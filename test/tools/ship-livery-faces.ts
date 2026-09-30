/**
 * 船的塗裝版面倒出來給畫貼圖的腳本（`tools/livery/ship_*.py`）用。
 *
 *   npx vite-node test/tools/ship-livery-faces.ts -- <艦級 id> <輸出.json>
 *
 * 輸出：版面參數、各區的像素矩形，與每一個船身／甲板三角形的區與像素座標。
 * 投影走 `shipLivery.ts` 的同一支 `applyShipLiveryUv`，所以與遊戲裡算的 UV 逐點相同。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import type { Group, Material, Mesh, Object3D } from 'three'
import { createGltfLoader } from '../../src/render/geometry/gltfLoader'
import { SHIP_LIVERIES } from '../../src/render/shipLiveries'
import {
  SHIP_LIVERY_HEIGHT, SHIP_LIVERY_WIDTH, applyShipLiveryUv, shipLiveryRects,
} from '../../src/render/shipLivery'
import { SHIP_CLASSES, type ShipClassId } from '../../src/world/ships'

const argv = process.argv.slice(2).filter((a) => a !== '--')
const [id, out] = argv as [ShipClassId | undefined, string | undefined]
const def = id === undefined ? undefined : SHIP_LIVERIES[id]
if (id === undefined || def === undefined || out === undefined) {
  throw new Error(`用法：ship-livery-faces.ts <艦級 id> <輸出.json>；id 是 ${Object.keys(SHIP_LIVERIES).join('、')}`)
}

const buf = readFileSync(`public${SHIP_CLASSES[id].url}`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const scene = await new Promise<Group>((res, rej) => {
  createGltfLoader().parse(bytes, '', (g) => res(g.scene), rej)
})
scene.updateMatrixWorld(true)

/** `pos` 是三個頂點的艦體座標，`node` 是 GLB 節點名 —— 畫圖腳本拿來量船殼輪廓 */
const faces: { strip: string; node: string; pts: number[][]; pos: number[][] }[] = []
scene.traverse((o: Object3D) => {
  const mesh = o as Mesh
  if (!mesh.isMesh) return
  const kind = def.kinds[(mesh.material as Material).name]
  if (kind !== 'body' && kind !== 'deck') return
  let geo = mesh.geometry.clone()
  geo.applyMatrix4(mesh.matrixWorld)
  if (geo.index !== null) geo = geo.toNonIndexed()
  const p = geo.getAttribute('position')
  let i = 0
  applyShipLiveryUv(geo, kind, def.layout, (strip, px) => {
    faces.push({
      strip, node: mesh.name,
      pts: [[px[0]!, px[1]!], [px[2]!, px[3]!], [px[4]!, px[5]!]],
      pos: [0, 1, 2].map((k) => [p.getX(i + k), p.getY(i + k), p.getZ(i + k)]),
    })
    i += 3
  })
})

writeFileSync(out, JSON.stringify({
  id, width: SHIP_LIVERY_WIDTH, height: SHIP_LIVERY_HEIGHT,
  layout: def.layout, rects: shipLiveryRects(def.layout), faces,
}))
console.log(`${out}：${faces.length} 個面`)
