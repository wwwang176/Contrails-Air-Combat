import { describe, expect, it } from 'vitest'
import { buildVolleyGroups } from '../../src/audio/volleyGroups'
import type { Combatant } from '../../src/world/combatant'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { A6M5 } from '../../src/specs/a6m5'

function player(): Combatant {
  return { aircraft: { spec: { battery: { mounts: [] }, turrets: [] } } } as unknown as Combatant
}

describe('齊射音效的分組', () => {
  it('重複的武器掛點只分一組，後座砲塔的旗標明確給值', () => {
    const result = buildVolleyGroups(player())
    expect(result.groups).toEqual([])
    expect(result.groups.every(g => g.mount >= 0 || g.turret >= 0)).toBe(true)
    expect(result.ownTurretVolley).toBe(false)
  })

  it('每一組帶上齊射庫的音量修正', () => {
    const groups = buildVolleyGroups({ aircraft: new Aircraft(A6M5) }).groups
    expect(groups.find(g => g.pool === 'volley-type97x2')!.db).toBe(-3)
    expect(groups.find(g => g.pool === 'volley-type99-2x2')!.db).toBe(0)
  })

  it('不超過呼叫端給的分組容量', () => {
    expect(buildVolleyGroups(player(), 1).groups).toHaveLength(0)
  })
})
