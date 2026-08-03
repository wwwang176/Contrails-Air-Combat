import { Quaternion, Vector3 } from 'three'
import { World, type Combatant } from '../world/World'
import { Aircraft } from '../aircraft/Aircraft'
import { AiController } from '../ai/AiController'
import { createTargetBoard, type TargetBoard } from '../ai/target'
import { P51D } from '../specs/p51d'
import { BF109G6 } from '../specs/bf109g6'
import type { Controller } from '../control/Controller'

/**
 * 一場戰鬥的編制與出生幾何。
 *
 * **`entryRange` / `lateralSpacing` / `altitudeSpread` / `resetCountdown`
 * 是起始值，待門檻回填任務由實測定案**（M5 spec §13）。
 */
export interface BattleConfig {
  /** 每隊架數。專案負責人裁決：M5 固定 20（spec §2） */
  perSide: number
  altitude: number
  tas: number
  /** 兩隊重心的初始距離，m */
  entryRange: number
  /** 同隊相鄰兩架的橫向間距，m */
  lateralSpacing: number
  /**
   * 兩隊重心的橫向錯開量，m。藍隊 −offset/2、紅隊 +offset/2。
   *
   * 【為什麼一定要有】0 的時候藍 slot k 與紅 slot k 在 Z 軸上完全共線、
   * 高度層也一樣（`altitudeOffset` 對兩隊是同一個函數），整場仗變成 20 場
   * 精準的對頭槍戰 —— 而那正是 P-51 的六挺翼槍最差的區間（匯聚點在 300 m，
   * 這種仗打在 660–1,000 m）。實測：藍隊每 9 秒被零損失全滅一次，60 秒內
   * 七次；有效命中率藍 34% 對紅 97%。
   *
   * 【數值怎麼來的】`fire.ts` 的 `trackingCone` 是 3°，是扣扳機前的最後一關。
   * 橫向間隔小於 `entryRange × tan(3°)` 的兩隊，從出生那一刻就在彼此的射擊
   * 錐內 —— 3,000 m 下是 **157 m**。實測的懸崖落在 120 m（兩次全滅）與
   * 180 m（零全滅）之間，與這個預測一致。取兩倍為設計值。
   *
   * 【不是「間距的整數倍會共線」】那個假說被實測推翻：60 m（0.5 倍間距）
   * 與 120 m（1 倍）都一樣糟，而 240/360/480/600 全是整數倍卻都沒事。
   * 決定性的是絕對大小，不是與間距的公因數。
   */
  lateralOffset: number
  /** 高度散布的半幅，m */
  altitudeSpread: number
  /** 一方全滅後到重置的秒數 */
  resetCountdown: number
}

export const DEFAULT_BATTLE: BattleConfig = {
  perSide: 20,
  altitude: 4000,
  tas: 200,
  entryRange: 3000,
  lateralSpacing: 120,
  lateralOffset: 300,
  altitudeSpread: 300,
  resetCountdown: 3,
}

export interface Battle {
  readonly world: World
  readonly board: TargetBoard
  readonly blue: Combatant[]
  readonly red: Combatant[]
  /** 玩家那一架。恆在 `blue` 裡 */
  readonly player: Combatant
  readonly cfg: BattleConfig
  /**
   * 每一架的開局姿態。重置時抄回去。
   *
   * 【為什麼要另外存】`World.respawn` 走的是 `Aircraft.reset`，它重建的是
   * 一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
   */
  readonly spawnOrientations: Quaternion[]
  /** 重置倒數的剩餘秒數；> 0 代表戰鬥已分出結果 */
  countdown: number
}

const UP = new Vector3(0, 1, 0)
const FWD = new Vector3(0, 0, -1)

/**
 * 高度散布：把 slot 映到 [−1, 1] 的鋸齒。
 *
 * 【為什麼不是亂數】M5 spec §3.1 條件 7 要求決定性 —— 同一組設定跑兩次要
 * 逐幀一致。亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉決定性；而這裡
 * 真正要的只是「別讓 20 架擠在同一個高度」，鋸齒就夠了。
 *
 * 【週期取 5 而不是 2】2 只會產生兩個高度層 —— 那在畫面上看起來是兩排整齊
 * 的飛機，不是一團散開的機群。
 */
function altitudeOffset(slot: number, spread: number): number {
  const cycle = slot % 5
  return ((cycle / 4) * 2 - 1) * spread
}

/**
 * 造一場 N vs N。
 *
 * 【玩家固定在藍隊中央】開局視野裡兩側都是友機、敵機在正前方 —— 與 M2
 * 「靶機擺正前方 400 m」同一個理由：看得到才算存在。
 */
export function createBattle(
  playerController: Controller, cfg: BattleConfig = DEFAULT_BATTLE,
): Battle {
  const world = new World()
  const blue: Combatant[] = []
  const red: Combatant[] = []
  const playerSlot = Math.floor(cfg.perSide / 2)
  let player: Combatant | null = null

  // 藍隊在 +Z、機首朝 −Z；紅隊在 −Z、機首朝 +Z（繞 Y 轉 π）
  for (const side of ['blue', 'red'] as const) {
    const blueSide = side === 'blue'
    const z = blueSide ? cfg.entryRange / 2 : -cfg.entryRange / 2
    const yaw = blueSide ? 0 : Math.PI
    const orientation = new Quaternion().setFromAxisAngle(UP, yaw)
    const velocity = FWD.clone().applyQuaternion(orientation).multiplyScalar(cfg.tas)

    // 對稱錯開，戰場才會維持以原點為中心（相機與小地圖都吃這個）
    const lateral = (blueSide ? -1 : 1) * cfg.lateralOffset / 2

    for (let slot = 0; slot < cfg.perSide; slot++) {
      const x = (slot - (cfg.perSide - 1) / 2) * cfg.lateralSpacing + lateral
      const y = cfg.altitude + altitudeOffset(slot, cfg.altitudeSpread)
      const spec = blueSide ? P51D : BF109G6
      const aircraft = new Aircraft(spec, y, cfg.tas)
      aircraft.state.position.set(x, y, z)
      aircraft.state.orientation.copy(orientation)
      aircraft.state.velocity.copy(velocity)
      aircraft.prevPosition.copy(aircraft.state.position)
      aircraft.prevOrientation.copy(orientation)

      const isPlayer = blueSide && slot === playerSlot
      const controller = isPlayer ? playerController : new AiController()
      const c = world.add(
        aircraft, controller, side, aircraft.state.position.clone(), y, cfg.tas,
      )
      // 【一律不重生】一方全滅要能被偵測到，重生會讓那件事永遠不發生
      c.respawnOnDestroy = false
      if (isPlayer) player = c
      ;(blueSide ? blue : red).push(c)
    }
  }

  if (player === null) throw new Error('玩家沒有被建立——perSide 必須 >= 1')

  // 【指派板必須在全部 add 完之後才建】它會檢查 index 與陣列位置一致，
  // 而 index 是 add 依序給的
  const board = createTargetBoard(world.combatants)

  // AI 接線：指派板、自身索引、決策相位
  for (const c of world.combatants) {
    const ai = c.controller
    if (!(ai instanceof AiController)) continue
    ai.board = board
    ai.selfIndex = c.index
    // 【相位依索引攤平】40 架的包絡查詢因此不會擠在同一個物理步
    ai.setDecisionPhase(c.index / world.combatants.length)
  }

  return {
    world,
    board,
    blue,
    red,
    player,
    cfg,
    spawnOrientations: world.combatants.map((c) => c.aircraft.state.orientation.clone()),
    countdown: 0,
  }
}

/** 還活著的架數。 */
export function aliveCount(cs: readonly Combatant[]): number {
  let n = 0
  for (let i = 0; i < cs.length; i++) if (cs[i]!.alive) n++
  return n
}

/**
 * 推進一場戰鬥：世界一步，加上全滅倒數與重置。
 *
 * 【倒數而不是立刻重置】一方被打光的瞬間直接換場，玩家會以為遊戲當掉了
 * （M5 spec §3.2 條件 15）。倒數是唯一的新狀態 —— 這是「零選單、零狀態機」
 * 這條 M2 紀律在多機下還能延續的方式。
 */
export function stepBattle(b: Battle, dt: number): void {
  b.world.step(dt)

  // 【退場的飛機要放掉它自己的指派】`World.step` 跳過退場者的控制器，所以
  // `selectTarget` 永遠沒機會替它把槽位歸 −1（M5 spec §7）。不清的話那筆
  // 指派會留到重置為止 —— `countLocks` 有跳過退場者所以不影響統計，但它是
  // 一筆會騙人的狀態，而且 spec 明寫要歸零。
  const cs = b.world.combatants
  const assignments = b.board.assignments
  for (let i = 0; i < cs.length; i++) {
    if (!cs[i]!.alive) assignments[i] = -1
  }

  if (b.countdown > 0) {
    b.countdown -= dt
    if (b.countdown <= 0) {
      b.countdown = 0
      resetBattle(b)
    }
    return
  }

  if (aliveCount(b.blue) === 0 || aliveCount(b.red) === 0) {
    b.countdown = b.cfg.resetCountdown
  }
}

/**
 * 整場回到滿編。
 *
 * 【與 R 鍵共用同一條路徑】兩份長得很像的初始化，就是只有一份會被修好的
 * 那種危險 —— 與 `Aircraft.respawn`、`World.destroy` 是同一個理由。
 */
export function resetBattle(b: Battle): void {
  b.world.projectiles.clear()
  const combatants = b.world.combatants
  for (let i = 0; i < combatants.length; i++) {
    const c = combatants[i]!
    b.world.respawn(c)
    // 【方位與速度要另外抄回去】`World.respawn` 走的是 `Aircraft.reset`，
    // 它重建的是一個「朝預設方向平飛」的狀態，不知道紅隊該朝 +Z。
    const q = b.spawnOrientations[i]!
    c.aircraft.state.orientation.copy(q)
    c.aircraft.prevOrientation.copy(q)
    c.aircraft.state.velocity.copy(FWD).applyQuaternion(q).multiplyScalar(c.spawnTas)
  }
  b.board.assignments.fill(-1)
  b.countdown = 0
}
