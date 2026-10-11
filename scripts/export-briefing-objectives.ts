/** Export public opening/objective information for authoring briefing charts. */
import { writeFileSync } from 'node:fs'
import { MISSIONS, missionConfigFrom } from '../src/battle/missions'

const result = Object.values(MISSIONS).flat().filter(c => c.battle !== null).map(card => {
  const config = missionConfigFrom(card as Parameters<typeof missionConfigFrom>[0])
  return { id: card.id, rules: config.rules, fleet: card.battle?.fleet?.ships.map(s => ({ cls: s.cls, team: s.team })),
    ground: config.ground?.filter(g => !g.hidden && g.killAt !== 0),
  }
})
writeFileSync('public/ui/maps/reference/objectives.json', JSON.stringify(result, null, 2))
