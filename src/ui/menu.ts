import type { ReadyMissionCard } from '../battle/missions'
import type { SkirmishSetup } from '../battle/skirmish'
import { onLangChange, type Lang } from '../i18n'
import type { AircraftSpec } from '../specs/types'
import type { Screen, ScreenEvent } from './screens'
import type { Tutorial } from './tutorials'
import { createMenuTutorial } from './menuTutorial'
import { createMenuSettings, type MenuSettingsHooks } from './menuSettings'
import { createMenuCampaign } from './menuCampaign'
import { createMenuHangar } from './menuHangar'
import { createMenuSkirmish } from './menuSkirmish'

export interface MenuHooks extends MenuSettingsHooks {
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
   * 使用者按了某一關的出擊。
   *
   * 【為什麼是獨立的 hook 而不是塞進 `onEvent`】`ScreenEvent` 是一個字串，
   * 帶不了「哪一張卡」。與 `onSetup` 同一類：畫面之外的資料。
   *
   * 【先送這個，再送 `fight`】呼叫端要先知道打哪一關，才建得出戰鬥。
   */
  onMission(card: ReadyMissionCard): void
  /**
   * 機庫換了一架，或剛進機庫。
   *
   * 【與 `onMission` 同一類】畫面事件帶不了「哪一架」。呼叫端收到之後把
   * 展示場換成這一台 —— 進機庫時也會送一次，所以呼叫端不必自己記得初值。
   */
  onAircraft(spec: AircraftSpec): void
  /** 暫停中按了右上角的「教學」按鈕。呼叫端挑這架飛機的卡交給 `showTutorials` */
  onHelp(): void
}

export interface Menu {
  /**
   * 依序彈出幾張教學卡。每張按「了解」就記成看過、換下一張；最後一張按完
   * 呼叫 `done`。空清單直接呼叫 `done`。
   */
  showTutorials(list: readonly Tutorial[], done: () => void): void
  /** 這一場有沒有教學卡可看 —— 決定暫停時右上角的「教學」按鈕出不出現 */
  setTutorialHelp(available: boolean): void
  /** 顯示指定畫面，其餘隱藏 */
  show(screen: Screen): void
  /** 暫停 overlay */
  setPaused(v: boolean): void
  /** 依目前的設定重畫編組那一頁 */
  renderSetup(setup: SkirmishSetup): void
  /** 設定裡的語言目前**已生效**的值（理由同 `renderQuality`） */
  renderLang(lang: Lang): void
  /**
   * 設定裡的畫質現在是哪一檔。**這是「已生效」的值**，不是玩家正在挑的那一顆
   * —— 設定頁上的選擇要按「確定」才送得出來，在那之前只存在選單內部。
   *
   * 【呼叫端要在開場叫一次】選單不負責記住設定，它只知道畫面上該標哪一顆。
   */
  renderQuality(pixelRatio: number): void
  /** 同上，抗鋸齒目前**已生效**的值 */
  renderAntialias(on: boolean): void
  /** 同上，音量目前**已生效**的值（null 是關閉） */
  renderVolume(db: number | null): void
  /** 同上，瞄準輔助目前**已生效**的值 */
  renderAimAssist(on: boolean): void
}

/**
 * 選單的 DOM 元件。
 *
 * 動態按鈕透過事件委派回報畫面事件；three.js 的展示場與戰鬥資源由呼叫端管理。
 *
 * 【各頁管理自己的內容】任務、機庫與編組分別持有選取狀態；這裡協調畫面、
 * 彈窗與語言更新。DOM 流程由 `test/e2e/menu-pages.e2e.ts` 驗證。
 */
export function createMenu(root: HTMLElement, hooks: MenuHooks): Menu {
  const sections: Record<Screen, HTMLElement | null> = {
    landing: root.querySelector('#landing'),
    menu: root.querySelector('#menu'),
    campaign: root.querySelector('#campaign'),
    mission: root.querySelector('#mission'),
    skirmish: root.querySelector('#skirmish'),
    hangar: root.querySelector('#hangar'),
    // 戰鬥沒有自己的 section —— 它就是「全部都藏起來」
    battle: null,
  }
  const pause = root.querySelector('#pause') as HTMLElement
  const confirm = root.querySelector('#confirm') as HTMLElement
  const restartAsk = root.querySelector('#restart-confirm') as HTMLElement
  const menuAsk = root.querySelector('#menu-confirm') as HTMLElement
  const tutorial = root.querySelector('#tutorial') as HTMLElement
  const settings = root.querySelector('#settings') as HTMLElement
  const reloadAsk = root.querySelector('#reload-ask') as HTMLElement
  const planePick = root.querySelector('#plane-pick') as HTMLElement
  const gear = root.querySelector('#gear') as HTMLElement
  /**
   * 暫停時齒輪旁邊的「教學」按鈕：重看這架飛機的教學卡。**只在暫停選單開著、而且
   * 這一場有卡可看時出現**（`setTutorialHelp`）。
   */
  const help = root.querySelector('#help') as HTMLElement
  let helpAvailable = false
  /**
   * 【飛行中把齒輪藏起來】指標鎖定時所有點擊都送給遊戲，畫面上的按鈕收不到 ——
   * 留一顆點不到的按鈕會被當成壞掉。解除鎖定（Esc）之後它就回來。
   *
   * 【為什麼在這裡聽而不是讓 main.ts 推】鎖定與否是 DOM 的事實，UI 自己讀得到；
   * 多一條對外 API 就多一個會忘記呼叫的地方。
   */
  const syncGear = (): void => { gear.hidden = document.pointerLockElement !== null }
  document.addEventListener('pointerlockchange', syncGear)
  syncGear()

  /**
   * 彈窗的層級。**後開的壓在先開的上面** —— 「彈窗的彈窗」（設定之上的重新載入
   * 警告、暫停之上的放棄確認）不靠文件順序，靠開啟順序。
   *
   * 【為什麼不能靠文件順序】`#ui .screen` 沒有 z-index，彼此只按文件順序疊。
   * 但畫面內容一旦自己設了 z-index（機庫左欄的 `.pane.hangar` 就是 1），由於
   * `.screen` 沒有建立堆疊脈絡，那一層是直接參與 `#ui` 的堆疊脈絡，於是壓過
   * **所有** z-index 為 auto 的兄弟 —— 設定因此被機庫的左欄蓋住。
   *
   * 【基準值】`#ui` 裡畫面內容目前最高是 1；留一大段空間給日後的內容。
   */
  const OVERLAY_BASE = 50
  /**
   * 暫停自成一段，**比齒輪低**。
   *
   * 【為什麼不跟彈窗同一段】齒輪是彈窗的入口：暫停的時候它必須還按得到，
   * 進了設定之後又必須沉到背後（否則在設定裡挑到一半誤點它，`openSettings`
   * 會把草稿重設回原值，而畫面上看不出發生了什麼）。
   * 齒輪的值寫在 index.html 的 `.gear`，夾在這兩段中間。
   */
  const PAUSE_BASE = 10
  const overlayStack: HTMLElement[] = []

  function restackOverlays(): void {
    overlayStack.forEach((e, i) => {
      e.style.zIndex = String((e === pause ? PAUSE_BASE : OVERLAY_BASE) + i)
    })
  }

  function openOverlay(e: HTMLElement): void {
    // 【已經開著就不重複推】重複推會讓它在自己上面再疊一層，計數就對不上了
    if (!overlayStack.includes(e)) overlayStack.push(e)
    restackOverlays()
    e.hidden = false
  }

  function closeOverlay(e: HTMLElement): void {
    const i = overlayStack.indexOf(e)
    if (i >= 0) overlayStack.splice(i, 1)
    e.hidden = true
    // 【要清掉】留著舊的層級值，下次它在別的順序下打開就會疊錯
    e.style.zIndex = ''
    restackOverlays()
  }
  const q = (id: string): HTMLElement => root.querySelector(`#${id}`) as HTMLElement
  const el = {
    campaignCards: q('campaign-cards'),
    campName: q('camp-name'),
    missionTrail: q('mission-trail'),
    route: q('route'),
    brief: q('brief'),
    presets: q('sk-presets'),
    mine: q('sk-mine'),
    foe: q('sk-foe'),
    versus: q('sk-versus'),
    terrain: q('sk-terrain'),
    alt: q('sk-alt'),
    tod: q('sk-tod'),
    quality: q('set-quality'),
    antialias: q('set-aa'),
    volume: q('set-volume'),
    aimAssist: q('set-assist'),
    lang: q('set-lang'),
    rack: q('hangar-rack'),
    sheet: q('hangar-sheet'),
    go: root.querySelector('#skirmish [data-act="fight"]') as HTMLButtonElement,
  }

  const { drawTutorial, nextTutorial, showTutorials } = createMenuTutorial(root, tutorial, openOverlay, closeOverlay)
  const { renderCampaign, renderMission } = createMenuCampaign(el, hooks)
  const { renderHangar, drawHangar } = createMenuHangar(el, hooks)
  const { renderSetup, redrawSetup, redrawPlanePick } = createMenuSkirmish(
    el, planePick, hooks, openOverlay, closeOverlay,
  )

  // 【事件委派】按鈕是動態產生的，一個一個掛監聽器會在重畫時漏掉舊的。
  //
  // 【為什麼掛在 document 而不是 root】結算板的按鈕在 `#board` 裡，不在 `#ui`
  // 底下 —— 掛在 root 上那幾顆永遠不會送出事件。data-act 是這一層唯一的協定。
  root.ownerDocument.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b || b.disabled) return
    const act = b.dataset['act']
    if (act === undefined) return
    if (act === 'resume') { hooks.onResume(); return }
    // 【重新開始也要問過】整場重來，誤按就回不去 —— 與放棄任務同一類 overlay
    if (act === 'restart') { openOverlay(restartAsk); return }
    if (act === 'restartNo') { closeOverlay(restartAsk); return }
    if (act === 'restartYes') { closeOverlay(restartAsk); hooks.onRestart(); return }
    // 【放棄任務要問過】確認框是暫停之上的第二層 overlay，不是畫面；
    // 確認之後才送畫面事件 —— 回的是該陣營的任務表，`campaign` 還留著
    // 【設定是 overlay，不是畫面】與暫停、確認同一類，見 ui/screens.ts
    if (act === 'settings') { openSettings(); return }
    if (act === 'settingsApply') { applySettings(); return }
    // 【取消就整批丟掉】選擇只存在選單內部，沒有任何東西套用過，所以不必還原畫面
    if (act === 'settingsCancel') { closeOverlay(settings); return }
    // 要重新載入的設定，套用前的最後一問
    if (act === 'reloadYes') { commitReload(); return }
    if (act === 'reloadNo') {
      // 【放棄這一項變更】按鈕要標回已生效的值，否則選中狀態會停在沒生效的那一顆
      cancelReload()
      return
    }
    if (act === 'tutorialOk') { nextTutorial(); return }
    if (act === 'planePickCancel') { closeOverlay(planePick); return }
    if (act === 'help') { hooks.onHelp(); return }
    // 【回主選單也要問過】遭遇戰的出口，按下去這一場就沒了 —— 與放棄任務同一類
    if (act === 'toMenu') { openOverlay(menuAsk); return }
    if (act === 'toMenuNo') { closeOverlay(menuAsk); return }
    if (act === 'toMenuYes') { closeOverlay(menuAsk); hooks.onEvent('toMenu'); return }
    if (act === 'abandon') { openOverlay(confirm); return }
    if (act === 'abandonNo') { closeOverlay(confirm); return }
    if (act === 'abandonYes') { closeOverlay(confirm); hooks.onEvent('toMission'); return }
    hooks.onEvent(act as ScreenEvent)
  })

  // 【教學卡也收 Enter／空白鍵】手已經在鍵盤上，不必為了一顆按鈕去找滑鼠
  root.ownerDocument.addEventListener('keydown', (e) => {
    if (tutorial.hidden || (e.code !== 'Enter' && e.code !== 'Space')) return
    e.preventDefault()
    nextTutorial()
  })

  const {
    openSettings, applySettings, commitReload, cancelReload, drawSettingRows,
    renderLang, renderQuality, renderAntialias, renderVolume, renderAimAssist,
  } = createMenuSettings(el, settings, reloadAsk, hooks, openOverlay, closeOverlay)

  renderCampaign()

  /**
   * 換語言：只畫一次就留著的都要重畫。
   *
   * 【編組頁不論顯示與否都重畫】它在開場畫好之後只在改編組時重畫，不重畫的話
   * 下一次打開還是舊的語言。
   */
  onLangChange(() => {
    renderCampaign()
    if (!sections.mission?.hidden) renderMission()
    if (!sections.hangar?.hidden) drawHangar()
    redrawSetup()
    drawSettingRows()
    if (!tutorial.hidden) drawTutorial()
    redrawPlanePick()
  })

  return {
    show(screen) {
      for (const [name, s] of Object.entries(sections)) {
        if (s) s.hidden = name !== screen
      }
      if (screen === 'mission') renderMission()
      // 【進機庫要重畫一次】它同時是「把展示場換成目前這一架」的那一次
      // 通知（`renderHangar` 尾巴的 `onAircraft`）
      if (screen === 'hangar') renderHangar()
    },
    showTutorials,
    setTutorialHelp(available) {
      helpAvailable = available
    },
    setPaused(v) {
      if (v) {
        openOverlay(pause)
        help.hidden = !helpAvailable
        return
      }
      help.hidden = true
      // 【關掉暫停就一併關掉疊在上面的那幾層】「繼續」與換畫面都不該留下一層覆蓋。
      // 由上而下關，層級表才不會中途留下空洞
      closeOverlay(reloadAsk)
      closeOverlay(settings)
      closeOverlay(restartAsk)
      closeOverlay(menuAsk)
      closeOverlay(confirm)
      closeOverlay(tutorial)
      closeOverlay(pause)
    },
    renderSetup,
    renderLang,
    renderQuality,
    renderAntialias,
    renderAimAssist,
    renderVolume,
  }
}
