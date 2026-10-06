import type { Showcase } from './showcase'
import type { SceneContext } from '../render/scene'
import type { Terrain } from '../render/terrain'

/** Renders one hangar frame and keeps hangar-only wiring together. */
export function renderHangarFrame(
  frameSeconds: number,
  elapsed: number,
  showcase: Showcase,
  ctx: SceneContext,
  terrain: Terrain,
): void {
  showcase.update(frameSeconds, ctx.camera)
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
}
