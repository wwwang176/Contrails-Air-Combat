import './render/heightFogInstall'
import { createBattleEventPresentation } from './app/battleEventPresentation'
import type { BattleConfig } from './battle/battleConfig'
import type { Battle } from './battle/battleState'
import { createEffectStepper } from './render/effectStepper'
import { createSteamEmission } from './render/steamEmission'
import { createBlastPresentation, CRASH_BLAST_HEIGHT, KILL_BLAST_INHERIT } from './render/blastPresentation'
import { createBattleScenery } from './render/battleScenery'
import { createSceneWeather } from './render/sceneWeather'
import { Color, Euler, Quaternion, Vector3 } from 'three'
import { GFX_HIDDEN_LAYER, createGraphicsDiagnostics } from './app/graphicsDiagnostics'
import { CLOUD_ATLAS_URL, cloudColorOf, cloudFieldSpecs, createClouds } from './render/clouds'
import { skirmishCloudField } from './world/cloudField'
import { REEL_WIND, SMOKE_WIND, windOf } from './render/wind'
import { FixedStepAccumulator, MAX_FRAME_SECONDS, clampFrameSeconds } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { createRangeProbe } from './hud/rangeProbe'
import { DEG } from './core/math'
import { indicatedAirspeed } from './core/airspeed'
import { overspeedShake } from './core/overspeedFeedback'
import { createScene } from './render/scene'
import { fieldInnerFor, readAntialias, readQuality, saveAntialias, saveQuality } from './render/quality'
import { readVolume, saveVolume } from './audio/volume'
import { createAudioEngine } from './audio/engine'
import { createCannonAudio } from './audio/cannonAudio'
import { createFlightAudio } from './audio/flightAudio'
import { createAircraftLoopAudio } from './audio/aircraftLoopAudio'
import { createListenerMotion } from './audio/listenerMotion'
import { createBattleAudioCues } from './audio/battleAudioCues'
import { SINGLE_FILES } from './audio/catalog'
import { STRIKE_HEIGHT, applyFlash, createStorm, rollThunder, stepStorm } from './render/storm'
import { createRain } from './render/rain'
import { DAY_PALETTES, applyTimeOfDay, type TimeOfDay } from './render/timeOfDay'
import { flatSeaCrashPolicy } from './world/seaCrash'
import { arenaKills, createArenaState, SKIRMISH_ARENA, stepArena, type ArenaBounds } from './world/arena'
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
  AIR_BLAST, BLAST_PACE, LAND_BLAST, WATER_BLAST,
  createBlastSmoke, createDust, createEmberSmoke, createFireGlow, createWaterMist,
  emitBlast, emitEmber, emitFlakBlasts, emitMist, resetFlakBlastSeed,
  type BlastPools,
} from './render/blast'
import { MORTAR_BLAST_SCALE } from './render/mortarBlast'
import { createFireball, FIREBALL_COUNT, FIREBALL_SPEED } from './render/fireball'
import { createFlakBursts, emitFlakBursts, resetFlakBurstSeed } from './render/flakBursts'
import { createFlareLights } from './render/flares'
import { createShipModels, shipModelTop } from './render/ships'
import { createGroundModels } from './render/groundTargets'
import { createSearchlights, makeGlareTexture } from './render/searchlights'
import { createGroundBattle } from './render/groundBattle'
import { BATTLE_FOG, stepBattleFog } from './render/heightFog'
import { settleGroundTargets } from './world/groundTargets'
import type { Ship } from './world/ships'
import {
  balloonHills, settleBalloons, syncBalloonHills, type BalloonHillSet,
} from './world/balloons'
import { createBalloonModels } from './render/balloons'
import type { TerrainSource } from './ai/terrainSense'
import { clearBursts, createBursts, pushBurst } from './world/flak'
import { createShipFireSmoke, createSmoke, createSteam } from './render/smoke'
import { addSmokeLighting } from './render/smokeLighting'
import { createBlastLights } from './render/blastLights'
import { battleLights } from './battle/battleLights'
import {
  createShipFires, stepShipFires,
} from './render/shipFires'
import {
  createGroundFires, lightGroundFire, stepGroundFires,
} from './render/groundFires'
import { createFireCrowd, updateFireCrowd } from './render/fireCrowd'
import { hash01 } from './core/hash'
import { createSpray, WATER_COLOR } from './render/spray'
import { createVortex } from './render/vortex'
import { createOrderMarkers } from './render/orderMarkers'
import { createDebris } from './render/debris'
import {
  createWrecks, WRECK_FIRE_SCALE, WRECK_FIRE_SMOKE_COLOR, WRECK_FIRE_SMOKE_COLOR_2,
  WRECK_FIRE_SMOKE_SCALE,
} from './render/wrecks'
import { bodyColorOf } from './render/geometry/buildAircraft'
import { createImpacts } from './world/events'
import { preloadLiveryVariants } from './render/geometry/buildAircraft'
import { createAircraftVisuals } from './render/aircraftVisuals'
import { Hud } from './hud/Hud'
import { createAudioMeter, type AudioMeter } from './hud/audioMeter'
import type { MeterSample } from './audio/meter'
import { createHudFrame, nextHitFlash, HUD_MAX_CONTACTS } from './hud/types'
import {
  fillMarkers, type MarkerObjectives, type MarkerPool, type MarkerProject, type ShipMarkerTop,
} from './hud/markerFeed'
import { attitudeFromOrientation, headingFromOrientation } from './core/attitude'
import { createScoreboard, scoreRows, sortScoreRows, type AfterAction } from './ui/scoreboard'
import { shortName } from './ui/briefing'
import { resetGEffect } from './hud/widgets/gEffect'
import { runFrontCount } from './hud/widgets/torpedoLine'
import {
  TORPEDO_RUN_SAMPLES, runSampleDistance, torpedoEntersWater, torpedoHeading,
} from './world/torpedo'
import { resetDamageMarks, stepDamageMarks } from './hud/damageMarks'
import { CameraRig, DEFAULT_CAMERA_OPTIONS, thirdPersonFor } from './camera/CameraRig'
import { solveImpact, type BombState, type Impact } from './world/bomb'
import { resetBombBay, type BombBay } from './weapons/bomb'
import {
  aglOk, canRelease, envelopeFor, pitchOk, rollOk,
} from './weapons/releaseEnvelope'
import type { Loadout } from './weapons/stores'
import { BOMB_PROFILE } from './ai/bombRun'
import { TORPEDO_PROFILE } from './ai/torpedoRun'
import { createWakes } from './render/wake'
import { createShipWakes, shipFoamTexture } from './render/shipWakes'
import {
  createGodCameraState, enterGodCamera, godCameraTarget, stepGodCamera,
  type GodCameraInput,
} from './camera/godCamera'
import { deathCamAim, enterDeathCam } from './camera/deathCam'
import { applyBlend, createCameraBlend, startBlend } from './camera/cameraBlend'
import {
  GUN_LOST_SHAKE, KILL_SHAKE,
  addShake, applyCameraShake, createCameraShake, hudShakeAngle, hudShakeShiftX,
  hudShakeShiftY, stepCameraShake,
} from './camera/cameraShake'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { attachTouch } from './input/touch'
import { AimAssist, readAimAssist, saveAimAssist } from './input/aimAssist'
import { BOMB_AIM_SCALE, levelAimBasis, slewAimWorld } from './input/aim'
import { teamSlot, type Combatant, type World } from './world/World'
import { solveLead, NO_INTERCEPT } from './world/lead'
import { PROJECTILE_LIFETIME } from './world/Projectiles'
import { PlayerController } from './control/PlayerController'
import { AiController } from './ai/AiController'
import { recoveryWorkerFailure } from './ai/recoveryWorkerClient'
import { blockForRecoveryWorker } from './ui/recoveryBlocker'
import { VETERAN } from './ai/profile'
import { HEAD_ON } from './battle/entry'
import { NEUTRAL_TUNING } from './battle/mission'
import { BF109K4 } from './specs/bf109k4'
import { P51D } from './specs/p51d'
import { DEFAULT_DOCTRINE } from './ai/doctrine'
import { extendReason } from './ai/rules'
import type { FlightOrder } from './ai/commandTypes'
import { createBattle, playerFlight, resetBattle, stepBattle } from './battle/setup'
import { settleAtSpawn } from './battle/flightSpawn'
import { aliveCount, isObjectiveGround, isObjectiveShip } from './battle/objectiveQueries'
import { flightOfCombatant, isFlightLeader } from './battle/flights'
import { getLang, onLangChange, readLang, saveLang, setLang, t, type MessageKey } from './i18n'
import { applyStaticText } from './i18n/dom'
import { aircraftName } from './i18n/names'
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
import { createMenuReel, type MenuReel, type ReelSiteRequest } from './app/menuReel'
import type { ReelTerrainKind } from './app/reelShots'
import { createShowcase, type Showcase } from './app/showcase'
import { preloadStartupAssets } from './app/startupAssets'
import { warmBattleGraphics } from './app/battleWarmup'
import { assetUrl } from './core/asset'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
const perf = createPerfOverlay(ctx.renderer)
const rangeProbe = createRangeProbe()
const audio = createAudioEngine(ctx.camera)
const cannonAudio = createCannonAudio(audio, ctx.camera.position)
const noteGroundShot = cannonAudio.noteGroundShot
audio.setVolume(readVolume())

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
/** 選單短片畫在農地上的廠區是哪一段的；null = 沒有廠區。戰鬥的地形一律是 null */
let terrainSiteKey: string | null = null
/**
 * 建地形時給的 GPU 資源。**每次建都重讀檔位** —— 內圈半徑跟著玩家目前選的
 * 畫質走，換檔位時另由 `onQuality` 直接調現有地形的
 */
const terrainGfx = (): TerrainGfx => ({ renderer: ctx.renderer, fieldInner: fieldInnerFor(readQuality()) })
let terrain = createTerrain(terrainKind, terrainGfx())
/**
 * AI 看到的地形。**平常就是 `terrain`**；有防空氣球的那一場多了幾座只有 AI
 * 看得到的山（`world/balloons.ts` 的 `balloonHills`）—— 高度場、撞地與畫面都
 * 不動。每一場在地形接上之後重算（`startWorld`）。
 */
let aiTerrain: TerrainSource = terrain
/** 氣球的山。每幀依氣球的死活就地改高度（`syncBalloonHills`）；沒有氣球是 null */
let balloonHillSet: BalloonHillSet | null = null
const sceneWeather = createSceneWeather(ctx.scene, { createStorm, createRain })
/**
 * 地上水花落在的高度：地形與海面取高的那一個（`Terrain.heightAt`）。**模組層一顆
 * 函式**，每幀傳進去不配置閉包
 */
const rainGroundAt = (x: number, z: number): number => terrain.heightAt(x, z, elapsed)

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
// 【剔除掛在 render 的開頭】three 在這裡已經更新過場景與相機的矩陣，而自己的
// 視錐剔除還沒開始。戰鬥、機庫、選單都畫這一個 scene，三個畫面都走得到 ——
// 每個呼叫 render 的地方各自記得呼叫的話，漏掉一處就是那個畫面少一塊海。
// 讀的是當下的 `terrain`，換場之後自然跟上
ctx.scene.onBeforeRender = (_renderer, _scene, camera) => { terrain.cull(camera) }

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
    ctl.airOnly = c.team === 'blue' && battle.cfg.tuning.airOnly === true
    // 【投彈那兩格跟著一起接】理由與船完全相同，而且它們也是每一場、每一次
    // 重生都要重接：`bombBay` 隨機種變（換裝、接手僚機），`bombDrag` 必須
    // 與 `World` 是同一個值，否則 AI 算的落點與飛出去的那一顆分家。
    ctl.bombBay = c.bombBay
    ctl.bombDrag = world.bombDrag
    // 【剖面跟著掛載走，不跟著機種】任務卡可以把 G4M 的魚雷複寫成炸彈
    // （`MissionBattle.blueLoadout`），查機種的話那一關會飛雷擊航路去投彈
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
    if (!force && ctl.terrain === aiTerrain) continue
    ctl.terrain = aiTerrain
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
  if (force || playerAi.terrain !== aiTerrain) {
    playerAi.terrain = aiTerrain
    playerAi.clearTerrainState()
  }
}

const tracers = createTracers()
ctx.scene.add(tracers.object)
/** 探照燈眩光的十字貼圖：畫一次、每一場共用 */
const glareTexture = makeGlareTexture()
/** 砲位陣亡時噴火球用的暫存。熱路徑之外，但仍不配置。 */
const GUN_LOST_DIR = new Vector3()

const input = createInputState()
const bindings = attachInput(canvas, input)
const touch = attachTouch(document.getElementById('touch') as HTMLElement, input)

const playerController = new PlayerController(input)
/** 瞄準輔助。開關來自設定頁（`readAimAssist`） */
const aimAssist = new AimAssist()
aimAssist.enabled = readAimAssist()

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

// 【語言最先定】之後畫的每一段字都查表；`index.html` 裡寫死的是中文
setLang(readLang())
applyStaticText(document)
/**
 * 換語言時選單以外要跟著換的：`index.html` 的固定文字、結算板、HUD 的打字機。
 * 選單與觸控按鈕各自訂閱。HUD 每幀查表，不必處理
 */
onLangChange(() => {
  applyStaticText(document)
  scoreboard.refresh()
  langChangedAt = elapsed
  if (battle !== undefined) hudFrame.reportTypedBefore = battle.world.time
})

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

/** 這一場的界：任務讀卡片，遭遇戰用 `SKIRMISH_ARENA`。由 `resetArena` 換 */
let arenaBounds: ArenaBounds = SKIRMISH_ARENA

/**
 * 開一場新的（或重開一場）時把界歸零，並換上這一場的界。
 *
 * 【兩個進場點都要呼叫】`restartBattle` 是「再打一場」，`enterBattle` 是
 * 由選單進來 —— 只接前者的話，爆炸之後回選單再開一場會沿用已經 expired
 * 的狀態，玩家一進場就爆。
 */
function resetArena(): void {
  Object.assign(arena, createArenaState())
  arenaBounds = mode === 'mission' && pendingMission !== null ? pendingMission.battle.arena : SKIRMISH_ARENA
  hudFrame.arenaShow = true
  hudFrame.arenaX = arenaBounds.x
  hudFrame.arenaZ = arenaBounds.z
  hudFrame.arenaRadius = arenaBounds.radius
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
const hudAttitude = { pitch: 0, roll: 0 }
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

const aircraftVisuals = createAircraftVisuals(ctx.scene)
const visuals = aircraftVisuals.visuals

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
 * 【有瞄具的走投彈視角，沒有的直接投彈（掛彈戰鬥機、Ju 87）】見 `InputState.bombRelease`
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
const steamEmission = createSteamEmission(steam)
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
/** 短片開動的車在車尾揚起的塵：與地面戰的行進揚塵同一個配方（壽命倍率 1，見 `render/groundBattle.ts`） */
const reelTrackDust = createDust(256, 1, smokeTexture)
ctx.scene.add(reelTrackDust.object)
/**
 * 天上的靜止雲朵（`render/clouds.ts`）。戰鬥由建場（`buildBattleTerrain`）鋪這一場的雲場；
 * 短片換段時由舞台的 `setClouds` 換一批
 */
const clouds = createClouds(new TextureLoader().load(assetUrl(CLOUD_ATLAS_URL)))
ctx.scene.add(clouds.object)
const CLOUD_COLOR = new Color()
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
const battleAudioCues = createBattleAudioCues(audio, ctx.camera.position, CRASH_BLAST_HEIGHT)
const blastPresentation = createBlastPresentation({
  BLAST_POOLS, cameraPosition: ctx.camera.position, cameraShake,
  blastLights, blastSparks, debris, groundFires,
})

/**
 * 地面戰的小爆炸（砲彈擊中、迫擊砲彈落地）：畫面是 `emitMortarBlast`，聲音是一般爆炸聲
 * （`CUE.Explosion`，與飛機、炸彈同一條路），**當量與畫面同一個 `MORTAR_BLAST_SCALE`** ——
 * 畫面縮小、聲音沒跟著縮的話，一發砲彈聽起來像一顆炸彈。事件在下一幀的 `playCues` 播。
 */
const onGroundImpact = (x: number, y: number, z: number): void => {
  blastPresentation.emitMortarBlast(x, y, z)
  battleAudioCues.queueExplosion(x, y, z, MORTAR_BLAST_SCALE)
}

/**
 * 一朵火災的迷你爆炸。**船火與地面火共用這一支** —— 配方在
 * `render/firePuff.ts`，靶場（`tools/range.ts`）接的也是它。
 *
 * **在模組層建一次** —— 幀迴圈裡宣告閉包是每幀一次配置。
 */
const emitFirePuff = createFirePuff(BLAST_POOLS, shipFireSmoke)
const battleScenery = createBattleScenery(ctx.scene, {
  glareTexture, smokeTexture, burn: emitFirePuff, impact: onGroundImpact, fired: noteGroundShot,
}, {
  createShipModels, createShipWakes, shipFoamTexture, createGroundModels,
  createSearchlights, createGroundBattle, createBalloonModels,
})

/**
 * 殘骸的引擎火。**同一份配方、小一號** —— 燒的是一具發動機艙，不是整艘
 * 燃燒的軍艦。
 */
const emitWreckFirePuff = createFirePuff(
  BLAST_POOLS, wreckFireSmoke, WRECK_FIRE_SCALE, WRECK_FIRE_SMOKE_SCALE, wrecks.anchors,
)

const stepEffects = createEffectStepper({
  sparks, blastSparks, wrecks, debris, emitWreckFirePuff, smoke, spray, BLAST_POOLS,
  splashes, fireball, steam, shipFireSmoke, wreckFireSmoke, blastJets,
  blastChunks, blastGlow, blastEmber, blastSmoke, blastDust, blastMist, flakBursts, blastLights,
})

/**
 * 燒著往下掉的氣球放一朵火。與殘骸的引擎火同一份小號配方，但不吸附錨點 ——
 * 氣球的位置每幀由 `render/balloons.ts` 給。**在模組層建一次**，理由同上。
 */
const burnBalloon = (x: number, y: number, z: number): void => {
  emitWreckFirePuff(x, y, z)
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
  blastChunks, blastGlow, blastEmber, blastSmoke, blastDust, blastMist, blastJets, reelTrackDust,
  // 【船火那兩份也在這裡】漏清煙池的話上一場的煙殘留 12 秒；漏清 `shipFires`
  // 更糟 —— 上一場的火點會用同一個船索引附到新一場的船上，燒滿 60 秒
  shipFireSmoke, wreckFireSmoke, shipFires, groundFires, steam,
  // 【鏡頭震動也在這裡】跨場狀態、`reset()` 的簽章一樣。漏清的話上一場
  // 最後那一顆炸彈的餘震會接在新一場的第一幀上
  cameraShake,
]

function resetPools(): void {
  for (const p of POOLS) p.reset()
  resetFlakBurstSeed()
  resetFlakBlastSeed()
}

ctx.scene.add(debris.object)

/** combatant 索引 → 機身色。零件用它上色 —— `World` 不需要知道有塗裝這回事。 */
const debrisColorOf = (index: number): number =>
  bodyColorOf(world.combatants[index]!.aircraft.spec)

const presentBattleEvents = createBattleEventPresentation({
  camera: ctx.camera, damageMarks: hudFrame.damageMarks, battleAudioCues,
  sparks, splashes, blastPresentation, debris, debrisColorOf, shipFires, groundFires,
  spray, flakBursts, BLAST_POOLS,
})

// 【依 c.index 索引的內插姿態】直接持有 Visual 的 Vector3/Quaternion 參考，
// 不複製 —— 每幀的內插迴圈寫進那些物件，這裡自然就是最新的。
const renderPositions = aircraftVisuals.positions
const renderQuaternions = aircraftVisuals.quaternions

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
/**
 * 主要目標的判定與量距基準點。判定讀 `battle.rules`（返航節拍會換掉它）；
 * `ref` 每幀抄一次，與接觸點的 `refPos` 相同
 */
const markerObjectives: MarkerObjectives & { ref: Vector3 } = {
  ship: (s) => isObjectiveShip(s, battle.rules),
  ground: (t) => isObjectiveGround(t, battle.rules),
  ref: new Vector3(),
}

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
  // 【位置、機首與速度回到開局的那一組】reset 一律朝 −Z；藍隊朝別的方向出生時（德 M3 朝東、
  // 德 M4 朝南）少了這一步，玩家開場就背對目標。瞄準點跟著機首
  settleAtSpawn(battle, p)
  input.aimWorld.set(0, 0, -1).applyQuaternion(p.aircraft.state.orientation)
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

/** 由顯示資源管理器與殘骸池各自釋放持有的模型。 */
function releaseVisuals(): void {
  aircraftVisuals.clear(wrecks)
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
  aircraftVisuals.sync(world.combatants, battle.cfg.liveries)
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
  aircraftVisuals.sync(world.combatants, battle.cfg.liveries)
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

function leaveBattle(): void {
  audio.stopAll()
  battleAudioCues.clear()
  resetAudioState()
  tutorialPending = []
  tutorialOpen = false
  ignoreNextUnlock = false
  releaseVisuals()
  battleScenery.releaseGroundBattle()
  // 【圓環要移出場景】不移的話回到主選單，那個環還浮在選單的背景海上
  ctx.scene.remove(objectiveRing.object)
  // 【記分板要一起收】`stepAndDrawBattle` 不再跑，結算板會就這樣留在
  // 選單上面 —— 從結算按「回設定頁」時看得最清楚
  input.scoreboardHeld = false
  scoreboard.setVisible(false)
  boardActions.hidden = true
  boardEl.classList.remove('finished')
  clearBattleScenery()
  // 短片下一幀換段時放它自己的雲；機庫沒有雲
  clouds.clear()
  // 回到選單：短片的風
  Object.assign(SMOKE_WIND, REEL_WIND)
}

/**
 * 收掉這一場的船、地面單位、探照燈、氣球與雨。**下一場開打時本來就會重建**，
 * 這裡只是不讓它們留在選單的短片裡 —— 上一場的艦隊會開進短片的畫面。
 */
function clearBattleScenery(): void {
  battleScenery.clearModels()
  sceneWeather.clear()
}

/**
 * 選單短片要的地形：與現在的不同才重建。短片每換一段都叫它（在暗場裡），
 * 所以從戰鬥回到選單也由它換回來
 */
function setMenuTerrain(kind: ReelTerrainKind, site?: ReelSiteRequest): void {
  const siteKey = site?.key ?? null
  if (terrainKind === kind && terrainSiteKey === siteKey) return
  terrainKind = kind
  terrainSiteKey = siteKey
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrain = createTerrain(terrainKind, terrainGfx(), site?.layout)
  ctx.scene.add(terrain.object)
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
  // 【重開也要有橫幅】橫幅在換成另一句時才出現，上一場留下的要清掉
  bannerKey = null
  // 物理時間從頭算，上一場換語言的時刻對這一場沒有意義
  hudFrame.reportTypedBefore = -1
  // 【上一場的聲音不帶過來】爆炸的尾巴、延遲中的遠方爆炸、裝填的邊緣都清掉
  audio.stopAll()
  battleAudioCues.clear()
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
  // 【再打一場也要有橫幅】橫幅在換成另一句時才出現，上一場留下的要清掉；
  // 結算的「再打一場」走的是這裡，不是 `restartBattle`
  bannerKey = null
  hudFrame.reportTypedBefore = -1
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
  return tutorialsFor(player.aircraft.spec.role, playerLoadout?.kind ?? null, input.bombRelease)
}

/** 進戰鬥、重新開始時世界的聲音從靜音淡入的長度，s */
const BATTLE_FADE_IN = 1

async function loadBattle(): Promise<void> {
  loadingBattle = true
  tutorialPending = []
  loading.show()
  try {
    await loading.hold()
    await loading.step('loading.clear', 0.05)
    // 與 `enterBattle` 同樣的第 1、2 段
    bannerKey = null
    hudFrame.reportTypedBefore = -1
    releaseVisuals()
    resetPools()
    // 【佈景 GLB 進場才載】見 `preloadTerrainScenery`。只有洛伊納與波爾塔瓦
    // 要等，其餘地形是 no-op
    await loading.step('loading.scenery', 0.1)
    await preloadTerrainScenery(battleTerrainKind())
    await loading.step('loading.terrain', 0.2)
    buildBattleTerrain()
    await loading.step('loading.forces', 0.5)
    // 【任務卡指定的塗裝變體先載好】`buildAircraft(spec, variant)` 是同步的，樣板要在 `startWorld`
    // 建模型之前就在快取裡；沒指定的任務與遭遇戰是 no-op
    const cfg = battleConfig()
    await preloadLiveryVariants(cfg.liveries)
    startWorld(cfg)
    // 【地面與植被在載入畫面裡備好】田色的三張貼圖第一次烘、烘圖的著色器第一次編，
    // 植被每幀只補十幾格 —— 留到開場的話第一幀卡半秒，接著兩秒樹一片片長出來。
    // 以玩家的出生點（開場第一幀地形跟著的那一點）先更新一次、把植被排乾
    await loading.step('loading.vegetation', 0.6)
    const spawn = player.aircraft.state.position
    terrain.update(elapsed, spawn.x, spawn.z)
    terrain.settle?.()
    // 【機種與掛載在 startWorld 之後才知道】這架飛機還沒看過的卡；暫停時的
    // 「教學」按鈕看不看得到也在這時決定
    tutorialPending = unseenTutorials(playerTutorials(), readSeenTutorials())
    menu.setTutorialHelp(playerTutorials().length > 0)
    // 【音效在開場就開始背景下載】大多數時候這裡已經載完，等一下就過。
    // 沒載完時這是唯一還要連網的一步，所以進度條給它一整段，每載完一支推一格
    await loading.step('loading.audio', 0.7)
    await audio.load((done, total) => {
      loading.set('loading.audio', 0.7 + 0.15 * fileFraction(done, total))
    })
    await loading.step('loading.shaders', 0.85)
    await warmBattleGraphics(ctx, battle.cfg, spawn, player.aircraft.state.orientation)
    await loading.finish('brief.go')
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
  terrainSiteKey = null
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
  sceneWeather.reset(timeOfDay)
  // 煙的材質不是 three 內建受光材質；時段換完要把同一顆太陽同步進 shader。
  syncFireSmokeLighting()
  resetArena()
  // 【風在建地圖時定一次】只吹煙與塵、只是畫面。重開不重建地形，風也不換
  windOf((Math.random() * 0x100000000) >>> 0, SMOKE_WIND)
  // 雲場鋪在這一場的界上，所以排在 `resetArena` 換好 `arenaBounds` 之後
  const card = mode === 'mission' ? pendingMission : null
  clouds.set(
    cloudFieldSpecs(
      card !== null ? card.battle.clouds : skirmishCloudField(terrainKind, timeOfDay),
      arenaBounds,
      card !== null ? card.id : `skirmish:${terrainKind}:${timeOfDay}`,
    ),
    cloudColorOf(DAY_PALETTES[timeOfDay], CLOUD_COLOR),
  )
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
  // 【氣球同一個理由】地面絞車的錨點照地形取高度；AI 的山跟著這一場的氣球建
  settleBalloons(world.balloons, world.groundAt)
  balloonHillSet = world.balloons.length > 0 ? balloonHills(world.balloons, terrain.islands) : null
  aiTerrain = balloonHillSet === null
    ? terrain
    : { islands: balloonHillSet.islands, land: terrain.land }
  setPlayer(battle.player)
  rebuildVisuals()

  battleScenery.rebuild(world, pendingMission?.battle.theater)

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
  playerAi.airOnly = cfg.tuning.airOnly === true
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
  input.pauseRequested = false
  // 【吸住的目標是上一場的索引】
  aimAssist.reset()
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
 * 目標橫幅與中央訊息的打字機時鐘：記下換成另一句的那一刻，HUD 只拿到
 * 「出現了幾秒」。用 `elapsed` 而不是牆鐘，暫停時打字也停。記的是鍵，null = 沒有。
 */
let bannerKey: MessageKey | null = null
let bannerStart = 0
let messageKey: MessageKey | null = null
let messageStart = 0
/** 最後一次換語言時的 `elapsed`；在這之前出現的橫幅與訊息整句印，見 `objectiveBannerTypeAge` */
let langChangedAt = -Infinity
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
// 但 240 Hz 裡不碰 Web Audio —— `queueAudioCues` 只寫五個數字進佇列，
// `updateAudio` 每一幀在鏡頭定位之後才播（距離、延遲、低通都量到鏡頭）。

const listenerMotion = createListenerMotion()
const camVel = listenerMotion.velocity
const aircraftLoopAudio = createAircraftLoopAudio(audio, ctx.camera.position, camVel)
const flightAudio = createFlightAudio(audio, ctx.camera.position, input, {
  playHeavyHit: battleAudioCues.playHeavyHit, teamSlot,
})

/**
 * 上一幀的狀態全部歸零。開戰、離開、接手僚機時呼叫 —— 不歸零的話，
 * 上一架正在裝填、新的這一架沒有，會誤播「裝填完成」。
 */
function resetAudioState(): void {
  // 【流速要收回 1】分出勝負那段是超級慢動作，離場時不收的話選單的按鈕
  // 音會用戰場最後的流速播 —— 聽起來像壞掉的按鈕
  audio.setTimeScale(1)
  cannonAudio.reset()
  listenerMotion.reset()
  flightAudio.reset()
  aircraftLoopAudio.reset()
  battleAudioCues.reset()
}

/**
 * `player` 的唯一寫入點。**齊射分組與槍焰的邊緣狀態跟著換** —— 新的這一架武裝不同，
 * 沿用上一架的分組會播錯庫，或者整組沒聲音，而且兩種都不會報錯。
 */
function setPlayer(c: Combatant): void {
  player = c
  battleAudioCues.rebuildVolleyGroups(player)
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
  audio.beginFrame()
  listenerMotion.update(ctx.camera.position, worldSeconds)
  battleAudioCues.playFrame(world, player, elapsed, flying)
  cannonAudio.playCannons(world, elapsed)

  aircraftLoopAudio.update(world.combatants, renderPositions, me, elapsed, flying, battleAudioCues.ownTurretVolley)
  audio.endFrame()

  flightAudio.update(world, me, elapsed, worldSeconds, hudFrame.arenaShow && arena.outside)
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
    // 【輔助排在玩家之後】先吃玩家這一幀的轉動，再拉。轉動量與 `slewAimWorld`
    // 同一個換算（位移 × 半個 FOV）
    const playerTurn = Math.hypot(input.aimDeltaX, input.aimDeltaY) * ctx.camera.fov * DEG / 2
    aimAssist.step(input.aimWorld, playerTurn, worldSeconds, player, world.combatants)
  }
  // 【只在一般飛行時吸】其餘分支的瞄準點不歸玩家管，離開時要放掉目標
  if (input.godView || dying || aiFlying || input.viewMode === 'bomb') aimAssist.reset()
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
    // 【跟瞄歷史一起清】瞄準方向剛被一步重設，那一步不是角速度（`resetTrack`）
    player.aircraft.director.resetTrack()
  }

  // 【hitsDealt 必須在回呼裡累加】World.step 在每個**物理步**開頭把它歸零，
  // 而一幀可能跑好幾步。若在幀尾才讀 player.hitsDealt，最後一步沒命中就整幀
  // 漏掉——連射時 X 標記會閃爍不定。
  let hitsThisFrame = 0
  // 【必須在物理之前】接在幀尾的話，新的一場第一幀的 AI 是用「沒有地形」
  // 在飛 —— 而那一幀正好是最可能有人貼著島出生的時候
  wireTerrain()
  // 【破掉的氣球不再是山】AI 不必繞一座不存在的山；重開一場長回來
  if (balloonHillSet !== null) syncBalloonHills(world.balloons, balloonHillSet)
  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    stepBattle(battle, dt)
    // 【緊接在物理步之後】增援是 `stepBattle` 裡的節拍加進去的，而幀尾的
    // 內插迴圈假設每個座位都有模型。空手而回時這一行只是一次整數比較
    syncVisuals()
    // 【在物理步裡推，不在幀尾】一幀可能跑好幾個物理步，而倒數吃的是
    // 物理時間 —— 在幀尾推的話界外的秒數會隨幀率漂
    const pp = player.aircraft.state.position
    stepArena(arena, arenaBounds, pp.x, pp.y, pp.z, dt)
    hitsThisFrame += player.hitsDealt
    presentBattleEvents(world, player, terrain, elapsed, input.godView)
    perf.endPhysics()
  })

  // 【玩家陣亡不再重生】M9 起改為接手僚機（`stepBattle` 的 takeover），
  // 舊機體於是像所有人一樣被殘骸池接管 —— M8 spec §10 預告的那件事現在
  // 自動成立了。
  if (battle.player !== player) {
    setPlayer(battle.player)
    // 【界的倒數跟著機體】出界爆炸後 `expired` 是單向的；不清的話接手的僚機在界內
    // 也會在下一個物理步被 `crashPolicy` 殺掉
    Object.assign(arena, createArenaState())
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
    // 【跟瞄歷史一起清】新機的指揮儀還留著那一席 AI 的跟瞄歷史（`resetTrack`）
    player.aircraft.director.resetTrack()
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
  aircraftVisuals.update(
    world.combatants, alpha, ctx.camera.position, propRotation,
    battle.cfg.liveries, wrecks, vortex,
  )
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
  if (sceneWeather.storm !== null) {
    applyFlash(ctx.lights, ctx.sky, DAY_PALETTES.storm, stepStorm(sceneWeather.storm, worldSeconds, playThunder))
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
  const att = attitudeFromOrientation(renderQuat, hudAttitude)
  const agl = renderPos.y - terrain.collisionHeightAt(renderPos.x, renderPos.z)
  // 【包絡與 agl 只解一次】HUD 的投放閘門與高度弧讀的必須是**這兩個值**，
  // 不是各自再查一次 —— 分家的症狀是「錶上綠燈而扳機沒有反應」，不拋例外
  // 也沒有訊息
  const releaseEnv = playerLoadout !== null ? envelopeFor(playerLoadout.kind) : null
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
  steamEmission.emitPlantSteam(worldSeconds, world.groundTargets, terrainKind)
  steamEmission.emitFlareSmoke(worldSeconds, world.flares)
  // 【槍焰用內插姿態】它是一個狀態而不是一個瞬間，所以位置在這裡重算 ——
  // 用物理位置的話槍焰會相對機身抖動一個子步的位移（M7 spec §2.1）
  muzzles.update(world.combatants, renderPositions, renderQuaternions)
  // 【砲塔的槍管也用內插姿態】理由與槍焰完全相同
  turretBarrels.update(world.combatants, renderPositions, renderQuaternions)
  turretMuzzles.update(world.combatants, renderPositions, renderQuaternions)
  flareLights.update(world.flares, elapsed)
  stepEffects(worldSeconds, world.time, terrain, elapsed)
  // 【船在渲染幀率更新，不在物理步】它讀的是船的位置與砲位的槍焰計時器，
  // 兩者都是狀態不是事件 —— 與飛機模型同一個道理。
  battleScenery.groundModels?.update(world.groundTargets, ctx.camera.position, worldSeconds)
  // 【吃世界秒數】射擊排程是 `world.time` 的純函數；暫停時兩者都不走
  battleScenery.groundBattle?.update(world.groundTargets, world.time, worldSeconds, world.groundAt)
  // 【吃世界秒數】暫停時為 0，團塊停在原地
  if (battleScenery.battleFogOn) stepBattleFog(worldSeconds)
  battleScenery.balloonModels?.update(world.balloons, worldSeconds, terrain.collisionHeightAt, burnBalloon)
  battleScenery.searchlights?.update(elapsed, world.combatants, ctx.camera.position)
  battleScenery.shipModels?.update(world.ships, (x, y, z) => {
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
  // 【浪高與海面同一組 uniform】帶子要跟著看得見的浪起伏，否則會被浪蓋掉。地形每場
  // 重建，所以每幀接一次（沒換就只是比對參考）
  wakes.bindOcean(terrain.oceanHeight)
  wakes.step(worldSeconds, elapsed, terrain.heightAt)
  battleScenery.shipWakes?.bindOcean(terrain.oceanHeight)
  battleScenery.shipWakes?.step(world.ships, worldSeconds, elapsed, terrain.heightAt)
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

  // 【雨跟著這一幀的鏡頭】雨絲的方向由雨自己算：雨滴這一幀在鏡頭眼裡移動了多少。
  // 上帝視角不轉，照停著的方向畫
  if (sceneWeather.rain !== null) {
    sceneWeather.rain.update(ctx.camera.position, worldSeconds, frameSeconds, input.godView, rainGroundAt)
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
  hudFrame.aircraftName = aircraftName(aircraft.spec)
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
  hudFrame.touch = touch.visible
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
  markerObjectives.ref.copy(refPos)
  fillMarkers(
    hudFrame, world.ships, world.groundTargets, MARKER_POOLS,
    teamSlot(player.team), projectMarker, shipMarkerTop, markerObjectives,
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
  const objectiveKey = battle.objectiveKey ?? pendingMission?.battle.objectiveKey ?? null
  hudFrame.objectiveText = objectiveKey === null ? '' : t(objectiveKey)
  hudFrame.objectiveMetric = m.metric
  hudFrame.objectiveMetricKind = m.metricKind
  // 【橫幅在目標改變的那一刻出現】開場是卡片上那一句短句；返航節拍換掉
  // 目標時是那一則訊息 —— 兩者走同一條。遭遇戰沒有橫幅
  //
  // 【以鍵判斷換了沒有】語言切換只換字，不算新的橫幅
  const banner = mode !== 'mission'
    ? null
    : battle.objectiveKey ?? pendingMission?.battle.bannerKey ?? objectiveKey
  if (banner !== bannerKey) {
    bannerKey = banner
    bannerStart = elapsed
    // 【橫幅配電報聲】與訊息同一組；橫幅消失時不響
    if (bannerKey !== null) audio.playPool('radio', 'radio', 0, 0, 0, false)
  }
  hudFrame.objectiveBanner = bannerKey === null ? '' : t(bannerKey)
  hudFrame.objectiveBannerAge = bannerKey === null ? -1 : elapsed - bannerStart
  hudFrame.objectiveBannerTypeAge = bannerStart <= langChangedAt ? -1 : hudFrame.objectiveBannerAge
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
  hudFrame.message = battle.message === null ? '' : t(battle.message)
  // 【打字機的時鐘】訊息換了就從頭打；沒有訊息就沒有年齡
  if (battle.message !== messageKey) {
    messageKey = battle.message
    messageStart = elapsed
    // 【增援預警配無線電】訊息消失時不響
    if (messageKey !== null) audio.playPool('radio', 'radio', 0, 0, 0, false)
  }
  hudFrame.messageAge = messageKey === null || messageStart <= langChangedAt ? -1 : elapsed - messageStart

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
  // 【觸控操作不鎖指標】觸控層直接收 pointer 事件
  if (touch.active) return
  void Promise.resolve(canvas.requestPointerLock()).catch(() => {})
}

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

/**
 * 短片裡受損拖的煙，相對殘骸煙池（`wreckFireSmoke`）的出生尺寸。
 *
 * 【走殘骸那一池，不走通用煙池】通用的那一份是 2.5 秒的實心軟圓，一路拖出來是
 * 一串分開的黑球；殘骸那一份有煙的貼圖與受光、活 20 秒、慢慢散開 —— 拖出來是
 * 一條連著的煙，與殘骸墜落時那一條是同一種東西
 */
const REEL_SMOKE_SIZE = 0.32

/** 短片的高砲：一朵雲走與戰鬥同一條路（黑雲池 + 爆點小火球 + 閃光） */
const REEL_BURSTS = createBursts(1)

/** 短片現在的時段。雲色照它（`setClouds` 在 `setTimeOfDay` 之後呼叫） */
let menuTimeOfDay: TimeOfDay = 'noon'

/** 開場與主選單的左欄 */
const reelRows = Array.from(document.querySelectorAll<HTMLElement>('#landing .rows, #menu .rows'))
/** 選單頁的主角位置（畫面寬度的成數）；開場與主選單每次重量，量到之前用這個值 */
let reelSubjectRight = 0.7

// 開場就是選單：短片的風（進戰鬥時建地圖換成那一張的風、離開戰鬥換回來）
Object.assign(SMOKE_WIND, REEL_WIND)

/**
 * 主選單背景的短片（`app/menuReel.ts`）。選單類畫面都在放；進機庫與戰鬥時停下。
 */
const menuReel: MenuReel = createMenuReel({
  scene: ctx.scene,
  camera: ctx.camera,
  terrain: () => terrain,
  setTerrain: setMenuTerrain,
  setTimeOfDay(tod) {
    setMenuTimeOfDay(tod)
  },
  setClouds(list) {
    if (list.length === 0) clouds.clear()
    else clouds.set(list, cloudColorOf(DAY_PALETTES[menuTimeOfDay], CLOUD_COLOR))
  },
  fade: document.getElementById('reel-fade') as HTMLElement,
  subjectX() {
    // 所有選單頁一律落在左欄（開場與主選單的 `.rows`，兩頁同寬）右緣與畫面右緣的中間。
    // 左欄只在這兩頁量得到，其他頁沿用上一次量到的值 —— 換頁時主角才不會動
    for (const rows of reelRows) {
      const right = rows.getBoundingClientRect().right
      if (right > 0 && window.innerWidth > 0) {
        reelSubjectRight = (right + window.innerWidth) / 2 / window.innerWidth
        break
      }
    }
    return reelSubjectRight
  },
  light: window.matchMedia('(pointer: coarse)').matches,
  fx: {
    kill(model, spec, vx, vy, vz, seed, blast) {
      // 【殘骸池的回收回呼從場景移除】模型要直接掛在場景上，回收時才拆得掉
      ctx.scene.attach(model.group)
      if (blast) {
        const p = model.group.position
        emitBlast(BLAST_POOLS, AIR_BLAST, p.x, p.y, p.z, seed,
          vx * KILL_BLAST_INHERIT, vy * KILL_BLAST_INHERIT, vz * KILL_BLAST_INHERIT)
        blastLights.flash(p.x, p.y, p.z, KILL_SHAKE, ctx.camera.position)
      }
      wrecks.adopt(model, spec, vx, vy, vz, seed)
    },
    flak(x, y, z) {
      // 雲的大小、閃光的尺度都用艦砲的預設值
      pushBurst(REEL_BURSTS, x, y, z, 1)
      emitFlakBursts(flakBursts, REEL_BURSTS)
      emitFlakBlasts(BLAST_POOLS, REEL_BURSTS)
      blastLights.flash(x, y, z, REEL_BURSTS.shake[0]!, ctx.camera.position, false)
      clearBursts(REEL_BURSTS)
    },
    smoke(x, y, z, vx, vy, vz) {
      // 【平順地蜿蜒，不是各自亂飄】外飄速度由出生位置決定（幾條不同波長的正弦），
      // 相鄰兩團幾乎一樣 —— 整條煙緩緩彎曲但仍連成一條。不加的話直飛的飛機把煙排成
      // 一條筆直的管子；每團各自亂數的話又散成一片、讀不出是一條煙
      const wx = Math.sin(x * 0.031 + z * 0.017) + 0.5 * Math.sin(y * 0.043 + x * 0.011)
      const wy = Math.sin(z * 0.027 - x * 0.019) + 0.5 * Math.sin(x * 0.047 + y * 0.013)
      const wz = Math.sin(y * 0.029 + z * 0.023)
      const s = (reelSmokeSeed = (reelSmokeSeed + 1) | 0)
      const j = REEL_SMOKE_JITTER
      const size = REEL_SMOKE_SIZE * (1 + (hash01(s * 5 + 4) * 2 - 1) * REEL_SMOKE_SIZE_JITTER)
      wreckFireSmoke.emit(x, y, z,
        vx + REEL_SMOKE_WANDER * wx + (hash01(s * 5 + 1) * 2 - 1) * j,
        vy + REEL_SMOKE_WANDER * wy + (hash01(s * 5 + 2) * 2 - 1) * j,
        vz + REEL_SMOKE_WANDER * wz + (hash01(s * 5 + 3) * 2 - 1) * j, size)
    },
    fire(x, y, z) {
      emitWreckFirePuff(x, y, z)
    },
    bomb(x, y, z, water) {
      blastPresentation.reelBomb(x, y, z, water, terrain, elapsed)
    },
    torpedoSplash(x, z) {
      blastPresentation.reelTorpedoSplash(x, z)
    },
    torpedoWake(slot, x, z, serial) {
      wakes.emit(slot, x, z, serial)
    },
    torpedoHit(x, z) {
      blastPresentation.reelTorpedoHit(x, z, terrain, elapsed)
    },
    shipHit(x, y, z) {
      blastPresentation.reelShipHit(x, y, z, terrain, elapsed)
    },
    vortex(seat, loadFactor, lx, ly, lz, rx, ry, rz) {
      vortex.emit(seat, loadFactor, lx, ly, lz, rx, ry, rz)
    },
    hits(events) {
      const c = ctx.camera.position
      sparks.emit(events, c.x, c.y, c.z)
    },
    shipFire(x, y, z) {
      emitFirePuff(x, y, z)
    },
    trackDust(x, y, z) {
      reelTrackDust.emit(x, y, z, 0, 0.8, 0, 0.6)
    },
    groundKill(x, y, z, fires) {
      blastPresentation.reelGroundKill(x, y, z, fires)
    },
    blast(x, y, z, size) {
      blastPresentation.reelBlast(x, y, z, size, terrain, elapsed)
    },
    clear() {
      wrecks.reset()
      resetPools()
      // 【閃光不在 `POOLS` 裡】停在一團爆炸的閃光上進機庫的話，光源與煙的受光一直亮著
      blastLights.reset()
    },
  },
})
/**
 * 短片拖煙：蜿蜒的外飄速度幅度、每團各自的小亂數（m/s）、大小的相對抖動。
 * 煙本來就細，幅度一大整條就散掉、不連貫
 */
const REEL_SMOKE_WANDER = 0.84
const REEL_SMOKE_JITTER = 0.4
const REEL_SMOKE_SIZE_JITTER = 0.35
let reelSmokeSeed = 0
/** 選單裡沒有戰鬥的船。模組層建一次 —— 每幀傳一個新的空陣列就是每幀配置 */
const NO_SHIPS: readonly Ship[] = []

/**
 * 選單期間的時段與天氣。雷雨的段要有雨與閃電；換到別的時段就收掉 ——
 * 留著的話機庫裡也在下雨
 */
function setMenuTimeOfDay(tod: TimeOfDay): void {
  menuTimeOfDay = tod
  applyTimeOfDay(ctx, terrain, tod)
  syncFireSmokeLighting()
  sceneWeather.set(tod)
}

window.addEventListener('resize', () => menuReel.relayout())

/** 選單期間的一幀：放短片、推進特效池 */
function drawMenuBackground(frameSeconds: number): void {
  menuReel.update(frameSeconds, elapsed)
  // 【定格時特效也停】只停短片的話，殘骸與煙照樣往下掉、往外散，截到的不是那一秒
  // 【慢動作時特效也慢】短片變速時，煙、火、曳光照畫面秒數散開的話，只有飛機在慢
  const fx = menuReel.hold ? 0 : frameSeconds * menuReel.rate
  stepEffects(fx, elapsed, terrain, elapsed)
  spray.step(fx)
  vortex.step(fx)
  reelTrackDust.step(fx)
  // 短片地上的煙囪與冷卻塔冒白煙（炸毀的就停）
  steamEmission.emitPlantSteam(fx, menuReel.props, terrainKind)
  // 短片投下的炸彈點的地面火、魚雷的航跡。【擠在一起的火少冒煙】短片的地面火也要
  // 照密度節流，不然一串炸彈的火全速冒煙；戰鬥的船火池在選單裡是空的
  updateFireCrowd(fireCrowd, groundFires, shipFires, NO_SHIPS, fx)
  stepGroundFires(groundFires, fx, emitFirePuff, fireCrowd.ground)
  wakes.bindOcean(terrain.oceanHeight)
  wakes.step(fx, elapsed, terrain.heightAt)
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  if (sceneWeather.storm !== null) {
    applyFlash(ctx.lights, ctx.sky, DAY_PALETTES.storm, stepStorm(sceneWeather.storm, fx, playThunder))
  }
  if (sceneWeather.rain !== null) sceneWeather.rain.update(ctx.camera.position, fx, frameSeconds, false, rainGroundAt)
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
  'settingsCancel', 'reloadNo', 'planePickCancel',
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
    // 【短片只在選單類畫面放】機庫有自己的展示場、戰鬥有自己的場景。停下時連共用的
    // 特效池一起清 —— 機庫不推進那些池，留著的黑雲會凍在天上
    if (screen === 'hangar' || screen === 'battle') menuReel.stop()
    // 【機庫一律正午】短片換過時段，停在黃昏的話機庫的飛機是剪影
    if (screen === 'hangar' && from !== 'hangar') setMenuTimeOfDay('noon')
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
    // 【換頁之後重量】回到開場或主選單時左欄才量得到
    menuReel.relayout()
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
    // 【再打同一關也要有橫幅】橫幅在換成另一句時才出現，上一場留下的要清掉
    bannerKey = null
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
  onQuality(pixelRatio) {
    ctx.setQuality(pixelRatio)
    saveQuality(pixelRatio)
    // 【田色的內圈跟著檔位】前兩檔留一圈算式，其餘純貼圖；純海面沒有這一項
    terrain.fieldClip?.setInnerRadius(fieldInnerFor(pixelRatio))
    // 【自己重畫】選單不記得目前的檔位，按鈕的選中狀態要由這裡再餵一次
    menu.renderQuality(pixelRatio)
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
  onAimAssist(on) {
    aimAssist.enabled = on
    aimAssist.reset()
    saveAimAssist(on)
    menu.renderAimAssist(on)
  },
  onLang(lang) {
    saveLang(lang)
    setLang(lang)
    menu.renderLang(lang)
  },
})
// 【先套用再畫選單】兩邊讀同一個值，按鈕標的才是畫面實際用的檔位
const startQuality = readQuality()
ctx.setQuality(startQuality)
menu.renderQuality(startQuality)
// 抗鋸齒在 `createScene` 就讀過並套用了，這裡只是把按鈕標成同一個值
menu.renderAntialias(readAntialias())
menu.renderVolume(readVolume())
menu.renderAimAssist(aimAssist.enabled)
menu.renderLang(getLang())
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
    titleKey: mode === 'mission' && pendingMission !== null ? pendingMission.titleKey : 'result.skirmish',
    objectiveKey: battle.objectiveKey ?? pendingMission?.battle.objectiveKey ?? 'mission.killAll.objective',
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
  bindings.tick(frameSeconds, touch.hold)
  touch.sync(
    screen === 'battle' && !loadingBattle && !paused && battle.outcome === 'fighting',
  )
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
    // 【觸控的暫停鈕走同一條路】沒有指標鎖就不會有 `pointerLockLost`
    if (input.pointerLockLost || input.pauseRequested) {
      const unlocked = input.pointerLockLost
      input.pointerLockLost = false
      input.pauseRequested = false
      // 分出勝負之後不再暫停 —— 結算板本身就是出口
      // 【教學卡自己放開的那一次不算】見 `ignoreNextUnlock`；卡開著時卡上的
      // 「了解」就是出口，也不疊暫停選單
      if (unlocked && ignoreNextUnlock) {
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
    // 【短片定格時全域時間也停】海浪與火星讀的是它，照走的話截到的不是那一秒
    if (screen === 'hangar' || !menuReel.hold) elapsed += frameSeconds
    // 【展示場還沒建好就照畫海天】進機庫的第一幀有可能落在 `onAircraft`
    // 之前，那一幀畫成黑的會閃一下。**這一幀不放短片** —— 放的話它會從暗場重新開一段
    if (screen === 'hangar') {
      if (showcase !== null) drawHangar(frameSeconds, showcase)
      else ctx.renderer.render(ctx.scene, ctx.camera)
    } else {
      drawMenuBackground(frameSeconds)
    }
  }

  perf.endFrame(loop.lastSubstepCount)
  rangeProbe.update(ctx.camera, terrain, elapsed)
  requestAnimationFrame(frame)
}

// 【GLB 機種要在進迴圈前載完】`buildAircraft` 是同步的（`main.ts`、四個工具
// 頁、node 單元測試都同步呼叫它），所以非同步只能關在這一行。
const initialRecoveryFailure = recoveryWorkerFailure()
if (initialRecoveryFailure !== null) {
  blockForRecoveryWorker(initialRecoveryFailure)
} else {
  await preloadStartupAssets(loading)
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
 * 覆蓋層此刻顯示的 FPS。**量測出口**：探針拿它與自己由 rAF 時間戳量到的
 * 真實幀率比對，兩者對不上就是覆蓋層量錯了東西。
 */
;(window as unknown as Record<string, unknown>)['__perfFps'] = (): number => perf.fps

/**
 * 主選單短片的**量測出口**：不給參數回目前放到哪；給 `(段名, 秒)` 就跳過去，
 * 事件從頭重放到那一刻。`hold` = 跳過去之後定格（截圖驗收分鏡用）。
 */
;(window as unknown as Record<string, unknown>)['__reel'] = (shot?: string, at = 0, hold = false) => {
  if (shot !== undefined) {
    menuReel.hold = hold
    menuReel.seek(shot, at, (dt) => {
      elapsed += dt
      stepEffects(dt, elapsed, terrain, elapsed)
      spray.step(dt)
      vortex.step(dt)
    })
  }
  return menuReel.status
}

// 探針在呼叫時才解析物件，換場後會取到新模型；正常逐幀迴圈不呼叫它們。
Object.assign(window, createGraphicsDiagnostics({
  scene: ctx.scene,
  renderer: ctx.renderer,
  terrain: () => terrain,
  groups: {
    particles: () => [smoke.object, fireball.object, spray.object, splashes.object, sparks.object],
    blastSparks: () => [blastSparks.object],
    tracers: () => [tracers.object, muzzles.object, turretMuzzles.object],
    vortex: () => [vortex.object],
    aircraft: () => [...visuals.values()]
      .flatMap((v) => (v.lod === null ? [v.model.group] : [v.model.group, v.lod.group])),
    battleProps: () => [turretBarrels.object, orderMarkers.object, debris.object, objectiveRing.object],
    ships: () => (battleScenery.shipModels === null ? [] : [battleScenery.shipModels.object]),
    ground: () => (battleScenery.groundModels === null ? [] : [battleScenery.groundModels.object]),
    balloons: () => (battleScenery.balloonModels === null ? [] : [battleScenery.balloonModels.object]),
    rain: () => (sceneWeather.rain === null ? [] : [sceneWeather.rain.object]),
    clouds: () => [clouds.object],
    rainLines: () => (sceneWeather.rain === null ? [] : sceneWeather.rain.object.children.slice(0, 1)),
    rainSplash: () => (sceneWeather.rain === null ? [] : sceneWeather.rain.object.children.slice(1, 2)),
    beach: () => (terrainKind === 'leyte' ? terrain.object.children.slice(4) : []),
  },
}))

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
  const g = battleScenery.groundModels?.object
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
    ground: battleScenery.groundModels?.lodState() ?? null,
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
    team: t.team,
    alive: t.alive,
    arrived: t.arrived,
    dormant: t.dormant,
    scripted: t.scripted,
    speed: t.speed,
    x: +t.position.x.toFixed(1),
    y: +t.position.y.toFixed(1),
    z: +t.position.z.toFixed(1),
  }))

/** **量測出口**：地面戰的戲開場到現在打了幾發。`null` = 這一場沒有戲 */
;(window as unknown as Record<string, unknown>)['__theater'] = () => battleScenery.groundBattle?.shots ?? null

/**
 * **量測出口**：戰場高度霧開關（省略參數 = 查現在的狀態）。同一頁交錯開關量它的成本、拍有霧與沒霧的
 * 同一幀。`null` = 這一場沒有霧
 */
;(window as unknown as Record<string, unknown>)['__haze'] = (on?: boolean) => {
  if (!battleScenery.battleFogOn) return null
  if (on !== undefined) BATTLE_FOG.a.w = on ? 1 : 0
  return BATTLE_FOG.a.w > 0
}

/** **量測出口**：塵團開關（省略參數 = 查現在的狀態）。`null` = 這一場沒有塵團 */
;(window as unknown as Record<string, unknown>)['__dustClouds'] = (on?: boolean) => {
  const o = battleScenery.groundBattle?.objects.find((x) => x.name === 'groundBattle.dustClouds')
  if (o === undefined) return null
  if (on !== undefined) o.visible = on
  return o.visible
}

/** **量測出口**：迫擊砲彈開場到現在發了幾發、落地幾發、最近一發落在哪裡。`null` = 這一場沒有戲 */
;(window as unknown as Record<string, unknown>)['__mortars'] = () => battleScenery.groundBattle === null ? null : {
  shots: battleScenery.groundBattle.arcShots,
  landed: battleScenery.groundBattle.arcLanded,
  last: { ...battleScenery.groundBattle.arcLastLanding },
}

/**
 * **量測出口**：把紅方 `unit` 的前 `n` 台（省略 = 全部）直接打掉。
 *
 * 【為什麼需要它】德 M4 的兩段要驗「反坦克砲炸完 → 縱隊出發、目標換段」。靠 AI 去
 * 炸要好幾分鐘而且每次不同；這一支讓驗收直接跳到換段那一刻。走的是與炸彈同一條
 * 摧毀判定（`alive = false`），算進摧毀數。玩家沒有任何路徑碰得到。
 */
;(window as unknown as Record<string, unknown>)['__wreckGround'] = (unit: string, n = Infinity) => {
  let k = 0
  for (const t of world.groundTargets) {
    if (k >= n) break
    if (t.team !== 'red' || t.unit.id !== unit || !t.alive) continue
    t.hp = 0
    t.alive = false
    k++
  }
  return k
}

/**
 * **量測出口**：場上每一艘船的艦級、位置與艏向（度，0 = 艦首朝 −Z）。
 * 截圖要把上帝視角擺到某一艘旁邊，艦隊會走，只能讀當下的座標。
 */
;(window as unknown as Record<string, unknown>)['__ships'] = () =>
  world.ships.map((s) => ({
    cls: s.cls.id,
    alive: s.alive,
    x: +s.position.x.toFixed(1),
    z: +s.position.z.toFixed(1),
    heading: +(2 * Math.atan2(s.orientation.y, s.orientation.w) * 180 / Math.PI).toFixed(1),
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
    // 【與選單進戰鬥同一條】短片不停的話，離場清掉的雲它不會再鋪回來
    menuReel.stop()
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

/** **量測出口**：這一場的風（m/s，只吹煙與塵） */
;(window as unknown as Record<string, unknown>)['__wind'] = () => ({ ...SMOKE_WIND })

/**
 * **量測出口**：這一場的界與倒數狀態。給 `(x, z)` 時先把玩家水平搬過去（高度不動），
 * 驗界外警告、倒數與接手僚機用
 */
;(window as unknown as Record<string, unknown>)['__arena'] = (x?: number, z?: number) => {
  if (screen !== 'battle' || loadingBattle) return null
  if (x !== undefined && z !== undefined) {
    const p = player.aircraft.state.position
    p.x = x
    p.z = z
  }
  const p = player.aircraft.state.position
  return {
    bounds: { ...arenaBounds }, outside: arena.outside, remaining: arena.remaining, expired: arena.expired,
    seat: player.index, alive: player.alive, x: p.x, z: p.z,
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
    /** 瞄準輔助正吸著的那一架，−1 = 沒有 */
    assist: aimAssist.target,
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
