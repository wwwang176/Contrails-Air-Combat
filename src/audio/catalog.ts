import type { ShipAATier } from '../world/shipAA'

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
  | 'reload' | 'whistle' | 'radio' | 'warn' | 'wind' | 'impact' | 'ui' | 'thunder' | 'siren' | 'sirenSelf'

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
  /**
   * 每次播放的隨機音高幅度（±），省略 = 0.08。**引擎是唯一乘這個亂數的地方**（`randomRate`）——
   * 呼叫端再乘一次，兩個疊起來就超出這個幅度
   */
  pitchJitter?: number
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
   * 俯衝警笛（`sirenFile` 有檔的機種）。**自己的不定位**，比引擎大 10 dB；別人的走 3D 定位。
   * 實際大小再乘上空速的曲線（`curves.ts` 的 `sirenParams`）。
   *
   * 【別人的傳得比引擎遠得多】警笛是專門拿來嚇人的，而且上帝視角停在地面時鏡頭離俯衝的飛機常有
   * 一兩公里：參考距離 250 m、衰減率 0.6，同為全音量時 1 km 外比引擎大約 10 dB、2 km 外大約 11 dB。
   * **起始值，由試玩裁定。**
   */
  sirenSelf: { gainDb: 7, ref: 0, max: 0 },
  siren: { gainDb: 0, ref: 250, max: 6000, rolloff: 0.6 },
  /**
   * 自己的槍。**一次擊發一個 one-shot，不是循環。**
   *
   * 【比循環要小聲】350 ms 的尾音配上 13.3 發/秒，全速連射時同時有將近五層
   * 在響 —— 同一個數字底下比循環大 5.7 dB。
   */
  fireSelf: { gainDb: -4, ref: 0, max: 0 },
  /**
   * 別人的槍。**循環音**。
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
   * 別的往下壓，見上面那段。各砲種之間的差距在 `GUN_BY_KIND`。
   *
   * 【音高只差 ±4%】每一種砲只有一個檔：差到 ±8% 聽起來像換了一門不同口徑的砲
   */
  cannon: { gainDb: 5, ref: 150, max: 6000, pitchJitter: 0.04 },
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
  // 各砲種的開火聲，每一種一個檔（`GUN_BY_KIND`）。20 mm 與 .50 各有兩種砲共用一個檔
  'gun-5in': ['gun-5in'],
  'gun-heavy-flak': ['gun-heavy-flak'],
  'gun-tank': ['gun-tank'],
  'gun-at': ['gun-at'],
  'gun-mortar': ['gun-mortar'],
  'gun-40mm': ['gun-40mm'],
  'gun-20mm': ['gun-20mm'],
  'gun-50cal': ['gun-50cal'],
  'gun-rifle': ['gun-rifle'],
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
  'volley-mg17x2': range('volley-mg17x2', 3),
  // 自己駕駛 Ju 87 時後座的單管 MG 15 也走這一套（與前機槍同一個機制，單聲道）
  'volley-mg15x1': range('volley-mg15x1', 3),
  'volley-type97x2': range('volley-type97x2', 3),
  'volley-type99-2x2': range('volley-type99-2x2', 3),
  'volley-ho103x2': range('volley-ho103x2', 3),
  'volley-ho5x2': range('volley-ho5x2', 3),
  /**
   * 前機槍過熱時扣扳機的空響。**與齊射同一套分組**（武器 id ×挺數）：同一組的 N 挺各「喀」一下，
   * 錯開 0～15 ms、音高 ±2.5%、音量 ±1.5 dB、左右照槍的位置（與齊射的左右相同）。
   * 每種槍的音高照齊射槍聲的高低順序壓進 ±10%：MK 108 最低（−10%）、MG 17 最高（+10%）。
   * 每個檔的 A 加權峰值對齊同一個值，六挺疊起來不會比兩挺大聲；補償 +8 dB 後與自己的引擎（−20.6 dB）
   * 同一個量級、比自己的槍聲（−17.2 dB）小 —— 不補的話被引擎蓋掉 8 dB
   */
  'gun-jam-m2-50calx6': range('gun-jam-m2-50calx6', 3),
  'gun-jam-mk108x1': range('gun-jam-mk108x1', 3),
  'gun-jam-mg131x2': range('gun-jam-mg131x2', 3),
  'gun-jam-mg17x2': range('gun-jam-mg17x2', 3),
  'gun-jam-type97x2': range('gun-jam-type97x2', 3),
  'gun-jam-type99-2x2': range('gun-jam-type99-2x2', 3),
  'gun-jam-ho103x2': range('gun-jam-ho103x2', 3),
  'gun-jam-ho5x2': range('gun-jam-ho5x2', 3),
} as const satisfies Record<string, readonly string[]>
export type Pool = keyof typeof POOLS

/**
 * 開火循環依射速合成。翼槍六挺 M2 的三個機種共用一個。
 *
 * 【Ju 87 的是兩挺翼內 MG 17（1,150 發/分）】左右擺開；後座的單管 MG 15 走砲塔檔（`turretFile`）。
 *
 * 【Yak-1B 暫用 Bf 109 K-4 的循環】同樣是機首的一門機砲加機槍；專屬的循環還沒做。
 */
const FIRE_OF: Record<string, string> = {
  p51d: 'fire-m2x6', f4f4: 'fire-m2x6', f6f5: 'fire-m2x6',
  bf109k4: 'fire-bf109k4', a6m5: 'fire-a6m5', ki84: 'fire-ki84',
  ju87: 'fire-ju87', yak1b: 'fire-bf109k4',
}

/**
 * 引擎聲借用別台的檔。**Yak-1B 暫用 Bf 109 K-4 的**：同是液冷倒 V 12 缸、機首單發。
 * 其餘每個機種都有自己的檔（`engine-<機種 id>`）。
 */
const ENGINE_OF: Readonly<Record<string, string>> = { yak1b: 'bf109k4' }

export function engineFile(specId: string): string {
  return `engine-${ENGINE_OF[specId] ?? specId}`
}

/** 沒有前射武器（轟炸機）回 null */
export function fireFile(specId: string): string | null {
  return FIRE_OF[specId] ?? null
}

/**
 * 俯衝警笛的檔。**只有 Ju 87 有**（Jericho 警笛）；回 null 的機種不響警笛 ——
 * 這是「這架會不會響」的唯一判斷，音量與音高隨空速變（`curves.ts` 的 `sirenParams`）。
 *
 * 檔案是 8 秒的立體聲循環（同一段 1 秒的循環接 8 次），播放速度 1 時基頻約 864 Hz。
 * 左右聲道是同一段錯開半圈、往左右各擺一些再混的：寬度做在檔案裡，播放端不必再擺位。
 * 換檔時 `curves.ts` 的 `SIREN_BASE_HZ` 要跟著改，否則整條音高曲線偏掉而且不報錯。
 */
const SIREN_OF: Readonly<Record<string, string>> = { ju87: 'siren-ju87' }

export function sirenFile(specId: string): string | null {
  return SIREN_OF[specId] ?? null
}

/** 砲塔：武器 id（與 src/weapons/ 相同）與管數 → 檔。雙聯以上一律用雙聯 */
export function turretFile(weaponId: string, guns: number): string {
  return `turret-${weaponId}x${guns >= 2 ? 2 : 1}`
}

/**
 * 各砲塔檔的音量修正，dB；不在表裡的是 0。目標是各砲塔聽起來一樣大。
 *
 * ```
 *   檔                   A 加權（整段）   修正    修正後
 *   M2 .50 單管/雙聯     −21.5 / −22.2     0
 *   MG 131               −23.2             0
 *   MG 15 單管/雙聯      −23.0 / −23.8     0
 *   九二式 7.7 mm        −19.5            −3     −22.5
 *   九九式 20 mm         −23.8            +1     −22.8
 * ```
 *
 * 【為什麼不看 LUFS】七個檔的 LUFS 都在 −16.4 上下，但九二式的能量在中高頻、九九式在 300 Hz
 * 以下 —— 耳朵對中高頻敏感，同樣的 LUFS 下九二式明顯比較大聲，九九式偏小。
 * 【不放進素材清單的補償值】那一欄只能是 0–12 dB，負的修正放不進去。
 */
const TURRET_GAIN_DB: Readonly<Record<string, number>> = {
  'turret-type92x1': -3,
  'turret-type99-1x1': 1,
}

export const TURRET_GAIN_FILES: readonly string[] = Object.keys(TURRET_GAIN_DB)

export function turretGainDb(file: string): number {
  return TURRET_GAIN_DB[file] ?? 0
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
 * 艦砲、陸砲開火：**每一種砲固定一個聲音**（SPEC `2026-10-09-gun-sounds-design.md`）。
 *
 * ```
 *   naval5in     艦艇 127 mm                    gun-5in
 *   heavyFlak    陸上 Flak 18、90 mm M1A1       gun-heavy-flak
 *   tankGun      戰車砲（地面戰）                gun-tank
 *   atGun        反坦克砲（地面戰）              gun-at
 *   mortar       迫擊砲發射（地面戰）            gun-mortar
 *   naval40      艦艇 40 mm                     gun-40mm
 *   naval20      艦艇 20 mm                     gun-20mm
 *   lightFlak20  陸上 Flak 38 四聯 20 mm        gun-20mm
 *   quad50       M16 四聯 .50                   gun-50cal（低音 +6 dB 烘進檔案）
 *   roof50       卡車車頂 .50                   gun-50cal
 *   infantry     步兵（地面戰）                  gun-rifle（高音 +6 dB 烘進檔案）
 * ```
 *
 * 【不再共用一庫、隨機挑】同一門砲每發換一段不同的錄音，聽起來像幾種武器輪流打。每發的小變化只有
 * 音高（`cannon` 類別的 `pitchJitter`）與音量（`cannonAudio.ts` 的 `GUN_GAIN_JITTER_DB`）。
 *
 * 【`gainDb` 含 A 加權校正】檔案照素材慣例都在 −16 LUFS，但人耳聽感（A 加權、最響 0.4 s）各不相同。
 * 這裡的值 = 負責人在試聽頁定的砲種音量 + 把該檔校正到舊砲擊庫平均 −24.1 dB(A) 的差。改檔要重量。
 *
 * 【`gap` 是每一座砲位／每一台地面單位各自的時段】一座在 `gap` 秒內只響一聲，防它自己在一瞬間
 * 疊好幾聲；全場的總量交給引擎的每類配額（`VOICE_QUOTA`），被丟的是遠處小聲的。
 */
export interface GunSound {
  pool: Pool
  gainDb: number
  gap: number
}

const GUN_BY_KIND: Readonly<Record<string, GunSound>> = {
  naval5in: { pool: 'gun-5in', gainDb: 2.8, gap: 0.12 },
  heavyFlak: { pool: 'gun-heavy-flak', gainDb: 3.3, gap: 0.12 },
  tankGun: { pool: 'gun-tank', gainDb: -6.0, gap: 0.15 },
  atGun: { pool: 'gun-at', gainDb: -5.9, gap: 0.15 },
  mortar: { pool: 'gun-mortar', gainDb: -7.4, gap: 0.3 },
  naval40: { pool: 'gun-40mm', gainDb: -6.4, gap: 0.1 },
  naval20: { pool: 'gun-20mm', gainDb: -10.4, gap: 0.07 },
  lightFlak20: { pool: 'gun-20mm', gainDb: -6.4, gap: 0.1 },
  quad50: { pool: 'gun-50cal', gainDb: -8.7, gap: 0.1 },
  roof50: { pool: 'gun-50cal', gainDb: -10.7, gap: 0.07 },
  infantry: { pool: 'gun-rifle', gainDb: -14.7, gap: 0.08 },
}

const GUN_DEFAULT: GunSound = { pool: 'gun-40mm', gainDb: -6.4, gap: 0.1 }

export function gunSound(kind: string): GunSound {
  return Object.hasOwn(GUN_BY_KIND, kind) ? GUN_BY_KIND[kind]! : GUN_DEFAULT
}

/** 船的砲區沒有自己的 `sound`：三層對到艦砲的三種 */
const SHIP_GUN_SOUND: Readonly<Record<ShipAATier, string>> = { flak: 'naval5in', autocannon: 'naval40', mg: 'naval20' }

export function shipGunSound(tier: ShipAATier): string {
  return SHIP_GUN_SOUND[tier]
}

/**
 * 地面戰的單位 id → 砲聲的種類（`gunSound` 的鍵）。**不在表裡的單位沒有砲口聲** ——
 * 卡車、建物，以及不走地面戰的戲的重高砲（它們走 `playCannons` 的砲位閃光）。
 *
 * 【用 Map】單位 id 是任意字串，物件查表會撈到 `constructor` 之類原型上的成員。
 */
const GROUND_GUN_TIER: ReadonlyMap<string, string> = new Map([
  ['tank', 'tankGun'], ['tankDug', 'tankGun'], ['panzer4', 'tankGun'], ['tiger', 'tankGun'], ['usTank', 'tankGun'],
  ['atGun', 'atGun'], ['infantry', 'infantry'], ['mortar', 'mortar'],
])

export function groundGunTier(unitId: string): string | null {
  return GROUND_GUN_TIER.get(unitId) ?? null
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

/** 前機槍過熱的空響：武器 id 與挺數 → 空響庫。沒有對應的庫回 null（那一組過熱時不響） */
export function jamPool(weaponId: string, guns: number): Pool | null {
  const id = `gun-jam-${weaponId}x${guns}`
  return id in POOLS ? id as Pool : null
}

/**
 * 自己駕駛時砲塔改走齊射庫（與前機槍同一個機制）的各座砲塔的庫；不符條件回 null，維持砲塔循環。
 *
 * 【每一座砲塔都有庫才整架改走】只有一部分有的話（He 111 的機首與兩側是單管 MG 15，背部是
 * MG 131、腹部是雙聯 MG 15），沒有庫的那幾座自己駕駛時會整個沒聲音 —— 不報錯。
 */
export function ownTurretVolleyPools(
  turrets: readonly { readonly weapon: { readonly id: string }; readonly guns: number }[],
): Pool[] | null {
  if (turrets.length === 0) return null
  const pools: Pool[] = []
  for (const t of turrets) {
    const pool = volleyPool(t.weapon.id, t.guns)
    if (pool === null) return null
    pools.push(pool)
  }
  return pools
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
  ...['p51d', 'bf109k4', 'f4f4', 'f6f5', 'a6m5', 'ki84', 'he111', 'ju87', 'g4m', 'b17g'].map(engineFile),
  ...new Set(Object.values(FIRE_OF)),
  ...Object.values(SIREN_OF),
  ...Object.values(POOLS).flat(),
  ...Object.values(SINGLE_FILES),
]
