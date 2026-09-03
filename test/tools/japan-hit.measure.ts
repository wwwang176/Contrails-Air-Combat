/**
 * 三台日本機的槍口站位與命中盒粗切量測。**不是測試，不斷言任何事。**
 *
 * 跑法：`ID=ki84 npx vite-node test/tools/japan-hit.measure.ts`
 *       （`ID` 可以是 `ki84`／`a6m5`／`g4m`，省略即 `ki84`）
 *
 * 【為什麼直接讀 GLB 的節點而不是 `buildAircraft`】`parseGlbTemplate` 會按
 * 材質把零件併起來，併完就分不出哪些點是機身、哪些是機翼。與
 * `f6f-hit.measure.ts` 同一個理由。
 *
 * ── 印出來的四段 ────────────────────────────────────────────
 *
 *   零件包圍盒      GLB 裡每個節點的範圍
 *   機身縱剖        逐 z 的背線、腹線與半寬 —— **機首同調槍的依據**
 *   機翼前緣        逐展向站位的前緣 z、弦線 y、弦長 —— **翼砲的依據**
 *   逐 z 帶         機身類零件的實際幅度 —— **手切機首／座艙／機身盒的依據**
 */
import { readFileSync } from 'node:fs'
import { Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

declare const process: { env: Record<string, string | undefined> }

const ID = process.env['ID'] ?? 'ki84'
const buf = readFileSync(`public/models/${ID}.glb`)
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const scene = await new Promise<import('three').Group>((res, rej) => {
  new GLTFLoader().parse(bytes, '', (g) => res(g.scene), rej)
})
scene.updateMatrixWorld(true)

const parts = new Map<string, Vector3[]>()
const all: Vector3[] = []
scene.traverse((o) => {
  const mesh = o as Mesh
  const pos = mesh.geometry?.getAttribute?.('position')
  if (!pos) return
  const name = o.name.replace(/^(KI84|A6M5|G4M)_?/i, '').replace(/\d+(_\d+)?$/, '') || o.name
  const list = parts.get(name) ?? []
  for (let i = 0; i < pos.count; i++) {
    const v = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld)
    list.push(v)
    all.push(v)
  }
  parts.set(name, list)
})

const f = (v: number): string => v.toFixed(3).padStart(7)
const bbox = (l: readonly Vector3[]): string => {
  const a = new Vector3(Infinity, Infinity, Infinity), b = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of l) { a.min(p); b.max(p) }
  return `X${f(a.x)}…${f(b.x)}  Y${f(a.y)}…${f(b.y)}  Z${f(a.z)}…${f(b.z)}`
}

console.log(`\n══ ${ID} ══\n── 零件包圍盒 ──`)
for (const [n, l] of parts) console.log(`${n.padEnd(12)} ${String(l.length).padStart(5)} 點  ${bbox(l)}`)

const zLo = Math.min(...all.map((p) => p.z))
const zHi = Math.max(...all.map((p) => p.z))
const xHi = Math.max(...all.map((p) => Math.abs(p.x)))

// ── 機身縱剖：只取中軸附近的點 ──
console.log('\n── 機身縱剖（|x| ≤ 0.30）──\n    z      背線 y   腹線 y')
for (let z = zLo; z <= zHi; z += 0.2) {
  const band = all.filter((p) => Math.abs(p.z - z) < 0.1 && Math.abs(p.x) <= 0.30)
  if (!band.length) continue
  console.log(`${f(z)}  ${f(Math.max(...band.map((p) => p.y)))}  ${f(Math.min(...band.map((p) => p.y)))}`)
}

// ── 機翼前緣：右翼逐站。**只掃 Wing 那個節點**，混進機身就量不準 ──
const wing = parts.get('Wing') ?? []
console.log('\n── 右翼逐站 ──\n    x     前緣 z   後緣 z   弦長    弦線 y   下表面最低 y')
for (let x = 0.4; x <= xHi; x += 0.1) {
  const band = wing.filter((p) => Math.abs(p.x - x) < 0.05)
  if (band.length < 8) continue
  const le = Math.min(...band.map((p) => p.z))
  const te = Math.max(...band.map((p) => p.z))
  const atLe = band.filter((p) => p.z < le + 0.06)
  console.log(`${f(x)}  ${f(le)}  ${f(te)}  ${f(te - le)}`
    + `  ${f(atLe.reduce((s, p) => s + p.y, 0) / atLe.length)}`
    + `  ${f(Math.min(...band.map((p) => p.y)))}`)
}

// ── 逐 z 帶：機身類零件的實際幅度 ──
const WING = /wing|tail|plane|fin|prop/i
const body = [...parts].filter(([n]) => !WING.test(n)).flatMap(([, l]) => l)
console.log('\n── 逐 z 帶：機身類零件的 |x|max、ymax、ymin ──\n   z帶            |x|max   ymax    ymin')
for (let z = zLo; z < zHi; z += 0.3) {
  const b = body.filter((p) => p.z >= z && p.z < z + 0.3)
  if (!b.length) continue
  console.log(`${f(z)}…${f(z + 0.3)}  ${f(Math.max(...b.map((p) => Math.abs(p.x))))}`
    + `  ${f(Math.max(...b.map((p) => p.y)))}  ${f(Math.min(...b.map((p) => p.y)))}`)
}
console.log()
