import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  Box3, BufferAttribute, BufferGeometry, Color, Group, Matrix3, Mesh as ThreeMesh, Vector3,
  type Mesh, type Object3D,
} from 'three'
import {
  BUILDING_DEPTH, BUILDING_ROOF, BUILDING_WALL, BUILDING_WIDTH, buildingGeometry,
  createFloraGeometries, disposeFloraGeometries, pointColorOf, POINT_POOLS, POINT_SIZE,
  POINT_Y, ROOF, WALL, type MeshPool, type PointPool,
} from '../../src/render/floraShapes'
import { BROAD_CROWN_R, BUSH_R, CONE_CROWN_R, TREE_HEIGHT } from '../../src/specs/flora'
import { HEDGE_BUSH_SPACING } from '../../src/render/flora'
import { bakeFloraScene, FLORA_MODEL_URLS, preloadFloraModels } from '../../src/render/floraModels'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { FLORA_COLORS, SEASONS } from '../../src/render/season'
import { createVegetation } from '../../src/render/vegetation'

async function readPublic(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync(`public${url}`)
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

/**
 * 【模組頂層建，GLB 還沒載入】這一份是退路的程序幾何。下面「近距離模型」那一組
 * 在 `beforeAll` 裡預載之後另建一份。
 */
const geo = createFloraGeometries()
const names = Object.keys(geo) as MeshPool[]

/** 六個喬木幾何 —— 兩個樹種各三級。遠處那一級是點，沒有幾何 */
const TREES = ['broadHigh', 'broadNear', 'broadMid', 'coneHigh', 'coneNear', 'coneMid'] as const

/** 用 GLB 的那六個池 */
const MODEL_POOLS = ['broadHigh', 'broadNear', 'coneHigh', 'coneNear', 'bushHigh', 'bushNear'] as const

/**
 * 每一個點池取代的是哪一級。**點的大小、高度、顏色都拿它當參照** ——
 * 過門檻時被遮住的地、樹冠的高度、顏色三件事都必須連續。
 */
const REPLACES: Record<PointPool, MeshPool> = {
  broadPoint: 'broadMid', conePoint: 'coneMid', bushPoint: 'bushMid',
}

/**
 * 一堆二維點的凸包面積。**側影要用它，不能用包圍盒** —— 八面體與錐的角落
 * 是空的，包圍盒會高估。
 */
function hullArea(pts: readonly [number, number][]): number {
  const p = [...pts].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]))
  const cross = (o: [number, number], a: [number, number], b: [number, number]): number =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const half = (src: readonly [number, number][]): [number, number][] => {
    const out: [number, number][] = []
    for (const q of src) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop()
      out.push(q)
    }
    out.pop()
    return out
  }
  const hull = [...half(p), ...half([...p].reverse())]
  let a = 0
  for (let i = 0; i < hull.length; i++) {
    const u = hull[i]!
    const v = hull[(i + 1) % hull.length]!
    a += u[0] * v[1] - v[0] * u[1]
  }
  return Math.abs(a) / 2
}

/** 三角形數。池幾何有索引，`buildingGeometry` 沒有 */
function tris(g: BufferGeometry): number {
  const idx = g.getIndex()
  return (idx !== null ? idx.count : g.getAttribute('position').count) / 3
}

function bounds(g: BufferGeometry): Box3 {
  return new Box3().setFromBufferAttribute(
    g.getAttribute('position') as never,
  )
}

/** 幾何裡出現過的顏色，十六進位字串 */
function colours(g: BufferGeometry): Set<string> {
  const a = g.getAttribute('color')
  const out = new Set<string>()
  for (let i = 0; i < a.count; i++) {
    out.add([a.getX(i), a.getY(i), a.getZ(i)].map((v) => v.toFixed(4)).join(','))
  }
  return out
}

/**
 * 樹冠的上下界與外接半徑。近級要把樹幹的頂點排除掉，所以用顏色篩。
 *
 * 【半徑不能用包圍盒的寬】七邊錐與六邊錐的外接半徑一樣，但頂點落在不同
 * 的角度上，包圍盒因此不同（13.31 對 14）—— 那是取樣的差別，不是樹冠
 * 大小的差別。
 */
function crownSpan(g: BufferGeometry): { y0: number; y1: number; r: number } {
  const p = g.getAttribute('position')
  const c = g.getAttribute('color')
  const want = crownColour(g)
  let y0 = Infinity
  let y1 = -Infinity
  let r = 0
  for (let i = 0; i < p.count; i++) {
    const hit = [c.getX(i), c.getY(i), c.getZ(i)].map((n) => n.toFixed(4)).join(',')
    if (hit !== want) continue
    const y = p.getY(i)
    if (y < y0) y0 = y
    if (y > y1) y1 = y
    r = Math.max(r, Math.hypot(p.getX(i), p.getZ(i)))
  }
  return { y0, y1, r }
}

/** 樹冠色。樹幹先建，所以最後一個頂點一定是樹冠 */
function crownColour(g: BufferGeometry): string {
  const a = g.getAttribute('color')
  const i = a.count - 1
  return [a.getX(i), a.getY(i), a.getZ(i)].map((v) => v.toFixed(4)).join(',')
}

describe('植被與建築的幾何', () => {
  /**
   * 【精確比對，不是上限】三角形數是效能預算的分母。
   * `OctahedronGeometry(detail = 1)` 是 32 個三角形而不是 8 —— 那種
   * 四倍的誤差要在幾何定稿的當下就抓到，不是在幀時間掉下來之後。
   */
  it('每個幾何的三角形數（GLB 未載入：近距離兩級退回程序幾何）', () => {
    const want: Record<MeshPool, number> = {
      broadHigh: 20, broadNear: 20, broadMid: 8,
      coneHigh: 19, coneNear: 19, coneMid: 6,
      bushHigh: 8, bushNear: 8, bushMid: 8,
      house: 18, barn: 18, church: 34, houseSlate: 18, barnTar: 18,
    }
    const got: Record<string, number> = {}
    for (const n of names) got[n] = tris(geo[n])
    console.log(JSON.stringify(got))
    for (const n of names) expect([n, tris(geo[n])]).toEqual([n, want[n]])
  })

  /** 【遠處那三個池沒有幾何】它們是 `gl.POINTS`，一株一個頂點 */
  it('十四個幾何，名字與有網格的那十四個池一一對應', () => {
    expect(names.slice().sort()).toEqual([
      'barn', 'barnTar', 'broadHigh', 'broadMid', 'broadNear', 'bushHigh', 'bushMid', 'bushNear',
      'church', 'coneHigh', 'coneMid', 'coneNear', 'house', 'houseSlate',
    ])
    expect(POINT_POOLS.every((n) => !names.includes(n as MeshPool))).toBe(true)
  })

  /**
   * 【落地的那些，底面必須在 y = 0】實例的 `y` 直接放地面高度。
   *
   * 【喬木的中級不落地，那是故意的】它只有樹冠，而樹冠本來就長在樹幹
   * 頂上 —— 見「換級不換樹冠位置」。
   */
  it('會落地的幾何底面都在 y = 0', () => {
    for (const n of names) {
      if (n === 'broadMid' || n === 'coneMid') continue
      expect([n, bounds(geo[n]).min.y]).toEqual([n, 0])
    }
  })

  /**
   * 【換級不換樹冠位置】試飛回報過的缺陷：中級把樹冠拉到地面
   * （`octa(…, H/2, H/2)`），所以過 900 m 的門檻時樹冠往下掉一截又變胖 ——
   * 比少一根樹幹明顯得多。
   *
   * 【判準是樹冠自己的包圍盒】近級的整體底面在 0（那是樹幹），所以不能比
   * 整個幾何 —— 要把樹冠色的頂點挑出來單獨量。
   */
  it('換級不換樹冠位置：三級的樹冠包圍盒逐項相同', () => {
    for (const sp of [
      ['broadHigh', 'broadNear', 'broadMid'],
      ['coneHigh', 'coneNear', 'coneMid'],
    ] as const) {
      const want = crownSpan(geo[sp[0]])
      for (const n of sp) {
        const got = crownSpan(geo[n])
        expect([n, got.y0, got.y1]).toEqual([n, want.y0, want.y1])
        expect([n, Math.abs(got.r - want.r) < 1e-4]).toEqual([n, true])
      }
    }
  })

  /** 【每一級都一樣高】換級不得讓樹忽然長高或縮矮 */
  it('六個喬木幾何一樣高', () => {
    for (const n of TREES) {
      expect([n, bounds(geo[n]).max.y]).toEqual([n, TREE_HEIGHT])
    }
  })

  /**
   * 【換級不換剪影】900 m 的門檻上只該掉樹幹與幾個面。闊葉遠近都是圓的，
   * 針葉遠近都是尖的 —— 判準是寬高比。
   *
   * 這一條正面擋住「L1 之後不分樹種」那個缺陷：把 `coneFar` 換成八面體
   * 就會紅。
   */
  it('換級不換剪影：闊葉三級都圓，針葉三級都尖', () => {
    const ratio = (n: MeshPool): number => {
      const b = bounds(geo[n])
      return (b.max.x - b.min.x) / b.max.y
    }
    for (const n of ['broadHigh', 'broadNear', 'broadMid'] as const) {
      expect([n, ratio(n) > 0.6]).toEqual([n, true])
    }
    for (const n of ['coneHigh', 'coneNear', 'coneMid'] as const) {
      expect([n, ratio(n) < 0.6]).toEqual([n, true])
    }
  })

  /**
   * 【換級不換樹種】遠級與近級的樹冠必須同色，而兩個樹種必須不同色。
   * 顏色與剪影是兩件事，兩條都要有 —— 同色但形狀變了、或形狀對了但
   * 顏色跳掉，看起來都是「那棵樹換了種」。
   */
  it('換級不換樹種：三級同色，兩樹種不同色', () => {
    expect(crownColour(geo.broadMid)).toBe(crownColour(geo.broadNear))
    expect(crownColour(geo.broadHigh)).toBe(crownColour(geo.broadNear))
    expect(crownColour(geo.coneMid)).toBe(crownColour(geo.coneNear))
    expect(crownColour(geo.coneHigh)).toBe(crownColour(geo.coneNear))
    expect(crownColour(geo.bushHigh)).toBe(crownColour(geo.bushMid))
    expect(crownColour(geo.bushNear)).toBe(crownColour(geo.bushMid))
    expect(crownColour(geo.broadMid)).not.toBe(crownColour(geo.coneMid))
  })

  /**
   * 【灌木要比間距寬】相鄰兩叢交疊才成一條連續的堤，而那條堤就是 bocage 的
   * 本體 —— 喬木只是每隔十幾公尺插上去的一根。
   */
  it('灌木比喬木矮一截，但比它的間距寬', () => {
    for (const n of ['bushHigh', 'bushNear', 'bushMid'] as const) {
      const b = bounds(geo[n])
      expect(b.max.y).toBeLessThan(TREE_HEIGHT / 3)
      expect(b.max.y).toBeGreaterThan(2)
      expect(b.max.x - b.min.x).toBeGreaterThan(HEDGE_BUSH_SPACING)
    }
  })

  it('教堂的尖塔比任何一棟房子都高', () => {
    expect(bounds(geo.church).max.y).toBeGreaterThan(bounds(geo.house).max.y * 2)
    expect(bounds(geo.church).max.y).toBeGreaterThan(bounds(geo.barn).max.y * 2)
  })

  /**
   * 【建築只有一種形狀】房子、穀倉、倉庫的大小與樓高由實例各軸縮放決定；四個池
   * 只差顏色。形狀分家的話，佈置那一側算的牆外框（`BUILDING_WIDTH` 等）就對不上
   * 畫出來的東西 —— 建築會互相穿插而護欄抓不到
   */
  it('四種建築是同一個形狀，尺寸就是 BUILDING_* 那幾個常數', () => {
    const pos = Array.from(geo.house.getAttribute('position').array)
    for (const n of ['houseSlate', 'barn', 'barnTar'] as const) {
      expect([n, Array.from(geo[n].getAttribute('position').array)]).toEqual([n, pos])
    }
    const b = bounds(geo.house)
    // 牆的外框：屋頂四邊各出簷半公尺，所以外接盒比牆各大 1 m
    expect(b.max.x - b.min.x).toBeCloseTo(BUILDING_WIDTH + 1, 6)
    expect(b.max.z - b.min.z).toBeCloseTo(BUILDING_DEPTH + 1, 6)
    expect(b.max.y).toBeCloseTo(BUILDING_WALL + BUILDING_ROOF, 6)
  })

  /** 【樹幹與樹冠必須是兩個顏色】材質沒開 vertexColors 的話這一條仍然綠 */
  it('近距離兩級的喬木都有樹幹色與樹冠色', () => {
    for (const n of ['broadHigh', 'broadNear', 'coneHigh', 'coneNear'] as const) {
      expect(colours(geo[n]).size).toBe(2)
    }
    // 中級沒有樹幹，只有一個顏色
    for (const n of ['broadMid', 'coneMid'] as const) {
      expect([n, colours(geo[n]).size]).toEqual([n, 1])
    }
  })

  it('房子的牆與屋頂是兩個顏色，教堂三個', () => {
    for (const n of ['house', 'houseSlate', 'barn', 'barnTar'] as const) {
      expect([n, colours(geo[n]).size]).toEqual([n, 2])
    }
    // 本堂牆、屋頂、尖頂
    expect(colours(geo.church).size).toBe(3)
  })

  /**
   * 【同一種牆的兩種屋頂只差屋頂】灰泥牆配新瓦或石板、磚木牆配老瓦或油毛氈。
   * 牆跟著變的話，一個鎮裡會有一成多的房子是灰牆。
   */
  it('同一種牆的兩種屋頂只有屋頂的顏色不同', () => {
    for (const [a, b] of [['house', 'houseSlate'], ['barn', 'barnTar']] as const) {
      const ca = geo[a].getAttribute('color')
      const cb = geo[b].getAttribute('color')
      expect(Array.from(geo[a].getAttribute('position').array)).toEqual(Array.from(geo[b].getAttribute('position').array))
      let differ = 0
      for (let i = 0; i < ca.count; i++) {
        if (ca.getX(i) !== cb.getX(i) || ca.getY(i) !== cb.getY(i) || ca.getZ(i) !== cb.getZ(i)) differ++
      }
      // 人字屋頂共用之後是 6 個頂點（屋簷四角、屋脊兩端）；牆的頂點一個都不能不同
      expect([a, differ]).toEqual([a, 6])
    }
  })

  /**
   * 【屋頂是風化的老瓦】新瓦的鮮磚紅（0xa8503a，紅是綠的 2.1 倍），從空中看整個
   * 鎮是一片亮紅。**比的是 sRGB** —— 頂點色存的是線性值，直接相除會把比例放大
   * 兩倍多。
   */
  it('黏土瓦的屋頂不是鮮紅：sRGB 下紅不過綠的 1.85 倍', () => {
    const col = geo.house.getAttribute('color')
    const c = new Color()
    let ratio = 0
    for (let i = 0; i < col.count; i++) {
      const hex = c.setRGB(col.getX(i), col.getY(i), col.getZ(i)).getHex()
      const r = (hex >> 16) & 0xff
      const g = (hex >> 8) & 0xff
      if (r > g * 1.2) ratio = r / g
    }
    expect(ratio).toBeGreaterThan(1.2)
    expect(ratio).toBeLessThan(1.85)
  })

  it('近距離兩級喬木最低的那些頂點是樹幹色', () => {
    for (const n of ['broadHigh', 'broadNear', 'coneHigh', 'coneNear'] as const) {
      const g = geo[n]
      const p = g.getAttribute('position')
      const c = g.getAttribute('color')
      const low = new Set<string>()
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0.01) continue
        low.add([c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(4)).join(','))
      }
      expect(low.size).toBe(1)
      // 樹幹是棕的：紅 > 綠 > 藍
      const [r, gg, b] = [...low][0]!.split(',').map(Number) as [number, number, number]
      expect(r).toBeGreaterThan(gg)
      expect(gg).toBeGreaterThan(b)
    }
  })

  it('每個幾何都有法線與包圍球', () => {
    for (const n of names) {
      expect(geo[n].getAttribute('normal')).toBeDefined()
      expect(geo[n].boundingSphere).not.toBeNull()
    }
  })

  /**
   * 【每一面都要朝外】材質是 `FrontSide`，背面剔除開著。繞反的話近的那一面
   * 被剔掉、留下遠側的內面，法線朝著鏡頭 —— 太陽打出來的體積感沒了，
   * 深度也比實際位置遠一個樹冠。
   *
   * 【判準】這八個形狀都對軸上某一點是星形的（由該點看得到每一個面），
   * 所以 `面法線 · (面心 − 該點) > 0` 就是朝外。**包圍盒中心不行** ——
   * 教堂是本堂加高塔，非凸，中心會落在塔身外面而誤判本堂的屋頂。
   */
  /**
   * 【要挑在形狀**內部**，不能挑在頂點上】舊的 `broadNear: 5` 正好是樹冠
   * 八面體的下頂點，那四個下半面的內積因此是 0 —— 它一直是靠浮點誤差
   * 擦邊過的。挑在樹冠裡面就有餘裕。
   */
  const STAR_Y: Record<string, number> = {
    broadHigh: 20, broadNear: 20, broadMid: 20, coneHigh: 12, coneNear: 12, coneMid: 12,
    bushHigh: 4, bushNear: 4, bushMid: 4, house: 2.5, barn: 3, church: 3, houseSlate: 2.5, barnTar: 3,
  }

  it('每一個面的法線都朝外', () => {
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    const n = new Vector3()
    const cb = new Vector3()
    const ab = new Vector3()
    const mid = new Vector3()
    const p = new Vector3()
    for (const name of names) {
      const pos = geo[name].getAttribute('position')
      const idx = geo[name].getIndex()!
      p.set(0, STAR_Y[name]!, 0)
      const inward: number[] = []
      for (let f = 0; f < idx.count / 3; f++) {
        a.fromBufferAttribute(pos, idx.getX(f * 3))
        b.fromBufferAttribute(pos, idx.getX(f * 3 + 1))
        c.fromBufferAttribute(pos, idx.getX(f * 3 + 2))
        // three 的 computeVertexNormals 用 (C − B) × (A − B)
        n.crossVectors(cb.subVectors(c, b), ab.subVectors(a, b))
        mid.addVectors(a, b).add(c).multiplyScalar(1 / 3).sub(p)
        if (n.dot(mid) <= 0) inward.push(f)
      }
      expect([name, inward]).toEqual([name, []])
    }
  })

  /**
   * 【共用頂點，逐池精確比對】一個池同時畫幾千到幾萬份，頂點數是逐實例的頂點運算。
   * 八面體 6、六邊錐 7（底 6 ＋ 尖 1）、房子 14（牆 8 ＋ 屋頂 6）、教堂 27
   * （本堂 8 ＋ 屋頂 6 ＋ 塔 8 ＋ 四邊尖頂 5）；近距離的退路是 6 或 7 邊樹幹的上下
   * 兩圈 12 加樹冠。不共用的話每個都是三角形數的三倍
   */
  it('有索引、頂點共用：逐池的頂點數', () => {
    const want: Record<MeshPool, number> = {
      broadHigh: 18, broadNear: 18, broadMid: 6,
      coneHigh: 20, coneNear: 20, coneMid: 7,
      bushHigh: 6, bushNear: 6, bushMid: 6,
      house: 14, barn: 14, church: 27, houseSlate: 14, barnTar: 14,
    }
    for (const n of names) {
      expect([n, geo[n].getIndex() !== null]).toEqual([n, true])
      expect([n, geo[n].getAttribute('position').count]).toEqual([n, want[n]])
    }
  })

  /** 【建築的樣板不共用頂點】`buildDepot` 收的零件要非索引 */
  it('buildingGeometry 沒有索引', () => {
    const g = buildingGeometry(WALL, ROOF)
    expect(g.getIndex()).toBeNull()
    expect(g.getAttribute('position').count).toBe(18 * 3)
    g.dispose()
  })

  it('disposeFloraGeometries 把每一個都釋放掉', () => {
    const g = createFloraGeometries()
    const seen: string[] = []
    for (const n of Object.keys(g) as MeshPool[]) {
      g[n].addEventListener('dispose', () => seen.push(n))
    }
    disposeFloraGeometries(g)
    expect(seen.sort()).toEqual(names.slice().sort())
  })

  /**
   * 【為什麼是面積不是寬度】點是螢幕對齊的實心方塊，而它取代的那一級是
   * 八面體或錐。同寬的話方塊的面積是兩倍，3 km 那條門檻上林相會突然變厚
   * —— 而那正是這一版要消滅的感受。解同一個面積，過門檻時被遮住的地才是
   * 連續的。
   *
   * 【側影用凸包算】八面體與錐都是凸的，所以把頂點投影到 xy 平面再取凸包
   * 就是它的側影。用包圍盒會高估（角落是空的）。
   */
  it('點的面積等於它取代的那一級的側影', () => {
    for (const name of POINT_POOLS) {
      const g = geo[REPLACES[name as PointPool]]
      const pos = g.getAttribute('position')
      const pts: [number, number][] = []
      for (let i = 0; i < pos.count; i++) pts.push([pos.getX(i), pos.getY(i)])
      const area = hullArea(pts)
      const s = POINT_SIZE[name as PointPool]!
      console.log(JSON.stringify({
        池: name, 取代: REPLACES[name as PointPool], 側影面積: area.toFixed(2),
        點邊長: s.toFixed(3), 點面積: (s * s).toFixed(2),
      }))
      expect([name, Math.abs(s * s - area) < 0.05]).toEqual([name, true])
    }
  })

  /**
   * 【點的中心要對上樹冠的中心】株的座標在地面上，而點是以自己為中心畫的
   * 方塊 —— 對不上的話過門檻時整片林相會上下跳一截。
   */
  it('點的高度等於它取代的那一級的樹冠中心', () => {
    for (const name of POINT_POOLS) {
      const sp = crownSpan(geo[REPLACES[name as PointPool]])
      const want = (sp.y0 + sp.y1) / 2
      expect([name, POINT_Y[name as PointPool]]).toEqual([name, want])
    }
  })

  /** 【點的顏色要對上樹冠的顏色】換級不得換樹種 */
  it('點的顏色等於它取代的那一級的樹冠色', () => {
    for (const name of POINT_POOLS) {
      const want = crownColour(geo[REPLACES[name as PointPool]])
      const c = new Color(pointColorOf(name as PointPool, 'summer'))
      const got = [c.r, c.g, c.b].map((v) => v.toFixed(4)).join(',')
      expect([name, got]).toEqual([name, want])
    }
  })
})

describe('近距離模型（GLB 已載入）', () => {
  let m: Record<MeshPool, BufferGeometry>
  beforeAll(async () => {
    await preloadFloraModels(readPublic)
    m = createFloraGeometries()
  })

  /**
   * 【這一條證明池真的用了 GLB】退路的程序幾何外框一樣、法線一樣朝外，
   * 其餘每一條換成程序幾何都會綠 —— 只有面數分得出來。
   */
  it('六個池的三角形數就是模型的面數；其餘池不變', () => {
    const want: Record<(typeof MODEL_POOLS)[number], number> = {
      broadHigh: 340, broadNear: 136, coneHigh: 68, coneNear: 50, bushHigh: 192, bushNear: 58,
    }
    for (const n of MODEL_POOLS) expect([n, tris(m[n])]).toEqual([n, want[n]])
    for (const n of names) {
      if ((MODEL_POOLS as readonly string[]).includes(n)) continue
      expect([n, tris(m[n])]).toEqual([n, tris(geo[n])])
    }
  })

  /**
   * 【外框對齊遠一級】樹頂、樹冠半徑與程序幾何相同，過 900 m 與 1,200 m 的門檻
   * 時樹不會長高縮矮、樹冠不會變胖。點池的邊長也拿同一組常數算。
   */
  it('樹頂與樹冠半徑等於外框常數，底面在 y = 0', () => {
    const want: Record<(typeof MODEL_POOLS)[number], [number, number]> = {
      broadHigh: [TREE_HEIGHT, BROAD_CROWN_R], broadNear: [TREE_HEIGHT, BROAD_CROWN_R],
      coneHigh: [TREE_HEIGHT, CONE_CROWN_R], coneNear: [TREE_HEIGHT, CONE_CROWN_R],
      bushHigh: [bounds(geo.bushMid).max.y, BUSH_R], bushNear: [bounds(geo.bushMid).max.y, BUSH_R],
    }
    for (const n of MODEL_POOLS) {
      const b = bounds(m[n])
      expect([n, b.max.y]).toEqual([n, expect.closeTo(want[n][0], 4)])
      expect([n, b.min.y]).toEqual([n, expect.closeTo(0, 6)])
      expect([n, crownSpan(m[n]).r]).toEqual([n, expect.closeTo(want[n][1], 3)])
    }
  })

  /** 【高模換中模只換面數】枝與葉團同位置同大小，樹冠的上下緣差不到半公尺 */
  it('高模與中模的樹冠同一個位置', () => {
    for (const [hi, mid] of [['broadHigh', 'broadNear'], ['coneHigh', 'coneNear'], ['bushHigh', 'bushNear']] as const) {
      const a = crownSpan(m[hi])
      const b = crownSpan(m[mid])
      expect([hi, Math.abs(a.y0 - b.y0) < 0.5, Math.abs(a.y1 - b.y1) < 0.5]).toEqual([hi, true, true])
    }
  })

  it('喬木兩色、最低處是樹幹色；灌木一色；樹冠色跟著季節換', () => {
    /** 貼地那幾個頂點的顏色 */
    const lowColours = (g: BufferGeometry): Set<string> => {
      const p = g.getAttribute('position')
      const c = g.getAttribute('color')
      const out = new Set<string>()
      for (let i = 0; i < p.count; i++) {
        if (p.getY(i) > 0.01) continue
        out.add([c.getX(i), c.getY(i), c.getZ(i)].map((v) => v.toFixed(4)).join(','))
      }
      return out
    }
    // 程序幾何的樹幹色就是 `TRUNK`
    const trunk = [...lowColours(geo.broadNear)]
    for (const n of ['broadHigh', 'broadNear', 'coneHigh', 'coneNear'] as const) {
      expect([n, colours(m[n]).size]).toEqual([n, 2])
      expect([n, [...lowColours(m[n])]]).toEqual([n, trunk])
    }
    for (const n of ['bushHigh', 'bushNear'] as const) expect([n, colours(m[n]).size]).toEqual([n, 1])
    const hex = (x: number): string => {
      const c = new Color(x)
      return [c.r, c.g, c.b].map((v) => v.toFixed(4)).join(',')
    }
    for (const s of SEASONS) {
      const g = createFloraGeometries(s)
      const want: Record<(typeof MODEL_POOLS)[number], number> = {
        broadHigh: FLORA_COLORS[s].broadLeaf, broadNear: FLORA_COLORS[s].broadLeaf,
        coneHigh: FLORA_COLORS[s].conifer, coneNear: FLORA_COLORS[s].conifer,
        bushHigh: FLORA_COLORS[s].bushLeaf, bushNear: FLORA_COLORS[s].bushLeaf,
      }
      for (const n of MODEL_POOLS) {
        // 樹冠只有一個色，而且就是這一季的；喬木的樹幹色不跟著季節換
        const set = colours(g[n])
        expect([s, n, set.has(hex(want[n]))]).toEqual([s, n, true])
        const other = [...set].filter((c) => c !== hex(want[n]))
        expect([s, n, other]).toEqual([s, n, n.startsWith('bush') ? [] : trunk])
      }
      disposeFloraGeometries(g)
    }
  })

  /** 【兩個節點共用一份沒有索引的幾何】各自的變換只套在各自的複本上 */
  it('共用幾何的節點各自套自己的變換', () => {
    const shared = new BufferGeometry()
    shared.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3))
    const scene = new Group()
    for (const [x, part] of [[10, 'trunk'], [20, 'crown']] as const) {
      const mesh = new ThreeMesh(shared)
      mesh.position.x = x
      mesh.userData['part'] = part
      scene.add(mesh)
    }
    const baked = bakeFloraScene(scene, 'test')
    expect(baked.crownFrom).toBe(3)
    expect([baked.position[0], baked.position[9]]).toEqual([10, 20])
    expect(Array.from(shared.getAttribute('position').array)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
  })

  /**
   * 【共用頂點】頂點運算是這幾池的主要成本。一個頂點平均被三個以上的三角形共用
   * 才算真的併到了 —— 葉團的球面約五到六個，枝幹的管子約三個。
   */
  it('有索引、頂點真的共用，有法線與包圍球', () => {
    for (const n of MODEL_POOLS) {
      expect(m[n].getIndex()).not.toBeNull()
      const verts = m[n].getAttribute('position').count
      expect([n, tris(m[n]) * 3 / verts > 3]).toEqual([n, true])
      expect(m[n].getAttribute('normal')).toBeDefined()
      expect(m[n].boundingSphere).not.toBeNull()
    }
  })

  /** 【材質一定要是 flatShading】共用頂點之後面還是硬的，靠的是它 */
  it('植被的網格材質開了 flatShading', () => {
    const v = createVegetation([], () => 0)
    const mats = new Set<unknown>()
    v.object.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.isMesh) mats.add(mesh.material)
    })
    expect(mats.size).toBeGreaterThan(0)
    for (const mat of mats) expect((mat as { flatShading: boolean }).flatShading).toBe(true)
    v.dispose()
  })

  /**
   * 【池幾何的每一面朝外】枝與葉團不是對某一點的星形，上面那條「由軸上一點看
   * 每一面」的判準不適用。改拿 GLB 自帶的頂點法線當答案：照解析的次序（樹幹在前、
   * 樹冠在後）排好，逐面與**池幾何**算出來的面法線比 —— 解析、變換、次序、繞序
   * 任一處錯，都有面會反過來。
   */
  it('池幾何的每一面與 GLB 自帶的法線同向', async () => {
    const pool: Record<string, Record<'high' | 'mid', MeshPool>> = {
      broad: { high: 'broadHigh', mid: 'broadNear' },
      cone: { high: 'coneHigh', mid: 'coneNear' },
      bush: { high: 'bushHigh', mid: 'bushNear' },
    }
    const nv = new Vector3()
    const nf = new Vector3()
    for (const sp of Object.keys(FLORA_MODEL_URLS) as (keyof typeof FLORA_MODEL_URLS)[]) {
      for (const lv of ['high', 'mid'] as const) {
        const url = FLORA_MODEL_URLS[sp][lv]
        const scene = await new Promise<Object3D>((res, rej) => {
          createGltfLoader().parse(readFileSync(`public${url}`).buffer as ArrayBuffer, '', (g) => res(g.scene), rej)
        })
        scene.updateMatrixWorld(true)
        const byPart: Record<'trunk' | 'crown', Vector3[]> = { trunk: [], crown: [] }
        scene.traverse((o) => {
          const mesh = o as Mesh
          if (!mesh.isMesh) return
          const nor = mesh.geometry.toNonIndexed().getAttribute('normal')
          const nm = new Matrix3().getNormalMatrix(mesh.matrixWorld)
          const part = mesh.userData['part'] as 'trunk' | 'crown'
          for (let i = 0; i < nor.count; i++) byPart[part].push(new Vector3().fromBufferAttribute(nor, i).applyMatrix3(nm))
        })
        const want = [...byPart.trunk, ...byPart.crown]
        const g = m[pool[sp]![lv]]
        const pos = g.getAttribute('position')
        const idx = g.getIndex()!
        expect([url, idx.count]).toEqual([url, want.length])
        const a = new Vector3()
        const b = new Vector3()
        const c = new Vector3()
        const flipped: number[] = []
        for (let f = 0; f < idx.count / 3; f++) {
          a.fromBufferAttribute(pos, idx.getX(f * 3))
          b.fromBufferAttribute(pos, idx.getX(f * 3 + 1))
          c.fromBufferAttribute(pos, idx.getX(f * 3 + 2))
          // three 的面法線 (C − B) × (A − B)；flatShading 在螢幕空間算的是同一個方向
          nf.crossVectors(c.sub(b), a.sub(b))
          nv.copy(want[f * 3]!)
          if (nf.dot(nv) <= 0) flipped.push(f)
        }
        expect([url, flipped]).toEqual([url, []])
      }
    }
  })
})
