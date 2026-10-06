import type { Battle } from './battleState'
import type { Team } from '../world/team'
import type { AircraftSpec } from '../specs/types'
import { conditionMet, MESSAGE_SECONDS } from './beats'
import { countDestroyed, destroyedInPool, inDestroyPool } from './objectiveQueries'
import { evacOrderOf } from './missionProgress'
import { resetMissionState } from './mission'
import { fitsNextReserve, parkedLeft, reinforce } from './reinforcements'
import { stepConveyor, stepRecycle } from './flightRecovery'
import { dropFlares } from './flareRotation'

/**
 * `stepBeats` 的當步快照。模組級，不配置。
 *
 * 【六個具名欄位而不是 `Record<string, number>`】組出來的鍵每一次都是一個
 * 新字串，而這裡每個物理步跑一次全場掃描。
 */
const aliveCounts = {
  blue: 0, red: 0, blueFighter: 0, redFighter: 0, blueBomber: 0, redBomber: 0,
}

function aliveOf(team: Team, role?: AircraftSpec['role']): number {
  if (team === 'blue') {
    if (role === undefined) return aliveCounts.blue
    return role === 'bomber' ? aliveCounts.blueBomber : aliveCounts.blueFighter
  }
  if (role === undefined) return aliveCounts.red
  return role === 'bomber' ? aliveCounts.redBomber : aliveCounts.redFighter
}

/**
 * 推進節拍。**排在 `drainKills` 之後、`compactFlights` 之前**（見呼叫點）。
 *
 * 【先判斷後套效果】所有條件都對**同一份快照**判斷，才開始套效果。否則第一
 * 個增援會改變存活數，讓同一步後面的條件依陣列順序產生隱性耦合 —— 而那種
 * 耦合在測試裡看起來一切正常，直到有人調整了卡片上節拍的順序。
 *
 * 【為什麼用 `world.time` 而不是另開一個 tick 計數】它已經是一個單調的浮點
 * 累加器，而且判定用的東西（助攻窗口、任務時限）本來就掛在它上面。同一組
 * `dt` 序列累加出來的值逐位元相同，重播因此仍然是決定性的。
 *
 * 熱路徑：`beats` 為空時只有一次長度檢查。
 */
export function stepBeats(b: Battle): void {
  const beats = b.cfg.beats
  if (beats === undefined || beats.length === 0) return
  const now = b.world.time
  // 【過期的訊息在這裡收掉】`message` 因此恆是「這一刻該顯示的那一則」，
  // 畫面那一層照抄就好，不必自己持有一份計時
  if (b.message !== null && now >= b.messageUntil) b.message = null
  // 【走完就不再掃全場】節拍是一場裡的幾個瞬間，而這個函數每個物理步都跑
  if (b.beatsLeft === 0) return

  // 【快照先數】alive 條件全部讀這一份
  aliveCounts.blue = 0
  aliveCounts.red = 0
  aliveCounts.blueFighter = 0
  aliveCounts.redFighter = 0
  aliveCounts.blueBomber = 0
  aliveCounts.redBomber = 0
  // 【六個分支寫死，不組字串當鍵】`${team}Bomber` 每一架都配置一個新字串 ——
  // 20v20、240 Hz 是每秒 9,600 次，而這裡是熱路徑
  for (const c of b.world.combatants) {
    if (!c.alive) continue
    const bomber = c.aircraft.spec.role === 'bomber'
    if (c.team === 'blue') {
      aliveCounts.blue++
      if (bomber) aliveCounts.blueBomber++
      else aliveCounts.blueFighter++
    } else {
      aliveCounts.red++
      if (bomber) aliveCounts.redBomber++
      else aliveCounts.redFighter++
    }
  }
  // 【與 `stepMission` 同一個池】不能借 `MISSION_INPUTS` —— 那一份在這一步
  // 之後才填，讀到的是上一步、甚至上一場的殘留
  let destroyed = 0
  for (const t of b.world.groundTargets) {
    if (inDestroyPool(t, b.rules) && destroyedInPool(t, b.world.combatants)) destroyed++
  }

  for (let i = 0; i < beats.length; i++) {
    const beat = beats[i]!
    const st = b.beatStates[i]!
    if (st.phase === 'done') continue
    // 【重生節拍自己管每一支小隊的時刻】它不是「一個條件、一次效果」，
    // 而是同一場裡反覆發生的事，狀態依分隊放在 `reviveAt`
    if (beat.kind === 'recycle') {
      stepRecycle(b, beat, st, now)
      continue
    }
    if (beat.kind === 'conveyor') {
      stepConveyor(b)
      continue
    }
    // 【起飛的那一批要地上還有飛機】一架都不剩時不預警、不進場 —— 條件成立
    // 也一樣。等下去是對的：它不會再成立，而同形狀的下一批照樣可以用那個預留
    const grounded = beat.kind === 'reinforce' && beat.flight.departs !== undefined
      && parkedLeft(b, beat.flight.departs, beat.flight.team) === 0
    if (st.phase === 'waiting') {
      // 【`destroyed` 條件自帶單位】數的是它自己指定的那一種，不是規則的池
      const d = beat.when.kind === 'destroyed'
        ? countDestroyed(b.world.groundTargets, b.world.combatants, beat.when.unit)
        : destroyed
      if (!conditionMet(beat.when, now, aliveOf, b.batches, d)) continue
      if (grounded) continue
      st.phase = 'warned'
      st.dueAt = now + (beat.kind === 'reinforce' ? beat.warnLead : 0)
      // 【照明彈與縱隊出發沒有訊息】天亮起來、車動起來就是通知
      if (beat.kind === 'reinforce') b.message = beat.warnKey
      else if (beat.kind === 'withdraw' || beat.kind === 'retarget') b.message = beat.messageKey
      if (beat.kind !== 'flare' && beat.kind !== 'depart' && beat.kind !== 'mopUp') b.messageUntil = st.dueAt + MESSAGE_SECONDS
    }
    // 【落下來而不是 continue】`warnLead` 為 0 的節拍，預警與生效是同一刻。
    // 中間硬隔一個物理步的話，那 4 ms 看不出來，卻讓「0 秒預警」這個寫法
    // 多出一條沒有人會預期的語意
    if (now < st.dueAt) continue
    // 【預警之後地上的飛機被打光】這一批作罷，預留留給同形狀的下一批
    if (grounded) {
      st.phase = 'done'
      b.beatsLeft--
      continue
    }
    // 【預留依形狀取用】座位依序附加到世界尾端，每一支預留的分隊在建構期就
    // 綁死了自己的座位範圍、隊伍與架數。輪到的那一支隊伍或架數不同就要等 ——
    // 硬塞的話那幾架會落進別隊的分隊裡。形狀相同就直接用：前一個波次的條件
    // 可能永遠不成立（`ground`），照陣列順序排隊的話後面那一個永遠不會來
    if (beat.kind === 'reinforce' && !fitsNextReserve(b, beat.flight)) continue
    st.phase = 'done'
    b.beatsLeft--
    if (beat.kind === 'reinforce') reinforce(b, beat.flight)
    else if (beat.kind === 'flare') dropFlares(b, beat)
    else if (beat.kind === 'depart') {
      const targets = b.world.groundTargets
      for (let k = beat.first; k < beat.first + beat.count; k++) targets[k]!.departAt = now
    } else if (beat.kind === 'mopUp') {
      // 【剩下還活著的排定被打掉的時刻】`stepScriptedKill` 到了 `killAt` 就走擊毀流程、標成劇本打掉的
      // （不算摧毀數）。索引雜湊把它們散在 `within` 裡，不是同一刻一排爆。
      //
      // 【只打敵方】同一種單位的友軍也在場上（德 M4 的德軍反坦克砲與蘇軍支援砲都是 `atGun`），
      // 不看隊伍的話友軍會被一起「打掉」
      for (const t of b.world.groundTargets) {
        if (t.team === 'blue' || t.unit.id !== beat.unit || !t.alive || t.scripted || t.killAt !== Infinity) continue
        const u = (Math.imul(t.index + 1, 2654435761) >>> 0) / 4294967296
        t.killAt = now + beat.within[0] + (beat.within[1] - beat.within[0]) * u
      }
    } else if (beat.kind === 'retarget') {
      // 【換參考，不配置】規則物件在建場時就建好（`RetargetBeat.rules`）
      b.rules = beat.rules
      resetMissionState(b.rules, b.mission)
      b.objectiveKey = beat.messageKey
    } else {
      // 【規則與狀態兩個都要換】`stepMission` 是依規則分支的：只換狀態的話
      // 倒數永遠停在原值、計量顯示的是敵機數，飛進撤離圈也不會判勝
      //
      // 【就地寫回，不換 `MissionState` 物件】見 `Battle.mission` 的註解
      b.rules = {
        kind: 'evacuate', point: beat.point, radius: beat.radius, seconds: beat.seconds,
      }
      resetMissionState(b.rules, b.mission)
      b.evacOrder = evacOrderOf(b.rules)
      // 【目標文字也要跟著換】計量已經變成到新終點的距離，文字卻還是卡片上
      // 那一句 —— 兩者搭起來會指向一個不存在的任務
      b.objectiveKey = beat.messageKey
    }
  }
}
