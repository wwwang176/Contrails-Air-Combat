import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  Box3, BufferGeometry, Color, Float32BufferAttribute, Texture,
  type Group, type Material, type Mesh, type MeshStandardMaterial, type Object3D,
} from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import {
  SHIP_LIVERY_HEIGHT, SHIP_LIVERY_WIDTH, applyShipLiveryUv, partTones, shipLiveryRects,
  shipPartKind, shipParts,
  type ShipLiveryLayout, type ShipPartKind, type ShipRect, type ShipStrip,
} from '../../src/render/shipLivery'
import { SHIP_LIVERIES, applyShipLivery } from '../../src/render/ships'

/**
 * # 船的塗裝 UV
 *
 * 守的是「每一個面投到對的那一條、方向對」。畫得好不好看由截圖裁定。
 */

/** 一艘 100 m 長、艦首在 −Z 的假船 */
const L: ShipLiveryLayout = {
  url: '', scale: 10, zMin: -50, zMax: 50, yMin: -2, yMax: 10, halfBeam: 5,
}

/** 單一個三角形（逆時針為正面）的幾何 */
function tri(a: number[], b: number[], c: number[]): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([...a, ...b, ...c], 3))
  return g
}

/** 三個頂點的像素座標 */
function px(g: BufferGeometry): number[][] {
  const uv = g.getAttribute('uv')
  return [0, 1, 2].map((i) => [uv.getX(i) * SHIP_LIVERY_WIDTH, uv.getY(i) * SHIP_LIVERY_HEIGHT])
}

function inside(p: number[], strip: ShipStrip, layout = L): boolean {
  const r = shipLiveryRects(layout)[strip]
  return p[0]! >= r.x - 1e-6 && p[0]! <= r.x + r.w + 1e-6
    && p[1]! >= r.y - 1e-6 && p[1]! <= r.y + r.h + 1e-6
}

// 右舷立面（法線 +X）：z 由 10 到 −10、y 由 0 到 4
const STBD = tri([5, 0, 10], [5, 0, -10], [5, 4, 0])
// 左舷立面（法線 −X）
const PORT = tri([-5, 0, -10], [-5, 0, 10], [-5, 4, 0])
// 朝上的面（法線 +Y）
const UP = tri([0, 6, 0], [1, 6, 1], [1, 6, -1])

describe('船的塗裝 UV', () => {
  it('左舷立面 → 左舷條，右舷立面 → 右舷條', () => {
    const p = PORT.clone(); applyShipLiveryUv(p, 'body', L)
    const s = STBD.clone(); applyShipLiveryUv(s, 'body', L)
    for (const q of px(p)) expect(inside(q, 'port')).toBe(true)
    for (const q of px(s)) expect(inside(q, 'starboard')).toBe(true)
  })

  /** 【站在那一側看過去】畫圖的照看到的畫：左舷看艦首在左、右舷看艦首在右，上面在上 */
  it('左舷條艦首在左、右舷條艦首在右，兩條都是上面在上', () => {
    const p = PORT.clone(); applyShipLiveryUv(p, 'body', L)
    const [pBow, pAft, pTop] = px(p) as [number[], number[], number[]]
    expect(pBow[0]).toBeLessThan(pAft[0]!)
    expect(pTop[1]).toBeLessThan(pBow[1]!)
    const s = STBD.clone(); applyShipLiveryUv(s, 'body', L)
    const [sAft, sBow, sTop] = px(s) as [number[], number[], number[]]
    expect(sBow[0]).toBeGreaterThan(sAft[0]!)
    expect(sTop[1]).toBeLessThan(sBow[1]!)
  })

  /** 【水平面漆甲板藍】迷彩只在立面；俯視時走廊頂與砲座頂會投到同一塊，給單色就不會打架 */
  it('朝上的船身面 → 單色區', () => {
    const g = UP.clone(); applyShipLiveryUv(g, 'body', L)
    for (const q of px(g)) expect(inside(q, 'flat')).toBe(true)
  })

  /** 【俯視不是鏡像】地圖上往西開的船，右舷朝北。左舷在上的話是從船底往上看 */
  it('甲板面 → 甲板條，艦首在左、右舷在上', () => {
    // 艦首左舷、艦首右舷、艦尾中線
    const g = tri([-4, 6, -40], [4, 6, -40], [0, 6, 40])
    applyShipLiveryUv(g, 'deck', L)
    const [bowPort, bowStbd, aft] = px(g) as [number[], number[], number[]]
    for (const q of [bowPort, bowStbd, aft]) expect(inside(q, 'deck')).toBe(true)
    expect(bowPort[0]).toBeLessThan(aft[0]!)
    expect(bowStbd[1]).toBeLessThan(bowPort[1]!)
  })

  /** 【前後壁不算朝上】法線 (0, 0, 1) 的水平分量在 z；只比 nx 的話它會被漆成甲板藍 */
  it('朝前後的立面不進單色區', () => {
    const g = tri([1, 0, 20], [3, 0, 20], [2, 3, 20])
    applyShipLiveryUv(g, 'body', L)
    for (const q of px(g)) expect(inside(q, 'flat')).toBe(false)
  })

  /**
   * 【mipmap 不滲色】縮小時一個像素會跨出條外；條與條之間要有畫圖腳本延色的空間。
   * 16 px 撐到第 3 級 mip（8 px 一格）仍只讀到同一條的漆
   */
  it('各區之間、各區與圖邊至少隔 16 px', () => {
    const MIN = 16
    const r = shipLiveryRects(L)
    expect(r.starboard.y - (r.port.y + r.port.h)).toBeGreaterThanOrEqual(MIN)
    expect(r.deck.y - (r.starboard.y + r.starboard.h)).toBeGreaterThanOrEqual(MIN)
    const apart = r.flat.y - (r.deck.y + r.deck.h) >= MIN || r.flat.x - (r.deck.x + r.deck.w) >= MIN
    expect(apart).toBe(true)
    for (const k of ['port', 'starboard', 'deck', 'flat'] as const) {
      expect(r[k].x).toBeGreaterThanOrEqual(MIN)
      expect(r[k].y).toBeGreaterThanOrEqual(MIN)
      expect(SHIP_LIVERY_WIDTH - (r[k].x + r[k].w)).toBeGreaterThanOrEqual(MIN)
      expect(SHIP_LIVERY_HEIGHT - (r[k].y + r[k].h)).toBeGreaterThanOrEqual(MIN)
    }
  })

  /** 【朝前後的面照重心分】法線沒有左右分量；一個面的三個頂點要進同一條，否則會被撕開 */
  it('朝前後的面照重心的 x 分左右舷', () => {
    // 法線 −Z（朝艦首）的一面，重心在右舷
    const g = tri([1, 0, -20], [3, 0, -20], [2, 3, -20])
    applyShipLiveryUv(g, 'body', L)
    for (const q of px(g)) expect(inside(q, 'starboard')).toBe(true)
    const h = tri([-3, 0, -20], [-1, 0, -20], [-2, 3, -20])
    applyShipLiveryUv(h, 'body', L)
    for (const q of px(h)) expect(inside(q, 'port')).toBe(true)
  })

  /** 【放不下就丟】超出的部分會讀到隔壁那一條的漆，而且不報錯 */
  it('三條放不進貼圖時丟錯', () => {
    expect(() => shipLiveryRects({ ...L, scale: 30 })).toThrow()
    expect(() => shipLiveryRects({ ...L, yMax: 200 })).toThrow()
  })

  it('有索引的幾何丟錯：相鄰面可能歸到不同條', () => {
    const g = UP.clone()
    g.setIndex([0, 1, 2])
    expect(() => applyShipLiveryUv(g, 'body', L)).toThrow()
  })
})

describe('零件的深淺', () => {
  /** 三個不相連的零件：一大塊（兩個三角形共邊）、兩個小的 */
  function parts(): BufferGeometry {
    const g = new BufferGeometry()
    g.setAttribute('position', new Float32BufferAttribute([
      // 大塊：兩個三角形，共用 (1,0,0)–(0,1,0) 那條邊
      0, 0, 0, 1, 0, 0, 0, 1, 0,
      1, 0, 0, 1, 1, 0, 0, 1, 0,
      // 小塊一
      10, 0, 0, 11, 0, 0, 10, 1, 0,
      // 小塊二
      -10, 3, 5, -9, 3, 5, -10, 4, 5,
    ], 3))
    return g
  }

  /** 依重心分種類：大塊在原點附近、小塊一在 +X、小塊二在 −X */
  const KINDS: readonly ShipPartKind[] = [
    { name: 'big', tone: 1.3, boxes: [{ x: [0, 2], y: [0, 2], z: [-1, 1] }] },
    { name: 'far', tone: 0.6, boxes: [{ x: [5, 20] }] },
  ]

  /** 色階是畫面上的倍率；頂點色在線性空間相乘，所以寫進去的是 tone^2.2 */
  it('同一塊零件的頂點同一個倍率，照重心落在哪一種的框裡', () => {
    const t = partTones(parts(), KINDS, 'test')
    expect(t.length).toBe(12 * 3)
    for (let i = 0; i < 6 * 3; i++) expect(t[i]).toBeCloseTo(Math.pow(1.3, 2.2), 5)
    // 兩個小塊都在 |x| 5…20：x 用的是絕對值，兩舷同一種
    for (let i = 6 * 3; i < 12 * 3; i++) expect(t[i]).toBeCloseTo(Math.pow(0.6, 2.2), 5)
  })

  /** 【認不出來就丟】漏了一種的話那一塊會靜靜地維持原色，看起來像是忘了塗 */
  it('有零件落不進任何一種時丟錯', () => {
    expect(() => partTones(parts(), KINDS.slice(0, 1), 'test')).toThrow()
  })
})

async function loadFletcher(): Promise<Group> {
  const buf = readFileSync('public/models/fletcher.glb')
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const scene = await new Promise<Group>((res, rej) => {
    createGltfLoader().parse(bytes, '', (g) => res(g.scene), rej)
  })
  scene.updateMatrixWorld(true)
  return scene
}

/** 像素點落在哪一區；都不在回 null */
function stripOf(x: number, y: number, rects: Record<ShipStrip, ShipRect>): ShipStrip | null {
  for (const k of ['port', 'starboard', 'deck', 'flat'] as const) {
    const r = rects[k]
    if (x >= r.x - 1e-3 && x <= r.x + r.w + 1e-3 && y >= r.y - 1e-3 && y <= r.y + r.h + 1e-3) return k
  }
  return null
}

describe('Fletcher 套塗裝', () => {
  /**
   * 走真的 `applyShipLivery`：UV 是從套完的網格讀回來的，區是照像素位置自己判的，
   * 朝向是自己算法線 —— 不借用分類函式回報的任何東西
   */
  it('每一個船身／甲板面整面落在一區，而且那一區與它的朝向相符', async () => {
    const def = SHIP_LIVERIES.fletcher!
    const scene = await loadFletcher()
    applyShipLivery(scene, def, new Texture())
    const rects = shipLiveryRects(def.layout)
    // 朝上的判定是 35.5°（1 : 1.4）；兩邊各留 0.5° 給浮點
    const UP = 36 * Math.PI / 180
    const SIDE = 35 * Math.PI / 180
    const counts: Record<string, number> = {}
    scene.traverse((o: Object3D) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const kind = def.kinds[(mesh.material as Material).name]
      if (kind !== 'body' && kind !== 'deck') return
      const pos = mesh.geometry.getAttribute('position')
      const uv = mesh.geometry.getAttribute('uv')
      expect(uv, mesh.name).toBeDefined()
      expect(uv.count).toBe(pos.count)
      for (let i = 0; i + 2 < pos.count; i += 3) {
        const s = [0, 1, 2].map((k) => stripOf(
          uv.getX(i + k) * SHIP_LIVERY_WIDTH, uv.getY(i + k) * SHIP_LIVERY_HEIGHT, rects))
        expect(s[0], `${mesh.name} 第 ${i / 3} 面`).not.toBeNull()
        expect(s[1]).toBe(s[0])
        expect(s[2]).toBe(s[0])
        const strip = s[0]!
        counts[strip] = (counts[strip] ?? 0) + 1
        const ux = pos.getX(i + 1) - pos.getX(i), uy = pos.getY(i + 1) - pos.getY(i), uz = pos.getZ(i + 1) - pos.getZ(i)
        const vx = pos.getX(i + 2) - pos.getX(i), vy = pos.getY(i + 2) - pos.getY(i), vz = pos.getZ(i + 2) - pos.getZ(i)
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx
        const tilt = Math.acos(ny / Math.hypot(nx, ny, nz))
        if (kind === 'deck') expect(strip).toBe('deck')
        else if (strip === 'flat') expect(tilt, `${mesh.name} 第 ${i / 3} 面`).toBeLessThanOrEqual(UP)
        else {
          expect(tilt, `${mesh.name} 第 ${i / 3} 面`).toBeGreaterThanOrEqual(SIDE)
          // 明顯朝左右的面進自己那一舷
          const side = nx / Math.hypot(nx, ny, nz)
          if (side > 0.5) expect(strip).toBe('starboard')
          if (side < -0.5) expect(strip).toBe('port')
        }
      }
    })
    for (const s of ['port', 'starboard', 'deck', 'flat']) expect(counts[s], s).toBeGreaterThan(0)
  })

  it('船身與甲板吃貼圖、顏色歸白；細部換成塗裝的顏色；頂點不動', async () => {
    const def = SHIP_LIVERIES.fletcher!
    const scene = await loadFletcher()
    const before = new Box3().setFromObject(scene)
    const tex = new Texture()
    applyShipLivery(scene, def, tex)
    const after = new Box3().setFromObject(scene)
    expect(after.min.toArray()).toEqual(before.min.toArray())
    expect(after.max.toArray()).toEqual(before.max.toArray())
    const want = new Color(def.accentColor).getHex()
    const seen = new Set<string>()
    scene.traverse((o: Object3D) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const m = mesh.material as MeshStandardMaterial
      const kind = def.kinds[m.name]
      if (kind === undefined) return
      seen.add(kind)
      if (kind === 'accent') {
        expect(m.color.getHex()).toBe(want)
      } else {
        expect(m.map).toBe(tex)
        expect(m.color.getHex()).toBe(0xffffff)
      }
    })
    expect([...seen].sort()).toEqual(['accent', 'body', 'deck'])
  })

  /**
   * 【依種類分深淺】建模腳本（`tools/blender/build_fletcher.py`）的零件逐一數得出來：
   * 砲械 29 塊、上層結構 20 塊。每一塊都要認得出種類，而且每一種的塊數要對 ——
   * 框畫錯的話某一塊會跑到隔壁那一種，只看「都有認到」抓不到。
   *
   * 艦橋 3（艦橋、駕駛室、翼台）、甲板室 7（五段甲板室、前甲板室、艦橋前平台）、
   * 砲桶 6（四座 20 mm 環、40 mm 的桶身與環）、小艇 2、煙囪 2；
   * 5 吋砲 10（五座砲塔、五根砲管）、射控 2（射控台、雷達板）、魚雷管 2、
   * 機砲 11（四座 20 mm 各有砲身與砲管、40 mm 砲架與兩根砲管）、桅 2（桅杆、桁）、
   * 深水炸彈軌 2
   */
  it('Fletcher 的每一塊零件都認得出種類，塊數與建模腳本相符', async () => {
    const def = SHIP_LIVERIES.fletcher!
    const scene = await loadFletcher()
    applyShipLivery(scene, def, new Texture())
    const want: Record<string, number> = {
      bridge: 3, house: 7, tub: 6, boat: 2, funnel: 2,
      gun: 10, director: 2, torpedo: 2, aa: 11, mast: 2, rack: 2,
    }
    const got: Record<string, number> = {}
    scene.traverse((o: Object3D) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const m = mesh.material as MeshStandardMaterial
      const kind = def.kinds[m.name]
      if (kind !== 'accent' && kind !== 'body') return
      expect(m.vertexColors, mesh.name).toBe(true)
      const c = mesh.geometry.getAttribute('color')
      const pos = mesh.geometry.getAttribute('position')
      expect(c.count).toBe(pos.count)
      const kinds = def.parts[mesh.name]
      if (kinds === undefined) {
        // 船殼維持原色
        for (let i = 0; i < c.count; i++) expect(c.getX(i), mesh.name).toBe(1)
        return
      }
      const parts = shipParts(mesh.geometry)
      const kindOf = (p: number) => shipPartKind(
        kinds, parts.centroid[p * 3]!, parts.centroid[p * 3 + 1]!, parts.centroid[p * 3 + 2]!)
      for (let p = 0; p < parts.count; p++) {
        const k = kindOf(p)
        expect(k, `${mesh.name} 第 ${p} 塊`).not.toBeNull()
        got[k!.name] = (got[k!.name] ?? 0) + 1
      }
      // 頂點色就是那一塊的種類的色階（換成線性）
      for (let i = 0; i < pos.count; i++) {
        expect(c.getX(i)).toBeCloseTo(Math.pow(kindOf(parts.of[Math.floor(i / 3)]!)!.tone, 2.2), 6)
      }
      // 【±40%】負責人指定的幅度
      for (const k of kinds) {
        expect(k.tone, k.name).toBeGreaterThanOrEqual(0.6)
        expect(k.tone, k.name).toBeLessThanOrEqual(1.4)
      }
    })
    expect(got).toEqual(want)
  })
})
