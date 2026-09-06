import { DEFAULT_SAFETY, type SafetyConfig } from './safety'
import { maxLoadFactorAero } from '../analysis/envelope'
import { G0 } from '../core/math'
import type { Aircraft } from '../aircraft/Aircraft'
import { WOBBLE_MAX, type IslandDesc } from '../world/archipelago'
import type { LandField } from '../world/occlusion'

/**
 * AI 的地形感知。
 *
 * ```
 *   broad phase   當前航跡是一條**線段**（不介入時飛機確實直飛）
 *                 對島的膨脹圓做精確的線段-圓相交
 *   驗算          「如果我往那邊轉」是一段**圓弧**，半徑
 *                 R = V²/(g·√(n²−1))。弧與圓的最小距離有閉式解
 * ```
 *
 * 【為什麼驗算非用圓弧不可】「把航向瞬間旋轉，再測一條直線」犯的是射線法
 * 的同一個毛病：直線假設飛機瞬間轉向。實測 800 km/h 下轉到 45° 要 498 m
 * 弧長，障礙在 300 m 處時橫向只偏了 69 m —— 直線版會說「那邊是空的」，
 * 然後飛機照撞。
 *
 * 【為什麼不查高度場】沿航跡取樣高度會漏：步長比格距大時，射線跨得過一整座
 * 窄峰。島本來就是圓，用圓去判斷是解析的，而且**知道自己在繞哪一座島** ——
 * 解除條件因此寫得出來。
 *
 * 熱路徑（20 Hz × 40 架），不配置。
 */

/**
 * 前視距離，m。
 *
 * 繞開一堵牆的成本是轉彎半徑乘上安全倍率 —— K-4 在 800 km/h 滿載過載時是
 * 1,016 m。翻越一座 1,000 m 的山要 2,747 m，但**AI 不需要翻山，只需要繞開**。
 *
 * 【轟炸機不夠】He 111 在 600 km/h、3.5 G 的半徑是 845 m，乘 1.5 是 1,267 m。
 * 飛行掃描涵蓋機型維度，掃出撞山就從這裡加。
 */
export const SENSE_RANGE = 1200

/**
 * 每幾個物理步重算一次。240 Hz ÷ 12 = 20 Hz。
 *
 * 地形是靜態的。800 km/h 下飛機每個物理步只走 0.926 m，12 步之間走 11.11 m
 * —— 遠小於島的膨脹半徑。**呼叫端必須按機號錯開相位**，否則 40 架同一步
 * 全算會做出週期性尖峰，直接打在 1% low 上。
 */
export const SENSE_INTERVAL = 12

/** 沿航跡檢查剖面的點數 */
const PROFILE_STEPS = 8

/** 機體膨脹的固定餘裕，m。半翼展之外再加這麼多 */
const BODY_MARGIN = 20

/** 轉向的上限，rad */
const MAX_TURN = (60 * Math.PI) / 180

/**
 * 驗算時試的轉向角，rad。由小到大 —— **偏離航向最小的可行解優先**，
 * 多轉的每一度都是掉出戰鬥位置的代價。
 */
const TURN_STEPS = [15, 30, 45, 60].map((d) => (d * Math.PI) / 180)

/**
 * 連續這麼多次判定「已經沒有交會」才解除鎖存。
 *
 * 【設計時本來還有一條「最短鎖存 0.5 秒」，實作時拿掉了】解除的幾何條件
 * 已經涵蓋它。加上時間下限反而有害：高速掠過一座 300 m 的小島只要兩三次
 * 感知就過去了，硬等滿 0.5 秒的話 AI 會對著一個早就沒有威脅的方向繼續轉。
 */
const CLEAR_SAMPLES = 3

/** 半徑大於這個值就當直線算，避免 R → ∞ 時的數值問題 */
const STRAIGHT_R = 1e6

/**
 * AI 需要的地形資訊。
 *
 * 【`islands` 與 `land` 是兩件事，不是同一件的兩種寫法】避障讀 `islands`：
 * 用解析的圓盤，因為那一層漏判的代價是**撞山**。遮蔽讀 `land`：它要的正是
 * 「畫面上那個面」，而且漏判的代價只是**多開一輪空槍**。
 *
 * 【`land` 是可選的】既有的考題全部是 `{ islands }`，一個字都不用改。
 */
export interface TerrainSource {
  readonly islands: readonly IslandDesc[]
  readonly land?: LandField | null
}

/** 可變，由 `senseTerrain` 就地填寫 —— 熱路徑不得配置 */
export interface TerrainSense {
  /** 沿航跡的最高地形，m。餵給 `applySafety` 當地板高度 */
  floor: number
  /** 這一次要下的航向偏移，rad。0 = 不轉（不需要，**或無處可去**） */
  turn: number
  /**
   * 承諾的規避方向，−1／+1；0 = 沒有承諾。
   *
   * 【為什麼與 `turn` 分開】`turn` 會因為「這一刻兩側都被堵住」而變成 0，
   * 而承諾不該跟著消失 —— 否則下一次感知會把 0 當成正側，原本的負側承諾
   * 就翻面了，那就是換一個觸發條件的乒乓。
   */
  side: -1 | 0 | 1
  /** 正在繞哪一座島；−1 = 沒有。與 `side` 一起構成鎖存 */
  island: number
  /** 連續判定「已經沒有交會」的次數 */
  clearSamples: number
}

export function createSense(): TerrainSense {
  return { floor: 0, turn: 0, side: 0, island: -1, clearSamples: 0 }
}

/**
 * 清空。**`playerAi` 跨場重用，`resetBattle` 也會建新的控制器** —— 上一場
 * 「我正在繞第 17 座島」的承諾不得帶進新的一場或新的座位。
 */
export function resetSense(s: TerrainSense): void {
  s.floor = 0
  s.turn = 0
  s.side = 0
  s.island = -1
  s.clearSamples = 0
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 線性內插的餘裕，m。**加在解析上界之上。**
 *
 * 【為什麼非有不可】`terrainCeiling` 的推導對的是**解析**的地形，而撞地判定
 * 與畫面讀的是 40 m 格的**線性內插**（見 `world/heightfield.ts`）。剖面在
 * 山腳是**凸**的，而凸函數的弦在函數之上 —— 所以格與格之間內插出來的值可以
 * 高過解析值。
 *
 * 【25 是量出來的】掃全圖 48 座島、5 m 步長（每格 8×8 個內部點），
 * `field.sample − terrainCeiling` 的最大值是 **16.39 m**（第 25 座島，
 * 半徑 166、峰 147）。25 留了五成餘裕。
 *
 * 【為什麼不改成取四個格點的 max】那是嚴格的界（內插是四個格點的線性組合），
 * 但要讓 AI 認得高度場的格線 —— 而這一層刻意不查高度場（見檔頭）。
 * 一個常數換掉那個相依。
 *
 * 【動了 FIELD_CELL 或島的剖面就要重量】`scratchpad/overshoot.ts` 那一支。
 */
const CEILING_MARGIN = 25

/**
 * (x, z) 那一點上，地形高度的**上界**，m。
 *
 * ── 【為什麼逐瓣算真正的二維距離】───────────────────────────────
 *
 * 島是好幾瓣取聯集（見 `world/archipelago.ts` 的 `LobeDesc`）。這裡若是
 * 一條只吃「離島心多遠」的剖面，那在圓對稱的島上是對的，多瓣之後有兩個
 * 相反的毛病：
 *
 * ```
 *   低估   偏心的次峰在單錐模型裡看不見 —— 實測在真的群島上差 284 m，
 *          而低估的方向是「我爬得過去」
 *   高估   改成「這一圈上最高的那一瓣」之後方向對了，但那一圈繞島一整周
 *          —— 航跡從東邊掠過時會被島**西邊**的次峰嚇到。實測 20v20 甲板
 *          高度下橫向規避因此一次都不再觸發（5/40 → 0/40）
 * ```
 *
 * 逐瓣量真正的二維距離把兩個毛病一起解掉：偏心的次峰看得見，而看不見的
 * 那幾顆不會算進來。
 *
 * ── 【為什麼仍然是上界】──────────────────────────────────────
 *
 * 尺度用 `radius × WOBBLE_MAX` 而不是這個方位真正的 `radius × wobble`，
 * 所以 smoothstep 的引數偏小、算出來的高度偏大；海床那一項
 * （`+ SEA_FLOOR × (1 − s)`）也刻意漏掉。**對解析的地形，估計恆 ≥ 實際。**
 *
 * 【但畫面上那一份不是解析的】撞地判定讀的是 40 m 格的線性內插，而它在
 * 凸的地方會高過解析值 —— 實測最多 16.39 m。那一段由 `CEILING_MARGIN`
 * 補上，所以對**內插後**的地形估計也恆 ≥ 實際。
 *
 * 【`export` 是給測試的】這件事沒有別的觀測點：`checkClimb` 只在**取樣到
 * 的**點上用它，所以走 `senseTerrain` 量到的是取樣夠不夠密，不是估計準不準。
 */
export function terrainCeiling(isl: IslandDesc, x: number, z: number): number {
  let best = 0
  const lobes = isl.lobes
  for (let i = 0; i < lobes.length; i++) {
    const lo = lobes[i]!
    const t = Math.hypot(x - lo.cx, z - lo.cz) / (lo.radius * WOBBLE_MAX)
    if (t >= 1) continue
    const h = lo.peak * smoothstep(1, 0, t)
    if (h > best) best = h
  }
  return best > 0 ? best + CEILING_MARGIN : 0
}

/** 這一架現在的轉彎半徑，m。`nMax` 已經含重力與失速限制 */
function turnRadius(self: Aircraft): number {
  const tas = self.state.velocity.length()
  const n = Math.min(
    maxLoadFactorAero(self.spec, self.state.position.y, tas),
    self.spec.limits.gPositive,
  )
  if (!(n > 1) || !(tas > 1)) return STRAIGHT_R
  const r = (tas * tas) / (G0 * Math.sqrt(n * n - 1))
  return r > STRAIGHT_R ? STRAIGHT_R : r
}

/**
 * 一段轉彎弧與一個點的最小距離，m。**閉式解，不取樣。**
 *
 * 弧上一點到目標的距離平方是 `R² + d² − 2Rd·cos(θ − θ*)`（餘弦定理），
 * 所以極小值只有一個，落在 `θ = θ*`。若 `θ*` 落在飛機會走過的那一段裡，
 * 最小距離就是 `|R − d|`；否則距離在該段上單調，最小值在兩個端點之一。
 *
 * @param sign 轉向的正負。與 `applySafety` 的旋轉式同一組約定：
 *             正的 turn 把航向轉向 `(−dz, dx)` 那一側
 */
function arcMinDistance(
  px: number, pz: number, dx: number, dz: number,
  radius: number, sign: number, tx: number, tz: number, range: number,
): number {
  if (radius >= STRAIGHT_R) {
    // 退化成線段-點：夾住投影再量
    const t = Math.max(0, Math.min(range, (tx - px) * dx + (tz - pz) * dz))
    return Math.hypot(tx - (px + dx * t), tz - (pz + dz * t))
  }
  // 轉彎圓心在飛機的側方 radius 處
  const sx = -dz * sign
  const sz = dx * sign
  const cx = px + sx * radius
  const cz = pz + sz * radius

  const d = Math.hypot(tx - cx, tz - cz)
  const a0 = Math.atan2(pz - cz, px - cx)
  const ai = Math.atan2(tz - cz, tx - cx)
  const thetaMax = range / radius

  // sign > 0 時 θ 遞增（半徑向量 × 速度為正，逆時針）
  const TAU = Math.PI * 2
  let dtheta = (ai - a0) * (sign > 0 ? 1 : -1)
  dtheta = ((dtheta % TAU) + TAU) % TAU
  if (dtheta <= thetaMax) return Math.abs(radius - d)

  const dStart = Math.hypot(tx - px, tz - pz)
  const te = a0 + (sign > 0 ? thetaMax : -thetaMax)
  const ex = cx + radius * Math.cos(te)
  const ez = cz + radius * Math.sin(te)
  const dEnd = Math.hypot(tx - ex, tz - ez)
  return dStart < dEnd ? dStart : dEnd
}

/** broad phase 的結果。模組級，避免在熱路徑配置 */
const hit = { index: -1, along: 0, perp: 0, centre: 0, enter: 0 }

/**
 * 沿 (dx, dz) 找**最先遇到**的島。精確的線段-圓相交。
 *
 * 【不是加長矩形】初稿用 `along ∈ [−r, range+r] && |perp| ≤ r` 判斷，那是一個
 * 加長的方框，四個角會假命中（例如 along = −0.9r、perp = 0.9r 時離起點
 * 1.27r，線段根本沒碰到圓）。假命中只會讓 AI 過度規避、不會漏，但它同時
 * 也把「誰比較先遇到」排錯了。
 */
function findThreat(
  px: number, pz: number, dx: number, dz: number,
  islands: readonly IslandDesc[], margin: number, skip: number, range: number,
): boolean {
  hit.index = -1
  let nearest = Infinity
  for (let i = 0; i < islands.length; i++) {
    if (i === skip) continue
    const isl = islands[i]!
    const r = isl.outerRadius + margin
    const ox = isl.cx - px
    const oz = isl.cz - pz
    const along = ox * dx + oz * dz
    const perp = dx * oz - dz * ox
    if (perp > r || perp < -r) continue
    // 線段上離島心最近的那一點
    const t = along < 0 ? 0 : along > range ? range : along
    const nx = px + dx * t - isl.cx
    const nz = pz + dz * t - isl.cz
    if (nx * nx + nz * nz > r * r) continue
    // 進入點：沿航跡第一次碰到圓的距離
    const half = Math.sqrt(Math.max(0, r * r - perp * perp))
    const enter = along - half
    if (enter < nearest) {
      nearest = enter
      hit.index = i
      hit.along = along
      hit.perp = perp
      hit.centre = Math.hypot(ox, oz)
      hit.enter = enter
    }
  }
  return hit.index >= 0
}

/**
 * 沿航跡爬得過這座島嗎？順便回報沿途最高的地形。
 *
 * 【八個等距點是取樣，抓不到極值】剖面平滑不等於有限點抓得到峰頂 ——
 * 一座 400 m 直徑的小島，峰頂可能落在兩點之間。
 *
 * 【所以把每一瓣自己的最近點補進來】`terrainCeiling` 是逐瓣取 max，而第 i 瓣
 * 沿航跡的極大值就落在「航跡離那一顆瓣心最近」的地方，也就是
 * `s = (c_i − p) · d`。主瓣那一顆就是「離島心最近的那一點」，
 * 所以這是**純追加**。
 *
 * 少了它的症狀是漏掉一整座次峰 —— 實測一顆合法的次峰因此由 550 m 讀成
 * 549.36 m（等距點剛好擦過峰肩），而窄的那一批漏得更多。
 */
const climb = { ok: true, floor: 0 }
function checkClimb(
  y0: number, isl: IslandDesc,
  px: number, pz: number, dx: number, dz: number, cfg: SafetyConfig,
): void {
  const tanP = Math.tan(cfg.recoveryPitch)
  climb.ok = true
  climb.floor = 0
  const test = (s: number): void => {
    if (s < 0 || s > SENSE_RANGE) return
    const h = terrainCeiling(isl, px + dx * s, pz + dz * s)
    if (h > climb.floor) climb.floor = h
    if (y0 + s * tanP < h + cfg.clearance) climb.ok = false
  }
  /**
   * 【腳下那一點只進地板，不進「爬不爬得過」】等距取樣由 s = 150 起，所以
   * **飛機正下方的地形從來沒有被看過** —— 而 `floor` 正是拉起判斷的輸入。
   * 貼著一道稜線飛的時候，前方 150 m 可能已經降下去了。
   *
   * 【為什麼不讓它參與 climb.ok】那一項問的是「爬得過**前方**嗎」。把腳下
   * 算進去等於「我離地不足 120 m 就要轉」—— 那是 ground 分支的職責，
   * 而且甲板高度掠過小島時會一直觸發橫向規避。
   */
  climb.floor = terrainCeiling(isl, px, pz)
  for (let i = 1; i <= PROFILE_STEPS; i++) test((SENSE_RANGE * i) / PROFILE_STEPS)
  // 每一瓣自己的最近點：那一瓣沿航跡最高的地方
  const lobes = isl.lobes
  for (let i = 0; i < lobes.length; i++) {
    const lo = lobes[i]!
    test((lo.cx - px) * dx + (lo.cz - pz) * dz)
  }
}

/**
 * 往 sign 側轉 turn 之後，那條**路徑**還會不會撞上爬不過的島。
 *
 * 【路徑是弧段加直線段，不是一直轉下去】飛機轉到目標航向之後就直飛。
 * 初稿的驗算只算了「沿這一側的完整轉彎弧」，那與角度無關 —— 於是每個候選
 * 角度都得到同一個答案，pickTurn 挑不出東西來。
 *
 * 
 *
 * 【R 是物理量不是參數】重力在那個 −1 裡，失速由 maxLoadFactorAero 進到
 * n 裡。轉不動（失速或近乎靜止）時回 true —— 那時候任何轉向都是空話。
 */
function pathBlocked(
  self: Aircraft, px: number, pz: number, dx: number, dz: number, turn: number,
  islands: readonly IslandDesc[], margin: number, cfg: SafetyConfig,
): boolean {
  const radius = turnRadius(self)
  if (radius >= STRAIGHT_R) return true
  const sign = turn >= 0 ? 1 : -1
  const mag = Math.abs(turn)
  const arcLen = Math.min(mag * radius, SENSE_RANGE)
  const y0 = self.state.position.y
  const reach = y0 + SENSE_RANGE * Math.tan(cfg.recoveryPitch)

  for (let i = 0; i < islands.length; i++) {
    const isl = islands[i]!
    const r = isl.outerRadius + margin
    // 【已經在這座島的圓裡就跳過】「會不會進入圓」對它沒有意義 —— 飛機
    // 已經在裡面了，轉向的目的正是出去。不跳過的話每一個候選角度都會被
    // 判成 blocked，於是 pickTurn 回 0，而那是「最該全力轉開的時候不轉」。
    if (Math.hypot(isl.cx - px, isl.cz - pz) < r) continue
    if (arcMinDistance(px, pz, dx, dz, radius, sign, isl.cx, isl.cz, arcLen) < r) {
      if (reach < isl.peak + cfg.clearance) return true
    }
  }
  if (arcLen >= SENSE_RANGE) return false

  // 弧的終點與轉過去之後的航向
  const sx = -dz * sign
  const sz = dx * sign
  const cx = px + sx * radius
  const cz = pz + sz * radius
  const a0 = Math.atan2(pz - cz, px - cx)
  const te = a0 + (arcLen / radius) * sign
  const ex = cx + radius * Math.cos(te)
  const ez = cz + radius * Math.sin(te)
  const c = Math.cos(turn)
  const sn = Math.sin(turn)
  const nx = dx * c - dz * sn
  const nz = dx * sn + dz * c
  const rest = SENSE_RANGE - arcLen

  for (let i = 0; i < islands.length; i++) {
    const isl = islands[i]!
    const r = isl.outerRadius + margin
    if (Math.hypot(isl.cx - px, isl.cz - pz) < r) continue
    if (arcMinDistance(ex, ez, nx, nz, STRAIGHT_R, 1, isl.cx, isl.cz, rest) < r) {
      if (reach < isl.peak + cfg.clearance) return true
    }
  }
  return false
}

/**
 * 要讓航跡離島心 `need` 公尺，航向得偏多少（rad）。
 *
 * 【已經在圓內就直接全力轉】初稿寫成 `asin(need/c) − asin(|perp|/c)`，
 * 而 `centre ≤ need` 時兩項都飽和到 90°、相減趨近 0 —— **最該全力轉開的
 * 時候反而不轉**。
 */
function turnMagnitude(centre: number, perp: number, need: number): number {
  if (centre <= need) return MAX_TURN
  const c = Math.max(centre, 1)
  const want = Math.asin(Math.min(1, need / c))
  const have = Math.asin(Math.min(1, Math.abs(perp) / c))
  const t = want - have
  return t <= 0 ? 0 : t > MAX_TURN ? MAX_TURN : t
}

/**
 * 挑一個可行的轉向角。**偏離航向最小的可行解優先** —— 多轉的每一度都是
 * 掉出戰鬥位置的代價。回 0 表示這一側每個角度都走不通。
 */
function pickTurn(
  self: Aircraft, px: number, pz: number, dx: number, dz: number, sign: number,
  islands: readonly IslandDesc[], margin: number, cfg: SafetyConfig, want: number,
): number {
  for (const step of TURN_STEPS) {
    if (step < want) continue
    const turn = step * sign
    if (!pathBlocked(self, px, pz, dx, dz, turn, islands, margin, cfg)) return turn
  }
  return 0
}

export function senseTerrain(
  self: Aircraft, src: TerrainSource, out: TerrainSense,
  cfg: SafetyConfig = DEFAULT_SAFETY,
): void {
  const pos = self.state.position
  const vel = self.state.velocity
  let dx = vel.x
  let dz = vel.z
  const speed = Math.hypot(dx, dz)
  if (!(speed > 1e-3)) {
    // 水平速度為零時「前方」沒有定義。回「不介入」而不是回 NaN
    resetSense(out)
    return
  }
  dx /= speed
  dz /= speed

  const margin = self.spec.wing.span / 2 + BODY_MARGIN
  const islands = src.islands

  // ── 鎖存中 ──────────────────────────────────────────────────────────
  if (out.island >= 0 && out.island < islands.length) {
    const isl = islands[out.island]!
    const r = isl.outerRadius + margin
    const ox = isl.cx - pos.x
    const oz = isl.cz - pos.z
    const perp = dx * oz - dz * ox
    const centre = Math.hypot(ox, oz)

    checkClimb(pos.y, isl, pos.x, pos.z, dx, dz, cfg)
    out.floor = climb.floor

    /**
     * 【解除的判準是「不再有交會」，不是「通過了橫斷面」】初稿用
     * `along < 0 && centre > r`，而那用的是**當下航向** —— 沿著島的外圍
     * 切線繞行時 `along ≈ 0`，即使早就沒有碰撞路徑也可能永遠不成立。
     * 實測有八組在 50 秒後仍然鎖著。
     *
     * 改成問「照現在的航向直走，還會不會碰到這座島」。
     */
    const straight = arcMinDistance(
      pos.x, pos.z, dx, dz, STRAIGHT_R, 1, isl.cx, isl.cz, SENSE_RANGE)
    const done = centre > r && (straight >= r || climb.ok)
    if (done) {
      out.clearSamples++
      if (out.clearSamples >= CLEAR_SAMPLES) { resetSense(out); return }
    } else {
      out.clearSamples = 0
    }

    if (done || climb.ok) {
      out.turn = 0
      return
    }

    // 仍然要繞。**每次都重新驗算承諾側**：它可能被另一座島封住了
    const sign = out.side !== 0 ? out.side : perp >= 0 ? -1 : 1
    out.side = sign
    const want = turnMagnitude(centre, perp, r)
    out.turn = pickTurn(self, pos.x, pos.z, dx, dz, sign, islands, margin, cfg, want)
    // turn 為 0 表示這一刻無處可去 —— 交給安全層全力拉起。
    // **side 保留**，下一次不會因此翻面
    return
  }

  // ── 沒有鎖存：找威脅 ────────────────────────────────────────────────
  if (!findThreat(pos.x, pos.z, dx, dz, islands, margin, -1, SENSE_RANGE)) {
    resetSense(out)
    return
  }

  const idx = hit.index
  const isl = islands[idx]!
  const perp = hit.perp
  const centre = hit.centre
  checkClimb(pos.y, isl, pos.x, pos.z, dx, dz, cfg)
  out.floor = climb.floor

  if (climb.ok) {
    // 爬得過 —— 不轉。地板已經抬高，交給既有的 'ground' 分支
    out.turn = 0
    out.side = 0
    out.island = -1
    out.clearSamples = 0
    return
  }

  // 先試背離島心的那一側，不行再試另一側
  const first = perp >= 0 ? -1 : 1
  const need = isl.outerRadius + margin
  const want = turnMagnitude(centre, perp, need)
  let turn = pickTurn(self, pos.x, pos.z, dx, dz, first, islands, margin, cfg, want)
  let side: -1 | 0 | 1 = first
  if (turn === 0) {
    const other = (first === 1 ? -1 : 1) as -1 | 1
    turn = pickTurn(self, pos.x, pos.z, dx, dz, other, islands, margin, cfg, want)
    if (turn !== 0) side = other
  }

  out.turn = turn
  out.side = turn === 0 ? 0 : side
  out.island = turn === 0 ? -1 : idx
  out.clearSamples = 0
}
