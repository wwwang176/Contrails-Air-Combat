import {
  specOf, addFlight, setCount, removeFlight, setLead, applyPreset, flightsTotal,
  PRESETS, ALTITUDES, MAX_SIDE, MAX_FLIGHTS, type SkirmishSetup, type Flight, type PresetKey,
} from '../battle/skirmish'
import { formatNumber, t } from '../i18n'
import type { AircraftSpec } from '../specs/types'
import type { TerrainKind } from '../world/terrainKind'
import type { TimeOfDay } from '../world/timeOfDay'
import { strengthOf, SIDE_OF } from './dossier'
import { shortName } from './briefing'
import { optRow, escapeHtml, type OptItem } from './menuOptions'
import { campaignLabel, fullName, HANGAR_SPECS, roleWord, silBadge } from './menuAircraft'

/** 場地的選項。**順序即按鈕順序。**群島在前：它是預設，也是有東西可看的那一個 */
const TERRAINS: readonly OptItem<TerrainKind>[] = [
  { labelKey: 'terrain.archipelago', hintKey: 'terrain.archipelago.hint', value: 'archipelago',
    sil: '<svg width="72" height="26"><rect y="17" width="72" height="9" fill="#38505c"/><path d="M8 17l9-8 9 8z" fill="#4d5c3f"/><path d="M40 17l13-11 13 11z" fill="#4d5c3f"/></svg>' },
  { labelKey: 'terrain.leyte', hintKey: 'terrain.leyte.hint', value: 'leyte',
    sil: '<svg width="72" height="26"><rect y="17" width="72" height="9" fill="#38505c"/><path d="M30 17h42v9H30z" fill="#3f5a36"/><path d="M30 17l6-3h36v3z" fill="#4b6a3f"/><path d="M40 22h32" stroke="#a89770"/><path d="M48 14v-6m0 0l-4 2m4-2l4 2" stroke="#4b6a3f"/></svg>' },
  { labelKey: 'terrain.farmland', hintKey: 'terrain.farmland.hint', value: 'farmland',
    sil: '<svg width="72" height="26"><rect y="15" width="72" height="11" fill="#4a5238"/><path d="M0 15h72" stroke="#616a48"/><rect x="12" y="9" width="7" height="6" fill="#5c6449"/><rect x="46" y="10" width="9" height="5" fill="#5c6449"/></svg>' },
  { labelKey: 'terrain.autumnFarmland', hintKey: 'terrain.autumnFarmland.hint', value: 'autumnFarmland',
    sil: '<svg width="72" height="26"><rect y="15" width="72" height="11" fill="#57493a"/><path d="M0 15h72" stroke="#6b5c48"/><path d="M8 26l10-11M26 26l10-11M44 26l10-11" stroke="#4a3e32"/><circle cx="60" cy="11" r="4" fill="#6e5440"/></svg>' },
  { labelKey: 'terrain.leuna', hintKey: 'terrain.leuna.hint', value: 'leuna',
    sil: '<svg width="72" height="26"><rect y="18" width="72" height="8" fill="#54493b"/><rect x="18" y="11" width="30" height="7" fill="#6a6258"/><rect x="24" y="3" width="3" height="8" fill="#6a6258"/><rect x="36" y="5" width="3" height="6" fill="#6a6258"/><path d="M0 23q10-3 20 0t20 0" stroke="#3c5260" stroke-width="2" fill="none"/></svg>' },
  { labelKey: 'terrain.poltava', hintKey: 'terrain.poltava.hint', value: 'poltava',
    sil: '<svg width="72" height="26"><rect y="16" width="72" height="10" fill="#566041"/><path d="M6 21h60" stroke="#a7a08e" stroke-width="3"/><path d="M30 12h14M37 9v6" stroke="#b9b2a0" stroke-width="2"/></svg>' },
  { labelKey: 'terrain.asch', hintKey: 'terrain.asch.hint', value: 'asch',
    sil: '<svg width="72" height="26"><rect y="16" width="72" height="10" fill="#4f5a3e"/><path d="M6 21h60" stroke="#7d8078" stroke-width="3" stroke-dasharray="4 2"/><rect x="12" y="12" width="6" height="4" fill="#6b705f"/><rect x="54" y="12" width="6" height="4" fill="#6b705f"/></svg>' },
  { labelKey: 'terrain.rzhev', hintKey: 'terrain.rzhev.hint', value: 'rzhev',
    sil: '<svg width="72" height="26"><rect y="16" width="72" height="10" fill="#c9d1d8"/><path d="M0 16q18-6 36 0t36 0" fill="#e4e9ee"/><path d="M10 23h52" stroke="#8d949b" stroke-width="3"/><path d="M48 16v-7" stroke="#55534d" stroke-width="2"/></svg>' },
  { labelKey: 'terrain.sea', hintKey: 'terrain.sea.hint', value: 'sea',
    sil: '<svg width="72" height="26"><rect y="13" width="72" height="13" fill="#32485a"/><path d="M4 19q6-3 12 0t12 0 12 0 12 0 12 0" stroke="#44607a" fill="none"/></svg>' },
]
/** 開場高度示意：一條虛線的高度就是那一格 */
const altSil = (y: number): string =>
  `<svg width="72" height="26"><rect y="23" width="72" height="3" fill="#4a5238"/>`
  + `<path d="M0 ${y}h72" stroke="#6b5b3f" stroke-dasharray="3 3"/>`
  + `<g transform="translate(30 ${y - 3})" fill="#e3d9c0"><rect x="4" y="0" width="2" height="7"/><rect x="0" y="2" width="10" height="2"/></g></svg>`
const ALT_Y: readonly number[] = [20, 12, 4]
/**
 * 時段的選項。**順序即按鈕順序，與 `render/timeOfDay.ts` 的 `TIME_OF_DAY_IDS`
 * 一致**；十一月的正午不列（它是洛伊納那一關的天色，選單上與正午分不出來）。
 *
 * 【剪影不從 palette 取色】那一份是線性工作空間的光照參數，而這裡是 UI 的
 * sRGB 色票 —— 兩者不是同一件事。剪影只要認得出是哪個時段。
 */
const TIMES: readonly OptItem<TimeOfDay>[] = [
  { labelKey: 'tod.dawn', hintKey: 'tod.dawn.hint', value: 'dawn',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#2c3a46"/><rect width="56" height="18" fill="#5b6f86"/><path d="M0 18h56" stroke="#f0c9a0"/><circle cx="28" cy="18" r="6" fill="#ffd7a8"/></svg>' },
  { labelKey: 'tod.noon', hintKey: 'tod.noon.hint', value: 'noon',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#2e4658"/><rect width="56" height="18" fill="#7ba3c6"/><circle cx="28" cy="7" r="5" fill="#fff4d8"/></svg>' },
  { labelKey: 'tod.dusk', hintKey: 'tod.dusk.hint', value: 'dusk',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#241f2e"/><rect width="56" height="18" fill="#8a5468"/><path d="M0 18h56" stroke="#ff9a52"/><circle cx="28" cy="18" r="6" fill="#ff9a52"/></svg>' },
  { labelKey: 'tod.night', hintKey: 'tod.night.hint', value: 'night',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#0a1018"/><rect width="56" height="18" fill="#16233a"/><circle cx="38" cy="7" r="4" fill="#c8d6ee"/><circle cx="12" cy="6" r="1" fill="#dce6f6"/><circle cx="20" cy="12" r="1" fill="#dce6f6"/><circle cx="7" cy="13" r="1" fill="#dce6f6"/></svg>' },
  { labelKey: 'tod.storm', hintKey: 'tod.storm.hint', value: 'storm',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#1c252c"/><rect width="56" height="18" fill="#3a444d"/><path d="M8 7q4-5 10-2q5-4 11 0q6-2 8 3z" fill="#262e35"/><path d="M30 8l-4 6h4l-3 6" stroke="#f2ecc8" stroke-width="1.5" fill="none"/><path d="M12 11l-2 6M18 11l-2 6M44 9l-2 6M50 9l-2 6" stroke="#7b8894"/></svg>' },
]

/** Owns formation editing and its aircraft picker; the caller applies each proposed setup. */
export function createMenuSkirmish(
  el: { presets: HTMLElement; mine: HTMLElement; foe: HTMLElement; versus: HTMLElement;
    terrain: HTMLElement; alt: HTMLElement; tod: HTMLElement; go: HTMLButtonElement },
  planePick: HTMLElement,
  hooks: { onSetup(setup: SkirmishSetup): void },
  openOverlay: (element: HTMLElement) => void,
  closeOverlay: (element: HTMLElement) => void,
) {
  const q = (id: string): HTMLElement => planePick.querySelector('#' + id) as HTMLElement
  /** 最後一次畫的編組；換語言時照它重畫 */
  let lastSetup: SkirmishSetup | null = null
  /** 機種彈窗最後一次打開時的參數；換語言時照它重畫 */
  let lastPick: { readonly setup: SkirmishSetup; readonly team: 'blue' | 'red' } | null = null
  // ── 編組頁 ───────────────────────────────────────────
  function flightRow(setup: SkirmishSetup, team: 'blue' | 'red', f: Flight, i: number): HTMLElement {
    const spec = specOf(f.id)
    const lead = team === 'blue' && setup.lead === i
    const row = document.createElement('div')
    row.className = `flight${lead ? ' lead paperbit' : ''}`
    row.innerHTML =
      (team === 'blue'
        ? `<button class="pick" title="${escapeHtml(t('skirmish.myFlight'))}"></button>` : '<span></span>')
      + `<div class="who"><div class="nm">${escapeHtml(shortName(spec))} <span class="full">${escapeHtml(fullName(spec))}</span></div>`
      + `<div class="meta">${escapeHtml(roleWord(spec.role))} · ${escapeHtml(strengthOf(spec.id))}</div></div>`
      + `<div class="dots">${[1, 2, 3, 4].map((n) => `<i class="${n <= f.count ? 'on' : ''}"></i>`).join('')}</div>`
      + `<div class="qty"><button class="btn tiny minus">−</button><span class="n">${f.count}</span>`
      + `<button class="btn tiny plus">+</button><button class="btn tiny rm">✕</button></div>`
    row.querySelector('.pick')?.addEventListener('click', () => hooks.onSetup(setLead(setup, i)))
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
    const hi = Math.max(m, f, 1)
    const byRole = (list: readonly Flight[], role: AircraftSpec['role']) =>
      list.filter((x) => specOf(x.id).role === role).reduce((n, x) => n + x.count, 0)
    el.versus.innerHTML = `<div class="vs">${escapeHtml(t('skirmish.versus'))}</div>`
      + `<div class="bar"><i class="m" style="height:${(m / hi) * 50}%"></i><i class="f" style="height:${(f / hi) * 50}%"></i></div>`
      + `<div class="odds"><b class="m">${m}</b> : <b class="f">${f}</b><br>`
      + `${escapeHtml(t('skirmish.fighters', { a: byRole(setup.blue, 'fighter'), b: byRole(setup.red, 'fighter') }))}<br>`
      + `${escapeHtml(t('skirmish.bombers', { a: byRole(setup.blue, 'bomber'), b: byRole(setup.red, 'bomber') }))}</div>`
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
    optRow(el.terrain, TERRAINS, setup.terrain, (v) => hooks.onSetup({ ...setup, terrain: v }))
    optRow(el.alt, ALTITUDES.map((a, i) => ({ labelKey: a.labelKey, hint: `${formatNumber(a.value)} m`, value: a.value, sil: altSil(ALT_Y[i] ?? 12) })),
      setup.altitude, (v) => hooks.onSetup({ ...setup, altitude: v }))
    optRow(el.tod, TIMES, setup.timeOfDay, (v) => hooks.onSetup({ ...setup, timeOfDay: v }))
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
