import { beforeAll, describe, it, expect } from 'vitest'
import { Group, Quaternion, Vector3 } from 'three'
import {
  createWrecks, WRECK_FIRE_INTERVAL, WRECK_FIRE_SCALE, WRECK_FIRE_SECONDS,
  WRECK_FIRE_SMOKE_SCALE,
} from '../../src/render/wrecks'
import { FIRE_SECONDS } from '../../src/render/shipFires'
import { createFirePuff } from '../../src/render/firePuff'
import type { BlastPools } from '../../src/render/blast'
import type { Anchors } from '../../src/render/anchors'
import type { Particles } from '../../src/render/particles'
import { buildAircraft, type AircraftModel } from '../../src/render/geometry/buildAircraft'
import { createImpacts, IMPACT_STRIDE } from '../../src/world/events'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'

/**
 * # 殘骸的引擎燃燒
 *
 * 被打爆的飛機在**一具引擎**上燒，表現與船火同一套 —— 每 0.3 秒一朵小爆炸
 * 加一叢上升的煙（`main.ts` 的 `emitFirePuff`）。多發機隨機挑一具。
 *
 * 【這一支守的是什麼】三件靜靜壞掉的事：火點沒有跟著翻滾的殘骸走（火留在
 * 半空、殘骸掉下去）、四發機每一次都燒同一具、以及火點長在重心而不是引擎上
 * —— 三者都不會報錯，畫面上只是「怪」。
 */

const DEEP = (): number => -100000
const WET = (): number => 0

/** 這一次 step 吐出來的火點，世界座標 */
function firePoints(w: { fireEvents: { data: Float32Array; count: number } }): Vector3[] {
  const out: Vector3[] = []
  for (let e = 0; e < w.fireEvents.count; e++) {
    const o = e * IMPACT_STRIDE
    out.push(new Vector3(w.fireEvents.data[o]!, w.fireEvents.data[o + 1]!, w.fireEvents.data[o + 2]!))
  }
  return out
}

describe('模型要說得出引擎在哪裡', () => {
  beforeAll(async () => { await loadGlbTemplatesForNode() })

  /**
   * 【為什麼用螺旋槳的位置】引擎在整流罩裡，而模型上唯一標得出來的那個點
   * 就是槳轂。差幾十公分，對一團火來說沒有分別。
   */
  it('單發機一個點、雙發兩個、四發四個', () => {
    expect(buildAircraft(P51D).enginePoints).toHaveLength(1)
    expect(buildAircraft(HE111).enginePoints).toHaveLength(2)
    expect(buildAircraft(B17G).enginePoints).toHaveLength(4)
  })

  /** 【機體座標，而且在機首前段】長在機尾的話火會從尾巴冒出來 */
  it('P-51 的那一個在中線上、機首前方', () => {
    const p = buildAircraft(P51D).enginePoints[0]!
    expect(Math.abs(p.x)).toBeLessThan(0.3)
    expect(p.z).toBeLessThan(-2)
  })

  /** 【四發機要左右各兩具】全部落在同一側就是矩陣沒有套對 */
  it('B-17 的四個分在兩側，內外各一', () => {
    const xs = buildAircraft(B17G).enginePoints.map((p) => p.x).sort((a, b) => a - b)
    expect(xs.filter((x) => x < 0)).toHaveLength(2)
    expect(xs.filter((x) => x > 0)).toHaveLength(2)
    // 外側那兩具比內側遠 —— 對照 `b17g.model.ts` 的 3.05 與 6.571
    expect(Math.abs(xs[0]!)).toBeGreaterThan(Math.abs(xs[1]!))
  })
})

/** 只餵 `render/wrecks.ts` 的假模型。引擎擺在一個好認的偏心位置 */
function fakeModel(engines: Vector3[]): AircraftModel {
  return {
    group: new Group(),
    metrics: { realLength: 9.83, noseZ: -3.4, noseY: 0.3, tipY: 0 },
    eyePoint: new Vector3(),
    wingTip: new Vector3(5.64, 0, 0),
    bombPoint: null,
    enginePoints: engines,
    setPropSpin: () => {},
    dispose: () => {},
  }
}

describe('殘骸的燃燒', () => {
  it('持續吐出火點，節奏是 WRECK_FIRE_INTERVAL', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([new Vector3(0, 0, -3)])
    m.group.position.set(0, 4000, 0)
    w.adopt(m, P51D, 0, 0, -150, 0)
    w.step(1, DEEP, WET, 0)
    // 一秒 ÷ 0.3 秒 = 三朵多；一步只放一朵，所以是 1
    expect(w.fireEvents.count).toBe(1)
    // 【比的是一秒放幾朵，不是精確計數】一步只放一朵，所以起算的相位會
    // 讓計數在整數之間差一
    let total = 0
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60, DEEP, WET, 0)
      total += w.fireEvents.count
    }
    const perSecond = 1 / WRECK_FIRE_INTERVAL
    expect(total).toBeGreaterThanOrEqual(perSecond - 1)
    expect(total).toBeLessThanOrEqual(perSecond + 1)
  })

  /**
   * 【多發機要挑得散】每一次都挑第 0 具的話，四發轟炸機永遠燒同一邊的
   * 內側引擎。
   */
  it('四發機在不同種子下燒到每一具引擎', () => {
    const engines = [
      new Vector3(3, 0, -3), new Vector3(6, 0, -3),
      new Vector3(-3, 0, -3), new Vector3(-6, 0, -3),
    ]
    const picked = new Set<number>()
    for (let seed = 0; seed < 40; seed++) {
      const w = createWrecks(1, () => {})
      const m = fakeModel(engines)
      m.group.position.set(0, 4000, 0)
      w.adopt(m, B17G, 0, 0, -150, seed)
      w.step(0.001, DEEP, WET, 0)
      const local = firePoints(w)[0]!
      picked.add(engines.findIndex((e) => e.distanceTo(local) < 1e-3))
    }
    expect(picked.size).toBe(4)
    expect(picked.has(-1)).toBe(false)
  })

  /** 【同一具殘骸全程燒同一具引擎】每一朵各挑一具的話火會在機翼上跳 */
  it('同一具殘骸不會換引擎', () => {
    const engines = [new Vector3(3, 0, -3), new Vector3(-6, 0, -3)]
    const w = createWrecks(1, () => {})
    const m = fakeModel(engines)
    m.group.position.set(0, 4000, 0)
    // 【姿態鎖死】翻滾會讓世界座標一直變，那樣分不出「換了引擎」與「轉了」
    w.adopt(m, HE111, 0, 0, 0, 5)
    const xs = new Set<number>()
    for (let i = 0; i < 200; i++) {
      w.step(1 / 60, DEEP, WET, 0)
      for (const p of firePoints(w)) xs.add(Math.round(p.x))
    }
    expect(xs.size).toBe(1)
  })

  /**
   * 【燒滿一分鐘就停】與船火同一個時長。殘骸的壽命上限是兩分鐘（那是一道
   * 保險，給飄出海面網格、永遠碰不到水的那一具），不設上限的話那一具會
   * 在天上燒兩分鐘。
   */
  it('燒滿 WRECK_FIRE_SECONDS 之後停止，之前一直在燒', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([new Vector3(0, 0, -3)])
    m.group.position.set(0, 40000, 0)
    w.adopt(m, P51D, 0, 0, -150, 0)
    // 【高得碰不到水】要驗的是時間上限，不是落海
    const dry = (): number => -1e9
    let before = 0
    for (let i = 0; i < (WRECK_FIRE_SECONDS - 1) / (1 / 60); i++) {
      w.step(1 / 60, dry, dry, 0)
      before += w.fireEvents.count
    }
    expect(before).toBeGreaterThan((WRECK_FIRE_SECONDS - 2) / WRECK_FIRE_INTERVAL * 0.9)

    // 跨過上限，再開始數
    for (let i = 0; i < 2 / (1 / 60); i++) w.step(1 / 60, dry, dry, 0)
    let after = 0
    for (let i = 0; i < 300; i++) {
      w.step(1 / 60, dry, dry, 0)
      after += w.fireEvents.count
    }
    expect(after).toBe(0)
  })

  /**
   * 【比船火短得多】燒起來的船是一個要一直看得到的目標；被打下來的飛機是
   * 一個瞬間的訊號。一場 20v20 裡每一具都燒滿船火那個時長的話，天空會被
   * 幾十道尾跡塞住。
   *
   * 【但也不能短到看不見】殘骸從四千公尺掉到海面要五十幾秒，火太短的話
   * 大半段是一具無聲無息落下的機體。
   */
  it('燒得比船火短，但至少十秒', () => {
    expect(WRECK_FIRE_SECONDS).toBeLessThan(FIRE_SECONDS)
    expect(WRECK_FIRE_SECONDS).toBeGreaterThanOrEqual(10)
  })

  /**
   * 【殘骸被回收就不燒】火點是從殘骸的格子推出來的，格子還給呼叫端之後
   * 自然停 —— 這一條把那件事釘住，免得哪天火改成自己的池子而漏了這一半。
   */
  it('殘骸撞地被回收之後不再吐火點', () => {
    const released: unknown[] = []
    const w = createWrecks(4, (m) => { released.push(m) })
    const m = fakeModel([new Vector3(0, 0, -3)])
    m.group.position.set(0, 30, 0)
    // 【地面在 0、沒有水】撞地那一條路
    w.adopt(m, P51D, 0, 0, 0, 0)
    for (let i = 0; i < 600; i++) w.step(1 / 60, () => 0, () => -Infinity, 0)
    expect(released).toHaveLength(1)
    expect(w.live).toBe(0)
    let after = 0
    for (let i = 0; i < 120; i++) {
      w.step(1 / 60, () => 0, () => -Infinity, 0)
      after += w.fireEvents.count
    }
    expect(after).toBe(0)
  })

  /** 【沉下去就不燒】水面下看不見，繼續放只是浪費池子 */
  it('入水之後不再吐火點', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([new Vector3(0, 0, -3)])
    m.group.position.set(0, 5, 0)
    w.adopt(m, P51D, 0, 0, 0, 0)
    // 掉到水面以下並沉一段
    for (let i = 0; i < 300; i++) w.step(1 / 60, () => 0, WET, 0)
    let after = 0
    for (let i = 0; i < 120; i++) {
      w.step(1 / 60, () => 0, WET, 0)
      after += w.fireEvents.count
    }
    expect(after).toBe(0)
  })

  /** 【每次 step 開頭排空】不排空的話計數會一路累積到滿 */
  it('fireEvents 每一步都重新開始', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([new Vector3(0, 0, -3)])
    m.group.position.set(0, 4000, 0)
    w.adopt(m, P51D, 0, 0, -150, 0)
    for (let i = 0; i < 100; i++) w.step(1 / 60, DEEP, WET, 0)
    expect(w.fireEvents.count).toBeLessThanOrEqual(1)
  })

  /**
   * 【火團要繼承殘骸的速度】火團在自己的壽命裡是自由飛的，不掛在任何父
   * 物件上。不帶速度的話，一具每秒掉八十公尺的殘骸每 0.3 秒在原地留一團
   * —— 畫面上是一串間隔二十四公尺的獨立爆炸，不是一團跟著它的火。
   */
  /**
   * 【推的是機體座標與格號，不是世界座標】火吸附在殘骸的格子上，世界座標
   * 由粒子池每一幀自己組。推世界座標的話火只會停在推的那一刻的位置。
   */
  it('火點事件帶的是引擎的機體座標與錨點格號', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([new Vector3(0.5, -0.2, -3)])
    m.group.position.set(1000, 4000, -2000)
    w.adopt(m, P51D, 20, -5, -150, 0)
    w.step(0.001, DEEP, WET, 0)
    expect(w.fireEvents.count).toBe(1)
    const d = w.fireEvents.data
    expect(d[0]!).toBeCloseTo(0.5, 5)
    expect(d[1]!).toBeCloseTo(-0.2, 5)
    expect(d[2]!).toBeCloseTo(-3, 5)
    // 第一具殘骸落在第 0 格
    expect(d[3]!).toBe(0)
  })

  /**
   * 【錨點查得到這一格的變換】火的世界座標全靠它。查不到的話火當場收掉，
   * 症狀是「飛機不燒了」。
   */
  it('anchors 回報殘骸當下的位置與姿態，格子空了就回 false', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([new Vector3(0, 0, -3)])
    m.group.position.set(1000, 4000, -2000)
    w.adopt(m, P51D, 0, 0, -150, 0)
    w.step(1 / 60, DEEP, WET, 0)

    const at = new Vector3()
    const q = new Quaternion()
    expect(w.anchors.frame(0, at, q)).toBe(true)
    expect(at.x).toBeCloseTo(m.group.position.x, 5)
    expect(at.y).toBeCloseTo(m.group.position.y, 5)
    expect(q.angleTo(m.group.quaternion)).toBeCloseTo(0, 6)

    // 沒有殘骸的格子
    expect(w.anchors.frame(3, at, q)).toBe(false)
    // 超出範圍的格號
    expect(w.anchors.frame(99, at, q)).toBe(false)
  })

  /** 【沒有引擎點的模型不能爆】程式版的外型可能一具槳都沒有 */
  it('模型沒有引擎點時安靜地不燒', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([])
    m.group.position.set(0, 4000, 0)
    w.adopt(m, P51D, 0, 0, -150, 0)
    expect(() => w.step(0.5, DEEP, WET, 0)).not.toThrow()
    expect(w.fireEvents.count).toBe(0)
  })
})

describe('引擎火比船火小一號', () => {
  /**
   * 【一具發動機艙不是一艘燃燒的軍艦】共用配方但縮尺寸。`scaleBlast` 吃的
   * 是當量，尺寸正比於它的立方根，所以線性倍率要先立方回去。
   */
  it('WRECK_FIRE_SCALE 落在 0 到 1 之間', () => {
    expect(WRECK_FIRE_SCALE).toBeGreaterThan(0)
    expect(WRECK_FIRE_SCALE).toBeLessThan(1)
  })

  it('縮過的火球比原尺寸小', () => {
    const full: number[][] = []
    const small: number[][] = []
    createFirePuff(poolsWith(full), fakePool([]), 1)(0, 0, 0)
    createFirePuff(poolsWith(small), fakePool([]), WRECK_FIRE_SCALE)(0, 0, 0)
    expect(full.length).toBeGreaterThan(0)
    expect(small.length).toBeGreaterThan(0)
    // sizeScale 是第七個引數
    expect(small[0]![6]!).toBeLessThan(full[0]![6]!)
  })
})

describe('火吸附在物件上，煙不吸附', () => {
  /** 錨點 7 在 (100, 200, 300)，沒有旋轉 */
  const anchors: Anchors = {
    frame(id, outPos, outQuat) {
      if (id !== 7) return false
      outPos.set(100, 200, 300)
      outQuat.identity()
      return true
    },
  }

  /**
   * 【火要帶著錨點編號進池子】火燒在物件上，整段跟著它的位置與姿態走。
   * 只在出生時繼承速度的話，翻滾的殘骸會把火甩到機翼外面。
   */
  it('火球帶著錨點編號，位置照傳的區域座標', () => {
    const fire: number[][] = []
    createFirePuff(poolsWith(fire), fakePool([]), 1, 1, anchors)(0, 0, -3, 7)
    expect(fire.length).toBeGreaterThan(0)
    // anchor 是第八個引數
    expect(fire[0]![7]!).toBe(7)
    expect(fire[0]![2]!).toBe(-3)
  })

  /** 沒給錨點時是世界座標、自由飛 —— 船火與地面火走這一條 */
  it('省略錨點時火球不吸附', () => {
    const fire: number[][] = []
    createFirePuff(poolsWith(fire), fakePool([]), 1)(10, 20, 30)
    expect(fire[0]![7]!).toBe(-1)
    expect(fire[0]![0]!).toBe(10)
  })

  /**
   * 【煙**不**吸附】它離開之後就是空氣裡的一團煙，被拋在後面才會連成
   * 尾跡。跟著錨點走的話整叢煙一起平移，柱子與尾跡都不見了 —— 而畫面上
   * 那只是「煙看起來怪」，不像缺陷。
   */
  it('煙不帶錨點，而且出生點被組回世界座標', () => {
    const plume: number[][] = []
    createFirePuff(poolsWith([]), fakePool(plume), 1, 1, anchors)(0, 0, -3, 7)
    expect(plume.length).toBeGreaterThan(0)
    for (const p of plume) {
      expect(p[7]!).toBe(-1)
      // 錨點在 (100, 200, 300)，區域 −3 落在世界 297
      expect(p[0]!).toBeCloseTo(100, 5)
      expect(p[2]!).toBeCloseTo(297, 5)
    }
  })

  /**
   * 【煙的速度只有自己的擴散與上升】吸附的火跟著錨點走，煙不跟；煙若也
   * 拿到錨點的速度，尾跡就不見了。
   *
   * 【一定要驗上升速度】只驗水平兩軸的話，把垂直分量加回去仍然是綠的，
   * 而那一項最致命：殘骸的垂直速度是負的，會把煙的上升整個抵銷掉。
   */
  it('煙的速度只有自己的擴散與上升', () => {
    const plume: number[][] = []
    createFirePuff(poolsWith([]), fakePool(plume), 1, 1, anchors)(0, 0, -3, 7)
    for (const p of plume) {
      expect(Math.abs(p[3]!)).toBeLessThan(FIRE_SMOKE_SPREAD_LIMIT)
      expect(Math.abs(p[5]!)).toBeLessThan(FIRE_SMOKE_SPREAD_LIMIT)
      expect(p[4]!).toBeGreaterThan(0)
    }
  })
})

/** 煙的水平擴散上限，m/s，在倍率 1 之下。比它大就是混進了火源的速度 */
const FIRE_SMOKE_SPREAD_LIMIT = 3

describe('火與煙的尺寸各有各的倍率', () => {
  /**
   * 【一定要能分開調】一具引擎的火苗很小，但拖在後面的煙要在幾公里外看得
   * 出「有一架掉下去了」。共用一個倍率的話，火縮到看得順眼時煙也跟著細到
   * 消失 —— 而畫面上那只是「煙不夠」，不像缺陷。
   */
  it('只改煙的倍率時，火球的尺寸不動', () => {
    const fireA: number[][] = []
    const fireB: number[][] = []
    createFirePuff(poolsWith(fireA), fakePool([]), 0.25, 0.25)(0, 0, 0)
    createFirePuff(poolsWith(fireB), fakePool([]), 0.25, 4)(0, 0, 0)
    expect(fireA[0]![6]!).toBe(fireB[0]![6]!)
  })

  it('煙的尺寸與水平擴散都跟著煙的倍率走', () => {
    const small: number[][] = []
    const big: number[][] = []
    createFirePuff(poolsWith([]), fakePool(small), 0.25, 1)(0, 0, 0)
    createFirePuff(poolsWith([]), fakePool(big), 0.25, 4)(0, 0, 0)
    expect(big[0]![6]!).toBeGreaterThan(small[0]![6]!)
    // 水平擴散：同一個種子，只差倍率
    expect(Math.abs(big[0]![3]!)).toBeCloseTo(Math.abs(small[0]![3]!) * 4, 5)
  })

  /** 省略煙的倍率時跟著火走 —— 船火與地面火兩者都是 1 */
  it('省略煙的倍率時與火同值', () => {
    const a: number[][] = []
    const b: number[][] = []
    createFirePuff(poolsWith([]), fakePool(a), 0.6)(0, 0, 0)
    createFirePuff(poolsWith([]), fakePool(b), 0.6, 0.6)(0, 0, 0)
    expect(a[0]![6]!).toBe(b[0]![6]!)
  })

  /** 殘骸的煙要比火大 —— 它是唯一的拖煙來源 */
  it('殘骸的煙倍率大於火倍率', () => {
    expect(WRECK_FIRE_SMOKE_SCALE).toBeGreaterThan(WRECK_FIRE_SCALE)
  })

  /**
   * 【火球的噴出速度要跟著尺寸縮】`scaleBlast` 刻意不動速度 —— 爆炸相似律
   * 下噴出速度與裝藥量無關。但這一份不是爆炸，是掛在引擎上的一團火：原速
   * 每秒十一公尺、活零點八五秒會散開七公尺，而縮到四分之一的球只有一點
   * 七五公尺寬。散開量是球徑的四倍，畫面上就成了一顆顆飄在空中的球，而
   * 不是燒在螺旋槳上的火。
   */
  it('火球的噴出速度跟著火的倍率縮，煙的倍率不影響它', () => {
    const full: number[][] = []
    const quarter: number[][] = []
    const bigSmoke: number[][] = []
    createFirePuff(poolsWith(full), fakePool([]), 1)(0, 0, 0)
    createFirePuff(poolsWith(quarter), fakePool([]), 0.25)(0, 0, 0)
    createFirePuff(poolsWith(bigSmoke), fakePool([]), 0.25, 8)(0, 0, 0)

    const speed = (p: number[]): number => Math.hypot(p[3]!, p[4]!, p[5]!)
    expect(speed(quarter[0]!)).toBeCloseTo(speed(full[0]!) * 0.25, 5)
    expect(speed(bigSmoke[0]!)).toBeCloseTo(speed(quarter[0]!), 5)
  })

  /**
   * 【倍率 1 要逐位元不變】船火與地面火走的是同一支。速度那一項套下去
   * 之後它們一個字都不該變。
   */
  it('倍率 1 時火球的速度與尺寸都不變', () => {
    const a: number[][] = []
    const b: number[][] = []
    createFirePuff(poolsWith(a), fakePool([]), 1)(0, 0, 0)
    createFirePuff(poolsWith(b), fakePool([]))(0, 0, 0)
    expect(a[0]).toEqual(b[0])
  })
})

function poolsWith(fireLog: number[][]): BlastPools {
  return {
    fireball: fakePool(fireLog), smoke: fakePool([]), dust: fakePool([]),
    spray: fakePool([]), splashEvents: createImpacts(),
  }
}

/** 記下每一次 `emit` 的引數。只餵 `createFirePuff` */
function fakePool(log: number[][]): Particles {
  return {
    object: null as never,
    live: 0,
    emit(x, y, z, vx, vy, vz, sizeScale, anchor) {
      log.push([x, y, z, vx, vy, vz, sizeScale ?? 1, anchor ?? -1])
    },
    step() {},
    reset() {},
    dispose() {},
  }
}

describe('main.ts 的接線', () => {
  const SOURCES = import.meta.glob('../../src/main.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>
  const MAIN = Object.values(SOURCES)[0]!

  /**
   * 【要與船火走同一支】燃燒的表現只該有一份配方。`emitFirePuff` 是船火與
   * 地面火共用的那一支，殘骸也接它。
   */
  it('殘骸的火點餵給同一份配方做出來的回呼', () => {
    const from = MAIN.indexOf('wrecks.fireEvents')
    expect(from).toBeGreaterThan(0)
    expect(MAIN.slice(from - 300, from + 400)).toContain('emitWreckFirePuff(')
    // 【兩支都出自 `createFirePuff`】各寫一份的話船火與飛機火會慢慢分家
    expect(MAIN.match(/createFirePuff\(/g) ?? []).toHaveLength(2)
    expect(MAIN).toContain('WRECK_FIRE_SCALE, WRECK_FIRE_SMOKE_SCALE')
  })
})
