import { LANGS, LANG_NAME, withLang, type Lang } from '../i18n'
import { applyStaticText } from '../i18n/dom'
import {
  ANTIALIAS_LEVELS, DEFAULT_ANTIALIAS, DEFAULT_QUALITY, QUALITY_LEVELS, qualityAvailable,
} from '../render/quality'
import { DEFAULT_VOLUME_DB, VOLUME_LEVELS } from '../audio/volume'
import { AIM_ASSIST_LEVELS, DEFAULT_AIM_ASSIST } from '../input/aimAssistPreferences'
import { DEFAULT_MOUSE_SENSITIVITY, snapMouseSensitivity } from '../input/mouseSensitivity'
import {
  CONTROL_MODES, DEFAULT_CONTROL_MODE, DEFAULT_STICK_RECENTER, STICK_RECENTER_LEVELS,
} from '../input/controlPreferences'
import type { ControlMode, StickRecenter } from '../input/InputState'
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
  /** 設定裡按了確定、滑鼠靈敏度有變。呼叫端負責套用與記住 */
  onMouseSensitivity(v: number): void
  /** 設定裡按了確定、操控方式或搖桿回中有變（兩格一起送）。呼叫端負責套用與記住 */
  onControl(mode: ControlMode, recenter: StickRecenter): void
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
  /** 滑鼠靈敏度的拉桿（`<input type="range">`），範圍與步距寫在 index.html */
  readonly mouse: Pick<HTMLInputElement, 'value' | 'addEventListener'>
  /** 拉桿旁的讀數 */
  readonly mouseValue: Pick<HTMLElement, 'textContent'>
  readonly control: HTMLElement
  readonly recenter: HTMLElement
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
  let appliedMouse = DEFAULT_MOUSE_SENSITIVITY
  let appliedMode: ControlMode = DEFAULT_CONTROL_MODE
  let appliedRecenter: StickRecenter = DEFAULT_STICK_RECENTER
  let draftLang: Lang = appliedLang
  let draftQuality = appliedQuality
  let draftAa = appliedAa
  let draftVolume: number | null = appliedVolume
  let draftAssist = appliedAssist
  let draftMouse = appliedMouse
  let draftMode = appliedMode
  let draftRecenter = appliedRecenter

  // 【拉桿不跟著 `drawSettingRows` 重建】拖曳中換掉元素會讓拖曳斷掉；監聽器只掛一次
  el.mouse.addEventListener('input', () => {
    draftMouse = snapMouseSensitivity(Number(el.mouse.value))
    el.mouseValue.textContent = `${draftMouse.toFixed(1)}x`
  })

  /**
   * 【用草稿的語言畫】點了語言，設定頁與它的重載確認框馬上換成那個語言，好讓玩家
   * 確認看得懂；其他頁面按確定才換（`onLang`）。
   */
  function drawSettingRows(): void {
    withLang(draftLang, () => {
      applyStaticText(settings)
      applyStaticText(reloadAsk)
      drawRows()
    })
  }

  /** 【沒有小圖示】畫質、抗鋸齒、音量都是抽象的，畫不出剪影；`.opt` 對純文字按鈕照樣成立 */
  function drawRows(): void {
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
    optRow(el.control,
      CONTROL_MODES.map((m) => ({ labelKey: m.labelKey, value: m.value, sil: '' })),
      draftMode, (v) => { draftMode = v; drawSettingRows() })
    // 【回中只對搖桿有意義】草稿是滑鼠瞄準時按不下去
    optRow(el.recenter,
      STICK_RECENTER_LEVELS.map((lv) => ({
        labelKey: lv.labelKey, value: lv.value, sil: '', disabled: draftMode !== 'stick',
      })),
      draftRecenter, (v) => { draftRecenter = v; drawSettingRows() })
    el.mouse.value = String(draftMouse)
    el.mouseValue.textContent = `${draftMouse.toFixed(1)}x`
  }

  /** 【每次打開都從已生效的值重來】上一次按取消留下的挑選不該跟著回來 */
  function openSettings(): void {
    draftLang = appliedLang
    draftQuality = appliedQuality
    draftAa = appliedAa
    draftVolume = appliedVolume
    draftAssist = appliedAssist
    draftMouse = appliedMouse
    draftMode = appliedMode
    draftRecenter = appliedRecenter
    drawSettingRows()
    closeOverlay(reloadAsk)
    openOverlay(settings)
  }

  /**
   * 按下恢復預設值：只改草稿，按確定才套用（抗鋸齒有變一樣先問重新載入）。
   * 語言不在內：恢復預設不該把介面換成玩家看不懂的語言。
   */
  function resetSettings(): void {
    draftQuality = DEFAULT_QUALITY
    draftAa = DEFAULT_ANTIALIAS
    draftVolume = DEFAULT_VOLUME_DB
    draftAssist = DEFAULT_AIM_ASSIST
    draftMouse = DEFAULT_MOUSE_SENSITIVITY
    draftMode = DEFAULT_CONTROL_MODE
    draftRecenter = DEFAULT_STICK_RECENTER
    drawSettingRows()
  }

  /** 操控方式或回中有沒有改。兩格一起送：回中是搖桿的一部分 */
  function controlChanged(): boolean {
    return draftMode !== appliedMode || draftRecenter !== appliedRecenter
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
    if (draftMouse !== appliedMouse) hooks.onMouseSensitivity(draftMouse)
    if (controlChanged()) hooks.onControl(draftMode, draftRecenter)
    closeOverlay(settings)
    // 【最後才換語言】換語言會重畫整個選單，放在關設定之後，重畫的是關好的畫面
    if (draftLang !== appliedLang) hooks.onLang(draftLang)
  }

  /**
   * 警告框上按了「儲存並重新載入」。
   *
   * 【其餘的要先送】`onAntialias` 會重新載入，它之後的程式碼不保證跑得到；漏送的話
   * 玩家同時改的畫質、音量、瞄準輔助、滑鼠靈敏度會在重整後消失，而那看起來像是
   * 「確定沒有生效」。
   */
  function commitReload(): void {
    closeOverlay(reloadAsk)
    if (draftQuality !== appliedQuality) hooks.onQuality(draftQuality)
    if (draftVolume !== appliedVolume) hooks.onVolume(draftVolume)
    if (draftAssist !== appliedAssist) hooks.onAimAssist(draftAssist)
    if (draftMouse !== appliedMouse) hooks.onMouseSensitivity(draftMouse)
    if (controlChanged()) hooks.onControl(draftMode, draftRecenter)
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

  function renderMouseSensitivity(v: number): void {
    appliedMouse = v
    draftMouse = v
    drawSettingRows()
  }

  function renderControl(mode: ControlMode, recenter: StickRecenter): void {
    appliedMode = mode
    appliedRecenter = recenter
    draftMode = mode
    draftRecenter = recenter
    drawSettingRows()
  }

  function cancelReload(): void {
    closeOverlay(reloadAsk)
    draftAa = appliedAa
    drawSettingRows()
  }

  return {
    openSettings, applySettings, resetSettings, commitReload, cancelReload, drawSettingRows,
    renderLang, renderQuality, renderAntialias, renderVolume, renderAimAssist, renderMouseSensitivity,
    renderControl,
  }
}
