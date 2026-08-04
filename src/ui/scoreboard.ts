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

export interface Scoreboard {
  /** 重畫。`banner` 為 null 時橫幅留白 */
  render(blue: ScoreRow[], red: ScoreRow[], banner: 'victory' | 'defeat' | null): void
  setVisible(v: boolean): void
}

const BANNER_TEXT = { victory: '勝　利', defeat: '落　敗' } as const

/**
 * 記分板的 DOM 元件。
 *
 * 【為什麼是 DOM 而不是 HUD 的 canvas】40 列 × 4 欄的表格、排序、灰字、
 * 高亮 —— canvas 要自己排版每一格。而且 M10 的結算畫面本來就是 DOM，
 * 兩邊共用同一個渲染函式（M9 spec §9.1）。
 *
 * 【為什麼整表重建而不是逐格更新】只在按住 TAB 或分出勝負時才呼叫，
 * 40 列的 `innerHTML` 重建在那個頻率下量不出來。逐格更新要維護一份
 * DOM 節點的索引，那是為了看不見的效能付看得見的複雜度。
 *
 * @param root 容器。必須含有 `#banner` 與 `#tables` 兩個子節點
 */
export function createScoreboard(root: HTMLElement): Scoreboard {
  const banner = root.querySelector('#banner') as HTMLElement
  const tables = root.querySelector('#tables') as HTMLElement

  function table(rows: ScoreRow[], team: 'blue' | 'red', title: string): string {
    const body = rows.map((r) => {
      const cls = [r.alive ? '' : 'dead', r.isPlayer ? 'me' : ''].filter(Boolean).join(' ')
      const name = r.isPlayer ? `${r.name}（你）` : r.name
      return `<tr class="${cls}"><td class="name">${escapeHtml(name)}</td>`
        + `<td>${r.kills}</td><td>${r.deaths}</td><td>${r.assists}</td></tr>`
    }).join('')
    return `<table class="${team}"><caption>${title}</caption>`
      + '<thead><tr><th class="name">飛行員</th><th>擊墜</th><th>陣亡</th><th>助攻</th></tr></thead>'
      + `<tbody>${body}</tbody></table>`
  }

  return {
    render(blue, red, outcome) {
      banner.textContent = outcome === null ? '' : BANNER_TEXT[outcome]
      banner.className = outcome ?? ''
      tables.innerHTML = table(blue, 'blue', '我方') + table(red, 'red', '敵方')
    },
    setVisible(v) {
      root.hidden = !v
    },
  }
}

/**
 * 名字是資料，不是標記。
 *
 * 【為什麼現在就要】名冊目前是寫死的常數，但 M10 之後很可能會有玩家自訂的
 * 呼號。到那時才補跳脫，等於留一個現成的注入點在那裡。
 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;'
  ))
}
