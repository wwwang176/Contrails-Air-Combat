import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 120

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
  it('玩家座位坐 AiController → 玩家那一支分隊拿得到命令', () => {
    const n = orderedSteps(new AiController())
    console.log(JSON.stringify({ orderedSteps: n }))
    expect(n).toBeGreaterThan(0)
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
