/**
 * 長週期振盪的**最小重現**。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/phugoid-minimal.probe.ts
 *
 * 【為什麼要最小重現】20v20 裡每一架都在動，「它為什麼上下跑」有太多
 * 候選答案：自己的能量迴路、追一個也在上下跑的目標、僚機的站位、
 * 指揮命令。全部拆掉，一次只留一個變因。
 *
 * 【四個場景，刻意由簡入繁】
 *
 *   一、完全沒有目標          → 走平飛的早退路徑。應該是直的。這是量具本身的對照組
 *   二、目標平飛、同高、正前方 → 只剩追擊幾何 + 能量迴路
 *   三、目標平飛、高 1000 m   → 加上「要爬上去」
 *   四、目標**不存在但有指派** → target 指向一架凍結不動的飛機
 *
 * 一有振盪就代表**不需要對手的機動**也會發生 —— 那時迴路在自己身上。
 */
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createCommand, type Command, type Controller } from '../../src/control/Controller'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { P51D } from '../../src/specs/p51d'
import { cornerSpeed } from '../../src/analysis/envelope'

const DT = 1 / 240
const SECONDS = 300
const RAD = 180 / Math.PI
const SPEC = applyFeel(P51D, GAME_FEEL)

/** 一個什麼都不做的控制器：維持機首方向、巡航油門。目標用它就不會機動。 */
class Straight implements Controller {
  update(self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1).applyQuaternion(self.state.orientation)
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

interface Result {
  altMin: number; altMax: number; tasMin: number; tasMax: number
  flips: number
  /** 累計航向變化，度。360 = 繞了一整圈 */
  headingTotal: number
  /** 淨水平位移 ÷ 水平航程。1 = 直線、0 = 繞回原點 */
  straightness: number
  /** 安全層介入的取樣比例 */
  safetyShare: number
  /** 前 10 秒之後才開始統計，跳過起始暫態 */
  samples: number
}

/**
 * @param bankDeg  起始坡度，度。沒有目標時這個值是關鍵 —— 早退路徑把
 *                 瞄準點設成**當下的機首方向**，誤差恆為零，指揮儀不下
 *                 任何修正指令，所以坡度不會被扶正。
 * @param pitchDeg 起始仰角，度
 */
function run(
  name: string, targetOffset: Vector3 | null, bankDeg = 0, pitchDeg = 0,
): Result {
  const self = new Aircraft(SPEC, 4000, 150)
  self.state.position.set(0, 4000, 0)
  if (bankDeg !== 0 || pitchDeg !== 0) {
    const q = new Quaternion()
      .setFromAxisAngle(new Vector3(1, 0, 0), pitchDeg / RAD)
      .premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), bankDeg / RAD))
    self.state.orientation.copy(q)
    self.prevOrientation.copy(q)
    self.state.velocity.set(0, 0, -1).applyQuaternion(q).multiplyScalar(150)
  }
  const ai = new AiController()
  ai.seaHeight = 0

  let target: Aircraft | null = null
  if (targetOffset !== null) {
    target = new Aircraft(SPEC, 4000 + targetOffset.y, 150)
    target.state.position.set(targetOffset.x, 4000 + targetOffset.y, targetOffset.z)
    ai.target = target
  }
  const straight = new Straight()
  const cmd = createCommand()
  const tCmd = createCommand()

  const r: Result = {
    altMin: Infinity, altMax: -Infinity, tasMin: Infinity, tasMax: -Infinity,
    flips: 0, samples: 0, headingTotal: 0, straightness: 1, safetyShare: 0,
  }
  let sign = 0
  let prevHeading = Number.NaN
  let path = 0
  let safety = 0
  const startPos = self.state.position.clone()
  const prevPos = self.state.position.clone()
  const steps = Math.round(SECONDS / DT)
  const settle = Math.round(10 / DT)
  for (let s = 0; s < steps; s++) {
    ai.update(self, DT, cmd)
    self.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake)
    if (target !== null) {
      straight.update(target, DT, tCmd)
      target.update(tCmd.aimWorld, tCmd.throttle, DT, tCmd.brake)
    }
    if (s < settle || s % 24 !== 0) continue
    r.samples++
    if (ai.safetyAction !== 'none') safety++
    const p2 = self.state.position
    path += Math.hypot(p2.x - prevPos.x, p2.z - prevPos.z)
    prevPos.copy(p2)
    const heading = Math.atan2(self.state.velocity.x, -self.state.velocity.z) * RAD
    if (!Number.isNaN(prevHeading)) {
      let d = heading - prevHeading
      while (d > 180) d -= 360
      while (d < -180) d += 360
      r.headingTotal += Math.abs(d)
    }
    prevHeading = heading
    const alt = self.state.position.y
    const tas = self.diag.aero.tas * 3.6
    if (alt < r.altMin) r.altMin = alt
    if (alt > r.altMax) r.altMax = alt
    if (tas < r.tasMin) r.tasMin = tas
    if (tas > r.tasMax) r.tasMax = tas
    const vel = self.state.velocity
    const sp = vel.length()
    const gamma = sp > 1e-3 ? Math.asin(Math.max(-1, Math.min(1, vel.y / sp))) : 0
    if (gamma > 10 / RAD && sign !== 1) { if (sign === -1) r.flips++; sign = 1 }
    else if (gamma < -10 / RAD && sign !== -1) { if (sign === 1) r.flips++; sign = -1 }
  }
  r.straightness = path > 1
    ? Math.hypot(self.state.position.x - startPos.x, self.state.position.z - startPos.z) / path
    : 1
  r.safetyShare = safety / Math.max(r.samples, 1)
  console.log(
    `${name.padEnd(28)} 高度 ${r.altMin.toFixed(0)}–${r.altMax.toFixed(0)} m`
    + `（擺幅 ${(r.altMax - r.altMin).toFixed(0)}）`
    + `　TAS ${r.tasMin.toFixed(0)}–${r.tasMax.toFixed(0)} km/h`
    + `　翻轉 ${r.flips}`
    + `　累計轉向 ${r.headingTotal.toFixed(0)}°`
    + `　直線度 ${r.straightness.toFixed(3)}`
    + `　安全層 ${(r.safetyShare * 100).toFixed(0)}%`,
  )
  return r
}

console.log(`P-51D（套 GAME_FEEL）4000 m 起始 150 m/s，角落速度 ${cornerSpeed(SPEC, 4000).toFixed(0)} m/s`)
console.log(`${SECONDS} 秒，跳過前 10 秒暫態\n`)

run('一、無目標、水平起始', null)
run('一b、無目標、坡度 30°', null, 30, 0)
run('一c、無目標、坡度 60°', null, 60, 0)
run('一d、無目標、仰角 20°', null, 0, 20)
run('一e、無目標、坡度 45° 仰角 15°', null, 45, 15)
run('二、目標同高、正前方 3 km', new Vector3(0, 0, -3000))
run('三、目標高 1000 m、3 km', new Vector3(0, 1000, -3000))
run('四、目標低 1000 m、3 km', new Vector3(0, -1000, -3000))
run('五、目標同高、只有 800 m', new Vector3(0, 0, -800))
