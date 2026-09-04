import { Quaternion, Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { mountDirection } from '../weapons/types'
import { stepCadence } from '../weapons/cadence'
import {
  boundingRadius, createHitResult, hitAircraft, segmentBox, segmentPointDistanceSq,
  NO_HIT, PART_MULTIPLIER, type HitPart,
} from './hit'
import { Projectiles } from './Projectiles'
import { createImpacts, pushImpact, type ImpactEvents } from './events'
import { createKills, pushKill, type KillEvents } from './kills'
import { createDamageEvents, pushDamage, type DamageEvents } from './damage'
import { CullIndex } from './cull'
import { landHitT, type LandField } from './occlusion'
import { normalAt, type SurfaceNormal } from './heightfield'
import { createTurretStates, resetTurretStates, stepTurrets } from './turrets'
import { stepShips, type Ship } from './ships'
import { stepShipGuns, ownerShipIndex } from './shipGuns'
import {
  createBursts, createFlak, clearBursts, flakDamage, pushBurst, stepFlak, FLAK_CAPACITY,
} from './flak'
import { obbOverlap } from './obb'
import type { TurretState } from './turrets'
import { createCommand, type Command, type Controller } from '../control/Controller'
import type { Aircraft } from '../aircraft/Aircraft'
import type { AircraftSpec } from '../specs/types'
import { PROJECTILE_LIFETIME } from './Projectiles'

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

  /**
   * 每座砲塔的執行期狀態。
   *
   * 【不是 readonly】與 `cooldowns` 同一個理由：換裝機種時砲塔數會變。
   */
  turretStates: TurretState[]
  /** 每座砲塔的射速時鐘。與 `cooldowns` 平行，但砲塔走自己那一條。 */
  turretCooldowns: Float32Array
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

/** 撞到陸地時的法線。模組級 —— 熱路徑不得配置 */
const LAND_N: SurfaceNormal = { nx: 0, ny: 1, nz: 0 }

/** 世界 → 艦體的逆姿態。模組級，熱路徑不得配置。 */
const SHIP_INV = /* @__PURE__ */ new Quaternion()
/** 撞船判定用的暫存。與 `SHIP_INV` 分開 —— 兩者同時活著。 */
const HULL_C = /* @__PURE__ */ new Vector3()
const BODY_C = /* @__PURE__ */ new Vector3()

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
   * 這一場的船。**船不是 `Combatant`** —— 它沒有飛行模型、不進記分板、
   * 不上 HUD 的接觸列表（見 spec §2）。空陣列 = 這一場沒有船，而三段推進
   * 都是零長度早退，所以既有的空戰逐位元不變。
   */
  readonly ships: Ship[] = []

  /** 空中的高砲彈。它不進彈丸池 —— 飛行途中不做命中判定。 */
  readonly flak = createFlak()

  /**
   * 這一個物理步的高砲引爆事件。**呼叫端負責排空**（與 `hitEvents` 同一個
   * 約定）—— 渲染層讀它畫黑雲。
   */
  readonly burstEvents = createBursts()

  /**
   * **這一步**的引爆，傷害用。每步開頭清空，由 `World` 自己吃掉。
   *
   * 【為什麼不能直接用 `burstEvents` 算傷害】那一份是呼叫端排空的 ——
   * headless 測試不排空，於是同一朵雲會**每一個物理步再扣一次血**。
   * 實測：一架停在 400 m 的一式陸攻兩秒內從 2,800 掉到 0，而畫面上只有
   * 一朵雲。
   *
   * 【為什麼容量等於彈池】一步之內最多所有在空中的砲彈同時引爆，所以
   * 這一份**在結構上不可能溢位** —— 而溢位就等於靜靜地少扣一次血。
   */
  private readonly stepBursts = createBursts(FLAK_CAPACITY)

  /**
   * 撞地判定。`main.ts` 注入與海面著色器共用波參數的版本。
   *
   * 【M5 起擴及所有飛機】M2 到 M4 只對玩家做，理由是「靶機在固定高度巡航，
   * 不會撞海」。20v20 裡總有人會被打到失控 —— 不補的話會出現在海面下繼續
   * 飛的飛機（M5 spec §1.1）。
   */
  crashPolicy: CrashPolicy = SEA_LEVEL

  /**
   * 這一場的陸地。彈丸撞到它就爆火花並回收。**`null` = 沒有陸地。**
   *
   * 【為什麼不是一個假的平原】造一個 `ceiling = SEA_FLOOR` 的物件會讓每
   * 一發入海的彈丸都去查高度場，而且「陸地要高於海平面」會變成唯一擋住
   * 海面回歸的東西。`null` 加上那道判準是兩道保險。
   *
   * 【海面那一條完全不走這裡】水柱仍在 `SEA_SURFACE_Y`、回收仍在
   * `SEA_KILL_Y`。見 `occlusion.ts` 的 `SEA`。
   */
  land: LandField | null = null

  /**
   * 這一個物理步之內的命中事件。**呼叫端負責排空**（M7 spec §2.2）。
   *
   * 【為什麼是呼叫端排空而不是 World 自己在 step 開頭清】一幀可能跑好幾
   * 個子步，而渲染層在子步回呼裡消費。`World` 自己清的話，能不能收到就
   * 取決於清空與消費的先後順序 —— 那是一個看不出來的耦合。
   *
   * headless 測試不排空，於是它會填滿並開始丟棄。那沒有問題：`dropped`
   * 是給**有排空**的整合測試斷言用的（見 `multi-battle.test.ts`）。
   *
   * 【它的語意是「彈丸撞到東西」，不是「彈丸打中飛機」】`land` 接上之後，
   * 撞在山壁上的那一發也推一筆（火花與打到飛機同一組）。`multi-battle`
   * 拿它的 `count` 當命中數 —— 那一支不注入地形，所以仍然成立，但下一個
   * 想這樣用的人要知道。傷害仍然只走 `damageEvents`。
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

  /**
   * 這一個物理步的受擊事件。與 `hitEvents` 一樣由**呼叫端**排空。
   *
   * 【為什麼對每一架都推，而不是只推玩家的】`World` 不知道誰是玩家，這一版
   * 也不該讓它知道。一次 push 是四個 float，`main.ts` 自己過濾
   * （受擊方向指示器 spec §3.1）。
   */
  readonly damageEvents: DamageEvents = createDamageEvents()

  /**
   * 世界時鐘，s。每個 `step` 開頭累加。
   *
   * 【為什麼世界要有自己的時鐘】助攻的時間窗口需要一個單調的時間基準，而
   * `main.ts` 的 `elapsed` 是**幀**的時間、還會被慢動作縮放（試驗場就有）。
   * 判定用的東西不該掛在畫面那一側。
   */
  time = 0

  /**
   * `damageTime[攻擊者 * damageStride + 受害者]` = 最後一次命中的世界時間。
   * 初值 `-Infinity`。
   *
   * 【為什麼是完整的 N×N 而不是每架一份清單】20v20 是 1,600 個 float，
   * 一次性配置；查一個「a 有沒有在窗口內打過 v」是 O(1)，而擊墜時掃一欄
   * 是 O(N)。清單版本要維護新增與過期，換來的只是省下幾 KB。
   *
   * 【為什麼初值不是 0】世界時間從 0 開始 —— 0 會被讀成「t=0 打過」
   * （M9 spec §5.1）。
   */
  damageTime = new Float32Array(0)

  /**
   * `damageTime` 的邊長。**等於配置當時的參戰架數。**
   *
   * 【為什麼公開】`stepBattle` 掃助攻時要用它當索引乘數。用
   * `combatants.length` 在組裝完成後恆等，但那是一個沒有東西保護的巧合。
   */
  damageStride = 0

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
      turretStates: createTurretStates(aircraft.spec, this.combatants.length),
      turretCooldowns: new Float32Array(aircraft.spec.turrets.length),
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
    this.grow(this.combatants.length)
    return c
  }

  /**
   * 預留到 `n` 架的容量。**只長不縮。**
   *
   * 【它買到什麼】`add` 的擴容路徑只在場景組裝期是安全的 —— `killEvents`
   * 會被換成一個空的、`damageTime` 會被整張填成 `-Infinity`。戰鬥進行中
   * 呼叫 `add` 因此會丟掉這一步還沒被排空的擊墜事件（戰績記到了、爆炸不見
   * 了），並抹掉全場的助攻窗口。
   *
   * 先 `reserve` 到最終架數，之後 `add` 的三個條件都不成立，中途加人於是
   * **一次都不重配**。
   *
   * 【為什麼不縮】縮了會讓已經發生的傷害紀錄越界。`n` 小於現有容量時
   * 這一呼叫什麼都不做。
   */
  reserve(n: number): void {
    this.grow(n)
  }

  /**
   * 把三個依架數的容器長到至少 `n`。
   *
   * 【重配就整張清掉】舊資料的索引在邊長變了之後全部失效 —— 搬移是一個
   * 沒有人會需要的功能，因為呼叫端只有兩個：組裝期的 `add`，以及組裝期的
   * `reserve`。**戰鬥中不得走到這裡**，那正是 `reserve` 存在的理由。
   */
  private grow(n: number): void {
    this.cull.ensure(n)
    // 見 killEvents 的註解：容量跟著架數走，溢位於是在結構上不可能
    if (this.killEvents.capacity < n) {
      this.killEvents = createKills(n)
    }
    if (this.damageStride < n) {
      this.damageStride = n
      this.damageTime = new Float32Array(n * n).fill(-Infinity)
    }
  }

  /**
   * 推進一個物理步。順序見 spec §4.2，**不可調換**。
   *
   * 【彈丸為什麼在飛機之後推進】判定用的是這一步的新位置。順序顛倒會讓
   * 彈丸打到上一步的殘影——240 Hz 下 300 m/s 的目標一步走 1.25 m，
   * 迎頭接近時兩機的相對位移是它的兩倍，那是看得出來的。
   */
  step(dt: number): void {
    // 【時鐘先走】這一步之內記下的命中時刻屬於這一步的結束時間，
    // 而同一步之內發生的擊墜用同一個 `time` 判窗口 —— 兩者一致。
    this.time += dt

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
      // 【砲塔的槍焰跟固定槍在同一個迴圈】理由與上面那一段一模一樣：遞減
      // 若寫在存活檢查之後，被打爆那一瞬間亮著的槍焰會永遠停在那裡。併在
      // 一起而不是讓 stepTurrets 自己遞減，是為了讓死掉的飛機不必每步再跑
      // 一次砲塔迴圈。
      for (let i = 0; i < c.turretStates.length; i++) {
        const st = c.turretStates[i]!
        const v = st.flash - dt
        st.flash = v > 0 ? v : 0
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
    // 【撞船與撞地同一個位置、同一個理由】不擋的話飛機會直接穿過巡洋艦。
    // 零長度的 `ships` 讓沒有船的場景完全不付這個成本。
    if (this.ships.length > 0) {
      for (const c of this.combatants) {
        if (!c.alive) continue
        if (this.hitsShip(c)) this.destroy(c)
      }
    }
    for (const c of this.combatants) {
      if (!c.alive) continue
      this.fire(c, dt)
    }
    // 【砲塔在 fire 之後、彈丸推進之前】兩者都往同一個池子寫，順序固定
    // 才可重現。跳過死掉的 —— 槍焰的遞減已經在上面那個全 combatant 的
    // 迴圈裡做過了。
    for (const c of this.combatants) {
      if (!c.alive) continue
      stepTurrets(c, this.combatants, this.projectiles, this.time, dt, this.land, this.ships)
    }
    // 【船排在飛機砲塔之後、彈丸推進之前】三者都往同一個彈丸池寫，
    // 順序固定才可重現。
    stepShips(this.ships, dt)
    for (const s of this.ships) {
      // 砲位槍焰的遞減放在這裡而不是 stepShipGuns 裡面 —— 與飛機砲塔同一個
      // 理由：寫在「死掉就 continue」之後的話，被打掉那一瞬間亮著的槍焰會
      // 永遠停在那裡。
      for (const g of s.guns) {
        const v = g.flash - dt
        g.flash = v > 0 ? v : 0
      }
      stepShipGuns(s, this.combatants, this.projectiles, this.flak, this.time, dt)
    }
    // 【兩份緩衝】傷害吃 `stepBursts`（每步清空、World 自己排空），
    // 渲染讀 `burstEvents`（呼叫端排空）。共用一份的話，沒有排空的呼叫端
    // 會讓同一朵雲每步都再扣一次血。
    clearBursts(this.stepBursts)
    stepFlak(this.flak, dt, this.stepBursts)
    this.applyBursts()
    for (let k = 0; k < this.stepBursts.count; k++) {
      pushBurst(
        this.burstEvents,
        this.stepBursts.x[k]!, this.stepBursts.y[k]!, this.stepBursts.z[k]!,
        this.stepBursts.team[k]!,
      )
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
    // 【砲塔狀態跟著 spec 一起重配】與射速時鐘、槍焰計時器同一個理由，
    // 而且必須在同一個地方 —— 分開寫就是只有一份會被修好的那種危險。
    if (c.turretCooldowns.length !== spec.turrets.length) {
      c.turretCooldowns = new Float32Array(spec.turrets.length)
      c.turretStates = createTurretStates(spec, c.index)
    } else {
      c.turretCooldowns.fill(0)
      resetTurretStates(c.turretStates, spec, c.index)
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
          c.team === 'blue' ? 0 : 1, PROJECTILE_LIFETIME,
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
    // 【在迴圈外取出】4,000 發的迴圈裡每一發讀一次屬性是白付的
    const land = this.land
    const ships = this.ships

    for (let i = 0; i < p.capacity; i++) {
      const owner = p.owner[i]!
      if (owner === -1) continue
      const ax = p.sx[i]!, ay = p.sy[i]!, az = p.sz[i]!
      const bx = p.x[i]!, by = p.y[i]!, bz = p.z[i]!

      // 射手的陣營。同隊的彈丸直接穿過（spec §5.4）。
      //
      // 【為什麼讀 p.team 而不是從 owner 反查】船不是 combatant，反查不到
      // —— 同隊過濾會靜靜失效，船於是打自己人。飛機那一側 `World.fire` 與
      // `stepTurrets` 填的值與反查出來的完全相同，所以行為逐位元不變。
      const shooter = owner >= 0 && owner < combatants.length ? combatants[owner] : undefined
      const ownerTeam = p.team[i]!

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
      // ── 船 ──────────────────────────────────────────────
      //
      // 【為什麼排在飛機之後、陸地之前】同一個物理步之內「先擦過一架飛機、
      // 再撞上艦橋」是合法的，而彈丸一步走 3.7–4.5 m。順序用線段參數 t 比。
      //
      // 【兩條排除規則缺一不可】
      //   發射的那一艘：砲口就在砲位盒的中心，而 `segmentBox` 對「起點已在
      //   盒內」回傳 t = 0 —— 每一發直射彈會在出膛那一步打中自己。
      //   同隊的船：spec §12 明令不做船對船，而姊妹艦就在 800 m 外。
      let shipHit: Ship | null = null
      let shipGun = -1
      if (ships.length > 0) {
        const fromShip = ownerShipIndex(owner)
        for (let k = 0; k < ships.length; k++) {
          const sh = ships[k]!
          // 沉了的船不再擋子彈
          if (!sh.alive) continue
          if (k === fromShip) continue
          if ((sh.team === 'blue' ? 0 : 1) === ownerTeam) continue
          if (segmentPointDistanceSq(
            ax, ay, az, bx, by, bz, sh.position.x, sh.position.y, sh.position.z,
          ) > sh.cls.radius * sh.cls.radius) continue

          // 世界 → 艦體：平移再套用艏向的逆旋轉。與 `hitAircraft` 同一招，
          // 但船只有 yaw，所以直接用四元數共軛即可。
          SHIP_INV.copy(sh.orientation).conjugate()
          const a = S.v[0]!.set(ax, ay, az).sub(sh.position).applyQuaternion(SHIP_INV)
          const b = S.v[1]!.set(bx, by, bz).sub(sh.position).applyQuaternion(SHIP_INV)

          // 【砲位優先於船體，不比 t】砲位盒**整個包在船體盒裡面** ——
          // 砲架就長在甲板與上層建築上，而船體盒是 2–3 個粗體積。照 t 比的話
          // 從上方來的子彈永遠先碰到船體那一面，**砲位一輩子打不掉**，
          // 而且沒有任何錯誤。實測過：三條斷言同時紅，第四條假綠。
          //
          // 露在外面的是砲，所以打到砲就算打到砲。
          for (let gi = 0; gi < sh.guns.length; gi++) {
            const g = sh.guns[gi]!
            // 【死掉的砲位不參與判定】負責人裁定：打掉的砲位是一個洞，
            // 不是還會擋子彈的殘骸。
            if (!g.alive) continue
            const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, g.box)
            if (t === NO_HIT || t >= bestT) continue
            bestT = t
            victim = null
            shipHit = sh
            shipGun = gi
          }
          if (shipGun >= 0) continue

          for (const box of sh.cls.hull) {
            const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box)
            if (t === NO_HIT || t >= bestT) continue
            bestT = t
            victim = null
            shipHit = sh
            shipGun = -1
          }
        }
      }
      if (shipHit !== null) {
        // 【火花與打到飛機同一組】`hitEvents` 的消費者是 `sparks.emit`。
        // **不推 `damageEvents`** —— 那一條要一個 combatant 索引，船不是飛機。
        pushImpact(
          this.hitEvents,
          ax + (bx - ax) * bestT, ay + (by - ay) * bestT, az + (bz - az) * bestT,
          -(bx - ax), -(by - ay), -(bz - az),
        )
        const dmg = p.damage[i]!
        // 【不套 PART_MULTIPLIER】那是飛機的六個部位，船沒有座艙也沒有機翼。
        // 裝甲差異由砲位與船體各自的血量表達，不由倍率表達。
        shipHit.hp -= dmg
        if (shipGun >= 0) {
          const g = shipHit.guns[shipGun]!
          g.hp -= dmg
          if (g.hp <= 0) g.alive = false
        }
        // 【擊沉】血量歸零就整艘退場：砲位全滅、停船、不再擋子彈、
        // 不再是任何人的目標。**砲位一起標死**，否則渲染層還會畫它們的
        // 槍焰，而 `stepShipGuns` 已經整艘早退了 —— 那會是一排永遠亮著的
        // 槍焰掛在沉船上。
        if (shipHit.alive && shipHit.hp <= 0) {
          shipHit.alive = false
          for (const g of shipHit.guns) g.alive = false
        }
        p.kill(i)
        continue
      }

      // ── 陸地 ────────────────────────────────────────────
      //
      // 【為什麼排在飛機之後而不是迴圈開頭】同一個物理步之內「先打中飛機、
      // 後進入地面」是合法命中。飛機真的會貼著坡面飛（甲板實測量到過離地
      // 6 m），而彈丸一步走 3.7~4.5 m —— 在迴圈開頭無條件 `continue` 會把
      // 那個命中吃掉。所以要算出交點參數再跟 `bestT` 比先後。
      //
      // 【火花與打到飛機同一組】`hitEvents` 的消費者是 `sparks.emit`，
      // 傷害走的是 `damageEvents` —— 所以推一筆進去就是「跟打到飛機一樣的
      // 火花」，渲染層一行都不用改。**不推 `damageEvents`**：那一條要一個
      // `victim.index`，山不是一架飛機。
      if (land !== null) {
        const landT = landHitT(ax, ay, az, bx, by, bz, land)
        if (landT < bestT) {
          const hx = ax + (bx - ax) * landT
          const hy = ay + (by - ay) * landT
          const hz = az + (bz - az) * landT
          normalAt(land.field, hx, hz, LAND_N)
          pushImpact(this.hitEvents, hx, hy, hz, LAND_N.nx, LAND_N.ny, LAND_N.nz)
          p.kill(i)
          continue
        }
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

      // 【方向取彈丸速度的反向，不是射手的位置】887 m/s 飛 500 m 要 0.56 秒
      // —— 指射手**現在**的位置，指的是一個玩家沒看到過的東西；而射手可能
      // 已經死了。「子彈從那裡來」正是玩家在畫面上看到的曳光彈方向
      // （受擊方向指示器 spec §3.2）。
      const vx = p.vx[i]!, vy = p.vy[i]!, vz = p.vz[i]!
      const vs = Math.hypot(vx, vy, vz)
      // 靜止的彈丸不存在，但除以 0 會把 NaN 一路餵進 HUD —— 擋在源頭
      if (vs > 1e-6) {
        pushDamage(this.damageEvents, victim.index, -vx / vs, -vy / vs, -vz / vs)
      }

      // 【命中即回收】不回收的話同一發會在後續每一步繼續扣血，而且池子
      // 會被打進機身的彈丸塞滿。
      this.applyDamage(victim, p.damage[i]!, part, shooter)
      p.kill(i)
    }
  }

  /**
   * 這一步的高砲引爆造成的傷害。
   *
   * 【為什麼掃重心而不是命中盒】破片是球形擴散的，50 m 的殺傷半徑遠大於
   * 一架飛機（P-51D 的包圍球是 7.1 m）。用命中盒等於假裝破片是一條線。
   *
   * 【走 `fuselage`】高砲破片不挑部位，而座艙的 ×2.5 用在這裡會讓傷害
   * 隨機到無法調校。**注意實扣的血仍然會除以機種的 `protection.fuselage`。**
   */
  private applyBursts(): void {
    const e = this.stepBursts
    if (e.count === 0) return
    for (let k = 0; k < e.count; k++) {
      const team = e.team[k]!
      const x = e.x[k]!, y = e.y[k]!, z = e.z[k]!
      for (const c of this.combatants) {
        if (!c.alive) continue
        if ((c.team === 'blue' ? 0 : 1) === team) continue
        const pos = c.aircraft.state.position
        const d = Math.hypot(pos.x - x, pos.y - y, pos.z - z)
        const dmg = flakDamage(d)
        if (dmg > 0) this.applyDamage(c, dmg, 'fuselage')
      }
    }
  }

  /**
   * 這一架碰到船了嗎。
   *
   * 【不能用重心】低空進場一定有人擦著艦體過去。用重心的話機翼會穿過上層
   * 建築而沒事 —— 所以用飛機的命中盒（機體 AABB ＋ 姿態 ＝ OBB）對船體盒
   * 做分離軸測試。
   *
   * 【先比包圍球】只有真的貼近的那一架才付 15 條軸的錢。
   */
  private hitsShip(c: Combatant): boolean {
    const pos = c.aircraft.state.position
    const q = c.aircraft.state.orientation
    for (const sh of this.ships) {
      if (!sh.alive) continue
      const reach = c.hitRadius + sh.cls.radius
      if (pos.distanceToSquared(sh.position) > reach * reach) continue
      for (const box of sh.cls.hull) {
        // 船體盒的中心要轉到世界：船有艏向
        HULL_C.copy(box.center).applyQuaternion(sh.orientation).add(sh.position)
        for (const hb of c.aircraft.spec.hitBoxes) {
          BODY_C.copy(hb.center).applyQuaternion(q).add(pos)
          if (obbOverlap(BODY_C, hb.half, q, HULL_C, box.half, sh.orientation)) return true
        }
      }
    }
    return false
  }

  /** 扣血並在必要時重生。倍率在這裡套用，測試可以直接呼叫。 */
  applyDamage(victim: Combatant, damage: number, part: HitPart, shooter?: Combatant): void {
    // 退場的飛機打不中——這一條也讓「死人身上還在扣血」不可能發生
    if (!victim.alive) return

    // 【除以防護力】1.0 是基準；IEEE754 下除以 1.0 是精確的，所以全填 1.0
    // 時行為逐位元不變 —— 接線這一步就是這樣驗的
    // 【`!` 是安全的】`protection` 的型別是 Record<HitPart, number>，六個
    // 部位都必填；`noUncheckedIndexedAccess` 對 Record 一律加上 undefined
    victim.hp -= damage * PART_MULTIPLIER[part] / victim.aircraft.spec.protection[part]!
    if (shooter) {
      shooter.hitsDealt++
      this.damageTime[shooter.index * this.damageStride + victim.index] = this.time
    }
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
    // 【砲塔也要清】不清的話重生後會從上一條命的指向、目標與點放相位接著
    // 跑。就地重設，不配置 —— respawn 可能在物理步之內被呼叫。
    c.turretCooldowns.fill(0)
    resetTurretStates(c.turretStates, c.aircraft.spec, c.index)
    c.hitsDealt = 0
    c.alive = true
    // 【上一條命的傷害紀錄要作廢】不清的話，重生後的第一次擊墜會把上一條
    // 命的攻擊者算進助攻（M9 spec §5.2）
    const n = this.damageStride
    for (let a = 0; a < n; a++) this.damageTime[a * n + c.index] = -Infinity
  }

  /** 整張傷害時刻表歸位。整場重開時用。 */
  clearDamageLog(): void {
    this.damageTime.fill(-Infinity)
  }
}
