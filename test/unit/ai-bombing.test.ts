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
import { loadoutOf } from '../../src/weapons/stores'
import { blastRadiusOf } from '../../src/weapons/bomb'
import { bombDragK, BOMB_TERMINAL_SPEED, solveImpact } from '../../src/world/bomb'
import type { BombState, Impact } from '../../src/world/bomb'
import { A6M5 } from '../../src/specs/a6m5'
import {
  BOMB_PROFILE, RELEASE_HULLS, RUN_SETTLE, createBombAim, deckHeightOf, insideWindow,
  releaseWindowOf, setBombBallistics, shipAt, shouldRelease, solveGateOf, stepBombAim,
} from '../../src/ai/bombRun'
import { createStrikeState, stepStrike, RUN_TRIM } from '../../src/ai/strikeRun'
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
    // 【不寫死枚數】G4M 的預設掛載是九一式航空魚雷 ×1，任務卡可以用
    // `blueLoadout` 換成炸彈 ×2（japan-m4 就是）。這一條守的是「容量取自
    // 掛載表」，不是某一個數字。
    const n = loadoutOf('g4m')?.count ?? 0
    expect(n).toBeGreaterThan(0)
    expect(g4m.bombBay.capacity).toBe(n)
    expect(g4m.bombBay.load).toBe(n)
    expect(g4m.loadout).toBe(loadoutOf('g4m'))
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
   * 漏了的話：轟炸機換成 P-51 之後那一架仍然投得出東西，而畫面上沒有
   * 任何東西不對。
   */
  it('setSpec 之後容量跟著換，而且滿艙', () => {
    const w = new World()
    const c = add(w, P51D)
    expect(c.bombBay.capacity).toBe(0)

    w.setSpec(c, B17G)
    expect(c.bombBay.capacity).toBe((loadoutOf('b17g')?.count ?? 0))
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
    expect(c.bombBay.load).toBe(loadoutOf('g4m')?.count ?? 0)
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

describe('releaseWindowOf', () => {
  /**
   * 【窗是方的，不是圓的】艦體細長：弗萊徹半長 57.4 m 對半寬 6.04 m，
   * 差 9.5 倍。用一個圓去比的話，取大的會投一堆從船頭前面擦過去的彈、
   * 取小的則正橫進場永遠不准投。
   *
   * 【為什麼是艦體的兩倍】判準是**玩起來好不好玩**，不是命中率。放寬到
   * 兩倍讓 AI 願意投，投出去中不中交給彈道 —— 傷害判定一個字都不動。
   */
  it('是艦體半長半寬的 RELEASE_HULLS 倍', () => {
    const w = releaseWindowOf(SHIP_CLASSES.fletcher)
    expect(w.along).toBeCloseTo(57.4 * RELEASE_HULLS, 6)
    expect(w.across).toBeCloseTo(6.04 * RELEASE_HULLS, 6)
  })

  /**
   * 【窗遠大於殺傷半徑，這是刻意的】500 kg 的殺傷半徑是 39 m，而弗萊徹
   * 沿船身的窗有 114.8 m。窗口邊緣放手的那一顆一定不會造成傷害 ——
   * AI 願意投、飛得順比命中率重要。
   */
  it('沿船身的窗遠大於殺傷半徑', () => {
    expect(releaseWindowOf(SHIP_CLASSES.fletcher).along)
      .toBeGreaterThan(blastRadiusOf(11_700))
  })

  /**
   * 【Essex 取主艦體，不是飛行甲板】它有兩個盒：艦體寬 28.4 m、飛行甲板
   * 寬 43 m。取極值會讓窗橫向放大 51%。
   */
  it('Essex 取的是艦體不是飛行甲板', () => {
    expect(releaseWindowOf(SHIP_CLASSES.essex).across).toBeCloseTo(14.2 * RELEASE_HULLS, 6)
  })

  /** 【誤差要拆進船的體軸】船是斜的時候，世界座標的差向量沒有意義 */
  it('窗依船的艏向擺放', () => {
    // 艏向 90°：船身沿 ±X，所以 X 方向可以差很遠、Z 方向不行
    // 弗萊徹的窗是 86.1 × 9.06（半長半寬乘 RELEASE_HULLS）
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, Math.PI / 2, 0)
    expect(insideWindow(s, 80, 0)).toBe(true)
    expect(insideWindow(s, 0, 80)).toBe(false)
    expect(insideWindow(s, 0, 8)).toBe(true)
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
 * 【為什麼是無誤差的條件】測試要用測試專用
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
  it('對靜止的船：投得出來，而且落點在釋放窗內', () => {
    const r = flyUntilRelease(0)
    expect(r.released).toBe(true)
    const w = releaseWindowOf(SHIP_CLASSES.fletcher)
    // 艏向 0：船身沿 Z，所以 z 差比的是 along、x 差比的是 across
    expect(Math.abs(r.impact.x - r.ship.position.x)).toBeLessThanOrEqual(w.across)
    expect(Math.abs(r.impact.z - r.ship.position.z)).toBeLessThanOrEqual(w.along)
  })

  /**
   * 【外推的正面驗收在瞄點上，不在落點上】釋放窗放寬到艦體的兩倍之後，
   * 落點那一側量不到外推了：船 8 m/s、落彈 14 s 走 112 m，而弗萊徹沿船身的
   * 窗有 114.8 m —— 把外推整段拿掉，落點仍然落在窗內。
   *
   * 瞄點沒有這個問題，它是**船屆時的位置**本身。
   *
   * 【期望值就地算，不呼叫 `shipAt`】用同一支函數的話，把外推拿掉的變異會在
   * 等式兩邊同時生效而自我抵銷 —— 這一條就不再是反證。艏向 0 = 往 −Z。
   */
  it('瞄點跟著船外推：8 m/s 的船，瞄點領先它落彈時間 × 船速', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -2500, 0, 8)
    const a = new Aircraft(G4M)
    a.state.position.set(0, 1000, 0)
    a.state.velocity.set(0, 0, -90)
    const plan = { aim: new Vector3(), lockRange: 0, egressRange: 0 }
    setBombBallistics(K, DT)
    BOMB_PROFILE.plan(a, ship, plan)

    const hit: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
    const st: BombState = { x: 0, y: 1000, z: 0, vx: 0, vy: 0, vz: -90 }
    expect(solveImpact(st, K, () => deckHeightOf(SHIP_CLASSES.fletcher), DT, hit)).toBe(true)
    expect(plan.aim.z).toBeCloseTo(ship.position.z - 8 * hit.seconds, 6)
    expect(plan.aim.x).toBeCloseTo(ship.position.x, 9)
    // 外推的量要真的看得見 —— 14 秒約 112 m
    expect(ship.position.z - plan.aim.z).toBeGreaterThan(100)
  })

  it('對 8 m/s 的船也投得出來', () => {
    expect(flyUntilRelease(8).released).toBe(true)
  })

  it('離太遠時不投', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -7000, 0, 0)
    const a = new Aircraft(G4M)
    a.state.position.set(0, 1000, 0)
    a.state.velocity.set(0, 0, -90)
    expect(shouldRelease(a, ship, K, DT)).toBe(false)
  })
})

describe('攻擊航路的狀態機', () => {
  const strike = () => createStrikeState()

  function plane(y = 1000, z = 0): Aircraft {
    const a = new Aircraft(G4M)
    a.state.position.set(0, y, z)
    a.state.velocity.set(0, 0, -90)
    return a
  }

  it('轟炸剖面維持現在的高度：aimWorld 沒有垂直分量', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -2000, 0, 8)
    const a = plane()
    a.state.velocity.set(0, -12, -90)
    const out = createCommand()
    setBombBallistics(K, DT)
    stepStrike(strike(), a, sh, 0, BOMB_PROFILE, true, true, DT, out)
    expect(out.aimWorld.y).toBe(0)
    expect(out.aimWorld.length()).toBeCloseTo(1, 9)
  })

  /** 【攻擊航路不開固定槍】B-17 與 He 111 有槍，掃射會把機首拉離航路。 */
  it('不開固定槍', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -2000, 0, 8)
    const out = createCommand()
    out.firing = true
    setBombBallistics(K, DT)
    stepStrike(strike(), plane(), sh, 0, BOMB_PROFILE, true, true, DT, out)
    expect(out.firing).toBe(false)
  })

  /**
   * 【遠的時候是進場，不鎖航向】只看角度的話會在 8 km 外就鎖住一個之後
   * 一定會歪掉的航向。
   */
  it('超出鎖定距離時留在進場', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -3000, 0, 8)
    const st = strike()
    const out = createCommand()
    setBombBallistics(K, DT)
    stepStrike(st, plane(), sh, 0, BOMB_PROFILE, true, true, DT, out)
    expect(st.phase).toBe('approach')
  })

  /**
   * 【對正且進到鎖定距離就轉直飛，並且把目標鎖住】換船等於航向白鎖。
   *
   * 【1,000 m 不是猜的】鎖定距離＝前拋 ＋ 船沿視線靠近的量 ＋ `RUN_SETTLE`。
   * 1,000 m 平飛 90 m/s 的前拋約 1,210 m，這裡的船背離（`lead` 是負的），
   * 兩項加起來仍然在 1,000 m 之外。
   */
  it('對正且進到鎖定距離就轉直飛並鎖住目標', () => {
    const sh = createShip(3, SHIP_CLASSES.fletcher, 'red', 0, -1000, 0, 8)
    const st = strike()
    const out = createCommand()
    setBombBallistics(K, DT)
    stepStrike(st, plane(), sh, 3, BOMB_PROFILE, true, true, DT, out)
    expect(st.phase).toBe('run')
    expect(st.ship).toBe(3)
  })

  /**
   * 【鎖定距離必須隨高度變】寫死的話高空的轟炸機進到那個距離時**早就飛過
   * 投彈點了** —— 實測 4,000 m 的落點誤差一路單調增加（503 → 2283 m）。
   *
   * 【但不是線性的】阻力在長落程裡把水平速度削掉很多，所以前拋是**次線性**
   * 的：實測鎖定距離 1,000 m → 2,410 m、4,000 m → 3,432 m，高度四倍只換到
   * 1.42 倍。寫「三倍」那種直覺的斷言會紅，而紅的是斷言不是實作。
   */
  it('鎖定距離隨高度變大', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -3000, 0, 8)
    const out = createCommand()
    setBombBallistics(K, DT)

    const low = strike()
    stepStrike(low, plane(1000), sh, 0, BOMB_PROFILE, true, true, DT, out)
    const high = strike()
    stepStrike(high, plane(4000), sh, 0, BOMB_PROFILE, true, true, DT, out)

    expect(low.plan.lockRange).toBeGreaterThan(0)
    expect(high.plan.lockRange).toBeGreaterThan(low.plan.lockRange + 800)
  })

  /**
   * 【鎖定距離要涵蓋投彈窗】投彈只在直飛段判定（進場段的 `bombing` 恆為
   * false），而轉直飛的閘門就是鎖定距離。閘門開在窗口關掉之後的話，整趟
   * 從頭到尾扣不到扳機，而畫面上只看得到「飛過艦隊上空就走了」。
   *
   * 【為什麼是迎面的船】鎖定距離若只算炸彈的前拋距離，就漏掉船在落彈時間
   * 裡沿著視線走掉的那一段。船背離時漏掉的量是負的（閘門偏早，不會出事），
   * 迎面時才會把窗口整個推到閘門之外。
   */
  it('鎖定距離要含船的前置量：船迎面開來時比純前拋遠', () => {
    setBombBallistics(K, DT)
    // 航向 π = 朝 +Z 開，迎著從 +Z 往 −Z 進場的飛機
    const sh = createShip(0, SHIP_CLASSES.essex, 'red', 0, -3000, Math.PI, 8)
    const a = plane(2000, 0)

    const st = strike()
    const out = createCommand()
    stepStrike(st, a, sh, 0, BOMB_PROFILE, true, true, DT, out)

    // 純前拋：炸彈自己往前飛多遠，與船動不動無關
    const hit: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
    const bs: BombState = { x: 0, y: 2000, z: 0, vx: 0, vy: 0, vz: -90 }
    expect(solveImpact(bs, K, () => deckHeightOf(SHIP_CLASSES.essex), DT, hit)).toBe(true)
    const throwRange = Math.hypot(hit.x, hit.z)

    // 船以 8 m/s 迎面走了一整個落彈時間，放手點因此比前拋遠那麼多
    const lead = 8 * hit.seconds
    expect(lead).toBeGreaterThan(100)
    expect(st.plan.lockRange - throwRange).toBeCloseTo(lead + RUN_SETTLE, 0)
  })

  /**
   * 【閘門要在窗關上之前開】投彈只在直飛段判定，閘門開在窗口關掉之後的話，
   * 整趟從頭到尾扣不到扳機 —— 而畫面上只看得到「飛過艦隊上空就走了」。
   */
  it('鎖定距離在投彈窗關上之前就到', () => {
    setBombBallistics(K, DT)
    const sh = createShip(0, SHIP_CLASSES.essex, 'red', 0, -6000, Math.PI, 8)

    // 掃出投彈窗的內緣：最近還放得中的那個距離
    let close = 0
    for (let z = -5000; z <= -1000; z += 10) {
      if (!shouldRelease(plane(2000, z), sh, K, DT)) continue
      close = z + 6000
      break
    }
    expect(close).toBeGreaterThan(0)

    const st = strike()
    const out = createCommand()
    stepStrike(st, plane(2000, close - 6000), sh, 0, BOMB_PROFILE, true, true, DT, out)
    expect(st.plan.lockRange).toBeGreaterThan(close)
  })

  /**
   * 【空艙就脫離】這一條守的是實測到的「空手飛一趟」累計 115 秒 ——
   * 少了它，AI 會一直飛攻擊航路而不知道手上沒東西，然後鑽進近迫火網。
   */
  it('空艙時轉脫離，而且背離船並爬升', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -2500, 0, 8)
    const st = strike()
    st.phase = 'run'
    const out = createCommand()
    setBombBallistics(K, DT)
    stepStrike(st, plane(), sh, 0, BOMB_PROFILE, false, true, DT, out)
    expect(st.phase).toBe('egress')
    // 船在 −Z，脫離要往 +Z，而且要爬升
    expect(out.aimWorld.z).toBeGreaterThan(0)
    expect(out.aimWorld.y).toBeGreaterThan(0)
    expect(out.bombing).toBe(false)
  })

  /**
   * 【脫離距離也是推導的】＝ 鎖定距離 ＋ 2 × 持續迴旋半徑。寫死的話一定會
   * 錯一邊：5,000 m 是 4,000 m 高度的值，拿到 1,000 m 多飛一倍多的路
   * （實測循環 111 s 對 41 s）。
   */
  it('脫離距離大於鎖定距離，而且隨高度變大', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -3000, 0, 8)
    const out = createCommand()
    setBombBallistics(K, DT)

    const low = strike()
    stepStrike(low, plane(1000), sh, 0, BOMB_PROFILE, true, true, DT, out)
    const high = strike()
    stepStrike(high, plane(4000), sh, 0, BOMB_PROFILE, true, true, DT, out)

    expect(low.plan.egressRange).toBeGreaterThan(low.plan.lockRange)
    expect(high.plan.egressRange).toBeGreaterThan(low.plan.egressRange)
  })

  /** 【飛過頭也要放棄】留在直飛只會鑽進 20 mm 的近迫火網。 */
  it('飛到放棄距離之內就轉脫離', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -400, 0, 8)
    const st = strike()
    st.phase = 'run'
    const out = createCommand()
    setBombBallistics(K, DT)
    stepStrike(st, plane(), sh, 0, BOMB_PROFILE, true, true, DT, out)
    expect(st.phase).toBe('egress')
  })

  /** 【補滿且拉開夠遠才准再進場】兩個條件缺一個就會空手再衝一次。 */
  it('脫離時只有補滿還不夠，要拉開夠遠', () => {
    const near = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -1200, 0, 8)
    const far = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, -6000, 0, 8)
    const out = createCommand()
    setBombBallistics(K, DT)

    const a = strike(); a.phase = 'egress'
    stepStrike(a, plane(), near, 0, BOMB_PROFILE, true, true, DT, out)
    expect(a.phase).toBe('egress')

    const b2 = strike(); b2.phase = 'egress'
    stepStrike(b2, plane(), far, 0, BOMB_PROFILE, false, true, DT, out)
    expect(b2.phase).toBe('egress')

    const c = strike(); c.phase = 'egress'
    stepStrike(c, plane(), far, 0, BOMB_PROFILE, true, true, DT, out)
    expect(c.phase).toBe('approach')
  })

  /**
   * 【直飛段不逐步重瞄】這是整件事的核心。航向每拍只朝理想值收斂
   * `RUN_TRIM`，所以一步之內的變化必須遠小於「直接對準」。
   */
  it('直飛段的航向是重阻尼，不是每步重瞄', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 900, -2500, 0, 8)
    const st = strike()
    st.phase = 'run'
    st.heading.set(0, 0, -1)
    const out = createCommand()
    setBombBallistics(K, DT)
    stepStrike(st, plane(), sh, 0, BOMB_PROFILE, true, true, DT, out)
    // 理想航向偏了約 20°，一拍只能走掉 RUN_TRIM 那一小段
    const moved = Math.acos(Math.min(1, st.heading.dot(new Vector3(0, 0, -1))))
    expect(moved).toBeGreaterThan(0)
    expect(moved).toBeLessThan(0.25 * RUN_TRIM * 4)
  })

  it('非決策拍不動航向', () => {
    const sh = createShip(0, SHIP_CLASSES.fletcher, 'red', 900, -2500, 0, 8)
    const st = strike()
    st.phase = 'run'
    st.heading.set(0, 0, -1)
    const out = createCommand()
    setBombBallistics(K, DT)
    stepStrike(st, plane(), sh, 0, BOMB_PROFILE, true, false, DT, out)
    expect(st.heading.z).toBe(-1)
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

/**
 * # 戰鬥機的掛彈掃射
 *
 * 轟炸機走攻擊航路（平飛、定高、通過正上方）；戰鬥機掛彈走的是**掃射**
 * ——機首指著船持續接近，近了才把瞄準點換成落彈解、投完換回來。
 *
 * 【為什麼不共用攻擊航路】那一份要求平飛穩定通過船的正上方，而戰鬥機的
 * 掛載是兩顆 60 kg：一趟丟兩顆卻要飛完整條進場、直飛、脫離的循環。
 */
describe('戰鬥機的落彈點瞄準', () => {
  const K2 = bombDragK(BOMB_TERMINAL_SPEED)

  function zero(y: number, z: number, gammaDeg = 0, speed = 140): Aircraft {
    const a = new Aircraft(A6M5)
    a.state.position.set(0, y, z)
    const g = (gammaDeg * Math.PI) / 180
    a.state.velocity.set(0, speed * Math.sin(g), -speed * Math.cos(g))
    return a
  }

  /** 船在 −Z，靜止不動 —— 這一組驗的是幾何，不是前置量 */
  const still = (): ReturnType<typeof createShip> =>
    createShip(0, SHIP_CLASSES.essex, 'red', 0, -800, 0, 0)

  /**
   * 【落點落在船的後面就要抬頭】平飛時炸彈前拋得遠，落點會越過船；瞄準點
   * 必須比視線更低頭才收得回來。反過來則要抬頭。
   *
   * 這一條守的是**修正的方向**。方向錯的話飛機會一路把落點推離船，而且
   * 看起來只是「AI 投不準」。
   */
  it('落點越過船時，指令方向比視線更低頭', () => {
    setBombBallistics(K2, DT)
    // 【幾何要落在瞄準帶裡】斜距 hypot(500, 700) = 860 m，介於拉起的 400
    // 與接手的 1,000 之間；淺下降讓前拋遠大於 700 m，落點於是在船的另一邊
    const a = zero(500, 0, -5)
    const sh = createShip(0, SHIP_CLASSES.essex, 'red', 0, -700, 0, 0)
    const st = createBombAim()
    stepBombAim(st, a, sh, true, true)
    expect(st.active).toBe(true)
    const los = new Vector3(
      sh.position.x - a.state.position.x, -a.state.position.y, sh.position.z - a.state.position.z,
    ).normalize()
    // 700 m 高、平緩下降：前拋遠大於 800 m 的距離，落點在船的另一邊
    expect(st.aim.y).toBeLessThan(los.y)
  })

  /** 【太遠不作用】遠處的解在數學上成立，但那不是這個戰法要的東西 */
  it('超過落彈瞄準距離時不接手瞄準點', () => {
    setBombBallistics(K2, DT)
    const st = createBombAim()
    const sh = createShip(0, SHIP_CLASSES.essex, 'red', 0, -4000, 0, 0)
    stepBombAim(st, zero(700, 0, -10), sh, true, true)
    expect(st.active).toBe(false)
    expect(st.release).toBe(false)
  })

  /**
   * 【拉起優先】掃射在 `SHIP_BREAK_RANGE` 轉脫離，而脫離要背離船並爬升。
   * 這一層若還在寫瞄準點，飛機會被拉回船上撞上去。
   */
  it('進到拉起距離之內就交還瞄準點', () => {
    setBombBallistics(K2, DT)
    const st = createBombAim()
    const sh = createShip(0, SHIP_CLASSES.essex, 'red', 0, -300, 0, 0)
    stepBombAim(st, zero(200, 0, -30), sh, true, true)
    expect(st.active).toBe(false)
  })

  /** 【空艙就不接手】沒有東西可投時瞄準點留給機槍 */
  it('空艙時不接手瞄準點', () => {
    setBombBallistics(K2, DT)
    const st = createBombAim()
    stepBombAim(st, zero(700, 0, -20), still(), false, true)
    expect(st.active).toBe(false)
    expect(st.release).toBe(false)
  })

  /**
   * 【放手的判準與 `shouldRelease` 是同一個】兩份會漂開，而症狀是「投出去
   * 的那一顆與判定用的那一條軌跡不是同一條」。
   */
  it('要不要放與 shouldRelease 一致', () => {
    setBombBallistics(K2, DT)
    const sh = still()
    // 【幾何都要落在瞄準帶裡】斜距介於拉起的 400 與接手的 1,000 之間 ——
    // 帶外 `stepBombAim` 直接早退，而 `shouldRelease` 不看距離，兩者於是
    // 「不一致」而那不是缺陷
    for (const [y, z, g] of [[500, -100, -20], [400, -200, -35], [300, -350, -45]] as const) {
      const a = zero(y, z, g)
      const st = createBombAim()
      stepBombAim(st, a, sh, true, true)
      expect(st.release).toBe(shouldRelease(a, sh, K2, DT))
    }
  })

  /** 【只在決策拍重算】解算一次 170 µs，每個物理步跑會撞穿設計預算 */
  it('非決策拍不重算', () => {
    setBombBallistics(K2, DT)
    const st = createBombAim()
    const sh = still()
    stepBombAim(st, zero(700, 0, -20), sh, true, true)
    const before = st.aim.clone()
    stepBombAim(st, zero(700, -400, -20), sh, true, false)
    expect(st.aim.equals(before)).toBe(true)
  })
})
