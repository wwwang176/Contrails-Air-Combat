import type { Outcome } from '../battle/mission'
import type { Roster } from '../battle/pilots'
import type { Team } from '../world/team'
import { scoreRows, sortScoreRows, type AfterAction, type Scoreboard } from '../ui/scoreboard'

/** Rebuilding a full table is limited to four times a second while TAB is held. */
const BOARD_PERIOD = 0.25

/** Owns redraw timing for one reusable scoreboard, independently of DOM and simulation. */
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
    // Build rows only when visible and due. Keep the final report unchanged so
    // expanding/collapsing its details and selecting text survives later frames.
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
    // Reopening TAB must render immediately, even within the previous interval.
    if (!showBoard) boardNextDraw = 0
    scoreboard.setVisible(showBoard)
  }

  return { reset, update }
}
