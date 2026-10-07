import { AiController } from '../ai/AiController'
import { resetShip } from '../world/ships'
import { resetShipGuns } from '../world/shipGuns'
import { resetGroundTarget } from '../world/groundTargets'
import { resetBalloon } from '../world/balloons'
import { clearImpacts } from '../world/events'
import { clearBursts, clearFlak } from '../world/flak'
import { clearFlares } from '../world/flares'
import { compactFlights, type Flight } from './flights'
import { settle } from './flightSpawn'
import { stepBeats } from './missionBeats'
import { stepFlareRotation } from './flareRotation'
import { stepCommandLayer, stepPressure } from './commandLayer'
import { evacOrderOf, stepMissionProgress } from './missionProgress'
import { resetBattleReport } from './report'
import { drainKills, drainReports } from './combatEvents'
import { pilotNames } from './names'
import { resetMissionState } from './mission'
import { wireStations } from './stationWiring'
import { resetAlert, stepAlert } from './alert'
import type { Battle } from './battleState'

/** HUD 的編隊查詢只需玩家索引與編制，不依賴完整戰局。 */
interface PlayerFormation {
  readonly player: Pick<Battle['player'], 'index'>
  readonly flights: Pick<Battle['flights'], 'flightOf' | 'flights'>
}

/**
 * 把操縱權交到等待中的座位上。
 *
 * 【為什麼身分立刻換、操縱權延後】那 2 秒是給玩家看自己的火球與零件的
 * （M8 條件 17 的前提）。但擊墜的歸屬必須在事件發生的那一刻就定案，
 * 否則兇手記到的是玩家而不是那位 AI（M9 spec §7.2）。
 */
function completeTakeover(b: Battle): void {
  const seat = b.takeoverSeat
  b.takeoverSeat = -1
  b.takeoverTimer = 0
  b.takeoverKiller = -1
  const next = b.world.combatants[seat]
  // 【目標可能在這 2 秒裡也死了】那時 drainKills 已經又換過一次身分並重設
  // 了倒數，所以走到這裡的座位恆是活的；這一條是防禦，不是常態路徑。
  if (next === undefined || !next.alive) return
  next.controller = b.playerController
  b.player = next
  // 站位由 wireStations 依 `instanceof AiController` 自動跟上
  b.flights.pinned = seat
}

/**
 * 推進一場戰鬥：世界一步，加上戰績記錄、接手移交、編制壓縮與勝負判定。
 */
export function stepBattle(b: Battle, dt: number): void {
  b.world.step(dt)
  // 【離地的那一席在名冊上活過來】它在滑行期間是不存活的席位（`reinforce`）。
  // 排在 `drainKills` 之前：離地那一步就被打下來的話，擊落要記在活過來的那一列上 ——
  // 反過來排，`recordKill` 會跳過還沒活過來的那一列，戰績漏記、名冊留著存活
  const lifted = b.world.liftoffs
  for (let i = 0; i < lifted.length; i++) b.roster.pilots[lifted[i]!]!.alive = true
  lifted.length = 0
  drainKills(b)
  drainReports(b)

  // 【退場的飛機要放掉它自己的指派】`World.step` 跳過退場者的控制器，所以
  // `selectTarget` 永遠沒機會替它把槽位歸 −1（M5 spec §7）。不清的話那筆
  // 指派會留到重置為止 —— `countLocks` 有跳過退場者所以不影響統計，但它是
  // 一筆會騙人的狀態，而且 spec 明寫要歸零。
  const cs = b.world.combatants
  const assignments = b.board.assignments
  for (let i = 0; i < cs.length; i++) {
    if (!cs[i]!.alive) assignments[i] = -1
  }

  // 【編制與站位每步重算】保序壓縮是存活旗標的純函數（M6 spec §5.4）：
  // 重算比維護增減安全 —— 維護要求每一條退場路徑都配一次更新，漏掉任何
  // 一條就留下一個永遠不消失的幽靈狀態。成本是 O(架數)。
  // 【倒數要排在壓縮之前】移交會改 `flights.pinned`，同一步的壓縮才會把
  // 玩家放到新分隊的 members[0]
  if (b.takeoverSeat >= 0) {
    b.takeoverTimer -= dt
    if (b.takeoverTimer <= 0) completeTakeover(b)
  }

  // 【節拍排在編制之前】最後一架第一波敵機被擊落的**同一步**就要能加第二波
  // ——排在勝負判定之後就來不及，那一步已經判成「一方全滅」了。而排在
  // `compactFlights` 之前，新分隊在下一次 `World.step` 之前就完成編制與接線
  stepBeats(b)
  stepFlareRotation(b)
  // 【排在命令層之前】同一步觸發警戒，同一步就把紅方交回指揮官
  stepAlert(b, dt)

  compactFlights(b.flights, cs)
  wireStations(b)
  stepCommandLayer(b, dt)
  stepPressure(b, dt)

  if (b.outcome !== 'fighting') return

  stepMissionProgress(b, dt)
}

/**
 * 整場回到滿編。
 *
 * 【與 R 鍵共用同一條路徑】兩份長得很像的初始化，就是只有一份會被修好的
 * 那種危險 —— 與 `Aircraft.respawn`、`World.destroy` 是同一個理由。
 *
 * @param seed 新的名字種子。省略時抽一個 —— 再打一場的名字重新隨機
 *             （M9 spec §6.1）。
 */
export function resetBattle(
  b: Battle, seed: number = (Math.random() * 0x100000000) >>> 0,
): void {
  b.world.projectiles.clear()
  // 【炸彈也要清】它的壽命是彈丸的 75 倍（90 s 對 1.2 s）—— 上一場還在空中
  // 的炸彈會在第二場繼續落下，看起來像憑空冒出來的水柱。
  b.world.bombs.clear()
  // 【魚雷更久】跑滿射程要 91 秒，比炸彈的上限還長。而且它會在水面拉出
  // 一條航跡 —— 上一場的那一條會在第二場繼續往前走
  b.world.torpedoes.clear()
  // 【船與高砲也要重設】`japan-m3` 沒有波次，所以「再打一場」走的是就地
  // resetBattle、**不重建 World**。少了這一段，第二局會是船停在上一局結束
  // 的位置、被打掉的砲位仍然是死的、上一局的高砲彈還在空中而且會引爆 ——
  // 全程不報錯。
  clearFlak(b.world.flak)
  clearFlares(b.world.flares)
  // 【輪替也停】節拍不重播（見 `battle-restart.test.ts`），輪替跟著節拍走
  b.flareRotation = null
  b.flareLane.fill(-1)
  b.flareDue.fill(-1)
  b.flareCursor = 0
  clearBursts(b.world.burstEvents)
  for (const s of b.world.ships) {
    resetShip(s)
    resetShipGuns(s)
  }
  // 【地面目標也要】沒有波次的關重開不重建 World，走的是這一條
  for (const t of b.world.groundTargets) resetGroundTarget(t)
  b.world.liftoffs.length = 0
  // 【時鐘也要歸零】砲塔的搖晃相位吃 `world.time`。不歸零的話，第二場即使
  // 種子與設定完全相同也會從不同的相位開始 —— 逐位元重播因此破功，而症狀
  // 看起來像隨機的。
  b.world.time = 0
  const combatants = b.world.combatants
  for (let i = 0; i < combatants.length; i++) {
    const c = combatants[i]!
    b.world.respawn(c)
    // 【方位與速度要另外抄回去】`World.respawn` 走的是 `Aircraft.reset`，
    // 它重建的是一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
    settle(c, c.spawnPosition, b.spawnOrientations[i]!, c.spawnTas)
  }
  // 【等重生的小隊也要忘掉】不清的話上一場排好的重生會在新場的開頭發生，
  // 而那一支此刻活得好好的
  b.reviveAt.fill(-1)
  b.batches = 0
  // 【上一場還沒排空的擊墜不記進新場】游標跳到現在的流水號
  b.killsSeen = b.world.killEvents.total
  b.groundKillsSeen = b.world.groundKillEvents.total
  // 【上一場沒排空的也要丟掉】那兩條由 `drainReports` 獨佔並就地排空，
  // 但重開之前的最後一步可能剛推進去 —— 留著的話新場第一步就會通報它
  clearImpacts(b.world.shipKillEvents)
  clearImpacts(b.world.shipHitEvents)
  // 【氣球回到空中】破掉的長回來；上一場沒排空的破掉事件丟掉
  for (const bl of b.world.balloons) resetBalloon(bl)
  clearImpacts(b.world.balloonKillEvents)
  // 【通報也要清】不清的話新的一場開場那三秒還掛著上一場的最後幾則，
  // 而佇列裡沒出場的會一條一條慢慢冒出來
  resetBattleReport(b.report)
  // 【擊落的累計與抵達的閂都要歸零】它們是跨步累積的，不歸零的話第二局
  // 開場就帶著上一局的進度 —— `hunt` 可能第一幀就判勝，護送可能第一幀就
  // 判定送到了，而畫面上一切正常
  b.redKilled = 0
  b.redKilledBombers = 0
  if (b.convoy !== null) b.convoy.arrived.fill(false)

  // 【被接手過的座位要還給 AI】接手時那顆 AiController 被丟掉了。少了這一段，
  // 重開之後戰場上會有一架永遠不動的飛機 —— 玩家的控制器同時裝在兩個座位上，
  // 而其中一個不會收到任何輸入。
  b.player = combatants[b.playerSeat]!
  b.flights.pinned = b.playerSeat
  b.takeoverSeat = -1
  b.takeoverTimer = 0
  b.takeoverKiller = -1
  for (const c of combatants) {
    if (c.index === b.playerSeat) {
      c.controller = b.playerController
      continue
    }
    // 【沿用的控制器要放掉空層鎖】重開之後目標常常是同一架，換目標那一道擋不住
    // 上一場記下的回升高度與離場（見 `AiController.resetAirTactics`）
    if (c.controller instanceof AiController) {
      c.controller.resetAirTactics()
      continue
    }
    const ai = new AiController()
    ai.board = b.board
    ai.selfIndex = c.index
    // 【難度也要抄回去】少了這一行，被玩家接手過的座位重開之後會悄悄
    // 變回 ACE —— 一場裡有一架敵人比其他人強，而且找不出原因。
    ai.profile = b.cfg.aiProfile
    ai.setDecisionPhase(c.index / combatants.length)
    c.controller = ai
  }

  // 【名字重抽】再打一場的名字重新隨機
  b.seed = seed
  const blueNames = pilotNames(seed, b.blue[0]!.aircraft.spec.faction, b.blue.length)
  // 【紅隊可以是空的】與 `createBattle` 同一條規則
  const redNames = b.red.length === 0
    ? []
    : pilotNames(seed, b.red[0]!.aircraft.spec.faction, b.red.length)
  let bi = 0
  let ri = 0
  for (let i = 0; i < combatants.length; i++) {
    const p = b.roster.pilots[i]!
    p.name = combatants[i]!.team === 'blue' ? blueNames[bi++]! : redNames[ri++]!
    p.kills = 0
    p.deaths = 0
    p.assists = 0
    p.alive = true
    p.isPlayer = i === b.playerSeat
  }

  // 【為什麼還要這一行】上面對每一架呼叫的 `World.respawn` 各清掉「打過它」
  // 的那一欄，合起來剛好是整張表 —— 但那是巧合式的完整。這一行讓「重開
  // 不留上一場的傷害紀錄」這個意圖自己成立，不倚賴迴圈涵蓋了每一個座位。
  b.world.clearDamageLog()
  b.board.assignments.fill(-1)
  b.board.pressure.fill(0)
  b.pressureTimer = 0
  compactFlights(b.flights, combatants)
  // 【wireStations 要在最後】它會依 `instanceof AiController` 重接站位參考，
  // 而上面剛換過控制器
  wireStations(b)
  // 【任務狀態也要重設】少了這一行，「再打一場」會直接開在上一場的結果上，
  // 而撤離的倒數會從 0 開始 —— 開局第一個物理步就判 defeat。
  //
  // 【就地寫回而不是換一個 MissionState】`b.mission` 是 readonly 參考，
  // `main.ts` 與 HUD 每幀讀 `mission.target`。
  // 【規則也要還原】返航節拍換過的話，重開一場要回到卡片上原本那一條
  b.rules = b.cfg.rules
  b.evacOrder = evacOrderOf(b.rules)
  resetMissionState(b.rules, b.mission)
  b.outcome = 'fighting'
  // 【訊息也要清】就地重開的是沒有節拍的關卡；上一場的警戒訊息留著的話，新的一場
  // 沒警戒卻寫著「進入警戒狀態」，而再觸發時鍵沒有變化、畫面不會重播
  b.message = null
  b.messageUntil = 0
  // 【排在最後】要在控制器換回 AI 之後才發巡邏令
  resetAlert(b)
}

/**
 * 玩家的分隊；玩家已退場時回傳 null。
 *
 * 【為什麼不直接讓呼叫端讀 flights】HUD 那一層不該知道編制的內部表示。
 * 這兩個函數是它需要的全部。
 */
export function playerFlight(b: PlayerFormation): Flight | null {
  const f = b.flights.flightOf[b.player.index]!
  return f >= 0 ? b.flights.flights[f]! : null
}

/**
 * 玩家的僚機（`members[1]`）的 `Combatant` 索引；沒有時回傳 −1。
 *
 * 遞補之後它會自動指向新的那一架 —— 因為 `members` 每步都重新壓縮。
 */
export function playerWingman(b: PlayerFormation): number {
  const f = playerFlight(b)
  if (f === null || f.count < 2) return -1
  return f.members[1]!
}
