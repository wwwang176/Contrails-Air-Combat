import {
  BoxGeometry, BufferAttribute, BufferGeometry, Color, CylinderGeometry, Matrix4,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { DEG } from '../../../core/math'

/**
 * 地面單位的低階零件 —— **只有盒子與圓柱，沒有任何單位的造型。**
 *
 * 【為什麼不像 floraShapes 那樣手寫三角形】地面單位滿是輪子、砲管、鍋爐、
 * 緩衝器 —— 全部是圓柱。手寫三角形要自己算圓周分段，一個單位就得寫上百行，
 * 而且改半徑就得整段重來。這裡改用 three 的 primitive 加一個變換矩陣，
 * 代價是每個零件多一次 `toNonIndexed`（建構期一次，不在熱路徑上）。
 *
 * 【為什麼不共用頂點】材質是 `flatShading`，不共用頂點時
 * `computeVertexNormals` 直接給出面法線 —— low-poly 的稜線因此是硬的。
 * `mergeGeometries` 之前每個零件都先 `toNonIndexed()` 就是為了這件事。
 *
 * 【顏色走頂點色】一個單位合併成**一個 mesh、一個 draw call**，配色靠頂點色
 * 帶。材質的 `vertexColors` 必須是 `true`，否則 `USE_COLOR` 不定義，
 * 整台會被塗成材質的單一顏色。
 *
 * ## 呼叫端要遵守的約定
 *
 * - **底面在 y = 0**：擺放時 `y` 直接放地面高度，否則整批浮空或陷地。
 * - **車頭朝 −Z**，與機體座標同一套（`tools/hangar.ts` 檔頭）。混用的話
 *   同一個航向角會讓車與飛機朝相反方向，而那在畫面上像是 AI 壞了。
 * - **左右對稱於 x = 0**。
 */

/**
 * 擺放：先繞**零件自己的中心** X → Y → Z 轉，再平移。角度是**度**。
 *
 * 【`ry` 不是公轉】要把幾支腳架成星形時，只給 `ry` 會讓它們全部疊在同一個
 * 位置上 —— 位置得自己用三角函數算（見 `flak.ts` 的三角砲座）。
 */
export interface Place {
  x?: number
  y?: number
  z?: number
  rx?: number
  ry?: number
  rz?: number
}

const M = /* @__PURE__ */ new Matrix4()
const R = /* @__PURE__ */ new Matrix4()
const C = /* @__PURE__ */ new Color()

function placed(geo: BufferGeometry, hex: number, at: Place): BufferGeometry {
  const g = geo.toNonIndexed()
  geo.dispose()

  M.makeRotationX((at.rx ?? 0) * DEG)
  R.makeRotationY((at.ry ?? 0) * DEG)
  M.premultiply(R)
  R.makeRotationZ((at.rz ?? 0) * DEG)
  M.premultiply(R)
  M.setPosition(at.x ?? 0, at.y ?? 0, at.z ?? 0)
  g.applyMatrix4(M)

  C.setHex(hex)
  const n = g.getAttribute('position').count
  const col = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    col[i * 3] = C.r
    col[i * 3 + 1] = C.g
    col[i * 3 + 2] = C.b
  }
  g.setAttribute('color', new BufferAttribute(col, 3))
  return g
}

/** 長方體。`w` 沿 X、`h` 沿 Y、`d` 沿 Z，中心在 `at`。 */
export function box(w: number, h: number, d: number, hex: number, at: Place = {}): BufferGeometry {
  return placed(new BoxGeometry(w, h, d), hex, at)
}

/**
 * 圓柱。**未旋轉時軸沿 Y**，中心在 `at`。
 *
 * 輪子（軸沿 X）用 `rz: 90`；砲管與鍋爐（軸沿 Z）用 `rx: 90`。
 */
export function cyl(
  r: number, len: number, hex: number, at: Place = {}, seg = 12, rTop = r,
): BufferGeometry {
  return placed(new CylinderGeometry(rTop, r, len, seg), hex, at)
}

/**
 * 把零件併成一顆網格用的幾何。**零件在這裡被吃掉**（已 dispose），
 * 呼叫端不要再拿去用。
 */
export function assemble(parts: BufferGeometry[]): BufferGeometry {
  const geo = mergeGeometries(parts)
  if (geo === null) {
    throw new Error('地面單位的零件合併失敗 —— 屬性不一致')
  }
  for (const p of parts) p.dispose()
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}

/**
 * 配色。**同一族用同一個色鍵**，改一次全部跟著改。GLB 那幾台照材質名對到
 * 這裡（`glb.ts` 的 `GLB_MATERIALS`），火車直接用。
 */
export const HUE = {
  /** 蘇軍 4BO 保護綠（T-34、卡車）。 */
  armyGreen: 0x4d5a37,
  /** 德軍 Dunkelgelb（Flak 砲位）。 */
  sandYellow: 0x8f7d51,
  /** 鋼鐵：砲管、軌道、車架。 */
  steel: 0x4a4f55,
  steelDark: 0x33383d,
  /** 蒸汽機車的黑。純黑在暗場景裡是一團看不見的洞，所以是很深的藍灰。 */
  locoBlack: 0x24282c,
  /** 橡膠：輪胎、履帶。 */
  rubber: 0x1f2226,
  /** 帆布篷、遮蔽物。 */
  canvas: 0x7d7357,
  /** 木材：貨車地板、枕木。 */
  wood: 0x6b5537,
  /** 玻璃：駕駛室窗。單一顏色，不做透明 —— 一個 draw call 的代價。 */
  glass: 0x2c3a44,
  /** 標記紅：軌道車輛的底架、緩衝器。 */
  markRed: 0x7a2f26,
} as const
