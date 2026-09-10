/**
 * 每一種機的**繪製成本**：走一遍 `parseGlbTemplate` + `buildFromTemplate`，
 * 數建出來的網格數（＝ draw call）與三角形數，依三角形排。
 *   npx vite-node test/tools/aircraft-cost.probe.ts
 *
 * 【為什麼要靜態數而不是在遊戲裡量】遊戲裡 `renderer.info` 是全場的合計，
 * 而場上同時有轟炸機、護航與敵機 —— 攤不出「一架 B-17 要幾個 draw call」。
 *
 * 【螺旋槳那幾片也算】它們是同一顆模型的節點，跟著一起畫。分開列出來是因為
 * 它們是**每一具引擎各一片**，四發機那一項就是四倍。
 */
import { readFileSync } from 'node:fs'
import { Mesh, Object3D } from 'three'
import { parseGlbTemplate, buildFromTemplate } from '../../src/render/geometry/glb'
import type { GlbAircraft } from '../../src/render/geometry/glb'
import { A6M5_MODEL } from '../../src/render/geometry/a6m5.model'
import { B17G_MODEL } from '../../src/render/geometry/b17g.model'
import { BF109K4_MODEL } from '../../src/render/geometry/bf109k4.model'
import { F4F4_MODEL } from '../../src/render/geometry/f4f4.model'
import { F6F5_MODEL } from '../../src/render/geometry/f6f5.model'
import { G4M_MODEL } from '../../src/render/geometry/g4m.model'
import { HE111_MODEL } from '../../src/render/geometry/he111.model'
import { KI84_MODEL } from '../../src/render/geometry/ki84.model'
import { P51D_MODEL } from '../../src/render/geometry/p51d.model'

const MODELS: { readonly name: string; readonly model: GlbAircraft }[] = [
  { name: 'B-17G', model: B17G_MODEL },
  { name: 'He 111', model: HE111_MODEL },
  { name: 'G4M', model: G4M_MODEL },
  { name: 'P-51D', model: P51D_MODEL },
  { name: 'Bf 109K-4', model: BF109K4_MODEL },
  { name: 'F4F-4', model: F4F4_MODEL },
  { name: 'F6F-5', model: F6F5_MODEL },
  { name: 'A6M5', model: A6M5_MODEL },
  { name: 'Ki-84', model: KI84_MODEL },
]

interface Row {
  readonly name: string
  readonly meshes: number
  readonly tris: number
  readonly kib: number
  readonly parts: string
}

const rows: Row[] = []
for (const { name, model } of MODELS) {
  const buf = readFileSync(`public${model.url}`)
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  const t = await parseGlbTemplate(bytes, model)
  const built = buildFromTemplate(t)
  built.group.updateMatrixWorld(true)
  let meshes = 0
  let tris = 0
  const byMesh: { n: string; t: number }[] = []
  built.group.traverse((o: Object3D) => {
    const m = o as Mesh
    if (m.isMesh !== true) return
    const p = m.geometry.getAttribute('position')
    if (p === undefined) return
    const idx = m.geometry.index
    const n = (idx === null ? p.count : idx.count) / 3
    meshes++
    tris += n
    byMesh.push({ n: m.name === '' ? '(無名)' : m.name, t: n })
  })
  byMesh.sort((a, b) => b.t - a.t)
  rows.push({
    name,
    meshes,
    tris,
    kib: buf.byteLength / 1024,
    parts: byMesh.slice(0, 4).map((b) => `${b.n} ${b.t.toLocaleString()}`).join('、'),
  })
}

rows.sort((a, b) => b.tris - a.tris)
console.log('==== 每一架的繪製成本 ====')
console.log('  機種          網格  三角形      GLB     最重的幾塊')
for (const r of rows) {
  console.log(`  ${r.name.padEnd(12)} ${String(r.meshes).padStart(4)}`
    + `  ${r.tris.toLocaleString().padStart(8)}`
    + `  ${r.kib.toFixed(0).padStart(5)} KiB`
    + `   ${r.parts}`)
}

const b17 = rows.find((r) => r.name === 'B-17G')!
const p51 = rows.find((r) => r.name === 'P-51D')!
console.log(`\n  洛伊納一關的空中編制：B-17 十二架 ＋ P-51 四架 ＋ Bf 109 四架`)
const k4 = rows.find((r) => r.name === 'Bf 109K-4')!
const total = b17.meshes * 12 + p51.meshes * 4 + k4.meshes * 4
const totalTris = b17.tris * 12 + p51.tris * 4 + k4.tris * 4
console.log(`  全部同時在畫面裡：${total} 個 draw call、${totalTris.toLocaleString()} 個三角形`)
console.log(`  其中 B-17 占 ${b17.meshes * 12} 個 draw call`
  + `（${((b17.meshes * 12 / total) * 100).toFixed(0)}%）`
  + `、${(b17.tris * 12).toLocaleString()} 個三角形`
  + `（${((b17.tris * 12 / totalTris) * 100).toFixed(0)}%）`)
