/**
 * 音效目錄：哪一類用哪些檔、多大聲、多遠聽得到。
 *
 * 【檔案一律標準音量】誰比誰大聲只看這裡的 gainDb；檔案本身都是 −16 LUFS，
 * 因峰值限制少掉的分貝在 public/audio/manifest.json 的 makeupDb，播放時加回去。
 * 【ref 為 0 表示不定位】自己身上的聲音放在鏡頭位置，不做距離衰減。
 * 數值是起始值，由試玩決定。
 */
export type Category = 'engine' | 'engineSelf' | 'fire' | 'fireSelf' | 'turret' | 'explosion' | 'splash'
  | 'blast' | 'cannon' | 'flakBurst' | 'hitSelf' | 'hitDealt' | 'flyby' | 'damage' | 'rattle'
  | 'reload' | 'whistle' | 'radio' | 'warn' | 'wind' | 'impact' | 'ui' | 'thunder'

export interface CategorySpec {
  gainDb: number
  /** 這個距離內是原音量，m。0 = 不定位 */
  ref: number
  /** 超過就不播（單次）或靜音（循環），m */
  max: number
  /**
   * 距離衰減的快慢，省略 = 1（three 的 inverse 模型原樣）。
   * **小於 1 就傳得更遠** —— 0.45 時 3 km 外比 1 大 6.4 dB。
   *
   * 【為什麼不是調 ref】把 ref 拉大等於「這個距離內都一樣響」，近處就分不出
   * 遠近了。改衰減率只讓尾巴拖長，近處的層次不變。
   */
  rolloff?: number
}

/**
 * 【爆炸是天花板】檔案的峰值壓在 −1 dBFS，音量設「高」時總音量是 0 dB ——
 * 爆炸的 +6 已經接近破音。要讓爆炸更突出就把別的往下壓，不是把爆炸往上加。
 */
export const CATEGORY: Record<Category, CategorySpec> = {
  /**
   * 【自己的不定位】引擎就在鏡頭前一兩公尺，永遠是原音量；別人的走 3D 定位，
   * `ref` 之內與自己的一樣大，之外每遠一倍小 6 dB。
   *
   * 【參考距離 150 m】60 m 時空戰常見的 200～500 m 距離上敵機引擎已經小了
   * 10～18 dB，等於只剩背景。**起始值，由試玩裁定。**
   */
  engineSelf: { gainDb: -3, ref: 0, max: 0 },
  engine: { gainDb: -3, ref: 150, max: 3000 },
  /**
   * 自己的槍。**一次擊發一個 one-shot，不是循環。**
   *
   * 【比循環要小聲】350 ms 的尾音配上 13.3 發/秒，全速連射時同時有將近五層
   * 在響 —— 同一個數字底下比循環大 5.7 dB。
   */
  fireSelf: { gainDb: -4, ref: 0, max: 0 },
  /**
   * 別人的槍。**循環音**，而且再吃各口徑的差異（`GUN_BY_TIER`）——
   * 機槍那一層還要再減 10 dB。
   *
   * 【為什麼比自己的槍高】循環在同一個數字下比 one-shot 小約 5.7 dB。
   * 兩邊設成同一個數字時，敵機的機槍實測**聽不到**。
   */
  fire: { gainDb: 3, ref: 80, max: 2500 },
  /**
   * 砲塔。**自己機上的與別架的共用這一個** —— 砲塔一律是定位音源，自己那架
   * 的就掛在幾公尺外，在參考距離之內等於全音量。
   *
   * 【為什麼比戰鬥機的槍小】開轟炸機時砲塔就是玩家的槍，但它同時是滿天
   * 轟炸機編隊的還擊聲 —— 拉到與戰鬥機同樣的比例，盟 M2 那種場面會太吵。
   */
  turret: { gainDb: 2, ref: 80, max: 2500 },
  /** 飛機被打爆。**不要再遠了** —— 空戰時滿天都是，傳太遠會變成持續的隆隆聲 */
  explosion: { gainDb: 6, ref: 150, max: 8000 },
  /**
   * 炸彈、魚雷、地面目標炸毀。**比飛機爆炸傳得遠得多** —— 幾百公斤的裝藥
   * 在地面炸開，幾公里外聽得到才對。
   */
  blast: { gainDb: 6, ref: 150, max: 8000, rolloff: 0.45 },
  splash: { gainDb: 2, ref: 80, max: 3000 },
  /**
   * 艦砲、陸砲開火。**這一類已經比爆炸低不了多少** —— 要再大聲的話得先把
   * 別的往下壓，見上面那段。各口徑之間的差距在 `GUN_BY_TIER`。
   */
  cannon: { gainDb: 5, ref: 150, max: 6000 },
  // 5 吋艦砲、88 砲在空中炸開：就在你附近，要聽得出壓力
  flakBurst: { gainDb: 2, ref: 120, max: 8000, rolloff: 0.45 },
  // 自己被打中的金屬聲。**單獨響（機槍命中）與疊在受創悶響上都是這一類**；
  // 只有機槍那一條另外壓了一截，見 `main.ts` 的 `BULLET_HIT_DB`
  hitSelf: { gainDb: -6, ref: 0, max: 0 },
  // 【比自己被打小得多】連續掃射時它一直在響；音量與頻率上限見 `playHitDealt`
  hitDealt: { gainDb: -14, ref: 0, max: 0 },
  // 【定位但不衰減】判定半徑 20 m，`ref` 也是 20 —— 範圍內都是原音量，
  // 要的只是左右方向：聽得出子彈從哪一邊掠過
  flyby: { gainDb: -5.4, ref: 20, max: 200 },
  damage: { gainDb: 0, ref: 0, max: 0 },
  rattle: { gainDb: 0, ref: 0, max: 0 },
  reload: { gainDb: -8, ref: 0, max: 0 },
  /**
   * 選單按鈕。**選單裡只有它在響** —— 不像戰場上要跟引擎與槍聲擠，
   * 所以它與戰場上那些的相對大小沒有意義，只看按起來舒不舒服。
   */
  ui: { gainDb: -10, ref: 0, max: 0 },
  // 【壓低】投一艙就是八顆，八次呼嘯同時響；它是氛圍，不是回饋
  whistle: { gainDb: -16, ref: 60, max: 1500 },
  radio: { gainDb: -5, ref: 0, max: 0 },
  warn: { gainDb: -10, ref: 0, max: 0 },
  wind: { gainDb: -6, ref: 0, max: 0 },
  /**
   * 子彈打在船殼、建築上。**定位音源** —— 掃射時聽得出打在哪裡。
   *
   * 【射程比擦過遠、比爆炸近】它是一連串小撞擊，1.2 km 之外就只是雜訊了
   */
  impact: { gainDb: -4, ref: 60, max: 1200 },
  /**
   * 雷聲（雷雨的時段）。**定位在閃電打下的地方**（`render/storm.ts`、`main.ts`
   * 的 `playThunder`）：聽得出從哪一邊來，音波走到才響，遠的更悶。
   *
   * 【衰減放得很緩、增益給得高】閃電在 1～5 km 外，而空氣吸收每公里就是 2.8 dB。
   * 照一般的 inverse 衰減，5 km 外的雷會小到聽不見。**起始值，由試玩裁定。**
   */
  thunder: { gainDb: 12, ref: 1000, max: 8000, rolloff: 0.3 },
}

const range = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`)

/** 同一種事件從庫裡隨機挑（`pick.ts` 的 pickNoRepeat） */
export const POOLS = {
  explosion: range('explosion', 5),
  /**
   * 空爆：爆炸庫的三個各剪成 2.2 s。
   * 【要短】高射砲一秒炸四次；用 4–7 s 的原版會同時有三十幾個聲音在播
   */
  flakBurst: ['flak-burst-1', 'flak-burst-2', 'flak-burst-3'],
  splash: range('splash', 4),
  cannon: range('cannon', 3),
  /** 雷雨的雷聲。長短、遠近各不同，每一聲再隨機播放速度與低通 */
  thunder: range('thunder', 7),
  hit: range('hit', 16),
  flyby: range('flyby', 20),
  damage: range('damage', 10),
  rattle: range('rattle', 15),
  radio: range('radio', 4),
  /** 子彈打在地面、建築上：一下撞擊加碎屑散落 */
  debris: range('debris', 4),
  // 自己的槍：一次擊發一個 one-shot。命名與砲塔同一套（武器 id ×挺數）
  'volley-m2-50calx6': range('volley-m2-50calx6', 3),
  'volley-mk108x1': range('volley-mk108x1', 3),
  'volley-mg131x2': range('volley-mg131x2', 3),
  'volley-type97x2': range('volley-type97x2', 3),
  'volley-type99-2x2': range('volley-type99-2x2', 3),
  'volley-ho103x2': range('volley-ho103x2', 3),
  'volley-ho5x2': range('volley-ho5x2', 3),
} as const satisfies Record<string, readonly string[]>
export type Pool = keyof typeof POOLS

/** 開火循環依射速合成。翼槍六挺 M2 的三個機種共用一個 */
const FIRE_OF: Record<string, string> = {
  p51d: 'fire-m2x6', f4f4: 'fire-m2x6', f6f5: 'fire-m2x6',
  bf109k4: 'fire-bf109k4', a6m5: 'fire-a6m5', ki84: 'fire-ki84',
}

export function engineFile(specId: string): string {
  return `engine-${specId}`
}

/** 沒有前射武器（轟炸機）回 null */
export function fireFile(specId: string): string | null {
  return FIRE_OF[specId] ?? null
}

/** 砲塔：武器 id（與 src/weapons/ 相同）與管數 → 檔。雙聯以上一律用雙聯 */
export function turretFile(weaponId: string, guns: number): string {
  return `turret-${weaponId}x${guns >= 2 ? 2 : 1}`
}

/**
 * 子彈打在飛機以外的東西上，該播什麼。**索引是 `world/material.ts` 的 `MATERIAL`。**
 *
 * 【為什麼有預設】新加的目標忘了定材質、或材質新增了而這張表沒跟上時，
 * 走 `IMPACT_DEFAULT` —— 會有聲音，只是不特別。整個沒聲音才是難查的那種壞法。
 *
 * 【艦體用命中庫、其餘用碎屑庫】打在厚鋼板上是金屬悶響（命中庫，切掉高頻）；
 * 打在地面、建築上會濺起碎屑，那是另一種聲音。**預設也是碎屑庫** —— 沒定
 * 材質的東西多半不是鋼板。
 */
export interface ImpactSound {
  pool: Pool
  gainDb: number
  rate: number
  /** 音色上限，Hz。厚的東西悶，薄的清脆 */
  cutoffHz: number
}

const IMPACT_DEFAULT: ImpactSound = { pool: 'debris', gainDb: 0, rate: 1, cutoffHz: 22000 }

const IMPACT_BY_MATERIAL: readonly ImpactSound[] = [
  /**
   * 艦體：幾公分厚的裝甲鋼板。**又低又悶。**
   *
   * 【低沉靠低通，不靠降音高】降音高等於把素材拉長，每一下拖得比原本久，
   * 連續掃射時會疊成一片轟隆。低通只切掉高頻的殘響，長度與節奏維持原樣。
   */
  { pool: 'hit', gainDb: 6, rate: 1, cutoffHz: 550 },
  /** 地面目標：建築、車輛 */
  { pool: 'debris', gainDb: 0, rate: 1, cutoffHz: 22000 },
]

export function impactSound(material: number): ImpactSound {
  return IMPACT_BY_MATERIAL[material] ?? IMPACT_DEFAULT
}

/**
 * 艦砲、陸砲開火：**每一層各有自己的聲音。**
 *
 * ```
 *   flak        127 mm 五吋砲     20 發/分    一聲大砲
 *   autocannon   40 mm 機砲      220 發/分    砰、砰、砰
 *   mg           20 mm 機砲      480 發/分    急促的噠噠
 * ```
 *
 * 【共用砲擊庫、只改音高與音色】口徑越小聲音越短越脆。沒有各口徑的獨立素材，
 * 要換成獨立的庫時改這張表就好。
 *
 * 【`gap` 是每一層各自的上限】20 mm 一座每秒八發，一艘船八個砲位 —— 不限的話
 * 光它就把聲道吃光。同一層在 `gap` 秒內只播一次，聽起來仍然是連續的。
 */
export interface GunSound {
  gainDb: number
  rate: number
  cutoffHz: number
  gap: number
}

const GUN_BY_TIER: Record<string, GunSound> = {
  flak: { gainDb: 0, rate: 1, cutoffHz: 22000, gap: 0.12 },
  autocannon: { gainDb: -6, rate: 1.6, cutoffHz: 7000, gap: 0.1 },
  mg: { gainDb: -10, rate: 2.2, cutoffHz: 9000, gap: 0.07 },
}

const GUN_DEFAULT: GunSound = { gainDb: -6, rate: 1.3, cutoffHz: 22000, gap: 0.1 }

export function gunSound(tier: string): GunSound {
  return GUN_BY_TIER[tier] ?? GUN_DEFAULT
}

/**
 * 自己的槍：武器 id 與挺數 → 齊射庫。沒有對應的庫回 null（轟炸機、還沒做的武器）。
 *
 * 【為什麼自己的槍不用循環】循環是一段連續掃射，播多久就聽到幾發 —— 點放一次
 * 扳機會被聽成好幾發，而且停的時候一定切在某一發中間。一次擊發播一個 one-shot
 * 的話，長度由素材自己的衰減決定，射速由 `roundsPerMinute` 決定，每台飛機都對。
 */
export function volleyPool(weaponId: string, guns: number): Pool | null {
  const id = `volley-${weaponId}x${guns}`
  return id in POOLS ? id as Pool : null
}

export const SINGLE_FILES = {
  /** 進出投彈瞄準視角：彈艙的機械聲 */
  bayToggle: 'reload-1',
  /** 彈艙補滿：掛鉤扣上的「喀」加一下悶響 */
  reloadDone: 'reload-2',
  whistle: 'whistle-1',
  warn: 'warn-1',
  wind: 'wind-1',
  /** 選單的一般按鈕：機械式的一下 */
  uiClick: 'ui-1',
  /** 退回上一頁：按下與彈起兩下 */
  uiBack: 'ui-2',
  /** 關閉面板、收起確認框：闔上的一下 */
  uiClose: 'ui-3',
} as const

/**
 * 這幾支排在下載佇列的最前面。
 *
 * 【為什麼】選單的按鈕音在主選單就會被按到，而那時整包音效還在背景下載。
 * 照清單原本的順序（字母序）它們排在最後 —— 開場那幾下按鈕會是靜音的。
 */
export const FIRST_FILES: readonly string[] =
  [SINGLE_FILES.uiClick, SINGLE_FILES.uiBack, SINGLE_FILES.uiClose]

export const ALL_FILES: readonly string[] = [
  ...['p51d', 'bf109k4', 'f4f4', 'f6f5', 'a6m5', 'ki84', 'he111', 'g4m', 'b17g'].map(engineFile),
  ...new Set(Object.values(FIRE_OF)),
  ...Object.values(POOLS).flat(),
  ...Object.values(SINGLE_FILES),
]
