import {
  AdditiveBlending, Group, PointLight, Sprite, SpriteMaterial, type Texture,
} from 'three'
import { FLARE_BURN, type Flares } from '../world/flares'

/**
 * # 照明彈的光
 *
 * 每一枚一個加法混色的光暈 sprite；**點光源固定四盞、開場就掛進場景**，
 * 對應池裡最新的四枚（燒最久的先熄）。
 *
 * 【為什麼不能動態增減燈】`MeshStandardMaterial` 的著色器是依光源數編的：
 * 場景裡多一盞燈，**每一個材質都重編一次** —— 幾百毫秒的卡頓，而且會在
 * 照明彈點燃的那一刻發生。四盞一直在，沒在用的強度 0。
 *
 * 【四盞的代價】每個片元多四次光照，地面那一顆網格最大。太卡就把
 * `FLARE_LIGHT_COUNT` 降到 2。
 */
export const FLARE_LIGHT_COUNT = 4
/** 光源的照射距離，m */
export const FLARE_LIGHT_DISTANCE = 2500
const FLARE_LIGHT_INTENSITY = 6
const FLARE_COLOR = 0xfff2d0
/** 光暈 sprite 的直徑，m */
const GLOW_SIZE = 40
/** 最後這幾秒亮度線性衰到 0 */
const FADE_SECONDS = 30

export function flareBrightness(age: number): number {
  const left = FLARE_BURN - age
  if (left <= 0) return 0
  if (left >= FADE_SECONDS) return 1
  return left / FADE_SECONDS
}

export interface FlareLights {
  readonly object: Group
  /** 每一渲染幀呼叫 */
  update(f: Flares): void
  dispose(): void
}

/** 依年齡排序用的索引，模組級，不配置。上界是池的容量 */
const ORDER = new Int32Array(64)

export function createFlareLights(glow: Texture): FlareLights {
  const object = new Group()
  const lights: PointLight[] = []
  for (let k = 0; k < FLARE_LIGHT_COUNT; k++) {
    const l = new PointLight(FLARE_COLOR, 0, FLARE_LIGHT_DISTANCE, 2)
    object.add(l)
    lights.push(l)
  }
  const material = new SpriteMaterial({
    map: glow, color: FLARE_COLOR, blending: AdditiveBlending, transparent: true, depthWrite: false,
  })
  const sprites: Sprite[] = []

  return {
    object,
    update(f) {
      if (f.capacity > ORDER.length) throw new Error(`照明彈池 ${f.capacity} 格，排序緩衝只有 ${ORDER.length}`)
      // sprite 的數量跟池的容量走，第一次看到才建
      while (sprites.length < f.capacity) {
        const s = new Sprite(material)
        s.visible = false
        object.add(s)
        sprites.push(s)
      }
      // 亮著的依年齡由小到大排（插入排序，最多 16 個）
      let n = 0
      for (let i = 0; i < f.capacity; i++) {
        if (f.live[i] === 0) continue
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
        const b = flareBrightness(f.age[i]!)
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
