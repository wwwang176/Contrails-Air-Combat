import { Quaternion, Vector3 } from 'three'
import { DEG } from '../core/math'
import { resetBurst, stepBurst, BURST_ON } from '../weapons/burst'
import { stepCadence } from '../weapons/cadence'
import { applyWobble, GOLDEN, inArc, slew, wobblePhase } from '../weapons/turret'
import type { Arc } from '../weapons/turret'
import { FLAK_MAX_FUSE, spawnFlak } from './flak'
import { NO_INTERCEPT, solveLead } from './lead'
import { SHIP_AA_ARC_DEFAULTS, type ShipAATier } from './shipAA'
import { FIRE_THRESHOLD, SEARCH_INTERVAL, TURRET_FLASH_SECONDS } from './turrets'
import type { Ship, ShipClass, ShipGun } from './ships'
import type { FlakShells } from './flak'
import type { Projectiles } from './Projectiles'
import type { TurretCombatant } from './turrets'

/**
 * # 艦上防空砲位的瞄準與開火
 *
 * 骨架照 `world/turrets.ts` 的 `stepTurrets`，**但有五處不一樣**（見
 * spec §3.3）：
 *
 * 1. 候選目標是 `TurretCombatant[]`，船不在裡面 —— 不必排除自傷。
 * 2. 槍口是艦體座標經船的艏向轉到世界。
 * 3. `flak` 那一層不進彈丸池，走近炸引信（`flak.ts`）。
 * 4. 射速時鐘住在船身上（`Ship.gunCooldowns`），因為 `stepCadence` 收的是
 *    `Float32Array + index`。
 * 5. **傷害就是表上的值** —— 不乘 `guns`、不乘 `TURRET_DAMAGE_SCALE`。
 *
 * 瞄準本身完全借用 `weapons/turret.ts` 與 `weapons/burst.ts` 的純函數：
 * 那一層不認識飛機，本來就借得到。
 */

/** 一層砲位的規格。**每一個數字都是起始值，由試飛裁定。** */
export interface ShipGunSpec {
  readonly muzzleVelocity: number
  readonly roundsPerMinute: number
  /** 彈丸壽命，秒。射程 = 初速 × 它。`flak` 用不到（走引信），填 0。 */
  readonly life: number
  /** 單發傷害。**最終值**，見上面第 5 點。 */
  readonly damage: number
  /** 砲位血量。 */
  readonly hp: number
  /** 碰撞盒的**半**邊長，m。**已經含負責人要的 ×1.5 膨脹。** */
  readonly boxHalf: number
  /** 轉速上限，rad/s。 */
  readonly rotationRate: number
}

/**
 * 三層的規格（spec §5.2）。**全部是起始值，由試飛裁定。**
 *
 * 參考座標：.50 白朗寧初速 887、800 發/分、單發 18（`weapons/p51d.ts`）；
 * 零戰的 20 mm 單發 100；B-17 球形腹部砲塔一發 33.75。
 *
 * 【5 吋砲的初速刻意訂 450，真砲是 790】負責人：「射速也慢，初速也慢」。
 * 這不是妥協，是這一層成立的條件 —— **慢彈才有看得見的飛行時間，黑雲才會
 * 在你前方一朵一朵開出來**。代價是它對閃避中的戰鬥機幾乎打不中，而那正是
 * 要的手感：黑雲是危險的招牌，不是必中的判決。
 */
export const SHIP_GUN_SPECS: Readonly<Record<ShipAATier, ShipGunSpec>> = {
  // 20 mm Oerlikon，射程 830 × 1.6 ≈ 1,330 m
  //
  // 【480 就是真砲的循環射速】Oerlikon 是每分鐘 450 發上下。
  //
  // 【單發只有 5】32 個砲區合起來每秒 256 發 —— 這一層真正的火力是單發
  // 乘上砲區數。要的是**視覺密度**厚，不是進去就死。
  mg: {
    muzzleVelocity: 830, roundsPerMinute: 480, life: 1.6,
    damage: 5, hp: 60, boxHalf: 1.2, rotationRate: 60 * DEG,
  },
  // 40 mm Bofors，射程 880 × 3.4 ≈ 2,990 m
  //
  // 【射程靠壽命而不是初速】落在史實有效射程（2.7–3.5 km，見 shipAA.ts
  // 表頭）內，也與 20 mm 的 1,330 m 拉開層次。初速會連帶動到預瞄解。
  //
  // 【220 對四聯裝仍然保守】Bofors 每一管是每分鐘 120 發，四聯裝的理論值
  // 是 480。這裡一個砲區代表的是一座砲塔，取 220 是「打打停停」的實況值。
  autocannon: {
    muzzleVelocity: 880, roundsPerMinute: 220, life: 3.4,
    damage: 18, hp: 120, boxHalf: 2.0, rotationRate: 45 * DEG,
  },
  // 5"/38 兩用砲，射程 450 × 11（引信上限）≈ 4,950 m
  flak: {
    muzzleVelocity: 450, roundsPerMinute: 20, life: 0,
    damage: 200, hp: 200, boxHalf: 3.0, rotationRate: 20 * DEG,
  },
}

/**
 * 船在彈丸池 `owner` 欄位裡的編碼基準。
 *
 * 【為什麼不能用 −1 也不能用 0..3】−1 是 `Projectiles` 的**空槽**標記
 * （`Projectiles.ts`），用它會讓 `liveCount` 加上去卻永遠不推進，池子慢慢
 * 漏光。而 0..3 會被 `resolveHits` 當成同索引的**飛機** —— 錯誤排除那一架，
 * 還把命中數與助攻記到它頭上。
 *
 * 負數區間離 −1 很遠，而且一眼看得出不是飛機。
 */
export const SHIP_OWNER_BASE = -1000

export function shipOwner(shipIndex: number): number {
  return SHIP_OWNER_BASE - shipIndex
}

/** 解回船編號；不是船就回 −1。 */
export function ownerShipIndex(owner: number): number {
  return owner <= SHIP_OWNER_BASE ? SHIP_OWNER_BASE - owner : -1
}

/** 搖晃振幅，rad。**起始值。** 比飛機砲塔的 1.0° 大 —— 要的是玩家有機會。 */
export const SHIP_WOBBLE_AMPLITUDE = 1.2 * DEG
/** 搖晃頻率，rad/s。與飛機砲塔同一個值。 */
export const SHIP_WOBBLE_OMEGA = 2 * Math.PI * 0.7

/** 一艘船最多幾個砲區。與 `shipAA.ts` 的併區上限一致。 */
export const MAX_SHIP_GUNS = 8

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)

/**
 * 一個砲位的射界錐軸，艦體座標。
 *
 * 水平分量朝**舷外**（不然左舷的砲會對著自己的上層建築打），中線上的砲
 * 改成朝正上。仰角讀 `SHIP_AA_ARC_DEFAULTS`。
 */
function axisOf(x: number, tier: ShipAATier, out: Vector3): Vector3 {
  const elev = SHIP_AA_ARC_DEFAULTS[tier].elevationDeg * DEG
  // 【中線的判準是 1 m】`shipAA.ts` 的 id 用 p/s/c 標舷別，但那是字串；
  // 用座標判不必解析 id，而任何一舷的砲都離中線遠不只 1 m。
  if (Math.abs(x) < 1) return out.set(0, 1, 0)
  return out.set(Math.sign(x) * Math.cos(elev), Math.sin(elev), 0).normalize()
}

export function createShipGuns(cls: ShipClass): ShipGun[] {
  const out: ShipGun[] = []
  for (let i = 0; i < cls.zones.length; i++) {
    const zone = cls.zones[i]!
    const spec = SHIP_GUN_SPECS[zone.tier]
    const axis = axisOf(zone.position.x, zone.tier, new Vector3())
    out.push({
      zone,
      aim: axis.clone(),
      axis,
      phase: 0, targetIndex: -1, searchCooldown: 0,
      burstFiring: true, burstTimer: BURST_ON, burstScale: 1,
      flash: 0,
      hp: spec.hp,
      alive: true,
      box: {
        center: zone.position,
        half: new Vector3(spec.boxHalf, spec.boxHalf, spec.boxHalf),
      },
    })
  }
  resetGuns(out)
  return out
}

/**
 * 就地重設，**不配置任何物件**。
 *
 * 【錯開的種子】`船編號 × MAX_SHIP_GUNS + 砲位編號`，與飛機砲塔各走一條
 * 序列（兩邊是不同的陣列，不會互撞）。理由與 `resetTurretStates` 一樣：
 * 全部從 0 開始的話，28 個砲位會在同一個物理步一起做 O(架數) 的搜尋。
 */
export function resetShipGuns(ship: Ship): void {
  resetGuns(ship.guns, ship.index)
  ship.gunCooldowns.fill(0)
}

function resetGuns(guns: ShipGun[], shipIndex = 0): void {
  for (let i = 0; i < guns.length; i++) {
    const g = guns[i]!
    g.aim.copy(g.axis)
    g.targetIndex = -1
    g.flash = 0
    g.hp = SHIP_GUN_SPECS[g.zone.tier].hp
    g.alive = true
    const k = shipIndex * MAX_SHIP_GUNS + i
    g.phase = wobblePhase(shipIndex, i)
    g.searchCooldown = ((k * GOLDEN) % 1) * SEARCH_INTERVAL
    resetBurst(g, k)
  }
}

// ── 模組私有暫存，熱路徑零配置。禁止跨模組共用。 ──────────
const P = /* @__PURE__ */ new Vector3()
const V = /* @__PURE__ */ new Vector3()
const LEAD = /* @__PURE__ */ new Vector3()
const WANT = /* @__PURE__ */ new Vector3()
const BEST_WANT = /* @__PURE__ */ new Vector3()
const E1 = /* @__PURE__ */ new Vector3()
const E2 = /* @__PURE__ */ new Vector3()
const SHOT = /* @__PURE__ */ new Vector3()
const MUZZLE = /* @__PURE__ */ new Vector3()
const VEL = /* @__PURE__ */ new Vector3()
const INV_Q = /* @__PURE__ */ new Quaternion()

/**
 * 推進一艘船的全部砲位一個物理步。
 *
 * 【呼叫順序】必須在 `World.fire` 與 `stepTurrets` **之後**、
 * `projectiles.step` **之前**。三者都往同一個池子寫，順序固定才可重現。
 *
 * 【槍焰的遞減不在這裡】與飛機砲塔同一個約定：由 `World.step` 那個掃過
 * 所有船的迴圈做，這樣「被打掉那一瞬間亮著的槍焰」不會永遠停在那裡。
 */
export function stepShipGuns(
  ship: Ship,
  all: readonly TurretCombatant[],
  projectiles: Projectiles,
  flak: FlakShells,
  time: number,
  dt: number,
): void {
  const guns = ship.guns
  // 【沉了的船一門砲都不動】與「砲位死了完全不動」同一條規則，只是整艘。
  if (!ship.alive || guns.length === 0) return

  const q = ship.orientation
  // 【一艘只算一次逆姿態】每個砲位各算一次就是 8 倍的四元數共軛
  INV_Q.copy(q).conjugate()

  for (let i = 0; i < guns.length; i++) {
    const g = guns[i]!
    // 【死掉的砲位完全不動】不搜尋、不轉、不開火，連射速時鐘都不走
    if (!g.alive) continue
    const spec = SHIP_GUN_SPECS[g.zone.tier]
    const firingWindow = stepBurst(g, dt)

    // 槍口的世界位置。**預瞄從這裡解，不是從船的重心** —— 艦艏與艦艉的
    // 砲位相距 185 m，用重心解的方向誤差遠大於 2° 的開火門檻。
    MUZZLE.copy(g.zone.position).applyQuaternion(q).add(ship.position)

    // 選目標。搜尋一律受冷卻節流，**與現在有沒有目標無關**
    g.searchCooldown -= dt
    if (g.searchCooldown <= 0) {
      g.targetIndex = pickTarget(ship, all, g, spec)
      g.searchCooldown += SEARCH_INTERVAL
    } else if (g.targetIndex >= 0) {
      const o = all[g.targetIndex]
      if (o === undefined || !o.alive) g.targetIndex = -1
    }

    let trigger = false
    if (g.targetIndex >= 0 && leadInBody(all[g.targetIndex]!, g, spec, WANT)) {
      slew(g.aim, WANT, spec.rotationRate * dt)
      trigger = firingWindow && g.aim.angleTo(WANT) < FIRE_THRESHOLD
    } else {
      // 沒有目標就慢慢回到中心方向 —— 否則砲位會停在最後一次追瞄的角度
      slew(g.aim, g.axis, spec.rotationRate * dt)
    }

    // 射速時鐘。**每個砲位每步恰好呼叫一次**，即使 trigger 是 false
    const shots = stepCadence(ship.gunCooldowns, i, spec.roundsPerMinute, trigger, dt)
    if (shots === 0) continue
    g.flash = TURRET_FLASH_SECONDS

    // 【5 吋砲走近炸引信】它不進彈丸池，見 flak.ts
    if (g.zone.tier === 'flak') {
      // 【引信在發射那一刻就定死】目標之後閃避的話，雲就開在空的地方 ——
      // 那正是要的手感：黑雲是危險的招牌，不是必中的判決。
      //
      // 【為什麼重解一次而不是沿用上面的 WANT】那一份是**機體座標**的方向，
      // 而且不帶飛行時間。這裡要的是秒數，而 solveLead 只在有目標時才有解。
      const o = all[g.targetIndex]
      if (o === undefined) continue
      P.copy(o.aircraft.state.position).sub(MUZZLE)
      V.copy(o.aircraft.state.velocity)
      const fuse = solveLead(P, V, spec.muzzleVelocity, LEAD)
      if (fuse === NO_INTERCEPT || fuse > FLAK_MAX_FUSE) continue
      applyWobble(g.aim, SHIP_WOBBLE_AMPLITUDE, SHIP_WOBBLE_OMEGA, g.phase, time, E1, E2, SHOT)
      SHOT.applyQuaternion(q)
      VEL.copy(SHOT).multiplyScalar(spec.muzzleVelocity)
      spawnFlak(
        flak, MUZZLE.x, MUZZLE.y, MUZZLE.z, VEL.x, VEL.y, VEL.z,
        fuse, ship.team === 'blue' ? 0 : 1,
      )
      continue
    }

    for (let n = 0; n < shots; n++) {
      applyWobble(g.aim, SHIP_WOBBLE_AMPLITUDE, SHIP_WOBBLE_OMEGA, g.phase, time, E1, E2, SHOT)
      SHOT.applyQuaternion(q)
      // 【不加船速】8 m/s 對 830 m/s 的初速是 1%，而加了就要在預瞄那一側
      // 也減掉它 —— 兩邊都要記得的東西遲早會有一邊忘記。
      VEL.copy(SHOT).multiplyScalar(spec.muzzleVelocity)
      projectiles.spawn(
        MUZZLE.x, MUZZLE.y, MUZZLE.z, VEL.x, VEL.y, VEL.z,
        // 【傷害就是表上的值】照抄 stepTurrets 會套 TURRET_DAMAGE_SCALE
        // 與 guns —— 四聯裝 40 mm 會從 40 變成 150。
        spec.damage, shipOwner(ship.index),
        ship.team === 'blue' ? 0 : 1, spec.life,
      )
    }
  }
}

/**
 * 解出目標的預瞄方向並轉成**艦體座標**，寫進 `out`。
 * 回傳 false = 無解、太遠、或落在射界錐外。
 *
 * 呼叫前 `MUZZLE` 與 `INV_Q` 必須已經是這一艘船／這一個砲位的值。
 */
function leadInBody(
  target: TurretCombatant, g: ShipGun, spec: ShipGunSpec, out: Vector3,
): boolean {
  P.copy(target.aircraft.state.position).sub(MUZZLE)
  V.copy(target.aircraft.state.velocity)
  const tt = solveLead(P, V, spec.muzzleVelocity, LEAD)
  // 【射程判定就是「飛行時間 ≤ 彈丸壽命」】與飛機砲塔同一條規則。
  // flak 那一層的上限是引信秒數，由 T5 的 FLAK_MAX_FUSE 給。
  if (tt === NO_INTERCEPT || tt > rangeSeconds(g, spec)) return false
  out.copy(LEAD).applyQuaternion(INV_Q)
  // 【就地填一個模組級的錐】寫成物件字面值的話每次呼叫配置一個 —— 而這一支
  // 每個砲位每步至少跑一次，搜尋時還會跑滿全部候選。
  ARC.axis = g.axis
  ARC.halfAngle = SHIP_AA_ARC_DEFAULTS[g.zone.tier].halfAngleDeg * DEG
  return inArc(ARC, out)
}

/** `leadInBody` 的射界錐暫存。`axis` 存的是參考，不複製。 */
const ARC: Arc = { axis: UP, halfAngle: 0 }

/** 這一層的飛行時間上限，秒。 */
function rangeSeconds(g: ShipGun, spec: ShipGunSpec): number {
  // flak 的 life 是 0（不進彈丸池），它的射程上限是引信秒數
  return g.zone.tier === 'flak' ? FLAK_MAX_FUSE : spec.life
}

/**
 * 挑目標：敵隊、存活、有解、在射界內，取**離槍口**最近的。
 *
 * 【便宜的拒絕放在 solveLead 之前】與 `turrets.ts` 的 `pickTarget` 同一個
 * 理由：多數候選在遠處，先用距離平方擋掉。
 *
 * 【用 BEST_WANT 而不是 WANT】搜尋不能污染外層正在用的 `WANT`。
 */
function pickTarget(
  ship: Ship, all: readonly TurretCombatant[], g: ShipGun, spec: ShipGunSpec,
): number {
  const reach = (spec.muzzleVelocity + MAX_CLOSING_SPEED) * rangeSeconds(g, spec)
  const reachSq = reach * reach
  let best = -1
  let bestDist = Infinity
  for (let k = 0; k < all.length; k++) {
    const o = all[k]!
    if (!o.alive || o.team === ship.team) continue
    const d = o.aircraft.state.position.distanceToSquared(MUZZLE)
    if (d > reachSq || d >= bestDist) continue
    if (!leadInBody(o, g, spec, BEST_WANT)) continue
    bestDist = d
    best = o.index
  }
  return best
}

/**
 * 粗篩用的接近速度上界，m/s。
 *
 * 【它必須寬到永遠不會假陰性】粗篩只是為了省下 `solveLead` 的平方根；
 * 多放進來的候選會被 `solveLead` 自己擋掉。反過來擋掉一個真的打得到的
 * 目標，症狀是「砲位對著一台俯衝進場的飛機完全不開火」，而且不報錯。
 *
 * 400 m/s（1,440 km/h）遠高於這個專案裡任何一台的極速。船是靜止的一側，
 * 所以不必像 `turrets.ts` 那樣算兩台相加。
 */
const MAX_CLOSING_SPEED = 400
