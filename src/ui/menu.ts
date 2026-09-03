import { MISSIONS, type MissionCard } from '../battle/missions'
import {
  ALL_SPECS, specOf, withAircraft, withoutAircraft,
  ALTITUDES, MAX_SIDE, type FactionChoice, type SkirmishSetup,
} from '../battle/skirmish'
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
   * 使用者點了一張任務卡。
   *
   * 【為什麼是獨立的 hook 而不是塞進 `onEvent`】`ScreenEvent` 是一個字串，
   * 帶不了「哪一張卡」。與 `onSetup` 同一類：畫面之外的資料。
   *
   * 【先送這個，再送 `fight`】呼叫端要先知道打哪一關，才建得出戰鬥。
   */
  onMission(card: MissionCard): void
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

/**
 * 機種在設定頁上的短名。**找不到就用 `spec.name`。**
 *
 * 【為什麼不直接用 `spec.name`】「B-17G Flying Fortress」在一顆按鈕上
 * 是 22 個字，四顆排下來會把那一欄撐到溢出畫面 —— 實測就是這樣。
 *
 * 【為什麼漏填只是變長而不是報錯】這是一張顯示用的對照表，不是設定。
 * 新機種沒填進來的代價是那一顆按鈕比別人寬，看得見、修得快，而且
 * 不會擋住任何人玩。
 */
const SHORT_NAME: Record<string, string> = {
  p51d: 'P-51D', bf109k4: 'Bf 109 K-4', f6f5: 'F6F-5', ki84: 'Ki-84', a6m5: 'A6M5', g4m: 'G4M',
  b17g: 'B-17G', he111: 'He 111',
}

const shortName = (id: string): string => SHORT_NAME[id] ?? specOf(id).name

/**
 * 場地的選項。**順序即按鈕順序。**
 *
 * 【為什麼群島在前】它是預設，也是有東西可看的那一個。純海面留著是因為
 * `createTerrain` 的兩個分支都要有人走 —— 不然那條路徑會變成死碼。
 */
const TERRAINS: readonly { label: string; value: TerrainKind }[] = [
  { label: '群　島', value: 'archipelago' },
  { label: '內　陸', value: 'farmland' },
  { label: '純海面', value: 'sea' },
]

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
  const adders: Record<'blue' | 'red', HTMLElement> = {
    blue: root.querySelector('#blue-add') as HTMLElement,
    red: root.querySelector('#red-add') as HTMLElement,
  }
  const rosters: Record<'blue' | 'red', HTMLElement> = {
    blue: root.querySelector('#blue-roster') as HTMLElement,
    red: root.querySelector('#red-roster') as HTMLElement,
  }
  const heads: Record<'blue' | 'red', HTMLElement> = {
    blue: root.querySelector('#blue-head') as HTMLElement,
    red: root.querySelector('#red-head') as HTMLElement,
  }
  /**
   * 遭遇戰那一頁的「開始戰鬥」。**任一邊空著就禁用。**
   *
   * 【為什麼不靠 `battleConfigFrom` 補一架】那一層的補救是防禦性的
   * （名單是從 DOM 來的），拿它當 UI 的行為會變成「畫面上是空的卻打得
   * 起來，而且憑空多一架沒人點過的飛機」—— 兩個不一致的真相。
   */
  const fightButton = root.querySelector('#skirmish [data-act="fight"]') as HTMLButtonElement
  const picks = {
    terrain: root.querySelector('#terrain-pick') as HTMLElement,
    altitude: root.querySelector('#altitude-pick') as HTMLElement,
  }

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
    // 【這兩個不換畫面】所以它們不走狀態機
    if (act === 'resume') { hooks.onResume(); return }
    if (act === 'restart') { hooks.onRestart(); return }
    hooks.onEvent(act as ScreenEvent)
  })

  /**
   * 一列單選按鈕。**場地與開場高度共用這一支。**
   *
   * 【為什麼不是下拉】同一頁的其他控制項全是按鈕列。下拉在這個尺寸下要
   * 另外寫一整套樣式，而且少一次點擊換不到什麼。
   */
  function pickRow<T>(
    host: HTMLElement, options: readonly { label: string; value: T }[],
    current: T, onPick: (v: T) => void,
  ): void {
    host.innerHTML = ''
    for (const o of options) {
      const b = document.createElement('button')
      b.textContent = o.label
      if (o.value === current) b.classList.add('sel')
      b.addEventListener('click', () => onPick(o.value))
      host.appendChild(b)
    }
  }

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
      // 【只有做好的卡可點】看起來可點卻沒反應才是真的壞掉。攔截與護航缺
      // 第三種機體、打擊缺對地武器，那三張維持 M10 的樣子
      b.disabled = !m.playable
      b.innerHTML =
        `<span class="card-title">${escapeHtml(m.title)}</span>`
        + `<span class="card-desc">${escapeHtml(m.summary)}</span>`
        + `<span class="card-meta">${escapeHtml(m.type)}</span>`
        + (m.playable ? '' : '<span class="locked">未開放</span>')
      // 【為什麼卡片用自己的監聽器而不是 data-act】`data-act` 只帶得了一個
      // 字串，而這裡要帶「哪一張卡」。`factionRow` 與 `stepper` 早就這樣做
      if (m.playable) {
        b.addEventListener('click', () => {
          hooks.onMission(m)
          hooks.onEvent('fight')
        })
      }
      missionList.appendChild(b)
    }
  }

  /**
   * 一隻的名單卡。**兩顆按鈕，不是一顆。**
   *
   * 【為什麼不把「選我」跟「移除」合成一顆】一顆按鈕只能有一個動作，
   * 而這裡真的有兩個。分開之後「✕ 才會刪掉東西」在兩邊都成立——
   * 點卡片本體不可能誤刪。
   */
  function chip(
    host: HTMLElement, team: 'blue' | 'red', setup: SkirmishSetup, index: number,
  ): void {
    const list = team === 'blue' ? setup.blue : setup.red
    const wrap = document.createElement('span')
    wrap.className = 'chip'

    const body = document.createElement('button')
    body.textContent = `${index + 1}　${shortName(list[index]!)}`
    if (team === 'blue') {
      // 【藍隊的卡片點一下就是「我開這一台」】選中的那一台高亮，
      // 而且 `mixedLine` 會把它換到它那一小隊的長機位
      if (index === setup.playerAt) body.classList.add('me')
      body.addEventListener('click', () => hooks.onSetup({ ...setup, playerAt: index }))
    } else {
      // 【敵方沒有「選我」】本體不收點擊，但仍然是一顆按鈕——
      // 換成 span 的話字型、邊框、高度全都要另外再寫一份。
      // 【不用 disabled】那條 CSS 把透明度壓到 .38，一整排敵機看起來
      // 像壞掉的按鈕；`.static` 只是把指標事件關掉
      body.classList.add('static')
    }
    wrap.appendChild(body)

    const del = document.createElement('button')
    del.className = 'del'
    del.textContent = '✕'
    del.addEventListener('click', () => hooks.onSetup(withoutAircraft(setup, team, index)))
    wrap.appendChild(del)
    host.appendChild(wrap)
  }

  function renderSide(team: 'blue' | 'red', setup: SkirmishSetup): void {
    const list = team === 'blue' ? setup.blue : setup.red
    const label = team === 'blue' ? '我方' : '敵方'

    adders[team].innerHTML = ''
    for (const spec of ALL_SPECS) {
      const b = document.createElement('button')
      b.textContent = shortName(spec.id)
      // 【滿編時禁用而不是點了沒反應】看起來可點卻沒反應才是真的壞掉
      b.disabled = list.length >= MAX_SIDE
      b.addEventListener('click', () => hooks.onSetup(withAircraft(setup, team, spec.id)))
      adders[team].appendChild(b)
    }
    // 【清空】預設是 20 對 20，要重編一整組時一架一架按 ✕ 是二十下
    const clear = document.createElement('button')
    clear.className = 'ghost'
    clear.textContent = '清空'
    clear.disabled = list.length === 0
    clear.addEventListener('click', () => hooks.onSetup(
      team === 'blue' ? { ...setup, blue: [], playerAt: 0 } : { ...setup, red: [] },
    ))
    adders[team].appendChild(clear)

    heads[team].textContent = `${label}出戰　${list.length} / ${MAX_SIDE}`
      + (team === 'blue' ? '　（點一台選我開哪一架）' : '')
    rosters[team].innerHTML = ''
    for (let i = 0; i < list.length; i++) chip(rosters[team], team, setup, i)
  }

  function renderSetup(setup: SkirmishSetup): void {
    renderSide('blue', setup)
    renderSide('red', setup)
    pickRow(picks.terrain, TERRAINS, setup.terrain,
      (v) => hooks.onSetup({ ...setup, terrain: v }))
    pickRow(picks.altitude, ALTITUDES, setup.altitude,
      (v) => hooks.onSetup({ ...setup, altitude: v }))
    fightButton.disabled = setup.blue.length === 0 || setup.red.length === 0
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
