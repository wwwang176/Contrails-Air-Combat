import { LANGS, LANG_NAME, type Lang } from '../i18n'
import {
  ANTIALIAS_LEVELS, DEFAULT_ANTIALIAS, DEFAULT_QUALITY, QUALITY_LEVELS, qualityAvailable,
} from '../render/quality'
import { DEFAULT_VOLUME_DB, VOLUME_LEVELS } from '../audio/volume'
import { AIM_ASSIST_LEVELS } from '../input/aimAssistPreferences'
import { optRow } from './menuOptions'

export interface MenuSettingsHooks {
  /**
   * 暫停選單裡換了繪圖解析度的檔位（`render/quality.ts` 的 `pixelRatio`）。
   *
   * 【與 `onResume` 同一類】overlay 上的動作，不換畫面。呼叫端負責套用與記住。
   */
  onQuality(pixelRatio: number): void
  /**
   * 設定裡換了抗鋸齒，而且玩家**已經在警告框上確認過**。
   *
   * 【呼叫端要存檔並重新載入】它是建立 WebGL context 的參數，換不了。選單只在
   * 玩家按下「儲存並重新載入」之後才送這個事件，所以呼叫端不必再問一次。
   */
  onAntialias(on: boolean): void
  /** 設定裡按了確定、音量有變。null 是關閉。呼叫端負責套用與記住 */
  onVolume(db: number | null): void
  /** 設定裡按了確定、瞄準輔助有變。呼叫端負責套用與記住 */
  onAimAssist(on: boolean): void
  /**
   * 設定裡按了確定、語言有變。呼叫端負責套用（`setLang`）與記住；選單自己訂閱
   * `onLangChange` 重畫
   */
  onLang(lang: Lang): void
}

interface SettingElements {
  readonly lang: HTMLElement
  readonly aimAssist: HTMLElement
  readonly quality: HTMLElement
  readonly antialias: HTMLElement
  readonly volume: HTMLElement
}

/** 設定草稿、套用順序與重新載入確認；不持有其他選單頁面的狀態。 */
export function createMenuSettings(
  el: SettingElements, settings: HTMLElement, reloadAsk: HTMLElement,
  hooks: MenuSettingsHooks,
  openOverlay: (element: HTMLElement) => void,
  closeOverlay: (element: HTMLElement) => void,
) {
  /**
   * 設定頁的兩組值：**已經生效的**，與**玩家正在挑的**。
   *
   * 【為什麼要分兩份】按鈕按下去只改「正在挑的」，按確定才送出去。合成一份就
   * 回不到原值了 —— 而「取消」的意思正是回到原值。
   *
   * 【已生效的那一份由 `main.ts` 餵進來】選單不負責記住設定，見 `renderQuality`。
   */
  let appliedLang: Lang = 'zh'
  let appliedQuality = DEFAULT_QUALITY
  let appliedAa = DEFAULT_ANTIALIAS
  let appliedVolume: number | null = DEFAULT_VOLUME_DB
  let appliedAssist = false
  let draftLang: Lang = appliedLang
  let draftQuality = appliedQuality
  let draftAa = appliedAa
  let draftVolume: number | null = appliedVolume
  let draftAssist = appliedAssist

  /** 【沒有小圖示】畫質、抗鋸齒、音量都是抽象的，畫不出剪影；`.opt` 對純文字按鈕照樣成立 */
  function drawSettingRows(): void {
    optRow(el.lang, LANGS.map((l) => ({ label: LANG_NAME[l], value: l, sil: '' })),
      draftLang, (v) => { draftLang = v; drawSettingRows() })
    optRow(el.aimAssist,
      AIM_ASSIST_LEVELS.map((lv) => ({ labelKey: lv.labelKey, value: lv.value, sil: '' })),
      draftAssist, (v) => { draftAssist = v; drawSettingRows() })
    optRow(el.quality,
      QUALITY_LEVELS.map((lv) => ({
        labelKey: lv.labelKey, value: lv.pixelRatio, sil: '',
        disabled: !qualityAvailable(lv.pixelRatio, window.devicePixelRatio),
      })),
      draftQuality, (v) => { draftQuality = v; drawSettingRows() })
    optRow(el.antialias,
      ANTIALIAS_LEVELS.map((lv) => ({ labelKey: lv.labelKey, value: lv.value, sil: '' })),
      draftAa, (v) => { draftAa = v; drawSettingRows() })
    optRow(el.volume,
      VOLUME_LEVELS.map((lv) => ({ labelKey: lv.labelKey, value: lv.db, sil: '' })),
      draftVolume, (v) => { draftVolume = v; drawSettingRows() })
  }

  /** 【每次打開都從已生效的值重來】上一次按取消留下的挑選不該跟著回來 */
  function openSettings(): void {
    draftLang = appliedLang
    draftQuality = appliedQuality
    draftAa = appliedAa
    draftVolume = appliedVolume
    draftAssist = appliedAssist
    drawSettingRows()
    closeOverlay(reloadAsk)
    openOverlay(settings)
  }

  /**
   * 按下確定。**動到要重新載入的項目就先問過再套用** —— 沒問就重整會讓玩家
   * 在毫無預期之下丟掉進行中的戰鬥。
   */
  function applySettings(): void {
    if (draftAa !== appliedAa) { openOverlay(reloadAsk); return }
    if (draftQuality !== appliedQuality) hooks.onQuality(draftQuality)
    if (draftVolume !== appliedVolume) hooks.onVolume(draftVolume)
    if (draftAssist !== appliedAssist) hooks.onAimAssist(draftAssist)
    closeOverlay(settings)
    // 【最後才換語言】換語言會重畫整個選單，放在關設定之後，重畫的是關好的畫面
    if (draftLang !== appliedLang) hooks.onLang(draftLang)
  }

  /**
   * 警告框上按了「儲存並重新載入」。
   *
   * 【其餘的要先送】`onAntialias` 會重新載入，它之後的程式碼不保證跑得到；漏送的話
   * 玩家同時改的畫質、音量、瞄準輔助會在重整後消失，而那看起來像是「確定沒有生效」。
   */
  function commitReload(): void {
    closeOverlay(reloadAsk)
    if (draftQuality !== appliedQuality) hooks.onQuality(draftQuality)
    if (draftVolume !== appliedVolume) hooks.onVolume(draftVolume)
    if (draftAssist !== appliedAssist) hooks.onAimAssist(draftAssist)
    if (draftLang !== appliedLang) hooks.onLang(draftLang)
    hooks.onAntialias(draftAa)
  }

  function renderLang(lang: Lang): void {
    appliedLang = lang
    draftLang = lang
    drawSettingRows()
  }

  function renderQuality(pixelRatio: number): void {
    appliedQuality = pixelRatio
    draftQuality = pixelRatio
    drawSettingRows()
  }

  function renderAntialias(on: boolean): void {
    appliedAa = on
    draftAa = on
    drawSettingRows()
  }

  function renderVolume(db: number | null): void {
    appliedVolume = db
    draftVolume = db
    drawSettingRows()
  }

  function renderAimAssist(on: boolean): void {
    appliedAssist = on
    draftAssist = on
    drawSettingRows()
  }

  function cancelReload(): void {
    closeOverlay(reloadAsk)
    draftAa = appliedAa
    drawSettingRows()
  }

  return {
    openSettings, applySettings, commitReload, cancelReload, drawSettingRows,
    renderLang, renderQuality, renderAntialias, renderVolume, renderAimAssist,
  }
}
