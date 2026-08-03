import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createSituation, evaluateGeometry } from '../../src/ai/assess'
import { P51D } from '../../src/specs/p51d'
import { RAD } from '../../src/core/math'

/**
 * 【為什麼用 Aircraft 而不是自訂的輕量結構】評估層要讀的東西
 * （position、velocity、orientation、specificEnergy、diag）全部住在 Aircraft
 * 上。另外發明一個「態勢輸入」結構等於多一份要同步的資料——M2 的命中盒
 * 與外型分岔就是這樣發生的。
 */
function place(a: Aircraft, pos: [number, number, number], vel: [number, number, number]) {
  a.state.position.set(...pos)
  a.state.velocity.set(...vel)
  a.prevPosition.copy(a.state.position)
}

/** 讓機首指向 dir（世界座標）。 */
function face(a: Aircraft, dir: Vector3) {
  a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir.clone().normalize())
  a.prevOrientation.copy(a.state.orientation)
}

describe('evaluateGeometry', () => {
  const sit = createSituation()

  it('range 與 closureRate：正面接近時 closureRate 為正', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, 100])
    evaluateGeometry(self, target, sit)

    expect(sit.range).toBeCloseTo(500, 6)
    // 我以 200 往 −Z、他以 100 往 +Z，接近率 300
    expect(sit.closureRate).toBeCloseTo(300, 6)
  })

  it('拉開時 closureRate 為負，且 timeToMerge 為 Infinity', () => {
    // 【為什麼 timeToMerge 要是 Infinity 而不是負數或很大的數】規則表拿它
    // 當「還有多久要撞在一起」的門檻。拉開時答案是「永遠不會」，用
    // range / closureRate 會得到一個負數，而負數小於任何門檻——所有
    // 「timeToMerge < 門檻」的規則會全部誤觸發。
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -100])
    place(target, [0, 4000, -500], [0, 0, -300])
    evaluateGeometry(self, target, sit)

    expect(sit.closureRate).toBeLessThan(0)
    expect(sit.timeToMerge).toBe(Infinity)
  })

  it('timeToMerge = range / closureRate', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -600], [0, 0, -50])
    evaluateGeometry(self, target, sit)
    expect(sit.closureRate).toBeCloseTo(150, 6)
    expect(sit.timeToMerge).toBeCloseTo(4, 6)
  })

  it('aspectAngle：目標在正前方為 0，正後方為 180°', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    face(self, new Vector3(0, 0, -1))

    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -200])
    evaluateGeometry(self, target, sit)
    expect(sit.aspectAngle * RAD).toBeCloseTo(0, 4)

    place(target, [0, 4000, 500], [0, 0, -200])
    evaluateGeometry(self, target, sit)
    expect(sit.aspectAngle * RAD).toBeCloseTo(180, 4)
  })

  it('angleOffTail：我咬在他正後方為 0，正面對頭為 180°', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -200])

    // 他也朝 −Z：我在他正後方
    face(target, new Vector3(0, 0, -1))
    evaluateGeometry(self, target, sit)
    expect(sit.angleOffTail * RAD).toBeCloseTo(0, 4)

    // 他朝 +Z：正面對頭
    face(target, new Vector3(0, 0, 1))
    evaluateGeometry(self, target, sit)
    expect(sit.angleOffTail * RAD).toBeCloseTo(180, 4)
  })

  it('losRate：純徑向接近時為 0', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -100])
    evaluateGeometry(self, target, sit)
    expect(sit.losRate).toBeCloseTo(0, 9)
  })

  it('losRate：橫向掠過時等於 |橫向相對速度| / 距離', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, 0])
    place(target, [0, 4000, -500], [150, 0, 0])
    evaluateGeometry(self, target, sit)
    expect(sit.losRate).toBeCloseTo(150 / 500, 9)
  })

  it('兩機重疊時不產生 NaN', () => {
    // 重生的瞬間有可能發生。NaN 一旦進入態勢，整個規則表的比較全部變成
    // false，AI 會靜靜地退化成「永遠走預設意圖」——而且完全不會報錯。
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, 0], [0, 0, -200])
    evaluateGeometry(self, target, sit)
    for (const v of [sit.range, sit.closureRate, sit.aspectAngle, sit.angleOffTail, sit.losRate]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('不修改輸入的兩架飛機', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [10, 4100, -500], [5, 1, -150])
    const before = target.state.position.clone()
    const beforeQ = self.state.orientation.clone()
    evaluateGeometry(self, target, sit)
    expect(target.state.position.equals(before)).toBe(true)
    expect(self.state.orientation.angleTo(beforeQ)).toBe(0)
  })

  it('連續呼叫不配置：一萬次結果一致', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -100])
    evaluateGeometry(self, target, sit)
    const first = sit.range
    for (let i = 0; i < 10000; i++) evaluateGeometry(self, target, sit)
    expect(sit.range).toBe(first)
  })
})
