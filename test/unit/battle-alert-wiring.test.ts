import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 警戒機制的接線護欄 —— **讀原始碼**，寫法同 `audio-wiring.test.ts`。
 * 小部件各自有單元測試；這裡守的是「有沒有接上、順序對不對」，那種壞法不會報錯。
 */
const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')
const WORLD = read('src/world/World.ts')
const RUNTIME = read('src/battle/battleRuntime.ts')
const CREATE = read('src/battle/createBattle.ts')

describe('警戒接進戰鬥', () => {
  /** 【排在命令層之前】同一步觸發，同一步就把紅方交回指揮官；排在後面會多巡邏一步 */
  it('stepBattle：stepAlert 在 stepBeats 之後、stepCommandLayer 之前', () => {
    const step = RUNTIME.slice(RUNTIME.indexOf('export function stepBattle('), RUNTIME.indexOf('export function resetBattle('))
    const at = step.indexOf('stepAlert(b, dt)')
    expect(at).toBeGreaterThan(step.indexOf('stepBeats(b)'))
    expect(at).toBeLessThan(step.indexOf('stepCommandLayer(b, dt)'))
  })

  /** 【排在 wireStations 之後】它會重接站位參考 */
  it('createBattle：有警戒才停火並先發巡邏令，排在 wireStations 之後', () => {
    expect(CREATE).toMatch(/wireStations\(battle\)\n[\s\S]*if \(battle\.alert !== null\) \{\n\s+world\.holdFire\.fill\(1\)\n\s+armPatrol\(battle\)/)
  })
})

describe('停火旗標接進 World.step', () => {
  /**
   * 【三個呼叫點都要傳】參數省略時預設不停火 —— 少傳任何一處，那一種武器會靜靜地照常開火，
   * 而直接測 `stepTurrets`／`stepGunPlatform` 的測試仍然是綠的
   */
  it('砲塔、船、地面砲位都依自己的隊別傳停火旗標', () => {
    expect(WORLD).toMatch(
      /stepTurrets\(\s*c, this\.combatants, this\.projectiles, this\.time, dt, this\.land, this\.ships,\s*this\.holdFire\[teamSlot\(c\.team\)\] === 1,?\s*\)/)
    expect(WORLD).toMatch(
      /stepGunPlatform\(\s*s, this\.combatants, this\.projectiles, this\.flak, this\.time, dt, this\.ships,\s*this\.holdFire\[teamSlot\(s\.team\)\] === 1,?\s*\)/)
    expect(WORLD).toMatch(
      /stepGunPlatform\(\s*t, this\.combatants, this\.projectiles, this\.flak, this\.time, dt, this\.groundTargets,\s*this\.holdFire\[teamSlot\(t\.team\)\] === 1,?\s*\)/)
  })
})
