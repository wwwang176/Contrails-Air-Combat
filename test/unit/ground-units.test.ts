import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Box3, Vector3, type BufferAttribute, type BufferGeometry, type Mesh, type Object3D } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import {
  GROUND_UNITS, TRAIN_CONSIST, groundGeometry, preloadGroundModels, type GroundUnit,
} from '../../src/render/geometry/ground'
import { GLB_MATERIALS } from '../../src/render/geometry/ground/glb'
import { loadGlbTemplatesForNode } from '../fixtures/glb'

/**
 * 地面單位的外形與命中盒護欄。
 *
 * 守的事**都不會報錯，只會靜靜地錯**：
 *
 * - 底面沒有貼在 y = 0 —— 擺到地形上就整批浮空或陷地。
 * - 尺寸與真車差太多 —— 一個零件的座標打錯，車在地圖上就比它該有的小一截。
 * - 左右不對稱 —— 掃射時剪影歪一邊，而在空中看起來只像「這台車怪怪的」。
 * - 命中盒沒蓋住幾何 —— 子彈穿過看得見的車身而沒有任何提示；空盒則是一團
 *   看不見的東西在吃子彈。
 *
 * 【GLB 在 node 裡怎麼載】`preloadGroundModels` 預設走 `fetch('/models/…')`，
 * 那是瀏覽器的路。這裡傳自己的 fetcher 直接讀 `public/` 底下的檔 —— 與
 * `test/fixtures/glb.ts` 載機種同一招。
 */

const PUBLIC = 'public'
async function readPublic(url: string): Promise<ArrayBuffer> {
  const buf = readFileSync(`${PUBLIC}${url}`)
  // Buffer 的 ArrayBuffer 可能比它自己長（node 共用底層記憶體池），要切出這一段
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const built = new Map<GroundUnit, BufferGeometry>()

beforeAll(async () => {
  // 停放的 B-17 從機種的 GLB 樣板烘，樣板要先進來
  await loadGlbTemplatesForNode()
  await preloadGroundModels(readPublic)
  for (const u of GROUND_UNITS) built.set(u, groundGeometry(u))
})

function geometryOf(u: GroundUnit): BufferGeometry {
  const g = built.get(u)
  if (g === undefined) throw new Error(`沒有 ${u.id}`)
  return g
}

function boundsOf(u: GroundUnit): Box3 {
  const b = new Box3()
  const pos = geometryOf(u).getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    b.expandByPoint(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)))
  }
  return b
}

/**
 * 這台的網格，一個節點一筆、頂點已烘進遊戲座標，**砲管節點已排除**。
 * 程序化的火車只有一顆合併後的幾何，當一個節點。
 */
async function meshesOf(u: GroundUnit): Promise<{ node: string; pos: BufferAttribute }[]> {
  if (!('glb' in u.model)) {
    return [{ node: u.id, pos: geometryOf(u).getAttribute('position') as BufferAttribute }]
  }
  const { glb, barrelNodes } = u.model
  const scene = await new Promise<Object3D>((res, rej) => {
    readPublic(glb).then((buf) => new GLTFLoader().parse(buf, '', (g) => res(g.scene), rej), rej)
  })
  scene.updateMatrixWorld(true)
  const out: { node: string; pos: BufferAttribute }[] = []
  scene.traverse((o: Object3D) => {
    const mesh = o as Mesh
    if (!mesh.isMesh) return
    if (barrelNodes.some((p) => mesh.name.startsWith(p))) return
    const g = mesh.geometry.clone()
    g.applyMatrix4(mesh.matrixWorld)
    out.push({ node: mesh.name, pos: g.getAttribute('position') as BufferAttribute })
  })
  return out
}

/** 點在盒內（含邊界、容差 1 cm）。 */
function inside(x: number, y: number, z: number, u: GroundUnit): boolean {
  for (const b of u.hull) {
    if (Math.abs(x - b.center.x) <= b.half.x + 0.01
      && Math.abs(y - b.center.y) <= b.half.y + 0.01
      && Math.abs(z - b.center.z) <= b.half.z + 0.01) return true
  }
  return false
}

const size = new Vector3()

describe('地面單位', () => {
  it('登記表沒有重複的 id', () => {
    const ids = GROUND_UNITS.map((u) => u.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('列車的每一節都在登記表裡', () => {
    const ids = new Set(GROUND_UNITS.map((u) => u.id))
    for (const id of TRAIN_CONSIST) expect(ids.has(id)).toBe(true)
  })

  it('GLB 用到的材質名全在對照表裡，對照表也沒有沒人用的名字', () => {
    const used = new Set<string>()
    for (const u of GROUND_UNITS) {
      if (!('glb' in u.model)) continue
      for (const m of geometryOf(u).userData['materials'] as string[]) used.add(m)
    }
    for (const name of Object.keys(GLB_MATERIALS)) expect(used.has(name)).toBe(true)
  })

  for (const u of GROUND_UNITS) {
    describe(u.name, () => {
      it('底面貼在 y = 0', () => {
        // 5 cm 的容差：輪胎與履帶的圓周分段會讓最低點略高於理論值。
        expect(boundsOf(u).min.y).toBeGreaterThan(-0.01)
        expect(boundsOf(u).min.y).toBeLessThan(0.05)
      })

      it('尺寸與真車相差不到 5%', () => {
        boundsOf(u).getSize(size)
        expect(Math.abs(size.z - u.realLength) / u.realLength).toBeLessThan(0.05)
        expect(Math.abs(size.x - u.realWidth) / u.realWidth).toBeLessThan(0.05)
        expect(Math.abs(size.y - u.realHeight) / u.realHeight).toBeLessThan(0.05)
      })

      it('左右對稱於 x = 0', () => {
        const b = boundsOf(u)
        expect(b.min.x).toBeCloseTo(-b.max.x, 2)
      })

      it('有頂點色 —— 少了它整台會被塗成單一顏色', () => {
        expect(geometryOf(u).getAttribute('color')).toBeDefined()
      })

      it('沒有共用頂點 —— 共用了就變成平滑著色', () => {
        expect(geometryOf(u).index).toBeNull()
      })

      it('命中盒沒有浮空、沒有伸出幾何的包圍盒', () => {
        const b = boundsOf(u)
        expect(u.hull.length).toBeGreaterThan(0)
        for (const h of u.hull) {
          expect(h.center.y - h.half.y).toBeGreaterThan(-0.01)
          expect(h.center.x - h.half.x).toBeGreaterThan(b.min.x - 0.05)
          expect(h.center.x + h.half.x).toBeLessThan(b.max.x + 0.05)
          expect(h.center.y + h.half.y).toBeLessThan(b.max.y + 0.05)
          expect(h.center.z - h.half.z).toBeGreaterThan(b.min.z - 0.05)
          expect(h.center.z + h.half.z).toBeLessThan(b.max.z + 0.05)
        }
      })

      it('命中盒蓋住砲管以外的全部頂點 —— 座標系換錯（(x, z, −y) 少個負號）會整批漏', async () => {
        // GLB 那幾台要回到原始場景逐物件看，因為合併後的幾何分不出哪些頂點是砲管
        const missed: string[] = []
        for (const { node, pos } of await meshesOf(u)) {
          for (let i = 0; i < pos.count; i++) {
            if (!inside(pos.getX(i), pos.getY(i), pos.getZ(i), u)) { missed.push(node); break }
          }
        }
        expect(missed).toEqual([])
      })
    })
  }
})
