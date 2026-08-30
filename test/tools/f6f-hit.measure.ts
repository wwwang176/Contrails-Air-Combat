/**
 * F6F-5 的命中盒與槍口站位量測。**不是測試，不斷言任何事。**
 *
 * 跑法：`npx vite-node test/tools/f6f-hit.measure.ts`
 * 切分平面可以掃：`ZFW=-1.2 ZTAIL=5.4 XSIDE=0.8 npx vite-node …`
 *
 * 【為什麼直接讀 GLB 的節點而不是 `buildAircraft`】`parseGlbTemplate` 會
 * 按材質把八個零件併成三個 mesh，併完就分不出哪些點是機身、哪些是機翼。
 * 命中盒是「哪一段是引擎、哪一段是機身」的切分，非得逐零件不可。
 *
 * ── 印出來的六段 ────────────────────────────────────────────
 *
 *   零件包圍盒        八個節點各自的範圍
 *   逐軸切片          機身縱剖、座艙、機翼與尾翼的展向剖面
 *   機翼前緣          每個展向站位的前緣 z / 前緣 y / 弦長 —— **槍位的依據**
 *   現行命中盒        `specs/f6f5.ts` 那六個盒的覆蓋率與體積佔比
 *   緊包圍盒          依三個切分平面反推「剛好包住」的六個盒 —— **改盒的依據**
 *   槍口 vs 命中盒    每個槍口落在哪個盒裡（空的就是子彈從機體外冒出來）
 */
import { readFileSync } from 'node:fs'
import { Mesh, Vector3 } from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { F6F5 } from '../../src/specs/f6f5'

declare const process: { env: Record<string, string | undefined> }

const buf = readFileSync('public/models/f6f5.glb')
const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
const scene = await new Promise<import('three').Group>((res, rej) => {
  new GLTFLoader().parse(bytes, '', (g) => res(g.scene), rej)
})
scene.updateMatrixWorld(true)

const parts = new Map<string, Vector3[]>()
scene.traverse((o) => {
  const mesh = o as Mesh
  const pos = mesh.geometry?.getAttribute?.('position')
  if (!pos) return
  // 一個節點有多個 primitive 時 three 會拆成 `F6F_Fuselage034`、
  // `…_1` 這樣的子物件，所以把尾碼也去掉，讓同一個零件併回一筆
  const name = o.name.replace(/^F6F_/, '').replace(/\d+(_\d+)?$/, '')
  const list = parts.get(name) ?? []
  for (let i = 0; i < pos.count; i++) {
    list.push(new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld))
  }
  parts.set(name, list)
})

const f = (v: number): string => v.toFixed(3).padStart(7)
const bbox = (list: readonly Vector3[]): string => {
  const a = new Vector3(Infinity, Infinity, Infinity), b = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of list) { a.min(p); b.max(p) }
  return `X${f(a.x)}…${f(b.x)}  Y${f(a.y)}…${f(b.y)}  Z${f(a.z)}…${f(b.z)}`
}
console.log('── 零件包圍盒 ──')
for (const [n, l] of parts) console.log(`${n.padEnd(11)} ${String(l.length).padStart(5)} 點  ${bbox(l)}`)

/** 逐段掃一個零件：沿 axis 切段，印出另外兩軸的幅度。 */
function slice(name: string, axis: 'x' | 'y' | 'z', step: number, abs = false): void {
  const l = parts.get(name)
  if (!l) return
  const key = (p: Vector3): number => (abs ? Math.abs(p[axis]) : p[axis])
  const lo = Math.floor(Math.min(...l.map(key)) / step) * step
  const hi = Math.max(...l.map(key))
  const other = (['x', 'y', 'z'] as const).filter((k) => k !== axis)
  console.log(`\n── ${name}：沿 ${axis}${abs ? '（取絕對值）' : ''} 每 ${step} m ──`)
  console.log(`   ${axis} 段` + other.map((k) => `      ${k} 下     ${k} 上`).join('') + '   點數')
  for (let t = lo; t < hi + 1e-9; t += step) {
    const seg = l.filter((p) => key(p) >= t - 1e-9 && key(p) < t + step - 1e-9)
    if (!seg.length) continue
    const cols = other.map((k) => `${f(Math.min(...seg.map((p) => p[k])))} ${f(Math.max(...seg.map((p) => p[k])))}`)
    console.log(`${f(t)}…${f(t + step)}  ${cols.join('  ')}  ${String(seg.length).padStart(5)}`)
  }
}
slice('Fuselage', 'z', 0.25)
slice('CowlFace', 'z', 0.10)
slice('Canopy', 'z', 0.10)
slice('Wing', 'x', 0.25)
slice('Tailplane', 'x', 0.25)
slice('Fin', 'z', 0.25)

// ── 機翼前緣：每 0.10 m 一站，前緣 z 與該處的 y ────────────────────────
console.log('\n── 機翼前緣（右半）──')
console.log('     x     前緣 z   前緣 y   後緣 z    弦     厚 下     厚 上')
{
  const w = parts.get('Wing')!.filter((p) => p.x > 0)
  const xs = [...new Set(w.map((p) => +p.x.toFixed(4)))].sort((a, b) => a - b)
  for (const x of xs) {
    const seg = w.filter((p) => Math.abs(p.x - x) < 1e-3)
    const z0 = Math.min(...seg.map((p) => p.z)), z1 = Math.max(...seg.map((p) => p.z))
    const le = seg.filter((p) => p.z < z0 + 1e-3)
    const ly = le.reduce((a, p) => a + p.y, 0) / le.length
    console.log(`${f(x)}  ${f(z0)}  ${f(ly)}  ${f(z1)}  ${f(z1 - z0)}  ${f(Math.min(...seg.map((p) => p.y)))} ${f(Math.max(...seg.map((p) => p.y)))}`)
  }
}

// ── 現行命中盒的覆蓋率 ────────────────────────────────────────────
const all: { p: Vector3; part: string }[] = []
for (const [n, l] of parts) {
  // 【只排除 Prop】整流罩頭錐（`Spinner`）**不轉**，`glb.ts` 只把
  // `F6F_Prop` 標成 spinning，所以它是靜態幾何，命中盒得包住它
  if (n === 'Prop') continue
  for (const p of l) all.push({ p, part: n })
}
const inside = (v: Vector3, b: { center: Vector3; half: Vector3 }): boolean =>
  Math.abs(v.x - b.center.x) <= b.half.x && Math.abs(v.y - b.center.y) <= b.half.y
  && Math.abs(v.z - b.center.z) <= b.half.z
console.log('\n── 現行命中盒 ──')
let volume = 0
for (const b of F6F5.hitBoxes) {
  volume += 8 * b.half.x * b.half.y * b.half.z
  const lo = b.center.clone().sub(b.half), hi = b.center.clone().add(b.half)
  console.log(`${b.part.padEnd(10)} X${f(lo.x)}…${f(hi.x)} Y${f(lo.y)}…${f(hi.y)} Z${f(lo.z)}…${f(hi.z)}  含 ${all.filter((v) => inside(v.p, b)).length} 點`)
}
const a = new Vector3(Infinity, Infinity, Infinity), b2 = new Vector3(-Infinity, -Infinity, -Infinity)
for (const v of all) { a.min(v.p); b2.max(v.p) }
const bboxVol = (b2.x - a.x) * (b2.y - a.y) * (b2.z - a.z)
console.log(`體積合計 ${volume.toFixed(1)} m³ / 整機包圍盒 ${bboxVol.toFixed(1)} m³ = ${(100 * volume / bboxVol).toFixed(0)}%`)
const missed = all.filter((v) => !F6F5.hitBoxes.some((b) => inside(v.p, b)))
console.log(`漏網 ${missed.length} 點`)
const byPart = new Map<string, Vector3[]>()
for (const v of missed) byPart.set(v.part, [...(byPart.get(v.part) ?? []), v.p])
for (const [n, l] of byPart) console.log(`   ${n.padEnd(11)} ${String(l.length).padStart(4)} 點  ${bbox(l)}`)


// ── 依切分平面反推「剛好包住」的六個盒 ────────────────────────────
const ZFW = Number(process.env['ZFW'] ?? -1.00)
const ZTAIL = Number(process.env['ZTAIL'] ?? 5.16)
const XSIDE = Number(process.env['XSIDE'] ?? 0.76)
console.log(`
── 切分 ZFW ${ZFW} / ZTAIL ${ZTAIL} / XSIDE ${XSIDE}：緊包圍盒 ──`)
const tight = (name: string, keep: (p: Vector3) => boolean): void => {
  const l = all.map((v) => v.p).filter(keep)
  if (!l.length) { console.log(`${name.padEnd(10)} 空`); return }
  const a2 = new Vector3(Infinity, Infinity, Infinity), b3 = new Vector3(-Infinity, -Infinity, -Infinity)
  for (const p of l) { a2.min(p); b3.max(p) }
  console.log(`${name.padEnd(10)} [${f(a2.x)},${f(a2.y)},${f(a2.z)}] [${f(b3.x)},${f(b3.y)},${f(b3.z)}]  ${l.length} 點`)
}
tight('engine', (p) => p.z <= ZFW)
tight('fuselage', (p) => p.z >= ZFW && p.z <= ZTAIL && Math.abs(p.x) <= XSIDE)
tight('tail', (p) => p.z >= ZTAIL)
tight('wingRight', (p) => p.x >= XSIDE && p.z < ZTAIL)
tight('cockpit', (p) => Math.abs(p.x) <= 0.50 && p.z >= 0.28 && p.z <= 1.46 && p.y >= 0.05)
// 機身盒不必包座艙罩 —— 覆蓋是六個盒的**聯集**
tight('fuselage（扣掉座艙盒管的）', (p) => p.z >= ZFW && p.z <= ZTAIL && Math.abs(p.x) <= XSIDE
  && !(Math.abs(p.x) <= 0.50 && p.z >= 0.28 && p.z <= 1.46 && p.y >= 0.05))

// ── 槍口 ──────────────────────────────────────────────────────────
console.log('\n── 槍口 vs 命中盒 ──')
for (const mt of F6F5.battery.mounts) {
  const hit = F6F5.hitBoxes.filter((b) => inside(mt.position, b)).map((b) => b.part)
  console.log(`  ${f(mt.position.x)} ${f(mt.position.y)} ${f(mt.position.z)}  ${hit.join(',') || '★ 不在任何盒內'}`)
}
