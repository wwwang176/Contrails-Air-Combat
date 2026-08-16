import type { Team } from '../world/World'
import type { Battle } from './setup'

/**
 * 集合點可視化的接收端。**結構型別，不 import 任何 render 模組** ——
 * `src/render/orderMarkers.ts` 的 `OrderMarkers` 天然符合這個形狀。
 *
 * 【為什麼要這一層】沒有它的話，這個函數就得 import render，而 render
 * 又要 import battle 才拿得到 `Battle` —— 兩層互相認識。反過來讓 battle
 * 定義一個「我會餵什麼給你」的形狀，方向就只有一條。
 */
export interface OrderSink {
  begin(): void
  add(
    team: Team, px: number, py: number, pz: number, radius: number,
    lx: number, ly: number, lz: number,
  ): void
  end(): void
}

/**
 * 把指揮官還握著的**集合令**餵給可視化。**唯讀，不改任何狀態。**
 *
 * 每一張畫成一顆以 `order.point` 為心、`order.radius` 為半徑的球，外加一條
 * 由該分隊長機拉到球心的線。
 *
 * 【為什麼只有 rally】`focus` 的 `point` 恆為零向量（它不用點），畫出來會
 * 是一顆黏在世界原點海面上的球；`flank` 目前停用（`FLANK_ENABLED`）。
 *
 * 【長機的挑法必須與 `leaderDistance` 一致】兩邊都是「分隊裡第一個存活
 * 成員」。不一致的話畫出來的線就不是判定用的那一條，而這個工具的**唯一
 * 用途**就是看那條距離為什麼收不進半徑裡。
 *
 * 熱路徑：不配置（每幀呼叫）。
 */
export function fillOrderView(b: Battle, out: OrderSink): void {
  out.begin()
  const cs = b.world.combatants
  const fs = b.flights.flights
  for (let f = 0; f < fs.length; f++) {
    const flight = fs[f]!
    // 【兩個 state 都開滿全域分隊長度，各自只填自己那幾格】所以用同一個
    // 索引 `f` 去查是對的，見 `setup.ts` 的 `blueCommand` 註解
    const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
    const order = state.orders[f] ?? null
    if (order === null || order.kind !== 'rally') continue

    let lead = -1
    for (let i = 0; i < flight.count; i++) {
      const idx = flight.members[i]!
      const c = cs[idx]
      if (c !== undefined && c.alive) { lead = idx; break }
    }
    // 全滅：命令會在同一步被 `stepCommand` 解除，這裡只是不畫
    if (lead < 0) continue

    const p = order.point
    const q = cs[lead]!.aircraft.state.position
    out.add(flight.team, p.x, p.y, p.z, order.radius, q.x, q.y, q.z)
  }
  out.end()
}
