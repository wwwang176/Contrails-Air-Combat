import { Vector3 } from 'three'
import type { Team } from '../world/World'
import type { AircraftSpec } from '../specs/types'
import type { GroundUnitId } from '../render/geometry/ground'

/**
 * 一場戰鬥的結果。`victory` = 任務達成，`defeat` = 任務失敗。
 *
 * 【為什麼住在這裡而不是 `setup.ts`】它現在是**任務判定的產物**。留在
 * `setup.ts` 的話 `mission.ts` 要 import `setup.ts`，而 `setup.ts` 又要
 * import `mission.ts` —— 一個沒有必要的循環。`setup.ts` 再匯出這個型別，
 * 既有的 import 站點全部不用動。
 */
export type Outcome = 'fighting' | 'victory' | 'defeat'

/**
 * 這一關怎麼算贏。
 *
 * 【為什麼是可辨識聯集而不是一個函數】關卡是**資料**（`battle/missions.ts`
 * 是一張表）。函數會把「怎麼打」藏進閉包裡，而閉包不能比較、不能序列化、
 * 也不能在測試裡直接組一個出來。
 */
export type MissionRules =
  | { kind: 'annihilate' }
  | {
    kind: 'evacuate'
    /** 撤離點的世界座標 */
    point: Vector3
    /** 抵達半徑，m。**也就是圓環的半徑** —— 看到的圈就是判定範圍 */
    radius: number
    /** 時限，秒。無時限給 `Infinity` */
    seconds: number
  }
  | {
    kind: 'convoy'
    /**
     * 被護送的那些飛機屬於哪一隊。**護送與攔截的唯一差別就是這個欄位。**
     *
     * ```
     *   'blue'  護送 —— 我方的轟炸機，飛到就贏、全滅就輸
     *   'red'   攔截 —— 敵方的轟炸機，飛到就輸、全滅就贏
     * ```
     *
     * 【為什麼是一條規則而不是兩種 kind】兩組條件是對稱的：「護送勝＝我方
     * 轟炸機任一台到達終點」「攔截勝＝敵方轟炸機被殲滅（護航的戰鬥機
     * 忽略）」。攤開來就是同一句話 ——
     * **某一隊的轟炸機：抵達終點，那一隊贏；全部被擊落，那一隊輸。**
     * 寫成兩個分支的話，兩邊的判定順序、邊界、NaN 處理會各自漂移。
     */
    owner: Team
    /**
     * 終點的世界座標。**判定與畫面上的圓環都用這一個點。**
     *
     * 【它不是每一架各自的飛行點】那幾架各自飛一條平行線（見
     * `setup.ts` 的 `convoyPoints`），但**判定只有一個圈**。整隊的寬度由
     * `order.ts` 的 `CONVOY_LANE` 壓在半徑之內，所以「平行飛」與「一個圈」
     * 不衝突。
     */
    point: Vector3
    /** 抵達半徑，m。**也就是圓環的半徑** */
    radius: number
    /**
     * 要**幾架**抵達，那一隊才算達成。**省略 = 1，也就是任一架抵達就定案。**
     *
     * 【為什麼不是「剩幾架」】它數的是**累計進過圈的架數**，不是當下還活著
     * 的。兩者在整隊一起到的時候很接近，但「進過圈又飛出去」只有前者說得對
     * ——而那正是抵達之後會發生的事（`setup.ts` 不讓抵達的那幾架退場，它們
     * 會繼續往前飛）。
     *
     * 【它同時給出一個新的敗北條件】`convoyAlive + convoyArrived < need` 時
     * 已經湊不到門檻了，當場判定。少了那一條，16 架剩 7 架的玩家還要再飛
     * 兩分鐘才知道自己輸了。
     */
    need?: number
  }
  | {
    /**
     * 擊落 `count` 架敵機。**累計，不是把場上打空。**
     *
     * 【為什麼不是 `annihilate`】有重生的關「場上歸零」永遠不會發生，而德軍
     * 攔截隊真正的作戰目標本來就是「把損失率推到讓對方停飛」，不是攔下特定
     * 的某一批。沒有判定圈、沒有抵達。
     *
     * 【`role` 是必要的，不是裝飾】德 M1 的目標是**轟炸機**，而場上同時有
     * 護航的戰鬥機。少了這一格，玩家打護航機也能過關 —— 那一關的內容就整個
     * 變了，而畫面上一切正常。
     */
    kind: 'hunt'
    count: number
    /** 只算這個角色的擊落。省略 = 全部 */
    role?: AircraftSpec['role']
  }
  | {
    /**
     * 擊沉任意 `count` 艘敵艦。
     *
     * 【為什麼是「任意幾艘」而不是指名】指名的話玩家要先認出哪一艘是目標，
     * 而八艘裡有四艘長得一樣（只有兩個艦級模型）。「任意三艘」讓玩家自己
     * 挑最好打的那幾艘 —— 那本來就是雷擊機該做的決定。
     *
     * 【本期玩家打不完】一式陸攻的固定掛架是空的，魚雷在另一支分支上。
     * 規則先接好，武器進來就成立 —— 見 spec §10.3。
     */
    kind: 'sink'
    count: number
    /**
     * 這一關有護衛編制：藍隊的戰鬥機是護衛，轟炸機是攻擊隊。**護衛全滅就判敗**，
     * 即使攻擊隊還活著、船還沒沉夠。省略 = 只有藍隊全滅才敗。
     *
     * 藍隊全是轟炸機的關（日 M3）戰鬥機數恆為 0，帶了這一格就會開場判敗 ——
     * 只有卡片有攻擊隊時 `missionRules` 才加上它。
     */
    escorts?: true
  }
  | {
    /**
     * 炸毀任意 `count` 座敵方地面目標（`world/groundTargets.ts`）。
     *
     * 與 `sink` 同一個形狀：任意幾座、不指名、藍隊全滅才敗。判準是卡片上
     * 有沒有 `destroyCount`（`missions.ts` 的 `missionRules`）。
     */
    kind: 'destroy'
    count: number
    /**
     * 只算這一種地面單位。**省略 = 敵方地面目標全部都算。** 過濾在
     * `setup.ts` 的 `inDestroyPool`，這一支只讀已經數好的 `targetsDestroyed`。
     */
    unit?: GroundUnitId
  }
  | {
    /**
     * 守住我方艦隊。**勝負都寫在這一條裡。**
     *
     * ```
     *   負  任何一艘要害艦被擊沉（**排在勝之前**，見下）
     *   勝  紅方飛機全滅，而且沒有敵機正在進場的路上
     *   負  藍方飛機全滅
     * ```
     *
     * 【要害艦排在勝利之前，刻意不沿用「victory 先於 defeat」】那條慣例的
     * 理由是 `evacuate` 的「飛進圓環那一步剛好時限歸零，判贏才符合玩家的
     * 認知」—— 那是**同一個目標在邊界達成**。這裡不是：最後一架敵機與航母
     * 同一步沉，而這一關的整句話就是「航母被擊沉就輸」。判成勝利的話，
     * 結算畫面會在一艘沉到海底的航母上寫「任務成功」。
     *
     * 【沒有「哪一艘」這個欄位】要害艦由 `MissionFleet` 的條目上的 `vital`
     * 指名 —— 誰要緊與艦名單住在同一個地方。把艦級寫進規則的話，換一艘船
     * 當主角就要改規則。
     *
     * 【沒有要害艦時自然退化成 `annihilate`】`vitalSunk` 恆為 0，第一條分支
     * 就不成立。**不另寫 fallback** —— 那是死碼：拿掉它行為完全相同。
     */
    kind: 'defend'
  }

/**
 * 這一關自己的小旋鈕。**每一項都是一個獨立的數字，預設值等於「沒有這一關」。**
 *
 * ── 為什麼要有這一層 ──────────────────────────────────────
 *
 * 攔截與護送需要「讓轟炸機被選到的機會變高」，而那是一個**逐關**的旋鈕。
 *
 * 關卡要調的東西與 **AI 的通則**是兩回事。`TargetConfig`、`SteerConfig`、
 * `CommandConfig` 那幾組是「一架飛機該怎麼打」，它們的每一個值都由掃描
 * 定案、被一整排既有護欄釘住 —— 為了一張關卡去動它們，等於讓遭遇戰的
 * 基準跟著關卡走。這一層則是「**這一場**有什麼特別的」。
 *
 * ── 加新旋鈕的規矩 ────────────────────────────────────────
 *
 * 1. **預設值必須是「行為與沒有它時逐字相同」。** 遭遇戰與殲滅任務吃的是
 *    `DEFAULT_BATTLE.tuning`，那一份的每一項都是中性值。
 * 2. **一項只調一件事。** 這裡不放組合開關 —— 那會變成第二套難度系統，
 *    而難度一貫由編制與幾何給（見 `setup.ts` 的 `aiProfile`）。
 * 3. **值住在卡片上**（`MissionCard`），這裡只是它流到 `BattleConfig` 的
 *    型別。每一張卡因此可以不一樣。
 */
export interface MissionTuning {
  /**
   * 被護送／被攔截的那幾架（`duty === 'transit'`）在**敵方**目標挑選裡
   * 值幾倍。**1 = 與一般敵機同分**，也就是關掉這條規則。
   *
   * 【它要解決什麼】護航機把攔截方的目標全部吸走 —— 實測 4 架 P-51 對上
   * 「2 或 4 架護航機 + 4 架轟炸機」，轟炸機**一發都不會挨到**
   * （`docs/backlog.md` §2.26）。
   *
   * 【為什麼一個數字同時管護送與攔截】它掛在**被護送的那幾架身上**，而
   * 只有敵人會替它們評分。護送時是紅隊更想打我方轟炸機（那正是這一關
   * 要防的事），攔截時是藍隊更想打敵方轟炸機。**同一個偏置，兩張卡。**
   *
   * 【起始值，待掃描】見 `missions.ts` 的 `CONVOY_PRIORITY`。
   */
  convoyPriority: number
  /**
   * 戰鬥機要優先掃射的地面單位。**省略 = 不覆寫空戰優先序。**
   *
   * 這不是另一套 AI：卡片只負責說明任務目標，實際掃射、立即自衛與防墜仍走
   * `AiController` 的共用行為。用單位 id 而不是關卡 id，核心層因此不知道自己
   * 正在哪一關。
   */
  readonly priorityGroundUnit?: GroundUnitId
}

/** 中性值：每一項都等於「沒有這一關」。遭遇戰與殲滅任務用它 */
export const NEUTRAL_TUNING: MissionTuning = { convoyPriority: 1 }

/**
 * `stepMission` 讀的快照。**就地重填，不配置。**
 *
 * 【為什麼不直接吃 `Battle`】與 `CommandUnit`（`ai/command.ts`）、
 * `SteerConfig` 同一套手法：吃快照才能單元測試而不用建一個世界出來。
 */
export interface MissionInputs {
  aliveBlue: number
  /**
   * 藍隊還活著的戰鬥機（`role !== 'bomber'`）。`sink` 的 `escorts` 讀它。
   *
   * 【依機體角色而不是 duty】攻擊隊與護衛的 duty 都是 `combat`，分得開它們的
   * 只有機種：攻擊隊恆是 `convoySpec` 的轟炸機。
   */
  aliveBlueFighters: number
  aliveRed: number
  /** 玩家目前那一架的位置 */
  playerPos: Vector3
  /**
   * 玩家那一架還活著嗎。
   *
   * 【為什麼一定要有】接手有 2 秒延遲（`battle/takeover.ts` 的
   * `TAKEOVER_DELAY`），那段期間 `Battle.player` 仍然指著**已經退場的那一
   * 架**，位置停在墜落點。少了這個旗標，「玩家死在圓環裡、僚機還活著」會
   * 判成撤離成功。
   */
  playerAlive: boolean
  /**
   * 編組表上 `duty === 'transit'` 的那些飛機**還活著、而且還沒抵達的有幾架**。
   *
   * 【為什麼抵達的不算在裡面】它與 `convoyArrived` 加起來要等於「還有機會
   * 湊到門檻的架數」。抵達的若兩邊都算，那個和就會超過實際架數，而敗北條件
   * （湊不到 `need`）就永遠不成立。
   *
   * 【為什麼是 duty 而不是 `spec.role === 'bomber'`】遭遇戰選 B-17 時整隊
   * 都是轟炸機，那時這一關的規則是殲滅、根本不讀這個欄位；但用 role 推導
   * 的話，哪天有人在護送任務裡放一架轟炸機當護航（真機也這樣用過），
   * 它就會被算進「要保護的目標」。**duty 說的是任務角色，role 說的是機體。**
   */
  convoyAlive: number
  /**
   * 那幾架**還活著、而且還沒抵達的**裡面，離終點最近的距離，m。
   * 一架都不剩時 `Infinity`。
   *
   * 【為什麼只算活著的】把死掉的算進來會讓「最後一架在圈裡被打下來」同時
   * 滿足抵達與全滅兩個條件 —— 那時判定的順序就決定勝負，而任何一種順序
   * 都說得出道理。只算活著的之後兩者**互斥**，順序不再影響結果。
   *
   * 【它只餵目標列，不參與判定】抵達與否由 `convoyArrived` 說了算。
   */
  convoyLead: number
  /**
   * 那幾架裡面**累計進過判定圈的有幾架**。只增不減。
   *
   * 【為什麼判定不能自己算】「進過圈」是**跨步累積的狀態**，而 `stepMission`
   * 是一個只看當步快照的純函數。讓它自己從距離推的話，同一架會被每一步重算
   * 一次 —— 一架在圈裡待三秒就會被當成七百多架抵達。
   *
   * 【半徑與 NaN 的防線因此搬到呼叫端】`setup.ts` 逐座位比 `< radius`，
   * `NaN < radius` 是 false，位置壞掉時不會誤判抵達。
   */
  convoyArrived: number
  /**
   * **紅方**累計被擊落的架數。只增不減，`hunt` 規則讀它。
   *
   * 【為什麼不是「開場架數減存活數」】有重生的關兩者不相等 —— 重生會把存活
   * 數補回去，而擊落是已經發生的事。用補數算的話，打掉一整隊再讓它重生，
   * 進度就退回去了。
   */
  redKilled: number
  /** 上面那些裡面，機體角色是轟炸機的有幾架。`hunt.role` 限定時要分得出來 */
  redKilledBombers: number
  /**
   * **敵方**已經被擊沉幾艘。
   *
   * 【為什麼只算敵方】友軍的船在 `allies-m4` 那種「守住艦隊」的關才有意義，
   * 而那是另一條規則。這一格只回答「我打沉幾艘了」。
   */
  shipsSunk: number
  /** 敵方一共有幾艘。全部沉了但目標更高時，這一關就打不完了 —— 見 `stepMission`。 */
  shipsTotal: number
  /**
   * 敵方的地面目標已經炸毀幾座、一共幾座。只算 `team !== 'blue'` 的，理由
   * 與船相同。`destroy` 以外的規則不讀它們。
   */
  targetsDestroyed: number
  targetsTotal: number
  /**
   * **我方**的要害艦已經沉了幾艘（`MissionFleet` 上標了 `vital` 的那些）。
   * `defend` 以外的規則不讀它。
   */
  vitalSunk: number
  /**
   * **我方**要害艦剩餘血量的比例，0～1；有幾艘取最低的那一艘。沒有要害艦
   * 恆為 1。`defend` 的目標列印它 —— 敵機整隊重生之後敵機數讀不出仗打到
   * 哪裡，玩家要盯的是航母還剩幾成。
   */
  vitalHp: number
  /**
   * 還有敵機正在進場的路上 —— **已經預警、還沒生出來**。
   *
   * 【為什麼勝利要看它】`stepBeats` 在觸發那一步先把節拍轉成 `warned`，
   * 飛機要等 `warnLead` 秒才生成（`setup.ts` 的 `dueAt`），而存活數只數場上
   * 活著的。那幾秒之內紅方歸零的話會**先判勝，第二波永遠不來** —— 那一關
   * 的下半場整段跳過，而畫面上一切正常。
   *
   * 【`setup.ts:1467` 的排序沒有涵蓋這一段】那條註解解決的是「最後一架第一
   * 波敵機被擊落的**同一步**就要能加第二波」；預警到生效之間那幾秒是另一
   * 件事。
   */
  redInbound: boolean
}

/**
 * 任務的狀態。**判定與顯示都在這裡**，由同一次 `stepMission` 寫出。
 *
 * 【為什麼判定與顯示不分開】分開的話 HUD 要自己再算一次進度，而兩份邏輯
 * 會漂移 —— 玩家看到「剩 12 架」卻突然贏了。合在一起就從結構上消掉這個
 * 風險（spec §4.3）。
 */
export interface MissionState {
  outcome: Outcome
  /** 撤離點。`hasTarget` 為 false 時無意義。**物件重用，不換參考** */
  readonly target: Vector3
  hasTarget: boolean
  /** 抵達半徑，m */
  targetRadius: number
  /** 剩餘秒數。無時限時是 `Infinity` */
  secondsLeft: number
  /**
   * HUD 的計量。殲滅＝剩餘敵機數，撤離與護送＝到終點的距離 m，擊沉＝還差幾艘，
   * 守住艦隊＝要害艦剩餘血量的比例 0～1
   */
  metric: number
  /** `metric` 怎麼印。由規則決定（`resetMissionState`），HUD 照抄 */
  metricKind: 'count' | 'distance' | 'percent'
  /**
   * `metric` 的分母。**−1 = 這一關沒有分母**，目標列就印裸數字。
   *
   * 【只有擊沉有】「還差 4 艘」單獨一個 4 讀不出進度；有分母才看得出
   * 打掉幾艘、總共要幾艘。距離與剩餘敵機數沒有一個固定的總量可以當分母。
   */
  metricTotal: number
  /**
   * HUD 的**第二個**計量：還剩幾架要護送／要打掉。**−1 = 這一關沒有這個
   * 數字**，目標列就不畫它。
   *
   * 【為什麼護送要兩個數字】它們回答的是兩個不同的問題：距離說「還要撐
   * 多久」，架數說「還剩多少籌碼」。
   * 護送的敗北條件是**全部被擊落**，那件事在距離上完全看不出來。
   *
   * 【為什麼是 −1 而不是 0】0 在護送的意思是「全滅了」，也就是輸。讓
   * 「這一關沒有這個數字」長得像敗北，與 `formatObjectiveMetric` 拒絕把
   * 壞掉的值印成 0 是同一條理由。
   */
  remaining: number
  /**
   * 護送已經送到幾架。**−1 = 這一關沒有門檻**（`need` 是 1 或不是護送），
   * 目標列就不畫它。
   *
   * 【為什麼門檻是 1 時也給 −1】那時「已抵達 1」與「贏了」是同一件事，印出來
   * 只會是一個恆為 0 的數字。有門檻才有進度可看。
   */
  arrived: number
}

/**
 * 分出勝負之後的時間流速。**0.05**，也就是二十分之一。
 *
 * 【為什麼不是 0】定格看起來像當掉 —— 那正是 M10 spec §8.1 的「暫停時
 * 所有模擬時間都不前進」要避免的觀感（一批定格的飛機浮在繼續起伏的
 * 海上）。但結算不是暫停：玩家沒有要回來繼續打，他在看戰果。慢動作讓
 * 最後那一下（被打爆的僚機、還在墜落的殘骸）演完，而不是硬生生卡住。
 */
export const FINISHED_TIME_SCALE = 0.05

/**
 * 這一幀的模擬時間要乘多少。**分出勝負之後切慢動作。**
 *
 * 【為什麼抽成一支函數住在這裡】它的呼叫端是 `main.ts` 的主迴圈，而那個
 * 檔案沒有任何測試（見 `test/e2e/` 幾支的檔頭）。抽出來之後這件事拆成
 * 兩半，兩半各自有護欄：
 *
 * ```
 *   一、分出勝負會改 dt      ← 這支函數，`test/unit/mission.test.ts`
 *   二、dt 會影響遊戲速度    ← `FixedStepAccumulator`，`test/unit/loop.test.ts`
 * ```
 *
 * 【為什麼是縮放而不是換步長】`loop.setStepHz` 會清掉 accumulator，而且會
 * 改變物理的積分步長 —— 那是**換一套動力學**，不是放慢播放。餵給
 * `loop.advance` 的時間變少，它自然就少跑幾個 240 Hz 的子步，每一步的
 * 內容一個字都沒變。
 *
 * 【呼叫端要連 `elapsed` 一起乘】海浪與地形讀的是那個累加值。只慢飛機的話
 * 畫面上是一批慢動作的飛機浮在照常起伏的海上（M10 spec §8.1 的同一條）。
 */
export function timeScale(outcome: Outcome): number {
  return outcome === 'fighting' ? 1 : FINISHED_TIME_SCALE
}

export function createMissionState(rules: MissionRules): MissionState {
  const s: MissionState = {
    outcome: 'fighting',
    target: new Vector3(),
    hasTarget: false,
    targetRadius: 0,
    secondsLeft: Infinity,
    metric: 0,
    metricKind: 'count',
    metricTotal: -1,
    remaining: -1,
    arrived: -1,
  }
  resetMissionState(rules, s)
  return s
}

/**
 * 回到開局。**「再打一場」與暫停選單的「重新開始」都要呼叫。**
 *
 * 【為什麼不是重新 `createMissionState`】`Battle.mission` 是 readonly 的
 * 參考，而 `main.ts` 與 HUD 每幀讀它。換掉物件會讓那些參考指向孤兒 ——
 * 與 `Aircraft.reset` 改成就地寫回是同一條教訓（見 `setup.ts` 的
 * `stepCommandLayer` 註解）。
 *
 * 【annihilate 分支一定要把目標清乾淨】撤離打完換遭遇戰時，殘留的
 * `hasTarget` 會讓圓環留在畫面上、小地圖上也留一個指向不存在座標的圈。
 */
export function resetMissionState(rules: MissionRules, out: MissionState): void {
  out.outcome = 'fighting'
  // 【只有數數量的那幾種會覆寫它】其餘在下面都不碰，所以一律先關掉分母
  out.metricTotal = -1
  // 【只有帶門檻的護送會覆寫它】同上，先關掉
  out.arrived = -1
  // 【計量怎麼印由規則決定】有終點的印距離、守住艦隊印要害艦的血量比例，
  // 其餘印架數
  out.metricKind = rules.kind === 'defend'
    ? 'percent'
    : rules.kind === 'convoy' || rules.kind === 'evacuate' ? 'distance' : 'count'
  if (rules.kind === 'convoy') {
    out.target.copy(rules.point)
    out.hasTarget = true
    out.targetRadius = rules.radius
    out.secondsLeft = Infinity
    // 【開局兩個計量都給「不知道」】這裡拿不到任何一架的位置與存活狀態，
    // 而第一個物理步就會覆蓋它們。`remaining` 特別不能給 0 —— 那個值的
    // 意思是「全滅」，也就是輸
    out.metric = 0
    out.remaining = -1
    // 【有門檻才給 0】0 在這一格的意思是「還沒送到任何一架」，那是開局的
    // 實話；沒有門檻時它不該出現在畫面上，所以維持 −1
    if ((rules.need ?? 1) > 1) out.arrived = 0
    return
  }
  out.remaining = -1
  if (rules.kind === 'evacuate') {
    out.target.copy(rules.point)
    out.hasTarget = true
    out.targetRadius = rules.radius
    out.secondsLeft = rules.seconds
    // 【開局的 metric 先給 0 而不是實際距離】這裡拿不到玩家位置，而第一個
    // 物理步就會覆蓋它。給一個假的距離反而會在第一幀閃一下錯的數字。
    out.metric = 0
    return
  }
  out.target.set(0, 0, 0)
  out.hasTarget = false
  out.targetRadius = 0
  out.secondsLeft = Infinity
  // 【數數量的那幾種，開局計量是「還差全部」】給 0 的話目標列會在第一幀
  // 閃一下「還差 0 艘」—— 那個數字的意思是達標了。
  const counted = rules.kind === 'sink' || rules.kind === 'destroy' || rules.kind === 'hunt'
  out.metric = counted ? rules.count : 0
  if (counted) out.metricTotal = rules.count
}

/**
 * `hunt` 這一關要數的是哪一格。
 *
 * 【為什麼戰鬥機是減出來的，不是自己一格】`role` 只有兩個值，開第三格等於
 * 多一個「總數 = 戰鬥機 + 轟炸機」的不變式，而那個不變式沒有任何東西在守。
 * 減出來就不可能對不起來。
 */
function killedOfRole(
  role: AircraftSpec['role'] | undefined, inp: MissionInputs,
): number {
  if (role === 'bomber') return inp.redKilledBombers
  if (role === 'fighter') return inp.redKilled - inp.redKilledBombers
  return inp.redKilled
}

/**
 * 推進一步：同時寫出判定與顯示。
 *
 * 【定案之後不再改任何欄位】一場只判一次 —— 與 `stepBattle` 現況的
 * `if (b.outcome !== 'fighting') return` 一致。少了這一條，結算畫面上的
 * 數字會在勝負已定之後繼續跳。
 *
 * 【victory 先於 defeat】同一步同時滿足時算贏：飛進圓環的那一步剛好時限
 * 歸零，判贏才符合玩家的認知。殲滅那一側的順序照的是**既有的兩行**
 * （`setup.ts` 舊的 `if (red === 0) ... else if (blue === 0) ...`）。
 */
export function stepMission(
  rules: MissionRules, inp: MissionInputs, dt: number, out: MissionState,
): void {
  if (out.outcome !== 'fighting') return

  if (rules.kind === 'annihilate') {
    out.metric = inp.aliveRed
    if (inp.aliveRed === 0) out.outcome = 'victory'
    else if (inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }

  // ── 守住艦隊 ──────────────────────────────────────────
  //
  // 【要害艦排在勝利之前】理由見 `MissionRules` 的 `defend`。
  //
  // 【`redInbound` 也擋在勝利那一條上】預警期間紅方歸零不算贏 —— 那一批
  // 還在路上。
  if (rules.kind === 'defend') {
    out.metric = inp.vitalHp
    if (inp.vitalSunk > 0) out.outcome = 'defeat'
    else if (inp.aliveRed === 0 && !inp.redInbound) out.outcome = 'victory'
    else if (inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }

  // ── 擊沉 ──────────────────────────────────────────────
  //
  // 【只顯示擊沉進度，不顯示我方架數】`(2/4)` 已經說完這一關要做什麼。
  // 我方全滅仍然判敗，只是那件事不占目標列的版面。
  if (rules.kind === 'sink') {
    out.metric = Math.max(0, rules.count - inp.shipsSunk)
    out.metricTotal = rules.count
    out.remaining = -1
    if (inp.shipsSunk >= rules.count) {
      out.outcome = 'victory'
      return
    }
    // 【全滅才算輸，不是「船沉光了還沒達標」】後者是關卡設計錯誤
    // （目標數大於艦隊數），應該由 `campaigns.test.ts` 那一層擋掉，
    // 而不是在戰鬥中判一個玩家看不懂的敗北。
    //
    // 【有護衛編制時，護衛全滅也算全滅】那一關的目標是掩護，攻擊隊還活著不算數
    if (inp.aliveBlue === 0 || (rules.escorts === true && inp.aliveBlueFighters === 0)) {
      out.outcome = 'defeat'
    }
    return
  }

  // ── 炸毀 ──────────────────────────────────────────────
  //
  // 逐格與擊沉相同，換的只有計數的來源。判負是藍隊全滅，不是玩家陣亡 ——
  // 玩家被擊落後兩秒接手友機的機制（`takeover.ts`）才保得住
  if (rules.kind === 'destroy') {
    out.metric = Math.max(0, rules.count - inp.targetsDestroyed)
    out.metricTotal = rules.count
    out.remaining = -1
    if (inp.targetsDestroyed >= rules.count) {
      out.outcome = 'victory'
      return
    }
    if (inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }

  // ── 擊落 ──────────────────────────────────────────────
  //
  // 逐格與擊沉相同，換的只有計數的來源與那一格要不要依角色過濾。
  if (rules.kind === 'hunt') {
    const killed = killedOfRole(rules.role, inp)
    out.metric = Math.max(0, rules.count - killed)
    out.metricTotal = rules.count
    out.remaining = -1
    if (killed >= rules.count) {
      out.outcome = 'victory'
      return
    }
    if (inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }

  // ── 護送／攔截 ────────────────────────────────────────
  //
  // 【一條規則，兩張卡】**某一隊的轟炸機：送到 `need` 架，那一隊贏；再也湊
  // 不到 `need` 架，那一隊輸。** `owner` 說那一隊是誰，而玩家恆在藍隊，所以
  // `good` 就是「那一隊是不是我方」。護送是 `owner: 'blue'`，攔截是
  // `owner: 'red'`，兩者共用下面每一行 —— 包含邊界的行為。
  //
  // 【兩個條件互斥，所以順序不影響結果】抵達的只算進 `convoyArrived`、
  // 還在路上的只算進 `convoyAlive`（見 `MissionInputs`），同一架不會同時
  // 落在兩邊。
  if (rules.kind === 'convoy') {
    const good = rules.owner === 'blue'
    const need = rules.need ?? 1
    out.metric = inp.convoyLead
    out.remaining = inp.convoyAlive
    out.arrived = need > 1 ? inp.convoyArrived : -1

    if (inp.convoyArrived >= need) {
      out.outcome = good ? 'victory' : 'defeat'
      return
    }
    // 【湊不到門檻就當場定案，不等全滅】`need` 是 1 時它退化成「全部被擊落」
    // ——兩者逐字等價，所以沒有第二條路徑。門檻大於 1 時它才是新的：16 架
    // 只剩 7 架還有機會時，這一關已經結束了，不必再飛兩分鐘。
    if (inp.convoyAlive + inp.convoyArrived < need) {
      out.outcome = good ? 'defeat' : 'victory'
      return
    }
    // 【為什麼還要這一條】攔截時我方全滅要算輸，而那件事上面兩條都涵蓋
    // 不到（敵轟炸機還活著、也還沒到）。護送時它是多餘的但無害：轟炸機
    // 本來就在藍隊，`aliveBlue === 0` 蘊含 `convoyAlive === 0`。
    if (inp.aliveBlue === 0) out.outcome = 'defeat'
    return
  }

  // ── 撤離 ──────────────────────────────────────────────
  //
  // 【`dt` 要守】非有限或負的 `dt` 是呼叫端的 bug，但代價全部落在這裡：
  // `NaN` 會**永久污染** `secondsLeft`（一旦是 NaN，`<= 0` 恆為 false，
  // 任務再也不會超時），而 `formatCountdown` 對 NaN 回空字串 —— 玩家看到
  // 的只是「倒數消失了」。負的 `dt` 則會把時間加回去。
  //
  // 【為什麼是降級而不是丟例外】專案的既有作風：`sweetYield` 對非有限值
  // 回 1（不讓位）、`clampSide` 對 NaN 回 `MIN_SIDE`。丟例外會讓一個顯示
  // 用的計時器炸掉整個遊戲迴圈。夾成 0 的意思是「這一步時間不前進」，
  // 而下面的勝負判定照跑。
  //
  // 【`Infinity - 0` 仍是 `Infinity`】無時限因此不必特例。有測試釘住這件
  // 事，否則哪天改成一個計時器物件就會靜靜壞掉。
  out.secondsLeft -= Number.isFinite(dt) && dt > 0 ? dt : 0
  out.metric = inp.playerPos.distanceTo(rules.point)

  // 【NaN 走這條】`NaN < radius` 是 false，所以位置壞掉時不會誤判成功；
  // 落到下面的兩條失敗條件，而那兩條不讀位置。
  if (inp.playerAlive && out.metric < rules.radius) {
    out.outcome = 'victory'
    return
  }
  if (inp.aliveBlue === 0 || out.secondsLeft <= 0) out.outcome = 'defeat'
}
