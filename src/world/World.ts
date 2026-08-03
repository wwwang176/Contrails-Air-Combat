import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { mountDirection } from '../weapons/types'
import { stepCadence } from '../weapons/cadence'
import {
  boundingRadius, createHitResult, hitAircraft, segmentPointDistanceSq,
  PART_MULTIPLIER, type HitPart,
} from './hit'
import { Projectiles } from './Projectiles'
import { CullIndex } from './cull'
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
  /**
   * 包圍球半徑，m。命中判定的粗篩用，隨 spec 一起更新。
   *
   * 【為什麼存在 Combatant 上而不是每次算】它只跟機種有關，而 resolveHits
   * 每步要對 4,000 發 × 每架各問一次——那是每秒上百萬次呼叫。
   */
  hitRadius: number
  team: Team
  /**
   * 還在戰場上。false = 已退場（被打爆或撞地）。
   *
   * 【為什麼是旗標而不是從 combatants 移除】`index` 是彈丸記錄射手用的。
   * `splice` 之後所有在飛的彈丸都會認錯主人 —— 包括「打不到自己」那條
   * 規則，於是死人的遺彈會開始打活人，而症狀離成因很遠。
   */
  alive: boolean
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
  /** 命中判定的粗篩索引。每個物理步重填一次（spec §5.2） */
  private readonly cull = new CullIndex()

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
      hitRadius: boundingRadius(aircraft.spec.hitBoxes),
      team,
      alive: true,
      hitsDealt: 0,
      respawnOnDestroy: false,
      spawnPosition: spawnPosition.clone(),
      spawnAltitude,
      spawnTas,
    }
    this.combatants.push(c)
    this.cull.ensure(this.combatants.length)
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
    //
    // 【hitsDealt 對退場的也歸零】HUD 那一層不必分辨死活，少一個「讀到上
    // 一條命的命中數」的機會。
    for (const c of this.combatants) {
      c.hitsDealt = 0
      if (!c.alive) continue
      c.controller.update(c.aircraft, dt, c.command)
    }

    // 2. 全部 Aircraft 推進，接著開火（槍口用推進後的姿態）
    for (const c of this.combatants) {
      if (!c.alive) continue
      c.aircraft.update(c.command.aimWorld, c.command.throttle, dt, c.command.brake)
    }
    for (const c of this.combatants) {
      if (!c.alive) continue
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
    c.hitRadius = boundingRadius(spec.hitBoxes)
  }

  /** 依扳機與射速時鐘發射。熱路徑，不配置。 */
  private fire(c: Combatant, dt: number): void {
    // 打爆的飛機不會繼續射擊。step 已經擋過退場的，這一條擋的是「血歸零
    // 但因為 respawnOnDestroy 而仍然活著」那一格的殘餘狀態。
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

  /**
   * 重填粗篩索引：只收存活的飛機，依 x 排序。
   *
   * 【為什麼在 resolveHits 裡而不是 step 開頭】判定吃的是**推進後**的位置。
   * 在飛機推進之前填，粗篩用的是上一步的殘影，視窗會偏掉一整步的位移。
   */
  private buildCull(): void {
    const cull = this.cull
    cull.clear()
    const combatants = this.combatants
    for (let i = 0; i < combatants.length; i++) {
      const c = combatants[i]!
      if (!c.alive) continue
      const p = c.aircraft.state.position
      cull.add(p.x, p.y, p.z, c.hitRadius, c.index, c.team === 'blue' ? 0 : 1)
    }
    cull.sort()
  }

  /**
   * 線段 vs 各機的命中盒，取最近的那一架。
   *
   * 【公開是為了等價測試】與 `applyDamage` 同一個理由。
   * `test/unit/cull-equivalence.test.ts` 要能在完全掌控的狀態下呼叫它，
   * 再與一份獨立的暴力法比對。
   *
   * 【這是整個專案最熱的迴圈】滿載 4,000 發 × 40 架。粗篩換成排序掃描之前
   * 是 7,408 µs，換之後 202 µs（M5 spec §5.1）。所以這裡刻意寫得比別處囉嗦：
   *
   *   - **索引迴圈而不是 for...of**。後者每次都會配置一個迭代器物件，
   *     在這個位置就是每步 4,000 次配置——違反熱路徑零配置的紀律。
   *   - **視窗用 x 區間夾**。窗外的飛機在代數上不可能被命中（spec §5.3），
   *     所以窗內取到的最小 t 就是全場的最小 t。
   *   - **座標從 CullIndex 的並排陣列讀**，不穿 Combatant → Aircraft → state。
   *   - **s0/s1 只在通過粗篩後才寫**。粗篩擋掉絕大多數的配對，把兩個
   *     Vector3.set 留在外面等於替它們白做。
   */
  resolveHits(): void {
    this.buildCull()

    const p = this.projectiles
    const combatants = this.combatants
    const cull = this.cull
    const rMax = cull.rMax
    const s0 = S.v[0]!
    const s1 = S.v[1]!

    for (let i = 0; i < p.capacity; i++) {
      const owner = p.owner[i]!
      if (owner === -1) continue
      const ax = p.sx[i]!, ay = p.sy[i]!, az = p.sz[i]!
      const bx = p.x[i]!, by = p.y[i]!, bz = p.z[i]!

      // 射手的陣營。同隊的彈丸直接穿過（spec §5.4）；射手不在名單上時取 −1，
      // 於是不會與任何 0/1 相等，等於不做同隊過濾。
      const shooter = owner >= 0 && owner < combatants.length ? combatants[owner] : undefined
      const ownerTeam = shooter === undefined ? -1 : (shooter.team === 'blue' ? 0 : 1)

      const lo = (ax < bx ? ax : bx) - rMax
      const hi = (ax > bx ? ax : bx) + rMax

      let bestT = Infinity
      let victim: Combatant | null = null
      let part: HitPart = 'fuselage'
      const count = cull.count
      for (let j = cull.lowerBound(lo); j < count; j++) {
        const cx = cull.x[j]!
        if (cx > hi) break
        if (cull.team[j]! === ownerTeam) continue
        // 【同隊過濾已經涵蓋自傷，但這一條要留】spec §5.4：「同隊零傷害」
        // 必須是一條自己成立的規則，而不是碰巧被另一條擋掉。
        if (cull.index[j]! === owner) continue
        // 【粗篩】線段離機體重心比包圍球還遠就一定碰不到，跳過六次 slab
        // 測試與兩次四元數旋轉。
        if (segmentPointDistanceSq(
          ax, ay, az, bx, by, bz, cx, cull.y[j]!, cull.z[j]!,
        ) > cull.r2[j]!) continue

        const c = combatants[cull.index[j]!]!
        s0.set(ax, ay, az)
        s1.set(bx, by, bz)
        if (!hitAircraft(
          c.aircraft.spec.hitBoxes, c.aircraft.state.position, c.aircraft.state.orientation,
          s0, s1, this.hit,
        )) continue
        if (this.hit.t >= bestT) continue
        bestT = this.hit.t
        victim = c
        part = this.hit.part
      }
      if (!victim) continue

      // 【命中即回收】不回收的話同一發會在後續每一步繼續扣血，而且池子
      // 會被打進機身的彈丸塞滿。
      this.applyDamage(victim, p.damage[i]!, part, shooter)
      p.kill(i)
    }
  }

  /** 扣血並在必要時重生。倍率在這裡套用，測試可以直接呼叫。 */
  applyDamage(victim: Combatant, damage: number, part: HitPart, shooter?: Combatant): void {
    // 退場的飛機打不中——這一條也讓「死人身上還在扣血」不可能發生
    if (!victim.alive) return

    victim.hp -= damage * PART_MULTIPLIER[part]
    if (shooter) shooter.hitsDealt++
    if (victim.hp > 0) return

    this.destroy(victim)
  }

  /**
   * 退場。被打爆與撞地走同一條路徑（spec §7）。
   *
   * 【為什麼抽出來】兩個觸發、一套後果。分成兩份長得很像的副本，就是只有
   * 一份會被修好的那種危險 —— 與 `isCrashed` 當初抽出來同一個理由。
   */
  destroy(c: Combatant): void {
    c.hp = 0
    if (c.respawnOnDestroy) {
      this.respawn(c)
      return
    }
    c.alive = false
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
    c.alive = true
  }
}
