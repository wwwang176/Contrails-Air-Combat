import { Vector3 } from 'three'
import { World } from '../src/world/World'
import { Aircraft } from '../src/aircraft/Aircraft'
import type { Command, Controller } from '../src/control/Controller'
import { PROJECTILE_CAPACITY, PROJECTILE_LIFETIME } from '../src/world/Projectiles'
import { P51D } from '../src/specs/p51d'
import { BF109K4 } from '../src/specs/bf109k4'

export const LOAD_DT = 1 / 240
export const LOAD_ALTITUDE = 4000
export const LOAD_TAS = 160

/** 恆扣扳機、恆朝機首的控制器。 */
class Blazing implements Controller {
  private readonly aim = new Vector3(0, 0, -1)
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = 0.7
    out.firing = true
  }
}

export interface ProjectileLoadState {
  world: World
}

/**
 * 滿載的彈丸池負載。
 *
 * 【與 M1 的 bench/physics-load.ts 同一個「單一替換點」設計】門檻測試
 * （test/unit/perf-gate.test.ts）與 benchmark（bench/projectiles.bench.ts）
 * 呼叫的是同一份負載定義，改一處、兩邊量到同一份工作量，不會各自維護一份
 * 初始條件而悄悄量到不同的東西。
 *
 * 【為什麼要先塞滿再開始計時】要量的是**滿載**的成本。從空池開始的話，
 * 前 1,000 步量到的是逐漸爬升的存量，平均值會被低估到只有目標的兩成。
 */
export function createProjectileLoad(): ProjectileLoadState {
  const world = new World()
  // 兩架都會重生：不然雙方在 2 秒內互相打爆，之後量到的是「沒有目標可判定」
  // 的空轉，而不是滿載的命中判定成本。
  for (const [spec, team, z] of
    [[P51D, 'blue', 0], [BF109K4, 'red', -800]] as const) {
    const c = world.add(
      new Aircraft(spec, LOAD_ALTITUDE, LOAD_TAS), new Blazing(), team,
      new Vector3(0, LOAD_ALTITUDE, z), LOAD_ALTITUDE, LOAD_TAS,
    )
    c.respawnOnDestroy = true
  }

  const state: ProjectileLoadState = { world }
  fill(state)
  return state
}

/**
 * 把池子灌滿。直接呼叫 spawn 而不是等它自然射滿——1.2 s 的壽命下，
 * 兩架飛機的穩態存量只有 200 發左右，離 4,000 差二十倍。
 */
function fill(state: ProjectileLoadState): void {
  const p = state.world.projectiles
  for (let i = 0; i < PROJECTILE_CAPACITY; i++) {
    // 散開在射手前方一大片，讓命中判定真的要逐盒算而不是第一個就中
    const a = (i / PROJECTILE_CAPACITY) * Math.PI * 2
    p.spawn(
      Math.cos(a) * 40, LOAD_ALTITUDE + Math.sin(a) * 40, -100 - (i % 700),
      Math.cos(a) * 20, Math.sin(a) * 20, -887, 6, 0, 0, PROJECTILE_LIFETIME, 12.7,
    )
    // 【壽命要錯開】全部給 age 0 的話，4,000 發會在同一步一起到期、
    // 再被一起補滿，量到的是週期性的尖峰而不是穩態。
    p.age[i] = (i / PROJECTILE_CAPACITY) * PROJECTILE_LIFETIME
  }
}

export function stepProjectileLoad(state: ProjectileLoadState): void {
  // 壽命會讓存量掉下去，所以每步補回滿載——量的是滿載成本
  const p = state.world.projectiles
  while (p.live < PROJECTILE_CAPACITY) {
    p.spawn(0, LOAD_ALTITUDE, -200, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME, 12.7)
  }
  state.world.step(LOAD_DT)
}

export function resetProjectileLoad(state: ProjectileLoadState): void {
  state.world.projectiles.clear()
  for (const c of state.world.combatants) state.world.respawn(c)
  fill(state)
}
