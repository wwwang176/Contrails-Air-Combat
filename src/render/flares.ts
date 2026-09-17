import {
  AdditiveBlending, Group, PointLight, Sprite, SpriteMaterial, type Texture,
} from 'three'
import { FLARE_BURN, FLARE_LANES, type Flares } from '../world/flares'

/**
 * # 照明彈的光
 *
 * 每一枚一個加法混色的光暈 sprite；**點光源固定 `FLARE_LIGHT_COUNT` 盞**，
 * 對應池裡最新的那幾枚（燒最久的先熄）。德 M2 一次點三枚，正好一枚一盞。
 * 只有帶照明彈節拍的戰鬥在開戰時掛進場景（`battle/battleLights.ts`）。
 *
 * 【為什麼不能動態增減燈】`MeshStandardMaterial` 的著色器是依光源數編的：
 * 場景裡多一盞燈，**每一個材質都重編一次** —— 幾百毫秒的卡頓，而且會在
 * 照明彈點燃的那一刻發生。燈一直在，沒在用的強度 0。
 *
 * 【燈的代價】每個片元多一次光照，地面那一顆網格最大。太卡就把
 * `FLARE_LIGHT_COUNT` 降到 2。
 */
export const FLARE_LIGHT_COUNT = FLARE_LANES
/**
 * 光源的照射距離，m。**它決定地上亮的那一圈有多大**：1,200 m 高的燈，
 * 2,000 m 的截止在地面是半徑 1,600 m 的圓 —— 機場亮、周圍的田暗。
 */
export const FLARE_LIGHT_DISTANCE = 2000
/**
 * 燭光。three 的點光源是 1/d² 衰減：1,200 m 正下方的照度是 I / 1.44e6，
 * 夜間的太陽是 0.38 —— 要在地面看得出亮暗差，強度得是幾十萬的量級。
 * **起始值，拿眼睛校。**
 */
const FLARE_LIGHT_INTENSITY = 4.5e5
const FLARE_COLOR = 0xfff2d0
/** 光暈 sprite 的直徑，m */
const GLOW_SIZE = 40
/** 點燃後這幾秒亮度從 0 升到 1 */
const RISE_SECONDS = 2
/** 最後這幾秒亮度線性衰到 0 */
const FADE_SECONDS = 15
/** 閃爍的深度：亮度在 1 − FLICKER … 1 之間晃 */
const FLICKER = 0.18

/** 還沒點燃的是 0；點燃後幾秒漸亮；最後幾秒衰到 0 */
export function flareBrightness(age: number): number {
  if (age < 0) return 0
  const left = FLARE_BURN - age
  if (left <= 0) return 0
  const rise = age < RISE_SECONDS ? age / RISE_SECONDS : 1
  const fade = left < FADE_SECONDS ? left / FADE_SECONDS : 1
  return rise < fade ? rise : fade
}

/**
 * 隨機的閃爍。三個互質頻率的正弦相乘，每一枚的相位不同 —— 看起來是不
 * 規則的，但是時間的純函數（不配置、可重現）。
 */
export function flareFlicker(index: number, seconds: number): number {
  const p = index * 1.7
  const s = Math.sin(seconds * 23 + p) * Math.sin(seconds * 7.3 + p * 2) * Math.sin(seconds * 3.1 + p * 0.5)
  return 1 - FLICKER * (0.5 + 0.5 * s)
}

export interface FlareLights {
  readonly object: Group
  /** 每一渲染幀呼叫；`seconds` 是畫面時間，只拿來閃爍 */
  update(f: Flares, seconds: number): void
  dispose(): void
}

/** 依年齡排序用的索引，模組級，不配置。上界是池的容量 */
const ORDER = new Int32Array(64)

export function createFlareLights(glow: Texture): FlareLights {
  const object = new Group()
  const lights: PointLight[] = []
  for (let k = 0; k < FLARE_LIGHT_COUNT; k++) {
    const l = new PointLight(FLARE_COLOR, 0, FLARE_LIGHT_DISTANCE, 2)
    // 【燈在每一個圖層都亮】three 只收 `light.layers.test(camera.layers)` 的燈，
    // 而且不看強度。低解析度煙那一趟只開第 1 層；燈只在第 0 層的話，有煙的
    // 每一幀兩趟的點光源數不同，每個吃光照的材質每幀重算 shader program
    l.layers.enableAll()
    object.add(l)
    lights.push(l)
  }
  const material = new SpriteMaterial({
    map: glow, color: FLARE_COLOR, blending: AdditiveBlending, transparent: true, depthWrite: false,
  })
  const sprites: Sprite[] = []

  return {
    object,
    update(f, seconds) {
      if (f.capacity > ORDER.length) throw new Error(`照明彈池 ${f.capacity} 格，排序緩衝只有 ${ORDER.length}`)
      // sprite 的數量跟池的容量走，第一次看到才建
      while (sprites.length < f.capacity) {
        const s = new Sprite(material)
        s.visible = false
        object.add(s)
        sprites.push(s)
      }
      // 點燃的依年齡由小到大排（插入排序，最多 16 個）。還沒點燃的不算
      let n = 0
      for (let i = 0; i < f.capacity; i++) {
        if (f.live[i] === 0 || f.age[i]! < 0) continue
        let j = n
        while (j > 0 && f.age[ORDER[j - 1]!]! > f.age[i]!) {
          ORDER[j] = ORDER[j - 1]!
          j--
        }
        ORDER[j] = i
        n++
      }
      for (let i = 0; i < f.capacity; i++) sprites[i]!.visible = false
      for (let k = 0; k < n; k++) {
        const i = ORDER[k]!
        const b = flareBrightness(f.age[i]!) * flareFlicker(i, seconds)
        const s = sprites[i]!
        s.visible = true
        s.position.set(f.x[i]!, f.y[i]!, f.z[i]!)
        s.scale.set(GLOW_SIZE * (0.6 + 0.4 * b), GLOW_SIZE * (0.6 + 0.4 * b), 1)
        if (k < FLARE_LIGHT_COUNT) {
          const l = lights[k]!
          l.position.copy(s.position)
          l.intensity = FLARE_LIGHT_INTENSITY * b
        }
      }
      for (let k = n; k < FLARE_LIGHT_COUNT; k++) lights[k]!.intensity = 0
    },
    dispose() {
      material.dispose()
      for (const l of lights) l.dispose()
    },
  }
}
