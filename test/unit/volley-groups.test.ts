import { describe, expect, it } from 'vitest'
import { buildVolleyGroups } from '../../src/audio/volleyGroups'
import type { Combatant } from '../../src/world/combatant'

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

  it('不超過呼叫端給的分組容量', () => {
    expect(buildVolleyGroups(player(), 1).groups).toHaveLength(0)
  })
})
