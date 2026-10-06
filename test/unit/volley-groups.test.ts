import { describe, expect, it } from 'vitest'
import { buildVolleyGroups } from '../../src/audio/volleyGroups'
import type { Combatant } from '../../src/world/combatant'

function player(): Combatant {
  return { aircraft: { spec: { battery: { mounts: [] }, turrets: [] } } } as unknown as Combatant
}

describe('audio volley groups', () => {
  it('groups repeated weapon mounts once and keeps the rear-turret flag explicit', () => {
    const result = buildVolleyGroups(player())
    expect(result.groups).toEqual([])
    expect(result.groups.every(g => g.mount >= 0 || g.turret >= 0)).toBe(true)
    expect(result.ownTurretVolley).toBe(false)
  })

  it('does not exceed the caller supplied group capacity', () => {
    expect(buildVolleyGroups(player(), 1).groups).toHaveLength(0)
  })
})
