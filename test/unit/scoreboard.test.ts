import { describe, it, expect } from 'vitest'
import { scoreRows, sortScoreRows, type ScoreRow } from '../../src/ui/scoreboard'
import { createRoster } from '../../src/battle/pilots'
import type { Team } from '../../src/world/World'

const SEATS: { team: Team }[] = [
  { team: 'blue' }, { team: 'blue' }, { team: 'red' }, { team: 'red' },
]

function row(name: string, kills: number, assists = 0): ScoreRow {
  return { name, kills, deaths: 0, assists, alive: true, isPlayer: false }
}

describe('scoreRows', () => {
  it('只取指定隊伍的列', () => {
    const r = createRoster(['A', 'B', 'C', 'D'], 0)
    expect(scoreRows(r, SEATS, 'blue').map((x) => x.name)).toEqual(['A', 'B'])
    expect(scoreRows(r, SEATS, 'red').map((x) => x.name)).toEqual(['C', 'D'])
  })

  it('戰績與存活、玩家標記照抄', () => {
    const r = createRoster(['A', 'B', 'C', 'D'], 1)
    r.pilots[1]!.kills = 3
    r.pilots[1]!.deaths = 1
    r.pilots[1]!.assists = 2
    r.pilots[1]!.alive = false
    const rows = scoreRows(r, SEATS, 'blue')
    expect(rows[1]).toEqual({
      name: 'B', kills: 3, deaths: 1, assists: 2, alive: false, isPlayer: true,
    })
  })
})

describe('sortScoreRows（M9 spec §9.3）', () => {
  it('依擊墜降序', () => {
    const rows = [row('A', 1), row('B', 5), row('C', 3)]
    expect(sortScoreRows(rows).map((x) => x.name)).toEqual(['B', 'C', 'A'])
  })

  it('擊墜相同時比助攻', () => {
    const rows = [row('A', 2, 1), row('B', 2, 4)]
    expect(sortScoreRows(rows).map((x) => x.name)).toEqual(['B', 'A'])
  })

  it('全部相同時比名字 —— 順序不能隨輸入順序漂移', () => {
    // 【為什麼要第三層】只比 K 的話同分的列會隨陣列順序跳動，畫面上看起來
    // 像 bug，而且測試會不穩定。
    const a = [row('Zed', 2, 1), row('Amy', 2, 1)]
    const b = [row('Amy', 2, 1), row('Zed', 2, 1)]
    expect(sortScoreRows(a).map((x) => x.name)).toEqual(['Amy', 'Zed'])
    expect(sortScoreRows(b).map((x) => x.name)).toEqual(['Amy', 'Zed'])
  })

  it('陣亡不影響排序 —— 打得好的死了還是在上面', () => {
    const dead = { ...row('A', 5), alive: false }
    const rows = [row('B', 1), dead]
    expect(sortScoreRows(rows).map((x) => x.name)).toEqual(['A', 'B'])
  })
})
