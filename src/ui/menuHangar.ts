import type { AircraftSpec } from '../specs/types'
import { dossierOf, SIDE_OF } from './dossier'
import { shortName } from '../i18n/names'
import { escapeHtml } from './menuOptions'
import { campaignLabel, fullName, HANGAR_SPECS, roleWord, silBadge } from './menuAircraft'

/** Owns the selected dossier; translating its text does not rebuild the 3D showcase. */
export function createMenuHangar(
  el: { rack: HTMLElement; sheet: HTMLElement },
  hooks: { onAircraft(spec: AircraftSpec): void },
) {
  /** 機庫攤開的是 `HANGAR_SPECS` 的第幾架 */
  let hangarPick = 0
  // ── 機庫：左邊一疊機種卷宗，攤開的那一份在右邊 ───────
  /**
   * 【為什麼重畫整頁而不是只換選中的那一格】這一頁的狀態只有「第幾架」一個
   * 數字，而 `dossierOf` 是純函數。少一條「上一個選中的是誰」的鏡射狀態，
   * 就少一個會忘記清掉的地方（與 `renderMission` 同一條理由）。
   */
  /** 機庫換上目前這一架，並通知展示場 */
  function renderHangar(): void {
    drawHangar()
    hooks.onAircraft(HANGAR_SPECS[hangarPick] ?? HANGAR_SPECS[0]!)
  }
  /** 只畫機庫的字（左欄與卷宗），展示場不動。換語言時單獨叫 */
  function drawHangar(): void {
    const spec = HANGAR_SPECS[hangarPick] ?? HANGAR_SPECS[0]!
    el.rack.innerHTML = ''
    HANGAR_SPECS.forEach((s, i) => {
      const b = document.createElement('button')
      b.className = `stop paperbit${i === hangarPick ? ' on' : ''}`
      // 【e2e 用 id 選機】顯示名會改，id 不會
      b.dataset['aircraft'] = s.id
      b.innerHTML = `${silBadge(s.id)}<div><div class="k">`
        + `${escapeHtml(campaignLabel(SIDE_OF[s.id] ?? 'allies'))} ${escapeHtml(roleWord(s.role))}</div>`
        + `<div class="n">${escapeHtml(shortName(s))}</div></div>`
      b.addEventListener('click', () => {
        // 【點已經攤開的那一份不重畫】重畫會把數值條打回 0 再長一次、
        // 把展示機整台重建、鏡頭也重拉一遍 —— 而畫面上什麼都沒換
        if (i === hangarPick) return
        hangarPick = i
        renderHangar()
      })
      el.rack.appendChild(b)
    })

    const d = dossierOf(spec)
    // 【Bf 109 K-4 沒有副名】`fullName` 回空字串，不濾掉的話副標會以分隔符開頭
    const sub = [fullName(spec), campaignLabel(d.side), roleWord(d.role)]
      .filter((s) => s !== '').join(' · ')
    el.sheet.innerHTML = `<h2>${escapeHtml(shortName(spec))}</h2>`
      + `<div class="lbl" style="margin-top:5px">${escapeHtml(sub)}</div>`
      + `<p class="story">${escapeHtml(d.story)}</p>`
      + `<div class="bars">${d.bars.map((b) =>
        `<div class="stat"><span class="k">${escapeHtml(b.label)}</span>`
        + `<span class="track"><i data-fill="${(b.fill * 100).toFixed(1)}"></i></span>`
        + `<span class="v">${escapeHtml(b.text)}</span></div>`).join('')}</div>`
      + `<div class="facts">${d.facts.map((f) =>
        `<div class="fact"><span class="lbl">${escapeHtml(f.label)}</span>`
        + `<span class="v">${escapeHtml(f.value)}</span></div>`).join('')}</div>`

    // 【條的寬度要在下一幀才寫】`innerHTML` 換上的是新元素，而 CSS 轉場
    // 對「一生下來就是那個寬度」不會動。先讓它以 0 進 DOM，下一幀再推到
    // 目標值，換機種時四條就會一起長出來。
    requestAnimationFrame(() => {
      el.sheet.querySelectorAll('.bars i').forEach((node) => {
        const bar = node as HTMLElement
        const fill = bar.dataset['fill']
        if (fill !== undefined) bar.style.width = `${fill}%`
      })
    })
  }

  return { renderHangar, drawHangar }
}
