import { describe, it, expect } from 'vitest'
import {
  createVortex, vortexEmitCount, vortexIntensity,
  TRAIL_LIFE, TRAIL_NODES, TRAIL_NODE_SPACING, TRAIL_REAL_NODES,
  VORTEX_G_FULL, VORTEX_G_ON, VORTEX_MAX_PER_FRAME, VORTEX_MAX_STEP, VORTEX_SEATS,
} from '../../src/render/vortex'
import { MAX_COMBATANTS } from '../../src/battle/skirmish'

describe('vortexIntensity', () => {
  it('平飛 1 g 什麼都沒有', () => {
    expect(vortexIntensity(1)).toBe(0)
  })

  it('門檻上恰好是 0', () => {
    expect(vortexIntensity(VORTEX_G_ON)).toBe(0)
  })

  it('拉滿是 1，超過也夾在 1', () => {
    expect(vortexIntensity(VORTEX_G_FULL)).toBe(1)
    expect(vortexIntensity(10)).toBe(1)
  })

  /**
   * 【為什麼取絕對值】負 G（推桿）時機翼一樣被載重，只是方向相反，翼尖
   * 一樣會凝。這條防的是有人把 Math.abs 拿掉。
   */
  it('負 G 與同大小的正 G 相同', () => {
    expect(vortexIntensity(-5)).toBe(vortexIntensity(5))
  })

  it('門檻與拉滿之間是連續遞增的', () => {
    const mid = (VORTEX_G_ON + VORTEX_G_FULL) / 2
    expect(vortexIntensity(mid)).toBeGreaterThan(0)
    expect(vortexIntensity(mid)).toBeLessThan(1)
  })
})

/**
 * 【間隔現在是常數，不再隨 intensity 變】管子是連續的，節點只需要抓得住
 * 路徑的彎曲 —— intensity 改為只管**透明度**（spec §13.3，專案負責人裁決
 * 「管子的透明度代表他的強度」）。
 *
 * 8 m 的由來：6 g / 200 m/s 的轉彎半徑 680 m，弦高誤差 `L²/(8R)`；最壞情形
 * （100 m/s @ 7 g，半徑 146 m）也只有 0.055 m，對半徑 0.6–2.0 m 的管子
 * 完全看不出來。
 */
describe('vortexEmitCount', () => {
  it('距離不足一個間隔就不加節點', () => {
    expect(vortexEmitCount(TRAIL_NODE_SPACING - 0.1)).toBe(0)
  })

  it('剛好三個間隔加三個節點', () => {
    expect(vortexEmitCount(TRAIL_NODE_SPACING * 3)).toBe(3)
  })

  it('被每幀上限夾住', () => {
    expect(vortexEmitCount(TRAIL_NODE_SPACING * 1000)).toBe(VORTEX_MAX_PER_FRAME)
  })
})

/** `emit` 的六個座標：兩個翼尖，世界座標。整架沿 +X 移到 `x`。 */
function tips(x: number): [number, number, number, number, number, number] {
  return [x, 1000, 0, x, 1000, 10]
}

/**
 * 【`live` 的語意】目前有幾個**節點**（含斷開處的退化節點），不是粒子數。
 * 下面每一條的期望值都是照 spec §13 的規則用 node 原型算出來的，不是猜的。
 */
describe('凝結尾的節點', () => {
  /**
   * 【第一幀不加節點】管子是「上一幀翼尖 → 這一幀翼尖」那條線段上的取樣，
   * 第一幀沒有上一幀可以連。少了這道守衛，換場後第一幀會從一個未初始化的
   * 位置（0,0,0）拉一條管子過來。
   */
  it('第一幀只記錄位置，不加節點', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    expect(v.live).toBe(0)
    v.dispose()
  })

  /**
   * 走 20 m：`floor(20/8) = 2` 個真實節點，加上斷開處的**兩個**退化節點
   * （spec §13.5），每個翼尖 4 個 → 共 8。
   */
  it('第二幀加節點：兩個真實 + 兩個退化，兩個翼尖共 8 個', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBe(8)
    v.dispose()
  })

  it('G 在門檻以下不加節點', () => {
    const v = createVortex()
    v.emit(0, 1, ...tips(0))
    v.emit(0, 1, ...tips(20))
    expect(v.live).toBe(0)
    v.dispose()
  })

  /**
   * 【門檻以下也要記錄位置】不記的話，從緩轉切進硬拉的第一幀會拿到很久
   * 以前的位置，拉出一條長管。
   *
   * 低 G 走到 24 m，再高 G 走 9 m：`floor(9/8) = 1` 個真實節點 + 2 個退化
   * ＝每翼尖 3 個 → 6。若拿到的是 0 m 那一幀的位置，距離會是 33 m →
   * `floor(33/8) = 4` 個真實節點 → 12。
   */
  it('門檻以下仍然記錄位置，切進高 G 時不會拉長管', () => {
    const v = createVortex()
    v.emit(0, 1, ...tips(0))
    v.emit(0, 1, ...tips(24))
    v.emit(0, 6, ...tips(33))
    expect(v.live).toBe(6)
    v.dispose()
  })

  /**
   * 【超過 MAX_STEP 不加節點】擋的是換場、重生、接手、以及分頁切回來時的
   * 巨大 dt —— 否則會出現一條橫跨半個地圖的白管。
   */
  it('位移超過上限不加節點，但位置有記錄下來', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(600))
    expect(v.live).toBe(0)
    // 下一幀恢復正常：從剛剛記錄的位置起算，走 24 m → 3 真實 + 2 退化 = 5，×2
    v.emit(0, 6, ...tips(624))
    expect(v.live).toBe(10)
    v.dispose()
  })

  it('單幀的真實節點不超過每幀上限', () => {
    const v = createVortex()
    v.emit(0, 6.5, ...tips(0))
    v.emit(0, 6.5, ...tips(VORTEX_MAX_STEP - 1))
    // 59 m / 8 = 7 個真實節點（未觸及 8 的上限）+ 2 退化 = 9，兩翼尖 18
    expect(v.live).toBe(18)
    expect(v.live).toBeLessThanOrEqual((VORTEX_MAX_PER_FRAME + 2) * 2)
    v.dispose()
  })

  /**
   * 【reset 也要清上一幀的位置與餘數】只清幾何的話，換場後第一幀會從上一場
   * 的位置拉一條管過來。MAX_STEP 是防線，但不能靠防線當設計 —— 所以第三幀
   * 的位移刻意落在 MAX_STEP 之內（40 − 20 = 20 m），否則那道防線會先擋掉、
   * 把 `seen` 的清除拿掉之後這條照樣綠。
   */
  it('reset 清掉節點與上一幀的位置', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.reset()
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(40))
    expect(v.live).toBe(0)      // 又是第一幀
    v.dispose()
  })

  it('座位超出範圍不會爆，也不踩到別的座位', () => {
    const v = createVortex()
    v.emit(VORTEX_SEATS, 6, ...tips(0))
    v.emit(VORTEX_SEATS, 6, ...tips(20))
    v.emit(-1, 6, ...tips(0))
    expect(v.live).toBe(0)
    // 【只斷言 live === 0 是守不住「不踩別人」的】拿掉守衛之後 typed array
    // 的越界讀寫在 JS 是 undefined / 靜默 no-op，live 仍是 0。真正驗得到的
    // 是：座位 0 的第一次 emit 仍然必須是「第一幀」。
    v.emit(0, 6, ...tips(0))
    expect(v.live).toBe(0)
    v.emit(0, 6, ...tips(20))
    expect(v.live).toBeGreaterThan(0)
    v.dispose()
  })

  /**
   * 【環形緩衝】每一條最多 `TRAIL_REAL_NODES` 個正式節點，滿了覆蓋最舊的
   * —— 尾跡的尾端先消失。與 `particles.ts` 的覆蓋策略一致。
   *
   * 【上限是環數減一，不是環數】最後一格留給活動頭端。塞滿到 `TRAIL_NODES`
   * 的話有效環數會變成 41 而 `writeTrail` 只寫得下 40 —— 頭端被擠掉，管頭
   * 退回最新的正式節點。見下方「高速塞滿緩衝之後，頭端仍然黏在翼尖」。
   */
  it('每一條的正式節點不超過 TRAIL_REAL_NODES，且它比環數少一', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    for (let k = 1; k <= 100; k++) v.emit(0, 6, ...tips(k * 40))
    expect(v.live).toBe(TRAIL_REAL_NODES * 2)
    expect(TRAIL_REAL_NODES).toBe(TRAIL_NODES - 1)
    v.dispose()
  })
})

/**
 * 【這一組守的是「同一個動作在不同機器上長得一樣」】`carry` 把「不滿一個
 * 間隔」的部分留到下一幀，而不是丟掉。少了它，一幀走不滿一個間隔就整幀
 * 丟掉 —— 粒子版實測起效門檻會從設計的 3 g 變成 3.93 g（200 m/s @60fps）、
 * 5.80 g（120 m/s）、而 120 fps 下永遠不出現。
 */
describe('餘數跨幀累積（幀率不變性）', () => {
  it('連續幾幀各走不滿一個間隔，累積之後才加節點', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))          // 第一幀只記錄
    for (const p of [2, 4, 6]) {      // 每幀 2 m，累積 2 / 4 / 6 < 8
      v.emit(0, 6, ...tips(p))
      expect(v.live).toBe(0)
    }
    v.emit(0, 6, ...tips(8))          // 累積 8 → 每翼尖 1 真實 + 2 退化
    expect(v.live).toBe(6)
    v.dispose()
  })

  /**
   * 【幀率不變性的操作型定義】走同樣的總距離，一大步、六中步、廿四小步
   * 必須加出**同樣多**的節點。沒有這一條，「同一個動作在不同機器上長得
   * 一樣」只是一個願望。
   */
  it('48 m：一步、六步、廿四步加出一樣多的節點', () => {
    const run = (steps: number): number => {
      const v = createVortex()
      v.emit(0, 6, ...tips(0))
      for (let k = 1; k <= steps; k++) v.emit(0, 6, ...tips((48 / steps) * k))
      const n = v.live
      v.dispose()
      return n
    }
    // 48 / 8 = 6 個真實節點 + 2 退化 = 8，兩個翼尖 16
    expect(run(1)).toBe(16)
    expect(run(6)).toBe(16)
    expect(run(24)).toBe(16)
  })
})

/**
 * 【跨層一致性，只有測試守得到】`vortex.ts` 依設計不得 import
 * `src/battle/`，所以 `VORTEX_SEATS` 與 `MAX_COMBATANTS` 這兩個常數在產品碼
 * 裡永遠碰不到面。這條是「有人把 20v20 改成 32v32 卻沒動 VORTEX_SEATS」的
 * 唯一防線 —— 症狀會是編號較大的那幾架完全沒有尾跡，而不是任何錯誤。
 */
describe('座位數容得下全部參戰者', () => {
  it('VORTEX_SEATS 不小於 MAX_COMBATANTS', () => {
    expect(VORTEX_SEATS).toBeGreaterThanOrEqual(MAX_COMBATANTS)
  })
})

/**
 * 【著色器注入找不到目標時不會報錯】`String.replace` 找不到就原樣回傳，
 * 於是逐頂點 alpha 會靜靜地失效 —— 管子變成一片不透明的白。這一條拿 three
 * 真正的 `ShaderLib.basic` 去斷言注入確實發生。與 `particles.ts` 的
 * `injectBillboard` 同一個理由（那邊的註解寫得更詳細）。
 */
describe('逐頂點 alpha 的著色器注入', () => {
  it('三個 chunk 都被改到', async () => {
    const { ShaderLib } = await import('three')
    const { injectVertexAlpha } = await import('../../src/render/vortex')
    const shader = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    }
    const before = shader.vertexShader + shader.fragmentShader
    injectVertexAlpha(shader)
    const after = shader.vertexShader + shader.fragmentShader
    expect(after).not.toBe(before)
    expect(shader.vertexShader).toContain('attribute float aAlpha')
    expect(shader.vertexShader).toContain('vAlpha = aAlpha')
    expect(shader.fragmentShader).toContain('gl_FragColor.a *= vAlpha')
  })
})

/**
 * 【這一組守的是「畫成什麼」】獨立審查指出：新增的測試全部落在 `tube.ts`
 * 的純函數與節點數上，而這一份的**全部目的**（頂點怎麼擺、alpha 怎麼寫、
 * 斷開處長什麼樣）一條斷言都沒有。
 *
 * 【測得起來】`vite.config.ts` 是 `environment: 'node'`，而 `BufferGeometry`
 * / `BufferAttribute` 是純 JS，不需要 WebGL context。
 */
describe('繪製層', () => {
  const alphaOf = (v: ReturnType<typeof createVortex>): Float32Array =>
    v.object.geometry.getAttribute('aAlpha').array as Float32Array
  const posOf = (v: ReturnType<typeof createVortex>): Float32Array =>
    v.object.geometry.getAttribute('position').array as Float32Array

  /**
   * 【頭端要黏在翼尖】正式節點每 8 m 才落一個，所以最新的正式節點永遠落後
   * 翼尖最多 8 m —— 專案負責人試飛時看到的正是這個：「管子是飛機飛出一段
   * 距離後才出現，會跟飛機有一個距離差」。活動頭端每幀重寫，永遠貼在當下
   * 的翼尖上。
   */
  it('走不滿一個間隔時，管子的頭端仍然在翼尖上', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))     // 落下 2 個正式節點（在 8 m 與 16 m）
    v.emit(0, 6, ...tips(23))     // 再走 3 m，不滿一個間隔
    v.step(1 / 60)
    // 右翼尖那一條（trail 1）的有效環裡，必須有一環的中心在 x = 23 附近
    const p = posOf(v)
    const base = 1 * TRAIL_NODES * 4 * 3
    let best = Infinity
    for (let j = 0; j < TRAIL_NODES; j++) {
      // 一環四個頂點的 x 平均就是環心
      let sx = 0
      for (let s = 0; s < 4; s++) sx += p[base + (j * 4 + s) * 3]!
      best = Math.min(best, Math.abs(sx / 4 - 23))
    }
    expect(best).toBeLessThan(0.01)
    v.dispose()
  })

  it('沒有頭端時（G 掉回門檻以下）管子停在最後一個正式節點', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(20))
    v.emit(0, 1, ...tips(23))     // G 掉下去
    v.step(1 / 60)
    const p = posOf(v)
    const base = 1 * TRAIL_NODES * 4 * 3
    let best = Infinity
    for (let j = 0; j < TRAIL_NODES; j++) {
      let sx = 0
      for (let s = 0; s < 4; s++) sx += p[base + (j * 4 + s) * 3]!
      best = Math.min(best, Math.abs(sx / 4 - 23))
    }
    expect(best).toBeGreaterThan(1)
    v.dispose()
  })

  /**
   * 【reset 之後頂點要被寫乾淨】只把節點數歸零的話，那 160 個頂點會維持
   * 上一場的內容（含非零 alpha）—— 換一場之後上一場的管子原地不動、
   * 而且永遠不會消失（沒有年齡可以讓它淡掉，`step` 根本不會碰它）。
   *
   * 粒子版靠 `pool.reset()` 把矩陣歸零解決，換成自建幾何之後那條路徑不見了。
   * 只斷言 `live === 0` 守不到這件事。
   */
  it('reset 之後每一個頂點的 alpha 都是 0', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(40))
    v.step(1 / 60)
    expect(alphaOf(v).some((a) => a > 0)).toBe(true)
    v.reset()
    expect(alphaOf(v).every((a) => a === 0)).toBe(true)
    v.dispose()
  })

  /** 節點全部老死之後也要寫乾淨 —— 否則最後一截會凍在空中。 */
  it('節點全部超過壽命之後 alpha 全歸零', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(40))
    v.emit(0, 1, ...tips(45))          // 收掉頭端，只留正式節點
    v.step(1 / 60)
    expect(alphaOf(v).some((a) => a > 0)).toBe(true)
    v.step(TRAIL_LIFE * 2)             // 全部過期
    v.step(1 / 60)                     // 再一幀把頂點寫乾淨
    expect(v.live).toBe(0)
    expect(alphaOf(v).every((a) => a === 0)).toBe(true)
    v.dispose()
  })

  /**
   * 【退化節點的半徑必須是 0】不收的話，它與相鄰的正式環同位置、不同半徑，
   * 會連出一片扁平的環形貼片。收成 0 之後那一帶是零長度的錐 —— 讀起來是
   * 把管口封起來的軟端蓋。
   */
  it('斷開處的退化節點半徑是 0（四個頂點重合在環心）', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(40))
    v.step(1 / 60)
    const p = posOf(v)
    const a = alphaOf(v)
    const base = 1 * TRAIL_NODES * 4
    // 第 0、1 環是斷開處推入的兩個退化節點（alpha 0）
    for (const j of [0, 1]) {
      expect(a[base + j * 4]).toBe(0)
      const x0 = p[(base + j * 4) * 3]!
      const y0 = p[(base + j * 4) * 3 + 1]!
      const z0 = p[(base + j * 4) * 3 + 2]!
      for (let s = 1; s < 4; s++) {
        expect(p[(base + j * 4 + s) * 3]).toBeCloseTo(x0, 6)
        expect(p[(base + j * 4 + s) * 3 + 1]).toBeCloseTo(y0, 6)
        expect(p[(base + j * 4 + s) * 3 + 2]).toBeCloseTo(z0, 6)
      }
    }
    v.dispose()
  })

  /**
   * 【緩衝塞滿之後頭端會被靜靜丟掉】`writeTrail` 只寫得下 `TRAIL_NODES` 環，
   * 而有效環數是「正式節點 + 頭端」。正式節點若佔滿全部 40 格，有效環數會是
   * 41 —— 頭端排在最後，於是永遠輪不到它，管頭退回最新的正式節點，與翼尖
   * 差最多一個間隔（8 m），而且隨著取樣相位在 0 與 8 m 之間來回跳。
   *
   * 【為什麼只有俯衝拉起看得到】緩衝要塞滿，得在 `TRAIL_LIFE`（1.4 s）之內
   * 走完 `(TRAIL_NODES − 1) × TRAIL_NODE_SPACING` = 312 m —— 也就是 223 m/s
   * 以上。緩轉（120 m/s）只用得到 21 格、200 m/s 也才 35 格，頭端一直都在；
   * 唯一衝得過那條線的動作就是俯衝拉起。專案負責人回報的「有的時候還是會
   * 斷頭，例如在俯衝抬升的時候」就是這個。
   *
   * 【修法是留一格，不是把 TRAIL_NODES 調大】調大只是把門檻推到更高的速度，
   * 而俯衝速度沒有上界。留一格之後「有效環數 ≤ TRAIL_NODES」是結構上成立的，
   * 與速度無關。
   */
  it('高速塞滿緩衝之後，頭端仍然黏在翼尖', () => {
    const v = createVortex()
    const dt = 1 / 60
    const stepM = 250 * dt              // 250 m/s，已在 228.6 m/s 的分界之上
    const base = 1 * TRAIL_NODES * 4
    let worst = 0
    for (let f = 0; f < 180; f++) {
      const x = f * stepM
      v.emit(0, 5, x, 1000, 0, x, 1000, 10)
      v.step(dt)
      if (f < 90) continue               // 前 1.5 s 等緩衝塞滿
      const p = posOf(v)
      const a = alphaOf(v)
      let best = Infinity
      for (let j = 0; j < TRAIL_NODES; j++) {
        if (a[base + j * 4]! <= 0) continue   // 退化節點與沒用到的環不算
        let sx = 0
        for (let s = 0; s < 4; s++) sx += p[base * 3 + (j * 4 + s) * 3]!
        best = Math.min(best, Math.abs(sx / 4 - x))
      }
      worst = Math.max(worst, best)
    }
    expect(worst).toBeLessThan(1e-3)
    v.dispose()
  })

  /**
   * 【沒用到的環要塌到**最後**一個有效環】塌到第一個的話，環 `used−1`
   * （最新、alpha 最高）與環 `used` 之間會連出一條從管頭回到管尾的
   * 320 m 長錐 —— 而且不會有任何別的測試紅。
   */
  it('沒用到的環塌到最後一個有效環的位置', () => {
    const v = createVortex()
    v.emit(0, 6, ...tips(0))
    v.emit(0, 6, ...tips(40))     // 2 退化 + 5 實 = 7 個節點，+ 頭端 = 8 環
    v.step(1 / 60)
    const p = posOf(v)
    const base = 1 * TRAIL_NODES * 4 * 3
    const cx = (j: number): number => {
      let s = 0
      for (let k = 0; k < 4; k++) s += p[base + (j * 4 + k) * 3]!
      return s / 4
    }
    // 頭端在 x = 40；其後每一環都該塌在那裡，而不是回到 x = 0
    const last = cx(7)
    expect(last).toBeCloseTo(40, 6)
    for (let j = 8; j < TRAIL_NODES; j++) expect(cx(j)).toBeCloseTo(last, 6)
    v.dispose()
  })
})
