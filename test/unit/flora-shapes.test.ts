import { describe, it, expect } from 'vitest'
import { Box3, type BufferGeometry } from 'three'
import {
  createFloraGeometries, disposeFloraGeometries, TREE_HEIGHT, type PoolName,
} from '../../src/render/floraShapes'

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

  it('灌木比喬木矮一個量級', () => {
    expect(bounds(geo.bush).max.y).toBeLessThan(4)
    expect(bounds(geo.bush).max.y).toBeGreaterThan(2)
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
