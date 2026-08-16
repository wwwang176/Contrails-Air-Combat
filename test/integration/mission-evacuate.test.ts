/**
 * **撤離任務真的打得完，而且時限真的生效。**
 *
 * 【為什麼要消融】只斷言「不飛就輸」的話，若時限根本沒接上、輸的原因其實是
 * 被打死，這支測試仍然全綠。所以：雙方的槍都改成不痛，然後
 *
 *   有限時限 → 必須 `defeat`、`secondsLeft <= 0`、藍隊還有人、玩家還在圈外
 *   Infinity  → 跑同樣的時長必須仍然是 `fighting`
 *
 * 這四加二條合起來說的是「**它是因為時限到了才輸的**」，而不只是「它輸了」
 * （Codex 審查 2026-08-16）。
 */
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240

/** 一路朝撤離點飛，不開火 */
class Runner implements Controller {
  constructor(private readonly point: Vector3) {}
  private readonly aim = new Vector3()
  update(self: Aircraft, _dt: number, out: Command): void {
    out.throttle = WEP_THROTTLE
    out.brake = 0
    out.firing = false
    this.aim.copy(this.point).sub(self.state.position).normalize()
    out.aimWorld.copy(this.aim)
  }
}

/**
 * 往**反方向**平飛，永遠到不了撤離點。
 *
 * 【為什麼不是「維持現在的航向」】藍隊出生時機首朝 −Z（`setup.ts` 的
 * `createBattle`），而撤離點也在 −Z —— 一個「維持航向」的控制器會直飛
 * 撤離點然後判 victory，那條「超時落敗」的測試會量到完全相反的東西
 * （Codex 審查 2026-08-16）。
 *
 * 【為什麼一定要水平】`World.crashPolicy` 的預設是 `SEA_LEVEL`，無頭環境
 * 一樣會撞海。開局在 4,000 m 平飛才不會在中途墜海把「還有人活著」那條
 * 斷言弄紅 —— 而那會讓紅色的原因指向錯的地方。
 */
class Away implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.6
    out.brake = 0
    out.firing = false
    out.aimWorld.set(0, 0, 1)
  }
}

/**
 * 讓一支槍不痛。
 *
 * 【為什麼一定要】不隔離戰損的話，「超時落敗」與「被打死落敗」在
 * `outcome === 'defeat'` 上長得一模一樣。前例：`ai-shot-yield.test.ts`。
 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}

const CARD = MISSIONS.allies.find((c) => c.type === '撤離')!

function evacPoint(): Vector3 {
  const rules = missionConfigFrom(CARD, 'allies').rules
  if (rules.kind !== 'evacuate') throw new Error('撤離卡的 rules 應為 evacuate')
  return rules.point
}

function evacRadius(): number {
  const rules = missionConfigFrom(CARD, 'allies').rules
  if (rules.kind !== 'evacuate') throw new Error('撤離卡的 rules 應為 evacuate')
  return rules.radius
}

function run(controller: Controller, seconds: number, limit?: number) {
  const base = missionConfigFrom(CARD, 'allies')
  const rules = base.rules.kind === 'evacuate' && limit !== undefined
    ? { ...base.rules, seconds: limit }
    : base.rules
  const b = createBattle(controller, {
    ...base,
    rules,
    blueSpec: { ...base.blueSpec, battery: harmless(base.blueSpec.battery) },
    redSpec: { ...base.redSpec, battery: harmless(base.redSpec.battery) },
  })
  const steps = Math.round(seconds * 240)
  for (let i = 0; i < steps; i++) {
    stepBattle(b, DT)
    if (b.outcome !== 'fighting') break
  }
  return b
}

function aliveBlue(b: ReturnType<typeof run>): number {
  return b.blue.filter((c) => c.alive).length
}

describe('撤離任務', () => {
  it('直飛撤離點 → victory，而且時限還有剩', () => {
    const b = run(new Runner(evacPoint()), CARD.seconds)
    console.log(
      `[撤離] 直飛：${b.outcome}　剩餘 ${b.mission.secondsLeft.toFixed(1)} s`
      + `　距離 ${b.mission.metric.toFixed(0)} m　我方剩 ${aliveBlue(b)}/${CARD.blueCount}`,
    )
    expect(b.outcome).toBe('victory')
    expect(b.mission.secondsLeft).toBeGreaterThan(0)
  })

  /**
   * 【四條斷言缺一不可】只斷言 `defeat` 的話，任何原因的落敗都算通過。
   * 這四條合起來說的是「**它是因為時限到了才輸的**」。
   */
  it('反方向飛 → 時限歸零 → defeat（而且不是被打死的）', () => {
    const b = run(new Away(), CARD.seconds + 5)
    console.log(
      `[撤離] 反向：${b.outcome}　剩餘 ${b.mission.secondsLeft.toFixed(1)} s`
      + `　距離 ${b.mission.metric.toFixed(0)} m　我方剩 ${aliveBlue(b)}/${CARD.blueCount}`,
    )
    expect(b.outcome).toBe('defeat')
    expect(b.mission.secondsLeft).toBeLessThanOrEqual(0)
    expect(aliveBlue(b), '不得是被全滅輸的').toBeGreaterThan(0)
    expect(b.mission.metric, '玩家必須還在圈外').toBeGreaterThan(evacRadius())
  })

  /**
   * ★ **消融：拿掉時限，上一條必須不再成立。**
   *
   * 【為什麼斷言 `fighting` 而不是「若 defeat 則全滅」】後者在時限沒接上時
   * 也成立。槍已經不痛了，所以跑完同樣的時長之後唯一正確的結果就是還在打。
   */
  it('把時限設成 Infinity 之後，同樣的跑法仍然是 fighting', () => {
    const b = run(new Away(), CARD.seconds + 5, Infinity)
    console.log(
      `[撤離] 消融：${b.outcome}　剩餘 ${b.mission.secondsLeft}`
      + `　我方剩 ${aliveBlue(b)}/${CARD.blueCount}`,
    )
    expect(b.mission.secondsLeft).toBe(Infinity)
    expect(b.outcome).toBe('fighting')
    expect(aliveBlue(b)).toBeGreaterThan(0)
  })
}, 10 * 60 * 1000)
