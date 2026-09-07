import { describe, it, expect } from 'vitest'
import {
  commandExemptFlight, createBattle, stepBattle,
  DEFAULT_BATTLE, type Battle,
} from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { AiController } from '../../src/ai/AiController'
import {
  createGodCameraState, stepGodCamera, type GodCameraInput,
} from '../../src/camera/godCamera'
import { replayDigest } from '../tools/spawn-snapshot'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 120
/**
 * 中立性那兩場的長度，s。
 *
 * 【為什麼比上面那兩條短這麼多】它比的是逐位元的狀態校驗和，分歧在幾個
 * 物理步內就顯示得出來；上面兩條要等指揮官真的排到命令，那需要整場仗。
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
 * 玩家那一支分隊當下有沒有命令。
 *
 * 【一定要守 `flightOf < 0`】`compactFlights` 把死者的 `flightOf` 填 −1，
 * 而玩家陣亡到接手之間有整整兩秒（`takeover.ts` 的 `TAKEOVER_DELAY`）。
 * `orders` 是一般陣列，`orders[-1]` 是 `undefined`，而 `undefined !== null`
 * 為**真** —— 少了這個守衛，陣亡的每一格都會被算成「拿到命令」，於是這
 * 一整組測試在實作之前就是綠的。
 */
function hasOrder(b: Battle): boolean {
  const f = b.flights.flightOf[b.flights.pinned]
  if (f === undefined || f < 0) return false
  return (b.blueCommand.orders[f] ?? null) !== null
}

/** 跑一場，回傳玩家那一支分隊「拿到過命令」的步數 */
function orderedSteps(playerController: Controller): number {
  const b = createBattle(playerController)
  let n = 0
  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)
    if (hasOrder(b)) n++
  }
  return n
}

describe('指揮權跟著代飛走（20v20、120 秒）', () => {
  /**
   * 【為什麼用 `instanceof` 推導而不是加一個旗標】規則本身就是「座位上
   * 沒有人類，就沒有人會跟指揮官搶操縱」。推導比鏡射安全 —— 鏡射要求
   * 每一條會改變狀態的路徑都記得更新，漏掉任何一條就留下一個永遠不消失
   * 的幽靈狀態（`setup.ts` 的既有註解）。
   */
  /**
   * 【斷言打在規則上，不打在排程結果上】原版斷言「120 秒內玩家分隊拿到
   * 過命令」—— 那是混沌量：空層鎖上線後這一場裡玩家那支整場接戰、指揮官
   * 從來沒有理由輪到它（`god-order.probe.ts`：其他分隊拿到三萬步的命令，
   * 玩家那支 0，接線完好）。規則「座位是 AiController → 不豁免」是確定
   * 的，直接驗 `commandExemptFlight`；「指揮迴路活著」則由「有任何分隊
   * 拿到命令」守住。
   */
  it('玩家座位坐 AiController → 玩家分隊不在豁免名單，命令照發', () => {
    const b = createBattle(new AiController())
    let anyOrdered = 0
    for (let s = 0; s < SECONDS * 240; s++) {
      stepBattle(b, DT)
      if (s % 240 === 0) expect(commandExemptFlight(b)).toBe(-1)
      if (anyOrdered === 0
        && b.blueCommand.orders.some((o) => o !== null && o !== undefined)) {
        anyOrdered = s
      }
    }
    console.log(JSON.stringify({ anyOrderedAt: anyOrdered / 240 }))
    expect(anyOrdered).toBeGreaterThan(0)
  }, 10 * 60 * 1000)

  /**
   * 【第一份 spec §2.1】座位上有人類時指揮官永遠不碰那一支。
   *
   * 人類替身平飛不還手，120 秒內幾乎一定會被打下來 —— 那不影響這一條：
   * 接手之後 `playerController` 會被裝到新座位上（`takeover.ts`），
   * `flights.pinned` 跟著走，所以「座位上是人類」始終成立。中間那兩秒由
   * `hasOrder` 的 `flightOf < 0` 守衛跳過。
   */
  it('玩家座位坐人類控制器 → 整場一次都拿不到命令', () => {
    expect(orderedSteps(new Human())).toBe(0)
  }, 10 * 60 * 1000)
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
