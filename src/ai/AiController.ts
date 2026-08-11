import { Vector3 } from 'three'
import {
  alarmFactor, alarmRamp, considerThreatFrom, createSituation, evaluateEnergy,
  evaluateGeometry, evaluateThreat, trackingFactor,
} from './assess'
import { createRuleState, stepRules, type Intent } from './rules'
import {
  buildEngageBasis, createDefendState, createEngageBasis, engageKnobs, geometryGate,
  shrinkTowardNose, stepDefend, steerCommand, type Knobs,
} from './steer'
import { DEFAULT_DOCTRINE, energyPull } from './doctrine'
import { cornerSpeed } from '../analysis/envelope'
import { shouldFire } from './fire'
import {
  createTargetState, selectTarget, DEFAULT_TARGET, type TargetBoard, type TargetConfig,
} from './target'
import { applySafety, type SafetyAction } from './safety'
import {
  DEFAULT_STATION, STATION_OFFSETS, stationCommand, stationPoint,
  type StationConfig, type StationOffset,
} from './station'
import {
  DEFAULT_WINGMAN, LEVEL_SELF_DEFENCE, createWingmanState, selectWingmanTarget,
  type WingmanConfig,
} from './wingman'
import { rallyCommand } from './rally'
import { ACE, type DifficultyProfile } from './profile'
import type { FlightOrder } from './command'
import { CommandDelay } from './delay'
import type { Aircraft } from '../aircraft/Aircraft'
import { createCommand, type Command, type Controller } from '../control/Controller'

/** 意圖仲裁與包絡查詢的頻率，Hz。 */
export const AI_DECISION_HZ = 10

const FWD = new Vector3(0, 0, -1)

/**
 * 敵機 AI。實作 `control/Controller`，所以 `World` 一個字都不用改。
 *
 * 【全部的狀態都住在這裡】`assess` / `rules` / `steer` / `fire` / `safety`
 * 都是純函數（spec §4.3）——這是 L4 的對戰矩陣能在 node 裡跑幾百場的前提。
 */
export class AiController implements Controller {
  /**
   * 交戰對象。`board` 為 null 時由 `main.ts` 或測試設定；否則由
   * `selectTarget` 在每個決策節拍改寫。
   */
  target: Aircraft | null = null
  /** 該點的海面（未來為地表）高度，m */
  seaHeight = 0
  profile: DifficultyProfile = ACE

  /**
   * 目標選擇的共享指派板。
   *
   * 【null 時完全是 M4 的行為】`target` 由外部指派、不做選擇。M4 的全部
   * 測試與 `bench/ai-load.ts` 因此一個字都不用改（M5 spec §6.6）。
   */
  board: TargetBoard | null = null
  /** 自己在 `board.candidates` 裡的索引。`board` 為 null 時不使用 */
  selfIndex = -1
  targetConfig: TargetConfig = DEFAULT_TARGET

  /**
   * 站位參考機，同時也是**掩護對象**（M6 spec §5.1）。
   *
   * 【null 時完全是 M5 的行為】自由選目標、沒有目標就平飛。Schwarm 長機、
   * 落單者、以及還沒接線的實例都走這一條，所以 M4 的全部測試與
   * `bench/ai-load.ts` 一個字都不用改。
   */
  stationReference: Aircraft | null = null
  /** 站位參考機在 `board.candidates` 裡的索引；−1 = 無 */
  stationReferenceIndex = -1
  /** 這一架的站位偏置。`stationReference` 為 null 時不使用 */
  stationOffset: StationOffset = STATION_OFFSETS[0]!
  stationConfig: StationConfig = DEFAULT_STATION
  wingmanConfig: WingmanConfig = DEFAULT_WINGMAN
  /**
   * 上一個決策節拍算出的站位誤差，m。供 HUD、telemetry 與測試讀取。
   *
   * 【為什麼是 10 Hz 而不是每步】只有僚機的目標選擇讀它，而那本來就是
   * 決策節拍。整合測試的抽樣頻率遠低於 10 Hz，讀得到的精度綽綽有餘。
   */
  stationError = 0

  /**
   * 目前對我威脅最大的敵機。`board` 為 null 時恆為 null（退化成 M4 行為）。
   *
   * 【為什麼要記住是誰】`defend` 的破防方向要繞著**真正在打我的那一架**算，
   * 而它常常不是我的目標 —— 實測 20v20，長機 97.8% 的鎖定來自非目標敵機。
   *
   * 【為什麼它不改變 `target`】「誰在打我」與「誰最好打」是兩個問題。把它們
   * 綁在一起會變成：他打我 → 我切過去 → 他拉開 → 我又切回來，也就是剛修掉的
   * A→B→A 猶豫。閃躲只改**動作**，不碰目標選擇；至於要不要轉去打他，
   * `selectTarget` 的評分裡本來就有威脅項，會走正常的、有遲滯保護的路徑。
   */
  threatSource: Aircraft | null = null

  /**
   * 指揮層下來的命令；`null` = 自由交戰。由 `setup.ts` 每步寫入。
   *
   * 【它是外部覆寫，不是仲裁表裡的一列】見 `update` 裡那兩行的註解。
   */
  order: FlightOrder | null = null

  /**
   * 集火命令指定的那一架。`null` = 沒有指定。由 `setup.ts` 每步寫入。
   *
   * 【為什麼不直接放在 `FlightOrder` 裡】命令住在 `src/ai/command.ts`，而
   * 那一層只吃索引不吃 `Aircraft`（規劃是純函數，見該檔的註解）。索引解析
   * 成 `Aircraft` 是 `battle` 層的事 —— 與 `stationReference` 同一個手法。
   *
   * 【陣亡由 `setup.ts` 擋】它解析索引時若那一架已經退場就寫 `null`。
   * `AiController` 不必知道「命令裡的索引可能過期」這回事。
   */
  focusTarget: Aircraft | null = null

  /** 供 HUD、telemetry 與測試讀取 */
  intent: Intent = 'approach'
  safetyActive = false
  /**
   * 安全層這一格接管了哪一種：`'none'` / `'ground'`（撞地）/ `'stall'`（失速）。
   *
   * 【為什麼不只留 `safetyActive`】兩個接管的補救方向相反，量「安全層介入率」
   * 時混在一起會量到不相干的東西 —— 見 `SafetyAction` 的註解。`safetyActive`
   * 保留原語意（有沒有介入），需要分辨的護欄讀這一個。
   */
  safetyAction: SafetyAction = 'none'
  /**
   * 上一格的射擊解強度鏡像。**只為量測存在**（spec §7.3 的觀測值：「命令
   * 發出的那一格，受命飛機正握有射擊解」的次數）。
   *
   * 【為什麼不直接公開 `sit`】那會讓外部依賴整個 `Situation` 的形狀，而它是
   * 內部資料結構。鏡像一個純量的相依面積最小。
   *
   * 【為什麼不用 `intent === 'engage'` 當代理】代理量會把「approach 中被
   * 拉走」誤算成無害，而那正是要看的東西。
   */
  shotInstant = 0
  trackingSeconds = 0
  /**
   * 警戒（「有人的預瞄環套在我身上」）已經持續幾秒。
   *
   * 【為什麼與 `trackingSeconds` 分開】後者是在 `sit.threatInstant > 0` 時
   * 累積的，而那個量在 `THREAT_RANGE`（900 m）外恆為 0 —— 共用計時器等於
   * 把警戒也綁回 900 m，而警戒的射程是由武器決定的（約 1064 m）。飽和時間
   * 也刻意不同：警戒 0.5 s、跟蹤 1.0 s。
   */
  alarmSeconds = 0
  /**
   * 累計做過幾次意圖仲裁。
   *
   * 【為什麼公開】相位錯開（M5 spec §6.4）唯一可自動化的觀測量。人工驗收
   * 看的是「幀率沒有週期性頓挫」，那不可能寫成斷言；「40 架的決策沒有擠在
   * 同一步」則可以。
   */
  decisionsMade = 0

  private readonly sit = createSituation()
  private readonly targetState = createTargetState()
  private readonly basis = createEngageBasis()
  /**
   * 規則層的閂鎖狀態。**唯讀** —— 只有 `stepRules` 能寫。
   *
   * 【為什麼公開】與 `intent`、`safetyActive` 同一個理由：測試要分辨
   * `extend` 是**哪一個理由**觸發的。三個理由裡兩個是「跟他比」、一個是
   * 「我自己飛不動了」，只看 `intent` 分不出來 —— 而「劣勢方應該更常脫離」
   * 這個主張只對前兩個成立（M11 spec §4.1）。
   */
  readonly rules = createRuleState()
  /**
   * 破防層的跨格狀態（目前只有反轉的倒數）。**唯讀** —— 只有 `stepDefend`
   * 能寫。與 `rules` 同一個理由公開：反轉是一個展開中的動作，有沒有真的
   * 發生過，只看 `intent` 是看不出來的。
   */
  readonly defend = createDefendState()
  private readonly knobs: Knobs = { leadLag: 1, vertical: 0 }
  private readonly wingmanState = createWingmanState()
  private readonly station = new Vector3()
  /**
   * 延遲之前的指令。`update` 的三條輸出路徑全部寫進這裡，再由 `emit` 經過
   * 反應延遲流進呼叫端的 `out`。
   */
  private readonly raw = createCommand()
  private readonly delay = new CommandDelay()
  /** 距離下一次意圖仲裁還有多久，s */
  private decisionTimer = 0

  update(self: Aircraft, dt: number, out: Command): void {
    const period = 1 / AI_DECISION_HZ
    const reference = this.stationReference
    const raw = this.raw

    // 【節拍先算，分支後用】決策這一步要不要跑，必須在「有沒有目標」之前
    // 決定 —— 否則沒有目標時計時器不會前進，board 一設上去就會變成每個
    // 物理步都在選目標。
    this.decisionTimer -= dt
    const decide = this.decisionTimer <= 0
    if (decide) {
      this.decisionTimer += period
      this.decisionsMade++
      if (reference) {
        stationPoint(reference, this.stationOffset, this.seaHeight, this.station)
        this.stationError = this.station.distanceTo(self.state.position)
      } else {
        this.stationError = 0
      }
      this.threatSource = this.scanThreat(self)
      if (this.board) {
        // 【角色分派】有站位參考機 = 僚機，走四級準則；否則是自由獵手
        this.target = reference
          ? selectWingmanTarget(
            this.wingmanState, this.board, this.selfIndex,
            this.stationReferenceIndex, this.stationError, period, this.wingmanConfig,
          )
          : selectTarget(
            this.targetState, this.board, this.selfIndex, period, this.targetConfig,
          )
      }
      // 【命令對僚機的意思】不是「你也飛去集合點」—— 那會讓編隊在路上散成
      // 一排。是「停止出擊」，於是它掉進下面「沒有目標 → 飛站位」那一格，
      // 自動貼著長機一起走。不需要任何新的協調機制（spec §5.3、§5.4）。
      //
      // 【LEVEL_SELF_DEFENCE 照樣插隊】「有人正在打我」不能被命令擋住，
      // 那與 rules.ts 讓 defend 豁免 minDwell、wingman.ts 讓跨級插隊豁免
      // switchMargin 是同一條原則。
      // 【集火時僚機不能被清掉目標】它要靠既有的 LEVEL_FOCUS（「打參考機
      // 正在打的那一架」）跟上長機。清掉會讓它掉進「沒有目標 → 飛站位」，
      // 集火就只剩長機一架在打 —— 那個戰術的整個意義就沒了
      if (this.order !== null && this.order.kind !== 'focus'
        && reference && this.wingmanState.level > LEVEL_SELF_DEFENCE) {
        this.target = null
      }
      // 【只覆寫長機】僚機走 LEVEL_FOCUS，那一級本來就有自衛與掩護插隊，
      // 「有人正在打我」不會被集火命令擋住。與集合點同一個手法：只操縱
      // 長機，編隊靠既有機制跟上，wingman.ts 一個字不動
      if (this.focusTarget !== null && !reference) this.target = this.focusTarget
    }

    const target = this.target
    if (!target) {
      if (reference) {
        // 【隊形保持就在這一格】沒有值得打的敵人時飛回站位。
        //
        // 它**不進** `arbitrate` 的優先序：engage / merge / approach 全都
        // 要求有目標，所以「沒有目標」這一格本來就是它的位置。代價是這條
        // 分支跳過整條態勢評估，`defend` 因此結構上不可能觸發 —— 補法是
        // 僚機目標優先序最上面的那一級「自衛」，而不是在 rules.ts 開特例
        // （M6 spec §3.2）。
        stationCommand(
          self, reference, this.stationOffset, this.seaHeight, raw, this.stationConfig,
        )
      } else if (this.order !== null && this.order.kind !== 'focus') {
        // 【長機收到命令且場上沒有值得打的敵人】飛集合點。這一格與下面的
        // 平飛是同一個位置的兩種答案 —— 有命令就有地方去。
        //
        // 【集火要排除】它的 `point` 是零向量。這一格不看意圖，所以少了
        // 這個條件，「集火令的長機在目標剛陣亡的那一瞬沒有目標」就會變成
        // 「往世界原點的海平面俯衝」
        rallyCommand(self, this.order.point, raw)
      } else {
        // 沒有目標也沒有站位時維持機首方向平飛。這比「保持上一格的指令」
        // 安全——上一格可能是一個俯衝中的脫離向量。
        raw.aimWorld.copy(FWD).applyQuaternion(self.state.orientation)
        raw.throttle = 0.7
        raw.brake = 0
        raw.firing = false
      }
      // 【拉桿紀律連早退路徑也涵蓋，甜蜜區不涵蓋】兩者的位階不同：甜蜜區
      // 是戰術偏好，指揮官比它高，執行命令時讓位；拉桿紀律是「不要弄壞
      // 自己」—— **沒有任何命令的內容是「把自己拉爆」**，所以它在任何時候
      // 都生效，包括飛去集合點與飛回站位的途中。見 spec §4.4。
      //
      // 【為什麼不能靠 steerCommand】上面三個分支直接寫 `aimWorld` 然後
      // return，根本不經過 `steerCommand`，那一層的紀律對它們無效。
      //
      // 【為什麼是 cornerSpeed 而不是 sit.cornerRatio】這條路徑沒有目標，
      // `evaluateEnergy` 因此沒有跑過，`this.sit` 是上一次有目標時的舊值。
      // 直接算 —— 這個量本來就只與自己有關（`cornerSpeed` 已快取）。
      //
      // 【安全層仍然有最後決定權】`emit` 裡的 `applySafety` 排在這之後，
      // 撞地與失速的硬接管會整個換掉 `aimWorld`。順序是對的。
      const ceiling = energyPull(
        self.diag.aero.tas / cornerSpeed(self.spec, self.state.position.y),
        DEFAULT_DOCTRINE,
      )
      shrinkTowardNose(self, ceiling, raw.aimWorld)
      this.emit(self, dt, out)
      return
    }

    // ── 240 Hz：便宜的運動學 ──────────────────────────────
    // 【意圖是 10 Hz，但它引用的幾何不能是 10 Hz 的舊值】高速近距離時
    // 100 ms 足以讓「超前」的態勢完全改變。
    evaluateGeometry(self, target, this.sit)
    evaluateThreat(self, target, this.sit)
    // 只為量測存在，見欄位註解
    this.shotInstant = this.sit.shotInstant
    // 【威脅來源每步重算，但「是誰」只在決策節拍找】掃全場要對每架敵機解
    // 預瞄，240 Hz 跑不起；而「誰在打我」是慢變量，10 Hz 找一次夠了。找到
    // 之後那一架的威脅值仍然每步更新 —— 與幾何 240 Hz、能量 10 Hz 同一個
    // 分頻原則（spec §4.2）。
    const src = this.threatSource
    if (src !== null && src !== target) considerThreatFrom(self, src, this.sit)
    // 【誰在打我】`scanThreat` 已經用 `alarmFactor` 掃過全場（含當前目標），
    // 所以它挑出來的那一架就是警戒值最大的。`board` 為 null 時退回目標。
    const attacker = src ?? target
    buildEngageBasis(self, target, this.basis)

    // 跟蹤計時器：在他的射擊錐內才累積，離開立刻歸零
    this.trackingSeconds = this.sit.threatInstant > 0 ? this.trackingSeconds + dt : 0
    const threat = this.sit.threatInstant * trackingFactor(this.trackingSeconds)

    // 警戒：「他的預瞄環套在我身上嗎」。這是**閃躲的觸發判準**，與上面那個
    // 「他打得中我的機率」分開 —— 後者的距離因子讓閃躲門檻在幾何上等價於
    // 「他必須進到 585 m 以內」，實測 700/900 m 被連續射擊 180 秒，`defend`
    // 進入率 0.0%。完整推導見 `assess.ts` 的 `alarmFactor`。
    const alarmInstant = alarmFactor(attacker, self)
    // 【自己的計時器】`trackingSeconds` 是在 `threatInstant > 0` 時累積的，
    // 而那個量在 900 m 外恆為 0 —— 共用等於把警戒也綁回 900 m。
    this.alarmSeconds = alarmInstant > 0 ? this.alarmSeconds + dt : 0
    const alarm = alarmInstant * alarmRamp(this.alarmSeconds)
    // 【為什麼是 max】`alarm ≥ threat` 在幾何上恆成立（同樣的錐、同樣的預瞄
    // 解，只是少乘一個 ≤1 的距離因子，有單元測試釘住）。所以 `max` 等於
    // 「以警戒為準，但保證絕不比原本遲鈍」—— 新機制只能讓閃躲**更早**觸發，
    // 不可能讓任何既有的觸發消失。
    const danger = threat > alarm ? threat : alarm

    // ── 10 Hz：昂貴的包絡查詢與意圖仲裁 ────────────────────
    if (decide) {
      evaluateEnergy(self, target, this.sit)
      this.intent = stepRules(this.rules, this.sit, danger, period)
      // 【命令是外部覆寫，不是 arbitrate 的一列】那個函式的優先序關係是
      // 實測逐條談定的（相對理由 vs 絕對理由、defend 的絕對優先權，見
      // rules.ts 的長註解與 2026-08-07 的 #136）。把命令插進去會動到那
      // 整組關係；覆寫在外面則一條都不受影響。
      //
      // 【stepRules 照常呼叫】閂鎖要繼續維護，否則命令解除的那一格會拿到
      // 一組停在幾秒前的閂鎖。
      //
      // 【閃躲永遠優先】專案負責人 2026-08-07 裁定，撤退也一樣。「強制
      // 脫離」的意思是「不抵抗、不回頭打」，不是「不閃彈」。
      //
      // 【集火不碰意圖】它是三種命令裡唯一「要交戰」的一種（spec §5.4）。
      // rally 與 flank 是「不要打，去那裡」，focus 是「打那一架」——
      // 壓成 rally 會讓集火命令反而停止交戰，那是完全相反的效果
      if (this.order !== null && this.order.kind !== 'focus') {
        this.intent = this.rules.defendLatch ? 'defend' : 'rally'
      }
    }

    // ── 240 Hz：轉向、開火 ────────────────────────────────
    engageKnobs(this.sit, this.knobs)
    const mode = geometryGate(this.sit, this.basis)
    // 【意圖是上一個決策節拍的值】反轉的觸發只在進入的那一格用得上，晚一個
    // 物理步（4 ms）不影響；重要的是這裡讀到的意圖與下面 `steerCommand`
    // 讀到的是**同一個**，不能半新半舊。
    stepDefend(this.defend, self, attacker, this.intent === 'defend', dt)
    steerCommand(
      this.intent, mode, this.sit, this.basis, self, this.seaHeight,
      this.knobs, this.defend,
      // 【集火沒有點】它的 `point` 是一個沒有意義的零向量。意圖不會是
      // 'rally' 所以那個分支不會跑，但傳一個假的點進去是在賭別人不會改
      // 那個分支
      this.order === null || this.order.kind === 'focus' ? null : this.order.point,
      raw,
    )
    // 【rally 與 flank 途中不交戰】兩份 spec 都這樣寫（第一份 §4.4、第二份
    // §4.4），而 `rallyCommand` 也確實把 `firing` 設成 false —— 但它只在
    // 「沒有目標」那條分支跑。**有目標的長機走的是這一行**，於是命令期間
    // 照樣扣扳機：強制注入側翼實測 11814/115200 個取樣在開火。
    //
    // 意圖是唯一該讀的判準：`focus` 的意圖不會是 rally（它要交戰），
    // 而破防閂上時意圖是 defend —— 「不回頭打」不包含「不閃彈」，也不
    // 包含閃躲過程中打到的那一槍。
    raw.firing = this.intent === 'rally' ? false : shouldFire(this.sit, this.basis, self)

    this.emit(self, dt, out)
  }

  /**
   * 把 `raw` 送出去：先過反應延遲，再過安全層。
   *
   * 【安全層為什麼排在延遲之後】延遲模擬的是**判讀與決策**的耗時；「快撞地
   * 了」是反射，不是判讀。把安全層一起延遲會讓 AI 撞地率上升，而那是一個
   * 與難度無關的退步 —— 玩家不會覺得「敵人比較弱」，只會覺得「敵人會自殺」。
   * 安全層讀的是飛機**當下**的狀態，所以它必須拿當下的狀態算（spec §4.2）。
   *
   * 【為什麼只有一個呼叫點】`update` 有三條輸出路徑（站位、平飛、交戰），
   * 以前各自呼叫 `applySafety`。收斂成一個之後，「延遲在安全層之前」這件事
   * 不可能被新增的分支繞過。
   *
   * `profile.reactionDelay = 0`（`ACE`）時 `CommandDelay` 走位元等價的捷徑，
   * 所以這一層對既有的全部測試是無作用的。
   *
   * 【延遲會讓 AI 飛得更低，但那不是這個順序的錯】五個低空受控場景、120 秒、
   * 取全場最低高度：
   *
   * ```
   * 延遲     對頭@600  對頭@400  追擊@500  側舷@700  俯衝@2000   最低  觸海
   * 0.00        387      400      121      115       228      115   無
   * 0.30        600      170      499       63       568       63   無
   * 0.50        386      348      257       −0       547       −0   有
   * 0.80        549      389      488      275       524      275   無
   * ```
   *
   * 0.5 s 那一場的軌跡查到根因，**在 `applySafety` 不在這裡**：它的閉式解
   * 假設俯衝角不再變陡。t=113.0 時高度 367 m、γ=−40°，需要 279 m，通過；
   * 0.75 秒後 γ 已經 −60°，需要 459 m，而高度只剩 292 m —— 需求的成長比
   * 飛機拉得起來的還快。零延遲的同一場也只剩 115 m，是同一個病，延遲只是
   * 讓 AI 更常撞上它。修它要動 `DEFAULT_SAFETY.factor`，那會移動全部既有
   * 基準，另案處理。
   */
  private emit(self: Aircraft, dt: number, out: Command): void {
    this.delay.push(this.raw, this.profile.reactionDelay, dt, out)
    this.safetyAction = applySafety(self, this.seaHeight, out)
    this.safetyActive = this.safetyAction !== 'none'
  }

  /**
   * 掃全場找出對我威脅最大的敵機。`board` 為 null 時回 null。
   *
   * 【為什麼是這裡而不是 assess.ts】掃描需要指派板，而板是 AI 層的概念；
   * `assess.ts` 只認兩架飛機（spec §4.3）。
   *
   * 【為什麼不重用僚機的自衛級】那一級的產出是**目標**，這裡要的是**威脅
   * 來源**，兩者刻意分開（見 `threatSource` 的註解）。僚機兩者都要，所以
   * 兩條路徑各自掃一次 —— 都在 10 Hz，成本可以接受。
   *
   * 熱路徑之外（10 Hz），不配置。
   */
  private scanThreat(self: Aircraft): Aircraft | null {
    const board = this.board
    if (board === null) return null
    const me = board.candidates[this.selfIndex]
    if (me === undefined) return null

    let best: Aircraft | null = null
    let bestValue = 0
    const cs = board.candidates
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i]!
      if (!c.alive || c.team === me.team) continue
      // 【用警戒而不是威脅排序】`threatFactor` 在 900 m 外恆為 0，所以
      // 用它掃描的話，一架咬在我 950 m 正後方的敵機得分與「不存在」相同 ——
      // 選不出來，`defend` 的破防軸也就繞不到他身上。`alarmFactor` 的支撐集
      // **包含** `threatFactor` 的（同樣的錐、同樣的解，只是少乘距離因子），
      // 所以換過來只會多找到人，不會少。
      const t = alarmFactor(c.aircraft, self)
      if (t > bestValue) {
        bestValue = t
        best = c.aircraft
      }
    }
    return best
  }

  /**
   * 錯開決策相位（M5 spec §6.4）。
   *
   * 【為什麼需要】40 架的 `decisionTimer` 都從 0 起算，會在**同一個物理步**
   * 一起做昂貴的包絡查詢，變成每 100 ms 一次的週期性尖峰。
   *
   * 【它不解決分攤的順序相依】那件事無法消除，只能換一種形式 —— 見
   * M5 spec §6.4。這裡要保證的是決定性，不是順序無關。
   *
   * @param fraction 0..1，在一個決策週期裡的位置
   */
  setDecisionPhase(fraction: number): void {
    let f = fraction % 1
    if (f < 0) f += 1
    this.decisionTimer = f * (1 / AI_DECISION_HZ)
  }
}
