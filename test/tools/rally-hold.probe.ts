/**
 * 兩個缺陷的**直接量測**。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/rally-hold.probe.ts
 *
 * 【為什麼不用 `stall-loop.probe.ts` 量】那一支跑 `DEFAULT_BATTLE`（`ACE`，
 * 反應延遲 0）。實測 600 秒下 `ACE` 的指揮層**一道命令都不發**，`rally`
 * 佔時 0~3.8% —— 缺陷乙（集合令永遠不解除）在那個配置下結構上不可見。
 * 這一支用 `battleConfigFrom(DEFAULT_SKIRMISH)`，也就是玩家實際玩到的
 * `VETERAN`。
 *
 * 【量兩件事】
 *
 *   乙：每一張 `rally` 命令從發出到解除撐了幾秒。實機回報的症狀是「長機
 *       在高空無限繞圈」，對應的量就是**持有時長的尾巴**與「跑到結束都沒
 *       解除」的張數。中位數不是重點 —— 病在尾巴。
 *
 *   甲：進入 `overshoot` 的那一刻速度是多少（`cornerRatio`），以及接下來
 *       兩秒掉了多少。這個閘門的觸發條件純幾何、不看速度，所以在裡面收
 *       油門到底 + 減速板全開會把速度掉光。
 *
 * 【一次跑兩個種子】改動的效果若比開局差異還小，那就不是效果。種子本身
 * 不進物理路徑（只用來取飛行員名字），所以變因是**開局**：兩個種子給的是
 * 兩場不同的仗。
 */
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { FlightOrder } from '../../src/ai/command'
import type { CommandState } from '../../src/ai/command'

const DT = 1 / 240
const SECONDS = 900
const STRIDE = 24
/** 進入 `overshoot` 之後追蹤幾秒的速度變化 */
const AFTER = 2

interface Held {
  order: FlightOrder
  since: number
}

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return Number.NaN
  const i = Math.min(sorted.length - 1, Math.floor(sorted.length * p))
  return sorted[i]!
}

function run(seed: number): void {
  const b: Battle = createBattle(new AiController(), battleConfigFrom(DEFAULT_SKIRMISH), seed)
  const cs = b.world.combatants
  const states: CommandState[] = [b.blueCommand, b.redCommand]
  /** 每個 (陣營, 分隊) 目前握著的那一張命令 */
  const held = new Map<string, Held>()
  /** 已解除的 rally 命令活了幾秒 */
  const rallyLives: number[] = []
  /** 跑到結束都沒解除的 rally 張數 */
  let rallyUnresolved = 0
  let rallyIssued = 0

  /** 進入 overshoot 那一刻的 cornerRatio */
  const entryRatio: number[] = []
  /** 進入之後 AFTER 秒的 TAS 變化，km/h */
  const drop: number[] = []
  const wasOvershoot = new Uint8Array(cs.length)
  /** 待結算：進入 overshoot 的時刻與當時的 TAS */
  const pending = new Map<number, { t: number, tas: number }>()

  let t = 0
  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s < steps; s++) {
    stepBattle(b, DT)
    t += DT
    if (s % STRIDE !== 0) continue

    // ── 乙：命令的壽命 ──────────────────────────────────
    for (let si = 0; si < states.length; si++) {
      const st = states[si]!
      for (let f = 0; f < st.orders.length; f++) {
        const key = `${si}:${f}`
        const now = st.orders[f] ?? null
        const prev = held.get(key)
        if (prev !== undefined && prev.order !== now) {
          if (prev.order.kind === 'rally') rallyLives.push(t - prev.since)
          held.delete(key)
        }
        if (now !== null && (prev === undefined || prev.order !== now)) {
          held.set(key, { order: now, since: t })
          if (now.kind === 'rally') rallyIssued++
        }
      }
    }

    // ── 甲：進入 overshoot 的能量 ────────────────────────
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive) continue
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      const tas = c.aircraft.diag.aero.tas * 3.6
      const p = pending.get(i)
      if (p !== undefined && t - p.t >= AFTER) {
        drop.push(p.tas - tas)
        pending.delete(i)
      }
      const isOver = ai.mode === 'overshoot' ? 1 : 0
      if (isOver === 1 && wasOvershoot[i] === 0) {
        entryRatio.push(ai.sit.cornerRatio)
        if (!pending.has(i)) pending.set(i, { t, tas })
      }
      wasOvershoot[i] = isOver
    }
  }
  for (const h of held.values()) if (h.order.kind === 'rally') rallyUnresolved++

  rallyLives.sort((a, c) => a - c)
  entryRatio.sort((a, c) => a - c)
  drop.sort((a, c) => a - c)
  const below = entryRatio.filter((r) => r < 1).length

  console.log(`── 種子 ${seed}　20v20　${SECONDS} 秒（VETERAN）──`)
  console.log(
    `  rally 發出 ${rallyIssued} 張　已解除 ${rallyLives.length}　`
    + `**跑到結束仍未解除 ${rallyUnresolved}**`,
  )
  console.log(
    `  已解除的壽命 s：中位 ${pct(rallyLives, 0.5).toFixed(1)}　`
    + `p90 ${pct(rallyLives, 0.9).toFixed(1)}　最長 ${pct(rallyLives, 1).toFixed(1)}`,
  )
  console.log(
    `  overshoot 進入 ${entryRatio.length} 次　`
    + `其中 cornerRatio < 1（本來就沒速度）${below}`
    + `（${(below / Math.max(entryRatio.length, 1) * 100).toFixed(1)}%）`,
  )
  console.log(
    `  進入時 cornerRatio：中位 ${pct(entryRatio, 0.5).toFixed(2)}　`
    + `p10 ${pct(entryRatio, 0.1).toFixed(2)}`,
  )
  console.log(
    `  進入後 ${AFTER} s 的 TAS 變化 km/h（正 = 掉速）：`
    + `中位 ${pct(drop, 0.5).toFixed(0)}　p90 ${pct(drop, 0.9).toFixed(0)}　`
    + `最多 ${pct(drop, 1).toFixed(0)}`,
  )
  console.log('')
}

console.log('【怎麼讀】乙看「未解除」那一欄要歸零、壽命的尾巴要縮短；')
console.log('　　　　　甲看「進入後掉速」要縮小 —— 尤其是進入時本來就沒速度的那些。\n')
run(20260811)
run(297534859)
