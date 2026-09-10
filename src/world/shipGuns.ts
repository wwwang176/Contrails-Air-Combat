import { Quaternion, Vector3 } from 'three'
import { DEG } from '../core/math'
import { hash01 } from '../render/scatter'
import { resetBurst, stepBurst, BURST_ON } from '../weapons/burst'
import { stepCadence } from '../weapons/cadence'
import { applyWobble, GOLDEN, inArc, slew, wobblePhase } from '../weapons/turret'
import type { Arc } from '../weapons/turret'
import {
  FLAK_BLAST_SCALE, FLAK_DAMAGE, FLAK_MAX_FUSE, FLAK_RADIUS, FLAK_SHAKE, FLAK_SMOKE, spawnFlak,
} from './flak'
import { NO_INTERCEPT, solveLead } from './lead'
import { SHIP_AA_ARC_DEFAULTS, type ShipAATier, type ShipAAZone } from './shipAA'
import { FIRE_THRESHOLD, SEARCH_INTERVAL, TURRET_FLASH_SECONDS } from './turrets'
import type { Ship, ShipClass, ShipGun } from './ships'
import type { FlakShells } from './flak'
import type { Projectiles } from './Projectiles'
import type { TurretCombatant } from './turrets'
import type { Team } from './World'

/**
 * # 防空砲位的瞄準與開火
 *
 * **船與陸上的砲位共用這一支。** 射控只讀砲台的那幾格（見 `GunPlatform`）——
 * 陸上的重高砲位是 `GroundTarget`，掛上 `createGroundBattery()` 之後就跟一艘
 * 船一樣走這裡。
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

/**
 * 一座砲台。**射控只讀這幾格** —— `Ship` 天生滿足，`GroundTarget` 掛上
 * `guns` 之後也滿足。
 *
 * 【為什麼不直接收 `Ship`】陸上的重高砲位沒有船殼、沒有航速、不會沉。射控
 * 收 `Ship` 的話「會開火」與「是一艘船」就綁死了，沒有船的關卡一發都打不出來。
 */
export interface GunPlatform {
  readonly guns: readonly ShipGun[]
  /** 世界座標。砲口是 `zone.position` 經 `orientation` 轉過來再加它 */
  readonly position: Vector3
  readonly orientation: Quaternion
  readonly team: Team
  /** 沉了／炸了就一門砲都不動 */
  readonly alive: boolean
  /**
   * 這一座在自己那一組裡的編號。**同組不得重複** —— 它進的是引信誤差與
   * 搖晃相位的種子，撞號的兩座會抽到同一串亂數，彈幕於是同步。
   */
  readonly index: number
  /**
   * 射速時鐘，一門砲一格。`stepCadence` 收的是 `Float32Array + index`，
   * 所以住在砲台身上而不是砲身上。
   */
  readonly gunCooldowns: Float32Array
}

/** 一層砲位的規格。**每一個數字都是起始值，由試飛裁定。** */
export interface ShipGunSpec {
  readonly muzzleVelocity: number
  /** 口徑，mm。與飛機的槍同一格，見 `weapons/armour.ts` */
  readonly caliber: number
  readonly roundsPerMinute: number
  /** 彈丸壽命，秒。射程 = 初速 × 它。`flak` 用不到（走引信），填 0。 */
  readonly life: number
  /** 單發傷害。**最終值**，見上面第 5 點。 */
  readonly damage: number
  /** 砲位血量。 */
  readonly hp: number
  /** 碰撞盒的**半**邊長，m。**已經含 ×1.5 的膨脹。** */
  readonly boxHalf: number
  /** 轉速上限，rad/s。 */
  readonly rotationRate: number
  /**
   * 引信秒數上限。**只有 `flak` 那一層讀**，其餘層的射程是 `life`。
   * 射程 = `muzzleVelocity × maxFuse`。
   */
  readonly maxFuse: number
  /**
   * 引信秒數的相對誤差，±。**只有 `flak` 那一層讀。** 見 `FLAK_FUSE_ERROR`。
   */
  readonly fuseError: number
  /** 一朵雲的殺傷半徑與爆心傷害。**只有 `flak` 那一層讀**，逐發帶進彈池 */
  readonly burstRadius: number
  readonly burstDamage: number
  /**
   * 表現的三個尺度。**只有 `flak` 那一層讀**，逐發帶進彈池。
   *
   * ```
   *   burstSmoke  黑雲的散佈半徑，m
   *   burstBlast  空中閃光與火球的線性尺度，1 = FLAK_BLAST 原配方
   *   burstShake  鏡頭震動的當量尺度
   * ```
   *
   * 【三格互相獨立，也不從 `burstRadius` 推】它們是手感：雲小一號、搖一樣
   * 重、閃光大一點都是合法的選擇。綁成公式之後，調任何一個都會動到另外兩個。
   */
  readonly burstSmoke: number
  readonly burstBlast: number
  readonly burstShake: number
}

/**
 * 三層的規格（spec §5.2）。**全部是起始值，由試飛裁定。**
 *
 * 參考座標：.50 白朗寧初速 887、800 發/分、單發 18（`weapons/p51d.ts`）；
 * 零戰的 20 mm 單發 100；B-17 球形腹部砲塔一發 33.75。
 *
 * 【火力密度靠砲區數，不靠單發】TF58 九艘船的理論火力是每秒三千點，而零戰
 * 只有 600 血。掛彈的零戰在離目標九百到六百公尺之間才進得了投彈點，那三百
 * 公尺是它唯一會失敗的地方 —— 單發過痛就沒有人到得了。
 *
 * 兩挺自動砲取上面那個座標的一半；五吋砲取四分之一，因為它單發最重，而且
 * 黑雲是危險的招牌不是必中的判決。
 *
 * 【5 吋砲的初速刻意訂 450，真砲是 790】射速慢、初速也慢。
 * 這不是妥協，是這一層成立的條件 —— **慢彈才有看得見的飛行時間，黑雲才會
 * 在你前方一朵一朵開出來**。代價是它對閃避中的戰鬥機幾乎打不中，而那正是
 * 要的手感：黑雲是危險的招牌，不是必中的判決。
 */
/**
 * 每一層的砲位規格。
 *
 * 【血量是 300/600/1000】再低的話（60/120/200 那個量級）砲位太容易被轟炸機
 * 的機槍打爆。
 *
 * 【上界是艦體血量】砲位不該比船本身還耐打 —— 那會讓「打掉防空砲」變成
 * 比擊沉還難的事。五倍之後離上界仍然很遠：
 *
 * ```
 *                砲位   砲位總血   艦體血    占比
 *   Fletcher      6      2,800    20,000   14.0%
 *   Wichita       8      4,400    40,000   11.0%
 *   Essex         8      4,400    60,000    7.3%
 * ```
 *
 * 護欄在 `test/unit/ships.test.ts`。**起始值，由試飛裁定。**
 */
/**
 * 引信秒數的相對誤差，±。**艦砲與陸砲同值。**
 *
 * 【為什麼要有誤差】攔截時間是精確解，一朵雲的殺傷半徑在 2 km 上等於每一朵
 * 時機對的雲都扣得到血 —— 黑雲該是危險的招牌，不是必中的判決。±6% 在
 * 2 km（4.4 秒）上是 ±0.27 秒、沿彈道 ±120 m，雲於是開在目標前後。
 *
 * 【逐發的確定性擾動】種子是那一門砲的累計發射數，同一場同種子逐位元相同。
 *
 * 【它宣告在規格表之前】兩份表都引用它 —— 放在後面的話模組求值會撞上 TDZ，
 * 而那是載入期就整個炸掉。
 */
export const FLAK_FUSE_ERROR = 0.06

/** 不走引信那一層的填法。`maxFuse` 是 0 表示「射程看 `life`」 */
const NOT_FLAK = {
  maxFuse: 0, fuseError: 0, burstRadius: 0, burstDamage: 0,
  burstSmoke: 0, burstBlast: 0, burstShake: 0,
} as const

export const SHIP_GUN_SPECS: Readonly<Record<ShipAATier, ShipGunSpec>> = {
  // 20 mm Oerlikon，射程 830 × 1.6 ≈ 1,330 m
  //
  // 【480 就是真砲的循環射速】Oerlikon 是每分鐘 450 發上下。
  //
  // 【單發只有 2.5】32 個砲區合起來每秒 256 發 —— 這一層真正的火力是單發
  // 乘上砲區數。要的是**視覺密度**厚，不是進去就死。
  mg: {
    muzzleVelocity: 830, roundsPerMinute: 480, life: 1.6, caliber: 20,
    damage: 2.5, hp: 300, boxHalf: 1.2, rotationRate: 60 * DEG,
    ...NOT_FLAK,
  },
  // 40 mm Bofors，射程 880 × 3.4 ≈ 2,990 m
  //
  // 【射程靠壽命而不是初速】落在史實有效射程（2.7–3.5 km，見 shipAA.ts
  // 表頭）內，也與 20 mm 的 1,330 m 拉開層次。初速會連帶動到預瞄解。
  //
  // 【220 對四聯裝仍然保守】Bofors 每一管是每分鐘 120 發，四聯裝的理論值
  // 是 480。這裡一個砲區代表的是一座砲塔，取 220 是「打打停停」的實況值。
  autocannon: {
    muzzleVelocity: 880, roundsPerMinute: 220, life: 3.4, caliber: 40,
    damage: 9, hp: 600, boxHalf: 2.0, rotationRate: 45 * DEG,
    ...NOT_FLAK,
  },
  // 5"/38 兩用砲，射程 450 × 11（引信上限）≈ 4,950 m
  flak: {
    muzzleVelocity: 450, roundsPerMinute: 20, life: 0, caliber: 127,
    damage: 50, hp: 1000, boxHalf: 3.0, rotationRate: 20 * DEG,
    maxFuse: FLAK_MAX_FUSE, fuseError: FLAK_FUSE_ERROR, burstRadius: FLAK_RADIUS,
    burstDamage: FLAK_DAMAGE,
    burstSmoke: FLAK_SMOKE, burstBlast: FLAK_BLAST_SCALE, burstShake: FLAK_SHAKE,
  },
}

/**
 * 陸上的輕型防空砲：蘇軍 37 mm 61-K 的樣子（`flakLight` 的模型是 2 cm
 * 四聯，剪影差不多）。**走彈丸池、有曳光** —— 夜空裡那一片曳光彈就是它。
 *
 * ```
 *   初速 880        沿用 40 mm 艦砲
 *   射速 160 發/分  61-K 的實際循環射速
 *   壽命 3.0 s      射程 2,640 m —— 1,500 m 的投彈高度打得到
 *   單發 7          40 mm 艦砲是 9
 * ```
 *
 * 【射界是天頂 ± 65°】陸上砲位的砲區在中線上，`axisOf` 對中線給的是天頂
 * 軸，射界錐是 `SHIP_AA_ARC_DEFAULTS.autocannon.halfAngleDeg`；仰角低於 25°
 * 的目標打不到 —— 貼地掠過的飛機是安全的，那正是掃射該有的樣子。
 *
 * 【壓力靠座數不靠單發】與洛伊納的重砲同一條哲學。**全部是起始值，由試玩
 * 裁定。** `boxHalf` 用不到（命中判定走 `GroundTarget.hull`）。
 */
export const GROUND_LIGHT_FLAK_SPEC: ShipGunSpec = {
  muzzleVelocity: 880, roundsPerMinute: 160, life: 3.0, caliber: 37,
  damage: 7, hp: 160, boxHalf: 1.0, rotationRate: 60 * DEG,
  ...NOT_FLAK,
}

/**
 * 陸上的 8.8 cm Flak 36/37。**與 5 吋艦砲分開的一份表** —— 一個守航母、
 * 一個守油廠，強度各自試飛。
 *
 * ## 史實
 *
 * 初速約 820 m/s、射速 15–20 發/分、有效射高約 8,000 m、彈重 9.4 kg。用的是
 * **時間引信**（Zeitzünder）而不是近炸引信。擊落一架四發轟炸機平均要數千發
 * —— 高砲真正的作用是累積損傷與心理壓力，不是單發致命。
 *
 * ## 遊戲值（**起始值，由試飛裁定**）
 *
 * ```
 *   初速 600        比 5 吋的 450 快（88 本來就是高初速砲），但仍遠低於史實
 *   射速 15 發/分   史實下限。艦砲有揚彈機，陸砲是人力裝填
 *   引信上限 8.2 s  射程 600 × 8.2 ≈ 4,900 m，與艦砲同一個射程
 *   引信誤差 ±6%    與 5 吋艦砲同值
 *   殺傷 75 m／120  **範圍大、單發輕**（艦砲是 50 m／200）
 *   震動 0.55       艦砲的兩倍多 —— 見下面那一格的理由
 * ```
 *
 * 【範圍大單發輕是刻意的】洛伊納的恐怖是累積損傷，不是單發致命：一朵雲對
 * B-17G 的爆心傷害只有血量的 2.1%（120 ÷ 防護 1.15 ÷ 5,000），但 75 m 的
 * 範圍讓「被打到」變成常態。史實上擊落一架四發轟炸機平均要數千發 88。
 *
 * 【射速在卡片上複寫】洛伊納那一關是 30 發/分（`MissionBattle.flakSpec`）——
 * `flakHeavy` 另外四關也在用，這裡的 15 是通用值。
 *
 * 【`damage`／`life` 填 0】那兩格是彈丸池用的，`flak` 這一層走引信不進池。
 */
export const GROUND_FLAK_SPEC: ShipGunSpec = {
  muzzleVelocity: 600, roundsPerMinute: 15, life: 0, caliber: 88,
  damage: 0, hp: 400, boxHalf: 3.0, rotationRate: 15 * DEG,
  maxFuse: 8.2, fuseError: FLAK_FUSE_ERROR, burstRadius: 75, burstDamage: 120,
  /*
   * 表現的三格。雲與閃光與艦砲同大小，**震動是艦砲的兩倍多**。
   *
   * 【震動 0.55 不是 0.25】角度吃 `trauma` 的平方（`camera/cameraShake.ts`）
   * —— 0.25 在爆心只有 0.23 度，65 度視野下是三個像素，玩家感覺不到自己
   * 正在挨打。0.55 是 1.13 度，而震動範圍也從 125 m 拉到 275 m。
   */
  burstSmoke: FLAK_SMOKE, burstBlast: FLAK_BLAST_SCALE, burstShake: 0.55,
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
      spec,
      aim: axis.clone(),
      axis,
      phase: 0, targetIndex: -1, searchCooldown: 0, fired: 0,
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
 * 陸上重高砲位的砲口高度，m。88 mm Flak 的砲耳大約在這裡。
 *
 * 【不是 0】槍焰與彈道都從這裡出發；貼地的話砲彈會從沙包裡冒出來。
 */
export const GROUND_FLAK_MUZZLE_Y = 2.2

/**
 * 一座陸上重高砲位的砲。**一個砲位一門**，走 `flak` 那一層（近炸引信、
 * 不進彈丸池）。
 *
 * 【射界朝正上】`axisOf` 靠 `zone.position.x` 判斷舷別，中線上的朝天頂 ——
 * 陸上砲位就該是這樣：它守的是頭上那一塊天，不是某一側。
 *
 * 【`hp` 與 `box` 用不到但要填】陸上砲位的命中判定走 `GroundTarget.hull`，
 * 這一門砲不是獨立的可打目標；`alive` 由砲位本身的存活決定。
 *
 * @param spec 這一關的規格。**省略 = `GROUND_FLAK_SPEC`** —— `flakHeavy` 在
 *   盟 M2、德 M2、日 M4 都出現，逐關複寫走 `BattleConfig.flakSpec`。
 * @param tier 走哪一層射控：`flak` 是時間引信（不進彈丸池）、`autocannon`／
 *   `mg` 是直射彈（進池、有曳光）。射界錐照 `SHIP_AA_ARC_DEFAULTS[tier]`
 * @param calibreMm 口徑，只進 `ShipAAZone`（穿甲門檻在 `spec.caliber`）
 */
export function createGroundBattery(
  spec: ShipGunSpec = GROUND_FLAK_SPEC, tier: ShipAATier = 'flak', calibreMm = 88,
): ShipGun[] {
  const zone: ShipAAZone = {
    id: 'flak_c1',
    tier,
    calibreMm,
    position: new Vector3(0, GROUND_FLAK_MUZZLE_Y, 0),
    guns: 1,
    mountsInZone: 1,
    representative: 'flak_c1',
  }
  const axis = axisOf(zone.position.x, zone.tier, new Vector3())
  const out: ShipGun[] = [{
    zone,
    spec,
    aim: axis.clone(),
    axis,
    phase: 0, targetIndex: -1, searchCooldown: 0, fired: 0,
    burstFiring: true, burstTimer: BURST_ON, burstScale: 1,
    flash: 0,
    hp: spec.hp,
    alive: true,
    box: {
      center: zone.position,
      half: new Vector3(spec.boxHalf, spec.boxHalf, spec.boxHalf),
    },
  }]
  resetGuns(out)
  return out
}

/**
 * 陸上砲位就地重設。**不配置任何物件** —— 與 `resetShipGuns` 同一件事，
 * 只是種子用地面目標的索引。
 */
export function resetGroundBattery(t: GunPlatform): void {
  resetGuns(t.guns as ShipGun[], t.index)
  t.gunCooldowns.fill(0)
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
    g.fired = 0
    g.flash = 0
    // 【讀自己的規格】船的 `spec` 就是表裡那一份；陸砲帶自己的，重設之後
    // 才不會變回艦砲的血量
    g.hp = g.spec.hp
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
 *
 * @param fleet 目標分攤要數的全部砲台。**`World` 一定要傳整組** —— 艦隊傳
 *   整支艦隊、陸上砲位傳全部砲位。省略時只數這一座，那是單台呼叫端（測試、
 *   探針）的退路；各自只數自己就回到「全部咬同一架」。
 *
 *   【陸上與海上分開數】兩者不會同場，而且混在一起要先把兩種砲台併成一個
 *   陣列 —— 那是每步一次配置。
 */
export function stepGunPlatform(
  ship: GunPlatform,
  all: readonly TurretCombatant[],
  projectiles: Projectiles,
  flak: FlakShells,
  time: number,
  dt: number,
  fleet: readonly GunPlatform[] = (SOLO[0] = ship, SOLO),
): void {
  const guns = ship.guns
  // 【沉了的砲台一門砲都不動】與「砲位死了完全不動」同一條規則，只是整座。
  if (!ship.alive || guns.length === 0) return

  const q = ship.orientation
  // 【一艘只算一次逆姿態】每個砲位各算一次就是 8 倍的四元數共軛
  INV_Q.copy(q).conjugate()

  // 【鎖定數每艘每步從整個艦隊重數】維護增減要求每一條退場路徑都配一次
  // 更新，漏掉一條就留下永遠不消失的幽靈鎖定；重數是 O(艦隊砲位數)，
  // 九艘船不到一百門，而且自我修復
  if (LOCKS.length < all.length) LOCKS = new Int32Array(all.length)
  LOCKS.fill(0, 0, all.length)
  for (const s of fleet) {
    if (!s.alive) continue
    for (const g of s.guns) {
      if (g.alive && g.targetIndex >= 0 && g.targetIndex < all.length) LOCKS[g.targetIndex]!++
    }
  }

  for (let i = 0; i < guns.length; i++) {
    const g = guns[i]!
    // 【死掉的砲位完全不動】不搜尋、不轉、不開火，連射速時鐘都不走
    if (!g.alive) continue
    // 【讀砲身上的那一份】同屬 flak 層的艦砲與陸砲強度不同
    const spec = g.spec
    const firingWindow = stepBurst(g, dt)

    // 槍口的世界位置。**預瞄從這裡解，不是從船的重心** —— 艦艏與艦艉的
    // 砲位相距 185 m，用重心解的方向誤差遠大於 2° 的開火門檻。
    MUZZLE.copy(g.zone.position).applyQuaternion(q).add(ship.position)

    // 選目標。搜尋一律受冷卻節流，**與現在有沒有目標無關**
    g.searchCooldown -= dt
    if (g.searchCooldown <= 0) {
      // 【自己的舊鎖定先放掉】否則重挑時自己那一票會把原目標算成滿的
      if (g.targetIndex >= 0 && g.targetIndex < all.length) LOCKS[g.targetIndex]!--
      g.targetIndex = pickTarget(ship, all, g, spec)
      if (g.targetIndex >= 0) LOCKS[g.targetIndex]!++
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
      const exact = solveLead(P, V, spec.muzzleVelocity, LEAD)
      if (exact === NO_INTERCEPT || exact > FLAK_MAX_FUSE) continue
      // 【誤差在上限檢查之後套】上限守的是「打不打得到」，誤差只是雲開在
      // 前面還是後面；讓誤差把一發合法的射擊擋掉沒有道理
      // 【種子含船、砲區與累計發射數】只用發射數的話九艘船的第一門砲會抽到
      // 同一串誤差
      const k = ((ship.index * MAX_SHIP_GUNS + i) * 0x100000 + g.fired) | 0
      g.fired++
      // 【夾在上限之內】誤差往後偏的那一半不能把射程推過引信上限
      const fuse = Math.min(spec.maxFuse, exact * (1 + spec.fuseError * (2 * hash01(k) - 1)))
      applyWobble(g.aim, SHIP_WOBBLE_AMPLITUDE, SHIP_WOBBLE_OMEGA, g.phase, time, E1, E2, SHOT)
      SHOT.applyQuaternion(q)
      VEL.copy(SHOT).multiplyScalar(spec.muzzleVelocity)
      spawnFlak(
        flak, MUZZLE.x, MUZZLE.y, MUZZLE.z, VEL.x, VEL.y, VEL.z,
        fuse, ship.team === 'blue' ? 0 : 1,
        spec.burstRadius, spec.burstDamage,
        spec.burstSmoke, spec.burstBlast, spec.burstShake,
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
        ship.team === 'blue' ? 0 : 1, spec.life, spec.caliber,
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
  return g.zone.tier === 'flak' ? spec.maxFuse : spec.life
}

/**
 * 整個艦隊此刻每一架敵機被幾門砲鎖定，依 combatant 索引。`stepShipGuns`
 * 每艘每步從整個艦隊重數，搜尋當步就地增減。長度跟著參戰架數走，只在
 * 架數超過時重配 —— 那發生在場景組裝期。
 */
let LOCKS = new Int32Array(64)

/** `stepShipGuns` 沒給艦隊時的單艦清單。不配置 */
const SOLO: GunPlatform[] = []

/**
 * 挑目標：敵隊、存活、有解、在射界內，取**全艦隊鎖定數最少**的；鎖定數
 * 相同時取離槍口最近的。
 *
 * 【為什麼不是「最近的」】每門砲各挑最近的話，一支四機小隊壓進來時九艘
 * 船的砲全部咬長機，長機死了下一秒全部轉到第二架 —— 四架依序死在同一段
 * 距離上，一支小隊永遠走不到投彈點。搜尋是逐門依序做的，「最少」於是
 * 自然輪流：第一門挑最近的，第二門挑鎖定數還是零的下一架，繞完一輪再從
 * 最近的疊第二層。只有一架在射程內時全艦隊照打，砲位不閒著。
 *
 * 【便宜的拒絕放在 solveLead 之前】與 `turrets.ts` 的 `pickTarget` 同一個
 * 理由：多數候選在遠處，先用距離平方擋掉。
 *
 * 【用 BEST_WANT 而不是 WANT】搜尋不能污染外層正在用的 `WANT`。
 */
function pickTarget(
  ship: GunPlatform, all: readonly TurretCombatant[], g: ShipGun, spec: ShipGunSpec,
): number {
  const reach = (spec.muzzleVelocity + MAX_CLOSING_SPEED) * rangeSeconds(g, spec)
  const reachSq = reach * reach
  let best = -1
  let bestDist = Infinity
  let bestLocks = Infinity
  for (let k = 0; k < all.length; k++) {
    const o = all[k]!
    if (!o.alive || o.team === ship.team) continue
    const d = o.aircraft.state.position.distanceToSquared(MUZZLE)
    if (d > reachSq) continue
    const locks = LOCKS[o.index]!
    if (locks > bestLocks || (locks === bestLocks && d >= bestDist)) continue
    if (!leadInBody(o, g, spec, BEST_WANT)) continue
    bestLocks = locks
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
