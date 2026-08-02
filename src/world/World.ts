import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { mountDirection } from '../weapons/types'
import { stepCadence } from '../weapons/cadence'
import { createHitResult, hitAircraft, PART_MULTIPLIER, type HitPart } from './hit'
import { Projectiles } from './Projectiles'
import { createCommand, type Command, type Controller } from '../control/Controller'
import type { Aircraft } from '../aircraft/Aircraft'
import type { AircraftSpec } from '../specs/types'

export type Team = 'blue' | 'red'

/** 世界裡的一架飛機：機體 + 控制器 + 武器狀態 + 戰損狀態。 */
export interface Combatant {
  /** 在 `World.combatants` 裡的索引。彈丸用它記錄射手，判定時排除自傷。 */
  readonly index: number
  readonly aircraft: Aircraft
  controller: Controller
  readonly command: Command
  /**
   * 每個掛架一個射擊時鐘。長度等於 `spec.battery.mounts.length`。
   *
   * 【不是 readonly】換裝機種時掛架數會變（P-51 六個、109 三個），
   * `setSpec` 必須換掉整個陣列。
   */
  cooldowns: Float32Array
  hp: number
  team: Team
  /** 這一步打中別人幾次。HUD 的 X 標記靠它觸發（0.15 s 計時在 HUD 那一層）。 */
  hitsDealt: number
  /** 靶機為真：被打爆就滿血重生。玩家為假（M2 沒有東西打得到玩家）。 */
  respawnOnDestroy: boolean
  readonly spawnPosition: Vector3
  spawnAltitude: number
  spawnTas: number
}

const S = makeScratch(3)

/**
 * 世界 —— `Combatant[]` + 彈丸池 + 每步的四段順序。
 *
 * 【為什麼要有這一層】M1 的 main.ts 假設「世界上只有一架飛機」。M4 的 AI
 * 與 M5 的 40 架都從這個結構長出來，晚做只會更貴（spec §1）。`Aircraft`
 * 的介面完全不動，重量全在這裡與渲染／HUD 層。
 */
export class World {
  readonly combatants: Combatant[] = []
  readonly projectiles = new Projectiles()

  private readonly hit = createHitResult()

  add(
    aircraft: Aircraft,
    controller: Controller,
    team: Team,
    spawnPosition: Vector3,
    spawnAltitude = spawnPosition.y,
    spawnTas = 160,
  ): Combatant {
    const c: Combatant = {
      index: this.combatants.length,
      aircraft,
      controller,
      command: createCommand(),
      cooldowns: new Float32Array(aircraft.spec.battery.mounts.length),
      hp: aircraft.spec.hp,
      team,
      hitsDealt: 0,
      respawnOnDestroy: false,
      spawnPosition: spawnPosition.clone(),
      spawnAltitude,
      spawnTas,
    }
    this.combatants.push(c)
    return c
  }

  /**
   * 推進一個物理步。順序見 spec §4.2，**不可調換**。
   *
   * 【彈丸為什麼在飛機之後推進】判定用的是這一步的新位置。順序顛倒會讓
   * 彈丸打到上一步的殘影——240 Hz 下 300 m/s 的目標一步走 1.25 m，
   * 迎頭接近時兩機的相對位移是它的兩倍，那是看得出來的。
   */
  step(dt: number): void {
    // 1. 各控制器產生指令
    for (const c of this.combatants) {
      c.hitsDealt = 0
      c.controller.update(c.aircraft, dt, c.command)
    }

    // 2. 全部 Aircraft 推進，接著開火（槍口用推進後的姿態）
    for (const c of this.combatants) {
      c.aircraft.update(c.command.aimWorld, c.command.throttle, dt)
    }
    for (const c of this.combatants) {
      this.fire(c, dt)
    }

    // 3. 彈丸推進
    this.projectiles.step(dt)

    // 4. 命中判定
    this.resolveHits()
  }

  /**
   * 換裝機種。
   *
   * 【射速時鐘必須跟著重配】P-51 六個掛架、109 三個。沿用舊陣列的話，
   * 換成 109 之後第四到第六個時鐘變成孤兒（不影響結果但是死資料），
   * 而由 109 換回 P-51 時迴圈會讀到 `cooldowns[3..5]` 這三個不存在的槽位
   * ——在 `noUncheckedIndexedAccess` 下 `cooldowns[i]!` 會是 `undefined`，
   * 算術一路變成 NaN，那三挺槍從此永遠不發射。
   */
  setSpec(c: Combatant, spec: AircraftSpec): void {
    c.aircraft.setSpec(spec)
    if (c.cooldowns.length !== spec.battery.mounts.length) {
      c.cooldowns = new Float32Array(spec.battery.mounts.length)
    } else {
      c.cooldowns.fill(0)
    }
    c.hp = spec.hp
  }

  /** 依扳機與射速時鐘發射。熱路徑，不配置。 */
  private fire(c: Combatant, dt: number): void {
    // 打爆的飛機不會繼續射擊
    if (c.hp <= 0) return

    const battery = c.aircraft.spec.battery
    const trigger = c.command.firing
    const pos = c.aircraft.state.position
    const vel = c.aircraft.state.velocity
    const q = c.aircraft.state.orientation

    for (let i = 0; i < battery.mounts.length; i++) {
      const mount = battery.mounts[i]!
      const shots = stepCadence(c.cooldowns, i, mount.weapon.roundsPerMinute, trigger, dt)
      if (shots === 0) continue

      // 槍口的世界位置與世界射向
      const muzzle = S.v[0]!.copy(mount.position).applyQuaternion(q).add(pos)
      const dir = mountDirection(battery, i, S.v[1]!).applyQuaternion(q)
      // V_bullet = 槍口方向 × 初速 + 射手速度（spec §5.1）
      const v = S.v[2]!.copy(dir).multiplyScalar(mount.weapon.muzzleVelocity).add(vel)

      for (let n = 0; n < shots; n++) {
        this.projectiles.spawn(
          muzzle.x, muzzle.y, muzzle.z, v.x, v.y, v.z, mount.weapon.damage, c.index,
        )
      }
    }
  }

  /** 線段 vs 各機的命中盒，取最近的那一架。 */
  private resolveHits(): void {
    const p = this.projectiles
    const s0 = S.v[0]!
    const s1 = S.v[1]!

    for (let i = 0; i < p.capacity; i++) {
      const owner = p.owner[i]!
      if (owner === -1) continue
      s0.set(p.sx[i]!, p.sy[i]!, p.sz[i]!)
      s1.set(p.x[i]!, p.y[i]!, p.z[i]!)

      let bestT = Infinity
      let victim: Combatant | null = null
      let part: HitPart = 'fuselage'
      for (const c of this.combatants) {
        if (c.index === owner) continue      // 打不到自己
        if (c.hp <= 0) continue
        if (!hitAircraft(
          c.aircraft.spec.hitBoxes, c.aircraft.state.position,
          c.aircraft.state.orientation, s0, s1, this.hit,
        )) continue
        if (this.hit.t >= bestT) continue
        bestT = this.hit.t
        victim = c
        part = this.hit.part
      }
      if (!victim) continue

      // 【命中即回收】不回收的話同一發會在後續每一步繼續扣血，而且池子
      // 會被打進機身的彈丸塞滿。
      const shooter = owner >= 0 && owner < this.combatants.length
        ? this.combatants[owner]!
        : undefined
      this.applyDamage(victim, p.damage[i]!, part, shooter)
      p.kill(i)
    }
  }

  /** 扣血並在必要時重生。倍率在這裡套用，測試可以直接呼叫。 */
  applyDamage(victim: Combatant, damage: number, part: HitPart, shooter?: Combatant): void {
    victim.hp -= damage * PART_MULTIPLIER[part]
    if (shooter) shooter.hitsDealt++
    if (victim.hp > 0) return

    victim.hp = 0
    if (victim.respawnOnDestroy) this.respawn(victim)
  }

  /**
   * 滿血重生在出生點。
   *
   * 【為什麼 M2 的靶機是自動重生而不是留一具殘骸】M2 沒有爆炸、沒有殘骸、
   * 也沒有選單——靶機的存在就是為了被打（spec §11）。自動重生讓驗收迴圈
   * 保持緊湊，而且不必為此發明一套死亡狀態機。
   */
  respawn(c: Combatant): void {
    c.aircraft.reset(c.spawnAltitude, c.spawnTas)
    c.aircraft.state.position.copy(c.spawnPosition)
    c.aircraft.prevPosition.copy(c.spawnPosition)
    c.hp = c.aircraft.spec.hp
    c.cooldowns.fill(0)
    c.hitsDealt = 0
  }
}
