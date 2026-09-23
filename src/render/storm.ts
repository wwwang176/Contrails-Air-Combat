import { Color, type Mesh, type ShaderMaterial } from 'three'
import type { Lights } from './lighting'
import type { DayPalette } from './timeOfDay'

/**
 * # 雷雨：閃電與雷聲
 *
 * **不下雨。** 閃電是整個畫面亮一下：兩盞散射光往上推、天空往白處拉，一次閃
 * 兩三下再放回色盤的基準值。雷聲從閃電打下的位置發出（`main.ts` 的
 * `playThunder`），音波走到鏡頭才響、遠的更悶更小 —— 那三件事是音訊引擎對
 * 定位音源本來就做的。每一聲的播放速度、低通、音量另外隨機（`rollThunder`）。
 *
 * 【不畫閃電的形狀】閃光本身就讀得出「打雷了」。畫一道光柱要決定它在畫面
 * 的哪裡、多高、會不會穿過雲 —— 那是另一件事。
 *
 * 【只動光照強度與天空色，不增減燈】three 的燈數一變，每一個受光材質都要
 * 重編 shader。強度與顏色是 uniform，每幀改都不花錢。
 *
 * 熱路徑（每一幀）：不配置。
 */

/** 兩道閃電之間隔幾秒，均勻抽。**起始值，由試玩裁定。** */
export const STRIKE_INTERVAL = [6, 16] as const
/**
 * 閃電離鏡頭多遠，m，均勻抽。近的更亮、雷聲來得更快。
 *
 * 【最遠 5 km】雷雨就在頭上。再遠的話空氣吸收（每公里 2.8 dB）加上距離衰減，
 * 雷聲小到聽不見，只剩一下沒有聲音的閃光。
 */
export const STRIKE_DISTANCE = [1000, 5000] as const
/** 雷聲音源的高度，m：閃電通道的中段 */
export const STRIKE_HEIGHT = 800
/** 開場到第一道閃電，s。第一道要早一點，玩家才知道這是雷雨 */
const FIRST_STRIKE = [2, 6] as const
/** 一次閃光（含後面的幾下閃爍）的長度，s */
export const FLASH_SECONDS = 0.7

/** 閃光推到最亮時兩盞散射光各加多少強度 */
const FLASH_HEMI = 2.2
const FLASH_AMBIENT = 1.2
/** 天空往這個顏色拉，最多拉到 `FLASH_SKY_MIX` */
const FLASH_SKY = new Color(0xe6ecff)
const FLASH_SKY_MIX = 0.65

/**
 * 閃光的形狀，0～1。**三下**：一下最亮的主閃、一下較弱的回閃、再一下拖長的
 * 餘光 —— 真實的閃電是好幾次回擊組成的，只閃一下讀起來像爆炸。
 */
export function flashEnvelope(age: number): number {
  if (age < 0 || age >= FLASH_SECONDS) return 0
  const v = pulse(age, 0, 1, 0.05) + pulse(age, 0.14, 0.7, 0.06) + pulse(age, 0.34, 0.8, 0.12)
  return v > 1 ? 1 : v
}

function pulse(age: number, start: number, peak: number, tau: number): number {
  return age < start ? 0 : peak * Math.exp(-(age - start) / tau)
}

export interface Storm {
  /** 距離下一道閃電還有幾秒 */
  timer: number
  /** 目前這一次閃光走了幾秒。沒有在閃時是 `FLASH_SECONDS` 以上 */
  age: number
  /** 目前這一次閃光的強度倍率：遠的暗、近的亮 */
  strength: number
  readonly rand: () => number
}

export function createStorm(rand: () => number = Math.random): Storm {
  return {
    timer: FIRST_STRIKE[0] + rand() * (FIRST_STRIKE[1] - FIRST_STRIKE[0]),
    age: FLASH_SECONDS,
    strength: 0,
    rand,
  }
}

/** 這個距離的閃光有多亮：最近是全亮，最遠剩三成五 */
function strengthAt(distance: number): number {
  const t = (distance - STRIKE_DISTANCE[0]) / (STRIKE_DISTANCE[1] - STRIKE_DISTANCE[0])
  return 1 - 0.65 * Math.min(1, Math.max(0, t))
}

/**
 * 推進 `dt` 秒，回傳這一刻的閃光強度 0～1。打下一道新的閃電時呼叫
 * `onStrike(距離, 方位)` —— 方位是繞 Y 的弧度 0～2π，雷聲由呼叫端排。
 *
 * 【`dt` 為 0 就什麼都不發生】暫停時世界時間不走，閃電也不打。
 */
export function stepStorm(
  s: Storm, dt: number, onStrike: (distance: number, bearing: number) => void,
): number {
  if (dt <= 0) return flashEnvelope(s.age) * s.strength
  s.age += dt
  s.timer -= dt
  if (s.timer <= 0) {
    const d = STRIKE_DISTANCE[0] + s.rand() * (STRIKE_DISTANCE[1] - STRIKE_DISTANCE[0])
    const bearing = s.rand() * 2 * Math.PI
    s.timer = STRIKE_INTERVAL[0] + s.rand() * (STRIKE_INTERVAL[1] - STRIKE_INTERVAL[0])
    s.age = 0
    s.strength = strengthAt(d)
    onStrike(d, bearing)
  }
  return flashEnvelope(s.age) * s.strength
}

/**
 * 每一聲雷的隨機範圍，均勻抽。**全部是起始值，由試玩裁定。**
 *
 * ```
 *   播放速度  0.7～1.05   慢一點更低沉、更長，同一支素材聽起來像不同的雷
 *   低通      600～4000 Hz 悶雷到脆的霹靂；遠的另外被引擎依距離再壓
 *   音量      −6～+2 dB
 * ```
 */
export const THUNDER_RATE = [0.7, 1.05] as const
export const THUNDER_CUTOFF_HZ = [600, 4000] as const
export const THUNDER_DB = [-6, 2] as const

export interface ThunderVoice {
  rate: number
  cutoffHz: number
  extraDb: number
}

/** 模組層的暫存。閃電幾秒才一道，但每道都重用這一份 */
const VOICE: ThunderVoice = { rate: 1, cutoffHz: 4000, extraDb: 0 }

/** 抽一聲雷的播放速度、低通與音量。**回傳的是共用的暫存**，呼叫端當下用掉 */
export function rollThunder(rand: () => number): ThunderVoice {
  VOICE.rate = THUNDER_RATE[0] + rand() * (THUNDER_RATE[1] - THUNDER_RATE[0])
  VOICE.cutoffHz = THUNDER_CUTOFF_HZ[0] + rand() * (THUNDER_CUTOFF_HZ[1] - THUNDER_CUTOFF_HZ[0])
  VOICE.extraDb = THUNDER_DB[0] + rand() * (THUNDER_DB[1] - THUNDER_DB[0])
  return VOICE
}

/**
 * 把強度 `f` 的閃光套到燈與天空上。**基準一律從色盤重算** —— `f` 是 0 時就是
 * 色盤本身，不會一次次累加上去。
 */
export function applyFlash(lights: Lights, sky: Mesh, base: DayPalette, f: number): void {
  lights.hemi.intensity = base.hemiIntensity + f * FLASH_HEMI
  lights.ambient.intensity = base.ambientIntensity + f * FLASH_AMBIENT
  const u = (sky.material as ShaderMaterial).uniforms
  const k = f * FLASH_SKY_MIX
  ;(u.horizon!.value as Color).setHex(base.skyHorizon).lerp(FLASH_SKY, k)
  ;(u.zenith!.value as Color).setHex(base.skyZenith).lerp(FLASH_SKY, k)
}
