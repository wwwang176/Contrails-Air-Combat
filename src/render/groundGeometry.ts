import { BufferAttribute, BufferGeometry, Color } from 'three'
import type { HeightFieldData } from '../world/heightfield'

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
 * 高度場上一塊方框（格點欄 `c0..c1`、列 `r0..r1`，含端點）的 geometry。
 * **頂點高度直接讀 `field.data`**，與碰撞共用高度來源；整格沉在水下的不畫。
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
