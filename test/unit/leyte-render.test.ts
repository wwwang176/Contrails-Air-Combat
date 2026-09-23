import { describe, expect, it } from 'vitest'
import { Color, type BufferGeometry, type Mesh } from 'three'
import {
  createLeyte, FIELD_HALF, LEYTE_ROAD, PLAIN_HEIGHT, ROAD_TREE_CLEAR, SAND_TOP, distanceToRoad,
} from '../../src/world/leyte'
import {
  FAR_LAND_NAME, ROAD_COLOR, createLeyteGround, isLeyteGrass, leyteShade, roadCoverageAt,
  roadHalfWidthAt,
} from '../../src/render/leyteGround'
import { createLeyteFlora, leyteAccept, FLORA_STRIDE, FloraKind, type FloraBuffer } from '../../src/render/flora'
import { createTerrain } from '../../src/render/terrain'

/**
 * # 雷伊泰的算繪
 *
 * 守三件會靜靜壞掉的事：畫出來的地與撞地判定是同一個高度、公路只有一份座標
 * （路面、植被清空帶都讀 `LEYTE_ROAD`）、平地上的樹比丘陵上少。
 */

const { field } = createLeyte()

function maxAccept(cx: number, cz: number): number {
  let m = 0
  for (let x = cx - 300; x <= cx + 300; x += 13) {
    for (let z = cz - 300; z <= cz + 300; z += 13) m = Math.max(m, leyteAccept(field, x, z, field.sample(x, z)))
  }
  return m
}

describe('leyte 的地面網格', () => {
  it('每一個頂點的高度就是高度場的值（畫面與撞地同一個數字）', () => {
    const g = createLeyteGround(field, () => 0)
    let checked = 0
    g.object.traverse((o) => {
      const geo = (o as Mesh).geometry as BufferGeometry | undefined
      // 【遠景陸地不比】它在場外，沒有高度場也沒有碰撞
      if (geo === undefined || o.name === FAR_LAND_NAME) return
      const p = geo.getAttribute('position')
      for (let i = 0; i < p.count; i += 97) {
        expect(p.getY(i)).toBe(Math.fround(field.sample(p.getX(i), p.getZ(i))))
        checked++
      }
    })
    expect(checked).toBeGreaterThan(100)
    g.dispose()
  })

  it('場外有遠景陸地：陸地一路延伸到場地之外', () => {
    const g = createLeyteGround(field, () => 0)
    let outside = 0
    g.object.traverse((o) => {
      const geo = (o as Mesh).geometry as BufferGeometry | undefined
      if (geo === undefined) return
      const p = geo.getAttribute('position')
      for (let i = 0; i < p.count; i++) {
        if ((Math.abs(p.getX(i)) > FIELD_HALF + 1 || p.getZ(i) > FIELD_HALF + 1) && p.getY(i) > PLAIN_HEIGHT) {
          outside++
        }
      }
    })
    expect(outside).toBeGreaterThan(100)
    g.dispose()
  })

  it('沙灘只在 SAND_TOP 以下；平地是草色', () => {
    const sand = leyteShade(SAND_TOP - 0.1, 0, new Color()).getHex()
    expect(leyteShade(PLAIN_HEIGHT, 0, new Color()).getHex()).not.toBe(sand)
    expect(isLeyteGrass(SAND_TOP - 0.1)).toBe(false)
    expect(isLeyteGrass(PLAIN_HEIGHT)).toBe(true)
  })
})

describe('公路只有一份座標', () => {
  it('路面覆蓋在中線上是 1、離開 40 m 是 0', () => {
    const a = LEYTE_ROAD[30]!
    expect(roadCoverageAt(a.x, a.z)).toBe(1)
    expect(roadCoverageAt(a.x + 30, a.z + 30)).toBe(0)
  })

  it('路寬沿路不規則，但最窄處仍蓋得住轉彎時偏離中線的車（2.1 m）', () => {
    let lo = Infinity
    let hi = -Infinity
    for (let i = 1; i < LEYTE_ROAD.length; i++) {
      const a = LEYTE_ROAD[i - 1]!
      const b = LEYTE_ROAD[i]!
      for (let t = 0; t <= 1; t += 0.01) {
        const w = roadHalfWidthAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t)
        lo = Math.min(lo, w)
        hi = Math.max(hi, w)
      }
    }
    expect(hi - lo).toBeGreaterThan(1)
    expect(lo).toBeGreaterThanOrEqual(2.2)
    expect(hi).toBeLessThan(ROAD_TREE_CLEAR)
  })

  it('路面是土色，接近沙灘而不是柏油', () => {
    const sand = leyteShade(SAND_TOP - 0.1, 0, new Color())
    const road = new Color(ROAD_COLOR)
    const dist = Math.abs(road.r - sand.r) + Math.abs(road.g - sand.g) + Math.abs(road.b - sand.b)
    expect(dist).toBeLessThan(0.25)
  })

  it('植被在公路清空帶內接受率為 0，平地上遠低於丘陵上', () => {
    const a = LEYTE_ROAD[4]!
    expect(leyteAccept(field, a.x, a.z, PLAIN_HEIGHT)).toBe(0)
    // 平地（有緩坡）取在公路走廊裡遠離丘陵的一點，對照組取最大那座丘陵的頂
    expect(maxAccept(0, 2500)).toBeLessThan(maxAccept(-7500, 0) * 0.3)
  })

  it('實際長出來的樹沒有一棵落在清空帶內，而且是闊葉樹或灌木', () => {
    const src = createLeyteFlora(field)
    const cap = 20000
    const out: FloraBuffer = {
      data: new Float32Array(cap * FLORA_STRIDE), kind: new Uint8Array(cap), capacity: cap, count: 0, dropped: 0,
    }
    const a = LEYTE_ROAD[2]!
    src(a.x - 300, a.z - 300, a.x + 300, a.z + 300, (x, z) => field.sample(x, z), out)
    expect(out.count).toBeGreaterThan(0)
    for (let i = 0; i < out.count; i++) {
      const x = out.data[i * FLORA_STRIDE]!
      const z = out.data[i * FLORA_STRIDE + 2]!
      expect(distanceToRoad(x, z)).toBeGreaterThanOrEqual(ROAD_TREE_CLEAR)
      expect([FloraKind.BroadTree, FloraKind.Bush]).toContain(out.kind[i])
    }
  })
})

describe('createTerrain("leyte")', () => {
  it('海面在岸線外、陸地在平地上；避障清單是丘陵', () => {
    const t = createTerrain('leyte')
    expect(t.collisionHeightAt(0, -8000)).toBe(0)
    expect(t.collisionHeightAt(0, 2000)).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
    expect(t.waterAt(0, 2000)).toBe(-Infinity)
    expect(t.islands.length).toBeGreaterThan(0)
    t.dispose()
  })
})
