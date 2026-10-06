import { LoadController } from './load-controller'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../src/battle/setup'
import { PROJECTILE_CAPACITY, PROJECTILE_LIFETIME } from '../src/world/Projectiles'

export const LOAD_DT = 1 / 240

export interface MultiLoadState {
  battle: Battle
}

/**
 * 20v20 × 滿載 4,000 發的負載。
 *
 * 【與 M1 的 physics-load、M2 的 projectile-load、M4 的 ai-load 同一個
 * 「單一替換點」設計】門檻測試與 benchmark 呼叫同一份負載定義，改一處、
 * 兩邊量到同一份工作量，不會各自維護一份初始條件而悄悄量到不同的東西。
 *
 * 【為什麼要人工把池灌滿】20v20 的穩態存量取決於有多少人正扣著扳機，那會
 * 隨戰況起伏。要量的是**最壞情形**，所以每步補回滿載。
 */
export function createMultiLoad(): MultiLoadState {
  const battle = createBattle(new LoadController(), DEFAULT_BATTLE)
  const state: MultiLoadState = { battle }
  fill(state)
  return state
}

function fill(state: MultiLoadState): void {
  const p = state.battle.world.projectiles
  const cs = state.battle.world.combatants
  for (let i = 0; i < PROJECTILE_CAPACITY; i++) {
    const c = cs[i % cs.length]!
    const o = c.aircraft.state.position
    const a = (i / PROJECTILE_CAPACITY) * Math.PI * 2
    p.spawn(
      o.x + Math.cos(a) * 40, o.y + Math.sin(a) * 40, o.z - 100 - (i % 700),
      Math.cos(a) * 20, Math.sin(a) * 20, -887, 6, c.index, 0, PROJECTILE_LIFETIME, 12.7,
    )
    // 【壽命要錯開】全部給 age 0 的話會在同一步一起到期、再被一起補滿，
    // 量到的是週期性的尖峰而不是穩態
    p.age[i] = (i / PROJECTILE_CAPACITY) * PROJECTILE_LIFETIME
  }
}

export function stepMultiLoad(state: MultiLoadState): void {
  const p = state.battle.world.projectiles
  const o = state.battle.world.combatants[0]!.aircraft.state.position
  while (p.live < PROJECTILE_CAPACITY) {
    p.spawn(o.x, o.y, o.z - 200, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME, 12.7)
  }
  stepBattle(state.battle, LOAD_DT)
}

export function resetMultiLoad(state: MultiLoadState): void {
  state.battle.world.projectiles.clear()
  for (const c of state.battle.world.combatants) state.battle.world.respawn(c)
  fill(state)
}
