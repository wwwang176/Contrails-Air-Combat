import { Euler, Quaternion, Vector3, type Object3D } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { DEG } from './core/math'
import { createScene } from './render/scene'
import { applyTimeOfDay } from './render/timeOfDay'
import { flatSeaCrashPolicy } from './world/seaCrash'
import { arenaKills, createArenaState, stepArena } from './world/arena'
import { createTerrain } from './render/terrain'
import { createObjectiveRing } from './render/objectiveRing'
import { timeScale } from './battle/mission'
import { createTracers } from './render/tracers'
import { createMuzzles, createTurretMuzzles } from './render/muzzle'
import { createTurretBarrels } from './render/turretBarrels'
import { createSparks } from './render/sparks'
import { createSplashes } from './render/splash'
import { TextureLoader } from 'three'
import { createBombs, createTorpedoes } from './render/bombs'
import { createFireChunks } from './render/chunks'
import { JET_RISE, createWaterJets } from './render/waterJets'
import {
  AIR_BLAST, BLAST_PACE, FIRE_BLAST, LAND_BLAST, TORPEDO_BLAST, WATER_BLAST,
  createBlastSmoke, createDust, createEmberSmoke, createFireGlow, createWaterMist,
  emitBlast, emitEmber, emitFlakBlasts, emitMist, resetFlakBlastSeed, scaleBlast,
  type BlastParams, type BlastPools,
} from './render/blast'
import { createFireball, FIREBALL_COUNT, FIREBALL_SPEED } from './render/fireball'
import { createFlakBursts, emitFlakBursts, resetFlakBurstSeed } from './render/flakBursts'
import {
  createShipModels, preloadShipModels, shipModelTop, type ShipModels,
} from './render/ships'
import { createGroundModels, type GroundModels } from './render/groundTargets'
import { preloadGroundModels } from './render/geometry/ground'
import { settleGroundTargets } from './world/groundTargets'
import { clearBursts } from './world/flak'
import {
  createShipFireSmoke, createSmoke, emitSmoke,
  DEBRIS_SMOKE_SIZE, SHIP_FIRE_PLUME_SPEED,
} from './render/smoke'
import {
  createShipFires, lightShipFires, stepShipFires, type FirePuffFn,
} from './render/shipFires'
import { createGroundFires, lightGroundFire, stepGroundFires } from './render/groundFires'
import { hash01 } from './render/scatter'
import {
  createSpray, emitSpray, DEBRIS_SPRAY_COUNT, WATER_COLOR, WRECK_SPRAY_COUNT,
} from './render/spray'
import { createVortex } from './render/vortex'
import { createOrderMarkers } from './render/orderMarkers'
import { BLAST_DEBRIS_COLOR, createDebris } from './render/debris'
import { createWrecks } from './render/wrecks'
import { bodyColorOf } from './render/geometry/buildAircraft'
import {
  IMPACT_STRIDE, clearImpacts, createImpacts, type ImpactEvents,
} from './world/events'
import { KILL_STRIDE, clearKills, type KillEvents } from './world/kills'
import { clearDamage, DAMAGE_STRIDE } from './world/damage'
import { buildAircraft, preloadAircraftModels, type AircraftModel } from './render/geometry/buildAircraft'
import { PROP_DISC_RENDER_ORDER } from './render/geometry/assembly'
import { SKY_RENDER_ORDER } from './render/sky'
import { Hud } from './hud/Hud'
import { createHudFrame, indicatedAirspeed, nextHitFlash, HUD_MAX_CONTACTS } from './hud/types'
import {
  fillMarkers, type MarkerPool, type MarkerProject, type ShipMarkerTop,
} from './hud/markerFeed'
import { attitudeFromOrientation, headingFromOrientation } from './hud/attitude-math'
import { createScoreboard, scoreRows, sortScoreRows, type AfterAction } from './ui/scoreboard'
import { shortName } from './ui/briefing'
import { resetGEffect } from './hud/widgets/gEffect'
import { runFrontCount } from './hud/widgets/torpedoLine'
import {
  TORPEDO_RUN_SAMPLES, runSampleDistance, torpedoEntersWater, torpedoHeading,
} from './world/torpedo'
import { pushDamageMark, resetDamageMarks, stepDamageMarks } from './hud/damageMarks'
import { CameraRig, DEFAULT_CAMERA_OPTIONS, thirdPersonFor } from './camera/CameraRig'
import { solveImpact, type BombState, type Impact } from './world/bomb'
import { blastScaleOf, resetBombBay, stepBombBay, type BombBay } from './weapons/bomb'
import {
  aglOk, canRelease, envelopeFor, pitchOk, rollOk,
} from './weapons/releaseEnvelope'
import { type Loadout, loadoutOf } from './weapons/stores'
import { BOMB_PROFILE } from './ai/bombRun'
import { TORPEDO_PROFILE } from './ai/torpedoRun'
import { WAKE_SPRAY_COUNT } from './render/spray'
import { createWakes } from './render/wake'
import {
  createGodCameraState, enterGodCamera, godCameraTarget, stepGodCamera,
  type GodCameraInput,
} from './camera/godCamera'
import { deathCamAim, enterDeathCam } from './camera/deathCam'
import { applyBlend, createCameraBlend, startBlend } from './camera/cameraBlend'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { slewAimWorld } from './input/aim'
import { teamSlot, type Combatant, type World } from './world/World'
import { solveLead, NO_INTERCEPT } from './world/lead'
import { PROJECTILE_LIFETIME } from './world/Projectiles'
import { PlayerController } from './control/PlayerController'
import { AiController } from './ai/AiController'
import { VETERAN } from './ai/profile'
import { HEAD_ON } from './battle/entry'
import { NEUTRAL_TUNING } from './battle/mission'
import { BF109K4 } from './specs/bf109k4'
import { P51D } from './specs/p51d'
import type { BattleConfig } from './battle/setup'
import { DEFAULT_DOCTRINE } from './ai/doctrine'
import { extendReason } from './ai/rules'
import type { FlightOrder } from './ai/command'
import {
  aliveCount, createBattle, playerFlight, resetBattle, stepBattle, type Battle,
} from './battle/setup'
import { flightOfCombatant, isFlightLeader } from './battle/flights'
import { lineAbreast, sideSummary } from './battle/order'
import { fillOrderView } from './battle/orderView'
import {
  battleConfigFrom, DEFAULT_SKIRMISH, MAX_COMBATANTS, type SkirmishSetup,
} from './battle/skirmish'
import { missionConfigFrom, type ReadyMissionCard } from './battle/missions'
import { createMenu } from './ui/menu'
import { nextScreen, type Screen } from './ui/screens'
import { menuCameraPose } from './app/menuCamera'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
const perf = createPerfOverlay(ctx.renderer)

/**
 * 目前的地形。**一律經過這個變數存取** —— 撞地判定、水柱、殘骸與零件
 * 入水都讀它的 `heightAt`。
 *
 * 【為什麼不能把 heightAt 抓進閉包快取】換地形之後那一處就還在讀舊的
 * 高度場，而症狀（飛機撞到看不見的海面）離成因非常遠（M10 spec §5.2）。
 */
/**
 * 目前地形的種類。**只有開場那一行日誌讀它** —— 但那一行是「同一場逐位元
 * 重跑」的鑰匙的一部分，而有波次的「重新開始」不重建地形卻要重印那一行。
 */
let terrainKind: Parameters<typeof createTerrain>[0] = 'archipelago'
let terrain = createTerrain(terrainKind)
/**
 * 撤離點的 3D 圓環。**生命週期比照 `terrain`：每一場都重建**（`enterBattle`）。
 *
 * 【沒有波次的「重新開始」不重建】那條路走 `resetBattle` 而不是 `startWorld`
 * （見 `restartBattle`）—— 那時 rules、撤離點、幾何與場景歸屬都沒有換，環
 * 必須留在場景裡而且下一幀照常更新。有波次的那條走 `startWorld`，比照換場。
 */
let objectiveRing = createObjectiveRing()
ctx.scene.add(terrain.object)

/**
 * 把地形接給每一架 AI，並清掉上一場的鎖存。
 *
 * 【為什麼是每幀掃一次，而不是在建立控制器的地方各接一次】接的地方不只
 * enterBattle：playerAi 跨場重用、resetBattle 在玩家接手過座位之後會建新的
 * AiController、重生也會。一一去接的話，漏掉哪一條路徑的症狀是「有一架
 * AI 看不見地形」—— 那要等到它撞山才會發現，而且看起來像 AI 有 bug。
 *
 * 【成本】40 次參考比較。只有在**不相等**時才寫入並清鎖存，所以換地形、
 * 新控制器、重生都會被接住，而穩定狀態下什麼都不做。
 */
function wireTerrain(force = false): void {
  for (const c of world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    // 【船跟著地形一起接】兩者的生命週期一模一樣：每一場重建、跨場重用的
    // 控制器要換掉、重生也會建新的。分開兩個迴圈只會多一個會漏掉的地方。
    ctl.ships = world.ships
    ctl.groundTargets = world.groundTargets
    // 【投彈那兩格跟著一起接】理由與船完全相同，而且它們也是每一場、每一次
    // 重生都要重接：`bombBay` 隨機種變（換裝、接手僚機），`bombDrag` 必須
    // 與 `World` 是同一個值，否則 AI 算的落點與飛出去的那一顆分家。
    ctl.bombBay = c.bombBay
    ctl.bombDrag = world.bombDrag
    // 【剖面跟著掛載走，不跟著機種】任務卡可以把 G4M 的魚雷複寫成炸彈
    // （`MissionBattle.blueLoadout`），查機種的話那一關會飛雷擊航路去投彈
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
    if (!force && ctl.terrain === terrain) continue
    ctl.terrain = terrain
    ctl.clearTerrainState()
  }
  playerAi.ships = world.ships
  playerAi.groundTargets = world.groundTargets
  // 【代飛的那一架不投彈】`playerAi` 只在玩家交出操縱時接手，而投彈仍然
  // 由玩家的幀迴圈發動（見 `playerBay`）。給 null 就讓它走掃射那一支。
  playerAi.bombBay = null
  playerAi.bombDrag = world.bombDrag
  if (force || playerAi.terrain !== terrain) {
    playerAi.terrain = terrain
    playerAi.clearTerrainState()
  }
}

const tracers = createTracers()
ctx.scene.add(tracers.object)


/**
 * 這一場的船。**沒有船的一場是 null**，而那是絕大多數的場次。
 *
 * 【生命週期比照地形】每一場重建（`startWorld`），因為艦隊是設定的一部分。
 */
let shipModels: ShipModels | null = null
let groundModels: GroundModels | null = null
/** 砲位陣亡時噴火球用的暫存。熱路徑之外，但仍不配置。 */
const GUN_LOST_DIR = new Vector3()

const input = createInputState()
const bindings = attachInput(canvas, input)

const playerController = new PlayerController(input)

/** 目前的畫面。與 `ui/screens.ts` 的狀態機是同一組值 */
let screen: Screen = 'landing'
/** 戰鬥是否暫停。只有 `screen === 'battle'` 時才有意義 */
let paused = false
/** 遭遇戰的設定。設定頁改它，「開始戰鬥」與「再打一場」都讀它 */
let setup: SkirmishSetup = { ...DEFAULT_SKIRMISH }

/**
 * 這一場是從哪裡進來的。
 *
 * 【為什麼不由 `battle.cfg.rules` 推導】遭遇戰與殲滅任務的 `rules`
 * **完全相同**（任務框架 spec §5）—— 差別只在來路。它決定 HUD 畫不畫
 * 目標列、結算的第二顆按鈕回哪裡。
 */
let mode: 'skirmish' | 'mission' = 'skirmish'
/**
 * 玩家點的那一張卡。`mode === 'mission'` 時才有意義。
 *
 * 【型別是 `ReadyMissionCard`】選單只把有戰鬥設定的那幾張接上點擊，所以到得了
 * 這裡的卡一定打得起來 —— 下游因此不需要任何 null 檢查。
 */
let pendingMission: ReadyMissionCard | null = null

/**
 * 目前這一場。**只有 `screen === 'battle'` 時才有值。**
 *
 * 【為什麼用定值斷言而不是 `Battle | null`】`stepAndDrawBattle` 裡有三十
 * 幾處讀它，改成可為空只是把同一個不變式重複寫三十遍。不變式由一個地方
 * 保證：進入 `battle` 這個畫面的唯一途徑是 `fight` 事件，而那個事件的
 * 處理器一定先呼叫 `enterBattle()`（見下方的 `onEvent`）。日後若多開一條
 * 進入戰鬥的路徑，那條路徑也必須先呼叫 `enterBattle()`。
 */
let battle!: Battle
let world!: World
/**
 * 玩家目前開的那一架。
 *
 * 【為什麼不是 const】接手僚機會換一架（M9 spec §7.2）。每幀比對
 * `battle.player`，變了就把觀測用 AI、第一人稱眼點與相機一起搬過去。
 */
let player!: Combatant

/**
 * 自機的 AI（`I`）。純觀測用：讓同一顆腦袋同時開兩台，從外面看它怎麼打。
 *
 * 【為什麼要獨立一個實例而不是共用戰場裡的某一個】`AiController` 持有跨格
 * 狀態（遲滯閂鎖、最小停留、10 Hz 節流、跟蹤計時器、目標記憶）。共用的話
 * 兩架會互相踩掉對方的決策狀態，看到的行為不是任何一架真正的行為。
 */
const playerAi = new AiController()

/**
 * 玩家的戰場邊界。**只有玩家有** —— AI 沒有絕對的牽引，界若對它生效，
 * 整隊會在開打前先自爆。見 `world/arena.ts` 與 `docs/backlog.md` §10.2。
 */
const arena = createArenaState()

/**
 * 開一場新的（或重開一場）時把界歸零。
 *
 * 【兩個進場點都要呼叫】`restartBattle` 是「再打一場」，`enterBattle` 是
 * 由選單進來 —— 只接前者的話，爆炸之後回選單再開一場會沿用已經 expired
 * 的狀態，玩家一進場就爆。
 *
 * 【只有遭遇戰有界】任務卡的撤離點在 −20,000 m、護航的集合點 12,000 m，
 * 兩者都在界外。
 */
function resetArena(): void {
  Object.assign(arena, createArenaState())
  hudFrame.arenaShow = mode === 'skirmish'
}

/** 【選單期間要藏起來】`stepAndDrawBattle` 不跑，HUD 畫布會停在最後一幀 */
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement
const hud = new Hud(hudCanvas)
const hudFrame = createHudFrame()
/**
 * 受擊方向轉座標用的暫存。**模組層** —— 排空發生在物理子步的回呼裡，
 * 一幀可能跑八次，在裡面 new 就是每幀八次配置。
 */
const DAMAGE_DIR = new Vector3()
const DAMAGE_VIEW = new Quaternion()
const boardEl = document.getElementById('board') as HTMLElement
const boardActions = boardEl.querySelector('#board-actions') as HTMLElement
/** 結算的兩個回頭出口。依 `mode` 擇一顯示 —— 見 `stepAndDrawBattle` 尾端 */
const backToSetup = boardActions.querySelector('[data-act="toSetup"]') as HTMLElement
const backToMission = boardActions.querySelector('[data-act="toMission"]') as HTMLElement
/** 暫停選單的兩個出口。依 `mode` 擇一顯示，與結算板同一個做法 */
const pauseEl = document.getElementById('pause') as HTMLElement
const pauseToMenu = pauseEl.querySelector('[data-act="toMenu"]') as HTMLElement
const pauseAbandon = pauseEl.querySelector('[data-act="abandon"]') as HTMLElement
const scoreboard = createScoreboard(boardEl)

/**
 * 一架飛機的可視部分：模型 + 內插用的暫存。
 *
 * 【為什麼一架一組而不是共用】M1 只有一架，位置與姿態直接寫在模組層的兩個
 * 變數上。兩架以上就必須各自持有，否則第二架會把第一架的內插結果覆寫掉
 * ——這是「世界上只有一架飛機」這個假設最直接的殘留物。
 */
interface Visual {
  /**
   * 【M10 起是 readonly】M9 以前 `C` 可以中途換機種，那時這一格會被換掉。
   * 現在模型從 `attachVisual` 建出來到 `releaseVisual` 釋放為止恆是同一具，
   * 所以 `renderPositions` 那些參考不需要任何附帶條件就恆有效。
   */
  readonly model: AircraftModel
  readonly position: Vector3
  readonly quaternion: Quaternion
  /**
   * 模型已經交給殘骸池了嗎。
   *
   * 【為什麼需要這個旗標】殘骸池從此擁有那個 `group` 的位置與旋轉；每幀的
   * 內插迴圈若繼續寫它，殘骸會被釘在飛機死掉的地方一動也不動。
   */
  wrecked: boolean
}

const visuals = new Map<Combatant, Visual>()
function attachVisual(c: Combatant): Visual {
  const v: Visual = {
    model: buildAircraft(c.aircraft.spec),
    position: new Vector3(),
    quaternion: new Quaternion(),
    wrecked: false,
  }
  ctx.scene.add(v.model.group)
  visuals.set(c, v)
  return v
}

// 【三個特效各一個 InstancedMesh】總共多 3 個 draw call（M7 spec §9）
// 【容量照滿編訂而不是照這一場的架數】池子是基礎設施，建一次永不重建
const muzzles = createMuzzles(MAX_COMBATANTS)
ctx.scene.add(muzzles.object)
// 【砲塔的槍管與槍焰各一個池】槍管必須跟著砲塔轉 —— 烘進機身的靜態槍管，
// 在砲塔轉向時彈流會從管子旁邊飛出去，而砲塔的重點就是它會轉。
const turretBarrels = createTurretBarrels(MAX_COMBATANTS)
ctx.scene.add(turretBarrels.object)
const turretMuzzles = createTurretMuzzles(MAX_COMBATANTS)
ctx.scene.add(turretMuzzles.object)
const sparks = createSparks()
ctx.scene.add(sparks.object)
const splashes = createSplashes()
ctx.scene.add(splashes.object)
const bombVisuals = createBombs()
ctx.scene.add(bombVisuals.object)
const torpedoVisuals = createTorpedoes()
ctx.scene.add(torpedoVisuals.object)

// 【每幀重用，不得配置】solveImpact 每幀跑一次，最壞 11,498 步
const BOMB_IMPACT: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }
const BOMB_START: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const BOMB_EYE = new Vector3()
const BOMB_POINT = new Vector3()
const BOMB_NDC = new Vector3()
/**
 * 投雷時的機首**水平**方向。熱路徑不得配置，所以放在模組層。
 *
 * 【為什麼要它】垂直入水那種退化情況下，水中的航向沿用它 —— 那件事不能
 * 從退化的速度反推。
 */
const NOSE_H = new Vector3()
/**
 * 機首的水平方向，**就地寫進 `out`**。
 *
 * 【為什麼投放與 HUD 共用一支】兩邊各寫一份的話會在垂直下墜那一點分家 ——
 * 症狀是「航跡線指一邊、雷跑另一邊」，而那個幾何看不到也測不到。
 */
function noseHorizontal(q: Quaternion, out: Vector3): Vector3 {
  out.set(0, 0, -1).applyQuaternion(q)
  out.y = 0
  if (out.lengthSq() < 1e-12) out.set(0, 0, -1)
  else out.normalize()
  return out
}
/** 航跡線：航向、取樣點的世界座標與投影，全部預先配置 */
const TORP_DIR = new Float64Array(2)
const RUN_WORLD = new Vector3()
const RUN_NDC = new Vector3()
/**
 * 取樣點投影後的 NDC z。
 *
 * 【為什麼要留一條】`runFrontCount` 要一次看完全部的 z 才判得出「從 0 起
 * 連續在相機前方幾個」，而 `HudFrame` 上只有 `runX` / `runY`。少了這一條
 * 就只剩兩條路：每幀生一個陣列，或在這裡另寫一份判斷讓那支測過的純函數
 * 變成沒人呼叫的死護欄。
 */
const RUN_Z = new Float64Array(TORPEDO_RUN_SAMPLES)

/**
 * 玩家的彈艙。**就是 `player.bombBay`，不是另一份。**
 *
 * 【為什麼不能各持一份】AI 的投放走 `World.releaseBombs`，讀的是
 * `Combatant.bombBay`。這裡若自己再開一個，玩家投完按 `I` 代飛時 AI 會拿
 * 另一個滿艙再投一次 —— 而且代飛不會停掉既有的連投佇列，兩條路會同時投。
 *
 * 【投放本身仍然在幀迴圈】搬進物理步的話就沒有 `bombPoint` 與內插後的
 * 算繪位置，準星與彈著會分家。**共用的是庫存，不是路徑。**
 */
function playerBay(): BombBay {
  return player.bombBay
}
/**
 * 玩家這一趟掛什麼。`null` = 掛不了東西。
 *
 * 【為什麼要記在這裡】投彈的那一段每幀都要它的 `kind` 與 `damage`，而
 * `loadoutOf` 是一次查表 —— 換飛機時查一次就夠。
 */
let playerLoadout: Loadout | null = null
/**
 * 這一關複寫的掛載。`null` = 沒有複寫，照機種的預設走。
 *
 * 【為什麼記在這裡】`syncBombLoad` 在換飛機與重生時都會跑，而那時候手上
 * 沒有 `BattleConfig`。`startWorld` 每一場設一次。
 */
let missionLoadout: Loadout | null = null
/**
 * 上一幀左鍵按著沒有。
 *
 * 【為什麼要邊緣】`firing` 是持續按著的布林，而彈艙吃的是「剛按下」。
 * 直接餵 `firing` 的話按著不放會被讀成每一幀都重新扣一次扳機。
 */
let bombWasFiring = false

/**
 * 玩家換了一台飛機：重算掛彈量與瞄具眼點。
 *
 * 【換到不能投彈的飛機要強制退出】少了這一條，重生成戰鬥機之後相機會卡在
 * 一個沒有 `bombPoint` 的模式裡。
 */
function syncBombLoad(): void {
  const m = visuals.get(player)!.model
  playerLoadout = missionLoadout ?? loadoutOf(player.aircraft.spec.id)
  input.bombCapable = m.bombPoint !== null && playerLoadout !== null
  if (m.bombPoint !== null) rig.options.bombPoint.copy(m.bombPoint)
  if (!input.bombCapable && input.viewMode === 'bomb') input.viewMode = 'third'
  resetBombBay(player.bombBay, playerLoadout)
  bombWasFiring = false
}

// 【擊墜表現：+4 個 draw call】火球、黑煙、噴濺、零件。殘骸接管既有的
// AircraftModel，所以它 +0；水柱沿用 M7 的池子，也是 +0（M8 spec §11）
/**
 * 煙團的不透明度貼圖。爆炸那一組與船火的煙柱共用。
 *
 * 【`load` 不 `await`】它同步回傳一個 Texture，圖到了自己填進去。第一次
 * 爆炸離開場有好幾秒，貼圖早就在了；真的沒到的話 alphaMap 是空的，那一批
 * 粒子透明 —— 不會壞，只是看不見。
 */
const smokeTexture = new TextureLoader().load('/textures/smoke.png')

/**
 * 高砲的黑雲。**跨場重用的池**，與火球、煙同一個生命週期。
 *
 * 【為什麼不是煙霧池的一部分】壽命、上升與尺寸是整池共用的建立期設定，
 * 而高砲雲要四秒、幾乎不上升、6→14 m。見 `render/flakBursts.ts`。
 * 貼圖與其他的煙同一張，畫面裡才是同一種質感。
 */
const flakBursts = createFlakBursts(undefined, smokeTexture)
ctx.scene.add(flakBursts.object)

const fireball = createFireball()
ctx.scene.add(fireball.object)
const smoke = createSmoke()
ctx.scene.add(smoke.object)
/**
 * 船火的煙柱。**與通用煙池分開** —— 這一份壽命 20 秒、上升約 10 m/s，
 * 柱高 200 m；通用的那一份是 2.5 秒、3 m/s，柱高 7.5 m，在 1,000 m 的
 * 投彈高度上看不見。
 */
const shipFireSmoke = createShipFireSmoke(undefined, smokeTexture)
ctx.scene.add(shipFireSmoke.object)
const spray = createSpray(WATER_COLOR)
ctx.scene.add(spray.object)
const vortex = createVortex()
ctx.scene.add(vortex.object)
/**
 * 船身上的火點。**只有位置與計時，粒子由上面兩個池生。**
 *
 * 它與粒子池一起進 `POOLS` —— `reset()` 這個名字就是為了那份清單。
 */
const shipFires = createShipFires()
const groundFires = createGroundFires()
/**
 * 魚雷的航跡。**貼著浪面的一條白帶，不是粒子** —— 粒子池畫的是團狀的東西，
 * 這是一條線（理由見 `render/wake.ts`，與凝結尾同一條）。水花仍然照噴，它
 * 負責線上的閃爍。
 */
const wakes = createWakes()
ctx.scene.add(wakes.object)
// 【不進 POOLS】它沒有粒子狀態要在換場時歸零 —— 每一幀由指揮層的命令
// 重新填滿，上一場的內容活不過一幀
const orderMarkers = createOrderMarkers()
ctx.scene.add(orderMarkers.object)
const debris = createDebris()

// ── 爆炸 ────────────────────────────────────────────────
//
// 【七個池一組】球塊火球、光暈、交棒煙、爆炸煙柱、揚塵、水冠、水霧。
// 配方在 `render/blast.ts`，`/blast.html` 是它的調校台。
const blastChunks = createFireChunks(undefined, BLAST_PACE, (x, y, z, vx, vy, vz, d, slot) => {
  emitEmber(blastEmber, slot, x, y, z, vx, vy, vz, d)
})
ctx.scene.add(blastChunks.object)
const blastGlow = createFireGlow(undefined, BLAST_PACE)
ctx.scene.add(blastGlow.object)
const blastEmber = createEmberSmoke(undefined, BLAST_PACE, smokeTexture)
ctx.scene.add(blastEmber.object)
const blastSmoke = createBlastSmoke(undefined, BLAST_PACE, smokeTexture)
ctx.scene.add(blastSmoke.object)
const blastDust = createDust(undefined, BLAST_PACE, smokeTexture)
ctx.scene.add(blastDust.object)
const blastMist = createWaterMist(undefined, BLAST_PACE, smokeTexture)
ctx.scene.add(blastMist.object)
const blastJets = createWaterJets({
  capacity: 256, life: 1.5 * BLAST_PACE, rise: JET_RISE, alphaFrom: 0.8,
  onFade: (x, y, z, height, radius, slot) => {
    emitMist(blastMist, slot, WATER_BLAST.mistPerJet, WATER_BLAST.mistSize,
      x, y, z, height, radius)
  },
})
ctx.scene.add(blastJets.object)

/**
 * 給 `emitBlast` 的那一組。每幀都是同一個物件 —— 熱路徑不配置。
 *
 * 【`splashEvents` 是它自己的，不是 `world` 的】那一格只在**沒有** `jets`
 * 池時才會被寫（`emitCrown` 的退路），而這裡永遠有 —— 給它一個專用的空
 * 通道比接上世界的那一條安全：`world` 要到 `startWorld()` 才存在。
 */
const BLAST_POOLS: BlastPools = {
  fireball: blastChunks,
  smoke: blastSmoke,
  dust: blastDust,
  spray,
  splashEvents: createImpacts(),
  glow: blastGlow,
  jets: blastJets,
}

/**
 * 離地多近算「墜地」，m。
 *
 * 【它分的是兩套表現】貼著地面炸的要揚塵，空中炸的不要 —— 一架 12 m 長的
 * 飛機撞地時機身中心大約就在這個高度。
 */
const CRASH_BLAST_HEIGHT = 25

/** 依當量縮放後的配方。模組級 —— 每次爆炸不配置 */
const SCALED_BLAST: { -readonly [K in keyof BlastParams]: number } = { ...LAND_BLAST }

/**
 * 空中擊墜的爆炸繼承多少母機速度。
 *
 * 【與 `FIREBALL_INHERIT` 同一個值、同一個理由】火球完全靜止的話，一架
 * 150 m/s 的飛機在半秒的壽命內會飛出 75 m —— 畫面上是「爆炸發生在飛機
 * 後面」。真實的火球會先隨殘骸往前衝，再被空氣煞住。
 */
const KILL_BLAST_INHERIT = 0.5

/**
 * 擊墜的爆炸。**空中與墜地是同一條事件流**（兩者都走 `World.destroy`），
 * 由離地高度分辨。
 */
function emitKillBlasts(events: KillEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * KILL_STRIDE
    const x = d[o]!
    const y = d[o + 1]!
    const z = d[o + 2]!
    const ground = terrain.collisionHeightAt(x, z)
    // 【撞海不算墜地】海面的 `collisionHeightAt` 是 0，只看高度的話撞海會
    // 揚起一團深咖啡色的土。入水的表現由殘骸的水柱負責（`wrecks`）
    const onLand = !(terrain.waterAt(x, z) > -Infinity)
      && y - ground <= CRASH_BLAST_HEIGHT
    // 【墜地那一份的爆點壓到地面】事件的 y 是機身中心，火球生在半空的話
    // 揚塵會浮著
    // 【空中那一份繼承母機速度】墜地的不繼承 —— 它已經撞停了
    const inherit = onLand ? 0 : KILL_BLAST_INHERIT
    emitBlast(BLAST_POOLS, onLand ? LAND_BLAST : AIR_BLAST,
      x, onLand ? ground : y, z, (e * 131 + Math.round(world.time * 60)) | 0,
      d[o + 3]! * inherit, d[o + 4]! * inherit, d[o + 5]! * inherit)
  }
}

/**
 * 地面目標被摧毀：在它的位置點一團落地的火。**與墜地那一份同一個配方**
 * （`LAND_BLAST`）—— 燒起來的卡車與撞地的飛機看起來就該是同一種土與火。
 * 事件的 y 已經是地面高度，不必再壓。這裡自己排空。
 */
function emitGroundKills(events: ImpactEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    emitBlast(BLAST_POOLS, LAND_BLAST, d[o]!, d[o + 1]!, d[o + 2]!,
      (e * 97 + Math.round(world.time * 60)) | 0, 0, 0, 0)
    // 【原地掛一根煙柱】燒 60 秒，與船火同一套參數。炸彈落點的火球與碎片
    // 由 `emitBombBlasts` 負責 —— 這裡只點火，不再放第二次爆炸
    const t = world.groundTargets[d[o + 3]!]
    const top = t === undefined ? 0 : t.impactY - t.position.y
    lightGroundFire(groundFires, d[o]!, d[o + 1]! + top * 0.3, d[o + 2]!)
  }
  clearImpacts(events)
}

/**
 * 炸彈落地。`nx` 是落點的種類：0 = 陸、1 = 水、2 = 船（見
 * `World.onBombImpact`）。
 *
 * 【打中船用空爆那一份】甲板上炸不揚土、也不掀水冠 —— 剩下的正好是
 * `AIR_BLAST` 的火球加煙。
 */
function emitBombBlasts(events: ImpactEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    // 0 = 陸、1 = 水、2 = 船、3 = 建築。船與建築同一套：火加碎片
    const kind = d[o + 3]!
    const recipe = kind > 1.5 ? AIR_BLAST : kind > 0.5 ? WATER_BLAST : LAND_BLAST
    // 【表現的規模跟著那一顆的傷害走】`ny` 帶的是爆心傷害，而尺度的立方
    // 才是 `scaleBlast` 要的當量 —— 傷害本身正比於尺度，見 `blastScaleOf`
    const scale = blastScaleOf(d[o + 4]!)
    scaleBlast(recipe, scale * scale * scale, SCALED_BLAST)
    const seed = (e * 197 + Math.round(world.time * 60)) | 0
    emitBlast(BLAST_POOLS, SCALED_BLAST, d[o]!, d[o + 1]!, d[o + 2]!, seed)
    // 碎片與擊墜共用同一個池；散射速度跟著當量的尺度走
    debris.burst(d[o]!, d[o + 1]!, d[o + 2]!, BLAST_DEBRIS_COLOR, seed, scale)
  }
}

/**
 * 一朵火災的迷你爆炸：一團小爆燃 ＋ 幾團垂直上升的煙。
 *
 * **綁在模組層建一次** —— 幀迴圈裡宣告閉包是每幀一次配置。
 *
 * 【煙一律往上，不走錐狀噴射】`FIRE_BLAST` 的 `smokeCount` 是 0，這裡的
 * 每一團都給一個**朝上**的初速，只在水平方向抖一點寬度。
 *
 * 【柱高固定 200 m】每一艘都一樣。初速由 `plumeSpeed` 從那個高度反解 ——
 * 兩者之間隔著阻尼，寫死一個看起來差不多的速度的話，改了壽命或阻尼之後
 * 就不對了。
 *
 * 【一次三團】0.3 秒一次，一團的話那是一串珠子不是一道柱子。
 */
const FIRE_SMOKE_PER_PUFF = 3
/** 水平散開的最大速度，m/s。柱子的粗細 */
const FIRE_SMOKE_SPREAD = 1.6
/** 上升速度的抖動幅度，比例。0.25 = 落在 0.75×～1.25× 之間 */
const FIRE_SMOKE_RISE_JITTER = 0.25

const emitFirePuff: FirePuffFn = (x, y, z) => {
  emitBlast(BLAST_POOLS, FIRE_BLAST, x, y, z, (fireSeed = (fireSeed + 1) | 0))
  for (let k = 0; k < FIRE_SMOKE_PER_PUFF; k++) {
    // 【三個維度各自抖】方位角、半徑、上升速度全部獨立取樣。
    //
    // 只抖方位角、而且用等角度分佈（黃金角 × 序號）的話，等速上升會把
    // 連續幾朵串成一條**規則的螺旋線** —— 畫面上是兩三股麻花而不是一叢煙。
    // 半徑固定會讓它們貼在同一個圓柱面上；上升速度一致則讓同一朵的三顆
    // 永遠共面。
    const s = fireSeed * FIRE_SMOKE_PER_PUFF + k
    const a = hash01(s * 3 + 1) * Math.PI * 2
    const r = Math.sqrt(hash01(s * 3 + 2)) * FIRE_SMOKE_SPREAD
    const up = SHIP_FIRE_PLUME_SPEED
      * (1 + (hash01(s * 3 + 3) * 2 - 1) * FIRE_SMOKE_RISE_JITTER)
    shipFireSmoke.emit(x, y, z, Math.cos(a) * r, up, Math.sin(a) * r, 1)
  }
}
/** `emitFirePuff` 的散佈序號。爆炸配方與煙的三個抖動都吃它 */
let fireSeed = 0

/**
 * 魚雷引爆。`nx` 是 0 撞岸／1 撞船，兩者共用同一份水冠配方。
 *
 * 【爆點抬到水面】事件的 y 是定深（−1 m）—— 水柱從那裡長的話，整根的底部
 * 一公尺埋在水裡。
 */
function emitTorpedoBlasts(events: ImpactEvents): void {
  const d = events.data
  for (let e = 0; e < events.count; e++) {
    const o = e * IMPACT_STRIDE
    const x = d[o]!
    const z = d[o + 2]!
    const w = terrain.waterAt(x, z)
    const scale = blastScaleOf(d[o + 4]!)
    scaleBlast(TORPEDO_BLAST, scale * scale * scale, SCALED_BLAST)
    const y = Number.isFinite(w) ? w : d[o + 1]!
    const seed = (e * 211 + Math.round(world.time * 60)) | 0
    emitBlast(BLAST_POOLS, SCALED_BLAST, x, y, z, seed)
    // 碎片從水面往上拋；與擊墜共用同一個池
    debris.burst(x, y, z, BLAST_DEBRIS_COLOR, seed, scale)
  }
}

/**
 * 每一場結束時要歸零的粒子池。**清單只有這一份。**
 *
 * 【為什麼要有這個陣列與 `resetPools`】換一場有**兩個**入口 ——
 * `enterBattle()`（設定頁的「開始戰鬥」、結算的「再打一場」）與
 * `restartBattle()`（暫停選單的「重新開始」）。原本只有前者列了七行
 * `xxx.reset()`，後者一行都沒有，於是按「重新開始」之後上一場的煙與碎片
 * 會飄在舊位置上等自己過期。
 *
 * **那幾秒不是重點**，重點是「兩個入口、兩份清單」這個結構：下一個人加第
 * 八個池的時候會加到其中一份。抽成一份之後，加池子只要動這個陣列，兩個
 * 入口自動跟上。`test/unit/pool-reset-entrypoints.test.ts` 釘住這件事 ——
 * 它連「入口裡不准再出現 `xxx.reset()`」都一起守，否則兩份清單會再長出來。
 *
 * 【殘骸不在這裡】殘骸池持有飛機模型，必須在 `visuals` 清空**之前**還回去，
 * 那是 `releaseVisuals()` 的責任、順序也不同（見 `enterBattle` 的註解）。
 */
const POOLS = [
  fireball, smoke, spray, sparks, splashes, debris, vortex, flakBursts, wakes,
  blastChunks, blastGlow, blastEmber, blastSmoke, blastDust, blastMist, blastJets,
  // 【船火那兩份也在這裡】漏清煙池的話上一場的煙殘留 12 秒；漏清 `shipFires`
  // 更糟 —— 上一場的火點會用同一個船索引附到新一場的船上，燒滿 60 秒
  shipFireSmoke, shipFires, groundFires,
]

function resetPools(): void {
  for (const p of POOLS) p.reset()
  resetFlakBurstSeed()
  resetFlakBlastSeed()
}

ctx.scene.add(debris.object)
const wrecks = createWrecks(MAX_COMBATANTS, (m) => {
  ctx.scene.remove(m.group)
  m.dispose()
})

/** combatant 索引 → 機身色。零件用它上色 —— `World` 不需要知道有塗裝這回事。 */
const debrisColorOf = (index: number): number =>
  bodyColorOf(world.combatants[index]!.aircraft.spec)

// 【依 c.index 索引的內插姿態】直接持有 Visual 的 Vector3/Quaternion 參考，
// 不複製 —— 每幀的內插迴圈寫進那些物件，這裡自然就是最新的。
let renderPositions: Vector3[] = []
let renderQuaternions: Quaternion[] = []

const rig = new CameraRig()

const godCam = createGodCameraState()
/** 上一幀是否在上帝視角。進出的邊緣偵測用 */
let wasGodView = false
/** G 進出兩個方向共用的鏡頭過渡 */
const godBlend = createCameraBlend()
/**
 * 餵給 `stepGodCamera` 的輸入。**重用，不每幀配置** —— 與 `probe`、
 * `relPos` 那一組同一個做法。
 */
const godInput: GodCameraInput = {
  forward: false, back: false, left: false, right: false,
  up: false, down: false, boost: false, lookX: 0, lookY: 0,
}
/** 上帝視角的注視點。重用，理由同上 */
const godTarget = new Vector3()

/** 兩個翼尖的世界座標。熱路徑：不配置。 */
const TIP_L = new Vector3()
const TIP_R = new Vector3()

/** HUD 投影用的暫存向量；投影距離取 1000 m，遠到視差可以忽略。 */
const probe = new Vector3()
const HUD_PROJECT_DISTANCE = 1000
/** 接觸點的預瞄計算用暫存。熱路徑禁止配置。 */
const relPos = new Vector3()
const relVel = new Vector3()
const leadDir = new Vector3()
const leadProbe = new Vector3()

/**
 * `fillMarkers` 的投影回呼。**綁在模組層建一次** —— 幀迴圈裡宣告一個閉包
 * 是每幀一次配置，與 `World.dropOne` 綁成欄位是同一條理由。
 */
const projectMarker: MarkerProject = (x, y, z, out) => {
  probe.set(x, y, z).project(ctx.camera)
  out.x = probe.x * ctx.camera.aspect
  out.y = probe.y
  return probe.z >= 1
}
/** 餵給 `fillMarkers` 的池清單。就地換內容，不每幀造一個陣列 */
const MARKER_POOLS: MarkerPool[] = []
/**
 * 船的標記畫在模型的最高點。**桅杆不在任何碰撞盒裡** —— 用
 * `world/ships.ts` 推出來的高度只有模型的三分之一到一半。
 */
const shipMarkerTop: ShipMarkerTop = (s) => shipModelTop(s.cls.id)

let propRotation = 0
/** 上一幀是否正在等待接手。用來偵測「剛死掉」那一幀 */
let wasDying = false

/**
 * 重生：重置飛機並把瞄準點放回機首。
 *
 * 【只在開新的一場或重新開始時呼叫】玩家陣亡不重生 —— M9 起改為接手僚機。
 */
function respawnPlayer() {
  const p = battle.player
  // 【速度讀這一席的 `spawnTas`，高度讀 cfg】開局速度逐機種（見 `setup.ts`
  // 的 `openingTas`），`cfg.tas` 只是戰鬥機的那一個值 —— 拿它重生轟炸機會
  // 超過 vne。高度是全場一個值，沒有逐機種的版本
  p.aircraft.respawn(input.aimWorld, battle.cfg.altitude, p.spawnTas)
  p.aircraft.state.position.copy(p.spawnPosition)
  p.aircraft.prevPosition.copy(p.spawnPosition)
  p.hp = p.aircraft.spec.hp
  p.alive = true
  p.cooldowns.fill(0)
  // 清掉墜海前那一下扭轉留在相機上的落後量與自由視角角度
  rig.snapTo(input.aimWorld)
  // 撞海前八成正在拉大 G；不清掉的話重生後畫面還是黑的
  resetGEffect()
  // 上一條命的紅邊不屬於這一條命
  resetDamageMarks(hudFrame.damageMarks)
}

/** 把一架的模型移出場景並釋放。殘骸池的回收回呼與換場都用它 */
function releaseVisual(v: Visual): void {
  ctx.scene.remove(v.model.group)
  v.model.dispose()
}

/**
 * 把場上的模型全部還回去。
 *
 * 【`wrecks.reset()` 必須排在清空 `visuals` 之前】殘骸池持有的模型也在
 * `visuals` 裡。順序顛倒的話同一個模型會被 `dispose()` 兩次。
 */
function releaseVisuals(): void {
  wrecks.reset()
  for (const v of visuals.values()) releaseVisual(v)
  visuals.clear()
  renderPositions = []
  renderQuaternions = []
}

/**
 * 整批重建模型。換一場與 R 重開都走這裡。
 *
 * 【為什麼 R 也要整批重建，而不是只把 `wrecked` 旗標清掉】殘骸池**仍然
 * 持有**上一批被接管的模型，而且會在它們沉到水下時呼叫回收回呼 ——
 * 那時那個模型已經是一架活著的飛機的模型了，於是活人的飛機憑空消失。
 * 這是 M9 留下的缺陷；`wrecks.reset()` 到 M10 才存在，這裡才修得掉。
 */
function rebuildVisuals(): void {
  releaseVisuals()
  for (const c of world.combatants) attachVisual(c)
  // 【依 c.index 索引的內插姿態】直接持有 Visual 的 Vector3/Quaternion
  // 參考，不複製 —— 每幀的內插迴圈寫進那些物件，這裡自然就是最新的。
  renderPositions = world.combatants.map((c) => visuals.get(c)!.position)
  renderQuaternions = world.combatants.map((c) => visuals.get(c)!.quaternion)
  // 眼點是量出來的座艙位置，一機一個值
  rig.options.firstPersonOffset.copy(visuals.get(player)!.model.eyePoint)
  syncBombLoad()
  fitCameraToPlayer()
}

/**
 * 把還沒有模型的座位補上。**只建新的那幾具**，場上既有的一律不動。
 *
 * 【為什麼不能沿用 `rebuildVisuals`】那一支會先 `releaseVisuals()` ——
 * 戰鬥進行到一半呼叫它，殘骸池持有的模型會被抽走（正在冒煙的殘骸憑空消失）、
 * 全場的內插暫存換成新物件、玩家的相機重新對焦。增援只是多了幾個座位，
 * 那三件事一件都不該發生。
 *
 * 【判準是長度差而不是 `reinforce` 的回傳值】增援只從尾端加座位，所以
 * 「哪幾個座位還沒有模型」比兩個長度就答得出來。而 `reinforce` 是
 * `stepBeats` 在 `stepBattle` 裡面呼叫的 —— 要把那組索引傳出來，得在
 * 物理層開一條只為畫面存在的回呼。
 *
 * 【必須在下一個物理子步之前做完】幀尾的內插迴圈是 `visuals.get(c)!` ——
 * 少一具模型不是畫面缺一架，是當場拋錯。
 */
function syncVisuals(): void {
  for (let i = renderPositions.length; i < world.combatants.length; i++) {
    const v = attachVisual(world.combatants[i]!)
    renderPositions.push(v.position)
    renderQuaternions.push(v.quaternion)
  }
}

/**
 * 第三人稱的距離與高度跟著機種的翼展走（見 `thirdPersonFor`）。
 *
 * 【為什麼與眼點分開一個函式】眼點來自**幾何**（量出來的座艙位置），
 * 距離來自**氣動 spec**（翼展）。兩者的來源不同，換機時要一起做但理由
 * 各自成立 —— 合成一行的話，日後有人只改其中一邊就會靜靜地漏掉另一邊。
 */
function fitCameraToPlayer(): void {
  const fit = thirdPersonFor(player.aircraft.spec.wing.span)
  rig.options.thirdDistance = fit.distance
  rig.options.thirdHeight = fit.height
}

/** 離開戰鬥：清場並收掉記分板。 */
function leaveBattle(): void {
  releaseVisuals()
  // 【圓環要移出場景】不移的話回到主選單，那個環還浮在選單的背景海上
  ctx.scene.remove(objectiveRing.object)
  // 【記分板要一起收】`stepAndDrawBattle` 不再跑，結算板會就這樣留在
  // 選單上面 —— 從結算按「回設定頁」時看得最清楚
  input.scoreboardHeld = false
  scoreboard.setVisible(false)
  boardActions.hidden = true
  boardEl.classList.remove('finished')
}

/**
 * 重開這一場：同樣的設定、同樣的座位，名字重抽、戰績歸零。
 *
 * 暫停選單的「重新開始」走這裡。
 *
 * 【為什麼不是直接呼叫 `enterBattle`】那會換掉整個 `Battle` 與地形，而
 * `resetBattle` 產出的遊戲狀態已經與新建一場等價（名字重抽、戰績歸零、
 * 被接手過的座位還給 AI）。留在同一場的好處是玩家的座位與設定原封不動，
 * 而且不必繞一圈選單。
 *
 * 【重開整場而不是只重生自機】20v20 裡「只有我復活、戰場停在半場」是一個
 * 說不通的狀態。
 */
function restartBattle(): void {
  // 【有波次的一場整個重建】`resetBattle` 只把飛機放回出生點：已經進場的
  // 增援會留在場上，而節拍狀態全部是 `done` —— 第二波不會再來，第二輪
  // 因此是一場從頭就滿編、什麼都不會發生的仗。
  // 所以是重建，不是截斷。
  //
  // 【地形不重建】它是關卡設計的一部分，這一場並沒有換關卡。
  if (battle.beatStates.length > 0) {
    releaseVisuals()
    resetPools()
    resetArena()
    startWorld(battle.cfg)
    // 【強制清，理由與下面那條相同】`playerAi` 跨場重用，而地形沒換 ——
    // 參考比對會跳過它
    wireTerrain(true)
    return
  }
  resetBattle(battle)
  // 【池子也要清】少了這一行，上一場的煙（最多 3.1 s）、碎片（1.5–2 s）、
  // 水柱（~2.1 s）會飄在舊位置上等自己過期。殘骸不在其中 —— 下面的
  // `rebuildVisuals` 會把殘骸池持有的模型還回去。
  resetPools()
  player = battle.player
  // 【模型整批重建】只把 `wrecked` 旗標清掉是不夠的 —— 見 `rebuildVisuals`
  rebuildVisuals()
  leaveGodView()
  respawnPlayer()
  // 【強制清，不能靠參考比對】重開一場不換 terrain，所以 wireTerrain 的
  // ctl.terrain === terrain 會跳過 —— 上一場「我正在繞第 17 座島」的承諾
  // 就這樣帶進了新的一場
  wireTerrain(true)
  resetArena()
}

/**
 * 退出上帝視角。**重開一場與換場都要呼叫**。
 *
 * 不呼叫的話：上帝視角 → ESC → 回主選單 → 開始戰鬥，新的一場會直接開在
 * 上帝視角，而鏡頭停在舊世界的座標上。與 `input.pointerLockLost = false`
 * 是同一類殘留 —— 這兩個函數都是「換一場」的入口。
 *
 * 【`wasGodView` 也要一起清】只清 `input.godView` 的話邊緣偵測不會觸發，
 * `playerAi` 會留在 true，新的一場開頭是 AI 在飛。
 *
 * 【按鍵狀態也要清】這裡是直接改 `input.godView` 的，繞過了 `G` 的處理器。
 */
function leaveGodView(): void {
  input.godView = false
  wasGodView = false
  input.playerAi = false
  // 新的一場不該從上一場的鏡頭位置飄過來
  godBlend.active = false
  bindings.clearHolds()
}

/**
 * 重建整場戰鬥。設定頁的「開始戰鬥」與結算的「再打一場」都走這裡。
 *
 * 【順序不可調換】先把上一場的東西還回去（殘骸池持有模型，必須在
 * `visuals` 清空之前歸零），再建新的世界，最後才建模型 —— 模型是依
 * 新的 `combatants` 建的（M10 spec §5.3、§5.5）。
 */
function enterBattle(): void {
  // 1. 上一場的模型全部還回去（殘骸池持有的也在裡面）
  releaseVisuals()

  // 2. 其餘的池子歸零
  resetPools()

  // 3. 地形重建。種類沒變也重建 —— 那條路徑因此每一場都在走，不是一條
  //    等著被第一次使用的死碼（M10 spec §5.3）
  //
  //    【任務的地形是關卡設計的一部分】它寫在卡片上：太平洋那幾關要海面、
  //    帝國本土那一關要內陸。共用遭遇戰那一個「上一次選了什麼」的話，打完
  //    一場純海面遭遇戰再點任務卡，任務會靜靜地變成海面
  terrainKind = mode === 'mission' && pendingMission !== null
    ? pendingMission.battle.terrain
    : setup.terrain
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrain = createTerrain(terrainKind)
  ctx.scene.add(terrain.object)
  // 【時段與地形同一個來源】任務讀卡片（省略 = 正午），遭遇戰讀玩家在編組頁
  // 選的那一格。天空、霧、三盞燈與海一次換完 —— 分開叫的話漏掉海的症狀是
  // 「黃昏的天配中午的海」，而且不會有東西報錯
  applyTimeOfDay(ctx, terrain, mode === 'mission' && pendingMission !== null
    ? pendingMission.battle.timeOfDay ?? 'noon'
    : setup.timeOfDay)
  resetArena()

  // 4. 新的世界。【兩條路各自有唯一的設定入口】遭遇戰走 `battleConfigFrom`、
  //    任務走 `missionConfigFrom` —— 難度 VETERAN 都在那兩個函數裡套
  startWorld(drillConfig !== null
    ? drillConfig
    : mode === 'mission' && pendingMission !== null
      ? missionConfigFrom(pendingMission)
      : battleConfigFrom(setup))
}

/**
 * 依一份設定建起新的世界，並接好所有跨場重用的東西。
 *
 * **`enterBattle` 與有波次的「重新開始」共用這一段。**地形與界不在裡面 ——
 * 重開一場不換地形，而換場才需要重建它。
 */
function startWorld(cfg: BattleConfig): void {
  // 【在 createBattle 之前】那一支會走到 `syncBombLoad`，而它讀這個值
  missionLoadout = cfg.blueLoadout ?? null
  battle = createBattle(playerController, cfg)
  battleStartedAt = elapsed
  battleEndedAt = -1
  aarDrawn = false
  boardNextDraw = 0
  world = battle.world
  /**
   * 撞地判定，套用於**所有**飛機。
   *
   * 【M5 起擴及全部】M2 到 M4 只對玩家做，理由是「靶機在固定高度巡航，
   * 不會撞海」。20v20 裡總有人會被打到失控——不補的話會出現在海面下
   * 繼續飛的飛機（M5 spec §1.1）。
   *
   * 波參數與海面著色器共用（見 aircraft/crash.ts），而 `elapsed` 在幀首
   * 更新、與 `terrain.update` 餵給 shader 的是同一個時間 —— 玩家看到的
   * 浪頭就是撞得到的浪頭。
   */
  const seaCrash = flatSeaCrashPolicy(terrain.collisionHeightAt)
  world.crashPolicy = (c) => {
    // 【比 combatant，不是比 controller】玩家按 I 交給 AI、或進上帝視角時，
    // 這一架的 `controller` 會被換成 `playerAi` —— 比 controller 的話那時候
    // 倒數歸零殺不掉人
    if (arenaKills(arena, c === player)) return true
    return seaCrash(c)
  }
  // 【彈丸的陸地】撞到山就爆火花並回收。玩家、AI 與砲塔的槍全部走同一個
  // 彈丸池，所以這一行就涵蓋三者
  world.land = terrain.land
  // 【炸彈的地面與水面】與 `crashPolicy` 同一個注入方式：規則的權威在
  // `render/terrain.ts`，`World` 不抄第二份。放在這裡就自動涵蓋換地形 ——
  // 這一段每一場都重跑
  world.groundAt = terrain.collisionHeightAt
  world.waterAt = terrain.waterAt
  // 【地面目標要在地形接上之後才落地】建戰鬥時 groundAt 還是 0
  settleGroundTargets(world.groundTargets, world.groundAt)
  player = battle.player
  rebuildVisuals()

  // 【船的模型每一場重建】艦隊是設定的一部分 —— 沿用上一場的話，換一張
  // 沒有艦隊的卡時那幾艘會留在海上。
  if (shipModels !== null) {
    ctx.scene.remove(shipModels.object)
    shipModels.dispose()
    shipModels = null
  }
  if (world.ships.length > 0) {
    shipModels = createShipModels(world.ships)
    ctx.scene.add(shipModels.object)
  }
  // 地面目標與船同一個做法：每一場重建
  if (groundModels !== null) {
    ctx.scene.remove(groundModels.object)
    groundModels.dispose()
    groundModels = null
  }
  if (world.groundTargets.length > 0) {
    groundModels = createGroundModels(world.groundTargets)
    ctx.scene.add(groundModels.object)
  }

  // 5. 撤離圓環。【比照地形每一場都重建】那條路徑因此每一場都在走，不是
  //    一條等著被第一次使用的死碼。沒有撤離點的一場就是建了不加進場景 ——
  //    `hasTarget` 是唯一的判準，`mode` 不參與（殲滅任務也沒有環）
  ctx.scene.remove(objectiveRing.object)
  objectiveRing.dispose()
  objectiveRing = createObjectiveRing()
  if (battle.mission.hasTarget) ctx.scene.add(objectiveRing.object)

  playerAi.board = battle.board
  playerAi.selfIndex = player.index
  playerAi.setDecisionPhase(player.index / world.combatants.length)
  /**
   * 【難度也要給】`createBattle` 的接線迴圈只走 `combatants` 上的
   * `AiController`，而玩家座位掛的是**手動**控制器 —— 代飛這一顆從來不在
   * 那個迴圈裡。漏掉的話它留在 `AiController` 的預設 `ACE`（反應延遲 0），
   * 場上其他每一架卻是關卡指定的 `VETERAN`（0.3 s）。
   *
   * 【為什麼這個漏接很難發現】它不會報錯、不會掉幀，只是讓代飛比友軍反應
   * 快三成秒。實測代價是**離線探針與遊戲跑出兩條完全不同的軌跡** —— 探針
   * 把 `AiController` 當成玩家座位的 controller 傳進 `createBattle`，於是
   * 它拿得到 `VETERAN`。同一張卡、同樣從 t=0 代飛，一邊谷底低 263 m、
   * 一邊低 697 m，而我一度以為那是混沌。
   */
  playerAi.profile = cfg.aiProfile
  // 【戰術狀態也要清】`playerAi` 是跨關卡重用的同一顆。少了這一行，上一場
  // 【重現一場戰鬥的鑰匙】種子是 `Math.random()` 抽的，不印出來就永遠
  // 找不回這一場。（設定, 種子, 秒數, 座位）四樣湊齊，無頭環境就能把
  // 同一場逐位元重跑 —— 人工試飛回報異常行為時，那是唯一的復現途徑。
  //
  // 【種子不進物理路徑】它只配飛行員名字，但它是 `createBattle` 唯一的
  // 非決定性輸入，所以仍然是鑰匙的一部分。
  //
  // 【印 `battle.cfg` 而不是 `setup`】任務模式下 `setup` 是**遭遇戰**的設定，
  // 與這一場毫無關係 —— 那會讓這把鑰匙在最需要它的時候（任務出問題）失效。
  console.log(
    `[戰鬥] 種子 ${battle.seed}　${mode === 'mission' ? pendingMission?.id ?? '?' : '遭遇戰'}`
    + `　藍 ${sideSummary(battle.cfg.units, 'blue')}`
    + `　紅 ${sideSummary(battle.cfg.units, 'red')}`
    + `　規則 ${battle.cfg.rules.kind}　玩家座位 #${player.index}`
    // 【場地與開場高度也是鑰匙的一部分】兩者都是設定，而且都會改變這一場
    // 長什麼樣 —— 少了它們，「同一場逐位元重跑」就不成立
    + `　場地 ${terrainKind}　開場 ${battle.cfg.altitude} m`,
  )
  telemetryAt = 0
  // 【命令的計數也要歸零】不歸零的話「第 87 張」會跨場累積，那個數字
  // 從此不能拿來比較
  orderRef = null
  orderSince = 0
  orderCount = 0
  respawnPlayer()
  wasDying = false
  // 【殘留的旗標要清】它是單幀旗標，但只有戰鬥中的分支會消費它 ——
  // 留著的話新的一場開頭第一幀就被彈進暫停選單
  input.pointerLockLost = false
  // 【上帝視角的殘留同理】上一場按著 G 進主選單的話，新的一場會直接開在
  // 上帝視角、鏡頭停在舊世界的座標上
  leaveGodView()
}

/**
 * 每 `TELEMETRY_PERIOD` 秒印一行玩家那一架的狀態。
 *
 * 【印的是玩家那一架，不是全場】全場 40 行會把 console 淹掉，而回報者
 * 看的永遠是自己跟拍的那一架。要看別架就用（種子, 秒數）重跑。
 *
 * 【AI 代飛時才有意圖可印】玩家自己飛的時候 `controller` 不是
 * `AiController`，那幾欄留白 —— 這也順便標示出「這一段是誰在飛」。
 */
function logTelemetry(): void {
  const a = player.aircraft
  const v = a.state.velocity
  const speed = v.length()
  const gamma = speed > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, v.y / speed))) * (180 / Math.PI) : 0
  const ctl = player.controller
  const ai = ctl instanceof AiController ? ctl : null
  console.log(
    `[t=${elapsed.toFixed(0)}s] #${player.index}`
    + `　${(a.diag.aero.tas * 3.6).toFixed(0)} km/h`
    + `　${a.state.position.y.toFixed(0)} m`
    + `　航跡 ${gamma.toFixed(0)}°`
    + (ai === null ? '　（玩家操縱）' : `　${ai.intent}/${ai.mode}`
      + `　目標 ${ai.target === null ? '無' : '#' + world.combatants.findIndex((c) => c.aircraft === ai.target)}`
      + `　命令 ${orderLabel(ai.order)}`),
  )
}

/**
 * 命令那一欄。**張數與已握秒數是重點，不是 `kind`。**
 *
 * 集合令另外印兩個距離:**我的**與**長機的**。
 *
 * 【為什麼要印兩個】到達判定比的是 `command.ts` 的 `leaderDistance`，也就是
 * 分隊裡**第一個存活成員**離集合點多遠。而 `compactFlights` 把玩家釘在
 * `members[0]`（`flights.ts` 的 `pinned`），所以理論上兩者恆等。
 *
 * **實機打破過那個理論**：座位 #8 的距離連續進到 250 m、
 * 209 m、145 m（判定 300 m），命令卻握了 196 秒沒解除。而 headless 用全 AI
 * 與「人飛 15 秒再交接」兩種條件、約 40 張命令、幾十萬個物理步，一次都
 * 複製不出來（`test/tools/rally-stuck.probe.ts`、`rally-handover.probe.ts`
 * 量的不變式是 0 違反）。
 *
 * 所以下一次要讓症狀自己說出是誰：**長機是哪一架、它離集合點多遠**。
 *   兩個數相同而仍未解除 → 解除路徑本身壞了
 *   長機不是玩家那一架   → `pinned` 的不變式在遊戲裡不成立，往 compactFlights 查
 *
 * 一直繞不進去的話，這一欄會是一串遠大於 300 的數字而張數不動；churn 的
 * 話會是張數一直跳而秒數一直被歸零。兩種病在同一行裡分得開。
 */
function orderLabel(order: FlightOrder | null): string {
  if (order === null) return '無'
  const held = (elapsed - orderSince).toFixed(0)
  const base = `${order.kind}（第 ${orderCount} 張，已握 ${held}s`
  if (order.kind !== 'rally') return base + '）'
  const d = player.aircraft.state.position.distanceTo(order.point)
  return `${base}，我離 ${d.toFixed(0)} m，${leaderLabel(order.point)}`
    + `／判定 ${order.radius.toFixed(0)} m）`
}

/**
 * 判定實際用的那個數：分隊第一個存活成員是誰、離集合點多遠。
 *
 * 【為什麼在這裡重算而不是從 command.ts 匯出】`leaderDistance` 是那個模組的
 * 私有函數，為了一行遙測把它公開會讓「誰可以問到達判定」這件事變模糊。這裡
 * 逐字重寫五行，並且**刻意讀同一份 `commandUnits` 快照** —— 若快照與飛機
 * 本體不同步，這一行印出來的就會與「我離」矛盾，那本身就是線索。
 */
function leaderLabel(point: Vector3): string {
  const f = battle.flights.flightOf[player.index] ?? -1
  const flight = f >= 0 ? battle.flights.flights[f] : undefined
  if (flight === undefined) return '長機 無編制'
  for (let i = 0; i < flight.count; i++) {
    const idx = flight.members[i]!
    const u = battle.commandUnits[idx]
    if (u === undefined || !u.alive) continue
    const d = Math.hypot(u.position.x - point.x, u.position.y - point.y, u.position.z - point.z)
    return `長機 #${idx} 離 ${d.toFixed(0)} m`
  }
  return '長機 全滅'
}

const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })
let lastTime = performance.now()
let elapsed = 0
/** 這一場從 `elapsed` 的哪一刻開始 —— `elapsed` 是全域幀鐘，跨場不歸零 */
let battleStartedAt = 0
/**
 * 分出勝負的那一刻，`-1` = 還在打。
 *
 * 【為什麼要記】主迴圈在結算之後照樣跑，用 `elapsed` 去算用時的話，
 * 戰報上的「幾分幾秒」會在玩家看著它的時候繼續往上跳。
 */
let battleEndedAt = -1
/** 結算板畫過了沒 —— 它是靜止的，一場只要畫一次 */
let aarDrawn = false
/** 按住 TAB 的即時看板下一次重畫的時刻，s */
let boardNextDraw = 0
/**
 * 即時看板的重畫週期，s。
 *
 * 【為什麼不是每幀】40 列的 `innerHTML` 重建、外加瀏覽器重排整張表 ——
 * 一秒六十次是白做的：擊墜數一秒也不會變四次。
 */
const BOARD_PERIOD = 0.25
/**
 * 下一次印遙測的時間，s。
 *
 * 【為什麼是週期而不是按鍵】人工試飛看到異常時，手已經在操縱上了 ——
 * 要他再按一個鍵去標記，那一刻就過去了。定期印讓他事後往回捲就找得到。
 */
let telemetryAt = 0
const TELEMETRY_PERIOD = 15

/**
 * 玩家那一架**目前**握著的命令物件，用來認同一性。`null` = 沒有命令。
 *
 * 【為什麼要認同一性而不是只印 `kind`】`spentSeconds` 是 3 秒、`planPeriod`
 * 是 2 秒 —— 一張命令解除之後，只要分隊仍然見底，五秒內就會發出新的一張。
 * 每 15 秒印一次 `kind` 的話，「一張握了 1600 秒」與「一百張各握 16 秒」
 * 印出來**一模一樣**，而這兩件事的診斷完全相反。
 *
 * 實機 log 卡過這裡：`命令 rally` 連續 1600 秒，而那份數據分不出集合令到底
 * 有沒有在解除。
 */
let orderRef: FlightOrder | null = null
/** `orderRef` 是在哪一秒換上來的 */
let orderSince = 0
/** 這一場總共發過幾張命令給玩家那一架。churn 的直接指標 */
let orderCount = 0

/** 每幀認一次玩家那一架的命令有沒有換人。換了就重新計時 */
function trackPlayerOrder(): void {
  const ctl = player.controller
  const now = ctl instanceof AiController ? ctl.order : null
  if (now === orderRef) return
  orderRef = now
  orderSince = elapsed
  if (now !== null) orderCount++
}

/**
 * 戰鬥中的一幀：推進、內插、特效、HUD、記分板。
 *
 * 【為什麼抽出來】選單期間這一整段都不該跑（沒有 `Battle`）。抽成函數
 * 之後 `frame` 只剩下一個分支，而搬家本身沒有改任何一行內容 ——
 * `main.ts` 沒有測試護著，這一步必須看得出來只是搬家。
 */
function stepAndDrawBattle(frameSeconds: number): void {
  trackPlayerOrder()
  // 世界固定瞄準點：滑鼠位移繞相機的右／上軸旋轉它。不夾制——相機跟著瞄準點
  // 走，準星恆在畫面正中央，「準星不能離開畫面」那個前提不存在了（見 input/aim.ts）。
  // 右鍵自由視角時 bindings 不累積 aimDelta，所以瞄準點原地不動，飛機繼續
  // 飛向玩家先前指的地方。
  //
  // 【軸取自 rig.viewBase 而不是 camera.quaternion】viewBase 不含自由視角
  // 偏移。轉頭時若拿實際相機姿態，滑鼠的螢幕座標軸會跟著轉頭一起轉。
  //
  // 【AI 接管時瞄準點鎖在機首】相機是跟著瞄準點走的。接管期間滑鼠仍然會
  // 累積位移，若照常套用，相機會被拖離飛機——而這個模式的全部意義就是
  // 「看清楚 AI 在幹嘛」。鎖在機首讓相機自然地跟拍。右鍵自由視角不受影響：
  // 它是 rig 之上的獨立偏移，不經過瞄準點。
  // ── 上帝視角的進出 ────────────────────────────────────
  // 【一定要排在讀 `input.playerAi` 之前】進入的那一幀就要代飛，否則會有
  // 一幀是「鏡頭已經飛走了但飛機沒人在開」
  if (input.godView !== wasGodView) {
    // 【兩個方向都從相機現在的姿態開始過渡】這裡是幀首，相機還停在上一幀
    // 的姿態 —— 那正是玩家眼前的畫面。下面各自算出目的姿態後由 `applyBlend`
    // 拉回起點的比例，所以進去與回來走的是同一條路
    startBlend(godBlend, ctx.camera)
    if (input.godView) {
      input.playerAi = true
      // 【用算繪位置而不是物理位置】這裡是幀首，算繪位置是上一幀內插的
      // 結果 —— 那正是玩家最後看到的那個位置
      enterGodCamera(
        godCam,
        visuals.get(player)!.position,
        headingFromOrientation(player.aircraft.state.orientation),
      )
    } else {
      // 【一律關掉代飛】直接對應「取消上帝視角後就回到我自己飛」。副作用
      // 是進入前就開著的 `I` 也會被關掉，刻意不記憶原本的值
      input.playerAi = false
      // 【相機要重新吸附】不吸附的話它會從上帝位置一路彈簧飛回來
      rig.snapTo(input.aimWorld)
    }
    wasGodView = input.godView
  }
  const aiFlying = input.playerAi
  // 【死亡鏡頭】玩家陣亡到接手之間的那 2 秒：位置定在死亡點（殘骸化之後
  // `Visual.position` 就不再更新，而相機讀的正是它），視線平滑轉向擊殺者。
  // 這段期間滑鼠不該做任何事 —— 已經沒有飛機可以操縱了。
  const dying = battle.takeoverSeat >= 0
  // 【死掉的那一刻就把畫面擦乾淨】歸零過載只讓黑視「不再累積」，已經累積的
  // 那一份要 2.4 s 才退得掉（`RECOVERY_TIME`），比死亡鏡頭本身還長。
  if (dying && !wasDying) {
    resetGEffect()
    resetDamageMarks(hudFrame.damageMarks)
    // 視角退回機外、取消右鍵轉頭 —— 死亡鏡頭只在機外、只看擊殺者
    enterDeathCam(input)
  }
  // 輸入層靠它擋掉死亡鏡頭期間的右鍵與 B；接手完成的那一幀自動解除
  input.dead = dying
  wasDying = dying
  if (input.godView) {
    // 【上帝分支排在 `dying` 之前】排在後面的話，陣亡那 2 秒 `lookX/lookY`
    // 不再更新、而下面的清除又被 `if (!input.godView)` 擋住 —— 鏡頭會以
    // 上一幀的位移**等速自轉**兩秒。spec §7.1 說死亡不影響上帝視角，
    // 只有這個順序做得到
    //
    // 【瞄準點鎖在機首】與 `I` 同一個理由：切回來時飛機才不會被一個舊的
    // 瞄準點硬扯過去。滑鼠位移在下面被鏡頭吃掉，不進 `slewAimWorld`
    input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
    input.firing = false
    godInput.lookX = input.aimDeltaX
    godInput.lookY = input.aimDeltaY
  } else if (dying) {
    const killerSeat = battle.takeoverKiller
    deathCamAim(
      input.aimWorld,
      visuals.get(player)!.position,
      // 兇手在這 2 秒裡也可能死掉；那時他的位置停在自己的墜落點，
      // 鏡頭看過去仍然是對的畫面
      killerSeat >= 0 ? world.combatants[killerSeat]!.aircraft.state.position : null,
      frameSeconds,
    )
    input.firing = false
  } else if (aiFlying) {
    input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
    // 左鍵失效：開火完全由 AI 的開火紀律決定
    input.firing = false
  } else if (input.viewMode === 'bomb') {
    // 【投彈模式凍結瞄準點】瞄準點就是飛行指令，而 `slewAimWorld` 的旋轉軸
    // 取自相機 —— 相機一朝下，滑鼠的語意就變了。凍結它、指揮儀照舊追它，
    // 等於「保持航向與姿態」。什麼都不做就是凍結。
    //
    // 下面照舊歸零 `aimDelta`：不歸零的話位移會累積到離開投彈模式的那一幀，
    // 鏡頭一次噴過去
  } else {
    slewAimWorld(
      input.aimWorld, input.aimDeltaX, input.aimDeltaY,
      rig.viewBase, ctx.camera.fov * DEG,
    )
  }
  input.aimDeltaX = 0
  input.aimDeltaY = 0
  // 【不在上帝視角時要清掉】留著的話，下次進上帝視角的第一幀會吃到一個
  // 陳年的位移，鏡頭會跳一下
  if (!input.godView) {
    godInput.lookX = 0
    godInput.lookY = 0
  }

  // 【陣亡等待接手的期間不換控制器】那一架已經退場，`World.step` 根本不會
  // 呼叫它的控制器；而交還那一支會把瞄準點拉回機首 —— 死亡鏡頭正在用它。
  if (dying) {
    // 什麼都不做
  } else if (aiFlying && player.controller !== playerAi) {
    player.controller = playerAi
  } else if (!aiFlying && player.controller !== playerController) {
    player.controller = playerController
    // 交還操縱時把瞄準點留在機首，玩家才不會被一個舊的瞄準點硬扯過去
    input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
  }

  // 【hitsDealt 必須在回呼裡累加】World.step 在每個**物理步**開頭把它歸零，
  // 而一幀可能跑好幾步。若在幀尾才讀 player.hitsDealt，最後一步沒命中就整幀
  // 漏掉——連射時 X 標記會閃爍不定。
  let hitsThisFrame = 0
  // 【必須在物理之前】接在幀尾的話，新的一場第一幀的 AI 是用「沒有地形」
  // 在飛 —— 而那一幀正好是最可能有人貼著島出生的時候
  wireTerrain()
  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    stepBattle(battle, dt)
    // 【緊接在物理步之後】增援是 `stepBattle` 裡的節拍加進去的，而幀尾的
    // 內插迴圈假設每個座位都有模型。空手而回時這一行只是一次整數比較
    syncVisuals()
    // 【在物理步裡推，不在幀尾】一幀可能跑好幾個物理步，而倒數吃的是
    // 物理時間 —— 在幀尾推的話界外的秒數會隨幀率漂
    const pp = player.aircraft.state.position
    stepArena(arena, pp.x, pp.y, pp.z, dt)
    hitsThisFrame += player.hitsDealt
    // 【事件必須在回呼裡排空】與上面 hitsDealt 同一個理由：World 在每個
    // 物理步產生事件，而一幀可能跑好幾步。在幀尾才讀的話，最後一步以外
    // 的火花與水柱全部漏掉（M7 spec §2.2）。
    //
    // 相機位置用的是上一幀的 —— 火花的剔除半徑是 800 m，而相機一幀移動
    // 不到 4 m，差異在剔除判斷上看不出來。
    sparks.emit(
      world.hitEvents, ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z,
    )
    splashes.emit(world.splashEvents, terrain.heightAt, elapsed)
    clearImpacts(world.hitEvents)
    clearImpacts(world.splashEvents)
    // 【只取玩家自己的】World 不知道誰是玩家，所以它對每一架都推
    // （受擊方向指示器 spec §3.1）。過濾在這裡做。
    //
    // 【相機用的是上一幀的姿態】`rig.update` 排在物理迴圈之後 —— 硬轉
    // 90°/s、一幀 16 ms 下的誤差是 1.4°，對一個 70° 寬的光團看不出來。
    // 為了少一幀而多開一個暫存緩衝，複雜度換不到任何看得見的東西（spec §6.1）。
    const dmg = world.damageEvents
    if (dmg.count > 0) {
      DAMAGE_VIEW.copy(ctx.camera.quaternion).invert()
      for (let i = 0; i < dmg.count; i++) {
        const o = i * DAMAGE_STRIDE
        if (dmg.data[o]! !== player.index) continue
        DAMAGE_DIR.set(dmg.data[o + 1]!, dmg.data[o + 2]!, dmg.data[o + 3]!)
          .applyQuaternion(DAMAGE_VIEW)
        pushDamageMark(hudFrame.damageMarks, DAMAGE_DIR.x, DAMAGE_DIR.y, DAMAGE_DIR.z)
      }
    }
    clearDamage(dmg)
    // 【火球與零件走事件】它們是世界錨定的一次性效果，用事件裡的子步位置
    // ——與火花同一個理由（M7 spec §2.2）。**玩家自己被擊墜時也要有**，
    // 而那正是「每幀比對 alive」做不到的事（M8 spec §2.1）
    emitKillBlasts(world.killEvents)
    emitGroundKills(world.groundKillEvents)
    debris.emit(world.killEvents, debrisColorOf)
    clearKills(world.killEvents)
    // 【炸彈的落點也走事件】`World` 只判水陸並推一筆，配方由這裡選
    emitBombBlasts(world.bombEvents)
    // 【起火要排在排空之前】兩份事件都在這個物理子步裡就被清掉了；等到
    // 幀率區段才讀的話它們已經是空的，火點永遠是 0 而且不報錯
    lightShipFires(shipFires, world.bombEvents, world.ships)
    clearImpacts(world.bombEvents)
    // 【魚雷的兩條管道】引爆走水冠、入水與航跡走水花。兩者都在物理子步裡
    // 消費 —— 一枚魚雷跑 91 秒會推出 250 筆航跡，累到幀尾會滿
    emitTorpedoBlasts(world.torpedoEvents)
    lightShipFires(shipFires, world.torpedoEvents, world.ships)
    clearImpacts(world.torpedoEvents)
    emitSpray(spray, world.torpedoWakeEvents, WAKE_SPRAY_COUNT)
    clearImpacts(world.torpedoWakeEvents)
    // 【黑雲與火花同一個約定】`World` 只推事件，排空是呼叫端的責任。
    // 傷害那一半 `World` 自己在物理步裡就吃掉了（見 `stepBursts`）。
    emitFlakBursts(flakBursts, world.burstEvents)
    // 爆點的閃光與小火球走爆炸那一組池；黑雲留在上面那個池
    emitFlakBlasts(BLAST_POOLS, world.burstEvents)
    clearBursts(world.burstEvents)
    perf.endPhysics()
  })

  // 【玩家陣亡不再重生】M9 起改為接手僚機（`stepBattle` 的 takeover），
  // 舊機體於是像所有人一樣被殘骸池接管 —— M8 spec §10 預告的那件事現在
  // 自動成立了。
  if (battle.player !== player) {
    player = battle.player
    playerAi.selfIndex = player.index
    playerAi.setDecisionPhase(player.index / world.combatants.length)
    // 換了機體就換了位置，上一個座位的地形承諾不再適用
    playerAi.clearTerrainState()
    // 眼點是量出來的座艙位置，一機一個值 —— 兩隊機種不同時位置不一樣
    rig.options.firstPersonOffset.copy(visuals.get(player)!.model.eyePoint)
    syncBombLoad()
    fitCameraToPlayer()
    // 【瞄準點要放回機首】不放的話它還指著舊機體墜落前指的地方（多半是
    // 海面），接手的第一瞬間新機就被硬扯下去 —— 與 `I` 交還操縱時把瞄準點
    // 留在機首是同一條理由。必須排在 snapTo 之前，相機吃的是它。
    input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
    // 【相機要瞬移過去】不 snap 的話會從舊機體的位置一路飛到新機體，
    // 那是一段跨越幾百公尺的鏡頭
    rig.snapTo(input.aimWorld)
    // 接手前八成正在拉大 G；不清掉的話接手後畫面還是黑的
    resetGEffect()
    // 打死上一架的那些方向不屬於新的這一架
    resetDamageMarks(hudFrame.damageMarks)
  }

  // reset 會把 prevPosition 一併設為新位置，因此重置不會被內插成一條
  // 橫跨半個地圖的殘影。
  propRotation += frameSeconds * (8 + input.throttle * 60)
  for (const c of world.combatants) {
    const v = visuals.get(c)!
    // 模型已經交給殘骸池，位置與旋轉從此由它寫
    if (v.wrecked) continue

    v.position.lerpVectors(c.aircraft.prevPosition, c.aircraft.state.position, alpha)
    v.quaternion.slerpQuaternions(c.aircraft.prevOrientation, c.aircraft.state.orientation, alpha)
    v.model.group.position.copy(v.position)
    v.model.group.quaternion.copy(v.quaternion)

    if (!c.alive) {
      // 【殘骸的判準是「還有沒有人要用這個模型」，不是「這是不是玩家」】
      // M9 起玩家陣亡改為接手僚機，他的 alive 維持 false —— 這一段一個字
      // 都不用改就自動替玩家的舊機體留下殘骸（M8 spec §10 預告的那件事）。
      //
      // 【為什麼先內插再接管】殘骸的起始姿態必須接在畫面上最後看到的位置。
      // 用擊墜事件裡的子步位置會跳最多 0.83 m（M8 spec §3.1）。
      v.wrecked = true
      const vel = c.aircraft.state.velocity
      wrecks.adopt(v.model, c.aircraft.spec.hitBoxes, vel.x, vel.y, vel.z, c.index)
      continue
    }

    v.model.group.visible = true
    v.model.setPropSpin(propRotation, c.command.throttle > 0.15)

    // 【翼尖凝結尾】接線點在 `v.wrecked` 與 `!c.alive` 的 continue 之後 ——
    // 翻滾的殘骸沒有升力，本來就不該冒尾跡，那是免費得到的。
    //
    // 【用 v.position / v.quaternion 而不是 c.aircraft.state.*】尾跡要接在
    // **畫面上看到的**翼尖，不是物理子步的位置。與殘骸接管用 `v` 的理由
    // 完全相同（見上方那段註解）。
    //
    // 【翼尖寫在造型檔上】每一台的機翼位置都不一樣，見 `HullSpec.wingTip`。
    const tip = v.model.wingTip
    TIP_L.set(-tip.x, tip.y, tip.z).applyQuaternion(v.quaternion).add(v.position)
    TIP_R.set(tip.x, tip.y, tip.z).applyQuaternion(v.quaternion).add(v.position)
    vortex.emit(
      c.index, c.aircraft.diag.loadFactor,
      TIP_L.x, TIP_L.y, TIP_L.z,
      TIP_R.x, TIP_R.y, TIP_R.z,
    )
  }
  const renderPos = visuals.get(player)!.position
  const renderQuat = visuals.get(player)!.quaternion
  // 【地形跟著**鏡頭**走】海面網格是以中心點捲動的（`ocean.ts`），跟著
  // 飛機的話鏡頭飛遠之後畫面上會看到網格的邊。
  //
  // 【這不影響物理】`terrain.heightAt(x, z, time)` 只吃世界座標與時間，
  // 與 `update` 的中心點無關 —— 撞地判定因此不會被鏡頭改到
  if (input.godView) terrain.update(elapsed, godCam.position.x, godCam.position.z)
  else terrain.update(elapsed, renderPos.x, renderPos.z)

  const aircraft = player.aircraft
  // HUD 的迎角條與 STALL 字樣都拿它當分母
  const alphaCrit = aircraft.spec.lift.alphaCrit +
    (aircraft.diag.slatsDeployed ? aircraft.spec.lift.slatAlphaBonus : 0)

  // ── 彈艙 ──────────────────────────────────────────────
  //
  // 【**必須在所有視角分支之外**】彈艙是機械，與鏡頭在哪裡無關：關進任何一個
  // 視角分支，回補與連投節拍就會在那個視角之外凍住。`bomb-bay-wiring.test.ts`
  // 守這一條。
  //
  // 【扣扳機不必另外擋】上帝視角與代飛在上面已經把 `input.firing` 設成 false，
  // 所以 `press` 恆為 false —— 那兩個模式投不出彈，但連投剩下的幾枚照節奏
  // 投完、回補照走。
  //
  // 【投彈點每幀都算】連投中途換視角時，剩下那幾枚要從當下的位置出去。
  // 【包絡每幀都算】它是準星的顏色，而準星在一般飛行時也畫
  const att = attitudeFromOrientation(renderQuat)
  const agl = renderPos.y - terrain.collisionHeightAt(renderPos.x, renderPos.z)
  // 【包絡與 agl 只解一次】HUD 的投放閘門與高度弧讀的必須是**這兩個值**，
  // 不是各自再查一次 —— 分家的症狀是「錶上綠燈而扳機沒有反應」，不拋例外
  // 也沒有訊息
  const releaseEnv = playerLoadout !== null ? envelopeFor(playerLoadout.kind) : null
  const releaseOk = releaseEnv !== null && canRelease(
    releaseEnv, att.roll, att.pitch, agl, aircraft.diag.aero.tas,
  )

  const bp = visuals.get(player)!.model.bombPoint
  if (bp !== null) {
    BOMB_EYE.copy(bp).applyQuaternion(renderQuat).add(renderPos)
    const press = input.viewMode === 'bomb' && input.firing && !bombWasFiring
    stepBombBay(playerBay(), frameSeconds, press, releaseOk, () => {
      const v = player.aircraft.state.velocity
      const damage = playerLoadout?.damage ?? 0
      if (playerLoadout?.kind === 'torpedo') {
        // 【機首的水平方向要一起送】垂直入水那種退化情況沿用它，而那件事
        // **不能從退化的速度反推**
        noseHorizontal(renderQuat, NOSE_H)
        world.dropTorpedo(
          BOMB_EYE.x, BOMB_EYE.y, BOMB_EYE.z, v.x, v.y, v.z, damage,
          NOSE_H.x, NOSE_H.z, teamSlot(player.team),
        )
      } else {
        world.dropBomb(
          BOMB_EYE.x, BOMB_EYE.y, BOMB_EYE.z, v.x, v.y, v.z, damage,
          teamSlot(player.team),
        )
      }
    })
  }
  // 【離開投彈模式就清掉邊緣】不清的話回到投彈模式時，按著的那一下會被讀成
  // 一次新的扣扳機
  bombWasFiring = input.viewMode === 'bomb' && input.firing

  let bombTarget: Vector3 | null = null
  let bombState: 'off' | 'solved' | 'none' = 'off'
  if (input.godView) {
    godInput.forward = input.godMove.forward
    godInput.back = input.godMove.back
    godInput.left = input.godMove.left
    godInput.right = input.godMove.right
    godInput.up = input.godMove.up
    godInput.down = input.godMove.down
    godInput.boost = input.godMove.boost
    stepGodCamera(godCam, godInput, frameSeconds)
    ctx.camera.position.copy(godCam.position)
    ctx.camera.up.set(0, 1, 0)
    ctx.camera.lookAt(godCameraTarget(godCam, godTarget))
    // 【FOV 固定】隨速度變化的那一份吃的是飛機的 TAS，在這裡沒有意義
    if (Math.abs(ctx.camera.fov - DEFAULT_CAMERA_OPTIONS.fovBase) > 0.01) {
      ctx.camera.fov = DEFAULT_CAMERA_OPTIONS.fovBase
      ctx.camera.updateProjectionMatrix()
    }
  } else {
    // 【落點要在 rig.update 之前解】投彈模式下相機的視線就是指向它
    //
    // 【不看視角】落點是飛行狀態的函數，算得出來一般飛行也標得出來（HUD 的
    // `bombsight` 在兩種模式都畫，只差顏色）。上帝視角則整段跳過 —— 那裡連
    // 落點圈都不畫。
    if (bp !== null) {
      bombState = 'none'
      BOMB_START.x = BOMB_EYE.x; BOMB_START.y = BOMB_EYE.y; BOMB_START.z = BOMB_EYE.z
      const v = player.aircraft.state.velocity
      BOMB_START.vx = v.x; BOMB_START.vy = v.y; BOMB_START.vz = v.z
      // 【dt 用 loop.stepSeconds 而不是 frameSeconds】預測必須與空中的
      // 炸彈同一個步長，那條護欄的整個重點就在這裡
      if (solveImpact(BOMB_START, world.bombDrag, world.groundAt, loop.stepSeconds, BOMB_IMPACT)) {
        BOMB_POINT.set(BOMB_IMPACT.x, BOMB_IMPACT.y, BOMB_IMPACT.z)
        bombState = 'solved'
        // 【只有投彈模式把落點交給相機】一般飛行時鏡頭跟的是瞄準點
        if (input.viewMode === 'bomb') bombTarget = BOMB_POINT
      }
    }
    // 相機看的是**瞄準方向**而不是機首方向：準星釘在畫面中央，跟不上的是飛機
    rig.update(
      ctx.camera, renderPos, renderQuat, input.aimWorld, aircraft.diag.aero.tas,
      input.viewMode, input.lookYaw, input.lookPitch, frameSeconds, bombTarget,
    )
  }
  // 【排在兩個分支之後】上面算出來的是這一幀的目的姿態，過渡把它往按 G
  // 那一刻的姿態拉回一部分；過渡結束後這一行什麼都不做
  applyBlend(godBlend, ctx.camera, frameSeconds)

  tracers.update(world.projectiles)
  bombVisuals.update(world.bombs)
  torpedoVisuals.update(world.torpedoes)
  // 【火災走畫面時間，不是物理子步】它是純裝飾 —— 與 `sparks.step` 同一條
  stepShipFires(shipFires, world.ships, frameSeconds, emitFirePuff)
  stepGroundFires(groundFires, frameSeconds, emitFirePuff)
  // 【槍焰用內插姿態】它是一個狀態而不是一個瞬間，所以位置在這裡重算 ——
  // 用物理位置的話槍焰會相對機身抖動一個子步的位移（M7 spec §2.1）
  muzzles.update(world.combatants, renderPositions, renderQuaternions)
  // 【砲塔的槍管也用內插姿態】理由與槍焰完全相同
  turretBarrels.update(world.combatants, renderPositions, renderQuaternions)
  turretMuzzles.update(world.combatants, renderPositions, renderQuaternions)
  // 【火花與水柱在幀率積分】純裝飾，不參與判定也不需要決定性
  sparks.step(frameSeconds)
  // 【殘骸與零件先步進，再把它們吐出來的事件餵給煙、噴濺與水柱】兩者的
  // 事件緩衝在各自的 step 開頭排空，所以這裡讀到的恆是這一幀的
  // 【落地與落水用兩支不同的函式】`heightAt` 決定「碰到地面了沒」，
  // `waterAt` 決定「那是水嗎」。共用一支的話摔在島上會噴水柱
  wrecks.step(frameSeconds, terrain.heightAt, terrain.waterAt, elapsed)
  debris.step(frameSeconds, terrain.heightAt, terrain.waterAt, elapsed)
  emitSmoke(smoke, wrecks.smokeEvents)
  emitSmoke(smoke, debris.smokeEvents, DEBRIS_SMOKE_SIZE)
  emitSpray(spray, wrecks.sprayEvents, WRECK_SPRAY_COUNT)
  emitSpray(spray, debris.sprayEvents, DEBRIS_SPRAY_COUNT)
  // 殘骸入水的那一圈水柱沿用 M7 的池子 —— 用數量換規模，splash.ts 不用改
  splashes.emit(wrecks.splashEvents, terrain.heightAt, elapsed)
  // 零件入水各濺一根小水柱。與噴濺讀同一份事件：同一次入水的兩個表現，
  // 位置相同。高低粗細由 splashSize 依格子隨機
  splashes.emit(debris.sprayEvents, terrain.heightAt, elapsed)
  splashes.step(frameSeconds)
  fireball.step(frameSeconds)
  smoke.step(frameSeconds)
  shipFireSmoke.step(frameSeconds)
  // 【爆炸那一組】水冠要在水霧之前 —— 它的 `onFade` 會往水霧池發射，
  // 同一幀生的那幾團才不會被水霧自己的 `step` 漏掉一幀
  blastJets.step(frameSeconds)
  blastChunks.step(frameSeconds)
  blastGlow.step(frameSeconds)
  blastEmber.step(frameSeconds)
  blastSmoke.step(frameSeconds)
  blastDust.step(frameSeconds)
  blastMist.step(frameSeconds)
  flakBursts.step(frameSeconds)
  // 【船在渲染幀率更新，不在物理步】它讀的是船的位置與砲位的槍焰計時器，
  // 兩者都是狀態不是事件 —— 與飛機模型同一個道理。
  groundModels?.update(world.groundTargets)
  shipModels?.update(world.ships, (x, y, z) => {
    // 砲位被打掉：當場一團火。**借火球池**，不另開一套。
    for (let k = 0; k < FIREBALL_COUNT; k++) {
      GUN_LOST_DIR.set(
        Math.cos(k * 2.39963) * 0.7, Math.abs(Math.sin(k * 1.7)) * 0.9, Math.sin(k * 2.39963) * 0.7,
      ).normalize()
      fireball.emit(
        x, y, z,
        GUN_LOST_DIR.x * FIREBALL_SPEED * 0.5,
        GUN_LOST_DIR.y * FIREBALL_SPEED * 0.5,
        GUN_LOST_DIR.z * FIREBALL_SPEED * 0.5,
      )
    }
  })
  // ── 魚雷的航跡 ───────────────────────────────────────
  //
  // 【在渲染幀率餵，不在物理步】帶子是視覺，取樣間隔由它自己按走過的距離
  // 決定 —— 與凝結尾同一個做法
  {
    const t = world.torpedoes
    for (let i = 0; i < t.capacity; i++) {
      // 【只有水中段有航跡】空中那一段沒有東西可以翻起泡沫
      if (t.active[i] === 0 || t.phase[i] !== 1) continue
      wakes.emit(i, t.x[i]!, t.z[i]!, t.serial[i]!)
    }
  }
  // 【高度交給它自己每幀問】帶子要跟著看得見的浪起伏，否則會被浪蓋掉
  wakes.step(frameSeconds, elapsed, terrain.heightAt)
  vortex.step(frameSeconds)
  spray.step(frameSeconds)

  // ── 集合點的可視化（`O`）───────────────────────────────
  // 【觀測工具，不進任何模擬】只讀指揮層的狀態，不寫。
  //
  // 【為什麼要有它】集合令的到達判定是「長機進到 `order.radius` 以內」，而
  // `rallyAim` 對那個點是**純追擊、沒有抵達行為** —— 迴轉半徑大於半徑時，
  // 長機會在球外面繞著它盤旋而永遠判不到達。那個現象在無頭模擬裡重現不
  // 出來，但畫出來就一眼看得到。
  //
  // 【為什麼用 `state.position` 而不是內插後的位置】這條線只是要看「離多
  // 遠」，一個物理步的抖動（240 Hz）在 300 m 的尺度下看不出來，而拿內插
  // 位置要把整個 combatants 迴圈的暫存搬出來。
  orderMarkers.setVisible(input.orderMarkers)
  if (input.orderMarkers) fillOrderView(battle, orderMarkers)

  // 【撤離圓環一定要排在 renderer.render 之前】billboard 的 `lookAt` 讀的是
  // 相機**這一幀**的位置。排在渲染之後的話環會慢整整一幀（3D 在這裡畫、
  // HUD 到 `hud.render` 才畫），而且新建的第一幀會停在原點、半徑 1。
  if (battle.mission.hasTarget) {
    // 【中途才出現的撤離點】場景歸屬在 `enterBattle` 決定過一次，而返航節拍
    // 是在戰鬥進行中把任務換成撤離的 —— 不在這裡補的話，環每一幀照常更新
    // 位置與半徑，卻永遠不在場景裡
    if (objectiveRing.object.parent === null) ctx.scene.add(objectiveRing.object)
    objectiveRing.update(battle.mission.target, battle.mission.targetRadius, ctx.camera)
  }

  ctx.renderer.render(ctx.scene, ctx.camera)

  // 兩個準星都從**內插後的機身位置**往外投影 1000 m，所以它們的分離距離
  // 就是指揮儀正在追的角度誤差，而不是被相機視差污染過的東西。
  probe.set(0, 0, -1).applyQuaternion(renderQuat)
    .multiplyScalar(HUD_PROJECT_DISTANCE).add(renderPos).project(ctx.camera)
  hudFrame.noseX = probe.x
  hudFrame.noseY = probe.y
  hudFrame.noseVisible = probe.z < 1

  // 投彈落點。**照 noseX/noseY 同一條路**：世界點 → NDC。
  //
  // 【為什麼要投影而不是寫死在畫面中央】相機自動盯落點，所以解穩定時圓圈
  // 確實在中心；但視線的 LERP 會在機動時把它拖開，而那個分離量正是要看的
  // 東西 —— 「投彈解還沒收斂」。
  hudFrame.bombState = bombState
  hudFrame.bombing = input.viewMode === 'bomb'
  hudFrame.bombCapable = input.bombCapable
  hudFrame.ordnance = playerLoadout?.kind ?? null
  hudFrame.releaseOk = releaseOk
  // 【就是餵給 `canRelease` 的那一組】不是各自再查一次 —— 見上面 releaseEnv
  hudFrame.releaseEnv = releaseEnv
  hudFrame.releaseAgl = agl
  const bay = playerBay()
  hudFrame.bombBayCapacity = bay.capacity
  hudFrame.bombLoad = bay.load
  hudFrame.bombReloading = bay.reloading
  hudFrame.bombReloadLeft = bay.reloading ? bay.timer : 0
  hudFrame.bombVisible = false
  hudFrame.runCount = 0
  if (bombState === 'solved') {
    BOMB_NDC.copy(BOMB_POINT).project(ctx.camera)
    hudFrame.bombX = BOMB_NDC.x
    hudFrame.bombY = BOMB_NDC.y
    hudFrame.bombVisible = BOMB_NDC.z < 1 &&
      Math.abs(BOMB_NDC.x) <= 1 && Math.abs(BOMB_NDC.y) <= 1
    // 【落點是水才有水中段】`solveImpact` 撞到**任何**地面都回成功，而真雷
    // 遇到陸地或無水是立刻結束（`world/torpedo.ts` 的 `stepAir`）—— 判準逐字
    // 沿用它，不得改用含浪的高度、也不得寫成 `> 雷體高度`。少了這一條，
    // 飛過島嶼或內陸農地時會畫出一條不存在的 2 km 水中航跡
    const onWater = playerLoadout?.kind === 'torpedo' && torpedoEntersWater(
      terrain.collisionHeightAt(BOMB_POINT.x, BOMB_POINT.z),
      terrain.waterAt(BOMB_POINT.x, BOMB_POINT.z),
    )
    if (onWater) {
      const v = player.aircraft.state.velocity
      noseHorizontal(renderQuat, NOSE_H)
      torpedoHeading(v.x, v.z, NOSE_H.x, NOSE_H.z, TORP_DIR)
      for (let k = 0; k < TORPEDO_RUN_SAMPLES; k++) {
        const d = runSampleDistance(k)
        RUN_WORLD.set(
          BOMB_POINT.x + TORP_DIR[0]! * d,
          BOMB_POINT.y,
          BOMB_POINT.z + TORP_DIR[1]! * d,
        )
        RUN_NDC.copy(RUN_WORLD).project(ctx.camera)
        hudFrame.runX[k] = RUN_NDC.x
        hudFrame.runY[k] = RUN_NDC.y
        RUN_Z[k] = RUN_NDC.z
      }
      hudFrame.runCount = runFrontCount(RUN_Z, TORPEDO_RUN_SAMPLES)
    }
  }

  // 瞄準點是世界方向（Task 19），螢幕位置得自己投影。NDC 的 x 乘上長寬比
  // 才會換成「螢幕半高」。相機追著它，所以這一組值正常情況下都貼近 0。
  probe.copy(input.aimWorld)
    .multiplyScalar(HUD_PROJECT_DISTANCE).add(renderPos).project(ctx.camera)
  hudFrame.aimX = probe.x * ctx.camera.aspect
  hudFrame.aimY = probe.y
  hudFrame.aimVisible = probe.z < 1

  // 【姿態上面已經算過】投放包絡與 HUD 讀的是同一組值
  hudFrame.tas = aircraft.diag.aero.tas
  hudFrame.ias = indicatedAirspeed(aircraft.diag.aero.tas, aircraft.diag.air.sigma)
  hudFrame.vneRatio = hudFrame.ias / aircraft.spec.limits.vne
  hudFrame.mach = aircraft.diag.aero.mach
  hudFrame.altitude = renderPos.y
  hudFrame.verticalSpeed = aircraft.state.velocity.y
  hudFrame.heading = headingFromOrientation(renderQuat)
  // 【小地圖是機首朝上的，上帝視角下要改成鏡頭朝上】
  if (input.godView) hudFrame.heading = godCam.yaw
  hudFrame.roll = att.roll
  hudFrame.pitch = att.pitch
  // 【陣亡期間過載歸 1】退場的飛機不再被 `world.step` 推進，`diag.loadFactor`
  // 於是**凍結**在死亡當下。玩家多半是在拉大 G 的時候被打下來的，照抄的話
  // 黑視會在那 2 秒繼續累積（`ONSET_TIME` 1.6 s）—— 死亡鏡頭的全部意義是
  // 看得見自己的火球與零件，隔著半黑的畫面看就什麼都不剩了。
  hudFrame.loadFactor = dying ? 1 : aircraft.diag.loadFactor
  hudFrame.alpha = aircraft.diag.aero.alpha
  hudFrame.alphaCrit = alphaCrit
  hudFrame.ps = aircraft.specificExcessPowerActual
  hudFrame.es = aircraft.specificEnergy
  // 【讀 controls 而不是 input】兩者在玩家駕駛時完全相同，但 AI 接管時
  // input.throttle 還停在玩家鬆手前的值，顯示出來會與飛機實際在跑的油門不符。
  hudFrame.throttle = aircraft.controls.throttle
  hudFrame.powerW = aircraft.diag.powerW
  // 【上帝視角下小地圖以鏡頭為中心】小地圖吃的就是這三個欄位，所以
  // widget 一行都不用改
  hudFrame.arenaOutside = arena.outside
  hudFrame.arenaRemaining = arena.remaining
  hudFrame.worldX = input.godView ? godCam.position.x : renderPos.x
  hudFrame.worldZ = input.godView ? godCam.position.z : renderPos.z
  hudFrame.aircraftName = aircraft.spec.name
  hudFrame.hp = player.hp
  hudFrame.hpMax = player.aircraft.spec.hp
  hudFrame.aiFlying = input.playerAi
  // 【只在代飛時填】不代飛時 `playerAi` 沒有在跑，那三個欄位是上一次的殘值
  if (input.playerAi) {
    hudFrame.aiIntent = playerAi.intent
    hudFrame.aiMode = playerAi.mode
    hudFrame.aiExtendWhy = playerAi.intent === 'extend'
      ? extendReason(playerAi.rules) : ''
  }
  hudFrame.godView = input.godView
  hudFrame.controlAuthority = aircraft.diag.controlAuthority
  hudFrame.blueAlive = aliveCount(battle.blue)
  hudFrame.redAlive = aliveCount(battle.red)

  // 【分隊存活】遞補之後 count 會自動變 —— members 每個物理步重新壓縮
  const flight = playerFlight(battle)
  hudFrame.flightAlive = flight?.count ?? 0
  hudFrame.flightSize = flight?.roster.length ?? 0

  /**
   * 【轟炸機沒有瞄準具】它們的槍全部是砲塔、由 AI 操作 —— 玩家沒有任何
   * 可扣扳機的武器，畫一個預瞄環會讓人以為按了會發射。
   *
   * 【判準用 mounts 而不是 role】要問的是「玩家扣得到扳機嗎」，而那正是
   * `battery.mounts` 的定義。用 `role === 'bomber'` 的話，日後若有哪一台
   * 轟炸機真的裝了固定前射武器，這裡會靜靜地漏掉它的預瞄環。
   */
  const hasFixedGuns = aircraft.spec.battery.mounts.length > 0

  // 【接觸點】畫全部，沒有距離門檻；預瞄環的條件是「真的打得到」。
  const sight = aircraft.spec.battery.sight
  // 【每幀取一次】玩家的分隊序號。編制每個物理步重新壓縮，所以陣亡、
  // 遞補、重生都不需要額外同步 —— flightOf 直接就是最新的
  const playerFlightIndex = battle.flights.flightOf[player.index]!
  // 【上帝視角下的基準點是鏡頭，不是自機】兩個地方吃它：
  //
  //   `refY`   小地圖的高度符號。平面已經以鏡頭重新置中（`worldX`/`worldZ`），
  //            高度基準卻還留在自機的話，三角形的上下與畫面上的位置對應不
  //            起來 —— 一架就在鏡頭正下方的飛機會被畫成「在你上方」。
  //   `refPos` `contact.range`，而 `radius` 由它推出來。
  //
  // 【`range` 也要跟著 `refPos`】拿 `renderPos`（玩家飛機）算的話，鏡頭
  // 飛到戰場另一頭時，框卻會因為**玩家飛機**靠近某架敵機而變大 ——
  // 分隊標示（`godMarkers`）的「框依距離縮放」吃的就是它。
  const refPos = input.godView ? godCam.position : renderPos
  const refY = refPos.y
  let n = 0
  for (const c of world.combatants) {
    // 【上帝視角下自機也要進接觸點】座艙裡排除自己是對的（你就坐在裡面），
    // 但上帝視角下中心是**鏡頭**不是自機 —— 不放進來的話，玩家自己那一架
    // （正被 AI 代飛，也就是這個模式最想看的東西）在小地圖上一個像素都沒有。
    // 池子夠：`HUD_MAX_CONTACTS` 48，20v20 最多 39 個他機。
    //
    // 【自機那一格的 `range` 是 0】上帝視角下鏡頭與自機是兩個東西，所以
    // `range` 不再恆為 0 —— 那是 `refPos` 改成鏡頭之後的直接後果（見上面）。
    // 恆為 0 的只剩「鏡頭正好貼在某架身上」那個退化情形，而 `radius` 的
    // `Math.max(range, 1)` 已經擋住除以零。
    if ((c === player && !input.godView) || !c.alive || n >= HUD_MAX_CONTACTS) continue
    const contact = hudFrame.contacts[n]!
    const v = visuals.get(c)!

    probe.copy(v.position).project(ctx.camera)
    contact.behind = probe.z >= 1
    contact.x = probe.x * ctx.camera.aspect
    contact.y = probe.y
    contact.range = v.position.distanceTo(refPos)
    // 【單位是螢幕半高】透視投影的 NDC y = tan(θ) / tan(fov/2)，而
    // tan(atan(halfSpan / range)) 就是 halfSpan / range——所以直接寫比值，
    // 不要繞一圈 atan（那會算成 θ / tan(fov/2)，近距離時低估框的大小）。
    contact.radius = ((c.aircraft.spec.wing.span / 2) / Math.max(contact.range, 1))
      / Math.tan((ctx.camera.fov * DEG) / 2)
    contact.hostile = c.team !== player.team
    // 【`playerFlightIndex >= 0` 這道守衛不能省】玩家退場時它是 −1，而場上
    // 每一架已退場者的 `flightOf` 也是 −1 —— 少了守衛就會 `-1 === -1`，
    // 一整批飛機被畫成隊友色。
    contact.flightMate = playerFlightIndex >= 0
      && battle.flights.flightOf[c.index] === playerFlightIndex
    // 【分隊標示只認長機】`compactFlights` 每個物理步重壓，所以長機陣亡時
    // 標示自動跳到繼任者，這裡不需要任何同步。玩家那一架恆為 true ——
    // 他釘死在 `members[0]`（`FlightIndex.pinned`）。
    const flight = flightOfCombatant(battle.flights, c.index)
    contact.flightLeader = isFlightLeader(battle.flights, c.index)
    contact.flightAlive = flight?.count ?? 0
    contact.flightSize = flight?.roster.length ?? 0
    contact.deltaY = v.position.y - refY
    contact.worldX = v.position.x
    contact.worldZ = v.position.z

    // 【預瞄環只給敵機】M5 起彈丸直接穿過友機（spec §2），所以友機的預瞄環
    // 指的是一個打不到的點——畫出來只會是「往這裡開槍」的錯誤暗示。19 架
    // 友機同時畫更是滿畫面的雜訊。順帶省掉每架一次的預瞄解。
    contact.leadValid = false
    if (contact.hostile && hasFixedGuns) {
      relPos.copy(c.aircraft.state.position).sub(aircraft.state.position)
      relVel.copy(c.aircraft.state.velocity).sub(aircraft.state.velocity)
      const t = solveLead(relPos, relVel, sight.muzzleVelocity, leadDir)
      contact.leadValid = t !== NO_INTERCEPT && t <= PROJECTILE_LIFETIME
      if (contact.leadValid) {
        leadProbe.copy(renderPos).addScaledVector(leadDir, HUD_PROJECT_DISTANCE).project(ctx.camera)
        contact.leadX = leadProbe.x * ctx.camera.aspect
        contact.leadY = leadProbe.y
        contact.leadBehind = leadProbe.z >= 1
      }
    }

    contact.active = true
    n++
  }
  hudFrame.contactCount = n

  // ── 彈藥與艦船的標記 ────────────────────────────────
  //
  // 【為什麼不塞進 `contacts`】接觸點那一格帶著預瞄環、分隊、目標框半徑、
  // 小地圖座標 —— 這三種東西一個都用不到，而池子只有 48 格：64 顆彈就把
  // 飛機全擠掉了。
  //
  // 【位置用池裡的物理座標，不內插】`bombVisuals`／`torpedoVisuals` 讀的
  // 就是同一組數字（見上面的 `update`），所以標記與模型逐幀對齊。飛機那一側
  // 用 `visuals` 是因為它有內插後的算繪位置，而彈藥沒有。
  MARKER_POOLS[0] = world.bombs
  MARKER_POOLS[1] = world.torpedoes
  fillMarkers(
    hudFrame, world.ships, world.groundTargets, MARKER_POOLS,
    teamSlot(player.team), projectMarker, shipMarkerTop,
  )

  // 命中回饋：World 在命中的那一步把 hitsDealt 加上去；HUD 這一層負責計時。
  hudFrame.hitFlash = nextHitFlash(hudFrame.hitFlash, hitsThisFrame, frameSeconds)
  // 【一幀一次，不是一個子步一次】淡出走的是畫面時間。在子步裡步進的話，
  // 一幀跑幾個子步就淡幾倍快 —— 而子步數會隨幀率變動。
  stepDamageMarks(hudFrame.damageMarks, frameSeconds)

  // ── 任務目標 ──────────────────────────────────────────
  //
  // 【`objectiveActive` 由 `mode` 給而不是由 rules 推導】遭遇戰與殲滅任務的
  // `rules` **完全相同**（任務框架 spec §5）—— 差別只在來路，那是畫面模式，
  // 不是規則。
  //
  // 【計量的種類跟著 `hasTarget` 走】有撤離點就顯示距離、沒有就顯示剩餘
  // 敵機數 —— 與 `stepMission` 寫進 `metric` 的意思逐條對應。
  const m = battle.mission
  hudFrame.objectiveActive = mode === 'mission'
  // 【撤離節拍改寫過的優先】它把 `mission` 換掉了，卡片上那一句已經不成立
  hudFrame.objectiveText = battle.objectiveText !== ''
    ? battle.objectiveText
    : pendingMission?.battle.objective ?? ''
  hudFrame.objectiveMetric = m.metric
  hudFrame.objectiveMetricKind = m.hasTarget ? 'distance' : 'count'
  // 【分母由 `mission.ts` 給】只有擊沉會填總艘數，其餘任務恆是 −1
  hudFrame.objectiveMetricTotal = m.metricTotal
  // 【−1 由 `mission.ts` 給】只有護送／攔截會填實際架數，其餘任務恆是 −1
  hudFrame.objectiveRemaining = m.remaining
  hudFrame.objectiveSeconds = m.secondsLeft
  hudFrame.objectiveHasTarget = m.hasTarget
  hudFrame.objectiveWorldX = m.target.x
  hudFrame.objectiveWorldZ = m.target.z
  // 【照抄，不在這裡判過期】`stepBeats` 已經依物理時間把過期的收掉了
  hudFrame.message = battle.message

  hud.render(hudFrame, frameSeconds)

  // 【只在看得到的時候才重建】40 列的 innerHTML 重建不便宜到可以每幀做
  const finished = battle.outcome !== 'fighting'
  // 【分出勝負就放開指標鎖】結算板的兩顆按鈕要點得到，而指標鎖定期間
  // 游標是被抓住的。解鎖會讓下一幀的 `pointerLockLost` 為真，但那個分支
  // 只在 `outcome === 'fighting'` 時才暫停 —— 所以不會誤觸
  if (finished && document.pointerLockElement === canvas) document.exitPointerLock()
  if (finished && battleEndedAt < 0) battleEndedAt = elapsed
  const showBoard = input.scoreboardHeld || finished
  // 【結算板畫一次，即時看板每 0.25 秒畫一次】兩者都是整表重建；結算板的
  // 內容在分出勝負的那一刻就定了，每幀重畫還會把玩家手動收起來的名單
  // 重新攤開、把他選起來的文字弄丟
  if (showBoard && (finished ? !aarDrawn : elapsed >= boardNextDraw)) {
    scoreboard.render(
      sortScoreRows(scoreRows(battle.roster, world.combatants, 'blue')),
      sortScoreRows(scoreRows(battle.roster, world.combatants, 'red')),
      finished ? (battle.outcome === 'victory' ? 'victory' : 'defeat') : null,
      finished ? afterAction() : null,
    )
    aarDrawn = finished
    boardNextDraw = elapsed + BOARD_PERIOD
  }
  // 【放開 TAB 就把節流歸零】下次按下去要立刻有東西，不能等剩下的週期
  if (!showBoard) boardNextDraw = 0
  scoreboard.setVisible(showBoard)
  // 【結算時才讓那兩顆按鈕出現，而且 #board 這時要能點】按住 TAB 看戰績
  // 的期間它是 pointer-events: none —— 那時它只是看
  boardActions.hidden = !finished
  // 【兩個出口依模式擇一】不逐幀改 `data-act` —— 它是選單那一層唯一的協定
  // （`menu.ts` 的事件委派註解），改它等於讓一個 DOM 屬性變成隱性狀態
  backToSetup.hidden = mode !== 'skirmish'
  backToMission.hidden = mode !== 'mission'
  pauseToMenu.hidden = mode !== 'skirmish'
  pauseAbandon.hidden = mode !== 'mission'
  boardEl.classList.toggle('finished', finished)
}

/**
 * 要求指標鎖定，被拒絕就算了。
 *
 * 【為什麼一定要接住 rejection】瀏覽器在使用者按 ESC 解除鎖定之後有一段
 * 冷卻期（Chrome 約 1.25 s）會拒絕新的請求 —— 而「按 ESC 暫停、立刻按
 * 繼續」正好落在那段時間裡。`void` 不會接住 rejection，主控台於是冒出一個
 * 沒人處理的 promise 錯誤。鎖不上本身不是問題：玩家點一下畫面就會鎖上
 * （見 `bindings.ts` 的 canvas click）。
 *
 * 【為什麼包一層 `Promise.resolve`】舊的瀏覽器與舊的型別定義裡
 * `requestPointerLock()` 回傳 `void`，直接 `.catch` 會炸。
 */
function grabPointer(): void {
  void Promise.resolve(canvas.requestPointerLock()).catch(() => {})
}

const MENU_POSE = { position: new Vector3(), target: new Vector3() }

/** 選單期間的一幀：只有海與天，鏡頭緩緩平移（M10 spec §9.4）。 */
function drawMenuBackground(): void {
  menuCameraPose(elapsed, MENU_POSE)
  ctx.camera.position.copy(MENU_POSE.position)
  ctx.camera.up.set(0, 1, 0)
  ctx.camera.lookAt(MENU_POSE.target)
  terrain.update(elapsed, MENU_POSE.position.x, MENU_POSE.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
}

/**
 * 演練場設定。**非 null 時 `enterBattle` 用它取代正常的關卡設定。**
 * 只有 `__drill` 這個量測出口會寫它 —— 玩家沒有任何路徑碰得到。
 */
let drillConfig: BattleConfig | null = null
/** 演練場的靶機。每幀把血量釘回去（「打不死」的全部意思） */
let drillDrone: Combatant | null = null

const menu = createMenu(document.getElementById('ui') as HTMLElement, {
  onEvent(event) {
    const from = screen
    screen = nextScreen(screen, event)
    // 【走遭遇戰那條路就要把模式換回來】少了這一行，打過一關任務之後再打
    // 遭遇戰，HUD 會留著上一關的目標列、結算的出口也會回到任務列表
    if (event === 'skirmish' || event === 'toSetup') {
      mode = 'skirmish'
      pendingMission = null
    }
    // 【`fight` 一律重建】不管是從設定頁進來還是結算的「再打一場」
    if (event === 'fight' && screen === 'battle') {
      enterBattle()
      paused = false
      grabPointer()
    }
    // 【離開戰鬥要清場】不清的話回到主選單還看得到上一場的戰場
    if (from === 'battle' && screen !== 'battle') {
      paused = false
      leaveBattle()
    }
    menu.show(screen)
    menu.setPaused(false)
  },
  onSetup(next) {
    setup = next
    menu.renderSetup(setup)
  },
  /**
   * 【`menu.ts` 保證這個先於 `onEvent('fight')`】所以 `enterBattle` 讀得到
   * 這一關。雙方飛什麼、打在哪一種地形，卡片自己說。
   */
  onMission(card) {
    mode = 'mission'
    pendingMission = card
  },
  onResume() {
    paused = false
    menu.setPaused(false)
    grabPointer()
  },
  onRestart() {
    restartBattle()
    paused = false
    menu.setPaused(false)
    grabPointer()
  },
})
menu.renderSetup(setup)
menu.show(screen)

/**
 * 結算板除了兩張表之外的東西（選單 spec §2.6）。只在分出勝負
 * 的那一幀算一次。
 *
 * 【我方第幾隊】編組表裡 `player: true` 那一筆在藍隊裡排第幾 —— 遭遇戰與
 * 任務都成立，不需要另一份索引。
 * 【轟炸機存活】`convoy.seats` 是 `world.combatants` 的索引，逐一讀 hp。
 */
function afterAction(): AfterAction {
  const blueUnits = battle.cfg.units.filter((u) => u.team === 'blue')
  const flightAt = blueUnits.findIndex((u) => u.player === true)
  const me = battle.player
  const convoy = battle.convoy
  return {
    mode,
    title: mode === 'mission' ? pendingMission?.title ?? '' : '遭遇戰',
    objective: battle.objectiveText !== ''
      ? battle.objectiveText
      : pendingMission?.battle.objective ?? '擊落全部敵機',
    seconds: (battleEndedAt < 0 ? elapsed : battleEndedAt) - battleStartedAt,
    playerSpec: shortName(me.aircraft.spec),
    playerFlight: (flightAt < 0 ? 0 : flightAt) + 1,
    playerHp01: Math.max(0, Math.min(1, me.hp / me.aircraft.spec.hp)),
    convoy: convoy === null ? null : {
      alive: convoy.seats.filter((i) => world.combatants[i]!.hp > 0).length,
      total: convoy.seats.length,
    },
  }
}

function frame(now: number) {
  const frameSeconds = (now - lastTime) / 1000
  lastTime = now
  perf.begin()
  bindings.tick(frameSeconds)
  hudCanvas.hidden = screen !== 'battle'

  // 【演練場的靶機打不死】血量每幀釘回滿 —— 幀內的彈著扣不到 0，就永遠
  // 不會走進擊墜路徑。轉向已由 `__drill` 換上直飛控制器，這裡只管活著。
  if (drillDrone !== null && screen === 'battle') {
    drillDrone.hp = drillDrone.aircraft.spec.hp * 1e6
  }
  if (screen === 'battle') {
    // 【暫停時所有模擬時間都不前進】只停飛機的話，畫面上是一批定格的
    // 飛機浮在繼續起伏的海上 —— 那看起來像當掉（M10 spec §8.1）
    if (input.pointerLockLost) {
      input.pointerLockLost = false
      // 分出勝負之後不再暫停 —— 結算板本身就是出口
      if (battle.outcome === 'fighting') {
        paused = true
        menu.setPaused(true)
        // 【暫停時記分板一定要收掉】`stepAndDrawBattle` 不跑，記分板的
        // 顯示狀態就凍結在按下暫停前的那一刻 —— 玩家若正按著 TAB，
        // 那張板子會一直疊在暫停選單上（M10 spec §8.1）
        input.scoreboardHeld = false
        scoreboard.setVisible(false)
      }
    }
    if (!paused) {
      // 【分出勝負之後切超級慢動作】理由與流速的定值見 `mission.ts` 的
      // `timeScale`。結算板背後的戰場繼續，只是慢下來。
      //
      // 【為什麼是縮放 dt，而不是像暫停那樣整個跳過 `stepAndDrawBattle`】
      // 結算板、兩顆按鈕、放開指標鎖**全部**在那支函數的尾巴。跳過它就得
      // 記一個「已經畫過結算了嗎」的旗標，而那種鏡射狀態要求每一條重開的
      // 路徑都記得重設它 —— 漏掉任何一條就留下一個永遠不消失的幽靈。
      // 由 `battle.outcome` 推導不必維護任何東西（與 `stepCommandLayer` 用
      // `instanceof` 推導、編制每步重算是同一條紀律）。
      //
      // 【`elapsed` 也要一起慢】海浪與地形讀的就是它，見 `timeScale` 的註解
      const sim = frameSeconds * timeScale(battle.outcome)
      elapsed += sim
      stepAndDrawBattle(sim)
      if (elapsed >= telemetryAt) {
        telemetryAt = elapsed + TELEMETRY_PERIOD
        logTelemetry()
      }
    } else {
      ctx.renderer.render(ctx.scene, ctx.camera)
    }
  } else {
    elapsed += frameSeconds
    drawMenuBackground()
  }

  perf.endFrame(loop.lastSubstepCount)
  requestAnimationFrame(frame)
}

// 【GLB 機種要在進迴圈前載完】`buildAircraft` 是同步的（`main.ts`、四個工具
// 頁、node 單元測試都同步呼叫它），所以非同步只能關在這一行。
await preloadAircraftModels()
// 【船的 GLB 也在開場載】三個艦級全部要 —— allies-m4 的第 58 特遣支隊有
// 航母。少載一種的症狀是 `createShipModels` 找不到樣板**直接丟例外**，
// 那一關進不去，而每一條單元測試都還是綠的（GLB 載入不在它們的路徑上）。
await preloadShipModels(['essex', 'wichita', 'fletcher'])
// 【地面單位的 GLB 也在開場載】`createGroundModels` 是同步的，樣板沒載到就丟
await preloadGroundModels()
requestAnimationFrame(frame)

/**
 * **凍結畫面的量測出口**：暫停、把鏡頭釘在指定的姿態、把世界時間釘死。
 *
 * 【為什麼需要它】「改完畫面不能有任何差異」這種要求，唯一的答案是**逐像素
 * 比對**，而逐像素比對需要一個兩次執行會產生一模一樣像素的場景。實際戰鬥
 * 不是 —— 飛機在哪、浪走到哪、參照物撒在哪，每一次都不同。
 *
 * 這個出口把三個變因全部釘死：
 *
 * ```
 *   鏡頭   直接寫 position 與 quaternion。暫停時主迴圈只呼叫 render，
 *          不會有人把它改回去（見 `frame` 裡 `paused` 那一支）
 *   時間   `elapsed` 只在 `!paused` 時前進，所以設一次就凍住 —— 海浪的
 *          相位、碎光的漂移全部固定
 *   海面   `terrain.update` 在暫停時不跑，網格會停在暫停前的位置上。
 *          這裡主動叫一次，讓它對齊新的鏡頭
 *   植被   引擎每幀只生四格，光靠一次 `update` 會拍到一片還沒補完的地。
 *          `terrain.settle()` 一次排乾
 * ```
 *
 * 飛機與參照物仍然是隨機的 —— 比對時用 `__gfx` 把它們關掉。
 *
 * 【不呼叫 `menu.setPaused`】那會把暫停選單疊上來蓋住畫面。這裡要的是
 * 「模擬停下來」而不是「玩家按了暫停」。
 */
;(window as unknown as Record<string, unknown>)['__still'] = (
  yawDeg = 0, pitchDeg = 0, altitude = 3000, time = 0, x = 0, z = 0,
) => {
  paused = true
  elapsed = time
  ctx.camera.position.set(x, altitude, z)
  // YXZ：先繞 Y 偏航、再繞 X 俯仰，與飛行姿態同一個慣例
  ctx.camera.quaternion.setFromEuler(
    new Euler((pitchDeg * Math.PI) / 180, (yawDeg * Math.PI) / 180, 0, 'YXZ'))
  ctx.camera.updateMatrixWorld(true)
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  // 【一定要排乾】少了它，定格拍到的是還在補格的植被 —— 而且每次拍到的
  // 進度都不一樣，`pixel-identical` 會變成隨機紅
  terrain.settle?.()
  return { yawDeg, pitchDeg, altitude, time, x, z }
}

/**
 * **圖形消融的量測出口**：逐繪製層開關可見性，把幀時間歸因到具體的子系統。
 * 給 `test/e2e/frame-time.e2e.ts` 用。
 *
 * 【為什麼需要它】這個場景是**填充率**吃緊而不是 CPU
 *（像素數砍成 1/9，頓挫由每秒 5.6 次掉到 0.08 次）。但「填充率」不是一個
 * 可以動手的對象 —— 要知道是哪一層在畫，而 WebGL 沒有逐物件的計時器。
 * 唯一可靠的歸因手段就是關掉一層、重量一次、看差多少。
 *
 * 【為什麼用 layers 而不是 `visible`】模糊圓盤的 `visible` **每幀都被
 * 重寫**（跟著轉速），設了下一幀就被蓋回去。`layers` 全專案沒有別人在用，
 * 而 three 的 `projectObject` 對每個物件單獨測 `camera.layers`，所以把物件
 * 移到相機沒有啟用的那一層就等於不畫它，且不與任何逐幀邏輯打架。
 *
 * 【第 31 層是「隱形層」】相機只啟用第 0 層（three 的預設），所以移到 31
 * 就消失、移回 0 就回來。
 *
 * 【目標在呼叫的當下才解析】飛機與模糊圓盤是每一場動態生出來的，抓一次
 * 存起來會在下一場指到上一場的屍體。
 */
const GFX_HIDDEN_LAYER = 31
;(window as unknown as Record<string, unknown>)['__gfx'] = (
  patch: Record<string, boolean>,
) => {
  const byRenderOrder = (order: number): Object3D[] => {
    const out: Object3D[] = []
    ctx.scene.traverse((o) => { if (o.renderOrder === order) out.push(o) })
    return out
  }
  // 【terrain 用索引】那三個孩子的次序是 `render/terrain.ts` 明文寫下的
  // 契約，單元測試也靠它（並自我驗證抓對了人）
  const targets: Record<string, () => readonly Object3D[]> = {
    farSea: () => [terrain.object.children[0]!],
    nearSea: () => [terrain.object.children[1]!],
    islands: () => [terrain.object.children[2]!],
    // 【用 slice 不是 children[3]!】純海面沒有第四個孩子，固定取索引的話
    // 切到純海之後消融 flora 會對 undefined 呼叫 traverse，當場崩
    flora: () => terrain.object.children.slice(3),
    sky: () => byRenderOrder(SKY_RENDER_ORDER),
    propDisc: () => byRenderOrder(PROP_DISC_RENDER_ORDER),
    // 五個粒子池一起 —— 它們是同一種成本（半透明、關深度寫入、疊在一起）
    particles: () => [smoke.object, fireball.object, spray.object, splashes.object, sparks.object],
    tracers: () => [tracers.object, muzzles.object, turretMuzzles.object],
    vortex: () => [vortex.object],
    aircraft: () => [...visuals.values()].map((v) => v.model.group),
    // 【戰況相依的雜項】砲塔管、編隊標記、碎片、目標環。它們的位置取決於
    // 這一場打成什麼樣，兩次執行不會一樣 —— 逐像素比對要把它們一起關掉，
    // 否則定格的畫面仍然有 0.2～6% 的像素在跳，任何改動的差都埋在裡面。
    battleProps: () => [turretBarrels.object, orderMarkers.object, debris.object,
      objectiveRing.object],
  }
  const applied: string[] = []
  for (const [name, on] of Object.entries(patch)) {
    const pick = targets[name]
    if (pick === undefined) continue
    // 【一定要 traverse 到葉子】three 的 `projectObject` 對每個物件**單獨**測
    // 圖層，而且不論父物件通不通過都照樣遞迴下去 —— 圖層不繼承。只設群組
    // 的話（飛機模型、粒子池若是 Group）子網格照畫不誤。
    for (const root of pick()) root.traverse((o) => { o.layers.set(on ? 0 : GFX_HIDDEN_LAYER) })
    applied.push(`${name}=${on ? 'on' : 'off'}`)
  }
  return { applied, known: Object.keys(targets) }
}

/**
 * **量測出口**：把當前戰鬥的玩家座位讀成一個純資料點，給 Playwright 用。
 *
 * 【為什麼需要它】離線探針量的是 `stepBattle`，人工回報的卻是**在遊戲裡**
 * 按代飛看到的行為。兩者中間隔著這個檔案的接線 —— 何時換控制器、指揮層、
 * 暫停、掉幀丟時間。少了這個出口，Playwright 只讀得到像素，量不出軌跡。
 *
 * 【為什麼是函式而不是掛物件】`battle` 每開一場就換一顆，抓著舊的參考會
 * 量到上一場。
 *
 * 【為什麼回純數字而不是回 `battle`】跨 CDP 傳一整棵物件圖既慢又會踩到
 * 循環參考；而且要量什麼在這裡寫清楚，比在腳本裡挖欄位誠實。
 */
/**
 * **打法設定的消融開關**，逐欄蓋掉 `DEFAULT_DOCTRINE`，回蓋完的值。
 * 與離線探針的 `DP` 環境變數是同一件事 —— 那一個走 `process.env`，瀏覽器
 * 裡沒有那條路。
 *
 * 【必須在開戰之前呼叫】`AiController` 每步都讀這顆物件，中途改等於換規則，
 * 那條軌跡兩邊都不是。
 */
;(window as unknown as Record<string, unknown>)['__doctrine'] = (
  patch: Record<string, number>,
) => {
  Object.assign(DEFAULT_DOCTRINE, patch)
  return { ...DEFAULT_DOCTRINE }
}

/**
 * **1v1 演練場**，量測出口。驗收場景是「一台打不死的靶機（永遠直飛）
 * 跟我機面對面 1v1」。
 *
 * 【它做三件事】換設定（109 對 P-51、5000 m 對頭 3 km）、開戰、把紅方那一架
 * 換成直飛控制器。血量的釘回在主迴圈（見 `drillDrone`）。
 *
 * 【靶機的控制器不做任何機動】維持出生航向、機首水平、八成油門 —— 與
 * `band-drill.probe.ts` 的 `Idle` 同一個角色：它是一把尺，不是對手。
 * 離線探針逐步把狀態釘回直線，這裡放給物理自己飛 —— 有頭驗收看的是
 * 「AI 繞著一個真實的目標怎麼轉」，尺直不直差幾公尺無所謂。
 *
 * 【代飛要另外按】與遊戲相同：`KeyI`。e2e 腳本在呼叫本函式的同一個 tick
 * dispatch —— `leaveGodView` 會在開戰時把 `input.playerAi` 清掉，先按無效。
 */
;(window as unknown as Record<string, unknown>)['__drill'] = (altitude = 5000) => {
  drillConfig = {
    units: lineAbreast(HEAD_ON, BF109K4, 1, P51D, 1),
    altitude,
    tas: 180,
    entryRange: 3000,
    schwarmSpacing: 800,
    lateralOffset: 0,
    altitudeSpread: 0,
    aiProfile: VETERAN,
    rules: { kind: 'annihilate' },
    tuning: NEUTRAL_TUNING,
  }
  try {
    mode = 'skirmish'
    pendingMission = null
    screen = 'battle'
    enterBattle()
    paused = false
    menu.show(screen)
  } finally {
    // 【一場一次】離開演練再開新戰鬥要拿到正常設定
    drillConfig = null
  }
  const drone = world.combatants.find((c) => c.team === 'red') ?? null
  drillDrone = drone
  if (drone !== null) {
    const level = new Vector3()
    drone.controller = {
      update(self, _dt, out2) {
        const v = self.state.velocity
        const h = Math.hypot(v.x, v.z)
        if (h > 1e-3) level.set(v.x / h, 0, v.z / h)
        else level.set(0, 0, -1).applyQuaternion(self.state.orientation)
        out2.aimWorld.copy(level)
        out2.throttle = 0.8
        out2.brake = 0
        out2.firing = false
      },
    }
  }
  return { seat: player.index, drone: drone?.index ?? -1 }
}

;(window as unknown as Record<string, unknown>)['__probe'] = () => {
  if (screen !== 'battle') return null
  const a = player.aircraft
  const pos = a.state.position
  const vel = a.state.velocity
  const speed = vel.length()
  const right = new Vector3(1, 0, 0).applyQuaternion(a.state.orientation)
  const up = new Vector3(0, 1, 0).applyQuaternion(a.state.orientation)
  const aim = player.command.aimWorld
  // 被護送的單位（護航關才有），取還活著的平均高度
  let by = 0
  let bn = 0
  for (const c of world.combatants) {
    if (!c.alive) continue
    if (battle.board.protectedMask[c.index] === 0) continue
    by += c.aircraft.state.position.y
    bn++
  }
  const tgt = playerAi.target
  return {
    /**
     * **物理時鐘**，秒。用 `world.time` 而不是 `elapsed` —— 後者累加的是
     * 牆鐘（`frameSeconds`），而固定步長迴圈撞到 `maxSubsteps` 時會丟時間。
     * 無頭瀏覽器跑 WebGL 幾乎一定會撞到，兩者於是分家。
     */
    t: +world.time.toFixed(2),
    ai: input.playerAi,
    alive: player.alive,
    x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1),
    v: +speed.toFixed(1),
    // 航跡角：速度向量相對地平線。正 = 爬升
    ga: speed > 1e-3 ? +(Math.asin(vel.y / speed) * 180 / Math.PI).toFixed(2) : 0,
    // 【坡度用 atan2 不用 asin】asin 的值域是 ±90°，**分不出正飛與倒飛**。
    // 實測踩過一次：一段「坡度只有 −11°、幾乎平飛」的取樣，真值是 179°
    bk: +(Math.atan2(-right.y, up.y) * 180 / Math.PI).toFixed(1),
    // 指令的航跡角 —— 與 ga 對照就知道低頭是被命令的還是掉下去的
    cmd: +(Math.atan2(aim.y, Math.hypot(aim.x, aim.z)) * 180 / Math.PI).toFixed(2),
    intent: playerAi.intent,
    mode: playerAi.mode,
    // 迴轉平面的俯仰偏置，度。正 = 拉高迴旋、負 = 俯衝迴旋、0 = 水平
    tpb: +(playerAi.sit.turnPitch * 180 / Math.PI).toFixed(2),
    asp: +(playerAi.sit.aspectAngle * 180 / Math.PI).toFixed(1),
    // 被護送單位的平均高度；全滅或非護航關時 NaN
    by: bn > 0 ? +(by / bn).toFixed(1) : Number.NaN,
    tr: tgt !== null ? +tgt.state.position.distanceTo(pos).toFixed(1) : -1,
    // 掉幀會讓固定步長迴圈丟時間，軌跡就與離線探針分家 —— 要看得到
    sub: loop.lastSubstepCount,
    /**
     * 代飛這一顆 AI 的反應延遲，秒。**這是兩條量測路徑對不對得起來的鑰匙。**
     * `ACE` 是 0、`VETERAN` 不是 —— 延遲不同，軌跡四十秒後就完全不一樣。
     */
    rd: playerAi.profile.reactionDelay,
    /**
     * 撤離圓環在不在場景裡。
     *
     * 【為什麼是這個而不是數像素】圓環畫在 WebGL 那一張畫布上，而
     * `preserveDrawingBuffer` 是關的 —— `getImageData` 讀不回來。所以 e2e
     * 問的是「它有沒有被加進場景」：`hasTarget` 為真卻沒加進去，正是那個
     * 會靜靜發生的失敗（環每一幀照常更新位置與半徑，就是不在場景裡）。
     */
    ring: objectiveRing.object.parent !== null,
    /** 這一場有沒有終點。`ring` 的對照 —— 兩者必須一致 */
    tgtOn: battle.mission.hasTarget,
    /**
     * ── 投雷 HUD 的實際狀態 ──────────────────────────────
     *
     * 【為什麼要暴露這幾格】`test/e2e/torpedo-hud.e2e.ts` 只截圖的話，把
     * `main.ts` 的接線整個刪掉、`releaseAgl` 填錯、甚至 widget 完全不畫，
     * 那支腳本都還是會成功結束 —— 那是一條殺不死的護欄。
     *
     * 讀的是 `hudFrame` 本身，也就是 widget 真正拿到的那一份。
     */
    /** 航跡線這一幀畫幾個取樣點。0 = 不畫 */
    runN: hudFrame.runCount,
    /** HUD 拿到的離地高度 —— 必須是 `canRelease` 吃的那一個 */
    hudAgl: +hudFrame.releaseAgl.toFixed(1),
    /** 投放閘門三格的結果，順序同畫面 */
    gate: hudFrame.releaseEnv === null ? null : {
      roll: rollOk(hudFrame.releaseEnv, hudFrame.roll),
      pitch: pitchOk(hudFrame.releaseEnv, hudFrame.pitch),
      agl: aglOk(hudFrame.releaseEnv, hudFrame.releaseAgl),
    },
    /** 這一幀投得出去嗎 —— 三格全綠必須等於它 */
    relOk: hudFrame.releaseOk,
  }
}
