import { describe, expect, it } from 'vitest'
import { Color, type BufferGeometry, type Mesh } from 'three'
import {
  createLeyte, FIELD_HALF, LEYTE_MASSIFS, LEYTE_ROAD, PLAIN_HEIGHT, ROAD_TREE_CLEAR, SAND_TOP, distanceToRoad,
} from '../../src/world/leyte'
import {
  FAR_LAND_NAME, ROAD_COLOR, bakeRoadDistance, createLeyteGround, isLeyteGrass, leyteShade,
  roadCoverageAt, roadHalfWidthAt, type CanopyMap,
} from '../../src/render/leyteGround'
import {
  bakeLeyteCanopy, createFloraBuffer, createLeyteFlora, leyteAccept, leyteCanopyCoarse,
  FLORA_STRIDE, FloraKind, LEYTE_HILL_DENSITY, type FloraBuffer,
} from '../../src/render/flora'
import { createTerrain } from '../../src/render/terrain'
import { createOcean } from '../../src/render/ocean'

/**
 * # 雷伊泰的算繪
 *
 * 守三件會靜靜壞掉的事：畫出來的地與撞地判定是同一個高度、公路只有一份座標
 * （路面、植被清空帶都讀 `LEYTE_ROAD`）、平地上的樹比丘陵上少。
 */

const { field } = createLeyte()
/** 網格的測試不看林子：一張空的樹冠圖 */
const NO_CANOPY: CanopyMap = { data: new Uint8Array(4), size: 2, half: FIELD_HALF, texel: FIELD_HALF }

function maxAccept(cx: number, cz: number): number {
  let m = 0
  for (let x = cx - 300; x <= cx + 300; x += 13) {
    for (let z = cz - 300; z <= cz + 300; z += 13) m = Math.max(m, leyteAccept(field, x, z, field.sample(x, z)))
  }
  return m
}

describe('leyte 的地面網格', () => {
  it('每一個頂點的高度就是高度場的值（畫面與撞地同一個數字）', () => {
    const g = createLeyteGround(field, NO_CANOPY)
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

  it('陸地比海面先畫 —— 被陸地蓋住的海由深度測試擋掉，不算碎光', () => {
    const g = createLeyteGround(field, NO_CANOPY)
    const ocean = createOcean(null)
    let meshes = 0
    g.object.traverse((o) => {
      if ((o as Mesh).isMesh !== true) return
      meshes++
      expect(o.renderOrder).toBeLessThan(ocean.mesh.renderOrder)
      expect(o.renderOrder).toBeLessThan(ocean.farMesh.renderOrder)
    })
    expect(meshes).toBeGreaterThan(0)
    g.dispose()
    ocean.dispose()
  })

  it('場外有遠景陸地：陸地一路延伸到場地之外', () => {
    const g = createLeyteGround(field, NO_CANOPY)
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

  it('烘好的離路距離圖與逐段算的距離一致（誤差在一格之內）；離路遠的是上限', () => {
    const r = bakeRoadDistance()
    const { x0, z0, x1, z1 } = r.box
    let checked = 0
    for (let i = 0; i < 4000; i++) {
      // 固定序列的取樣點，涵蓋整個方框
      const x = x0 + ((i * 7919) % 1000) / 1000 * (x1 - x0)
      const z = z0 + ((i * 104729) % 1000) / 1000 * (z1 - z0)
      const col = Math.min(r.width - 1, Math.floor((x - x0) / r.texel))
      const row = Math.min(r.height - 1, Math.floor((z - z0) / r.texel))
      const baked = (r.data[row * r.width + col]! / 255) * r.maxDistance
      const cx = x0 + (col + 0.5) * r.texel
      const cz = z0 + (row + 0.5) * r.texel
      const truth = Math.min(r.maxDistance, distanceToRoad(cx, cz))
      expect(Math.abs(baked - truth), `${cx},${cz}`).toBeLessThan(r.maxDistance / 255 + 1e-6)
      checked++
    }
    expect(checked).toBe(4000)
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
    // 平地取公路中段（瓣離公路至少 400 m，±300 m 的方框全在平地上），對照組取最高那一瓣的頂
    const mid = LEYTE_ROAD[Math.floor(LEYTE_ROAD.length / 2)]!
    const top = LEYTE_MASSIFS.flatMap((m) => m.lobes).reduce((a, b) => (b.peak > a.peak ? b : a))
    expect(maxAccept(mid.x, mid.z)).toBeLessThan(maxAccept(top.cx, top.cz) * 0.3)
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

describe('樹冠圖', () => {
  const canopy = bakeLeyteCanopy(field)
  const at = (x: number, z: number): number => {
    const col = Math.floor((x + canopy.half) / canopy.texel)
    const row = Math.floor((z + canopy.half) / canopy.texel)
    return canopy.data[row * canopy.size + col]!
  }
  const mean = (cx: number, cz: number): number => {
    let s = 0
    let n = 0
    for (let x = cx - 400; x <= cx + 400; x += canopy.texel) {
      for (let z = cz - 400; z <= cz + 400; z += canopy.texel) { s += at(x, z); n++ }
    }
    return s / n
  }

  it('蓋住整個高度場；開場用的粗圖範圍相同（`setCanopy` 換圖靠它）', () => {
    expect(canopy.half).toBe(FIELD_HALF)
    expect(canopy.size * canopy.texel).toBeCloseTo(2 * FIELD_HALF, 6)
    const coarse = leyteCanopyCoarse(field)
    expect(coarse.half).toBe(canopy.half)
    expect(coarse.size * coarse.texel).toBeCloseTo(2 * FIELD_HALF, 6)
  })

  it('接受率不超過 LEYTE_HILL_DENSITY —— 放置先拿雜湊比這個上限，超過就不算接受率', () => {
    let top = 0
    for (const lo of LEYTE_MASSIFS.flatMap((m) => m.lobes)) {
      for (let dx = -300; dx <= 300; dx += 37) {
        for (let dz = -300; dz <= 300; dz += 41) {
          const x = lo.cx + dx
          const z = lo.cz + dz
          top = Math.max(top, leyteAccept(field, x, z, field.sample(x, z)))
        }
      }
    }
    expect(top).toBeGreaterThan(LEYTE_HILL_DENSITY * 0.8)
    expect(top).toBeLessThanOrEqual(LEYTE_HILL_DENSITY)
  })

  it('每一株真的樹底下都是暗的 —— 立體的樹長在自己的暗點上', () => {
    const top = LEYTE_MASSIFS.flatMap((m) => m.lobes).reduce((a, b) => (b.peak > a.peak ? b : a))
    const buf = createFloraBuffer(20000)
    createLeyteFlora(field)(top.cx - 200, top.cz - 200, top.cx + 200, top.cz + 200, () => 0, buf)
    expect(buf.count).toBeGreaterThan(50)
    for (let k = 0; k < buf.count; k++) {
      const x = buf.data[k * FLORA_STRIDE]!
      const z = buf.data[k * FLORA_STRIDE + 2]!
      expect(at(x, z), `${x.toFixed(0)},${z.toFixed(0)}`).toBeGreaterThan(0)
    }
  })

  it('公路中線上沒有樹冠', () => {
    for (const p of LEYTE_ROAD) {
      if (Math.abs(p.x) >= FIELD_HALF || Math.abs(p.z) >= FIELD_HALF) continue
      expect(at(p.x, p.z), `${p.x.toFixed(0)},${p.z.toFixed(0)}`).toBe(0)
    }
  })

  it('山上的林子比公路旁的平地密', () => {
    const top = LEYTE_MASSIFS.flatMap((m) => m.lobes).reduce((a, b) => (b.peak > a.peak ? b : a))
    const mid = LEYTE_ROAD[Math.floor(LEYTE_ROAD.length / 2)]!
    expect(mean(top.cx, top.cz)).toBeGreaterThan(mean(mid.x, mid.z) * 3)
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
