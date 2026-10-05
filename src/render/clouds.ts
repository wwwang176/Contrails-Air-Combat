import {
  Color, Group, InstancedBufferAttribute, InstancedMesh, Matrix4, MeshBasicMaterial, NormalBlending,
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

/**
 * 一團雲塊：相對雲底中心的位移、直徑（m）、明暗（1 = 雲頂的亮度）、貼圖集第幾張、翻不翻，
 * 與大小名次（0～1，越大的雲塊越高；遠處先丟名次低的，見 `CLOUD_LOD_*`）
 */
export interface CloudPuff {
  dx: number
  dy: number
  dz: number
  size: number
  shade: number
  tile: number
  flip: boolean
  rank: number
}

/** 雲塊貼圖集：`CLOUD_ATLAS_SIDE` × `CLOUD_ATLAS_SIDE` 張 */
export const CLOUD_ATLAS_URL = '/textures/cloud-puffs.png'
export const CLOUD_ATLAS_SIDE = 4
/**
 * 每一張雲塊在原本正方形裡實際佔的長方形：寬、高（倍正方形邊長）與中心偏移（x 往右、
 * y 往上，倍邊長）。貼圖集裡每一格存的是拉伸填滿的那個長方形，四邊形照這張表縮回原本的
 * 比例、挪回原本的位置 —— 雲塊的大小形狀與正方形版一樣，透明的留白少畫約三成七。
 * 【表與貼圖集是一組】換貼圖集就要換這張表，否則雲塊被拉成別的比例
 */
export const CLOUD_TILES: readonly (readonly [number, number, number, number])[] = [
  [0.91, 0.445, 0.002, 0], [0.895, 0.496, 0.002, -0.002], [0.914, 0.344, 0, 0], [0.945, 0.469, 0.016, 0],
  [0.871, 0.871, 0.002, -0.002], [0.902, 0.488, 0.002, -0.002], [0.914, 0.922, 0.004, 0], [0.91, 0.805, -0.006, -0.094],
  [0.906, 0.98, -0.008, -0.006], [0.945, 0.93, 0.012, -0.035], [0.918, 0.855, -0.002, -0.002], [0.922, 0.762, 0, -0.002],
  [0.922, 0.715, 0, -0.131], [0.922, 0.664, 0, -0.168], [0.922, 0.609, 0, -0.164], [0.918, 0.672, -0.002, 0.16],
]
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
export const CLOUD_BASE_DARK = 0.08
/**
 * 雲塊照片內部的明暗往白色拉多少（0 = 照片原樣，1 = 整塊純色）。照片的暗處一明顯，雲塊之間
 * 沒有前後排序（見檔頭）就看得出後面的雲塊疊在前面
 */
export const CLOUD_FLATTEN = 0.6
/** 每團雲塊的不透明度（再乘上貼圖本身的透明度） */
export const CLOUD_ALPHA = 0.85
/** 離相機這麼近完全透明、這麼遠才完全不透明，m */
export const CLOUD_FADE_NEAR = 25
export const CLOUD_FADE_FAR = 90
/**
 * 中心離相機不到這麼遠的雲塊整塊不畫，m。這裡的不透明度不到 5%（smoothstep 在 25～90 m 之間
 * 的 13% 處），看不出少了；照樣畫的話穿雲時是十幾層全螢幕的透明混合
 */
export const CLOUD_CULL_NEAR = 33
/**
 * 深度那一遍只寫「貼圖透明度 × 不透明度 × 淡出」到這麼高的地方 —— 雲塊的核心。柔邊不寫，
 * 後面的東西透得過柔邊；寫了的話柔邊後面的煙被切成一塊硬邊
 */
export const CLOUD_DEPTH_CUTOFF = 0.5
/**
 * 深度那一遍寫的深度往後推多少，倍雲塊直徑。雲的白是十幾層雲塊疊出來的；深度照雲塊本身的
 * 位置寫的話，最前面那塊的核心把同一朵雲後面的雲塊全擋掉，那裡只剩一層、又薄又灰。往後推，
 * 同一朵雲的雲塊互不阻擋，雲後面遠處的煙仍被擋住
 */
export const CLOUD_DEPTH_PUSH = 1
/**
 * 遠處的雲少用雲塊：離相機 `CLOUD_LOD_NEAR` 以內全畫，到 `CLOUD_LOD_FAR` 只留大小名次最高的
 * `CLOUD_LOD_KEEP`（大的雲塊撐住輪廓）。被丟的雲塊在名次邊界 `CLOUD_LOD_BAND` 內淡出，不會一塊塊跳。
 * 整片雲層一次看到幾百朵時，遠的那幾百朵在畫面上很小，雲塊少了看不出來
 */
export const CLOUD_LOD_NEAR = 1200
export const CLOUD_LOD_FAR = 3500
export const CLOUD_LOD_KEEP = 0.35
export const CLOUD_LOD_BAND = 0.15
/**
 * 最遠畫到哪，m：`CLOUD_DRAW_FADE` 起淡出、`CLOUD_DRAW_FAR` 外整塊不畫。場景的霧太淡，幾公里外的雲
 * 遮不掉，要自己收
 */
export const CLOUD_DRAW_FADE = 6000
export const CLOUD_DRAW_FAR = 8000
/**
 * 雲的顏色那一遍排在所有半透明物件前面畫。雲與煙都不寫深度、物件又都在原點（距離排序分不出
 * 先後），晚畫的那一方在重疊處永遠蓋在上面；雲先畫，近處的煙才疊得在雲上
 */
export const CLOUD_RENDER_ORDER = -10
/** 雲色配方：日光、天空半球光、環境光各佔多少；日光強度以正午 2.2 為 1 */
export const CLOUD_SUN = 0.65
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
  out.rank = hash01(h + 4)
  out.size = c.radius * CLOUD_PUFF_SIZE * (0.7 + 0.5 * out.rank)
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
export function injectCloudPuff(shader: { vertexShader: string; fragmentShader: string }, depthOnly = false): void {
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
       attribute vec4 aExtent;
       attribute float aRank;
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
      `vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float instScale = length(instanceMatrix[0].xyz);
       // 世界上方在畫面上的方向；正上下看時它縮成一點，平順退回畫面上方
       vec2 worldUp = (viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xy;
       float upLen = length(worldUp);
       vec2 up2 = upLen > 1e-4 ? worldUp / upLen : vec2(0.0, 1.0);
       up2 = mix(vec2(0.0, 1.0), up2, smoothstep(0.05, 0.3, upLen));
       up2 = length(up2) > 1e-4 ? normalize(up2) : vec2(0.0, 1.0);
       vec2 right2 = vec2(up2.y, -up2.x);
       vCloudDist = -mvPosition.z;
       // 遠處只留大小名次高的雲塊（CLOUD_LOD_*），被丟的在名次邊界內淡出；再遠整片淡出（CLOUD_DRAW_*）
       float keep = mix(1.0, ${CLOUD_LOD_KEEP.toFixed(3)}, smoothstep(${CLOUD_LOD_NEAR.toFixed(1)}, ${CLOUD_LOD_FAR.toFixed(1)}, vCloudDist));
       float lodFade = clamp((aRank - (1.0 - keep)) / ${CLOUD_LOD_BAND.toFixed(3)}, 0.0, 1.0);
       float farFade = 1.0 - smoothstep(${CLOUD_DRAW_FADE.toFixed(1)}, ${CLOUD_DRAW_FAR.toFixed(1)}, vCloudDist);
       vAlpha = aAlpha * lodFade * farFade;
       // 這一張雲塊實際佔的長方形（CLOUD_TILES）：縮回原本的寬高、挪回原本的位置；左右翻時偏移也翻
       vec2 local = vec2(
         position.x * aExtent.x + (aFlip > 0.5 ? -aExtent.z : aExtent.z),
         position.y * aExtent.y + aExtent.w);
       mvPosition.xy += (right2 * local.x + up2 * local.y) * instScale;${depthOnly ? `
       // 深度往後推（CLOUD_DEPTH_PUSH）：同一朵雲的雲塊互不阻擋
       mvPosition.z -= instScale * ${CLOUD_DEPTH_PUSH.toFixed(3)};` : ''}
       gl_Position = projectionMatrix * mvPosition;
       // 【幾乎透明的不畫】中心離相機不到 CLOUD_CULL_NEAR 的雲塊不透明度不到 5%，照樣光柵化的話
       // 穿雲時是十幾層全螢幕的透明混合。四個頂點的中心深度相同，整塊一起移出裁切範圍
       // 遠處被丟掉、超出最遠距離的雲塊也一樣整塊移出
       if (vCloudDist < ${CLOUD_CULL_NEAR.toFixed(1)} || vAlpha <= 0.0) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);`,
    )
  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;
       varying float vCloudDist;`,
    )
    .replace(
      '#include <map_fragment>',
      depthOnly
        ? `#include <map_fragment>
       // 【深度那一遍只寫核心】透明度不到 CLOUD_DEPTH_CUTOFF 的柔邊與淡出中的雲塊不寫深度
       if (diffuseColor.a * vAlpha * smoothstep(${CLOUD_FADE_NEAR.toFixed(1)}, ${CLOUD_FADE_FAR.toFixed(1)}, vCloudDist) < ${CLOUD_DEPTH_CUTOFF.toFixed(3)}) discard;`
        : `#include <map_fragment>
       // 照片內部的明暗往白色拉（CLOUD_FLATTEN）；雲底變暗與時段雲色在之後的逐塊顏色裡乘上
       diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0), ${CLOUD_FLATTEN.toFixed(3)});`,
    )
    .replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       gl_FragColor.a *= vAlpha * smoothstep(${CLOUD_FADE_NEAR.toFixed(1)}, ${CLOUD_FADE_FAR.toFixed(1)}, vCloudDist);`,
    )
}

export interface Clouds {
  /** 加進場景的那一個：深度那一遍與顏色那一遍兩顆網格 */
  readonly object: Group
  /** 顏色那一遍（畫面上看到的雲） */
  readonly mesh: InstancedMesh
  /** 深度那一遍：只寫雲塊核心的深度、不畫顏色，當成實心物件在所有半透明物件之前畫 */
  readonly depth: InstancedMesh
  /** 開關深度那一遍（量測與對照用；預設開） */
  setDepthPrepass(on: boolean): void
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
const PUFF: CloudPuff = { dx: 0, dy: 0, dz: 0, size: 0, shade: 1, tile: 0, flip: false, rank: 0 }

/** `atlas` 是雲塊貼圖集（`CLOUD_ATLAS_URL`）：白色、透明度在 alpha */
export function createClouds(atlas: Texture, capacity = CLOUD_PUFF_CAPACITY): Clouds {
  atlas.colorSpace = SRGBColorSpace
  // 四邊形的頂點落在 [-0.5, 0.5]，縮放值就是直徑
  const geometry = new PlaneGeometry(1, 1)
  const alphas = new InstancedBufferAttribute(new Float32Array(capacity).fill(CLOUD_ALPHA), 1)
  const tiles = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  const flips = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  const extents = new InstancedBufferAttribute(new Float32Array(capacity * 4), 4)
  const ranks = new InstancedBufferAttribute(new Float32Array(capacity), 1)
  geometry.setAttribute('aRank', ranks)
  geometry.setAttribute('aAlpha', alphas)
  geometry.setAttribute('aTile', tiles)
  geometry.setAttribute('aFlip', flips)
  geometry.setAttribute('aExtent', extents)

  const material = new MeshBasicMaterial({
    color: 0xffffff, map: atlas, transparent: true, depthWrite: false, blending: NormalBlending,
  })
  material.onBeforeCompile = (s): void => injectCloudPuff(s)
  material.customProgramCacheKey = () => 'clouds'
  // 【深度那一遍是實心物件】不透明的那一批在所有半透明物件之前畫：雲核心後面的煙、同一朵雲
  // 背面的雲塊，深度都比不過而被擋掉；只寫深度、不寫顏色
  const depthMaterial = new MeshBasicMaterial({ map: atlas, colorWrite: false, depthWrite: true })
  depthMaterial.onBeforeCompile = (s): void => injectCloudPuff(s, true)
  depthMaterial.customProgramCacheKey = () => 'clouds-depth'

  const object = new InstancedMesh(geometry, material, capacity)
  // 包圍球建立時全在原點 —— 開著視錐剔除的話相機一離開原點整批不見
  object.frustumCulled = false
  object.count = 0
  object.renderOrder = CLOUD_RENDER_ORDER
  object.name = 'clouds'
  const depth = new InstancedMesh(geometry, depthMaterial, capacity)
  // 【同一份雲塊位置】兩遍的頂點算法一樣、矩陣是同一份，深度與顏色那一遍的雲塊才疊得剛好
  depth.instanceMatrix = object.instanceMatrix
  depth.frustumCulled = false
  depth.count = 0
  // 【排在天空之後】天空也是實心物件；它晚畫的話，雲核心先寫了深度的地方天空畫不上去，露出底色
  depth.renderOrder = 1000
  depth.name = 'clouds.depth'
  const group = new Group()
  group.name = 'clouds'
  group.add(depth, object)

  return {
    object: group,
    mesh: object,
    depth,

    setDepthPrepass(on) {
      depth.visible = on
    },

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
          const e = CLOUD_TILES[PUFF.tile]!
          ;(extents.array as Float32Array).set(e, n * 4)
          ;(ranks.array as Float32Array)[n] = PUFF.rank
          n++
        }
      })
      object.count = n
      depth.count = n
      object.instanceMatrix.needsUpdate = true
      if (object.instanceColor) object.instanceColor.needsUpdate = true
      tiles.needsUpdate = true
      flips.needsUpdate = true
      extents.needsUpdate = true
      ranks.needsUpdate = true
    },

    clear() {
      object.count = 0
      depth.count = 0
    },

    dispose() {
      geometry.dispose()
      material.dispose()
      depthMaterial.dispose()
      object.dispose()
      depth.dispose()
    },
  }
}
