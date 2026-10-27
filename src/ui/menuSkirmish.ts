import { specOf } from '../specs/catalog'
import { SCHWARM_SIZE } from '../battle/flights'
import {
  addFlight, setCount, removeFlight, setLead, applyPreset, flightsTotal,
  PRESETS, ALTITUDES, MAX_SIDE, MAX_FLIGHTS, PERFORMANCE_LEVELS, type SkirmishSetup, type Flight, type PresetKey,
} from '../battle/skirmish'
import { formatNumber, t, type MessageKey } from '../i18n'
import type { PerformanceLevel } from '../specs/feel'
import type { AircraftSpec } from '../specs/types'
import type { TerrainKind } from '../world/terrainKind'
import type { TimeOfDay } from '../world/timeOfDay'
import { strengthOf, SIDE_OF } from './dossier'
import { shortName } from '../i18n/names'
import { optRow, escapeHtml, type OptItem } from './menuOptions'
import { campaignLabel, HANGAR_SPECS, roleWord, silBadge } from './menuAircraft'

/** WebP 實體尺寸為 2x，HTML 尺寸固定，避免載入前後排版跳動。 */
const settingImage = (id: string): string =>
  `<img class="setting-image" src="/ui/skirmish-options/${id}.webp" width="72" height="26" alt="" decoding="async" draggable="false">`

/** 場地的選項。**順序即按鈕順序。**群島在前：它是預設，也是有東西可看的那一個 */
const TERRAINS: readonly OptItem<TerrainKind>[] = [
  { labelKey: 'terrain.archipelago', hintKey: 'terrain.archipelago.hint', value: 'archipelago',
    sil: settingImage('archipelago') },
  { labelKey: 'terrain.leyte', hintKey: 'terrain.leyte.hint', value: 'leyte',
    sil: settingImage('leyte') },
  { labelKey: 'terrain.farmland', hintKey: 'terrain.farmland.hint', value: 'farmland',
    sil: settingImage('farmland') },
  { labelKey: 'terrain.autumnFarmland', hintKey: 'terrain.autumnFarmland.hint', value: 'autumnFarmland',
    sil: settingImage('autumnFarmland') },
  { labelKey: 'terrain.leuna', hintKey: 'terrain.leuna.hint', value: 'leuna',
    sil: settingImage('leuna') },
  { labelKey: 'terrain.poltava', hintKey: 'terrain.poltava.hint', value: 'poltava',
    sil: settingImage('poltava') },
  { labelKey: 'terrain.asch', hintKey: 'terrain.asch.hint', value: 'asch',
    sil: settingImage('asch') },
  { labelKey: 'terrain.rzhev', hintKey: 'terrain.rzhev.hint', value: 'rzhev',
    sil: settingImage('rzhev') },
  { labelKey: 'terrain.sea', hintKey: 'terrain.sea.hint', value: 'sea',
    sil: settingImage('sea') },
]
/** 高度圖片沿用相同地平線，以飛機離地位置區分。 */
const ALT_IMAGES: Readonly<Record<number, string>> = { 600: 'alt-low', 1500: 'alt-mid', 4000: 'alt-high', 6000: 'alt-top' }
/**
 * 時段的選項。**順序即按鈕順序，與 `render/timeOfDay.ts` 的 `TIME_OF_DAY_IDS`
 * 一致**；十一月的正午不列（它是洛伊納那一關的天色，選單上與正午分不出來）。
 * 圖片僅作選項示意，遊戲光照仍由原本的時段設定決定。
 */
const TIMES: readonly OptItem<TimeOfDay>[] = [
  { labelKey: 'tod.dawn', hintKey: 'tod.dawn.hint', value: 'dawn',
    sil: settingImage('dawn') },
  { labelKey: 'tod.noon', hintKey: 'tod.noon.hint', value: 'noon',
    sil: settingImage('noon') },
  { labelKey: 'tod.dusk', hintKey: 'tod.dusk.hint', value: 'dusk',
    sil: settingImage('dusk') },
  { labelKey: 'tod.night', hintKey: 'tod.night.hint', value: 'night',
    sil: settingImage('night') },
  { labelKey: 'tod.storm', hintKey: 'tod.storm.hint', value: 'storm',
    sil: settingImage('storm') },
]
/** 飛機性能的選項，順序照 `PERFORMANCE_LEVELS` */
const PERFORMANCES: readonly OptItem<PerformanceLevel>[] = PERFORMANCE_LEVELS.map((value) => ({
  labelKey: `perf.${value}`, hintKey: `perf.${value}.hint`, value, sil: settingImage(`perf-${value}`),
}))

/** 管編隊編輯與選機視窗；每一次提出的設定由呼叫端套用 */
export function createMenuSkirmish(
  el: { presets: HTMLElement; mine: HTMLElement; foe: HTMLElement; versus: HTMLElement;
    terrain: HTMLElement; alt: HTMLElement; tod: HTMLElement; perf: HTMLElement; go: HTMLButtonElement },
  planePick: HTMLElement,
  optionPick: HTMLElement,
  hooks: { onSetup(setup: SkirmishSetup): void },
  openOverlay: (element: HTMLElement) => void,
  closeOverlay: (element: HTMLElement) => void,
) {
  const q = (id: string): HTMLElement => planePick.querySelector('#' + id) as HTMLElement
  /** 最後一次畫的編組；換語言時照它重畫 */
  let lastSetup: SkirmishSetup | null = null
  /** 機種彈窗最後一次打開時的參數；換語言時照它重畫 */
  let lastPick: { readonly setup: SkirmishSetup; readonly team: 'blue' | 'red' } | null = null
  let optionHost: HTMLElement | null = null
  const optionList = optionPick.querySelector<HTMLElement>('#sk-option-list')!
  const optionTitle = optionPick.querySelector<HTMLElement>('#sk-option-title')!
  function focusSetting(): void {
    optionHost?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
  }
  function cancelSetting(): void {
    closeOverlay(optionPick)
    focusSetting()
  }
  optionPick.querySelector('.sk-option-cancel')!.addEventListener('click', cancelSetting)
  optionPick.addEventListener('click', (e) => { if (e.target === optionPick) cancelSetting() })
  optionPick.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      cancelSetting()
    }
    if (e.key !== 'Tab') return
    const buttons = Array.from(optionPick.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    const first = buttons[0]
    const last = buttons[buttons.length - 1]
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  })
  /** 主頁只呈現目前設定；彈窗沿用既有資料與套用流程。 */
  function settingChoice<T>(host: HTMLElement, label: MessageKey, items: readonly OptItem<T>[], current: T, onPick: (value: T) => void): void {
    const selected = items.find((item) => item.value === current) ?? items[0]!
    const name = selected.labelKey === undefined ? selected.label ?? '' : t(selected.labelKey)
    const hint = selected.hintKey === undefined ? selected.hint ?? '' : t(selected.hintKey)
    const reading = host === el.alt ? hint : name
    const detail = host === el.alt ? name : hint
    const button = document.createElement('button')
    button.className = 'setting-summary'
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-controls', 'sk-option-pick')
    button.setAttribute('aria-label', `${t(label)}: ${name}${hint ? ` · ${hint}` : ''}`)
    button.innerHTML = `<span class="setting-art" aria-hidden="true">${selected.sil}</span>`
      + `<span class="setting-value"><span class="setting-caption">${escapeHtml(t(label))}</span><b>${escapeHtml(reading)}</b><small>${escapeHtml(detail)}</small></span>`
      + '<span class="setting-chevron" aria-hidden="true">›</span>'
    button.addEventListener('click', () => {
      optionHost = host
      optionTitle.textContent = t(label)
      optRow(optionList, items, current, (value) => {
        closeOverlay(optionPick)
        onPick(value)
        focusSetting()
      })
      optionList.dataset.kind = host.id
      optionList.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.classList.contains('on'))))
      openOverlay(optionPick)
      optionList.querySelector<HTMLButtonElement>('button.on')?.focus({ preventScroll: true })
    })
    host.replaceChildren(button)
  }
  // ── 編組頁 ───────────────────────────────────────────
  function flightRow(setup: SkirmishSetup, team: 'blue' | 'red', f: Flight, i: number): HTMLElement {
    const spec = specOf(f.id)
    const lead = team === 'blue' && setup.lead === i
    const row = document.createElement('div')
    row.className = `flight${team === 'blue' ? ' selectable' : ''}${lead ? ' lead' : ''}`
    row.innerHTML =
      silBadge(spec.id)
      + `<div class="who" title="${escapeHtml(roleWord(spec.role))} · ${escapeHtml(strengthOf(spec.id))}"><div class="nm">${escapeHtml(shortName(spec))}</div>`
      + `<div class="meta">${escapeHtml(lead ? t('skirmish.myFlight') : roleWord(spec.role))}</div></div>`
      + (team === 'blue'
        ? `<button class="flight-select" aria-pressed="${lead}" aria-label="${escapeHtml(t('skirmish.myFlight'))} · ${i + 1} · ${escapeHtml(shortName(spec))}"></button>`
        : `<span class="flight-index">${String(i + 1).padStart(2, '0')}</span>`)
      + `<div class="qty"><button class="btn tiny minus">−</button><span class="n">${f.count}</span>`
      + `<button class="btn tiny plus">+</button><button class="btn tiny rm">✕</button></div>`
    const plus = row.querySelector<HTMLButtonElement>('.plus')!
    plus.disabled = f.count >= SCHWARM_SIZE || flightsTotal(team === 'blue' ? setup.blue : setup.red) >= MAX_SIDE
    // 透明按鈕覆蓋整張卡，數量操作在它上方；保留原生鍵盤操作，不再畫 radio。
    row.querySelector<HTMLButtonElement>('.flight-select')?.addEventListener('click', (e) => {
      hooks.onSetup(setLead(setup, i))
      if (e.detail === 0) el.mine.querySelectorAll<HTMLButtonElement>('.flight-select')[i]?.focus({ preventScroll: true })
    })
    row.querySelector('.minus')!.addEventListener('click', () => hooks.onSetup(setCount(setup, team, i, f.count - 1)))
    row.querySelector('.plus')!.addEventListener('click', () => hooks.onSetup(setCount(setup, team, i, f.count + 1)))
    row.querySelector('.rm')!.addEventListener('click', () => hooks.onSetup(removeFlight(setup, team, i)))
    return row
  }
  function renderSide(setup: SkirmishSetup, team: 'blue' | 'red'): void {
    const host = team === 'blue' ? el.mine : el.foe
    const list = team === 'blue' ? setup.blue : setup.red
    host.innerHTML = `<header><h3>${escapeHtml(t(team === 'blue' ? 'side.mine' : 'side.foe'))}</h3>`
      + `<span class="count"><b>${flightsTotal(list)}</b><small> ${escapeHtml(t('skirmish.capacity', { n: MAX_SIDE }))}</small></span></header>`
    list.forEach((f, i) => host.appendChild(flightRow(setup, team, f, i)))

    const add = document.createElement('button')
    add.className = 'btn add'
    add.textContent = t('skirmish.addFlight')
    // 【滿了就禁用，不是點了沒反應】看起來可點卻沒反應才是真的壞掉
    add.disabled = list.length >= MAX_FLIGHTS || flightsTotal(list) >= MAX_SIDE
    add.addEventListener('click', () => openPlanePick(setup, team))
    host.appendChild(add)
  }
  /**
   * 「加一個小隊」的機種彈窗。點一架就加進那一側並收起來。
   *
   * 【帶著開窗當下的 `setup`】彈窗開著的時候編組頁點不到，設定不會在這之間變
   */
  function openPlanePick(setup: SkirmishSetup, team: 'blue' | 'red'): void {
    lastPick = { setup, team }
    q('plane-pick-title').textContent = t('skirmish.addFlightTitle', { side: t(team === 'blue' ? 'side.mine' : 'side.foe') })
    const list = q('plane-pick-list')
    list.innerHTML = ''
    for (const spec of HANGAR_SPECS) {
      const b = document.createElement('button')
      b.className = 'plane'
      // 【國家在前、類型在下】例如「美軍 P-51D」，類型排在下面。全名讓位給
      // 這兩項 —— 選單是三欄的窄卡，`North American P-51D Mustang` 在那裡
      // 一定折行
      const side = SIDE_OF[spec.id]
      b.innerHTML = `${silBadge(spec.id)}<div>`
        + `<div class="nm">${side === undefined ? '' : `<i>${escapeHtml(campaignLabel(side))}</i> `}`
        + `${escapeHtml(shortName(spec))}</div>`
        + `<div class="st">${escapeHtml(roleWord(spec.role))} · ${escapeHtml(strengthOf(spec.id))}</div></div>`
      b.addEventListener('click', () => {
        closeOverlay(planePick)
        hooks.onSetup(addFlight(setup, team, spec.id))
      })
      list.appendChild(b)
    }
    openOverlay(planePick)
  }
  function renderVersus(setup: SkirmishSetup): void {
    const m = flightsTotal(setup.blue)
    const f = flightsTotal(setup.red)
    const byRole = (list: readonly Flight[], role: AircraftSpec['role']) =>
      list.filter((x) => specOf(x.id).role === role).reduce((n, x) => n + x.count, 0)
    el.versus.innerHTML = `<div class="vs">${escapeHtml(t('skirmish.versus'))}</div>`
      + `<div class="odds"><span class="totals"><b class="m">${m}</b><span>:</span><b class="f">${f}</b></span>`
      + `<span class="role-odds">${escapeHtml(t('skirmish.fighters', { a: byRole(setup.blue, 'fighter'), b: byRole(setup.red, 'fighter') }))}</span>`
      + `<span class="role-odds">${escapeHtml(t('skirmish.bombers', { a: byRole(setup.blue, 'bomber'), b: byRole(setup.red, 'bomber') }))}</span></div>`
  }
  function renderSetup(setup: SkirmishSetup): void {
    lastSetup = setup
    el.presets.innerHTML = ''
    for (const key of Object.keys(PRESETS) as PresetKey[]) {
      const b = document.createElement('button')
      b.className = 'btn tiny'
      b.textContent = t(PRESETS[key].labelKey)
      b.addEventListener('click', () => hooks.onSetup(applyPreset(setup, key)))
      el.presets.appendChild(b)
    }
    renderSide(setup, 'blue')
    renderSide(setup, 'red')
    renderVersus(setup)
    settingChoice(el.terrain, 'skirmish.terrain', TERRAINS, setup.terrain, (v) => hooks.onSetup({ ...setup, terrain: v }))
    settingChoice(el.alt, 'skirmish.altitude', ALTITUDES.map((a) => ({ labelKey: a.labelKey, hint: `${formatNumber(a.value)} m`, value: a.value, sil: settingImage(ALT_IMAGES[a.value] ?? 'alt-mid') })),
      setup.altitude, (v) => hooks.onSetup({ ...setup, altitude: v }))
    settingChoice(el.tod, 'skirmish.tod', TIMES, setup.timeOfDay, (v) => hooks.onSetup({ ...setup, timeOfDay: v }))
    settingChoice(el.perf, 'skirmish.performance', PERFORMANCES, setup.performance, (v) => hooks.onSetup({ ...setup, performance: v }))
    // 【任一邊空著就禁用】不靠 `battleConfigFrom` 補一架 —— 那是防禦，不是 UI 的行為
    // 【只禁用，不寫一行字】一邊空著的時候那一欄本身就是空的、按鈕也灰了，
    // 再寫一句「兩邊都要有人才打得起來」是多的
    el.go.disabled = flightsTotal(setup.blue) === 0 || flightsTotal(setup.red) === 0
  }
  // 【點遮罩收起來】只認點在遮罩本身，點到框裡的東西不算
  planePick.addEventListener('click', (e) => { if (e.target === planePick) closeOverlay(planePick) })

  function redrawSetup(): void {
    if (lastSetup !== null) renderSetup(lastSetup)
  }

  function redrawPlanePick(): void {
    if (!planePick.hidden && lastPick !== null) openPlanePick(lastPick.setup, lastPick.team)
  }

  return { renderSetup, redrawSetup, redrawPlanePick }
}
