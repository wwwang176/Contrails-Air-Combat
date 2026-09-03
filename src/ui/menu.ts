import { CAMPAIGNS, MISSIONS } from '../battle/missions'
import type { Campaign, MissionCard, ReadyMissionCard } from '../battle/missions'
import {
  ALL_SPECS, specOf, addFlight, setCount, removeFlight, setLead, applyPreset, flightsTotal,
  topSpeedKmh, PRESETS, ALTITUDES, MAX_SIDE, MAX_FLIGHTS,
  type SkirmishSetup, type Flight, type PresetKey,
} from '../battle/skirmish'
import { briefingOf, shortName, type Briefing } from './briefing'
import type { AircraftSpec } from '../specs/types'
import type { TerrainKind } from '../world/terrainKind'
import type { Screen, ScreenEvent } from './screens'

export interface MenuHooks {
  /** 使用者送出一個畫面事件 */
  onEvent(event: ScreenEvent): void
  /** 使用者改了遭遇戰設定 */
  onSetup(setup: SkirmishSetup): void
  /** 暫停選單的「繼續」 */
  onResume(): void
  /**
   * 暫停選單的「重新開始」。
   *
   * 【為什麼不是一個 `ScreenEvent`】它不換畫面 —— 打完之後還是留在戰鬥裡。
   * 與 `onResume` 同一類：overlay 上的動作，不是畫面之間的轉移。
   */
  onRestart(): void
  /**
   * 使用者按了某一關的出擊。
   *
   * 【為什麼是獨立的 hook 而不是塞進 `onEvent`】`ScreenEvent` 是一個字串，
   * 帶不了「哪一張卡」。與 `onSetup` 同一類：畫面之外的資料。
   *
   * 【先送這個，再送 `fight`】呼叫端要先知道打哪一關，才建得出戰鬥。
   */
  onMission(card: ReadyMissionCard): void
}

export interface Menu {
  /** 顯示指定畫面，其餘隱藏 */
  show(screen: Screen): void
  /** 暫停 overlay */
  setPaused(v: boolean): void
  /** 依目前的設定重畫編組那一頁 */
  renderSetup(setup: SkirmishSetup): void
}

/**
 * 戰役的標籤與陣營卡上的文案。
 *
 * 【為什麼是 `Record<Campaign, …>` 而不是陣列】少一格是編譯錯誤。加第四條線時
 * 只加型別而漏了這裡，卡片會**永遠畫不出來而且照樣編譯**。
 */
const CAMPAIGN_LABEL: Record<Campaign, string> = { allies: '盟軍', germany: '德軍', japan: '日本' }
const CAMPAIGN_BLURB: Record<Campaign, { readonly line: string; readonly planes: string; readonly sub: string }> = {
  allies: { line: '第八航空軍的護航與轟炸，太平洋的艦隊防空。', planes: 'P-51D · B-17G · F6F-5', sub: '第八航空軍' },
  germany: { line: '帝國防空：攔截轟炸機流，撐到燃料見底。', planes: 'Bf 109 K-4 · He 111', sub: '帝國防空' },
  japan: { line: '臺灣沖到雷伊泰：陸基攔截，護送雷擊隊。', planes: 'A6M5 · Ki-84 · G4M', sub: '海軍航空隊' },
}

/** 場地的選項。**順序即按鈕順序。**群島在前：它是預設，也是有東西可看的那一個 */
const TERRAINS: readonly { label: string; hint: string; value: TerrainKind; sil: string }[] = [
  { label: '群島', hint: '島鏈與淺海', value: 'archipelago',
    sil: '<svg width="72" height="26"><rect y="17" width="72" height="9" fill="#38505c"/><path d="M8 17l9-8 9 8z" fill="#4d5c3f"/><path d="M40 17l13-11 13 11z" fill="#4d5c3f"/></svg>' },
  { label: '內陸', hint: '農地與村落', value: 'farmland',
    sil: '<svg width="72" height="26"><rect y="15" width="72" height="11" fill="#4a5238"/><path d="M0 15h72" stroke="#616a48"/><rect x="12" y="9" width="7" height="6" fill="#5c6449"/><rect x="46" y="10" width="9" height="5" fill="#5c6449"/></svg>' },
  { label: '純海面', hint: '沒有地標', value: 'sea',
    sil: '<svg width="72" height="26"><rect y="13" width="72" height="13" fill="#32485a"/><path d="M4 19q6-3 12 0t12 0 12 0 12 0 12 0" stroke="#44607a" fill="none"/></svg>' },
]

/** 開場高度示意：一條虛線的高度就是那一格 */
const altSil = (y: number): string =>
  `<svg width="72" height="26"><rect y="23" width="72" height="3" fill="#4a5238"/>`
  + `<path d="M0 ${y}h72" stroke="#6b5b3f" stroke-dasharray="3 3"/>`
  + `<g transform="translate(30 ${y - 3})" fill="#e3d9c0"><rect x="4" y="0" width="2" height="7"/><rect x="0" y="2" width="10" height="2"/></g></svg>`
const ALT_Y: readonly number[] = [20, 12, 4]

/** 剪影：戰鬥機一種、轟炸機一種 */
const SIL: Record<AircraftSpec['role'], string> = {
  fighter: '<svg width="46" height="20" viewBox="0 0 46 20"><rect x="21" y="1" width="4" height="17" rx="2"/><path d="M2 9h42v3H2z"/><path d="M18 15h10v2H18z"/></svg>',
  bomber: '<svg width="46" height="20" viewBox="0 0 46 20"><rect x="20" y="0" width="6" height="19" rx="3"/><path d="M0 8h46v4H0z"/><path d="M15 14h16v2.5H15z"/><circle cx="12" cy="10" r="2"/><circle cx="34" cy="10" r="2"/></svg>',
}
const ROLE_WORD: Record<AircraftSpec['role'], string> = { fighter: '戰鬥機', bomber: '轟炸機' }

/** 機種副名：全名去掉短名之後剩下的那截（「P-51D Mustang」→「Mustang」） */
function fullName(spec: AircraftSpec): string {
  const s = shortName(spec)
  return spec.name.startsWith(s) ? spec.name.slice(s.length).trim() : spec.name
}

const readyCount = (list: readonly MissionCard[]): number => list.filter((m) => m.battle !== null).length

/**
 * 選單的 DOM 元件（2026-09-04 選單重做）。
 *
 * 【為什麼不用前端框架】狀態只有「六個畫面之一」加上一個設定物件與兩個
 * 索引，一個變數與一次 `render()` 就寫完了。同一頁的真正風險是 three.js 的
 * 資源生命週期，而那是框架碰不到的地方（M10 spec §9.1）。
 *
 * 【資料都在別處算好】簡報用 `briefingOf`、編組用 `skirmish.ts` 的純函數 ——
 * 這裡只畫，因為這裡沒有測試（要 DOM）。
 */
export function createMenu(root: HTMLElement, hooks: MenuHooks): Menu {
  const sections: Record<Screen, HTMLElement | null> = {
    landing: root.querySelector('#landing'),
    menu: root.querySelector('#menu'),
    campaign: root.querySelector('#campaign'),
    mission: root.querySelector('#mission'),
    skirmish: root.querySelector('#skirmish'),
    // 戰鬥沒有自己的 section —— 它就是「全部都藏起來」
    battle: null,
  }
  const pause = root.querySelector('#pause') as HTMLElement
  const q = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement
  const el = {
    menuMissionMeta: q('menu-mission-meta'),
    menuSkirmishMeta: q('menu-skirmish-meta'),
    campaignCards: q('campaign-cards'),
    campName: q('camp-name'),
    campSub: q('camp-sub'),
    route: q('route'),
    brief: q('brief'),
    presets: q('sk-presets'),
    mine: q('sk-mine'),
    foe: q('sk-foe'),
    versus: q('sk-versus'),
    terrain: q('sk-terrain'),
    alt: q('sk-alt'),
    warn: q('sk-warn'),
    go: root.querySelector('#skirmish [data-act="fight"]') as HTMLButtonElement,
  }

  /** 任務線的狀態：哪一條、選了第幾關 */
  let campaign: Campaign = 'allies'
  const picked: Record<Campaign, number> = { allies: 0, germany: 0, japan: 0 }
  /** 編組頁的機種選單有沒有展開（每側各自） */
  const paletteOpen = { blue: false, red: false }

  // 【事件委派】按鈕是動態產生的，一個一個掛監聽器會在重畫時漏掉舊的。
  //
  // 【為什麼掛在 document 而不是 root】結算板的按鈕在 `#board` 裡，不在 `#ui`
  // 底下 —— 掛在 root 上那幾顆永遠不會送出事件。data-act 是這一層唯一的協定。
  root.ownerDocument.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b || b.disabled) return
    const act = b.dataset['act']
    if (act === undefined) return
    if (act === 'resume') { hooks.onResume(); return }
    if (act === 'restart') { hooks.onRestart(); return }
    hooks.onEvent(act as ScreenEvent)
  })

  // ── 主選單：狀態行算出來，不寫死 ─────────────────────────
  function renderMenuMeta(): void {
    const ready = CAMPAIGNS.reduce((n, c) => n + readyCount(MISSIONS[c]), 0)
    el.menuMissionMeta.textContent = `${CAMPAIGNS.map((c) => CAMPAIGN_LABEL[c]).join(' · ')}　　可出擊 ${ready} 關`
    el.menuSkirmishMeta.textContent = `${ALL_SPECS.length} 種機體　最多 ${MAX_SIDE} 對 ${MAX_SIDE}`
  }

  // ── 陣營頁：三張海報卡 ────────────────────────────────
  function renderCampaign(): void {
    el.campaignCards.innerHTML = ''
    for (const c of CAMPAIGNS) {
      const b = document.createElement('button')
      b.className = 'tallcard paperbit'
      b.dataset['campaign'] = c
      const blurb = CAMPAIGN_BLURB[c]
      b.innerHTML = `<span class="photo"><i class="tape tl"></i><img src="/ui/${c}.png" alt=""></span>`
        + `<span class="t">${CAMPAIGN_LABEL[c]}</span><span class="d">${escapeHtml(blurb.line)}</span>`
        + `<span class="m">${escapeHtml(blurb.planes)}　　<b>可出擊 ${readyCount(MISSIONS[c])}</b> / ${MISSIONS[c].length} 關</span>`
      // 【卡片用自己的監聽器而不是 data-act】`data-act` 只帶得了一個字串，
      // 這裡要帶「哪一條線」。先記下來，再送畫面事件 —— 資料先於事件
      b.addEventListener('click', () => {
        campaign = c
        hooks.onEvent('mission')
      })
      el.campaignCards.appendChild(b)
    }
  }

  // ── 簡報頁：左欄路線、右欄簡報 ───────────────────────
  function unitRow(u: Briefing['mine'] extends readonly (infer U)[] | undefined ? U : never): string {
    return `<div class="unit"><span class="sil">${SIL[u.role]}</span>`
      + `<span><span class="nm">${escapeHtml(u.name)}</span> <span class="qty">× ${u.count}</span></span></div>`
      + (u.note === undefined ? '' : `<div class="note">↑ ${escapeHtml(u.note)}</div>`)
  }

  function renderBrief(card: MissionCard): void {
    const b = briefingOf(card)
    const head = `<h2>${escapeHtml(b.title)}</h2><div class="lbl" style="margin:4px 0 12px">${escapeHtml(b.kind)}</div>`
    if (!b.ready) {
      el.brief.innerHTML = head
        + `<p style="max-width:56ch;color:var(--dim)">${escapeHtml(b.summary)}</p>`
        + '<div class="soonbox"><b>準備中</b><br>這一關要打的是地面與海上目標（工廠、列車、艦船），'
        + '還要投彈與雷擊 —— 那一整套還沒做好。</div>'
      return
    }
    el.brief.innerHTML = head
      + `<span class="stamp">機密</span>`
      + `<div class="obj">${escapeHtml(b.objective ?? '')}</div>`
      + `<p style="max-width:58ch;margin:0 0 4px;color:var(--dim)">${escapeHtml(b.summary)}</p>`
      + `<div class="forces"><div><div class="lbl" style="margin-bottom:8px">我方</div>${(b.mine ?? []).map(unitRow).join('')}</div>`
      + `<div class="vs">對</div>`
      + `<div><div class="lbl" style="margin-bottom:8px">敵方</div>${(b.foe ?? []).map(unitRow).join('')}</div></div>`
      + `<div class="facts">${(b.facts ?? []).map((f) =>
        `<div class="fact"><div class="lbl">${escapeHtml(f.label)}</div><div class="v">${escapeHtml(f.value)}</div></div>`).join('')}</div>`
      + `<div class="actions"><button class="go" id="brief-go">出　擊</button></div>`
    const go = el.brief.querySelector('#brief-go') as HTMLButtonElement
    go.addEventListener('click', () => {
      // 【先送卡，再送 fight】呼叫端要先知道打哪一關，才建得出戰鬥
      hooks.onMission(card as ReadyMissionCard)
      hooks.onEvent('fight')
    })
  }

  function renderMission(): void {
    const list = MISSIONS[campaign]
    const k = picked[campaign]
    el.campName.textContent = CAMPAIGN_LABEL[campaign]
    el.campSub.textContent = `${CAMPAIGN_BLURB[campaign].sub} · 第 ${k + 1} 關 / ${list.length}`
    el.route.innerHTML = ''
    list.forEach((m, i) => {
      const ready = m.battle !== null
      const b = document.createElement('button')
      b.className = `stop ${ready ? 'ready' : 'soon'}${i === k ? ' on paperbit' : ''}`
      // 【e2e 用 id 選卡】標題會改，id 不會
      b.dataset['mission'] = m.id
      b.innerHTML = `<div class="k">第 ${i + 1} 關　${escapeHtml(m.type)}</div><div class="n">${escapeHtml(m.title)}</div>`
        + (ready ? '' : '<div class="soonmark">準備中</div>')
      b.addEventListener('click', () => {
        picked[campaign] = i
        renderMission()
      })
      el.route.appendChild(b)
    })
    renderBrief(list[k]!)
  }

  // ── 編組頁 ───────────────────────────────────────────
  function flightRow(setup: SkirmishSetup, team: 'blue' | 'red', f: Flight, i: number): HTMLElement {
    const spec = specOf(f.id)
    const lead = team === 'blue' && setup.lead === i
    const row = document.createElement('div')
    row.className = `flight${lead ? ' lead paperbit' : ''}`
    row.innerHTML =
      (team === 'blue' ? '<button class="pick" title="我帶這一隊"></button>' : '<span></span>')
      + `<div class="who"><div class="nm">${escapeHtml(shortName(spec))} <span class="full">${escapeHtml(fullName(spec))}</span></div>`
      + `<div class="meta">${ROLE_WORD[spec.role]}　${topSpeedKmh(spec.id)} km/h　耐受 ${spec.hp}</div></div>`
      + `<div class="dots">${[1, 2, 3, 4].map((n) => `<i class="${n <= f.count ? 'on' : ''}"></i>`).join('')}</div>`
      + `<div class="qty"><button class="btn tiny minus">−</button><span class="n">${f.count}</span>`
      + `<button class="btn tiny plus">＋</button><button class="btn tiny rm">✕</button></div>`
    row.querySelector('.pick')?.addEventListener('click', () => hooks.onSetup(setLead(setup, i)))
    row.querySelector('.minus')!.addEventListener('click', () => hooks.onSetup(setCount(setup, team, i, f.count - 1)))
    row.querySelector('.plus')!.addEventListener('click', () => hooks.onSetup(setCount(setup, team, i, f.count + 1)))
    row.querySelector('.rm')!.addEventListener('click', () => hooks.onSetup(removeFlight(setup, team, i)))
    return row
  }

  function renderSide(setup: SkirmishSetup, team: 'blue' | 'red'): void {
    const host = team === 'blue' ? el.mine : el.foe
    const list = team === 'blue' ? setup.blue : setup.red
    host.innerHTML = `<header><h3>${team === 'blue' ? '我方' : '敵方'}</h3>`
      + `<span class="count"><b>${flightsTotal(list)}</b><small> / ${MAX_SIDE} 架</small></span></header>`
    list.forEach((f, i) => host.appendChild(flightRow(setup, team, f, i)))

    const add = document.createElement('button')
    add.className = 'btn add'
    add.textContent = '＋ 加一個分隊'
    // 【滿了就禁用，不是點了沒反應】看起來可點卻沒反應才是真的壞掉
    add.disabled = list.length >= MAX_FLIGHTS || flightsTotal(list) >= MAX_SIDE
    add.addEventListener('click', () => {
      paletteOpen[team] = !paletteOpen[team]
      renderSetup(setup)
    })
    host.appendChild(add)

    const pal = document.createElement('div')
    pal.className = 'palette'
    pal.hidden = !paletteOpen[team] || add.disabled
    for (const spec of ALL_SPECS) {
      const b = document.createElement('button')
      b.className = 'plane'
      b.innerHTML = `<span class="sil">${SIL[spec.role]}</span><span>`
        + `<span class="nm">${escapeHtml(shortName(spec))}</span><br>`
        + `<span class="st">${escapeHtml(fullName(spec))}　${topSpeedKmh(spec.id)} km/h</span></span>`
      b.addEventListener('click', () => {
        paletteOpen[team] = false
        hooks.onSetup(addFlight(setup, team, spec.id))
      })
      pal.appendChild(b)
    }
    host.appendChild(pal)
  }

  function renderVersus(setup: SkirmishSetup): void {
    const m = flightsTotal(setup.blue)
    const f = flightsTotal(setup.red)
    const hi = Math.max(m, f, 1)
    const byRole = (list: readonly Flight[], role: AircraftSpec['role']) =>
      list.filter((x) => specOf(x.id).role === role).reduce((n, x) => n + x.count, 0)
    el.versus.innerHTML = `<div class="vs">對戰</div>`
      + `<div class="bar"><i class="m" style="height:${(m / hi) * 50}%"></i><i class="f" style="height:${(f / hi) * 50}%"></i></div>`
      + `<div class="odds"><b class="m">${m}</b> ： <b class="f">${f}</b><br>`
      + `戰鬥機 ${byRole(setup.blue, 'fighter')} : ${byRole(setup.red, 'fighter')}<br>`
      + `轟炸機 ${byRole(setup.blue, 'bomber')} : ${byRole(setup.red, 'bomber')}</div>`
  }

  function optRow<T>(
    host: HTMLElement, items: readonly { label: string; hint: string; value: T; sil: string }[],
    current: T, onPick: (v: T) => void,
  ): void {
    host.innerHTML = ''
    for (const it of items) {
      const b = document.createElement('button')
      b.className = it.value === current ? 'on' : ''
      b.innerHTML = `${it.sil}<span>${escapeHtml(it.label)}</span><small>${escapeHtml(it.hint)}</small>`
      b.addEventListener('click', () => onPick(it.value))
      host.appendChild(b)
    }
  }

  function renderSetup(setup: SkirmishSetup): void {
    el.presets.innerHTML = ''
    for (const key of Object.keys(PRESETS) as PresetKey[]) {
      const b = document.createElement('button')
      b.className = 'btn tiny'
      b.textContent = PRESETS[key].label
      b.addEventListener('click', () => hooks.onSetup(applyPreset(setup, key)))
      el.presets.appendChild(b)
    }
    renderSide(setup, 'blue')
    renderSide(setup, 'red')
    renderVersus(setup)
    optRow(el.terrain, TERRAINS, setup.terrain, (v) => hooks.onSetup({ ...setup, terrain: v }))
    optRow(el.alt, ALTITUDES.map((a, i) => ({ label: a.label, hint: `${a.value.toLocaleString()} m`, value: a.value, sil: altSil(ALT_Y[i] ?? 12) })),
      setup.altitude, (v) => hooks.onSetup({ ...setup, altitude: v }))
    // 【任一邊空著就禁用】不靠 `battleConfigFrom` 補一架 —— 那是防禦，不是 UI 的行為
    const empty = flightsTotal(setup.blue) === 0 || flightsTotal(setup.red) === 0
    el.go.disabled = empty
    el.warn.textContent = empty ? '兩邊都要有人才打得起來' : ''
  }

  renderMenuMeta()
  renderCampaign()

  return {
    show(screen) {
      for (const [name, s] of Object.entries(sections)) {
        if (s) s.hidden = name !== screen
      }
      if (screen === 'mission') renderMission()
    },
    setPaused(v) {
      pause.hidden = !v
    },
    renderSetup,
  }
}

/** 名字與文案都是資料，不是標記。與 `ui/scoreboard.ts` 同一個理由 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;'
  ))
}
