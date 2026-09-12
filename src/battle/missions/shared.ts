import { Vector3 } from 'three'
import { FLAK_SITES, PLANT_TARGETS } from '../../world/leuna'
import {
  DUMPS, HEAVY_FLAK_SITES, LIGHT_FLAK_SITES, PARKED_ROWS, SEARCHLIGHT_SITES,
} from '../../world/poltava'
import type { GroundEntry, MissionFleet } from './types'

/**
 * # 幾張卡共用的編成與常數
 *
 * **只放被一張以上的卡用到的東西。** 只有一張卡在用的數字寫在那張卡旁邊
 * —— 搬到這裡只會讓讀卡片的人多跳一個檔案。
 */

/**
 * 護送與攔截的終點在多遠，m。
 *
 * 【為什麼護送與攔截共用】它們是同一個局面的兩側：一隊轟炸機要飛到一個點，
 * 另一隊要在那之前把它們打光。距離對兩邊同時成立。
 */
const CONVOY_DISTANCE = 12000

/**
 * 抵達半徑，m。**沿用撤離掃描出來的 1,000**。
 *
 * 【它同時是編隊寬度的上界】整隊只有一個判定圈，所以最外側那一架也必須
 * 落得進來。`order.ts` 的 `CONVOY_LANE` 就是照這個數字訂的。
 */
export const CONVOY_RADIUS = 1000

/**
 * 被護送的那幾架在敵方目標挑選裡值幾倍。**起始值，試飛中。**
 *
 * 【為什麼一定要大於 1】不加偏置時護航機只要有兩架，轟炸機就**一發都挨不
 * 到**（實測血量 100/100/100/100）—— `targetScore` 只看威脅與幾何，而護航機
 * 兩者都更強：它會還手、而且擺得更高更近。
 *
 * 【為什麼一個數字管兩張卡】它掛在被護送的那幾架身上，只有敵人替它們評分。
 * 護送時是紅隊更想打我方轟炸機，攔截時是藍隊更想打敵方轟炸機 —— **同一個
 * 偏置，兩側同時動**，所以不能只照著一張卡調。
 */
const CONVOY_PRIORITY = 5

/**
 * 護送與攔截共用的幾何。差別只有目標列的文字與雙方飛什麼。
 *
 * 【對頭】護送要打穿出去，攔截則是迎向轟炸機流 —— 同一個擺法對兩邊都成立，
 * 因為它們本來就是同一個局面的兩側。
 *
 * 【無時限】兩組勝負條件裡都沒有時間 —— 護送敗北只有「全部被擊落」，
 * 攔截敗北只有「任一台抵達」。
 */
export const CONVOY = {
  convoyCount: 4, convoyPriority: CONVOY_PRIORITY,
  targetDistance: CONVOY_DISTANCE, targetRadius: CONVOY_RADIUS,
  seconds: Infinity,
  entry: 'headOn',
} as const

/** 殲滅：沒有終點也沒有時限，贏的條件就是敵方歸零。 */
export const KILL = {
  objective: '擊落全部敵機',
  convoySpec: null, convoyCount: 0, convoyPriority: 1,
  targetDistance: 0, targetRadius: 0, seconds: Infinity,
  entry: 'headOn',
} as const

/**
 * 倫內爾島的第 18 特遣艦隊 —— **史實編成的三分之二**。
 *
 * ## 史實
 *
 * 1943 年 1 月 29–30 日，Giffen 少將的 TF 18 接戰時是 **12 艘**：
 * 三艘重巡（Wichita、Chicago、Louisville）、三艘輕巡（Montpelier、
 * Cleveland、Columbia）排成兩列縱隊，六艘驅逐艦在前方張開半圓形警戒幕。
 * 兩艘護航航母（Chenango、Suwannee）跟不上 24 節，**開打前就被留在後面**
 * —— 那也是為什麼那一夜沒有空中掩護。
 *
 * 攻擊方是第 705 與 701 航空隊的一式陸攻，黃昏兩波約 31 架。Chicago 中兩枚
 * 魚雷，隔天被第二批雷擊擊沉。
 *
 * ## 為什麼放 8 艘而不是 12
 *
 * 巡洋與驅逐各四艘，維持史實的一比一。**只有兩個艦級模型**，12 艘會讓
 * 重複太明顯；8 艘已經讀得出是一支艦隊，而四艘散在 3 km 上遠看只是四個
 * 分開的點。
 *
 * ## 陣型
 *
 * 巡洋艦兩列縱隊（橫向相距 500 m、縱向 600 m），驅逐艦在前方張成警戒幕
 * （最外側 ±900 m，前方 900–1,100 m）。整隊橫跨 1.8 km、縱深 1.4 km。
 *
 * 美軍 1943–45 年的防空警戒序列：縱隊裡的主力艦彼此 450–900 m，護衛幕在
 * 距核心 1,400–2,700 m，**遭空襲時會刻意收緊到 1,400–1,800 m 讓火網重疊**
 * —— 收緊正是那個序列的目的。這個擺法落在那個區間的緊端。
 *
 * 航速 8 m/s ≈ 15.5 節，**起始值** —— 真艦的戰鬥航速更高，但這一關的重點
 * 是彈幕不是追擊，船跑太快會讓低空進場的相對幾何每次都不一樣，調不準。
 */
/**
 * 沖繩外海的第 58 特遣支隊 —— **史實編成的三分之一，而且只有三個艦級。**
 *
 * ## 史實
 *
 * 1945 年 4 月，Mitscher 中將的 TF 58 分成四個特遣支隊。單一支隊典型是
 * 艦隊航母 2–3、輕航母 1–2、快速戰艦 2–3、巡洋艦 3–5、驅逐艦 13–18，
 * 合計 22–28 艘。環形防空序列：航母在中心（彼此 2,300–2,750 m）、戰艦與
 * 巡洋艦內環、驅逐艦外環（半徑 3,600–5,500 m）。
 *
 * ## 為什麼航母只有一艘
 *
 * 專案只有三個艦級模型（Essex／Wichita／Fletcher），沒有戰艦、沒有輕航母。
 * 兩艘 Essex 並排會讓重複很明顯（同 `RENNELL_FLEET` 的「12 艘取 8 艘」），
 * 而且**「守兩艘」會讓失敗判定變模糊**。一艘航母＝一個要守的東西。
 *
 * 六艘驅逐艦不是佈景 —— 每一艘都有完整的三層防空（`world/shipAA.ts`），
 * 是玩家真正的火力支援。
 *
 * ## 為什麼中心在原點
 *
 * 雙方 `headOn` 進場都收斂到中點，所以艦隊放原點時**空戰自然發生在艦隊
 * 上空** —— 艦載防空因此真的參戰，而不是遠遠看著。
 *
 * 陣型尺度沿用 `RENNELL_FLEET`（整隊橫跨約 1.8 km）。**起始值，由試飛裁定。**
 */
export const TF58_GROUP: MissionFleet = {
  center: new Vector3(0, 0, 0),
  heading: 0,
  speed: 8,
  ships: [
    // 【航母在中心，而且是唯一的要害艦】沉了就輸
    { cls: 'essex', team: 'blue', offset: new Vector3(0, 0, 0), vital: true },
    // 巡洋艦：內環，左右各一
    { cls: 'wichita', team: 'blue', offset: new Vector3(-500, 0, 200) },
    { cls: 'wichita', team: 'blue', offset: new Vector3(500, 0, 200) },
    // 驅逐艦：外環警戒幕。前方張得比後方開 —— 敵機從 −Z 來
    { cls: 'fletcher', team: 'blue', offset: new Vector3(-900, 0, -900) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(-300, 0, -1100) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(300, 0, -1100) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(900, 0, -900) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(-800, 0, 800) },
    { cls: 'fletcher', team: 'blue', offset: new Vector3(800, 0, 800) },
  ],
}

export const RENNELL_FLEET: MissionFleet = {
  center: new Vector3(0, 0, 0),
  heading: 0,
  speed: 8,
  ships: [
    // 巡洋艦：兩列縱隊。−Z 是艦首方向，所以 z 小的是前導艦。
    { cls: 'wichita', team: 'red', offset: new Vector3(-250, 0, -300) },
    { cls: 'wichita', team: 'red', offset: new Vector3(-250, 0, 300) },
    { cls: 'wichita', team: 'red', offset: new Vector3(250, 0, -300) },
    { cls: 'wichita', team: 'red', offset: new Vector3(250, 0, 300) },
    // 驅逐艦：前方的半圓形警戒幕
    { cls: 'fletcher', team: 'red', offset: new Vector3(-900, 0, -900) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(-300, 0, -1100) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(300, 0, -1100) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(900, 0, -900) },
  ],
}

/** 德 M4 撤退段的終點在多遠，m */
export const RETREAT_DISTANCE = 12000

/**
 * 三條戰役各四關。
 *
 * ── 為什麼還有四張是 `battle: null` ──────────────────────
 *
 * 它們要的地面目標（工廠、車站、火車、登陸艇）與陸上 Flak 的邏輯還沒有。
 * **編制與機種現在不填** —— 填進一張還打不起來的卡，只會變成一組沒有人
 * 驗證過、卻看起來已經定案的數字。那幾關要用什麼寫在 `docs/roadmap.md`
 * 的對照表裡。
 *
 * ── 八張可玩的來歷 ──────────────────────────────────────
 *
 * ```
 *   盟 M1 / 德 M1   唯二有實測基礎的（掃描定值），由
 *                   `mission-config-baseline.test.ts` 逐項釘住
 *   日 M1 / 日 M3   編制照掃描過的那兩種形狀（8v6 殲滅、護送）
 *   德 M4           返航節拍的第一個使用者
 *   盟 M4 / 日 M4   艦隊：守住與擊沉
 *   盟 M2           地面目標：炸毀（`world/leuna.ts` 的廠區）
 * ```
 */
/**
 * 洛伊納的廠區與預定砲位，世界座標。佈局在 `world/leuna.ts`，這裡只把相對
 * 偏移換成絕對座標。砲位是不還手的靶（`groundTargets.ts` 檔頭）。
 */
export const LEUNA_GROUND: readonly GroundEntry[] = [
  ...PLANT_TARGETS.map((p): GroundEntry => ({
    unit: p.kind, team: 'red', x: p.x, z: p.z, heading: p.heading,
  })),
  ...FLAK_SITES.map((s): GroundEntry => ({
    unit: 'flakHeavy', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
]

/**
 * 波爾塔瓦機場：24 架停放的 B-17、油桶堆兩塊、彈藥堆一塊、輕砲 16、重砲 6、
 * 探照燈 6。全部是紅方的地面目標，全部算進炸毀的池。佈局在 `world/poltava.ts`。
 */
export const POLTAVA_GROUND: readonly GroundEntry[] = [
  ...PARKED_ROWS.map((p): GroundEntry => ({
    unit: 'parkedB17', team: 'red', x: p.x, z: p.z, heading: p.heading,
  })),
  ...DUMPS.map((d): GroundEntry => ({
    unit: d.kind, team: 'red', x: d.x, z: d.z, heading: d.heading,
  })),
  ...LIGHT_FLAK_SITES.map((s): GroundEntry => ({
    unit: 'flakLight', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
  ...HEAVY_FLAK_SITES.map((s): GroundEntry => ({
    unit: 'flakHeavy', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
  ...SEARCHLIGHT_SITES.map((s): GroundEntry => ({
    unit: 'searchlight', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
]
