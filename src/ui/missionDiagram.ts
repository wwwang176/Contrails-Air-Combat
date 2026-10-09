import { missionConfigFrom, type ReadyMissionCard } from '../battle/missions'
import { t, type MessageKey } from '../i18n'
import { missionArtwork } from './missionArtwork'
import { escapeHtml } from './menuOptions'
import { renderMissionLayers } from './missionLayers'

type Target = 'arrival' | 'aircraft' | 'ground' | 'ships' | 'convoy' | 'exit' | 'defend'

/** Use the actual victory rule, not the broad menu category (strike can mean
 * ships, buildings or a supply convoy). No hidden waves or trigger times leak
 * into the briefing. The drawing is explicitly a schematic, not world positions. */
export function diagramTarget(card: ReadyMissionCard): Target {
  const rule = missionConfigFrom(card).rules
  switch (rule.kind) {
    case 'sink': return 'ships'
    case 'destroy': return 'ground'
    case 'interdict': return 'convoy'
    case 'defend': return 'defend'
    case 'evacuate': return 'exit'
    case 'convoy': return rule.owner === 'blue' ? 'arrival' : 'aircraft'
    default: return 'aircraft'
  }
}

const TARGET_KEY: Record<Target, MessageKey> = {
  arrival: 'brief.map.arrival', aircraft: 'brief.map.aircraft', ground: 'brief.map.ground',
  ships: 'brief.map.ships', convoy: 'brief.map.convoy', exit: 'brief.map.exit', defend: 'brief.map.defend',
}
/** Pre-battle briefing with independently editable terrain, unit and cloud
 * layers. Review adjustments do not overwrite the approved baked artwork. */
export function renderMissionDiagram(card: ReadyMissionCard): string {
  const target = diagramTarget(card)
  const art = missionArtwork(card.id)
  const targetText = escapeHtml(t(TARGET_KEY[target]))
  const place = escapeHtml(t(card.placeKey))
  return `<figure class="mission-map dossier-paper" data-target="${target}">
    <figcaption><span>${place}</span></figcaption>
    ${art ? renderMissionLayers(card.id, art, `${t(card.placeKey)} / ${t(card.summaryKey)}`) : `<div class="map-drawing map-unavailable" role="img" aria-label="${place}">${targetText}</div>`}
    <div class="map-legend"><span class="map-legend-side"><i class="map-legend-line"></i>${escapeHtml(t('side.mine'))}</span><span class="map-legend-side"><i class="map-legend-line map-legend-foe"></i>${escapeHtml(t('side.foe'))}</span><span>${targetText}</span></div>
  </figure>`
}
