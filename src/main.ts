import { Quaternion, Vector3 } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { DEG } from './core/math'
import { createScene } from './render/scene'
import { createTerrain } from './render/terrain'
import { createTracers } from './render/tracers'
import { createMuzzles } from './render/muzzle'
import { createSparks } from './render/sparks'
import { createSplashes } from './render/splash'
import { createFireball, emitFireball } from './render/fireball'
import { createSmoke, emitKillSmoke, emitSmoke, DEBRIS_SMOKE_SIZE } from './render/smoke'
import {
  createSpray, emitSpray, DEBRIS_SPRAY_COUNT, WATER_COLOR, WRECK_SPRAY_COUNT,
} from './render/spray'
import { createVortex } from './render/vortex'
import { createDebris } from './render/debris'
import { createWrecks } from './render/wrecks'
import { bodyColorOf } from './render/geometry/buildAircraft'
import { clearImpacts } from './world/events'
import { clearKills } from './world/kills'
import { clearDamage, DAMAGE_STRIDE } from './world/damage'
import { buildAircraft, type AircraftModel } from './render/geometry/buildAircraft'
import { Hud } from './hud/Hud'
import { createHudFrame, indicatedAirspeed, nextHitFlash, HUD_MAX_CONTACTS } from './hud/types'
import { attitudeFromOrientation, headingFromOrientation } from './hud/attitude-math'
import { createScoreboard, scoreRows, sortScoreRows } from './ui/scoreboard'
import { resetGEffect } from './hud/widgets/gEffect'
import { pushDamageMark, resetDamageMarks, stepDamageMarks } from './hud/damageMarks'
import { CameraRig, DEFAULT_CAMERA_OPTIONS } from './camera/CameraRig'
import {
  createGodCameraState, enterGodCamera, godCameraTarget, stepGodCamera,
  type GodCameraInput,
} from './camera/godCamera'
import { deathCamAim } from './camera/deathCam'
import { isCrashed } from './aircraft/crash'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { slewAimWorld } from './input/aim'
import type { Combatant, World } from './world/World'
import { solveLead, NO_INTERCEPT } from './world/lead'
import { PROJECTILE_LIFETIME } from './world/Projectiles'
import { PlayerController } from './control/PlayerController'
import { AiController } from './ai/AiController'
import {
  aliveCount, createBattle, playerFlight, resetBattle, stepBattle, type Battle,
} from './battle/setup'
import {
  battleConfigFrom, DEFAULT_SKIRMISH, MAX_COMBATANTS, type SkirmishSetup,
} from './battle/skirmish'
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
let terrain = createTerrain('sea')
ctx.scene.add(terrain.object)

const tracers = createTracers()
ctx.scene.add(tracers.object)

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
const sparks = createSparks()
ctx.scene.add(sparks.object)
const splashes = createSplashes()
ctx.scene.add(splashes.object)

// 【擊墜表現：+4 個 draw call】火球、黑煙、噴濺、零件。殘骸接管既有的
// AircraftModel，所以它 +0；水柱沿用 M7 的池子，也是 +0（M8 spec §11）
const fireball = createFireball()
ctx.scene.add(fireball.object)
const smoke = createSmoke()
ctx.scene.add(smoke.object)
const spray = createSpray(WATER_COLOR)
ctx.scene.add(spray.object)
const vortex = createVortex()
ctx.scene.add(vortex.object)
const debris = createDebris()
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
  // 【讀這一場的 cfg 而不是模組層的常數】M10 起每一場的設定可以不同
  p.aircraft.respawn(input.aimWorld, battle.cfg.altitude, battle.cfg.tas)
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
}

/** 離開戰鬥：清場並收掉記分板。 */
function leaveBattle(): void {
  releaseVisuals()
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
  resetBattle(battle)
  player = battle.player
  // 【模型整批重建】只把 `wrecked` 旗標清掉是不夠的 —— 見 `rebuildVisuals`
  rebuildVisuals()
  leaveGodView()
  respawnPlayer()
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
  fireball.reset()
  smoke.reset()
  spray.reset()
  sparks.reset()
  splashes.reset()
  debris.reset()
  vortex.reset()

  // 3. 地形重建。種類沒變也重建 —— 那條路徑因此每一場都在走，不是一條
  //    等著被第一次使用的死碼（M10 spec §5.3）
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrain = createTerrain('sea')
  ctx.scene.add(terrain.object)

  // 4. 新的世界
  battle = createBattle(playerController, battleConfigFrom(setup))
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
  world.crashPolicy = (c) => isCrashed(c.aircraft.state.position, terrain.heightAt, elapsed)
  player = battle.player
  rebuildVisuals()

  playerAi.board = battle.board
  playerAi.selfIndex = player.index
  playerAi.setDecisionPhase(player.index / world.combatants.length)
  respawnPlayer()
  wasDying = false
  // 【殘留的旗標要清】它是單幀旗標，但只有戰鬥中的分支會消費它 ——
  // 留著的話新的一場開頭第一幀就被彈進暫停選單
  input.pointerLockLost = false
  // 【上帝視角的殘留同理】上一場按著 G 進主選單的話，新的一場會直接開在
  // 上帝視角、鏡頭停在舊世界的座標上
  leaveGodView()
}

const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })
let lastTime = performance.now()
let elapsed = 0

/**
 * 戰鬥中的一幀：推進、內插、特效、HUD、記分板。
 *
 * 【為什麼抽出來】選單期間這一整段都不該跑（沒有 `Battle`）。抽成函數
 * 之後 `frame` 只剩下一個分支，而搬家本身沒有改任何一行內容 ——
 * `main.ts` 沒有測試護著，這一步必須看得出來只是搬家。
 */
function stepAndDrawBattle(frameSeconds: number): void {
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
  }
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
  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    stepBattle(battle, dt)
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
    emitFireball(fireball, world.killEvents)
    emitKillSmoke(smoke, world.killEvents)
    debris.emit(world.killEvents, debrisColorOf)
    clearKills(world.killEvents)
    perf.endPhysics()
  })

  // 【玩家陣亡不再重生】M9 起改為接手僚機（`stepBattle` 的 takeover），
  // 舊機體於是像所有人一樣被殘骸池接管 —— M8 spec §10 預告的那件事現在
  // 自動成立了。
  if (battle.player !== player) {
    player = battle.player
    playerAi.selfIndex = player.index
    playerAi.setDecisionPhase(player.index / world.combatants.length)
    // 眼點是量出來的座艙位置，一機一個值 —— 兩隊機種不同時位置不一樣
    rig.options.firstPersonOffset.copy(visuals.get(player)!.model.eyePoint)
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
    // 相機看的是**瞄準方向**而不是機首方向：準星釘在畫面中央，跟不上的是飛機
    rig.update(
      ctx.camera, renderPos, renderQuat, input.aimWorld, aircraft.diag.aero.tas,
      input.viewMode, input.lookYaw, input.lookPitch, frameSeconds,
    )
  }

  tracers.update(world.projectiles)
  // 【槍焰用內插姿態】它是一個狀態而不是一個瞬間，所以位置在這裡重算 ——
  // 用物理位置的話槍焰會相對機身抖動一個子步的位移（M7 spec §2.1）
  muzzles.update(world.combatants, renderPositions, renderQuaternions)
  // 【火花與水柱在幀率積分】純裝飾，不參與判定也不需要決定性
  sparks.step(frameSeconds)
  // 【殘骸與零件先步進，再把它們吐出來的事件餵給煙、噴濺與水柱】兩者的
  // 事件緩衝在各自的 step 開頭排空，所以這裡讀到的恆是這一幀的
  wrecks.step(frameSeconds, terrain.heightAt, elapsed)
  debris.step(frameSeconds, terrain.heightAt, elapsed)
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
  vortex.step(frameSeconds)
  spray.step(frameSeconds)
  ctx.renderer.render(ctx.scene, ctx.camera)

  // 兩個準星都從**內插後的機身位置**往外投影 1000 m，所以它們的分離距離
  // 就是指揮儀正在追的角度誤差，而不是被相機視差污染過的東西。
  probe.set(0, 0, -1).applyQuaternion(renderQuat)
    .multiplyScalar(HUD_PROJECT_DISTANCE).add(renderPos).project(ctx.camera)
  hudFrame.noseX = probe.x
  hudFrame.noseY = probe.y
  hudFrame.noseVisible = probe.z < 1

  // 瞄準點是世界方向（Task 19），螢幕位置得自己投影。NDC 的 x 乘上長寬比
  // 才會換成「螢幕半高」。相機追著它，所以這一組值正常情況下都貼近 0。
  probe.copy(input.aimWorld)
    .multiplyScalar(HUD_PROJECT_DISTANCE).add(renderPos).project(ctx.camera)
  hudFrame.aimX = probe.x * ctx.camera.aspect
  hudFrame.aimY = probe.y
  hudFrame.aimVisible = probe.z < 1

  const att = attitudeFromOrientation(renderQuat)
  hudFrame.tas = aircraft.diag.aero.tas
  hudFrame.ias = indicatedAirspeed(aircraft.diag.aero.tas, aircraft.diag.air.sigma)
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
  hudFrame.worldX = input.godView ? godCam.position.x : renderPos.x
  hudFrame.worldZ = input.godView ? godCam.position.z : renderPos.z
  hudFrame.aircraftName = aircraft.spec.name
  hudFrame.hp = player.hp
  hudFrame.hpMax = player.aircraft.spec.hp
  hudFrame.aiFlying = input.playerAi
  hudFrame.godView = input.godView
  hudFrame.controlAuthority = aircraft.diag.controlAuthority
  hudFrame.blueAlive = aliveCount(battle.blue)
  hudFrame.redAlive = aliveCount(battle.red)

  // 【分隊存活】遞補之後 count 會自動變 —— members 每個物理步重新壓縮
  const flight = playerFlight(battle)
  hudFrame.flightAlive = flight?.count ?? 0
  hudFrame.flightSize = flight?.roster.length ?? 0

  // 【接觸點】畫全部，沒有距離門檻；預瞄環的條件是「真的打得到」。
  const sight = aircraft.spec.battery.sight
  // 【每幀取一次】玩家的分隊序號。編制每個物理步重新壓縮，所以陣亡、
  // 遞補、重生都不需要額外同步 —— flightOf 直接就是最新的
  const playerFlightIndex = battle.flights.flightOf[player.index]!
  // 【小地圖的高度符號要跟著小地圖的中心走】上帝視角下平面已經以鏡頭
  // 重新置中（`worldX`/`worldZ`），高度基準卻還留在自機的話，三角形的
  // 上下與畫面上的位置對應不起來 —— 一架就在鏡頭正下方的飛機會被畫成
  // 「在你上方」。`range` 不必跟著改：小地圖不吃它，而吃它的接觸點框與
  // 邊緣指示在上帝視角下根本不畫（`hudWidgets`）
  const refY = input.godView ? godCam.position.y : renderPos.y
  let n = 0
  for (const c of world.combatants) {
    // 【上帝視角下自機也要進接觸點】座艙裡排除自己是對的（你就坐在裡面），
    // 但上帝視角下中心是**鏡頭**不是自機 —— 不放進來的話，玩家自己那一架
    // （正被 AI 代飛，也就是這個模式最想看的東西）在小地圖上一個像素都沒有。
    // 池子夠：`HUD_MAX_CONTACTS` 48，20v20 最多 39 個他機。
    //
    // 【`range` 與 `radius` 會是 0 與一個很大的值】兩者只有接觸點框與邊緣
    // 指示在吃，而那兩個 widget 在上帝視角下根本不畫（`hudWidgets`）。
    if ((c === player && !input.godView) || !c.alive || n >= HUD_MAX_CONTACTS) continue
    const contact = hudFrame.contacts[n]!
    const v = visuals.get(c)!

    probe.copy(v.position).project(ctx.camera)
    contact.behind = probe.z >= 1
    contact.x = probe.x * ctx.camera.aspect
    contact.y = probe.y
    contact.range = v.position.distanceTo(renderPos)
    // 【單位是螢幕半高】透視投影的 NDC y = tan(θ) / tan(fov/2)，而
    // tan(atan(halfSpan / range)) 就是 halfSpan / range——所以直接寫比值，
    // 不要繞一圈 atan（那會算成 θ / tan(fov/2)，近距離時低估框的大小）。
    contact.radius = ((c.aircraft.spec.wing.span / 2) / Math.max(contact.range, 1))
      / Math.tan((ctx.camera.fov * DEG) / 2)
    contact.hostile = c.team !== player.team
    contact.flightMate = playerFlightIndex >= 0
      && battle.flights.flightOf[c.index] === playerFlightIndex
    contact.deltaY = v.position.y - refY
    contact.worldX = v.position.x
    contact.worldZ = v.position.z

    // 【預瞄環只給敵機】M5 起彈丸直接穿過友機（spec §2），所以友機的預瞄環
    // 指的是一個打不到的點——畫出來只會是「往這裡開槍」的錯誤暗示。19 架
    // 友機同時畫更是滿畫面的雜訊。順帶省掉每架一次的預瞄解。
    contact.leadValid = false
    if (contact.hostile) {
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

  // 命中回饋：World 在命中的那一步把 hitsDealt 加上去；HUD 這一層負責計時。
  hudFrame.hitFlash = nextHitFlash(hudFrame.hitFlash, hitsThisFrame, frameSeconds)
  // 【一幀一次，不是一個子步一次】淡出走的是畫面時間。在子步裡步進的話，
  // 一幀跑幾個子步就淡幾倍快 —— 而子步數會隨幀率變動。
  stepDamageMarks(hudFrame.damageMarks, frameSeconds)

  hud.render(hudFrame, frameSeconds)

  // 【只在看得到的時候才重建】40 列的 innerHTML 重建不便宜到可以每幀做
  const finished = battle.outcome !== 'fighting'
  // 【分出勝負就放開指標鎖】結算板的兩顆按鈕要點得到，而指標鎖定期間
  // 游標是被抓住的。解鎖會讓下一幀的 `pointerLockLost` 為真，但那個分支
  // 只在 `outcome === 'fighting'` 時才暫停 —— 所以不會誤觸
  if (finished && document.pointerLockElement === canvas) document.exitPointerLock()
  const showBoard = input.scoreboardHeld || finished
  if (showBoard) {
    scoreboard.render(
      sortScoreRows(scoreRows(battle.roster, world.combatants, 'blue')),
      sortScoreRows(scoreRows(battle.roster, world.combatants, 'red')),
      finished ? (battle.outcome === 'victory' ? 'victory' : 'defeat') : null,
    )
  }
  scoreboard.setVisible(showBoard)
  // 【結算時才讓那兩顆按鈕出現，而且 #board 這時要能點】按住 TAB 看戰績
  // 的期間它是 pointer-events: none —— 那時它只是看
  boardActions.hidden = !finished
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

const menu = createMenu(document.getElementById('ui') as HTMLElement, {
  onEvent(event) {
    const from = screen
    screen = nextScreen(screen, event)
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

function frame(now: number) {
  const frameSeconds = (now - lastTime) / 1000
  lastTime = now
  perf.begin()
  bindings.tick(frameSeconds)
  hudCanvas.hidden = screen !== 'battle'

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
      elapsed += frameSeconds
      stepAndDrawBattle(frameSeconds)
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
requestAnimationFrame(frame)
