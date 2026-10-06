/**
 * **產生貼合外形的命中盒，直接貼進 `specs/*.ts`。** 不是測試。
 *
 * 跑法：`npx vite-node test/tools/hitbox-emit.probe.ts`
 *
 * 分段數不是挑的，是**掃出來取轉折點**：段數再加一段、正後方投影面積改善
 * 不到 `KNEE` 就停。各機種的曲線在不同的地方轉折，因為那由網格自己的展向
 * 站位決定（K-4 的機翼只有幾站，切三段與切兩段是同一組盒）。
 *
 * 【機翼盒一定要包住槍口】翼槍的槍管伸在前緣之外（P-51D 0.35 m、F6F
 * 0.25/0.12/0.00 m）。純粹由網格頂點推出來的段盒不含它們，子彈會從機體外面
 * 冒出來 —— 所以切完之後要把落在該段展向範圍內的槍口併進去。
 *
 * 【發動機走找空隙不走等分】四具發動機之間本來就是空的。順帶修掉一個現行
 * 缺陷：B-17G 的單一發動機盒橫跨 x ±7.00，把兩具發動機之間那一大片**內翼**
 * 一起包了進去 —— 而倍率取最高，於是整片內翼現在都算 engine 2.0。
 */
import { Mesh, Vector3 } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { makeHitBox, type HitBox, type HitPart } from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { F6F5 } from '../../src/specs/f6f5'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import { KI84 } from '../../src/specs/ki84'
import { A6M5 } from '../../src/specs/a6m5'
import { G4M } from '../../src/specs/g4m'
import { F4F4 } from '../../src/specs/f4f4'
import { JU87 } from '../../src/specs/ju87'
import { YAK1B } from '../../src/specs/yak1b'
import type { AircraftSpec } from '../../src/specs/types'
import { cluster, grow, inBox, mergeEmpty, patchHoles, sliceWing, splitTail } from './hitbox-fit'
import { areaOf, boxTris } from './hitbox-projection'

await loadGlbTemplatesForNode()

const NACELLE_GAP = 0.60
/** 再多切一段的改善低於這個比例就停 */
const KNEE = 0.10
const MAX_SEG = 10

function mesh(spec: AircraftSpec): { pts: Vector3[]; tris: number[][] } {
  const m = buildAircraft(spec)
  m.group.updateMatrixWorld(true)
  const pts: Vector3[] = []
  const tris: number[][] = []
  m.group.traverse((o) => {
    if (o.userData['spinning']) return
    const g = (o as Mesh).geometry
    const pos = g?.getAttribute?.('position')
    if (!pos) return
    const base = pts.length
    const v = new Vector3()
    for (let i = 0; i < pos.count; i++) {
      pts.push(v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld).clone())
    }
    const idx = g.getIndex()
    const count = idx ? idx.count : pos.count
    for (let k = 0; k + 2 < count; k += 3) {
      const a = idx ? idx.getX(k) : k
      const b = idx ? idx.getX(k + 1) : k + 1
      const c = idx ? idx.getX(k + 2) : k + 2
      const p = pts[base + a]!, q = pts[base + b]!, r = pts[base + c]!
      tris.push([p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z])
    }
  })
  m.dispose()
  return { pts, tris }
}

const D = Math.PI / 180
const dirOf = (az: number, el: number): Vector3 => new Vector3(
  Math.sin(az * D) * Math.cos(el * D), Math.sin(el * D), Math.cos(az * D) * Math.cos(el * D),
).normalize()
const ASPECTS = [
  { name: '正後方', s: dirOf(0, 0) },
  { name: '後上方30', s: dirOf(0, 30) },
  { name: '側方90', s: dirOf(90, 0) },
  { name: '正上方', s: dirOf(0, 90) },
] as const

const f = (v: number, d = 2): string => v.toFixed(d)
const f1 = (v: number): string => v.toFixed(1)
const line = (b: HitBox, tag: string): string => {
  const lo = b.center.clone().sub(b.half), hi = b.center.clone().add(b.half)
  return `    makeHitBox('${b.part}', [${f(lo.x)}, ${f(lo.y)}, ${f(lo.z)}], `
    + `[${f(hi.x)}, ${f(hi.y)}, ${f(hi.z)}]),`.padEnd(34) + `// ${tag}`
}

// 環境變數 `ID=yak1b` 只算一台
const ONLY = process.env['ID']
for (const spec of [P51D, F6F5, F4F4, BF109K4, KI84, A6M5, HE111, B17G, G4M, JU87, YAK1B]
  .filter((s) => ONLY === undefined || s.id === ONLY)) {
  const { pts, tris } = mesh(spec)
  const axes = ASPECTS.map((a) => {
    const dir = a.s.clone().multiplyScalar(-1)
    const up = Math.abs(dir.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    const ex = new Vector3().crossVectors(dir, up).normalize()
    return [ex, new Vector3().crossVectors(ex, dir).normalize()] as const
  })
  const boxArea = (bs: readonly HitBox[], i: number): number =>
    areaOf(bs.flatMap(boxTris), ...axes[i]!)
  const inside = (part: HitPart): Vector3[] => {
    const bs = spec.hitBoxes.filter((b) => b.part === part)
    return pts.filter((p) => bs.some((b) => inBox(p, b)))
  }
  const cur = (part: HitPart): HitBox[] => spec.hitBoxes.filter((b) => b.part === part)

  console.log(`\n══ ${spec.name} ═════════════════════════════════════════`)

  // ── 機翼：掃段數取轉折 ───────────────────────────────────────
  /**
   * 【只算右翼，左翼用鏡射】飛機是左右對稱的，而三角形夾出來的數字不是
   * —— 網格本身有 0.01 級的不對稱（K-4 只有左舷有增壓器進氣口、B-17G 的
   * 翼尖圓化收尾差一格），照兩邊各自算會得到差 0.01～0.35 m 的兩組盒，
   * `hitbox.test.ts` 的「左右翼盒左右對稱」直接紅。鏡射是對的做法：命中盒
   * 是**簡化的傷害體積**，不是外形的複製品。
   */
  const mirror = (b: HitBox): HitBox => {
    const lo = b.center.clone().sub(b.half), hi = b.center.clone().add(b.half)
    return makeHitBox('wingLeft', [-hi.x, lo.y, lo.z], [-lo.x, hi.y, hi.z])
  }
  const wingAt = (n: number): HitBox[] => {
    const r = mergeEmpty(sliceWing('wingRight', tris, cur('wingRight'), n), pts)
    return [...r, ...r.map(mirror)]
  }
  const curve: number[] = []
  for (let n = 1; n <= MAX_SEG; n++) curve.push(boxArea(n === 1 ? [...cur('wingRight'), ...cur('wingLeft')] : wingAt(n), 0))
  // 【要看兩步不能只看一步】只看下一步的話會停在**平台**上：B-17G 由 2 段
  // 切到 3 段只改善 1%（那兩段的切分面剛好都落在同一個結構帶），但 3 段切到
  // 4 段又改善 13%。停在 2 段就把後面那一大截讓掉了。
  const gain = (n: number): number => (curve[n - 1]! - curve[n]!) / curve[n - 1]!
  let segs = MAX_SEG
  for (let n = 2; n <= MAX_SEG - 2; n++) {
    if (gain(n) < KNEE && gain(n + 1) < KNEE) { segs = n; break }
  }
  console.log('  機翼正後方投影 '
    + curve.map((v, i) => `${i + 1}段 ${f1(v)}(${i === 0 ? 2 : wingAt(i + 1).length}盒)`).join('  '))
  console.log(`  → 取 ${segs} 段（再切一段的改善 < ${KNEE * 100}%）`)

  // ── 槍口：把每一挺併進它所屬的那一段 ─────────────────────────
  //
  // 【只看翼槍】109 的武裝全在中軸線附近（穿槳轂的 MK 108 在 x = 0、兩挺
  // MG 131 在 x = ±0.20），那些槍口在機身／發動機盒裡，不該把機翼盒往機首
  // 拉。不擋的話右翼第一段會被拉到 z = −2.60（砲口在錐尖），左右還因此
  // 不對稱。判準是「槍口的展向位置落在機翼的展向範圍內」。
  let wings = wingAt(segs)
  {
    const wr = wings.filter((b) => b.part === 'wingRight')
    const xLo = Math.min(...wr.map((b) => b.center.x - b.half.x))
    const xHi = Math.max(...wr.map((b) => b.center.x + b.half.x))
    for (const m of spec.battery.mounts) {
      const x = Math.abs(m.position.x)
      if (x < xLo || x > xHi) continue
      let best = wr[0]!
      let bd = Infinity
      for (const b of wr) {
        const d = Math.abs(x - b.center.x)
        if (d < bd) { bd = d; best = b }
      }
      const grown = grow(best, new Vector3(x, m.position.y, m.position.z))
      wings = wings.map((b) => (b === best ? grown : b))
      wr[wr.indexOf(best)] = grown
    }
    wings = [...wr, ...wr.map(mirror)]
  }

  // ── 尾段：掃切分面 ──────────────────────────────────────────
  //
  // 【為什麼要重推而不是沿用】GLB 換過之後，舊網格算出來的盒可能已經
  // 不貼合。一律由當下的網格重推。
  const tailRegion = cur('tail')
  let bestCut = 0.3
  let bestArea = Infinity
  let tail: HitBox[] = tailRegion
  for (let c = 0.15; c <= 2.2001; c += 0.05) {
    const t = splitTail(tris, tailRegion, c)
    if (t.length < 2) continue
    const a = boxArea(t, 0)
    if (a < bestArea) { bestArea = a; bestCut = c; tail = t }
  }
  console.log(`  尾段切分 |x| = ${f(bestCut)}　正後方 `
    + `${f1(boxArea(tailRegion, 0))} → ${f1(bestArea)} m²`)

  // ── 發動機：找空隙 ──────────────────────────────────────────
  const engPts = inside('engine')
  const engCl = cluster('engine', engPts, 'x', NACELLE_GAP)
  const engine = engCl.length > 1 ? engCl : cur('engine')
  if (engCl.length > 1) {
    console.log(`  發動機 1 盒 → ${engCl.length} 盒　正後方 `
      + `${f1(boxArea(cur('engine'), 0))} → ${f1(boxArea(engCl, 0))} m²`)
  }

  const next = patchHoles(
    [...cur('cockpit'), ...engine, ...cur('fuselage'), ...tail, ...wings], pts, tris)
  console.log('  投影 m²      ' + ASPECTS.map((a) => a.name.padStart(10)).join(''))
  console.log('  真實外形    ' + axes.map(([ex, ey]) => f1(areaOf(tris, ex, ey)).padStart(10)).join(''))
  console.log('  現行        ' + ASPECTS.map((_, i) => f1(boxArea(spec.hitBoxes, i)).padStart(10)).join('')
    + `   ${spec.hitBoxes.length} 盒`)
  console.log('  候選        ' + ASPECTS.map((_, i) => f1(boxArea(next, i)).padStart(10)).join('')
    + `   ${next.length} 盒`)
  console.log('  放大倍數    ' + ASPECTS.map((_, i) => {
    const r = boxArea(next, i) / areaOf(tris, ...axes[i]!)
    return `${f(r)}×`.padStart(10)
  }).join(''))

  // 【幾何自洽】盒的聯集投影不可能比真實外形小。小了就代表盒組漏掉了
  // 一片表面，而頂點覆蓋率檢查不到（頂點在盒裡、頂點之間的面不在）。
  for (let i = 0; i < ASPECTS.length; i++) {
    const r = boxArea(next, i) / areaOf(tris, ...axes[i]!)
    if (r < 1) console.log(`  ★ ${ASPECTS[i]!.name} 的盒投影只有真實外形的 ${f(r)} —— 盒組有洞`)
  }
  const missed = pts.filter((p) => !next.some((b) => inBox(p, b)))
  const missedNow = pts.filter((p) => !spec.hitBoxes.some((b) => inBox(p, b)))
  console.log(`  覆蓋率檢查：現行漏網 ${missedNow.length} 點、候選漏網 ${missed.length} 點`)
  if (missed.length) {
    const a = new Vector3(Infinity, Infinity, Infinity)
    const b = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const p of missed) { a.min(p); b.max(p) }
    console.log(`     漏網包圍盒 X${f(a.x)}…${f(b.x)} Y${f(a.y)}…${f(b.y)} Z${f(a.z)}…${f(b.z)}`)
    const wasEngine = missed.filter((p) => cur('engine').some((bx) => inBox(p, bx))).length
    const wasWing = missed.filter((p) => [...cur('wingRight'), ...cur('wingLeft')]
      .some((bx) => inBox(p, bx))).length
    console.log(`     其中原本被發動機盒蓋住 ${wasEngine}、被機翼盒蓋住 ${wasWing}`)
  }
  for (const m of spec.battery.mounts) {
    if (!next.some((b) => inBox(m.position, b))) {
      console.log(`  ★ 槍口 ${m.position.toArray().map((v) => f(v)).join(',')} 不在任何盒內`)
    }
  }

  console.log('  ── 貼進 specs ──')
  for (const b of cur('cockpit')) console.log(line(b, '座艙'))
  engine.forEach((b, i) => console.log(line(b, engine.length > 1 ? `發動機艙 ${i + 1}` : '發動機')))
  for (const b of cur('fuselage')) console.log(line(b, '機身'))
  tail.forEach((b, i) => console.log(line(b, i === 0 ? '平尾' : '垂尾＋尾錐')))
  const patched = next.filter((b) => ![...cur('cockpit'), ...engine, ...cur('fuselage'),
    ...tail, ...wings].includes(b))
  for (const p of ['wingRight', 'wingLeft'] as const) {
    wings.filter((b) => b.part === p).sort((a, b) => Math.abs(a.center.x) - Math.abs(b.center.x))
      .forEach((b, i) => console.log(line(b, `${p === 'wingRight' ? '右' : '左'}翼第 ${i + 1} 段`)))
  }
  patched.forEach((b, i) => console.log(line(b, `補漏 ${i + 1}（${b.part}）`)))
}
