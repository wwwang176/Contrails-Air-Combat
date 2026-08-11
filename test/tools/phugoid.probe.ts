/**
 * 長週期振盪（phugoid）的振幅與週期。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/phugoid.probe.ts
 *
 * 【為什麼要與 `stall-loop.probe.ts` 分開】那一支讀 `AiController.mode` 與
 * `.sit`，那兩個欄位是 2026-08-12 才公開的 —— 拿去跑舊 commit 只會讀到
 * `undefined`。這一支**只讀運動學**（高度與 TAS），任何 commit 都跑得動，
 * 所以它才是跨版本比較的那把尺。
 *
 * 【只採計「附近沒有敵機」的樣本】纏鬥中的上下起伏是戰術動作，不是振盪。
 * 人工回報的情境是「戰鬥區域已經遠離，長機還在原地垂直繞圈」——
 * 那才是這支要量的東西。
 *
 * 【量的是峰谷差，不是標準差】振盪的形狀是正弦，標準差會把振幅低估成
 * 0.7 倍，而且對取樣起點敏感。峰谷差直接對應「玩家看到它上下跑多少」。
 */
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import type { Combatant } from '../../src/world/World'

const DT = 1 / 240
const SECONDS = 600
const SEED = 20260811
const STRIDE = 24
/** 統計視窗，s。一個完整的長週期約 20 s，取 30 s 保證涵蓋一整圈。 */
const WINDOW = 30
const windowSamples = Math.round(WINDOW / (DT * STRIDE))
/** 最近的敵機超過這個距離才採計，m。 */
const LONE_RANGE = 800

function nearestEnemy(cs: readonly Combatant[], me: Combatant): number {
  let best = Infinity
  for (const o of cs) {
    if (!o.alive || o.team === me.team || o.index === me.index) continue
    const d = o.aircraft.state.position.distanceTo(me.aircraft.state.position)
    if (d < best) best = d
  }
  return best
}

const b = createBattle(new AiController(), DEFAULT_BATTLE, SEED)
const cs = b.world.combatants
const st = cs.map(() => ({
  n: 0, lone: true,
  altMin: Infinity, altMax: -Infinity, tasMin: Infinity, tasMax: -Infinity,
}))
/** 每個合格視窗的 `{ 高度峰谷差 m, TAS 峰谷差 km/h }` */
const windows: { alt: number; tas: number }[] = []

for (let s = 0; s < Math.round(SECONDS / DT); s++) {
  stepBattle(b, DT)
  if (s % STRIDE !== 0) continue
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    if (!c.alive) continue
    const t = st[i]!
    if (nearestEnemy(cs, c) < LONE_RANGE) t.lone = false
    const alt = c.aircraft.state.position.y
    const tas = c.aircraft.state.velocity.length() * 3.6
    if (alt < t.altMin) t.altMin = alt
    if (alt > t.altMax) t.altMax = alt
    if (tas < t.tasMin) t.tasMin = tas
    if (tas > t.tasMax) t.tasMax = tas
    t.n++
    if (t.n >= windowSamples) {
      if (t.lone) windows.push({ alt: t.altMax - t.altMin, tas: t.tasMax - t.tasMin })
      t.n = 0
      t.lone = true
      t.altMin = Infinity; t.altMax = -Infinity
      t.tasMin = Infinity; t.tasMax = -Infinity
    }
  }
}

const pct = (xs: number[], p: number) =>
  [...xs].sort((a, c) => a - c)[Math.round((xs.length - 1) * p)] ?? 0
const alts = windows.map((w) => w.alt)
const tass = windows.map((w) => w.tas)

console.log(`合格視窗（${WINDOW} s 內最近的敵機都 >${LONE_RANGE} m）：${windows.length} 個`)
console.log(`高度峰谷差   中位 ${pct(alts, 0.5).toFixed(0)} m　p90 ${pct(alts, 0.9).toFixed(0)}　最大 ${pct(alts, 1).toFixed(0)}`)
console.log(`TAS 峰谷差   中位 ${pct(tass, 0.5).toFixed(0)} km/h　p90 ${pct(tass, 0.9).toFixed(0)}　最大 ${pct(tass, 1).toFixed(0)}`)
const big = windows.filter((w) => w.alt > 300)
console.log(`高度擺幅 >300 m 的視窗：${big.length}/${windows.length}`
  + `（${(big.length / Math.max(windows.length, 1) * 100).toFixed(1)}%）`)
