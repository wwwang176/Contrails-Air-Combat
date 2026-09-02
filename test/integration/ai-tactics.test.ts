import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, stepBattle, resetBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { PlayerController } from '../../src/control/PlayerController'
import { createInputState } from '../../src/input/InputState'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { DEFAULT_TACTICS } from '../../src/ai/tactics'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import { applyFeel, feelFor } from '../../src/specs/feel'
import type { Command, Controller } from '../../src/control/Controller'
import type { Battery } from '../../src/weapons/types'
import type { AircraftSpec } from '../../src/specs/types'
import type { TacticalPhase } from '../../src/ai/tactics'

const DT = 1 / 240
const SEED = 20260805

/**
 * # 戰術層（boom & zoom）的接線
 *
 * ## 這一份守的是接線，不是戰局
 *
 * 相位機本身在 `test/unit/ai-tactics.test.ts` 逐條驗過（含「一整圈跑得完」）——
 * 那一份直接餵 `TacticalInput`，不經過飛機。這一份補的是**中間那一段**：
 * `AiController` 有沒有把真實態勢填成合法的輸入、相位有沒有回頭改變 `intent`。
 *
 * ## 為什麼是靶機而不是 20v20
 *
 * 「20v20 跑 150 秒，至少有一架完成過一整圈」量的是**戰場的產物**：它同時
 * 吃編成、開局速度、目標選擇、僚機站位與四十架的互相干擾。任何一項改動都
 * 會讓它翻面，而翻面的時候分不出是「相位機壞了」還是「這一局剛好沒人有
 * 機會做這個動作」——兩者要靠完全不同的手段修。
 *
 * 靶機場景把那些變因全部拿掉：兩架、固定幾何、靶機直線平飛。相位機跑不完
 * 一圈，就真的是相位機或接線壞了。
 *
 * ## 為什麼是對頭而不是尾追
 *
 * `dive → zoom` 的條件是**接近率翻負持續 `passSeconds`**，也就是「真的飛過
 * 目標了」。尾追幾何下獵人跟在後面，接近率不會翻負 —— 實測四種尾追配置
 * 全部卡在 `dive` 直到 `diveMax` 到期轉 `cooldown`。對頭則必然穿過，
 * 這是 boom & zoom 的定義本身要求的幾何。
 *
 * ## 高度差為什麼取 0
 *
 * 獵人高 1,000／2,000 m 時停在 `perch` 直到 `perchMax` 到期 —— 它有能量
 * 優勢卻等不到承諾的理由（靶機等速直線，`psTarget` 不會轉負）。等高對頭
 * 是這個場景裡唯一會走完整圈的幾何，而走得完就夠了：這一份要證明的是
 * 「接線通了」，不是「每一種幾何都會做這個動作」。
 */

const FWD = new Vector3(0, 0, -1)

/** 同一副武器，單發傷害歸零 —— 靶機不會被打掉，觀察窗才不會被截斷 */
function blunt(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}

/** 靶機：直線平飛，不閃、不打、不反應 */
class Drone implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

/** 擺一架在 (0, alt, z)，機首朝 −Z（`sign = 1`）或 +Z（`sign = −1`） */
function place(spec: AircraftSpec, alt: number, z: number, tas: number, sign: number): Aircraft {
  const feeled = applyFeel(spec, feelFor(spec))
  const a = new Aircraft({ ...feeled, battery: blunt(feeled.battery) }, alt, tas)
  const dir = new Vector3(0, 0, -sign)
  a.state.position.set(0, alt, z)
  a.state.velocity.copy(dir).multiplyScalar(tas)
  a.state.orientation.setFromUnitVectors(FWD, dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  return a
}

interface Hunt {
  /** 相位的變化序列，連續重複已經壓掉 */
  seq: TacticalPhase[]
  /** `dive` 相位的取樣數 */
  dive: number
  /** 其中 `intent === 'engage'` 的取樣數 */
  diveEngage: number
  /** 其中被 `defendLatch`／`extendFloorLatch` 讓位掉的取樣數 */
  yielded: number
}

const ALTITUDE = 4000

/**
 * 一架 Bf 109（AI、戰術層開著）對上一架直線平飛的 P-51 靶機，對頭。
 *
 * @param gapZ  獵人的起始 z，靶機固定在 −3,000 —— 兩者的間距
 */
function hunt(gapZ: number, tas: number, quota: number, seconds = 180): Hunt {
  const world = new World()
  const drone = place(P51D, ALTITUDE, -3000, 150, 1)
  const hunter = place(BF109K4, ALTITUDE, gapZ, tas, -1)
  const ai = new AiController()
  const dc = world.add(drone, new Drone(), 'red', drone.state.position.clone(), ALTITUDE, 150)
  const hc = world.add(hunter, ai, 'blue', hunter.state.position.clone(), ALTITUDE, tas)
  dc.respawnOnDestroy = false
  hc.respawnOnDestroy = false
  // 【`Combatant` 就是 `TargetCandidate`】`setup.ts` 也是直接餵
  // `world.combatants`。沒有板子的話 `hasSlot` 拿不到隊內序號，戰術層恆為 off
  ai.board = createTargetBoard(world.combatants)
  ai.selfIndex = hc.index
  ai.tacticalConfig = { ...DEFAULT_TACTICS, quota }

  const out: Hunt = { seq: [], dive: 0, diveEngage: 0, yielded: 0 }
  for (let k = 0; k < Math.round(seconds / DT); k++) {
    world.step(DT)
    const p = ai.tactics.phase
    if (out.seq[out.seq.length - 1] !== p) out.seq.push(p)
    if (p !== 'dive') continue
    out.dive++
    // 戰術層讓位給 defend 與絕對能量見底（見 `AiController` 的優先序註解）
    if (ai.rules.defendLatch || ai.rules.extendFloorLatch) out.yielded++
    else if (ai.intent === 'engage') out.diveEngage++
  }
  return out
}

const CYCLE: TacticalPhase[] = ['build', 'perch', 'dive', 'zoom', 'build']

/** 序列裡有沒有出現完整的一圈 */
function completesCycle(seq: readonly TacticalPhase[]): boolean {
  for (let i = 0; i + CYCLE.length <= seq.length; i++) {
    let ok = true
    for (let j = 0; j < CYCLE.length; j++) {
      if (seq[i + j] !== CYCLE[j]) { ok = false; break }
    }
    if (ok) return true
  }
  return false
}

/** 兩種間距 × 兩種獵人速度 —— 四組都要走完整圈，不是挑一個剛好的點 */
const CASES: readonly (readonly [number, number])[] = [
  [2000, 150], [2000, 200], [4000, 150], [4000, 200],
]

describe('戰術層的接線（靶機、對頭、180 秒）', () => {
  it.each(CASES)('間距 %d m、獵人 %d m/s：一整圈跑得完', (gapZ, tas) => {
    const h = hunt(gapZ, tas, 1)
    expect(completesCycle(h.seq)).toBe(true)
  }, 60_000)

  it.each(CASES)('間距 %d m、獵人 %d m/s：dive 期間 intent 一律是 engage', (gapZ, tas) => {
    const h = hunt(gapZ, tas, 1)
    // 【先證明場景成立】沒有這一條的話，`dive` 一次都沒進的場景也會是綠的
    expect(h.dive).toBeGreaterThan(0)
    // 【不是比例而是逐格】沒有門檻可以被調鬆 —— 讓位的那幾格已經另外扣掉
    expect(h.diveEngage + h.yielded).toBe(h.dive)
  }, 60_000)

  it('quota = 0 的對照組：同一個場景一次都不進戰術層', () => {
    // 【它擋的是「這幾條其實沒在量戰術層」】上面兩條若因為別的理由變綠，
    // 這一條會跟著綠 —— 兩者一起看才分得出名額真的是開關
    const h = hunt(2000, 200, 0)
    expect(h.seq).toEqual(['off'])
    expect(h.dive).toBe(0)
  }, 60_000)
})

describe('戰術層在整場對局裡的重置', () => {
  function battle(quota: number) {
    const card = MISSIONS.allies.find((c) => c.id === 'allies-intercept')!
    const b = createBattle(
      new PlayerController(createInputState()), missionConfigFrom(card, 'allies'), SEED,
    )
    for (const c of b.world.combatants) {
      if (c.controller instanceof AiController) {
        c.controller.tacticalConfig = { ...DEFAULT_TACTICS, quota }
      }
    }
    return b
  }

  it('rematch 之後戰術狀態是乾淨的', () => {
    const b = battle(1)
    // 【要問「曾經離開過」，不是「此刻在不在」】`off` 的佔時約九成，取一個
    // 瞬間看「有沒有人不在 off」是在賭機率 —— 17 架同時都在 off 的機率約
    // 兩成，任何無關的軌跡擾動都會讓這條隨機紅。
    let busy = false
    for (let k = 0; k < Math.round(60 / DT); k++) {
      stepBattle(b, DT)
      if (busy) continue
      busy = b.world.combatants.some((c) =>
        c.controller instanceof AiController && c.controller.tactics.phase !== 'off')
    }
    // 先確認機制真的動過 —— 否則這一條會在機制沒接上時也是綠的
    expect(busy).toBe(true)

    resetBattle(b, SEED)
    for (const c of b.world.combatants) {
      if (c.controller instanceof AiController) {
        expect(c.controller.tactics.phase).toBe('off')
        expect(c.controller.tactics.dwell).toBe(0)
        expect(c.controller.tactics.dryRounds).toBe(0)
      }
    }
  }, 300_000)
})
