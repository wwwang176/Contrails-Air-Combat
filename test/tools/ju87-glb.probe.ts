/**
 * Ju 87 的 GLB 走一遍 `parseGlbTemplate`：材質對得上、槳葉節點找得到、
 * 各材質的頂點數、包圍盒（翼展／全長／高度）、法線朝外（帶符號體積為正）。
 *   node scripts/compress-models.mjs && npx vite-node test/tools/ju87-glb.probe.ts
 */
import { readFileSync } from 'node:fs'
import { Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'
import { parseGlbTemplate, buildFromTemplate } from '../../src/render/geometry/glb'
import { JU87_MODEL } from '../../src/render/geometry/ju87.model'

const buf = readFileSync(`public${JU87_MODEL.url}`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const t = await parseGlbTemplate(bytes, JU87_MODEL)
const model = buildFromTemplate(t)
model.group.updateMatrixWorld(true)

const byMat = new Map<string, number>()
const min = new Vector3(Infinity, Infinity, Infinity), max = new Vector3(-Infinity, -Infinity, -Infinity)
const v = new Vector3()
let spinning = 0
function signedVolume(m: Mesh, shift = 0): number {
  const p = m.geometry.getAttribute('position'); const idx = m.geometry.index
  const n = idx ? idx.count : p.count
  const at = (i: number): number => (idx ? idx.getX(i) : i)
  const a = new Vector3(), b = new Vector3(), c = new Vector3()
  let vol = 0
  for (let i = 0; i < n; i += 3) {
    a.fromBufferAttribute(p, at(i)); b.fromBufferAttribute(p, at(i + 1)); c.fromBufferAttribute(p, at(i + 2))
    a.z += shift; b.z += shift; c.z += shift
    vol += a.dot(b.clone().cross(c)) / 6
  }
  return vol
}
// 【平移到遠處再算一次】對原點取的帶符號體積，離原點近的零件纏繞反了也只差一點點；
// 兩次的值一樣才表示封閉而且朝外（技能坑 66）
const vols: string[] = []
const parts: string[] = []
let tris = 0
model.group.traverse((o: Object3D) => {
  const m = o as Mesh
  if (!m.isMesh) return
  const mat = m.material as MeshStandardMaterial
  const key = `${mat.color.getHexString()}${mat.transparent ? '/glass' : ''}${m.userData['inwardShell'] ? '/inward' : ''}${m.userData['spinning'] ? '/spin' : ''}`
  const p = m.geometry.getAttribute('position')
  byMat.set(key, (byMat.get(key) ?? 0) + p.count)
  tris += (m.geometry.index ? m.geometry.index.count : p.count) / 3
  if (m.userData['spinning']) spinning++
  if (typeof m.userData['part'] === 'string') parts.push(m.userData['part'] as string)
  if (!m.userData['spinning'] && !m.userData['inwardShell']) {
    vols.push(`${key} ${signedVolume(m).toFixed(3)} / 平移 20 m ${signedVolume(m, 20).toFixed(3)}`)
  }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld)
    min.min(v); max.max(v)
  }
})
console.log('材質/頂點數', Object.fromEntries(byMat))
console.log('三角形', tris, 'spinning mesh 數', spinning, 'part', parts)
console.log('包圍盒 min', min.toArray().map((x) => +x.toFixed(3)), 'max', max.toArray().map((x) => +x.toFixed(3)))
console.log('翼展', (max.x - min.x).toFixed(3), '全長', (max.z - min.z).toFixed(3), '高', (max.y - min.y).toFixed(3))
console.log('metrics', t.metrics)
console.log('帶符號體積（非槳、非內殼）', vols)
model.setPropSpin(1, true)
