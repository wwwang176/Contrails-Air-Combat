import { Quaternion, Vector3 } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { DEG } from './core/math'
import { createScene } from './render/scene'
import { createOcean } from './render/ocean'
import { createProps } from './render/props'
import { buildAircraft, type AircraftModel } from './render/geometry/buildAircraft'
import { Hud } from './hud/Hud'
import { createHudFrame, indicatedAirspeed } from './hud/types'
import { attitudeFromOrientation, headingFromOrientation } from './hud/attitude-math'
import { resetGEffect } from './hud/widgets/gEffect'
import { CameraRig } from './camera/CameraRig'
import { Aircraft } from './aircraft/Aircraft'
import { isCrashed } from './aircraft/crash'
import { createInputState } from './input/InputState'
import { attachInput } from './input/bindings'
import { slewAimWorld } from './input/aim'
import { P51D } from './specs/p51d'
import { BF109G6 } from './specs/bf109g6'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
const perf = createPerfOverlay(ctx.renderer)

const ocean = createOcean()
ctx.scene.add(ocean.mesh)
ctx.scene.add(createProps(600))

const START_ALTITUDE = 4000
const START_TAS = 160

const aircraft = new Aircraft(P51D, START_ALTITUDE, START_TAS)
const input = createInputState()
const bindings = attachInput(canvas, input)

let model: AircraftModel = buildAircraft(aircraft.spec)
ctx.scene.add(model.group)
const hud = new Hud(document.getElementById('hud') as HTMLCanvasElement)
const hudFrame = createHudFrame()

const rig = new CameraRig()
rig.options.firstPersonOffset.copy(model.eyePoint)

/** 換機種時整組重建，避免佔位/殘影：先建新的再移除舊的並釋放幾何與材質。 */
function rebuildModel() {
  const next = buildAircraft(aircraft.spec)
  ctx.scene.add(next.group)
  ctx.scene.remove(model.group)
  model.dispose()
  model = next
  // 眼點是量出來的座艙位置，一機一個值——換機種必須跟著換，否則機首視角
  // 的眼睛會落到另一台的座艙高度去（見 assembly.ts 的 eyePoint）。
  rig.options.firstPersonOffset.copy(model.eyePoint)
}

const renderPos = new Vector3()
const renderQuat = new Quaternion()
/** HUD 投影用的暫存向量；投影距離取 1000 m，遠到視差可以忽略。 */
const probe = new Vector3()
const HUD_PROJECT_DISTANCE = 1000
let propRotation = 0

/** 重生：重置飛機並把瞄準點放回機首。R 與撞海重置共用同一條路徑。 */
function respawn() {
  aircraft.respawn(input.aimWorld, START_ALTITUDE, START_TAS)
  // 清掉墜海前那一下扭轉留在相機上的落後量與自由視角角度
  rig.snapTo(input.aimWorld)
  // 撞海前八成正在拉大 G；不清掉的話重生後畫面還是黑的
  resetGEffect()
}
respawn()
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
    respawn()
    input.resetRequested = false
  }
  if (input.swapSpecRequested) {
    // C 不動瞄準點：瞄準點是「玩家指著的世界方向」，不屬於機體。運動狀態
    // 既然原樣保留（換的是飛機不是處境），瞄準點跟著保留才連貫；歸零反而
    // 會在換裝的瞬間硬扯機首。
    aircraft.setSpec(aircraft.spec.id === 'p51d' ? BF109G6 : P51D)
    rebuildModel()
    input.swapSpecRequested = false
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

  const alpha = loop.advance(frameSeconds, (dt) => {
    perf.beginPhysics()
    // 傳世界方向：指揮儀自己每步做 world → body（見 Aircraft.update 註解）
    aircraft.update(input.aimWorld, input.throttle, dt)
    perf.endPhysics()
  })

  // 撞海判定：與海面著色器共用同一份波參數（見 aircraft/crash.ts）。
  // elapsed 已在幀首更新，所以判定用的時間與下方 ocean.update 餵給
  // shader 的時間是同一個——玩家看到的浪頭就是撞得到的浪頭。
  if (isCrashed(aircraft.state.position, ocean.heightAt, elapsed)) {
    // 與 R 完全同一條路徑：瞄準點必須一併歸位，否則重生後會被舊瞄準點
    // （還指著海面）拖著飛回海裡。
    respawn()
  }

  // reset 會把 prevPosition 一併設為新位置，因此重置不會被內插成一條
  // 橫跨半個地圖的殘影。
  renderPos.lerpVectors(aircraft.prevPosition, aircraft.state.position, alpha)
  renderQuat.slerpQuaternions(aircraft.prevOrientation, aircraft.state.orientation, alpha)
  ocean.update(elapsed, renderPos.x, renderPos.z)

  model.group.position.copy(renderPos)
  model.group.quaternion.copy(renderQuat)
  propRotation += frameSeconds * (8 + input.throttle * 60)
  model.setPropSpin(propRotation, input.throttle > 0.15)

  // HUD 的迎角條與 STALL 字樣都拿它當分母
  const alphaCrit = aircraft.spec.lift.alphaCrit +
    (aircraft.diag.slatsDeployed ? aircraft.spec.lift.slatAlphaBonus : 0)

  // 相機看的是**瞄準方向**而不是機首方向：準星釘在畫面中央，跟不上的是飛機
  rig.update(
    ctx.camera, renderPos, renderQuat, input.aimWorld, aircraft.diag.aero.tas,
    input.viewMode, input.lookYaw, input.lookPitch, frameSeconds,
  )

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
  hud.render(hudFrame, frameSeconds)

  perf.endFrame(loop.lastSubstepCount)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
