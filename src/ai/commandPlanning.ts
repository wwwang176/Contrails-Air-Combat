import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEFAULT_STEER } from './steerConfig'
import { DEFAULT_COMMAND, FLANK_RANGE, type CommandConfig } from './commandConfig'
import type { CommandFlight, CommandUnit, FlightOrder } from './commandTypes'

/** 水平方向退化的下限。與 `station.ts` 的 `MIN_GROUND_SPEED` 同一個量級 */
const MIN_HORIZONTAL = 1e-3

/**
 * 撤退令的最短行程，是 `arriveRadius` 的幾倍。分隊離殼比這個近就不發令。
 *
 * 【為什麼是 3】判準是「這張命令活得比一個決策週期久嗎」。短於
 * `spentSeconds`(3 s) + `planPeriod`(2 s) 的命令唯一的作用是把見底計時歸零，
 * 飛機幾乎沒動。實測巡弋約 110 m/s，5 秒是 550 m；3 × 300 = 900 m 約 8 秒。
 *
 * 【為什麼不是新參數】它由 `arriveRadius` 導出，兩者本來就不獨立 ——
 * `arriveRadius` 是到達判定的解析度，行程至少要是它的數倍才有意義。
 */
const MIN_TRIP_RATIO = 3

/**
 * 「這個敵分隊已經在交戰」的 `cornerRatio` 門檻。
 *
 * 0.9 高於指揮層的 `spentRatio`（0.6，「已經打不動」）而低於自由巡航 ——
 * 語意是「有人正在讓它拉桿」。與見底判定用同一個量，不新增概念。
 *
 * 【它是**觸發**，第三份會整條換掉。不要掃描它】刻意不放進 `CommandConfig`：
 * 放進去會讓人以為它與那八個**執行**參數同一個地位，於是被一起掃描 ——
 * 那就是在調第三份的東西（spec §2、§3.3）。
 */
const ENGAGED_RATIO = 0.9

const P = makeScratch(4)

/** `flankPoint` 專用的暫存池。與其他函式分開，避免巢狀呼叫時別名衝突 */
const F = makeScratch(5)

/** 選邊時「兩邊一樣安全」的判定寬容度。低於它就改用就近 */
const DANGER_TIE = 1e-9

/**
 * 這個小隊此刻該收到什麼命令。`null` = 自由交戰。
 *
 * **純函數**：只讀 `members` 與 `enemies`，不改它們，不碰世界。這是
 * spec §7.1 那一層驗收的前提 —— 混戰的結果太吵，從結果反推判斷品質驗不出
 * 東西，必須能直接餵快照出考題。
 *
 * 【它不判斷「見底了沒」】那是 `stepCommand` 的事（它才有跨步的計時器）。
 * 這裡收到的 `spentSeconds` 是已經累積好的秒數 —— 與 `defendAim` 收
 * `axisSign` 而不自己決定號誌是同一個分工：純函數沒有「這是不是第一格」
 * 的資訊。
 *
 * 【配置】發令時配置一個 `Vector3`。它每 `planPeriod` 秒才可能發生一次，
 * **不在 240 Hz 的熱路徑上**。
 *
 * @param spentSeconds 這個小隊「最低那一架連續低於門檻」已經累積的秒數
 */
export function planFlightOrder(
  members: readonly CommandUnit[],
  enemies: readonly CommandUnit[],
  spentSeconds: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  if (spentSeconds < cfg.spentSeconds) return null

  // ── 小隊質心、平均速度、最低升限 ──────────────────────
  const own = P.v[0]!.set(0, 0, 0)
  const vel = P.v[1]!.set(0, 0, 0)
  let n = 0
  let ceiling = Infinity
  for (let i = 0; i < members.length; i++) {
    const m = members[i]!
    if (!m.alive) continue
    own.add(m.position)
    vel.add(m.velocity)
    if (m.serviceCeiling < ceiling) ceiling = m.serviceCeiling
    n++
  }
  if (n === 0) return null
  own.divideScalar(n)
  vel.divideScalar(n)

  // ── 敵群質心 ──────────────────────────────────────────
  const foe = P.v[2]!.set(0, 0, 0)
  let e = 0
  for (let i = 0; i < enemies.length; i++) {
    const t = enemies[i]!
    if (!t.alive) continue
    foe.add(t.position)
    e++
  }
  // 【沒有敵人就沒有命令】撤離是相對某個威脅而言的。沒有威脅時把小隊送去
  // 遠方只是把它移出戰場。
  if (e === 0) return null
  foe.divideScalar(e)

  // ── 方向：由敵群指向小隊，取水平分量 ────────────────────
  // 退化階梯與 `stationPoint`、`unloadAim` 一致：
  // 首選 → 次選 → 固定方向。**不 return、不留 NaN。**
  const dir = P.v[3]!.set(own.x - foe.x, 0, own.z - foe.z)
  let len = dir.length()
  // 【距離要在退化階梯之前另存】`len` 下面會被改成速度長度、甚至 1
  const gap = len
  if (len < MIN_HORIZONTAL) {
    // 敵我質心水平重合：「遠離」沒有定義，改用小隊自己的前進方向
    dir.set(vel.x, 0, vel.z)
    len = dir.length()
    if (len < MIN_HORIZONTAL) {
      // 連速度也退化：任何固定方向都一樣好，重點是不要產生 NaN
      dir.set(0, 0, -1)
      len = 1
    }
  }
  dir.divideScalar(len)

  // ── 閘門：行程不夠長就不發令 ──────────────────────────
  // 【為什麼需要它】行程長度是 |withdrawRange − gap|。少了閘門有兩個失敗：
  //
  //   gap ≈ 殼 → 行程短於到達半徑，命令在**下一格**就被判到達
  //     （`stepCommand` 的 rally 分支）、`spent` 被歸零，飛機一步都沒動 ——
  //     撤退在那一帶等於失效，而既有的「多數命令要到得了」會變成假綠。
  //   gap > 殼 → 「撤退令」會把一支 `intent` 被壓成 `rally`、不開火、僚機
  //     被清目標的四機編隊沿徑向直線送回敵群。那正是要救的分隊。
  //
  // 【為什麼用 gap 不用 len】`len` 在上面的退化階梯裡會被重新賦值成**速度
  // 的長度**（敵我水平重合時），最後一階直接設成 1。用 `len` 的話行為會
  // 取決於速度大小而不是敵我距離。
  if (gap >= cfg.withdrawRange - cfg.arriveRadius * MIN_TRIP_RATIO) return null

  // ── 高度：撤退不改變高度，只夾在安全下界與最低升限之間 ────
  // 【為什麼不加碼】`own.y + withdrawClimb` 那種寫法賭的是「爬起來的高度
  // 之後換得回速度」，而實測沒有發生：20v20 四分鐘裡高度 +2000 m 而 TAS
  // 一直停在 110。而且高度不能像水平那樣錨在敵群 —— 那會變成互相加價
  // （紅爬到藍 +800，藍下一張就是紅 +800），一路頂到升限；垂直方向沒有
  // 「背對」這種把兩隊分開的自由度。撤退要補的是**速度**，而爬升是消耗
  // 速度的動作。
  //
  // 【下界取 clearanceScale（500）而不是安全層的固定餘裕（30／100 m）】政策層
  // 不該把飛機送進硬限制的作用區。與 task #136 的六場護欄取同一條線。
  //
  // 【這道下界是活碼】任何 500 m 以下的分隊都會被抬上來 —— 也就是「撤退
  // 不改變高度」在低空是假的。加碼版（own.y + 800）要 own.y < −300 才咬
  // 得到，等於永遠不觸發。
  //
  // 【目前海面恆為 0】未來加入地形時這裡要與 `stationPoint` 一樣收
  // `seaHeight`，下界改成 `seaHeight + clearanceScale`。
  let y = own.y
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  return {
    kind: 'rally',
    // 【錨在敵群，不是自己】錨在自己的話位移量與「已經跑多遠」無關 ——
    // 那是一個沒有不動點的純積分器。錨在敵群之後這是一個固定的球殼，
    // 而且撤退本身不移動錨點（敵群質心不因我方撤退而動）。
    point: new Vector3(
      foe.x + dir.x * cfg.withdrawRange,
      y,
      foe.z + dir.z * cfg.withdrawRange,
    ),
    radius: cfg.arriveRadius,
    targetFlight: -1,
    side: 0,
    focusIndex: -1,
  }
}

/**
 * 側翼點的幾何。寫進 `out`，回傳 `false` 代表輸入退化到連質心都算不出來
 * （呼叫端保留舊點）。
 *
 * ```
 * u    = 目標分隊平均速度的水平單位向量
 * r    = u 的右手側水平法向量
 * out  = 目標質心 − u × flankTrail + side × r × flankOffset
 * out.y = clamp(目標質心.y + flankClimb, clearanceScale, 我方最低升限)
 * ```
 *
 * `−u × flankTrail` 把點放到他們**後方**而不是正側方：正側方是一個過渡
 * 位置，後側方才是能開始追蹤射擊的位置。
 *
 * 【退化階梯】`CommandUnit` **沒有 orientation**，所以沒有「機首」可以像
 * `stationPoint` 那樣退回去。改成：目標速度退化 → 由我方質心指向目標質心
 * （把他們當成正在遠離我們，點因此落在我們與他們之間，可及而且安全）→
 * 兩個質心也重合 → 取世界 −Z。**不 return NaN**：NaN 一旦進入距離比較，
 * 所有比較都變成 false，小隊會靜靜地永遠飛不到而且完全不報錯。
 *
 * 熱路徑：不配置（`stepCommand` 每步呼叫它）。
 */
export function flankPoint(
  target: readonly CommandUnit[],
  own: readonly CommandUnit[],
  side: number,
  cfg: CommandConfig,
  out: Vector3,
): boolean {
  // ── 目標分隊的質心與平均速度 ──────────────────────────
  const foe = F.v[0]!.set(0, 0, 0)
  const vel = F.v[1]!.set(0, 0, 0)
  let m = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    if (!t.alive) continue
    foe.add(t.position)
    vel.add(t.velocity)
    m++
  }
  if (m === 0) return false
  foe.divideScalar(m)
  vel.divideScalar(m)

  // ── 我方質心與最低升限 ───────────────────────────────
  // 【上界取**我方**的升限】要飛上去的是我們，不是他們
  const us = F.v[2]!.set(0, 0, 0)
  let n = 0
  let ceiling = Infinity
  for (let i = 0; i < own.length; i++) {
    const u = own[i]!
    if (!u.alive) continue
    us.add(u.position)
    if (u.serviceCeiling < ceiling) ceiling = u.serviceCeiling
    n++
  }
  if (n === 0) return false
  us.divideScalar(n)

  // ── 航向 u，退化階梯 ─────────────────────────────────
  let ux = vel.x
  let uz = vel.z
  let len = Math.hypot(ux, uz)
  if (len < MIN_HORIZONTAL) {
    ux = foe.x - us.x
    uz = foe.z - us.z
    len = Math.hypot(ux, uz)
    if (len < MIN_HORIZONTAL) {
      ux = 0
      uz = -1
      len = 1
    }
  }
  ux /= len
  uz /= len

  // 右手側：three 是 +X 右、+Y 上、−Z 前，所以航向 (ux, uz) 的右邊是
  // (−uz, ux)。驗算：朝 −Z（ux=0, uz=−1）時右邊是 (1, 0) = +X。
  // 與 `stationPoint` 的同一段驗算一致。
  const rx = -uz
  const rz = ux

  let y = foe.y + cfg.flankClimb
  if (y > ceiling) y = ceiling
  if (y < DEFAULT_STEER.clearanceScale) y = DEFAULT_STEER.clearanceScale

  out.set(
    foe.x - ux * cfg.flankTrail + side * rx * cfg.flankOffset,
    y,
    foe.z - uz * cfg.flankTrail + side * rz * cfg.flankOffset,
  )
  return true
}

/**
 * 一個候選點的危險分數：其他敵機離它多近。
 *
 * ```
 * danger(p) = Σ 1 / (1 + (|p − e| / dangerScale)²)
 * ```
 *
 * 【為什麼是平方反比核而不是「半徑內的計數」】計數需要一個半徑門檻，而門檻
 * 會讓分數在邊界上跳。連續核在相鄰輸入上連續 —— 與 `targetScore` 的三個
 * 折扣項、`alarmRamp` 的連續斜坡同一條紀律（spec §7.5 的否決條件）。
 *
 * 【為什麼不算目標分隊自己】側翼點本來就該靠近它。把它算進去等於懲罰
 * 「靠近要打的人」—— 呼叫端傳進來的 `others` 已經排除了目標分隊。
 *
 * 【為什麼不算友機】友機不危險。這裡問的是「這個點會不會被打」。
 *
 * 熱路徑之外（每 `planPeriod` 秒），不配置。
 */
function dangerAt(p: Vector3, others: readonly CommandUnit[], cfg: CommandConfig): number {
  let sum = 0
  for (let i = 0; i < others.length; i++) {
    const e = others[i]!
    if (!e.alive) continue
    const d = p.distanceTo(e.position) / cfg.dangerScale
    sum += 1 / (1 + d * d)
  }
  return sum
}

/**
 * 從敵分隊的後側方切進去。`null` = 不該下這張命令。
 *
 * **純函數**：只讀三個快照陣列，不改它們，不碰世界（spec §6.3）。
 *
 * 【三種 `null`】目標分隊沒在交戰（spec §3.1 的開場死鎖防護）、任一邊全滅、
 * 兩個候選點都太危險。最後一條與 `planFocusTarget` 的「沒有一架可及」是同一
 * 條紀律：**規劃層寧可不發，也不發一張執行不了的命令。**
 *
 * 【配置】發令時配置一個 `Vector3`，每 `planPeriod` 秒最多一次，
 * **不在 240 Hz 的熱路徑上**。
 *
 * @param others 其餘敵機（**不含**目標分隊），算危險分數用
 * @param targetFlight 目標分隊的全域索引，原封不動寫進命令
 */
export function planFlankOrder(
  members: readonly CommandUnit[],
  target: readonly CommandUnit[],
  others: readonly CommandUnit[],
  targetFlight: number,
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  // ── 開場死鎖防護（spec §3.1）────────────────────────────
  // 目標分隊要**已經被別人纏住**。少了這道閘門，開場所有人同時側翼、
  // 途中又不交戰，兩隊會互相繞圈一槍不開 —— 而且會自我維持
  let engaged = false
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    if (t.alive && t.cornerRatio < ENGAGED_RATIO) { engaged = true; break }
  }
  if (!engaged) return null

  const right = P.v[0]!
  const left = P.v[1]!
  if (!flankPoint(target, members, 1, cfg, right)) return null
  if (!flankPoint(target, members, -1, cfg, left)) return null

  const dr = dangerAt(right, others, cfg)
  const dl = dangerAt(left, others, cfg)

  let side: number
  if (dr < dl - DANGER_TIE) side = 1
  else if (dl < dr - DANGER_TIE) side = -1
  else {
    // 【一樣安全就取近的】轉場最短，也就是輸出為零的時間最短。
    // 用我方質心到兩個候選點的距離比
    const us = P.v[2]!.set(0, 0, 0)
    let n = 0
    for (let i = 0; i < members.length; i++) {
      const u = members[i]!
      if (!u.alive) continue
      us.add(u.position)
      n++
    }
    // n === 0 不可能走到這裡（flankPoint 已經回 false 了），但索引後的
    // 除法還是要防：NaN 會讓下面的比較靜靜地變成 false
    if (n > 0) us.divideScalar(n)
    side = us.distanceTo(right) <= us.distanceTo(left) ? 1 : -1
  }

  const chosen = side === 1 ? right : left
  if ((side === 1 ? dr : dl) > cfg.dangerLimit) return null

  return {
    kind: 'flank',
    point: chosen.clone(),
    radius: cfg.arriveRadius,
    targetFlight,
    side,
    focusIndex: -1,
  }
}

/**
 * 叫整隊集火同一架。`null` = 沒有任何一架可及。
 *
 * **純函數**，理由同 `planFlankOrder`。
 *
 * 【挑血最少的，不是 `targetScore` 最高的】`targetScore` 吃 `Aircraft`
 * （要 orientation 算機首、要 `threatFactor`），收它會毀掉這一層能出考題的
 * 性質；用速度方向代替機首是一個近似，而近似會製造第二個「誰好打」的答案。
 *
 * 而且「血最少」本來就是更對的判準：集火的整個賣點是**讓目標更快掉下來**，
 * 已經受創的那一架離掉下來最近 —— 這是史實的「打落單、打受傷」。
 * `targetScore` 回答的是另一個問題（「誰對**我**最有價值」，含威脅項與機會
 * 項），那是**單機**選目標的問題，不是**小隊集火**的問題。
 *
 * 【可及性是閘門不是加權項】一個追不到的目標再好打也沒用。寫成加權會在
 * 「重傷但追不到」與「健康但就在眼前」之間挑錯，有測試守著。
 *
 * @param candidateIndices 與 `candidates` **平行**，內容是 `units` 的全域索引
 */
export function planFocusTarget(
  members: readonly CommandUnit[],
  candidates: readonly CommandUnit[],
  candidateIndices: readonly number[],
  cfg: CommandConfig = DEFAULT_COMMAND,
): FlightOrder | null {
  // ── 我方質心與平均航向 ───────────────────────────────
  const us = P.v[0]!.set(0, 0, 0)
  const vel = P.v[1]!.set(0, 0, 0)
  let n = 0
  for (let i = 0; i < members.length; i++) {
    const u = members[i]!
    if (!u.alive) continue
    us.add(u.position)
    vel.add(u.velocity)
    n++
  }
  if (n === 0) return null
  us.divideScalar(n)
  vel.divideScalar(n)

  // 【速度退化時錐形閘門放行】沒有速度就沒有「我們正在去的方向」。把所有人
  // 都擋掉會讓集火在重生瞬間靜靜地失效 —— 而那不是一個看得出來的失效
  let hx = vel.x
  let hz = vel.z
  const hlen = Math.hypot(hx, hz)
  const hasHeading = hlen >= MIN_HORIZONTAL
  if (hasHeading) { hx /= hlen; hz /= hlen }

  const cosCone = Math.cos(cfg.focusCone)

  let best = -1
  let bestHp = Infinity
  let bestDist = Infinity
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!
    if (!c.alive) continue

    const dist = us.distanceTo(c.position)
    if (dist > cfg.focusRange) continue

    if (hasHeading) {
      const dx = c.position.x - us.x
      const dz = c.position.z - us.z
      const dlen = Math.hypot(dx, dz)
      // 【水平重合時放行】方位沒有定義，而「就在我們頭上」不該被當成
      // 「偏離航向」擋掉
      if (dlen >= MIN_HORIZONTAL && (dx * hx + dz * hz) / dlen < cosCone) continue
    }

    // 血少的優先；同值取近的
    if (c.hpFraction < bestHp || (c.hpFraction === bestHp && dist < bestDist)) {
      best = i
      bestHp = c.hpFraction
      bestDist = dist
    }
  }
  if (best < 0) return null

  return {
    kind: 'focus',
    // 【集火不用點】給一個新的零向量而不是共用一個模組層級的常數 ——
    // 共用的可變向量被誰改到都查不出來。每 `planPeriod` 秒最多一次，不在
    // 熱路徑上
    point: new Vector3(),
    radius: 0,
    targetFlight: -1,
    side: 0,
    focusIndex: candidateIndices[best]!,
  }
}

/**
 * 把「該優先考慮」的分隊排出來，寫進 `out`（先清空）。
 *
 * **純函數**：只讀五個陣列，不改它們，不碰世界。與三個規劃函式同一個地位。
 *
 * 分數只問一件事：**這支分隊連續多久沒有人握著射擊解**（`idle`）。閒最久的
 * 排最前面 —— 問的是「叫誰去，損失最小」，不是「誰最有機會」（spec §4.1）。
 *
 * 【排名刻意不看敵方】要不要發、發給誰打由 `planFocusTarget` 決定；排名只
 * 回答「先考慮誰」。我方這邊看閒置度，敵方那邊看有沒有打得到的目標，各管
 * 一半，不重疊 —— 同一個問題不要有兩個答案。
 *
 * 【為什麼已持有命令的不進榜】遲滯就是這樣免費來的：命令照既有的解除條件
 * 走，不會出現「這一輪排第 3 拿到命令、下一輪排第 6 又被收回」的抖動。
 *
 * 【為什麼是插入排序】`own` 最多五個元素，而插入排序是**穩定**的 —— 由於
 * `own` 是遞增的，同 `idle` 值自然保持索引由小到大，破平手不需要額外的
 * 比較。決定性是 spec §7.4 的否決條件，靠 `Array.prototype.sort` 的實作
 * 細節來破平手是不能接受的。
 *
 * 熱路徑之外（每 `planPeriod` 秒），不配置。
 *
 * @param own        這個指揮官管的分隊索引，**必須是遞增的**
 * @param orders     每個分隊當下的命令，`null` = 沒有
 * @param idle       每個分隊的閒置秒數
 * @param skipFlight 不下命令的分隊索引（玩家所在的那一隊）；−1 = 都下
 * @param out        輸出。呼叫前不必清空，這裡會清
 */
export function rankFlights(
  flights: readonly CommandFlight[],
  own: readonly number[],
  units: readonly CommandUnit[],
  orders: readonly (FlightOrder | null)[],
  idle: Readonly<Float32Array>,
  skipFlight: number,
  out: number[],
  cfg: CommandConfig = DEFAULT_COMMAND,
): void {
  out.length = 0

  for (let oi = 0; oi < own.length; oi++) {
    const f = own[oi]!
    if (f === skipFlight) continue

    const flight = flights[f]
    if (flight === undefined || flight.count === 0) continue

    const o = orders[f]
    if (o !== undefined && o !== null) continue

    if ((idle[f] ?? 0) < cfg.idleSeconds) continue

    // 【成員全滅但 count 還沒壓縮】同一步裡 compactFlights 可能還沒跑過
    let alive = false
    for (let p = 0; p < flight.count; p++) {
      const u = units[flight.members[p]!]
      if (u !== undefined && u.alive) { alive = true; break }
    }
    if (!alive) continue

    out.push(f)
  }

  // 插入排序，idle 大的在前。穩定，所以同值保持 `own` 的遞增順序
  for (let i = 1; i < out.length; i++) {
    const v = out[i]!
    const iv = idle[v] ?? 0
    let j = i - 1
    while (j >= 0 && (idle[out[j]!] ?? 0) < iv) {
      out[j + 1] = out[j]!
      j--
    }
    out[j + 1] = v
  }
}

/**
 * 側翼到位了嗎 —— **幾何判定，不是距離**。
 *
 * ```
 * u = 敵分隊平均速度的水平單位向量
 * d = 由敵分隊質心指向我方質心的水平單位向量
 * 到位 ⇔ d · u < cos(flankSector)  且  兩個質心的距離 < FLANK_RANGE
 * ```
 *
 * 【為什麼不用「離側翼點小於 arriveRadius」】那個判準在追一個移動目標時
 * 可能永遠不成立，正是第一份 spec §4.1 記載的病 —— 而敵**分隊**質心 30 秒
 * 飄 2040~4663 m（實測）。幾何判準不會過期。
 *
 * 【為什麼距離門用 `FLANK_RANGE` 而不是新的一個數字】側翼命令的**發出**
 * 條件就是距離 > `FLANK_RANGE`，所以解除用同一條線不會抖：解除的那一格
 * 距離必然 < `FLANK_RANGE`，下一次規劃走的是集火那一支。
 *
 * 熱路徑：不配置（每步呼叫）。
 */
export function flankArrived(
  members: readonly CommandUnit[],
  target: readonly CommandUnit[],
  cfg: CommandConfig,
): boolean {
  let fx = 0, fy = 0, fz = 0, vx = 0, vz = 0, m = 0
  for (let i = 0; i < target.length; i++) {
    const t = target[i]!
    fx += t.position.x; fy += t.position.y; fz += t.position.z
    vx += t.velocity.x; vz += t.velocity.z
    m++
  }
  if (m === 0) return false
  fx /= m; fy /= m; fz /= m; vx /= m; vz /= m

  let ux = vx
  let uz = vz
  const ulen = Math.hypot(ux, uz)
  // 【速度退化時不算到位】方向沒有定義就沒有「後側方」可言。回 false 讓
  // 命令繼續 —— 比誤判到位安全，下一步速度多半就回來了
  if (ulen < MIN_HORIZONTAL) return false
  ux /= ulen; uz /= ulen

  let cx = 0, cy = 0, cz = 0, n = 0
  for (let i = 0; i < members.length; i++) {
    const u = members[i]!
    cx += u.position.x; cy += u.position.y; cz += u.position.z; n++
  }
  if (n === 0) return false
  cx /= n; cy /= n; cz /= n

  if (Math.hypot(cx - fx, cy - fy, cz - fz) >= FLANK_RANGE) return false

  let dx = cx - fx
  let dz = cz - fz
  const dlen = Math.hypot(dx, dz)
  // 【水平重合】方位沒有定義。當成到位 —— 已經貼在他們身上了
  if (dlen < MIN_HORIZONTAL) return true
  dx /= dlen; dz /= dlen

  return dx * ux + dz * uz < Math.cos(cfg.flankSector)
}
