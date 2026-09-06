import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { DEG } from '../core/math'
import { solveImpact, type BombState, type Impact } from '../world/bomb'
import { TORPEDO_RANGE, TORPEDO_SPEED } from '../world/torpedo'
import { shipAt } from './bombRun'
import { TORPEDO_ENVELOPE, canRelease } from '../weapons/releaseEnvelope'
import { sustainedTurnRate } from '../analysis/envelope'
import type { Aircraft } from '../aircraft/Aircraft'
import type { StrikeProfile } from './strikeRun'
import type { Ship, ShipClass } from '../world/ships'

/**
 * # AI 的雷擊航路
 *
 * **狀態機與轟炸共用**（`ai/strikeRun.ts`），這裡只填武器相關的那幾格 ——
 * 與 `ai/bombRun.ts` 平行。
 *
 * ## 為什麼瞄準只需要解一次彈道
 *
 * 魚雷是兩段：空中的拋物線，落水之後**定深等速直線**。看起來要疊代，
 * 其實不用 ——
 *
 * **空中那一段與船在哪無關。** 它只是飛機當下狀態的函數，所以
 * `solveImpact` 解一次就拿到入水點與空中時間，與船無關。
 *
 * **水中那一段是等速追等速，有閉式解。** 「從入水點出發、以 22 m/s 直線
 * 追一艘等速直行的船」是一個二次式（見 `waterRunSeconds`）。
 *
 * 所以總共一次 `solveImpact` 加一個開根號，比轟炸那一份還便宜。
 *
 * ## 為什麼沒有夾角門檻
 *
 * 直覺是「尾追追不到，要擋掉」。但雷 22 m/s 比船快，**攔截解永遠存在**
 * ——尾追真正的問題是**雷程用盡**，而那本來就要檢查。夾角因此不是一個
 * 需要另外擋的情況，它會自己以「水中航程超過射程」的形式被擋掉。
 *
 * 夾角有量進報表（`test/tools/torpedo-run.probe.ts`），要不要加門檻等命中率
 * 有數字再說。
 *
 * ## 這一層不做的
 *
 * - 不迴避彈幕、不編隊雷擊。
 * - 不決定「艙空了要不要繼續」—— 狀態機收 `loaded`，空了就停在脫離段。
 */

/** 方向退化的下限。與 `bombRun.ts` 同一個手法。 */
const MIN_ERROR = 1e-6

const S = /* @__PURE__ */ makeScratch(4)

/**
 * 水中段要跑幾秒才追得到。**追不到回 −1。**
 *
 * 雷從 `(ex, ez)` 出發、速度大小 `speed`、方向由攔截解決定；船在入水時刻
 * 位於 `(sx, sz)`、速度 `(ux, uz)`。要找的 t 滿足
 *
 * ```
 *   |(sx, sz) + (ux, uz)·t − (ex, ez)| = speed · t
 * ```
 *
 * 平方之後是 `a·t² + b·t + c = 0`：
 *
 * ```
 *   a = |u|² − speed²      b = 2·(d · u)      c = |d|²
 * ```
 *
 * 【為什麼恆有唯一的非負根】雷比船快時 `a < 0`，而 `c ≥ 0`，所以兩根的
 * 乘積 `c / a ≤ 0` —— 一正一負。取正的那個就是答案，不必挑、不必疊代。
 *
 * 【船比雷快時才會沒有解】`a ≥ 0` 時可能兩根皆負。這在遊戲裡不會發生
 * （最快的船 15 m/s 對雷的 22 m/s），但**判準寫成肯定式**，退化時回 −1
 * 而不是回一個假的時間。
 */
export function waterRunSeconds(
  ex: number, ez: number,
  sx: number, sz: number,
  ux: number, uz: number,
  speed: number,
): number {
  const dx = sx - ex
  const dz = sz - ez
  const c = dx * dx + dz * dz
  if (c <= 0) return 0
  const a = ux * ux + uz * uz - speed * speed
  const b = 2 * (dx * ux + dz * uz)
  if (a > -MIN_ERROR) {
    // 【退化：船不比雷慢】剩下的是一次式 `b·t + c = 0`
    if (b >= -MIN_ERROR) return -1
    return -c / b
  }
  const disc = b * b - 4 * a * c
  if (!(disc >= 0)) return -1
  const root = Math.sqrt(disc)
  // `2a < 0`，所以較大的那個根是 `(−b − √disc) / (2a)`
  const t = (-b - root) / (2 * a)
  return t >= 0 ? t : -1
}

/**
 * 命中窗：船體盒的**半長與半寬**，m。
 *
 * 【為什麼不是一個半徑】魚雷是**接觸引爆、沒有範圍傷害**，所以窗就是艦體
 * 本身，而艦體是細長的：弗萊徹半長 57.4 m、半寬 6.04 m —— 差 9.5 倍。用
 * 一個圓去近似的話，取大的會投一堆擦身而過的雷，取小的則正橫進場永遠不
 * 准投。
 *
 * 【第一個盒恆是艦體】與 `releaseRadiusOf` 同一條不變量：Essex 的第二個盒
 * 是寬 43 m 的飛行甲板，取極值會放大 51%。
 */
export function hitWindowOf(cls: ShipClass): { along: number; across: number } {
  const hull = cls.hull[0]
  if (hull === undefined) return { along: 0, across: 0 }
  return { along: hull.half.z, across: hull.half.x }
}

/**
 * 空中段的落地平面是**海面**，不是甲板。
 *
 * 【與轟炸的差別】炸彈炸的是甲板（高 4.5～7 m），魚雷入的是水。`World`
 * 餵給魚雷的 `groundAt` 在海上回 0，這裡必須是同一個平面，否則 AI 算的
 * 入水點與飛出去的那一枚分家。
 */
const SEA = (): number => 0

/** 解算用的暫存。模組私有，禁止跨模組共用。 */
const START: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const HIT: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }

/**
 * 彈道參數。**`drag` 與 `dt` 必須與 `World` 餵給魚雷的相同** —— 空中段
 * 走的是同一支 `stepBomb`，兩邊漂開的症狀只是「投不準」。
 *
 * 【為什麼是模組變數】`StrikeProfile` 的方法簽名與轟炸共用，不能為了彈道
 * 多兩個參數。同 `bombRun.ts` 的 `setBombBallistics`。
 */
let drag = 0
let solveDt = 1 / 240

export function setTorpedoBallistics(k: number, dt: number): void {
  drag = k
  solveDt = dt
}

/**
 * 這一步的解算結果。`plan` 與 `shouldRelease` 各自填，不共用 —— 兩者可能
 * 在同一拍以不同的飛機狀態被呼叫。
 */
interface Solution {
  /** 入水點 */
  ex: number
  ez: number
  /** 空中時間，s */
  air: number
  /** 水中時間，s。−1 = 追不到 */
  water: number
}
const SOL: Solution = { ex: 0, ez: 0, air: 0, water: -1 }

/**
 * 解這一枚：空中落到哪、水中要跑多久。**解不出來時 `water` 是 −1。**
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
function solve(self: Aircraft, ship: Ship): boolean {
  const p = self.state.position
  const v = self.state.velocity
  START.x = p.x; START.y = p.y; START.z = p.z
  START.vx = v.x; START.vy = v.y; START.vz = v.z
  if (drag <= 0 || !solveImpact(START, drag, SEA, solveDt, HIT)) return false
  SOL.ex = HIT.x
  SOL.ez = HIT.z
  SOL.air = HIT.seconds
  // 船在**入水時刻**的位置，水中段從那裡開始算
  const at = shipAt(ship, HIT.seconds, S.v[0]!)
  const dir = S.v[1]!.set(0, 0, -1).applyQuaternion(ship.orientation)
  SOL.water = waterRunSeconds(
    HIT.x, HIT.z, at.x, at.z,
    dir.x * ship.speed, dir.z * ship.speed, TORPEDO_SPEED,
  )
  return true
}

/**
 * 雷的水中航向 = 投放瞬間的**水平**航向。
 *
 * 【它是精確的，不是近似】`stepBomb` 的阻力與速度反向、重力只動垂直分量，
 * 所以水平兩軸恆等比例縮放 —— **方向在整個空中段守恆**。`world/torpedo.ts`
 * 的入水段正是拿入水速度的水平分量當航向。
 *
 * 退化（垂直下墜）時回 false。
 */
function waterHeading(self: Aircraft, out: Vector3): boolean {
  const v = self.state.velocity
  const l = Math.hypot(v.x, v.z)
  if (l < MIN_ERROR) return false
  out.set(v.x / l, 0, v.z / l)
  return true
}

/**
 * 這一拍投得出去嗎 —— **姿態與高度，不含幾何。**
 *
 * 【為什麼「可以鎖」要等於「可以投」】鎖定只看機首方向，而**轉彎中的機首
 * 會短暫地指對方向**。實測一台 G4M 帶著 45° 坡度進入直飛段，一邊改平一邊
 * 讓解掃過去：誤差穿過 (1, 1)（正中艦體）的那一拍坡度是 36.5°，被包絡擋掉；
 * 等改平到 6.3° 時誤差已經長到 34 m，而窗只有 6 m。
 *
 * 【為什麼直接用 `canRelease`】它就是 `World` 那一側的判準。自己再寫一份
 * 門檻，兩邊漂開的症狀是「AI 鎖了一個它投不出去的航向」。
 *
 * 【不配置】自己算 roll/pitch 而不呼叫 `attitudeFromOrientation` —— 那一支
 * 回一個物件，而這裡是決策拍。
 */
function established(self: Aircraft, runAltitude: number): boolean {
  // 【要在航路高度上穩住，不是勉強擠進天花板】只看包絡的話，飛機一鑽進
  // 上限就鎖 —— 那時它還在俯衝。實測移動靶：鎖在 248 m、俯仰 −5°、夾角 0
  // （正尾追），而同一份剖面對靜止靶是 148 m、坡度 0.2°、夾角 131°。
  //
  // 【兩個條件】高度到位，而且**不再上下動**。少了升降率那一條，穿越
  // 航路高度的那一瞬也算數，於是它會在俯衝的途中鎖住。
  const dy = self.state.position.y - runAltitude
  if (!(Math.abs(dy) <= RUN_ALT_BAND)) return false
  if (!(Math.abs(self.state.velocity.y) <= RUN_ALT_RATE)) return false
  return releasable(self)
}

/** 離航路高度多近才算「在航路上」，m。**起始值，由試飛裁定。** */
export const RUN_ALT_BAND = 60

/**
 * 升降率小於多少才算穩住，m/s。
 *
 * 【為什麼要這一條】高度控制有殘餘擺盪（125～230 m）。只看高度的話，
 * 穿越航路高度的那一瞬也算數 —— 而那正是它下沉最快的時候。
 */
export const RUN_ALT_RATE = 8

function releasable(self: Aircraft): boolean {
  const q = self.state.orientation
  const fwd = S.v[2]!.set(0, 0, -1).applyQuaternion(q)
  const up = S.v[3]!.set(0, 1, 0).applyQuaternion(q)
  const right = S.v[1]!.set(1, 0, 0).applyQuaternion(q)
  const pitch = Math.asin(Math.max(-1, Math.min(1, fwd.y)))
  const roll = Math.atan2(-right.y, up.y)
  return canRelease(
    TORPEDO_ENVELOPE, roll, pitch, self.state.position.y, self.diag.aero.tas,
  )
}

/** 同 `bombRun.ts`：持續迴旋半徑，m。 */
function turnRadius(self: Aircraft): number {
  const v = self.state.velocity
  const tas = Math.hypot(v.x, v.y, v.z)
  if (tas < MIN_ERROR) return 0
  const omega = sustainedTurnRate(self.spec, self.state.position.y, tas)
  return omega > 0 ? tas / omega : 0
}

/**
 * 航路高度，m。**訂在 AI 飛得住的高度，不是史實的投雷高度。**
 *
 * 【50 與 100 都飛不住】實測（`test/tools/torpedo-run.probe.ts`，一台 G4M、
 * 一艘不還擊的弗萊徹、五分鐘）：
 *
 * ```
 *              投  中   結局
 *    50 m      0   0    95 s 飛進海裡，之前貼海 206 秒
 *   100 m      0   0   135 s 飛進海裡
 *   150 m      0   0   活著
 * ```
 *
 * 擋住它的不是安全層（直飛段全程 `safety=none`），是它下降之後改不出來。
 * 那是飛行控制的題目，不是雷擊剖面的 —— 轟炸剖面的 `runAltitude` 是 `null`
 * （從巡航高度投），所以這條路魚雷是第一個踩的。
 *
 * 【高度跟著 AI 飛得住的走】包絡上限也一起訂在 200
 * （`weapons/releaseEnvelope.ts`）。**起始值，由試飛裁定。**
 */
export const RUN_ALTITUDE = 150

/**
 * 鎖航向的圓錐，rad。**比轟炸的 25° 緊。**
 *
 * 【為什麼要更緊】投雷包絡的坡度只准 ±12°，等於直飛段幾乎不能修正航向。
 * 鎖得鬆就是鎖在一個修不回來的航向上。**起始值，由試飛裁定。**
 */
export const LOCK_CONE = 15 * DEG

/**
 * 放棄距離，m。到這裡還沒放出去就代表這一趟算不準了。
 *
 * 【比轟炸的 600 近】魚雷的放手點在船前 1～2 km（雷程決定），而轟炸從
 * 1,000 m 平飛投下的放手點約 1.3 km —— 兩者其實同量級，但雷擊是低空進場、
 * 掉頭半徑小，可以再往前壓一點。**起始值，由試飛裁定。**
 */
export const ABORT_RANGE = 400

/**
 * 下降到航路高度時最陡准到多少（指令方向的 sin）。**0.26 ≈ 15°。**
 *
 * 【為什麼要限】不限的話 `applyRunAltitude` 的指令會被頂到 45°，而從
 * 1,000 m 掉到 50 m 的誤差一定頂得到。實測 45°：飛機一頭栽進海裡，安全層
 * 來不及改出，之後黏在水面上以 5 m/s 抹平。
 *
 * 【為什麼是 0.45 而不是 0.26】要在進到鎖定距離（約 1,350 m）之前就降到
 * 航路高度並改平 —— 沒降完就鎖不了航向。實測對移動靶：0.26 是 2 投 1 中，
 * 0.45 與 0.7 都是 2 投 2 中，取小的那個。**起始值，由試飛裁定。**
 */
export const RUN_SLOPE = 0.45

/**
 * 水中航程的餘裕。**放手時算出來的航程要小於射程乘上這個係數。**
 *
 * 【為什麼要留】算的是放手那一瞬間的解，而雷真正入水在幾秒之後 —— 那幾秒
 * 裡船還在跑。貼著射程放的話會出現「差幾公尺跑完」的雷。
 */
export const RANGE_MARGIN = 0.9

/**
 * 預期的投放航程，m。**訂鎖定點用的，不是硬性上限。**
 *
 * 【為什麼不直接吃滿射程】鎖定距離是「空中前拋 ＋ 水中航程」，吃滿的話
 * 鎖定點落在 2.4 km 外。鎖了之後航向就固定，只剩 `RUN_TRIM` 的重阻尼修正
 * ——實測橫向誤差每 0.5 秒只收 2 m，從 65 m 收進 6 m 的窗要 30 秒，而直飛段
 * 只有 28 秒。**鎖得越遠，殘留誤差越大也越修不完。**
 *
 * 【800 m】史實的雷擊投放距離也在 500～1,000 m。硬性上限仍是
 * `TORPEDO_RANGE × RANGE_MARGIN`（見 `shouldRelease`）—— 這一格只決定什麼
 * 時候開始直飛。**起始值，由試飛裁定。**
 */
export const RELEASE_RUN = 800

/**
 * 造一份雷擊剖面。
 *
 * 【為什麼是工廠】與 `makeBombProfile` 同一個理由：旋鈕還在試飛階段，
 * 用工廠才比較得出來。
 */
export function makeTorpedoProfile(
  runAltitude = RUN_ALTITUDE,
  lockCone = LOCK_CONE,
  abortRange = ABORT_RANGE,
  runSlope = RUN_SLOPE,
): StrikeProfile {
  return {
    runAltitude,
    runSlope,
    lockCone,
    abortRange,
    runSeconds: 60,
    // 【脫離不爬升】轟炸是 12°，雷擊必須是 0 —— 每一趟爬一次，下一趟就從
    // 更高的地方進場，來不及降回包絡（上限 200 m）就又飛過頭。實測兩台
    // 飛機一艘船跑 120 秒：高度被一輪一輪打到 240 m，`run` 段只出現 2 次、
    // 一枚都沒投，而 `egress` 佔了三分之一的時間 —— 從外面看就是「明明
    // 前方有船，卻一直轉彎走掉」。
    //
    // 雷擊機本來也不爬升脫離：投完之後貼著海面閃開，爬升只是把自己送進
    // 高砲的射界。
    egressClimb: 0,

    /**
     * 瞄「船在**雷程時刻**的位置」，鎖定距離 =「空中前拋 ＋ 水中航程」。
     *
     * 【為什麼不是入水時刻】雷入水之後還要跑 0～90 秒。以 22 m/s 跑
     * 1,000 m 是 45 秒，而船在那 45 秒裡走 364 m —— 三個艦身。
     *
     * 【解不出來就退回接近時刻】那發生在速度太低或追不到時。此時它還在
     * 進場段，一個粗略的前置量比什麼都不給好。
     */
    plan(self, ship, out) {
      const p = self.state.position
      // 【投不出去就不准鎖航向】見 `releasable`。`lockRange` 給 0 就是
      // 「這一拍還不到鎖的時候」—— 飛機繼續在進場段改平、下降、對正，
      // 等姿態進了包絡再鎖。
      //
      // 【拿 y 當 AGL】雷擊的目標在海上，海面恆為 0。這一層拿不到地形，
      // 而內陸沒有船。
      const ready = established(self, runAltitude)
      if (solve(self, ship) && SOL.water >= 0) {
        shipAt(ship, SOL.air + SOL.water, out.aim)
        // 【水中航程要夾在射程之內】從 8 km 外解出來的航程是好幾公里，而雷
        // 只跑得了 2 km。不夾的話 `lockRange` 跟著距離一起長，飛機會在 5 km
        // 外就鎖死航向 —— 鎖了之後不能修正，等飛到投放點時解早就漂掉了；
        // `egressRange` 也跟著長，脫離要飛到 13 km 才准回頭。
        // 【用預期航程，不是這一拍解出來的】解出來的航程隨著飛機接近而變短，
        // 於是 `lockRange` 跟著 `range` 一起縮、永遠差一點點 —— 實測
        // 1086/884、1044/853、1001/821…**鎖定條件永遠不成立**。鎖定距離要
        // 是一個固定的接戰距離：飛到這裡就開始直飛，不管這一拍算出什麼。
        const reach = Math.hypot(SOL.ex - p.x, SOL.ez - p.z) + RELEASE_RUN
        out.lockRange = ready ? reach : 0
        // 【脫離距離照算】它管的是「飛多遠才准回頭」，與這一拍鎖不鎖無關
        out.egressRange = reach + 2 * turnRadius(self)
        return
      }
      const v = self.state.velocity
      const speed = Math.hypot(v.x, v.z)
      const range = Math.hypot(ship.position.x - p.x, ship.position.z - p.z)
      shipAt(ship, speed > MIN_ERROR ? range / speed : 0, out.aim)
      out.lockRange = 0
      out.egressRange = 2 * turnRadius(self)
    },

    shouldRelease(self, ship) {
      return shouldRelease(self, ship)
    },
  }
}

/**
 * 現在投得中嗎。
 *
 * 三道：追得到、射程夠、**雷真的會撞到艦體**。第三道問的與轟炸同一件事
 * ——「現在投會走到哪」對「船屆時會在哪」—— 只是窗換成艦體盒本身，因為
 * 魚雷是接觸引爆。
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
export function shouldRelease(self: Aircraft, ship: Ship): boolean {
  const h = S.v[2]!
  if (!waterHeading(self, h)) return false
  if (!solve(self, ship) || SOL.water < 0) return false

  const run = TORPEDO_SPEED * SOL.water
  if (run > TORPEDO_RANGE * RANGE_MARGIN) return false

  // 雷實際會走到的點：入水點沿著水平航向走完水中航程
  const tx = SOL.ex + h.x * run
  const tz = SOL.ez + h.z * run
  const at = shipAt(ship, SOL.air + SOL.water, S.v[0]!)
  // 【誤差拆進船的體軸】艦體細長（半長 57.4 對半寬 6.04），用一個圓去比
  // 的話取大的會投一堆擦身而過的雷、取小的則永遠不准投
  const dir = S.v[1]!.set(0, 0, -1).applyQuaternion(ship.orientation)
  const ex = tx - at.x
  const ez = tz - at.z
  const along = ex * dir.x + ez * dir.z
  const across = ex * dir.z - ez * dir.x
  const w = hitWindowOf(ship.cls)
  return Math.abs(along) <= w.along && Math.abs(across) <= w.across
}

/**
 * `shouldRelease` 的內部量，攤開給量測工具看。**不進遊戲路徑。**
 *
 * 【為什麼不是把 `shouldRelease` 拆開】那一支是熱路徑，回一個物件就是每拍
 * 一次配置。這一支只給 `test/tools/` 呼叫，配置無所謂。
 */
export function diagnose(self: Aircraft, ship: Ship): {
  run: number; along: number; across: number
  wAlong: number; wAcross: number; ok: boolean
} {
  const w = hitWindowOf(ship.cls)
  const out = { run: NaN, along: NaN, across: NaN, wAlong: w.along, wAcross: w.across, ok: false }
  const h = new Vector3()
  if (!waterHeading(self, h) || !solve(self, ship) || SOL.water < 0) return out
  out.run = TORPEDO_SPEED * SOL.water
  const tx = SOL.ex + h.x * out.run
  const tz = SOL.ez + h.z * out.run
  const at = shipAt(ship, SOL.air + SOL.water, new Vector3())
  const dir = new Vector3(0, 0, -1).applyQuaternion(ship.orientation)
  const ex = tx - at.x
  const ez = tz - at.z
  out.along = ex * dir.x + ez * dir.z
  out.across = ex * dir.z - ez * dir.x
  out.ok = out.run <= TORPEDO_RANGE * RANGE_MARGIN
    && Math.abs(out.along) <= w.along && Math.abs(out.across) <= w.across
  return out
}

/** 目前上場的那一份。 */
export const TORPEDO_PROFILE = makeTorpedoProfile()
