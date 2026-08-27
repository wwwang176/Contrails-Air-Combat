/**
 * 找一組「幾何上真的被山擋住」的配對，當測試的 fixture。不是測試（`.probe.ts`）。
 *
 * 跑法：`node node_modules/vite-node/vite-node.mjs test/tools/occlusion-case.probe.ts`
 *
 * 【為什麼是算而不是量】在一場仗裡數「有幾發穿山」會數到 0 —— 那個 0 只代表
 * 這一場沒撞上，不代表沒有這個 bug。遮蔽是一個確定的幾何事實，直接把它算
 * 出來、把情境造出來就好。
 */
import { createArchipelago } from '../../src/world/archipelago'

const arch = createArchipelago()

function ground(x: number, z: number): number {
  const h = arch.field.sample(x, z)
  return Number.isFinite(h) && h > 0 ? h : 0
}

/** 視線在中途最深沉進地形幾公尺；<= 0 表示沒被擋 */
function sink(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(2, Math.ceil(len / 10))
  let worst = -Infinity
  for (let i = 1; i < n; i++) {
    const t = i / n
    const d = ground(ax + (bx - ax) * t, az + (bz - az) * t) - (ay + (by - ay) * t)
    if (d > worst) worst = d
  }
  return worst
}

/** 兩架都至少離地這麼高才算「在正常飛」，m。安全層的 clearance 是 120 */
const MIN_CLEAR = 120
const isl = arch.islands[0]!
console.log('錨島', JSON.stringify({
  cx: isl.cx, cz: isl.cz, peak: isl.peak.toFixed(0), outerR: isl.outerRadius.toFixed(0),
}))

/**
 * 沿一條過島心的直線，兩架各在山脊兩側、等高。
 * 掃「離島心多遠」與「多高」，找**兩架離地都夠多、而視線沉得夠深**的那一組。
 */
const line = Math.hypot(isl.cx, isl.cz)
const ux = isl.cx / line
const uz = isl.cz / line

let best: { d: number; y: number; clearA: number; sink: number; gap: number } | null = null
for (let d = 200; d <= 900; d += 20) {
  for (let y = 20; y <= 900; y += 10) {
    const ax = isl.cx - ux * d, az = isl.cz - uz * d
    const bx = isl.cx + ux * d, bz = isl.cz + uz * d
    const ca = y - ground(ax, az)
    const cb = y - ground(bx, bz)
    if (ca < MIN_CLEAR || cb < MIN_CLEAR) continue
    const gap = 2 * d
    if (gap > 1000) continue
    const s = sink(ax, y, az, bx, y, bz)
    if (s <= 0) continue
    if (best === null || s > best.sink) best = { d, y, clearA: Math.min(ca, cb), sink: s, gap }
  }
}
console.log('過島心、等高、兩架各在一側：', best === null ? '找不到' : JSON.stringify(best))

/** 放寬：兩架不必等高、不必過島心，掃一個網格找最深的一組 */
let best2: Record<string, number> | null = null
for (let ang = 0; ang < 360; ang += 15) {
  const th = (ang * Math.PI) / 180
  const px = Math.cos(th), pz = Math.sin(th)
  for (let r = 200; r <= 2200; r += 50) {
    const ax = isl.cx + px * r, az = isl.cz + pz * r
    for (let gap = 300; gap <= 1000; gap += 50) {
      const bx = isl.cx + px * (r - gap), bz = isl.cz + pz * (r - gap)
      for (let ya = 50; ya <= 900; ya += 25) {
        for (let yb = 50; yb <= 900; yb += 25) {
          const ca = ya - ground(ax, az)
          const cb = yb - ground(bx, bz)
          if (ca < MIN_CLEAR || cb < MIN_CLEAR) continue
          const s = sink(ax, ya, az, bx, yb, bz)
          if (s <= 0) continue
          if (best2 === null || s > best2['sink']!) {
            best2 = { ang, r, gap, ya, yb, ca, cb, sink: s, ax, az, bx, bz }
          }
        }
      }
    }
  }
}
console.log('放寬之後最深的一組：', best2 === null ? '找不到'
  : JSON.stringify(Object.fromEntries(
    Object.entries(best2).map(([k, v]) => [k, Math.round(v * 10) / 10]))))
