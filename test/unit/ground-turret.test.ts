import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { BoxGeometry, BufferGeometry, Mesh, MeshStandardMaterial, Object3D } from 'three'
import { bakeGroundScene, parseGroundGlb } from '../../src/render/geometry/ground/glb'
import { GROUND_MODELS, groundGeometry, preloadGroundModels } from '../../src/render/geometry/ground'
import { GUN_TURRET_KEY, restGeometry, type GunTurretParts } from '../../src/render/geometry/ground/turret'
import { GROUND_UNITS } from '../../src/specs/ground'

/**
 * 砲塔拆塊（SPEC `2026-10-08-gun-traverse-design.md` §4）。
 *
 * 守的事：拆開的三塊放回轉軸之後與不拆的整支**逐點相同** —— 轉軸減錯一個分量，靜止時
 * 砲塔就整座偏一截，而且不會報錯。
 */

function readPublic(url: string): ArrayBuffer {
  const b = readFileSync(`public${url}`)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** 頂點（位置＋顏色）當成一個多重集合比：三塊的合併順序與整支的走訪順序不同 */
function vertexSet(g: BufferGeometry): string[] {
  const p = g.getAttribute('position')
  const c = g.getAttribute('color')
  const out: string[] = []
  for (let i = 0; i < p.count; i++) {
    out.push([p.getX(i), p.getY(i), p.getZ(i), c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(4)).join(','))
  }
  return out.sort()
}

const TURRET = { traverse: 'T_Traverse', elevate: 'T_Elevate' }

/** 一座小砲：底座固定、轉盤跟著水平轉、砲管跟著抬 */
function smallGun(): Object3D {
  const steel = new MeshStandardMaterial({ name: 'LP_Steel' })
  const root = new Object3D()
  const base = new Mesh(new BoxGeometry(2, 0.4, 2).translate(0, 0.2, 0), steel)
  base.name = 'T_Base'
  const trav = new Object3D()
  trav.name = TURRET.traverse
  trav.position.set(0, 0.4, 0.1)
  const ring = new Mesh(new BoxGeometry(1, 0.3, 1), steel)
  ring.name = 'T_Ring'
  ring.position.set(0, 0.15, 0)
  const elev = new Object3D()
  elev.name = TURRET.elevate
  elev.position.set(0, 0.6, -0.2)
  const barrel = new Mesh(new BoxGeometry(0.1, 0.1, 2).translate(0, 0, -1), steel)
  barrel.name = 'T_Barrel'
  root.add(base)
  root.add(trav)
  trav.add(ring)
  trav.add(elev)
  elev.add(barrel)
  return root
}

describe('拆塊：小砲', () => {
  it('三塊放回轉軸與不拆的整支逐點相同；固定那一塊只剩底座', () => {
    const whole = bakeGroundScene(smallGun())
    const split = bakeGroundScene(smallGun(), TURRET)
    const parts = split.userData[GUN_TURRET_KEY] as GunTurretParts
    expect(parts.traversePivot.toArray()).toEqual([0, 0.4, 0.1])
    expect(parts.elevatePivot.toArray().map((v) => +v.toFixed(6))).toEqual([0, 0.6, -0.2])
    expect(split.getAttribute('position').count).toBe(36)
    // 砲管以耳軸為原點：最遠的那一端在 z = −2
    parts.elevate.computeBoundingBox()
    expect(parts.elevate.boundingBox!.min.z).toBeCloseTo(-2, 6)
    expect(parts.elevate.boundingBox!.max.z).toBeCloseTo(0, 6)
    expect(vertexSet(restGeometry(split))).toEqual(vertexSet(whole))
  })

  it('少了任一個節點就丟錯', () => {
    expect(() => bakeGroundScene(smallGun(), { ...TURRET, elevate: 'nope' })).toThrow(/nope/)
    expect(() => bakeGroundScene(smallGun(), { ...TURRET, traverse: 'nope' })).toThrow(/nope/)
  })

  it('Elevate 不在 Traverse 底下就丟錯', () => {
    const s = smallGun()
    const elev = s.getObjectByName(TURRET.elevate)!
    s.add(elev)
    expect(() => bakeGroundScene(s, TURRET)).toThrow(/Elevate|底下/)
  })

  it('轉軸節點帶旋轉或縮放就丟錯', () => {
    const r = smallGun()
    r.getObjectByName(TURRET.traverse)!.rotation.y = 0.3
    expect(() => bakeGroundScene(r, TURRET)).toThrow(/旋轉|縮放/)
    const k = smallGun()
    k.getObjectByName(TURRET.elevate)!.scale.set(1, 2, 1)
    expect(() => bakeGroundScene(k, TURRET)).toThrow(/旋轉|縮放/)
  })
})

describe('拆塊：遊戲裡的 GLB', () => {
  beforeAll(async () => {
    await preloadGroundModels(async (url) => readPublic(url))
  })

  const turreted = GROUND_UNITS.filter((u) => {
    const m = GROUND_MODELS[u.id].model
    return 'glb' in m && m.turret !== undefined
  })

  it('五種模型、七個單位登記了砲塔', () => {
    expect(turreted.map((u) => u.id).sort()).toEqual(
      ['atGun', 'flakHeavy', 'flakLight', 'tank', 'tankDug', 'usFlakHeavy', 'usFlakTrack'],
    )
  })

  for (const u of turreted) {
    it(`${u.id}：放回靜止姿勢與不拆的整支逐點相同`, async () => {
      const m = GROUND_MODELS[u.id].model
      if (!('glb' in m)) throw new Error('不是 GLB')
      const geo = groundGeometry(u)
      expect(geo.userData[GUN_TURRET_KEY]).toBeDefined()
      const whole = await parseGroundGlb(readPublic(m.glb))
      expect(vertexSet(restGeometry(geo))).toEqual(vertexSet(whole))
    })
  }
})
