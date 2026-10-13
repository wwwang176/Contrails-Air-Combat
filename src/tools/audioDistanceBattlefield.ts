import { TextureLoader, Vector3 } from 'three'
import { createScene } from '../render/scene'
import { createTerrain, preloadTerrainScenery } from '../render/terrain'
import { applyTimeOfDay } from '../render/timeOfDay'
import { createFireChunks } from '../render/chunks'
import {
  BLAST_PACE, LAND_BLAST, createBlastSmoke, createDust, createEmberSmoke,
  createFireGlow, emitBlast, emitEmber,
} from '../render/blast'
import { createSpray, WATER_COLOR } from '../render/spray'
import { createImpacts } from '../world/events'
import { createBlastLights } from '../render/blastLights'
import { createCameraSmoke } from '../render/cameraSmoke'
import { assetUrl } from '../core/asset'
import { addSmokeLighting } from '../render/smokeLighting'

/** 使用戰場的地形、日照與陸地爆炸配方；沒有另畫一份簡化的爆炸動畫。 */
export async function createDistanceBattlefield(canvas: HTMLCanvasElement) {
  const ctx = createScene(canvas)
  // 工具採側欄版面，由工具的 ResizeObserver 決定畫布大小。
  window.removeEventListener('resize', ctx.resize)
  canvas.style.width = '100%'; canvas.style.height = '100%'
  await preloadTerrainScenery('farmland')
  const terrain = createTerrain('farmland'); ctx.scene.add(terrain.object)
  applyTimeOfDay(ctx, terrain, 'noon')
  const smokeTexture = await new TextureLoader().loadAsync(assetUrl('/textures/smoke.png'))
  const ember = createEmberSmoke(undefined, BLAST_PACE, smokeTexture)
  const chunks = createFireChunks(undefined, BLAST_PACE,
    (x, y, z, vx, vy, vz, d, slot) => emitEmber(ember, slot, x, y, z, vx, vy, vz, d))
  const smoke = createBlastSmoke(undefined, BLAST_PACE, smokeTexture)
  const dust = createDust(undefined, BLAST_PACE, smokeTexture)
  const glow = createFireGlow(undefined, BLAST_PACE)
  const spray = createSpray(WATER_COLOR)
  const particles = [ember, chunks, smoke, dust, glow, spray]
  for (const p of particles) ctx.scene.add(p.object)
  const lights = createBlastLights(); ctx.scene.add(lights.object)
  for (const pool of [ember, smoke]) addSmokeLighting(pool, ctx.lights.sun.position,
    ctx.lights.sun.color, ctx.lights.sun.intensity, 0, lights.smokeUniforms)
  const cameraSmoke = createCameraSmoke(smokeTexture)
  const pools = { fireball: chunks, smoke, dust, glow, spray, splashEvents: createImpacts() }
  const origin = new Vector3(0, terrain.heightAt(0, 220, 0), 220)
  let elapsed = 0
  return {
    ...ctx, terrain, origin,
    explode(): void {
      for (const p of particles) p.reset()
      cameraSmoke.reset()
      emitBlast(pools, LAND_BLAST, origin.x, origin.y, origin.z, 1)
      lights.flash(origin.x, origin.y, origin.z, 1, ctx.camera.position)
    },
    step(dt: number): void {
      elapsed += dt
      for (const p of particles) p.step(dt)
      lights.step(dt)
      terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
      cameraSmoke.update(ctx.scene, ctx.camera, dt, dt)
    },
    render(): void { ctx.renderer.render(ctx.scene, ctx.camera); cameraSmoke.render(ctx.renderer) },
  }
}
