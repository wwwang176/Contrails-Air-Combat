import { describe, expect, it } from 'vitest'
import { Vector3, type Mesh } from 'three'
import {
  SHIP_BOW_WAKE, SHIP_STERN_WAKE, STERN_WAKE_START, createShipWakes, shipHalfSize,
  shipSinkBoxes, shipWakePoint,
} from '../../src/render/shipWakes'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import {
  TORPEDO_WAKE, WAKE_LIFT, createSinkBoxes, insideSinkBox, wakeHalfWidth,
} from '../../src/render/wake'
import { WAVES } from '../../src/render/ocean'

/**
 * # 船的航跡
 *
 * 守的是「從哪裡落、停著的船沒有、寬度照艦寬」。好不好看由截圖裁定。
 */

const flat = () => 0

/** 讓船沿艏向走 `seconds` 秒，每 0.1 秒餵一次航跡 */
function sail(speed: number, seconds: number) {
  const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, speed)
  const w = createShipWakes([ship])
  const fwd = new Vector3(0, 0, -1).applyQuaternion(ship.orientation)
  for (let t = 0; t < seconds; t += 0.1) {
    ship.position.addScaledVector(fwd, speed * 0.1)
    w.step([ship], 0.1, t, flat)
  }
  return { ship, w }
}

/** 一條帶子（第 0 格）的頂點：有不透明度的那些 */
function visible(obj: Mesh) {
  const p = obj.geometry.getAttribute('position')
  const a = obj.geometry.getAttribute('aAlpha')
  const out: Vector3[] = []
  for (let i = 0; i < p.count; i++) if (a.getX(i) > 0) out.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)))
  return out
}

describe('船的航跡', () => {
  /** 【艦尾那一條從船身底下開始】落在艦尾的話，帶子與船尾之間看起來斷一截 */
  it('艦首的點在艦首；艦尾那一條從船身底下開始；跟著艏向轉', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 100, 200, Math.PI / 2, 8)
    const { halfLength } = shipHalfSize(ship)
    expect(halfLength).toBeCloseTo(57.4, 3)
    const bow = shipWakePoint(ship, -1, new Vector3())
    const stern = shipWakePoint(ship, 1, new Vector3())
    // 繞 +Y 轉 90°：艦首 −Z 轉到 −X
    expect(bow.x).toBeCloseTo(100 - halfLength, 3)
    expect(stern.x).toBeCloseTo(100 + STERN_WAKE_START * halfLength, 3)
    expect(stern.x).toBeLessThan(100 + halfLength)
    expect(bow.z).toBeCloseTo(200, 3)
  })

  /** 【開場就鋪好】不然開場船後面是空的，航跡一格一格長出來，像船才剛起步 */
  it('建立時就照航向與航速往回鋪好航跡；停著的船沒有', () => {
    const moving = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 8)
    const parked = createShip(1, SHIP_CLASSES.fletcher, 'red', 500, 0, 0, 0)
    const w = createShipWakes([moving, parked])
    w.step([moving, parked], 0, 0, flat)
    const [stern] = w.object.children as [Mesh, Mesh]
    const vs = visible(stern)
    // 全部都是第 0 格（開動的那艘，x 在 0 附近）；拖到船後面好幾百公尺
    for (const v of vs) expect(Math.abs(v.x)).toBeLessThan(50)
    const farthest = Math.max(...vs.map((v) => v.z))
    expect(farthest).toBeGreaterThan(8 * SHIP_STERN_WAKE.life * 0.8)
  })

  /** 【停著的船沒有航跡】灘頭擱淺的 LST 航速是 0 */
  it('停著的船不落節點，兩條帶子都看不到', () => {
    const { w } = sail(0, 10)
    const [stern, bow] = w.object.children as [Mesh, Mesh]
    expect(visible(stern)).toEqual([])
    expect(visible(bow)).toEqual([])
  })

  it('開動的船艦尾拖出一長條、艦首的白浪比船寬', () => {
    const { ship, w } = sail(8, 20)
    const [stern, bow] = w.object.children as [Mesh, Mesh]
    const { halfBeam } = shipHalfSize(ship)
    const sv = visible(stern)
    const bv = visible(bow)
    expect(sv.length).toBeGreaterThan(10)
    expect(bv.length).toBeGreaterThan(4)
    // 寬度照艦寬：艦首最寬處超出船舷，艦尾最寬處是半艦寬的數倍
    const maxX = (vs: Vector3[]) => Math.max(...vs.map((v) => Math.abs(v.x)))
    expect(maxX(bv)).toBeGreaterThan(halfBeam * 1.3)
    expect(maxX(bv)).toBeLessThanOrEqual(halfBeam * SHIP_BOW_WAKE.halfTo + 1e-3)
    expect(maxX(sv)).toBeGreaterThan(halfBeam * SHIP_STERN_WAKE.halfFrom)
    // 艦尾那一條在船後面（+Z），艦首那一條從艦首往後
    const { halfLength } = shipHalfSize(ship)
    const shipZ = ship.position.z
    for (const v of sv) expect(v.z).toBeGreaterThanOrEqual(shipZ + STERN_WAKE_START * halfLength - 1e-3)
    for (const v of bv) expect(v.z).toBeGreaterThanOrEqual(shipZ - halfLength - 1e-3)
  })

  /**
   * 【船身底下的帶子不跟著浪抬】艦尾那一條從船身底下開始；浪高時照浪抬會高過艦尾
   * 甲板，泡沫從甲板上冒出來
   */
  it('船身範圍內的帶子壓在水線，船身外照浪高', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, Math.PI / 2, 8)
    const { halfLength, halfBeam } = shipHalfSize(ship)
    const boxes = createSinkBoxes(1)
    shipSinkBoxes([ship], boxes)
    // 艏向轉 90°：船身沿 x 軸
    expect(insideSinkBox(boxes, 0, halfLength - 1, 0)).toBe(true)
    expect(insideSinkBox(boxes, 0, 0, halfBeam - 0.5)).toBe(true)
    expect(insideSinkBox(boxes, 0, halfLength + 1, 0)).toBe(false)
    expect(insideSinkBox(boxes, 0, 0, halfBeam + 0.5)).toBe(false)

    const w = createShipWakes([ship])
    const waves = () => 3
    w.step([ship], 0.1, 0, waves)
    const [stern] = w.object.children as [Mesh, Mesh]
    const p = stern.geometry.getAttribute('position')
    const a = stern.geometry.getAttribute('aAlpha')
    const sink = stern.geometry.getAttribute('aSink')
    let under = 0
    for (let i = 0; i < p.count; i++) {
      if (a.getX(i) <= 0) continue
      const inside = insideSinkBox(boxes, 0, p.getX(i), p.getZ(i))
      // 著色器算浪高時讀的旗標與 CPU 自己壓的是同一個判斷
      expect(sink.getX(i)).toBe(inside ? 1 : 0)
      if (inside) {
        under++
        expect(p.getY(i)).toBeLessThan(1)
      } else {
        expect(p.getY(i)).toBeGreaterThan(3)
      }
    }
    expect(under).toBeGreaterThan(0)
  })

  /**
   * 【接了海面，浪高交給著色器】CPU 只寫浮起的那 WAKE_LIFT；再加 CPU 的浪高就是算兩次，
   * 帶子浮在浪上一倍高
   */
  it('接了海面之後頂點只帶 WAKE_LIFT，不再問浪高場', () => {
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 8)
    const w = createShipWakes([ship])
    let asked = 0
    const waves = () => { asked++; return 3 }
    w.bindOcean({ uTime: { value: 0 } })
    w.step([ship], 0.1, 0, waves)
    expect(asked).toBe(0)
    const [stern] = w.object.children as [Mesh, Mesh]
    const p = stern.geometry.getAttribute('position')
    const a = stern.geometry.getAttribute('aAlpha')
    let seen = 0
    for (let i = 0; i < p.count; i++) {
      if (a.getX(i) <= 0) continue
      seen++
      expect(p.getY(i)).toBeCloseTo(WAKE_LIFT, 6)
    }
    expect(seen).toBeGreaterThan(0)
    // 解開之後回到 CPU 問浪高
    w.bindOcean(null)
    w.step([ship], 0.1, 0.1, waves)
    expect(asked).toBeGreaterThan(0)
  })

  /**
   * 【寬的帶子橫向要切】浪高只在頂點上取樣、頂點之間是直線；一段寬過最短那道浪的
   * 六分之一，浪峰處的弦低於海面超過 WAKE_LIFT 能蓋的量，中段被浪蓋掉
   */
  it('每一艘船的航跡散到最寬時，橫向每一段都短於最短浪長的六分之一', () => {
    const shortest = Math.min(...WAVES.map((wv) => wv.wavelength))
    for (const cls of Object.values(SHIP_CLASSES)) {
      const ship = createShip(0, cls, 'red', 0, 0, 0, 8)
      const { halfBeam } = shipHalfSize(ship)
      for (const style of [SHIP_STERN_WAKE, SHIP_BOW_WAKE]) {
        const segment = (2 * style.halfTo * halfBeam) / (style.columns ?? 1)
        expect(segment, `${cls.name}`).toBeLessThanOrEqual(shortest / 6)
      }
    }
    // 幾何上真的切了：同一個節點的相鄰頂點距離 = 帶寬 ÷ 段數
    const { ship, w } = sail(8, 30)
    const [stern] = w.object.children as [Mesh, Mesh]
    const p = stern.geometry.getAttribute('position')
    const a = stern.geometry.getAttribute('aAlpha')
    const cols = SHIP_STERN_WAKE.columns! + 1
    const { halfBeam } = shipHalfSize(ship)
    const limit = (2 * SHIP_STERN_WAKE.halfTo * halfBeam) / SHIP_STERN_WAKE.columns!
    let checked = 0
    for (let i = 0; i + 1 < p.count; i++) {
      if (i % cols === cols - 1 || a.getX(i) <= 0) continue
      const d = Math.hypot(p.getX(i + 1) - p.getX(i), p.getZ(i + 1) - p.getZ(i))
      expect(d).toBeLessThanOrEqual(limit + 1e-3)
      checked++
    }
    expect(checked).toBeGreaterThan(SHIP_STERN_WAKE.columns!)
  })

  /** 【扇形】前段就張開：壽命走到四分之一時，寬度已經走完一半 */
  it('艦尾的帶子前段就張開成扇形', () => {
    const quarter = wakeHalfWidth(SHIP_STERN_WAKE.life / 4, SHIP_STERN_WAKE)
    const mid = (SHIP_STERN_WAKE.halfFrom + SHIP_STERN_WAKE.halfTo) / 2
    expect(quarter).toBeGreaterThanOrEqual(mid - 1e-9)
    // 魚雷的維持均勻變寬
    expect(wakeHalfWidth(TORPEDO_WAKE.life / 4)).toBeCloseTo(
      TORPEDO_WAKE.halfFrom + (TORPEDO_WAKE.halfTo - TORPEDO_WAKE.halfFrom) / 4, 9)
  })

  /**
   * 【紋理照公尺、不照帶寬】u 若是 0…1 橫跨帶寬，帶子散開幾倍泡沫就被橫向拉長幾倍、
   * 變成扁的橫條。照公尺算的話，每一對頂點的 u 差 = 帶寬 ÷ 紋理尺寸
   */
  it('泡沫 UV 的橫向照公尺：u 差與帶寬成正比，不固定是 1', () => {
    const { w } = sail(8, 30)
    const [stern] = w.object.children as [Mesh, Mesh]
    const p = stern.geometry.getAttribute('position')
    const uv = stern.geometry.getAttribute('uv')
    const a = stern.geometry.getAttribute('aAlpha')
    const ratios: number[] = []
    let narrow = Infinity, wide = 0
    // 左緣到右緣：每個節點一排 cols 個頂點
    const cols = SHIP_STERN_WAKE.columns! + 1
    for (let i = 0; i + cols - 1 < p.count; i += cols) {
      const r = i + cols - 1
      if (a.getX(i) <= 0) continue
      const width = Math.hypot(p.getX(r) - p.getX(i), p.getZ(r) - p.getZ(i))
      if (width < 1e-3) continue
      const du = Math.abs(uv.getX(r) - uv.getX(i))
      ratios.push(du / width)
      narrow = Math.min(narrow, width); wide = Math.max(wide, width)
    }
    expect(wide).toBeGreaterThan(narrow * 3)
    for (const r of ratios) expect(r).toBeCloseTo(1 / SHIP_STERN_WAKE.foamTile!, 6)
  })

  /** 【沉了就不再落】已經落的照常淡掉 */
  it('沉了的船不再落新節點', () => {
    const { ship, w } = sail(8, 5)
    ship.alive = false
    const [stern] = w.object.children as [Mesh, Mesh]
    const before = visible(stern).length
    const fwd = new Vector3(0, 0, -1)
    for (let t = 0; t < 5; t += 0.1) {
      ship.position.addScaledVector(fwd, 0.8)
      w.step([ship], 0.1, t, flat)
    }
    expect(visible(stern).length).toBeLessThanOrEqual(before)
  })
})
