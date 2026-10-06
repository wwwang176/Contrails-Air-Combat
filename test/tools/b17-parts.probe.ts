/**
 * B-17G 那 24 個網格各是什麼：三角形數、材質、可見性、是不是會轉的槳。
 *   npx vite-node test/tools/b17-parts.probe.ts
 *
 * 【在問什麼】一架 24 個 draw call、十二架就 288 個，而三角形只有 13,315 ——
 * 平均一個 draw call 才 555 個三角形。要知道那 24 塊裡有幾塊是**同材質、
 * 不會動**的，因為只有那些併得起來。
 *
 * 【會轉的併不得】螺旋槳每幀繞自己的軸轉，併進機身就跟著機身不動了。
 * 材質不同的也併不得 —— 一次 draw call 只綁一個材質。
 */
import { readFileSync } from 'node:fs'
import { Mesh, MeshStandardMaterial, Object3D } from 'three'
import { parseGlbTemplate, buildFromTemplate } from '../../src/render/geometry/glb'
import { B17G_MODEL } from '../../src/render/geometry/b17g.model'

const buf = readFileSync(`public${B17G_MODEL.url}`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const t = await parseGlbTemplate(bytes, B17G_MODEL)
const built = buildFromTemplate(t)
built.group.updateMatrixWorld(true)

interface Part {
  readonly tris: number
  readonly mat: string
  readonly colour: string
  readonly spins: boolean
  readonly visible: boolean
  readonly transparent: boolean
}

const parts: Part[] = []
built.group.traverse((o: Object3D) => {
  const m = o as Mesh
  if (m.isMesh !== true) return
  const p = m.geometry.getAttribute('position')
  if (p === undefined) return
  const idx = m.geometry.index
  const mat = m.material as MeshStandardMaterial
  parts.push({
    tris: (idx === null ? p.count : idx.count) / 3,
    mat: mat.name === '' ? '(無名)' : mat.name,
    colour: '#' + mat.color.getHexString(),
    // 與模型動畫共用標記；props 是建構函式的內部資料，不是 AircraftModel 介面。
    spins: m.userData['spinning'] === true,
    visible: o.visible,
    transparent: mat.transparent === true,
  })
})
parts.sort((a, b) => b.tris - a.tris)

console.log(`==== B-17G 的 ${parts.length} 個網格 ====`)
console.log('   三角形   材質        顏色      會轉  可見  半透明')
for (const p of parts) {
  console.log(`  ${p.tris.toLocaleString().padStart(7)}   ${p.mat.padEnd(11)} ${p.colour.padEnd(9)}`
    + ` ${(p.spins ? '是' : '  ').padEnd(4)}  ${(p.visible ? '是' : '否').padEnd(4)}`
    + `  ${p.transparent ? '是' : ''}`)
}

// 【併得起來的定義】同材質、不會轉、不透明。半透明的要照距離排序，併進
// 不透明那一塊會讓它整片變成不透明
const groups = new Map<string, { n: number; tris: number }>()
for (const p of parts) {
  if (p.spins || p.transparent) continue
  const key = `${p.mat} ${p.colour}`
  const g = groups.get(key) ?? { n: 0, tris: 0 }
  g.n++
  g.tris += p.tris
  groups.set(key, g)
}
console.log('\n  ── 同材質、不會轉、不透明的分組（這些併得起來）──')
let merged = 0
let kept = 0
for (const [k, g] of [...groups.entries()].sort((a, b) => b[1].tris - a[1].tris)) {
  console.log(`  ${String(g.n).padStart(3)} 塊　${g.tris.toLocaleString().padStart(7)} 三角形　${k}`)
  merged++
  kept += g.n
}
const rest = parts.length - kept
console.log('\n  網格數估算包含隱藏槳盤；實際 draw call 取決於可見性與渲染 pass。')
console.log(`  現在 ${parts.length} 個網格`
  + ` → 併完剩 ${merged + rest} 個（${merged} 組 ＋ ${rest} 個會轉或半透明的）`)
console.log(`  十二架：${parts.length * 12} → ${(merged + rest) * 12}`)
