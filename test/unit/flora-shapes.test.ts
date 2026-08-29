import { describe, it, expect } from 'vitest'
import { Box3, Vector3, type BufferGeometry } from 'three'
import {
  createFloraGeometries, disposeFloraGeometries, CARD_POOLS, TREE_HEIGHT,
  type PoolName,
} from '../../src/render/floraShapes'
import { HEDGE_BUSH_SPACING } from '../../src/render/flora'

const geo = createFloraGeometries()
const names = Object.keys(geo) as PoolName[]

/** 六個喬木幾何 —— 兩個樹種各三級 */
const TREES = [
  'broadNear', 'broadMid', 'broadCard', 'coneNear', 'coneMid', 'coneCard',
] as const

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
  it('每個幾何的三角形數', () => {
    const want: Record<PoolName, number> = {
      broadNear: 20, broadMid: 8, broadCard: 2,
      coneNear: 19, coneMid: 6, coneCard: 1,
      bushNear: 8, bushCard: 2,
      house: 18, barn: 18, church: 34,
    }
    const got: Record<string, number> = {}
    for (const n of names) got[n] = tris(geo[n])
    console.log(JSON.stringify(got))
    for (const n of names) expect(tris(geo[n])).toBe(want[n])
  })

  it('十一個幾何，名字與池一一對應', () => {
    expect(names.slice().sort()).toEqual([
      'barn', 'broadCard', 'broadMid', 'broadNear', 'bushCard', 'bushNear',
      'church', 'coneCard', 'coneMid', 'coneNear', 'house',
    ])
  })

  /**
   * 【底面必須在 y = 0】實例的 `y` 直接放地面高度 —— 底面不在 0 的話整批
   * 浮空或陷地。
   */
  it('每個幾何的底面都在 y = 0', () => {
    for (const n of names) expect(bounds(geo[n]).min.y).toBeCloseTo(0, 5)
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
    const ratio = (n: PoolName): number => {
      const b = bounds(geo[n])
      return (b.max.x - b.min.x) / b.max.y
    }
    for (const n of ['broadNear', 'broadMid', 'broadCard'] as const) {
      expect([n, ratio(n) > 0.6]).toEqual([n, true])
    }
    for (const n of ['coneNear', 'coneMid', 'coneCard'] as const) {
      expect([n, ratio(n) < 0.6]).toEqual([n, true])
    }
  })

  /**
   * 【換級不換樹種】遠級與近級的樹冠必須同色，而兩個樹種必須不同色。
   * 顏色與剪影是兩件事，兩條都要有 —— 同色但形狀變了、或形狀對了但
   * 顏色跳掉，看起來都是「那棵樹換了種」。
   */
  it('換級不換樹種：三級同色，兩樹種不同色', () => {
    for (const n of ['broadMid', 'broadCard'] as const) {
      expect([n, crownColour(geo[n])]).toEqual([n, crownColour(geo.broadNear)])
    }
    for (const n of ['coneMid', 'coneCard'] as const) {
      expect([n, crownColour(geo[n])]).toEqual([n, crownColour(geo.coneNear)])
    }
    expect(crownColour(geo.broadCard)).not.toBe(crownColour(geo.coneCard))
  })

  /**
   * 【灌木要比間距寬】相鄰兩叢交疊才成一條連續的堤，而那條堤就是 bocage 的
   * 本體 —— 喬木只是每隔十幾公尺插上去的一根。
   */
  it('灌木比喬木矮一截，但比它的間距寬', () => {
    const b = bounds(geo.bushNear)
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
  it('近級的兩種喬木都有樹幹色與樹冠色', () => {
    for (const n of ['broadNear', 'coneNear'] as const) {
      expect(colours(geo[n]).size).toBe(2)
    }
    // 中級與公告板沒有樹幹，只有一個顏色
    for (const n of ['broadMid', 'broadCard', 'coneMid', 'coneCard', 'bushCard'] as const) {
      expect([n, colours(geo[n]).size]).toEqual([n, 1])
    }
  })

  it('房子的牆與屋頂是兩個顏色，教堂三個', () => {
    expect(colours(geo.house).size).toBe(2)
    expect(colours(geo.barn).size).toBe(2)
    // 本堂牆、屋頂、尖頂
    expect(colours(geo.church).size).toBe(3)
  })

  it('近級喬木最低的那些頂點是樹幹色', () => {
    for (const n of ['broadNear', 'coneNear'] as const) {
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
  const STAR_Y: Record<string, number> = {
    broadNear: 5, broadMid: 7.5, coneNear: 4, coneMid: 1,
    bushNear: 2, house: 2.5, barn: 3, church: 3,
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
      // 【公告板不適用】它是單面的平片，朝向由頂點著色器決定 ——
      // 守它的是下面那條繞序，以及 `test/e2e/flora-card.e2e.ts`
      if (CARD_POOLS.includes(name)) continue
      const pos = geo[name].getAttribute('position')
      p.set(0, STAR_Y[name]!, 0)
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

  /**
   * 【公告板要在 xy 平面上逆時針繞】頂點著色器把 x 映到「水平上垂直於視線
   * 的方向」、y 維持向上，於是 `right × up` 指向鏡頭 —— 繞序在螢幕上就永遠
   * 是正面。順時針的話鏡頭繞到另一邊，整批會被背面剔除掉。
   */
  it('公告板的繞序讓它永遠是正面', () => {
    const a = new Vector3()
    const b = new Vector3()
    const c = new Vector3()
    for (const name of CARD_POOLS) {
      const pos = geo[name].getAttribute('position')
      const zs: number[] = []
      for (let f = 0; f < pos.count / 3; f++) {
        a.fromBufferAttribute(pos, f * 3)
        b.fromBufferAttribute(pos, f * 3 + 1)
        c.fromBufferAttribute(pos, f * 3 + 2)
        // (C − B) × (A − B) 的 z 分量
        zs.push((c.x - b.x) * (a.y - b.y) - (c.y - b.y) * (a.x - b.x))
      }
      expect([name, zs.every((z) => z > 0)]).toEqual([name, true])
    }
  })

  /** 【公告板的法線固定向上】面法線會讓亮度隨鏡頭方位變 —— 見 floraShapes.ts */
  it('公告板的頂點法線全部是 (0, 1, 0)', () => {
    for (const name of CARD_POOLS) {
      const n = geo[name].getAttribute('normal')
      const bad: number[] = []
      for (let i = 0; i < n.count; i++) {
        if (n.getX(i) !== 0 || n.getY(i) !== 1 || n.getZ(i) !== 0) bad.push(i)
      }
      expect([name, bad]).toEqual([name, []])
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
