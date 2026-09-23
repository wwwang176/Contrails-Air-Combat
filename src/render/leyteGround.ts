import {
  BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, DataTexture, Group, LinearFilter,
  LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, RedFormat, UnsignedByteType, type Object3D,
} from 'three'
import type { HeightFieldData } from '../world/heightfield'
import { FIELD_HALF, LEYTE_ROAD, ROAD_WIDTH, SAND_TOP, farHeight } from '../world/leyte'
import { buildGroundRect, DRAW_FLOOR } from './island'

/**
 * # 雷伊泰的地面
 *
 * 低多邊形的頂點色網格，與群島同一種畫法；差別在三件事：
 *
 * 1. **切成方塊**，不是一座座圓島 —— 陸地是一整片。一塊一個 Mesh，各自進出
 *    視錐；整塊沉在水下的格子不畫（`buildGroundRect`）。
 * 2. **沙灘由高度 `SAND_TOP` 分界**，平地（8 m）是草。群島的分界是 12 m，
 *    照搬的話整片平地都是沙。
 * 3. **公路畫在材質的 shader 裡**：離 `LEYTE_ROAD` 任一段小於半寬就是泥土路的
 *    顏色。不另建貼地的網格 —— 那會與地面共面，拉遠就閃。
 *
 * 【林子也畫在 shader 裡】每一株樹的樹冠烘成一張俯視圖（`CanopyMap`），地面照
 * 它往樹冠色混 —— 立體的樹生成範圍之外，林子仍然是一株一株的，不是一片平均色。
 *
 * 【泥土路，不是柏油】雨季的雷伊泰公路是泥濘的土路：顏色接近沙灘、邊緣不規則、
 * 顏色帶一點深淺。路寬沿路起伏（`roadHalfWidthAt`），邊緣有一段混進草地的過渡。
 */

const ROUGHNESS = 0.95
const SAND = new Color(0xc2b280)
const GRASS = new Color(0x55703f)
/** 樹冠的平均色：闊葉樹與灌木。地色按林相覆蓋率往它混 */
const CANOPY = new Color(0x2f4a2a)
/**
 * 樹冠圖畫上去的顏色：比 `CANOPY` 深。
 *
 * 【為什麼要更深】圖一格 8 m，遠處再經 mipmap 平均，一株一株的暗點會被四周
 * 的草地沖淡；顏色深一點，拉遠了林子仍然讀得出來。
 */
const CANOPY_MAP = new Color(0x1e331b)
/** 泥土路的顏色：比沙灘暗一點、偏土黃 */
export const ROAD_COLOR = 0xb5a276

/**
 * 路寬的起伏：三道斜向的正弦疊在標稱半寬上，各自的振幅比例。合計 ±45%，
 * 標稱半寬 12 m 時是 6.6～17.4 m。長波長的讓路忽寬忽窄，最短的那一道（波長
 * 二十幾公尺）讓路緣參差。**最窄處要大於車在轉角偏離中線的 2.1 m**
 * （`leyte-render.test.ts`），否則車會開到路外的草地上。
 */
const WIDTH_RIPPLE = [
  { amp: 0.22, fx: 0.031, fz: 0.017, phase: 0 },
  { amp: 0.13, fx: 0.083, fz: -0.061, phase: 1.3 },
  { amp: 0.1, fx: 0.21, fz: 0.17, phase: 0.7 },
] as const
/** 路緣混進草地的過渡寬，m。泥土路沒有一條刀切的邊 */
const ROAD_EDGE_SOFT = 3

/** 一塊方塊幾格邊長。40 × 80 m = 3.2 km */
export const LEYTE_TILE_CELLS = 40

/** 這裡看起來是草嗎。**植被只長在回真的地方**，與地色同一條分界 */
export function isLeyteGrass(h: number): boolean {
  return h >= SAND_TOP
}

/** 這個高度、被樹冠遮住這麼多時的地色。沙灘不吃覆蓋率 —— 樹長不到那裡 */
export function leyteShade(h: number, cover: number, out: Color): Color {
  if (!isLeyteGrass(h)) return out.copy(SAND)
  return out.copy(GRASS).lerp(CANOPY, Math.min(1, Math.max(0, cover)))
}

/**
 * 這一點的路半寬，m。**與 shader 同一條式子**（`roadGlsl` 的 `halfW`）：標稱半寬
 * 乘上沿路起伏的正弦，只吃世界座標 —— 同一點永遠同一個寬度。
 */
export function roadHalfWidthAt(x: number, z: number): number {
  let k = 1
  for (const r of WIDTH_RIPPLE) k += r.amp * Math.sin(r.fx * x + r.fz * z + r.phase)
  return (ROAD_WIDTH / 2) * k
}

/**
 * 這一點在不在路面上，0 或 1：離中線比這一點的半寬近。**與 shader 同一條式子**
 * （不含路緣的過渡帶）。測試拿它確認路畫在 `LEYTE_ROAD` 上。
 */
export function roadCoverageAt(x: number, z: number): number {
  const w = roadHalfWidthAt(x, z)
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
    if (Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < w) return 1
  }
  return 0
}

/**
 * 分組外接矩形往外擴多少，m：路最寬處的半寬加過渡帶，再留一段餘裕。矩形外的
 * 像素一段都不算 —— 那時 `roadD` 停在 1e9，而擴出去的這一圈保證矩形邊上的
 * 像素離路已經遠到覆蓋率是 0，邊界不會畫出一條線。
 */
/** 離路距離圖一格幾公尺 */
const ROAD_TEXEL = 4
/**
 * 距離圖記到幾公尺為止，m。**要大過路最寬處的半寬加一格**，超過的一律記成它
 * —— 那些像素離路夠遠，覆蓋率是 0。
 */
const ROAD_MAX_DISTANCE = 40

export interface RoadDistanceMap {
  /** 一格一個位元組：離中線的距離 ÷ `maxDistance` × 255 */
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
  /** 世界座標的方框，m。第 (row, col) 格的中心在 (x0 + (col+0.5)·texel, z0 + (row+0.5)·texel) */
  readonly box: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }
  readonly texel: number
  readonly maxDistance: number
}

/**
 * 把「離公路中線多遠」烘成一張圖，給地面的 shader 查。**載入期跑一次。**
 *
 * 【為什麼不在 shader 裡逐段算】公路有七十幾段。每個地面像素迴圈掃過一個常數
 * 陣列，在 ANGLE（D3D）上翻譯出來極慢 —— 實測在陸地上方從 160 fps 掉到 30。
 * 換成一次取樣之後，成本與沒有公路一樣。
 *
 * 【逐段只畫自己的鄰近】每一段只更新它外接矩形外擴 `maxDistance` 那一塊，
 * 整張圖一百多萬格，實際算的只有公路兩旁那一條帶。
 */
export function bakeRoadDistance(): RoadDistanceMap {
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  for (const p of LEYTE_ROAD) {
    x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
    z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
  }
  const M = ROAD_MAX_DISTANCE
  x0 -= M; z0 -= M; x1 += M; z1 += M
  const width = Math.ceil((x1 - x0) / ROAD_TEXEL)
  const height = Math.ceil((z1 - z0) / ROAD_TEXEL)
  x1 = x0 + width * ROAD_TEXEL
  z1 = z0 + height * ROAD_TEXEL
  const dist = new Float32Array(width * height).fill(M)
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const len2 = abx * abx + abz * abz
    const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - M - x0) / ROAD_TEXEL))
    const c1 = Math.min(width - 1, Math.ceil((Math.max(a.x, b.x) + M - x0) / ROAD_TEXEL))
    const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - M - z0) / ROAD_TEXEL))
    const r1 = Math.min(height - 1, Math.ceil((Math.max(a.z, b.z) + M - z0) / ROAD_TEXEL))
    for (let row = r0; row <= r1; row++) {
      const z = z0 + (row + 0.5) * ROAD_TEXEL
      for (let col = c0; col <= c1; col++) {
        const x = x0 + (col + 0.5) * ROAD_TEXEL
        const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2))
        const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
        const k = row * width + col
        if (d < dist[k]!) dist[k] = d
      }
    }
  }
  const data = new Uint8Array(width * height)
  for (let k = 0; k < data.length; k++) data[k] = Math.round((Math.min(M, dist[k]!) / M) * 255)
  return { data, width, height, box: { x0, z0, x1, z1 }, texel: ROAD_TEXEL, maxDistance: M }
}

/**
 * 公路的 GLSL：查離路距離圖（`bakeRoadDistance`），小於這一點的半寬
 * （`roadHalfWidthAt`）就混泥土色。路緣往內 `ROAD_EDGE_SOFT` 公尺是混進草地的
 * 過渡；顏色另外疊一層低頻的深淺，泥濘的地方深、乾的地方淺。
 *
 * 【方框外直接當作很遠】距離圖只蓋公路外擴 `ROAD_MAX_DISTANCE` 的那一塊。
 *
 * 【`px` 要夾上限】方框內外相鄰的兩個像素距離可能跳一大截 —— 不夾的話
 * `fwidth` 很大，過渡帶會寬到整條路都變成半透明。
 */
function roadGlsl(map: RoadDistanceMap): string {
  const half = (ROAD_WIDTH / 2).toFixed(2)
  const ripple = WIDTH_RIPPLE.map((r) =>
    ` + ${r.amp.toFixed(3)} * sin(${r.fx.toFixed(4)} * vRoadXZ.x + ${r.fz.toFixed(4)} * vRoadXZ.y + ${r.phase.toFixed(3)})`,
  ).join('')
  const c = new Color(ROAD_COLOR)
  const { x0, z0, x1, z1 } = map.box
  return `
  {
    vec2 roadUv = (vRoadXZ - vec2(${x0.toFixed(1)}, ${z0.toFixed(1)}))
      / vec2(${(x1 - x0).toFixed(1)}, ${(z1 - z0).toFixed(1)});
    float roadD = 1.0e9;
    if (roadUv.x >= 0.0 && roadUv.x <= 1.0 && roadUv.y >= 0.0 && roadUv.y <= 1.0) {
      roadD = texture2D(uRoadDist, roadUv).r * ${map.maxDistance.toFixed(1)};
    }
    float halfW = ${half} * (1.0${ripple});
    float px = clamp(fwidth(roadD), 1.0e-3, 8.0);
    float cover = 1.0 - smoothstep(halfW - ${ROAD_EDGE_SOFT.toFixed(2)} - px, halfW + px, roadD);
    float mud = 0.88 + 0.12 * sin(0.047 * vRoadXZ.x + 0.029 * vRoadXZ.y) * sin(0.13 * vRoadXZ.y - 0.07 * vRoadXZ.x);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}) * mud, cover);
  }`
}

/**
 * 場地裡每一株樹的樹冠，俯視、烘成一張圖（`render/flora.ts` 的
 * `bakeLeyteCanopy`）。一格一個位元組：0 = 空地，255 = 整格被樹冠蓋滿。
 */
export interface CanopyMap {
  /** `size²` 格，列優先；第 (row, col) 格的中心在 (−half + (col+0.5)·texel, −half + (row+0.5)·texel) */
  readonly data: Uint8Array
  readonly size: number
  /** 圖蓋住的方框的半邊長，m：`[−half, half]²`，就是高度場 */
  readonly half: number
  readonly texel: number
}

/**
 * 樹冠的 GLSL：查樹冠圖，往 `CANOPY_MAP` 混。**只在場內** —— 場外的遠景陸地沒有
 * 樹，它的暗綠在頂點色裡（`FAR_COVER`）。
 */
function canopyGlsl(map: CanopyMap): string {
  const c = CANOPY_MAP
  return `
  {
    vec2 canopyUv = (vRoadXZ + ${map.half.toFixed(1)}) / ${(2 * map.half).toFixed(1)};
    if (canopyUv.x >= 0.0 && canopyUv.x <= 1.0 && canopyUv.y >= 0.0 && canopyUv.y <= 1.0) {
      float canopy = texture2D(uCanopy, canopyUv).r;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}), canopy);
    }
  }`
}

function createGroundMaterial(
  roadTex: DataTexture, map: RoadDistanceMap, canopyUniform: { value: DataTexture }, canopy: CanopyMap,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: ROUGHNESS })
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uRoadDist'] = { value: roadTex }
    // 【同一個物件】`setCanopy` 換它的 value，編好的程式立刻讀到新的圖
    shader.uniforms['uCanopy'] = canopyUniform
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadXZ;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvRoadXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec2 vRoadXZ;\nuniform sampler2D uRoadDist;\nuniform sampler2D uCanopy;',
      )
      // 【樹冠先、路後】路的清空帶本來就沒有樹，路面蓋在最上面
      .replace('#include <color_fragment>', `#include <color_fragment>${canopyGlsl(canopy)}${roadGlsl(map)}`)
  }
  // 【快取鍵】注入的程式要有自己的鍵，否則 three 會拿別的 MeshStandardMaterial
  // 編好的程式來用 —— 症狀是路不見了，或別的東西上面畫出一條路
  m.customProgramCacheKey = () => 'leyte-ground-road-canopy'
  return m
}

/**
 * 樹冠圖 → 貼圖。**要 mipmap 與各向異性**：遠處一個像素蓋好幾格，不平均的話
 * 一顆顆暗點會閃爍；斜看的地面不開各向異性會糊成一片。
 */
function canopyTexture(map: CanopyMap): DataTexture {
  const tex = new DataTexture(map.data, map.size, map.size, RedFormat, UnsignedByteType)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearMipmapLinearFilter
  tex.generateMipmaps = true
  tex.anisotropy = CANOPY_ANISOTROPY
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}
/** 樹冠圖的各向異性。three 會夾到顯示卡的上限 */
const CANOPY_ANISOTROPY = 8

/** 離路距離圖 → 貼圖。單通道、線性內插 —— 距離在格與格之間是線性的 */
function roadDistanceTexture(map: RoadDistanceMap): DataTexture {
  const tex = new DataTexture(map.data, map.width, map.height, RedFormat, UnsignedByteType)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.needsUpdate = true
  return tex
}

/** 遠景陸地畫到離原點多遠，m。雷雨的霧在這之前就把它吃掉了 */
const FAR_EXTENT = 80000
/** 遠景陸地的格距，m。場地邊界（±15 km）落在格線上，格子不會跨進場內 */
const FAR_CELL = 1000
/** 一塊遠景幾格邊長。一塊一個 Mesh，各自進出視錐 */
const FAR_TILE_CELLS = 10
/** 遠景陸地的林相覆蓋率：遠看的林子是一片暗綠 */
const FAR_COVER = 0.45
/** 遠景陸地那幾塊 Mesh 的名字。它們不在高度場裡，量測與測試靠它認 */
export const FAR_LAND_NAME = 'leyte-far'

/**
 * 地面的繪製次序：**比海面早畫**（海面是 0、遠海是 1）。
 *
 * 【為什麼】海面的碎光與浪花是整個場景最貴的片段著色器，而海面網格跟著鏡頭走
 * —— 同一個次序下 three 依距離排，海幾乎總是先畫，島底下那一大片看不見的海
 * 每個像素都算完一遍碎光才被陸地蓋掉。陸地先畫之後，深度測試在著色器之前就
 * 把那些像素擋掉。海面的著色器沒有 `discard`、也不寫深度，所以提前的深度測試
 * 是開著的。
 */
const GROUND_RENDER_ORDER = -1

/**
 * 場外的遠景陸地：一塊的 geometry。**只畫不碰撞**，高度照 `farHeight`。
 * 場內的格子（那裡是高度場）與整格沉在水下的格子不畫。一格都沒有時回 null。
 */
function buildFarTile(x0: number, z0: number): BufferGeometry | null {
  const n = FAR_TILE_CELLS + 1
  const positions = new Float32Array(n * n * 3)
  const colors = new Float32Array(n * n * 3)
  const c = new Color()
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const x = x0 + i * FAR_CELL
      const z = z0 + j * FAR_CELL
      const h = farHeight(x, z)
      const v = (j * n + i) * 3
      positions[v] = x
      positions[v + 1] = h
      positions[v + 2] = z
      leyteShade(h, FAR_COVER, c)
      colors[v] = c.r
      colors[v + 1] = c.g
      colors[v + 2] = c.b
    }
  }
  const indices: number[] = []
  for (let j = 0; j < FAR_TILE_CELLS; j++) {
    for (let i = 0; i < FAR_TILE_CELLS; i++) {
      const cx0 = x0 + i * FAR_CELL
      const cz0 = z0 + j * FAR_CELL
      const inside = cx0 >= -FIELD_HALF && cx0 + FAR_CELL <= FIELD_HALF
        && cz0 >= -FIELD_HALF && cz0 + FAR_CELL <= FIELD_HALF
      if (inside) continue
      const a = j * n + i
      const b = a + 1
      const d = a + n
      const e = d + 1
      if (
        positions[a * 3 + 1]! < DRAW_FLOOR && positions[b * 3 + 1]! < DRAW_FLOOR
        && positions[d * 3 + 1]! < DRAW_FLOOR && positions[e * 3 + 1]! < DRAW_FLOOR
      ) continue
      indices.push(a, d, b, b, d, e)
    }
  }
  if (indices.length === 0) return null
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/** 場內的頂點色不帶林相 —— 林子由樹冠圖畫（`canopyGlsl`），兩邊都畫的話會暗兩次 */
const NO_COVER = (): number => 0

/**
 * @param canopy 開場用的樹冠圖。**`half` 要等於高度場的半邊長** —— shader 的
 *   座標換算寫死它，之後 `setCanopy` 換上的圖也要一樣
 */
export function createLeyteGround(
  field: HeightFieldData, canopy: CanopyMap,
): { object: Object3D; setCanopy(map: CanopyMap): void; dispose(): void } {
  const group = new Group()
  const roadMap = bakeRoadDistance()
  const roadTex = roadDistanceTexture(roadMap)
  const canopyUniform = { value: canopyTexture(canopy) }
  const material = createGroundMaterial(roadTex, roadMap, canopyUniform, canopy)
  const geometries: BufferGeometry[] = []
  const last = field.size - 1
  for (let r0 = 0; r0 < last; r0 += LEYTE_TILE_CELLS) {
    for (let c0 = 0; c0 < last; c0 += LEYTE_TILE_CELLS) {
      const geo = buildGroundRect(
        field, c0, Math.min(last, c0 + LEYTE_TILE_CELLS), r0, Math.min(last, r0 + LEYTE_TILE_CELLS),
        NO_COVER, leyteShade,
      )
      if (geo === null) continue
      geometries.push(geo)
      const mesh = new Mesh(geo, material)
      mesh.renderOrder = GROUND_RENDER_ORDER
      group.add(mesh)
    }
  }
  // 【遠景陸地】島很大，另外幾面的海岸不在視野裡。與場內共用同一個材質
  const span = FAR_CELL * FAR_TILE_CELLS
  for (let z0 = -FAR_EXTENT; z0 < FAR_EXTENT; z0 += span) {
    for (let x0 = -FAR_EXTENT; x0 < FAR_EXTENT; x0 += span) {
      const geo = buildFarTile(x0, z0)
      if (geo === null) continue
      geometries.push(geo)
      const mesh = new Mesh(geo, material)
      mesh.name = FAR_LAND_NAME
      mesh.renderOrder = GROUND_RENDER_ORDER
      group.add(mesh)
    }
  }
  return {
    object: group,
    setCanopy(map) {
      if (map.half !== canopy.half) throw new Error(`樹冠圖的範圍不同：${map.half} ≠ ${canopy.half}`)
      canopyUniform.value.dispose()
      canopyUniform.value = canopyTexture(map)
    },
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
      roadTex.dispose()
      canopyUniform.value.dispose()
    },
  }
}
