import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fillGunHeatHud } from '../../src/app/battleFlightHud'
import { GUN_HEAT_BLINK_HZ, createGunHeat } from '../../src/control/gunHeat'
import { createHudFrame } from '../../src/hud/types'

/** 前機槍熱度 → HUD 幀（SPEC `2026-10-08-gun-overheat-design.md`） */
describe('熱度寫進 HUD', () => {
  it('照熱度給冷／熱／過熱；不在座位上（代飛、上帝視角）恆為冷', () => {
    const f = createHudFrame()
    const h = createGunHeat()
    fillGunHeatHud(f, h, false, 0)
    expect(f.gunHeat).toBe('cool')
    h.warn = true
    fillGunHeatHud(f, h, false, 0)
    expect(f.gunHeat).toBe('warn')
    h.locked = true
    fillGunHeatHud(f, h, false, 0)
    expect(f.gunHeat).toBe('hot')
    fillGunHeatHud(f, h, true, 0)
    expect(f.gunHeat).toBe('cool')
  })

  it('閃爍每秒 4 次：每 1/8 秒亮暗互換', () => {
    expect(GUN_HEAT_BLINK_HZ).toBe(4)
    const f = createHudFrame()
    const h = createGunHeat()
    h.locked = true
    const states: boolean[] = []
    for (const t of [0.01, 0.13, 0.26, 0.38]) {
      fillGunHeatHud(f, h, false, t)
      states.push(f.gunHeatBlink)
    }
    expect(states).toEqual([true, false, true, false])
  })

  it('updateBattleFlightHud 接上：用玩家控制器的熱度、代飛或上帝視角算離手、時間用物理時間', () => {
    const src = readFileSync('src/app/battleFlightHud.ts', 'utf8')
    expect(src).toContain('fillGunHeatHud(hudFrame, playerController.gunHeat, input.playerAi || input.godView, battle.world.time)')
    expect(readFileSync('src/main.ts', 'utf8')).toMatch(/const battleFlightHudDeps: BattleFlightHudDependencies = \{[^}]*playerController,/)
  })
})
