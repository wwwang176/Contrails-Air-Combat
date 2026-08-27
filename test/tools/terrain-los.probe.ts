/**
 * 在武器射程內，山擋得住視線嗎？不是測試（`.probe.ts`）。
 *
 * 跑法：`node node_modules/vite-node/vite-node.mjs test/tools/terrain-los.probe.ts`
 *
 * 【要回答什麼】專案負責人 2026-08-28 問「AI 會不會對地形後面的敵人開火／
 * 做防禦機動」。程式碼那一側的答案很明確：`shouldFire`、`alarmFactor`、
 * `Projectiles.step`、`World.resolveHits` **全部沒有任何遮蔽判斷**，
 * 整個 `src/` 裡也只有 `terrainSense.ts` 出現過 `blocked` 這個字。
 *
 * 但「沒有判斷」不等於「會出事」。這一支量的是**幾何上到底有沒有機會**：
 * 在有效射程（約 1 km）之內、兩架都在地形之上，存不存在一條被山擋住的
 * 視線？島的剖面是 smoothstep，1,806 m 才爬到 900 m —— 平均坡度 0.5，
 * 很平緩。**平緩的圓丘擋不擋得住一條 1 km 的視線，是一個要量的問題。**
 */
import { createArchipelago } from '../../src/world/archipelago'

const arch = createArchipelago()

/** 有效射程，m。P-51D 約 1,064（見 `assess.ts` 的 alarmFactor 註解）*/
const RANGE = 1000
/** 兩架都至少離地這麼高才算「在飛」，m */
const MIN_CLEAR = 30
/** 視線取樣步長，m */
const STEP = 20

function ground(x: number, z: number): number {
  const h = arch.field.sample(x, z)
  return Number.isFinite(h) && h > 0 ? h : 0
}

/** 這條視線被地形擋住嗎，以及最深的侵入量（m） */
function blockedBy(
  ax: number, ay: number, az: number, bx: number, by: number, bz: number,
): number {
  const len = Math.hypot(bx - ax, bz - az)
  const n = Math.max(2, Math.ceil(len / STEP))
  let worst = 0
  for (let i = 1; i < n; i++) {
    const t = i / n
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    const y = ay + (by - ay) * t
    const d = ground(x, z) - y
    if (d > worst) worst = d
  }
  return worst
}

let s = 987654321
const rnd = (): number => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }

for (const isl of [arch.islands[0]!, arch.islands[1]!]) {
  for (const alt of [100, 200, 400, 700]) {
    let pairs = 0
    let blocked = 0
    let deepest = 0
    for (let k = 0; k < 200000; k++) {
      // A 在島的膨脹圓內外隨機一點
      const r = isl.outerRadius * 1.3
      const ax = isl.cx + (rnd() - 0.5) * 2 * r
      const az = isl.cz + (rnd() - 0.5) * 2 * r
      const th = rnd() * Math.PI * 2
      const d = 200 + rnd() * (RANGE - 200)
      const bx = ax + Math.cos(th) * d
      const bz = az + Math.sin(th) * d
      // 兩架都要真的在飛 —— 離地至少 MIN_CLEAR
      const ay = alt
      const by = alt + (rnd() - 0.5) * 400
      if (ay - ground(ax, az) < MIN_CLEAR) continue
      if (by - ground(bx, bz) < MIN_CLEAR) continue
      pairs++
      const w = blockedBy(ax, ay, az, bx, by, bz)
      if (w > 0) { blocked++; if (w > deepest) deepest = w }
    }
    console.log(
      `島 peak ${isl.peak.toFixed(0)}`,
      `高度 ${String(alt).padStart(3)} m`,
      '| 兩架都在飛的配對', String(pairs).padStart(6),
      '| 視線被擋', String(blocked).padStart(5),
      ((blocked / Math.max(1, pairs)) * 100).toFixed(2).padStart(6) + '%',
      '| 最深侵入', deepest.toFixed(0).padStart(4), 'm',
    )
  }
}
