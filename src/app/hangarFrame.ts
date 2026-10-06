import type { Showcase } from './showcase'
import type { SceneContext } from '../render/scene'
import type { Terrain } from '../render/terrain'

/** 渲染一幀機庫畫面；只有機庫用到的接線集中在這裡 */
export function renderHangarFrame(
  frameSeconds: number,
  elapsed: number,
  showcase: Pick<Showcase, 'update'>,
  ctx: Pick<SceneContext, 'camera' | 'renderer' | 'scene'>,
  terrain: Pick<Terrain, 'update'>,
): void {
  showcase.update(frameSeconds, ctx.camera)
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
}
