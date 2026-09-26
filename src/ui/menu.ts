import { CAMPAIGNS, MISSIONS } from '../battle/missions'
import { assetUrl } from '../core/asset'
import type { Campaign, MissionCard, ReadyMissionCard } from '../battle/missions'
import {
  ALL_SPECS, specOf, addFlight, setCount, removeFlight, setLead, applyPreset, flightsTotal,
  PRESETS, ALTITUDES, MAX_SIDE, MAX_FLIGHTS,
  type SkirmishSetup, type Flight, type PresetKey,
} from '../battle/skirmish'
import { briefingOf, shortName, type Briefing } from './briefing'
import { dossierOf, sortForHangar, strengthOf, SIDE_OF } from './dossier'
import type { AircraftSpec } from '../specs/types'
import type { TerrainKind } from '../world/terrainKind'
import type { TimeOfDay } from '../world/timeOfDay'
import type { Screen, ScreenEvent } from './screens'
import { markTutorialSeen, type Tutorial } from './tutorials'
import {
  ANTIALIAS_LEVELS, DEFAULT_ANTIALIAS, DEFAULT_QUALITY, QUALITY_LEVELS,
} from '../render/quality'
import { DEFAULT_VOLUME_DB, VOLUME_LEVELS } from '../audio/volume'
import { AIM_ASSIST_LEVELS } from '../input/aimAssist'

export interface MenuHooks {
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
  /**
   * 暫停選單裡換了繪圖解析度的檔位（`render/quality.ts` 的 `scale`）。
   *
   * 【與 `onResume` 同一類】overlay 上的動作，不換畫面。呼叫端負責套用與記住。
   */
  onQuality(scale: number): void
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
  /**
   * 設定裡的畫質現在是哪一檔。**這是「已生效」的值**，不是玩家正在挑的那一顆
   * —— 設定頁上的選擇要按「確定」才送得出來，在那之前只存在選單內部。
   *
   * 【呼叫端要在開場叫一次】選單不負責記住設定，它只知道畫面上該標哪一顆。
   */
  renderQuality(scale: number): void
  /** 同上，抗鋸齒目前**已生效**的值 */
  renderAntialias(on: boolean): void
  /** 同上，音量目前**已生效**的值（null 是關閉） */
  renderVolume(db: number | null): void
  /** 同上，瞄準輔助目前**已生效**的值 */
  renderAimAssist(on: boolean): void
}

/**
 * 戰役的標籤與陣營卡上的文案。
 *
 * 【為什麼是 `Record<Campaign, …>` 而不是陣列】少一格是編譯錯誤。加第四條線時
 * 只加型別而漏了這裡，卡片會**永遠畫不出來而且照樣編譯**。
 */
const CAMPAIGN_LABEL: Record<Campaign, string> = { allies: '美軍', germany: '德軍', japan: '日軍' }
const CAMPAIGN_BLURB: Record<Campaign, { readonly line: string; readonly planes: string }> = {
  allies: { line: '歐洲的護航與打擊，太平洋的艦隊防空。', planes: 'P-51D · B-17G · F6F-5' },
  germany: { line: '本土到東西兩線：攔截轟炸機流，夜襲與掃射機場。', planes: 'Bf 109 K-4 · He 111' },
  japan: { line: '瓜島、雷伊泰到倫內爾島：掩護雷擊隊，截斷補給車隊。', planes: 'A6M5 · Ki-84 · G4M' },
}

/** 場地的選項。**順序即按鈕順序。**群島在前：它是預設，也是有東西可看的那一個 */
const TERRAINS: readonly { label: string; hint: string; value: TerrainKind; sil: string }[] = [
  { label: '群島', hint: '島鏈與淺海', value: 'archipelago',
    sil: '<svg width="72" height="26"><rect y="17" width="72" height="9" fill="#38505c"/><path d="M8 17l9-8 9 8z" fill="#4d5c3f"/><path d="M40 17l13-11 13 11z" fill="#4d5c3f"/></svg>' },
  { label: '雷伊泰', hint: '海岸與叢林', value: 'leyte',
    sil: '<svg width="72" height="26"><rect y="17" width="72" height="9" fill="#38505c"/><path d="M30 17h42v9H30z" fill="#3f5a36"/><path d="M30 17l6-3h36v3z" fill="#4b6a3f"/><path d="M40 22h32" stroke="#a89770"/><path d="M48 14v-6m0 0l-4 2m4-2l4 2" stroke="#4b6a3f"/></svg>' },
  { label: '內陸', hint: '農地與村落', value: 'farmland',
    sil: '<svg width="72" height="26"><rect y="15" width="72" height="11" fill="#4a5238"/><path d="M0 15h72" stroke="#616a48"/><rect x="12" y="9" width="7" height="6" fill="#5c6449"/><rect x="46" y="10" width="9" height="5" fill="#5c6449"/></svg>' },
  { label: '晚秋內陸', hint: '十一月的農地', value: 'autumnFarmland',
    sil: '<svg width="72" height="26"><rect y="15" width="72" height="11" fill="#57493a"/><path d="M0 15h72" stroke="#6b5c48"/><path d="M8 26l10-11M26 26l10-11M44 26l10-11" stroke="#4a3e32"/><circle cx="60" cy="11" r="4" fill="#6e5440"/></svg>' },
  { label: '洛伊納', hint: '油廠與河谷', value: 'leuna',
    sil: '<svg width="72" height="26"><rect y="18" width="72" height="8" fill="#54493b"/><rect x="18" y="11" width="30" height="7" fill="#6a6258"/><rect x="24" y="3" width="3" height="8" fill="#6a6258"/><rect x="36" y="5" width="3" height="6" fill="#6a6258"/><path d="M0 23q10-3 20 0t20 0" stroke="#3c5260" stroke-width="2" fill="none"/></svg>' },
  { label: '波爾塔瓦', hint: '草原機場', value: 'poltava',
    sil: '<svg width="72" height="26"><rect y="16" width="72" height="10" fill="#566041"/><path d="M6 21h60" stroke="#a7a08e" stroke-width="3"/><path d="M30 12h14M37 9v6" stroke="#b9b2a0" stroke-width="2"/></svg>' },
  { label: 'Y-29', hint: '前進降落場', value: 'asch',
    sil: '<svg width="72" height="26"><rect y="16" width="72" height="10" fill="#4f5a3e"/><path d="M6 21h60" stroke="#7d8078" stroke-width="3" stroke-dasharray="4 2"/><rect x="12" y="12" width="6" height="4" fill="#6b705f"/><rect x="54" y="12" width="6" height="4" fill="#6b705f"/></svg>' },
  { label: '純海面', hint: '沒有地標', value: 'sea',
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
const TIMES: readonly { label: string; hint: string; value: TimeOfDay; sil: string }[] = [
  { label: '清晨', hint: '日出前後', value: 'dawn',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#2c3a46"/><rect width="56" height="18" fill="#5b6f86"/><path d="M0 18h56" stroke="#f0c9a0"/><circle cx="28" cy="18" r="6" fill="#ffd7a8"/></svg>' },
  { label: '正午', hint: '日正當中', value: 'noon',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#2e4658"/><rect width="56" height="18" fill="#7ba3c6"/><circle cx="28" cy="7" r="5" fill="#fff4d8"/></svg>' },
  { label: '黃昏', hint: '日落前後', value: 'dusk',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#241f2e"/><rect width="56" height="18" fill="#8a5468"/><path d="M0 18h56" stroke="#ff9a52"/><circle cx="28" cy="18" r="6" fill="#ff9a52"/></svg>' },
  { label: '夜間', hint: '月光', value: 'night',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#0a1018"/><rect width="56" height="18" fill="#16233a"/><circle cx="38" cy="7" r="4" fill="#c8d6ee"/><circle cx="12" cy="6" r="1" fill="#dce6f6"/><circle cx="20" cy="12" r="1" fill="#dce6f6"/><circle cx="7" cy="13" r="1" fill="#dce6f6"/></svg>' },
  { label: '雷雨', hint: '閃電與雨', value: 'storm',
    sil: '<svg width="56" height="26"><rect y="18" width="56" height="8" fill="#1c252c"/><rect width="56" height="18" fill="#3a444d"/><path d="M8 7q4-5 10-2q5-4 11 0q6-2 8 3z" fill="#262e35"/><path d="M30 8l-4 6h4l-3 6" stroke="#f2ecc8" stroke-width="1.5" fill="none"/><path d="M12 11l-2 6M18 11l-2 6M44 9l-2 6M50 9l-2 6" stroke="#7b8894"/></svg>' },
]

/**
 * 陣營章：墊在側影後面的國籍標誌，**照三面標誌本來的樣子畫，不加底盤**。
 *
 * 美軍是 1943 年九月起的 star-and-bar：藍圓加白星，兩側各一條純白槓，外面
 * 一圈藍邊。槓長是藍圓直徑的一半（規範值），**槓高比規範再窄三成** ——
 * 徽章只有 21 px 高，按規範的厚度畫出來是一條粗帶，看不出它是槓。槓裡面
 * 那條紅線是 1947 年以後的事，這幾關的機種身上不會有。
 *
 * 日軍是日之丸，紅圓外面一道窄白邊。
 *
 * 德軍是 1940 年以後的 Balkenkreuz，比例照規範走：十字臂寬 1/4 W、兩側白邊
 * 各 1/8 W、最外的黑框 1/32 W，由內而外是黑、白、黑。**四個臂端不封黑**，
 * 白與黑框都是順著臂的兩側走到端點，端點看到的是白。
 *
 * 【三個的外框比例不一樣】星條徽是橫的（寬是高的兩倍），另外兩個是方的。
 * 三個的高度由 `.sil .mk` 統一，寬度讓 SVG 自己照 viewBox 算 —— 星條徽
 * 因此是另外兩個的兩倍寬，放大它的高度時要留意 68 px 的徽章框放不放得下。
 *
 * 【顏色寫死在這裡】這是三面標誌的本色，不跟著介面的色票走；白的那一階
 * 取的是紙的米白而不是純白，純白在這塊深色紙上會跳出來。
 */
const INSIGNIA_WHITE = '#e6dcc4'
/** 【比面板再深一階】跟面板同深度的黑會整個消失，鐵十字就只剩下白框 */
const INSIGNIA_BLACK = '#12100b'

const MARK: Record<Campaign, string> = {
  allies: '<svg class="mk" viewBox="0 0 64 32">'
    + '<path fill="#35506e" d="M3.4 10h57.2v12H3.4z"/><circle cx="32" cy="16" r="15" fill="#35506e"/>'
    + `<path fill="${INSIGNIA_WHITE}" d="M4.8 11.4h54.4v9.2H4.8z"/>`
    + '<circle cx="32" cy="16" r="13.6" fill="#35506e"/>'
    + `<path fill="${INSIGNIA_WHITE}" d="M32 5l2.59 7.44 7.87.16-6.28 4.76 2.29 7.54L32 20.4l-6.47 4.5`
    + ' 2.29-7.54-6.28-4.76 7.87-.16z"/></svg>',
  germany: '<svg class="mk" viewBox="0 0 32 32">'
    + `<path fill="${INSIGNIA_BLACK}" d="M7 0H25V7H32V25H25V32H7V25H0V7H7Z"/>`
    + `<path fill="${INSIGNIA_WHITE}" d="M8 0H24V8H32V24H24V32H8V24H0V8H8Z"/>`
    + `<path fill="${INSIGNIA_BLACK}" d="M12 0H20V12H32V20H20V32H12V20H0V12H12Z"/></svg>`,
  japan: `<svg class="mk" viewBox="0 0 32 32"><circle cx="16" cy="16" r="15" fill="${INSIGNIA_WHITE}"/>`
    + '<circle cx="16" cy="16" r="13.2" fill="#b23a33"/></svg>',
}

/**
 * 機種徽章：陣營章打底，機身側影壓在上面。
 *
 * 側影是 `public/ui/sil/<id>.png`，由 `tools/blender/render_silhouettes.py`
 * 從同一份 GLB 拍出來 —— 玩家在機庫看到的就是這個外型。**圖是靠
 * `mask-image` 上色的**，所以檔案本身只有 alpha 有意義；換成 `<img>` 的話
 * 兩個畫面就沒辦法各用各的顏色。
 *
 * 新機種要記得跑一次那支腳本，否則這裡只剩下陣營章（`silhouette` 測試會紅）。
 */
function silBadge(id: string): string {
  const side = SIDE_OF[id]
  return `<span class="sil" style="--ac:url(${assetUrl(`/ui/sil/${id}.png`)})">`
    + `${side === undefined ? '' : MARK[side]}<i></i></span>`
}
const ROLE_WORD: Record<AircraftSpec['role'], string> = { fighter: '戰鬥機', bomber: '轟炸機' }

/** 機種在畫面上的排列：機庫的卷宗架與編組頁的機種選單共用這一份 */
const HANGAR_SPECS = sortForHangar(ALL_SPECS)

/** 機種副名：全名去掉短名之後剩下的那截（「P-51D Mustang」→「Mustang」） */
function fullName(spec: AircraftSpec): string {
  const s = shortName(spec)
  return spec.name.startsWith(s) ? spec.name.slice(s.length).trim() : spec.name
}

const readyCount = (list: readonly MissionCard[]): number => list.filter((m) => m.battle !== null).length

/**
 * 選單的 DOM 元件。
 *
 * 【為什麼不用前端框架】狀態只有「六個畫面之一」加上一個設定物件與兩個
 * 索引，一個變數與一次 `render()` 就寫完了。同一頁的真正風險是 three.js 的
 * 資源生命週期，而那是框架碰不到的地方（M10 spec §9.1）。
 *
 * 【資料都在別處算好】簡報用 `briefingOf`、編組用 `skirmish.ts` 的純函數 ——
 * 這裡只畫，因為這裡沒有測試（要 DOM）。
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
  const gear = root.querySelector('#gear') as HTMLElement
  /**
   * 暫停時齒輪旁邊的「教學」按鈕：重看這架飛機的教學卡。**只在暫停選單開著、而且
   * 這一場有卡可看時出現**（`setTutorialHelp`）。
   */
  const help = root.querySelector('#help') as HTMLElement
  let helpAvailable = false
  /** 正在看的那一串卡，與看完要做的事 */
  let tutorialQueue: readonly Tutorial[] = []
  let tutorialAt = 0
  let tutorialDone: () => void = () => {}
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
    rack: q('hangar-rack'),
    sheet: q('hangar-sheet'),
    go: root.querySelector('#skirmish [data-act="fight"]') as HTMLButtonElement,
  }

  /** 任務線的狀態：哪一條、選了第幾關 */
  let campaign: Campaign = 'allies'
  const picked: Record<Campaign, number> = { allies: 0, germany: 0, japan: 0 }
  /** 機庫攤開的是 `HANGAR_SPECS` 的第幾架 */
  let hangarPick = 0
  /** 編組頁的機種選單有沒有展開（每側各自） */
  const paletteOpen = { blue: false, red: false }

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
      closeOverlay(reloadAsk)
      draftAa = appliedAa
      drawSettingRows()
      return
    }
    if (act === 'tutorialOk') { nextTutorial(); return }
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

  /** 把第 `tutorialAt` 張畫進卡片 */
  function drawTutorial(): void {
    const t = tutorialQueue[tutorialAt]!
    q('tut-title').textContent = t.title
    q('tut-panels').innerHTML = t.panels.map((p) =>
      `<li class="tut-panel"><figure class="tut-fig">`
      + `<img src="${assetUrl(p.image)}" alt="${escapeHtml(p.alt)}">`
      + p.tags.map((g) =>
        `<span class="tut-tag" style="left:${g.x}%;top:${g.y}%">${escapeHtml(g.text)}</span>`).join('')
      + `</figure><div class="tut-cap">${escapeHtml(p.caption)}</div></li>`).join('')
  }

  /** 「了解」：這一張記成看過；還有下一張就換上，沒有就收起來並呼叫 `done` */
  function nextTutorial(): void {
    const t = tutorialQueue[tutorialAt]
    if (t !== undefined) markTutorialSeen(t.id)
    tutorialAt++
    if (tutorialAt < tutorialQueue.length) { drawTutorial(); return }
    closeOverlay(tutorial)
    tutorialQueue = []
    const done = tutorialDone
    tutorialDone = () => {}
    done()
  }

  // ── 陣營頁：三張海報卡 ────────────────────────────────
  function renderCampaign(): void {
    el.campaignCards.innerHTML = ''
    for (const c of CAMPAIGNS) {
      const b = document.createElement('button')
      b.className = 'tallcard paperbit'
      b.dataset['campaign'] = c
      const blurb = CAMPAIGN_BLURB[c]
      b.innerHTML = `<span class="photo"><i class="tape tl"></i><img src="${assetUrl(`/ui/${c}.jpg`)}" alt=""></span>`
        + `<span class="t">${CAMPAIGN_LABEL[c]}</span><span class="d">${escapeHtml(blurb.line)}</span>`
        + `<span class="m">${escapeHtml(blurb.planes)}　　<b>可出擊 ${readyCount(MISSIONS[c])}</b> / ${MISSIONS[c].length} 關</span>`
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
        + '<div class="soonbox"><b>準備中</b><br>這一關還在製作中。</div>'
      return
    }
    el.brief.innerHTML = head
      + `<span class="stamp">機密</span>`
      + `<div class="obj">${escapeHtml(b.objective ?? '')}</div>`
      + `<p style="margin:0 0 4px;color:var(--dim)">${escapeHtml(b.summary)}</p>`
      + `<div class="forces"><div><div class="lbl" style="margin-bottom:8px">我方</div>${(b.mine ?? []).map(unitRow).join('')}</div>`
      + `<div class="vs">對</div>`
      + `<div><div class="lbl" style="margin-bottom:8px">敵方</div>${(b.foe ?? []).map(unitRow).join('')}</div></div>`
      + `<div class="facts">${(b.facts ?? []).map((f) =>
        `<div class="fact"><div class="lbl">${escapeHtml(f.label)}</div><div class="v">${escapeHtml(f.value)}</div></div>`).join('')}</div>`
      + `<div class="actions"><button class="go" id="brief-go">出　擊</button></div>`
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
    el.campName.textContent = CAMPAIGN_LABEL[campaign]
    el.route.innerHTML = ''
    list.forEach((m, i) => {
      const ready = m.battle !== null
      const b = document.createElement('button')
      // 【每一關都是紙】不再只有選中的那一份是紙 —— 那一疊本來就是四份文件，
      // 沒翻開的那幾份靠 `.stop:not(.on)` 壓暗一階
      b.className = `stop paperbit ${ready ? 'ready' : 'soon'}${i === k ? ' on' : ''}`
      // 【e2e 用 id 選卡】標題會改，id 不會
      b.dataset['mission'] = m.id
      b.innerHTML = `<div class="k">第 ${i + 1} 關　${escapeHtml(m.type)}</div><div class="n">${escapeHtml(m.title)}</div>`
        + (ready ? '' : '<div class="soonmark">準備中</div>')
      b.addEventListener('click', () => {
        picked[campaign] = i
        renderMission()
      })
      el.route.appendChild(b)
    })
    renderBrief(list[k]!)
  }

  // ── 機庫：左邊一疊機種卷宗，攤開的那一份在右邊 ───────
  /**
   * 【為什麼重畫整頁而不是只換選中的那一格】這一頁的狀態只有「第幾架」一個
   * 數字，而 `dossierOf` 是純函數。少一條「上一個選中的是誰」的鏡射狀態，
   * 就少一個會忘記清掉的地方（與 `renderMission` 同一條理由）。
   */
  function renderHangar(): void {
    const spec = HANGAR_SPECS[hangarPick] ?? HANGAR_SPECS[0]!
    el.rack.innerHTML = ''
    HANGAR_SPECS.forEach((s, i) => {
      const b = document.createElement('button')
      b.className = `stop paperbit${i === hangarPick ? ' on' : ''}`
      // 【e2e 用 id 選機】顯示名會改，id 不會
      b.dataset['aircraft'] = s.id
      b.innerHTML = `${silBadge(s.id)}<div><div class="k">`
        + `${CAMPAIGN_LABEL[SIDE_OF[s.id] ?? 'allies']}　${ROLE_WORD[s.role]}</div>`
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
    // 【Bf 109 K-4 沒有副名】`fullName` 回空字串，不濾掉的話副標會以一個
    // 全形空白開頭
    const sub = [fullName(spec), CAMPAIGN_LABEL[d.side], ROLE_WORD[d.role]]
      .filter((s) => s !== '').join('　')
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

    hooks.onAircraft(spec)
  }

  // ── 編組頁 ───────────────────────────────────────────
  function flightRow(setup: SkirmishSetup, team: 'blue' | 'red', f: Flight, i: number): HTMLElement {
    const spec = specOf(f.id)
    const lead = team === 'blue' && setup.lead === i
    const row = document.createElement('div')
    row.className = `flight${lead ? ' lead paperbit' : ''}`
    row.innerHTML =
      (team === 'blue' ? '<button class="pick" title="我的小隊"></button>' : '<span></span>')
      + `<div class="who"><div class="nm">${escapeHtml(shortName(spec))} <span class="full">${escapeHtml(fullName(spec))}</span></div>`
      + `<div class="meta">${ROLE_WORD[spec.role]}　${strengthOf(spec.id)}</div></div>`
      + `<div class="dots">${[1, 2, 3, 4].map((n) => `<i class="${n <= f.count ? 'on' : ''}"></i>`).join('')}</div>`
      + `<div class="qty"><button class="btn tiny minus">−</button><span class="n">${f.count}</span>`
      + `<button class="btn tiny plus">＋</button><button class="btn tiny rm">✕</button></div>`
    row.querySelector('.pick')?.addEventListener('click', () => hooks.onSetup(setLead(setup, i)))
    row.querySelector('.minus')!.addEventListener('click', () => hooks.onSetup(setCount(setup, team, i, f.count - 1)))
    row.querySelector('.plus')!.addEventListener('click', () => hooks.onSetup(setCount(setup, team, i, f.count + 1)))
    row.querySelector('.rm')!.addEventListener('click', () => hooks.onSetup(removeFlight(setup, team, i)))
    return row
  }

  function renderSide(setup: SkirmishSetup, team: 'blue' | 'red'): void {
    const host = team === 'blue' ? el.mine : el.foe
    const list = team === 'blue' ? setup.blue : setup.red
    host.innerHTML = `<header><h3>${team === 'blue' ? '我方' : '敵方'}</h3>`
      + `<span class="count"><b>${flightsTotal(list)}</b><small> / ${MAX_SIDE} 架</small></span></header>`
    list.forEach((f, i) => host.appendChild(flightRow(setup, team, f, i)))

    const add = document.createElement('button')
    add.className = 'btn add'
    add.textContent = '＋ 加一個小隊'
    // 【滿了就禁用，不是點了沒反應】看起來可點卻沒反應才是真的壞掉
    add.disabled = list.length >= MAX_FLIGHTS || flightsTotal(list) >= MAX_SIDE
    add.addEventListener('click', () => {
      paletteOpen[team] = !paletteOpen[team]
      renderSetup(setup)
    })
    host.appendChild(add)

    const pal = document.createElement('div')
    pal.className = 'palette'
    pal.hidden = !paletteOpen[team] || add.disabled
    for (const spec of HANGAR_SPECS) {
      const b = document.createElement('button')
      b.className = 'plane'
      // 【國家在前、類型在下】例如「盟軍 P-51」，類型排在下面。全名讓位給
      // 這兩項 —— 選單是兩欄的窄卡，`North American P-51D Mustang` 在那裡
      // 一定折行
      const side = SIDE_OF[spec.id]
      b.innerHTML = `${silBadge(spec.id)}<div>`
        + `<div class="nm">${side === undefined ? '' : `<i>${CAMPAIGN_LABEL[side]}</i>　`}`
        + `${escapeHtml(shortName(spec))}</div>`
        + `<div class="st">${ROLE_WORD[spec.role]}　${strengthOf(spec.id)}</div></div>`
      b.addEventListener('click', () => {
        paletteOpen[team] = false
        hooks.onSetup(addFlight(setup, team, spec.id))
      })
      pal.appendChild(b)
    }
    host.appendChild(pal)
  }

  function renderVersus(setup: SkirmishSetup): void {
    const m = flightsTotal(setup.blue)
    const f = flightsTotal(setup.red)
    const hi = Math.max(m, f, 1)
    const byRole = (list: readonly Flight[], role: AircraftSpec['role']) =>
      list.filter((x) => specOf(x.id).role === role).reduce((n, x) => n + x.count, 0)
    el.versus.innerHTML = `<div class="vs">對戰</div>`
      + `<div class="bar"><i class="m" style="height:${(m / hi) * 50}%"></i><i class="f" style="height:${(f / hi) * 50}%"></i></div>`
      + `<div class="odds"><b class="m">${m}</b> ： <b class="f">${f}</b><br>`
      + `戰鬥機 ${byRole(setup.blue, 'fighter')} : ${byRole(setup.red, 'fighter')}<br>`
      + `轟炸機 ${byRole(setup.blue, 'bomber')} : ${byRole(setup.red, 'bomber')}</div>`
  }

  function optRow<T>(
    host: HTMLElement, items: readonly { label: string; hint: string; value: T; sil: string }[],
    current: T, onPick: (v: T) => void,
  ): void {
    host.innerHTML = ''
    for (const it of items) {
      const b = document.createElement('button')
      b.className = it.value === current ? 'on' : ''
      // 【空的說明就不要那一行】畫質與抗鋸齒沒有副標，留一個空的 `<small>`
      // 會在字底下撐出一條空隙，那一列看起來就像少印了字
      const small = it.hint === '' ? '' : `<small>${escapeHtml(it.hint)}</small>`
      b.innerHTML = `${it.sil}<span>${escapeHtml(it.label)}</span>${small}`
      b.addEventListener('click', () => onPick(it.value))
      host.appendChild(b)
    }
  }

  /**
   * 設定頁的兩組值：**已經生效的**，與**玩家正在挑的**。
   *
   * 【為什麼要分兩份】按鈕按下去只改「正在挑的」，按確定才送出去。合成一份就
   * 回不到原值了 —— 而「取消」的意思正是回到原值。
   *
   * 【已生效的那一份由 `main.ts` 餵進來】選單不負責記住設定，見 `renderQuality`。
   */
  let appliedQuality = DEFAULT_QUALITY
  let appliedAa = DEFAULT_ANTIALIAS
  let appliedVolume: number | null = DEFAULT_VOLUME_DB
  let appliedAssist = false
  let draftQuality = appliedQuality
  let draftAa = appliedAa
  let draftVolume: number | null = appliedVolume
  let draftAssist = appliedAssist

  /** 【沒有小圖示】畫質、抗鋸齒、音量都是抽象的，畫不出剪影；`.opt` 對純文字按鈕照樣成立 */
  function drawSettingRows(): void {
    optRow(el.aimAssist,
      AIM_ASSIST_LEVELS.map((lv) => ({ label: lv.label, hint: '', value: lv.value, sil: '' })),
      draftAssist, (v) => { draftAssist = v; drawSettingRows() })
    optRow(el.quality,
      QUALITY_LEVELS.map((lv) => ({ label: lv.label, hint: '', value: lv.scale, sil: '' })),
      draftQuality, (v) => { draftQuality = v; drawSettingRows() })
    optRow(el.antialias,
      ANTIALIAS_LEVELS.map((lv) => ({ label: lv.label, hint: '', value: lv.value, sil: '' })),
      draftAa, (v) => { draftAa = v; drawSettingRows() })
    optRow(el.volume,
      VOLUME_LEVELS.map((lv) => ({ label: lv.label, hint: '', value: lv.db, sil: '' })),
      draftVolume, (v) => { draftVolume = v; drawSettingRows() })
  }

  /** 【每次打開都從已生效的值重來】上一次按取消留下的挑選不該跟著回來 */
  function openSettings(): void {
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
    hooks.onAntialias(draftAa)
  }

  function renderQuality(scale: number): void {
    appliedQuality = scale
    draftQuality = scale
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

  function renderSetup(setup: SkirmishSetup): void {
    el.presets.innerHTML = ''
    for (const key of Object.keys(PRESETS) as PresetKey[]) {
      const b = document.createElement('button')
      b.className = 'btn tiny'
      b.textContent = PRESETS[key].label
      b.addEventListener('click', () => hooks.onSetup(applyPreset(setup, key)))
      el.presets.appendChild(b)
    }
    renderSide(setup, 'blue')
    renderSide(setup, 'red')
    renderVersus(setup)
    optRow(el.terrain, TERRAINS, setup.terrain, (v) => hooks.onSetup({ ...setup, terrain: v }))
    optRow(el.alt, ALTITUDES.map((a, i) => ({ label: a.label, hint: `${a.value.toLocaleString()} m`, value: a.value, sil: altSil(ALT_Y[i] ?? 12) })),
      setup.altitude, (v) => hooks.onSetup({ ...setup, altitude: v }))
    optRow(el.tod, TIMES, setup.timeOfDay, (v) => hooks.onSetup({ ...setup, timeOfDay: v }))
    // 【任一邊空著就禁用】不靠 `battleConfigFrom` 補一架 —— 那是防禦，不是 UI 的行為
    // 【只禁用，不寫一行字】一邊空著的時候那一欄本身就是空的、按鈕也灰了，
    // 再寫一句「兩邊都要有人才打得起來」是多的
    el.go.disabled = flightsTotal(setup.blue) === 0 || flightsTotal(setup.red) === 0
  }

  renderCampaign()

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
    showTutorials(list, done) {
      if (list.length === 0) { done(); return }
      tutorialQueue = list
      tutorialAt = 0
      tutorialDone = done
      drawTutorial()
      openOverlay(tutorial)
    },
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
    renderQuality,
    renderAntialias,
    renderAimAssist,
    renderVolume,
  }
}

/** 名字與文案都是資料，不是標記。與 `ui/scoreboard.ts` 同一個理由 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;'
  ))
}
