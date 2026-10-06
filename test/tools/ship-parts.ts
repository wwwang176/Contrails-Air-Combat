/**
 * 列出一艘船每一個網格的零件：三角形數、重心、範圍（遊戲座標，艦首 −Z）。
 * 建 `render/shipLiveries.ts` 的零件種類表時用。
 *
 *   npx vite-node test/tools/ship-parts.ts -- <艦級 id> [網格名的一部分]
 *
 * 零件的切法走 `shipLivery.ts` 的同一支 `shipParts`。
 */
import { readFileSync } from 'node:fs'
import type { Group, Mesh, Object3D } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { shipParts } from '../../src/render/shipLivery'
import { SHIP_CLASSES, type ShipClassId } from '../../src/world/ships'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const [id, only] = argv as [ShipClassId | undefined, string | undefined]
if (id === undefined || SHIP_CLASSES[id] === undefined) {
  throw new Error(`用法：ship-parts.ts <艦級 id> [網格名]；id 是 ${Object.keys(SHIP_CLASSES).join('、')}`)
}

const buf = readFileSync(`public${SHIP_CLASSES[id].url}`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const scene = await new Promise<Group>((res, rej) => {
  createGltfLoader().parse(bytes, '', (g) => res(g.scene), rej)
})
scene.updateMatrixWorld(true)
scene.traverse((o: Object3D) => {
  const mesh = o as Mesh
  if (!mesh.isMesh) return
  if (only !== undefined && !mesh.name.includes(only)) return
  let geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
  if (geo.index !== null) geo = geo.toNonIndexed()
  const parts = shipParts(geo)
  const pos = geo.getAttribute('position')
  const tris = new Int32Array(parts.count)
  const lo = new Float64Array(parts.count * 3).fill(Infinity)
  const hi = new Float64Array(parts.count * 3).fill(-Infinity)
  for (let t = 0; t < parts.of.length; t++) {
    const p = parts.of[t]!
    tris[p]!++
    for (let k = 0; k < 3; k++) {
      const v = [pos.getX(t * 3 + k), pos.getY(t * 3 + k), pos.getZ(t * 3 + k)]
      for (let a = 0; a < 3; a++) {
        lo[p * 3 + a] = Math.min(lo[p * 3 + a]!, v[a]!)
        hi[p * 3 + a] = Math.max(hi[p * 3 + a]!, v[a]!)
      }
    }
  }
  const order = [...Array(parts.count).keys()].sort((a, b) => parts.centroid[a * 3 + 2]! - parts.centroid[b * 3 + 2]!)
  console.log(`${mesh.name}（${(mesh.material as { name: string }).name}）${parts.count} 塊`)
  const f = (v: number) => v.toFixed(1).padStart(6)
  for (const p of order) {
    const c = [0, 1, 2].map((a) => parts.centroid[p * 3 + a]!)
    console.log(`  #${String(p).padStart(3)} tris ${String(tris[p]).padStart(4)}  c(${f(c[0]!)},${f(c[1]!)},${f(c[2]!)})`
      + `  x ${f(lo[p * 3]!)}…${f(hi[p * 3]!)}  y ${f(lo[p * 3 + 1]!)}…${f(hi[p * 3 + 1]!)}  z ${f(lo[p * 3 + 2]!)}…${f(hi[p * 3 + 2]!)}`)
  }
})
