import { CAMPAIGNS, MISSIONS, type Campaign, type MissionCard, type ReadyMissionCard } from '../battle/missions'
import { assetUrl } from '../core/asset'
import { t, type MessageKey } from '../i18n'
import { briefingOf, missionTypeName, type Briefing } from './briefing'
import { escapeHtml } from './menuOptions'
import { campaignLabel, silBadge } from './menuAircraft'

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
      b.className = 'tallcard paperbit'
      b.dataset['campaign'] = c
      const blurb = CAMPAIGN_BLURB[c]
      b.innerHTML = `<span class="photo"><i class="tape tl"></i><img src="${assetUrl(`/ui/${c}.jpg`)}" alt=""></span>`
        + `<span class="t">${escapeHtml(campaignLabel(c))}</span><span class="d">${escapeHtml(t(blurb.lineKey))}</span>`
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
    const head = `<h2>${escapeHtml(b.title)}</h2><div class="lbl" style="margin:4px 0 12px">${escapeHtml(b.kind)}</div>`
    if (!b.ready) {
      el.brief.innerHTML = head
        + `<p style="color:var(--dim)">${escapeHtml(b.summary)}</p>`
        + `<div class="soonbox"><b>${escapeHtml(t('brief.soon'))}</b><br>${escapeHtml(t('brief.soonBody'))}</div>`
      return
    }
    el.brief.innerHTML = head
      + `<span class="stamp">${escapeHtml(t('brief.stamp'))}</span>`
      + `<div class="obj">${escapeHtml(b.objective ?? '')}</div>`
      + `<p style="margin:0 0 4px;color:var(--dim)">${escapeHtml(b.summary)}</p>`
      + `<div class="forces"><div><div class="lbl" style="margin-bottom:8px">${escapeHtml(t('side.mine'))}</div>${(b.mine ?? []).map(unitRow).join('')}</div>`
      + `<div class="vs">${escapeHtml(t('brief.versus'))}</div>`
      + `<div><div class="lbl" style="margin-bottom:8px">${escapeHtml(t('side.foe'))}</div>${(b.foe ?? []).map(unitRow).join('')}</div></div>`
      + `<div class="facts">${(b.facts ?? []).map((f) =>
        `<div class="fact"><div class="lbl">${escapeHtml(f.label)}</div><div class="v">${escapeHtml(f.value)}</div></div>`).join('')}</div>`
      + `<div class="actions"><button class="go" id="brief-go">${escapeHtml(t('brief.go'))}</button></div>`
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
      b.className = `stop paperbit ${ready ? 'ready' : 'soon'}${i === k ? ' on' : ''}`
      // 【e2e 用 id 選卡】標題會改，id 不會
      b.dataset['mission'] = m.id
      b.innerHTML = `<div class="k">${escapeHtml(t('menu.stage', { n: i + 1 }))} ${escapeHtml(missionTypeName(m.type))}</div><div class="n">${escapeHtml(t(m.titleKey))}</div>`
        + (ready ? '' : `<div class="soonmark">${escapeHtml(t('brief.soon'))}</div>`)
      b.addEventListener('click', () => {
        picked[campaign] = i
        renderMission()
      })
      el.route.appendChild(b)
    })
    renderBrief(list[k]!)
  }

  return { renderCampaign, renderMission }
}
