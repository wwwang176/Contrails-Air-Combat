import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { WEP_THROTTLE } from '../physics/propulsion'
import { DEG } from '../core/math'
import type { Aircraft } from '../aircraft/Aircraft'
import type { AircraftSpec } from '../specs/types'
import type { Command } from '../control/Controller'
import type { Ship } from '../world/ships'
import type { Team } from '../world/World'

/**
 * # AI 的對艦索敵與掃射
 *
 * **這是一條與空戰完全平行的路徑。**
 *
 * `selectTarget`／`targetScore`（`ai/target.ts`）一個字都沒有動 —— 那一層
 * 被一整排護欄釘著，而且它評的每一項（機會、威脅、切換成本、視野）對一艘
 * 不會轉向、不會還手（以砲位而非機首還手）的船都沒有意義。硬把船塞進
 * `TargetCandidate` 就要給它一具假的 `Aircraft`，那正是 spec §2 拒絕過的事。
 *
 * 所以：**只有在空戰那一側回傳「沒有目標」時，才問這一層。** 有敵機在的
 * 時候行為與改動前逐字相同，沒有船的場次更是連問都不會問。
 *
 * ## 這一層刻意不做的
 *
 * - **不迴避彈幕。** 威脅評估仍然只認得飛機。AI 會若無其事地飛進 32 門
 *   20 mm 的火網 —— 那其實蠻符合一式陸攻在倫內爾島的下場。
 * - **不投雷、不投彈。** 魚雷在另一支分支上。這裡只有機槍掃射。
 * - **不編隊攻擊。** 僚機仍然走站位那一格，只有自由獵手會去打船。
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
 * 瞄點比水線高多少，m。
 *
 * 【為什麼不瞄艦體盒的原點】那個原點在**水線**上（與 `shipAA.ts` 同一套
 * 座標）。直接瞄它等於瞄海面：飛機對著水打，而且俯衝角比實際需要的更陡。
 * 抬到上層建築的高度帶，掃射線才落在船上。**起始值。**
 */
export const SHIP_AIM_HEIGHT = 12

/**
 * 這個機種能不能掃射船。
 *
 * 【為什麼是「有沒有固定掛架」】一式陸攻的武器全做成 AI 砲塔，`mounts` 是
 * 空陣列 —— 它飛到船上方**射不出任何東西**。少了這道閘，`japan-m4` 的五架
 * 僚機會排隊飛向艦隊、在彈幕裡繞圈、什麼都做不到，而且看起來像 AI 壞了。
 *
 * 砲塔那一側本來就會自己打船（`world/turrets.ts` 的 `pickTarget`），
 * 不需要飛行員飛過去。
 */
export function canAttackShips(spec: AircraftSpec): boolean {
  return spec.battery.mounts.length > 0
}

/**
 * 挑一艘船：敵隊、還浮著、在接戰半徑內，取**最近**的。回傳它在 `ships`
 * 裡的索引；沒有就是 −1。
 *
 * 【為什麼只用距離，不像空戰那樣評分】船不會轉向、不會逃、彼此也沒有
 * 「誰比較威脅我」的差別。多一套評分只是多一組要調的旋鈕。
 *
 * 熱路徑（決策拍，10 Hz）：不配置。
 */
export function pickShipTarget(
  selfPos: Vector3, selfTeam: Team, ships: readonly Ship[],
): number {
  let best = -1
  let bestSq = SHIP_ATTACK_RANGE * SHIP_ATTACK_RANGE
  for (let i = 0; i < ships.length; i++) {
    const s = ships[i]!
    if (!s.alive || s.team === selfTeam) continue
    const d = selfPos.distanceToSquared(s.position)
    if (d > bestSq) continue
    bestSq = d
    best = i
  }
  return best
}

/** 瞄點：船的位置抬到上層建築的高度帶。就地寫 `out`。 */
export function shipAimPoint(ship: Ship, out: Vector3): Vector3 {
  return out.set(ship.position.x, ship.position.y + SHIP_AIM_HEIGHT, ship.position.z)
}

const S = /* @__PURE__ */ makeScratch(3)
const FWD = /* @__PURE__ */ new Vector3(0, 0, -1)
/** 方向退化的下限，m。與 `rallyAim` 同一個手法。 */
const MIN_ERROR = 1e-6

/**
 * 掃射一艘船。寫滿整個 `Command`。
 *
 * 三段：**遠了就飛過去、對準了就開火、太近就拉起來**。
 *
 * 【脫離優先於開火】兩者在同一步都成立時（貼著船還對得很準）要選脫離 ——
 * 多打的那零點幾秒換不到一架飛機。
 *
 * **呼叫端仍然要在之後套 `applySafety`**（spec §5.2：命令不豁免安全層）。
 *
 * 熱路徑：不配置。不修改 `self`，也不修改 `ship`。
 */
export function shipAttackCommand(self: Aircraft, ship: Ship, out: Command): void {
  const aim = shipAimPoint(ship, S.v[0]!)
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
