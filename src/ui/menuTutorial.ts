import { assetUrl } from '../core/asset'
import { t } from '../i18n'
import { captionOf, markTutorialSeen, type Tutorial } from './tutorials'
import { escapeHtml } from './menuOptions'

/** 教學佇列、畫面與完成通知；疊層順序由選單統一管理。 */
export function createMenuTutorial(
  root: HTMLElement, tutorial: HTMLElement,
  openOverlay: (element: HTMLElement) => void,
  closeOverlay: (element: HTMLElement) => void,
) {
  const q = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement
  let tutorialQueue: readonly Tutorial[] = []
  let tutorialAt = 0
  let tutorialDone: () => void = () => {}

  /** 把目前這張教學畫進卡片。 */
  function drawTutorial(): void {
    const card = tutorialQueue[tutorialAt]
    if (card === undefined) return
    // 【觸控裝置換說法】與瞄準輔助的預設同一個判準（`input/aimAssistPreferences.ts`）
    const touch = window.matchMedia('(pointer: coarse)').matches
    q('tut-title').textContent = t(card.titleKey)
    const progress = root.querySelector<HTMLElement>('#tut-progress')
    if (progress) {
      progress.textContent = `${tutorialAt + 1} / ${tutorialQueue.length}`
      progress.hidden = tutorialQueue.length < 2
    }
    q('tut-panels').innerHTML = card.panels.map((p, i) =>
      `<li class="tut-panel"><figure class="tut-fig">`
      + `<img src="${assetUrl(p.image)}" alt="${escapeHtml(t(p.altKey))}">`
      + p.tags.map((g) =>
        `<span class="tut-tag${g.hud === undefined ? '' : ` hud ${g.hud}`}" style="left:${g.x}%;top:${g.y}%">`
        + `${escapeHtml(t(g.textKey, g.params) + (g.suffix ?? ''))}</span>`).join('')
      + `</figure><div class="tut-instruction"><span class="tut-step" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span>`
      + `<div class="tut-cap">${escapeHtml(t(captionOf(p, touch)))}</div></div></li>`).join('')
  }

  /** 「了解」：這一張記成看過；還有下一張就換上，沒有就收起來並呼叫 `done` */
  function nextTutorial(): void {
    const t = tutorialQueue[tutorialAt]
    if (t !== undefined) markTutorialSeen(t.id)
    tutorialAt++
    if (tutorialAt < tutorialQueue.length) {
      drawTutorial()
      q('tut-panels').scrollLeft = 0
      q('tut-panels').scrollTop = 0
      return
    }
    closeOverlay(tutorial)
    tutorialQueue = []
    const done = tutorialDone
    tutorialDone = () => {}
    done()
  }

  return {
    drawTutorial, nextTutorial,
    showTutorials(list: readonly Tutorial[], done: () => void) {
      if (list.length === 0) { done(); return }
      tutorialQueue = list
      tutorialAt = 0
      tutorialDone = done
      drawTutorial()
      openOverlay(tutorial)
      q('tut-panels').scrollLeft = 0
      q('tut-panels').scrollTop = 0
    },
  }
}
