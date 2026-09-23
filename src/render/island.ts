import {
  BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial,
  type Object3D,
} from 'three'
import type { HeightFieldData } from '../world/heightfield'
import type { IslandDesc } from '../world/archipelago'

/**
 * 把高度場切成 low-poly 的島。
 *
 * 【頂點高度直接讀 `field.data`，不重算】這是 `render/terrain.ts` 那條鐵律
 * 在渲染這一側的落實：畫出來的頂點與撞地判定查到的值必須是同一個數字。
 * 只要這裡改成「自己再算一次 smoothstep」，兩份就開始漂，而症狀是飛機撞到
 * 一片看不見的陸地。`terrain.test.ts` 有一條逐頂點比對的護欄守它。
 *
 * 【一座島一個 Mesh，不合併】48 個 draw call 對現代 GPU 不算多，換到的是
 * 每座島各有自己的包圍球、可以被視錐剔除 —— 飛機在場地一角時不必畫另一角
 * 的島。合併成單一 geometry 會省下 draw call 但整片一起進出視錐。
 *
 * 【切到 `outerRadius` 而不是 `radius`】島形的 wobble 讓地形延伸到標稱半徑
 * 的 1.29 倍。切在 `radius` 會讓外圈那一環有碰撞卻沒有畫面。
 */

/** 材質共用一份 —— 48 座島的差異全在頂點色裡 */
const ROUGHNESS = 0.95

/** 高度分層的顏色。硬分界，不漸層 —— low-poly 的面就是要看得出來 */
const SAND = new Color(0xc2b280)
const GRASS = new Color(0x4a5f42)
/**
 * 水線以上這個高度之內算沙灘，m。**草帶的下界就是它。**
 *
 * 【為什麼不叫 SHORE_BAND】`world/archipelago.ts` 有一個同名的常數，值是
 * **200** —— 那是烘岸用的距離，量綱都不一樣。同名不同義拿錯完全不報錯，
 * 而症狀是植被的下界變成 200，12～200 m 的大片綠帶光禿。
 */
export const GRASS_MIN_HEIGHT = 12
/**
 * 低於這個高度的格子整格不畫，m。
 *
 * 三道波的最低波谷是 −4.5，所以 −5.5 以下的地形永遠被海遮住。留一點餘裕
 * 是因為海面在遠處由 clipmap 的粗格線性內插，波谷會比解析值淺一點。
 *
 * 【它與 WAVES 的振幅和綁死】調高浪幅越過這一條，波谷就會露出沒有畫的海床，
 * 島的四周破洞。`ocean.test.ts` 的「浪谷不會深過島的裁切界」守著。
 */
export const DRAW_FLOOR = -5.5
/**
 * 樹冠的平均色。針葉與灌木按樹冠面積加權 —— `CONE_CROWN_R²` 對
 * `ISLAND_BUSH_RATIO × BUSH_R²`，也就是 66% 對 34%。
 *
 * 【為什麼不 import `floraShapes` 的那三個顏色】`island.ts` 是被
 * `flora.ts` import 的那一端，反過來會成環。這是一個常數，由那兩個顏色
 * 算一次寫死；`island-shade.test.ts` 釘著它。
 */
export const CANOPY = new Color(0x30452e)

/**
 * 這個高度、被樹冠遮住這麼多時，地該是什麼顏色。
 *
 * 【只有兩段】水線上是沙、再上去全是草，一路到峰頂。島是綠的。
 *
 * 【草的那一段要先帶上林相】`FLORA_RADIUS` 外一棵樹都不畫，而地色比樹冠
 * 亮很多 —— 飛進圈的瞬間整座島同時變暗變花。先按實際被遮住的面積比往樹冠
 * 色混，樹進圈就只是加上質感。覆蓋率由 `flora.ts` 的 `islandCanopyCover`
 * 算，與植被的放置同源。
 *
 * 【沙灘不吃覆蓋率】樹長不到那裡去。
 */
export function shade(h: number, cover: number, out: Color): Color {
  if (h < GRASS_MIN_HEIGHT) return out.copy(SAND)
  return out.copy(GRASS).lerp(CANOPY, Math.min(1, Math.max(0, cover)))
}

/**
 * 這裡看起來是草嗎。**島上的樹只長在回真的地方。**
 *
 * 【為什麼是謂語而不是一個常數】判準與地的顏色必須是同一條式子，不然會出現
 * 樹長在沙灘上。給一支謂語，放置那一側根本不必看到常數，也就沒有拿錯
 * `SHORE_BAND` 的機會。`island-shade.test.ts` 逐高度比對它與 `shade`。
 *
 * 【不吃坡度】實測群島的島很陡：草帶 16.24 km² 裡坡度 20° 以內只有 3.7%。
 * 用坡度當判準會砍掉 95% 的地 —— 坡度只用來壓密度。
 */
export function isGrass(h: number): boolean {
  return h >= GRASS_MIN_HEIGHT
}

/**
 * 一座島的 geometry。範圍取不到任何格點時回 null（島小到落在格線之間）。
 */
function buildIsland(
  field: HeightFieldData, isl: IslandDesc, coverAt: (x: number, z: number) => number,
): BufferGeometry | null {
  const { size, cell } = field
  const half = (size - 1) / 2
  const last = size - 1

  const c0 = Math.max(0, Math.floor((isl.cx - isl.outerRadius) / cell + half))
  const c1 = Math.min(last, Math.ceil((isl.cx + isl.outerRadius) / cell + half))
  const r0 = Math.max(0, Math.floor((isl.cz - isl.outerRadius) / cell + half))
  const r1 = Math.min(last, Math.ceil((isl.cz + isl.outerRadius) / cell + half))
  return buildGroundRect(field, c0, c1, r0, r1, coverAt, shade)
}

/**
 * 高度場上一塊方框（格點欄 `c0..c1`、列 `r0..r1`，含端點）的 geometry。
 * **頂點高度直接讀 `field.data`**（檔頭的鐵律）；整格沉在水下的不畫。
 * 範圍不到一格時回 null。
 *
 * @param shadeAt 地色。群島用 `shade`；雷伊泰有自己的沙灘分界（`leyteGround.ts`）
 */
export function buildGroundRect(
  field: HeightFieldData, c0: number, c1: number, r0: number, r1: number,
  coverAt: (x: number, z: number) => number,
  shadeAt: (h: number, cover: number, out: Color) => Color,
): BufferGeometry | null {
  const { size, cell, data } = field
  const half = (size - 1) / 2
  const nx = c1 - c0 + 1
  const nz = r1 - r0 + 1
  if (nx < 2 || nz < 2) return null

  const positions = new Float32Array(nx * nz * 3)
  const colors = new Float32Array(nx * nz * 3)
  const scratch = new Color()

  for (let j = 0; j < nz; j++) {
    const row = r0 + j
    const z = (row - half) * cell
    for (let i = 0; i < nx; i++) {
      const col = c0 + i
      const x = (col - half) * cell
      const h = data[row * size + col]!
      const v = (j * nx + i) * 3
      positions[v] = x
      positions[v + 1] = h
      positions[v + 2] = z
      const c = shadeAt(h, coverAt(x, z), scratch)
      colors[v] = c.r
      colors[v + 1] = c.g
      colors[v + 2] = c.b
    }
  }

  // 每一格兩個三角形。頂點數上限 (nx·nz) 遠小於 65536 的話可以用 16 位元，
  // 但大島是 105² = 11,025，小島更少 —— 一律 Uint32 省掉一個分支
  const quads = (nx - 1) * (nz - 1)
  const indices = new Uint32Array(quads * 6)
  let k = 0
  for (let j = 0; j < nz - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i
      const b = a + 1
      const c = a + nx
      const d = c + 1
      // 【整格都沉在水下就不畫】切的是方形 bounding box，四個角落是一大片
      // 平坦的海床。畫出來的話會與海面 z-fighting —— 相機遠平面超過
      // 4,000 km，深度緩衝在幾十公里外分不出幾公尺的差，症狀是島的四周
      // 掛著一條條水平的摩爾紋。
      //
      // 水面下的地形玩家本來就看不到，所以這不是取捨，是不畫看不見的東西。
      // **`heightAt` 不受影響** —— 碰撞仍然讀完整的高度場，鐵律沒有破口。
      if (
        positions[a * 3 + 1]! < DRAW_FLOOR && positions[b * 3 + 1]! < DRAW_FLOOR
        && positions[c * 3 + 1]! < DRAW_FLOOR && positions[d * 3 + 1]! < DRAW_FLOOR
      ) continue
      indices[k++] = a; indices[k++] = c; indices[k++] = b
      indices[k++] = b; indices[k++] = c; indices[k++] = d
    }
  }
  if (k === 0) return null

  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(positions, 3))
  geo.setAttribute('color', new BufferAttribute(colors, 3))
  geo.setIndex(new BufferAttribute(indices.subarray(0, k), 1))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

export function createIslands(
  field: HeightFieldData, islands: readonly IslandDesc[],
  /**
   * 這一點的地被樹冠遮住多少，0～1。**注入而不是 import** ——
   * `flora.ts` 已經 import 這個檔案的 `isGrass`，反過來會成環。組裝的人是
   * `terrain.ts`。不傳就是不上林相色。
   */
  coverAt: (x: number, z: number) => number = () => 0,
): { object: Object3D; dispose(): void } {
  const group = new Group()
  const material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: ROUGHNESS,
  })
  const geometries: BufferGeometry[] = []

  for (const isl of islands) {
    const geo = buildIsland(field, isl, coverAt)
    if (geo === null) continue
    geometries.push(geo)
    group.add(new Mesh(geo, material))
  }

  return {
    object: group,
    dispose() {
      for (const g of geometries) g.dispose()
      material.dispose()
    },
  }
}
