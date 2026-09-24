import { BufferAttribute, BufferGeometry, Color } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { GROUND_UNITS, groundGeometry } from './geometry/ground'
import { LEYTE_BEACH, type BeachDump } from '../world/leyte'

/**
 * # 雷伊泰灘頭的佈景
 *
 * 木箱堆與停著不動的車，**合併成一顆網格、一個 draw call、沒有命中盒** ——
 * 與洛伊納廠區的佈景同一個性質：子彈與炸彈穿過去落到地面。擺位在
 * `world/leyte.ts` 的 `LEYTE_BEACH`。
 *
 * 【木箱是一個個立方體】每一堆由種子決定：格子上一疊一疊，1～3 層、每層略小
 * 一點、各自偏一點角度；每隔幾排留一條走道；偶爾一大塊蓋帆布的堆。顏色在
 * 幾種木箱色裡挑、每一箱再深淺抖一點 —— 從空中看是一片斑駁的補給場，不是
 * 一塊色塊。
 *
 * 【車子用地面單位的幾何】`groundGeometry` 的樣板（開場已載），轉向、平移到
 * 位置上再併進來。**樣板要先載** —— 與地面目標同一個前提。
 */

/** 木箱的格距，m */
const CELL = 2.6
/** 一格放一疊的機率 */
const FILL = 0.78
/** 每隔幾排、幾欄留一條走道 */
const AISLE_ROW = 5
const AISLE_COL = 6
/** 蓋帆布的大堆佔幾成 */
const TARP = 0.07
/** 木箱色：漆成橄欖綠的、原木色、深褐、灰綠 */
const CRATE_COLORS = [0x5b5a3a, 0x8a7650, 0x4a4632, 0x676b4e, 0x7a6a48]
const TARP_COLOR = 0x6f6a50

/** 種子進、序列出（與 `world/leyte.ts` 的 `makeRand` 同一個 LCG） */
function lcg(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** 一個立方體的 12 個三角形（36 個頂點），繞 Y 轉 `yaw`，底面中心在 (x, y, z) */
function pushBox(
  pos: number[], col: number[], c: Color,
  x: number, y: number, z: number, w: number, h: number, d: number, yaw: number,
): void {
  const cs = Math.cos(yaw), sn = Math.sin(yaw)
  const hw = w / 2, hd = d / 2
  // 8 個角：i 的位元 0 = x 正、1 = y 上、2 = z 正
  const cx = new Array<number>(8), cy = new Array<number>(8), cz = new Array<number>(8)
  for (let i = 0; i < 8; i++) {
    const lx = i & 1 ? hw : -hw
    const lz = i & 4 ? hd : -hd
    cx[i] = x + lx * cs + lz * sn
    cy[i] = y + (i & 2 ? h : 0)
    cz[i] = z - lx * sn + lz * cs
  }
  // 六個面，每面兩個三角形，逆時針朝外
  const faces = [
    [0, 4, 6, 2], [1, 3, 7, 5], // −x、+x
    [0, 1, 5, 4], [2, 6, 7, 3], // 底、頂
    [0, 2, 3, 1], [4, 5, 7, 6], // −z、+z
  ]
  for (const [a, b, e, f] of faces) {
    for (const k of [a!, b!, e!, a!, e!, f!]) {
      pos.push(cx[k]!, cy[k]!, cz[k]!)
      col.push(c.r, c.g, c.b)
    }
  }
}

const C = /* @__PURE__ */ new Color()

/** 一堆補給裡的木箱，寫進 pos／col */
function crates(
  dump: BeachDump, heightAt: (x: number, z: number) => number, pos: number[], col: number[],
): void {
  const rand = lcg(dump.seed)
  const h = dump.heading
  // 深（沿 heading）與寬（右手）兩個方向
  const fx = -Math.sin(h), fz = -Math.cos(h)
  const rx = Math.cos(h), rz = -Math.sin(h)
  const cols = Math.max(1, Math.floor(dump.width / CELL))
  const rows = Math.max(1, Math.floor(dump.depth / CELL))
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lat = (i - (cols - 1) / 2) * CELL
      const dep = (j - (rows - 1) / 2) * CELL
      // 亂數每一格都抽固定的次數，走道與空格才不會讓後面的格子整片換樣子
      const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand(), r5 = rand()
      if (dump.lane > 0 && Math.abs(lat) < dump.lane / 2) continue
      if (j % AISLE_ROW === AISLE_ROW - 1 || i % AISLE_COL === AISLE_COL - 1) continue
      if (r0 > FILL) continue
      const x = dump.x + rx * lat + fx * dep + (r1 - 0.5) * 0.5
      const z = dump.z + rz * lat + fz * dep + (r2 - 0.5) * 0.5
      const y = heightAt(x, z)
      const yaw = h + (r3 - 0.5) * 0.3
      if (r4 < TARP) {
        // 蓋帆布的大堆：兩格大、扁一點
        C.setHex(TARP_COLOR).multiplyScalar(0.92 + 0.16 * r5)
        pushBox(pos, col, C, x, y, z, CELL * 1.8, 1.5 + r5 * 0.6, CELL * 1.8, yaw)
        continue
      }
      const base = CRATE_COLORS[Math.floor(r5 * CRATE_COLORS.length)]!
      let w = 1.3 + 0.8 * r1
      let d = 1.1 + 0.7 * r2
      let top = y
      const layers = r4 < 0.35 ? 1 : r4 < 0.8 ? 2 : 3
      for (let k = 0; k < layers; k++) {
        const bh = 0.8 + 0.35 * rand()
        C.setHex(base).multiplyScalar(0.9 + 0.2 * rand())
        pushBox(pos, col, C, x + (rand() - 0.5) * 0.3, top, z + (rand() - 0.5) * 0.3, w, bh, d, yaw + (rand() - 0.5) * 0.25)
        top += bh
        w *= 0.88
        d *= 0.88
      }
    }
  }
}

/**
 * 整片灘頭的佈景幾何。**每次建一份新的** —— 呼叫端 dispose 的是它自己的那份。
 *
 * @param heightAt 地面高度（畫出來的那一份，與撞地同一個高度場）
 */
export function buildLeyteBeach(heightAt: (x: number, z: number) => number): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  for (const d of LEYTE_BEACH.dumps) crates(d, heightAt, pos, col)
  const boxes = new BufferGeometry()
  boxes.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  boxes.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  boxes.computeVertexNormals()

  const parts: BufferGeometry[] = [boxes]
  for (const v of LEYTE_BEACH.vehicles) {
    const unit = GROUND_UNITS.find((u) => u.id === v.unit)!
    const g = groundGeometry(unit).clone()
    for (const name of Object.keys(g.attributes)) {
      if (name !== 'position' && name !== 'color' && name !== 'normal') g.deleteAttribute(name)
    }
    g.rotateY(v.heading)
    g.translate(v.x, heightAt(v.x, v.z), v.z)
    parts.push(g)
  }
  const merged = mergeGeometries(parts)
  if (merged === null) throw new Error('灘頭佈景合併失敗 —— 屬性不一致')
  for (const p of parts) p.dispose()
  merged.computeBoundingSphere()
  return merged
}
