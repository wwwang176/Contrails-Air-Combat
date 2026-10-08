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

describe('還沒警戒的敵方在 HUD 上是黃色', () => {
  /** 【四處都要傳】少傳一處，那一種標示仍然是紅的，而 `contactColor` 自己的測試照樣綠 */
  it('目標框、船的標記、小地圖、上帝視角的標記都把 enemyUnaware 傳給顏色', () => {
    expect(read('src/hud/widgets/contacts.ts')).toContain('contactColor(c.hostile, c.flightMate, f.enemyUnaware)')
    expect(read('src/hud/widgets/markers.ts')).toContain('contactColor(m.hostile, false, f.enemyUnaware)')
    expect(read('src/hud/widgets/minimap.ts')).toContain('contactColor(c.hostile, c.flightMate, f.enemyUnaware)')
    expect(read('src/hud/widgets/godMarkers.ts')).toContain('godMarkerColor(c.hostile, f.enemyUnaware)')
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
