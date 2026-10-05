import { describe, expect, it, vi } from 'vitest'
import { Scene } from 'three'
import { createRain } from '../../src/render/rain'
import { createStorm } from '../../src/render/storm'
import { createSceneWeather } from '../../src/render/sceneWeather'

function fixture() {
  const scene = new Scene()
  const builders = { createRain: vi.fn(createRain), createStorm: vi.fn(createStorm) }
  return { scene, builders, weather: createSceneWeather(scene, builders) }
}

describe('場景天氣的生命週期', () => {
  it('選單同一時段沿用雨與雷暴，離開雷雨後移除並釋放雨', () => {
    const { scene, weather, builders } = fixture()
    weather.set('noon')
    expect(builders.createRain).not.toHaveBeenCalled()
    weather.set('storm')
    const rain = weather.rain!, storm = weather.storm!
    const dispose = vi.spyOn(rain, 'dispose')
    weather.set('storm')
    expect(weather.rain).toBe(rain)
    expect(weather.storm).toBe(storm)
    expect(builders.createStorm).toHaveBeenCalledTimes(1)
    expect(builders.createRain).toHaveBeenCalledTimes(1)
    expect(scene.children).toEqual([rain.object])

    weather.set('noon')
    weather.clear()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(rain.object.parent).toBeNull()
    expect(weather.rain).toBeNull()
    expect(weather.storm).toBeNull()
    expect(scene.children).toHaveLength(0)
  })

  it('新場次即使同時段仍建立新的雨與雷暴，舊雨只釋放一次', () => {
    const { scene, weather } = fixture()
    weather.reset('storm')
    const oldRain = weather.rain!, oldStorm = weather.storm!
    const oldDispose = vi.spyOn(oldRain, 'dispose')
    weather.reset('storm')
    expect(weather.rain).not.toBe(oldRain)
    expect(weather.storm).not.toBe(oldStorm)
    expect(oldDispose).toHaveBeenCalledTimes(1)
    expect(oldRain.object.parent).toBeNull()
    expect(scene.children).toEqual([weather.rain!.object])
    const dispose = vi.spyOn(weather.rain!, 'dispose')
    weather.reset('noon')
    weather.clear()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(oldDispose).toHaveBeenCalledTimes(1)
    expect(scene.children).toHaveLength(0)
    expect(weather.storm).toBeNull()
  })

  it('離場清理可重複呼叫，之後的選單可重新進入雷雨', () => {
    const { scene, weather } = fixture()
    weather.set('storm')
    const rain = weather.rain!
    const dispose = vi.spyOn(rain, 'dispose')
    weather.clear()
    weather.clear()
    expect(dispose).toHaveBeenCalledTimes(1)
    expect(scene.children).toHaveLength(0)
    weather.set('storm')
    expect(weather.rain).not.toBe(rain)
    expect(scene.children).toEqual([weather.rain!.object])
    weather.clear()
  })
})
