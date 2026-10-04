import {
  Color, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial,
  NormalBlending, PlaneGeometry, Quaternion, type Texture, Vector3,
} from 'three'
import { injectBillboard } from './particles'
import { hash01 } from './scatter'
import type { DayPalette } from './timeOfDay'

/**
 * # 靜止的雲朵
 *
 * 一朵雲是一團面向相機的煙團（與爆炸黑煙同一套廣告板，`injectBillboard`）疊成的：中心高、
 * 邊緣低、底部平，底下的煙團暗一點。**雲不飄、不長大、不淡出** —— 建場時擺好就不動，
 * 每幀不寫任何東西。全部雲朵是一顆 `InstancedMesh`、一次繪製。
 *
 * 短片與關卡共用：呼叫端給世界座標的雲心與半徑（`CloudSpec`），顏色照時段給
 * （`cloudColorOf`）。
 *
 * 【靠近相機就淡掉】廣告板貼到相機前會整片糊住、穿過去的那一幀突然跳不見。離相機
 * `CLOUD_FADE_NEAR`～`CLOUD_FADE_FAR` 之間淡出（`injectCloudFade`），飛機從雲裡穿過、
 * 鏡頭擦過雲邊都不會突兀。
 *
 * 【吃場景的霧】材質是 `MeshBasicMaterial`，遠處的雲照常融進霧裡（含高度霧）。
 */

/** 一朵雲：世界座標的雲底中心與水平半徑，m */
export interface CloudSpec {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly radius: number
}

/** 一團煙：相對雲底中心的位移、直徑（m）與明暗（1 = 雲頂的亮度） */
export interface CloudPuff {
  dx: number
  dy: number
  dz: number
  size: number
  shade: number
}

/** 全部雲朵合計最多幾團煙 */
export const CLOUD_PUFF_CAPACITY = 512
/** 每這麼多公尺半徑一團煙；一朵雲的團數夾在 `CLOUD_PUFFS_MIN`～`CLOUD_PUFFS_MAX` */
export const CLOUD_PUFF_SPACING = 8
export const CLOUD_PUFFS_MIN = 6
export const CLOUD_PUFFS_MAX = 28
/** 雲頂比雲底高多少，倍半徑 */
export const CLOUD_DOME = 0.45
/** 雲底的煙團比雲頂暗多少（1 − 這個 = 雲底的亮度） */
export const CLOUD_BASE_DARK = 0.28
/** 每團煙的不透明度 */
export const CLOUD_ALPHA = 0.9
/** 離相機這麼近完全透明、這麼遠才完全不透明，m */
export const CLOUD_FADE_NEAR = 25
export const CLOUD_FADE_FAR = 90
/** 雲色配方：日光、天空半球光、環境光各佔多少；日光強度以正午 2.2 為 1 */
export const CLOUD_SUN = 0.55
export const CLOUD_SKY = 0.45
export const CLOUD_AMBIENT = 1
const CLOUD_SUN_REF = 2.2

/** 一朵雲幾團煙 */
export function cloudPuffCount(radius: number): number {
  return Math.min(CLOUD_PUFFS_MAX, Math.max(CLOUD_PUFFS_MIN, Math.round(radius / CLOUD_PUFF_SPACING)))
}

/**
 * 第 `k` 團煙在雲裡的位置、大小、明暗（純函數，`seed` 一樣就一樣）。水平撒在 0.75 倍半徑
 * 的圓裡，越靠中心疊得越高（雲頂圓、邊緣低），雲底是平的
 */
export function cloudPuff(c: CloudSpec, seed: number, k: number, out: CloudPuff): CloudPuff {
  const h = seed * 7919 + k * 97
  const a = hash01(h + 1) * Math.PI * 2
  const r = Math.sqrt(hash01(h + 2)) * 0.75
  const lift = (1 - r * r) * (0.35 + 0.65 * hash01(h + 3))
  out.dx = Math.cos(a) * r * c.radius
  out.dz = Math.sin(a) * r * c.radius
  out.dy = lift * CLOUD_DOME * c.radius
  out.size = c.radius * (0.7 + 0.5 * hash01(h + 4))
  out.shade = 1 - CLOUD_BASE_DARK * (1 - lift)
  return out
}

const SKY = new Color()

/** 這個時段的雲色（雲頂、受光面），寫進 `out` */
export function cloudColorOf(p: DayPalette, out: Color): Color {
  out.set(p.sunColor).multiplyScalar(CLOUD_SUN * Math.min(1, p.sunIntensity / CLOUD_SUN_REF))
  out.add(SKY.set(p.hemiSky).multiplyScalar(CLOUD_SKY * p.hemiIntensity))
  out.add(SKY.set(p.ambientColor).multiplyScalar(CLOUD_AMBIENT * p.ambientIntensity))
  return out.setRGB(Math.min(1, out.r), Math.min(1, out.g), Math.min(1, out.b))
}

/**
 * 在 `injectBillboard` 之後再注入「靠近相機就淡掉」。抽成具名函式是為了拿 three 真正的
 * `ShaderLib.basic` 斷言注入有發生 —— `String.replace` 找不到目標時不報錯，雲會靜靜地
 * 退化成貼臉就糊一片
 */
export function injectCloudFade(shader: { vertexShader: string; fragmentShader: string }): void {
  shader.vertexShader = shader.vertexShader
    .replace('varying float vAlpha;', 'varying float vAlpha;\n       varying float vCloudDist;')
    .replace('gl_Position = projectionMatrix * mvPosition;',
      'gl_Position = projectionMatrix * mvPosition;\n       vCloudDist = -mvPosition.z;')
  shader.fragmentShader = shader.fragmentShader
    .replace('varying float vAlpha;', 'varying float vAlpha;\n       varying float vCloudDist;')
    .replace('gl_FragColor.a *= vAlpha;',
      `gl_FragColor.a *= vAlpha * smoothstep(${CLOUD_FADE_NEAR.toFixed(1)}, ${CLOUD_FADE_FAR.toFixed(1)}, vCloudDist);`)
}

export interface Clouds {
  readonly object: InstancedMesh
  /** 換成這一批雲（世界座標）與雲色。建場時呼叫，不在幀迴圈裡；超出容量的煙團丟掉 */
  set(list: readonly CloudSpec[], color: Color): void
  /** 拿掉全部雲 */
  clear(): void
  dispose(): void
}

const M = new Matrix4()
const POS = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const TINT = new Color()
const PUFF: CloudPuff = { dx: 0, dy: 0, dz: 0, size: 0, shade: 1 }

export function createClouds(alphaMap: Texture, capacity = CLOUD_PUFF_CAPACITY): Clouds {
  // 四邊形的頂點落在 [-0.5, 0.5]，縮放值就是直徑（與 `particles.ts` 同一個約定）
  const geometry = new PlaneGeometry(1, 1)
  const alphas = new InstancedBufferAttribute(new Float32Array(capacity).fill(CLOUD_ALPHA), 1)
  geometry.setAttribute('aAlpha', alphas)
  // 【逐團轉貼圖】同一張煙的貼圖疊十幾團，不轉的話看得出是同一個形狀重複
  const spins = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  for (let i = 0; i < capacity; i++) (spins.array as Float32Array)[i] = hash01(i * 0x3c6ef372) * Math.PI * 2
  geometry.setAttribute('aSpin', spins)

  const material = new MeshBasicMaterial({
    color: 0xffffff, transparent: true, depthWrite: false, blending: NormalBlending, alphaMap,
  })
  material.onBeforeCompile = (s): void => {
    injectBillboard(s, false)
    injectCloudFade(s)
  }
  material.customProgramCacheKey = () => 'clouds'

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球建立時全在原點 —— 開著視錐剔除的話相機一離開原點整批不見
  object.frustumCulled = false
  object.count = 0
  object.name = 'clouds'

  return {
    object,

    set(list, color) {
      let n = 0
      list.forEach((c, j) => {
        const puffs = cloudPuffCount(c.radius)
        for (let k = 0; k < puffs && n < capacity; k++) {
          cloudPuff(c, j + 1, k, PUFF)
          POS.set(c.x + PUFF.dx, c.y + PUFF.dy, c.z + PUFF.dz)
          object.setMatrixAt(n, M.compose(POS, ROT, SCALE.setScalar(PUFF.size)))
          object.setColorAt(n, TINT.copy(color).multiplyScalar(PUFF.shade))
          n++
        }
      })
      object.count = n
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },

    clear() {
      object.count = 0
    },

    dispose() {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
