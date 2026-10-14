import { CAMPAIGNS, MISSIONS, type Campaign, type MissionCard, type ReadyMissionCard } from '../battle/missions'
import { assetUrl } from '../core/asset'
import { t, formatMonth, type MessageKey } from '../i18n'
import { shortName } from '../i18n/names'
import { briefingOf, missionTypeName, type Briefing } from './briefing'
import { escapeHtml } from './menuOptions'
import { campaignLabel, silBadge } from './menuAircraft'
import { renderMissionDiagram } from './missionDiagram'
import { missionCompletion } from '../app/missionCompletion'
import { completionStamp, pendingStamp } from './completionStamp'

const CAMPAIGN_BLURB: Record<Campaign, { readonly lineKey: MessageKey }> = {
  allies: { lineKey: 'campaign.allies.blurb' },
  germany: { lineKey: 'campaign.germany.blurb' },
  japan: { lineKey: 'campaign.japan.blurb' },
}

/** 管戰役選擇、記住的關卡選擇與任務簡報上的動作 */
export function createMenuCampaign(
  el: { campaignCards: HTMLElement; campName: HTMLElement; missionTrail: HTMLElement; route: HTMLElement; brief: HTMLElement },
  hooks: { onEvent(event: 'mission' | 'fight'): void; onMission(card: ReadyMissionCard): void },
) {
  /** 任務線的狀態：哪一條、選了第幾關 */
  let campaign: Campaign = 'allies'
  const picked: Record<Campaign, number> = { allies: 0, germany: 0, japan: 0 }
  // ── 陣營頁：三張海報卡 ────────────────────────────────
  function renderCampaign(): void {
    el.campaignCards.innerHTML = ''
    for (const c of CAMPAIGNS) {
      const b = document.createElement('button')
      b.className = 'campaign-card dossier-paper'
      b.dataset['campaign'] = c
      const blurb = CAMPAIGN_BLURB[c]
      const count = MISSIONS[c].filter(m => m.battle !== null).length
      b.innerHTML = `<span class="photo"><i class="tape tl" aria-hidden="true"></i><img src="${assetUrl(`/ui/${c}.jpg`)}" alt=""></span>`
        + `<span class="campaign-card-body"><span class="campaign-card-heading"><span class="t">${escapeHtml(campaignLabel(c))}</span>`
        + `<span class="campaign-count">${escapeHtml(t('campaign.count', { n: count }))}</span></span>`
        + `<span class="d">${escapeHtml(t(blurb.lineKey))}</span>`
        + `</span>`
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
    return `<div class="unit">${silBadge(u.id)}`
      + `<span><span class="nm">${escapeHtml(u.name)}</span> <span class="qty">× ${u.count}</span></span></div>`
  }
  function renderBrief(card: MissionCard): void {
    const b = briefingOf(card)
    const completed = missionCompletion.has(card.id)
    const head = `<header class="mission-head"><div><span class="mission-kind">${escapeHtml(b.kind)}</span><h2>${escapeHtml(b.title)}</h2>`
      + `<div class="mission-meta">${escapeHtml(formatMonth(card.period.year, card.period.month))} · ${escapeHtml(t(card.placeKey))}</div></div>`
      + `<div class="mission-head-stamps">${completed ? completionStamp('brief') : pendingStamp()}</div></header>`
    el.brief.classList.toggle('mission-unready', card.battle === null)
    if (card.battle === null) {
      el.brief.innerHTML = `<div class="brief-intel">${head}<p class="mission-summary">${escapeHtml(b.summary)}</p>`
        + `<div class="soonbox"><b>${escapeHtml(t('brief.soon'))}</b><br>${escapeHtml(t('brief.soonBody'))}</div></div>`
      return
    }
    el.brief.innerHTML = `<div class="brief-intel">${head}<div class="brief-details">`
      + `<div class="mission-objective">${escapeHtml(b.objective ?? '')}</div>`
      + `<p class="mission-summary">${escapeHtml(b.summary)}</p>`
      + `<aside class="mission-sidebar"><section class="mission-forces"><h3>${escapeHtml(t('brief.forces'))}</h3><div class="mission-force-columns">`
      + `<div class="mission-force mine"><h4>${escapeHtml(t('side.mine'))}</h4>${(b.mine ?? []).map(unitRow).join('')}</div>`
      + `<div class="mission-force foe"><h4>${escapeHtml(t('side.foe'))}</h4>${(b.foe ?? []).map(unitRow).join('') || `<span class="lbl">${escapeHtml(t('brief.noAircraft'))}</span>`}</div></div></section>`
      + `</aside></div></div>`
      + renderMissionDiagram(card as ReadyMissionCard)
      + `<footer class="mission-actions"><div class="mission-seat">${silBadge(card.battle.blueSpec.id)}<span><small>${escapeHtml(t('brief.player'))}</small><b>${escapeHtml(shortName(card.battle.blueSpec))}</b></span></div>`
      + `<button class="dossier-action" id="brief-go">${escapeHtml(t('brief.go'))}</button></footer>`
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
    el.campName.textContent = campaignLabel(campaign)
    el.missionTrail.innerHTML = `${escapeHtml(t('menu.mission'))} › ${escapeHtml(campaignLabel(campaign))}`
      + ` › <b>${escapeHtml(t(list[k]!.titleKey))}</b>`
    el.route.innerHTML = ''
    list.forEach((m, i) => {
      const ready = m.battle !== null
      const b = document.createElement('button')
      // 【每一關都是紙】不再只有選中的那一份是紙 —— 那一疊本來就是四份文件，
      // 沒翻開的那幾份靠 `.stop:not(.on)` 壓暗一階
      b.className = `mission-tab dossier-paper ${ready ? 'ready' : 'soon'}${i === k ? ' on' : ''}`
      b.setAttribute('aria-pressed', String(i === k))
      // 【e2e 用 id 選卡】標題會改，id 不會
      b.dataset['mission'] = m.id
      b.innerHTML = `<div class="k">${escapeHtml(t('menu.stage', { n: i + 1 }))} ${escapeHtml(missionTypeName(m.type))}</div>`
        + `<div class="n">${escapeHtml(t(m.titleKey))}</div>${missionCompletion.has(m.id) ? completionStamp('compact') : ''}`
        + (ready ? '' : `<div class="soonmark">${escapeHtml(t('brief.soon'))}</div>`)
      b.addEventListener('click', () => {
        picked[campaign] = i
        renderMission()
        // Re-rendering replaces the tabs; keep keyboard focus and horizontal
        // scroll on the chosen mission rather than jumping back to the page.
        const active = el.route.querySelector<HTMLButtonElement>('.on')
        active?.focus({ preventScroll: true })
        active?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
      el.route.appendChild(b)
    })
    renderBrief(list[k]!)
  }

  return { renderCampaign, renderMission }
}
