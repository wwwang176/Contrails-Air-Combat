import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { solveImpact, type BombState, type Impact } from '../world/bomb'
import type { Aircraft } from '../aircraft/Aircraft'
import type { Command } from '../control/Controller'
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
 * 解算用的落地平面高度：**主甲板**，不是海面。
 *
 * 【為什麼不用海面】甲板高 4.5～7 m，多掉那幾公尺在末速下多飛約 7 m。
 * 在釋放半徑的量級之內，但沒有理由留著這個偏差。
 *
 * 【為什麼是 `hull` 的最高點】船體盒一律止於主甲板（`world/ships.ts` 的
 * 硬性不變量：盒頂低於最低的砲位），所以那就是甲板。
 */
export function deckHeightOf(cls: ShipClass): number {
  let top = 0
  for (const b of cls.hull) {
    const t = b.center.y + b.half.y
    if (t > top) top = t
  }
  return top
}

/**
 * 釋放半徑，m。**專案負責人裁定：照船體寬度處理。**
 *
 * ```
 *   Fletcher DD-445    12.08 m
 *   Wichita CA-45      18.82 m
 *   Essex CV-9         28.40 m
 * ```
 *
 * 【為什麼取 `hull[0]` 而不是最寬的那一個盒】Essex 有兩個盒：主艦體寬
 * 28.4 m、飛行甲板寬 43 m。照 `deckHeightOf` 那樣取極值的話釋放半徑會
 * 放大 51%（Codex 審查 C7）。**第一個盒恆是艦體**，那才是「船寬」。
 *
 * 【它是這一關難度的主旋鈕】起始值，由試飛裁定。
 */
export function releaseRadiusOf(cls: ShipClass): number {
  const hull = cls.hull[0]
  return hull === undefined ? 0 : hull.half.x * 2
}

const FWD = /* @__PURE__ */ new Vector3(0, 0, -1)
const S = /* @__PURE__ */ makeScratch(3)

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

/** 方向退化的下限。與 `shipAttack.ts` 的 `MIN_ERROR` 同一個手法。 */
const MIN_ERROR = 1e-6

/**
 * 轟炸航路。寫滿整個 `Command`。
 *
 * **平飛、朝船的預測位置、不開固定槍。**
 *
 * 【為什麼是水平的 `aimWorld`】投彈解算假設的是穩定的航路。俯衝的話落點
 * 每一步都在大幅移動，而且 `applySafety` 會在低空接管、把 `bombing` 關掉
 * （見那一支）。定高才投得中。
 *
 * 【為什麼不開固定槍】一式陸攻沒有（`battery.mounts` 是空陣列），但
 * B-17 與 He 111 有 —— 讓它們在航路上掃射會把機首拉離航路。自衛是砲塔的事
 * （`world/turrets.ts`），那一層與 `Command` 無關。
 *
 * 【飛過頭之後】瞄的是船的預測位置，所以通過之後方向自然反轉、它會繞回來
 * 重新進場。這一版沒有專門的脫離段。
 *
 * **呼叫端仍然要在之後套 `applySafety`**（spec §5.2：命令不豁免安全層）。
 *
 * 熱路徑：不配置。不修改 `self`，也不修改 `ship`。
 */
export function bombRunCommand(
  self: Aircraft, ship: Ship, release: boolean, out: Command,
): void {
  const p = self.state.position
  const v = self.state.velocity

  // 【前置量取「水平接近時間」】不是彈道時間 —— 那一段由 `shouldRelease`
  // 負責。這裡只要機首指向它屆時會在的地方，航路才不會一路被拖著修正。
  const speed = Math.hypot(v.x, v.z)
  const dx = ship.position.x - p.x
  const dz = ship.position.z - p.z
  const range = Math.hypot(dx, dz)
  const lead = speed > MIN_ERROR ? range / speed : 0
  const at = shipAt(ship, lead, S.v[1]!)

  const ax = at.x - p.x
  const az = at.z - p.z
  const horiz = Math.hypot(ax, az)
  if (horiz < MIN_ERROR) {
    // 正上方：保持現在的水平航向，不要讓 aim 退化成零向量
    const fwd = S.v[2]!.copy(FWD).applyQuaternion(self.state.orientation)
    fwd.y = 0
    if (fwd.lengthSq() < MIN_ERROR) fwd.set(0, 0, -1)
    else fwd.normalize()
    out.aimWorld.copy(fwd)
  } else {
    out.aimWorld.set(ax / horiz, 0, az / horiz)
  }

  out.throttle = 1
  out.brake = 0
  out.firing = false
  out.bombing = release
}
