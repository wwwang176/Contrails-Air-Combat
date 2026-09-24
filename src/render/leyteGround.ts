import {
  BufferAttribute, BufferGeometry, ClampToEdgeWrapping, Color, DataTexture, FloatType, Group, LinearFilter,
  LinearMipmapLinearFilter, Mesh, MeshStandardMaterial, NearestFilter, RedFormat, RGBAFormat, RGFormat,
  UnsignedByteType, type Object3D,
} from 'three'
import type { HeightFieldData } from '../world/heightfield'
import { FIELD_HALF, LEYTE_ROADS, ROAD_WIDTH, SAND_TOP, farHeight } from '../world/leyte'
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
 * 3. **路畫在材質的 shader 裡**：離 `LEYTE_ROADS` 任一段小於那條路的半寬就是
 *    泥土路的顏色。不另建貼地的網格 —— 那會與地面共面，拉遠就閃。
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
/**
 * 路中線的明度，路緣是 1。**越往中間越暗**：車輪壓過的是中間那一段，泥被
 * 翻起來、積水，路緣是乾的土。由路緣到中線平滑地變暗。
 */
const ROAD_CENTER_SHADE = 0.7

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

/** 沿路起伏的倍率：1 ± 0.45。**與 shader 同一條式子**，只吃世界座標 */
function widthRipple(x: number, z: number): number {
  let k = 1
  for (const r of WIDTH_RIPPLE) k += r.amp * Math.sin(r.fx * x + r.fz * z + r.phase)
  return k
}

/**
 * 這一點的路半寬，m。**與 shader 同一條式子**（`roadGlsl` 的 `halfW`）：標稱半寬
 * 乘上沿路起伏的正弦 —— 同一點、同一條路永遠同一個寬度。
 *
 * @param nominal 那條路的標稱半寬。省略 = 車隊那一條（`ROAD_WIDTH / 2`）
 */
export function roadHalfWidthAt(x: number, z: number, nominal = ROAD_WIDTH / 2): number {
  return nominal * widthRipple(x, z)
}

/**
 * 這一點在不在**任何一條**路面上，0 或 1：離某條路的中線比那條路在這一點的
 * 半寬近。**與 shader 同一條式子**（不含路緣的過渡帶）。
 */
export function roadCoverageAt(x: number, z: number): number {
  const k = widthRipple(x, z)
  for (const road of LEYTE_ROADS) {
    const w = road.halfWidth * k
    const pts = road.points
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      const abx = b.x - a.x
      const abz = b.z - a.z
      const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
      if (Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < w) return 1
    }
  }
  return 0
}

/** 最近路段圖一格幾公尺 */
const ROAD_TEXEL = 10
/**
 * 一格記錄最近路段的範圍，m：格心離路段不到這麼遠才記。**要大過最寬的路最寬處
 * 的半寬（12 × 1.45 = 17.4 m）加上過渡帶與半格的對角（7.1 m）**，不然路緣那一帶
 * 的像素所在的格沒有記到路段，路會被切掉一條邊。
 */
const ROAD_REACH = 30

/**
 * 島上所有路的「最近路段」圖：每一格記離它最近的那一段路是第幾段，shader 再拿
 * 那一段的兩端**精確**算距離（`roadGlsl`）。
 */
export interface RoadSegmentMap {
  /** `size²` 格，每格兩個位元組：路段編號的低、高位元組。0 = 附近沒有路 */
  readonly ids: Uint8Array
  readonly size: number
  /** 圖蓋住的方框的半邊長，m：`[−half, half]²` */
  readonly half: number
  readonly texel: number
  /**
   * 路段表：第 k 段（從 1 起）佔兩個 RGBA：`(ax, az, bx, bz)` 與 `(標稱半寬, 0, 0, 0)`，
   * 分別在第 0 列與第 1 列的第 k 格。第 0 格不用
   */
  readonly segments: Float32Array
  /** 路段表的寬（段數 + 1） */
  readonly segmentCount: number
}

/**
 * 把島上所有路烘成最近路段圖。**載入期跑一次**，幾十毫秒。
 *
 * 【為什麼不直接烘距離】距離在中線上有一個尖點，線性內插會把中線墊高將近半格
 * —— 10 m 一格時細的土路（最窄 2.2 m）會斷成一截一截。整張島 4 m 一格的距離圖
 * 又太大（五千多萬格）。記「最近哪一段」再在 shader 裡精確算，細路也是精確的。
 *
 * 【為什麼不在 shader 裡逐段算】路有上千段。每個地面像素迴圈掃過一個常數陣列，
 * 在 ANGLE（D3D）上翻譯出來極慢 —— 實測只有七十幾段時陸地上方就從 160 fps
 * 掉到 30。
 */
export function bakeRoadSegments(): RoadSegmentMap {
  const half = FIELD_HALF
  const size = Math.round((2 * half) / ROAD_TEXEL)
  const texel = (2 * half) / size
  let n = 1
  for (const r of LEYTE_ROADS) n += r.points.length - 1
  if (n > 65535) throw new Error(`路段太多：${n}`)
  const segments = new Float32Array(n * 2 * 4)
  const ids = new Uint8Array(size * size * 2)
  const best = new Float32Array(size * size).fill(ROAD_REACH)
  let id = 1
  for (const road of LEYTE_ROADS) {
    const pts = road.points
    for (let i = 1; i < pts.length; i++, id++) {
      const a = pts[i - 1]!
      const b = pts[i]!
      segments.set([a.x, a.z, b.x, b.z], id * 4)
      segments[(n + id) * 4] = road.halfWidth
      const abx = b.x - a.x
      const abz = b.z - a.z
      const len2 = abx * abx + abz * abz
      const c0 = Math.max(0, Math.floor((Math.min(a.x, b.x) - ROAD_REACH + half) / texel))
      const c1 = Math.min(size - 1, Math.ceil((Math.max(a.x, b.x) + ROAD_REACH + half) / texel))
      const r0 = Math.max(0, Math.floor((Math.min(a.z, b.z) - ROAD_REACH + half) / texel))
      const r1 = Math.min(size - 1, Math.ceil((Math.max(a.z, b.z) + ROAD_REACH + half) / texel))
      for (let row = r0; row <= r1; row++) {
        const z = -half + (row + 0.5) * texel
        for (let col = c0; col <= c1; col++) {
          const x = -half + (col + 0.5) * texel
          const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / len2))
          const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
          const k = row * size + col
          if (d >= best[k]!) continue
          best[k] = d
          ids[k * 2] = id & 0xff
          ids[k * 2 + 1] = id >> 8
        }
      }
    }
  }
  return { ids, size, half, texel, segments, segmentCount: n }
}

/**
 * 公路的 GLSL：查這一格最近的路段（`bakeRoadSegments`），精確算到那一段的距離，
 * 小於那條路在這一點的半寬（標稱 × `widthRipple`）就混泥土色。路緣往內一段是
 * 混進草地的過渡，寬度跟著路寬走；顏色另外疊一層低頻的深淺，泥濘的地方深、乾
 * 的地方淺，再由路緣往中線變暗（`ROAD_CENTER_SHADE`）。
 *
 * 【`px` 要夾上限】相鄰兩格記的路段不同時距離可能跳一截 —— 不夾的話 `fwidth`
 * 很大，過渡帶會寬到整條路都變成半透明。
 */
function roadGlsl(map: RoadSegmentMap): string {
  const ripple = WIDTH_RIPPLE.map((r) =>
    ` + ${r.amp.toFixed(3)} * sin(${r.fx.toFixed(4)} * vRoadXZ.x + ${r.fz.toFixed(4)} * vRoadXZ.y + ${r.phase.toFixed(3)})`,
  ).join('')
  const c = new Color(ROAD_COLOR)
  const soft = (ROAD_EDGE_SOFT / (ROAD_WIDTH / 2)).toFixed(4)
  return `
  {
    vec2 roadUv = (vRoadXZ + ${map.half.toFixed(1)}) / ${(2 * map.half).toFixed(1)};
    float roadD = 1.0e9;
    float roadHw = 0.0;
    if (roadUv.x >= 0.0 && roadUv.x <= 1.0 && roadUv.y >= 0.0 && roadUv.y <= 1.0) {
      vec2 rg = texture2D(uRoadIds, roadUv).rg;
      int id = int(rg.r * 255.0 + 0.5) + 256 * int(rg.g * 255.0 + 0.5);
      if (id > 0) {
        vec4 s = texelFetch(uRoadSegs, ivec2(id, 0), 0);
        roadHw = texelFetch(uRoadSegs, ivec2(id, 1), 0).r;
        vec2 ab = s.zw - s.xy;
        float t = clamp(dot(vRoadXZ - s.xy, ab) / dot(ab, ab), 0.0, 1.0);
        roadD = length(vRoadXZ - (s.xy + ab * t));
      }
    }
    float halfW = roadHw * (1.0${ripple});
    float px = clamp(fwidth(roadD), 1.0e-3, 8.0);
    float cover = roadHw > 0.0
      ? 1.0 - smoothstep(halfW - roadHw * ${soft} - px, halfW + px, roadD)
      : 0.0;
    float mud = 0.88 + 0.12 * sin(0.047 * vRoadXZ.x + 0.029 * vRoadXZ.y) * sin(0.13 * vRoadXZ.y - 0.07 * vRoadXZ.x);
    float rut = mix(${ROAD_CENTER_SHADE.toFixed(3)}, 1.0, smoothstep(0.0, max(halfW, 1.0e-3), roadD));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}) * mud * rut, cover);
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

/** 場外一株樹佔一格的邊長，m。與場內植被的候選網格同尺度 */
const FAR_TREE_CELL = 13
/** 場外一株樹的樹冠半徑，格邊長的幾成 */
const FAR_TREE_R = 0.45

function glslVec3(c: Color): string {
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`
}

/**
 * 樹冠的 GLSL。
 *
 * **場內**：查樹冠圖，往 `CANOPY_MAP` 混。
 *
 * **場外**：沒有樹冠圖，頂點色已經是期望的平均覆蓋率（`leyteFarCover`）。這裡把
 * 它拆回一株一株：由頂點色反推覆蓋率，每 `FAR_TREE_CELL` 一格擲一次雜湊決定有沒有
 * 樹、樹冠畫成圓。**平均起來與頂點色相同**，所以一個像素蓋很多格時（遠處）淡回
 * 頂點色，不會閃也不會變暗。
 *
 * 【雜湊用整數】世界座標到幾萬公尺，`fract(sin(…))` 那種浮點雜湊在那個量級會
 * 失去精度、排出條紋。
 */
function canopyGlsl(map: CanopyMap): string {
  const grass = glslVec3(GRASS)
  const canopy = glslVec3(CANOPY_MAP)
  const fill = Math.PI * FAR_TREE_R * FAR_TREE_R
  return `
  {
    vec2 canopyUv = (vRoadXZ + ${map.half.toFixed(1)}) / ${(2 * map.half).toFixed(1)};
    if (canopyUv.x >= 0.0 && canopyUv.x <= 1.0 && canopyUv.y >= 0.0 && canopyUv.y <= 1.0) {
      float canopy = texture2D(uCanopy, canopyUv).r;
      diffuseColor.rgb = mix(diffuseColor.rgb, ${canopy}, canopy);
    } else {
      vec3 dg = ${grass} - ${canopy};
      float cov = clamp(dot(${grass} - diffuseColor.rgb, dg) / dot(dg, dg), 0.0, 1.0);
      vec2 q = vRoadXZ / ${FAR_TREE_CELL.toFixed(1)};
      float fade = 1.0 - smoothstep(0.35, 0.9, length(fwidth(q)));
      if (cov > 0.0 && fade > 0.0) {
        ivec2 ic = ivec2(floor(q));
        uint h = uint(ic.x) * 0x8da6b343u ^ uint(ic.y) * 0xd8163841u;
        h ^= h >> 13u; h *= 0x5bd1e995u; h ^= h >> 15u;
        float pick = float(h & 0xffffu) / 65535.0;
        vec2 ctr = vec2(0.5) + (vec2(float((h >> 16u) & 0xffu), float(h >> 24u)) / 255.0 - 0.5)
          * ${(1 - 2 * FAR_TREE_R).toFixed(3)};
        float tree = pick < cov / ${fill.toFixed(4)} && length(fract(q) - ctr) < ${FAR_TREE_R.toFixed(3)} ? 1.0 : 0.0;
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(${grass}, ${canopy}, tree), fade);
      }
    }
  }`
}

function createGroundMaterial(
  road: { ids: DataTexture; segments: DataTexture }, map: RoadSegmentMap,
  canopyUniform: { value: DataTexture }, canopy: CanopyMap,
): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: ROUGHNESS })
  m.onBeforeCompile = (shader) => {
    shader.uniforms['uRoadIds'] = { value: road.ids }
    shader.uniforms['uRoadSegs'] = { value: road.segments }
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
        '#include <common>\nvarying vec2 vRoadXZ;\nuniform sampler2D uRoadIds;\nuniform highp sampler2D uRoadSegs;\n'
          + 'uniform sampler2D uCanopy;',
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

/**
 * 最近路段圖 → 兩張貼圖。**一律最近取樣、不做 mipmap**：編號不能內插 —— 兩段
 * 的編號平均出來是第三段。
 */
function roadSegmentTextures(map: RoadSegmentMap): { ids: DataTexture; segments: DataTexture } {
  const ids = new DataTexture(map.ids, map.size, map.size, RGFormat, UnsignedByteType)
  const segments = new DataTexture(map.segments, map.segmentCount, 2, RGBAFormat, FloatType)
  for (const t of [ids, segments]) {
    t.magFilter = NearestFilter
    t.minFilter = NearestFilter
    t.generateMipmaps = false
    t.wrapS = ClampToEdgeWrapping
    t.wrapT = ClampToEdgeWrapping
    t.needsUpdate = true
  }
  return { ids, segments }
}

/** 遠景陸地畫到離原點多遠，m。雷雨的霧在這之前就把它吃掉了 */
const FAR_EXTENT = 80000
/**
 * 遠景陸地的格距，m。場地邊界（±15 km）落在格線上，格子不會跨進場內。
 *
 * 【與場內接得上】場內邊緣一帶的緩坡收平了（`world/leyte.ts` 的 `ROLL_EDGE`），
 * 邊緣上兩邊都是一條水平線，粗格與細格在那裡不會裂開。
 */
const FAR_CELL = 500
/** 一塊遠景幾格邊長。一塊一個 Mesh，各自進出視錐 */
const FAR_TILE_CELLS = 20
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
 *
 * 【頂點色是期望的樹冠覆蓋率】`coverAt` 給；草地往 `CANOPY_MAP` 混 —— 與場內
 * 樹冠圖畫上去的是同一個顏色，場內外平均起來一樣暗。
 */
function buildFarTile(
  x0: number, z0: number, coverAt: (x: number, z: number, h: number) => number,
): BufferGeometry | null {
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
      if (isLeyteGrass(h)) c.copy(GRASS).lerp(CANOPY_MAP, Math.min(1, Math.max(0, coverAt(x, z, h))))
      else c.copy(SAND)
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
 * @param farCoverAt 場外遠景陸地一點的期望樹冠覆蓋率（`render/flora.ts` 的
 *   `leyteFarCover`）。省略 = 沒有林子
 */
export function createLeyteGround(
  field: HeightFieldData, canopy: CanopyMap,
  farCoverAt: (x: number, z: number, h: number) => number = () => 0,
): { object: Object3D; setCanopy(map: CanopyMap): void; dispose(): void } {
  const group = new Group()
  const roadMap = bakeRoadSegments()
  const roadTex = roadSegmentTextures(roadMap)
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
      const geo = buildFarTile(x0, z0, farCoverAt)
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
      roadTex.ids.dispose()
      roadTex.segments.dispose()
      canopyUniform.value.dispose()
    },
  }
}
