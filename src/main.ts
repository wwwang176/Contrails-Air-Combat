import { Euler, Quaternion, Vector3, type Object3D } from 'three'
import { FixedStepAccumulator, MAX_FRAME_SECONDS, clampFrameSeconds } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { DEG } from './core/math'
import { createScene } from './render/scene'
import { fieldInnerFor, readAntialias, readQuality, saveAntialias, saveQuality } from './render/quality'
import { readVolume, saveVolume } from './audio/volume'
import { createAudioEngine } from './audio/engine'
import {
  SINGLE_FILES, engineFile, fireFile, gunSound, impactSound, turretFile, volleyPool, type Pool,
} from './audio/catalog'
import {
  STRIKE_HEIGHT, applyFlash, createStorm, rollThunder, stepStorm, type Storm,
} from './render/storm'
import { createRain, type Rain } from './render/rain'
import { CUE, CUE_STRIDE, clearCues, createCueQueue, pushCue } from './audio/queue'
import { nearestN } from './audio/nearest'
import { nearMiss } from './audio/nearMiss'
import { LAYER_DB } from './audio/pick'
import {
  blastGainDb, blastRate, damageGainDb, dopplerRate, engineRate, hitFeedback, shakeGainDb,
  hitRate, shakeInterval, windParams,
} from './audio/curves'
import { DAY_PALETTES, applyTimeOfDay } from './render/timeOfDay'
import { FAR_LAND_NAME } from './render/leyteGround'
import { flatSeaCrashPolicy } from './world/seaCrash'
import { arenaKills, createArenaState, stepArena } from './world/arena'
import { createTerrain, preloadTerrainScenery, type TerrainGfx, type TerrainKind } from './render/terrain'
import { createObjectiveRing } from './render/objectiveRing'
import { timeScale } from './battle/mission'
import { createTracers } from './render/tracers'
import { createMuzzles, createTurretMuzzles } from './render/muzzle'
import { createTurretBarrels } from './render/turretBarrels'
import { createSparks } from './render/sparks'
import { createBlastSparks } from './render/blastSparks'
import { createSplashes } from './render/splash'
import { TextureLoader } from 'three'
import { createBombs, createTorpedoes } from './render/bombs'
import { createFireChunks } from './render/chunks'
import { createFirePuff } from './render/firePuff'
import { JET_RISE, createWaterJets } from './render/waterJets'
import {
  AIR_BLAST, BLAST_PACE, BOMB_BLAST_SIZE, LAND_BLAST, TORPEDO_BLAST, WATER_BLAST, blastFireRadius,
  createBlastSmoke, createDust, createEmberSmoke, createFireGlow, createWaterMist,
  emitBlast, emitEmber, emitFlakBlasts, emitMist, resetFlakBlastSeed, scaleBlast,
  type BlastParams, type BlastPools,
} from './render/blast'
import { createFireball, FIREBALL_COUNT, FIREBALL_SPEED } from './render/fireball'
import { createFlakBursts, emitFlakBursts, resetFlakBurstSeed } from './render/flakBursts'
import { createFlareLights } from './render/flares'
import {
  createShipModels, preloadShipModels, shipModelTop, type ShipModels,
} from './render/ships'
import { createGroundModels, type GroundModels } from './render/groundTargets'
import { createSearchlights, makeGlareTexture, type Searchlights } from './render/searchlights'
import { groundModelUrls, preloadGroundModels } from './render/geometry/ground'
import { settleGroundTargets } from './world/groundTargets'
import { clearBursts, flakDamage, type BurstEvents } from './world/flak'
import {
  createShipFireSmoke, createSmoke, createSteam, emitSmoke,
  DEBRIS_SMOKE_SIZE, STEAM_PLUME_SPEED,
} from './render/smoke'
import { addSmokeLighting } from './render/smokeLighting'
import { createBlastLights } from './render/blastLights'
import { battleLights } from './battle/battleLights'
import {
  createShipFires, lightShipFires, stepShipFires,
} from './render/shipFires'
import {
  createGroundFires, lightGroundFire, lightGroundFires, stepGroundFires,
} from './render/groundFires'
import { createFireCrowd, updateFireCrowd } from './render/fireCrowd'
import { hash01 } from './render/scatter'
import {
  createSpray, emitSpray, DEBRIS_SPRAY_COUNT, WATER_COLOR, WRECK_SPRAY_COUNT,
} from './render/spray'
import { createVortex } from './render/vortex'
import { createOrderMarkers } from './render/orderMarkers'
import { BLAST_DEBRIS_COLOR, createDebris } from './render/debris'
import {
  createWrecks, WRECK_FIRE_SCALE, WRECK_FIRE_SMOKE_COLOR, WRECK_FIRE_SMOKE_COLOR_2,
  WRECK_FIRE_SMOKE_SCALE,
} from './render/wrecks'
import { bodyColorOf } from './render/geometry/buildAircraft'
import {
  IMPACT_STRIDE, clearImpacts, createImpacts, type ImpactEvents,
} from './world/events'
import { KILL_STRIDE, clearKills, type KillEvents } from './world/kills'
import { clearDamage, DAMAGE_STRIDE } from './world/damage'
import { HIT_PARTS, type HitPart } from './world/hit'
import {
  AIRCRAFT_MODEL_COUNT, buildAircraft, buildAircraftLod, preloadAircraftModels, useAircraftLod, type AircraftModel,
} from './render/geometry/buildAircraft'
import { PROP_DISC_RENDER_ORDER } from './render/geometry/assembly'
import { SKY_RENDER_ORDER } from './render/sky'
import { Hud } from './hud/Hud'
import { createAudioMeter, type AudioMeter } from './hud/audioMeter'
import type { MeterSample } from './audio/meter'
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
import { blastScaleOf, resetBombBay, type BombBay } from './weapons/bomb'
import {
  aglOk, canRelease, envelopeFor, pitchOk, rollOk,
} from './weapons/releaseEnvelope'
import type { Loadout } from './weapons/stores'
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
import {
  GROUND_KILL_SHAKE, GUN_LOST_SHAKE, KILL_SHAKE,
  OVERSPEED_FULL, OVERSPEED_SHAKE,
  addShake, applyCameraShake, createCameraShake, hudShakeAngle, hudShakeShiftX,
  hudShakeShiftY, ordnanceShakeScale, overspeedShake, stepCameraShake,
} from './camera/cameraShake'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { BOMB_AIM_SCALE, levelAimBasis, slewAimWorld } from './input/aim'
import { teamSlot, type Combatant, type World } from './world/World'
import { solveLead, NO_INTERCEPT } from './world/lead'
import { PROJECTILE_LIFETIME } from './world/Projectiles'
import { PlayerController } from './control/PlayerController'
import { AiController } from './ai/AiController'
import { recoveryWorkerFailure } from './ai/recoveryWorkerClient'
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
import { createLoadingScreen, fileFraction } from './ui/loading'
import {
  readSeenTutorials, tutorialsFor, unseenTutorials, type Tutorial,
} from './ui/tutorials'
import { nextScreen, type Screen } from './ui/screens'
import { menuCameraPose } from './app/menuCamera'
import { createShowcase, type Showcase } from './app/showcase'
import { PLANT_STACKS } from './world/leuna'
import { assetUrl } from './core/asset'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
const perf = createPerfOverlay(ctx.renderer)
const audio = createAudioEngine(ctx.camera)
audio.setVolume(readVolume())

/** 防墜 Worker 是正式安全系統；失去它時凍結遊戲並清楚告知，不做靜默降級。 */
function blockForRecoveryWorker(message: string): void {
  if (document.getElementById('recovery-worker-blocker') !== null) return
  void document.exitPointerLock?.()
  const blocker = document.createElement('section')
  blocker.id = 'recovery-worker-blocker'
  blocker.setAttribute('role', 'alert')
  blocker.setAttribute('aria-live', 'assertive')
  const title = document.createElement('h1')
  title.textContent = '無法啟動飛行'
  const detail = document.createElement('p')
  detail.textContent = `${message} 為避免 AI 在缺少防墜預演時繼續飛行，遊戲已停止。請重新整理；若仍出現，請改用支援 Web Worker 的瀏覽器。`
  blocker.append(title, detail)
  document.body.appendChild(blocker)
}

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
/**
 * 建地形時給的 GPU 資源。**每次建都重讀檔位** —— 內圈半徑跟著玩家目前選的
 * 畫質走，換檔位時另由 `onQuality` 直接調現有地形的
 */
const terrainGfx = (): TerrainGfx => ({ renderer: ctx.renderer, fieldInner: fieldInnerFor(readQuality()) })
let terrain = createTerrain(terrainKind, terrainGfx())
/**
 * 雷雨。**只有時段是 `storm` 的那一場才有**，其餘是 null。生命週期比照時段：
 * 每一場套時段時重建（`applyTimeOfDay` 那一行）。
 */
let storm: Storm | null = null
/** 雨，與 `storm` 同生同滅 */
let rain: Rain | null = null

/**
 * 雷聲：從閃電打下的地方發出。音波走到鏡頭才響、遠的更悶更小，由音訊引擎
 * 對定位音源照常處理；播放速度、低通與音量另外隨機（`rollThunder`）。疊一層
 * 同庫的另一支，隆隆聲才有層次。
 *
 * 【位置以鏡頭為中心】閃電打在「玩家看得到的那一片天」，不是固定在地圖上。
 *
 * 【模組層函數，不是每幀一個閉包】`stepStorm` 每幀都拿它當回呼。
 */
function playThunder(distance: number, bearing: number): void {
  const cam = ctx.camera.position
  const v = rollThunder(Math.random)
  audio.playPool(
    'thunder', 'thunder',
    cam.x + Math.sin(bearing) * distance, STRIKE_HEIGHT, cam.z + Math.cos(bearing) * distance,
    true, v.extraDb, true, v.rate, v.cutoffHz,
  )
}
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
    // 重生可能換一顆控制器；任務優先權與地形一樣必須在這個唯一接線點補上。
    ctl.priorityGroundUnit = c.team === 'blue'
      ? battle.cfg.tuning.priorityGroundUnit ?? null
      : null
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
  // 【代飛與友軍 AI 投彈的方式相同】接的是玩家那一架的彈艙（`playerBay` 就是
  // 它），發動走 `World.releaseBombs` 讀 `command.bombing` —— 與友軍 AI 同一條
  // 路。給 null 的話代飛看不到彈艙，只會掃射。在迴圈之外寫：代飛不在座位上
  // 時迴圈走不到它，而接手僚機會換掉 `player`
  playerAi.bombBay = player.bombBay
  playerAi.strikeProfile = player.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
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
/** 探照燈的光束。與 `groundModels` 同一個生命週期：每一場重建 */
let searchlights: Searchlights | null = null
/** 探照燈眩光的十字貼圖：畫一次、每一場共用 */
const glareTexture = makeGlareTexture()
/** 砲位陣亡時噴火球用的暫存。熱路徑之外，但仍不配置。 */
const GUN_LOST_DIR = new Vector3()

const input = createInputState()
const bindings = attachInput(canvas, input)

const playerController = new PlayerController(input)

/** 目前的畫面。與 `ui/screens.ts` 的狀態機是同一組值 */
let screen: Screen = 'landing'
/** 戰鬥是否暫停。只有 `screen === 'battle'` 時才有意義。**只經由 `setPausedState` 改** */
let paused = false

/**
 * 暫停與繼續的唯一入口：同時改 `paused` 並通知音訊。
 *
 * 【為什麼要一個入口】寫入點散在 Esc、教學卡、重新開始、換畫面好幾處；
 * 漏掉任何一處，那條路徑上的聲音就不會停（`audio-wiring.test.ts` 守這一條）。
 * 分頁藏起來時也算暫停。
 */
function setPausedState(v: boolean): void {
  paused = v
  audio.setPaused(v || document.hidden)
}
document.addEventListener('visibilitychange', () => audio.setPaused(paused || document.hidden))
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
/** 蓋住畫面的載入進度（`index.html` 的 `#loading`）。開場就蓋著 */
const loading = createLoadingScreen()
/**
 * 正在非同步建一場戰鬥（`loadBattle`）。**為真時 `frame` 不推進、不畫戰鬥** ——
 * 第一場的 `battle` 那時還不存在。
 */
let loadingBattle = false
/** 載入完、第一幀畫完之後要依序彈的教學卡。空 = 不彈。見 `ui/tutorials.ts` */
let tutorialPending: Tutorial[] = []
/** 教學卡開著：暫停中，放開指標不算玩家按了暫停 */
let tutorialOpen = false
/**
 * 下一次「指標鎖掉了」是教學卡自己放開的，不是玩家按了 Esc。
 *
 * 【光靠 `tutorialOpen` 擋不住】`exitPointerLock` 是非同步的，放開要過一會兒
 * 才真的發生。玩家在那之前就按掉卡片的話，`tutorialOpen` 已經是 false，
 * 遲到的那一次放開會被讀成按了 Esc —— 暫停選單蓋上來，遊戲卡在第一幀。
 */
let ignoreNextUnlock = false
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

/**
 * 【選單期間要藏起來】`stepAndDrawBattle` 不跑，HUD 畫布會停在最後一幀。
 * **兩張都要藏** —— 遮罩那一張留著的話，選單上會蓋著最後一幀的暗角。
 */
const hudCanvas = document.getElementById('hud') as HTMLCanvasElement
const hudMaskCanvas = document.getElementById('hud-mask') as HTMLCanvasElement
const hud = new Hud(hudCanvas, hudMaskCanvas)
/**
 * 音訊錶。**預設關著** —— `__audioMeter(true)` 打開（見 `hud/audioMeter.ts`）。
 * 除錯用的疊圖，不進 `HudFrame`，也不吃暫停。
 */
let audioMeter: AudioMeter | null = null
const METER_SAMPLE: MeterSample = {
  peakDb: -60, reductionDb: 0, loudestDb: -60, voices: 0, cuts: 0, lagMs: 0,
}
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
   * 這一席目前的模型。**只在整隊重生時換**：舊模型已經交給殘骸池，復活的
   * 席位拿一具新的。`renderPositions` 參考的是 `position`，不受影響。
   */
  model: AircraftModel
  /**
   * 遠處用的低模。**沒有低模的機種是 `null`**，那一席一路走 `model`。
   *
   * 【兩具都掛在場景上，靠 `visible` 切】換的是哪一個 group 在畫，不是重建
   * 幾何 —— 每幀重建一架 B-17 是不可能的成本。
   */
  lod: AircraftModel | null
  /** 這一幀顯示的是低模嗎。`useAircraftLod` 的遲滯要讀上一幀的答案。 */
  far: boolean
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

/** 配這一席的低模並掛上場景（沒有低模的機種是 no-op）。復活時也走這裡。 */
function attachLod(v: Visual, id: string): void {
  v.lod = buildAircraftLod(id)
  if (v.lod !== null) {
    v.lod.group.visible = false
    ctx.scene.add(v.lod.group)
  }
  v.far = false
}

const visuals = new Map<Combatant, Visual>()
function attachVisual(c: Combatant): Visual {
  const v: Visual = {
    model: buildAircraft(c.aircraft.spec),
    lod: null,
    far: false,
    position: new Vector3(),
    quaternion: new Quaternion(),
    wrecked: false,
  }
  ctx.scene.add(v.model.group)
  attachLod(v, c.aircraft.spec.id)
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
const blastSparks = createBlastSparks()
ctx.scene.add(blastSparks.object)
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
/** 投彈模式下滑鼠旋轉瞄準點用的座標系，見 `levelAimBasis` */
const BOMB_AIM_BASIS = new Quaternion()
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
 * 【投放也與 AI 同一條路】`World.releaseBombs` 從質心投，與 `bombPoint` 差
 * 兩三公尺，落在殺傷半徑的雜訊裡。
 */
function playerBay(): BombBay {
  return player.bombBay
}
/**
 * 玩家這一趟掛什麼。`null` = 掛不了東西。
 *
 * 【為什麼要記在這裡】投彈的那一段每幀都要它的 `kind` 與 `damage`；換飛機時
 * 從那一架身上抄一次就夠（`syncBombLoad`）。
 */
let playerLoadout: Loadout | null = null

/**
 * 玩家換了一台飛機：重算掛彈量與瞄具眼點。
 *
 * 【掛載讀那一架自己的】`World` 在進場與換機種時已經照這一關的複寫定好了
 * （整隊的 `blueLoadout`、依機種的 `loadouts`）。這裡另外查一次的話，只認得
 * 其中一種複寫的那一份會靜靜地落回預設表 —— 症狀是掛了彈卻按不出來。
 *
 * 【換到不能投彈的飛機要強制退出】少了這一條，重生成戰鬥機之後相機會卡在
 * 一個沒有 `bombPoint` 的模式裡。
 *
 * 【有瞄具的走投彈視角，沒有的是掛彈戰鬥機】見 `InputState.bombRelease`
 */
function syncBombLoad(): void {
  const m = visuals.get(player)!.model
  playerLoadout = player.loadout
  input.bombCapable = m.bombPoint !== null && playerLoadout !== null
  input.bombRelease = m.bombPoint === null && playerLoadout?.kind === 'bomb'
  if (m.bombPoint !== null) rig.options.bombPoint.copy(m.bombPoint)
  if (!input.bombCapable && input.viewMode === 'bomb') input.viewMode = 'third'
  resetBombBay(player.bombBay, playerLoadout)
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
const smokeTexture = new TextureLoader().load(assetUrl('/textures/smoke.png'))

/**
 * 高砲的黑雲。**跨場重用的池**，與火球、煙同一個生命週期。
 *
 * 【為什麼不是煙霧池的一部分】壽命、上升與尺寸是整池共用的建立期設定，
 * 而高砲雲要四秒、幾乎不上升、6→14 m。見 `render/flakBursts.ts`。
 * 貼圖與其他的煙同一張，畫面裡才是同一種質感。
 */
const flakBursts = createFlakBursts(undefined, smokeTexture)
ctx.scene.add(flakBursts.object)
// 【照明彈的燈由開戰時決定掛不掛】光源數變動會讓每一個材質重編著色器，所以只在
// `startWorld` 依 `battleLights` 掛上或拿掉 —— 卡頓留在載入那一刻，戰鬥中燈數不變。
// 燈就算強度 0 也照算，用不到就不掛。
const flareLights = createFlareLights(smokeTexture)
/**
 * 爆炸的閃光：炸彈、魚雷、擊墜、地面目標、艦上砲位、高射砲。**開場就掛、恆掛**
 * —— 擊墜與高砲每一關都有。煙池建在它之後，煙的著色器讀它的 uniform。
 */
const blastLights = createBlastLights()
ctx.scene.add(blastLights.object)

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
const shipFireSmokeLighting = addSmokeLighting(
  shipFireSmoke,
  ctx.lights.sun.position,
  ctx.lights.sun.color,
  ctx.lights.sun.intensity,
  undefined,
  blastLights.smokeUniforms,
)
/**
 * 殘骸的引擎火冒的煙。**與船火分開一份池子** —— 顏色是逐池的，燒的東西
 * 不一樣就要有自己的一份（見 `WRECK_FIRE_SMOKE_COLOR`）。
 */
const wreckFireSmoke = createShipFireSmoke(
  undefined, smokeTexture, WRECK_FIRE_SMOKE_COLOR, WRECK_FIRE_SMOKE_COLOR_2,
)
ctx.scene.add(wreckFireSmoke.object)
ctx.scene.add(shipFireSmoke.object)
/** 廠區的白煙：煙囪與冷卻塔頂持續冒的蒸汽（`emitPlantSteam`） */
const steam = createSteam(undefined, smokeTexture)
ctx.scene.add(steam.object)
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
/** 擠在一起的火少冒一點煙。**兩個池合在一起算**，見 `render/fireCrowd.ts` */
const fireCrowd = createFireCrowd(groundFires, shipFires)
/**
 * 附近的爆炸把鏡頭搖一下。**火焰那一串小爆炸不進來**（見 `cameraShake.ts`）
 */
const cameraShake = createCameraShake()
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
// 配方在 `render/blast.ts`，`/tools/blast.html` 是它的調校台。
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
// 爆炸煙保留黑 → 深灰的年齡曲線，所以只做乘法式迎／背光與核心遮蔽，
// 不額外加入固定亮色。否則剛從火球交棒的黑煙會在那一幀突然變亮。
const blastEmberLighting = addSmokeLighting(
  blastEmber,
  ctx.lights.sun.position,
  ctx.lights.sun.color,
  ctx.lights.sun.intensity,
  0,
  blastLights.smokeUniforms,
)
const blastSmokeLighting = addSmokeLighting(
  blastSmoke,
  ctx.lights.sun.position,
  ctx.lights.sun.color,
  ctx.lights.sun.intensity,
  0,
  blastLights.smokeUniforms,
)
const fireSmokeLighting = [
  shipFireSmokeLighting,
  blastEmberLighting,
  blastSmokeLighting,
]

function syncFireSmokeLighting(): void {
  for (const lighting of fireSmokeLighting) {
    lighting.setLight(
      ctx.lights.sun.position,
      ctx.lights.sun.color,
      ctx.lights.sun.intensity,
    )
  }
}
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

// 【煙以全解析度直接畫在主場景，不走 `render/lowResTransparency.ts` 的半解析度
// 通道】那條通道要先把整個場景畫進 4× MSAA 離屏圖、解析顏色與深度、再複製回
// 畫布合成：Iris Xe 上每幀固定多花約 13 ms（深度解析就佔約 5 ms），航母大火與
// 油廠集火實測全解析度都快一倍。而且離屏的 sRGB 圖在線性空間做抗鋸齒混色，
// 遠方細碎的地面會整片變亮，與直接畫到畫布的顏色對不上。

/**
 * 給 `emitBlast` 的那一組。每幀都是同一個物件 —— 熱路徑不配置。
 *
 * 【`splashEvents` 是它自己的，不是 `world` 的】那一格只在**沒有** `jets`
 * 池時才會被寫（`emitCrown` 的退路），而這裡永遠有 —— 給它一個專用的空
 * 通道比接上世界的那一條安全：`world` 要到 `startWorld()` 才存在。
 */
// 【殘骸池要排在火焰之前】引擎火吸附在它的格子上，建回呼時就要拿到錨點
const wrecks = createWrecks(MAX_COMBATANTS, (m) => {
  ctx.scene.remove(m.group)
  m.dispose()
})

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
 * 碎片散射速度的基準火球半徑：未放大的 `LAND_BLAST`（基準彈、尺度 1）。
 * 火球比它大幾倍，碎片的初速就是 `DEBRIS_SPEED` 的幾倍。
 */
const DEBRIS_REF_FIRE_RADIUS = blastFireRadius(LAND_BLAST)

/**
 * 炸彈與魚雷的碎片散射倍率，跟著這一團的火球半徑走。**呼叫前 `SCALED_BLAST`
 * 要已經是這一團的配方。** 直接乘當量尺度的話，60 kg 彈（0.11）的碎片
 * 只有 4 m/s，連同拖著的煙幾乎原地落下。
 */
function blastDebrisSpeed(): number {
  return blastFireRadius(SCALED_BLAST) / DEBRIS_REF_FIRE_RADIUS
}

/** 火星的種子。每噴一次推一格，同一幀的兩團爆炸才不會噴成一樣的形狀 */
let sparkSeed = 0

/**
 * 炸彈與魚雷的爆炸噴火星，只往上半邊噴。**呼叫前 `SCALED_BLAST` 要已經是
 * 這一團的配方** —— 噴多遠跟著它的火球半徑走。落到腳下的地面或海面就熄掉。
 */
function burstSparks(x: number, y: number, z: number): void {
  const cam = ctx.camera.position
  sparkSeed = (sparkSeed + 1) | 0
  blastSparks.burst(x, y, z, terrain.collisionHeightAt(x, z) - 0.5, blastFireRadius(SCALED_BLAST),
    true, sparkSeed, elapsed, cam.x, cam.y, cam.z)
}

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
    addShake(cameraShake, x, onLand ? ground : y, z, KILL_SHAKE, ctx.camera.position)
    blastLights.flash(x, onLand ? ground : y, z, KILL_SHAKE, ctx.camera.position)
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
    // 【炸彈擊毀不放第二次爆炸】`nz` = 1 表示這一筆是爆風打的，那一顆的
    // 落點事件已經在 `emitBombBlasts` 放過火球與碎片；子彈擊毀沒有落點
    // 事件，這裡才放一團
    //
    // 【不能改看 `ny`】那一格是兇手的座位索引，玩家投的彈也是非負的
    if (d[o + 5]! === 0) {
      emitBlast(BLAST_POOLS, LAND_BLAST, d[o]!, d[o + 1]!, d[o + 2]!,
        (e * 97 + Math.round(world.time * 60)) | 0, 0, 0, 0)
      // 【炸彈擊毀的不搖第二次】同一個理由：那一顆的落點事件已經搖過
      addShake(cameraShake, d[o]!, d[o + 1]!, d[o + 2]!, GROUND_KILL_SHAKE, ctx.camera.position)
      blastLights.flash(d[o]!, d[o + 1]!, d[o + 2]!, GROUND_KILL_SHAKE, ctx.camera.position)
    }
    // 【原地掛煙柱】燒 60 秒，與船火同一套參數
    const t = world.groundTargets[d[o + 3]!]
    const top = t === undefined ? 0 : t.impactY - t.position.y
    // 【油桶堆整片燒】一個火點在 28 × 18 m 的堆上只是一角冒煙；其餘一個
    const n = t !== undefined && t.unit.id === 'fuelDump' ? 6 : 1
    // 【散在腳印上】六個火點沿黃金角撒在半徑 8 m 內 —— 純裝飾
    for (let k = 0; k < n; k++) {
      const r = n === 1 ? 0 : 8 * Math.sqrt((k + 0.5) / n)
      const a = k * 2.39996
      lightGroundFire(groundFires, d[o]! + Math.cos(a) * r, d[o + 1]! + top * 0.3, d[o + 2]! + Math.sin(a) * r)
    }
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
    // 【光與震動不吃放大】用原尺度，見 `BOMB_BLAST_SIZE`；碎片與火星跟著火球走
    const vis = scale * BOMB_BLAST_SIZE
    scaleBlast(recipe, vis * vis * vis, SCALED_BLAST)
    const seed = (e * 197 + Math.round(world.time * 60)) | 0
    emitBlast(BLAST_POOLS, SCALED_BLAST, d[o]!, d[o + 1]!, d[o + 2]!, seed)
    addShake(cameraShake, d[o]!, d[o + 1]!, d[o + 2]!, ordnanceShakeScale(scale), ctx.camera.position)
    blastLights.flash(d[o]!, d[o + 1]!, d[o + 2]!, scale, ctx.camera.position)
    // 碎片與擊墜共用同一個池；散射速度跟著火球的大小走
    debris.burst(d[o]!, d[o + 1]!, d[o + 2]!, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
    // 【落水的不噴】水面爆炸是水冠，火星不合理
    if (kind < 0.5 || kind > 1.5) burstSparks(d[o]!, d[o + 1]!, d[o + 2]!)
  }
}

/**
 * 一朵火災的迷你爆炸。**船火與地面火共用這一支** —— 配方在
 * `render/firePuff.ts`，靶場（`tools/range.ts`）接的也是它。
 *
 * **在模組層建一次** —— 幀迴圈裡宣告閉包是每幀一次配置。
 */
const emitFirePuff = createFirePuff(BLAST_POOLS, shipFireSmoke)

/**
 * 殘骸的引擎火。**同一份配方、小一號** —— 燒的是一具發動機艙，不是整艘
 * 燃燒的軍艦。
 */
const emitWreckFirePuff = createFirePuff(
  BLAST_POOLS, wreckFireSmoke, WRECK_FIRE_SCALE, WRECK_FIRE_SMOKE_SCALE, wrecks.anchors,
)

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
    addShake(cameraShake, x, y, z, ordnanceShakeScale(scale), ctx.camera.position)
    blastLights.flash(x, y, z, scale, ctx.camera.position)
    // 碎片從水面往上拋；與擊墜共用同一個池
    debris.burst(x, y, z, BLAST_DEBRIS_COLOR, seed, blastDebrisSpeed())
    burstSparks(x, y, z)
  }
}

/**
 * 高砲的引爆搖鏡頭。**配方在 `emitFlakBlasts`（`blast.ts`）裡放，震動在這
 * 一層加** —— 那一支不知道相機在哪裡，而震動一定要量到相機的距離。
 *
 * 呼叫端負責排空 `events`。
 */
function shakeFlakBursts(events: BurstEvents): void {
  for (let e = 0; e < events.count; e++) {
    // 【尺度逐發帶】艦砲與陸砲各有自己的 `burstShake`，要分開調就改那一格
    addShake(cameraShake, events.x[e]!, events.y[e]!, events.z[e]!,
      events.shake[e]!, ctx.camera.position)
    // 【不放大】火網下每秒好幾發；照原始尺度亮一下
    blastLights.flash(events.x[e]!, events.y[e]!, events.z[e]!,
      events.shake[e]!, ctx.camera.position, false)
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
  fireball, smoke, spray, sparks, blastSparks, splashes, debris, vortex, flakBursts, wakes,
  blastChunks, blastGlow, blastEmber, blastSmoke, blastDust, blastMist, blastJets,
  // 【船火那兩份也在這裡】漏清煙池的話上一場的煙殘留 12 秒；漏清 `shipFires`
  // 更糟 —— 上一場的火點會用同一個船索引附到新一場的船上，燒滿 60 秒
  shipFireSmoke, wreckFireSmoke, shipFires, groundFires, steam,
  // 【鏡頭震動也在這裡】跨場狀態、`reset()` 的簽章一樣。漏清的話上一場
  // 最後那一顆炸彈的餘震會接在新一場的第一幀上
  cameraShake,
]

/** 每一座冒煙的構件每秒幾顆蒸汽 */
const STEAM_PER_SECOND = 6
/**
 * 蒸汽被吹斜的水平速度，m/s，與抖動的幅度。
 *
 * 【風向要固定】每一顆各抽一個方向的話，柱子是往四面散開的一叢；真的煙囪
 * 是整片往同一邊斜。八根煙囪的斜度一致，才有「同一片天空」的感覺。
 */
const STEAM_WIND_X = 2.6
const STEAM_WIND_Z = -1.4
const STEAM_GUST = 0.7
let steamAccum = 0
let steamSeed = 0
/**
 * 廠區的白煙：每一座**活著的**煙囪與冷卻塔在頂端持續冒蒸汽，加上佈景的
 * 八根煙囪（打不掉，所以炸完六座構件之後廠區仍在冒煙）。純裝飾，種子用
 * 計數器 —— 與 `emitFirePuff` 同一套。
 *
 * 【這裡不配置記憶體】每幀跑。`PLANT_STACKS` 是模組常數而且已經是世界
 * 座標，迴圈裡沒有 `new`、沒有換算。
 */
function emitPlantSteam(frameSeconds: number): void {
  steamAccum += frameSeconds * STEAM_PER_SECOND
  const n = Math.floor(steamAccum)
  if (n <= 0) return
  steamAccum -= n
  if (terrainKind === 'leuna') {
    for (const p of PLANT_STACKS) {
      for (let k = 0; k < n; k++) {
        const s = (steamSeed = (steamSeed + 1) | 0)
        const gx = (hash01(s * 3 + 1) * 2 - 1) * STEAM_GUST
        const gz = (hash01(s * 3 + 2) * 2 - 1) * STEAM_GUST
        const ox = (hash01(s * 3 + 3) * 2 - 1) * 1.5
        steam.emit(p.x + ox, p.y, p.z,
          STEAM_WIND_X + gx, STEAM_PLUME_SPEED, STEAM_WIND_Z + gz, 1)
      }
    }
  }
  for (const t of world.groundTargets) {
    if (!t.alive) continue
    const id = t.unit.id
    if (id !== 'chimney' && id !== 'coolingTower') continue
    for (let k = 0; k < n; k++) {
      const s = (steamSeed = (steamSeed + 1) | 0)
      const gx = (hash01(s * 3 + 1) * 2 - 1) * STEAM_GUST
      const gz = (hash01(s * 3 + 2) * 2 - 1) * STEAM_GUST
      // 冷卻塔的頂寬，蒸汽從整個頂面冒；煙囪從一個點
      const spread = id === 'coolingTower' ? 8 : 1.5
      const ox = (hash01(s * 3 + 3) * 2 - 1) * spread
      steam.emit(t.position.x + ox, t.impactY, t.position.z,
        STEAM_WIND_X + gx, STEAM_PLUME_SPEED, STEAM_WIND_Z + gz, 1)
    }
  }
}

/** 每一枚亮著的照明彈每秒幾顆白煙 */
const FLARE_SMOKE_PER_SECOND = 4
let flareSmokeAccum = 0

/**
 * 照明彈的白煙：傘降的煙是往上拖的。借 `steam` 池（與廠區的蒸汽同一個），
 * 種子用同一個計數器。每幀跑，不配置。
 */
function emitFlareSmoke(frameSeconds: number): void {
  const fl = world.flares
  if (fl.count === 0) return
  flareSmokeAccum += frameSeconds * FLARE_SMOKE_PER_SECOND
  const n = Math.floor(flareSmokeAccum)
  if (n <= 0) return
  flareSmokeAccum -= n
  for (let i = 0; i < fl.capacity; i++) {
    // 還沒點燃的不冒煙
    if (fl.live[i] === 0 || fl.age[i]! < 0) continue
    for (let k = 0; k < n; k++) {
      const s = (steamSeed = (steamSeed + 1) | 0)
      const gx = (hash01(s * 3 + 1) * 2 - 1) * STEAM_GUST
      const gz = (hash01(s * 3 + 2) * 2 - 1) * STEAM_GUST
      steam.emit(fl.x[i]!, fl.y[i]!, fl.z[i]!, STEAM_WIND_X * 0.5 + gx, STEAM_PLUME_SPEED, STEAM_WIND_Z * 0.5 + gz, 1.5)
    }
  }
}

function resetPools(): void {
  for (const p of POOLS) p.reset()
  resetFlakBurstSeed()
  resetFlakBlastSeed()
}

ctx.scene.add(debris.object)

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
  if (v.lod !== null) {
    ctx.scene.remove(v.lod.group)
    v.lod.dispose()
    v.lod = null
  }
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
  audio.stopAll()
  clearCues(cues)
  resetAudioState()
  tutorialPending = []
  tutorialOpen = false
  ignoreNextUnlock = false
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
  // 【重開也要有橫幅】橫幅靠文字改變觸發，上一場留下的文字要清掉
  bannerText = ''
  // 【上一場的聲音不帶過來】爆炸的尾巴、延遲中的遠方爆炸、裝填的邊緣都清掉
  audio.stopAll()
  clearCues(cues)
  resetAudioState()
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
  setPlayer(battle.player)
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
  // 【再打一場也要有橫幅】橫幅靠文字改變觸發，上一場留下的文字要清掉；
  // 結算的「再打一場」走的是這裡，不是 `restartBattle`
  bannerText = ''
  // 1. 上一場的模型全部還回去（殘骸池持有的也在裡面）
  releaseVisuals()
  // 2. 其餘的池子歸零
  resetPools()
  buildBattleTerrain()
  startWorld(battleConfig())
}

/**
 * 同一件事的非同步版本：**每一段之間蓋著載入畫面、讓瀏覽器畫一次進度**，最後
 * 先把整個場景的著色器編好，第一幀就不會再卡一下。
 *
 * 【為什麼 `loadingBattle` 要蓋整段】`frame` 在載入期間照樣每幀跑，而第一場
 * 的 `battle` 要到 `startWorld` 才存在 —— 沒擋的話那幾幀會對 undefined 推進戰鬥。
 */
/** 這一場玩家那架飛機的全部教學卡。機種與掛載在 `startWorld` 之後才定 */
function playerTutorials(): Tutorial[] {
  return tutorialsFor(player.aircraft.spec.role, playerLoadout?.kind ?? null)
}

/** 進戰鬥、重新開始時世界的聲音從靜音淡入的長度，s */
const BATTLE_FADE_IN = 1

async function loadBattle(): Promise<void> {
  loadingBattle = true
  tutorialPending = []
  loading.show()
  try {
    await loading.hold()
    await loading.step('整理戰場', 0.05)
    // 與 `enterBattle` 同樣的第 1、2 段
    bannerText = ''
    releaseVisuals()
    resetPools()
    // 【佈景 GLB 進場才載】見 `preloadTerrainScenery`。只有洛伊納與波爾塔瓦
    // 要等，其餘地形是 no-op
    await loading.step('載入佈景', 0.1)
    await preloadTerrainScenery(battleTerrainKind())
    await loading.step('鋪設地形', 0.2)
    buildBattleTerrain()
    await loading.step('編組部隊', 0.5)
    startWorld(battleConfig())
    // 【機種與掛載在 startWorld 之後才知道】這架飛機還沒看過的卡；暫停時的
    // 「教學」按鈕看不看得到也在這時決定
    tutorialPending = unseenTutorials(playerTutorials(), readSeenTutorials())
    menu.setTutorialHelp(playerTutorials().length > 0)
    // 【音效在開場就開始背景下載】大多數時候這裡已經載完，等一下就過。
    // 沒載完時這是唯一還要連網的一步，所以進度條給它一整段，每載完一支推一格
    await loading.step('載入音效', 0.7)
    await audio.load((done, total) => {
      loading.set('載入音效', 0.7 + 0.15 * fileFraction(done, total))
    })
    await loading.step('編譯著色器', 0.85)
    // 【先編好】沒有這一步，第一幀要一次編完幾十個材質，進場那一下會頓
    await ctx.renderer.compileAsync(ctx.scene, ctx.camera)
    await loading.finish('出擊')
  } finally {
    loadingBattle = false
    loading.hide()
  }
  // 【載入畫面收掉才淡入】載入期間 context 開著；在前面淡的話，戰場出現時
  // 淡入已經走完，引擎聲還是一下子衝出來
  audio.fadeIn(BATTLE_FADE_IN)
}

/**
 * 這一場的地形種類。
 *
 * 【任務的地形是關卡設計的一部分】它寫在卡片上：太平洋那幾關要海面、帝國本土
 * 那一關要內陸。共用遭遇戰那一個「上一次選了什麼」的話，打完一場純海面遭遇戰
 * 再點任務卡，任務會靜靜地變成海面
 */
function battleTerrainKind(): TerrainKind {
  return mode === 'mission' && pendingMission !== null
    ? pendingMission.battle.terrain
    : setup.terrain
}

/**
 * 建場的第 3 段：地形、時段與界。
 *
 * 【佈景 GLB 要先載好】洛伊納與波爾塔瓦的地形同步地從快取拿佈景；`loadBattle`
 * 先 await `preloadTerrainScenery`。同步的 `enterBattle`（只有 `__drill` 在用）
 * 沒有那一步，換成那兩種地形會當場丟「還沒載入」。
 */
function buildBattleTerrain(): void {
  // 3. 地形重建。種類沒變也重建 —— 那條路徑因此每一場都在走，不是一條
  //    等著被第一次使用的死碼（M10 spec §5.3）
  terrainKind = battleTerrainKind()
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrain = createTerrain(terrainKind, terrainGfx())
  ctx.scene.add(terrain.object)
  // 【時段與地形同一個來源】任務讀卡片（省略 = 正午），遭遇戰讀玩家在編組頁
  // 選的那一格。天空、霧、三盞燈與海一次換完 —— 分開叫的話漏掉海的症狀是
  // 「黃昏的天配中午的海」，而且不會有東西報錯
  const timeOfDay = mode === 'mission' && pendingMission !== null
    ? pendingMission.battle.timeOfDay ?? 'noon'
    : setup.timeOfDay
  applyTimeOfDay(ctx, terrain, timeOfDay)
  // 【雷雨跟著時段】別的時段是 null —— 上一場的雷雨不會帶進下一場
  storm = timeOfDay === 'storm' ? createStorm() : null
  if (rain !== null) {
    ctx.scene.remove(rain.object)
    rain.dispose()
  }
  rain = storm !== null ? createRain() : null
  if (rain !== null) ctx.scene.add(rain.object)
  // 煙的材質不是 three 內建受光材質；時段換完要把同一顆太陽同步進 shader。
  syncFireSmokeLighting()
  resetArena()
}

/**
 * 建場的第 4 段要的設定。【兩條路各自有唯一的設定入口】遭遇戰走
 * `battleConfigFrom`、任務走 `missionConfigFrom` —— 難度 VETERAN 都在那兩個
 * 函數裡套
 */
function battleConfig(): BattleConfig {
  return drillConfig !== null
    ? drillConfig
    : mode === 'mission' && pendingMission !== null
      ? missionConfigFrom(pendingMission)
      : battleConfigFrom(setup)
}

/**
 * 依一份設定建起新的世界，並接好所有跨場重用的東西。
 *
 * **`enterBattle` 與有波次的「重新開始」共用這一段。**地形與界不在裡面 ——
 * 重開一場不換地形，而換場才需要重建它。
 */
function startWorld(cfg: BattleConfig): void {
  resetAudioState()
  battle = createBattle(playerController, cfg)
  // 【點光源在開場掛好，整場不變】見 `battle/battleLights.ts`。`add` 對已經掛著
  // 的物件是冪等的，`remove` 對沒掛的也是
  if (battleLights(cfg).flares) ctx.scene.add(flareLights.object)
  else ctx.scene.remove(flareLights.object)
  blastLights.reset()
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
   * 判定高度讀 `terrain.collisionHeightAt`：海面是平的、**不吃時間**，浪只是
   * 視覺。所以撞海與幀率、海浪動畫都無關。
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
  setPlayer(battle.player)
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
  if (searchlights !== null) {
    ctx.scene.remove(searchlights.object)
    searchlights.dispose()
    searchlights = null
  }
  if (world.groundTargets.length > 0) {
    groundModels = createGroundModels(world.groundTargets)
    ctx.scene.add(groundModels.object)
    searchlights = createSearchlights(world.groundTargets, glareTexture)
    ctx.scene.add(searchlights.object)
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
  // 【任務目標也要給代飛】玩家座位的手動控制器不經過 createBattle 的 AI 接線。
  // 省略時寫回 null，避免跨關沿用上一張卡的地面優先目標。
  playerAi.priorityGroundUnit = cfg.tuning.priorityGroundUnit ?? null
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

const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: MAX_FRAME_SECONDS })
let lastTime = performance.now()
let elapsed = 0
/**
 * 目標橫幅與中央訊息的打字機時鐘：記下文字改變的那一刻，HUD 只拿到
 * 「出現了幾秒」。用 `elapsed` 而不是牆鐘，暫停時打字也停。
 */
let bannerText = ''
let bannerStart = 0
let messageText = ''
let messageStart = 0
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

// ── 音效 ─────────────────────────────────────────────────────────────
//
// 【子步只記、每幀才播】世界的事件在物理子步裡就被清掉，所以要在子步裡讀；
// 但 240 Hz 裡不碰 Web Audio —— `queueAudioCues` 只寫四個數字進佇列，
// `updateAudio` 每一幀在鏡頭定位之後才播（距離、延遲、低通都量到鏡頭）。

/** 一幀最多 8 步、每步幾類事件 —— 512 筆夠寬，滿了丟新的 */
const cues = createCueQueue(512)
/** 自己被子彈打中時，另外播一下機身受創的機率 */
const HIT_DAMAGE_CHANCE = 0.35
/**
 * 機槍打在自己機身上的額外增益，dB。**只作用在這一條** —— 受創的悶響、
 * 以及疊在它上面的那一層金屬聲不吃這個值，五吋砲空爆造成的受創聲維持原樣。
 */
const BULLET_HIT_DB = -1.4
/** 子彈打中自己時，機身受創的輕重（0–1）。子彈沒有逐發的傷害事件，取一個中間偏輕的值 */
const BULLET_SEVERITY = 0.35
/** 空爆超過這個距離不記，m */
const FLAK_AUDIO_RANGE = 5000
/** 高射砲、艦砲開火聲的距離上限，m */
const CANNON_AUDIO_RANGE = 6000
/** 爆炸離鏡頭這麼近時另外播一陣機身晃動，m */
const NEAR_BLAST = 200
/** 敵彈擦過的判定半徑，m；兩次擦過聲之間至少隔幾秒 */
const FLYBY_RADIUS = 20
const FLYBY_GAP = 0.12
/** 炸彈呼嘯：離自己多近、正在下落才播，m */
const WHISTLE_RANGE = 400
/** 一幀掉超過這個比例的 HP 算重擊（高射砲、機砲） */
const HEAVY_HIT = 0.08
/**
 * 打中敵機的回饋至少隔這麼久才再響一次，s。
 *
 * 【為什麼要限】掃到敵機時幾乎每一幀都有命中，而命中聲平均 0.65 s —— 不限的話
 * 60 fps 疊將近 40 層，比單獨一次大 16 dB，還會把 24 個單次聲道佔滿。
 */
const HIT_DEALT_GAP = 0.1
/** 子彈打在船殼、建築上最密多久一次，s */
const MATERIAL_HIT_GAP = 0.07
/** 找不到正在打的那架時，回饋用這個距離，m */
/**
 * 別人的槍：最近這麼多秒內開過火就算「還在開火」，s。
 *
 * 【為什麼要保持】槍口閃光一發只亮 0.03 s，發與發之間有好幾幀是 0 ——
 * 直接看閃光的話，開火的循環一幀開、一幀關，聲道一直釋放又重播。砲塔更嚴重：
 * 不保持的話 60 秒內重啟一千多次。
 *
 * 【自己的槍不用這個】自己那架不播循環 —— 每次擊發播一個齊射 one-shot，
 * 見 `CUE.SelfVolley` 與 `volleyPool`。
 */
const FIRE_HOLD = 0.25

const ENGINE_KEYS = new Int32Array(8)
const FIRE_KEYS = new Int32Array(6)
const TURRET_KEYS = new Int32Array(6)
const AUDIO_POS: Vector3[] = []
const AUDIO_VALID = new Uint8Array(64)
const GUN_POS = new Vector3()
const WIND = { cutoffHz: 0, gainDb: 0 }
/** 上一幀每一門砲的 flash —— 由 0 變正就是剛開火。依平台、砲位的順序排 */
const prevGunFlash = new Float32Array(1024)
/** 炸彈呼嘯：每個炸彈槽播過沒有、上一幀的 age（age 變小代表槽被重用） */
const whistled = new Uint8Array(512)
const prevBombAge = new Float64Array(512)
/** 每架飛機前射武器、砲塔最近一次開火的時間（`elapsed`），依座位索引 */
const lastGunFire = new Float64Array(64)
const lastTurretFire = new Float64Array(64)
/** 每架轟炸機的砲塔循環用第幾座的聲音；−1 = 還沒挑。見 `noteTurretFire` */
const turretPick = new Int16Array(64)
/**
 * 自己那架的前射武器分組：同一種槍算一組，每組記一個代表掛架與它的齊射庫。
 *
 * 【為什麼同一種槍只記一個掛架】`stepCadence` 讓同型槍共用一份射速時鐘，
 * 六挺是一起擊發的；素材也是照這樣疊出來的，一組播一次就好。
 */
const volleyGroups: { mount: number; pool: Pool }[] = []
/** 分組代表掛架上一個子步的槍焰 —— 由 0 變正就是剛擊發 */
const prevVolleyFlash = new Float32Array(8)
/** 多普勒要聽者的速度。鏡頭沒有速度這個量，只能逐幀相減 */
const prevCamPos = new Vector3()
const camVel = new Vector3()
const CAM_STEP = new Vector3()
let camPosValid = false
/**
 * 單幀位移換算超過這個速度就當成鏡頭瞬移，速度歸零，m/s。
 *
 * 【瞬移不是速度】切視角、重生、換場會讓鏡頭一幀跳幾百公尺，相減出來是
 * 幾千 m/s —— 那一幀所有引擎聲會整片變調。比最快的飛機（225 m/s）大得多，
 * 正常飛行不會誤判。
 */
const CAM_TELEPORT_SPEED = 400
/** 鏡頭速度的平滑時間常數，s —— 鏡頭晃動不該變成音高抖動 */
const CAM_VEL_TAU = 0.05
const HIT_FB = { gainDb: 0, cutoffHz: 0 }
let prevPlayerHp = -1
let prevReloading = false
let prevViewMode: typeof input.viewMode = 'third'
let rattleTimer = 0
let lastFlyby = -Infinity
let lastHitDealt = -Infinity
/** 上一次播子彈打在船殼、建築上的世界時間 */
let lastMaterialHit = -Infinity
/** 每一層砲上一次開火出聲的時間（`elapsed`）。層的名字見 `world/shipAA.ts` */
const lastGunTier = new Map<string, number>()
/**
 * 這一幀每一層最近的那一座剛開火的砲。**值就地改寫，不在幀迴圈裡配置** ——
 * 只有第一次見到某一層時才建一個。
 */
const gunPick = new Map<string, { dist: number; x: number; y: number; z: number }>()
/** 最後一次有飛機被打中，是誰的哪個部位。−1 = 這一場還沒有過 */
let lastDealtVictim = -1
let lastDealtPart = 0
/** 這一幀有飛機被打中（自己以外）。子步裡寫、`updateAudio` 讀完歸零 */
let hitDealtPending = false

/**
 * 上一幀的狀態全部歸零。開戰、離開、接手僚機時呼叫 —— 不歸零的話，
 * 上一架正在裝填、新的這一架沒有，會誤播「裝填完成」。
 */
function resetAudioState(): void {
  // 【流速要收回 1】分出勝負那段是超級慢動作，離場時不收的話選單的按鈕
  // 音會用戰場最後的流速播 —— 聽起來像壞掉的按鈕
  audio.setTimeScale(1)
  prevGunFlash.fill(0)
  camPosValid = false
  camVel.set(0, 0, 0)
  whistled.fill(0)
  prevBombAge.fill(0)
  lastGunFire.fill(-Infinity)
  lastTurretFire.fill(-Infinity)
  turretPick.fill(-1)
  prevPlayerHp = -1
  prevReloading = false
  rattleTimer = 0
  lastFlyby = -Infinity
  lastHitDealt = -Infinity
  lastMaterialHit = -Infinity
  lastGunTier.clear()
  gunPick.clear()
  lastDealtVictim = -1
  prevViewMode = input.viewMode
}

/**
 * `player` 的唯一寫入點。**齊射分組與槍焰的邊緣狀態跟著換** —— 新的這一架武裝不同，
 * 沿用上一架的分組會播錯庫，或者整組沒聲音，而且兩種都不會報錯。
 */
function setPlayer(c: Combatant): void {
  player = c
  rebuildVolleyGroups()
}

/** 逐幀相減得到鏡頭速度，寫進 `camVel`。每一幀在鏡頭定位之後呼叫一次 */
function trackCameraVelocity(dt: number): void {
  const cam = ctx.camera.position
  if (!camPosValid || dt <= 0) {
    prevCamPos.copy(cam)
    camVel.set(0, 0, 0)
    camPosValid = true
    return
  }
  CAM_STEP.subVectors(cam, prevCamPos)
  prevCamPos.copy(cam)
  if (CAM_STEP.length() / dt > CAM_TELEPORT_SPEED) {
    camVel.set(0, 0, 0)
    return
  }
  camVel.lerp(CAM_STEP.divideScalar(dt), 1 - Math.exp(-dt / CAM_VEL_TAU))
}

/** 自己這架的前射武器依武器種類分組 */
function rebuildVolleyGroups(): void {
  volleyGroups.length = 0
  prevVolleyFlash.fill(0)
  const mounts = player.aircraft.spec.battery.mounts
  const seen = new Map<string, number>()
  for (let i = 0; i < mounts.length; i++) {
    const id = mounts[i]!.weapon.id
    if (seen.has(id)) continue
    seen.set(id, i)
    let guns = 0
    for (const m of mounts) if (m.weapon.id === id) guns++
    const pool = volleyPool(id, guns)
    if (pool !== null && volleyGroups.length < prevVolleyFlash.length) volleyGroups.push({ mount: i, pool })
  }
}

/**
 * 打中敵機的回饋。**不定位、但依那架有多遠給一點衰減與變悶**（見 `hitFeedback`）：
 * 打遠的聽起來悶而小聲，打近的清脆，兩者都還聽得見。
 *
 * 距離取畫面上最近的那架敵機 —— HUD 的接觸表已經算好，與前置量小圈是同一份資料。
 */
function playHitDealt(): void {
  if (elapsed - lastHitDealt < HIT_DEALT_GAP) return
  const victim = world.combatants[lastDealtVictim]
  if (victim === undefined) return
  lastHitDealt = elapsed
  hitFeedback(victim.aircraft.state.position.distanceTo(ctx.camera.position), HIT_FB)
  // 【與自己被打中同一條曲線】只是換成看對方那架：大台的、護甲厚的部位比較低沉
  const spec = victim.aircraft.spec
  const rate = hitRate(spec.mass, spec.protection[partOf(lastDealtPart)])
  audio.playPool('hit', 'hitDealt', 0, 0, 0, false, HIT_FB.gainDb, false, rate, HIT_FB.cutoffHz)
}

/** 物理子步裡呼叫，排在所有事件清除之前。只寫佇列 */
function queueAudioCues(): void {
  // 自己開火：每一組同型槍擊發一次記一筆。上帝視角時自己那架改走定位的開火循環
  const flash = player.muzzleFlash
  for (let i = 0; i < volleyGroups.length; i++) {
    const now = flash[volleyGroups[i]!.mount] ?? 0
    const was = prevVolleyFlash[i]!
    prevVolleyFlash[i] = now
    if (now > 0 && was <= 0 && player.alive && !input.godView) pushCue(cues, CUE.SelfVolley, i, 0, 0)
  }
  const k = world.killEvents
  for (let e = 0; e < k.count; e++) {
    const o = e * KILL_STRIDE
    const x = k.data[o]!, y = k.data[o + 1]!, z = k.data[o + 2]!
    pushCue(cues, CUE.Explosion, x, y, z)
    // 【落水才加水花】`onLand` 為假的也包括空中爆炸
    const w = terrain.waterAt(x, z)
    if (w > -Infinity && y - w <= CRASH_BLAST_HEIGHT) pushCue(cues, CUE.Splash, x, w, z)
  }
  // 【炸彈擊毀的不另外響】那一顆的落點事件已經響過（與 `emitGroundKills` 同一條）
  const g = world.groundKillEvents
  for (let e = 0; e < g.count; e++) {
    const o = e * IMPACT_STRIDE
    if (g.data[o + 5]! === 0) pushCue(cues, CUE.Blast, g.data[o]!, g.data[o + 1]!, g.data[o + 2]!)
  }
  const b = world.bombEvents
  for (let e = 0; e < b.count; e++) {
    const o = e * IMPACT_STRIDE
    const x = b.data[o]!, y = b.data[o + 1]!, z = b.data[o + 2]!
    const kind = b.data[o + 3]!
    // 【當量】與畫面那一套同一個來源：`ny` 帶的是爆心傷害
    const scale = blastScaleOf(b.data[o + 4]!)
    if (kind > 0.5 && kind < 1.5) {
      pushCue(cues, CUE.Splash, x, y, z, scale)
      pushCue(cues, CUE.SplashBoom, x, y, z, scale)
    } else {
      pushCue(cues, CUE.Blast, x, y, z, scale)
    }
  }
  const t = world.torpedoEvents
  for (let e = 0; e < t.count; e++) {
    const o = e * IMPACT_STRIDE
    const x = t.data[o]!, z = t.data[o + 2]!
    const w = terrain.waterAt(x, z)
    const y = Number.isFinite(w) ? w : t.data[o + 1]!
    const scale = blastScaleOf(t.data[o + 4]!)
    pushCue(cues, CUE.Blast, x, y, z, scale)
    pushCue(cues, CUE.Splash, x, y, z, scale)
  }
  const f = world.burstEvents
  const cam = ctx.camera.position
  const me = player.aircraft.state.position
  for (let i = 0; i < f.count; i++) {
    const dx = f.x[i]! - cam.x, dy = f.y[i]! - cam.y, dz = f.z[i]! - cam.z
    if (dx * dx + dy * dy + dz * dz < FLAK_AUDIO_RANGE * FLAK_AUDIO_RANGE) {
      pushCue(cues, CUE.FlakBurst, f.x[i]!, f.y[i]!, f.z[i]!)
    }
    // 【炸在自己身上就是受創】爆風的傷害不走子彈那條事件（`World.applyBursts`
    // 自己吃掉），這裡用同一支 `flakDamage` 算，聲音的輕重才跟實際傷害一致
    //
    // 【上帝視角不記】身上的聲音是不定位的，那時鏡頭在世界裡、離自機很遠，
    // 貼在鏡頭上播等於「在耳邊」，與畫面對不上
    if (!player.alive || input.godView) continue
    const ex = f.x[i]! - me.x, ey = f.y[i]! - me.y, ez = f.z[i]! - me.z
    // 【輕重看炸得多近，不看血量】同一發打在 B-17 與 P-51 身上，玩家聽到的該是
    // 同一聲；除以血量的話，血厚的機種永遠只聽到擦邊
    const dmg = flakDamage(Math.sqrt(ex * ex + ey * ey + ez * ez), f.radius[i]!, f.damage[i]!)
    if (dmg > 0) pushCue(cues, CUE.Damage, dmg / f.damage[i]!, 0, 0)
  }
  // 子彈打在船殼、建築上。【要限頻率】對船掃射時六挺每秒命中幾十發，
  // 不限的話光這一項就把事件佇列灌滿，爆炸與擊落會被擠掉
  const mh = world.materialHits
  for (let e = 0; e < mh.count; e++) {
    if (world.time - lastMaterialHit < MATERIAL_HIT_GAP) break
    lastMaterialHit = world.time
    const o = e * IMPACT_STRIDE
    pushCue(cues, CUE.MaterialHit, mh.data[o]!, mh.data[o + 1]!, mh.data[o + 2]!, mh.data[o + 3]!)
  }
  clearImpacts(mh)
  const dmg = world.damageEvents
  for (let i = 0; i < dmg.count && !input.godView; i++) {
    const o = i * DAMAGE_STRIDE
    // 【誰打中誰都算】不分射手 —— 僚機打中的也聽得到。太遠的由距離衰減擋掉，
    // 而距離要量**真正被打中的那一架**，所以這裡記下是誰
    if (dmg.data[o]! !== player.index) {
      lastDealtVictim = dmg.data[o]!
      lastDealtPart = dmg.data[o + 4]!
      hitDealtPending = true
    }
    if (dmg.data[o]! !== player.index) continue
    // 【x 帶的是被打中的部位序號】不是座標；護甲厚的部位聽起來比較低沉
    pushCue(cues, CUE.HitSelf, dmg.data[o + 4]!, 0, 0)
    if (Math.random() < HIT_DAMAGE_CHANCE) pushCue(cues, CUE.Damage, BULLET_SEVERITY, 0, 0)
  }
}

function playCues(): void {
  const cam = ctx.camera.position
  for (let i = 0; i < cues.count; i++) {
    const o = i * CUE_STRIDE
    const x = cues.data[o + 1]!, y = cues.data[o + 2]!, z = cues.data[o + 3]!
    // 【當量決定大小聲與低沉／脆】零戰的 60 kg 彈是 0.11、陸攻的魚雷是 1.67
    const scale = cues.data[o + 4]!
    const db = blastGainDb(scale)
    const rate = blastRate(scale)
    switch (cues.data[o]!) {
      // 【疊兩層】爆炸、水花、自己被打一次挑兩個不同的疊（見 `playPool` 的 layered）
      case CUE.Explosion:
      case CUE.Blast:
        // 【同一個庫、不同的類別】差別只在傳多遠，見 `CATEGORY.blast`
        audio.playPool('explosion', cues.data[o]! === CUE.Blast ? 'blast' : 'explosion',
          x, y, z, true, db, true, rate)
        if (Math.hypot(x - cam.x, y - cam.y, z - cam.z) < NEAR_BLAST) {
          audio.playPool('rattle', 'rattle', 0, 0, 0, false, -6)
        }
        break
      case CUE.Splash: audio.playPool('splash', 'splash', x, y, z, true, db, true, rate); break
      case CUE.SplashBoom: audio.playPool('explosion', 'blast', x, y, z, true, db - 12, false, rate); break
      case CUE.FlakBurst: audio.playPool('flakBurst', 'flakBurst', x, y, z, true, 0, true); break
      // 【x 帶的是被打中的部位序號】不是座標
      case CUE.HitSelf: audio.playPool('hit', 'hitSelf', 0, 0, 0, false, BULLET_HIT_DB, true, selfHitRate(x)); break
      // 【第五格帶的是材質】查不到的材質走預設，不會沒聲音
      case CUE.MaterialHit: {
        const m = impactSound(scale)
        audio.playPool(m.pool, 'impact', x, y, z, true, m.gainDb, false, m.rate, m.cutoffHz)
        break
      }
      // 【受創的 x 帶的是輕重】0 = 擦到一點、1 = 重擊，見 `damageGainDb`
      case CUE.Damage: playHeavyHit(x); break
      // 【自己開火的 x 帶的是分組序號】不是座標
      case CUE.SelfVolley: audio.playPool(volleyGroups[x]!.pool, 'fireSelf', 0, 0, 0, false); break
    }
  }
}

/**
 * 自己被打中的播放速度：**越大台、被打中的部位護甲越厚就越低沉**。
 * 部位序號是 `HIT_PARTS` 的索引，由受擊事件帶過來。
 */
function selfHitRate(partIndex: number): number {
  const spec = player.aircraft.spec
  return hitRate(spec.mass, spec.protection[partOf(partIndex)])
}

/** 部位序號 → 部位。認不得的當機身 —— 音效不該因為一個序號就整個不播 */
function partOf(partIndex: number): HitPart {
  return HIT_PARTS[partIndex] ?? 'fuselage'
}

/** 自己受創：一下結構的悶響，疊一下小一截的金屬命中。音量跟著輕重走 */
function playHeavyHit(severity: number): void {
  const db = damageGainDb(severity)
  audio.playPool('damage', 'damage', 0, 0, 0, false, db)
  audio.playPool('hit', 'hitSelf', 0, 0, 0, false, db + LAYER_DB)
}

/**
 * 高射砲、艦砲開火：flash 由 0 變正的那一幀響一下。
 *
 * 【每一層各自限頻率，而且只響最近的那一座】20 mm 一座每秒八發、一艘船八個
 * 砲位 —— 不限的話光它就把聲道吃光，五吋砲與爆炸反而聽不見。但那個時段是
 * **整個戰場共用一個**，取第一個輪到的等於隨機挑：貼著一座砲飛時，聽到的
 * 常常是八百公尺外那一門在響，而旁邊這門悶不吭聲。所以先掃一趟挑最近的。
 */
function playCannons(): void {
  const cam = ctx.camera.position
  for (const e of gunPick.values()) e.dist = Infinity

  // 第一趟：邊緣偵測，每一層留下離鏡頭最近的那一座
  let slot = 0
  const platforms = [world.ships, world.groundTargets] as const
  for (const list of platforms) {
    for (const p of list) {
      for (const gun of p.guns) {
        // 【滿了只停止記錄，不能整支返回】第二趟還沒跑，返回等於這一幀全啞
        if (slot >= prevGunFlash.length) break
        const was = prevGunFlash[slot]!
        prevGunFlash[slot++] = gun.flash
        if (!(gun.flash > 0 && was <= 0) || !p.alive) continue
        GUN_POS.copy(gun.zone.position).applyQuaternion(p.orientation).add(p.position)
        const d = GUN_POS.distanceTo(cam)
        if (d >= CANNON_AUDIO_RANGE) continue
        let best = gunPick.get(gun.zone.tier)
        if (best === undefined) {
          best = { dist: Infinity, x: 0, y: 0, z: 0 }
          gunPick.set(gun.zone.tier, best)
        }
        if (d >= best.dist) continue
        best.dist = d
        best.x = GUN_POS.x
        best.y = GUN_POS.y
        best.z = GUN_POS.z
      }
    }
  }

  // 第二趟：每一層在自己的時段裡響一次，位置取剛才挑到的那一座
  for (const [tier, best] of gunPick) {
    if (best.dist === Infinity) continue
    const g = gunSound(tier)
    if (elapsed - (lastGunTier.get(tier) ?? -Infinity) < g.gap) continue
    lastGunTier.set(tier, elapsed)
    audio.playPool('cannon', 'cannon', best.x, best.y, best.z, true,
      g.gainDb, false, g.rate, g.cutoffHz)
  }
}

function anyFlash(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (a[i]! > 0) return true
  return false
}

/**
 * 記下這架轟炸機的砲塔循環用哪一座的聲音：**最近在開火、管數最多的那一座**。
 *
 * 【只往大的換】閃光一幀一幀在不同砲塔之間跳；每一幀都挑「現在亮著的」的話，
 * 單管、雙聯輪流被選到，每換一次檔就從頭播。停火超過 FIRE_HOLD 才重新挑。
 * 呼叫時 `lastTurretFire` 還是上一次開火的時間。
 */
function noteTurretFire(c: Combatant): void {
  const turrets = c.aircraft.spec.turrets
  let cand = -1
  for (let i = 0; i < turrets.length; i++) {
    if (c.turretStates[i]!.flash > 0 && (cand < 0 || turrets[i]!.guns > turrets[cand]!.guns)) cand = i
  }
  if (cand < 0) return
  const i = c.index
  const cur = turretPick[i]!
  if (cur < 0 || elapsed - lastTurretFire[i]! >= FIRE_HOLD || turrets[cand]!.guns > turrets[cur]!.guns) turretPick[i] = cand
  lastTurretFire[i] = elapsed
}

/**
 * 每一幀、鏡頭定位之後呼叫：播佇列、引擎、開火、砲塔、艦砲、擦過、呼嘯、
 * 受創、晃動、風切、警告、裝填。
 */
function updateAudio(worldSeconds: number): void {
  const me = player
  // 【坐在座艙裡才有身上的聲音】上帝視角時鏡頭在世界裡，不定位的聲音會變成「在耳邊」
  const flying = me.alive && !input.godView
  // 【先更新聲道再播】搶聲道是比估計響度。不先把播放中的聲道更新到這一幀的距離，
  // 新的聲音拿本幀距離去跟上一幀的舊值比，明明比較響也會被擋掉
  // 【先更新聲道再播】搶聲道是比估計響度。不先把播放中的聲道更新到這一幀的距離，
  // 新的聲音拿本幀距離去跟上一幀的舊值比，明明比較響也會被擋掉
  audio.beginFrame()
  trackCameraVelocity(worldSeconds)
  playCues()
  clearCues(cues)
  // 【誰打中誰都播】僚機打中的也算。太遠的由距離衰減擋掉
  if (hitDealtPending && flying) playHitDealt()
  hitDealtPending = false
  playCannons()

  const cam = ctx.camera.position
  const all = world.combatants
  const n = Math.min(all.length, AUDIO_VALID.length)
  for (let i = 0; i < n; i++) AUDIO_POS[i] = visuals.get(all[i]!)!.position

  // 引擎：自己不定位；上帝視角時自己也進定位池
  for (let i = 0; i < n; i++) {
    const c = all[i]!
    AUDIO_VALID[i] = c.alive && !c.retired && (c !== me || !flying) ? 1 : 0
  }
  let m = nearestN(AUDIO_POS, AUDIO_VALID, n, cam.x, cam.y, cam.z, ENGINE_KEYS)
  for (let j = 0; j < m; j++) {
    const c = all[ENGINE_KEYS[j]!]!
    const p = AUDIO_POS[c.index]!
    // 【循環音才有多普勒】單次音效的音源是靜止的（爆炸），沒有升降調可言
    const doppler = dopplerRate(p, c.aircraft.state.velocity, cam, camVel)
    audio.assign('engine', c.index, engineFile(c.aircraft.spec.id), p.x, p.y, p.z,
      engineRate(c.command.throttle) * doppler)
  }
  // 開火的保持：最近 FIRE_HOLD 秒內開過火就算還在開火
  for (let i = 0; i < n; i++) {
    const c = all[i]!
    if (anyFlash(c.muzzleFlash)) lastGunFire[i] = elapsed
    noteTurretFire(c)
  }
  // 其他戰鬥機開火
  for (let i = 0; i < n; i++) {
    const c = all[i]!
    // 【上帝視角時自己也算一架】那時自機在畫面裡，開火聲該從它身上來
    AUDIO_VALID[i] = c.alive && (c !== me || !flying) && fireFile(c.aircraft.spec.id) !== null
      && elapsed - lastGunFire[i]! < FIRE_HOLD ? 1 : 0
  }
  m = nearestN(AUDIO_POS, AUDIO_VALID, n, cam.x, cam.y, cam.z, FIRE_KEYS)
  for (let j = 0; j < m; j++) {
    const c = all[FIRE_KEYS[j]!]!
    const p = AUDIO_POS[c.index]!
    audio.assign('fire', c.index, fireFile(c.aircraft.spec.id)!, p.x, p.y, p.z,
      dopplerRate(p, c.aircraft.state.velocity, cam, camVel))
  }
  // 砲塔（自己的轟炸機也算 —— 砲塔由 AI 操作）
  for (let i = 0; i < n; i++) {
    const c = all[i]!
    AUDIO_VALID[i] = c.alive && turretPick[i]! >= 0 && elapsed - lastTurretFire[i]! < FIRE_HOLD ? 1 : 0
  }
  m = nearestN(AUDIO_POS, AUDIO_VALID, n, cam.x, cam.y, cam.z, TURRET_KEYS)
  for (let j = 0; j < m; j++) {
    const c = all[TURRET_KEYS[j]!]!
    const t = c.aircraft.spec.turrets[turretPick[c.index]!]!
    const p = AUDIO_POS[c.index]!
    audio.assign('turret', c.index, turretFile(t.weapon.id, t.guns), p.x, p.y, p.z,
      dopplerRate(p, c.aircraft.state.velocity, cam, camVel))
  }
  audio.endFrame()

  // 自己身上的循環
  const spec = me.aircraft.spec
  audio.selfLoop('engine', flying ? engineFile(spec.id) : null, engineRate(me.command.throttle), 0)
  const vneRatio = indicatedAirspeed(me.aircraft.diag.aero.tas, me.aircraft.diag.air.sigma) / spec.limits.vne
  windParams(vneRatio, WIND)
  audio.selfLoop('wind', flying ? SINGLE_FILES.wind : null, 1, WIND.gainDb, WIND.cutoffHz)
  // 警告蜂鳴：飛出邊界，或速度進了紅線（與 HUD 的紅線警告同一個門檻）
  const warn = flying && ((hudFrame.arenaShow && arena.outside) || vneRatio >= OVERSPEED_FULL)
  audio.selfLoop('warn', warn ? SINGLE_FILES.warn : null, 1, 0)

  // 【擦過看的是鏡頭，不是機身】上帝視角時鏡頭在世界裡自由飛，從它旁邊掠過的
  // 子彈一樣該有聲音。坐在座艙裡時鏡頭就在機身上，兩者等價
  const eye = ctx.camera.position
  if (elapsed - lastFlyby >= FLYBY_GAP) {
    const team = input.godView ? -1 : teamSlot(me.team)
    const k = nearMiss(world.projectiles, team, eye.x, eye.y, eye.z, FLYBY_RADIUS)
    if (k >= 0) {
      lastFlyby = elapsed
      const p = world.projectiles
      audio.playPool('flyby', 'flyby', p.x[k]!, p.y[k]!, p.z[k]!, true)
    }
  }

  if (!flying) {
    prevPlayerHp = -1
    return
  }
  const pos = me.aircraft.state.position
  // 附近有炸彈落下 —— **自己投的也算**，那就是投彈的回饋
  const bombs = world.bombs
  const cap = Math.min(bombs.capacity, whistled.length)
  for (let i = 0; i < cap; i++) {
    if (bombs.age[i]! < prevBombAge[i]!) whistled[i] = 0
    prevBombAge[i] = bombs.age[i]!
    if (!bombs.active[i] || whistled[i] || bombs.vy[i]! >= 0) continue
    const dx = bombs.x[i]! - pos.x, dy = bombs.y[i]! - pos.y, dz = bombs.z[i]! - pos.z
    if (dx * dx + dy * dy + dz * dz > WHISTLE_RANGE * WHISTLE_RANGE) continue
    whistled[i] = 1
    audio.playFile(SINGLE_FILES.whistle, 'whistle', bombs.x[i]!, bombs.y[i]!, bombs.z[i]!, true)
  }
  // 重擊：HP 一幀掉很多（高射砲、機砲）
  const drop = prevPlayerHp >= 0 ? prevPlayerHp - me.hp : 0
  if (drop > spec.hp * HEAVY_HIT) playHeavyHit(Math.min(1, drop / (spec.hp * HEAVY_HIT * 2)))
  prevPlayerHp = me.hp
  // 機身晃動：超速或重傷
  const k = Math.min(1, overspeedShake(vneRatio) / OVERSPEED_SHAKE)
  if (k > 0) {
    rattleTimer -= worldSeconds
    if (rattleTimer <= 0) {
      audio.playPool('rattle', 'rattle', 0, 0, 0, false, shakeGainDb(k))
      rattleTimer = shakeInterval(k, Math.random)
    }
  } else {
    rattleTimer = 0
  }
  // 彈艙補滿
  const reloading = playerBay().reloading
  if (prevReloading && !reloading) audio.playFile(SINGLE_FILES.reloadDone, 'reload', 0, 0, 0, false)
  prevReloading = reloading
  // 進出投彈瞄準視角：彈艙的機械聲
  if (input.viewMode !== prevViewMode) {
    if (input.viewMode === 'bomb' || prevViewMode === 'bomb') {
      audio.playFile(SINGLE_FILES.bayToggle, 'reload', 0, 0, 0, false)
    }
    prevViewMode = input.viewMode
  }
}

/**
 * 戰鬥中的一幀：推進、內插、特效、HUD、記分板。
 *
 * 【為什麼抽出來】選單期間這一整段都不該跑（沒有 `Battle`）。抽成函數
 * 之後 `frame` 只剩下一個分支，而搬家本身沒有改任何一行內容 ——
 * `main.ts` 沒有測試護著，這一步必須看得出來只是搬家。
 *
 * @param frameSeconds 這一幀的時間。餵物理迴圈、上帝視角的移動與 HUD
 * @param worldSeconds 這一幀世界前進的時間（`loop.worldSeconds`）。煙、火、
 *   爆炸、殘骸、尾流、螺旋槳與鏡頭吃這個 —— 低於 30 fps 時世界變慢，它們
 *   要一起慢，否則在慢的電腦上特效比世界快
 */
function stepAndDrawBattle(frameSeconds: number, worldSeconds: number): void {
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
      worldSeconds,
    )
    input.firing = false
  } else if (aiFlying) {
    input.aimWorld.set(0, 0, -1).applyQuaternion(player.aircraft.state.orientation)
    // 左鍵失效：開火完全由 AI 的開火紀律決定
    input.firing = false
  } else if (input.viewMode === 'bomb') {
    // 【投彈模式只能微調】位移乘 `BOMB_AIM_SCALE`，旋轉軸取瞄準方向自己的
    // 水平座標系，不取相機 —— 投彈相機朝下看，拿它的軸滑鼠的語意就變了
    // （見 `levelAimBasis`）。不動滑鼠就是保持航向與姿態
    slewAimWorld(
      input.aimWorld, input.aimDeltaX * BOMB_AIM_SCALE, input.aimDeltaY * BOMB_AIM_SCALE,
      levelAimBasis(input.aimWorld, BOMB_AIM_BASIS), ctx.camera.fov * DEG,
    )
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
    // 【排在所有事件清除之前】見 `queueAudioCues`
    queueAudioCues()
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
    // 【落在陸地的炸彈也留火】水上的、打中船的、打中建築的各有各的去處
    lightGroundFires(groundFires, world.bombEvents)
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
    shakeFlakBursts(world.burstEvents)
    clearBursts(world.burstEvents)
    perf.endPhysics()
  })

  // 【玩家陣亡不再重生】M9 起改為接手僚機（`stepBattle` 的 takeover），
  // 舊機體於是像所有人一樣被殘骸池接管 —— M8 spec §10 預告的那件事現在
  // 自動成立了。
  if (battle.player !== player) {
    setPlayer(battle.player)
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
    // 上一架的 HP、裝填狀態不屬於新的這一架
    resetAudioState()
  }

  // reset 會把 prevPosition 一併設為新位置，因此重置不會被內插成一條
  // 橫跨半個地圖的殘影。
  propRotation += worldSeconds * (8 + input.throttle * 60)
  for (const c of world.combatants) {
    const v = visuals.get(c)!
    if (v.wrecked) {
      // 模型已經交給殘骸池，位置與旋轉從此由它寫
      if (!c.alive) continue
      // 【整隊重生的席位拿一具新模型】舊的那具由殘骸池在落海或被覆蓋時
      // 釋放。配置只發生在復活那一刻
      v.model = buildAircraft(c.aircraft.spec)
      ctx.scene.add(v.model.group)
      attachLod(v, c.aircraft.spec.id)
      v.wrecked = false
    }

    v.position.lerpVectors(c.aircraft.prevPosition, c.aircraft.state.position, alpha)
    v.quaternion.slerpQuaternions(c.aircraft.prevOrientation, c.aircraft.state.orientation, alpha)
    // 【距離 LOD】兩具的姿態都要寫 —— 只寫顯示中的那一具，換過去的那一幀
    // 會看到它還停在上一次顯示時的位置。
    if (v.lod !== null) {
      v.far = useAircraftLod(v.position.distanceToSquared(ctx.camera.position), v.far)
      v.lod.group.position.copy(v.position)
      v.lod.group.quaternion.copy(v.quaternion)
    }
    v.model.group.position.copy(v.position)
    v.model.group.quaternion.copy(v.quaternion)

    // 【整場不進場的席位不畫、不留殘骸】它從來沒有飛過
    if (c.retired) {
      v.model.group.visible = false
      if (v.lod !== null) v.lod.group.visible = false
      continue
    }
    if (!c.alive) {
      // 【殘骸的判準是「還有沒有人要用這個模型」，不是「這是不是玩家」】
      // M9 起玩家陣亡改為接手僚機，他的 alive 維持 false —— 這一段一個字
      // 都不用改就自動替玩家的舊機體留下殘骸（M8 spec §10 預告的那件事）。
      //
      // 【為什麼先內插再接管】殘骸的起始姿態必須接在畫面上最後看到的位置。
      // 用擊墜事件裡的子步位置會跳最多 0.83 m（M8 spec §3.1）。
      v.wrecked = true
      // 【殘骸接手目前顯示的那一具，另一具在這裡放掉】殘骸池只收一個 group，
      // 而墜落的殘骸會一路掉到眼前 —— 交低模過去的話近看是多邊形的機身。
      if (v.lod !== null) {
        ctx.scene.remove(v.lod.group)
        v.lod.dispose()
        v.lod = null
        v.far = false
      }
      const vel = c.aircraft.state.velocity
      wrecks.adopt(v.model, c.aircraft.spec, vel.x, vel.y, vel.z, c.index)
      continue
    }

    const shown = v.far && v.lod !== null ? v.lod : v.model
    if (v.lod !== null) {
      v.model.group.visible = !v.far
      v.lod.group.visible = v.far
    } else {
      v.model.group.visible = true
    }
    shown.setPropSpin(propRotation, c.command.throttle > 0.15)

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
  // 【閃電吃世界時間】暫停時 `worldSeconds` 是 0，天也不打雷
  if (storm !== null) {
    applyFlash(ctx.lights, ctx.sky, DAY_PALETTES.storm, stepStorm(storm, worldSeconds, playThunder))
  }

  const aircraft = player.aircraft
  // HUD 的迎角條與 STALL 字樣都拿它當分母
  const alphaCrit = aircraft.spec.lift.alphaCrit +
    (aircraft.diag.slatsDeployed ? aircraft.spec.lift.slatAlphaBonus : 0)

  // ── 投彈的準星與包絡 ──────────────────────────────────
  //
  // 【彈艙不在這裡推進】玩家的彈艙與 AI 一樣只由 `World.releaseBombs` 在物理步
  // 推進與投放；扣扳機是 `PlayerController` 寫進 `command.bombing`。這裡再推進
  // 一次的話，玩家的回補與連投間隔會快一倍。
  //
  // 【包絡每幀都算】它是準星的顏色，而準星在一般飛行時也畫
  const att = attitudeFromOrientation(renderQuat)
  const agl = renderPos.y - terrain.collisionHeightAt(renderPos.x, renderPos.z)
  // 【包絡與 agl 只解一次】HUD 的投放閘門與高度弧讀的必須是**這兩個值**，
  // 不是各自再查一次 —— 分家的症狀是「錶上綠燈而扳機沒有反應」，不拋例外
  // 也沒有訊息
  const releaseEnv = playerLoadout !== null ? envelopeFor(playerLoadout.kind, aircraft.spec.role) : null
  const releaseOk = releaseEnv !== null && canRelease(
    releaseEnv, att.roll, att.pitch, agl, aircraft.diag.aero.tas,
  )

  const bp = visuals.get(player)!.model.bombPoint
  if (bp !== null) BOMB_EYE.copy(bp).applyQuaternion(renderQuat).add(renderPos)
  // 【掛彈的戰鬥機從質心投】沒有瞄具眼點；`World.releaseBombs` 本來就從質心放
  else if (input.bombRelease) BOMB_EYE.copy(renderPos)

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
    if (bp !== null || input.bombRelease) {
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
      input.viewMode, input.lookYaw, input.lookPitch, worldSeconds, bombTarget,
    )
  }
  // 【排在兩個分支之後】上面算出來的是這一幀的目的姿態，過渡把它往按 G
  // 那一刻的姿態拉回一部分；過渡結束後這一行什麼都不做
  applyBlend(godBlend, ctx.camera, worldSeconds)
  // 【震動疊在最後】上面每一條分支都是從頭寫相機姿態的，排在它們之前會被
  // 整個蓋掉 —— 而畫面上只是「沒有震動」。也因為它們每幀重寫，這個偏移
  // 不會累積回相機
  // 【超速的持續搖晃】每幀由速度直接算、不衰減，與爆炸取最大值。上帝視角時
  // 鏡頭不在飛機上，不搖
  const shakeAero = player.aircraft
  cameraShake.sustained = input.godView ? 0 : overspeedShake(
    indicatedAirspeed(shakeAero.diag.aero.tas, shakeAero.diag.air.sigma)
      / shakeAero.spec.limits.vne,
  )
  stepCameraShake(cameraShake, worldSeconds)
  applyCameraShake(cameraShake, ctx.camera)
  // 【鏡頭定位之後】距離、音速延遲、低通都量到這一幀的鏡頭
  updateAudio(worldSeconds)

  tracers.update(world.projectiles)
  bombVisuals.update(world.bombs)
  torpedoVisuals.update(world.torpedoes)
  // 【火災走畫面時間，不是物理子步】它是純裝飾 —— 與 `sparks.step` 同一條
  // 【排在兩支 step 之前】這一幀的間隔倍率要先算好，否則兩支火用到的是
  // 上一幀的值；剛熄掉的格子也會慢一幀才歸位
  updateFireCrowd(fireCrowd, groundFires, shipFires, world.ships, worldSeconds)
  stepShipFires(shipFires, world.ships, worldSeconds, emitFirePuff, fireCrowd.ship)
  stepGroundFires(groundFires, worldSeconds, emitFirePuff, fireCrowd.ground)
  emitPlantSteam(worldSeconds)
  emitFlareSmoke(worldSeconds)
  // 【槍焰用內插姿態】它是一個狀態而不是一個瞬間，所以位置在這裡重算 ——
  // 用物理位置的話槍焰會相對機身抖動一個子步的位移（M7 spec §2.1）
  muzzles.update(world.combatants, renderPositions, renderQuaternions)
  // 【砲塔的槍管也用內插姿態】理由與槍焰完全相同
  turretBarrels.update(world.combatants, renderPositions, renderQuaternions)
  turretMuzzles.update(world.combatants, renderPositions, renderQuaternions)
  // 【火花與水柱在幀率積分】純裝飾，不參與判定也不需要決定性
  sparks.step(worldSeconds)
  // 【爆炸的火星走 `elapsed`】位置在著色器裡由出生到現在的時間算出來 ——
  // 暫停時它不走，慢動作時它一起慢
  blastSparks.step(elapsed)
  // 【殘骸與零件先步進，再把它們吐出來的事件餵給煙、噴濺與水柱】兩者的
  // 事件緩衝在各自的 step 開頭排空，所以這裡讀到的恆是這一幀的
  // 【落地與落水用兩支不同的函式】`heightAt` 決定「碰到地面了沒」，
  // `waterAt` 決定「那是水嗎」。共用一支的話摔在島上會噴水柱
  wrecks.step(worldSeconds, terrain.heightAt, terrain.waterAt, elapsed)
  debris.step(worldSeconds, terrain.heightAt, terrain.waterAt, elapsed)
  // 【殘骸的引擎在燒】走船火那一份配方，小一號。位置由 `wrecks` 每一步從
  // 機體座標轉成世界座標，法線那三格帶的是殘骸的速度 —— 火團要繼承它
  {
    const d = wrecks.fireEvents.data
    for (let e = 0; e < wrecks.fireEvents.count; e++) {
      const o = e * IMPACT_STRIDE
      emitWreckFirePuff(d[o]!, d[o + 1]!, d[o + 2]!, d[o + 3]!)
    }
  }
  emitSmoke(smoke, debris.smokeEvents, DEBRIS_SMOKE_SIZE)
  emitSpray(spray, wrecks.sprayEvents, WRECK_SPRAY_COUNT)
  emitSpray(spray, debris.sprayEvents, DEBRIS_SPRAY_COUNT)
  // 殘骸入水的那一圈水柱沿用 M7 的池子 —— 用數量換規模，splash.ts 不用改
  splashes.emit(wrecks.splashEvents, terrain.heightAt, elapsed)
  // 零件入水各濺一根小水柱。與噴濺讀同一份事件：同一次入水的兩個表現，
  // 位置相同。高低粗細由 splashSize 依格子隨機
  splashes.emit(debris.sprayEvents, terrain.heightAt, elapsed)
  splashes.step(worldSeconds)
  fireball.step(worldSeconds)
  smoke.step(worldSeconds)
  steam.step(worldSeconds)
  shipFireSmoke.step(worldSeconds)
  wreckFireSmoke.step(worldSeconds)
  // 【爆炸那一組】水冠要在水霧之前 —— 它的 `onFade` 會往水霧池發射，
  // 同一幀生的那幾團才不會被水霧自己的 `step` 漏掉一幀
  blastJets.step(worldSeconds)
  // 【這兩個要拿到殘骸的錨點】引擎火吸附在殘骸上，世界座標由池子每一幀
  // 自己組。不給的話那些火當場收掉 —— 畫面上是「飛機不燒了」
  blastChunks.step(worldSeconds, wrecks.anchors)
  blastGlow.step(worldSeconds, wrecks.anchors)
  blastEmber.step(worldSeconds)
  blastSmoke.step(worldSeconds)
  blastDust.step(worldSeconds)
  blastMist.step(worldSeconds)
  flakBursts.step(worldSeconds)
  flareLights.update(world.flares, elapsed)
  // 【畫面時間】閃光是純表現，與火花、火球同一條
  blastLights.step(worldSeconds)
  // 【船在渲染幀率更新，不在物理步】它讀的是船的位置與砲位的槍焰計時器，
  // 兩者都是狀態不是事件 —— 與飛機模型同一個道理。
  groundModels?.update(world.groundTargets, ctx.camera.position)
  searchlights?.update(elapsed, world.combatants, ctx.camera.position)
  shipModels?.update(world.ships, (x, y, z) => {
    // 砲位被打掉：當場一團火。**借火球池**，不另開一套。
    addShake(cameraShake, x, y, z, GUN_LOST_SHAKE, ctx.camera.position)
    blastLights.flash(x, y, z, GUN_LOST_SHAKE, ctx.camera.position)
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
  wakes.step(worldSeconds, elapsed, terrain.heightAt)
  vortex.step(worldSeconds)
  spray.step(worldSeconds)

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

  // 【雨跟著這一幀的鏡頭】雨絲的方向由雨自己算：雨滴這一幀在鏡頭眼裡移動了多少
  if (rain !== null) rain.update(ctx.camera.position, worldSeconds, frameSeconds)

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
  // 【掛彈的戰鬥機也畫彈艙格子】它沒有投彈視角，但一樣有彈、一樣要看補回
  hudFrame.bombCapable = input.bombCapable || input.bombRelease
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
    hudFrame.aiPhase = playerAi.hudPhase
    hudFrame.aiOverride = playerAi.hudOverride
    hudFrame.aiExtendWhy = playerAi.intent === 'extend'
      ? extendReason(playerAi.rules) : ''
  }
  hudFrame.godView = input.godView
  // 【`stepCameraShake` 之後】這一幀的震動量與相位在那裡才定案；排在它之前
  // 的話 HUD 會慢鏡頭一幀，兩者對不起來
  hudFrame.shakeAngle = hudShakeAngle(cameraShake)
  hudFrame.shakeX = hudShakeShiftX(cameraShake)
  hudFrame.shakeY = hudShakeShiftY(cameraShake)
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
  // 【通報接參考，不抄】池與淘汰都在 `stepBattle` 那一側。時間也一起送 ——
  // 行的年齡吃的是物理時間，用畫面時間量的話暫停時通報會繼續淡出
  hudFrame.report = battle.report
  hudFrame.reportTime = world.time

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
  hudFrame.objectiveMetricKind = m.metricKind
  // 【橫幅在目標文字改變的那一刻出現】開場是卡片上那一句短句；返航節拍
  // 換掉目標時是那一則訊息 —— 兩者走同一條。遭遇戰沒有橫幅
  const banner = mode !== 'mission'
    ? ''
    : battle.objectiveText !== ''
      ? battle.objectiveText
      : pendingMission?.battle.banner ?? hudFrame.objectiveText
  if (banner !== bannerText) {
    bannerText = banner
    bannerStart = elapsed
    // 【橫幅配電報聲】與訊息同一組；橫幅消失（換成空字串）時不響
    if (bannerText !== '') audio.playPool('radio', 'radio', 0, 0, 0, false)
  }
  hudFrame.objectiveBanner = bannerText
  hudFrame.objectiveBannerAge = bannerText === '' ? -1 : elapsed - bannerStart
  // 【分母由 `mission.ts` 給】只有擊沉會填總艘數，其餘任務恆是 −1
  hudFrame.objectiveMetricTotal = m.metricTotal
  // 【−1 由 `mission.ts` 給】只有護送／攔截會填實際架數，其餘任務恆是 −1
  hudFrame.objectiveRemaining = m.remaining
  // 【門檻讀當下的規則】返航節拍會換掉規則，開場的 `cfg.rules` 可能已經過時
  hudFrame.objectiveArrived = m.arrived
  // 【截斷的分母是放行上限】「已抵達 1/4」—— 玩家在盯的是還能放走幾輛
  hudFrame.objectiveNeed = battle.rules.kind === 'convoy'
    ? battle.rules.need ?? 1
    : battle.rules.kind === 'interdict' ? battle.rules.leak : -1
  hudFrame.objectiveSeconds = m.secondsLeft
  hudFrame.objectiveHasTarget = m.hasTarget
  hudFrame.objectiveWorldX = m.target.x
  hudFrame.objectiveWorldZ = m.target.z
  // 【照抄，不在這裡判過期】`stepBeats` 已經依物理時間把過期的收掉了
  hudFrame.message = battle.message
  // 【打字機的時鐘】訊息換了就從頭打；空字串沒有年齡
  if (battle.message !== messageText) {
    messageText = battle.message
    messageStart = elapsed
    // 【增援預警配無線電】訊息消失（換成空字串）時不響
    if (messageText !== '') audio.playPool('radio', 'radio', 0, 0, 0, false)
  }
  hudFrame.messageAge = messageText === '' ? -1 : elapsed - messageStart

  hud.render(hudFrame, frameSeconds)
  if (audioMeter !== null) {
    audio.meter(METER_SAMPLE)
    audioMeter.draw(METER_SAMPLE, frameSeconds)
  }

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
  // 【在手勢裡解鎖音訊】瀏覽器要使用者手勢才肯出聲；這裡就是出擊、繼續的那一下
  audio.unlock()
  void Promise.resolve(canvas.requestPointerLock()).catch(() => {})
}

const MENU_POSE = { position: new Vector3(), target: new Vector3() }

/**
 * 機庫的展示場。**只在機庫那一頁存在** —— 離開就整個丟掉。
 *
 * 【為什麼不常駐】它掛著一架完整的機體幾何與四個實例池。玩家大多數時候
 * 不在機庫，那些東西不該一直佔著場景與顯示卡的記憶體。
 */
let showcase: Showcase | null = null

/** 機庫的一幀：展示場自己擺相機，地形跟著相機捲動 */
function drawHangar(frameSeconds: number, show: Showcase): void {
  show.update(frameSeconds, ctx.camera)
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
}

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

/**
 * 按鈕音分三種，依 `data-act` 分：**退回上一頁**、**收起疊在上面的東西**、
 * 其餘都是一般的機械聲。
 *
 * 【為什麼用 act 而不是按鈕上的字】字會改、會翻譯；`data-act` 是選單那一層
 * 唯一的協定（見 `ui/menu.ts` 的事件委派）。
 *
 * 【沒有 act 的按鈕算一般的】陣營卡、任務卡、機種卡都自己掛監聽器，它們是
 * 「往前走」不是「退回來」。
 */
const BACK_ACTS = new Set(['back', 'toSetup', 'toMission', 'toMenu'])
/** 收起 overlay 的那幾顆：暫停、確認框、設定、教學卡 */
const CLOSE_ACTS = new Set([
  'resume', 'tutorialOk', 'restartNo', 'abandonNo', 'toMenuNo',
  'settingsCancel', 'reloadNo',
])

/** `data-act` → 要播哪一支。認不得的一律一般按鈕 */
function uiSound(act: string | undefined): string {
  if (act === undefined) return SINGLE_FILES.uiClick
  if (BACK_ACTS.has(act)) return SINGLE_FILES.uiBack
  if (CLOSE_ACTS.has(act)) return SINGLE_FILES.uiClose
  return SINGLE_FILES.uiClick
}

/**
 * 選單按鈕的聲音。**自己掛一個事件委派，不走 `menu.ts` 的那一個** —— 那一支
 * 是畫面轉換的協定，聲音掛進去等於把音訊接進 UI 層；兩個監聽器互不影響。
 *
 * 【在這裡解鎖音訊】瀏覽器要使用者手勢才肯出聲，而第一次點按鈕通常遠早於
 * 出擊那一下。少了它，整個選單在第一次出擊之前都是靜音的。
 *
 * 【走 `playUi` 而不是 `playFile`】暫停選單上那幾顆是暫停時唯一按得到的
 * 東西，而暫停會把世界那個 context 整個 suspend。
 */
document.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button')
  if (b === null || b.disabled) return
  audio.unlock()
  audio.playUi(uiSound(b.dataset['act']))
})

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
      // 【先鎖指標再載入】瀏覽器只准在點擊的當下要指標鎖定；等載入完再要會被拒絕
      grabPointer()
      setPausedState(false)
      void loadBattle()
    }
    // 【離開戰鬥要清場】不清的話回到主選單還看得到上一場的戰場
    if (from === 'battle' && screen !== 'battle') {
      setPausedState(false)
      leaveBattle()
    }
    // 【離開機庫也要清場】展示機與它的彈留在場景裡的話，主選單的海上會
    // 有一架飛機在遠處繞圈
    if (from === 'hangar' && screen !== 'hangar' && showcase !== null) {
      showcase.dispose()
      showcase = null
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
  /**
   * 【為什麼在這裡建展示場而不是在 `onEvent`】選單進機庫時會先送這一個
   * （`renderHangar` 的尾巴），順序因此比畫面事件更早也更可靠 —— 而且
   * 「換一架」走的是同一條路。
   */
  onAircraft(spec) {
    if (showcase === null) {
      showcase = createShowcase(
        ctx.scene,
        document.getElementById('hangar-view') as HTMLElement,
        document.getElementById('hangar-stage') as HTMLElement,
      )
    }
    showcase.setAircraft(spec)
  },
  onMission(card) {
    mode = 'mission'
    pendingMission = card
    // 【再打同一關也要有橫幅】橫幅靠文字改變觸發，上一場留下的文字要清掉
    bannerText = ''
  },
  onResume() {
    setPausedState(false)
    menu.setPaused(false)
    grabPointer()
  },
  onRestart() {
    restartBattle()
    setPausedState(false)
    // 【排在 setPausedState(false) 之後】那一下會排一段恢復用的短淡入，後叫的才算數
    audio.fadeIn(BATTLE_FADE_IN)
    menu.setPaused(false)
    grabPointer()
  },
  onHelp() {
    // 【暫停中重看，看完回到暫停選單】不解除暫停、不鎖指標；全部重看，
    // 不管看過沒有
    menu.showTutorials(playerTutorials(), () => {})
  },
  onQuality(scale) {
    ctx.setQuality(scale)
    saveQuality(scale)
    // 【田色的內圈跟著檔位】清晰留一圈算式，其餘純貼圖；純海面沒有這一項
    terrain.fieldClip?.setInnerRadius(fieldInnerFor(scale))
    // 【自己重畫】選單不記得目前的檔位，按鈕的選中狀態要由這裡再餵一次
    menu.renderQuality(scale)
  },
  onAntialias(on) {
    // 【選單已經問過了】它只在玩家按下「儲存並重新載入」之後才送這個事件。
    // antialias 是建立 context 的參數，換不了，所以只能整個重來一次
    saveAntialias(on)
    location.reload()
  },
  onVolume(db) {
    audio.setVolume(db)
    saveVolume(db)
    menu.renderVolume(db)
  },
})
// 【先套用再畫選單】兩邊讀同一個值，按鈕標的才是畫面實際用的檔位
const startQuality = readQuality()
ctx.setQuality(startQuality)
menu.renderQuality(startQuality)
// 抗鋸齒在 `createScene` 就讀過並套用了，這裡只是把按鈕標成同一個值
menu.renderAntialias(readAntialias())
menu.renderVolume(readVolume())
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
  const recoveryFailure = recoveryWorkerFailure()
  if (recoveryFailure !== null) {
    blockForRecoveryWorker(recoveryFailure)
    return
  }
  // 【在源頭夾】戰鬥、機庫與選單吃的都是這一個值，理由見 `MAX_FRAME_SECONDS`。
  // 各處自己夾的話，機庫的飛機與海面會吃到不同長度的時間而對不上
  const frameSeconds = clampFrameSeconds((now - lastTime) / 1000)
  lastTime = now
  perf.begin(now)
  bindings.tick(frameSeconds)
  hudCanvas.hidden = screen !== 'battle' || loadingBattle
  hudMaskCanvas.hidden = hudCanvas.hidden

  // 【演練場的靶機打不死】血量每幀釘回滿 —— 幀內的彈著扣不到 0，就永遠
  // 不會走進擊墜路徑。轉向已由 `__drill` 換上直飛控制器，這裡只管活著。
  if (drillDrone !== null && screen === 'battle') {
    drillDrone.hp = drillDrone.aircraft.spec.hp * 1e6
  }
  if (loadingBattle) {
    // 【載入中什麼都不推進、不畫】載入畫面蓋著整個畫面，而場景正被一段一段
    // 換掉；第一場的 `battle` 也還不存在
    //
    // 【滑鼠位移丟掉，指標照樣鎖著】出擊時就鎖了指標，載入中動滑鼠會一直累加
    // 到準星位移，而那要等戰鬥第一幀才消費 —— 一進場就被甩一個大彎
    input.aimDeltaX = 0
    input.aimDeltaY = 0
  } else if (screen === 'battle') {
    // 【暫停時所有模擬時間都不前進】只停飛機的話，畫面上是一批定格的
    // 飛機浮在繼續起伏的海上 —— 那看起來像當掉（M10 spec §8.1）
    if (input.pointerLockLost) {
      input.pointerLockLost = false
      // 分出勝負之後不再暫停 —— 結算板本身就是出口
      // 【教學卡自己放開的那一次不算】見 `ignoreNextUnlock`；卡開著時卡上的
      // 「了解」就是出口，也不疊暫停選單
      if (ignoreNextUnlock) {
        ignoreNextUnlock = false
      } else if (battle.outcome === 'fighting' && !tutorialOpen) {
        setPausedState(true)
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
      // 【`elapsed` 也要一起慢】海浪與地形讀的就是它，見 `timeScale` 的註解。
      // 低於 30 fps 時物理丟時間，它也丟同樣多（`worldSeconds`）
      const sim = frameSeconds * timeScale(battle.outcome)
      // 聲音也跟著慢
      audio.setTimeScale(timeScale(battle.outcome))
      const world = loop.worldSeconds(sim)
      elapsed += world
      stepAndDrawBattle(sim, world)
      // 【第一幀畫完才彈教學】鏡頭與 HUD 要先就位，卡片後面才是這一場的戰場，
      // 不是上一個畫面。暫停之後主迴圈只重畫這一幀
      if (tutorialPending.length > 0) {
        setPausedState(true)
        tutorialOpen = true
        // 【看完才放行】最後一張按「了解」才解除暫停、把指標鎖回來
        menu.showTutorials(tutorialPending, () => {
          tutorialOpen = false
          setPausedState(false)
          grabPointer()
        })
        tutorialPending = []
        // 【放開指標】卡上的按鈕要點得到；「了解」再鎖回來
        if (document.pointerLockElement === canvas) {
          ignoreNextUnlock = true
          document.exitPointerLock()
        }
      }
      if (elapsed >= telemetryAt) {
        telemetryAt = elapsed + TELEMETRY_PERIOD
        logTelemetry()
      }
    } else {
      ctx.renderer.render(ctx.scene, ctx.camera)
    }
  } else {
    elapsed += frameSeconds
    // 【展示場還沒建好就照畫海天】進機庫的第一幀有可能落在 `onAircraft`
    // 之前，那一幀畫成黑的會閃一下
    if (screen === 'hangar' && showcase !== null) drawHangar(frameSeconds, showcase)
    else drawMenuBackground()
  }

  perf.endFrame(loop.lastSubstepCount)
  requestAnimationFrame(frame)
}

// 【GLB 機種要在進迴圈前載完】`buildAircraft` 是同步的（`main.ts`、四個工具
// 頁、node 單元測試都同步呼叫它），所以非同步只能關在這一行。
const initialRecoveryFailure = recoveryWorkerFailure()
if (initialRecoveryFailure !== null) {
  blockForRecoveryWorker(initialRecoveryFailure)
} else {
  // 【載入畫面在 HTML 裡就蓋著】全部載完才收 —— 在那之前選單點不到，出擊不會
  // 撞上還沒載好的樣板
  //
  // 【進度是檔數】每載完一支 GLB 推一格，三類加起來是 100%。字寫目前在載哪一類
  const shipIds = ['essex', 'wichita', 'fletcher'] as const
  const fileTotal = AIRCRAFT_MODEL_COUNT + shipIds.length + groundModelUrls().length
  let filesDone = 0
  let fileLabel = ''
  const fileLoaded = (): void => {
    filesDone++
    loading.set(fileLabel, fileFraction(filesDone, fileTotal))
  }
  const loadGroup = (label: string): Promise<void> => {
    fileLabel = label
    return loading.step(label, fileFraction(filesDone, fileTotal))
  }
  await loading.hold()
  await loadGroup('載入機體')
  await preloadAircraftModels(fileLoaded)
  // 【船的 GLB 也在開場載】三個艦級全部要 —— allies-m3 的第 58 特遣支隊有
  // 航母。少載一種的症狀是 `createShipModels` 找不到樣板**直接丟例外**，
  // 那一關進不去，而每一條單元測試都還是綠的（GLB 載入不在它們的路徑上）。
  await loadGroup('載入艦艇')
  await preloadShipModels(shipIds, fileLoaded)
  // 【地面單位的 GLB 也在開場載】`createGroundModels` 是同步的，樣板沒載到就丟
  await loadGroup('載入地面單位')
  await preloadGroundModels(undefined, fileLoaded)
  // 【廠區與機場的佈景不在這裡】進場時才載，見 `loadBattle` 的 `preloadTerrainScenery`
  await loading.finish('完成')
  // 【不擋開場】選單先出來，音效在背景下載；進戰鬥時 `loadBattle` 才等它
  void audio.load()
  requestAnimationFrame(frame)
}

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
  setPausedState(true)
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
/**
 * 覆蓋層此刻顯示的 FPS。**量測出口**：探針拿它與自己由 rAF 時間戳量到的
 * 真實幀率比對，兩者對不上就是覆蓋層量錯了東西。
 */
;(window as unknown as Record<string, unknown>)['__perfFps'] = (): number => perf.fps

/**
 * **量測出口**：改田色 clipmap 的內圈半徑，回挪窗統計。同頁 A/B 用 ——
 * 半徑給得極大就等於整片地面走算式，而兩邊是同一個 program。純海面回 `null`。
 */
;(window as unknown as Record<string, unknown>)['__fieldClip'] = (inner?: number) => {
  const c = terrain.fieldClip
  if (c === null) return null
  if (inner !== undefined) c.setInnerRadius(inner)
  return { ...c.stats }
}

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
    // 【雷伊泰的遠景陸地】在陸地那一個孩子底下，依名字挑出來單獨關
    farLand: () => {
      const out: Object3D[] = []
      terrain.object.traverse((o) => { if (o.name === FAR_LAND_NAME) out.push(o) })
      return out
    },
    // 【用 slice 不是 children[3]!】純海面沒有第四個孩子，固定取索引的話
    // 切到純海之後消融 flora 會對 undefined 呼叫 traverse，當場崩
    flora: () => terrain.object.children.slice(3),
    sky: () => byRenderOrder(SKY_RENDER_ORDER),
    propDisc: () => byRenderOrder(PROP_DISC_RENDER_ORDER),
    // 五個粒子池一起 —— 它們是同一種成本（半透明、關深度寫入、疊在一起）
    particles: () => [smoke.object, fireball.object, spray.object, splashes.object, sparks.object],
    // 【不透明、位置在著色器裡算】成本與上面那五個不同，分開關
    blastSparks: () => [blastSparks.object],
    tracers: () => [tracers.object, muzzles.object, turretMuzzles.object],
    vortex: () => [vortex.object],
    // 【低模那一具也要收進來】只關正式模型的話，200 m 外那幾架照畫不誤
    aircraft: () => [...visuals.values()]
      .flatMap((v) => (v.lod === null ? [v.model.group] : [v.model.group, v.lod.group])),
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
/**
 * 觀察者鏡頭的直接定位。**要先按 `G` 進上帝視角**，否則寫進去的姿態下一幀
 * 就被飛行鏡頭蓋掉。
 *
 * 【為什麼不用鍵盤飛過去】按著 `W` 數秒鐘的位移取決於那幾秒跑了幾幀 ——
 * 量測本身會改變它，兩輪停的地方不一樣，而「同一個機位」正是 A/B 的前提。
 */
/**
 * 依單位種類隱藏地面目標，用來把幀時間歸因到某一種實體。給 `id` 就只藏那
 * 一種，省略則全部顯示。
 *
 * 【為什麼不放進 `__gfx`】那一份的目標是**繪製層**（海、天、粒子、曳光彈），
 * 而這裡要的是「同一層裡的某一批物件」—— 波爾塔瓦機場上停放的 24 架 B-17
 * 與 22 個砲位走的是同一顆材質、同一個 Group。
 *
 * 【`groundModels` 的孩子與 `world.groundTargets` 同序】`createGroundModels`
 * 是照那個陣列一路 `add` 的，兩邊靠索引對齊。
 */
;(window as unknown as Record<string, unknown>)['__hideGround'] = (id?: string) => {
  const g = groundModels?.object
  if (g === undefined) return { hidden: 0, kinds: [] as string[] }
  const list = world.groundTargets
  const kinds = new Set<string>()
  let hidden = 0
  for (let k = 0; k < list.length && k < g.children.length; k++) {
    const t = list[k]!
    kinds.add(t.unit.id)
    const on = id === undefined || t.unit.id !== id
    g.children[k]!.traverse((o) => { o.layers.set(on ? 0 : GFX_HIDDEN_LAYER) })
    if (!on) hidden++
  }
  return { hidden, kinds: [...kinds] }
}

/**
 * **量測出口**：場上每一席的機種與位置。
 *
 * 【為什麼需要它】對著某一群飛機量幀時間時，鏡頭要擺在它們身上，而它們一路
 * 在飛 —— 寫死座標的話量到一半整隊已經飛出畫面。
 */
/**
 * **量測出口**：距離 LOD 現在切到哪裡。
 *
 * 【為什麼需要它】切換沒有生效時畫面上**看不出來** —— 兩具模型長得幾乎一樣，
 * 症狀只有「省下來的幀時間是零」，而幀時間本來就會漂。
 */
;(window as unknown as Record<string, unknown>)['__lod'] = () => {
  let withLod = 0
  let far = 0
  let nearest = Infinity
  for (const v of visuals.values()) {
    if (v.lod === null) continue
    withLod++
    if (v.far) far++
    nearest = Math.min(nearest, v.position.distanceTo(ctx.camera.position))
  }
  return {
    seats: visuals.size, withLod, far, nearest: Math.round(nearest),
    ground: groundModels?.lodState() ?? null,
  }
}

;(window as unknown as Record<string, unknown>)['__seats'] = () =>
  world.combatants.map((c) => ({
    id: c.aircraft.spec.id,
    alive: c.alive,
    x: c.aircraft.state.position.x,
    y: c.aircraft.state.position.y,
    z: c.aircraft.state.position.z,
  }))

/**
 * **量測出口**：場上每一台地面目標的種類、位置與狀態。
 *
 * 【為什麼需要它】日 M2 的車隊會沿公路移動。驗收要看得到車真的在走、在轉彎、
 * 開到終點會退場 —— 截圖只看得到一幀，這一支給的是座標。
 */
;(window as unknown as Record<string, unknown>)['__ground'] = () =>
  world.groundTargets.map((t) => ({
    id: t.unit.id,
    alive: t.alive,
    arrived: t.arrived,
    speed: t.speed,
    x: +t.position.x.toFixed(1),
    y: +t.position.y.toFixed(1),
    z: +t.position.z.toFixed(1),
  }))

/** 音訊錶當下的讀數。**除錯與探針用** —— 與錶上畫的是同一組數字 */
;(window as unknown as Record<string, unknown>)['__audioRead'] = () => {
  audio.meter(METER_SAMPLE)
  return { ...METER_SAMPLE }
}

/**
 * 音訊錶：`__audioMeter(true)` 打開、`false` 關掉。
 *
 * 顯示輸出峰值（黃線是限幅器的天花板）、限幅器壓了幾 dB、HDR 的最響值與
 * 不衰減區的下緣（藍線），以及六秒的歷史曲線。**限幅壓超過 6 dB 會轉紅**
 * —— 那代表音量本來就太熱，不是某一層壞掉。
 */
;(window as unknown as Record<string, unknown>)['__audioMeter'] = (on = true) => {
  if (on && audioMeter === null) {
    audioMeter = createAudioMeter()
    document.body.appendChild(audioMeter.canvas)
  } else if (!on && audioMeter !== null) {
    audioMeter.canvas.remove()
    audioMeter = null
  }
  return audioMeter !== null
}

;(window as unknown as Record<string, unknown>)['__godcam'] = (
  x: number, y: number, z: number, yawDeg = 0, pitchDeg = 0,
) => {
  godCam.position.set(x, y, z)
  godCam.yaw = (yawDeg * Math.PI) / 180
  godCam.pitch = (pitchDeg * Math.PI) / 180
  return { x, y, z, yawDeg, pitchDeg }
}

/**
 * 打一片彈幕：`n` 顆落在 (`cx`, `cz`) 附近 `spread` 公尺內，走的是與炸彈
 * 落地**逐字相同**的那一支 `emitBlast(LAND_BLAST)`。省略座標時以地面目標
 * 的形心為準。
 */
;(window as unknown as Record<string, unknown>)['__bombs'] = (
  n = 48, spread = 700, fires = false, cx?: number, cz?: number,
) => {
  if (fires) {
    for (const t of world.groundTargets) {
      const top = t.impactY - t.position.y
      lightGroundFire(groundFires, t.position.x, t.position.y + top * 0.3, t.position.z)
    }
  }
  let ax = 0
  let az = 0
  for (const t of world.groundTargets) { ax += t.position.x; az += t.position.z }
  const m = Math.max(1, world.groundTargets.length)
  const ox = cx ?? ax / m
  const oz = cz ?? az / m
  for (let k = 0; k < n; k++) {
    const bx = ox + (hash01(k * 7919 + 1) * 2 - 1) * spread
    const bz = oz + (hash01(k * 7919 + 2) * 2 - 1) * spread
    emitBlast(BLAST_POOLS, LAND_BLAST, bx, world.groundAt(bx, bz), bz, k * 97, 0, 0, 0)
  }
  return {
    at: { x: +ox.toFixed(0), z: +oz.toFixed(0) },
    smoke: blastSmoke.live,
    dust: blastDust.live,
    glow: blastGlow.live,
    // 【地面火的煙走另一個池】容量 16384，是彈幕煙池的八倍 —— 煙牆真要堆
    // 得起來只可能在這裡
    fireSmoke: shipFireSmoke.live,
  }
}

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
    setPausedState(false)
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

/** `__probe` 的 `lead`：最近一架在畫面前方、預瞄環也在前方的敵機 */
function probeLead(): { x: number; y: number; r: number; lx: number; ly: number; range: number } | null {
  let best: (typeof hudFrame.contacts)[number] | null = null
  for (let i = 0; i < hudFrame.contactCount; i++) {
    const c = hudFrame.contacts[i]!
    if (!c.active || !c.hostile || c.behind || !c.leadValid || c.leadBehind) continue
    if (best === null || c.range < best.range) best = c
  }
  if (best === null) return null
  return {
    x: +best.x.toFixed(4), y: +best.y.toFixed(4), r: +best.radius.toFixed(4),
    lx: +best.leadX.toFixed(4), ly: +best.leadY.toFixed(4), range: +best.range.toFixed(0),
  }
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
  const groundTgt = playerAi.groundTarget
  const groundedAircraftTgt = playerAi.groundedAircraftTarget
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
    phase: playerAi.hudPhase,
    override: playerAi.hudOverride,
    /**
     * 瞄具：狀態、投不投得出去、是否在投彈模式、落點圈與航跡末端的 NDC、
     * 航跡取樣數。教學截圖靠它挑時機、擺標註。
     */
    sight: {
      state: hudFrame.bombState, ok: hudFrame.releaseOk, bombing: hudFrame.bombing,
      vis: hudFrame.bombVisible, bx: +hudFrame.bombX.toFixed(4), by: +hudFrame.bombY.toFixed(4),
      run: hudFrame.runCount,
      rx: hudFrame.runCount > 0 ? +hudFrame.runX[hudFrame.runCount - 1]!.toFixed(4) : 0,
      ry: hudFrame.runCount > 0 ? +hudFrame.runY[hudFrame.runCount - 1]!.toFixed(4) : 0,
      agl: +hudFrame.releaseAgl.toFixed(0),
      // 彈艙：還有幾枚、滿艙幾枚。驗收「按下去真的投出去了」讀它
      load: hudFrame.bombLoad, cap: hudFrame.bombBayCapacity,
    },
    /** 準星：滑鼠圓圈（螢幕半高單位）與機頭十字（NDC）。教學截圖挑兩者分開的時機 */
    reticle: {
      ax: +hudFrame.aimX.toFixed(4), ay: +hudFrame.aimY.toFixed(4),
      nx: +hudFrame.noseX.toFixed(4), ny: +hudFrame.noseY.toFixed(4),
    },
    /**
     * 最近一架有預瞄環的敵機：目標框中心、半徑與預瞄環（螢幕半高單位）、距離 m。
     * 沒有就是 null。教學截圖拿它擺標籤
     */
    lead: probeLead(),
    /** Worker 改出風險與最後安全動作；供低空攻擊的 e2e 護欄判讀。 */
    ru: +playerAi.recoveryUrgency.toFixed(3),
    capture: playerAi.recoveryCapture,
    firing: player.command.firing,
    safety: playerAi.safetyAction,
    // 迴轉平面的俯仰偏置，度。正 = 拉高迴旋、負 = 俯衝迴旋、0 = 水平
    tpb: +(playerAi.sit.turnPitch * 180 / Math.PI).toFixed(2),
    asp: +(playerAi.sit.aspectAngle * 180 / Math.PI).toFixed(1),
    // 被護送單位的平均高度；全滅或非護航關時 NaN
    by: bn > 0 ? +(by / bn).toFixed(1) : Number.NaN,
    tr: tgt !== null ? +tgt.state.position.distanceTo(pos).toFixed(1) : -1,
    /** 這一格實際正在掃射的地面單位與距離；空字串／−1 = 沒有。 */
    gt: groundTgt?.unit.id ?? '',
    gr: groundTgt !== null ? +groundTgt.position.distanceTo(pos).toFixed(1) : -1,
    /** true = 任務優先目標是仍在滑行／滾行的飛機。 */
    gta: groundedAircraftTgt !== null,
    /** 對地掃射航次：approach = 進場，egress = 已飛越、正在拉開。 */
    gsp: playerAi.groundStrafePhase,
    /** 這次離場算出的回頭門檻；−1 = 此速度暫時沒有可持續迴轉解。 */
    grr: Number.isFinite(playerAi.groundStrafeReattackRange)
      ? +playerAi.groundStrafeReattackRange.toFixed(1) : -1,
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
    /** 整隊重生已經預警的批數，與場上活著的紅方架數。試飛用來看重生有沒有發生 */
    batches: battle.batches,
    redAlive: world.combatants.reduce((n, c) => n + (c.team === 'red' && c.alive ? 1 : 0), 0),
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
