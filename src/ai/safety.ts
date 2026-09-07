import { Vector3 } from 'three'
import { G0 } from '../core/math'
import { makeScratch } from '../core/pool'
import { cornerSpeed, maxLoadFactorAero, stallSpeed } from '../analysis/envelope'
import { RHO0 } from '../physics/atmosphere'
import { WEP_THROTTLE } from '../physics/propulsion'
import { THROTTLE_FLOOR } from '../input/throttle'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { TerrainSense } from './terrainSense'

const FWD = new Vector3(0, 0, -1)
const UP = new Vector3(0, 1, 0)
const S = makeScratch(4)

/**
 * 航跡角的變化率 γ̇，rad/s。正值 = 航跡正在上揚。
 *
 * ```
 * γ̇ = g·(n·(L̂·ĉ) − cos γ) / V
 * ```
 *
 * `L̂` 是機體升力方向、`ĉ` 是**垂直平面內、垂直於速度、朝上**的單位向量。
 * 無側滑的座標轉彎裡 `L̂·ĉ` 就是坡度餘弦 `cos φ`，但寫成內積之後倒飛與
 * 大側滑也正確。`−cos γ` 是重力在同一個方向上的分量。
 *
 * 【為什麼是無狀態的】它由**當下**的升力方向、過載與速度算得出來，不需要
 * 上一步的 γ。`applySafety` 因此維持純函數（spec §4.3 的分層前提）。
 *
 * 【退化情形回 0】速度為零、或垂直俯衝／爬升（`ĉ` 沒有唯一解）時回 0 ——
 * 這兩種情形下「航跡角還會不會變陡」本來就沒有定義，回 0 等於「不預測」，
 * 讓 `applySafety` 退回原本的瞬時判斷。
 *
 * 熱路徑（240 Hz × 40 架），不配置。
 */
export function flightPathRate(self: Aircraft): number {
  const vel = self.state.velocity
  const tas = vel.length()
  if (tas < 1e-3) return 0
  const vhat = S.v[2]!.copy(vel).divideScalar(tas)

  // ĉ：把世界正上方扣掉沿速度的分量。模長恰好是 cos γ
  const c = S.v[3]!.copy(UP).addScaledVector(vhat, -UP.dot(vhat))
  const cosGamma = c.length()
  if (cosGamma < 1e-3) return 0
  c.divideScalar(cosGamma)

  const lift = S.v[1]!.copy(UP).applyQuaternion(self.state.orientation)
  return (G0 * (self.diag.loadFactor * lift.dot(c) - cosGamma)) / tas
}

/**
 * 由俯衝角 γ 改出到水平所需的高度，m。
 *
 * 改出是兩段：**先俯衝把高度換成速度**（只有速度夠才拉得動），**再拉平**。
 * 第二段的拉起半徑 `R = V² / (g·√(n²−1))`，弧線由 γ 回到 0 掉的高度是
 * `R·(1 − cos|γ|)`。第一段的代價由能量守恆給：`(V² − V₀²) / 2g`。
 *
 * 【為什麼用閉式解而不是迭代預測】spec §9.2 原本寫「預測 1–3 秒航跡 →
 * 不夠就提高脫離偏置 → 重新預測」。但迭代版每次都在找的正是這個閉式量。
 * 閉式解**更精確**（不受預測步長影響）、**更便宜**（240 Hz 跑得起）、
 * 而且**可單獨測試**：給定速度與俯衝角，所需高度是一個確定的數字。
 *
 * 【最佳拉起過載也有閉式解，所以這裡沒有新參數】第一段越長，速度越高、
 * 半徑越小，但換速度本身要付高度。令 `c = 1 − cos|γ|`、`u = V²`，固定高度下
 * `n = a·u`（`a = nMax / tas²`，因為 `n = q̄·S·CL_max / W ∝ V²`）：
 *
 * ```
 * H(u) = (u − tas²)/(2g) + u·c / (g·√(a²u² − 1))
 * dH/du = 1/(2g) − c·(a²u² − 1)^(−3/2) / g = 0
 *   ⟹ n*² = 1 + (2c)^(2/3)
 * ```
 *
 * `n*` **只與航跡角有關**，與速度、高度、機種都無關（−45° 時 1.3039、
 * −89° 時 1.6028），而且恆大於 1。
 *
 * 【分界為什麼是 `nMax ≥ n*` 而不是 `nMax > 1`】`nMax ≥ n*` 代表現在就
 * 拉得動、而且再加速也不划算，第一段長度為零，式子退回單段閉式解 ——
 * **拉得動的那一側連浮點結果都一模一樣**（實測安全矩陣 288 組逐格比對
 * `changed = 0`）。用 `nMax > 1` 當分界則會在 `nMax → 1⁺` 留一個跳到無限大
 * 的斷點。
 *
 * 【為什麼不回 Infinity】`nMax ≤ 1` 說的是「用**現在這個
 * 速度**拉不平」，不是「救不回來」。回 Infinity 會讓下面的撞地分支在
 * **任何有限高度**接管，並對一台已經失速的飛機下令爬升 —— 而失速分支
 * （壓頭）在 `nMax ≤ 1` 時保證成立卻永遠輪不到，因為
 * `nMax ≤ 1 ⟺ tas ≤ Vs(1g)` ⟹ `tas / Vs ≤ 1 < stallMargin`。
 * 實測誤觸發六次，全部在 5,038–7,671 m、下沉率 0.5 m/s
 * （spec `2026-08-09-recovery-altitude-degeneracy-design.md` §1）。
 *
 * 【拉起項寫成純乘法，因為 `c` 會捨入成 0】`1 − cos|γ|` 在 `|γ| < 2×10⁻⁸`
 * rad 時捨入成 0，於是 `root` 也是 0。若照字面寫成 `v²·c / (g·root)`，那就是
 * `Infinity × 0 = NaN` —— 而 NaN 流進 `margin <= needed` 會讓那個比較恆為假，
 * 安全層**永遠不介入**，比誤觸發更糟。改用恆等式 `c / root ≡ root² / 2`
 * 寫成 `v²·root² / (2g)`：`root = 0` 時它就是 0，不再有除法。
 *
 * 【單段那一支的 `nMax === 1` 也要擋】同一個角落裡 `n*` 會捨入成 1，於是
 * `nMax = 1` 會落進單段支並除以 `√(1−1) = 0`。回 `Infinity` —— 那既是拉起
 * 半徑真正的極限，也與修改前 `!(nMax > 1) → Infinity` 完全一致。
 *
 * 【為什麼不乾脆把 `c` 換成半正矢 `2·sin²(|γ|/2)`】它在數學上恆等、浮點下
 * 確實不會塌成 0，但**沒有多擋掉任何東西**（NaN 是上面那個純乘法擋掉的），
 * 代價卻是 288 格安全矩陣裡有 144 格的回傳值差 1 ULP —— 會換掉「拉得動的
 * 那一側逐位元不變」這個最強的迴歸證據。
 *
 * 【模型忽略了什麼】第一段假設推力與阻力相消。WEP 下低速段推力大於阻力，
 * 所以這裡**高估**所需高度，偏保守。反方向的偏差（俯衝中 γ 還會變陡）由
 * `factor` 與 `lookahead` 覆蓋，與單段閉式解面對的是同一件事。
 *
 * 熱路徑（240 Hz × 40 架）。比單段版多付一個 `cbrt`、一個 `sqrt` 與幾次
 * 乘除，不配置。
 */
export function recoveryAltitude(tas: number, gamma: number, nMax: number): number {
  if (gamma >= 0) return 0
  // 【唯一真正的「救不回來」】完全沒有升力，`n(v) = nMax·(v/tas)²` 恆為 0，
  // 換多少速度都拉不動。負值與 NaN 也落在這裡，與修改前 `!(nMax > 1)` 的
  // 處置一致 —— 回 Infinity 讓安全層介入，回 NaN 會讓它永遠不介入。
  if (!(nMax > 0)) return Infinity

  const c = 1 - Math.cos(Math.abs(gamma))
  // `root` 就是 √(n*² − 1)：由 n*² = 1 + (2c)^(2/3) 直接得 (2c)^(1/3)
  const root = Math.cbrt(2 * c)
  const nStar = Math.sqrt(1 + root * root)

  // 【`q > 0` 也要成立才走單段支】`q` 只在 `c` 捨入成 0（於是 n* 也捨入成 1）
  // 而 nMax 又恰為 1 的角落為 0。那時不能回 Infinity —— 兩段模型在那裡的答案
  // 是 **0**（加速無限小就能拿到正的剩餘過載，再穿過一個無限小的角度）。
  // 回 Infinity 等於在一個窄角落裡重建這次要修掉的缺陷本身。落到下面的兩段
  // 公式即可：`nStar = 1` ⟹ `v2 = tas²` ⟹ 兩項都自然是 0。
  const q = nMax * nMax - 1
  if (q > 0 && nMax >= nStar) {
    // 這一支與修改前逐位元相同
    return ((tas * tas) / (G0 * Math.sqrt(q))) * c
  }

  // 先換速度到 n = n*（`n ∝ V²` ⟹ `V² = tas² · n* ÷ nMax`），再拉平。
  // 拉起項 = v²·c / (G0·root)，而 c / root ≡ root² / 2，所以寫成純乘法：
  // `root = 0` 時它就是 0，不會變成 Infinity × 0
  const v2 = (tas * tas * nStar) / nMax
  return (v2 - tas * tas) / (2 * G0) + (v2 * root * root) / (2 * G0)
}

export interface SafetyConfig {
  /** 所需脫離高度的安全倍率 */
  factor: number
  /** 額外的固定餘裕，m。水平飛行時它就是最低容許高度 */
  clearance: number
  /** 硬接管時的爬升角，rad */
  recoveryPitch: number
  /**
   * 失速硬介入的速度裕度門檻（TAS ÷ 1G 失速速度）。
   *
   * **必須低於 `DEFAULT_STEER.speedRecoverMargin`** —— 瞄準點層是技巧、
   * 這一層是硬限制，硬限制只在技巧失效時才動（spec §4.4）。
   */
  stallMargin: number
  /** 失速介入時的壓頭角度，rad。正值，實際命令的是它的負值 */
  stallRecoveryPitch: number
  /**
   * 超速守線的 IAS / vne 門檻。**只擋往下。**
   *
   * 【為什麼是 0.90】紅線因子在 0.90 還剩 46% 操縱權限，抬得起來；0.95 只剩
   * 22%，來不及。拉起的閉式解假設 `gPositive` 全部可用，紅線一過那個假設
   * 整個失效 —— 沒有這一條，追擊中的 AI 會追進紅線、拉不起來、撞海。
   */
  overspeedRatio: number
  /**
   * 黃線：俯衝中 IAS / vne 過了這裡就收油門，還不動瞄準點。與 HUD 變黃、
   * 紅線因子開始作用是同一個數（`REDLINE_KNEE`）。
   */
  overspeedThrottleRatio: number
  /**
   * 航跡角的前瞻時間，s。用 `flightPathRate` 把 γ 往前推這麼久再算所需高度。
   *
   * 【為什麼需要它 —— `factor` 蓋不住這件事】閉式解假設 γ 不再變陡，而 AI
   * 在檢查通過之後還在繼續加深俯衝。實測軌跡：
   *
   * ```
   *   t     高度  TAS    γ    介入   needed
   * 113.00   367  128  −40°    否     279 m   ← 367 > 279，通過
   * 113.50   320  130  −54°    否     392 m   ← 這一刻已經追不上
   * 113.75   292  131  −60°    是     459 m   ← 觸發時缺 167 m
   * 117.22     0                              觸海
   * ```
   *
   * `factor` 補的是「建立過載要時間」，是一個固定比例；這裡補的是「俯衝角
   * 還會變陡」，隨 γ̇ 變化。用 factor 去蓋 γ̇ 的話，平飛時過度保守、急劇
   * 加深時仍然不夠。
   *
   * ## 0.25 s 是被兩組掃描從上下夾出來的
   *
   * **下界 —— 低空受控場景（五場、120 秒、子彈無傷害，全場最低高度／觸海）**
   *
   * ```
   * lookahead   延遲0      0.3       0.5       0.8      觸海合計
   * 0（修補前）   115        63     −0 觸海     275       644 步
   * 0.25          54        74        46       275         0
   * 0.50          16        91        99       275         0
   * 0.75         121       118        88       275         0
   * 1.00         106       115       120       275         0
   * 1.50         114       118       114       275         0
   * ```
   *
   * **只要有前瞻，觸海就消失了** —— 這就是這一項要修的東西。最低高度那幾欄
   * 是混沌的（同一場在六個 lookahead 下是 115/54/16/121/106/114，沒有趨勢），
   * 不作為判準。
   *
   * **上界 —— 六場機動測試（`ai-manoeuvre.test.ts` 的五個門檻）**
   *
   * 只有側舷@1000 有反應，其餘五場逐值不變：
   *
   * ```
   * lookahead   longestExtend（門檻 55 s）   offNose（門檻 85%）
   * 0                    23.8                     47.7%
   * 0.25                 34.3                     54.9%
   * 0.50                 42.0                     60.0%
   * 0.75                285.1  ✗                  96.3%  ✗
   * 1.00                118.2  ✗                  81.3%
   * 1.50                285.2  ✗                  96.3%  ✗
   * ```
   *
   * 0.75 以上會**炸開**：300 秒的仗裡有 285 秒是一段連續的 extend，機首 96%
   * 的時間偏離目標超過 90° —— AI 跑掉之後再也沒回來。安全層在 1000 m 提前
   * 介入，把飛機推進一個 `extendFloorLatch` 解不開的狀態。
   *
   * 可用區間是 0.25~0.50，兩者都通過全部門檻。取小的：離那道懸崖遠一點，
   * 而且低空最低高度也比較好（46 對 16 m）。
   */
  lookahead: number
}

/**
 * `factor`、`clearance`、`recoveryPitch` 仍是起始值。
 * `stallMargin`、`stallRecoveryPitch` 是失速硬介入的兩個門檻，見各欄位註解。
 *
 * `factor` 取 1.5 是因為閉式解假設立刻拉到 nMax，而實際上指揮儀要花時間
 * 滾平與建立過載。`clearance` 取 120 m 是「就算完全水平也不准比這更低」。
 */
export const DEFAULT_SAFETY: SafetyConfig = {
  factor: 1.5,
  clearance: 120,
  recoveryPitch: 20 * (Math.PI / 180),
  // 【必須低於瞄準點層的 speedRecoverMargin（1.25）】瞄準點層是技巧、這一層
  // 是硬限制，硬限制只在技巧失效時才動。有一條單元測試把這個關係釘住。
  // 實測六場開局的 safetyShare 最差 1.83%（修補前 6.74%）—— 這一層很少動，
  // 正是它該有的樣子
  stallMargin: 1.1,
  // 【硬限制比上層積極】25° 對 20°。**這一個沒有單獨掃過** —— 它只在瞄準點層
  // 已經失職之後才生效，而實測那佔不到 2% 的時間，掃它得不到訊號
  stallRecoveryPitch: 25 * (Math.PI / 180),
  // 【0.25 s 是兩組掃描夾出來的，見 `lookahead` 欄位的註解】上界由六場機動
  // 測試給（≥ 0.75 時側舷@1000 會炸開），下界由「不觸海」給（0 會觸海）。
  lookahead: 0.25,
  overspeedRatio: 0.90,
  overspeedThrottleRatio: 0.85,
}

/**
 * 速度向量的水平方向（單位向量）。垂直俯衝／爬升時水平分量退化，改用
 * 機首的水平投影；兩者都退化就回傳 −Z。
 *
 * 【為什麼要保持航向】指揮儀是 bank-to-turn：大坡度時命令「世界正上方」
 * 會要求飛機先滾平再拉，而滾平的過程中高度還在掉。保持當前航向、只改
 * 仰角，指揮儀就能同時滾平與拉起。
 */
function horizontalHeading(self: Aircraft, out: Vector3): void {
  const vel = self.state.velocity
  out.set(vel.x, 0, vel.z)
  const len = out.length()
  if (len > 1e-3) {
    out.divideScalar(len)
    return
  }
  const nose = S.v[1]!.copy(FWD).applyQuaternion(self.state.orientation)
  out.set(nose.x, 0, nose.z)
  const noseLen = out.length()
  if (noseLen > 1e-3) out.divideScalar(noseLen)
  else out.set(0, 0, -1)
}

/**
 * 安全層介入了哪一種。
 *
 * 【為什麼要分辨而不是回傳布林】兩個接管的補救**方向相反** ——「撞地」拉起、
 * 「失速」壓頭。把它們混進同一個布林，量出來的「安全層介入率」就同時包含
 * 兩件無關的事：`ai-visible-evasion` 有兩場在 3950 m 量到 2.23% / 3.67% 的
 * 介入率，那個高度不可能是撞地，是失速接管 —— 而那條護欄要守的是
 * 「不墜海」。
 */
export type SafetyAction = 'none' | 'ground' | 'stall' | 'terrain' | 'overspeed'


/**
 * 安全層。**可覆寫整個 `Command`**，回傳它介入了哪一種（`'none'` = 沒介入）。
 *
 * 【為什麼是濾網而不是規則表的第一條】它要能改寫 `aimWorld` **本身**
 * （而不只是換一個意圖），而且新增規則的人不可能繞過它。它同時覆寫
 * `throttle`、`brake` 與 `firing` —— 快撞海時不該還在開火。這也是本計畫
 * 不另外加 `recover` 意圖的理由：覆寫整個 Command 已經涵蓋它的效果，
 * 少一組要維護的優先序關係。
 *
 * @param seaHeight 該點的海面（未來為地表）高度，m
 */
export function applySafety(
  self: Aircraft,
  seaHeight: number,
  out: Command,
  cfg: SafetyConfig = DEFAULT_SAFETY,
  sense?: TerrainSense,
): SafetyAction {
  const vel = self.state.velocity
  const tas = vel.length()
  const gamma = tas > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / tas))) : 0

  // 【第二項用結構極限，不是 PILOT_G_POSITIVE】生理極限以黑視呈現、不夾
  // 過載，這裡若用 6.5 G，AI 會以為自己只拉得到 6.5 G 去算改出高度，算出
  // 比實際需要更高的門檻 —— 不會撞海，但會提早拉起、多出無謂的脫離。
  // 這一項必須與 `pitchRateLimit` 的 nLimit 用同一個上限。
  const nMax = Math.min(
    maxLoadFactorAero(self.spec, self.state.position.y, tas),
    self.spec.limits.gPositive,
  )
  // 【前瞻只在已經下降時生效】它要補的是「**我正在俯衝，而且還在加深**」。
  // 平飛或爬升時套用會製造出一個不存在的俯衝：實測 4000 m、TAS 30 的平飛
  // 被推出一個負的 γ，於是要付一份根本不存在的改出高度。
  //
  // 【這道守衛不兼任「擋掉 Infinity」】那件事在 `recoveryAltitude` 裡處理
  // —— 靠這裡擋的話只要有一點點下沉就擋不住，五公里高空一樣誤觸發。
  //
  // 【取較悲觀的那個】只在航跡**變陡**時提前介入；變緩時不會反而延後。
  // 夾在 −90° 是因為閉式解只在 |γ| ≤ 90° 有意義。
  const predicted = gamma < 0
    ? Math.max(-Math.PI / 2, gamma + flightPathRate(self) * cfg.lookahead)
    : gamma
  const worst = Math.min(gamma, predicted)
  const needed = recoveryAltitude(tas, worst, nMax) * cfg.factor + cfg.clearance
  const margin = self.state.position.y - seaHeight

  // ── 撞地硬接管 ──────────────────────────────────────────
  if (margin <= needed) {
    const horiz = S.v[0]!
    horizontalHeading(self, horiz)

    // 【地形的橫向規避】拉起爬不過前方那座島時，把航向轉開再爬。
    //
    // 這一段**寫在 ground 分支裡面**，所以「terrain 不會在 ground 不觸發時
    // 觸發」是結構保證的，不是一個要靠人維護的約定 —— 介入的頻率因此仍然
    // 完全由既有的 safetyShare 門檻管。
    //
    // 【不傳 sense 時這裡整段不存在】既有的對戰矩陣、AI 護欄與 replayDigest
    // 都走那一條路徑，輸出逐位元不變。
    let action: SafetyAction = 'ground'
    if (sense !== undefined && sense.turn !== 0) {
      const c = Math.cos(sense.turn)
      const sn = Math.sin(sense.turn)
      const hx = horiz.x
      const hz = horiz.z
      // 繞 y 軸旋轉。與 terrainSense 內部的旋轉用同一個式子 —— 兩邊的
      // 符號約定必須一致，否則 AI 會往島的方向轉
      horiz.x = hx * c - hz * sn
      horiz.z = hx * sn + hz * c
      action = 'terrain'
    }

    out.aimWorld.copy(horiz).multiplyScalar(Math.cos(cfg.recoveryPitch))
    out.aimWorld.y = Math.sin(cfg.recoveryPitch)
    out.aimWorld.normalize()

    // 【油門不是固定滿檔】拉起半徑 ∝ V²，高速時減速才拉得起來；但低速時
    // 收油門會失速。判準用角落速度：高於它代表速度多到轉不動。
    //
    // 【地形分支例外，而且是實測逼出來的】上面那套是為**俯衝改出**設計的
    // —— 目標是把速度換成更小的拉起半徑。地形分支要做的是相反的事：
    // 繞過去或爬過去，兩者都要能量。
    //
    // 掃描實測：He 111 在 400 km/h 正撞一座 915 m 的島時，被收油門加煞車，
    // 於是一邊轉一邊掉高度 —— 50 秒後從進場的 150 m 掉到 93 m，還在膨脹圓
    // 內繞。給它全馬力之後才爬得起來。
    //
    // **這不動 ground 分支的行為**：那一條的輸出逐位元不變。
    if (action === 'terrain') {
      out.throttle = WEP_THROTTLE
      out.brake = 0
    } else if (tas > cornerSpeed(self.spec, self.state.position.y)) {
      out.throttle = THROTTLE_FLOOR
      out.brake = 1
    } else {
      out.throttle = WEP_THROTTLE
      out.brake = 0
    }

    out.firing = false
    // 【接管時一併取消投彈】航向已經被改掉，而釋放的判準是照原本那條航路
    // 算的 —— 不取消的話炸彈會在偏離解算航路之後才出去
    out.bombing = false
    return action
  }

  // ── 失速硬接管（撞地之後才判，spec §4.5）─────────────────
  // 【為什麼排在撞地之後】兩者的補救相反：失速要壓頭、撞地要拉起。撞地
  // 優先，因為失速還有機會改出，撞地沒有。
  // ── 超速守線 ────────────────────────────────────────────
  // 【只擋往下，不擋往上】拉平之後 r 自己會掉。優先序在撞地之後：離地已經
  // 不夠時拉起是唯一的事。不動 firing／bombing —— 守線不是閃避，開火權留給
  // 上層。
  //
  // 【兩級】黃線（`overspeedThrottleRatio`）先收油門；到 `overspeedRatio` 才
  // 動瞄準點 —— 而且只把俯仰夾到水平以上，**方位保留**。整個換成水平航向
  // 會讓追擊者在守線的那幾秒放掉目標（人工試飛回報「追丟」）；保留方位它
  // 繼續朝敵人轉，只是不再往下。
  //
  // 【只收油門，不煞車】跟著 45° 俯衝的目標追下來時動量會帶到 0.98 —— 那是
  // 設計的一部分：紅線因子在那裡只剩 15% 權限，追擊者**跟不上目標的轉彎**。
  // 煞車會讓它停在 0.90、留在目標上方等它爬回來，實測把被追的一方打成全滅。
  const ratio = Math.sqrt((2 * self.diag.aero.qbar) / RHO0) / self.spec.limits.vne
  if (gamma < 0 && ratio > cfg.overspeedThrottleRatio) {
    out.throttle = 0
    out.brake = 0
    if (ratio > cfg.overspeedRatio && out.aimWorld.y < 0) {
      const h = Math.hypot(out.aimWorld.x, out.aimWorld.z)
      if (h > 1e-6) {
        out.aimWorld.set(out.aimWorld.x / h, 0, out.aimWorld.z / h)
      } else {
        horizontalHeading(self, out.aimWorld)
      }
    }
    return 'overspeed'
  }

  const vs = Math.max(stallSpeed(self.spec, self.state.position.y, 1), 1)
  if (tas / vs < cfg.stallMargin) {
    const horiz = S.v[0]!
    horizontalHeading(self, horiz)
    out.aimWorld.copy(horiz).multiplyScalar(Math.cos(cfg.stallRecoveryPitch))
    out.aimWorld.y = -Math.sin(cfg.stallRecoveryPitch)
    out.aimWorld.normalize()
    // 換速度要推力，而且低速時沒有減速的道理
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    out.bombing = false
    return 'stall'
  }

  return 'none'
}
