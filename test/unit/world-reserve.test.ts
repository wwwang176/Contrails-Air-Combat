import { describe, it, expect } from 'vitest'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { pushKill } from '../../src/world/kills'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # `World.reserve` —— 中途加人的前提
 *
 * `World.add` 的擴容路徑**只在場景組裝期是安全的**，那句前提就寫在
 * `World.ts` 的註解裡：「【重配就整張清掉】`add` 只發生在場景組裝期，那時
 * 還沒有任何傷害」。
 *
 * ```
 *   killEvents   容量不夠時換成一個空的
 *   damageTime   邊長不夠時整張填 -Infinity
 * ```
 *
 * 戰鬥進行中呼叫 `add` 會踩到兩件事：
 *
 *   一  這一步已經產生、但呼叫端還沒排空的擊墜事件被丟掉 —— 戰績記到了，
 *       爆炸、煙與碎片不見了
 *   二  全場還活著的目標的助攻窗口被抹掉
 *
 * `reserve(n)` 讓容量**在組裝期就一次到位**。之後 `add` 的三個條件都不成立，
 * 於是中途加人不會重配任何東西。
 */

class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

function join(w: World, team: 'blue' | 'red') {
  const ac = new Aircraft(P51D, 4000, 200)
  const c = w.add(ac, new Idle(), team, ac.state.position.clone())
  c.respawnOnDestroy = false
  return c
}

describe('World.reserve', () => {
  it('預留之後，加人不重配 damageTime 也不換掉 killEvents', () => {
    const w = new World()
    w.reserve(4)
    join(w, 'blue')
    join(w, 'red')

    // 【要有東西可以被弄丟】沒有這一段的話，「抹掉」與「本來就是空的」
    // 在斷言上分不出來
    w.time = 12.5
    w.damageTime[0 * w.damageStride + 1] = w.time
    pushKill(w.killEvents, 1, 2, 3, 4, 5, 6, 1, 0)

    const kills = w.killEvents
    const damage = w.damageTime
    const stride = w.damageStride
    const snapshot = Float32Array.from(damage)

    join(w, 'blue')
    join(w, 'red')

    // 【比參考而不是比內容】換掉一個空的 buffer 之後內容也可能碰巧相同，
    // 而持有舊參考的呼叫端（`main.ts` 的爆炸）拿到的就是被丟掉的那一份
    expect(w.killEvents).toBe(kills)
    expect(w.killEvents.count).toBe(1)
    expect(w.damageTime).toBe(damage)
    expect(w.damageStride).toBe(stride)
    expect(Array.from(w.damageTime)).toEqual(Array.from(snapshot))
  })

  it('預留的容量夠大時，damageStride 由 reserve 決定而不是架數', () => {
    const w = new World()
    w.reserve(8)
    join(w, 'blue')
    expect(w.damageStride).toBe(8)
    expect(w.damageTime.length).toBe(64)
  })

  it('沒有預留時維持原本的行為 —— 加人會重配', () => {
    // 【這一條是對照組】沒有它，上面兩條在「reserve 根本沒接上」時也會綠
    const w = new World()
    join(w, 'blue')
    const before = w.damageTime
    join(w, 'red')
    expect(w.damageTime).not.toBe(before)
    expect(w.damageStride).toBe(2)
  })

  it('reserve 比現有架數小時不縮 —— 縮了會讓已經發生的傷害越界', () => {
    const w = new World()
    join(w, 'blue')
    join(w, 'red')
    const stride = w.damageStride
    w.reserve(1)
    expect(w.damageStride).toBe(stride)
  })

  it('reserve 呼叫兩次不重配 —— 冪等', () => {
    const w = new World()
    w.reserve(6)
    const damage = w.damageTime
    const kills = w.killEvents
    w.reserve(6)
    expect(w.damageTime).toBe(damage)
    expect(w.killEvents).toBe(kills)
  })
})
