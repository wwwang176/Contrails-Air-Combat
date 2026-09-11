/**
 * 波爾塔瓦機場上那些**停放的飛機**值多少三角形。
 *   npx vite-node test/tools/parked-cost.probe.ts
 *
 * 【在問什麼】玩家回報鏡頭靠近機場（尤其看得到 B-17 時）幀率腰斬。停放的
 * 飛機是 `bakeParkedAircraft` 烘成的**一顆**網格，所以 draw call 只有一架
 * 一個 —— 貴的只可能是三角形。24 架乘起來要跟整個場景的總數比才知道佔多少。
 */
import { readFileSync } from 'node:fs'
import { Mesh, type Object3D } from 'three'
import { parseGlbTemplate, buildFromTemplate } from '../../src/render/geometry/glb'
import { B17G_MODEL } from '../../src/render/geometry/b17g.model'
import { PARKED_ROWS } from '../../src/world/poltava'

const buf = readFileSync(`public${B17G_MODEL.url}`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const t = await parseGlbTemplate(bytes, B17G_MODEL)
const built = buildFromTemplate(t)
built.group.updateMatrixWorld(true)

/**
 * 烘進停放網格的三角形。**槳盤不烘**（停著的飛機只有槳葉），所以那四片
 * 16 面的透明圓盤要扣掉 —— 見 `parked.ts` 的說明。
 */
let all = 0
let discs = 0
built.group.traverse((o: Object3D) => {
  const m = o as Mesh
  if (m.isMesh !== true) return
  const p = m.geometry.getAttribute('position')
  if (p === undefined) return
  const idx = m.geometry.index
  const n = (idx === null ? p.count : idx.count) / 3
  all += n
  const mat = m.material as { transparent?: boolean }
  if (mat.transparent === true && n <= 16) discs += n
})
const parked = all - discs

const count = PARKED_ROWS.length
console.log('==== 停放的 B-17 ====')
console.log(`  一架烘出來 ${parked.toLocaleString()} 個三角形（整份 GLB ${all.toLocaleString()}，扣掉槳盤 ${discs}）`)
console.log(`  機場上 ${count} 架　→　${(parked * count).toLocaleString()} 個三角形、${count} 個 draw call`)
console.log('')
console.log('  對照：實測整個場景（鏡頭在機場上方）是 503,537～544,137 個三角形')
console.log(`  也就是說停放的 B-17 占全場的 ${((parked * count / 520000) * 100).toFixed(0)}%`)
