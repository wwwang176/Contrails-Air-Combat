import { CAMPAIGNS, MISSIONS } from '../battle/missions'
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
}

export interface Menu {
  /** 顯示指定畫面，其餘隱藏 */
  show(screen: Screen): void
  /** 暫停 overlay */
  setPaused(v: boolean): void
  /** 依目前的設定重畫編組那一頁 */
  renderSetup(setup: SkirmishSetup): void
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
  japan: { line: '臺灣沖到雷伊泰：陸基攔截，護送雷擊隊。', planes: 'A6M5 · Ki-84 · G4M' },
}

/** 場地的選項。**順序即按鈕順序。**群島在前：它是預設，也是有東西可看的那一個 */
const TERRAINS: readonly { label: string; hint: string; value: TerrainKind; sil: string }[] = [
  { label: '群島', hint: '島鏈與淺海', value: 'archipelago',
    sil: '<svg width="72" height="26"><rect y="17" width="72" height="9" fill="#38505c"/><path d="M8 17l9-8 9 8z" fill="#4d5c3f"/><path d="M40 17l13-11 13 11z" fill="#4d5c3f"/></svg>' },
  { label: '內陸', hint: '農地與村落', value: 'farmland',
    sil: '<svg width="72" height="26"><rect y="15" width="72" height="11" fill="#4a5238"/><path d="M0 15h72" stroke="#616a48"/><rect x="12" y="9" width="7" height="6" fill="#5c6449"/><rect x="46" y="10" width="9" height="5" fill="#5c6449"/></svg>' },
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
 * 時段的四個選項。**順序即按鈕順序，與 `render/timeOfDay.ts` 的
 * `TIME_OF_DAY_IDS` 一致。**
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
  return `<span class="sil" style="--ac:url(/ui/sil/${id}.png)">`
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
    if (act === 'restart') { hooks.onRestart(); return }
    // 【放棄任務要問過】確認框是暫停之上的第二層 overlay，不是畫面；
    // 確認之後才送畫面事件 —— 回的是該陣營的任務表，`campaign` 還留著
    if (act === 'abandon') { confirm.hidden = false; return }
    if (act === 'abandonNo') { confirm.hidden = true; return }
    if (act === 'abandonYes') { confirm.hidden = true; hooks.onEvent('toMission'); return }
    hooks.onEvent(act as ScreenEvent)
  })

  // ── 陣營頁：三張海報卡 ────────────────────────────────
  function renderCampaign(): void {
    el.campaignCards.innerHTML = ''
    for (const c of CAMPAIGNS) {
      const b = document.createElement('button')
      b.className = 'tallcard paperbit'
      b.dataset['campaign'] = c
      const blurb = CAMPAIGN_BLURB[c]
      b.innerHTML = `<span class="photo"><i class="tape tl"></i><img src="/ui/${c}.jpg" alt=""></span>`
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
        + '<div class="soonbox"><b>準備中</b><br>這一關要打的是地面與海上目標（工廠、列車、艦船），'
        + '還要投彈與雷擊 —— 那一整套還沒做好。</div>'
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
      (team === 'blue' ? '<button class="pick" title="我帶這一隊"></button>' : '<span></span>')
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
    add.textContent = '＋ 加一個分隊'
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
      b.innerHTML = `${it.sil}<span>${escapeHtml(it.label)}</span><small>${escapeHtml(it.hint)}</small>`
      b.addEventListener('click', () => onPick(it.value))
      host.appendChild(b)
    }
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
    setPaused(v) {
      pause.hidden = !v
      // 關掉暫停就一併關掉確認框：「繼續」與換畫面都不該留下一個問句
      if (!v) confirm.hidden = true
    },
    renderSetup,
  }
}

/** 名字與文案都是資料，不是標記。與 `ui/scoreboard.ts` 同一個理由 */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;'
  ))
}
