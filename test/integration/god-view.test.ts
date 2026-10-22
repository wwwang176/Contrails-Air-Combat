import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createBattle, stepBattle,
  DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { AiController } from '../../src/ai/AiController'
import { commandExemptFlight } from '../../src/battle/commandLayer'
import type { FlightOrder } from '../../src/ai/commandTypes'
import {
  createGodCameraState, stepGodCamera, type GodCameraInput,
} from '../../src/camera/godCamera'
import { replayDigest } from '../tools/spawn-snapshot'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
/**
 * 中立性那兩場的長度，s。比的是逐位元的狀態校驗和，分歧在幾個物理步內
 * 就顯示得出來。
 */
const NEUTRAL_SECONDS = 20

/** 人類座位的替身：平飛、不參戰。代表「有人在操縱」 */
class Human implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

/**
 * 藍隊兩支分隊（玩家在第 1 支）、紅隊一支。同一個指揮官底下才分得出
 * 「玩家那一支被跳過」與「整個指揮官停了」。
 */
function twoBlueFlights(player: Controller): Battle {
  return createBattle(player, {
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 8, BF109K4, 4),
  })
}

/** 20 km 外的集合令：幾步之內不會判到達 */
function farRally(from: Vector3): FlightOrder {
  return {
    kind: 'rally', point: from.clone().add(new Vector3(0, 0, 20000)), radius: 300,
    targetFlight: -1, side: 0, focusIndex: -1,
  }
}

/**
 * 規則：座位上沒有人類，就沒有人會跟指揮官搶操縱，玩家那一支照樣受命
 * （第一份 spec §2.1）。由 `commandExemptFlight` 以 `instanceof AiController`
 * 推導。接手後 `flights.pinned` 跟著新座位走，由 `battle-setup.test.ts` 的
 * 接手與重開那幾條守；`stepCommand` 不對被跳過的分隊發令，由
 * `ai-command.test.ts` 守。
 */
describe('指揮權跟著座位上的控制器走', () => {
  it('座位坐 AiController → 沒有豁免的分隊', () => {
    expect(commandExemptFlight(twoBlueFlights(new AiController()))).toBe(-1)
  })

  it('座位坐人類控制器 → 豁免玩家所在的那一支', () => {
    const b = twoBlueFlights(new Human())
    const f = b.flights.flightOf[b.flights.pinned]!
    expect(f).toBeGreaterThanOrEqual(0)
    expect(commandExemptFlight(b)).toBe(f)
  })

  /**
   * 【守的是 `stepCommandLayer` 把豁免交給指揮官那一段】上面兩條只驗推導；
   * 推導對了、卻沒傳進 `stepCommand` 的話，人在飛的那一支照樣被指揮官
   * 拉走。兩支藍隊分隊都塞一張遠方集合令，推一步：人類座位時玩家那一支
   * 被清掉、另一支留著；AiController 座位時兩支都留著。
   */
  it('推一步：人類座位的那一支命令被清掉，同隊另一支與代飛時的那一支照留', () => {
    for (const human of [true, false]) {
      const b = twoBlueFlights(human ? new Human() : new AiController())
      const mine = b.flights.flightOf[b.flights.pinned]!
      const other = b.flights.flights.findIndex((fl, i) => fl.team === 'blue' && i !== mine)
      expect(other).toBeGreaterThanOrEqual(0)
      const lead = (f: number): Vector3 =>
        b.world.combatants[b.flights.flights[f]!.members[0]!]!.aircraft.state.position
      const mineOrder = farRally(lead(mine))
      const otherOrder = farRally(lead(other))
      b.blueCommand.orders[mine] = mineOrder
      b.blueCommand.orders[other] = otherOrder
      stepBattle(b, DT)
      expect(b.blueCommand.orders[other]).toBe(otherOrder)
      expect(b.blueCommand.orders[mine]).toBe(human ? null : mineOrder)
    }
  })
})

describe('鏡頭不得改變戰局（4v4、20 秒、兩場）', () => {
  /**
   * 【這條護欄實際在守什麼】它看起來近乎恆真 —— `godCamera.ts` 不 import
   * `src/battle/`，怎麼可能改到戰局？但這個專案裡有一個真的會踩到的機制：
   * **模組層級的共用暫存池**（`core/pool.ts` 的 `makeScratch`，`src/ai/` 與
   * `CameraRig` 都在用）。鏡頭若借用了別人的池子，就會在別人用到一半時把
   * 內容改掉，而症狀是「戰局悄悄變了」而不是任何錯誤。
   *
   * 對照挑代飛對代飛：代飛本身會改戰局（那是它該做的），而鏡頭不該。
   *
   * 它**守不到** `main.ts` 的算繪路徑（`terrain.update` 的中心點接錯之類），
   * 那一段沒有無頭測試 —— 由 Playwright 驗收補（spec §8.6）。
   *
   * 【為什麼比的是完整狀態校驗和，不是掉血】掉血只在子彈命中時才動，所以
   * 要先讓兩隊接敵、開火，才看得出分歧 —— 那是一場 20v20 打滿 120 秒。
   * `replayDigest` 涵蓋每一架的位置、姿態、角速度、作動器、血量與彈丸池，
   * 位置每一步都在變，**分歧在幾個物理步內就顯示得出來**。同一件事守得
   * 更嚴，而且 4v4 × 20 秒就夠。
   */
  async function run(stepCamera: boolean): Promise<string> {
    const b = createBattle(new AiController(), {
      ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 4, BF109K4, 4),
    })
    const cam = createGodCameraState()
    const input: GodCameraInput = {
      forward: true, back: false, left: false, right: true,
      up: true, down: false, boost: true, lookX: 0.01, lookY: -0.005,
    }
    for (let s = 0; s < NEUTRAL_SECONDS * 240; s++) {
      stepBattle(b, DT)
      if (stepCamera) stepGodCamera(cam, input, DT)
    }
    return replayDigest(b)
  }

  it('推進上帝鏡頭不改變任何一架的狀態', async () => {
    expect(await run(true)).toBe(await run(false))
  }, 5 * 60 * 1000)
})
