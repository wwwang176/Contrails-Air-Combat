/** 選單與戰鬥共用的雷雨資源；換場重建，選單同時段則沿用。 */
import type { Object3D } from 'three'
import type { TimeOfDay } from '../world/timeOfDay'
import type { createStorm, Storm } from './storm'
import type { createRain, Rain } from './rain'

export interface SceneWeather {
  readonly storm: Storm | null
  readonly rain: Rain | null
  /** 開新場次，即使時段相同仍重建雷雨。 */
  reset(timeOfDay: TimeOfDay): void
  /** 選單短片換時段，相同天氣保留原本的資源與時間。 */
  set(timeOfDay: TimeOfDay): void
  clear(): void
}

export interface SceneWeatherBuilders {
  createStorm: typeof createStorm
  createRain: typeof createRain
}

export function createSceneWeather(
  scene: Pick<Object3D, 'add' | 'remove'>,
  builders: SceneWeatherBuilders,
): SceneWeather {
  const state = {
    storm: null as Storm | null,
    rain: null as Rain | null,
    reset, set, clear,
  }

  function reset(timeOfDay: TimeOfDay): void {
    // 【雷雨跟著時段】別的時段是 null —— 上一場的雷雨不會帶進下一場
    state.storm = timeOfDay === 'storm' ? builders.createStorm() : null
    if (state.rain !== null) {
      scene.remove(state.rain.object)
      state.rain.dispose()
    }
    state.rain = state.storm !== null ? builders.createRain() : null
    if (state.rain !== null) scene.add(state.rain.object)
  }

  function set(timeOfDay: TimeOfDay): void {
    if (timeOfDay === 'storm' && state.storm === null) {
      state.storm = builders.createStorm()
      state.rain = builders.createRain()
      scene.add(state.rain.object)
    } else if (timeOfDay !== 'storm' && state.storm !== null) {
      state.storm = null
      if (state.rain !== null) {
        scene.remove(state.rain.object)
        state.rain.dispose()
        state.rain = null
      }
    }
  }

  function clear(): void {
    if (state.rain !== null) {
      scene.remove(state.rain.object)
      state.rain.dispose()
      state.rain = null
    }
    state.storm = null
  }

  return state
}
