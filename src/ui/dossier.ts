import { HISTORICAL, topSpeedKmh } from '../battle/skirmish'
import type { Campaign } from '../battle/missions'
import { bestSustainedTurnRateCached, maxRollRate } from '../analysis/envelope'
import { LOADOUT_BY_AIRCRAFT } from '../weapons/stores'
import type { AircraftSpec } from '../specs/types'

/**
 * 機庫左欄要畫的東西。**純資料，沒有 DOM。**
 *
 * 【為什麼不讓 `menu.ts` 直接讀 spec】數值條的刻度與換算是會出錯而且看不出
 * 錯的東西（條畫得太短只會被當成「這台就是慢」）。與 `briefing.ts` 同一條
 * 路：算在這裡、測在這裡，`menu.ts` 只負責畫。
 */
export interface Bar {
  readonly label: string
  /** 數字與單位，例如「711 km/h」。條旁邊要印出真值，否則讀者只能比長短 */
  readonly text: string
  /** 0…1，條的填滿比例 */
  readonly fill: number
}

export interface Fact {
  readonly label: string
  readonly value: string
}

export interface Dossier {
  /** 機種全名，例如「P-51D Mustang」 */
  readonly name: string
  /** 這一台飛在哪一邊的旗下 */
  readonly side: Campaign
  /** 戰鬥機／轟炸機 */
  readonly role: AircraftSpec['role']
  readonly story: string
  readonly bars: readonly Bar[]
  readonly facts: readonly Fact[]
}

/**
 * 機種是哪一邊的。
 *
 * 【為什麼不在 `AircraftSpec` 上】spec 是模擬用的係數，一架飛機飛在哪一邊是
 * 戰役的設定不是機體的性質（同一台 P-51D 在遭遇戰裡兩邊都能派）。這張表只
 * 服務顯示 —— 機種選單的前綴與機庫的陣營列都讀它。
 */
export const SIDE_OF: Record<string, Campaign> = {
  p51d: 'allies', b17g: 'allies', f6f5: 'allies', f4f4: 'allies',
  bf109k4: 'germany', he111: 'germany',
  a6m5: 'japan', ki84: 'japan', g4m: 'japan',
}

/**
 * 數值條的評估條件。
 *
 * 【為什麼九台用同一組條件而不是各取各的最佳點】條要能互相比較。各取各的
 * 臨界高度的話，B-17 的迴旋會在 7,600 m 量、零戰在 6,000 m 量，兩條並排
 * 起來就不是同一個問題的答案。
 *
 * 【滾轉為什麼是 100 m/s】舵面在高動壓下會變重（`controlStiffening`），
 * 所以滾轉率是速度的函數，必須指定一個速度。100 m/s（360 km/h TAS）是
 * **九台在這個高度都飛得到**的速度 —— 最慢的 He 111 在 3,000 m 的極速是
 * 397 km/h。挑更快的話轟炸機那幾條會落在它們根本到不了的速度上。
 */
const BAR_ALTITUDE = 3000
const BAR_ROLL_SPEED = 100

/**
 * 每一條的滿格值。
 *
 * 【為什麼是固定刻度而不是「全機種最大值」】相對刻度會讓最強的那一台永遠
 * 滿格，讀者因此看不出「第一名與第二名只差 1 km/h」（P-51D 與 Bf 109 K-4
 * 正是如此）。固定刻度下每一條的長度都有絕對意義，而轟炸機的迴旋與滾轉本來
 * 就該是短的。
 *
 * 【定值從量測來】九台的實測落在 405…711 km/h、4.5…24.5 m/s、7.8…19.1 °/s、
 * 21.6…89.3 °/s。刻度取在最大值之上一點，滿格因此是「還有這台沒到的餘地」。
 */
const SPEED_SCALE = 800
const CLIMB_SCALE = 25
const TURN_SCALE = 20
const ROLL_SCALE = 100

const DEG_PER_RAD = 180 / Math.PI

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)

/**
 * 九台的背景。**每一台都要有** —— `dossier.test.ts` 把 `ALL_SPECS` 掃一遍。
 *
 * 【為什麼不寫產量】同一個機型的產量按「該型號」還是「全系列」算差好幾倍
 * （P-51D 與 P-51 全系列就是），而一個沒有出處的數字擺在史實旁邊會被當成
 * 史實。負責人 2026-09-11 決定只放背景。
 */
const STORY: Record<string, string> = {
  p51d:
    '為英國訂單設計的機體，換上英國的梅林引擎之後才脫胎換骨。掛上副油箱，它能一路'
    + '陪著轟炸機飛到柏林再打回來 —— 德國空軍的日間攔截從此沒有安全的空域。',
  bf109k4:
    '109 家族的最後一種量產型，把 DB 605D 連同加力噴注壓到極限，爬升與高速仍是一流。'
    + '它的問題不在飛機：出場時是 1944 年末，燃料短缺，新飛行員的訓練時數只剩幾十小時。',
  f6f5:
    '格魯曼照著開戰頭一年的教訓設計：更大的引擎、更厚的裝甲、更好的前下方視野，'
    + '把零戰擅長的低速纏鬥換成能量與耐打的較量。它撐起了美國海軍後半場的制空。',
  f4f4:
    '開戰時美國海軍唯一拿得出手的艦載戰鬥機。速度與爬升都輸零戰，靠自封油箱、'
    + '裝甲與兩機互相掩護的戰術硬撐過 1942 年。可摺疊的主翼讓一艘航艦多帶好幾架。',
  ki84:
    '日本陸軍在戰爭末期最強的戰鬥機，速度、火力與防護終於同時追上對手。'
    + '真正拖垮它的是後期品質不穩的發動機與拿不到的高辛烷值燃料。',
  a6m5:
    '以極輕的結構換來無人能及的迴旋與航程，代價是沒有裝甲也沒有自封油箱。'
    + '五二型加厚了蒙皮、換上單排推力式排氣管，但這個設計的餘地已經用完了。',
  b17g:
    '密集的箱型編隊加上十三挺白朗寧，來自一個信念：轟炸機自己就能殺出一條路去。'
    + '機首下方那座下巴砲塔，正是被德國戰鬥機的迎頭攻擊逼出來的。',
  he111:
    '1930 年代以「高速郵政機」的名義發展出來的設計。不列顛之役證明它在有戰鬥機'
    + '攔截的白天撐不住，此後轉去夜襲、運輸與掛飛彈。整片玻璃的機首是它最好認的輪廓。',
  g4m:
    '為了飛得夠遠，防護被犧牲得徹底 —— 主翼是沒有防護的整體式油箱，盟軍飛行員'
    + '因此叫它打火機。它確實從陸上基地打出了遠得離譜的攻擊半徑，也確實賠上了機組。',
}

/** 千分位。長度單位不加（翼展只有兩位數），重量與升限要 */
const grouped = (v: number): string => Math.round(v).toLocaleString('en-US')

/**
 * 固定武裝那一列。同型的併成一列，例如「6 × M2 Browning .50 cal」。
 *
 * 【轟炸機走另一條】三台轟炸機的 `battery.mounts` 是空的 —— 它們的槍全在
 * 自衛砲塔上（`spec.turrets`）。印空字串的話那一列會讀成「這台沒有武裝」。
 */
function armamentOf(spec: AircraftSpec): string {
  const counts = new Map<string, number>()
  for (const m of spec.battery.mounts) {
    counts.set(m.weapon.name, (counts.get(m.weapon.name) ?? 0) + 1)
  }
  const fixed = [...counts].map(([name, n]) => `${n} × ${name}`).join('、')
  if (spec.turrets.length === 0) return fixed
  const turret = `自衛砲塔 ${spec.turrets.length} 座`
  return fixed === '' ? turret : `${fixed}；${turret}`
}

/** 掛彈那一列。掛不了東西的機種回 `null`，呼叫端就不畫那一列 */
function loadoutOf(spec: AircraftSpec): string | null {
  const load = LOADOUT_BY_AIRCRAFT[spec.id]
  if (load === undefined) return null
  const word = load.kind === 'torpedo' ? '魚雷' : '炸彈'
  return `${word} × ${load.count}`
}

/**
 * 四條數值條。
 *
 * 【極速為什麼用史實值而不是模型算出來的】編組頁印的極速走
 * `topSpeedKmh`（史實參考值）。同一台飛機在兩個畫面印兩個數字，玩家會
 * 認為其中一個是錯的。爬升與升限同理。
 *
 * 【迴旋與滾轉為什麼反過來，用模型算】史實參考表沒有這兩項 —— 而且這兩項
 * 正是玩家操縱時真正感覺得到的東西，從飛行模型算出來的才與手感相符。
 *
 * 【成本】`bestSustainedTurnRateCached` 第一次呼叫要填一張高度表（實測
 * 37…63 ms），之後查表 60 ns。所以只算玩家選中的那一台，不要開場把九台
 * 全算完。
 */
function barsOf(spec: AircraftSpec): readonly Bar[] {
  const h = HISTORICAL[spec.id]
  const climb = h === undefined ? 0 : h.climbRateSeaLevel
  const speed = topSpeedKmh(spec.id)
  const turn = bestSustainedTurnRateCached(spec, BAR_ALTITUDE) * DEG_PER_RAD
  const roll = maxRollRate(spec, BAR_ALTITUDE, BAR_ROLL_SPEED) * DEG_PER_RAD
  return [
    { label: '極速', text: `${speed} km/h`, fill: clamp01(speed / SPEED_SCALE) },
    { label: '爬升', text: `${climb.toFixed(1)} m/s`, fill: clamp01(climb / CLIMB_SCALE) },
    { label: '迴旋', text: `${turn.toFixed(1)} °/s`, fill: clamp01(turn / TURN_SCALE) },
    { label: '滾轉', text: `${roll.toFixed(0)} °/s`, fill: clamp01(roll / ROLL_SCALE) },
  ]
}

/** 機種 → 檔案。故事缺一台就印空字串，其餘照樣畫得出來 */
export function dossierOf(spec: AircraftSpec): Dossier {
  const h = HISTORICAL[spec.id]
  const facts: Fact[] = [
    { label: '翼展', value: `${spec.wing.span.toFixed(1)} m` },
    { label: '全備重量', value: `${grouped(spec.mass)} kg` },
    { label: '升限', value: h === undefined ? '—' : `${grouped(h.serviceCeiling)} m` },
    { label: '武裝', value: armamentOf(spec) },
  ]
  const load = loadoutOf(spec)
  if (load !== null) facts.push({ label: '掛載', value: load })

  return {
    name: spec.name,
    side: SIDE_OF[spec.id] ?? 'allies',
    role: spec.role,
    story: STORY[spec.id] ?? '',
    bars: barsOf(spec),
    facts,
  }
}
