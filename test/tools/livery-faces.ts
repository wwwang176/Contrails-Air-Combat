/**
 * 塗裝版面倒出來給畫貼圖的腳本（`tools/livery/*.py`）用。
 *
 *   npx vite-node test/tools/livery-faces.ts -- <機種 id> <輸出.json>
 *   npx vite-node test/tools/livery-faces.ts -- <機種 id>          （只列零件）
 *
 * 輸出：版面參數，與每一個機身色三角形的視圖、像素座標、所屬節點與 part。
 * 投影走 `livery.ts` 的同一支 `applyLiveryUv`，所以與遊戲裡算的 UV 逐點相同。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { Box3, type Group, type Material, type Mesh, type Object3D } from 'three'
import { GLB_MODELS } from '../../src/render/geometry/buildAircraft'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import {
  applyLiveryUv, liveryMoveFor, LIVERY_HEIGHT, LIVERY_WIDTH, type LiveryLayout,
} from '../../src/render/geometry/livery'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const [id, out] = argv
const def = id === undefined ? undefined : GLB_MODELS[id]
if (def === undefined) throw new Error(`用法：livery-faces.ts <機種 id> [輸出.json]；id 是 ${Object.keys(GLB_MODELS).join('、')}`)

const buf = readFileSync(`public${def.url}`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const scene = await new Promise<Group>((res, rej) => {
  createGltfLoader().parse(bytes, '', (g) => res(g.scene), rej)
})
scene.updateMatrixWorld(true)

const L: LiveryLayout = def.livery ?? { url: '', scale: 1, planZ: 0, sideY: 0 }
const faces: { view: string; pts: number[][]; node: string; part: string | null }[] = []
const box = new Box3()
scene.traverse((o: Object3D) => {
  const mesh = o as Mesh
  if (!mesh.isMesh) return
  const kind = def.materials[(mesh.material as Material).name]
  let geo = mesh.geometry.clone()
  geo.applyMatrix4(mesh.matrixWorld)
  if (geo.index !== null) geo = geo.toNonIndexed()
  const part = typeof mesh.userData['part'] === 'string' ? mesh.userData['part'] as string : null
  box.setFromBufferAttribute(geo.getAttribute('position') as never)
  const f = (v: number) => v.toFixed(2)
  console.log(`${mesh.name.padEnd(22)} ${String(kind).padEnd(8)} part=${String(part).padEnd(6)} tris=${String(geo.getAttribute('position').count / 3).padStart(5)}`
    + `  x ${f(box.min.x)}…${f(box.max.x)}  y ${f(box.min.y)}…${f(box.max.y)}  z ${f(box.min.z)}…${f(box.max.z)}`)
  if (kind !== 'body' || out === undefined) return
  applyLiveryUv(geo, L, liveryMoveFor(L, mesh.name, mesh.userData['part']), (view, px) => {
    faces.push({
      view,
      pts: [[px[0]!, px[1]!], [px[2]!, px[3]!], [px[4]!, px[5]!]],
      node: mesh.name,
      part,
    })
  })
})

if (out !== undefined) {
  writeFileSync(out, JSON.stringify({
    id, width: LIVERY_WIDTH, height: LIVERY_HEIGHT,
    scale: L.scale, planZ: L.planZ, sideY: L.sideY, moves: L.moves ?? [], url: L.url,
    faces,
  }))
  console.log(`${faces.length} 個機身色三角形 → ${out}`)
}
