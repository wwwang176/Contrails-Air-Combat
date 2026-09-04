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

/** 三行對比要的數字：`[我方, 敵方]`；存活是 `[活著, 總數]` */
export interface Tally {
  readonly kills: readonly [number, number]
  readonly alive: readonly [readonly [number, number], readonly [number, number]]
}

export function tallyOf(blue: readonly ScoreRow[], red: readonly ScoreRow[]): Tally {
  const sum = (rows: readonly ScoreRow[]) => {
    let kills = 0
    let alive = 0
    for (const r of rows) {
      kills += r.kills
      if (r.alive) alive++
    }
    return { kills, alive }
  }
  const b = sum(blue)
  const r = sum(red)
  return { kills: [b.kills, r.kills], alive: [[b.alive, blue.length], [r.alive, red.length]] }
}

/** 玩家那一列；沒有回 null */
export function playerOf(rows: readonly ScoreRow[]): ScoreRow | null {
  return rows.find((r) => r.isPlayer) ?? null
}

/** 用時 → 「m 分 s 秒」 */
export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/**
 * 結算時除了兩張表之外的東西（2026-09-04 選單重做 spec §2.6）。`main.ts` 算好
 * 傳進來 —— 這一層只畫。
 *
 * 【沒有命中率】`Pilot` 沒有發數與命中的紀錄。不做假數字。
 */
export interface AfterAction {
  readonly mode: 'mission' | 'skirmish'
  /** 卡名，或「遭遇戰」 */
  readonly title: string
  readonly objective: string
  readonly seconds: number
  /** 玩家的機種短名 */
  readonly playerSpec: string
  /** 我方第幾隊（1 起算） */
  readonly playerFlight: number
  /** 剩餘結構 0..1 */
  readonly playerHp01: number
  /** 護送卡才有：被護送的活了幾架 */
  readonly convoy: { readonly alive: number; readonly total: number } | null
}

export interface Scoreboard {
  /**
   * 重畫。`banner` 為 null 時橫幅留白（按住 TAB 的即時看板）；`extra` 為 null
   * 時只畫兩張表，戰報的其餘區塊藏起來。
   */
  render(blue: ScoreRow[], red: ScoreRow[], banner: 'victory' | 'defeat' | null,
    extra: AfterAction | null): void
  setVisible(v: boolean): void
}

const BANNER_TEXT = {
  skirmish: { victory: '勝　利', defeat: '落　敗' },
  mission: { victory: '任務達成', defeat: '任務失敗' },
} as const

/**
 * 記分板的 DOM 元件。
 *
 * 【為什麼是 DOM 而不是 HUD 的 canvas】40 列 × 4 欄的表格、排序、灰字、
 * 高亮 —— canvas 要自己排版每一格。而且 M10 的結算畫面本來就是 DOM，
 * 兩邊共用同一個渲染函式（M9 spec §9.1）。
 *
 * 【為什麼整表重建而不是逐格更新】只在按住 TAB 或分出勝負時才呼叫，
 * 40 列的 `innerHTML` 重建在那個頻率下量不出來。
 *
 * @param root 容器。必須含有 `#banner`、`#aar-sub`、`#aar-me`、`#aar-tally`、
 *             `#aar-details`、`#tables`
 */
export function createScoreboard(root: HTMLElement): Scoreboard {
  const banner = root.querySelector('#banner') as HTMLElement
  const sub = root.querySelector('#aar-sub') as HTMLElement
  const me = root.querySelector('#aar-me') as HTMLElement
  const tally = root.querySelector('#aar-tally') as HTMLElement
  const details = root.querySelector('#aar-details') as HTMLElement
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

  function playerCard(blue: ScoreRow[], x: AfterAction): string {
    const p = playerOf(blue)
    if (p === null) return ''
    const stat = (v: string, k: string) => `<div class="stat"><div class="v">${v}</div><div class="k">${k}</div></div>`
    return `<div class="who"><div class="n">${escapeHtml(p.name)}　${escapeHtml(x.playerSpec)}</div>`
      + `<div class="s">我方第 ${x.playerFlight} 分隊長機　·　${p.alive ? '全程存活' : '被擊落'}</div></div>`
      + stat(String(p.kills), '擊落') + stat(String(p.deaths), '被擊落') + stat(String(p.assists), '助攻')
      + stat(`${Math.round(x.playerHp01 * 100)}%`, '剩餘結構')
  }

  /**
   * 三組對比數字。**一組是一個 `.item`，橫著並排**（專案負責人 2026-09-04：
   * 「aar-tally 是不是可以改橫的? 不然現在佔高度有點多」）—— 每一組自己
   * 就是「我方　標籤　敵方」，所以拆成三個獨立的盒子不會讓左右錯開。
   */
  function tallyItems(blue: ScoreRow[], red: ScoreRow[], x: AfterAction): string {
    const t = tallyOf(blue, red)
    const item = (a: string, k: string, b: string) =>
      `<div class="item"><span class="a">${a}</span><span class="k">${k}</span><span class="b">${b}</span></div>`
    let html = item(String(t.kills[0]), '擊落', String(t.kills[1]))
    if (x.convoy !== null) html += item(`${x.convoy.alive} / ${x.convoy.total}`, '轟炸機存活', '—')
    html += item(`${t.alive[0][0]} / ${t.alive[0][1]}`, '存活', `${t.alive[1][0]} / ${t.alive[1][1]}`)
    return html
  }

  return {
    render(blue, red, outcome, extra) {
      const mode = extra?.mode ?? 'skirmish'
      banner.textContent = outcome === null ? '' : BANNER_TEXT[mode][outcome]
      banner.className = outcome ?? ''
      tables.innerHTML = table(blue, 'blue', '我方') + table(red, 'red', '敵方')
      const full = extra !== null
      sub.hidden = !full
      me.hidden = !full
      tally.hidden = !full
      details.classList.toggle('bare', !full)
      if (extra !== null) {
        sub.textContent = `${extra.objective}　·　${extra.title}　·　${formatDuration(extra.seconds)}`
        me.innerHTML = playerCard(blue, extra)
        tally.innerHTML = tallyItems(blue, red, extra)
        const cap = details.querySelector('.cap')
        if (cap) cap.textContent = `完整名單（${blue.length + red.length} 架）`
      }
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
