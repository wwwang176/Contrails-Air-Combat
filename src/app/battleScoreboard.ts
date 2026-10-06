import type { Outcome } from '../battle/mission'
import type { Roster } from '../battle/pilots'
import type { Team } from '../world/team'
import type { AfterAction, Scoreboard } from '../ui/scoreboard'
import { scoreRows, sortScoreRows } from '../ui/scoreboardRows'

/** 按住 TAB 時，整張表每秒最多重建四次 */
const BOARD_PERIOD = 0.25

/** 管一張重複使用的計分板什麼時候重畫，與 DOM、模擬都無關 */
export function createBattleScoreboard(
  scoreboard: Pick<Scoreboard, 'render' | 'setVisible'>,
  afterAction: (endedAt: number) => AfterAction,
) {
  let battleEndedAt = -1
  let aarDrawn = false
  let boardNextDraw = 0

  function reset(): void {
    battleEndedAt = -1
    aarDrawn = false
    boardNextDraw = 0
  }

  function update(
    roster: Roster,
    seats: readonly { team: Team }[],
    outcome: Outcome,
    held: boolean,
    elapsed: number,
  ): void {
    const finished = outcome !== 'fighting'
    if (finished && battleEndedAt < 0) battleEndedAt = elapsed
    const showBoard = held || finished
    // 只在顯示中而且到時間了才建列。結算戰報畫過就不再動，
    // 否則之後的幀會把展開／收合的細節與選取的文字洗掉
    if (showBoard && (finished ? !aarDrawn : elapsed >= boardNextDraw)) {
      scoreboard.render(
        sortScoreRows(scoreRows(roster, seats, 'blue')),
        sortScoreRows(scoreRows(roster, seats, 'red')),
        finished ? (outcome === 'victory' ? 'victory' : 'defeat') : null,
        finished ? afterAction(battleEndedAt) : null,
      )
      aarDrawn = finished
      boardNextDraw = elapsed + BOARD_PERIOD
    }
    // 重新按下 TAB 要立刻畫，即使還在上一個間隔內
    if (!showBoard) boardNextDraw = 0
    scoreboard.setVisible(showBoard)
  }

  return { reset, update }
}
