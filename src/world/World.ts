import { stepFixedGuns } from './fixedGuns'
import type { Combatant } from './combatant'
import { teamSlot, type Team } from './team'
import { Vector3 } from 'three'
import { createTorpedoContacts } from './torpedoContacts'
import {
  boundingRadius, createHitResult,
  partDamage, type HitPart,
} from './hit'
import { Projectiles } from './Projectiles'
import { createImpacts, pushImpact, type ImpactEvents } from './events'
import {
  BOMB_TERMINAL_SPEED, TORPEDO_SPREAD_RAD,
  Bombs, bombDragK, dropDrift, spreadDirection, spreadPair,
  type BombImpactFn, type BombState,
} from './bomb'
import { createBombObstacleQuery } from './bombObstacles'
import { applyBombBlast } from './bombBlast'
import { popIfDead } from './targetDeaths'
import { ProjectileHits } from './projectileHits'
import {
  createBombBay, resetBombBay, stepBombBay,
} from '../weapons/bomb'
import { loadoutOf, type Loadout } from '../weapons/stores'
import { canRelease, envelopeFor } from '../weapons/releaseEnvelope'
import { attitudeFromOrientation } from '../core/attitude'
import { Torpedoes } from './torpedo'
import { createKills, pushKill, type KillEvents } from './kills'
import { createDamageEvents, type DamageEvents } from './damage'
import type { LandField } from './occlusion'
import { createTurretStates, resetTurretStates, stepTurrets } from './turrets'
import { stepShips, type Ship } from './ships'
import {
  BALLOON_ENVELOPE_HIT, BALLOON_MISS, balloonCollision,
  stepBalloons,
  type Balloon,
} from './balloons'
import { stepScriptedKill, type GroundTarget } from './groundTargets'
import { stepGroundMotion } from './groundMotion'
import { stepGroundTaxi } from './groundTakeoff'
import { stepTakeoff } from '../control/takeoffRoll'
import { createFlares, stepFlares } from './flares'
import { stepGunPlatform } from './shipGuns'
import {
  burstDamageTo, createBursts, createFlak, clearBursts, pushBurst, stepFlak, FLAK_CAPACITY,
} from './flak'
import { obbOverlap } from './obb'
import { createCommand, type Controller } from '../control/Controller'
import type { Aircraft } from '../aircraft/Aircraft'
import type { AircraftSpec } from '../specs/types'

export type { Combatant } from './combatant'
export type { Team } from './team'
export { teamSlot } from './team'
export { FLASH_SECONDS } from '../weapons/muzzleFlash'

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

/** 投放偏移與推力的暫存。模組級 —— 熱路徑不得配置 */
const BOMB_PAIR = { u: 0, v: 0 }
const BOMB_VEL: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const DRIFT = { x: 0, z: 0 }
const RELEASE_ATTITUDE = { pitch: 0, roll: 0 }
/**
 * 投雷時的機首水平方向。**熱路徑不得配置**，所以是模組層級的一格。
 *
 * 與 `fixedGuns.ts` 的暫存分開，避免投放與槍口運算共用中間結果。
 */
const NOSE_H = /* @__PURE__ */ new Vector3()
/** 飛機撞船時，船體命中盒的世界中心。 */
const HULL_C = /* @__PURE__ */ new Vector3()
/** 飛機命中盒的世界中心，撞船時與 HULL_C 同時使用。 */
const BODY_C = /* @__PURE__ */ new Vector3()


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
  readonly bombs = new Bombs()
  readonly torpedoes = new Torpedoes()

  /**
   * 該點的**判定用**地面高度，m。海面是平的（0），陸地讀高度場。
   *
   * 【為什麼是注入的而不是自己讀 `this.land.field`】自己讀就要自己寫一次
   * 「海面是平的」，而那條規則的權威在 `render/terrain.ts` 的
   * `collisionHeightAt`。抄一份就是第二份真相。
   * 與 `crashPolicy` 同一個注入方式。
   */
  groundAt: (x: number, z: number) => number = () => 0

  /**
   * 該點的**水面**高度，m。沒有水的地方回 `-Infinity`（`terrain.waterAt`）。
   *
   * 【為什麼要第二支而不是用 `groundAt` 判斷】`groundAt` 回的是「陸地與平海
   * 取 max」，答不出「這裡碰到的是水嗎」。少了這一支，炸彈落在島上會噴水柱
   * —— `render/debris.ts` 已經為同一個坑留過註解（「只有落水才噴濺」），
   * 而純內陸地圖上那是**每一顆**都會發生。
   */
  waterAt: (x: number, z: number) => number = () => 0

  /**
   * 炸彈的阻力係數。與 `groundAt` 一樣由外面決定 —— `World` 不持有設計值。
   */
  bombDrag = bombDragK(BOMB_TERMINAL_SPEED)

  /**
   * 這一場的船。**船不是 `Combatant`** —— 它沒有飛行模型、不進記分板、
   * 不上 HUD 的接觸列表（見 spec §2）。空陣列 = 這一場沒有船，而三段推進
   * 都是零長度早退，所以既有的空戰逐位元不變。
   */
  readonly ships: Ship[] = []

  /**
   * 這一場的地面目標（戰車、卡車、砲位、火車、油廠的構件）。**與船同一個
   * 性質**：不是 `Combatant`、不動、死了是旗標。空陣列 = 這一場沒有，
   * 三條判定都零長度早退，既有的關逐位元不變。
   */
  readonly groundTargets: GroundTarget[] = []

  /**
   * 這一個物理步之內被摧毀的地面目標。**呼叫端負責排空**（與 `hitEvents`
   * 同一個約定）—— 渲染層讀它在那個位置點一團火。
   *
   * 借 `ImpactEvents`：x, y, z 是位置，nx 是目標索引，ny 是兇手的 combatant
   * 索引（−1 = 無主），nz 是「爆風打的」旗標（1 = 是）。與 `bombEvents`
   * 借第六格同一個手法。
   *
   * 【兇手與爆風旗標一定要分成兩格】合成一格（用 −1 兼表「炸彈」）的話，
   * 玩家投的彈會同時是「有兇手」與「是炸彈」—— 而渲染層靠後者決定放不放
   * 第二團火，症狀是同一個地方爆兩次、鏡頭震兩次，不會報錯。
   *
   * 【與落點事件分開】每一顆炸彈恰好一筆落點；目標由活變死的那一步另推
   * 這一筆，只推一次。合在一起的話直擊剛好炸毀時同一個爆點推兩次。
   */
  readonly groundKillEvents: ImpactEvents = createImpacts()

  /**
   * 這一步離地、交給空中那一池的席位索引（`stepGroundTaxi`）。**讀的人清空**
   * （`battle/setup.ts` 同步飛行員名冊）。
   */
  readonly liftoffs: number[] = []

  /**
   * 沉沒事件。**一艘船一筆**，由活變死的那一步推。
   *
   * 借 `ImpactEvents`：x, y, z 是位置，nx 是 `Ship.index`，ny 是兇手的
   * combatant 索引（−1 = 無主），nz 恆 0 —— 與 `groundKillEvents` 逐格相同。
   *
   * 【為什麼需要事件】船的死活渲染層自己看得到（`sh.alive`），但**誰打沉的**
   * 只有這一步知道：血量歸零的那一發是子彈、炸彈還是魚雷，三條路各自把
   * 兇手帶到這裡。
   */
  readonly shipKillEvents: ImpactEvents = createImpacts()

  /**
   * 這一場的防空氣球（`world/balloons.ts`）。**與地面目標同一個性質**：不是
   * `Combatant`、不動、死了是旗標。空陣列 = 這一場沒有，撞擊與彈丸兩條判定
   * 都零長度早退，既有的關逐位元不變。
   */
  readonly balloons: Balloon[] = []

  /**
   * 氣球破掉的事件。**一顆一筆**，由活變死的那一步推；呼叫端負責排空。
   *
   * 借 `ImpactEvents`：x, y, z 是氣囊中心，nx 是 `Balloon.index`，ny 是兇手的
   * combatant 索引（−1 = 無主，含撞上去的那一架），nz 恆 0。
   */
  readonly balloonKillEvents: ImpactEvents = createImpacts()

  /**
   * 雷擊命中事件。**只有魚雷推** —— 子彈與炸彈打中船不推。
   *
   * 借 `ImpactEvents`：格式與 `shipKillEvents` 逐格相同。
   *
   * 【為什麼只有魚雷值得一則通報】雷擊要壓到三十公尺、對齊艦身、算提前量，
   * 打得中本身就是戰果；而機槍掃在艦體上是常態。
   */
  readonly shipHitEvents: ImpactEvents = createImpacts()

  /** 空中的高砲彈。它不進彈丸池 —— 飛行途中不做命中判定。 */
  readonly flak = createFlak()

  /** 照明彈。沒有判定讀它，但它在物理步裡推進 —— 見 `flares.ts` */
  readonly flares = createFlares()

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
   * 這一場依機種複寫的掛載，鍵是 `spec.id`。**進場（`add`）與換機種（`setSpec`）
   * 都讀它**，沒列到的照預設表（`loadoutOf`）。
   *
   * 【為什麼存在 World 而不是開場套一次】增援與整隊重生都走 `add`／`setSpec`，
   * 只在開場套的話，重生的那一架靜靜地換回預設掛載。
   */
  loadoutOverrides: Readonly<Record<string, Loadout>> = {}

  /** 這一架該掛什麼：先看這一場的複寫，再看預設表 */
  private loadoutFor(specId: string): Loadout | null {
    return this.loadoutOverrides[specId] ?? loadoutOf(specId)
  }

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
   * 【它的語意是「彈丸撞到東西」，不是「彈丸打中飛機」】船、地面目標、氣球
   * 也推一筆（火花與打到飛機同一組）。`multi-battle` 拿它的 `count` 當命中數
   * —— 那一支沒有船與地面目標，所以仍然成立，但下一個想這樣用的人要知道。
   * 打到地形走 `terrainHitEvents`。傷害仍然只走 `damageEvents`。
   */
  readonly hitEvents: ImpactEvents = createImpacts()

  /**
   * 子彈打到地形：x, y, z, 地表法線。消費者是土柱（`render/dirtImpact.ts`）。
   *
   * 【為什麼不共用 `hitEvents`】那一條的消費者是火花，而打進地面要噴的是土。
   * 沒有欄位分得出來的話，渲染層就得自己再查一次地形。
   *
   * **呼叫端負責排空**（與 `hitEvents` 同一個理由）。
   */
  readonly terrainHitEvents: ImpactEvents = createImpacts()

  /**
   * 子彈打在**飛機以外**的東西上：x, y, z, 材質（`ImpactMaterial`）, 0, 0。
   * 法線那三格不用 —— 音效只要位置。
   *
   * 【為什麼不共用 `hitEvents`】那一條同時收飛機、船、地面目標與氣球，而飛機
   * 那些已經有自己的聲音（`hitSelf`／`hitDealt`）。沒有欄位分得出來，整批播就
   * 會與飛機那一套重複一次。
   *
   * **呼叫端負責排空**（與 `hitEvents` 同一個理由）。
   */
  readonly materialHits: ImpactEvents = createImpacts()

  /**
   * 這一個物理步之內的入海事件。法線恆為 `(0, 1, 0)` —— 水柱就是「法線
   * 朝上的撞擊」，所以與命中共用同一個型別（M7 spec §2.2）。
   *
   * 與 `hitEvents` 一樣由**呼叫端**排空。
   */
  readonly splashEvents: ImpactEvents = createImpacts()
  /**
   * 炸彈落地／落水。**`World` 只推事件，表現由 `main.ts` 決定** —— 與火花、
   * 黑雲同一個約定。`nx` 是「這裡是不是水」的旗標，見 `onBombImpact`。
   */
  readonly bombEvents: ImpactEvents = createImpacts()
  /** 命中目標由查詢留存，緊接著的 onBombImpact 用來標記落點事件。 */
  private readonly bombObstacles = createBombObstacleQuery(this.ships, this.groundTargets)

  /**
   * 魚雷引爆。`nx` 是 0 撞岸／1 撞船，`ny` 是這一枚的傷害。
   *
   * 【射程用盡不推事件】跑完自沉，爆了的話玩家會以為打中了什麼。
   */
  readonly torpedoEvents: ImpactEvents = createImpacts()
  /**
   * 魚雷的入水點與航跡。**同一個管道** —— 兩者的表現都是水面上的一叢
   * 水花，只有規模不同（`main.ts` 決定）。與 `hitEvents` 一樣由呼叫端排空。
   */
  readonly torpedoWakeEvents: ImpactEvents = createImpacts()
  /** 魚雷碰撞查詢與事件回呼只在建構時建立。 */
  private readonly torpedoContacts = createTorpedoContacts(this)

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
  private readonly projectileHits = new ProjectileHits()

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
      loadout: this.loadoutFor(aircraft.spec.id),
      bombBay: createBombBay(this.loadoutFor(aircraft.spec.id)),
      muzzleFlash: new Float32Array(aircraft.spec.battery.mounts.length),
      turretStates: createTurretStates(aircraft.spec, this.combatants.length),
      turretCooldowns: new Float32Array(aircraft.spec.turrets.length),
      hp: aircraft.spec.hp,
      hitRadius: boundingRadius(aircraft.spec.hitBoxes),
      team,
      alive: true,
      hitsDealt: 0,
      respawnOnDestroy: false,
      takeoff: null,
      retired: false,
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
    this.projectileHits.ensure(n)
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
      // 【滾行中不開火、不投彈】指令停在這兩格為假，控制器交還之後才接手
      if (c.takeoff !== null) {
        c.command.firing = false
        c.command.bombing = false
        continue
      }
      c.controller.update(c.aircraft, dt, c.command)
    }

    // 2. 全部 Aircraft 推進，接著開火（槍口用推進後的姿態）
    for (const c of this.combatants) {
      if (!c.alive) continue
      if (c.takeoff !== null) {
        const a = c.aircraft
        a.prevPosition.copy(a.state.position)
        a.prevOrientation.copy(a.state.orientation)
        if (!stepTakeoff(c.takeoff, a.state, dt)) c.takeoff = null
        continue
      }
      c.aircraft.update(
        c.command.aimWorld, c.command.throttle, dt, c.command.brake, c.command.upright,
        c.command.trackTurn, c.command.pull,
      )
    }
    // 【撞地要在開火之前判】撞地的那一步不該還打得出子彈。
    for (const c of this.combatants) {
      if (!c.alive) continue
      // 【滾行中不判撞地】機體原點在跑道面上方 1.5 m，低於撞地的離地餘裕
      if (c.takeoff !== null) continue
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
    // 【撞氣球同一個位置】鋼索與氣囊都擋飛機；撞上氣囊的話氣球也破。
    // 先把氣球擺到這一刻的飄晃位置 —— 碰撞與彈丸讀的都是它
    if (this.balloons.length > 0) {
      stepBalloons(this.balloons, this.time)
      for (const c of this.combatants) {
        if (!c.alive) continue
        const a = c.aircraft
        for (const b of this.balloons) {
          const hit = balloonCollision(
            b, a.spec.hitBoxes, a.state.position, a.state.orientation, c.hitRadius, this.hit,
          )
          if (hit === BALLOON_MISS) continue
          this.destroy(c)
          if (hit === BALLOON_ENVELOPE_HIT) {
            b.hp = 0
            popIfDead(b, -1, this.balloonKillEvents)
          }
          break
        }
      }
    }
    for (const c of this.combatants) {
      if (!c.alive) continue
      stepFixedGuns(c, this.projectiles, dt)
      this.releaseBombs(c, dt)
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
      // 【傳整個艦隊】目標分攤數的是全艦隊的鎖定，不是這一艘的
      stepGunPlatform(s, this.combatants, this.projectiles, this.flak, this.time, dt, this.ships)
    }
    // 【車先動、砲後打】防空車的槍口由這一步的位置算。`this.time` 在 `step`
    // 開頭已經加上 dt，所以這裡是這一步結束時的時間
    for (const t of this.groundTargets) {
      stepGroundMotion(t, this.time, this.groundAt)
      if (t.taxi !== null) stepGroundTaxi(t, dt, this.combatants, this.liftoffs)
      stepScriptedKill(t, this.time, this.groundKillEvents)
    }
    // 【陸上的高砲位走同一支】掛了砲的地面目標（洛伊納那八個）就是一座砲台。
    // **傳整組地面目標當「艦隊」** —— 目標分攤要跨全部砲位數，各自只數自己
    // 的話八門砲會一起咬同一架
    for (const t of this.groundTargets) {
      if (t.guns.length === 0) continue
      for (const g of t.guns) {
        const v = g.flash - dt
        g.flash = v > 0 ? v : 0
      }
      stepGunPlatform(
        t, this.combatants, this.projectiles, this.flak, this.time, dt, this.groundTargets,
      )
    }
    // 【兩份緩衝】傷害吃 `stepBursts`（每步清空、World 自己排空），
    // 渲染讀 `burstEvents`（呼叫端排空）。共用一份的話，沒有排空的呼叫端
    // 會讓同一朵雲每步都再扣一次血。
    clearBursts(this.stepBursts)
    stepFlak(this.flak, dt, this.stepBursts)
    // 池空時十六格全部早退，既有的關逐位元不變
    stepFlares(this.flares, dt, this.groundAt)
    this.applyBursts()
    for (let k = 0; k < this.stepBursts.count; k++) {
      // 【四個尺度一定要一起抄】漏掉的話 `pushBurst` 會補上 5 吋艦砲的預設
      // 值，於是陸砲的雲、閃光與震動全部照艦砲畫 —— 而且不報錯
      pushBurst(
        this.burstEvents,
        this.stepBursts.x[k]!, this.stepBursts.y[k]!, this.stepBursts.z[k]!,
        this.stepBursts.team[k]!,
        this.stepBursts.radius[k]!, this.stepBursts.damage[k]!,
        this.stepBursts.smoke[k]!, this.stepBursts.blast[k]!, this.stepBursts.shake[k]!,
      )
    }

    // 3. 彈丸推進
    this.projectiles.step(dt)

    // 3.5 炸彈推進
    //
    // 【與彈丸分開】那個池是等速直線、無阻力、無重力（spec §2），
    // 壽命上限 1.2 s；炸彈要重力、要阻力、要飛 48 秒。
    // 【兩份清單都空才不傳擋路回呼】只看船的話，沒有船的一關煙囪永遠擋
    // 不到炸彈 —— 回呼根本沒被傳進去，而症狀是炸彈穿過建築在地上爆
    this.bombs.step(
      dt, this.bombDrag, this.groundAt, this.onBombImpact,
      this.ships.length > 0 || this.groundTargets.length > 0 ? this.bombObstacles.block : undefined,
    )

    // 3.6 魚雷推進
    //
    // 【空中段與炸彈同一支積分】所以瞄具解的落點與入水點走的是同一條彈道。
    // 實際投放另外套一層散佈（見 `dropTorpedo`），瞄具畫的是**散佈前的
    // 中心** —— 與炸彈一樣。水中段是定深等速直線，只由航程回收。
    this.torpedoes.step(
      dt, this.bombDrag, this.groundAt, this.waterAt,
      this.torpedoContacts.end, this.torpedoContacts.entry, this.torpedoContacts.wake,
      this.ships.length > 0 ? this.torpedoContacts.block : undefined,
    )

    // 4. 命中判定
    this.resolveHits()
  }

  /**
   * 炸彈落地。**綁在實例上建一次，不在 `step` 裡寫成箭頭函數** —— 那樣會
   * 每個物理步配置一個閉包（240 Hz × 每場），而這一層的紀律是熱路徑零配置。
   */
  private readonly onBombImpact: BombImpactFn = (
    x, y, z, _speed, blocked, damage, owner,
  ) => {
    // 【`nx` 是落點的種類】0 = 陸、1 = 水、2 = 船、3 = 建築。四者是四套
    // 不同的表現（土／水冠／火／火加碎片），而判斷所需的 `waterAt`、
    // `ships` 與 `groundTargets` 只有這一層有。法線那三格對炸彈沒有意義
    // —— 恆是 (0,1,0) —— 所以借第一格。
    applyBombBlast(this, x, y, z, damage, owner)
    // 【`ny` 帶爆心傷害】表現的規模由它推導（`blastScaleOf`），而
    // `ImpactEvents` 的法線那三格對炸彈沒有意義 —— `nx` 已經借去當種類
    const hitShip = blocked && this.bombObstacles.ship !== null
    const hitGround = blocked && this.bombObstacles.ground !== null
    const kind = hitShip ? 2 : hitGround ? 3 : this.waterAt(x, z) > -Infinity ? 1 : 0
    // 【`nz` 帶命中的那一艘或那一座，沒中是 −1】火災要長在船身上，而火點存
    // 的是**艦體座標**（船在動）—— 起火的那一層因此要知道是哪一艘。**讀這
    // 一格的人要先看 `nx`**：船與建築的索引是兩份清單。第六格對炸彈本來就
    // 恆是 0，是一格現成的空位
    const index = hitShip ? this.bombObstacles.ship!.index : hitGround ? this.bombObstacles.ground!.index : -1
    pushImpact(this.bombEvents, x, y, z, kind, damage, index)
  }


  /**
   * 投一枚魚雷。位置與速度都是**世界座標**。
   *
   * @param damage      這一枚的接觸傷害。由投放的那一台的掛載決定
   * @param headX/headZ 投放瞬間的機首**水平**方向，單位向量。只有垂直入水
   *                    那種退化情況用得到 —— **不能從退化的速度反推**
   * @param team        投放者的隊別，`teamSlot`。只有 HUD 標記讀它。
   *                    **沒有預設值** —— 漏傳會靜靜地把雷標成藍色
   * @param owner       投放者的 combatant 索引。**戰果歸屬讀它** —— 漏傳
   *                    的話雷擊命中與擊沉都不屬於任何人，而那不會報錯
   */
  dropTorpedo(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, damage: number,
    headX: number, headZ: number, team: number, owner = -1,
  ): void {
    // 【散佈的序號與炸彈同一組做法】由累計投放序號決定（可重播），不是亂數。
    // 瞄具解的是散佈**之前**的彈道，所以圈畫的是中心而不是這一枚的落點 ——
    // 把散佈也套進瞄具的話，散佈就變成免費的情報，等於沒有散佈。
    // 【幅度是魚雷自己的】見 `TORPEDO_SPREAD_RAD`
    spreadPair(this.torpedoes.dropped, BOMB_PAIR)
    spreadDirection(
      vx, vy, vz,
      BOMB_PAIR.u * TORPEDO_SPREAD_RAD, BOMB_PAIR.v * TORPEDO_SPREAD_RAD,
      BOMB_VEL,
    )
    // 【推力只偏入水點】空中段一直推著；入水後的航向照上面這個方向走（`Torpedoes.spawn`）
    dropDrift(this.torpedoes.dropped, DRIFT)
    this.torpedoes.spawn(
      x, y, z, BOMB_VEL.vx, BOMB_VEL.vy, BOMB_VEL.vz, damage, headX, headZ,
      team, owner, DRIFT.x, DRIFT.z,
    )
  }

  /**
   * 投一顆。位置與速度都是**世界座標**。
   *
   * 【方向帶 ±0.1° 的偏移】同一串投下去的彈不會落在一條數學直線上。偏移量
   * 由**累計投彈序號**決定（`spreadPair`）而不是 `Math.random()` —— 後者
   * 讓同一場重播不出同一個結果，而這個專案為「逐位元重播」寫過鐵律
   * （見 `resetBattle` 對 `world.time` 的說明）。
   *
   * @param damage 這一顆的爆心傷害。**由投彈的那一台的掛載決定**
   *               （`weapons/stores.ts`），整顆彈的規模都從它推導。
   */
  /**
   * @param team  投放者的隊別，`teamSlot`。只有 HUD 標記讀它。
   *              **沒有預設值** —— 漏傳會靜靜地把彈標成藍色
   * @param owner 投放者的 combatant 索引。**戰果歸屬讀它** —— 漏傳的話
   *              炸掉的東西不屬於任何人，而那不會報錯
   */
  dropBomb(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, damage: number, team: number,
    owner = -1,
  ): void {
    // 【下墜全程一個隨機方向的小推力】見 `DROP_DRIFT_ACCEL`。序號是累計投彈數（可重播）
    dropDrift(this.bombs.dropped, DRIFT)
    this.bombs.spawn(x, y, z, vx, vy, vz, damage, team, owner, DRIFT.x, DRIFT.z)
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
    // 【彈艙是第四個】與上面三個「換機種會變」的東西同一段 —— 分開寫就是
    // 只有一份會被修好的那種危險。換完立刻滿艙、取消回補計時。
    c.loadout = this.loadoutFor(spec.id)
    resetBombBay(c.bombBay, c.loadout)
    c.hp = spec.hp
    c.hitRadius = boundingRadius(spec.hitBoxes)
  }

  /**
   * 這一步正在投彈的那一架。**`releaseBombs` 寫、`dropOne` 讀。**
   *
   * 【為什麼是欄位而不是參數】`stepBombBay` 的 `drop` 是一個無參數的回呼，
   * 而熱路徑不得每步配置一個閉包。與 `onBombImpact` 同一個手法。
   */
  private bombing: Combatant | null = null

  /** `stepBombBay` 的投放回呼。綁在實例上建一次。 */
  private readonly dropOne = (): void => {
    const c = this.bombing
    if (c === null) return
    const p = c.aircraft.state.position
    const v = c.aircraft.state.velocity
    const damage = c.loadout?.damage ?? 0
    // 【從質心投，不是 `bombPoint`】那一格住在算繪層的 `AircraftModel`，
    // `World` 讀不到也不該讀 —— 而它是給玩家對準星用的，與質心差兩三公尺，
    // 落在 30 m 量級的殺傷半徑的雜訊裡。
    const team = teamSlot(c.team)
    if (c.loadout?.kind === 'torpedo') {
      // 【機首的水平方向要一起送】垂直入水那種退化情況沿用它，而那件事
      // **不能從退化的速度反推**（同 `main.ts` 的玩家路徑）
      const n = NOSE_H.set(0, 0, -1).applyQuaternion(c.aircraft.state.orientation)
      n.y = 0
      if (n.lengthSq() < 1e-12) n.set(0, 0, -1)
      else n.normalize()
      this.dropTorpedo(p.x, p.y, p.z, v.x, v.y, v.z, damage, n.x, n.z, team, c.index)
      return
    }
    this.dropBomb(p.x, p.y, p.z, v.x, v.y, v.z, damage, team, c.index)
  }

  /**
   * 每一架的投彈，玩家與 AI 同一條路：扣扳機是控制器寫的 `command.bombing`，
   * 彈艙的推進與投放**只在這裡**。別處再推進同一個彈艙的話回補與連投
   * 間隔會快一倍。
   *
   * 【為什麼不是 `World` 認出玩家】這一層不知道誰是玩家（見 `damageEvents`
   * 的說明），也不該知道。差別做在控制器那一端。
   *
   * 【空艙的機種不必另外擋】容量 0 時 `stepBombBay` 的 `load > 0` 不成立，
   * 而回補又補回 0 —— 結構上投不出東西。
   *
   * 熱路徑，不配置。
   */
  private releaseBombs(c: Combatant, dt: number): void {
    // 【炸彈與魚雷都走這裡】差別收在 `dropOne` 的分流與包絡上；航路那一層
    // 由 `AiController.strikeProfile` 換剖面（`ai/torpedoRun.ts`）。
    if (c.hp <= 0 || c.loadout === null || c.bombBay.capacity === 0) return
    // 【投放包絡對 AI 一樣成立】玩家的準星顏色與 AI 的投放門檻是同一條
    // （`main.ts` 的 `releaseOk`）—— 兩邊分家的話會出現「AI 投得出玩家投不
    // 出的彈」。
    const a = c.aircraft
    const att = attitudeFromOrientation(a.state.orientation, RELEASE_ATTITUDE)
    const agl = a.state.position.y - this.groundAt(a.state.position.x, a.state.position.z)
    // 【控制器自己的高度下限】包絡沒有高度下限；AI 帶著 `AI_RELEASE_FLOOR`，排好的連投
    // 在那之下暫停（`Command.releaseFloor`）
    const ok = agl >= c.command.releaseFloor && canRelease(
      envelopeFor(c.loadout.kind), att.roll, att.pitch, agl, a.diag.aero.tas,
    )
    this.bombing = c
    stepBombBay(c.bombBay, dt, c.command.bombing, ok, this.dropOne)
    this.bombing = null
  }

  /** 結算目前彈丸；保留入口供命中等價測試與物理步共同使用。 */
  resolveHits(): void {
    this.projectileHits.resolve(this)
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
      for (const c of this.combatants) {
        if (!c.alive) continue
        const pos = c.aircraft.state.position
        // 半徑與傷害讀那一發自己的（艦砲與陸砲不同強度）；同隊不傷
        const dmg = burstDamageTo(e, k, c.team === 'blue' ? 0 : 1, pos.x, pos.y, pos.z)
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
    victim.hp -= partDamage(victim.aircraft.spec.protection, damage, part)
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
   * 一份會被修好的那種危險 —— 與 `isCrashed` 抽出來是同一個理由。
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
    // 【彈艙也要清】「再打一場」不重建 World 而是逐架 respawn。不清的話
    // 上一局的空艙、待投佇列與回補倒數會直接帶進下一局。
    // 【用 `c.loadout` 不重查 spec】任務卡覆寫過的掛載必須留得住
    resetBombBay(c.bombBay, c.loadout)
    c.hitsDealt = 0
    c.alive = true
    // 【重生在空中】上一條命還在滾行的話，不解開座標鎖它會被拉回跑道
    c.takeoff = null
    c.retired = false
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
