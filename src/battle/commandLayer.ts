import type { Battle } from './battleState'
import { Vector3 } from 'three'
import { AI_DECISION_HZ, AiController } from '../ai/AiController'
import { stepCommand } from '../ai/command'
import { type CommandUnit } from '../ai/commandTypes'
import { manoeuvreSpeed } from '../ai/doctrine'
import { PRESSURE_RANGE } from '../ai/target'
import { teamSlot } from '../world/team'
import { serviceCeiling } from '../analysis/envelope'
import type { Aircraft } from '../aircraft/Aircraft'
import type { AircraftSpec } from '../specs/types'
import type { Combatant } from '../world/combatant'
import type { World } from '../world/World'
import type { FlightIndex } from './flights'

interface CommandSeats {
  readonly world: Pick<World, 'combatants'>
  readonly flights: FlightIndex
}

type CommandBattle = CommandSeats & Pick<Battle,
  'commandUnits' | 'blueCommand' | 'redCommand' | 'blueOrderFlights' | 'redOrderFlights'
  | 'blueFlightIndices' | 'redFlightIndices' | 'convoy' | 'evacOrder'>

type PressureBattle = Pick<Battle, 'pressureTimer' | 'board'>

/** 一架的指揮層快照。**`createBattle` 與 `reinforce` 共用** */
export function makeCommandUnit(c: Combatant, ceilings: Map<AircraftSpec, number>): CommandUnit {
  const spec = c.aircraft.spec
  let ceiling = ceilings.get(spec)
  if (ceiling === undefined) {
    ceiling = serviceCeiling(spec)
    // 【NaN 代表搜尋失敗】`serviceCeiling` 在區間沒括住解時回 NaN。讓它流
    // 進規劃會使「集合點不超過升限」那個夾擠變成 false，高度限制靜靜消失。
    // 退成 Infinity：夾擠不生效，但下界（clearanceScale）仍然守著。
    if (!Number.isFinite(ceiling)) ceiling = Infinity
    ceilings.set(spec, ceiling)
  }
  return {
    // 【自己的向量，不是飛機那一份的別名】`stepCommandLayer` 每步 copy 進來。
    // 抓別名等於倚賴「`state.position` 這個物件永遠是同一個」—— 只要
    // `Aircraft.reset` 換掉整個 `state`，「再打一場」之後這 40 個別名就
    // 全部指向孤兒向量。見 `Aircraft.reset` 的註解。
    position: new Vector3(),
    velocity: new Vector3(),
    cornerRatio: 1,
    hpFraction: 1,
    shotInstant: 0,
    serviceCeiling: ceiling,
    alive: c.alive,
  }
}

/**
 * 重算兩隊的任務壓力，寫進 `board.pressure`。
 *
 * 「這一隊的被保護單位有沒有敵機貼上來」對同隊的每一架**完全相同**，所以
 * 算一次全隊共用（見 `TargetBoard.pressure`）。
 *
 * 【為什麼是 10 Hz 而不是每步】它是一個慢變量，而且是戰術層 10 Hz 決策的
 * 輸入。每步算等於把成本乘 24。
 *
 * 【非護送關卡沒有二次成本】`protectedMask` 全 0 時外層迴圈直接跑完，一次
 * 距離平方都不算 —— O(N²) 那一項是零。**但不是完全免費**：每個物理步仍有
 * 一次減法與分支，每 10 Hz 仍走一趟 O(N) 的遮罩掃描。
 *
 * 熱路徑：不配置。
 */
export function stepPressure(b: PressureBattle, dt: number): void {
  b.pressureTimer -= dt
  if (b.pressureTimer > 0) return
  b.pressureTimer += 1 / AI_DECISION_HZ

  const board = b.board
  const cs = board.candidates
  const mask = board.protectedMask
  const out = board.pressure
  out[0] = 0
  out[1] = 0

  const r2 = PRESSURE_RANGE * PRESSURE_RANGE
  for (let i = 0; i < cs.length; i++) {
    if (mask[i] === 0) continue
    const ward = cs[i]!
    if (!ward.alive) continue
    const slot = teamSlot(ward.team)
    // 這一隊已經成立，不必再找
    if (out[slot] !== 0) continue
    const wp = ward.aircraft.state.position
    for (let k = 0; k < cs.length; k++) {
      const foe = cs[k]!
      if (!foe.alive || foe.team === ward.team) continue
      if (foe.aircraft.state.position.distanceToSquared(wp) < r2) {
        out[slot] = 1
        break
      }
    }
  }
}

/**
 * 指揮官要豁免的分隊索引；沒有要豁免的回 −1。
 *
 * 【跳過的是「有人類在操縱的那一支」，不是「玩家的座位」】指揮 AI 不對
 * 玩家的小隊下令，理由是不跟人類搶操縱（spec §2.1）—— 座位上坐的是
 * AiController 時（`I` 代飛、上帝視角）那個理由就不成立了。
 *
 * 【為什麼用推導而不是加一個旗標】推導比鏡射安全：鏡射要求每一條會改變
 * 狀態的路徑都記得更新，漏掉任何一條就留下一個永遠不消失的幽靈狀態。
 * 這與 `wireStations` 靠 `instanceof AiController` 自動跟上、編制每步
 * 重算而不是增量維護，是同一條紀律。
 *
 * 【`pinned < 0` 時】`combatants[-1]` 是 undefined → `human` 為 false
 * → 回 −1。
 *
 * 【為什麼 export】這條規則的整合測試（`god-view.test.ts`）打在這個縫上。
 * 「玩家分隊終究會拿到命令」是混沌量 —— AI 行為一改，一場 120 秒的對戰
 * 裡那一支可能整場都在接戰、從來輪不到（實測 `god-order.probe.ts`：
 * 指揮層對其他分隊發了三萬步的命令，玩家那支 0）。規則本身是確定的，
 * 就直接驗規則。
 */
export function commandExemptFlight(b: CommandSeats): number {
  const seat = b.world.combatants[b.flights.pinned]
  const human = seat !== undefined && !(seat.controller instanceof AiController)
  return human ? b.flights.flightOf[b.flights.pinned]! : -1
}

/**
 * 推進兩隊的指揮官，並把命令寫進每一架的 `AiController.order`。
 *
 * 【為什麼排在 `wireStations` 之後】`stepCommand` 讀 `flight.count` 與
 * `flight.members`，那兩者由同一步的 `compactFlights` 重算。排在前面會用到
 * 上一步的編制 —— 剛陣亡的成員仍在名單裡。
 *
 * 【玩家那一隊自治，但只在**真的有人在操縱**的時候】指揮 AI 不對玩家的
 * 小隊下令，理由是不跟人類搶操縱（spec §2.1）。座位上坐的是 `AiController`
 * 時（`I` 代飛、上帝視角）那個理由就不成立了 —— 見下方 `playerFlight`
 * 的推導。
 */
export function stepCommandLayer(b: CommandBattle, dt: number): void {
  const cs = b.world.combatants

  // ── 快照：每步抄一份 ──────────────────────────────────
  //
  // 【位置與速度每步 copy，不抓參考】抓參考等於倚賴
  // 「`c.aircraft.state.position` 這個 `Vector3` 物件永遠是同一個」——
  // `Aircraft.reset` 一旦整個換掉 `state`，`resetBattle`（再打一場）之後
  // 這裡的 40 個參考就全部指向孤兒向量，指揮層讀一整場凍結的座標
  // （最大落差 5300 m，集合令因此解除不掉）。
  //
  // 根因已經在 `Aircraft.reset` 修掉（就地寫回 + `state` 標 `readonly`），
  // 這一段是第二道：`CommandUnit` 的名字是**快照**，那就真的抄一份，不要
  // 倚賴任何「那個物件不會被換掉」的默契。下一個在別處換掉物件的人，
  // 不會再連累指揮層。
  //
  // 【成本】40 架 × 2 個三分量向量 × 240 Hz。與同一迴圈裡的 `manoeuvreSpeed`
  // （查表 + 開方）相比可以忽略，而且不配置。
  for (let i = 0; i < cs.length; i++) {
    const c = cs[i]!
    const u = b.commandUnits[i]!
    u.alive = c.alive
    const a = c.aircraft
    u.position.copy(a.state.position)
    u.velocity.copy(a.state.velocity)
    // 【為什麼不從 AiController 的 sit 拿】那個欄位是私有的，而且玩家座位
    // 根本沒有 AiController。直接算比較誠實，也不依賴 AI 這一步跑過沒有
    // 【分母與 `assess.ts` 的 `cornerRatio` 必須是同一個】指揮層的
    // `spentRatio`（見底）與 `ENGAGED_RATIO`（已交戰）吃這個比值，若它與
    // 戰機端用不同的尺標，「指揮官認為誰沒能量」就會與「飛機自己覺得沒
    // 能量」對不起來。見 `ai/doctrine.ts` 的 `manoeuvreGFraction`
    const vc = manoeuvreSpeed(a.spec, a.state.position.y)
    u.cornerRatio = vc > 1e-3 ? a.state.velocity.length() / vc : 0
    // 【滿血由 spec 給】`c.hp` 的上界是 `c.aircraft.spec.hp`（`World` 的
    // respawn 就是抄它）。夾在 0 以上：受創超過滿血時 hp 會是負的
    const full = a.spec.hp
    const frac = full > 0 ? c.hp / full : 0
    u.hpFraction = frac > 0 ? frac : 0
    // 【只為排名】射擊解強度的鏡像，見 command.ts 的 `idle`。
    //
    // 【玩家座位可能沒有 AiController，那時寫 0】人類在操縱的那一支分隊
    // 本來就被 `skipFlight` 跳過，所以那個 0 不會被任何排名讀到；而代飛
    // 或上帝視角時座位上是 AiController，這一行就抄得到真值 —— 那一支
    // 分隊這時也確實會進排名（見下方 `playerFlight` 的推導）
    const ctl = c.controller
    u.shotInstant = ctl instanceof AiController ? ctl.shotInstant : 0
  }

  const playerFlight = commandExemptFlight(b)
  // 【下令端與被看見端是兩份清單】`own` 拿掉被護送的小隊、`foe` 不拿掉 ——
  // 攔截時對面的指揮官必須看得到那幾架才切得到它們的側翼。見
  // `Battle.blueOrderFlights`
  stepCommand(
    b.blueCommand, b.flights.flights, b.blueOrderFlights, b.redFlightIndices,
    b.commandUnits, playerFlight, dt,
  )
  stepCommand(
    b.redCommand, b.flights.flights, b.redOrderFlights, b.blueFlightIndices,
    b.commandUnits, playerFlight, dt,
  )

  // ── 發下去 ────────────────────────────────────────────
  for (let f = 0; f < b.flights.flights.length; f++) {
    const flight = b.flights.flights[f]!
    const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
    // 【被護送的小隊拿自己那一張永遠不解除的集合令】它們不在下令端的清單
    // 裡，所以 `state.orders[f]` 恆為 null —— 這裡的 `??` 只是把兩條路寫在
    // 一起，不是在跟指揮官搶
    const convoyOrder = b.convoy?.orders[f] ?? null
    // 【撤離令排在指揮官前面】撤離是任務層的命令，指揮官的集合／包抄／集火
    // 都是在戰場裡周旋，那時已經不該再周旋
    const evacOrder = convoyOrder === null && flight.team === 'blue' ? b.evacOrder : null
    const order = convoyOrder ?? evacOrder ?? state.orders[f] ?? null
    // 【索引解析成 Aircraft 在這一層】規劃層是純函數、只吃快照，不認識
    // Aircraft。與 wireStations 把 stationReferenceOf 的索引解析成飛機是
    // 同一個手法。
    //
    // 【陣亡在這裡擋】stepCommand 同一步也會把命令解除，所以這是同一件事
    // 的兩道保險 —— 但兩道的節奏不同：命令層的解除是每步的，而這一格擋的
    // 是「解除與發令之間」那一瞬。留一個指向退場飛機的 target 會讓 AI
    // 對著一個不存在的東西解預瞄
    let focus: Aircraft | null = null
    if (order !== null && order.kind === 'focus') {
      const c = cs[order.focusIndex]
      if (c !== undefined && c.alive) focus = c.aircraft
    }
    for (let p = 0; p < flight.count; p++) {
      const ai = cs[flight.members[p]!]!.controller
      if (ai instanceof AiController) {
        ai.order = order
        ai.focusTarget = focus
        // 【無條件飛完航程】被護送的那幾架連閃躲都不讓位，見
        // `AiController.transit`。每步重寫而不是生成時設一次 —— 玩家接手
        // 或代飛會換掉座位上的控制器物件，設一次的話新的那顆會漏掉
        ai.transit = convoyOrder !== null
        ai.evacuating = evacOrder !== null
      }
    }
  }
}
