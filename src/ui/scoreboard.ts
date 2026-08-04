import type { Roster } from '../battle/pilots'
import type { Team } from '../world/World'

/**
 * 記分板上的一列。
 *
 * 【為什麼另外定義而不是直接用 `Pilot`】`Pilot` 是可變的狀態、依座位索引；
 * 一列是某一隊、某一個排序下的快照。分開之後排序可以就地做而不會動到名冊。
 */
export interface ScoreRow {
  name: string
  kills: number
  deaths: number
  assists: number
  alive: boolean
  isPlayer: boolean
}

/** 取出某一隊的列。順序是座位順序 —— 排序交給 `sortScoreRows`。 */
export function scoreRows(
  roster: Roster, seats: readonly { team: Team }[], team: Team,
): ScoreRow[] {
  const out: ScoreRow[] = []
  for (let i = 0; i < seats.length; i++) {
    if (seats[i]!.team !== team) continue
    const p = roster.pilots[i]!
    out.push({
      name: p.name,
      kills: p.kills,
      deaths: p.deaths,
      assists: p.assists,
      alive: p.alive,
      isPlayer: p.isPlayer,
    })
  }
  return out
}

/**
 * 就地排序：擊墜降序 → 助攻降序 → 名字升序。
 *
 * 【為什麼一定要有第三層】只比擊墜的話，同分的列會隨著輸入順序跳動 ——
 * 畫面上看起來像 bug，而且測試會不穩定（M9 spec §9.3）。
 */
export function sortScoreRows(rows: ScoreRow[]): ScoreRow[] {
  rows.sort((a, b) => {
    if (b.kills !== a.kills) return b.kills - a.kills
    if (b.assists !== a.assists) return b.assists - a.assists
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  })
  return rows
}
