import type { SceneContext } from '../render/scene'
import type { Terrain, TerrainKind } from '../render/terrain'
import type { MenuReel } from './menuReel'
import type { Ship } from '../world/ships'
import type { createEffectStepper } from '../render/effectStepper'
import type { createSceneWeather } from '../render/sceneWeather'
import type { createSpray } from '../render/spray'
import type { createVortex } from '../render/vortex'
import type { createSteamEmission } from '../render/steamEmission'
import type { createWakes } from '../render/wake'
import type { createGroundFires } from '../render/groundFires'
import type { createShipFires } from '../render/shipFires'
import type { createFireCrowd } from '../render/fireCrowd'
import { DAY_PALETTES } from '../render/timeOfDay'
import { applyFlash, stepStorm } from '../render/storm'

export interface MenuBackgroundFrameDeps {
  readonly ctx: SceneContext
  readonly menuReel: MenuReel
  getTerrain(): Terrain
  getTerrainKind(): TerrainKind
  readonly sceneWeather: ReturnType<typeof createSceneWeather>
  readonly stepEffects: ReturnType<typeof createEffectStepper>
  readonly spray: ReturnType<typeof createSpray>
  readonly vortex: ReturnType<typeof createVortex>
  readonly reelTrackDust: { step(dt: number): void }
  readonly steamEmission: ReturnType<typeof createSteamEmission>
  readonly fireCrowd: ReturnType<typeof createFireCrowd>
  readonly groundFires: ReturnType<typeof createGroundFires>
  readonly shipFires: ReturnType<typeof createShipFires>
  readonly wakes: ReturnType<typeof createWakes>
  readonly noShips: readonly Ship[]
  readonly emitFirePuff: (x: number, y: number, z: number) => void
  readonly rainGroundAt: (x: number, z: number) => number
  readonly updateFireCrowd: typeof import('../render/fireCrowd').updateFireCrowd
  readonly stepGroundFires: typeof import('../render/groundFires').stepGroundFires
  readonly playThunder: (distance: number, bearing: number) => void
}

/** 推進並渲染一幀主選單背景短片，不碰戰鬥狀態 */
export function createMenuBackgroundFrame(deps: MenuBackgroundFrameDeps) {
  const {
    ctx, menuReel, getTerrain, getTerrainKind, sceneWeather, stepEffects, spray, vortex, reelTrackDust,
    steamEmission, fireCrowd, groundFires, shipFires, wakes, noShips, emitFirePuff,
    rainGroundAt, updateFireCrowd, stepGroundFires, playThunder,
  } = deps

  return function drawMenuBackground(frameSeconds: number, elapsed: number): void {
    menuReel.update(frameSeconds, elapsed)
    // 短片可能在 update 裡換場；此時才讀取，不能保留已釋放的地形。
    const terrain = getTerrain()
    const terrainKind = getTerrainKind()
    // 【定格時特效也停】只停短片的話，殘骸與煙照樣往下掉、往外散，截到的不是那一秒
    // 【慢動作時特效也慢】短片變速時，煙、火、曳光照畫面秒數散開的話，只有飛機在慢
    const fx = menuReel.hold ? 0 : frameSeconds * menuReel.rate
    stepEffects(fx, elapsed, terrain, elapsed)
    spray.step(fx)
    vortex.step(fx)
    reelTrackDust.step(fx)
    // 短片地上的煙囪與冷卻塔冒白煙（炸毀的就停）
    steamEmission.emitPlantSteam(fx, menuReel.props, terrainKind)
    // 短片投下的炸彈點的地面火、魚雷的航跡。【擠在一起的火少冒煙】短片的地面火也要
    // 照密度節流，不然一串炸彈的火全速冒煙；戰鬥的船火池在選單裡是空的
    updateFireCrowd(fireCrowd, groundFires, shipFires, noShips, fx)
    stepGroundFires(groundFires, fx, emitFirePuff, fireCrowd.ground)
    wakes.bindOcean(terrain.oceanHeight)
    wakes.step(fx, elapsed, terrain.heightAt)
    terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
    if (sceneWeather.storm !== null) {
      applyFlash(ctx.lights, ctx.sky, DAY_PALETTES.storm, stepStorm(sceneWeather.storm, fx, playThunder))
    }
    if (sceneWeather.rain !== null) {
      sceneWeather.rain.update(ctx.camera.position, fx, frameSeconds, false, rainGroundAt)
    }
    ctx.renderer.render(ctx.scene, ctx.camera)
  }
}
