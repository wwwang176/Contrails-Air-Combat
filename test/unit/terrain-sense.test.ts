import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createCommand } from '../../src/control/Controller'
import { applySafety } from '../../src/ai/safety'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import {
  createSense, resetSense, senseTerrain, SENSE_RANGE, terrainCeiling,
  type TerrainSense, type TerrainSource,
} from '../../src/ai/terrainSense'
import { createArchipelago, type IslandDesc } from '../../src/world/archipelago'

/**
 * 地形感知。**這裡斷言的是控制律，不是地形內容** —— 所以 fixture 是手寫的
 * 島，不是 `createArchipelago()`。
 *
 * 【為什麼是圓盤而不是沿航跡取樣高度場】射線取樣被三件事否決：步長比格距
 * 大就會跨過窄峰；射線是直線而飛機走弧線；而且射線相對於**當下航向**，
 * 飛機一轉，同一條射線掃的就是另一塊區域 —— 「那一側仍然通」因此不等於
 * 「原本那條走廊仍然通」，鎖存的解除條件寫不出來。
 *
 * 圓盤沒有這三個問題：解析、沒有取樣、而且**知道自己在繞哪一座島**。
 */

const WOBBLE = 1.29

/**
 * 一座**只有主瓣**的島 —— 也就是這一檔原本的那顆圓錐。
 *
 * 【為什麼這裡不放次峰】這一檔測的是圓盤法（進入點、鎖存、解除），而那一層
 * 只讀 `outerRadius`。次峰對它完全不相干，放進來只會讓每一條斷言多背一個
 * 與它無關的變因。偏心的次峰由下面「爬升判斷看得見偏心的次峰」單獨守。
 */
function island(cx: number, cz: number, radius: number, peak: number): IslandDesc {
  return {
    cx, cz, radius, outerRadius: radius * WOBBLE, peak,
    lobes: [{ cx, cz, offset: 0, radius, peak, pa: 0, pb: 0 }],
  }
}

/** 飛機放在原點，朝 −Z 飛（three 的預設前方），高度與速度可指定 */
function flyer(altitude: number, tasKmh: number): Aircraft {
  const ac = new Aircraft(P51D, altitude, tasKmh / 3.6)
  ac.state.position.set(0, altitude, 0)
  ac.state.velocity.set(0, 0, -tasKmh / 3.6)
  return ac
}

const src = (...islands: IslandDesc[]): TerrainSource => ({ islands })

/** 跑 n 次感知，回傳每一次的 turn */
function run(self: Aircraft, s: TerrainSource, out: TerrainSense, n: number): number[] {
  const seen: number[] = []
  for (let i = 0; i < n; i++) {
    senseTerrain(self, s, out)
    seen.push(out.turn)
  }
  return seen
}

describe('senseTerrain', () => {
  it('前方無島 —— 不介入，地板是海面', () => {
    const out = createSense()
    senseTerrain(flyer(500, 600), src(island(9000, -9000, 1500, 900)), out)
    expect(out.turn).toBe(0)
    expect(out.island).toBe(-1)
    expect(out.floor).toBe(0)
  })

  /**
   * 【情境】左右各一座撞不過的山，前方通得過 —— 飛機應該
   * **直穿過去，不轉也不拉高**。
   *
   * 這一條抓的是被否決的那個設計：拿「左右誰比較低」當判準的話，峽谷裡
   * 永遠有答案（左邊矮 20 m），於是飛機在兩堵牆之間搖擺著撞上去。
   */
  it('通道直穿 —— 左右都有高山、中間通得過，不介入', () => {
    const out = createSense()
    const wallL = island(-2500, -600, 1500, 900)
    const wallR = island(2500, -600, 1500, 900)
    senseTerrain(flyer(300, 600), src(wallL, wallR), out)
    expect(out.turn).toBe(0)
    expect(out.island).toBe(-1)
  })

  it('正前方有島但爬得過 —— 不轉，但地板抬高交給既有的 ground 分支', () => {
    const out = createSense()
    // 高度 3,000 m、島峰 200 m：綽綽有餘
    senseTerrain(flyer(3000, 600), src(island(0, -800, 500, 200)), out)
    expect(out.turn).toBe(0)
    expect(out.floor).toBeGreaterThan(0)
  })

  it('正前方有島爬不過 —— 轉，而且方向背離島心', () => {
    const out = createSense()
    // 島心偏左（−x），所以要往右（+turn 或 −turn 由座標系決定）轉開
    senseTerrain(flyer(200, 600), src(island(-200, -900, 1200, 900)), out)
    expect(out.turn).not.toBe(0)
    expect(out.island).toBe(0)
    const left = out.turn
    // 島心偏右時方向要相反
    const out2 = createSense()
    senseTerrain(flyer(200, 600), src(island(200, -900, 1200, 900)), out2)
    expect(Math.sign(out2.turn)).toBe(-Math.sign(left))
  })

  /**
   * 【鎖存不反轉】承諾了一個方向就繞完它。單次讀值只能升級成拉起，
   * 不能反向 —— 否則就是換一個觸發條件的乒乓。
   */
  /**
   * 【飛機必須真的在動】先前這條對一架**靜止**的飛機重複呼叫二十次 ——
   * 每次的輸入完全相同，所以它抓不到「turn 變 0 之後承諾符號遺失」那種
   * 失效。現在每一步都推進位置並照 turn 轉動航向。
   */
  it('鎖存不反轉 —— 一邊飛一邊繞，承諾側全程同號', () => {
    const out = createSense()
    const self = flyer(150, 600)
    /**
     * 【fixture 的三個條件缺一不可】島要**進得了感知距離**（島心 1,077 m，
     * 而感知是 1,200）、要**爬不過**（進場 150 m，20° 爬升在最近點只到
     * 477 m 而地形 420 m 加餘裕 120）、而且要**繞得開**（需要橫移 400 m，
     * 1.2 km 內轉 30° 給得出 555 m）。
     *
     * 少了任何一個，senseTerrain 都會正確地回 turn = 0，於是這條測到的就
     * 不是鎖存了 —— 前兩版 fixture 各踩了一個。
     */
    const s = src(island(-400, -1000, 600, 900))
    const speed = 600 / 3.6
    const sides: number[] = []
    for (let i = 0; i < 40; i++) {
      senseTerrain(self, s, out)
      if (out.side !== 0) sides.push(out.side)
      // 照這一步的 turn 轉一點，再往前飛一個感知週期
      const step = out.turn * 0.25
      const c = Math.cos(step)
      const sn = Math.sin(step)
      const v = self.state.velocity
      const vx = v.x * c - v.z * sn
      const vz = v.x * sn + v.z * c
      v.set(vx, 0, vz).normalize().multiplyScalar(speed)
      const dt = (12 / 240)
      self.state.position.x += v.x * dt
      self.state.position.z += v.z * dt
    }
    // 實測鎖存三個感知週期就解除 —— 轉開之後就不再有交會，那是對的。
    // 兩次就足以抓到反轉，三次留一點餘裕
    expect(sides.length).toBeGreaterThanOrEqual(3)
    const first = sides[0]!
    for (const x of sides) expect(x).toBe(first)
  })

  /**
   * 【把兩層串起來】只驗「左右兩案符號相反」的話，terrainSense 與
   * applySafety **同時**整體反號時仍然會綠 —— 而那個 bug 會讓 AI 往島的
   * 方向轉。這一條問的是最終結果：安全層輸出的航向，與島心的夾角有沒有
   * 變大。
   */
  it('安全層輸出的航向確實背離島心 —— 不只是符號相反', () => {
    const out = createSense()
    // 戰鬥機固定餘裕已改為 30 m；把 fixture 壓到 100 m，讓「爬不過、必須
    // 橫向繞」的前提仍成立。測試守的是轉向符號，不是舊 120 m 門檻。
    const self = flyer(100, 600)
    const isl = island(-300, -1600, 900, 900)
    senseTerrain(self, src(isl), out)
    expect(out.turn).not.toBe(0)

    const cmd = createCommand()
    cmd.aimWorld.set(0, 0, -1)
    const act = applySafety(self, out.floor, cmd, undefined, out)
    expect(act).toBe('terrain')

    const toIsl = new Vector3(isl.cx, 0, isl.cz).sub(self.state.position).setY(0).normalize()
    const before = new Vector3(0, 0, -1)
    const after = new Vector3(cmd.aimWorld.x, 0, cmd.aimWorld.z).normalize()
    // 夾角變大 = 內積變小
    expect(after.dot(toIsl)).toBeLessThan(before.dot(toIsl))
  })

  it('飛過去之後解除鎖存', () => {
    const out = createSense()
    const self = flyer(200, 600)
    const isl = island(0, -900, 800, 900)
    senseTerrain(self, src(isl), out)
    expect(out.island).toBe(0)
    // 把飛機挪到島的另一側、遠離膨脹圓
    self.state.position.set(0, 200, -900 - isl.outerRadius * 3)
    for (let i = 0; i < 5; i++) senseTerrain(self, src(isl), out)
    expect(out.island).toBe(-1)
    expect(out.turn).toBe(0)
  })

  it('resetSense 清空 —— playerAi 跨場重用，上一場的承諾不得帶進新場', () => {
    const out = createSense()
    senseTerrain(flyer(200, 600), src(island(-200, -900, 1200, 900)), out)
    expect(out.island).not.toBe(-1)
    resetSense(out)
    expect(out.island).toBe(-1)
    expect(out.turn).toBe(0)
    expect(out.floor).toBe(0)
  })

  it('速度為零不 NaN', () => {
    const out = createSense()
    const self = flyer(200, 600)
    self.state.velocity.set(0, 0, 0)
    senseTerrain(self, src(island(0, -900, 1200, 900)), out)
    expect(Number.isFinite(out.turn)).toBe(true)
    expect(Number.isFinite(out.floor)).toBe(true)
  })

  it('感知距離之外的島不算威脅', () => {
    const out = createSense()
    const far = island(0, -(SENSE_RANGE * 3), 1200, 900)
    senseTerrain(flyer(200, 600), src(far), out)
    expect(out.island).toBe(-1)
  })
})

/**
 * 偏心的次峰。**多瓣的群島下，這一組是最容易靜默失效的地方。**
 *
 * `profileHeight` 不能只吃「離島心多遠」—— 那在圓對稱的島上才對。多瓣的島
 * 次峰是偏心的：航跡從側面掠過去時，離島心最近的那一點是主瓣的山腰，而真正
 * 擋路的次峰在旁邊。低估的方向是「我爬得過去」—— 而症狀是撞上去。
 */
describe('爬升判斷看得見偏心的次峰', () => {
  /** 主瓣 + 一顆放在方位 `dir`、距島心 `offset` 的次峰 */
  const lobed = (
    cx: number, cz: number, radius: number, peak: number,
    offset: number, dir: number, lobeR: number, lobePeak: number,
  ): IslandDesc => ({
    cx, cz, radius, outerRadius: radius * WOBBLE, peak,
    lobes: [
      { cx, cz, offset: 0, radius, peak, pa: 0, pb: 0 },
      {
        cx: cx + Math.cos(dir) * offset, cz: cz + Math.sin(dir) * offset,
        offset, radius: lobeR, peak: lobePeak, pa: 0, pb: 0,
      },
    ],
  })

  /**
   * 【對照組是同一座島拿掉次峰】兩者的主瓣、位置、航跡完全相同，所以兩邊
   * 回報的地板只差在「次峰算不算數」。少了對照組的話，一個偏高的地板可能
   * 只是主瓣本來就那麼高。
   *
   * 【這一條守的是 `checkClimb` 的取樣點】估計式本身由下一條守。那裡只補
   * 「離島心最近的那一點」是不夠的：那是主瓣的極大值，而偏心的次峰在它
   * 旁邊，八個等距點抓不抓得到是運氣。
   */
  it('側面掠過時，地板恰好抬到次峰在航跡上的最高點', () => {
    const R = 1400
    const P = 900
    /**
     * 【次峰刻意誇大】550 m 比生成器真的會抽出來的高（`LOBE_SLOPE` 把它
     * 壓在 0.386 × 900 = 347 以下）。這裡要的是把「看得見／看不見」的差距
     * 放大到讀得出來 —— 用合法的極值只差幾十公尺，斷言會被幾何細節綁住。
     *
     * **它仍然守住兩個不變式**：放得下（1200 + 450 × 1.29 = 1780 ≤
     * outerRadius 1806），而且低於島的 peak。生成器的合法範圍另外由
     * `archipelago.test.ts` 的「每一瓣都放得下」守。
     */
    const OFF = 1200
    const LP = 550
    const CZ = -950
    /**
     * 【次峰要偏開島心的正側方】航跡是 x = 1,100 那條線、朝 −z 飛，所以
     * 「離某一點最近的 s」就是那一點的 −z。次峰與島心同一條 z 的話兩者的
     * 最近點是**同一個 s**，補不補都一樣 —— 測不到那幾個點。
     *
     * 偏 45° 之後島心的最近點在 s = 950、次峰的在 s = 102，而八個等距點是
     * 150、300、…、1,200。
     */
    const PERP = 1100
    const fly = (): Aircraft => {
      const ac = flyer(3000, 600)
      ac.state.position.set(PERP, 3000, 0)
      return ac
    }
    const withLobe = lobed(0, CZ, R, P, OFF, Math.PI / 4, 450, LP)
    const a = createSense()
    const b = createSense()
    senseTerrain(fly(), src(island(0, CZ, R, P)), a)
    senseTerrain(fly(), src(withLobe), b)
    // 航跡最靠近次峰心的那一點上，地形上界是多少
    const atClosest = terrainCeiling(withLobe, PERP, withLobe.lobes[1]!.cz)
    console.log(JSON.stringify({
      只有主瓣: a.floor.toFixed(2), 有次峰: b.floor.toFixed(2),
      最近點: atClosest.toFixed(2),
    }))
    // 對照組：只有主瓣的同一座島讀不到這個高度
    expect(a.floor).toBeLessThan(atClosest)
    /**
     * 【要求「恰好等於最近點的值」而不是「夠高」】等距的八點只差幾公尺 ——
     * 用不等式的話拿掉補點也照樣綠。實測過。
     */
    expect(b.floor).toBeCloseTo(atClosest, 6)
  })

  /**
   * 【估計必須恆 ≥ 實際地形】那是圓盤法保守性的全部內容 —— 低估的方向是
   * 「我爬得過去」，而症狀是撞上去。
   *
   * 【逐點比，不是逐圈比】上界是逐瓣量真正的二維距離算的，所以它與高度場
   * 是同一個座標系的兩份獨立實作 —— 這一條驗的正是兩份對得上。
   *
   * 【比的是高度場的格點，不是 `sample`】格點是 `bake` 直接算出來的，沒有
   * 內插，所以這一條是精確的。內插在山腳那種凸的地方會略高於解析值，那會
   * 讓這條測試變成在量內插誤差。
   *
   * 【為什麼掃真的群島】手寫的島驗不到「生成器造出來的每一種組合」。
   */
  it('地形高度的上界恆不低於真實的地形', () => {
    const { field, islands } = createArchipelago()
    let worst = Infinity
    let where = ''
    // 【5 m 步長，不是逐格點】格是 40 m，所以每一格取到 8×8 個**內部**點 ——
    // 那正是內插會高過解析值的地方。只比格點的話這條測試會漏掉 16 m 的低估
    for (const isl of islands) {
      for (let z = isl.cz - isl.outerRadius; z <= isl.cz + isl.outerRadius; z += 5) {
        for (let x = isl.cx - isl.outerRadius; x <= isl.cx + isl.outerRadius; x += 5) {
          if (Math.hypot(x - isl.cx, z - isl.cz) > isl.outerRadius) continue
          const slack = terrainCeiling(isl, x, z) - field.sample(x, z)
          if (slack < worst) { worst = slack; where = `${x.toFixed(0)},${z.toFixed(0)}` }
        }
      }
    }
    console.log(JSON.stringify({ 最小餘裕: worst.toFixed(2) + ' m', where }))
    expect(worst).toBeGreaterThan(0)
  })
})
