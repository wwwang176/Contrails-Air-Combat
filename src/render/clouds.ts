import {
  Color, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, NormalBlending,
  PlaneGeometry, Quaternion, SRGBColorSpace, type Texture, Vector3,
} from 'three'
import { hash01 } from './scatter'
import type { DayPalette } from './timeOfDay'

/**
 * # 靜止的雲朵
 *
 * 一朵雲是十幾團面向相機的雲塊疊成的：中心高、邊緣低、底部平，底下的雲塊暗一點。每一團
 * 從雲塊貼圖集（`/textures/cloud-puffs.png`，4 × 4 張照片裁下來的小雲）挑一張、隨機左右翻。
 * **雲不飄、不長大、不淡出** —— 建場時擺好就不動，每幀不寫任何東西。全部雲朵是一顆
 * `InstancedMesh`、一次繪製。
 *
 * 短片與關卡共用：呼叫端給世界座標的雲心與半徑（`CloudSpec`），顏色照時段給
 * （`cloudColorOf`）。
 *
 * 【貼圖的上方對齊世界上方】一般的廣告板跟著相機滾轉：掛在機身上的鏡頭一翻，雲塊整片
 * 跟著轉，照片裡的雲底跑到旁邊。這裡把四邊形的上方轉到「世界上方在畫面上的方向」，
 * 畫面怎麼滾，雲都是正的（`injectCloudPuff`）。正上下看時世界上方投到畫面上是一點，
 * 那時平順退回畫面上方。
 *
 * 【靠近相機就淡掉】雲塊貼到相機前會整片糊住、穿過去的那一幀突然跳不見。離相機
 * `CLOUD_FADE_NEAR`～`CLOUD_FADE_FAR` 之間淡出。
 *
 * 【雲塊之間不排序】`InstancedMesh` 無法逐實例排序，重疊的雲塊照繪製順序混合。雲塊顏色
 * 幾乎一樣、`depthWrite` 關著，看不出來；雲與飛機之間仍然正確（`depthTest` 開著）。
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

/** 一團雲塊：相對雲底中心的位移、直徑（m）、明暗（1 = 雲頂的亮度）、貼圖集第幾張、翻不翻 */
export interface CloudPuff {
  dx: number
  dy: number
  dz: number
  size: number
  shade: number
  tile: number
  flip: boolean
}

/** 雲塊貼圖集：`CLOUD_ATLAS_SIDE` × `CLOUD_ATLAS_SIDE` 張 */
export const CLOUD_ATLAS_URL = '/textures/cloud-puffs.png'
export const CLOUD_ATLAS_SIDE = 4
/** 全部雲朵合計最多幾團雲塊 */
export const CLOUD_PUFF_CAPACITY = 1536
/** 每這麼多公尺半徑一團雲塊；一朵雲的團數夾在 `CLOUD_PUFFS_MIN`～`CLOUD_PUFFS_MAX` */
export const CLOUD_PUFF_SPACING = 4.7
export const CLOUD_PUFFS_MIN = 12
export const CLOUD_PUFFS_MAX = 84
/** 雲塊直徑，倍半徑（貼圖四周有留白，所以比雲塊實際的樣子大） */
export const CLOUD_PUFF_SIZE = 1.1
/** 雲頂比雲底高多少，倍半徑 */
export const CLOUD_DOME = 0.45
/** 雲底的雲塊比雲頂暗多少（1 − 這個 = 雲底的亮度） */
export const CLOUD_BASE_DARK = 0.28
/** 每團雲塊的不透明度（再乘上貼圖本身的透明度） */
export const CLOUD_ALPHA = 0.85
/** 離相機這麼近完全透明、這麼遠才完全不透明，m */
export const CLOUD_FADE_NEAR = 25
export const CLOUD_FADE_FAR = 90
/** 雲色配方：日光、天空半球光、環境光各佔多少；日光強度以正午 2.2 為 1 */
export const CLOUD_SUN = 0.55
export const CLOUD_SKY = 0.45
export const CLOUD_AMBIENT = 1
const CLOUD_SUN_REF = 2.2

/** 一朵雲幾團雲塊 */
export function cloudPuffCount(radius: number): number {
  return Math.min(CLOUD_PUFFS_MAX, Math.max(CLOUD_PUFFS_MIN, Math.round(radius / CLOUD_PUFF_SPACING)))
}

/**
 * 第 `k` 團雲塊在雲裡的位置、大小、明暗、貼圖（純函數，`seed` 一樣就一樣）。水平撒在
 * 0.75 倍半徑的圓裡，越靠中心疊得越高（雲頂圓、邊緣低），雲底是平的
 */
export function cloudPuff(c: CloudSpec, seed: number, k: number, out: CloudPuff): CloudPuff {
  const h = seed * 7919 + k * 97
  const a = hash01(h + 1) * Math.PI * 2
  const r = Math.sqrt(hash01(h + 2)) * 0.75
  const lift = (1 - r * r) * (0.35 + 0.65 * hash01(h + 3))
  out.dx = Math.cos(a) * r * c.radius
  out.dz = Math.sin(a) * r * c.radius
  out.dy = lift * CLOUD_DOME * c.radius
  out.size = c.radius * CLOUD_PUFF_SIZE * (0.7 + 0.5 * hash01(h + 4))
  out.shade = 1 - CLOUD_BASE_DARK * (1 - lift)
  out.tile = Math.floor(hash01(h + 5) * CLOUD_ATLAS_SIDE * CLOUD_ATLAS_SIDE)
  out.flip = hash01(h + 6) < 0.5
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
 * 雲塊的著色器注入（`MeshBasicMaterial` + `map`）：廣告板的上方對齊世界上方、貼圖集取第
 * `aTile` 張（`aFlip` 左右翻）、靠近相機淡出。抽成具名函式是為了拿 three 真正的
 * `ShaderLib.basic` 斷言注入有發生 —— `String.replace` 找不到目標時不報錯，雲會靜靜地
 * 退化成一整張貼圖集、而且不再面向相機
 */
export function injectCloudPuff(shader: { vertexShader: string; fragmentShader: string }): void {
  const inv = (1 / CLOUD_ATLAS_SIDE).toFixed(6)
  const last = (CLOUD_ATLAS_SIDE - 1).toFixed(1)
  const side = CLOUD_ATLAS_SIDE.toFixed(1)
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       attribute float aTile;
       attribute float aFlip;
       varying float vAlpha;
       varying float vCloudDist;`,
    )
    .replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
       #ifdef USE_MAP
         // 【往內縮一點】取樣到隔壁那張的邊會在雲塊外圍描一圈別人的碎片
         vec2 tuv = vec2(aFlip > 0.5 ? 1.0 - uv.x : uv.x, uv.y) * 0.96 + 0.02;
         // 貼圖上下翻過（flipY），第 0 列在最上面 = UV 的最後一列
         vMapUv = (tuv + vec2(mod(aTile, ${side}), ${last} - floor(aTile / ${side}))) * ${inv};
       #endif`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float instScale = length(instanceMatrix[0].xyz);
       // 世界上方在畫面上的方向；正上下看時它縮成一點，平順退回畫面上方
       vec2 worldUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
       float upLen = length(worldUp);
       vec2 up2 = upLen > 1e-4 ? worldUp / upLen : vec2(0.0, 1.0);
       up2 = mix(vec2(0.0, 1.0), up2, smoothstep(0.05, 0.3, upLen));
       up2 = length(up2) > 1e-4 ? normalize(up2) : vec2(0.0, 1.0);
       vec2 right2 = vec2(up2.y, -up2.x);
       mvPosition.xy += (right2 * position.x + up2 * position.y) * instScale;
       vCloudDist = -mvPosition.z;
       gl_Position = projectionMatrix * mvPosition;`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;
       varying float vCloudDist;`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       gl_FragColor.a *= vAlpha * smoothstep(${CLOUD_FADE_NEAR.toFixed(1)}, ${CLOUD_FADE_FAR.toFixed(1)}, vCloudDist);`,
    )
}

export interface Clouds {
  readonly object: InstancedMesh
  /** 換成這一批雲（世界座標）與雲色。建場時呼叫，不在幀迴圈裡；超出容量的雲塊丟掉 */
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
const PUFF: CloudPuff = { dx: 0, dy: 0, dz: 0, size: 0, shade: 1, tile: 0, flip: false }

/** `atlas` 是雲塊貼圖集（`CLOUD_ATLAS_URL`）：白色、透明度在 alpha */
export function createClouds(atlas: Texture, capacity = CLOUD_PUFF_CAPACITY): Clouds {
  atlas.colorSpace = SRGBColorSpace
  // 四邊形的頂點落在 [-0.5, 0.5]，縮放值就是直徑
  const geometry = new PlaneGeometry(1, 1)
  const alphas = new InstancedBufferAttribute(new Float32Array(capacity).fill(CLOUD_ALPHA), 1)
  const tiles = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  const flips = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aAlpha', alphas)
  geometry.setAttribute('aTile', tiles)
  geometry.setAttribute('aFlip', flips)

  const material = new MeshBasicMaterial({
    color: 0xffffff, map: atlas, transparent: true, depthWrite: false, blending: NormalBlending,
  })
  material.onBeforeCompile = (s): void => injectCloudPuff(s)
  material.customProgramCacheKey = () => 'clouds'

  const object = new InstancedMesh(geometry, material, capacity)
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
          ;(tiles.array as Float32Array)[n] = PUFF.tile
          ;(flips.array as Float32Array)[n] = PUFF.flip ? 1 : 0
          n++
        }
      })
      object.count = n
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
      tiles.needsUpdate = true
      flips.needsUpdate = true
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
