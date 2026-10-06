import { describe, expect, it, vi } from 'vitest'
import { Vector3 } from 'three'
import { createMenuBackgroundFrame, type MenuBackgroundFrameDeps } from '../../src/app/menuBackgroundFrame'
import type { Terrain, TerrainKind } from '../../src/render/terrain'

describe('選單背景換場', () => {
  it('短片同幀換地形後，特效、蒸汽、尾流與地形更新都使用新場景', () => {
    const makeTerrain = () => ({
      heightAt: vi.fn(() => 0), oceanHeight: {}, update: vi.fn(),
    })
    const old = makeTerrain()
    const next = makeTerrain()
    let terrain = old
    let kind: TerrainKind = 'archipelago'
    const stepEffects = vi.fn()
    const emitPlantSteam = vi.fn()
    const wakes = { bindOcean: vi.fn(), step: vi.fn() }
    const props: never[] = []
    const render = vi.fn()
    const deps = {
      ctx: { camera: { position: new Vector3(11, 22, 33) }, renderer: { render } },
      menuReel: {
        hold: false, rate: 2, props,
        update() { terrain = next; kind = 'leuna' },
      },
      getTerrain: () => terrain as unknown as Terrain,
      getTerrainKind: () => kind,
      sceneWeather: { storm: null, rain: null }, stepEffects,
      spray: { step() {} }, vortex: { step() {} }, reelTrackDust: { step() {} },
      steamEmission: { emitPlantSteam }, fireCrowd: { ground: [] },
      groundFires: {}, shipFires: {}, wakes, noShips: [], emitFirePuff() {},
      rainGroundAt() { return 0 }, updateFireCrowd() {}, stepGroundFires() {}, playThunder() {},
    } as unknown as MenuBackgroundFrameDeps
    const draw = createMenuBackgroundFrame(deps)
    draw(0.1, 4)
    expect(old.update).not.toHaveBeenCalled()
    expect(next.update).toHaveBeenCalledWith(4, 11, 33)
    expect(stepEffects).toHaveBeenCalledWith(0.2, 4, next, 4)
    expect(emitPlantSteam).toHaveBeenCalledWith(0.2, props, 'leuna')
    expect(wakes.bindOcean).toHaveBeenCalledWith(next.oceanHeight)
    expect(wakes.step).toHaveBeenCalledWith(0.2, 4, next.heightAt)
    expect(render).toHaveBeenCalledOnce()
  })
})
