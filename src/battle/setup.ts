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

    for (let slot = 0; slot < cfg.perSide; slot++) {
      const x = (slot - (cfg.perSide - 1) / 2) * cfg.lateralSpacing
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
