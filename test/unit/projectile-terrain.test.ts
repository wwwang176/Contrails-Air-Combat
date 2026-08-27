import { describe, it, expect } from 'vitest'
import { Vector3, Quaternion } from 'three'
import { World, SEA_KILL_Y } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createHeightField } from '../../src/world/heightfield'
import type { LandField } from '../../src/world/occlusion'
import { clearImpacts } from '../../src/world/events'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * 彈丸與陸地。
 *
 * 【四條各自擋一個 Codex 審查抓到的坑】
 *
 * ```
 *   海面回歸    高度場沒島的地方是 −8。少了「陸地要 > 0」，入海的子彈會在
 *               水下 8 m 爆火花並提早消失，而不是到 SEA_KILL_Y 才回收
 *   命中優先    同一步「先打中飛機、後進入地面」是合法命中。飛機真的會貼著
 *               坡面飛（甲板實測離地 6 m），而彈丸一步走 3.7~4.5 m
 *   不推傷害    damageEvents 要一個 victim.index。山不是飛機
 *   null 不變   沒有陸地時，這一段程式碼等於不存在
 * ```
 */

/** 一片平的高台：整張圖都是同一個高度 */
function plateau(height: number): LandField {
  const f = createHeightField(16, 40)
  f.data.fill(height)
  return { field: f, ceiling: height }
}

/** 開闊海面：高度場是海床，不是陸地 */
function openSea(): LandField {
  const f = createHeightField(16, 40)
  f.data.fill(-8)
  return { field: f, ceiling: -8 }
}

class Silent implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0
    out.brake = 0
    out.firing = false
  }
}

const DT = 1 / 240
const UP = new Vector3(0, 1, 0)

/** 一發從 (x,y,z) 以 (vx,vy,vz) 出發的彈丸，跑 `steps` 步 */
function fireOne(
  w: World, x: number, y: number, z: number, vx: number, vy: number, vz: number,
  steps: number,
): { hits: number; splashes: number; damage: number; live: number } {
  // 【owner 不能是 −1】那是彈丸池的空槽哨兵，resolveHits 會直接跳過。
  // 給 0：這一支多半沒有 combatants，於是射手是 undefined、陣營 −1，
  // 等於「不做同隊過濾」——正是這幾條想要的
  w.projectiles.spawn(x, y, z, vx, vy, vz, 10, 0)
  let hits = 0
  let splashes = 0
  let damage = 0
  for (let i = 0; i < steps; i++) {
    w.step(DT)
    hits += w.hitEvents.count
    splashes += w.splashEvents.count
    damage += w.damageEvents.count
    clearImpacts(w.hitEvents)
    clearImpacts(w.splashEvents)
    w.damageEvents.count = 0
  }
  return { hits, splashes, damage, live: w.projectiles.live }
}

describe('彈丸撞到陸地', () => {
  it('往高台裡飛 → 火花 + 回收', () => {
    const w = new World()
    w.land = plateau(100)
    const r = fireOne(w, 0, 200, 0, 0, -400, 0, 120)
    expect(r.hits).toBeGreaterThan(0)
    expect(r.live).toBe(0)
  })

  it('撞到陸地不推 damageEvents —— 山不是一架飛機', () => {
    const w = new World()
    w.land = plateau(100)
    const r = fireOne(w, 0, 200, 0, 0, -400, 0, 120)
    expect(r.damage).toBe(0)
  })

  it('land 為 null 時完全不管陸地', () => {
    const w = new World()
    const r = fireOne(w, 0, 200, 0, 0, -400, 0, 120)
    expect(r.hits).toBe(0)
  })

  /**
   * 【這一條是海面回歸】高度場沒有島的地方是 `SEA_FLOOR = −8`。判準若只是
   * 「低於高度場」而不是「低於高度場**而且**高度場高於海平面」，這一發會
   * 在水下 8 m 爆一朵火花並提早消失。
   */
  it('入海的一發：水柱仍在、沒有地形火花、到 SEA_KILL_Y 才消失', () => {
    const w = new World()
    w.land = openSea()
    const r = fireOne(w, 0, 20, 0, 0, -400, 0, 120)
    expect(r.splashes).toBeGreaterThan(0)
    expect(r.hits).toBe(0)
    expect(r.live).toBe(0)
  })

  it('沒有陸地時，水柱與回收深度與 land 為 null 完全相同', () => {
    const a = new World()
    a.land = openSea()
    const ra = fireOne(a, 0, 20, 0, 0, -400, 0, 120)
    const b = new World()
    const rb = fireOne(b, 0, 20, 0, 0, -400, 0, 120)
    expect(ra.splashes).toBe(rb.splashes)
    expect(ra.hits).toBe(rb.hits)
    expect(ra.live).toBe(rb.live)
  })
})

/**
 * 【同一步先中飛機、後進地形】把一架敵機貼在高台上方，彈丸從它上面掠過
 * 之後才入地。那一發必須算命中，不能被判成撞地。
 */
describe('命中與撞地的先後', () => {
  it('先掠過飛機再入地 → 算命中', () => {
    const w = new World()
    w.land = plateau(100)
    const target = new Aircraft(BF109K4)
    // 【只高出地面 2 m】要讓「打中機體」與「入地」落在**同一個物理步**裡，
    // 兩者的距離就得小於一步。900 m/s 下一步是 3.75 m
    target.state.position.set(0, 102, 0)
    target.state.orientation.copy(new Quaternion().setFromAxisAngle(UP, 0))
    target.state.velocity.set(0, 0, 0)
    w.add(target, new Silent(), 'red', target.state.position.clone(), 102, 0)

    const before = w.combatants[0]!.hp
    // 【起點要讓步長邊界剛好落在地面上】240 Hz、900 m/s 下一步是 3.75 m。
    // 由 190 出發，第 24 步的終點恰好是 100.0 —— 也就是那一步的線段
    // 103.75 → 100.0 **同時**穿過機體與地面。這一條要驗的就是那一步。
    //
    // 沒有這個對齊的話命中會落在更早的一步（機體命中盒的頂在 103 以上），
    // 而那一步根本沒碰到地面 —— 測試就變成永遠綠、什麼都不擋。
    w.projectiles.spawn(0, 190, 0, 0, -900, 0, 25, 1)
    for (let i = 0; i < 40; i++) w.step(DT)
    expect(w.combatants[0]!.hp).toBeLessThan(before)
  })
})

/** 玩家與 AI 的固定槍都走 `World.fire`，所以只要 `land` 接好就一起生效 */
describe('接線', () => {
  it('World 預設沒有陸地', () => {
    expect(new World().land).toBeNull()
  })

  it('SEA_KILL_Y 沒有被動到', () => {
    expect(SEA_KILL_Y).toBe(-20)
  })

  it('P-51D 存在（fixture 的健全性）', () => {
    expect(P51D.id).toBe('p51d')
  })
})
