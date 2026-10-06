import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Object3D, PerspectiveCamera, Quaternion, Scene, Texture, Vector3 } from 'three'
import type { SceneContext } from '../../src/render/scene'
import type { BattleConfig } from '../../src/battle/setup'
import { warmBattleGraphics } from '../../src/app/battleWarmup'

const texturesFor = vi.hoisted(() => vi.fn())
vi.mock('../../src/render/geometry/buildAircraft', () => ({ liveryTexturesFor: texturesFor }))

beforeEach(() => texturesFor.mockReset())

function fixture() {
  const scene = new Scene()
  const camera = new PerspectiveCamera()
  const culled = new Object3D()
  const unculled = new Object3D()
  unculled.frustumCulled = false
  scene.add(culled, unculled)
  const calls: string[] = []
  const readPixels = vi.fn(() => calls.push('read'))
  const renderer = {
    compileAsync: vi.fn(async () => { calls.push('compile') }),
    initTexture: vi.fn(() => calls.push('texture')),
    render: vi.fn(() => {
      calls.push('render')
      scene.traverse((o) => expect(o.frustumCulled).toBe(false))
      expect(camera.position.toArray()).toEqual([1, 2, 3])
      expect(camera.matrixWorld.elements[12]).toBe(1)
    }),
    getContext: () => ({ RGBA: 6408, UNSIGNED_BYTE: 5121, readPixels }),
  }
  const ctx = { scene, camera, renderer: renderer as unknown as SceneContext['renderer'] }
  return { ctx, renderer, culled, unculled, calls, readPixels }
}

describe('戰鬥進場 GPU 暖機', () => {
  it('先編譯與預傳增援貼圖，再完整繪製、還原剔除並等待 GPU', async () => {
    const f = fixture()
    const texture = new Texture()
    texturesFor.mockResolvedValue([texture])
    const cfg = {
      beats: [
        { kind: 'reinforce', flight: { members: [{ id: 'p51d' }, { id: 'bf109k4' }] } },
        { kind: 'message' },
        { kind: 'reinforce', flight: { members: [{ id: 'p51d' }] } },
      ],
      liveries: { p51d: 'example' },
    } as unknown as BattleConfig
    const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.7)
    await warmBattleGraphics(f.ctx, cfg, new Vector3(1, 2, 3), orientation)
    expect(texturesFor).toHaveBeenCalledWith(['p51d', 'bf109k4', 'p51d'], cfg.liveries)
    expect(f.renderer.initTexture).toHaveBeenCalledWith(texture)
    expect(f.calls).toEqual(['compile', 'texture', 'render', 'read'])
    expect(f.ctx.camera.quaternion.equals(orientation)).toBe(true)
    expect(f.culled.frustumCulled).toBe(true)
    expect(f.unculled.frustumCulled).toBe(false)
    expect(f.readPixels).toHaveBeenCalledWith(0, 0, 1, 1, 6408, 5121, new Uint8Array(4))
  })

  it('編譯尚未完成時，不預傳或繪製；沒有波次也完成暖機', async () => {
    const f = fixture()
    let finish!: () => void
    f.renderer.compileAsync.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve }))
    texturesFor.mockResolvedValue([])
    const pending = warmBattleGraphics(f.ctx, {}, new Vector3(1, 2, 3), new Quaternion())
    expect(texturesFor).not.toHaveBeenCalled()
    expect(f.renderer.render).not.toHaveBeenCalled()
    finish()
    await pending
    expect(texturesFor).toHaveBeenCalledWith([], undefined)
    expect(f.calls).toEqual(['render', 'read'])
  })
})
