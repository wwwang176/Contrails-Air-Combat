import { describe, expect, it, vi } from 'vitest'
import { createMissionHud } from '../../src/hud/missionFeed'
import { createHudFrame } from '../../src/hud/types'
import { createMissionState } from '../../src/battle/mission'
import type { MessageKey } from '../../src/i18n'

const OBJECTIVE = 'mission.killAll.objective' as MessageKey
const BANNER = 'banner.test' as MessageKey
const MESSAGE = 'message.test' as MessageKey

function fixture() {
  const frame = createHudFrame()
  const playPool = vi.fn()
  let language = 'a'
  const feed = createMissionHud(frame, { playPool }, key => language + ':' + key)
  const battle: Parameters<typeof feed.fillMissionHud>[0] = {
    mission: createMissionState({ kind: 'annihilate' }), rules: { kind: 'annihilate' },
    objectiveKey: null, message: null,
  }
  const card = { battle: { objectiveKey: OBJECTIVE, bannerKey: BANNER } }
  return { frame, playPool, feed, battle, card, setLanguage(value: string) { language = value } }
}

describe('mission HUD feed', () => {
  it('plays radio only on new banner/message keys and clears their ages when absent', () => {
    const f = fixture()
    f.battle.message = MESSAGE
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 10)
    expect(f.playPool).toHaveBeenCalledTimes(2)
    expect(f.frame.objectiveText).toBe('a:' + OBJECTIVE)
    expect(f.frame.objectiveBanner).toBe('a:' + BANNER)
    expect(f.frame.messageAge).toBe(0)
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 12)
    expect(f.playPool).toHaveBeenCalledTimes(2)
    expect(f.frame.messageAge).toBe(2)
    expect(f.frame.objectiveBannerAge).toBe(2)
    f.battle.message = null
    f.feed.fillMissionHud(f.battle, 'skirmish', null, 13)
    expect(f.frame.messageAge).toBe(-1)
    expect(f.frame.objectiveBannerAge).toBe(-1)
    expect(f.frame.objectiveActive).toBe(false)
    expect(f.playPool).toHaveBeenCalledTimes(2)
  })

  it('translates existing text after a language change without replaying radio or restarting its clock', () => {
    const f = fixture()
    f.battle.message = MESSAGE
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 10)
    f.setLanguage('b')
    f.feed.setMissionHudLanguageTime(11)
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 12)
    expect(f.frame.objectiveBanner).toBe('b:' + BANNER)
    expect(f.frame.message).toBe('b:' + MESSAGE)
    expect(f.frame.objectiveBannerAge).toBe(2)
    expect(f.frame.objectiveBannerTypeAge).toBe(-1)
    expect(f.frame.messageAge).toBe(-1)
    expect(f.playPool).toHaveBeenCalledTimes(2)
  })

  it('uses the current objective and restarts the same banner on a new battle', () => {
    const f = fixture()
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 10)
    f.battle.objectiveKey = OBJECTIVE
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 15)
    expect(f.frame.objectiveBanner).toBe('a:' + OBJECTIVE)
    expect(f.frame.objectiveBannerAge).toBe(0)
    f.feed.resetMissionBanner()
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 20)
    expect(f.frame.objectiveBannerAge).toBe(0)
    expect(f.playPool).toHaveBeenCalledTimes(3)
  })

  it('reads the current mission state and convoy threshold without changing them', () => {
    const f = fixture()
    f.battle.rules = { kind: 'convoy', owner: 'blue', point: f.battle.mission.target, radius: 20, need: 4 }
    Object.assign(f.battle.mission, { metric: 300, metricTotal: 7, arrived: 2, remaining: 5, secondsLeft: 40 })
    const before = JSON.stringify(f.battle)
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 10)
    expect(f.frame).toMatchObject({ objectiveMetric: 300, objectiveMetricTotal: 7,
      objectiveArrived: 2, objectiveRemaining: 5, objectiveSeconds: 40, objectiveNeed: 4 })
    expect(JSON.stringify(f.battle)).toBe(before)
  })
})
