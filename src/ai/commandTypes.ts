import type { Vector3 } from 'three'

/**
 * 規劃需要知道的每架資訊。
 *
 * 【為什麼另外定義而不是收 `Combatant` 或 `Aircraft`】規劃不需要知道世界是
 * 怎麼組裝的（射速時鐘、包圍球、出生點都與「這個小隊該不該撤」無關），而且
 * 收最小介面才能在單元測試裡用字面物件出考題 —— 那是 spec §7.1 那一層
 * 存在的前提。與 `flights.ts` 的 `FlightMember`、`target.ts` 的
 * `TargetCandidate` 是同一個手法。
 *
 * `position` / `velocity` 是 `readonly` 的**參考**（內容仍可 `copy` 進去），
 * `cornerRatio` / `hpFraction` / `shotInstant` / `alive` 每步會被呼叫端改寫。
 */
export interface CommandUnit {
  readonly position: Vector3
  readonly velocity: Vector3
  /** TAS ÷ 角落速度。與 `Situation.cornerRatio` 同義 */
  cornerRatio: number
  /** 升限，m。集合點的高度上界 */
  readonly serviceCeiling: number
  /**
   * 剩餘血量佔滿血的比例，0..1（1 = 毫髮無傷）。集火挑目標用。
   *
   * 【為什麼是比例而不是絕對值】兩個機種的滿血不同，絕對值跨機種比不了。
   */
  hpFraction: number
  /**
   * 上一格的射擊解強度，0 = 沒有解。**排名用**（spec §4）。
   *
   * 【為什麼是這個量而不是「誰最有機會」】排名問的是「叫誰去，損失最小」。
   * 純幾何量不到那件事 —— 「離最近的敵分隊多近」對正在得手的和正在挨打的
   * 分隊是同一個數字。第二份 §12 量到側翼失敗的機制正是「一支已經咬住人的
   * 分隊放棄了現有位置」。
   *
   * 【資料是現成的】`AiController.shotInstant` 已經存在，它的註解寫的就是
   * 「只為量測存在」。`setup.ts` 每步抄過來，與 `cornerRatio`、`hpFraction`
   * 同一手。
   */
  shotInstant: number
  alive: boolean
}

/**
 * 命令的種類。**互斥的聯集，不是一組旗標**：`flank` 與 `focus` 由距離分開
 * （spec §3.2），永遠不會同時成立，所以命令不需要組合。
 */
export type OrderKind = 'rally' | 'flank' | 'focus'

/**
 * 一張下給小隊的命令。
 *
 * 【`rally` 的集合點凍結，`flank` 的每步重算】兩者的差別來自實測：敵**隊**
 * 質心 30 秒只飄 720 m（20 架纏鬥互相抵銷），但敵**分隊**質心飄 2040~4663 m
 * —— 抵銷效應只在架數多時成立，四架的分隊就是一團一起動的東西。
 *
 * 撤退的點是**遠離**敵人的，過期不太傷（第一份 spec §4.1 明寫接受這個代價）；
 * 側翼的點貼著敵分隊定義，凍結會在飛到一半就失效。所以側翼**凍結的是決定**
 * （`side` 與 `targetFlight`）**而不是座標**，到達改用幾何判定（spec §4.2）。
 */
export interface FlightOrder {
  readonly kind: OrderKind
  /**
   * 飛行點。`rally` 發令後不再變；`flank` **由 `stepCommand` 每步重寫**；
   * `focus` 不使用（恆為原點）。
   *
   * 【只有這一個欄位不是 readonly，而且只有 `flank` 會動它】
   */
  point: Vector3
  /** 到達判定半徑，m。只有 `rally` 使用 */
  readonly radius: number
  /** `flank`：切哪一個敵分隊。**全域**分隊索引。其餘為 −1 */
  readonly targetFlight: number
  /** `flank`：從哪一邊切。+1 = 敵航向的右舷，−1 = 左舷。其餘為 0 */
  readonly side: number
  /** `focus`：打哪一架。`units` 的**全域**索引。其餘為 −1 */
  readonly focusIndex: number
}

/**
 * 規劃需要知道的分隊結構。
 *
 * 【為什麼不直接收 `FlightIndex`】現行的相依方向是 `battle → ai`：
 * `setup.ts` import `AiController`、`target.ts`、`station.ts`，而 `src/ai/`
 * **從來不 import `src/battle/`**。收 `FlightIndex` 會把箭頭反過來。
 *
 * `battle/flights.ts` 的 `Flight` 在結構上滿足這個介面，呼叫端直接傳過來
 * 就成立，不需要轉接層。與 `flights.ts` 自己定義 `FlightMember`（而不是收
 * `World.Combatant`）是同一個手法。
 */
export interface CommandFlight {
  /** 存活成員在 `units` 裡的索引。只有前 `count` 格有效 */
  readonly members: Int32Array
  readonly count: number
}

/** 指揮官對一支隊伍的狀態。每個分隊一格 */
export interface CommandState {
  /** `orders[f]` = 第 f 個分隊的命令；`null` = 自由交戰 */
  orders: (FlightOrder | null)[]
  /** 每個分隊「最低那一架連續低於門檻」累積的秒數 */
  spent: Float32Array
  /**
   * 每個分隊「連續多久沒有任何成員握著射擊解」累積的秒數。
   *
   * 【與 `spent` 分開】兩個計時器問的是不同的事：`spent` 問「還打得動嗎」
   * （能量），`idle` 問「正在得手嗎」（戰果）。一支能量充足但完全沒有射擊
   * 機會的分隊，兩個量會給出相反的答案 —— 而那正是最該被調去集火的分隊。
   */
  idle: Float32Array
  /** 距離下次規劃還有多久，s */
  timer: number
}
