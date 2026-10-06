import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import * as ts from 'typescript'
import { createBattleScoreboard } from '../../src/app/battleScoreboard'
import { createRoster, type Roster } from '../../src/battle/pilots'
import type { AfterAction, Scoreboard } from '../../src/ui/scoreboard'
import type { Team } from '../../src/world/team'

const SEATS: { team: Team }[] = [{ team: 'blue' }, { team: 'blue' }, { team: 'red' }]
const UNREAD_ROSTER: Roster = { get pilots(): never { throw new Error('unexpected row rebuild') } }

function fixture() {
  const view = {
    render: vi.fn<Scoreboard['render']>(),
    setVisible: vi.fn<Scoreboard['setVisible']>(),
  }
  const afterAction = vi.fn((endedAt: number): AfterAction => ({
    mode: 'skirmish', titleKey: 'result.skirmish', objectiveKey: 'mission.killAll.objective',
    seconds: endedAt - 5, playerSpec: 'P-51D', playerFlight: 1, playerHp01: 1, convoy: null,
  }))
  const board = createBattleScoreboard(view, afterAction)
  const roster = createRoster(['A', 'B', 'C'], 0)
  return { view, afterAction, board, roster }
}

describe('計分板的重畫時機', () => {
  it('隱藏時不建列、也不建戰報', () => {
    const f = fixture()
    f.board.update(UNREAD_ROSTER, SEATS, 'fighting', false, 10)
    expect(f.view.render).not.toHaveBeenCalled()
    expect(f.afterAction).not.toHaveBeenCalled()
    expect(f.view.setVisible).toHaveBeenCalledWith(false)
  })

  it('戰鬥中每 0.25 秒最多重畫一次，重新打開時立刻畫', () => {
    const f = fixture()
    f.board.update(f.roster, SEATS, 'fighting', true, 10)
    expect(f.view.render).toHaveBeenCalledTimes(1)
    f.board.update(UNREAD_ROSTER, SEATS, 'fighting', true, 10.249)
    expect(f.view.render).toHaveBeenCalledTimes(1)
    f.board.update(f.roster, SEATS, 'fighting', true, 10.25)
    expect(f.view.render).toHaveBeenCalledTimes(2)
    f.board.update(UNREAD_ROSTER, SEATS, 'fighting', false, 10.26)
    f.board.update(f.roster, SEATS, 'fighting', true, 10.27)
    expect(f.view.render).toHaveBeenCalledTimes(3)
    expect(f.afterAction).not.toHaveBeenCalled()
    expect(f.view.render.mock.calls[2]!.slice(2)).toEqual([null, null])
  })

  it('各隊排好序的快照另外建，不去排原本的名冊', () => {
    const f = fixture()
    f.roster.pilots[1]!.kills = 3
    f.board.update(f.roster, SEATS, 'fighting', true, 10)
    const [blue, red] = f.view.render.mock.calls[0]!
    expect(blue.map((row) => row.name)).toEqual(['B', 'A'])
    expect(red.map((row) => row.name)).toEqual(['C'])
    expect(f.roster.pilots.map((pilot) => pilot.name)).toEqual(['A', 'B', 'C'])
    f.roster.pilots[1]!.kills = 4
    expect(blue[0]!.kills).toBe(3)
  })

  it.each(['victory', 'defeat'] as const)('%s 立刻畫，而且只畫一次', (outcome) => {
    const f = fixture()
    f.board.update(f.roster, SEATS, 'fighting', true, 10)
    f.board.update(f.roster, SEATS, outcome, false, 10.1)
    expect(f.view.render).toHaveBeenCalledTimes(2)
    const [, , banner, extra] = f.view.render.mock.calls[1]!
    expect(banner).toBe(outcome)
    expect(extra?.seconds).toBeCloseTo(5.1)
    expect(f.afterAction).toHaveBeenCalledTimes(1)
    expect(f.afterAction).toHaveBeenCalledWith(10.1)
    f.board.update(UNREAD_ROSTER, SEATS, outcome, false, 100)
    expect(f.view.render).toHaveBeenCalledTimes(2)
    expect(f.afterAction).toHaveBeenCalledTimes(1)
    expect(f.view.setVisible).toHaveBeenLastCalledWith(true)
  })

  it('開下一場時重設結算戰報與節流的狀態', () => {
    const f = fixture()
    f.board.update(f.roster, SEATS, 'victory', false, 20)
    f.board.reset()
    const nextRoster = createRoster(['D', 'E', 'F'], 1)
    f.board.update(nextRoster, SEATS, 'fighting', true, 20.01)
    expect(f.view.render.mock.calls[1]![0].map((row) => row.name)).toEqual(['D', 'E'])
    f.board.update(nextRoster, SEATS, 'defeat', false, 20.02)
    expect(f.view.render).toHaveBeenCalledTimes(3)
    expect(f.afterAction).toHaveBeenLastCalledWith(20.02)
  })

  it('畫失敗後重試，結束時間仍是第一次記下的', () => {
    const f = fixture()
    f.view.render.mockImplementationOnce(() => { throw new Error('render failed') })
    expect(() => f.board.update(f.roster, SEATS, 'victory', false, 10)).toThrow('render failed')
    f.board.update(f.roster, SEATS, 'victory', false, 11)
    expect(f.afterAction).toHaveBeenLastCalledWith(10)
    f.board.update(UNREAD_ROSTER, SEATS, 'victory', false, 12)
    expect(f.view.render).toHaveBeenCalledTimes(2)
  })
})

describe('計分板的接線', () => {
  const file = ts.createSourceFile('main.ts', readFileSync('src/main.ts', 'utf8'), ts.ScriptTarget.Latest, true)
  it.each([
    ['startWorld', 'battleScoreboard.reset'],
    ['stepAndDrawBattle', 'battleScoreboard.update'],
  ])('%s 在條件分支外呼叫 %s 一次', (fnName, callName) => {
    const fn = file.statements.find((node): node is ts.FunctionDeclaration =>
      ts.isFunctionDeclaration(node) && node.name?.text === fnName)
    expect(fn?.body).toBeDefined()
    const direct = fn!.body!.statements.filter((node) =>
      ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) &&
      node.expression.expression.getText(file) === callName)
    expect(direct).toHaveLength(1)
    let count = 0
    function visit(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.expression.getText(file) === callName) count++
      ts.forEachChild(node, visit)
    }
    visit(fn!.body!)
    expect(count).toBe(1)
  })
})
