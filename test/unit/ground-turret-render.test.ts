import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Mesh, Vector3 } from 'three'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget, type GroundTarget } from '../../src/world/groundTargets'
import { createGroundBattery } from '../../src/world/shipGuns'
import { TANK_TRAVERSE_RATE } from '../../src/render/gunAim'

/**
 * 砲塔的畫面（SPEC `2026-10-08-gun-traverse-design.md` §5）：車身底下掛水平轉那一顆、
 * 它底下掛上下抬那一顆，角度照瞄準方向。
 */
const DEG = Math.PI / 180
const CAM = new Vector3(0, 100, 0)

beforeAll(async () => {
  await preloadGroundModels(async (url) => {
    const b = readFileSync(`public${url}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  })
})

/** 第 k 台的車身、水平轉、上下抬三顆 */
function partsOf(models: ReturnType<typeof createGroundModels>, k: number): { body: Mesh; trav: Mesh; elev: Mesh } {
  const body = models.object.children[k] as Mesh
  const trav = body.children[0] as Mesh
  const elev = trav.children[0] as Mesh
  return { body, trav, elev }
}

function flak(heading = 0): GroundTarget {
  const t = createGroundTarget(0, 'usFlakHeavy', 'red', 0, 0, heading)
  t.guns = createGroundBattery()
  return t
}

describe('砲位：照模擬的瞄準方向', () => {
  it('兩顆子網格掛在轉軸上', () => {
    const t = flak()
    const models = createGroundModels([t])
    const { trav, elev } = partsOf(models, 0)
    expect(trav.position.toArray().map((v) => +v.toFixed(3))).toEqual([0, 0.92, 0])
    expect(elev.position.toArray().map((v) => +v.toFixed(3))).toEqual([0, 0.78, 0.15])
    models.dispose()
  })

  it('瞄準左邊水平 → yaw +90°；斜上前方 → pitch 45°', () => {
    const t = flak()
    const models = createGroundModels([t])
    const { trav, elev } = partsOf(models, 0)
    t.guns[0]!.aim.set(-1, 0, 0)
    models.update([t], CAM)
    expect(trav.rotation.y / DEG).toBeCloseTo(90, 6)
    expect(elev.rotation.x / DEG).toBeCloseTo(0, 6)
    t.guns[0]!.aim.set(0, 1, -1).normalize()
    models.update([t], CAM)
    expect(trav.rotation.y / DEG).toBeCloseTo(0, 6)
    expect(elev.rotation.x / DEG).toBeCloseTo(45, 6)
    models.dispose()
  })

  /** 沒目標時 aim 回到正上方：砲塔停在原來的方位，砲管抬到上限 */
  it('正上方：yaw 停在上一幀、pitch 夾 85°', () => {
    const t = flak()
    const models = createGroundModels([t])
    const { trav, elev } = partsOf(models, 0)
    t.guns[0]!.aim.set(1, 0, 0)
    models.update([t], CAM)
    t.guns[0]!.aim.set(0, 1, 0)
    models.update([t], CAM)
    expect(trav.rotation.y / DEG).toBeCloseTo(-90, 6)
    expect(elev.rotation.x / DEG).toBeCloseTo(85, 6)
    models.dispose()
  })

  it('死了角度不動，三顆一起換成殘骸的材質', () => {
    const t = flak()
    const models = createGroundModels([t])
    const { body, trav, elev } = partsOf(models, 0)
    t.guns[0]!.aim.set(-1, 0, 0)
    models.update([t], CAM)
    t.alive = false
    t.guns[0]!.aim.set(1, 0, 0)
    models.update([t], CAM)
    expect(trav.rotation.y / DEG).toBeCloseTo(90, 6)
    expect(trav.material).toBe(body.material)
    expect(elev.material).toBe(body.material)
    t.alive = true
    models.update([t], CAM)
    expect(trav.material).toBe(body.material)
    models.dispose()
  })
})

describe('T-34：照地面戰的瞄準目標慢慢轉', () => {
  const source = (j: number) => ({ aimTarget: (s: number) => (s === 0 ? j : -1) })

  it('以固定轉速轉向目標，到了就停；seconds 0 不轉', () => {
    const tank = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const foe = createGroundTarget(1, 'tank', 'red', -300, 0, 0)
    const list = [tank, foe]
    const models = createGroundModels(list)
    const { trav } = partsOf(models, 0)
    models.update(list, CAM, 0, source(1))
    expect(trav.rotation.y).toBe(0)
    models.update(list, CAM, 0.5, source(1))
    expect(trav.rotation.y).toBeCloseTo(TANK_TRAVERSE_RATE * 0.5, 9)
    // 旋轉軸不在車心（z 0.18）：正左方 300 m 的目標是 90.03°
    for (let i = 0; i < 20; i++) models.update(list, CAM, 0.5, source(1))
    expect(trav.rotation.y / DEG).toBeCloseTo(90, 1)
    models.dispose()
  })

  it('換成車身的座標：車頭朝左（heading +90°）時正左方的目標在正前方', () => {
    const tank = createGroundTarget(0, 'tank', 'blue', 0, 0, Math.PI / 2)
    const foe = createGroundTarget(1, 'tank', 'red', -300, 0, 0)
    const list = [tank, foe]
    const models = createGroundModels(list)
    const { trav, elev } = partsOf(models, 0)
    for (let i = 0; i < 20; i++) models.update(list, CAM, 0.5, source(1))
    expect(trav.rotation.y / DEG).toBeCloseTo(0, 1)
    // 目標比耳軸低一點、在 300 m 外：仰角是小的負值，夾在 −5° 以內
    expect(elev.rotation.x / DEG).toBeLessThan(0)
    expect(elev.rotation.x / DEG).toBeGreaterThan(-5)
    models.dispose()
  })

  /** 【重開一場】沒有波次的一場重開時地面模型留著用（`main.ts`），角度不能帶到下一場 */
  it('resetTurrets 把角度歸零，下一場從正前方開始轉', () => {
    const tank = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const foe = createGroundTarget(1, 'tank', 'red', -300, 0, 0)
    const list = [tank, foe]
    const models = createGroundModels(list)
    const { trav, elev } = partsOf(models, 0)
    for (let i = 0; i < 20; i++) models.update(list, CAM, 0.5, source(1))
    models.resetTurrets()
    expect(trav.rotation.y).toBe(0)
    expect(elev.rotation.x).toBe(0)
    models.update(list, CAM, 0.5, source(1))
    expect(trav.rotation.y).toBeCloseTo(TANK_TRAVERSE_RATE * 0.5, 9)
    models.dispose()
  })

  /**
   * 【仰角從耳軸量】耳軸在水平旋轉軸前方（T-34 0.98 m）。從旋轉軸量水平距離的話，近處的目標
   * 會指低：正前方 12 m 差 0.3°
   */
  it('仰角的水平距離從耳軸量，不是從水平旋轉軸', () => {
    const tank = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const foe = createGroundTarget(1, 'tank', 'red', 0, -12, 0)
    const list = [tank, foe]
    const models = createGroundModels(list)
    const { trav, elev } = partsOf(models, 0)
    for (let i = 0; i < 10; i++) models.update(list, CAM, 0.5, source(1))
    const tp = trav.position
    const ep = elev.position
    const dy = foe.unit.realHeight * 0.5 - (tp.y + ep.y)
    const flat = 12 + tp.z + ep.z
    expect(elev.rotation.x).toBeCloseTo(Math.atan2(dy, flat), 6)
    models.dispose()
  })

  /** 【開腳式砲架只能在架腳之間轉】ZiS-3 ±27°：目標在正左方時停在 +27°，不整座轉過去 */
  it('有射界的砲（反坦克砲）方位夾在射界裡', () => {
    const gun = createGroundTarget(0, 'atGun', 'blue', 0, 0, 0)
    const foe = createGroundTarget(1, 'tank', 'red', -300, 0, 0)
    const list = [gun, foe]
    const models = createGroundModels(list)
    const { trav } = partsOf(models, 0)
    for (let i = 0; i < 20; i++) models.update(list, CAM, 0.5, source(1))
    expect(trav.rotation.y / DEG).toBeCloseTo(27, 6)
    models.dispose()
  })

  it('沒有目標（或沒有來源）就慢慢轉回正前方', () => {
    const tank = createGroundTarget(0, 'tank', 'blue', 0, 0, 0)
    const foe = createGroundTarget(1, 'tank', 'red', -300, 0, 0)
    const list = [tank, foe]
    const models = createGroundModels(list)
    const { trav } = partsOf(models, 0)
    for (let i = 0; i < 20; i++) models.update(list, CAM, 0.5, source(1))
    models.update(list, CAM, 0.5, source(-1))
    expect(trav.rotation.y / DEG).toBeCloseTo(80, 1)
    for (let i = 0; i < 20; i++) models.update(list, CAM, 0.5)
    expect(trav.rotation.y).toBeCloseTo(0, 9)
    models.dispose()
  })
})
