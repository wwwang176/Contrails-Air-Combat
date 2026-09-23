import { Color, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Object3D } from 'three'
import type { HeightFieldData } from '../world/heightfield'
import { LEYTE_ROAD, ROAD_WIDTH, SAND_TOP } from '../world/leyte'
import { buildGroundRect } from './island'

/**
 * # 雷伊泰的地面
 *
 * 低多邊形的頂點色網格，與群島同一種畫法；差別在三件事：
 *
 * 1. **切成方塊**，不是一座座圓島 —— 陸地是一整片。一塊一個 Mesh，各自進出
 *    視錐；整塊沉在水下的格子不畫（`buildGroundRect`）。
 * 2. **沙灘由高度 `SAND_TOP` 分界**，平地（8 m）是草。群島的分界是 12 m，
 *    照搬的話整片平地都是沙。
 * 3. **公路畫在材質的 shader 裡**：離 `LEYTE_ROAD` 任一段小於半寬就是柏油色。
 *    不另建貼地的網格 —— 那會與地面共面，拉遠就閃。
 */

const ROUGHNESS = 0.95
const SAND = new Color(0xc2b280)
const GRASS = new Color(0x55703f)
/** 樹冠的平均色：闊葉樹與灌木。地色按林相覆蓋率往它混 */
const CANOPY = new Color(0x2f4a2a)
const ASPHALT = new Color(0x4a4640)

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
 * 這一點被路面蓋住沒有，0 或 1。**與 shader 同一條式子**（不含抗鋸齒帶）：
 * 測試拿它確認路畫在 `LEYTE_ROAD` 上。
 */
export function roadCoverageAt(x: number, z: number): number {
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    const abx = b.x - a.x
    const abz = b.z - a.z
    const t = Math.max(0, Math.min(1, ((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz)))
    if (Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t)) < ROAD_WIDTH / 2) return 1
  }
  return 0
}

/**
 * 公路的 GLSL：世界座標 xz 到折線的距離小於半寬就混柏油色。邊緣留一個像素寬
 * 的過渡，只為了抗鋸齒 —— 拉寬就變成一條暈開的帶子。
 */
function roadGlsl(): string {
  const segs: string[] = []
  for (let i = 1; i < LEYTE_ROAD.length; i++) {
    const a = LEYTE_ROAD[i - 1]!
    const b = LEYTE_ROAD[i]!
    segs.push(`vec4(${a.x.toFixed(1)}, ${a.z.toFixed(1)}, ${b.x.toFixed(1)}, ${b.z.toFixed(1)})`)
  }
  const half = (ROAD_WIDTH / 2).toFixed(1)
  const c = ASPHALT
  return `
  {
    const vec4 ROAD[${segs.length}] = vec4[${segs.length}](${segs.join(', ')});
    float roadD = 1.0e9;
    for (int i = 0; i < ${segs.length}; i++) {
      vec2 a = ROAD[i].xy;
      vec2 ab = ROAD[i].zw - a;
      float t = clamp(dot(vRoadXZ - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
      roadD = min(roadD, length(vRoadXZ - (a + ab * t)));
    }
    float px = max(fwidth(roadD), 1.0e-3);
    float cover = 1.0 - smoothstep(${half} - px, ${half} + px, roadD);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)}), cover);
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
  return {
    object: group,
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
    },
  }
}
