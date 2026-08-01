import { Quaternion, Vector3 } from 'three'
import { FixedStepAccumulator } from './core/loop'
import { createPerfOverlay } from './core/perf'
import { DEG } from './core/math'
import { createScene } from './render/scene'
import { createOcean } from './render/ocean'
import { createProps } from './render/props'
import { createScaffoldHud } from './render/scaffold'
import { buildAircraft, type AircraftModel } from './render/geometry/buildAircraft'
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

// 程序化機體幾何（Task 21）。HUD 仍是臨時鷹架，Task 23 會取代（見 render/scaffold.ts）。
let model: AircraftModel = buildAircraft(aircraft.spec)
ctx.scene.add(model.group)
const hud = createScaffoldHud()

/** 換機種時整組重建，避免佔位/殘影：先建新的再移除舊的並釋放幾何與材質。 */
function rebuildModel() {
  const next = buildAircraft(aircraft.spec)
  ctx.scene.add(next.group)
  ctx.scene.remove(model.group)
  model.dispose()
  model = next
}

const noseWorld = new Vector3()
const renderPos = new Vector3()
const renderQuat = new Quaternion()
const camOffset = new Vector3()
let propRotation = 0

/** 重生：重置飛機並把瞄準點放回機首。R 與撞海重置共用同一條路徑。 */
function respawn() {
  aircraft.respawn(input.aimWorld, START_ALTITUDE, START_TAS)
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

  // 世界固定瞄準點：滑鼠位移繞相機的右／上軸旋轉它，再夾制在機首前方
  // maxAimAngle 的圓錐內。右鍵自由視角時 bindings 不累積 aimDelta，
  // 所以瞄準點原地不動，飛機繼續飛向玩家先前指的地方。
  noseWorld.set(0, 0, -1).applyQuaternion(aircraft.state.orientation)
  slewAimWorld(
    input.aimWorld, input.aimDeltaX, input.aimDeltaY,
    ctx.camera.quaternion, noseWorld, ctx.camera.fov * DEG,
    ctx.camera.aspect,
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
  model.setSurfaces(aircraft.controls.aileron, aircraft.controls.elevator, aircraft.controls.rudder)
  propRotation += frameSeconds * (8 + input.throttle * 60)
  model.setPropSpin(propRotation, input.throttle > 0.15)

  // 暫時的跟隨相機，Task 22 會替換為完整的 CameraRig。
  // 刻意「不隨機體側滾」：slewAimWorld 的旋轉軸取自 camera.quaternion，
  // 相機若跟著滾，持續右移滑鼠會退化成螺旋。坡度靠機體模型與坡度儀呈現。
  camOffset.copy(noseWorld).multiplyScalar(-26)
  ctx.camera.position.copy(renderPos).add(camOffset)
  ctx.camera.position.y += 7
  ctx.camera.up.set(0, 1, 0)
  ctx.camera.lookAt(renderPos)

  ctx.renderer.render(ctx.scene, ctx.camera)
  hud.render(
    {
      aimWorld: input.aimWorld,
      noseWorld,
      orientation: renderQuat,
      altitude: renderPos.y,
      tas: aircraft.diag.aero.tas,
      loadFactor: aircraft.diag.loadFactor,
      alphaDeg: (aircraft.diag.aero.alpha * 180) / Math.PI,
      ps: aircraft.specificExcessPowerActual,
      throttle: input.throttle,
      specName: aircraft.spec.id === 'p51d' ? 'P-51D Mustang' : 'Bf 109 G-6',
    },
    ctx.camera,
  )
  perf.endFrame(loop.lastSubstepCount)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
