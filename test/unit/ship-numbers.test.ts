import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  BufferGeometry, Float32BufferAttribute, Texture, type Group, type Mesh, type Object3D,
} from 'three'
import { applyShipLivery, buildShipNumberDecals } from '../../src/render/ships'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import {
  DIGIT_SEGMENTS, buildNumberDecal, glyphRects, numberBox, numberMaterial, shipNumber,
  type NumberMark,
} from '../../src/render/shipNumbers'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'
import { SHIP_CLASSES, type ShipClassId } from '../../src/world/ships'

/**
 * # 船的號碼
 *
 * 方塊字（直線段、直角）與貼著船殼的貼花。守的是字形、方向與挑面；好不好看由截圖裁定。
 */

describe('方塊字', () => {
  it('十個數字的線段數對：8 是七段、1 是兩段', () => {
    expect(Object.keys(DIGIT_SEGMENTS).sort()).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])
    expect(DIGIT_SEGMENTS['8']!.length).toBe(7)
    expect(DIGIT_SEGMENTS['1']!.length).toBe(2)
    expect(DIGIT_SEGMENTS['9']!.length).toBe(6)
  })

  /** 【直角、外緣齊】每一段是一條實心直條，外緣貼齊字框 */
  it('每一段都在字框裡，外緣貼齊字框的四邊', () => {
    const w = 3, h = 5, t = 0.8
    const rs = glyphRects('8', w, h, t)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const r of rs) {
      expect(r.x).toBeGreaterThanOrEqual(0)
      expect(r.y).toBeGreaterThanOrEqual(0)
      expect(r.x + r.w).toBeLessThanOrEqual(w + 1e-9)
      expect(r.y + r.h).toBeLessThanOrEqual(h + 1e-9)
      x0 = Math.min(x0, r.x); y0 = Math.min(y0, r.y)
      x1 = Math.max(x1, r.x + r.w); y1 = Math.max(y1, r.y + r.h)
    }
    expect([x0, y0, x1, y1]).toEqual([0, 0, w, h])
  })

  it('號碼的外框：寬是字寬乘字數加字距，再加四周留白', () => {
    const mark: NumberMark = { view: 'starboard', z: 0, y: 0, height: 2 }
    const b1 = numberBox('9', mark)
    const b3 = numberBox('445', mark)
    expect(b3.w).toBeGreaterThan(b1.w * 2)
    expect(b3.h).toBe(b1.h)
    expect(b1.h).toBeGreaterThan(2)
  })
})

describe('號碼輪替', () => {
  /** 【相鄰不同】同一艦級編號相鄰的兩艘不同號碼 */
  it('第 i 艘取第 i % n 個，相鄰兩艘不同', () => {
    const vs = ['445', '446', '447']
    for (let i = 0; i < 10; i++) {
      expect(shipNumber(vs, i)).toBe(vs[i % 3])
      expect(shipNumber(vs, i + 1)).not.toBe(shipNumber(vs, i))
    }
  })
})

/** 一片朝 +X 的直立牆（右舷）與一片朝 −X 的（左舷），各兩個三角形，z −10…10、y 0…6 */
function walls(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([
    // 右舷 x = 5，法線 +X
    5, 0, 10, 5, 0, -10, 5, 6, -10,
    5, 0, 10, 5, 6, -10, 5, 6, 10,
    // 左舷 x = −5，法線 −X
    -5, 0, -10, -5, 0, 10, -5, 6, 10,
    -5, 0, -10, -5, 6, 10, -5, 6, -10,
  ], 3))
  return g
}

/** 一片朝上的甲板 y = 6，x −5…5、z −10…10 */
function deck(): BufferGeometry {
  const g = new BufferGeometry()
  g.setAttribute('position', new Float32BufferAttribute([
    -5, 6, -10, -5, 6, 10, 5, 6, 10,
    -5, 6, -10, 5, 6, 10, 5, 6, -10,
  ], 3))
  return g
}

/** 在貼花上找離 (x, y, z) 最近的頂點，回傳它的 UV */
function uvNear(g: BufferGeometry, x: number, y: number, z: number): [number, number] {
  const p = g.getAttribute('position')
  const uv = g.getAttribute('uv')
  let best = -1, bd = Infinity
  for (let i = 0; i < p.count; i++) {
    const d = (p.getX(i) - x) ** 2 + (p.getY(i) - y) ** 2 + (p.getZ(i) - z) ** 2
    if (d < bd) { bd = d; best = i }
  }
  return [uv.getX(best), uv.getY(best)]
}

describe('貼花', () => {
  const box = { w: 4, h: 2 }

  it('右舷的貼花只挑朝 +X 的面，往外推，框中心是 (0.5, 0.5)，往艦首 u 變大', () => {
    const mark: NumberMark = { view: 'starboard', z: 0, y: 3, height: 2 }
    const g = buildNumberDecal(walls(), mark, box)!
    const p = g.getAttribute('position')
    expect(p.count).toBeGreaterThan(0)
    for (let i = 0; i < p.count; i++) expect(p.getX(i)).toBeGreaterThan(5)
    // 框是 z −2…2、y 2…4：艦首下角是 (1, 0)、艦尾上角是 (0, 1)
    const [uBow, vLow] = uvNear(g, 5, 2, -2)
    const [uAft, vHigh] = uvNear(g, 5, 4, 2)
    expect(uBow).toBeCloseTo(1, 6)
    expect(vLow).toBeCloseTo(0, 6)
    expect(uAft).toBeCloseTo(0, 6)
    expect(vHigh).toBeCloseTo(1, 6)
  })

  it('左舷的貼花只挑朝 −X 的面，往艦首 u 變小（站在左舷看，艦首在左）', () => {
    const mark: NumberMark = { view: 'port', z: 0, y: 3, height: 2 }
    const g = buildNumberDecal(walls(), mark, box)!
    const p = g.getAttribute('position')
    expect(p.count).toBeGreaterThan(0)
    for (let i = 0; i < p.count; i++) expect(p.getX(i)).toBeLessThan(-5)
    const [uBow] = uvNear(g, -5, 2, -2)
    expect(uBow).toBeCloseTo(0, 6)
  })

  /** 【甲板上的字頂朝艦首】從艦尾進場的飛行員讀得正：右舷在右、艦首在上 */
  it('甲板的貼花往上推，往右舷 u 變大、往艦首 v 變大', () => {
    const mark: NumberMark = { view: 'deck', z: 0, x: 0, height: 2 }
    const g = buildNumberDecal(deck(), mark, box)!
    const p = g.getAttribute('position')
    for (let i = 0; i < p.count; i++) expect(p.getY(i)).toBeGreaterThan(6)
    // 甲板上框的長邊（字高）沿 z：z −1…1、x −2…2；右舷艦首角是 (1, 1)
    const [uStbd, vBow] = uvNear(g, 2, 6, -1)
    expect(uStbd).toBeCloseTo(1, 6)
    expect(vBow).toBeCloseTo(1, 6)
  })

  /**
   * 【裁到框內】框外不能靠字圖的透明邊擋：mipmap 縮小之後邊緣的 alpha 會升到 0.7
   * 以上，過得了 alphaTest，遠看框外多出一片色塊。所以貼花本身就只蓋框內
   */
  it('貼花的每一個頂點都在號碼框內（UV 在 0…1）', () => {
    for (const mark of [
      { view: 'starboard', z: 0, y: 3, height: 2 },
      { view: 'port', z: 0, y: 3, height: 2 },
      { view: 'deck', z: 0, x: 0, height: 2 },
    ] as const) {
      const g = buildNumberDecal(mark.view === 'deck' ? deck() : walls(), mark, box)!
      const uv = g.getAttribute('uv')
      expect(uv.count).toBeGreaterThan(0)
      for (let i = 0; i < uv.count; i++) {
        expect(uv.getX(i)).toBeGreaterThanOrEqual(-1e-6)
        expect(uv.getX(i)).toBeLessThanOrEqual(1 + 1e-6)
        expect(uv.getY(i)).toBeGreaterThanOrEqual(-1e-6)
        expect(uv.getY(i)).toBeLessThanOrEqual(1 + 1e-6)
      }
    }
  })

  /** 【只挑船殼】LST 的船身材質併了欄杆與立柱；不擋的話號碼會印半個字在立柱上 */
  it('只挑最大的一塊零件時，框內別的小零件不會被印上', () => {
    const g = walls()
    const p = g.getAttribute('position')
    const extra = [5.5, 2.5, 0.5, 5.5, 2.5, -0.5, 5.5, 3.5, -0.5]
    const merged = new BufferGeometry()
    merged.setAttribute('position', new Float32BufferAttribute([...(p.array as Float32Array), ...extra], 3))
    const mark: NumberMark = { view: 'starboard', z: 0, y: 3, height: 2 }
    const all = buildNumberDecal(merged, mark, box)!
    const hull = buildNumberDecal(merged, mark, box, true)!
    const maxX = (d: BufferGeometry) => {
      const q = d.getAttribute('position')
      let m = -Infinity
      for (let i = 0; i < q.count; i++) m = Math.max(m, q.getX(i))
      return m
    }
    expect(maxX(all)).toBeGreaterThan(5.4)
    expect(maxX(hull)).toBeLessThan(5.1)
  })

  it('材質切掉字外的透明處，並往前推免得與船殼互閃', () => {
    const m = numberMaterial(null)
    expect(m.alphaTest).toBeGreaterThanOrEqual(0.5)
    expect(m.polygonOffset).toBe(true)
    expect(m.polygonOffsetFactor).toBeLessThan(0)
  })

  /** 【艦尾那一個朝艦尾】轉 180°：右舷艦首角變成 (0, 0) */
  it('甲板上字頂朝艦尾的號碼整個轉 180°', () => {
    const mark: NumberMark = { view: 'deck', z: 0, x: 0, height: 2, top: 'stern' }
    const g = buildNumberDecal(deck(), mark, box)!
    const [u, v] = uvNear(g, 2, 6, -1)
    expect(u).toBeCloseTo(0, 6)
    expect(v).toBeCloseTo(0, 6)
  })

  it('框外餘量之外的面不挑；一個都沒挑到回 null', () => {
    const far: NumberMark = { view: 'starboard', z: 100, y: 3, height: 2 }
    expect(buildNumberDecal(walls(), far, box)).toBeNull()
  })
})

async function loadShip(id: ShipClassId): Promise<Group> {
  const buf = readFileSync(`public${SHIP_CLASSES[id].url}`)
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const scene = await new Promise<Group>((res, rej) => {
    createGltfLoader().parse(bytes, '', (g) => res(g.scene), rej)
  })
  scene.updateMatrixWorld(true)
  return scene
}

describe.each(['fletcher', 'lst', 'essex'] as const)('%s 的號碼', (id) => {
  /** 讀真的 GLB：每一個號碼位置都挑得到面 —— 挑不到的話那個號碼整個不見，不會報錯 */
  it('每一個號碼位置都挑得到船殼上的面', async () => {
    const def = SHIP_LIVERIES[id]!.numbers!
    expect(def.values.length).toBeGreaterThan(0)
    const scene = await loadShip(id)
    let src: Mesh | undefined
    scene.traverse((o: Object3D) => { if ((o as Mesh).isMesh && o.name === def.mesh) src = o as Mesh })
    expect(src, def.mesh).toBeDefined()
    let geo = src!.geometry.clone().applyMatrix4(src!.matrixWorld)
    if (geo.index !== null) geo = geo.toNonIndexed()
    for (const mark of def.marks) {
      const g = buildNumberDecal(geo, mark, numberBox(def.values[0]!, mark), def.largestPartOnly)
      expect(g, `${mark.view} z ${mark.z}`).not.toBeNull()
    }
  })

  /** 走遊戲載入時的那一支：套過塗裝的樣板上建得出併好的貼花，每一個位置都有份 */
  it('套過塗裝的樣板建得出號碼貼花', async () => {
    const def = SHIP_LIVERIES[id]!
    const scene = await loadShip(id)
    applyShipLivery(scene, def, new Texture())
    const g = buildShipNumberDecals(scene, def.numbers!)
    expect(g.getAttribute('position').count).toBeGreaterThan(0)
    expect(g.getAttribute('uv').count).toBe(g.getAttribute('position').count)
  })
})
