import type { BattleConfig } from '../battle/battleConfig'
import type { Object3D, Quaternion, Vector3 } from 'three'
import { liveryTexturesFor } from '../render/geometry/buildAircraft'
import type { SceneContext } from '../render/scene'

/**
 * 在載入畫面後完成 GPU 的首次工作，避免第一幀與增援出現時才編譯或上傳。
 * 呼叫端須先建好戰場並排乾地形的增量重建；本函式只在進場時執行。
 */
export async function warmBattleGraphics(
  ctx: Pick<SceneContext, 'renderer' | 'scene' | 'camera'>,
  cfg: Pick<BattleConfig, 'beats' | 'liveries'>,
  spawn: Vector3,
  orientation: Quaternion,
): Promise<void> {
  await ctx.renderer.compileAsync(ctx.scene, ctx.camera)
  // 場上已有的機種由繪製帶上 GPU；增援尚未在場，需預傳其貼圖與 mipmap。
  const reinforcements: string[] = []
  for (const beat of cfg.beats ?? []) {
    if (beat.kind === 'reinforce') for (const s of beat.flight.members) reinforcements.push(s.id)
  }
  for (const t of await liveryTexturesFor(reinforcements, cfg.liveries)) ctx.renderer.initTexture(t)
  // ANGLE 仍可能把部分編譯留到第一次繪製；鏡頭後方與視野外的模型也要暖機。
  ctx.camera.position.copy(spawn)
  ctx.camera.quaternion.copy(orientation)
  ctx.camera.updateMatrixWorld(true)
  const culled: Object3D[] = []
  ctx.scene.traverse((o) => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false } })
  ctx.renderer.render(ctx.scene, ctx.camera)
  for (const o of culled) o.frustumCulled = true
  // 讀回像素才會等待 GPU 完成，否則第一幀仍會等在繪製佇列後面。
  const gl = ctx.renderer.getContext()
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4))
}
