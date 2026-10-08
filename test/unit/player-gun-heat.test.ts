import { describe, it, expect } from 'vitest'
import { createCommand } from '../../src/control/Controller'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import { G4M } from '../../src/specs/g4m'
import { BF109K4 } from '../../src/specs/bf109k4'

/** 玩家前機槍過熱（SPEC `2026-10-08-gun-overheat-design.md`）：PlayerController 那一段 */
const DT = 1 / 240

function setup(spec = P51D) {
  const input = createInputState()
  const pc = new PlayerController(input)
  const out = createCommand()
  const plane = new Aircraft(spec)
  const run = (seconds: number, self = plane): void => {
    for (let i = 0; i < Math.round(seconds / DT); i++) pc.update(self, DT, out)
  }
  return { input, pc, out, plane, run }
}

describe('玩家前機槍過熱', () => {
  it('按住 6 秒過熱：打不出去、而且算在空響；一直按著不恢復；放開冷卻約 2 秒回到能開火', () => {
    const s = setup()
    s.input.firing = true
    s.run(5.9)
    expect(s.out.firing).toBe(true)
    expect(s.pc.dryFiring).toBe(false)
    s.run(0.2)
    expect(s.pc.gunHeat.locked).toBe(true)
    expect(s.out.firing).toBe(false)
    expect(s.pc.dryFiring).toBe(true)
    s.run(5)
    expect(s.pc.gunHeat.heat).toBe(1)
    s.input.firing = false
    s.run(0.5)
    expect(s.pc.dryFiring).toBe(false)
    s.run(1.6)
    s.input.firing = true
    s.run(DT)
    expect(s.out.firing).toBe(true)
  })

  it('秒數看機型：K-4 四秒就過熱', () => {
    const s = setup(BF109K4)
    s.input.firing = true
    s.run(4.05)
    expect(s.pc.gunHeat.locked).toBe(true)
  })

  /** 【快過熱】黃色而且還在開火：槍機聲疊在槍聲上（`warmFiring`）；綠色、過熱、放開都不算 */
  it('黃色而且按著扳機時才算快過熱；過熱後換成空響', () => {
    const s = setup()
    s.input.firing = true
    s.run(3)
    expect(s.pc.warmFiring).toBe(false)
    s.run(1)
    expect(s.pc.gunHeat.warn).toBe(true)
    expect(s.pc.warmFiring).toBe(true)
    s.input.firing = false
    s.run(DT)
    expect(s.pc.warmFiring).toBe(false)
    s.input.firing = true
    s.run(2.1)
    expect(s.pc.gunHeat.locked).toBe(true)
    expect(s.pc.warmFiring).toBe(false)
    expect(s.pc.dryFiring).toBe(true)
  })

  it('離手與重設都清掉快過熱', () => {
    const s = setup()
    s.input.firing = true
    s.run(4)
    expect(s.pc.warmFiring).toBe(true)
    s.pc.coolWhileAway(1 / 60)
    expect(s.pc.warmFiring).toBe(false)
    s.run(DT)
    expect(s.pc.warmFiring).toBe(true)
    s.pc.resetGunHeatState()
    expect(s.pc.warmFiring).toBe(false)
  })

  /** 【沒有前射武器不加熱】G4M 的機首槍屬於砲塔，扣扳機打不出東西 */
  it('沒有前射武器的機種不加熱、不空響', () => {
    const s = setup(G4M)
    s.input.firing = true
    s.run(5)
    expect(s.pc.gunHeat.heat).toBe(0)
    expect(s.pc.dryFiring).toBe(false)
  })

  it('投彈視角的左鍵不是扳機，不加熱', () => {
    const s = setup()
    s.input.firing = true
    s.input.viewMode = 'bomb'
    s.run(5)
    expect(s.pc.gunHeat.heat).toBe(0)
  })

  /** 【接手僚機】操縱的飛機換了，上一架的熱度不帶過去 */
  it('換了一架飛機就歸零', () => {
    const s = setup()
    s.input.firing = true
    s.run(6.1)
    expect(s.pc.gunHeat.locked).toBe(true)
    s.run(DT, new Aircraft(P51D))
    expect(s.pc.gunHeat.locked).toBe(false)
    expect(s.out.firing).toBe(true)
  })

  /** 【跨過門檻那一步】開火、鎖住、空響要用同一步的狀態：鎖住的那一步就不開火 */
  it('到達過熱的那一步不開火，而且只有在鎖住時才算空響', () => {
    const s = setup()
    s.input.firing = true
    for (let i = 0; i < 2000; i++) {
      s.pc.update(s.plane, DT, s.out)
      if (s.pc.gunHeat.locked) {
        expect(s.out.firing).toBe(false)
        expect(s.pc.dryFiring).toBe(true)
        return
      }
      expect(s.out.firing).toBe(true)
      expect(s.pc.dryFiring).toBe(false)
    }
    throw new Error('沒有過熱')
  })

  /** 【代飛、上帝視角】控制器換掉時 update 不會被呼叫，熱度由外面照實際時間冷卻，空響停掉 */
  it('離手時照時間冷卻、空響停掉', () => {
    const s = setup()
    s.input.firing = true
    s.run(6.1)
    expect(s.pc.dryFiring).toBe(true)
    s.pc.coolWhileAway(1)
    expect(s.pc.dryFiring).toBe(false)
    expect(s.pc.gunHeat.locked).toBe(true)
    s.pc.coolWhileAway(1.1)
    expect(s.pc.gunHeat.locked).toBe(false)
  })

  it('resetGunHeatState 歸零', () => {
    const s = setup()
    s.input.firing = true
    s.run(6.1)
    s.pc.resetGunHeatState()
    expect(s.pc.gunHeat.heat).toBe(0)
    expect(s.pc.gunHeat.locked).toBe(false)
    expect(s.pc.dryFiring).toBe(false)
  })
})
