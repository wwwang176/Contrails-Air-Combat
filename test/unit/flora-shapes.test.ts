import { describe, it, expect } from 'vitest'
import { Box3, Vector3, type BufferGeometry } from 'three'
import {
  createFloraGeometries, disposeFloraGeometries, TREE_HEIGHT, type PoolName,
} from '../../src/render/floraShapes'
import { HEDGE_BUSH_SPACING } from '../../src/render/flora'

const geo = createFloraGeometries()
const names = Object.keys(geo) as PoolName[]

function tris(g: BufferGeometry): number {
  return g.getAttribute('position').count / 3
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

describe('植被與建築的幾何', () => {
  /**
   * 【精確比對，不是上限】三角形數是效能預算的分母。
   * `OctahedronGeometry(detail = 1)` 是 32 個三角形而不是 8 —— 那種
   * 四倍的誤差要在幾何定稿的當下就抓到，不是在幀時間掉下來之後。
   */
  it('每個幾何的三角形數', () => {
    const want: Record<PoolName, number> = {
      broadL0: 20, coneL0: 19, treeMid: 8, treeFar: 4,
      bush: 8, house: 18, barn: 18, church: 34,
    }
    const got: Record<string, number> = {}
    for (const n of names) got[n] = tris(geo[n])
    console.log(JSON.stringify(got))
    for (const n of names) expect(tris(geo[n])).toBe(want[n])
  })

  it('八個幾何，名字與池一一對應', () => {
    expect(names.sort()).toEqual([
      'barn', 'broadL0', 'bush', 'church', 'coneL0', 'house', 'treeFar', 'treeMid',
    ])
  })

  /**
   * 【底面必須在 y = 0】實例的 `y` 直接放地面高度 —— 底面不在 0 的話整批
   * 浮空或陷地。
   */
  it('每個幾何的底面都在 y = 0', () => {
    for (const n of names) expect(bounds(geo[n]).min.y).toBeCloseTo(0, 5)
  })

  it('近中距離的喬木一樣高，最遠那一級刻意矮一點', () => {
    for (const n of ['broadL0', 'coneL0', 'treeMid'] as const) {
      expect(bounds(geo[n]).max.y).toBeCloseTo(TREE_HEIGHT, 5)
    }
    // 【treeFar 矮而寬】1 km 外一棵樹只有幾個像素，要的是團塊不是尖塔
    const far = bounds(geo.treeFar)
    expect(far.max.y).toBeLessThan(TREE_HEIGHT)
    expect(far.max.y).toBeGreaterThan(TREE_HEIGHT * 0.7)
    expect(far.max.x - far.min.x).toBeGreaterThan(bounds(geo.coneL0).max.x * 2)
  })

  /**
   * 【遠中距離不得是尖錐】L1／L2 不分樹種，而 450 m 外的地佔了畫面九成 ——
   * 兩級都用尖錐的話整片 bocage 讀起來像雲杉林。判準用「寬高比」：
   * 闊葉的樹冠接近球，針葉的錐細長。
   */
  it('遠中距離的輪廓是圓的，不是尖的', () => {
    for (const n of ['treeMid', 'treeFar'] as const) {
      const b = bounds(geo[n])
      expect((b.max.x - b.min.x) / b.max.y).toBeGreaterThan(0.6)
    }
    // 針葉的 L0 仍然細長 —— 那是防風林該有的樣子
    const c = bounds(geo.coneL0)
    expect((c.max.x - c.min.x) / c.max.y).toBeLessThan(0.6)
  })

  /**
   * 【灌木要比間距寬】相鄰兩叢交疊才成一條連續的堤，而那條堤就是 bocage 的
   * 本體 —— 喬木只是每隔十幾公尺插上去的一根。
   */
  it('灌木比喬木矮一截，但比它的間距寬', () => {
    const b = bounds(geo.bush)
    expect(b.max.y).toBeLessThan(TREE_HEIGHT / 3)
    expect(b.max.y).toBeGreaterThan(2)
    expect(b.max.x - b.min.x).toBeGreaterThan(HEDGE_BUSH_SPACING)
  })

  it('教堂的尖塔比任何一棟房子都高', () => {
    expect(bounds(geo.church).max.y).toBeGreaterThan(bounds(geo.house).max.y * 2)
    expect(bounds(geo.church).max.y).toBeGreaterThan(bounds(geo.barn).max.y * 2)
  })

  it('穀倉比房子長也比房子高', () => {
    const h = bounds(geo.house)
    const b = bounds(geo.barn)
    expect(b.max.x - b.min.x).toBeGreaterThan(h.max.x - h.min.x)
    expect(b.max.y).toBeGreaterThan(h.max.y)
  })

  /** 【樹幹與樹冠必須是兩個顏色】材質沒開 vertexColors 的話這一條仍然綠 */
  it('L0 的兩種喬木都有樹幹色與樹冠色', () => {
    for (const n of ['broadL0', 'coneL0'] as const) {
      expect(colours(geo[n]).size).toBe(2)
    }
    // 沒有樹幹的那兩級只有一個顏色
    expect(colours(geo.treeMid).size).toBe(1)
    expect(colours(geo.treeFar).size).toBe(1)
  })

  it('房子的牆與屋頂是兩個顏色，教堂三個', () => {
    expect(colours(geo.house).size).toBe(2)
    expect(colours(geo.barn).size).toBe(2)
    // 本堂牆、屋頂、尖頂
    expect(colours(geo.church).size).toBe(3)
  })

  it('L0 喬木最低的那些頂點是樹幹色', () => {
    for (const n of ['broadL0', 'coneL0'] as const) {
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
  const STAR_Y: Record<PoolName, number> = {
    broadL0: 5, coneL0: 4, treeMid: 7.5, treeFar: 1,
    bush: 2, house: 2.5, barn: 3, church: 3,
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
      p.set(0, STAR_Y[name], 0)
      const inward: number[] = []
      for (let f = 0; f < pos.count / 3; f++) {
        a.fromBufferAttribute(pos, f * 3)
        b.fromBufferAttribute(pos, f * 3 + 1)
        c.fromBufferAttribute(pos, f * 3 + 2)
        // three 的 computeVertexNormals 用 (C − B) × (A − B)
        n.crossVectors(cb.subVectors(c, b), ab.subVectors(a, b))
        mid.addVectors(a, b).add(c).multiplyScalar(1 / 3).sub(p)
        if (n.dot(mid) <= 0) inward.push(f)
      }
      expect([name, inward]).toEqual([name, []])
    }
  })

  it('沒有共用頂點 —— 面法線才是硬的', () => {
    for (const n of names) {
      expect(geo[n].getIndex()).toBeNull()
      expect(geo[n].getAttribute('position').count % 3).toBe(0)
    }
  })

  it('disposeFloraGeometries 把每一個都釋放掉', () => {
    const g = createFloraGeometries()
    const seen: string[] = []
    for (const n of Object.keys(g) as PoolName[]) {
      g[n].addEventListener('dispose', () => seen.push(n))
    }
    disposeFloraGeometries(g)
    expect(seen.sort()).toEqual(names.slice().sort())
  })
})
