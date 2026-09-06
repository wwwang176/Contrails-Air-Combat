import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEG } from '../core/math'
import { solveImpact, type BombState, type Impact } from '../world/bomb'
import { sustainedTurnRate } from '../analysis/envelope'
import type { Aircraft } from '../aircraft/Aircraft'
import type { StrikeProfile } from './strikeRun'
import { deckHeightOf } from '../world/ships'
import type { Ship, ShipClass } from '../world/ships'

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
 * 【它是效能閘，不是判準】精確解一次要 58～188 µs（Codex 2026-09-06 實測：
 * 1,000 m 57.9、4,000 m 123.4、8,000 m 188.3），而 40 架 × 10 Hz 攤到物理步
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
 * 在省的地方 —— 也正是 `japan-m4` 的 1,000 m。
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
 * 釋放半徑是船寬的幾倍。
 *
 * 【上界是殺傷半徑】500 kg 的殺傷半徑 39 m（`blastRadiusOf(11700)`），而
 * 2 倍船寬是弗萊徹 24.2 m、威奇塔 37.6 m —— 都還傷得到船。再放寬就是丟進
 * 海裡。
 */
export const RELEASE_BEAMS = 2

/**
 * 釋放半徑，m。**船寬 × `RELEASE_BEAMS`。**
 *
 * ```
 *                      船寬     釋放半徑
 *   Fletcher DD-445   12.08 m    24.16 m
 *   Wichita CA-45     18.82 m    37.64 m
 *   Essex CV-9        28.40 m    56.80 m
 * ```
 *
 * 【船寬取 `hull[0]`】Essex 有兩個盒：主艦體寬 28.4 m、飛行甲板寬 43 m。
 * 取極值會放大 51%。**第一個盒恆是艦體。**
 *
 * 【這一關難度的主旋鈕】
 */
export function releaseRadiusOf(cls: ShipClass): number {
  const hull = cls.hull[0]
  return hull === undefined ? 0 : hull.half.x * 2 * RELEASE_BEAMS
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
export function shipAt(ship: Ship, t: number, out: Vector3): Vector3 {
  out.set(0, 0, -1).applyQuaternion(ship.orientation)
  return out.multiplyScalar(ship.speed * t).add(ship.position)
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
  self: Aircraft, ship: Ship, k: number, dt: number,
): boolean {
  const p = self.state.position
  const gate = solveGateOf(p.y)
  const dx = ship.position.x - p.x
  const dz = ship.position.z - p.z
  if (dx * dx + dz * dz > gate * gate) return false

  const v = self.state.velocity
  START.x = p.x; START.y = p.y; START.z = p.z
  START.vx = v.x; START.vy = v.y; START.vz = v.z
  deckY = deckHeightOf(ship.cls)
  if (!solveImpact(START, k, DECK, dt, HIT)) return false

  const at = shipAt(ship, HIT.seconds, S.v[0]!)
  const ex = HIT.x - at.x
  const ez = HIT.z - at.z
  const r = releaseRadiusOf(ship.cls)
  return ex * ex + ez * ez <= r * r
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
 * 轟炸剖面的起始值。**全部由試飛裁定。**
 *
 * 【`lockRange` 為什麼是 3,000】炸彈從 1,000 m 平飛投下的水平行程約
 * 1,260 m，所以放手點在船前約 1.3 km。3 km 開始鎖航向留下約 19 秒的
 * 穩定時間（90 m/s），足夠機身把轉彎的餘擺收乾淨。
 *
 * 【`abortRange` 為什麼是 600】比放手點（約 1,300 m）更近就代表這一趟已經
 * 錯過了。600 m 還在 20 mm 的有效射程之外一點，來得及掉頭。
 *
 * 【`egressRange` 為什麼是 5,000】補彈要 20 秒，而 90 m/s 下 20 秒是
 * 1.8 km —— 但脫離之後還要留夠長度讓下一趟的直飛穩定下來（見 `lockRange`
 * 的 3 km）。5 km 同時滿足兩者。
 */
/**
 * 鎖定航向之後到放手之前要留多長，m。**負責人 2026-09-06 裁定：0。**
 *
 * 【它的作用不是「讓第一枚打得中」——那是航向鎖定做的】A/B 實測（一台
 * G4M、一艘不開火的威奇塔、五分鐘）：
 *
 * ```
 *                        平均循環   命中(<40m)   落點
 *   脫離5000 / 直線1200    111 s      6/6       6,33,12,33
 *   脫離3000 / 直線1200     66 s      8/8       6,33,15,25
 *   脫離3000 / 直線   0     67 s      4/8       6,45,11,54
 *   脫離5000 / 直線   0    111 s      3/6       6,45, 5,49
 * ```
 *
 * **每一趟的第一枚，四組完全一樣（6 m）。** 直線段只影響**連投的第二枚**
 * ——G4M 一趟兩枚間隔 0.35 s，飛機還在轉的話第二枚會飛出去 45～54 m。
 *
 * 【為什麼還是訂 0】負責人裁定：「命中率低沒關係，AI 操作玩起來比較好玩
 * 比較重要」。直線段對循環時間沒有影響（111 vs 111、66 vs 67），但它會把
 * `lockRange` 撐大 1,200 m，連帶把脫離距離也撐大 —— 拿掉之後 G4M 在
 * 1,000 m 的脫離距離由 3,456 m 降到 2,256 m。
 *
 * 【參數保留】`makeBombProfile` 仍然收它，隨時可以調回來重測。
 */
export const RUN_SETTLE = 0

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
   * 瞄「船在落彈時刻的位置」，鎖定距離＝「前拋距離 ＋ `RUN_SETTLE`」。
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
    deckY = deckHeightOf(ship.cls)
    if (drag > 0 && solveImpact(START, drag, DECK, solveDt, HIT)) {
      shipAt(ship, HIT.seconds, out.aim)
      // 前拋距離：落點離現在的水平距離
      out.lockRange = Math.hypot(HIT.x - p.x, HIT.z - p.z) + runSettle
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
