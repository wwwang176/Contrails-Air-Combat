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
    objectiveKey: null, message: null, alert: null,
  }
  const card = { battle: { objectiveKey: OBJECTIVE, bannerKey: BANNER } }
  return { frame, playPool, feed, battle, card, setLanguage(value: string) { language = value } }
}

/** 倫內爾島：敵方還沒警戒時，敵方的框與標記改用黃色（`contactColor` 的第三個參數） */
describe('任務 HUD：敵方還沒警戒', () => {
  it('有警戒而且還沒觸發時為真；觸發之後、沒有警戒的關卡都為假', () => {
    const f = fixture()
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 0)
    expect(f.frame.enemyUnaware).toBe(false)
    const alert = { alerted: false } as NonNullable<typeof f.battle.alert>
    f.battle.alert = alert
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 1)
    expect(f.frame.enemyUnaware).toBe(true)
    alert.alerted = true
    f.feed.fillMissionHud(f.battle, 'mission', f.card, 2)
    expect(f.frame.enemyUnaware).toBe(false)
  })
})

describe('任務 HUD 的資料', () => {
  it('橫幅／訊息換了新的鍵才播無線電；沒有時把經過時間清成 -1', () => {
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

  it('換語言後重譯現有文字，不重播無線電、也不重新計時', () => {
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

  it('用當下的目標；新的一場即使橫幅相同也重新播', () => {
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

  it('讀當下的任務狀態與船團門檻，不改動它們', () => {
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
