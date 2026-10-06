import { createMenu } from '../../src/ui/menu'
import { setLang } from '../../src/i18n'
import { ALL_SPECS, type SkirmishSetup } from '../../src/battle/skirmish'
import type { Screen } from '../../src/ui/screens'

/** 跑真正的選單，遊戲鉤子換成可觀察的紀錄；沒有渲染器也沒有模擬 */
export function mount() {
  const events: unknown[][] = []
  let setup: SkirmishSetup = {
    blue: [{ id: ALL_SPECS[0]!.id, count: 4 }],
    red: [{ id: ALL_SPECS[1]!.id, count: 4 }],
    lead: 0, terrain: 'archipelago', altitude: 3000, timeOfDay: 'noon',
  }
  const menu = createMenu(document.querySelector('#ui') as HTMLElement, {
    onEvent(event) {
      events.push(['event', event])
      if (event === 'mission' || event === 'fight') menu.show(event === 'fight' ? 'battle' : 'mission')
    },
    onMission(card) { events.push(['mission', card.id]) },
    onAircraft(spec) {
      if (this === undefined) throw new Error('Aircraft hook lost its receiver')
      events.push(['aircraft', spec.id])
    },
    onSetup(next) {
      if (this === undefined) throw new Error('Setup hook lost its receiver')
      setup = next; events.push(['setup', next]); menu.renderSetup(next)
    },
    onResume() { events.push(['resume']) },
    onRestart() { events.push(['restart']) },
    onHelp() { events.push(['help']) },
    onQuality(value) { events.push(['quality', value]) },
    onAntialias(value) { events.push(['antialias', value]) },
    onVolume(value) { events.push(['volume', value]) },
    onAimAssist(value) { events.push(['assist', value]) },
    onLang(value) { setLang(value) },
  })
  menu.renderSetup(setup)
  menu.show('campaign')
  const loading = document.querySelector<HTMLElement>('#loading')
  if (loading !== null) loading.hidden = true
  return {
    show(screen: Screen) { menu.show(screen) },
    setLang,
    events,
    get setup() { return setup },
  }
}
