import type { Aircraft } from '../aircraft/Aircraft'
import { alarmFactor, type Situation } from './assess'
import type { TargetBoard } from './target'

/** 找出來襲威脅中最強的一架，並更新呼叫端的最近距離 */
export function scanThreat(
  board: Pick<TargetBoard, 'candidates'> | null,
  selfIndex: number,
  self: Aircraft,
  sit: Pick<Situation, 'range' | 'nearestRange'>,
): Aircraft | null {
  // 【沒有板就退回目標距離】單機對單機沒有「別的敵機」，最近的就是他
  sit.nearestRange = sit.range
  if (board === null) return null
  const me = board.candidates[selfIndex]
  if (me === undefined) return null

  let best: Aircraft | null = null
  let bestValue = 0
  let nearest = Infinity
  const candidates = board.candidates
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i]!
    if (!candidate.alive || candidate.team === me.team) continue
    // 【順便量最近敵機】同一個迴圈、不配置。見 `Situation.nearestRange`
    const distance = candidate.aircraft.state.position.distanceTo(self.state.position)
    if (distance < nearest) nearest = distance
    // 【用警戒而不是威脅排序】`threatFactor` 在 900 m 外恆為 0，所以
    // 用它掃描的話，一架咬在我 950 m 正後方的敵機得分與「不存在」相同 ——
    // 選不出來，`defend` 的破防軸也就繞不到他身上。`alarmFactor` 的支撐集
    // **包含** `threatFactor` 的（同樣的錐、同樣的解，只是少乘距離因子），
    // 所以換過來只會多找到人，不會少。
    const value = alarmFactor(candidate.aircraft, self)
    if (value > bestValue) {
      bestValue = value
      best = candidate.aircraft
    }
  }
  // 【敵機全滅時保持 `range`】`Infinity` 會讓規則 3 的距離出場立刻成立，
  // 而那時候根本沒有人可以脫離
  if (nearest !== Infinity) sit.nearestRange = nearest
  return best
}
