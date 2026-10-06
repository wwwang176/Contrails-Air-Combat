import type { Vector3 } from 'three'
import { DEFAULT_COMMAND, FLANK_RANGE, type CommandConfig } from './commandConfig'
import type { CommandFlight, CommandState, CommandUnit, FlightOrder } from './commandTypes'
import {
  flankArrived, flankPoint, planFlankOrder, planFlightOrder, planFocusTarget, rankFlights,
} from './commandPlanning'

/**
 * 觸發階梯要不要選側翼。**目前是關的。**
 *
 * 【為什麼關】spec §12：時間對齊的實測顯示側翼讓開火的方位角**變差**
 * （delta +0.728，n = 3425 對 7566），總傷害也少 18%。同一批時刻，沒有
 * 繞路的那一支已經咬在人家尾後（−0.558），繞完 2.5 km 的那一支落在正
 * 側面附近（+0.170）—— 它把已經到手的位置丟掉了。到位判定與點位置各掃
 * 了八組，delta 隨參數完全非單調，**不是參數問題**。
 *
 * 【為什麼只關觸發，不刪程式碼】`planFlankOrder`、`flankPoint`、
 * `flankArrived` 與它們的十八條考題全部留著，強制注入的驗收也照跑 ——
 * 那條路徑本身是對的，錯的是「什麼時候選它」。而實測樣本全部來自強制
 * 注入：真實觸發器 120 秒只發 4 張，而注入挑的是「最近但超過 2500 m 的
 * 敵分隊」，混戰中那通常表示要放棄現有咬尾去追一支正忙著的分隊 ——
 * 那本來就是壞決定，不管側翼寫得多好。所以量到的是「在錯的時機執行側翼
 * 有多糟」，不是「側翼有沒有價值」。後者要等第三份的決策層才問得出來。
 *
 * 【重新打開的條件】spec §12.5：命令解除時交接目標（現在解除的那一瞬，
 * 小隊回頭走既有的自由選目標，而 `targetScore` 不知道我們剛繞到人家
 * 後面），並用同一條時間對齊的判準重測。
 */
const FLANK_ENABLED: boolean = false

export function createCommandState(flightCount: number): CommandState {
  return {
    orders: new Array<FlightOrder | null>(flightCount).fill(null),
    spent: new Float32Array(flightCount),
    idle: new Float32Array(flightCount),
    // 【起始為 0，第一步就規劃一次】起始為 planPeriod 的話開場前兩秒的
    // 指揮官是啞的，而開局正是編隊最完整、最該被指揮的時候
    timer: 0,
  }
}

/**
 * 推進指揮官一步：累積見底計時、維護命令、到期時規劃。
 *
 * 【為什麼計時每步跑而規劃每 N 秒跑】見底是一個**持續**條件（第一份
 * spec §2.4），漏數任何一步都會低估；而規劃是昂貴的而且是戰役尺度的決定，
 * 不該與戰機的機動同頻。這與 `AiController` 把幾何放 240 Hz、意圖仲裁放
 * 10 Hz 是同一個分頻原則。
 *
 * 【為什麼收 `own` / `foe` 兩組分隊索引】收攤平的敵機名單並掃**全部**分隊
 * 的話，藍方指揮官會替紅方分隊也規劃一遍、結果從來不被讀 —— 浪費一半的
 * 規劃工作，而且讀起來會讓人以為藍方在指揮紅方。側翼要挑「某一個敵分隊」
 * 也本來就需要敵方的分隊結構。
 *
 * 熱路徑：每步的部分不配置（側翼點的重算走 `flankPoint`，寫進既有的
 * `order.point`）。發令的那一格會配置一個 `Vector3`。
 *
 * @param flights  **全部**分隊，全域索引
 * @param own      這個指揮官管的分隊索引
 * @param foe      敵方的分隊索引
 * @param units    每架快照，全域索引，與 `CommandFlight.members` 對應
 * @param skipFlight 不下命令的分隊索引（玩家所在的那一隊）；−1 = 都下
 */
export function stepCommand(
  s: CommandState,
  flights: readonly CommandFlight[],
  own: readonly number[],
  foe: readonly number[],
  units: readonly CommandUnit[],
  skipFlight: number,
  dt: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): void {
  s.timer -= dt
  const plan = s.timer <= 0
  if (plan) s.timer += cfg.planPeriod

  for (let oi = 0; oi < own.length; oi++) {
    const f = own[oi]!
    const flight = flights[f]!

    // 【玩家那一隊自治】spec §2.1。也涵蓋全滅的分隊 —— 兩者都要把殘留的
    // 命令清掉，否則分隊復活（重置戰鬥）時會拿到一張過期的命令
    if (f === skipFlight || flight.count === 0) {
      s.orders[f] = null
      s.spent[f] = 0
      s.idle[f] = 0
      continue
    }

    // ── 見底計時：小隊裡第 `spentRank` 低的那一架 ──────────
    // 【為什麼不是恆取最低】見 `CommandConfig.spentRank`：四機小隊的最小值
    // 遠低於中位數，一架落單掉速的僚機就能把整支分隊拖出戰場三成的時間。
    //
    // 【為什麼是插入排序不是 Array.sort】分隊最多 4 人，而這一段每 dt 都跑
    // 一次（40 架 × 240 Hz）。`sort` 會配置 —— 熱路徑不得配置。
    RATIOS.length = 0
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u === undefined || !u.alive) continue
      let i = RATIOS.length
      RATIOS.push(u.cornerRatio)
      while (i > 0 && RATIOS[i - 1]! > RATIOS[i]!) {
        const t = RATIOS[i - 1]!
        RATIOS[i - 1] = RATIOS[i]!
        RATIOS[i] = t
        i--
      }
    }
    // 【空的時候是 Infinity】成員全部陣亡時不該累積見底，所以初值是
    // `Infinity` 不是 0。
    //
    // 【三面都要夾】上界是存活人數，下界是 0，而且要取整。`RATIOS[-1]`、
    // `RATIOS[0.5]`、`RATIOS[9]` 都是 `undefined`，而 `undefined < spentRatio`
    // 是 `false` —— 見底計時會被**靜靜地關掉**，撤退令從此不再發出，不丟
    // 任何例外也沒有錯誤訊息。
    const k = Math.min(Math.max(Math.floor(cfg.spentRank), 0), RATIOS.length - 1)
    const worst = RATIOS.length === 0 ? Infinity : RATIOS[k]!
    if (worst < cfg.spentRatio) s.spent[f] = s.spent[f]! + dt
    else s.spent[f] = 0

    // ── 閒置計時：隊裡**任何一架**握著射擊解就歸零 ──────────
    // 【為什麼是最大值而不是最低那一架】見底問的是「最弱的那一架拖不拖得
    // 動」，所以取最低；閒置問的是「這支分隊有沒有在得手」，只要有一架在
    // 得手就不該被調走，所以取最大
    let best = 0
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u === undefined || !u.alive) continue
      if (u.shotInstant > best) best = u.shotInstant
    }
    if (best <= 0) s.idle[f] = s.idle[f]! + dt
    else s.idle[f] = 0

    // ── 命令的維護：三種各自的解除條件 ────────────────────
    const order = s.orders[f]
    if (order !== undefined && order !== null) {
      // 【撤退優先於兩個進攻戰術，而且是一條解除條件】spec §3。優先序若
      // 只寫在規劃的那一格，一張已經發出的進攻命令會把小隊釘在那裡直到
      // 它到位 —— 期間就算打不動了也換不到撤退令，而「打不動的小隊被派
      // 出去切側翼」正是這條優先序要防的事。解除之後下一次規劃走撤退那
      // 一支（`spent` 不歸零，所以那一支立刻成立）
      // 【解除進攻命令時 idle 一律歸零，四處都是】spec §5.1。少了它，剛
      // 解除的分隊在下一個週期就會回到榜首（它確實是閒的），於是被永久釘
      // 在命令狀態。rally 那一支**不加** —— 它歸零的是 spent，一支剛撤退
      // 回來的分隊本來就是閒的，沒有理由再罰它一次
      if (order.kind !== 'rally' && s.spent[f]! >= cfg.spentSeconds) {
        s.orders[f] = null
        s.idle[f] = 0
        continue
      }
      if (order.kind === 'focus') {
        const t = units[order.focusIndex]
        // 【兩個解除條件】目標陣亡，或跑到遲滯帶之外。
        // 發令要求 < focusRange（1500）、解除要求 > FLANK_RANGE（2500），
        // 兩個不同的數字就是遲滯 —— 同一個門檻發令與解除會在邊界上抖
        if (t === undefined || !t.alive
          || centroidDistance(flight, units, t.position) > FLANK_RANGE) {
          s.orders[f] = null
          s.idle[f] = 0
        }
      } else if (order.kind === 'flank') {
        const tf = flights[order.targetFlight]
        if (tf === undefined || tf.count === 0) {
          // 目標分隊全滅：這張命令沒有對象了
          s.orders[f] = null
          s.idle[f] = 0
        } else {
          gather(TARGET, tf, units)
          gather(MEMBERS, flight, units)
          // 【點每步重算】凍結的是 side 與 targetFlight，不是座標。
          // 算不出來（兩邊都全滅）時保留舊點，下一步再試
          flankPoint(TARGET, MEMBERS, order.side, cfg, order.point)
          if (flankArrived(MEMBERS, TARGET, cfg)) {
            s.orders[f] = null
            s.idle[f] = 0
          }
        }
      } else {
        // rally：到達判**長機**，不是小隊質心。
        //
        // 【為什麼不是質心】兩層各自都對，合起來卻永遠不成立：`AiController`
        // 只把集合點給長機（「只操縱長機，編隊靠既有機制跟上」），僚機拿到
        // 的是「別打了」+ 站位保持；而質心被落在站位偏置上的僚機拖著，長機
        // 飛過點的那一瞬質心離點還有一整個編隊尺度。
        //
        // 而 `rallyAim` 是對固定點的**純追擊、沒有抵達行為** —— 命令不解除
        // 就等於長機繞著那個點無限盤旋。實測回報（seed 297534859、座位 #8）：
        // `命令 rally` 連握 200 秒以上，高度鎖在 5258~5306 m、速度
        // 319~333 km/h、mode 恆為 `unload`（吃滿迎角在轉彎）。
        //
        // 判長機就沒有這個縫：被送去的那一架自己說了算。
        if (leaderDistance(flight, units, order.point) <= order.radius) {
          s.orders[f] = null
          // 【歸零就是遲滯】要再累積滿 spentSeconds 才會重發（第一份
          // spec §4.2）。少了這一行，抵達的下一格就會立刻重發
          s.spent[f] = 0
        }
      }
      continue
    }

    // ── 階段一：撤退。**不佔配額**（spec §3.2）────────────
    // 「打不動了」是一個事實，不是指揮官在分配資源。而且撤退本來就有自己
    // 的門檻與遲滯（spentSeconds、到達歸零）
    if (!plan) continue
    gather(MEMBERS, flight, units)

    FOES.length = 0
    for (let fi = 0; fi < foe.length; fi++) {
      const ef = flights[foe[fi]!]
      if (ef === undefined) continue
      for (let p = 0; p < ef.count; p++) {
        const u = units[ef.members[p]!]
        if (u !== undefined && u.alive) FOES.push(u)
      }
    }
    const retreat = planFlightOrder(MEMBERS, FOES, s.spent[f]!, cfg)
    if (retreat !== null) s.orders[f] = retreat
  }

  // ── 階段二：排名與配額（spec §5）──────────────────────
  if (!plan) return

  // 【在維護之後數】這一步解除的命令要立刻把名額釋出，否則名額會晚一個
  // 規劃週期才回來
  let held = 0
  for (let oi = 0; oi < own.length; oi++) {
    const o = s.orders[own[oi]!]
    if (o !== undefined && o !== null && o.kind !== 'rally') held++
  }
  let slots = cfg.maxOrders - held
  if (slots <= 0) return

  rankFlights(flights, own, units, s.orders, s.idle, skipFlight, RANKED, cfg)

  for (let ri = 0; ri < RANKED.length && slots > 0; ri++) {
    const f = RANKED[ri]!
    const flight = flights[f]!
    gather(MEMBERS, flight, units)
    if (MEMBERS.length === 0) continue

    // 挑最近的敵分隊
    let nearest = -1
    let nearestDist = Infinity
    for (let fi = 0; fi < foe.length; fi++) {
      const gi = foe[fi]!
      const ef = flights[gi]
      if (ef === undefined || ef.count === 0) continue
      gather(TARGET, ef, units)
      if (TARGET.length === 0) continue
      let cx = 0, cy = 0, cz = 0
      for (let i = 0; i < TARGET.length; i++) {
        cx += TARGET[i]!.position.x; cy += TARGET[i]!.position.y; cz += TARGET[i]!.position.z
      }
      const k = TARGET.length
      const d = centroidDistanceTo(MEMBERS, cx / k, cy / k, cz / k)
      if (d < nearestDist) { nearestDist = d; nearest = gi }
    }
    if (nearest < 0) continue

    // 遠 → 側翼（目前停用）；近 → 集火（spec §3.2）
    const tf = flights[nearest]!
    gather(TARGET, tf, units)
    let issued: FlightOrder | null = null
    if (nearestDist > FLANK_RANGE) {
      // 【側翼已停用】見 `FLANK_ENABLED`
      if (FLANK_ENABLED) {
        OTHERS.length = 0
        for (let fi = 0; fi < foe.length; fi++) {
          const gi = foe[fi]!
          if (gi === nearest) continue
          const ef = flights[gi]
          if (ef === undefined) continue
          for (let p = 0; p < ef.count; p++) {
            const u = units[ef.members[p]!]
            if (u !== undefined && u.alive) OTHERS.push(u)
          }
        }
        issued = planFlankOrder(MEMBERS, TARGET, OTHERS, nearest, cfg)
      }
    } else {
      TARGET_IDX.length = 0
      for (let p = 0; p < tf.count; p++) {
        const gi = tf.members[p]!
        const u = units[gi]
        if (u !== undefined && u.alive) TARGET_IDX.push(gi)
      }
      issued = planFocusTarget(MEMBERS, TARGET, TARGET_IDX, cfg)
    }

    // 【回 null 不消耗名額】排名只決定考慮順序，能不能發由規劃函式自己說
    if (issued === null) continue
    s.orders[f] = issued
    slots--
  }
}

/**
 * 規劃時把分隊成員收集起來的暫存陣列。
 *
 * 【為什麼是模組層級的可變陣列】三個規劃函式都收 `readonly CommandUnit[]`
 * 是為了單元測試好寫字面陣列；而這裡每次規劃都 `new Array` 會在 20v20 下
 * 每兩秒配置幾十次。重用並在每次使用前 `length = 0`，與 `combatEvents.ts` 的
 * `ASSISTS` 同一個做法。
 *
 * **`MEMBERS` 與 `TARGET` 不得在同一次 `gather` 之間交錯使用** —— 它們是
 * 不同的陣列，但同一個陣列被 gather 兩次就會失去第一次的內容。
 */
const MEMBERS: CommandUnit[] = []
const TARGET: CommandUnit[] = []
const OTHERS: CommandUnit[] = []
const FOES: CommandUnit[] = []
/** 見底排序用的模組層暫存。熱路徑：不配置。 */
const RATIOS: number[] = []
const TARGET_IDX: number[] = []
/** 排名的輸出。重用，理由同上 */
const RANKED: number[] = []

/** 把一個分隊的存活成員收進 `out`（先清空）。不配置 */
function gather(
  out: CommandUnit[], flight: CommandFlight, units: readonly CommandUnit[],
): void {
  out.length = 0
  for (let p = 0; p < flight.count; p++) {
    const u = units[flight.members[p]!]
    if (u !== undefined && u.alive) out.push(u)
  }
}

/** 一個分隊的存活質心離 `p` 多遠。全滅時回 `Infinity`（比不上任何門檻） */
function centroidDistance(
  flight: CommandFlight, units: readonly CommandUnit[], p: Vector3,
): number {
  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return Infinity
  return Math.hypot(cx / n - p.x, cy / n - p.y, cz / n - p.z)
}

/**
 * 分隊長機離 `p` 多遠。全滅時回 `Infinity`（比不上任何門檻）。
 *
 * 【為什麼掃第一個**存活**的成員而不是 `members[0]`】`compactFlights` 每個
 * 物理步保序重壓，正常情況下 `members[0]` 就是活著的長機。但這一層吃的是
 * 快照，壓縮與 `stepCommand` 的先後順序是呼叫端的事 —— 寫死索引 0 會在
 * 「長機剛陣亡、還沒重壓」的那一格算到一具屍體的座標，命令從此解除不了。
 * 保序壓縮下「第一個存活者」與「繼位後的長機」是同一架，所以這不是近似。
 */
function leaderDistance(
  flight: CommandFlight, units: readonly CommandUnit[], p: Vector3,
): number {
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    return Math.hypot(u.position.x - p.x, u.position.y - p.y, u.position.z - p.z)
  }
  return Infinity
}

/** 已經收集好的一群的質心離 (x,y,z) 多遠。全滅時回 `Infinity` */
function centroidDistanceTo(
  group: readonly CommandUnit[], x: number, y: number, z: number,
): number {
  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < group.length; i++) {
    const u = group[i]!
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return Infinity
  return Math.hypot(cx / n - x, cy / n - y, cz / n - z)
}
