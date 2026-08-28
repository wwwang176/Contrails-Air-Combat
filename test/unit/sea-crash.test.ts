import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { CRASH_CLEARANCE } from '../../src/aircraft/crash'
import { flatSeaCrashPolicy } from '../../src/world/seaCrash'
import { createTerrain } from '../../src/render/terrain'
import { createArchipelago } from '../../src/world/archipelago'
import { gerstnerHeight, WAVES } from '../../src/render/ocean'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * 海面的碰撞體是**平面**，浪只是視覺高低。
 *
 * 【為什麼要走真正的 `World.crashPolicy → destroy`】只測
 * `Terrain.collisionHeightAt` 的話，`main.ts` 忘了由 `heightAt` 換過去仍然
 * 全綠 —— 那正是這一輪最可能的靜默失效（Codex 2026-08-28 審查抓到的）。
 * 這裡把政策裝進一個真的 `World` 裡，讓判定經過它自己的退場路徑。
 */

const DT = 1 / 240

/** 不下任何指令的控制器 —— 這一檔要的是「擺在那裡，然後 step 一次」 */
class Still implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0
    out.firing = false
  }
}

/** 把一架擺在 (x, y, z)，step 一次，回它還活著沒有 */
function survives(policy: ReturnType<typeof flatSeaCrashPolicy>, y: number): boolean {
  const world = new World()
  world.crashPolicy = policy
  const a = new Aircraft(P51D, 1000, 100)
  const c = world.add(a, new Still(), 'blue', new Vector3(0, 1000, 0), 1000, 100)
  a.state.position.set(0, y, 0)
  a.prevPosition.copy(a.state.position)
  world.step(DT)
  return c.alive
}

describe('海面的碰撞體是平面', () => {
  const sea = flatSeaCrashPolicy(() => 0)

  /**
   * 【門檻是 `CRASH_CLEARANCE`，不是 0】`isCrashed` 加了半個機身高度的餘裕，
   * 而這一條沿用它。說成「y ≤ 0」是不精確的。
   */
  it('門檻正好在 CRASH_CLEARANCE 上', () => {
    expect(survives(sea, CRASH_CLEARANCE + 0.01)).toBe(true)
    expect(survives(sea, CRASH_CLEARANCE - 0.01)).toBe(false)
  })

  /**
   * 【這一條是「浪不參與判定」的充要條件】浪的振幅和是好幾公尺，所以若判定
   * 讀的是波高，一定找得到兩個同高度但判定相反的水平位置。找不到才對。
   *
   * 掃的高度刻意選在波峰與波谷之間 —— 那正是「讀波高」與「讀平面」會分歧的
   * 那一段。
   */
  it('同一個高度，走到哪裡判定都一樣', () => {
    const maxAmp = WAVES.reduce((s, w) => s + w.amplitude, 0)
    const y = CRASH_CLEARANCE + maxAmp / 2
    // 先確認這個高度真的落在浪的起伏之內 —— 否則這條測試是空的
    let above = false
    let below = false
    for (let i = 0; i < 400; i++) {
      const h = gerstnerHeight(i * 31.7, i * 17.3, 4.5) + CRASH_CLEARANCE
      if (h > y) above = true
      if (h < y) below = true
    }
    expect(above, '這個高度沒有落在浪的起伏之內，測試是空的').toBe(true)
    expect(below).toBe(true)

    // 而平面政策在那 400 個位置上判定完全一致
    for (let i = 0; i < 400; i++) {
      const p = new Vector3(i * 31.7, y, i * 17.3)
      expect(sea({ aircraft: { state: { position: p } } } as never)).toBe(false)
    }
  })
})

describe('陸地還是撞得到', () => {
  /**
   * 【平面只換掉海那一項】山是靜態的高度場，判定照樣讀它 —— 不然飛機會穿山。
   */
  it('島上的判定高度等於高度場，海上是 0', () => {
    const terrain = createTerrain('archipelago')
    const arch = createArchipelago()
    const isl = arch.islands[0]!
    expect(terrain.collisionHeightAt(isl.cx, isl.cz))
      .toBeCloseTo(arch.field.sample(isl.cx, isl.cz), 6)
    expect(terrain.collisionHeightAt(isl.cx, isl.cz)).toBeGreaterThan(500)
    // 場地之外：高度場出界回 −Infinity，判定高度要退回平海面
    expect(terrain.collisionHeightAt(1e7, 1e7)).toBe(0)
    terrain.dispose()
  })

  it('純海面的判定高度處處是 0', () => {
    const terrain = createTerrain('sea')
    for (const [x, z] of [[0, 0], [1234, -5678], [-99999, 42]]) {
      expect(terrain.collisionHeightAt(x!, z!)).toBe(0)
    }
    terrain.dispose()
  })

  /**
   * 【海床不得把飛機打下來】高度場沒有島的地方是 `SEA_FLOOR = −8`。
   * `max(h, 0)` 少了的話判定高度會變成 −8，貼海飛的飛機要沉到水下 6 m
   * 才算撞海 —— 症狀是「明明入水了卻沒事」。
   */
  it('海床（−8）不會變成判定高度', () => {
    const terrain = createTerrain('archipelago')
    const arch = createArchipelago()
    // 找一個高度場是海床的位置
    let found = false
    for (let x = -14000; x <= 14000 && !found; x += 137) {
      if (arch.field.sample(x, 0) < -1) {
        expect(terrain.collisionHeightAt(x, 0)).toBe(0)
        found = true
      }
    }
    expect(found, '找不到海床的位置，測試是空的').toBe(true)
    terrain.dispose()
  })
})
