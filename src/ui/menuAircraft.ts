import { assetUrl } from '../core/asset'
import type { Campaign } from '../battle/missions'
import { ALL_SPECS } from '../specs/catalog'
import { t, type MessageKey } from '../i18n'
import { aircraftName } from '../i18n/names'
import { shortName } from '../i18n/names'
import { sortForHangar, MISSION_ONLY_SIDE, SIDE_OF } from './dossier'
import type { AircraftSpec } from '../specs/types'

/**
 * 戰役的標籤與陣營卡上的文案。
 *
 * 【為什麼是 `Record<Campaign, …>` 而不是陣列】少一格是編譯錯誤。加第四條線時
 * 只加型別而漏了這裡，卡片會**永遠畫不出來而且照樣編譯**。
 */
const CAMPAIGN_LABEL: Record<Campaign, MessageKey> = {
  allies: 'campaign.allies', germany: 'campaign.germany', japan: 'campaign.japan',
}
export const campaignLabel = (c: Campaign): string => t(CAMPAIGN_LABEL[c])
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
/** 蘇軍的紅星：只在任務簡報出現（`MISSION_ONLY_SIDE`），不是戰役線，所以不在 `MARK` 裡。紅取日本旗的那一階，白邊同上 */
const SOVIET_MARK = '<svg class="mk" viewBox="0 0 32 32">'
  + `<path fill="#b23a33" stroke="${INSIGNIA_WHITE}" stroke-width="1.4" stroke-linejoin="round"`
  + ' d="M16 2l3.37 10.36h10.9l-8.82 6.41 3.37 10.37L16 22.73l-8.82 6.41 3.37-10.37-8.82-6.41h10.9z"/></svg>'
function markOf(id: string): string {
  const side = SIDE_OF[id]
  if (side !== undefined) return MARK[side]
  return MISSION_ONLY_SIDE[id] === 'soviet' ? SOVIET_MARK : ''
}
/**
 * 機種徽章：陣營章打底，機身側影壓在上面。
 *
 * 側影是 `public/ui/sil/<id>.png`，與機庫裡的 GLB 同一個外型。**圖是靠
 * `mask-image` 上色的**，所以檔案本身只有 alpha 有意義；換成 `<img>` 的話
 * 兩個畫面就沒辦法各用各的顏色。
 *
 * 加新機種要補 `public/ui/sil/<id>.png`，否則這裡只剩下陣營章（`silhouette` 測試會紅）。
 */
export function silBadge(id: string): string {
  return `<span class="sil" style="--ac:url(${assetUrl(`/ui/sil/${id}.png`)})">${markOf(id)}<i></i></span>`
}
const ROLE_WORD: Record<AircraftSpec['role'], MessageKey> = { fighter: 'role.fighter', bomber: 'role.bomber' }
export const roleWord = (role: AircraftSpec['role']): string => t(ROLE_WORD[role])
/** 機種在畫面上的排列：機庫的卷宗架與編組頁的機種選單共用這一份 */
export const HANGAR_SPECS = sortForHangar(ALL_SPECS)
/** 機種副名：全名去掉短名之後剩下的那截（「P-51D Mustang」→「Mustang」） */
export function fullName(spec: AircraftSpec): string {
  const s = shortName(spec)
  const full = aircraftName(spec)
  return full.startsWith(s) ? full.slice(s.length).trim() : full
}
