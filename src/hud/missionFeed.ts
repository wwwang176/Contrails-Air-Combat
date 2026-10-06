import type { Battle } from '../battle/battleState'
import type { ReadyMissionCard } from '../battle/missions/types'
import type { MessageKey } from '../i18n'
import type { AudioEngine } from '../audio/engine'
import type { HudFrame } from './types'

type MissionDisplay = Pick<Battle, 'mission' | 'objectiveKey' | 'message' | 'rules'>
type MissionCardText = { readonly battle: Pick<ReadyMissionCard['battle'], 'objectiveKey' | 'bannerKey'> }
type MissionFrame = Pick<HudFrame,
  'message' | 'messageAge' | 'objectiveActive' | 'objectiveArrived' | 'objectiveBanner'
  | 'objectiveBannerAge' | 'objectiveBannerTypeAge' | 'objectiveHasTarget'
  | 'objectiveMetric' | 'objectiveMetricKind' | 'objectiveMetricTotal' | 'objectiveNeed'
  | 'objectiveRemaining' | 'objectiveSeconds' | 'objectiveText' | 'objectiveWorldX' | 'objectiveWorldZ'>

/** 任務 HUD 的資料組裝與訊息時鐘；只讀戰局，輸出寫入既有的 HUD 緩衝。 */
export function createMissionHud(
  hudFrame: MissionFrame, audio: Pick<AudioEngine, 'playPool'>,
  t: (key: MessageKey) => string,
) {
  /**
   * 目標橫幅與中央訊息的打字機時鐘：記下換成另一句的那一刻，HUD 只拿到
   * 「出現了幾秒」。用 `elapsed` 而不是牆鐘，暫停時打字也停。記的是鍵，null = 沒有。
   */
  let bannerKey: MessageKey | null = null
  let bannerStart = 0
  let messageKey: MessageKey | null = null
  let messageStart = 0
  /** 最後一次換語言時的 `elapsed`；在這之前出現的橫幅與訊息整句印，見 `objectiveBannerTypeAge` */
  let langChangedAt = -Infinity

  function fillMissionHud(
    battle: MissionDisplay, mode: 'skirmish' | 'mission', pendingMission: MissionCardText | null, elapsed: number,
  ): void {
    // ── 任務目標 ──────────────────────────────────────────
    //
    // 【`objectiveActive` 由 `mode` 給而不是由 rules 推導】遭遇戰與殲滅任務的
    // `rules` **完全相同**（任務框架 spec §5）—— 差別只在來路，那是畫面模式，
    // 不是規則。
    //
    // 【計量的種類跟著 `hasTarget` 走】有撤離點就顯示距離、沒有就顯示剩餘
    // 敵機數 —— 與 `stepMission` 寫進 `metric` 的意思逐條對應。
    const m = battle.mission
    hudFrame.objectiveActive = mode === 'mission'
    // 【撤離節拍改寫過的優先】它把 `mission` 換掉了，卡片上那一句已經不成立
    const objectiveKey = battle.objectiveKey ?? pendingMission?.battle.objectiveKey ?? null
    hudFrame.objectiveText = objectiveKey === null ? '' : t(objectiveKey)
    hudFrame.objectiveMetric = m.metric
    hudFrame.objectiveMetricKind = m.metricKind
    // 【橫幅在目標改變的那一刻出現】開場是卡片上那一句短句；返航節拍換掉
    // 目標時是那一則訊息 —— 兩者走同一條。遭遇戰沒有橫幅
    //
    // 【以鍵判斷換了沒有】語言切換只換字，不算新的橫幅
    const banner = mode !== 'mission'
      ? null
      : battle.objectiveKey ?? pendingMission?.battle.bannerKey ?? objectiveKey
    if (banner !== bannerKey) {
      bannerKey = banner
      bannerStart = elapsed
      // 【橫幅配電報聲】與訊息同一組；橫幅消失時不響
      if (bannerKey !== null) audio.playPool('radio', 'radio', 0, 0, 0, false)
    }
    hudFrame.objectiveBanner = bannerKey === null ? '' : t(bannerKey)
    hudFrame.objectiveBannerAge = bannerKey === null ? -1 : elapsed - bannerStart
    hudFrame.objectiveBannerTypeAge = bannerStart <= langChangedAt ? -1 : hudFrame.objectiveBannerAge
    // 【分母由 `mission.ts` 給】只有擊沉會填總艘數，其餘任務恆是 −1
    hudFrame.objectiveMetricTotal = m.metricTotal
    // 【−1 由 `mission.ts` 給】只有護送／攔截會填實際架數，其餘任務恆是 −1
    hudFrame.objectiveRemaining = m.remaining
    // 【門檻讀當下的規則】返航節拍會換掉規則，開場的 `cfg.rules` 可能已經過時
    hudFrame.objectiveArrived = m.arrived
    // 【截斷的分母是放行上限】「已抵達 1/4」—— 玩家在盯的是還能放走幾輛
    hudFrame.objectiveNeed = battle.rules.kind === 'convoy'
      ? battle.rules.need ?? 1
      : battle.rules.kind === 'interdict' ? battle.rules.leak : -1
    hudFrame.objectiveSeconds = m.secondsLeft
    hudFrame.objectiveHasTarget = m.hasTarget
    hudFrame.objectiveWorldX = m.target.x
    hudFrame.objectiveWorldZ = m.target.z
    // 【照抄，不在這裡判過期】`stepBeats` 已經依物理時間把過期的收掉了
    hudFrame.message = battle.message === null ? '' : t(battle.message)
    // 【打字機的時鐘】訊息換了就從頭打；沒有訊息就沒有年齡
    if (battle.message !== messageKey) {
      messageKey = battle.message
      messageStart = elapsed
      // 【增援預警配無線電】訊息消失時不響
      if (messageKey !== null) audio.playPool('radio', 'radio', 0, 0, 0, false)
    }
    hudFrame.messageAge = messageKey === null || messageStart <= langChangedAt ? -1 : elapsed - messageStart
  }

  function resetMissionBanner(): void {
    bannerKey = null
  }

  function setMissionHudLanguageTime(elapsed: number): void {
    langChangedAt = elapsed
  }

  return { fillMissionHud, resetMissionBanner, setMissionHudLanguageTime }
}
