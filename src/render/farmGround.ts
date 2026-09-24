import {
  BufferAttribute, BufferGeometry, DataTexture, Group, Mesh, MeshStandardMaterial,
  NearestFilter, RGBAIntegerFormat, UnsignedByteType, Vector4,
  type Object3D, type WebGLProgramParametersWithUniforms,
} from 'three'
import {
  buildRegionCandidates, fieldGlslWithSite, REGION_CANDIDATE_SUB, REGION_SPACING,
  type RegionCandidates, type SiteLayout,
} from './fields'
import type { Season } from './season'
import type { HeightFieldData } from '../world/heightfield'

/**
 * 把農地的高度場切成 low-poly 的地面。
 *
 * 【頂點高度直接讀 `field.data`，不重算】與 `render/island.ts` 同一條鐵律：
 * 畫出來的頂點與撞地判定查到的值必須是同一個數字。只要這裡改成「自己再算
 * 一次」，兩份就開始漂，而症狀是飛機撞到一片看不見的陸地。
 *
 * 【為什麼不帶頂點色】島那一支把三段高度色（沙／草／岩）烘進頂點屬性，
 * 那一套對農地沒有意義，而且 80 m 的格會把田的邊界糊成一格寬的漸層。
 * 顏色全部由片段著色器算 —— 見 `fields.ts`。
 *
 * 【平面著色仍然開著】起伏的面由光照分出來，田的邊界由片段分出來。
 * 兩者互不干擾，這正是「大片多邊形」與「Bocage 的田」可以同時成立的原因。
 *
 * 【為什麼切塊】5 × 5 = 25 塊，每塊 6 km 見方、各有包圍球，所以背對著的
 * 半張圖不會進畫面。比群島的 48 個 draw call 還少。
 */

/** 每一邊切幾塊。375 格 ÷ 5 = 75 格／塊 = 6,000 m */
export const FARM_CHUNKS = 5

const ROUGHNESS = 0.95

/** 一塊地的 geometry。`c0/r0` 是這一塊的起始格點索引，`n` 是格數 */
function buildChunk(
  field: HeightFieldData, c0: number, r0: number, n: number,
): BufferGeometry {
  const { size, cell, data } = field
  const half = (size - 1) / 2
  const nv = n + 1

  const positions = new Float32Array(nv * nv * 3)
  for (let j = 0; j < nv; j++) {
    const row = r0 + j
    const z = (row - half) * cell
    for (let i = 0; i < nv; i++) {
      const col = c0 + i
      const v = (j * nv + i) * 3
      positions[v] = (col - half) * cell
      positions[v + 1] = data[row * size + col]!
      positions[v + 2] = z
    }
  }

  // 【對角線的方向必須跟著 heightfield.ts 的 sample】那裡是 a,c,b 與 b,c,d，
  // 對角線是 b–c。動了這裡就要動那裡，否則格子內部兩份會分家 ——
  // 而只比頂點的測試抓不到那件事
  const indices = new Uint32Array(n * n * 6)
  let k = 0
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * nv + i
      const b = a + 1
      const c = a + nv
      const d = c + 1
      indices[k++] = a; indices[k++] = c; indices[k++] = b
      indices[k++] = b; indices[k++] = c; indices[k++] = d
    }
  }

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setIndex(new BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 把田的顏色注入一個 `MeshStandardMaterial`。**遠景環共用這一支** ——
 * 兩邊的圖案因此不可能對不上。
 *
 * 【為什麼取樣用 `modelMatrix` 算出來的世界座標】圖案必須釘在地上，而不是
 * 釘在網格上。吃世界座標的話，網格怎麼切、擺在哪裡都不影響畫出來的田。
 *
 * 【為什麼換掉整個 `color_fragment`】那個 chunk 的工作就是把頂點色乘進
 * `diffuseColor`，而農地沒有頂點色 —— 顏色的來源就是這裡。它在
 * `meshphysical_frag` 裡是固定存在的（vertexColors 關閉時只是空操作），
 * 所以這個 replace 一定命中。
 */
export function applyFields(
  material: MeshStandardMaterial, season: Season = 'summer', site?: SiteLayout,
  candidates?: { texture: DataTexture; table: RegionCandidates }, open = false,
): void {
  const glsl = fieldGlslWithSite(season, site, candidates !== undefined, open)
  material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
    if (candidates !== undefined) {
      const t = candidates.table
      shader.uniforms['uRegionCand'] = { value: candidates.texture }
      shader.uniforms['uRegionCandRect'] = { value: new Vector4(t.gx0, t.gz0, t.blocksX, t.blocksZ) }
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
varying vec3 vFarmWorld;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vFarmWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;`)

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vFarmWorld;
${glsl}`)
      .replace('#include <color_fragment>', `
diffuseColor.rgb = fieldColorAt(vFarmWorld.xz);`)
  }
  // 【換了著色器就要換 key】three 用它決定程式能不能重用。材質本身的參數
  // （flatShading 等）仍然照樣進 key，所以兩個材質共用這個字串是安全的。
  // 【季節要進 key】兩個季節的 GLSL 不同。key 相同的話先看過夏季農地再進
  // 晚秋的地形，three 會重用夏季的程式 —— 畫面還是綠的，而且不報錯
  // 【有沒有廠區、查不查候選表、田圍不圍著村也要進 key】都是另一份字串
  material.customProgramCacheKey = () => 'farm-fields:' + season
    + (site === undefined ? '' : ':site') + (candidates === undefined ? '' : ':cand') + (open ? ':open' : '')
}

/** `open`：田只圍著村，其餘是空地（`fields.ts` 的 `FIELD_REACH`） */
export function createFarmGround(
  field: HeightFieldData, season: Season = 'summer', site?: SiteLayout, open = false,
): {
  object: Object3D
  /** 區塊候選表。田色 clipmap 烘圖與內圈的算式共用它，才不必再建一份 */
  candidates: { texture: DataTexture; table: RegionCandidates }
  dispose(): void
} {
  const group = new Group()
  const material = new MeshStandardMaterial({ flatShading: true, roughness: ROUGHNESS })
  // 【區塊候選表進關卡時建】田區著色器每個片段原本要比九顆區塊種子；查表後
  // 平均只比三四顆，答案相同（`field-region-candidates.test.ts`）。範圍取蓋住
  // 整片地的區塊格，場外的片段落回完整搜尋。遠景環不查表，走完整搜尋
  const half = ((field.size - 1) / 2) * field.cell
  const gx0 = Math.floor(-half / REGION_SPACING)
  const gx1 = Math.floor(half / REGION_SPACING)
  const side = (gx1 - gx0 + 1) * REGION_CANDIDATE_SUB
  const table = buildRegionCandidates(gx0 * REGION_SPACING, gx0 * REGION_SPACING, side, side)
  const texture = new DataTexture(table.data, side, side, RGBAIntegerFormat, UnsignedByteType)
  texture.internalFormat = 'RGBA8UI'
  texture.minFilter = NearestFilter
  texture.magFilter = NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true
  applyFields(material, season, site, { texture, table }, open)

  const n = (field.size - 1) / FARM_CHUNKS
  const geometries: BufferGeometry[] = []
  for (let j = 0; j < FARM_CHUNKS; j++) {
    for (let i = 0; i < FARM_CHUNKS; i++) {
      const geo = buildChunk(field, i * n, j * n, n)
      geometries.push(geo)
      group.add(new Mesh(geo, material))
    }
  }

  return {
    object: group,
    candidates: { texture, table },
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
      texture.dispose()
    },
  }
}
