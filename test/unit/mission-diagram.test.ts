import { afterEach, describe, expect, it } from 'vitest'
import { MISSIONS, type ReadyMissionCard } from '../../src/battle/missions'
import { setLang, t } from '../../src/i18n'
import { diagramTarget, renderMissionDiagram } from '../../src/ui/missionDiagram'
import { missionArtwork } from '../../src/ui/missionArtwork'
import { existsSync } from 'node:fs'

const cards = Object.values(MISSIONS).flat().filter((c): c is ReadyMissionCard => c.battle !== null)
const card = (id: string): ReadyMissionCard => {
  const result = cards.find(c => c.id === id)
  if (!result) throw new Error(`Missing mission: ${id}`)
  return result
}
afterEach(() => setLang('zh'))

describe('mission diagram follows the actual objective', () => {
  it('ships a dedicated tactical illustration for every mission', () => {
    const paths = new Set<string>()
    for (const c of cards) {
      const art = missionArtwork(c.id)
      expect(art, c.id).toBeDefined()
      expect(existsSync(`public${art}`)).toBe(true)
      expect(renderMissionDiagram(c)).toContain(art!.slice(1))
      paths.add(art!)
    }
    expect(paths.size).toBe(cards.length)
  })
  it('distinguishes a protected fleet from an enemy fleet', () => {
    expect(diagramTarget(card('allies-m3'))).toBe('defend')
    expect(diagramTarget(card('japan-m3'))).toBe('ships')
  })
  it('distinguishes ground strikes from supply interdiction', () => {
    expect(diagramTarget(card('allies-m2'))).toBe('ground')
    expect(diagramTarget(card('japan-m2'))).toBe('convoy')
  })
  it('distinguishes escort destinations from bomber interceptions', () => {
    expect(diagramTarget(card('allies-m1'))).toBe('arrival')
    expect(diagramTarget(card('germany-m1'))).toBe('aircraft')
  })
  it('renders every playable mission in both languages with its own area', () => {
    for (const lang of ['zh', 'en'] as const) {
      setLang(lang)
      for (const c of cards) {
        const html = renderMissionDiagram(c)
        expect(html).toContain(t(c.placeKey))
        expect(html).toContain('role="img"')
        expect(html).not.toContain('undefined')
      }
    }
  })
  it('does not reveal future reinforcement/withdrawal triggers', () => {
    const c = card('allies-m1')
    const modified: ReadyMissionCard = { ...c, battle: { ...c.battle, waves: [], seconds: 9999 } }
    expect(renderMissionDiagram(modified)).toBe(renderMissionDiagram(c))
  })
  it('keeps revised terrain, models, clouds and objectives independently editable', () => {
    for (const id of ['germany-m4', 'germany-m2', 'germany-m3', 'japan-m2', 'allies-m3']) {
      const html = renderMissionDiagram(card(id))
      for (const layer of ['terrain', 'units', 'clouds', 'objectives', 'air']) {
        expect(html).toContain(`data-layer="${layer}"`)
      }
      expect(html).not.toContain('-models.webp')
      expect(html).toContain('model-silhouettes/')
    }
    expect(renderMissionDiagram(card('germany-m4'))).toContain('maps/reference/germany-m4-terrain.webp')
  })
  it('protects silhouettes and labels from clouds on all missions', () => {
    for (const c of cards) {
      const html = renderMissionDiagram(c)
      expect(html).toContain('data-layer="clouds" mask="url(')
      expect(html).toContain('<mask ')
      expect(html).toContain('textures/cloud-puffs.png')
      expect(html).not.toContain('<radialGradient')
    }
  })
  it('uses aircraft silhouettes throughout and includes the Rzhev Yak fighters', () => {
    for (const c of cards) {
      const html = renderMissionDiagram(c)
      expect(html).toContain('data-aircraft=')
      expect(html).not.toContain('M-37-21 37 21')
      expect(html).not.toContain('-runtime.svg')
    }
    const rzhev = renderMissionDiagram(card('germany-m4'))
    expect(rzhev).toContain('data-aircraft="yak1b"')
    expect(rzhev).toContain('Yak-1B × 6')
  })
})
