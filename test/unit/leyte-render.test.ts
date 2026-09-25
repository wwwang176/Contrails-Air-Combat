import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildLeyteBeach } from '../../src/render/leyteBeach'
import { preloadGroundModels } from '../../src/render/geometry/ground'
import { Color, type BufferGeometry, type Mesh } from 'three'
import {
  createLeyte, FIELD_HALF, LEYTE_MASSIFS, LEYTE_ROAD, LEYTE_ROADS, PLAIN_HEIGHT, ROAD_TREE_CLEAR, SAND_TOP,
  distanceToRoad, farUpland, roadTreeClear,
} from '../../src/world/leyte'
import {
  FAR_LAND_NAME, ROAD_COLOR, bakeRoadSegments, createLeyteGround, isLeyteGrass, leyteShade,
  roadCoverageAt, roadHalfWidthAt, type CanopyMap,
} from '../../src/render/leyteGround'
import {
  bakeLeyteCanopy, createFloraBuffer, createLeyteFlora, leyteAccept, leyteCanopyCoarse, leyteFarCover,
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

  it('最近路段圖：路旁每一格記的就是最近的那一段；遠離所有路的格是 0', () => {
    const r = bakeRoadSegments()
    const segAt = (id: number): { d: (x: number, z: number) => number; hw: number } => {
      const s = r.segments.subarray(id * 4, id * 4 + 4)
      return {
        hw: r.segments[(r.segmentCount + id) * 4]!,
        d: (x, z) => {
          const abx = s[2]! - s[0]!
          const abz = s[3]! - s[1]!
          const t = Math.max(0, Math.min(1, ((x - s[0]!) * abx + (z - s[1]!) * abz) / (abx * abx + abz * abz)))
          return Math.hypot(x - (s[0]! + abx * t), z - (s[1]! + abz * t))
        },
      }
    }
    const truth = (x: number, z: number): number => {
      let best = Infinity
      for (let id = 1; id < r.segmentCount; id++) best = Math.min(best, segAt(id).d(x, z))
      return best
    }
    let near = 0
    // 每條路取幾個點，往旁邊偏 0～25 m 找格子；再加一批全場的固定序列取樣
    const probes: [number, number][] = []
    for (const road of LEYTE_ROADS) {
      for (let i = 0; i < road.points.length; i += 7) {
        const p = road.points[i]!
        probes.push([p.x + (i % 25), p.z - (i % 17)])
      }
    }
    for (let i = 0; i < 400; i++) {
      probes.push([-r.half + ((i * 7919) % 1000) / 1000 * 2 * r.half, -r.half + ((i * 104729) % 1000) / 1000 * 2 * r.half])
    }
    for (const [x, z] of probes) {
      const col = Math.min(r.size - 1, Math.floor((x + r.half) / r.texel))
      const row = Math.min(r.size - 1, Math.floor((z + r.half) / r.texel))
      const cx = -r.half + (col + 0.5) * r.texel
      const cz = -r.half + (row + 0.5) * r.texel
      const k = row * r.size + col
      const id = r.ids[k * 2]! + 256 * r.ids[k * 2 + 1]!
      const t = truth(cx, cz)
      if (t < 29.9) {
        expect(id, `${cx},${cz}`).toBeGreaterThan(0)
        expect(segAt(id).d(cx, cz)).toBeCloseTo(t, 3)
        near++
      } else if (t > 30.1) {
        expect(id, `${cx},${cz}`).toBe(0)
      }
    }
    expect(near).toBeGreaterThan(100)
  })

  it('每一段記的半寬就是它那條路的標稱半寬', () => {
    const r = bakeRoadSegments()
    let id = 1
    for (const road of LEYTE_ROADS) {
      for (let i = 1; i < road.points.length; i++, id++) {
        expect(r.segments[(r.segmentCount + id) * 4]).toBe(road.halfWidth)
      }
    }
    expect(id).toBe(r.segmentCount)
  })

  it('支線也畫在地上：每條支線的中線上覆蓋率是 1', () => {
    for (const road of LEYTE_ROADS.slice(1)) {
      const p = road.points[Math.floor(road.points.length / 2)]!
      expect(roadCoverageAt(p.x, p.z)).toBe(1)
    }
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
    const out: FloraBuffer = createFloraBuffer(cap)
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

  it('支線兩旁也不長樹，清空帶跟著路寬走', () => {
    const src = createLeyteFlora(field)
    for (const road of LEYTE_ROADS.slice(1)) {
      const p = road.points[Math.floor(road.points.length / 2)]!
      const out = createFloraBuffer(20000)
      src(p.x - 200, p.z - 200, p.x + 200, p.z + 200, (x, z) => field.sample(x, z), out)
      const clear = roadTreeClear(road)
      for (let i = 0; i < out.count; i++) {
        const x = out.data[i * FLORA_STRIDE]!
        const z = out.data[i * FLORA_STRIDE + 2]!
        for (let k = 1; k < road.points.length; k++) {
          const a = road.points[k - 1]!
          const b = road.points[k]!
          const abx = b.x - a.x
          const abz = b.z - a.z
          const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
          expect(Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))).toBeGreaterThanOrEqual(clear)
        }
      }
      // 【路最寬處也在清空帶內】起伏的上限是 1.45 倍
      expect(road.halfWidth * 1.45).toBeLessThan(clear)
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

  it('場外遠景：稜上的林子比谷地密，沙灘沒有林子', () => {
    const z = FIELD_HALF + 5000
    let hi = { x: 0, u: -1 }
    let lo = { x: 0, u: 2 }
    for (let x = -20000; x <= 20000; x += 100) {
      const u = farUpland(x, z)
      if (u > hi.u) hi = { x, u }
      if (u < lo.u) lo = { x, u }
    }
    expect(hi.u - lo.u).toBeGreaterThan(0.5)
    const h = PLAIN_HEIGHT
    expect(leyteFarCover(hi.x, z, h)).toBeGreaterThan(leyteFarCover(lo.x, z, h) * 2)
    expect(leyteFarCover(hi.x, z, SAND_TOP - 0.1)).toBe(0)
  })

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

/** 灘頭佈景裡的車用地面單位的 GLB 樣板 —— 瀏覽器開場載，這裡直接讀 `public/` */
async function readPublic(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync(`public${url}`)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

describe('灘頭的佈景', () => {
  beforeAll(() => preloadGroundModels(readPublic))

  it('木箱與車都站在地上 —— 每一個頂點都不低於腳下的地面 10 cm 以上', () => {
    const g = buildLeyteBeach((x, z) => field.sample(x, z))
    const pos = g.getAttribute('position')
    let below = 0
    for (let i = 0; i < pos.count; i += 7) {
      if (pos.getY(i) < field.sample(pos.getX(i), pos.getZ(i)) - 0.6) below++
    }
    // 【容差 0.6 m】車與木箱堆只在中心取一次高度，沙灘的坡在幾公尺內差不到這麼多
    expect(below).toBe(0)
    g.dispose()
  })

  it('一顆網格、三角形數在預算內', () => {
    const g = buildLeyteBeach((x, z) => field.sample(x, z))
    const tris = g.getAttribute('position').count / 3
    // 【上限是防爆量，不是畫質】一顆網格一個 draw call，25 萬面約 27 MB 頂點緩衝。
    // 擺位的迴圈寫錯（例如重試次數沒擋住）時面數會暴增到這條擋得住的量級
    expect(tris).toBeGreaterThan(20_000)
    expect(tris).toBeLessThan(250_000)
    g.dispose()
  })
})

describe('createTerrain("leyte")', () => {
  beforeAll(() => preloadGroundModels(readPublic))

  it('海面在岸線外、陸地在平地上；避障清單是丘陵', () => {
    const t = createTerrain('leyte')
    expect(t.collisionHeightAt(0, -8000)).toBe(0)
    expect(t.collisionHeightAt(0, 2000)).toBeGreaterThanOrEqual(PLAIN_HEIGHT - 1e-6)
    expect(t.waterAt(0, 2000)).toBe(-Infinity)
    expect(t.islands.length).toBeGreaterThan(0)
    t.dispose()
  })
})
