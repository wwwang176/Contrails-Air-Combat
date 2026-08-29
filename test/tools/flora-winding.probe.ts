/**
 * 植被幾何的三角形繞序：面法線是朝外還是朝內。不是測試。
 *
 * 判準是「面法線與『面心減去包圍盒中心』的內積」。這些形狀都是凸的（或
 * 幾乎是凸的），所以朝外的話內積為正。用包圍盒中心而不是中軸，頂蓋與底蓋
 * 才判得準。
 *
 * 跑法：`node node_modules/vite-node/vite-node.mjs test/tools/flora-winding.probe.ts`
 */
import { Vector3 } from 'three'
import {
  createFloraGeometries, disposeFloraGeometries, type PoolName,
} from '../../src/render/floraShapes'

const geo = createFloraGeometries()

const a = new Vector3()
const b = new Vector3()
const c = new Vector3()
const ab = new Vector3()
const ac = new Vector3()
const n = new Vector3()
const mid = new Vector3()

console.log('\n  面法線朝外／朝內（朝外 = 與離軸方向同向）\n')
console.log('   幾何          面數   朝外   朝內   水平面（不算）')
for (const name of Object.keys(geo) as PoolName[]) {
  const g = geo[name]
  g.computeBoundingBox()
  const centre = g.boundingBox!.getCenter(new Vector3())
  const pos = g.getAttribute('position')
  let out = 0
  let inward = 0
  let flat = 0
  for (let f = 0; f < pos.count / 3; f++) {
    a.fromBufferAttribute(pos, f * 3)
    b.fromBufferAttribute(pos, f * 3 + 1)
    c.fromBufferAttribute(pos, f * 3 + 2)
    // three 的 computeVertexNormals：(C - B) × (A - B)
    ab.subVectors(c, b)
    ac.subVectors(a, b)
    n.crossVectors(ab, ac)
    mid.copy(a).add(b).add(c).multiplyScalar(1 / 3).sub(centre)
    if (mid.length() < 1e-6) { flat++; continue }
    if (n.dot(mid) > 0) out++
    else inward++
  }
  console.log(
    `   ${name.padEnd(12)} ${String(pos.count / 3).padStart(5)}`
    + `  ${String(out).padStart(5)}  ${String(inward).padStart(5)}  ${String(flat).padStart(8)}`)
}
console.log('')
disposeFloraGeometries(geo)

// ── 有號體積 ───────────────────────────────────────────────
// 面法線朝外時 Σ a·(b×c) / 6 為正。對非凸的形狀（教堂：本堂 ＋ 高塔）也成立，
// 所以它比「面心離中心」那個判準可靠。
const g2 = createFloraGeometries()
const va = new Vector3()
const vb = new Vector3()
const vc = new Vector3()
const cr = new Vector3()
console.log('  有號體積（朝外為正）\n')
console.log('   幾何          體積 m³')
for (const name of Object.keys(g2) as PoolName[]) {
  const pos = g2[name].getAttribute('position')
  let vol = 0
  for (let f = 0; f < pos.count / 3; f++) {
    va.fromBufferAttribute(pos, f * 3)
    vb.fromBufferAttribute(pos, f * 3 + 1)
    vc.fromBufferAttribute(pos, f * 3 + 2)
    vol += va.dot(cr.crossVectors(vb, vc)) / 6
  }
  console.log(`   ${name.padEnd(12)} ${vol.toFixed(1).padStart(10)}`)
}
console.log('')
disposeFloraGeometries(g2)
