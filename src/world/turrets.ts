import { Vector3, Quaternion } from 'three'
import { DEG } from '../core/math'
import { stepCadence } from '../weapons/cadence'
import {
  applyWobble, GOLDEN, inArc, MAX_TURRETS, ROOT3, SILVER, slew, turretMuzzle,
  TURRET_DAMAGE_SCALE, wobbleBasis, wobblePhase,
} from '../weapons/turret'
import { NO_INTERCEPT, solveLead } from './lead'
import { PROJECTILE_LIFETIME } from './Projectiles'
import type { Projectiles } from './Projectiles'
import type { Turret } from '../weapons/turret'
import type { AircraftSpec } from '../specs/types'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 砲塔推進需要的最小介面。**刻意不 import `World.ts` 的 `Combatant`。**
 *
 * 【為什麼】兩個理由，缺一不可：
 * 1. `World.ts` 會 import 這個檔案，反向再 import 回去就是循環相依。
 * 2. 測試可以用最小的假物件建場景，紅了分得出是「砲塔錯了」還是「世界
 *    推進錯了」—— 建整個 World 就分不出來。
 *
 * `World.Combatant` 結構上自然滿足這個介面，不必宣告 implements。
 */
export interface TurretCombatant {
  readonly index: number
  readonly team: 'blue' | 'red'
  alive: boolean
  hp: number
  readonly aircraft: Aircraft
  turretStates: TurretState[]
  turretCooldowns: Float32Array
}

export interface TurretState {
  /** 目前指向，**機體座標**單位向量。初始 = spec 的 `axis`。 */
  aim: Vector3
  /** 搖晃相位。 */
  phase: number
  /** 目前目標的 combatant 索引；−1 = 沒有目標。 */
  targetIndex: number
  /** 距離下一次重新搜尋還有幾秒。 */
  searchCooldown: number
  /** 點放：現在是開火段還是停火段。 */
  burstFiring: boolean
  /** 點放：目前這一段還剩幾秒。**恆為正。** */
  burstTimer: number
  /**
   * 這一座自己的點放週期倍率。開火段與停火段**同時**乘它，所以
   * 工作週期恆為 `BURST_ON / (BURST_ON + BURST_OFF)`，**火力總量不變**，
   * 變的只有節奏。見 `BURST_SCATTER`。
   */
  burstScale: number
  /**
   * 槍焰剩餘秒數。**這裡只負責設定，遞減由 `World.step` 的全 combatant
   * 迴圈做**（與固定槍的 `muzzleFlash` 同一個迴圈、同一個理由：遞減若寫在
   * `continue` 之後，被打爆那一瞬間亮著的槍焰會永遠停在那裡）。
   */
  flash: number
  /**
   * 上一發從哪一根管口出（0 = 左、1 = 右）。單管恆為 0。
   *
   * 【為什麼要記「上一發」而不是「下一發」】槍焰要畫在**剛剛發射的那一根**
   * 管口上。記「下一發」的話，渲染層讀到的是還沒發生的那一根，槍焰會固定
   * 偏在錯的一邊。
   */
  lastBarrel: number
}

/** 搖晃振幅，rad。**起始值，由試飛裁定。** 400 m 處 1° ≈ 7 m。 */
export const WOBBLE_AMPLITUDE = 1.0 * DEG
/** 搖晃頻率，rad/s。**起始值。** 週期 1.4 秒。 */
export const WOBBLE_OMEGA = 2 * Math.PI * 0.7
/** 點放的開火秒數。**起始值。** */
export const BURST_ON = 1.2
/** 點放的停火秒數。**起始值。** */
export const BURST_OFF = 0.8
/**
 * 點放週期的分散幅度，±這個比例。**起始值，由試飛裁定。**
 *
 * ── 為什麼需要它（人工回報 2026-08-21）──────────────────
 *
 * 「轟炸機上的機槍，開火時間、冷卻時間都一樣」。實測確認是**完全同步**：
 * `resetTurretStates` 對每一座都寫死 `burstFiring = true` 與
 * `burstTimer = BURST_ON`，而 `stepBurst` 只吃 `dt` —— 沒有任何一項與砲塔
 * 或載機有關，所以一旦同步就永遠同步。20 架 B-17G + 20 架 He 111 = 260 座
 * 砲塔跑 60 秒，同時開火的座數**每一步不是 260 就是 0**，60% 的時間全開、
 * 40% 的時間全關。整個機隊像同一根扳機。
 *
 * ── 為什麼「錯開起點」還不夠 ──────────────────────────
 *
 * 只錯開起點的話，260 座是一組**頻率相同、只差相位**的方波：相對關係凍結，
 * 每一座自己也永遠是精準的 1.2 開 / 0.8 關。週期也散開之後，任兩座的相對
 * 關係一直在漂，聽起來才不像節拍器。
 *
 * ── 為什麼是倍率而不是各自加一個隨機量 ──────────────
 *
 * 開火段與停火段乘同一個數，**工作週期完全不變** —— 每一座仍然是 60% 的
 * 時間在開火，所以火力總量與這一輪剛裁定的 `TURRET_DAMAGE_SCALE` 都不受
 * 影響。分別加減的話會連帶動到平衡，那是另一個決定。
 *
 * 0.25 → 週期落在 1.5 … 2.5 秒（開火段 0.9 … 1.5 秒）。
 */
export const BURST_SCATTER = 0.25
/**
 * 開火門檻角，rad。**追瞄誤差**的門檻，與搖晃無關 —— 搖晃作用在射出去的
 * 子彈上，不作用在 `aim` 上。取搖晃振幅的兩倍。
 */
export const FIRE_THRESHOLD = 2.0 * DEG
/**
 * 重新搜尋目標的間隔，秒。
 *
 * 【它同時是節流與防抖】搜尋是 O(架數)：20 架 B-17 × 8 座 × 40 個候選 =
 * 每步 6,400 次 `solveLead`。**有沒有目標都要節流** —— 找不到目標才是最常
 * 見的狀態（開局全部在遠處），若「沒目標就每步重掃」就等於完全沒有節流。
 */
export const SEARCH_INTERVAL = 1.0
/**
 * 砲塔槍焰的持續秒數。
 *
 * 【為什麼不 import `World.FLASH_SECONDS`】那會造成 `World → turrets →
 * World` 的循環相依。數值刻意與固定槍相同，但是各自的常數。
 */
export const TURRET_FLASH_SECONDS = 0.03

/**
 * 雙聯砲塔的兩根管口左右各偏這麼多，m。**與 `render/turretBarrels.ts`
 * 畫槍管用的是同一個數字** —— 分開寫的話彈丸與槍管會對不齊。
 */
export const BARREL_SPACING = 0.10

export function createTurretStates(
  spec: AircraftSpec, combatantIndex: number,
): TurretState[] {
  const out: TurretState[] = []
  for (let i = 0; i < spec.turrets.length; i++) {
    out.push({
      aim: spec.turrets[i]!.axis.clone(),
      phase: 0, targetIndex: -1, searchCooldown: 0,
      burstFiring: true, burstTimer: BURST_ON, burstScale: 1,
      flash: 0, lastBarrel: 0,
    })
  }
  resetTurretStates(out, spec, combatantIndex)
  return out
}

/**
 * 就地重設，**不配置任何物件**。
 *
 * 【為什麼一定要就地】`World.respawn` 可能在物理步之內被呼叫（被打爆的
 * 那一格），在那裡 `new` 一批物件會違反熱路徑零配置的紀律。
 *
 * 【初始搜尋時刻要錯開，而且要攤得夠細】全部從 0 開始的話，160 座砲塔會在
 * 同一個物理步一起做 O(架數) 的搜尋 —— 每 SEARCH_INTERVAL 秒出現一次尖峰。
 *
 * 用**黃金比的小數部分**攤到整個 `[0, SEARCH_INTERVAL)`，不是分成 16 槽：
 * 16 槽只是把一個大尖峰拆成每秒 16 個小尖峰，而且 `combatantIndex * n + i`
 * 在混合不同砲塔數的機種時會互撞（He 111 五座、B-17G 八座）。黃金比的
 * 低差異序列在任意前綴上都接近均勻，而且**完全確定性**（逐位元重播需要，
 * 不能用亂數）。
 */
export function resetTurretStates(
  states: TurretState[], spec: AircraftSpec, combatantIndex: number,
): void {
  const n = spec.turrets.length
  for (let i = 0; i < n; i++) {
    const s = states[i]!
    s.aim.copy(spec.turrets[i]!.axis)
    s.phase = wobblePhase(combatantIndex, i)
    s.targetIndex = -1
    // 黃金比的小數部分：低差異序列，任意前綴都接近均勻
    const k = combatantIndex * MAX_TURRETS + i
    s.searchCooldown = ((k * GOLDEN) % 1) * SEARCH_INTERVAL

    /*
     * 點放的錯開。**三條序列各用各的乘子**（GOLDEN / SILVER / ROOT3）——
     * 共用的話「搜尋早的那一座必然開火也早、週期也一起偏長」，三件事縮成
     * 一件。三個乘子彼此是無理數比，所以三維上一樣鋪得開。
     */
    s.burstScale = 1 + (((k * ROOT3) % 1) - 0.5) * 2 * BURST_SCATTER
    const on = BURST_ON * s.burstScale
    const cycle = (BURST_ON + BURST_OFF) * s.burstScale
    // 起點攤在整個週期上：落在開火段就是開火段，落在後段就是停火段
    const at = ((k * SILVER) % 1) * cycle
    s.burstFiring = at < on
    s.burstTimer = s.burstFiring ? on - at : cycle - at
    s.flash = 0
    s.lastBarrel = 0
  }
}

/**
 * 推進點放一步，回傳這一步是否在開火段。
 *
 * 【為什麼用 while 而不是 if】低更新率（工具程式可能用 0.3 s 甚至更大的
 * 步長）下一步可能跨過好幾個週期。用 if 會讓 `burstTimer` 變成負數而
 * 永遠不再回復。
 */
export function stepBurst(s: TurretState, dt: number): boolean {
  const firingThisStep = s.burstFiring
  s.burstTimer -= dt
  while (s.burstTimer <= 0) {
    s.burstFiring = !s.burstFiring
    // 兩段乘同一個倍率 —— 工作週期不變，只有節奏跟著這一座走
    s.burstTimer += (s.burstFiring ? BURST_ON : BURST_OFF) * s.burstScale
  }
  return firingThisStep
}

// ── 模組私有暫存，熱路徑零配置。禁止跨模組共用。 ──────────
const P = /* @__PURE__ */ new Vector3()
const V = /* @__PURE__ */ new Vector3()
const LEAD = /* @__PURE__ */ new Vector3()
const WANT = /* @__PURE__ */ new Vector3()
const BEST_WANT = /* @__PURE__ */ new Vector3()
/**
 * 【兩組基底，不共用】側偏用的與搖晃用的必須分開。共用的話，第一發之後的
 * `BARREL_E1` 會是被 `applyWobble` 內部的 `wobbleBasis` 覆寫過的值 ——
 * 目前兩者的輸入都是同一個未被修改的 `s.aim`，所以**碰巧**相同，但那依賴
 * 「`applyWobble` 永遠用同一種基底算法」這個沒有人守著的前提。
 */
const BARREL_E1 = /* @__PURE__ */ new Vector3()
const BARREL_E2 = /* @__PURE__ */ new Vector3()
const E1 = /* @__PURE__ */ new Vector3()
const E2 = /* @__PURE__ */ new Vector3()
const SHOT = /* @__PURE__ */ new Vector3()
const MUZZLE = /* @__PURE__ */ new Vector3()
const VEL = /* @__PURE__ */ new Vector3()
const OFFSET = /* @__PURE__ */ new Vector3()
const INV_Q = /* @__PURE__ */ new Quaternion()

/**
 * 推進一架飛機的全部砲塔一個物理步。
 *
 * 【呼叫順序】必須在 `World.fire` **之後**、`projectiles.step` **之前**。
 * 兩者都往同一個池子寫，順序固定才可重現。
 *
 * 【只對活著的呼叫】槍焰的遞減**不在這裡** —— 它併進 `World.step` 已有的
 * 「對所有 combatant 遞減 muzzleFlash」那個迴圈。這樣死掉的飛機不必每步再
 * 跑一次砲塔迴圈，而「被打爆那一瞬間亮著的槍焰不會永遠停在那裡」仍然成立。
 *
 * 【`all[s.targetIndex]` 的前提】`World` 保證 `combatants[i].index === i`
 * —— 死亡是 `alive` 旗標而不是把元素移除。所以 `o.index` 可以當索引用。
 */
export function stepTurrets(
  c: TurretCombatant,
  all: readonly TurretCombatant[],
  projectiles: Projectiles,
  time: number,
  dt: number,
): void {
  const turrets = c.aircraft.spec.turrets
  if (turrets.length === 0 || !c.alive || c.hp <= 0) return

  const pos = c.aircraft.state.position
  const vel = c.aircraft.state.velocity
  const q = c.aircraft.state.orientation
  // 【一架只算一次逆姿態】每座砲塔都算一次的話是 8 倍的四元數共軛
  INV_Q.copy(q).conjugate()

  for (let i = 0; i < turrets.length; i++) {
    const t = turrets[i]!
    const s = c.turretStates[i]!
    const firingWindow = stepBurst(s, dt)

    // 槍口的世界位置。**預瞄要從這裡解，不是從重心** —— B-17 的尾砲塔
    // 離重心 16 m，300 m 尾追時方向誤差可達數度，大於 2° 的開火門檻。
    //
    // 【槍口跟著 aim 掃，樞軸才是釘住的】`t.position` 只是**靜止時**的槍口。
    // 直接用它等於讓槍管繞管口轉（人工回報的「旋轉點不對」），見 turretMuzzle。
    turretMuzzle(t, s.aim, MUZZLE).applyQuaternion(q).add(pos)

    // 選目標。搜尋一律受冷卻節流，**與現在有沒有目標無關**
    s.searchCooldown -= dt
    if (s.searchCooldown <= 0) {
      s.targetIndex = pickTarget(c, all, t, vel)
      s.searchCooldown += SEARCH_INTERVAL
    } else if (s.targetIndex >= 0) {
      const o = all[s.targetIndex]
      if (o === undefined || !o.alive) s.targetIndex = -1
    }

    let trigger = false
    if (s.targetIndex >= 0 && leadInBody(all[s.targetIndex]!, t, vel, WANT)) {
      slew(s.aim, WANT, t.rotationRate * dt)
      trigger = firingWindow && s.aim.angleTo(WANT) < FIRE_THRESHOLD
    } else {
      // 沒有目標就慢慢回到中心方向 —— 否則砲塔會停在最後一次追瞄的角度
      slew(s.aim, t.axis, t.rotationRate * dt)
    }

    // 射速時鐘。**每座每步恰好呼叫一次**，即使 trigger 是 false ——
    // 既有的「放開扳機仍倒數到零」行為靠的就是這一點
    const shots = stepCadence(
      c.turretCooldowns, i, t.weapon.roundsPerMinute, trigger, dt)
    if (shots === 0) continue
    s.flash = TURRET_FLASH_SECONDS

    // 【生彈丸之前重算一次槍口】上面那一次是給預瞄用的，算在 `slew` 之前；
    // 這一次用轉完之後的 `aim`，彈丸才真的從畫出來的那根管子的尖端出來。
    turretMuzzle(t, s.aim, MUZZLE).applyQuaternion(q).add(pos)

    // 雙聯的兩根管口輪流出彈。仍然只有一道彈流（guns 乘的是傷害），但每
    // 一發都從某一根真的管口出來，不會從兩根管子中間冒出來。
    wobbleBasis(s.aim, BARREL_E1, BARREL_E2)
    for (let n = 0; n < shots; n++) {
      const barrel = t.guns > 1 ? 1 - s.lastBarrel : 0
      s.lastBarrel = barrel
      const side = t.guns > 1 ? (barrel === 0 ? -1 : 1) : 0
      OFFSET.copy(BARREL_E1).multiplyScalar(side * BARREL_SPACING).applyQuaternion(q)
      applyWobble(s.aim, WOBBLE_AMPLITUDE, WOBBLE_OMEGA, s.phase, time, E1, E2, SHOT)
      SHOT.applyQuaternion(q)
      VEL.copy(SHOT).multiplyScalar(t.weapon.muzzleVelocity).add(vel)
      projectiles.spawn(
        MUZZLE.x + OFFSET.x, MUZZLE.y + OFFSET.y, MUZZLE.z + OFFSET.z,
        VEL.x, VEL.y, VEL.z,
        // 【倍率只作用在砲塔】玩家扣扳機走的是 World.fire，那條路徑沒有
        // 這一項 —— 而 B-17G 的砲塔與 P-51D 的翼槍共用同一份 M2_BROWNING，
        // 改 WeaponSpec.damage 會把野馬一起砍半。見 TURRET_DAMAGE_SCALE。
        t.weapon.damage * t.guns * TURRET_DAMAGE_SCALE, c.index,
      )
    }
  }
}

/**
 * 解出目標的預瞄方向並轉成**機體座標**，寫進 `out`。
 * 回傳 false 代表「無解、太遠、或落在射界錐外」。
 *
 * 呼叫前 `MUZZLE` 與 `INV_Q` 必須已經是這一座砲塔的值。
 */
function leadInBody(
  target: TurretCombatant, t: Turret, shooterVel: Vector3, out: Vector3,
): boolean {
  P.copy(target.aircraft.state.position).sub(MUZZLE)
  V.copy(target.aircraft.state.velocity).sub(shooterVel)
  const tt = solveLead(P, V, t.weapon.muzzleVelocity, LEAD)
  // 【射程判定就是「t ≤ 彈丸壽命」】與 HUD 預瞄環同一個條件，不另訂數字
  if (tt === NO_INTERCEPT || tt > PROJECTILE_LIFETIME) return false
  out.copy(LEAD).applyQuaternion(INV_Q)
  return inArc(t, out)
}

/**
 * 粗篩用的接近速度上界，m/s。
 *
 * 【它必須寬到永遠不會假陰性】粗篩的唯一職責是省下 `solveLead` 的平方根；
 * 放進來的多餘候選會被 `solveLead` 自己擋掉，**成本只是幾次二次式**。反過來
 * 擋掉一個真的打得到的目標，症狀是「砲塔對著一台迎頭衝過來的戰鬥機完全不
 * 開火」，而且沒有任何錯誤。
 *
 * 【舊值 400 是錯的 —— Codex 2026-08-21 實測】它被當成「相對接近速度」的
 * 餘量，但那是**兩台加起來**：B-17 巡航 160 m/s 加上俯衝進場的 P-51 300 m/s
 * 就是 460。實算的假陰性區間是 **1464.4 … 1616.4 m，寬 152 m** —— 在那一段
 * 裡 `solveLead` 有解（實測 1.109 s < 1.2 s 的彈丸壽命）、方向也在射界錐內，
 * 但候選在解二次式之前就被丟掉了。
 *
 * 800 = 兩台各 400 m/s（1,440 km/h）—— 遠高於這個專案裡任何一台的極速，
 * 連垂直俯衝也到不了。多出來的粗篩半徑不會讓搜尋變貴：實測 160 座砲塔的
 * 搜尋成本本來就落在 20v20 的雜訊之內（見 `test/unit/perf-gate.test.ts`）。
 */
const MAX_CLOSING_SPEED = 800

/**
 * 射程的必要條件：即使迎頭全速接近也追不上就不必解二次式。
 * 887 是專案裡最快的初速（M2 白朗寧）。
 */
const MAX_REACH_SQ = ((887 + MAX_CLOSING_SPEED) * PROJECTILE_LIFETIME) ** 2

/**
 * 挑目標：敵隊、存活、有解、在射界內，取**離槍口**最近的。
 *
 * 【便宜的拒絕要放在 solveLead 之前】`solveLead` 有平方根與分支，而多數
 * 候選在遠處。先用距離平方擋掉。
 *
 * 【用 `BEST_WANT` 而不是 `WANT`】搜尋不能污染外層正在用的 `WANT`。外層
 * 選完之後會再對選中的目標呼叫一次 `leadInBody(..., WANT)` —— 多解一次
 * 二次式，但換到「沒有跨函數的隱式別名」。
 */
function pickTarget(
  c: TurretCombatant, all: readonly TurretCombatant[], t: Turret, vel: Vector3,
): number {
  let best = -1
  let bestDist = Infinity
  for (let k = 0; k < all.length; k++) {
    const o = all[k]!
    if (!o.alive || o.team === c.team || o.index === c.index) continue
    const d = o.aircraft.state.position.distanceToSquared(MUZZLE)
    if (d > MAX_REACH_SQ || d >= bestDist) continue
    if (!leadInBody(o, t, vel, BEST_WANT)) continue
    bestDist = d
    best = o.index
  }
  return best
}
