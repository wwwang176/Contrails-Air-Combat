/**
 * 「敵機就在正前方下方，AI 為什麼不低頭瞄」的複現。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/nose-bias.probe.ts
 *
 * 【人工回報】用 109 按 I 交給 AI 代飛，敵機在正前方約 150 m、
 * 預瞄點在下方約 15°，我機沒有低頭；敵機爬升、預瞄點縮到 5°，仍然沒有低頭。
 *
 * 【靜態讀出來的嫌疑犯】`steerCommand` 的戰術偏好層是
 * `applyPitchBias(sit.sweetPitch, out.aimWorld)` —— 甜蜜區偏置，把命令的
 * **航跡角**整個加一個角度、方位不動。它只看機種對、高度、空速，**完全不看
 * 距離、不看瞄準誤差、不看有沒有射擊解**。
 *
 * 109 對 P-51 的偏置（`doctrine.ts`，套 GAME_FEEL）：
 *
 *   4000 m   350 km/h → 0°     400 → +3.8°   450 → +7.9°   500 以上 → +10°
 *   2000 m   350 km/h → +4.8°  400 以上 → +10°
 *
 * 正號 = 抬頭。理由是 109 的甜蜜區在 350 km/h 附近，飛太快時該用高度換
 * 迴旋率。方向本身有道理，問題是**它沒有讓位機制**。
 *
 * 【算出來的平衡點】命令航跡角 = −(下瞄角 × 拉桿係數) + 偏置。偏置 +10° 時
 * 下瞄角要 10° 以上命令才是負的 —— 也就是 **AI 的機首會穩定停在目標線上方
 * 約 10°，低於 10° 的下瞄需求被完全吃掉甚至反向**。與人工回報逐項吻合。
 *
 * 【這支要驗的那一個假設】上面的推論成立的前提是「當時 109 夠快」。空速
 * 300 km/h 時偏置是 0，推論就不成立。這支把場景照人工回報擺出來，直接印
 * 每格的空速、偏置、機首相對預瞄點的仰角。
 */
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { DEFAULT_DOCTRINE, energyPull, manoeuvreSpeed, sweetSpotPitch } from '../../src/ai/doctrine'
import { VETERAN } from '../../src/ai/profile'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, GAME_FEEL } from '../../src/specs/feel'
import { RAD } from '../../src/core/math'
import type { Command, Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240
const FWD = new Vector3(0, 0, -1)

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const ME: AircraftSpec = { ...applyFeel(BF109K4, GAME_FEEL) }
const FOE: AircraftSpec = { ...applyFeel(P51D, GAME_FEEL) }
const ME_BLUNT: AircraftSpec = { ...ME, battery: harmless(ME.battery) }
const FOE_BLUNT: AircraftSpec = { ...FOE, battery: harmless(FOE.battery) }

/** 敵機：直飛或穩定爬升，不開火。人工回報說它在爬。 */
class Climber implements Controller {
  constructor(private readonly pitch: number) {}
  private readonly aim = new Vector3()
  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    const v = self.state.velocity
    const horiz = Math.hypot(v.x, v.z)
    if (horiz < 1e-6) { out.aimWorld.copy(FWD); return }
    const c = Math.cos(this.pitch) / horiz
    this.aim.set(v.x * c, Math.sin(this.pitch), v.z * c)
    out.aimWorld.copy(this.aim)
  }
}

/**
 * @param dropDeg 預瞄點在我機首下方幾度（開局）
 * @param tasKmh  我機開局空速
 * @param foePitchDeg 敵機的爬升角
 */
function run(dropDeg: number, tasKmh: number, foePitchDeg: number, seconds: number): void {
  const alt = 4000
  const range = 150
  const tas = tasKmh / 3.6
  const world = new World()
  const me = new Aircraft(ME_BLUNT, alt, tas)
  const foe = new Aircraft(FOE_BLUNT, alt, tas)

  // 我在原點平飛；敵機在正前方 range，下方 range·tan(drop)
  const drop = dropDeg * (Math.PI / 180)
  const mePos = new Vector3(0, alt, 0)
  const foePos = new Vector3(0, alt - range * Math.tan(drop), -range * Math.cos(drop))
  const foeCourse = new Vector3(0, Math.sin(foePitchDeg * (Math.PI / 180)), 0)
  foeCourse.z = -Math.cos(foePitchDeg * (Math.PI / 180))
  for (const [a, p, c] of [[me, mePos, FWD], [foe, foePos, foeCourse]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(c).normalize().multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(FWD, c.clone().normalize())
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const mc = world.add(me, ai, 'blue', mePos, alt, tas)
  const fc = world.add(foe, new Climber(foePitchDeg * (Math.PI / 180)), 'red', foePos, alt, tas)
  for (const c of [mc, fc]) c.respawnOnDestroy = false
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = mc.index
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const lead = new Vector3()
  const nose = new Vector3()

  console.log(`
══ 開局：預瞄點在下方 ${dropDeg}°、我機 ${tasKmh} km/h、敵機爬升 ${foePitchDeg}° ══`)
  console.log('   t    我空速   甜蜜區偏置  拉桿係數   預瞄點在機首下方   我的航跡角   意圖/模式')
  for (let s = 0; s <= seconds * 240; s++) {
    if (s % 60 === 0) {
      buildEngageBasis(me, foe, basis)
      lead.copy(basis.leadPoint).normalize()
      nose.copy(FWD).applyQuaternion(me.state.orientation)
      // 「下方幾度」= 機首航跡角 − 預瞄方向航跡角
      const nosePitch = Math.asin(Math.max(-1, Math.min(1, nose.y))) * RAD
      const leadPitch = Math.asin(Math.max(-1, Math.min(1, lead.y))) * RAD
      const selfTas = me.state.velocity.length()
      const sweet = sweetSpotPitch(me.spec, foe.spec, me.state.position.y, selfTas, DEFAULT_DOCTRINE)
      const pull = energyPull(
        selfTas / manoeuvreSpeed(me.spec, me.state.position.y, DEFAULT_DOCTRINE),
        DEFAULT_DOCTRINE,
      )
      console.log(
        `${(s * DT).toFixed(2).padStart(6)}`
        + `${(selfTas * 3.6).toFixed(0).padStart(8)}`
        + `${(sweet * RAD).toFixed(1).padStart(12)}°`
        + `${pull.toFixed(2).padStart(11)}`
        + `${(nosePitch - leadPitch).toFixed(1).padStart(17)}°`
        + `${nosePitch.toFixed(1).padStart(13)}°`
        + `   ${ai.intent}/${ai.mode}`,
      )
    }
    world.step(DT)
    if (!mc.alive || !fc.alive) { console.log('  （有人掛了，停）'); break }
  }
}

// 人工回報的兩個瞬間
run(15, 500, 10, 6)
run(5, 500, 10, 6)
// 對照：同樣的幾何，但慢速（偏置應為 0）
run(15, 320, 10, 6)
