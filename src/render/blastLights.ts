import { Color, Group, PointLight, Vector3 } from 'three'
import { ordnanceShakeScale } from '../camera/cameraShake'

type V3 = Vector3

/**
 * # 爆炸的閃光
 *
 * 炸彈、魚雷、擊墜、地面目標、艦上砲位與高射砲。固定 `BLAST_LIGHT_COUNT` 盞
 * 點光源；一次爆炸借一盞，亮一下就熄。**燈照地面、海、船與飛機，同一份位置
 * 與強度也餵給煙的著色器**（`smokeLighting.ts`）—— 煙與地面被同一盞光照亮。
 *
 * 【為什麼燈數固定】`MeshStandardMaterial` 的著色器依光源數編譯：場景裡多一盞
 * 燈，每一個受光材質都重編一次，幾百毫秒的卡頓會落在爆炸那一刻。燈開場就
 * 掛著、沒在用的強度 0。
 *
 * 【很多顆同時爆】燈不會變多。新的爆炸搶**目前最暗**的那一盞 —— 通常是最早
 * 炸的那顆，衰減得差不多了，被搶走時看不出光突然消失。一串連投的炸彈於是是
 * 一道沿落彈線往前滾的閃光。最暗的那盞都比新的一發亮時就不點：高砲的小閃光
 * 蓋不掉正在亮的炸彈閃光。
 */

export const BLAST_LIGHT_COUNT = 3
/** 最小當量的閃光秒數 */
export const BLAST_LIGHT_SECONDS_MIN = 0.1
/** 基準彈（尺度 1）以上的閃光秒數 */
export const BLAST_LIGHT_SECONDS_MAX = 0.3
/** 火光的顏色。**起始值，由試飛裁定。** */
export const BLAST_LIGHT_COLOR = 0xffa24a
/**
 * 基準彈的峰值強度，燭光。three 的點光源是 1/d² 衰減：爆心上方 30 m 的地面
 * 照度約 I / 900。**起始值，由試飛裁定。**
 */
export const BLAST_LIGHT_INTENSITY = 3e4
/** 基準彈的照射半徑，m。超過就完全不照（three 的截止距離）。**起始值。** */
export const BLAST_LIGHT_DISTANCE = 400
/**
 * 離鏡頭超過這個距離的爆炸不點燈，m。遠處的一顆小炸彈不該搶走近處正在亮的
 * 那一盞，而那麼遠的閃光在畫面上也照不到什麼。
 */
export const BLAST_LIGHT_CULL = 4000
/** 燈放在爆心上方多高，m —— 貼著地面放的話只照得到腳下那一小圈 */
export const BLAST_LIGHT_LIFT = 10

/**
 * 當量尺度 → 閃光的尺度（亮度與照射半徑都乘它）。**與鏡頭震動同一條曲線**
 * （`ordnanceShakeScale`）：基準彈以上原樣，以下大幅放大 —— 線性的話 60 kg
 * 彈只有基準彈一成的亮度，畫面上看不出來。兩者一起調，一顆炸彈的「晃」與
 * 「亮」才對得上。
 */
export function blastLightScale(scale: number): number {
  return ordnanceShakeScale(scale)
}

/** 閃光秒數：0.1 秒起，當量越大越久，基準彈以上 0.3 秒。 */
export function blastLightSeconds(scale: number): number {
  if (scale >= 1) return BLAST_LIGHT_SECONDS_MAX
  const s = scale > 0 ? scale : 0
  return BLAST_LIGHT_SECONDS_MIN + (BLAST_LIGHT_SECONDS_MAX - BLAST_LIGHT_SECONDS_MIN) * s
}

/** 亮度比例：爆炸那一刻 1，剩餘時間比例的平方，到時間歸零。 */
export function blastLightFalloff(age: number, seconds: number): number {
  if (age <= 0) return 1
  if (!(seconds > 0) || age >= seconds) return 0
  const left = 1 - age / seconds
  return left * left
}

/** 煙的著色器讀的那一份。**三個陣列的長度恆為 `BLAST_LIGHT_COUNT`** */
export interface BlastLightUniforms {
  readonly uBlastLightPos: { readonly value: V3[] }
  /** 燈色 × 亮度比例 × 閃光尺度。熄著的是零向量 */
  readonly uBlastLightColor: { readonly value: V3[] }
  readonly uBlastLightRadius: { readonly value: number[] }
}

export function createBlastLightUniforms(): BlastLightUniforms {
  const vecs = (): V3[] => Array.from({ length: BLAST_LIGHT_COUNT }, () => new Vector3())
  return {
    uBlastLightPos: { value: vecs() },
    uBlastLightColor: { value: vecs() },
    uBlastLightRadius: { value: new Array<number>(BLAST_LIGHT_COUNT).fill(0) },
  }
}

export interface BlastLights {
  readonly object: Group
  readonly smokeUniforms: BlastLightUniforms
  /**
   * 一次爆炸。`scale` 是爆炸相似律的線性尺度（`blastScaleOf` 或各爆炸的震動
   * 尺度），`cam` 是相機位置。**不配置。**
   *
   * @param amplify 小當量要不要照 `blastLightScale` 放大。高砲傳 false ——
   *   火網下每秒好幾發，放大的話整片一直大亮
   */
  flash(x: number, y: number, z: number, scale: number, cam: V3, amplify?: boolean): void
  /** 推進畫面時間。每一渲染幀一次 */
  step(dt: number): void
  /** 全部熄掉。換一場戰鬥時呼叫 */
  reset(): void
  dispose(): void
}

export function createBlastLights(): BlastLights {
  const object = new Group()
  const lights: PointLight[] = []
  for (let k = 0; k < BLAST_LIGHT_COUNT; k++) {
    const l = new PointLight(BLAST_LIGHT_COLOR, 0, BLAST_LIGHT_DISTANCE, 2)
    // 【燈在每一個圖層都亮】three 只收 `light.layers.test(camera.layers)` 的燈，
    // 而低解析度煙那一趟只開第 1 層 —— 燈只在第 0 層的話兩趟的燈數不同，每個
    // 受光材質每幀重算 shader program
    l.layers.enableAll()
    object.add(l)
    lights.push(l)
  }
  const smokeUniforms = createBlastLightUniforms()
  const base = new Color(BLAST_LIGHT_COLOR)
  const age = new Float32Array(BLAST_LIGHT_COUNT)
  const seconds = new Float32Array(BLAST_LIGHT_COUNT)
  const size = new Float32Array(BLAST_LIGHT_COUNT)

  function apply(k: number): void {
    const l = lights[k]!
    const f = size[k]! > 0 ? blastLightFalloff(age[k]!, seconds[k]!) : 0
    if (f <= 0) size[k] = 0
    const s = size[k]!
    l.intensity = BLAST_LIGHT_INTENSITY * s * f
    l.distance = BLAST_LIGHT_DISTANCE * s
    smokeUniforms.uBlastLightPos.value[k]!.copy(l.position)
    smokeUniforms.uBlastLightColor.value[k]!.set(base.r, base.g, base.b).multiplyScalar(s * f)
    smokeUniforms.uBlastLightRadius.value[k] = BLAST_LIGHT_DISTANCE * s
  }

  return {
    object,
    smokeUniforms,
    flash(x, y, z, scale, cam, amplify = true) {
      const s = amplify ? blastLightScale(scale) : scale > 0 ? scale : 0
      if (s <= 0) return
      const dx = x - cam.x
      const dy = y - cam.y
      const dz = z - cam.z
      if (dx * dx + dy * dy + dz * dz > BLAST_LIGHT_CULL * BLAST_LIGHT_CULL) return
      let k = 0
      for (let i = 1; i < BLAST_LIGHT_COUNT; i++) {
        if (lights[i]!.intensity < lights[k]!.intensity) k = i
      }
      // 【小閃光不蓋掉大閃光】最暗的那盞都比這一發亮的話就不點 —— 高砲一發
      // 不能把正在亮的炸彈或擊墜閃光搶走
      if (lights[k]!.intensity > BLAST_LIGHT_INTENSITY * s) return
      lights[k]!.position.set(x, y + BLAST_LIGHT_LIFT, z)
      age[k] = 0
      seconds[k] = blastLightSeconds(scale)
      size[k] = s
      apply(k)
    },
    step(dt) {
      for (let k = 0; k < BLAST_LIGHT_COUNT; k++) {
        if (size[k]! <= 0) continue
        age[k] = age[k]! + dt
        apply(k)
      }
    },
    reset() {
      for (let k = 0; k < BLAST_LIGHT_COUNT; k++) {
        age[k] = 0
        size[k] = 0
        apply(k)
      }
    },
    dispose() {
      for (const l of lights) l.dispose()
    },
  }
}
