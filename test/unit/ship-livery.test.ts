import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { BufferGeometry, Float32BufferAttribute, type Group, type Material, type Mesh, type Object3D } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import {
  SHIP_LIVERY_HEIGHT, SHIP_LIVERY_WIDTH, applyShipLiveryUv, shipLiveryRects,
  type ShipLiveryLayout, type ShipStrip,
} from '../../src/render/shipLivery'
import { SHIP_LIVERIES } from '../../src/render/ships'

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

describe('Fletcher 的版面', () => {
  /** 讀真的 GLB：每一個船身與甲板面都落在自己那一條之內，沒有面伸出去讀到隔壁 */
  it('每一個 Body／Deck 面的 UV 都在自己那一條裡', async () => {
    const def = SHIP_LIVERIES.fletcher!
    const buf = readFileSync('public/models/fletcher.glb')
    const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
    const scene = await new Promise<Group>((res, rej) => {
      createGltfLoader().parse(bytes, '', (g) => res(g.scene), rej)
    })
    scene.updateMatrixWorld(true)
    const rects = shipLiveryRects(def.layout)
    const counts: Record<string, number> = {}
    scene.traverse((o: Object3D) => {
      const mesh = o as Mesh
      if (!mesh.isMesh) return
      const kind = def.kinds[(mesh.material as Material).name]
      if (kind !== 'body' && kind !== 'deck') return
      let geo = mesh.geometry.clone()
      geo.applyMatrix4(mesh.matrixWorld)
      geo = geo.toNonIndexed()
      applyShipLiveryUv(geo, kind, def.layout, (strip, pts) => {
        counts[strip] = (counts[strip] ?? 0) + 1
        const r = rects[strip]
        for (let k = 0; k < 3; k++) {
          const x = pts[k * 2]!, y = pts[k * 2 + 1]!
          expect(x >= r.x - 1e-3 && x <= r.x + r.w + 1e-3 && y >= r.y - 1e-3 && y <= r.y + r.h + 1e-3,
            `${strip} (${x.toFixed(1)}, ${y.toFixed(1)})`).toBe(true)
        }
      })
    })
    for (const s of ['port', 'starboard', 'deck', 'flat']) expect(counts[s], s).toBeGreaterThan(0)
  })
})
