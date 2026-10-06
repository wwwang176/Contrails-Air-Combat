import type { Quaternion, Vector3 } from 'three'
import type { SceneContext } from '../render/scene'
import type { Battle } from '../battle/battleState'
import type { World } from '../world/World'
import type { InputState } from '../input/InputState'
import { fillOrderView } from '../battle/orderView'
import { updateFireCrowd, type FireCrowd } from '../render/fireCrowd'
import { stepShipFires, type ShipFires } from '../render/shipFires'
import { stepGroundFires, type GroundFires } from '../render/groundFires'
import type { createSteamEmission } from '../render/steamEmission'
import type { Muzzles, MuzzleSource, TurretMuzzleSource } from '../render/muzzle'
import type { TurretBarrels } from '../render/turretBarrels'
import type { FlareLights } from '../render/flares'
import type { BattleScenery } from '../render/battleScenery'
import type { Wakes } from '../render/wake'
import type { Vortex } from '../render/vortex'
import type { Particles } from '../render/particles'
import type { OrderMarkers } from '../render/orderMarkers'
import type { ObjectiveRing } from '../render/objectiveRing'
import type { SceneWeather } from '../render/sceneWeather'
import type { createEffectStepper } from '../render/effectStepper'
import type { createBlastPresentation } from '../render/blastPresentation'
import type { createTerrain, TerrainKind } from '../render/terrain'
import { stepBattleFog } from '../render/heightFog'

type Terrain = ReturnType<typeof createTerrain>
type SteamEmission = ReturnType<typeof createSteamEmission>
type EffectStepper = ReturnType<typeof createEffectStepper>
type BlastPresentation = ReturnType<typeof createBlastPresentation>

/** 場景讀取目前狀態；推進物理與管理世界生命週期由呼叫端負責。 */
type BattleSceneWorld = Pick<World, 'ships' | 'groundTargets' | 'flares' | 'combatants'
  | 'time' | 'groundAt' | 'balloons' | 'torpedoes'>

export interface BattleSceneFrameDependencies {
  readonly ctx: SceneContext
  readonly fireCrowd: FireCrowd
  readonly groundFires: GroundFires
  readonly shipFires: ShipFires
  readonly steamEmission: SteamEmission
  readonly muzzles: Muzzles<MuzzleSource>
  readonly turretBarrels: TurretBarrels
  readonly turretMuzzles: Muzzles<TurretMuzzleSource>
  readonly flareLights: FlareLights
  readonly stepEffects: EffectStepper
  readonly battleScenery: BattleScenery
  readonly blastPresentation: BlastPresentation
  readonly wakes: Wakes
  readonly vortex: Vortex
  readonly spray: Particles
  readonly orderMarkers: OrderMarkers
  getObjectiveRing(): ObjectiveRing
  readonly sceneWeather: SceneWeather
  readonly emitFirePuff: (x: number, y: number, z: number) => void
  readonly burnBalloon: (x: number, y: number, z: number) => void
  readonly rainGroundAt: (x: number, z: number) => number
  readonly renderPositions: readonly Vector3[]
  readonly renderQuaternions: readonly Quaternion[]
}

/** 推進一個戰鬥渲染幀裡 HUD 以外的場景視覺 */
export function updateBattleSceneFrame(
  deps: BattleSceneFrameDependencies,
  frameSeconds: number,
  worldSeconds: number,
  elapsed: number,
  input: InputState,
  battle: Battle,
  world: BattleSceneWorld,
  terrain: Terrain,
  terrainKind: TerrainKind,
): void {
  const {
    ctx, fireCrowd, groundFires, shipFires, steamEmission,
    muzzles, turretBarrels, turretMuzzles, flareLights, stepEffects,
    battleScenery, blastPresentation, wakes, vortex, spray,
    orderMarkers, sceneWeather, emitFirePuff,
    burnBalloon, rainGroundAt,
  } = deps

  // 【火災走畫面時間，不是物理子步】它是純裝飾 —— 與 `sparks.step` 同一條
  // 【排在兩支 step 之前】這一幀的間隔倍率要先算好，否則兩支火用到的是
  // 上一幀的值；剛熄掉的格子也會慢一幀才歸位
  updateFireCrowd(fireCrowd, groundFires, shipFires, world.ships, worldSeconds)
  stepShipFires(shipFires, world.ships, worldSeconds, emitFirePuff, fireCrowd.ship)
  stepGroundFires(groundFires, worldSeconds, emitFirePuff, fireCrowd.ground)
  steamEmission.emitPlantSteam(worldSeconds, world.groundTargets, terrainKind)
  steamEmission.emitFlareSmoke(worldSeconds, world.flares)
  // 【槍焰用內插姿態】它是一個狀態而不是一個瞬間，所以位置在這裡重算 ——
  // 用物理位置的話槍焰會相對機身抖動一個子步的位移（M7 spec §2.1）
  muzzles.update(world.combatants, deps.renderPositions, deps.renderQuaternions)
  // 【砲塔的槍管也用內插姿態】理由與槍焰完全相同
  turretBarrels.update(world.combatants, deps.renderPositions, deps.renderQuaternions)
  turretMuzzles.update(world.combatants, deps.renderPositions, deps.renderQuaternions)
  flareLights.update(world.flares, elapsed)
  stepEffects(worldSeconds, world.time, terrain, elapsed)

  battleScenery.groundModels?.update(world.groundTargets, ctx.camera.position, worldSeconds)
  // 【吃世界秒數】射擊排程是 `world.time` 的純函數；暫停時兩者都不走
  battleScenery.groundBattle?.update(world.groundTargets, world.time, worldSeconds, world.groundAt)
  // 【吃世界秒數】暫停時為 0，團塊停在原地
  if (battleScenery.battleFogOn) stepBattleFog(worldSeconds)
  battleScenery.balloonModels?.update(world.balloons, worldSeconds, terrain.collisionHeightAt, burnBalloon)
  battleScenery.searchlights?.update(elapsed, world.combatants, ctx.camera.position)
  // 【船在渲染幀率更新，不在物理步】它讀的是船的位置與砲位的槍焰計時器，
  // 兩者都是狀態不是事件 —— 與飛機模型同一個道理。
  battleScenery.shipModels?.update(world.ships, blastPresentation.emitGunLostBlast)

  // 【魚雷航跡在渲染幀率餵，不在物理步】帶子是視覺，取樣間隔由它自己按走過的
  // 距離決定 —— 與凝結尾同一個做法
  const torpedoes = world.torpedoes
  for (let i = 0; i < torpedoes.capacity; i++) {
    // 【只有水中段有航跡】空中那一段沒有東西可以翻起泡沫
    if (torpedoes.active[i] === 0 || torpedoes.phase[i] !== 1) continue
    wakes.emit(i, torpedoes.x[i]!, torpedoes.z[i]!, torpedoes.serial[i]!)
  }
  // 【浪高與海面同一組 uniform】帶子要跟著看得見的浪起伏，否則會被浪蓋掉。地形每場
  // 重建，所以每幀接一次（沒換就只是比對參考）
  wakes.bindOcean(terrain.oceanHeight)
  wakes.step(worldSeconds, elapsed, terrain.heightAt)
  battleScenery.shipWakes?.bindOcean(terrain.oceanHeight)
  battleScenery.shipWakes?.step(world.ships, worldSeconds, elapsed, terrain.heightAt)
  vortex.step(worldSeconds)
  spray.step(worldSeconds)

  // ── 集合點的可視化（`O`）───────────────────────────────
  // 【觀測工具，不進任何模擬】只讀指揮層的狀態，不寫。
  //
  // 【為什麼要有它】集合令的到達判定是「長機進到 `order.radius` 以內」，而
  // `rallyAim` 對那個點是**純追擊、沒有抵達行為** —— 迴轉半徑大於半徑時，
  // 長機會在球外面繞著它盤旋而永遠判不到達。那個現象在無頭模擬裡重現不
  // 出來，但畫出來就一眼看得到。
  //
  // 【為什麼用 `state.position` 而不是內插後的位置】這條線只是要看「離多
  // 遠」，一個物理步的抖動（240 Hz）在 300 m 的尺度下看不出來，而拿內插
  // 位置要把整個 combatants 迴圈的暫存搬出來。
  orderMarkers.setVisible(input.orderMarkers)
  if (input.orderMarkers) fillOrderView(battle, orderMarkers)

  // 【撤離圓環一定要排在 renderer.render 之前】billboard 的 `lookAt` 讀的是
  // 相機**這一幀**的位置。排在渲染之後的話環會慢整整一幀（3D 在這裡畫、
  // HUD 到 `hud.render` 才畫），而且新建的第一幀會停在原點、半徑 1。
  if (battle.mission.hasTarget) {
    const objectiveRing = deps.getObjectiveRing()
    // 【中途才出現的撤離點】場景歸屬在 `enterBattle` 決定過一次，而返航節拍
    // 是在戰鬥進行中把任務換成撤離的 —— 不在這裡補的話，環每一幀照常更新
    // 位置與半徑，卻永遠不在場景裡
    if (objectiveRing.object.parent === null) ctx.scene.add(objectiveRing.object)
    objectiveRing.update(battle.mission.target, battle.mission.targetRadius, ctx.camera)
  }
  // 【雨跟著這一幀的鏡頭】雨絲的方向由雨自己算：雨滴這一幀在鏡頭眼裡移動了多少。
  // 上帝視角不轉，照停著的方向畫
  if (sceneWeather.rain !== null) {
    sceneWeather.rain.update(ctx.camera.position, worldSeconds, frameSeconds, input.godView, rainGroundAt)
  }
}
