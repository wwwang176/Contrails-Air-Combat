import {
  DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4,
  MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { SPLASH_SHOULDER, SPLASH_TOP_RATIO, bulletProfile } from './splash'

/**
 * 爆炸的水冠 —— **粗水柱**，逐根指定高度與粗細。
 *
 * 【與 `splash.ts` 的水柱的差別】那一支是子彈與殘骸入水：高度與粗細由池格
 * 的雜湊決定、沒有逐實例透明度（它的註解記著「高度曲線本身就完成了消失」）。
 * 爆炸的水冠要的是另外三件事 —— 逐根指定尺寸（水冠是常態分佈，中央高）、
 * 瞬間衝起、落下時淡出讓水霧接手。三件都改不進那一支的介面。
 *
 * 【幾何共用】`bulletProfile()` 是同一支旋成體：柱身微收到肩部、再由肩部
 * 圓弧收到頂點。爆炸的水柱與子彈的水柱長得一樣，只是大得多。
 */

/** 抽到滿高要多久，s。比子彈那一支的 0.1 s 更急 —— 爆炸是瞬間衝起 */
export const JET_RISE = 0.06
/** 開始淡出的年齡比例。之前是實心的水 */
export const JET_FADE = 0.45
/** 出生時的高度佔滿高的比例 */
export const JET_SEED = 0.12
export const JET_CAPACITY = 256

/**
 * 年齡比例 → 高度佔滿高的比例。
 *
 * ```
 *   0 – rise    種子 → 滿高      衝起來
 *   rise – 1    滿高 → 0         塌回水面
 * ```
 */
export function jetScale(t: number, rise: number): number {
  if (t <= 0) return JET_SEED
  if (t >= 1) return 0
  if (t <= rise) return JET_SEED + (1 - JET_SEED) * (t / rise)
  return 1 - (t - rise) / (1 - rise)
}

/**
 * 年齡比例 → 不透明度。前段實心，`JET_FADE` 之後淡出。
 *
 * 【淡出而不只是塌下去】只靠高度收回去的話，柱子消失的方式是「縮進水裡」；
 * 水冠實際上是**散成水霧**，體積不會回收。
 */
export function jetAlpha(t: number, alphaFrom: number): number {
  if (t <= JET_FADE) return alphaFrom
  return alphaFrom * Math.max(0, 1 - (t - JET_FADE) / (1 - JET_FADE))
}

/**
 * 柱身在 `up`（0 = 柱腳、1 = 頂點）處的半徑，佔底部半徑的比例。
 *
 * **這是 `bulletProfile()` 那條輪廓的解析式**：柱身微收到肩部，再由肩部
 * 四分之一橢圓收到頂點。水霧要照著柱子的形狀生，就得問得到這條曲線。
 */
export function jetProfileRadius(up: number): number {
  if (up <= 0) return 1
  if (up >= 1) return 0
  if (up <= SPLASH_SHOULDER) {
    return 1 - (1 - SPLASH_TOP_RATIO) * (up / SPLASH_SHOULDER)
  }
  const t = (up - SPLASH_SHOULDER) / (1 - SPLASH_SHOULDER)
  return SPLASH_TOP_RATIO * Math.cos((t * Math.PI) / 2)
}

/**
 * 離爆心 `u`（佔散佈半徑的比例）處的水柱高度倍率 —— **常態分佈**。
 *
 * 【為什麼不是一圈等高】等高的一圈讀起來是柵欄。真實的水冠是中央一柱最高，
 * 往外遞減成一圈裙擺。
 *
 * 中央 1.0、邊緣（u = 1）約 0.165。
 */
export function jetFalloff(u: number): number {
  return Math.exp(-1.8 * u * u)
}

/**
 * 逐實例 alpha 的著色器注入。
 *
 * 【抽成具名函式】`String.replace` 找不到目標時不報錯，所以測試拿 three
 * 真正的 `ShaderLib.basic` 斷言注入確實發生（同 `injectBillboard`）。
 */
export function injectJetAlpha(
  shader: { vertexShader: string; fragmentShader: string },
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       varying float vAlpha;`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       #include <project_vertex>`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       gl_FragColor.a *= vAlpha;`,
    )
}

export interface WaterJets {
  object: InstancedMesh
  readonly live: number
  /**
   * 生一根。
   *
   * @param height 滿高，m
   * @param radius 底部半徑，m
   */
  emit(x: number, y: number, z: number, height: number, radius: number): void
  step(dt: number): void
  reset(): void
  dispose(): void
}

export interface WaterJetConfig {
  capacity: number
  /** 壽命，s */
  life: number
  /** 抽到滿高佔壽命的比例 */
  rise: number
  alphaFrom: number
  /**
   * 一根柱子**衝到頂、開始下墜**時呼叫一次，帶著它的位置與當下的尺寸。
   *
   * 【時機是頂點，不是淡出】水冠一到頂就開始散成水霧，柱子還立著的時候霧
   * 就已經在了。等淡出才生的話，柱子塌了一半都還乾乾淨淨。
   */
  onFade?: ((
    x: number, y: number, z: number,
    height: number, radius: number, slot: number,
  ) => void) | undefined
}

const M = new Matrix4()
const POS = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const ZERO = new Vector3(0, 0, 0)

export function createWaterJets(cfg: WaterJetConfig): WaterJets {
  const { capacity, life } = cfg
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const hh = new Float32Array(capacity)
  const rr = new Float32Array(capacity)
  const age = new Float32Array(capacity).fill(Infinity)
  const zeroed = new Uint8Array(capacity).fill(1)
  const faded = new Uint8Array(capacity).fill(1)
  let next = 0
  let live = 0

  // 【輪廓的滿高是 SPLASH_HEIGHT】所以 Y 的縮放值是「這一根多高 ÷ 12」
  const geometry = bulletProfile()
  const alphas = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  alphas.setUsage(DynamicDrawUsage)
  geometry.setAttribute('aAlpha', alphas)

  const material = new MeshBasicMaterial({
    color: 0xdfefff, transparent: true, depthWrite: false,
  })
  material.onBeforeCompile = injectJetAlpha

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  object.frustumCulled = false
  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) object.setMatrixAt(i, M)
  object.instanceMatrix.needsUpdate = true

  return {
    object,
    get live() { return live },

    emit(x, y, z, height, radius): void {
      const i = next
      next = next + 1 >= capacity ? 0 : next + 1
      if (age[i]! >= life) live++
      zeroed[i] = 0
      faded[i] = 0
      px[i] = x
      py[i] = y
      pz[i] = z
      hh[i] = height
      rr[i] = radius
      age[i] = 0
    },

    step(dt: number): void {
      const a = alphas.array as Float32Array
      live = 0
      let touched = false
      for (let i = 0; i < capacity; i++) {
        const old = age[i]!
        if (old >= life) {
          if (zeroed[i] === 1) continue
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          a[i] = 0
          zeroed[i] = 1
          touched = true
          continue
        }
        const na = old + dt
        age[i] = na
        if (na >= life) {
          M.compose(ZERO, ROT.identity(), ZERO)
          object.setMatrixAt(i, M)
          a[i] = 0
          zeroed[i] = 1
          touched = true
          continue
        }
        live++
        touched = true

        const t = na / life
        const k = jetScale(t, cfg.rise)
        // 輪廓本身是 12 m 高、0.8 m 半徑；縮放到這一根要的尺寸
        POS.set(px[i]!, py[i]!, pz[i]!)
        SCALE.set(rr[i]! / 0.8, (hh[i]! * k) / 12, rr[i]! / 0.8)
        M.compose(POS, ROT.identity(), SCALE)
        object.setMatrixAt(i, M)
        a[i] = jetAlpha(t, cfg.alphaFrom)

        if (cfg.onFade !== undefined && faded[i] === 0 && t >= cfg.rise) {
          faded[i] = 1
          cfg.onFade(px[i]!, py[i]!, pz[i]!, hh[i]! * k, rr[i]!, i)
        }
      }
      if (touched) {
        object.instanceMatrix.needsUpdate = true
        alphas.needsUpdate = true
      }
    },

    reset(): void {
      age.fill(Infinity)
      faded.fill(1)
      live = 0
      next = 0
      const a = alphas.array as Float32Array
      M.compose(ZERO, ROT.identity(), ZERO)
      for (let i = 0; i < capacity; i++) {
        if (zeroed[i] === 1) continue
        object.setMatrixAt(i, M)
        a[i] = 0
        zeroed[i] = 1
      }
      object.instanceMatrix.needsUpdate = true
      alphas.needsUpdate = true
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
