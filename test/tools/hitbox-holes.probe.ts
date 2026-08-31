/**
 * **命中盒蓋不住的地方在哪裡？** 不是測試。
 *
 * 跑法：`npx vite-node test/tools/hitbox-holes.probe.ts`
 *
 * `hitbox.test.ts` 的覆蓋率掃描只含三台戰鬥機，兩台轟炸機從來沒被掃過。
 * 這一支把落在所有盒之外的頂點分群印出來 —— 那些地方**打得到但不扣血**。
 */
import { Mesh, Vector3 } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { type HitBox } from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { F6F5 } from '../../src/specs/f6f5'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'

await loadGlbTemplatesForNode()

const inBox = (p: Vector3, b: HitBox): boolean =>
  Math.abs(p.x - b.center.x) <= b.half.x && Math.abs(p.y - b.center.y) <= b.half.y
  && Math.abs(p.z - b.center.z) <= b.half.z
const f = (v: number): string => v.toFixed(2).padStart(7)

for (const spec of [P51D, F6F5, BF109K4, HE111, B17G] as AircraftSpec[]) {
  const m = buildAircraft(spec)
  m.group.updateMatrixWorld(true)
  const missed: { p: Vector3; mesh: string }[] = []
  let total = 0
  m.group.traverse((o) => {
    if (o.userData['spinning']) return
    const pos = (o as Mesh).geometry?.getAttribute?.('position')
    if (!pos) return
    for (let i = 0; i < pos.count; i++) {
      const p = new Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld)
      total++
      if (!spec.hitBoxes.some((b) => inBox(p, b))) missed.push({ p, mesh: o.name || '(無名)' })
    }
  })
  m.dispose()
  console.log(`\n══ ${spec.name}　${missed.length} / ${total} 個頂點在所有盒之外 ══`)
  if (!missed.length) continue

  // 【分群】用 0.8 m 的鏈結距離做單鏈聚合。破洞通常是一整個零件（砲塔、
  // 發動機艙、翼尖），不是散點 —— 分群之後一眼看得出是哪個東西。
  const rest = [...missed]
  const groups: { p: Vector3; mesh: string }[][] = []
  while (rest.length) {
    const g = [rest.pop()!]
    for (let i = 0; i < g.length; i++) {
      for (let j = rest.length - 1; j >= 0; j--) {
        if (g[i]!.p.distanceTo(rest[j]!.p) < 0.8) g.push(rest.splice(j, 1)[0]!)
      }
    }
    groups.push(g)
  }
  groups.sort((a, b) => b.length - a.length)
  for (const g of groups.slice(0, 8)) {
    const a = new Vector3(Infinity, Infinity, Infinity)
    const b = new Vector3(-Infinity, -Infinity, -Infinity)
    for (const q of g) { a.min(q.p); b.max(q.p) }
    const names = [...new Set(g.map((q) => q.mesh))].join(',')
    console.log(`  ${String(g.length).padStart(5)} 點  X${f(a.x)}…${f(b.x)}`
      + ` Y${f(a.y)}…${f(b.y)} Z${f(a.z)}…${f(b.z)}  ${names}`)
  }
  if (groups.length > 8) console.log(`  …… 另外 ${groups.length - 8} 群`)
}
