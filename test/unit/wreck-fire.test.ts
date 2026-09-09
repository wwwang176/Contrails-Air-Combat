import { beforeAll, describe, it, expect } from 'vitest'
import { Group, Vector3 } from 'three'
import { createWrecks, WRECK_FIRE_INTERVAL, WRECK_FIRE_SECONDS } from '../../src/render/wrecks'
import { FIRE_SECONDS } from '../../src/render/shipFires'
import { buildAircraft, type AircraftModel } from '../../src/render/geometry/buildAircraft'
import { IMPACT_STRIDE } from '../../src/world/events'
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
    let total = 0
    for (let i = 0; i < 60; i++) {
      w.step(1 / 60, DEEP, WET, 0)
      total += w.fireEvents.count
    }
    expect(total).toBeCloseTo(1 / WRECK_FIRE_INTERVAL, 0)
  })

  /**
   * 【火點要跟著殘骸走】存世界座標放著不動的話，火會留在爆炸那一點而殘骸
   * 掉下去 —— 畫面上是「空中有一團火」，不像缺陷。
   */
  it('火點是引擎在世界座標的位置，跟著位置與姿態走', () => {
    const w = createWrecks(4, () => {})
    const m = fakeModel([new Vector3(0, 0, -3)])
    m.group.position.set(100, 4000, -200)
    // 繞 Y 轉 90°：機體 −Z 指向世界 −X
    m.group.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    w.adopt(m, P51D, 0, 0, 0, 0)
    w.step(0.001, DEEP, WET, 0)
    const p = firePoints(w)[0]!
    const want = new Vector3(0, 0, -3).applyQuaternion(m.group.quaternion).add(m.group.position)
    expect(p.x).toBeCloseTo(want.x, 2)
    expect(p.y).toBeCloseTo(want.y, 2)
    expect(p.z).toBeCloseTo(want.z, 2)
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
      // 【轉回機體座標再比】火點是世界座標，而殘骸在放火之前已經轉過一步
      const local = firePoints(w)[0]!
        .sub(m.group.position).applyQuaternion(m.group.quaternion.clone().invert())
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
    expect(before).toBeGreaterThan((WRECK_FIRE_SECONDS - 2) / WRECK_FIRE_INTERVAL)

    // 跨過上限，再開始數
    for (let i = 0; i < 2 / (1 / 60); i++) w.step(1 / 60, dry, dry, 0)
    let after = 0
    for (let i = 0; i < 300; i++) {
      w.step(1 / 60, dry, dry, 0)
      after += w.fireEvents.count
    }
    expect(after).toBe(0)
  })

  /** 【一分鐘，與船火同一個時長】燒起來的船與燒起來的飛機該燒一樣久 */
  it('WRECK_FIRE_SECONDS 等於船火的時長', () => {
    expect(WRECK_FIRE_SECONDS).toBe(FIRE_SECONDS)
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

describe('main.ts 的接線', () => {
  const SOURCES = import.meta.glob('../../src/main.ts', {
    query: '?raw', import: 'default', eager: true,
  }) as Record<string, string>
  const MAIN = Object.values(SOURCES)[0]!

  /**
   * 【要與船火走同一支】燃燒的表現只該有一份配方。`emitFirePuff` 是船火與
   * 地面火共用的那一支，殘骸也接它。
   */
  it('殘骸的火點餵給 emitFirePuff', () => {
    const from = MAIN.indexOf('wrecks.fireEvents')
    expect(from).toBeGreaterThan(0)
    expect(MAIN.slice(from - 200, from + 300)).toContain('emitFirePuff')
  })
})
