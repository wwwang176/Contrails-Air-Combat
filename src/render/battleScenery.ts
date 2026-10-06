/** 戰場模型與地面戰效果的所有權；每幀更新由呼叫端依原本順序直接使用同一批物件。 */
import type { FogExp2, Scene, Texture } from 'three'
import type { World } from '../world/World'
import type { MissionTheater } from '../battle/missions/types'
import type { GroundUnitId } from '../specs/ground'
import type { FirePuffFn } from './shipFires'
import type { createShipModels, ShipModels } from './ships'
import type { createShipWakes, ShipWakes } from './shipWakes'
import type { createGroundModels, GroundModels } from './groundTargets'
import type { createSearchlights, Searchlights } from './searchlights'
import type { createGroundBattle, GroundBattle } from './groundBattle'
import type { createBalloonModels, BalloonModels } from './balloons'
import { battleFogTint, clearBattleFog, setBattleFog } from './heightFog'

type SceneryWorld = Pick<World, 'ships' | 'groundTargets' | 'balloons'>

export interface BattleSceneryAssets {
  /** 共用貼圖由應用程式持有，不由場次釋放。 */
  glareTexture: Texture
  smokeTexture: Texture
  burn: FirePuffFn
  impact(x: number, y: number, z: number): void
  fired(unit: GroundUnitId, x: number, y: number, z: number): void
}

export interface BattleSceneryBuilders {
  createShipModels: typeof createShipModels
  createShipWakes: typeof createShipWakes
  shipFoamTexture(): Texture
  createGroundModels: typeof createGroundModels
  createSearchlights: typeof createSearchlights
  createGroundBattle: typeof createGroundBattle
  createBalloonModels: typeof createBalloonModels
}

export interface BattleScenery {
  readonly shipModels: ShipModels | null
  readonly shipWakes: ShipWakes | null
  readonly groundModels: GroundModels | null
  readonly searchlights: Searchlights | null
  readonly balloonModels: BalloonModels | null
  readonly groundBattle: GroundBattle | null
  readonly battleFogOn: boolean
  rebuild(world: SceneryWorld, theater: MissionTheater | undefined): void
  /** 模型與地面戰效果分開清理，讓離場流程維持原有順序。 */
  clearModels(): void
  releaseGroundBattle(): void
}

export function createBattleScenery(
  scene: Pick<Scene, 'add' | 'remove' | 'fog'>,
  assets: BattleSceneryAssets,
  builders: BattleSceneryBuilders,
): BattleScenery {
  // 普通欄位，沒有 getter 或逐幀包裝物件；建立與清理時才換掉參考。
  const state = {
    shipModels: null as ShipModels | null,
    shipWakes: null as ShipWakes | null,
    groundModels: null as GroundModels | null,
    searchlights: null as Searchlights | null,
    balloonModels: null as BalloonModels | null,
    groundBattle: null as GroundBattle | null,
    battleFogOn: false,
    rebuild, clearModels, releaseGroundBattle,
  }

  function rebuild(world: SceneryWorld, theater: MissionTheater | undefined): void {
    // 【船的模型每一場重建】艦隊是設定的一部分 —— 沿用上一場的話，換一張
    // 沒有艦隊的卡時那幾艘會留在海上。
    clearShips()
    if (world.ships.length > 0) {
      state.shipModels = builders.createShipModels(world.ships)
      scene.add(state.shipModels.object)
      state.shipWakes = builders.createShipWakes(world.ships, builders.shipFoamTexture())
      scene.add(state.shipWakes.object)
    }
    // 地面目標與船同一個做法：每一場重建
    clearGroundModels()
    if (world.groundTargets.length > 0) {
      state.groundModels = builders.createGroundModels(world.groundTargets)
      scene.add(state.groundModels.object)
      state.searchlights = builders.createSearchlights(world.groundTargets, assets.glareTexture)
      scene.add(state.searchlights.object)
    }
    // 地面戰的戲：純畫面，從卡片讀（不進 `BattleConfig`）。每一場重建
    releaseGroundBattle()
    if (theater !== undefined && world.groundTargets.length > 0) {
      state.groundBattle = builders.createGroundBattle(theater, assets.burn, assets.smokeTexture, assets.impact, assets.fired)
      for (const o of state.groundBattle.objects) scene.add(o)
      if (theater.haze !== undefined) {
        setBattleFog({ ...theater.haze, tint: battleFogTint((scene.fog as FogExp2).color, theater.fogColor) })
        state.battleFogOn = true
      }
    }
    // 氣球與船同一個做法：每一場重建
    clearBalloons()
    if (world.balloons.length > 0) {
      state.balloonModels = builders.createBalloonModels(world.balloons)
      scene.add(state.balloonModels.object)
    }
  }

  function releaseGroundBattle(): void {
    clearBattleFog()
    state.battleFogOn = false
    if (state.groundBattle === null) return
    for (const o of state.groundBattle.objects) scene.remove(o)
    state.groundBattle.dispose()
    state.groundBattle = null
  }

  function clearModels(): void {
    clearShips()
    clearGroundModels()
    clearBalloons()
  }

  /** 航跡與船使用相同的生命週期。 */
  function clearShips(): void {
    if (state.shipModels !== null) {
      scene.remove(state.shipModels.object)
      state.shipModels.dispose()
      state.shipModels = null
    }
    if (state.shipWakes !== null) {
      scene.remove(state.shipWakes.object)
      state.shipWakes.dispose()
      state.shipWakes = null
    }
  }

  function clearGroundModels(): void {
    if (state.groundModels !== null) {
      scene.remove(state.groundModels.object)
      state.groundModels.dispose()
      state.groundModels = null
    }
    if (state.searchlights !== null) {
      scene.remove(state.searchlights.object)
      state.searchlights.dispose()
      state.searchlights = null
    }
  }

  function clearBalloons(): void {
    if (state.balloonModels !== null) {
      scene.remove(state.balloonModels.object)
      state.balloonModels.dispose()
      state.balloonModels = null
    }
  }

  return state
}
