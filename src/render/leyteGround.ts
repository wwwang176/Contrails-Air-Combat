import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial, type Object3D,
} from 'three'
import type { HeightFieldData } from '../world/heightfield'
import { FIELD_HALF, LEYTE_ROAD, ROAD_WIDTH, SAND_TOP, farHeight, roadGroups } from '../world/leyte'
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
 * 【泥土路，不是柏油】雨季的雷伊泰公路是泥濘的土路：顏色接近沙灘、邊緣不規則、
 * 顏色帶一點深淺。路寬沿路起伏（`roadHalfWidthAt`），邊緣有一段混進草地的過渡。
 */

const ROUGHNESS = 0.95
const SAND = new Color(0xc2b280)
const GRASS = new Color(0x55703f)
/** 樹冠的平均色：闊葉樹與灌木。地色按林相覆蓋率往它混 */
const CANOPY = new Color(0x2f4a2a)
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
const GROUP_MARGIN = (ROAD_WIDTH / 2) * 1.5 + ROAD_EDGE_SOFT + 30

/**
 * 公路的 GLSL：世界座標 xz 到折線的距離小於這一點的半寬（`roadHalfWidthAt`）
 * 就混泥土色。路緣往內 `ROAD_EDGE_SOFT` 公尺是混進草地的過渡；顏色另外疊一層
 * 低頻的深淺，泥濘的地方深、乾的地方淺。
 *
 * 【先比分組的外接矩形】公路有幾十段，每一個地面像素都逐段算距離太貴。
 * 分組（`world/leyte.ts` 的 `roadGroups`）之後，離路遠的像素只做幾次比較。
 *
 * 【`px` 要夾上限】矩形內外相鄰的兩個像素，一個的 `roadD` 是幾十公尺、一個是
 * 1e9 —— 不夾的話 `fwidth` 是 1e9，過渡帶寬到整條路都變成半透明。
 */
function roadGlsl(): string {
  const segs: string[] = []
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    segs.push(`vec4(${a.x.toFixed(1)}, ${a.z.toFixed(1)}, ${b.x.toFixed(1)}, ${b.z.toFixed(1)})`)
  }
  const groups = roadGroups()
  const boxes = groups.map((g) =>
    `vec4(${(g.x0 - GROUP_MARGIN).toFixed(1)}, ${(g.z0 - GROUP_MARGIN).toFixed(1)}, `
    + `${(g.x1 + GROUP_MARGIN).toFixed(1)}, ${(g.z1 + GROUP_MARGIN).toFixed(1)})`)
  // 段 i（`LEYTE_ROAD[i-1] → [i]`）在 ROAD 陣列裡的索引是 i − 1
  const ranges = groups.map((g) => `ivec2(${g.i0 - 1}, ${g.i1 - 1})`)
  const half = (ROAD_WIDTH / 2).toFixed(2)
  const ripple = WIDTH_RIPPLE.map((r) =>
    ` + ${r.amp.toFixed(3)} * sin(${r.fx.toFixed(4)} * vRoadXZ.x + ${r.fz.toFixed(4)} * vRoadXZ.y + ${r.phase.toFixed(3)})`,
  ).join('')
  const c = new Color(ROAD_COLOR)
  return `
  {
    const vec4 ROAD[${segs.length}] = vec4[${segs.length}](${segs.join(', ')});
    const vec4 ROAD_BOX[${groups.length}] = vec4[${groups.length}](${boxes.join(', ')});
    const ivec2 ROAD_RANGE[${groups.length}] = ivec2[${groups.length}](${ranges.join(', ')});
    float roadD = 1.0e9;
    for (int g = 0; g < ${groups.length}; g++) {
      vec4 bb = ROAD_BOX[g];
      if (vRoadXZ.x < bb.x || vRoadXZ.x > bb.z || vRoadXZ.y < bb.y || vRoadXZ.y > bb.w) continue;
      for (int i = ROAD_RANGE[g].x; i < ROAD_RANGE[g].y; i++) {
        vec2 a = ROAD[i].xy;
        vec2 ab = ROAD[i].zw - a;
        float t = clamp(dot(vRoadXZ - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
        roadD = min(roadD, length(vRoadXZ - (a + ab * t)));
      }
    }
    float halfW = ${half} * (1.0${ripple});
    float px = clamp(fwidth(roadD), 1.0e-3, 8.0);
    float cover = 1.0 - smoothstep(halfW - ${ROAD_EDGE_SOFT.toFixed(2)} - px, halfW + px, roadD);
    float mud = 0.88 + 0.12 * sin(0.047 * vRoadXZ.x + 0.029 * vRoadXZ.y) * sin(0.13 * vRoadXZ.y - 0.07 * vRoadXZ.x);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}) * mud, cover);
  }`
}

function createGroundMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: ROUGHNESS })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadXZ;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvRoadXZ = (modelMatrix * vec4(transformed, 1.0)).xz;',
      )
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vRoadXZ;')
      .replace('#include <color_fragment>', `#include <color_fragment>${roadGlsl()}`)
  }
  // 【快取鍵】注入的程式要有自己的鍵，否則 three 會拿別的 MeshStandardMaterial
  // 編好的程式來用 —— 症狀是路不見了，或別的東西上面畫出一條路
  m.customProgramCacheKey = () => 'leyte-ground-road'
  return m
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

export function createLeyteGround(
  field: HeightFieldData, coverAt: (x: number, z: number) => number,
): { object: Object3D; dispose(): void } {
  const group = new Group()
  const material = createGroundMaterial()
  const geometries: BufferGeometry[] = []
  const last = field.size - 1
  for (let r0 = 0; r0 < last; r0 += LEYTE_TILE_CELLS) {
    for (let c0 = 0; c0 < last; c0 += LEYTE_TILE_CELLS) {
      const geo = buildGroundRect(
        field, c0, Math.min(last, c0 + LEYTE_TILE_CELLS), r0, Math.min(last, r0 + LEYTE_TILE_CELLS),
        coverAt, leyteShade,
      )
      if (geo === null) continue
      geometries.push(geo)
      group.add(new Mesh(geo, material))
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
      group.add(mesh)
    }
  }
  return {
    object: group,
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
    },
  }
}
