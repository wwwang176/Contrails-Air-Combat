import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { createCommand } from '../../src/control/Controller'
import { CommandDelay } from '../../src/ai/delay'
import { applySafety } from '../../src/ai/safety'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { G4M } from '../../src/specs/g4m'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import { bombBayOf } from '../../src/weapons/bomb'
import { bombDragK, BOMB_TERMINAL_SPEED, solveImpact } from '../../src/world/bomb'
import type { BombState, Impact } from '../../src/world/bomb'
import {
  bombRunCommand, deckHeightOf, releaseRadiusOf, shipAt, shouldRelease, solveGateOf,
} from '../../src/ai/bombRun'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import type { Controller } from '../../src/control/Controller'

/** 什麼都不做的控制器。這幾條要驗的是彈艙與投彈，不是 AI。 */
const IDLE: Controller = { update() {} }

function add(w: World, spec = G4M): ReturnType<World['add']> {
  return w.add(new Aircraft(spec), IDLE, 'blue', new Vector3(0, 1000, 0))
}

describe('Command.bombing', () => {
  /**
   * 【預設必須是 false】它與 `firing` 是兩套武器，而一個新建的指令代表
   * 「什麼都不做」。預設 true 的話，任何忘記寫這一格的控制器都會讓那一架
   * 一出生就把整艙投光。
   */
  it('新建的指令不投彈', () => {
    expect(createCommand().bombing).toBe(false)
  })

  it('與 firing 是兩格', () => {
    const c = createCommand()
    c.firing = true
    expect(c.bombing).toBe(false)
  })
})

describe('Combatant.bombBay', () => {
  it('容量取自機種，一出場就滿艙', () => {
    const w = new World()
    const g4m = add(w, G4M)
    expect(g4m.bombBay.capacity).toBe(bombBayOf('g4m'))
    expect(g4m.bombBay.capacity).toBe(2)
    expect(g4m.bombBay.load).toBe(2)
  })

  /**
   * 【戰鬥機是零容量，不是「沒有這一格」】`stepBombBay` 在
   * `load === 0 && queue === 0` 時進回補、而回補又補回 0，所以空艙的機種
   * 結構上投不出東西 —— 不必在投彈那一段另外擋一次。
   */
  it('沒有彈艙的機種容量是 0', () => {
    const w = new World()
    expect(add(w, P51D).bombBay.capacity).toBe(0)
  })

  /**
   * 【換裝機種容量要跟著變】與 `cooldowns`／`muzzleFlash`／砲塔同一段。
   * 漏了的話：G4M 換成 P-51 之後那一架仍然投得出兩枚 500 kg，而畫面上
   * 沒有任何東西不對。
   */
  it('setSpec 之後容量跟著換，而且滿艙', () => {
    const w = new World()
    const c = add(w, P51D)
    expect(c.bombBay.capacity).toBe(0)

    w.setSpec(c, B17G)
    expect(c.bombBay.capacity).toBe(bombBayOf('b17g'))
    expect(c.bombBay.capacity).toBe(10)
    expect(c.bombBay.load).toBe(10)

    // 反向也要成立：換回沒有彈艙的機種，艙要歸零
    w.setSpec(c, P51D)
    expect(c.bombBay.capacity).toBe(0)
    expect(c.bombBay.load).toBe(0)
  })

  /**
   * 【換裝要取消回補計時】沿用舊計時的話，換完之後那一架會在滿艙的狀態下
   * 「正在回補」，扳機被吃掉最多 20 秒。
   */
  it('setSpec 取消回補與待投佇列', () => {
    const w = new World()
    const c = add(w, G4M)
    c.bombBay.load = 0
    c.bombBay.queue = 1
    c.bombBay.timer = 12
    c.bombBay.reloading = true

    w.setSpec(c, G4M)
    expect(c.bombBay.reloading).toBe(false)
    expect(c.bombBay.queue).toBe(0)
    expect(c.bombBay.timer).toBe(0)
    expect(c.bombBay.load).toBe(2)
  })
})

describe('bombing 穿過既有的指令管線', () => {
  /**
   * 【投彈直通 `CommandDelay`，不進緩衝區】反應延遲模型的是「看到→動作」
   * 的遲滯，而投彈的判準是 AI 對**自己此刻的彈道**算出來的。延遲 0.3 s
   * 之後飛機已經走了 27 m（90 m/s），大於最小的釋放半徑 12.08 m ——
   * 每一顆都會系統性地落在船尾之後。
   *
   * 【這一條守的是「整個功能靜靜地不動作」】漏掉這一格的話，`bombRunCommand`
   * 寫了也送不出去，AI 一顆都投不出來而且不報錯。
   */
  it('有反應延遲時投彈仍然當步送達', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.bombing = true
    // 0.3 s 的延遲、1/240 的步長 —— 緩衝區有 72 格
    d.push(input, 0.3, 1 / 240, out)
    expect(out.bombing).toBe(true)
  })

  it('放開之後也是當步歸零，不會殘留', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.bombing = true
    d.push(input, 0.3, 1 / 240, out)
    input.bombing = false
    d.push(input, 0.3, 1 / 240, out)
    expect(out.bombing).toBe(false)
  })

  it('零延遲那條捷徑也要傳遞', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.bombing = true
    d.push(input, 0, 1 / 240, out)
    expect(out.bombing).toBe(true)
  })
})

describe('applySafety 取消投彈', () => {
  /**
   * 【接管時航向已經被改掉】而釋放的判準是照原本那條航路算的 —— 不取消的話
   * 炸彈會在偏離解算航路之後才出去。兩個接管分支（撞地、失速）都要關。
   */
  it('撞地接管時關掉 bombing', () => {
    const a = new Aircraft(G4M)
    // 低空、下沉：撞地接管的條件
    a.state.position.set(0, 40, 0)
    a.state.velocity.set(0, -60, -80)
    const out = createCommand()
    out.bombing = true
    out.firing = true
    const action = applySafety(a, 0, out)
    expect(action).not.toBe('none')
    expect(out.firing).toBe(false)
    expect(out.bombing).toBe(false)
  })
})

// ── 轟炸航路 ──────────────────────────────────────────────────────────

const K = bombDragK(BOMB_TERMINAL_SPEED)
const DT = 1 / 240

describe('releaseRadiusOf', () => {
  it('就是該艘船的船寬', () => {
    expect(releaseRadiusOf(SHIP_CLASSES.fletcher)).toBeCloseTo(12.08, 6)
    expect(releaseRadiusOf(SHIP_CLASSES.wichita)).toBeCloseTo(18.82, 6)
  })

  /**
   * 【Essex 取主艦體，不是飛行甲板】它有兩個盒：艦體寬 28.4 m、飛行甲板
   * 寬 43 m。照 `deckHeightOf` 那樣取極值的話釋放半徑會放大 51%
   * （Codex 審查 C7）。
   */
  it('Essex 取的是艦體 28.4 m，不是飛行甲板的 43 m', () => {
    expect(releaseRadiusOf(SHIP_CLASSES.essex)).toBeCloseTo(28.4, 6)
  })
})

describe('deckHeightOf', () => {
  /** 【與釋放半徑相反，這一個取極值】甲板是船體盒的最高點。 */
  it('是船體盒的最高點', () => {
    expect(deckHeightOf(SHIP_CLASSES.fletcher)).toBeCloseTo(4.5, 6)
    expect(deckHeightOf(SHIP_CLASSES.essex)).toBeCloseTo(14, 6)
  })
})

describe('shipAt', () => {
  /**
   * 【外推是這整件事的關鍵】船 8 m/s、炸彈從 1,000 m 落下約 14 秒 ——
   * 112 m，而弗萊徹全長 114.75 m。不外推的話每一顆都落在船尾之後接近
   * 一整個船身，**而且看起來只是「AI 投得不準」**。
   */
  it('艏向 0 時 14 秒後往 −Z 走 112 m', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 8)
    const at = shipAt(sh, 14, new Vector3())
    expect(at.z).toBeCloseTo(-112, 6)
    expect(at.x).toBeCloseTo(0, 9)
  })

  it('速度 0 的船原地不動', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 30, -40, 0.7, 0)
    const at = shipAt(sh, 99, new Vector3())
    expect(at.x).toBeCloseTo(30, 9)
    expect(at.z).toBeCloseTo(-40, 9)
  })
})

describe('solveGateOf', () => {
  /**
   * 【必須是上界】算小了會把真正的釋放窗擋在外面，而症狀是「AI 飛過去
   * 卻不投」—— 沒有任何錯誤。1,000 m 的實際水平行程約 1,260 m。
   */
  it('1,000 m 的閘寬於實際的水平行程', () => {
    expect(solveGateOf(1000)).toBe(2500)
    // 實測這個高度、90 m/s 平飛下的水平行程
    const st: BombState = { x: 0, y: 1000, z: 0, vx: 0, vy: 0, vz: -90 }
    const hit: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
    expect(solveImpact(st, K, () => 0, DT, hit)).toBe(true)
    expect(Math.hypot(hit.x, hit.z)).toBeLessThan(solveGateOf(1000))
  })
})

/**
 * 定高定速直線飛向一艘**靜止**的弗萊徹，一步一步走，直到解算說「投」。
 *
 * 【為什麼是無誤差的條件】專案負責人 2026-09-04 的裁定：測試要用測試專用
 * 的無誤差條件去打才有鑑別度，統計沒有。所以這裡沒有 AI、沒有搖晃、沒有
 * 姿態控制 —— 只有「一架飛機在一條直線上」與那條彈道。
 */
// 【步數上限要夠追】會動的船讓接近速度掉到 82 m/s，追到釋放點要約 18 秒
// ＝ 4,300 步。4,000 會讓那一條靜靜地失敗，而症狀是「解算壞了」。
function flyUntilRelease(shipSpeed: number, maxSteps = 9000): {
  released: boolean; impact: Impact; ship: ReturnType<typeof createShip>
} {
  const cls = SHIP_CLASSES.fletcher
  // 船在 −Z 方向 2,500 m 外，艏向 0（也往 −Z 走）
  const ship = createShip(0, cls, 'red', 0, -2500, 0, shipSpeed)
  const a = new Aircraft(G4M)
  a.state.position.set(0, 1000, 0)
  a.state.velocity.set(0, 0, -90)

  const hit: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
  for (let i = 0; i < maxSteps; i++) {
    if (shouldRelease(a, ship, K, DT)) {
      const st: BombState = {
        x: a.state.position.x, y: a.state.position.y, z: a.state.position.z,
        vx: a.state.velocity.x, vy: a.state.velocity.y, vz: a.state.velocity.z,
      }
      solveImpact(st, K, () => deckHeightOf(cls), DT, hit)
      return { released: true, impact: hit, ship }
    }
    // 定高定速直線：飛機自己走，船也走
    a.state.position.addScaledVector(a.state.velocity, DT)
    ship.position.z -= ship.speed * DT
  }
  return { released: false, impact: hit, ship }
}

describe('shouldRelease', () => {
  /**
   * 【落點要落在船體盒內】不是「差不多」—— 弗萊徹半長 57.4 m、半寬 6.04 m，
   * 落在盒內才是真的打中。
   */
  it('對靜止的船：投得出來，而且落點在船體盒內', () => {
    const r = flyUntilRelease(0)
    expect(r.released).toBe(true)
    const b = SHIP_CLASSES.fletcher.hull[0]!
    expect(Math.abs(r.impact.x - r.ship.position.x)).toBeLessThanOrEqual(b.half.x)
    expect(Math.abs(r.impact.z - r.ship.position.z)).toBeLessThanOrEqual(b.half.z)
  })

  /**
   * 【會動的船也要打得中】這一條是外推那一段的正面驗收：船 8 m/s，
   * 落點必須跟著跑到船屆時的位置上。
   */
  it('對 8 m/s 的船：落點落在它屆時的位置的船體盒內', () => {
    const r = flyUntilRelease(8)
    expect(r.released).toBe(true)
    // 【期望值就地算，不呼叫 `shipAt`】用同一支函數的話，把外推拿掉的變異
    // 會在等式兩邊同時生效而**自我抵銷** —— 這一條就不再是反證。
    // 艏向 0 = 往 −Z，所以屆時的位置是 z − 8t。
    const atZ = r.ship.position.z - 8 * r.impact.seconds
    const b = SHIP_CLASSES.fletcher.hull[0]!
    expect(Math.abs(r.impact.x - r.ship.position.x)).toBeLessThanOrEqual(b.half.x)
    expect(Math.abs(r.impact.z - atZ)).toBeLessThanOrEqual(b.half.z)
  })

  it('離太遠時不投', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -7000, 0, 0)
    const a = new Aircraft(G4M)
    a.state.position.set(0, 1000, 0)
    a.state.velocity.set(0, 0, -90)
    expect(shouldRelease(a, ship, K, DT)).toBe(false)
  })
})

describe('bombRunCommand', () => {
  it('平飛：aimWorld 沒有垂直分量', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -2000, 0, 8)
    const a = new Aircraft(G4M)
    a.state.position.set(0, 1000, 0)
    a.state.velocity.set(0, -12, -90)
    const out = createCommand()
    bombRunCommand(a, ship, false, out)
    expect(out.aimWorld.y).toBe(0)
    expect(out.aimWorld.length()).toBeCloseTo(1, 9)
  })

  /** 【轟炸航路不開固定槍】B-17 與 He 111 有槍，掃射會把機首拉離航路。 */
  it('不開固定槍，而且 bombing 照參數走', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -2000, 0, 8)
    const a = new Aircraft(G4M)
    a.state.position.set(0, 1000, 0)
    a.state.velocity.set(0, 0, -90)
    const out = createCommand()
    out.firing = true
    bombRunCommand(a, ship, true, out)
    expect(out.firing).toBe(false)
    expect(out.bombing).toBe(true)
    bombRunCommand(a, ship, false, out)
    expect(out.bombing).toBe(false)
  })
})

describe('解算平面是甲板，不是海面', () => {
  /**
   * 【4.5 m 的落差在 57 m 的盒裡看不出來】所以要直接比「同一條航路對兩艘
   * 只差甲板高度的船」的釋放時機。用海面解算的話兩者會在同一點放，
   * 而那正是這一條要否證的。
   */
  it('甲板高的船釋放得比較早', () => {
    const flat = {
      ...SHIP_CLASSES.fletcher,
      hull: [{
        center: new Vector3(0, 0, 0),
        half: new Vector3(6.04, 1e-6, 57.4),
      }],
    }
    const release = (cls: typeof SHIP_CLASSES.fletcher): number => {
      const ship = createShip(0, cls, 'red', 0, -2500, 0, 0)
      const a = new Aircraft(G4M)
      a.state.position.set(0, 1000, 0)
      a.state.velocity.set(0, 0, -90)
      for (let i = 0; i < 9000; i++) {
        if (shouldRelease(a, ship, K, DT)) return a.state.position.z
        a.state.position.addScaledVector(a.state.velocity, DT)
      }
      return NaN
    }
    const deck = release(SHIP_CLASSES.fletcher)
    const sea = release(flat)
    expect(Number.isNaN(deck)).toBe(false)
    expect(Number.isNaN(sea)).toBe(false)
    // 甲板高 4.5 m ⇒ 少掉那 4.5 m 的落程 ⇒ 前拋較短 ⇒ 要更靠近才投
    // （z 是負方向前進，所以「更靠近」是更小的 z）
    expect(deck).toBeLessThan(sea)
  })
})
