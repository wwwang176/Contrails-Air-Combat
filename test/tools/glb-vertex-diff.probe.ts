/**
 * GLB 機種 vs 程式版：世界座標的頂點集合逐一對照。
 *   npx vite-node test/tools/glb-vertex-diff.probe.ts he111
 * 報：兩邊頂點數、GLB 裡在程式版找不到同位置（1e-5）的頂點數與最遠距離。
 * 槳盤（載入時重做的 CircleGeometry）與隱藏物件都排除。
 */
import { readFileSync } from 'node:fs'
import { Mesh, Object3D, Vector3 } from 'three'
import { parseGlbTemplate } from '../../src/render/geometry/glb'
import { buildHe111 } from '../../src/render/geometry/he111'
import { buildB17G } from '../../src/render/geometry/b17g'
import { HE111_MODEL } from '../../src/render/geometry/he111.model'
import { B17G_MODEL } from '../../src/render/geometry/b17g.model'

declare const process: { argv: readonly string[] }
const id = process.argv[2] ?? 'he111'
const { build, def } = id === 'b17g'
  ? { build: buildB17G, def: B17G_MODEL } : { build: buildHe111, def: HE111_MODEL }

function verts(root: Object3D): Vector3[] {
  root.updateMatrixWorld(true)
  const out: Vector3[] = []
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh || !m.visible) return
    if (m.geometry.type === 'CircleGeometry') return
    const p = m.geometry.getAttribute('position')
    for (let i = 0; i < p.count; i++) {
      out.push(new Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(m.matrixWorld))
    }
  })
  return out
}

const buf = readFileSync(`public${def.url}`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const t = await parseGlbTemplate(bytes, def)
const a = verts(build().group)
const b = verts(t.group)
const key = (v: Vector3): string => `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`
const setA = new Set(a.map(key))
const cell = (v: Vector3): string =>
  `${Math.round(v.x * 100)},${Math.round(v.y * 100)},${Math.round(v.z * 100)}`
const grid = new Map<string, Vector3[]>()
for (const v of a) {
  const c = cell(v)
  const list = grid.get(c)
  if (list) list.push(v)
  else grid.set(c, [v])
}
let missing = 0
let maxD = 0
for (const v of b) {
  if (setA.has(key(v))) continue
  let best = Infinity
  const cx = Math.round(v.x * 100), cy = Math.round(v.y * 100), cz = Math.round(v.z * 100)
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        for (const w of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          best = Math.min(best, v.distanceTo(w))
        }
      }
    }
  }
  if (best > 1e-5) { missing++; maxD = Math.max(maxD, best) }
}
console.log(`${id}: 程式版 ${a.length} 頂點、GLB ${b.length} 頂點；`
  + `GLB 裡 1e-5 內找不到對應的 ${missing} 個，最遠 ${maxD.toExponential(2)} m`)
console.log(`  位置去重後：程式版 ${new Set(a.map(key)).size}、GLB ${new Set(b.map(key)).size}`)
