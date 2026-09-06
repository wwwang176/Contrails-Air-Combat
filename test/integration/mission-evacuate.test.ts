/**
 * **撤離任務真的打得完，而且時限真的生效。**
 *
 * 【為什麼要消融】只斷言「不飛就輸」的話，若時限根本沒接上、輸的原因其實是
 * 被打死，這支測試仍然全綠。所以：雙方的槍都改成不痛，然後
 *
 *   有限時限 → 必須 `defeat`、`secondsLeft <= 0`、藍隊還有人、玩家還在圈外
 *   Infinity  → 跑同樣的時長必須仍然是 `fighting`
 *
 * 這四加二條合起來說的是「**它是因為時限到了才輸的**」，而不只是「它輸了」。
 */
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import type { Battery } from '../../src/weapons/types'
import { readyCard, KILL_CARD } from '../fixtures/mission'
import type { ReadyMissionCard } from '../../src/battle/missions'

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
 * 撤離點然後判 victory，那條「超時落敗」的測試會量到完全相反的東西。
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

/**
 * 一張撤離卡。**自己建，不從 `MISSIONS` 找。**
 *
 * 【為什麼】12 關裡沒有撤離卡 —— 那個玩法的使用者是德 M4 的返航節拍。
 * 但撤離的判定還在，而且正是德 M4 靠的那一條，所以它仍然要驗。從卡表找的話
 * 這一份會跟著關卡設計一起漂。數字沿用 `evacuate.probe.ts` 掃描出來的那一組。
 */
const CARD: ReadyMissionCard = (() => {
  const kill = readyCard(KILL_CARD).battle
  return {
    id: 'test-evac', title: '測試用撤離', type: '撤離', summary: '',
    place: '測試', period: '測試',
    battle: {
      objective: '飛抵撤離點',
      blueSpec: kill.blueSpec, redSpec: kill.redSpec, convoySpec: null,
      blueCount: 4, redCount: 16, convoyCount: 0, convoyPriority: 1,
      targetDistance: 20000, targetRadius: 1000, seconds: 176,
      entry: 'pursuit', terrain: 'archipelago',
    },
  }
})()

function evacPoint(): Vector3 {
  const rules = missionConfigFrom(CARD).rules
  if (rules.kind !== 'evacuate') throw new Error('撤離卡的 rules 應為 evacuate')
  return rules.point
}

function targetRadius(): number {
  const rules = missionConfigFrom(CARD).rules
  if (rules.kind !== 'evacuate') throw new Error('撤離卡的 rules 應為 evacuate')
  return rules.radius
}

function run(controller: Controller, seconds: number, limit?: number) {
  const base = missionConfigFrom(CARD)
  const rules = base.rules.kind === 'evacuate' && limit !== undefined
    ? { ...base.rules, seconds: limit }
    : base.rules
  const b = createBattle(controller, {
    ...base,
    rules,
    // 【逐架把槍拆掉】不能只換 `blueSpec` / `redSpec` 兩個欄位，要掃過每一個
    // 小隊的每一架。**混編也照樣正確** —— 每一種機各自被換成自己的無害
    // 版本，而不是整隊被壓成同一台
    units: base.units.map((u) => ({
      ...u,
      members: u.members.map((m) => ({ ...m, battery: harmless(m.battery) })),
    })),
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
    const b = run(new Runner(evacPoint()), CARD.battle.seconds)
    console.log(
      `[撤離] 直飛：${b.outcome}　剩餘 ${b.mission.secondsLeft.toFixed(1)} s`
      + `　距離 ${b.mission.metric.toFixed(0)} m　我方剩 ${aliveBlue(b)}/${CARD.battle.blueCount}`,
    )
    expect(b.outcome).toBe('victory')
    expect(b.mission.secondsLeft).toBeGreaterThan(0)
  })

  /**
   * 【四條斷言缺一不可】只斷言 `defeat` 的話，任何原因的落敗都算通過。
   * 這四條合起來說的是「**它是因為時限到了才輸的**」。
   */
  it('反方向飛 → 時限歸零 → defeat（而且不是被打死的）', () => {
    const b = run(new Away(), CARD.battle.seconds + 5)
    console.log(
      `[撤離] 反向：${b.outcome}　剩餘 ${b.mission.secondsLeft.toFixed(1)} s`
      + `　距離 ${b.mission.metric.toFixed(0)} m　我方剩 ${aliveBlue(b)}/${CARD.battle.blueCount}`,
    )
    expect(b.outcome).toBe('defeat')
    expect(b.mission.secondsLeft).toBeLessThanOrEqual(0)
    expect(aliveBlue(b), '不得是被全滅輸的').toBeGreaterThan(0)
    expect(b.mission.metric, '玩家必須還在圈外').toBeGreaterThan(targetRadius())
  })

  /**
   * ★ **消融：拿掉時限，上一條必須不再成立。**
   *
   * 【為什麼斷言 `fighting` 而不是「若 defeat 則全滅」】後者在時限沒接上時
   * 也成立。槍已經不痛了，所以跑完同樣的時長之後唯一正確的結果就是還在打。
   */
  it('把時限設成 Infinity 之後，同樣的跑法仍然是 fighting', () => {
    const b = run(new Away(), CARD.battle.seconds + 5, Infinity)
    console.log(
      `[撤離] 消融：${b.outcome}　剩餘 ${b.mission.secondsLeft}`
      + `　我方剩 ${aliveBlue(b)}/${CARD.battle.blueCount}`,
    )
    expect(b.mission.secondsLeft).toBe(Infinity)
    expect(b.outcome).toBe('fighting')
    expect(aliveBlue(b)).toBeGreaterThan(0)
  })
}, 10 * 60 * 1000)
