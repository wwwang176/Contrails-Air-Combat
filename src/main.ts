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
import { Aircraft } from './aircraft/Aircraft'
import { isCrashed } from './aircraft/crash'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { slewAimWorld } from './input/aim'
import { World, type Combatant } from './world/World'
import { solveLead, NO_INTERCEPT } from './world/lead'
import { PROJECTILE_LIFETIME } from './world/Projectiles'
import { PlayerController } from './control/PlayerController'
import { MANOEUVRES, ScriptedController } from './control/ScriptedController'
import { AiController } from './ai/AiController'
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

const START_ALTITUDE = 4000
const START_TAS = 160
/**
 * 靶機的出生點：正前方 400 m、同高度。
 *
 * 【為什麼是 400 而不是更遠】兩個理由都指向同一個數字。一是武器：匯聚點在
 * 300 m，1944 年的實戰有效射程也在 400 m 以內——擺在 800 m 等於一出生就在
 * 打不到的地方。二是眼睛：Bf 109 翼展 10 m，800 m 外的張角只有 0.7°，在
 * 65° 視野的畫面上約 12 px，而且正好躲在畫面中央的準星後面，實測找不到。
 */
const DRONE_OFFSET = new Vector3(0, 0, -400)

const input = createInputState()
const bindings = attachInput(canvas, input)

const world = new World()

const player = world.add(
  new Aircraft(P51D, START_ALTITUDE, START_TAS),
  new PlayerController(input),
  'blue',
  new Vector3(0, START_ALTITUDE, 0),
  START_ALTITUDE, START_TAS,
)

const droneController = new ScriptedController()
const drone = world.add(
  new Aircraft(BF109G6, START_ALTITUDE, START_TAS),
  droneController,
  'red',
  new Vector3(0, START_ALTITUDE, 0).add(DRONE_OFFSET),
  START_ALTITUDE, START_TAS,
)
drone.respawnOnDestroy = true
world.respawn(drone)

// 【一定要在 player 建立之後】AI 的交戰對象是玩家那架飛機。
const droneAi = new AiController()
droneAi.target = player.aircraft

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
  player.hp = player.aircraft.spec.hp
  player.cooldowns.fill(0)
  // 清掉墜海前那一下扭轉留在相機上的落後量與自由視角角度
  rig.snapTo(input.aimWorld)
  // 撞海前八成正在拉大 G；不清掉的話重生後畫面還是黑的
  resetGEffect()
}
respawnPlayer()
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

  // 靶機的駕駛者：AI 或預錄機動。切換時換掉 Combatant 的 controller
  const wantAi = input.droneAi
  if (wantAi && drone.controller !== droneAi) {
    drone.controller = droneAi
  } else if (!wantAi && drone.controller !== droneController) {
    drone.controller = droneController
    // 換回預錄機動時重新錨定基準航向，否則它會硬扯機首回到很久以前的方向
    droneController.setManoeuvre(droneController.manoeuvre, drone.aircraft)
  }
  if (!wantAi) {
    const manoeuvre = MANOEUVRES[input.droneManoeuvre]
    if (manoeuvre && manoeuvre !== droneController.manoeuvre) {
      droneController.setManoeuvre(manoeuvre, drone.aircraft)
    }
  }

  // 世界固定瞄準點：滑鼠位移繞相機的右／上軸旋轉它。不夾制——相機跟著瞄準點
  // 走，準星恆在畫面正中央，「準星不能離開畫面」那個前提不存在了（見 input/aim.ts）。
  // 右鍵自由視角時 bindings 不累積 aimDelta，所以瞄準點原地不動，飛機繼續
  // 飛向玩家先前指的地方。
  //
  // 【軸取自 rig.viewBase 而不是 camera.quaternion】viewBase 不含自由視角
  // 偏移。轉頭時若拿實際相機姿態，滑鼠的螢幕座標軸會跟著轉頭一起轉。
  slewAimWorld(
    input.aimWorld, input.aimDeltaX, input.aimDeltaY,
    rig.viewBase, ctx.camera.fov * DEG,
  )
  input.aimDeltaX = 0
  input.aimDeltaY = 0

  // 【hitsDealt 必須在回呼裡累加】World.step 在每個**物理步**開頭把它歸零，
  // 而一幀可能跑好幾步。若在幀尾才讀 player.hitsDealt，最後一步沒命中就整幀
  // 漏掉——連射時 X 標記會閃爍不定。
  let hitsThisFrame = 0
  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    world.step(dt)
    hitsThisFrame += player.hitsDealt
    perf.endPhysics()
  })

  // 撞海判定：與海面著色器共用同一份波參數（見 aircraft/crash.ts）。
  // elapsed 已在幀首更新，所以判定用的時間與下方 ocean.update 餵給
  // shader 的時間是同一個——玩家看到的浪頭就是撞得到的浪頭。
  //
  // 只對玩家做：M2 的靶機在固定高度巡航，不會撞海。
  if (isCrashed(player.aircraft.state.position, ocean.heightAt, elapsed)) {
    // 與 R 完全同一條路徑：瞄準點必須一併歸位，否則重生後會被舊瞄準點
    // （還指著海面）拖著飛回海裡。
    respawnPlayer()
  }

  // 【玩家陣亡走與撞海完全相同的路徑】spec §2 的裁決：雙方陣亡都自動重生、
  // 不計分。零新 UI、零選單、零狀態機。
  if (player.hp <= 0) respawnPlayer()

  // reset 會把 prevPosition 一併設為新位置，因此重置不會被內插成一條
  // 橫跨半個地圖的殘影。
  propRotation += frameSeconds * (8 + input.throttle * 60)
  for (const c of world.combatants) {
    const v = visuals.get(c)!
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
  hudFrame.throttle = input.throttle
  hudFrame.powerW = aircraft.diag.powerW
  hudFrame.worldX = renderPos.x
  hudFrame.worldZ = renderPos.z
  hudFrame.aircraftName = aircraft.spec.name
  hudFrame.hp = player.hp
  hudFrame.hpMax = player.aircraft.spec.hp

  // 【接觸點】畫全部，沒有距離門檻；預瞄環的條件是「真的打得到」。
  const sight = aircraft.spec.battery.sight
  let n = 0
  for (const c of world.combatants) {
    if (c === player || n >= HUD_MAX_CONTACTS) continue
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
    contact.deltaY = v.position.y - renderPos.y
    contact.worldX = v.position.x
    contact.worldZ = v.position.z

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
