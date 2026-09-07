import { G0 } from '../core/math'
import { atmosphere } from '../physics/atmosphere'
import {
  controlEffectiveness, dragCoefficient, inducedDragFactor, redlineEffectiveness,
} from '../physics/aero'
import { WEP_THROTTLE, enginePower, propThrust } from '../physics/propulsion'
import { derivedClMax, type AircraftSpec } from '../specs/types'
import type { AirData } from '../physics/types'

const air: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/** 高迎角時縫翼必然展開，故包絡計算一律採用展開後的 CL_max。 */
function clMaxFor(spec: AircraftSpec): number {
  return derivedClMax(spec, spec.lift.slatAlphaBonus > 0)
}

function weight(spec: AircraftSpec): number {
  return spec.mass * G0
}

/** 當前速度與高度下，氣動能提供的最大過載。 */
export function maxLoadFactorAero(spec: AircraftSpec, altitude: number, tas: number): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  return (qbar * spec.wing.area * clMaxFor(spec)) / weight(spec)
}

/** 指定過載下的失速速度，m/s TAS。 */
export function stallSpeed(spec: AircraftSpec, altitude: number, loadFactor: number): number {
  atmosphere(altitude, air)
  return Math.sqrt(
    (2 * loadFactor * weight(spec)) / (air.density * spec.wing.area * clMaxFor(spec)),
  )
}

/** 指定速度與過載下的總阻力，N。過載超出氣動極限時回傳 Infinity。 */
export function dragAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  loadFactor: number,
): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  if (qbar <= 0) return 0
  const qS = qbar * spec.wing.area
  const cl = (loadFactor * weight(spec)) / qS
  if (cl > clMaxFor(spec)) return Infinity
  const mach = tas / air.soundSpeed
  return qS * dragCoefficient(spec, cl, 0, mach)
}

/** 指定速度與高度下的可用推力，N。 */
export function thrustAt(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  throttle = WEP_THROTTLE,
): number {
  atmosphere(altitude, air)
  const mach = tas / air.soundSpeed
  const power = enginePower(spec, air, mach, throttle)
  return propThrust(spec, power, tas, air)
}

/** 比超量功率 Ps = V(T − D)/W，m/s。正值代表能量累積。 */
export function specificExcessPower(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  loadFactor: number,
  throttle = WEP_THROTTLE,
): number {
  const d = dragAt(spec, altitude, tas, loadFactor)
  if (!Number.isFinite(d)) return -Infinity
  return (tas * (thrustAt(spec, altitude, tas, throttle) - d)) / weight(spec)
}

const V_SEARCH_MAX = 400

/**
 * 平飛極速，m/s TAS。以二分搜尋求 T − D = 0 的上根。
 *
 * 【修正】原始寫法只檢查失速速度 × 1.05 這一點的 T−D 正負，若為負即判定
 * 「該高度已無法平飛」。但在接近實用升限處，失速附近的誘導阻力可能大到
 * 讓 T−D 在那裡為負，而在更高速度（誘導阻力下降後）T−D 轉正、直到接近
 * 極速才再度轉負——即「動力曲線背面」現象。只檢查下界會把這種可平飛的
 * 高度誤判為不可平飛，回傳 0（已於 10,470 m 附近實測到 maxLevelSpeed
 * 從 178 m/s 驟降為 0 的懸崖，見 task-13-report.md）。
 * 改為粗掃描找出「最高的」一段正轉負區間再二分，可正確處理非單調的
 * T−D(v) 曲線，且仍是二分法而非導數法，滿足 finding #1 對增壓器接縫的要求。
 */
export function maxLevelSpeed(
  spec: AircraftSpec,
  altitude: number,
  throttle = WEP_THROTTLE,
): number {
  const excess = (v: number) => thrustAt(spec, altitude, v, throttle) - dragAt(spec, altitude, v, 1)

  const vMin = stallSpeed(spec, altitude, 1) * 1.05
  const vMax = V_SEARCH_MAX
  if (excess(vMax) > 0) return vMax

  const SCAN = 200
  let braLo = -1
  let braHi = -1
  let prevV = vMin
  let prevExcess = excess(vMin)
  for (let i = 1; i <= SCAN; i++) {
    const v = vMin + ((vMax - vMin) * i) / SCAN
    const e = excess(v)
    if (prevExcess > 0 && e <= 0) {
      braLo = prevV
      braHi = v
    }
    prevV = v
    prevExcess = e
  }
  if (braLo < 0) return 0 // 全速度範圍皆無法平飛

  let lo = braLo
  let hi = braHi
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2
    if (excess(mid) > 0) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 最佳爬升率與對應速度。掃描後以三分搜尋細化。 */
export function maxClimbRate(
  spec: AircraftSpec,
  altitude: number,
  throttle = WEP_THROTTLE,
): { rate: number; speed: number } {
  const vMin = stallSpeed(spec, altitude, 1) * 1.02
  // 【修正】maxLevelSpeed 在完全無法平飛時回傳哨兵值 0（見該函式文件），
  // 若直接餵給 Math.max(…, vMin+1)，0 會被 vMin+1 蓋掉，掃描區間因此
  // 塌縮成失速速度正上方僅 1 m/s 的窄窗——剛好是阻力曲線最差的一段，
  // 在絕對升限（約 11,470 m，高於 0.5 m/s 判定的 serviceCeiling）附近
  // 會讓 rate 出現 0.017 → −2.122 的階梯式跳變（見 task-13-report.md）。
  // 0 是「查無可平飛速度」的哨兵，不是一個可用的搜尋上界，必須先辨識出來，
  // 退回全域搜尋上限 V_SEARCH_MAX，而不是讓它污染 Math.max。
  const vLevel = maxLevelSpeed(spec, altitude, throttle)
  const vMax = vLevel > 0 ? Math.max(vLevel, vMin + 1) : V_SEARCH_MAX

  let bestRate = -Infinity
  let bestSpeed = vMin
  const COARSE = 120
  for (let i = 0; i <= COARSE; i++) {
    const v = vMin + ((vMax - vMin) * i) / COARSE
    const ps = specificExcessPower(spec, altitude, v, 1, throttle)
    if (ps > bestRate) {
      bestRate = ps
      bestSpeed = v
    }
  }

  // 在最佳點鄰域細化
  const span = (vMax - vMin) / COARSE
  let lo = Math.max(vMin, bestSpeed - span)
  let hi = Math.min(vMax, bestSpeed + span)
  for (let i = 0; i < 40; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (specificExcessPower(spec, altitude, a, 1, throttle) <
        specificExcessPower(spec, altitude, b, 1, throttle)) lo = a
    else hi = b
  }
  const v = (lo + hi) / 2
  return { rate: specificExcessPower(spec, altitude, v, 1, throttle), speed: v }
}

const CEILING_RATE = 0.5

/**
 * 實用升限，m。定義為最佳爬升率降至 0.5 m/s 的高度。
 *
 * 【修正】二分搜尋前必須先驗證 [0, 20000] 真的括住 CEILING_RATE 這個門檻，
 * 否則二分法在無解時會直接收斂到端點，回傳一個與合法答案無法區分的數字
 * ——例如載重異常、海平面爬升率就已低於門檻的機體，會回傳 0.000，
 * 看起來像是「升限就在海平面」的合理答案，其實是搜尋失敗。
 * 0 與 20000 之所以不能像 maxLevelSpeed／sustainedTurnRate 那樣直接當
 * 「無解」的哨兵值，是因為兩者對升限而言本身就是可能出現的合法答案；
 * 只有 NaN 不會與任何合法海拔混淆，因此用 NaN 明確代表「此高度區間未括住解」。
 */
export function serviceCeiling(spec: AircraftSpec, throttle = WEP_THROTTLE): number {
  const rateAt = (alt: number) => maxClimbRate(spec, alt, throttle).rate
  if (rateAt(0) <= CEILING_RATE) return NaN // 海平面爬升率已達不到門檻：飛不起來
  if (rateAt(20000) >= CEILING_RATE) return NaN // 20,000 m 處仍超過門檻：搜尋範圍未括住解

  let lo = 0
  let hi = 20000
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    if (rateAt(mid) > CEILING_RATE) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/** 瞬間轉彎率，rad/s。取氣動與結構過載的較小者。 */
export function instantaneousTurnRate(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
): number {
  const n = Math.min(maxLoadFactorAero(spec, altitude, tas), spec.limits.gPositive)
  if (n <= 1 || tas <= 0) return 0
  return (G0 * Math.sqrt(n * n - 1)) / tas
}

/** 持續轉彎率，rad/s。以二分搜尋求 Ps = 0 的過載。 */
export function sustainedTurnRate(
  spec: AircraftSpec,
  altitude: number,
  tas: number,
  throttle = WEP_THROTTLE,
): number {
  const nMax = Math.min(maxLoadFactorAero(spec, altitude, tas), spec.limits.gPositive)
  if (nMax <= 1) return 0
  if (specificExcessPower(spec, altitude, tas, nMax, throttle) >= 0) {
    return (G0 * Math.sqrt(nMax * nMax - 1)) / tas
  }
  if (specificExcessPower(spec, altitude, tas, 1, throttle) < 0) return 0

  let lo = 1
  let hi = nMax
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2
    // 【修正】原始寫法把 mid（正在二分的過載）誤代入 specificExcessPower 的
    // tas 參數槽位，導致 loadFactor 恆為 1、tas 被夾在 [1, nMax]（僅 1~數 m/s）。
    // 在此極低速下 qbar≈0 使 cl 遠超 CL_max，dragAt 恆回傳 Infinity，
    // Ps 恆為 −Infinity，於是 hi=mid 永遠成立、lo 永遠停在 1，
    // sustainedTurnRate 因此恆回傳 0（已於 BF109K4 300 km/h 實測到）。
    // 正確作法：tas 固定為外層傳入值，二分的是 loadFactor（第四參數）。
    if (specificExcessPower(spec, altitude, tas, mid, throttle) >= 0) lo = mid
    else hi = mid
  }
  const n = lo
  return n <= 1 ? 0 : (G0 * Math.sqrt(n * n - 1)) / tas
}

/**
 * 該高度下**這台飛機能達到的最佳**持續轉彎率，rad/s。
 *
 * 【它與 `sustainedTurnRate` 回答的是不同的問題】後者問「我**現在這個速度**
 * 能轉多快」，是一個瞬時事實；本函數問「這台飛機**打一場迴旋戰**能轉多快」，
 * 是機體本身的性質，與當前速度無關。
 *
 * 【為什麼 AI 的脫離決定要用這一個】迴旋戰有個性質：兩台都盡全力轉之後，
 * 速度會在幾秒內各自收斂到自己的最佳持續轉彎速度。所以「現在誰比較慢」
 * 決定不了這場仗誰贏 —— 決定它的是機體。
 *
 * 人工驗收實測過反例：AI 咬在敵機後方 236 m、正在開火時，因為敵機拉桿掉到
 * 356 km/h（自己還有 452），瞬時比較讀出 −1.7°/s 的劣勢而放棄射擊解逃走。
 * 但兩台的**機體**差距只有 −0.3°/s。敵機掉速正是它快撐不住的訊號，卻被讀成
 * 「他比我強」。
 *
 * 【為什麼是粗掃再細化，不是直接黃金分割】曲線在失速速度以下與 Ps(1G) 轉負
 * 的高速端**都是平的 0**。黃金分割碰到平段會收斂到錯的地方；先粗掃找出峰值
 * 所在的區間，才保證細化階段拿到的是真正的單峰段。
 */
export function bestSustainedTurnRate(
  spec: AircraftSpec,
  altitude: number,
  throttle = WEP_THROTTLE,
): number {
  return searchBestTurn(spec, altitude, throttle, -1)
}

/** `searchBestTurn` 的副產品：上一次求解的最佳速度，m/s。供表格填充熱啟動。 */
let lastBestTurnSpeed = -1

/**
 * `bestSustainedTurnRate` 的內部實作。`vHint > 0` 時只在提示值附近粗掃。
 *
 * 【熱啟動為什麼有效】最佳持續轉彎速度隨高度**平滑且單調地**上移
 * （實測 P-51D：266 → 299 → 303 → 324 → 326 km/h，跨越 8,000 m 只移動
 * 60 km/h）。相鄰 50 m 之間的移動遠小於粗掃窗寬，所以上一格的答案是下一格
 * 極好的起點，粗掃點數可以從 24 降到 6。
 */
function searchBestTurn(
  spec: AircraftSpec,
  altitude: number,
  throttle: number,
  vHint: number,
): number {
  const vs = stallSpeed(spec, altitude, 1)
  if (!(vs > 0) || !Number.isFinite(vs)) {
    lastBestTurnSpeed = -1
    return 0
  }

  // 最佳持續轉彎速度實測落在 1.2~1.6 × Vs，冷啟動取 [Vs, 3 × Vs] 有充足餘裕；
  // 熱啟動則只需覆蓋相鄰格之間的位移。
  let lo0: number
  let hi0: number
  let n: number
  if (vHint > 0) {
    const half = 0.25 * vs
    lo0 = Math.max(vs, vHint - half)
    hi0 = vHint + half
    n = 6
  } else {
    lo0 = vs
    hi0 = 3 * vs
    n = 24
  }

  const step = (hi0 - lo0) / n
  let bestV = lo0
  let bestR = 0
  for (let i = 0; i <= n; i++) {
    const v = lo0 + i * step
    const r = sustainedTurnRate(spec, altitude, v, throttle)
    if (r > bestR) {
      bestR = r
      bestV = v
    }
  }
  if (bestR <= 0) {
    lastBestTurnSpeed = -1
    return 0
  }

  // 細化：在峰值的左右各一格內做黃金分割，該區間保證單峰
  let lo = Math.max(lo0, bestV - step)
  let hi = Math.min(hi0, bestV + step)
  // 【12 次，不是 20 次】每次把區間縮成 2/3。最佳點附近的轉彎率是平的
  // （二次），所以速度精度的效益衰減得很快：20 次的收斂殘差約 1e-6 rad/s、
  // 12 次約 1e-5，而唯一的消費端門檻是 0.02 rad/s。多出來的 8 次是拿一倍的
  // 填表時間去換四個數量級的多餘精度。
  for (let i = 0; i < 12; i++) {
    const a = lo + (hi - lo) / 3
    const b = hi - (hi - lo) / 3
    if (sustainedTurnRate(spec, altitude, a, throttle)
      < sustainedTurnRate(spec, altitude, b, throttle)) lo = a
    else hi = b
  }
  const vRefined = (lo + hi) / 2
  const rRefined = sustainedTurnRate(spec, altitude, vRefined, throttle)
  if (rRefined >= bestR) {
    lastBestTurnSpeed = vRefined
    return rRefined
  }
  lastBestTurnSpeed = bestV
  return bestR
}

/** 快取表的高度格距與上限，m。 */
const BEST_TURN_STEP = 250
const BEST_TURN_CEILING = 14000
const BEST_TURN_SLOTS = BEST_TURN_CEILING / BEST_TURN_STEP + 1
/**
 * 每個機種一張惰性填充的表，**交錯存放** `[轉彎率0, 速度0, 轉彎率1, 速度1, …]`。
 * WeakMap 讓臨時的 spec 複本（消融測試）不會洩漏。
 */
const bestTurnTables = new WeakMap<AircraftSpec, Float64Array>()

function bestTurnTable(spec: AircraftSpec): Float64Array {
  let table = bestTurnTables.get(spec)
  if (table !== undefined) return table
  table = new Float64Array(BEST_TURN_SLOTS * 2)
  // 【一次填滿，不惰性逐格填】逐格填的版本實測讓 AI 步的 p999 由 217 µs
  // 惡化到 3.8 ms：飛機每跨過一個沒填過的高度格就要付一次完整求解。
  // 改成首次使用時一次填完，代價集中成單一次啟動成本，之後恆定為表格查詢。
  // 熱啟動讓這次填充只花冷啟動的數分之一。
  let hint = -1
  for (let k = 0; k < BEST_TURN_SLOTS; k++) {
    table[k * 2] = searchBestTurn(spec, k * BEST_TURN_STEP, WEP_THROTTLE, hint)
    hint = lastBestTurnSpeed
    table[k * 2 + 1] = hint > 0 ? hint : 0
  }
  bestTurnTables.set(spec, table)
  return table
}

/** 表格查詢 + 線性內插的共用部分。`offset` 0 取轉彎率、1 取速度。 */
function lookupBestTurn(spec: AircraftSpec, altitude: number, offset: number): number {
  const table = bestTurnTable(spec)
  const alt = altitude < 0 ? 0 : altitude > BEST_TURN_CEILING ? BEST_TURN_CEILING : altitude
  const x = alt / BEST_TURN_STEP
  const i = Math.floor(x)
  const j = i + 1 < BEST_TURN_SLOTS ? i + 1 : i
  const a = table[i * 2 + offset]!
  if (j === i) return a
  return a + (table[j * 2 + offset]! - a) * (x - i)
}

/**
 * `bestSustainedTurnRate` 的快取版，僅供 WEP 油門。
 *
 * 【為什麼需要它】原函數要掃過整個速度範圍，實測 **1,076 µs/次**。AI 的能量
 * 評估是 10 Hz、每次要算兩台，等於每 100 ms 花掉 2.1 ms —— 而 240 Hz 一格的
 * 預算只有 4.17 ms。那會是一個看得見的頓挫。
 *
 * 【為什麼可以快取】這個量只與（機種, 高度）有關，與速度、姿態、對手都無關。
 * 每 250 m 一格，首次使用時一次填滿，格間線性內插。
 *
 * 【誤差與門檻的關係】實測內插誤差在 11,000 m 以下 ≤ 0.0013 rad/s
 * （0.073°/s），相對於消費端的決策門檻 `turnEnter` = 0.02 rad/s 是 6.5%。
 * 11,000 m 以上升限附近曲線曲率變大，誤差升到 0.0073 rad/s —— 該高度兩台
 * 都已接近絕對升限、幾乎轉不動，而規則比的是**兩者之差**，內插偏差同號會
 * 大部分互相抵消。
 *
 * 實測：首次填表 P-51D 63 ms、Bf 109 37 ms（各一次）；之後每次查表 60 ns。
 *
 * 【仍然是純函數】同樣的輸入永遠給同樣的輸出，快取只是省掉重算。首次填格
 * 之後不再有任何配置行為。
 */
export function bestSustainedTurnRateCached(spec: AircraftSpec, altitude: number): number {
  return lookupBestTurn(spec, altitude, 0)
}

/**
 * 達到 `bestSustainedTurnRateCached` 那個轉彎率所需的速度，m/s TAS。同一張表。
 *
 * 【誰要用它】AI 的絕對能量底線：「我還剩多少本錢繼續纏鬥」的答案是
 * 「我的比能量夠不夠讓我在一個安全高度上維持最擅長的轉彎」，而那需要這個速度。
 */
export function bestSustainedTurnSpeedCached(spec: AircraftSpec, altitude: number): number {
  return lookupBestTurn(spec, altitude, 1)
}

/** 角落速度：氣動過載首次達到結構極限的速度，m/s。 */
export function cornerSpeed(spec: AircraftSpec, altitude: number): number {
  return stallSpeed(spec, altitude, spec.limits.gPositive)
}

/** 穩態最大滾轉率，rad/s。解 clDa·δa_eff + clP·(p·b/2V) = 0。 */
export function maxRollRate(spec: AircraftSpec, altitude: number, tas: number): number {
  atmosphere(altitude, air)
  const qbar = 0.5 * air.density * tas * tas
  const CS = spec.controlStiffening
  const da = controlEffectiveness(CS.aileronK, CS.qRef, qbar) * redlineEffectiveness(spec.limits.vne, qbar)
  return (spec.moments.clDa * da * 2 * tas) / (Math.abs(spec.moments.clP) * spec.wing.span)
}

/**
 * 由目標升力係數反解迎角（僅適用線性段）。
 * 供交叉驗證測試建立指定過載的飛行狀態。
 */
export function alphaForCl(spec: AircraftSpec, cl: number): number {
  return cl / spec.lift.clAlpha + spec.lift.alphaZero
}

// 供 EM 圖標註使用
export { inducedDragFactor }
