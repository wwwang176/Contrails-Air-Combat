import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEG } from '../core/math'
import { solveImpact, type BombState, type Impact } from '../world/bomb'
import { sustainedTurnRate } from '../analysis/envelope'
import type { Aircraft } from '../aircraft/Aircraft'
import type { StrikeProfile } from './strikeRun'
import { deckHeightOf } from '../world/ships'
import { SHIP_BREAK_RANGE } from './shipAttack'
import type { Box } from '../world/hit'
import type { StrikeTarget } from '../world/strikeTarget'

/**
 * # AI 的轟炸航路
 *
 * **與掃射（`ai/shipAttack.ts`）是兩個模式，只共用「哪一艘船」。**
 * 掃射對準砲位、俯衝、400 m 拉起脫離；轟炸要平飛、定高、穩定通過船的
 * 正上方 —— 照掃射的行為，飛機在投彈點之前就脫離了。
 *
 * 分流的判準是**有沒有彈艙**（`bombBayOf(spec.id) > 0`）。
 *
 * ## 釋放的判準是 `solveImpact`，不是另一條公式
 *
 * `world/bomb.ts` 已經有兩份必須逐位元一致的彈道（`Bombs.step` 與
 * `solveImpact`），它們的註解反覆寫著「差一個字就是準星與水柱分家」。
 * 這裡再推一份「該在幾公尺前放」的閉式解，就是第三份會漂開的東西。
 *
 * 所以問同一支函數：**現在投會落在哪**，再與**船屆時會在哪**比。
 *
 * ## 這一層不做的
 *
 * - 不迴避彈幕、不編隊轟炸。
 * - 不知道自己彈艙空了 —— `stepBombBay` 在回補期間吃掉扳機（`World`
 *   那一側），所以它會繼續飛航路、補完就投。
 */

/**
 * 這一顆炸彈**水平最遠飛得了多遠**的上界，由高度推。
 *
 * 【它是效能閘，不是判準】精確解一次要 58～188 µs（1,000 m 57.9、
 * 4,000 m 123.4、8,000 m 188.3），而 40 架 × 10 Hz 攤到物理步
 * 是 +96～+314 µs —— 超過 300 µs 的設計預算。從 8 km 外進場就每拍解算是
 * 浪費：那個距離上絕對投不到。
 *
 * 【必須是上界，算小了會漏掉釋放窗】無阻力自由落體的時間 `√(2h/g)` 是
 * **下界**（阻力讓它落得更久），但阻力同時也在削水平速度。取
 * `2h + 500` 這個線性上界實測涵蓋得很寬：
 *
 * ```
 *              實際水平行程   這個上界
 *   1,000 m       ~1,260 m     2,500 m
 *   4,000 m       ~2,700 m     8,500 m
 *   8,000 m       ~4,000 m    16,500 m
 * ```
 *
 * 而 `SHIP_ATTACK_RANGE` 本來就只有 8,000 m，所以低空那一段才是它真正
 * 在省的地方 —— 也正是 `japan-m3` 的 1,000 m。
 */
export function solveGateOf(altitude: number): number {
  return altitude * 2 + 500
}

/**
 * 解算用的落地平面高度：**主甲板**，不是海面。**定義在 `world/ships.ts`**
 * —— HUD 的標記高度用的是同一個數字，而 `hud/` 不能往上依賴 `ai/`。
 */
export { deckHeightOf }

/**
 * 轟炸的釋放窗是艦體的幾倍。**這一關難度的主旋鈕。**
 *
 * 【判準是玩起來好不好玩，不是命中率】1 倍等於「算出來會打中才准投」，
 * 而彈道解算精確到近乎作弊。放寬讓 AI 願意投，投出去中不中交給彈道。
 *
 * 【比雷擊那一份窄】放手的規則是「一進窗就投」，所以窗放寬不會讓落點分散，
 * 而是把每一次放手都推到窗的最外緣 —— 窗越寬，每一顆就越早出手。炸彈有
 * 爆風、落在旁邊還扣得到血，但太寬就變成整串都落在船前面。
 *
 * 【傷害判定不受影響】那是 `World` 那一側的事：炸彈量爆心到艦體盒的距離、
 * 魚雷是接觸引爆。這個窗只決定**扣不扣扳機**。
 *
 * **起始值，由試飛裁定。**
 */
export const RELEASE_HULLS = 1.5
/**
 * 橫過船身那一軸的倍率，**比沿船身寬**。
 *
 * 【為什麼橫向要更寬】正橫進場的落點掃過的是船身的短邊：Essex 半寬 14 m，
 * 1.5 倍只有 ±21 m，落點一拍走十幾公尺，側翼批次常常整趟扣不到扳機。
 * 沿船身那一軸有幾百公尺，放寬只會讓每一顆更早出手。
 *
 * **起始值，由試飛裁定。**
 */
export const RELEASE_ACROSS_HULLS = 2

/**
 * 釋放窗的半長與半寬，m。**沿船身與橫過船身各一個倍率。**
 *
 * 【為什麼不是一個半徑】艦體細長：弗萊徹半長 57.4 m 對半寬 6.04 m，差
 * 9.5 倍。用一個圓去比的話，取大的會投一堆從船頭前面擦過去的彈，取小的則
 * 正橫進場永遠不准投。
 *
 * 【第一個盒恆是艦體】Essex 有兩個盒：主艦體寬 28.4 m、飛行甲板寬 43 m。
 * 取極值會讓窗橫向放大 51%。
 */
export function releaseWindowOf(
  boxes: readonly Box[], along = RELEASE_HULLS, across = RELEASE_ACROSS_HULLS,
): { along: number, across: number } {
  const hull = boxes[0]
  if (hull === undefined) return { along: 0, across: 0 }
  return { along: hull.half.z * along, across: hull.half.x * across }
}

/**
 * 落點與船的差向量在不在窗內。**炸彈與魚雷共用這一支。**
 *
 * @param ex 落點 − 船屆時的位置，世界座標的 x 分量
 * @param ez 同上的 z 分量
 * @param alongHulls 沿船身的窗是艦體的幾倍。**轟炸與雷擊各有自己的值**
 * @param acrossHulls 橫過船身的窗是艦體的幾倍。轟炸比沿船身寬，雷擊兩軸相同
 *
 * 【為什麼要拆進體軸】船是斜的時候，世界座標的差向量沒有意義 —— 沿船身
 * 差 50 m 仍然在船上，橫過船身差 50 m 早就落海了。
 *
 * 熱路徑（決策拍）：不配置。
 */
export function insideWindow(
  target: StrikeTarget, ex: number, ez: number,
  alongHulls = RELEASE_HULLS, acrossHulls = RELEASE_ACROSS_HULLS,
): boolean {
  const dir = S.v[1]!.set(0, 0, -1).applyQuaternion(target.orientation)
  const along = ex * dir.x + ez * dir.z
  const across = ex * dir.z - ez * dir.x
  const hull = target.hull[0]
  if (hull === undefined) return false
  return Math.abs(along) <= hull.half.z * alongHulls
    && Math.abs(across) <= hull.half.x * acrossHulls
}

/**
 * 放手判定往前多看的秒數：一個決策拍（`AI_DECISION_HZ` 的倒數，護欄在
 * `ai-bombing.test.ts`；不直接 import 是因為 `AiController` import 本檔）。
 *
 * 【為什麼要掃】判定只在決策拍跑，而落點每一拍前進十幾公尺、俯衝時前拋
 * 還跟著縮。正橫進場的窗只有 ±21 m，只看「此刻在不在窗內」會整個跳過去
 * —— 側翼批次直飛到航母卻一枚都不放。
 */
export const RELEASE_SWEEP_SECONDS = 0.1

/**
 * 落點在不在窗內，**連同這一拍之內它會掃過的那一段**。落點的世界速度近似
 * 等於飛機的水平速度，沿它在 ⅓ 與 ⅔ 拍各多採一點：相鄰兩拍的採樣點於是
 * 相距最多 ⅓ 拍（140 m/s 是 5 m），比任何一艘的窗窄得多。放手在拍與拍之
 * 間才對得上的情形，提前這一拍放：落點最多短 ⅔ 個掃距（約 9 m）。
 *
 * **`shouldRelease` 與 `stepBombAim` 共用**，兩邊的判準才是同一條。
 *
 * @param hx/hz 落點；ax/az 船屆時的位置；vx/vz 飛機的水平速度
 */
function sweptInsideWindow(
  target: StrikeTarget, hx: number, hz: number, ax: number, az: number,
  vx: number, vz: number,
): boolean {
  for (let k = 0; k <= 2; k++) {
    const t = (k * RELEASE_SWEEP_SECONDS) / 3
    if (insideWindow(target, hx + vx * t - ax, hz + vz * t - az)) return true
  }
  return false
}

const S = /* @__PURE__ */ makeScratch(3)

/** 方向退化的下限。與 `shipAttack.ts` 的 `MIN_ERROR` 同一個手法。 */
const MIN_ERROR = 1e-6

/**
 * 船在 `t` 秒後的位置。就地寫 `out`。
 *
 * 【為什麼一定要外推】船以 8 m/s 固定艏向前進，而炸彈從 1,000 m 落下約
 * 14 秒 —— **112 m**。弗萊徹全長 114.75 m。不外推的話每一顆都會落在船尾
 * 之後接近一整個船身，而且**看起來只是「AI 投得不準」**。
 *
 * 【它是解析的】固定艏向、等速、不閃避 —— `world/ships.ts` 的 `stepShips`
 * 就是這麼跑的，所以這裡不是近似，是同一條式子。
 */
export function shipAt(target: StrikeTarget, t: number, out: Vector3): Vector3 {
  // 地面目標的 speed 是 0：退化成常數，同一條式子
  out.set(0, 0, -1).applyQuaternion(target.orientation)
  return out.multiplyScalar(target.speed * t).add(target.position)
}

/**
 * `solveImpact` 的落地平面。**模組層級的可變數 + 常駐閉包** —— 那一支收的
 * 是函數，而熱路徑不得每次配置一個。
 */
let deckY = 0
const DECK = (): number => deckY

/** 解算用的暫存。模組私有，禁止跨模組共用。 */
const START: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const HIT: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
/** `stepBombAim` 的瞄點偏移，世界座標。不與 `S` 的索引共用 */
const AIM_OFFSET = /* @__PURE__ */ new Vector3()

/**
 * 現在投得中嗎。
 *
 * 兩道閘：先用 `solveGateOf` 擋掉「絕對投不到」的距離（那是效能，見那個
 * 常數），再跑精確解。**精確解仍然是唯一的判準** —— 便宜的那一道只會
 * 讓它不被呼叫，不會自己說「投得中」。
 *
 * @param k  阻力係數。`World.bombDrag`
 * @param dt 解算步長。**必須與空中的炸彈相同**（1/240），否則落點會與
 *           真正飛出去的那一顆分家
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
export function shouldRelease(
  self: Aircraft, target: StrikeTarget, k: number, dt: number,
): boolean {
  const p = self.state.position
  const gate = solveGateOf(p.y)
  const dx = target.position.x - p.x
  const dz = target.position.z - p.z
  if (dx * dx + dz * dz > gate * gate) return false

  const v = self.state.velocity
  START.x = p.x; START.y = p.y; START.z = p.z
  START.vx = v.x; START.vy = v.y; START.vz = v.z
  deckY = target.impactY
  if (!solveImpact(START, k, DECK, dt, HIT)) return false

  const at = shipAt(target, HIT.seconds, S.v[0]!)
  return sweptInsideWindow(target, HIT.x, HIT.z, at.x, at.z, v.x, v.z)
}

/**
 * 轟炸的攻擊剖面。**狀態機在 `ai/strikeRun.ts`，這裡只填武器相關的那幾格。**
 *
 * 【`drag` 與 `dt` 為什麼是可變的模組變數】`StrikeProfile` 的方法簽名對
 * 轟炸與雷擊共用，不能為了彈道多兩個參數。呼叫端在跑狀態機之前用
 * `setBombBallistics` 設一次 —— 一場之內它們是常數。
 */
let drag = 0
let solveDt = 1 / 240

/**
 * 這一台在現在這個高度與速度下的持續迴旋半徑，m。
 *
 * 【為什麼是持續而不是瞬間】掉頭是一個 180° 的迴轉，撐不住的過載換不到
 * 那一整圈。`sustainedTurnRate` 解的正是 Ps = 0 的那個過載。
 *
 * 【差距很大，所以非推導不可】1,000 m 實測：零戰 487 m、G4M 534 m、
 * B-17G 555 m、He 111 639 m —— He 111 推重比最差，退得比 B-17 還遠。
 *
 * 【退化時回 0】速度太低或爬不動時 `sustainedTurnRate` 回 0，此時脫離距離
 * 退化成只有 `lockRange`。那已經是一個安全的下限（進得了場）。
 */
function turnRadius(self: Aircraft): number {
  const v = self.state.velocity
  const tas = Math.hypot(v.x, v.y, v.z)
  if (tas < MIN_ERROR) return 0
  const omega = sustainedTurnRate(self.spec, self.state.position.y, tas)
  return omega > 0 ? tas / omega : 0
}

/**
 * 設定彈道參數。**`drag` 必須與 `World.bombDrag` 是同一個值**，`dt` 必須與
 * 空中的炸彈相同 —— 兩邊漂開的話 AI 算的落點與飛出去的那一顆不一樣，而
 * 症狀只是「投不準」。
 */
export function setBombBallistics(k: number, dt: number): void {
  drag = k
  solveDt = dt
}

/**
 * 【`abortRange` 為什麼是 600】放手點隨高度變（1,000 m 平飛約在船前 1.3 km），
 * 比它更近就代表這一趟已經錯過了。600 m 還在 20 mm 的有效射程之外一點，
 * 來得及掉頭。**起始值，由試飛裁定。**
 *
 * `lockRange` 與 `egressRange` 不是常數，每個決策拍由 `plan` 推導。
 */
/**
 * 鎖定航向之後到放手之前要留多長，m。
 *
 * 【它是投彈窗的餘裕，不能是 0】鎖定距離的本體（到瞄點的距離）指的是窗口
 * 的**正中央** —— 恰好那一點放手才打得中。窗口沿著航路只有正負幾十公尺寬
 * （艦寬的函數，埃塞克斯約 ±75 m），而投彈只在直飛段判定。餘裕是 0 的話
 * 飛機在窗口中央才轉直飛，前半個窗口整段是浪費的，而進場段任何一點偏差
 * 都會把剩下的半個窗口也吃掉，症狀是**整趟一枚都投不出來**。
 *
 * 【它不負責讓第一枚打得中】那是航向鎖定做的。直線段只影響連投的第二枚：
 * G4M 一趟兩枚間隔 0.35 s，機身還在轉的話第二枚會飛出去 45～54 m。
 *
 * 【代價】它同時把 `egressRange` 撐大同樣的量，一趟循環因此長一點。
 *
 * **起始值，由試飛裁定。**
 */
export const RUN_SETTLE = 150

/**
 * 造一份轟炸剖面。
 *
 * 【為什麼是工廠不是常數】魚雷那一支要換掉整份剖面，而這一支的兩個幾何
 * 旋鈕（直線段長度、脫離距離）還在試飛階段 —— 用工廠才比較得出來。
 *
 * @param runSettle  鎖定航向之後到放手之前要留多長，m。見 `RUN_SETTLE`
 * @param egressRange 脫離要拉開到多遠才准再進場，m
 */
export function makeBombProfile(runSettle = RUN_SETTLE): StrikeProfile {
  return {
  runAltitude: null,
  lockCone: 25 * DEG,
  abortRange: 600,
  runSeconds: 60,
  egressClimb: 12 * DEG,

  /**
   * 瞄「船在落彈時刻的位置」，鎖定距離＝「前拋距離 ＋ 船沿視線靠近的量
   * ＋ `RUN_SETTLE`」。
   *
   * 【為什麼不是接近時刻】航向要對準的是炸彈**最後會落到**的那一點，不是
   * 飛機會飛到的那一點。兩者差 112 m（8 m/s × 14 s），而窗只有 18.82 m。
   *
   * 【解算失敗就退回接近時刻】那發生在高度不夠或速度太低時，此時它還在
   * 進場段，一個粗略的前置量比什麼都不給好。
   */
  plan(self, ship, out) {
    const p = self.state.position
    const v = self.state.velocity
    START.x = p.x; START.y = p.y; START.z = p.z
    START.vx = v.x; START.vy = v.y; START.vz = v.z
    deckY = ship.impactY
    if (drag > 0 && solveImpact(START, drag, DECK, solveDt, HIT)) {
      shipAt(ship, HIT.seconds, out.aim)
      // 【放手點 ＝ 前拋距離 ＋ 船沿視線靠近的量】炸彈落在自己前方 `throw`
      // 處，而它要落在**船的未來位置**上 —— 船迎面開來時那一點比現在的船更
      // 近，所以該放手的距離比前拋遠一個 `lead`。少了它，投彈窗整段落在鎖定
      // 距離之外，而投彈只在直飛段判定：整趟扣不到扳機，一枚都投不出去。
      //
      // 【不能直接用「到瞄點的距離」】那個量會隨著飛機接近一起縮，鎖定條件
      // 於是永遠差一點點（同 `ai/torpedoRun.ts` 記過的那個陷阱）。前拋與
      // `lead` 都不隨距離變，這個閘門才是一個固定的接戰距離。
      const throwRange = Math.hypot(HIT.x - p.x, HIT.z - p.z)
      const range = Math.hypot(ship.position.x - p.x, ship.position.z - p.z)
      const lead = range - Math.hypot(out.aim.x - p.x, out.aim.z - p.z)
      out.lockRange = throwRange + lead + runSettle
      out.egressRange = out.lockRange + 2 * turnRadius(self)
      return
    }
    const speed = Math.hypot(v.x, v.z)
    const range = Math.hypot(ship.position.x - p.x, ship.position.z - p.z)
    shipAt(ship, speed > MIN_ERROR ? range / speed : 0, out.aim)
    out.lockRange = runSettle
    out.egressRange = runSettle + 2 * turnRadius(self)
  },

  shouldRelease(self, ship) {
    return shouldRelease(self, ship, drag, solveDt)
  },
  }
}

/** 目前上場的那一份。 */
export const BOMB_PROFILE = makeBombProfile()

// ── 戰鬥機的掛彈掃射 ─────────────────────────────────────────────────

/**
 * 距離多近才把瞄準點換成落彈解，m。**斜距。**
 *
 * 【它是保險栓，不是投彈條件】投不投由 `shouldRelease` 那條窗決定。這個
 * 上限擋的是「數學上成立但戰術上很蠢」的解 —— 平飛在三公里外就找得到一個
 * 落點對得上的姿態，那一趟等於遠遠丟出去，而這個戰法要的是衝進去。
 *
 * 【下限不在這裡】掃射的 `SHIP_BREAK_RANGE` 一到就交還瞄準點，脫離優先。
 *
 * **起始值，由試飛裁定。**
 */
export const BOMB_AIM_RANGE = 1000

/**
 * 落彈點瞄準的狀態。**由 `AiController` 持有**，與 `StrikeState` 同一個性質。
 */
export interface BombAimState {
  /** 修正後的瞄準方向，單位向量。`active` 為 false 時內容沒有意義 */
  readonly aim: Vector3
  /** 這一步要不要放。呼叫端寫進 `Command.bombing` */
  release: boolean
  /** 這一拍有沒有接手瞄準點 */
  active: boolean
}

export function createBombAim(): BombAimState {
  return { aim: new Vector3(), release: false, active: false }
}

export function resetBombAim(s: BombAimState): void {
  s.aim.set(0, 0, 0)
  s.release = false
  s.active = false
}

/** 修正量的角度上限，rad。 */
const AIM_CLAMP = 30 * DEG

/**
 * 推進一步：算出「把落點推到船上」要往哪飛，以及現在放不放得中。
 *
 * ## 瞄準律
 *
 * 落點在自己前方 `throw` 處，而瞄準點轉 θ 會讓落點移動約 `θ × throw`。
 * 所以要把落點移動 `err`，瞄準點就轉 `err / throw` —— 把那個小向量加到
 * 視線的單位向量上即可。
 *
 * **每一拍都從視線重算，不是在上一拍的指令上疊加。** 疊加的話指令角度會
 * 每格滾雪球（`ai/steer.ts` 的 `unloadAim` 記過那個實測：4 秒由 −27° 跑到
 * −56°）。從視線重算讓它是當前狀態的純函數。
 *
 * 【俯衝是它自己長出來的，不是規則寫的】太高太平時前拋遠大於距離，落點
 * 落在船的另一邊，修正量於是一路把機首往下壓 —— 直到前拋縮到與距離相等。
 *
 * @param loaded 艙裡還有東西嗎。空了就把瞄準點交還給機槍
 * @param decide 這一步是不是決策拍。**解算只在決策拍跑**（一次 170 µs）
 *
 * 熱路徑：不配置。不修改 `self`，也不修改 `ship`。
 */
export function stepBombAim(
  state: BombAimState, self: Aircraft, ship: StrikeTarget,
  loaded: boolean, decide: boolean, aimPoint: Vector3 | null = null,
): void {
  if (!decide) return
  state.active = false
  state.release = false
  if (!loaded) return

  // 【瞄船身上的那一點】`aimPoint` 是艦體座標（`ShipClass.aimPoints`），轉進
  // 世界之後瞄準、落彈面與放手的窗都以它為準；沒給就是船心與甲板
  const off = aimPoint === null
    ? AIM_OFFSET.set(0, 0, 0)
    : AIM_OFFSET.copy(aimPoint).applyQuaternion(ship.orientation)
  const p = self.state.position
  const dx = ship.position.x + off.x - p.x
  const dy = ship.position.y + off.y - p.y
  const dz = ship.position.z + off.z - p.z
  const slant = Math.hypot(dx, dy, dz)
  // 【上限與下限】太遠不接手；進到拉起距離就交還 —— 脫離要背離船並爬升，
  // 這一層若還在寫瞄準點，飛機會被拉回船上撞上去
  if (slant > BOMB_AIM_RANGE || slant < SHIP_BREAK_RANGE || slant < MIN_ERROR) return

  const v = self.state.velocity
  START.x = p.x; START.y = p.y; START.z = p.z
  START.vx = v.x; START.vy = v.y; START.vz = v.z
  deckY = aimPoint === null ? ship.impactY : ship.position.y + off.y
  if (drag <= 0 || !solveImpact(START, drag, DECK, solveDt, HIT)) return

  const at = shipAt(ship, HIT.seconds, S.v[0]!)
  at.x += off.x
  at.z += off.z
  const ex = at.x - HIT.x
  const ez = at.z - HIT.z
  state.release = sweptInsideWindow(ship, HIT.x, HIT.z, at.x, at.z, v.x, v.z)

  const throwRange = Math.hypot(HIT.x - p.x, HIT.z - p.z)
  const aim = state.aim.set(dx / slant, dy / slant, dz / slant)
  if (throwRange > MIN_ERROR) {
    // 【夾住修正量】前拋很短時（貼著船、機首朝下）除法會炸開，而一個
    // 90° 的修正只會讓飛機翻過去。夾在 30° 之內，收斂交給下一拍
    const scale = Math.min(1, (AIM_CLAMP * throwRange) / Math.max(Math.hypot(ex, ez), MIN_ERROR))
    aim.x += (ex / throwRange) * scale
    aim.z += (ez / throwRange) * scale
    aim.normalize()
  }
  state.active = true
}
