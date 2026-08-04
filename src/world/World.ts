import { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { mountDirection } from '../weapons/types'
import { stepCadence } from '../weapons/cadence'
import {
  boundingRadius, createHitResult, hitAircraft, segmentPointDistanceSq,
  PART_MULTIPLIER, type HitPart,
} from './hit'
import { Projectiles } from './Projectiles'
import { createImpacts, pushImpact, type ImpactEvents } from './events'
import { createKills, pushKill, type KillEvents } from './kills'
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
  /**
   * 每個掛架的槍焰剩餘秒數。長度等於 `spec.battery.mounts.length`。
   *
   * 【為什麼是計時器而不是事件】事件會帶著**物理子步**的位置，而畫面畫
   * 在**內插後**的位置 —— 200 m/s 下差 0.83 m，槍焰會相對機身抖動接近
   * 一個機身長度。計時器是一個**狀態**，渲染層讀它的時候自己用內插姿態
   * 重算槍口位置（M7 spec §2.1）。
   *
   * 【不是 readonly】與 `cooldowns` 同一個理由：換裝機種時掛架數會變。
   */
  muzzleFlash: Float32Array
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

/**
 * 撞地判定。回傳 true 代表這一架已經碰到地面／海面。
 *
 * 【為什麼是注入的而不是寫死】玩家看到的海面是 Gerstner 波，判定必須走與
 * 著色器同一份波參數（見 aircraft/crash.ts）；而 headless 測試沒有海面
 * 著色器，也不該為此拖進渲染層。一個呼叫點、一條可替換的政策，就不會變成
 * 兩份長得很像、只有一份會被修好的判定。
 */
export type CrashPolicy = (c: Combatant) => boolean

/** 預設政策：平海面。headless 測試與對戰矩陣用這一個。 */
const SEA_LEVEL: CrashPolicy = (c) => c.aircraft.state.position.y <= 0

// 【第四個給命中法線用】resolveHits 的 s0/s1 佔了 v[0]、v[1]，fire 佔
// v[0..2]，兩者不同時執行。v[3] 是 M7 新增的法線暫存。
const S = makeScratch(4)

/**
 * 槍焰的顯示時長，s。
 *
 * 【兩個界夾出來的】
 * **下界 16.7 ms**：60 fps 的一幀。閃得比一幀短就會被抽樣漏掉 —— 有時
 * 看得到有時看不到，那比沒有更糟。30 ms 橫跨 1.8 幀，保證每次擊發至少
 * 畫到一幀。
 * **上界 67 ms**：全場最快的一管是 Bf 109 的 MG 131（900 rpm）。工作
 * 週期 30/67 = 45%，讀起來是**閃爍**；取到 60 ms 以上就變成一盞常亮的
 * 燈，那是錯的視覺（M7 spec §5.3）。
 *
 * 【為什麼住在 World 而不是 render】它記的是「這一管距離上次擊發多久」，
 * 那是物理事實不是畫面參數。渲染層決定它長什麼樣子。
 */
export const FLASH_SECONDS = 0.03

/**
 * 水面高度，m。**只用來決定「水柱畫在哪裡」**，不是回收深度。
 *
 * 【它是一個平面而海面不是】`main.ts` 注入的撞海判定走 Gerstner 波
 * （振幅合計約 ±2.15 m）。在 `resolveHits`（4,000 發 × 240 Hz）裡對每一
 * 發彈丸取一次浪高是每秒近百萬次 sin/cos，不划算。誤差最多 2.15 m ——
 * 887 m/s 下 2.4 ms —— 而**看得到的那個東西**（水柱）由渲染層擺在真實
 * 浪高上，所以畫面是對的（M7 spec §4.2）。
 */
export const SEA_SURFACE_Y = 0

/**
 * 彈丸低於這個高度就回收，m。
 *
 * 【為什麼不是 SEA_SURFACE_Y】撞海判定是 `y <= 浪高 + CRASH_CLEARANCE`，
 * 而 `CRASH_CLEARANCE = 2 m`、浪谷可到 −2.15 m —— 一架**還活著**的飛機
 * 可以低到 `y = −0.15 m`，它的命中盒更可以伸到更低。在水面就回收，理論上
 * 會吃掉那些命中（M7 spec §4.3，初稿在這裡寫錯過）。
 *
 * 【−20 m 的推導】存活 ⟹ 機體原點 > 浪谷 + `CRASH_CLEARANCE`。取一個保守
 * 的浪谷 −5 m（實際約 −2.15 m）得原點 > −3 m；加上全機種最大的包圍半徑
 * 7.1 m（P-51D 的機尾角），存活飛機的命中盒伸不到 −10.1 m 以下。−20 m
 * 有兩倍餘裕，所以**證明得出**回收它不會少算任何命中。
 *
 * 代價是彈丸多飛 20 m —— 887 m/s 下 22 ms，而且那一段整個被海面遮住。
 */
export const SEA_KILL_Y = -20

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

  /**
   * 撞地判定。`main.ts` 注入與海面著色器共用波參數的版本。
   *
   * 【M5 起擴及所有飛機】M2 到 M4 只對玩家做，理由是「靶機在固定高度巡航，
   * 不會撞海」。20v20 裡總有人會被打到失控 —— 不補的話會出現在海面下繼續
   * 飛的飛機（M5 spec §1.1）。
   */
  crashPolicy: CrashPolicy = SEA_LEVEL

  /**
   * 這一個物理步之內的命中事件。**呼叫端負責排空**（M7 spec §2.2）。
   *
   * 【為什麼是呼叫端排空而不是 World 自己在 step 開頭清】一幀可能跑好幾
   * 個子步，而渲染層在子步回呼裡消費。`World` 自己清的話，能不能收到就
   * 取決於清空與消費的先後順序 —— 那是一個看不出來的耦合。
   *
   * headless 測試不排空，於是它會填滿並開始丟棄。那沒有問題：`dropped`
   * 是給**有排空**的整合測試斷言用的（見 `multi-battle.test.ts`）。
   */
  readonly hitEvents: ImpactEvents = createImpacts()

  /**
   * 這一個物理步之內的入海事件。法線恆為 `(0, 1, 0)` —— 水柱就是「法線
   * 朝上的撞擊」，所以與命中共用同一個型別（M7 spec §2.2）。
   *
   * 與 `hitEvents` 一樣由**呼叫端**排空。
   */
  readonly splashEvents: ImpactEvents = createImpacts()

  /**
   * 這一個物理步的擊墜事件。與 `hitEvents` 一樣由**呼叫端**排空。
   *
   * 【為什麼不是 readonly】容量要跟著參戰架數走，而架數是 `add()` 一架一架
   * 長出來的。一個子步之內每架最多死一次（重生走的是每幀一次的 `main.ts`
   * 路徑，不在子步裡），所以「容量 = 架數」是一個**上界**而不是猜測 ——
   * 溢位於是在結構上不可能，而掉一次擊墜等於少一次爆炸（M8 spec §3）。
   *
   * 【重新配置只發生在 `add()`】那是場景組裝期，不是熱路徑。代價是持有
   * `world.killEvents` 參考的人必須在所有 `add()` 之後才取 —— `main.ts`
   * 每幀重新讀屬性，不快取。
   */
  killEvents: KillEvents = createKills(0)

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
      muzzleFlash: new Float32Array(aircraft.spec.battery.mounts.length),
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
    // 見 killEvents 的註解：容量跟著架數走，溢位於是在結構上不可能
    if (this.killEvents.capacity < this.combatants.length) {
      this.killEvents = createKills(this.combatants.length)
    }
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
      // 【槍焰的遞減要在 alive 檢查之前】被打爆那一瞬間亮著的槍焰，
      // 若遞減寫在 continue 之後就會永遠停在那裡。
      const flash = c.muzzleFlash
      for (let i = 0; i < flash.length; i++) {
        const v = flash[i]! - dt
        flash[i] = v > 0 ? v : 0
      }
      if (!c.alive) continue
      c.controller.update(c.aircraft, dt, c.command)
    }

    // 2. 全部 Aircraft 推進，接著開火（槍口用推進後的姿態）
    for (const c of this.combatants) {
      if (!c.alive) continue
      c.aircraft.update(c.command.aimWorld, c.command.throttle, dt, c.command.brake)
    }
    // 【撞地要在開火之前判】撞地的那一步不該還打得出子彈。
    for (const c of this.combatants) {
      if (!c.alive) continue
      if (this.crashPolicy(c)) this.destroy(c)
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
    // 【槍焰計時器與射速時鐘一起重配】理由相同，而且必須在同一個地方 ——
    // 分開寫就是只有一份會被修好的那種危險。
    if (c.muzzleFlash.length !== spec.battery.mounts.length) {
      c.muzzleFlash = new Float32Array(spec.battery.mounts.length)
    } else {
      c.muzzleFlash.fill(0)
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
      c.muzzleFlash[i] = FLASH_SECONDS

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
      // 【法線要與 bestT 一起抄】this.hit 每次 hitAircraft 呼叫都被覆寫，
      // 留到迴圈外再讀就會拿到「最後一個被測到的盒」而不是「最近的那一個」
      let bestNx = 0
      let bestNy = 0
      let bestNz = 0
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
        bestNx = this.hit.nx
        bestNy = this.hit.ny
        bestNz = this.hit.nz
      }
      if (!victim) {
        // 【水柱只在跨過水面的那一步推】寫成「y <= 水面」的話，彈丸在
        // 水面下的每一步都會再推一筆，一發變成一串。
        if (ay > SEA_SURFACE_Y && by <= SEA_SURFACE_Y) {
          const s = (ay - SEA_SURFACE_Y) / (ay - by)
          pushImpact(
            this.splashEvents,
            ax + (bx - ax) * s, SEA_SURFACE_Y, az + (bz - az) * s,
            0, 1, 0,
          )
        }
        // 【回收在更深的地方】見 SEA_KILL_Y 的推導
        if (by <= SEA_KILL_Y) p.kill(i)
        continue
      }

      // 【命中點與世界法線】命中點是線段上的 bestT；法線由機體座標轉世界
      const n = S.v[3]!
      if (bestNx !== 0 || bestNy !== 0 || bestNz !== 0) {
        n.set(bestNx, bestNy, bestNz).applyQuaternion(victim.aircraft.state.orientation)
      } else {
        // 【起點就在盒內】沒有入射面（M7 spec §3.2）。迎面噴回去 ——
        // 這是唯一一個「沒有正確答案」的情形，取一個不會出錯的方向。
        n.set(ax - bx, ay - by, az - bz)
        const len = n.length()
        if (len > 1e-6) n.divideScalar(len)
        else n.set(0, 1, 0)
      }
      pushImpact(
        this.hitEvents,
        ax + (bx - ax) * bestT, ay + (by - ay) * bestT, az + (bz - az) * bestT,
        n.x, n.y, n.z,
      )

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

    this.destroy(victim, shooter)
  }

  /**
   * 退場。被打爆與撞地走同一條路徑（spec §7）。
   *
   * 【為什麼抽出來】兩個觸發、一套後果。分成兩份長得很像的副本，就是只有
   * 一份會被修好的那種危險 —— 與 `isCrashed` 當初抽出來同一個理由。
   *
   * 【`killer` 省略＝沒有人的功勞】撞海與自摔走的就是這一條。事件的兇手欄
   * 寫 −1，記分板於是不會把它算給任何人（M9 spec §4.1）。
   */
  destroy(c: Combatant, killer?: Combatant): void {
    c.hp = 0
    if (c.respawnOnDestroy) {
      this.respawn(c)
      return
    }
    // 【推事件而不是讓渲染層比對 alive】見 kills.ts 的註解。排在
    // respawnOnDestroy 之後 —— 自動重生的靶機不是一次擊墜，不該生爆炸。
    const p = c.aircraft.state.position
    const v = c.aircraft.state.velocity
    // 【判物件而不是判索引】索引 0 是合法的兇手，`killer ? ... : -1` 會把
    // 第 0 座位的擊墜寫成「無兇手」
    pushKill(
      this.killEvents, p.x, p.y, p.z, v.x, v.y, v.z, c.index,
      killer === undefined ? -1 : killer.index,
    )
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
