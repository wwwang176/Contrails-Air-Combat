import { Quaternion, Vector3 } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { DEG } from './core/math'
import { createScene } from './render/scene'
import { createOcean } from './render/ocean'
import { createProps } from './render/props'
import { createTracers } from './render/tracers'
import { buildAircraft, type AircraftModel } from './render/geometry/buildAircraft'
import { Hud } from './hud/Hud'
import { createHudFrame, indicatedAirspeed, nextHitFlash, HUD_MAX_CONTACTS } from './hud/types'
import { attitudeFromOrientation, headingFromOrientation } from './hud/attitude-math'
import { resetGEffect } from './hud/widgets/gEffect'
import { CameraRig } from './camera/CameraRig'
import { isCrashed } from './aircraft/crash'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { slewAimWorld } from './input/aim'
import type { Combatant } from './world/World'
import { solveLead, NO_INTERCEPT } from './world/lead'
import { PROJECTILE_LIFETIME } from './world/Projectiles'
import { PlayerController } from './control/PlayerController'
import { AiController } from './ai/AiController'
import {
  aliveCount, createBattle, playerFlight, playerWingman, resetBattle, stepBattle,
} from './battle/setup'
import { P51D } from './specs/p51d'
import { BF109G6 } from './specs/bf109g6'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
const perf = createPerfOverlay(ctx.renderer)

const ocean = createOcean()
ctx.scene.add(ocean.mesh)
ctx.scene.add(createProps(600))

const tracers = createTracers()
ctx.scene.add(tracers.object)

const input = createInputState()
const bindings = attachInput(canvas, input)

const playerController = new PlayerController(input)
const battle = createBattle(playerController)
const world = battle.world
const player = battle.player
const START_ALTITUDE = battle.cfg.altitude
const START_TAS = battle.cfg.tas

/**
 * 自機的 AI（`I`）。純觀測用：讓同一顆腦袋同時開兩台，從外面看它怎麼打。
 *
 * 【為什麼要獨立一個實例而不是共用戰場裡的某一個】`AiController` 持有跨格
 * 狀態（遲滯閂鎖、最小停留、10 Hz 節流、跟蹤計時器、目標記憶）。共用的話
 * 兩架會互相踩掉對方的決策狀態，看到的行為不是任何一架真正的行為。
 */
const playerAi = new AiController()
playerAi.board = battle.board
playerAi.selfIndex = player.index
playerAi.setDecisionPhase(player.index / world.combatants.length)

const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement)
const hudFrame = createHudFrame()

/**
 * 一架飛機的可視部分：模型 + 內插用的暫存。
 *
 * 【為什麼一架一組而不是共用】M1 只有一架，位置與姿態直接寫在模組層的兩個
 * 變數上。兩架以上就必須各自持有，否則第二架會把第一架的內插結果覆寫掉
 * ——這是「世界上只有一架飛機」這個假設最直接的殘留物。
 */
interface Visual {
  model: AircraftModel
  readonly position: Vector3
  readonly quaternion: Quaternion
}

const visuals = new Map<Combatant, Visual>()
function attachVisual(c: Combatant): Visual {
  const v: Visual = {
    model: buildAircraft(c.aircraft.spec),
    position: new Vector3(),
    quaternion: new Quaternion(),
  }
  ctx.scene.add(v.model.group)
  visuals.set(c, v)
  return v
}
for (const c of world.combatants) attachVisual(c)

const rig = new CameraRig()
rig.options.firstPersonOffset.copy(visuals.get(player)!.model.eyePoint)

/** 換機種時整組重建，避免佔位/殘影：先建新的再移除舊的並釋放幾何與材質。 */
function rebuildModel(c: Combatant) {
  const v = visuals.get(c)!
  const next = buildAircraft(c.aircraft.spec)
  ctx.scene.add(next.group)
  ctx.scene.remove(v.model.group)
  v.model.dispose()
  v.model = next
  // 眼點是量出來的座艙位置，一機一個值——換機種必須跟著換，否則機首視角
  // 的眼睛會落到另一台的座艙高度去（見 assembly.ts 的 eyePoint）。
  if (c === player) rig.options.firstPersonOffset.copy(next.eyePoint)
}

/** HUD 投影用的暫存向量；投影距離取 1000 m，遠到視差可以忽略。 */
const probe = new Vector3()
const HUD_PROJECT_DISTANCE = 1000
/** 接觸點的預瞄計算用暫存。熱路徑禁止配置。 */
const relPos = new Vector3()
const relVel = new Vector3()
const leadDir = new Vector3()
const leadProbe = new Vector3()
let propRotation = 0

/** 重生：重置飛機並把瞄準點放回機首。R 與撞海重置共用同一條路徑。 */
function respawnPlayer() {
  player.aircraft.respawn(input.aimWorld, START_ALTITUDE, START_TAS)
  player.aircraft.state.position.copy(player.spawnPosition)
  player.aircraft.prevPosition.copy(player.spawnPosition)
  player.hp = player.aircraft.spec.hp
  player.alive = true
  player.cooldowns.fill(0)
  // 清掉墜海前那一下扭轉留在相機上的落後量與自由視角角度
  rig.snapTo(input.aimWorld)
  // 撞海前八成正在拉大 G；不清掉的話重生後畫面還是黑的
  resetGEffect()
}
respawnPlayer()

/**
 * 撞地判定，套用於**所有**飛機。
 *
 * 【M5 起擴及全部】M2 到 M4 只對玩家做，理由是「靶機在固定高度巡航，不會
 * 撞海」。20v20 裡總有人會被打到失控——不補的話會出現在海面下繼續飛的
 * 飛機（M5 spec §1.1）。
 *
 * 波參數與海面著色器共用（見 aircraft/crash.ts），而 `elapsed` 在幀首更新、
 * 與下方 `ocean.update` 餵給 shader 的是同一個時間 —— 玩家看到的浪頭就是
 * 撞得到的浪頭。
 */
world.crashPolicy = (c) => isCrashed(c.aircraft.state.position, ocean.heightAt, elapsed)

const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })
let lastTime = performance.now()
let elapsed = 0

function frame(now: number) {
  const frameSeconds = (now - lastTime) / 1000
  lastTime = now
  elapsed += frameSeconds
  perf.begin()
  bindings.tick(frameSeconds)

  if (input.resetRequested) {
    // 【R 重開整場，不只是自機】20v20 裡「只有我復活、戰場停在半場」是一個
    // 說不通的狀態。重置走與全滅倒數完全相同的那一條路徑（battle/setup）。
    resetBattle(battle)
    respawnPlayer()
    input.resetRequested = false
  }
  if (input.swapSpecRequested) {
    // C 不動瞄準點：瞄準點是「玩家指著的世界方向」，不屬於機體。運動狀態
    // 既然原樣保留（換的是飛機不是處境），瞄準點跟著保留才連貫；歸零反而
    // 會在換裝的瞬間硬扯機首。
    //
    // 【一定要走 world.setSpec，不能直接呼叫 aircraft.setSpec】掛架數不同
    // （P-51 六個、109 三個），射速時鐘必須跟著重配（見 World.setSpec）。
    world.setSpec(player, player.aircraft.spec.id === 'p51d' ? BF109G6 : P51D)
    rebuildModel(player)
    input.swapSpecRequested = false
  }

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
  const aiFlying = input.playerAi
  if (aiFlying) {
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

  if (aiFlying && player.controller !== playerAi) {
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
    perf.endPhysics()
  })

  // 【玩家陣亡與撞海走同一條路徑】撞地現在由 world.crashPolicy 統一判定
  // （M5 spec §7），兩者都只是把 alive 轉成 false。這裡負責把玩家接回來
  // ——瞄準點必須一併歸位，否則重生後會被舊瞄準點（還指著海面）拖回海裡。
  if (!player.alive) respawnPlayer()

  // reset 會把 prevPosition 一併設為新位置，因此重置不會被內插成一條
  // 橫跨半個地圖的殘影。
  propRotation += frameSeconds * (8 + input.throttle * 60)
  for (const c of world.combatants) {
    const v = visuals.get(c)!
    // 退場的飛機直接消失。爆炸火焰與殘骸模型延後至後續里程碑（M5 spec §2）
    v.model.group.visible = c.alive
    if (!c.alive) continue
    v.position.lerpVectors(c.aircraft.prevPosition, c.aircraft.state.position, alpha)
    v.quaternion.slerpQuaternions(c.aircraft.prevOrientation, c.aircraft.state.orientation, alpha)
    v.model.group.position.copy(v.position)
    v.model.group.quaternion.copy(v.quaternion)
    v.model.setPropSpin(propRotation, c.command.throttle > 0.15)
  }
  const renderPos = visuals.get(player)!.position
  const renderQuat = visuals.get(player)!.quaternion
  ocean.update(elapsed, renderPos.x, renderPos.z)

  const aircraft = player.aircraft
  // HUD 的迎角條與 STALL 字樣都拿它當分母
  const alphaCrit = aircraft.spec.lift.alphaCrit +
    (aircraft.diag.slatsDeployed ? aircraft.spec.lift.slatAlphaBonus : 0)

  // 相機看的是**瞄準方向**而不是機首方向：準星釘在畫面中央，跟不上的是飛機
  rig.update(
    ctx.camera, renderPos, renderQuat, input.aimWorld, aircraft.diag.aero.tas,
    input.viewMode, input.lookYaw, input.lookPitch, frameSeconds,
  )

  tracers.update(world.projectiles)
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
  hudFrame.roll = att.roll
  hudFrame.pitch = att.pitch
  hudFrame.loadFactor = aircraft.diag.loadFactor
  hudFrame.alpha = aircraft.diag.aero.alpha
  hudFrame.alphaCrit = alphaCrit
  hudFrame.ps = aircraft.specificExcessPowerActual
  hudFrame.es = aircraft.specificEnergy
  // 【讀 controls 而不是 input】兩者在玩家駕駛時完全相同，但 AI 接管時
  // input.throttle 還停在玩家鬆手前的值，顯示出來會與飛機實際在跑的油門不符。
  hudFrame.throttle = aircraft.controls.throttle
  hudFrame.powerW = aircraft.diag.powerW
  hudFrame.worldX = renderPos.x
  hudFrame.worldZ = renderPos.z
  hudFrame.aircraftName = aircraft.spec.name
  hudFrame.hp = player.hp
  hudFrame.hpMax = player.aircraft.spec.hp
  hudFrame.aiFlying = input.playerAi
  hudFrame.controlAuthority = aircraft.diag.controlAuthority
  hudFrame.blueAlive = aliveCount(battle.blue)
  hudFrame.redAlive = aliveCount(battle.red)
  hudFrame.resetCountdown = battle.countdown

  // 【分隊存活】遞補之後 count 會自動變 —— members 每個物理步重新壓縮
  const flight = playerFlight(battle)
  hudFrame.flightAlive = flight?.count ?? 0
  hudFrame.flightSize = flight?.roster.length ?? 0

  // 【接觸點】畫全部，沒有距離門檻；預瞄環的條件是「真的打得到」。
  const sight = aircraft.spec.battery.sight
  // 【每幀取一次】遞補之後它會指向新的那一架
  const wingmanIndex = playerWingman(battle)
  let n = 0
  for (const c of world.combatants) {
    if (c === player || !c.alive || n >= HUD_MAX_CONTACTS) continue
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
    contact.wingman = c.index === wingmanIndex
    contact.deltaY = v.position.y - renderPos.y
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

  hud.render(hudFrame, frameSeconds)

  perf.endFrame(loop.lastSubstepCount)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
