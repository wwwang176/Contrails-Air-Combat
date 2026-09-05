import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { WEP_THROTTLE } from '../physics/propulsion'
import { DEG } from '../core/math'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
import type { Ship } from '../world/ships'
import type { Team } from '../world/World'

/**
 * # AI 的對艦索敵與掃射
 *
 * **與空戰完全平行的一條路徑。只在空戰那一側回傳「沒有目標」時才問。**
 * 有敵機在、或這一場沒有船，程式碼路徑與沒有這個模組時相同。
 *
 * `selectTarget`／`targetScore`（`ai/target.ts`）不涉入：它評的每一項
 * （機會、威脅、切換成本、視野）對一艘不會轉向、以砲位而非機首還手的船
 * 都沒有意義，而把船塞進 `TargetCandidate` 要給它一具假的 `Aircraft`。
 *
 * ## 目標是砲位
 *
 * 掃射艦隊做的事就是打掉防空砲，而砲位是這一期唯一打得掉的東西（船體要等
 * 魚雷）。瞄船體中心會讓飛機對著一塊沒有東西的甲板打。砲位全打光的船才
 * 改瞄船體 —— 那是魚雷的目標，也是攻擊航路的起點。
 *
 * ## 索敵不看自己有沒有武器
 *
 * 「能不能鎖定」與「打不打得動」是兩層。一式陸攻沒有固定槍，但它低空掠過
 * 去時側方與機腹的 20 mm 銃手會打砲位（`world/turrets.ts` 的 `pickTarget`）
 * —— 用武器擋索敵會讓那一整段行為消失。
 *
 * ## 這一層不做的
 *
 * - 不迴避彈幕。威脅評估只認得飛機。
 * - 不投雷、不投彈。
 * - 不編隊攻擊。僚機仍然走站位那一格。
 */

/**
 * 多遠之內才會把船當目標，m。
 *
 * 【為什麼要有上限】不擋的話，開場在 20 km 外、身邊沒有敵機的 AI 會立刻
 * 脫離編隊一路飛向艦隊，而那一段路上它什麼都不做。**起始值。**
 */
export const SHIP_ATTACK_RANGE = 8000

/**
 * 進到這麼近就拉起來脫離，m。
 *
 * 【它守的是撞船】撞船現在是致命的（`World.hitsShip`），而俯衝掃射的 AI
 * 沒有任何東西會叫它拉桿 —— `applySafety` 看的是地形與海面，不是船。
 *
 * 【400 m 怎麼來】400 m/s 俯衝下是一秒。P-51D 拉起來要不到那麼久，而
 * 再近就進入 20 mm 的近迫火網最密的那一段。**起始值，由試飛裁定。**
 */
export const SHIP_BREAK_RANGE = 400

/**
 * 開火的距離，m。**比彈丸射程短** —— 遠處掃射只是浪費彈藥與暴露時間。
 * `PROJECTILE_LIFETIME × 887` 是 1,064 m，取七成。
 */
export const SHIP_FIRE_RANGE = 750

/** 機首與瞄準線的夾角小於這個才開火，rad。 */
export const SHIP_FIRE_CONE = 3 * DEG

/**
 * 船體瞄點比水線高多少，m。
 *
 * 【為什麼不是 0】艦體盒的原點在**水線**上（與 `shipAA.ts` 同一套座標），
 * 瞄它等於瞄海面。**只有砲位全打光時才會用到** —— 平常瞄的是砲位本身。
 */
export const SHIP_AIM_HEIGHT = 12

/**
 * 鎖定的東西：哪一艘船的哪一個砲位。
 *
 * `gun` 為 −1 代表「這艘船的砲位都打光了，瞄船體」。
 */
export interface ShipAim {
  ship: number
  gun: number
}

export function createShipAim(): ShipAim {
  return { ship: -1, gun: -1 }
}

/**
 * 粗篩的餘裕，m。取最長的艦體半長（Essex 133 m）再放寬。
 *
 * 【它必須寬到不會假陰性】粗篩用船心、比距離用砲位，兩者最多差一個艦體
 * 半長。算小了的症狀是「艦艏的砲位永遠不會被選中」，而且沒有任何錯誤。
 */
const HULL_SLACK = 200

const P0 = /* @__PURE__ */ new Vector3()

/**
 * 挑一個對艦目標：敵隊、還浮著、在接戰半徑內，取**離自己最近的砲位**；
 * 那艘船的砲位若已經打光，改瞄它的船體。回傳有沒有挑到。
 *
 * 【為什麼只用距離，不像空戰那樣評分】船不會轉向、不會逃，彼此也沒有
 * 「誰比較威脅我」的差別。多一套評分只是多一組要調的旋鈕。
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
export function pickShipTarget(
  selfPos: Vector3, selfTeam: Team, ships: readonly Ship[], out: ShipAim,
): boolean {
  out.ship = -1
  out.gun = -1
  let bestSq = SHIP_ATTACK_RANGE * SHIP_ATTACK_RANGE
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!
    if (!s.alive || s.team === selfTeam) continue
    // 粗篩：船心離得比「目前最佳 ＋ 一個艦體半長」還遠就不必逐砲位比
    const coarse = Math.sqrt(bestSq) + HULL_SLACK
    if (selfPos.distanceToSquared(s.position) > coarse * coarse) continue

    let anyGun = false
    for (let g = 0; g < s.guns.length; g++) {
      if (!s.guns[g]!.alive) continue
      anyGun = true
      const d = selfPos.distanceToSquared(gunWorld(s, g, P0))
      if (d > bestSq) continue
      bestSq = d
      out.ship = i
      out.gun = g
    }

    // 砲位全打光的船改瞄船體：魚雷的目標，也是攻擊航路的起點
    if (anyGun) continue
    const d = selfPos.distanceToSquared(shipAimPoint(s, P0))
    if (d > bestSq) continue
    bestSq = d
    out.ship = i
    out.gun = -1
  }
  return out.ship >= 0
}

/**
 * 一個砲位的世界座標。就地寫 `out`。
 *
 * **與 `stepShipGuns` 的槍口、渲染層的槍焰是同一個算法** —— 三處分開寫會
 * 漂開，症狀是「打的地方跟看到的地方差幾公尺」。
 */
export function gunWorld(ship: Ship, gunIndex: number, out: Vector3): Vector3 {
  const g = ship.guns[gunIndex]
  if (g === undefined) return shipAimPoint(ship, out)
  return out.copy(g.zone.position).applyQuaternion(ship.orientation).add(ship.position)
}

/** 船體的瞄點：位置抬到上層建築的高度帶。 */
export function shipAimPoint(ship: Ship, out: Vector3): Vector3 {
  return out.set(ship.position.x, ship.position.y + SHIP_AIM_HEIGHT, ship.position.z)
}

/** 鎖到砲位就瞄砲位，否則瞄船體。 */
export function shipAimAt(ship: Ship, gunIndex: number, out: Vector3): Vector3 {
  return gunIndex >= 0 ? gunWorld(ship, gunIndex, out) : shipAimPoint(ship, out)
}

const S = /* @__PURE__ */ makeScratch(3)
const FWD = /* @__PURE__ */ new Vector3(0, 0, -1)
/** 方向退化的下限，m。與 `rallyAim` 同一個手法。 */
const MIN_ERROR = 1e-6

/**
 * 掃射一個目標。寫滿整個 `Command`。
 *
 * 三段：**遠了就飛過去、對準了就開火、太近就拉起來**。
 *
 * 【脫離優先於開火】兩者同時成立時（貼著船還對得很準）選脫離 —— 多打的
 * 那零點幾秒換不到一架飛機。
 *
 * 【`firing` 對沒有固定槍的機種是空轉】`World.fire` 跑的是 `battery.mounts`，
 * 空陣列就是零次迭代。它飛這一趟是為了讓自己的銃手打得到砲位。
 *
 * **呼叫端仍然要在之後套 `applySafety`**（spec §5.2：命令不豁免安全層）。
 *
 * 熱路徑：不配置。不修改 `self`，也不修改 `ship`。
 */
export function shipAttackCommand(
  self: Aircraft, ship: Ship, gunIndex: number, out: Command,
): void {
  const aim = shipAimAt(ship, gunIndex, S.v[0]!)
  const los = S.v[1]!.copy(aim).sub(self.state.position)
  const range = los.length()

  out.throttle = WEP_THROTTLE
  out.brake = 0

  // ── 脫離 ──────────────────────────────────────────────
  //
  // 【往上，而且保留現在的水平方向】單純「機首朝上」會讓飛機在船正上方
  // 拉成一個垂直圓、然後再掉回來。保留水平分量才是掠過去。
  if (range < SHIP_BREAK_RANGE || range < MIN_ERROR) {
    const fwd = S.v[2]!.copy(FWD).applyQuaternion(self.state.orientation)
    fwd.y = 0
    if (fwd.lengthSq() < MIN_ERROR) fwd.set(0, 0, -1)
    else fwd.normalize()
    // 30° 爬升 —— 夠拉開，又不會把速度全部換成高度
    out.aimWorld.set(fwd.x * 0.866, 0.5, fwd.z * 0.866).normalize()
    out.firing = false
    return
  }

  los.divideScalar(range)
  out.aimWorld.copy(los)

  // ── 開火 ──────────────────────────────────────────────
  //
  // 【用機首而不是瞄準線】`aimWorld` 是**想要**的方向，機首是**現在**的
  // 方向。用前者的話飛機在掉頭途中就會開火，子彈往天空飛。
  const nose = S.v[2]!.copy(FWD).applyQuaternion(self.state.orientation)
  out.firing = range < SHIP_FIRE_RANGE && nose.dot(los) > Math.cos(SHIP_FIRE_CONE)
}
