import { describe, expect, it } from 'vitest'
import { farmLaneVillages, farmSettlements } from '../../src/render/farmSettlements'
import { createFloraBuffer, FloraKind } from '../../src/render/flora'
import { buildingColors } from '../../src/render/floraShapes'
import { steppeLayout } from '../../src/render/steppeVillage'
import { regionAt, trackGap, trackWidthAt } from '../../src/render/fields'

/**
 * 草原街村：房子沿凹路兩列、屋後垂直於街的菜園、只有七月麥田這個季節才用。
 */

const HALF = 8000
const villages = farmLaneVillages(HALF).filter((v) => v.place.kind === 'village')

function placements(): { x: number; z: number; kind: number }[] {
  const { flora } = steppeLayout(farmLaneVillages(HALF), () => false)
  const buf = createFloraBuffer(200000)
  flora(-HALF, -HALF, HALF, HALF, () => 0, buf)
  expect(buf.dropped).toBe(0)
  const out = []
  for (let i = 0; i < buf.count; i++) {
    out.push({ x: buf.data[i * 6]!, z: buf.data[i * 6 + 2]!, kind: buf.kind[i]! })
  }
  return out
}

describe('草原街村', () => {
  it('每個村有站址與凹路的走向，走向是單位圓上的角度', () => {
    expect(villages.length).toBeGreaterThan(5)
    for (const v of villages) {
      expect(Number.isFinite(v.lane)).toBe(true)
      expect(Math.abs(v.lane)).toBeLessThanOrEqual(Math.PI)
    }
  })

  it('房子沿街排，長出來不少', () => {
    const houses = placements().filter((p) => p.kind === FloraKind.House)
    // 40 個村、每村兩列幾十戶
    expect(houses.length).toBeGreaterThan(300)
  })

  it('菜園都是垂直於街的長條，四個角繞成矩形', () => {
    const { gardens } = farmSettlements(HALF, 'julyWheat')
    expect(gardens.length).toBeGreaterThan(100)
    for (const g of gardens.slice(0, 200)) {
      const [a, b, , d] = g.ring
      const w = Math.hypot(b![0] - a![0], b![1] - a![1])
      const l = Math.hypot(d![0] - a![0], d![1] - a![1])
      expect(l).toBeGreaterThan(w)
      // 相鄰兩邊垂直
      const dot = (b![0] - a![0]) * (d![0] - a![0]) + (b![1] - a![1]) * (d![1] - a![1])
      expect(Math.abs(dot) / (w * l)).toBeLessThan(1e-6)
    }
  })

  it('其他季節沒有菜園、建築色是德國中部那一套', () => {
    expect(farmSettlements(HALF, 'summer').gardens).toHaveLength(0)
    expect(farmSettlements(HALF, 'lateAutumn').gardens).toHaveLength(0)
    expect(buildingColors('summer')).toBe(buildingColors('lateAutumn'))
    expect(buildingColors('julyWheat').house.wall).not.toBe(buildingColors('summer').house.wall)
  })

  it('同一個種子兩次跑得到同一批房子', () => {
    expect(placements()).toEqual(placements())
  })
})

describe('草原街村避開凹路', () => {
  const REG = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 }
  const onRoad = (x: number, z: number): boolean => {
    regionAt(x, z, REG)
    return trackGap(x, z, REG) < trackWidthAt(x, z)
  }

  it('房子與棚子的中心都不在凹路上', () => {
    const bad = placements().filter((p) => p.kind !== FloraKind.BroadTree && onRoad(p.x, p.z))
    expect(bad).toHaveLength(0)
  })

  it('菜園的中心與四個角都不在凹路上', () => {
    const { gardens } = farmSettlements(HALF, 'julyWheat')
    let bad = 0
    for (const g of gardens) {
      if (onRoad(g.x, g.z) || g.ring.some(([x, z]) => onRoad(x, z))) bad++
    }
    expect(bad).toBe(0)
  })
})
