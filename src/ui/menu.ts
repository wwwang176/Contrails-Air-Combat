import { MISSIONS } from './missions'
import {
  specsFor, MAX_SIDE, MIN_SIDE, type FactionChoice, type SkirmishSetup,
} from '../battle/skirmish'
import type { Screen, ScreenEvent } from './screens'

export interface MenuHooks {
  /** 使用者送出一個畫面事件 */
  onEvent(event: ScreenEvent): void
  /** 使用者改了遭遇戰設定 */
  onSetup(setup: SkirmishSetup): void
  /** 暫停選單的「繼續」 */
  onResume(): void
}

export interface Menu {
  /** 顯示指定畫面，其餘隱藏 */
  show(screen: Screen): void
  /** 暫停 overlay */
  setPaused(v: boolean): void
  /** 依目前的設定重畫遭遇戰那一頁 */
  renderSetup(setup: SkirmishSetup): void
}

const FACTION_LABEL: Record<FactionChoice, string> = {
  allies: '同盟國',
  axis: '軸心國',
}

/** 難度星等。實心到 difficulty，其餘空心 */
function stars(n: number): string {
  return '★'.repeat(n) + '☆'.repeat(5 - n)
}

/**
 * 選單的 DOM 元件。
 *
 * 【為什麼不用前端框架】狀態只有「五個畫面之一」加上一個設定物件，
 * 一個變數與一次 `render()` 就寫完了。同一頁的真正風險是 three.js 的
 * 資源生命週期，而那是框架碰不到的地方（M10 spec §9.1）。
 *
 * 【為什麼整段重建而不是逐格更新】只在切換畫面或改設定時才呼叫，
 * 頻率是「使用者點一下」。
 */
export function createMenu(root: HTMLElement, hooks: MenuHooks): Menu {
  const sections: Record<Screen, HTMLElement | null> = {
    landing: root.querySelector('#landing'),
    menu: root.querySelector('#menu'),
    mission: root.querySelector('#mission'),
    skirmish: root.querySelector('#skirmish'),
    // 戰鬥沒有自己的 section —— 它就是「全部都藏起來」
    battle: null,
  }
  const pause = root.querySelector('#pause') as HTMLElement
  const missionFactions = root.querySelector('#mission-factions') as HTMLElement
  const missionList = root.querySelector('#mission-list') as HTMLElement
  const skirmishFactions = root.querySelector('#skirmish-factions') as HTMLElement
  const skirmishSpecs = root.querySelector('#skirmish-specs') as HTMLElement
  const blueStepper = root.querySelector('#blue-count') as HTMLElement
  const redStepper = root.querySelector('#red-count') as HTMLElement

  /** 任務模式自己的陣營選擇 —— 與遭遇戰的那一個互不相干 */
  let missionFaction: FactionChoice = 'allies'

  // 【事件委派】按鈕是動態產生的，一個一個掛監聽器會在重畫時漏掉舊的。
  //
  // 【為什麼掛在 document 而不是 root】結算板的「再打一場」與「回設定頁」
  // 在 `#board` 裡，不在 `#ui` 底下 —— 掛在 root 上那兩顆按鈕永遠不會
  // 送出事件，而症狀是「按了沒反應」。data-act 是這一層唯一的協定，
  // 誰擁有那個節點不重要。
  root.ownerDocument.addEventListener('click', (e) => {
    const el = (e.target as HTMLElement).closest('button')
    if (!el || el.disabled) return
    const act = el.dataset['act']
    if (act === undefined) return
    if (act === 'resume') { hooks.onResume(); return }
    hooks.onEvent(act as ScreenEvent)
  })

  function factionRow(
    host: HTMLElement, current: FactionChoice, onPick: (f: FactionChoice) => void,
  ): void {
    host.innerHTML = ''
    for (const f of ['allies', 'axis'] as const) {
      const b = document.createElement('button')
      b.textContent = FACTION_LABEL[f]
      if (f === current) b.classList.add('sel')
      b.addEventListener('click', () => onPick(f))
      host.appendChild(b)
    }
  }

  function renderMissions(): void {
    factionRow(missionFactions, missionFaction, (f) => {
      missionFaction = f
      renderMissions()
    })
    missionList.innerHTML = ''
    for (const m of MISSIONS[missionFaction]) {
      const b = document.createElement('button')
      b.className = 'card'
      // 【全部不可點】M10 沒有任務內容。看起來可點卻沒反應才是真的壞掉
      b.disabled = true
      b.innerHTML =
        `<span class="card-title">${escapeHtml(m.title)}</span>`
        + `<span class="card-desc">${escapeHtml(m.summary)}</span>`
        + `<span class="card-meta">${escapeHtml(m.type)}　${stars(m.difficulty)}</span>`
        + '<span class="locked">未開放</span>'
      missionList.appendChild(b)
    }
  }

  function stepper(host: HTMLElement, value: number, onChange: (v: number) => void): void {
    host.innerHTML = ''
    const dec = document.createElement('button')
    dec.textContent = '◀'
    dec.disabled = value <= MIN_SIDE
    dec.addEventListener('click', () => onChange(value - 1))
    const span = document.createElement('span')
    span.className = 'value'
    span.textContent = String(value)
    const inc = document.createElement('button')
    inc.textContent = '▶'
    inc.disabled = value >= MAX_SIDE
    inc.addEventListener('click', () => onChange(value + 1))
    host.append(dec, span, inc)
  }

  function renderSetup(setup: SkirmishSetup): void {
    factionRow(skirmishFactions, setup.faction, (f) => {
      // 【換陣營要把機種一起換掉】否則 specId 會留著上一個陣營的機
      hooks.onSetup({ ...setup, faction: f, specId: specsFor(f)[0]!.id })
    })
    skirmishSpecs.innerHTML = ''
    for (const s of specsFor(setup.faction)) {
      const b = document.createElement('button')
      b.textContent = s.name
      if (s.id === setup.specId) b.classList.add('sel')
      b.addEventListener('click', () => hooks.onSetup({ ...setup, specId: s.id }))
      skirmishSpecs.appendChild(b)
    }
    stepper(blueStepper, setup.blueCount, (v) => hooks.onSetup({ ...setup, blueCount: v }))
    stepper(redStepper, setup.redCount, (v) => hooks.onSetup({ ...setup, redCount: v }))
  }

  renderMissions()

  return {
    show(screen) {
      for (const [name, el] of Object.entries(sections)) {
        if (el) el.hidden = name !== screen
      }
      if (screen === 'mission') renderMissions()
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
