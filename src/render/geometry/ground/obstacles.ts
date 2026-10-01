import { BufferAttribute, BufferGeometry, Color } from 'three'
import { hash01 } from '../../scatter'
import { toLocal, type ObstacleKind, type ObstacleLine } from '../../../world/kursk'

/**
 * # 戰場的障礙物：反坦克樁、捷克刺蝟、鐵絲網
 *
 * 全是長方體拼的。**一顆合併的非索引三角形湯、只有位置與頂點色**，走地形的「佈景」機制
 * （`render/terrain.ts` 的 `scenery`、`sceneryChunks.ts` 切成 1 km 的格各自剔除）。沒有命中盒，
 * 子彈與炸彈穿過去；沒有遠近層級，總量約 2.6 萬個三角形、建構 40 ms 上下。
 *
 * 【尺寸比實物放大】與壕溝同理：照實的一公尺上下，從投彈高度看不到。常數在 `OBSTACLE_SIZE`。
 *
 * 【不畫底面、往地下埋】底面與地面共面，拉遠會閃（z-fight）。每個零件的底部埋進地面
 * `sink` 公尺，只畫頂面與四個側面。
 *
 * 【不用單片平面做鐵絲網】材質是單面的，從背面看不見；太薄的面拉遠也會閃。網用細長方體。
 *
 * 【頂點色是線性色】`new Color(hex)` 取 `.r/.g/.b`，與其他佈景同一個轉法；直接寫 hex / 255 整片偏亮。
 */

export const OBSTACLE_COLORS = {
  teeth: 0x8f8c84,
  hedgehog: 0x5a4a3c,
  post: 0x6c5b42,
  rail: 0x2b2a28,
} as const

export const OBSTACLE_SIZE = {
  /** 反坦克樁：方柱的邊長與高、同一排的間距、兩排之間的距離，m */
  teeth: { base: 1.7, height: 3.0, spacing: 4.2, rowGap: 9 },
  /** 捷克刺蝟：長條的長與粗、離地高度、間距，m */
  hedgehog: { bar: 5.0, thick: 0.45, height: 1.3, spacing: 14 },
  /** 鐵絲網：木樁間距、木樁的粗與高、橫條的粗與離地高度，m */
  wire: { spacing: 5, post: 0.32, postHeight: 2.4, rail: 0.22, railHeights: [0.7, 1.5] },
  /** 每個零件埋進地面的深度，m */
  sink: 0.25,
} as const

/** 三角形上限。總量小，所以不做遠近層級；超過的話要先想辦法省 */
export const OBSTACLE_MAX_TRIS = 60_000

export interface ObstaclePiece {
  readonly kind: ObstacleKind
  readonly x: number
  readonly z: number
  readonly yaw: number
  /** 第幾條線、線上第幾個。鐵絲網的橫條靠它接起來 */
  readonly line: number
  readonly index: number
}

/**
 * 沿折線每隔 `step` 公尺取一點：`first` 是第一點離起點多遠。回傳點與該處的線向（弧度，
 * 局部 x 軸朝線向）。終點不一定取到
 */
function walk(
  pts: readonly { x: number; z: number }[], step: number, first: number,
): { x: number; z: number; dir: number }[] {
  const out: { x: number; z: number; dir: number }[] = []
  let carry = first
  for (let k = 0; k + 1 < pts.length; k++) {
    const a = pts[k]!
    const b = pts[k + 1]!
    const len = Math.hypot(b.x - a.x, b.z - a.z)
    if (len === 0) continue
    const dir = Math.atan2(b.z - a.z, b.x - a.x)
    for (let s = carry; s <= len; s += step) {
      out.push({ x: a.x + ((b.x - a.x) * s) / len, z: a.z + ((b.z - a.z) * s) / len, dir })
      carry = s + step
    }
    carry -= len
  }
  return out
}

/**
 * 每一個零件的位置與朝向。**純函數**：同一份資料同一組結果，測試與幾何共用這一份。
 * 反坦克樁兩排錯開（第二排往德軍那一側退 `rowGap`、沿線錯半格），鐵絲網的木樁含線的兩端
 */
export function obstaclePlacements(lines: readonly ObstacleLine[]): ObstaclePiece[] {
  const out: ObstaclePiece[] = []
  lines.forEach((ln, li) => {
    const seed = (li + 1) * 100003
    if (ln.kind === 'teeth') {
      const T = OBSTACLE_SIZE.teeth
      for (let row = 0; row < 2; row++) {
        walk(ln.points, T.spacing, T.spacing / 2 + row * (T.spacing / 2)).forEach((p, i) => {
          // 往德軍那一側（局部 lz 較大）退 `rowGap`
          const nx = -Math.sin(p.dir)
          const nz = Math.cos(p.dir)
          const toward = toLocal(p.x + nx, p.z + nz).lz > toLocal(p.x, p.z).lz ? 1 : -1
          const j = seed + row * 50021 + i
          out.push({
            kind: 'teeth',
            x: p.x + nx * toward * row * T.rowGap + (hash01(j) - 0.5) * 0.5,
            z: p.z + nz * toward * row * T.rowGap + (hash01(j + 7) - 0.5) * 0.5,
            yaw: p.dir + (hash01(j + 13) - 0.5) * 0.2, line: li, index: row * 100000 + i,
          })
        })
      }
    } else if (ln.kind === 'hedgehog') {
      const H = OBSTACLE_SIZE.hedgehog
      walk(ln.points, H.spacing, H.spacing / 2).forEach((p, i) => {
        const j = seed + i
        out.push({
          kind: 'hedgehog',
          x: p.x + (hash01(j) - 0.5) * 1.2, z: p.z + (hash01(j + 7) - 0.5) * 1.2,
          yaw: hash01(j + 13) * Math.PI, line: li, index: i,
        })
      })
    } else {
      const W = OBSTACLE_SIZE.wire
      const posts = walk(ln.points, W.spacing, 0)
      // 終點補一根，橫條才接得到線的盡頭
      const last = ln.points[ln.points.length - 1]!
      const tail = posts[posts.length - 1]
      if (tail === undefined || Math.hypot(last.x - tail.x, last.z - tail.z) > 1) {
        posts.push({ x: last.x, z: last.z, dir: tail?.dir ?? 0 })
      }
      posts.forEach((p, i) => {
        out.push({ kind: 'wire', x: p.x, z: p.z, yaw: p.dir, line: li, index: i })
      })
    }
  })
  return out
}

interface Soup {
  readonly pos: number[]
  readonly col: number[]
}

type V3 = readonly [number, number, number]

/** 一個三角形，繞向朝外：與「重心離盒心」同向，不同向就換兩個頂點 */
function tri(out: Soup, a: V3, b: V3, c: V3, centre: V3, rgb: readonly [number, number, number]): void {
  const ux = b[0] - a[0]
  const uy = b[1] - a[1]
  const uz = b[2] - a[2]
  const vx = c[0] - a[0]
  const vy = c[1] - a[1]
  const vz = c[2] - a[2]
  const nx = uy * vz - uz * vy
  const ny = uz * vx - ux * vz
  const nz = ux * vy - uy * vx
  const gx = (a[0] + b[0] + c[0]) / 3 - centre[0]
  const gy = (a[1] + b[1] + c[1]) / 3 - centre[1]
  const gz = (a[2] + b[2] + c[2]) / 3 - centre[2]
  const flip = nx * gx + ny * gy + nz * gz < 0
  const p = flip ? [a, c, b] : [a, b, c]
  for (const v of p) {
    out.pos.push(v[0], v[1], v[2])
    out.col.push(rgb[0], rgb[1], rgb[2])
  }
}

/**
 * 一個長方體：中心 `(cx, cz)`、底面在 `y0`、高 `sy`、沿線向（局部 x）`sx`、橫向 `sz`、繞 y 轉 `yaw`。
 * **不畫底面**：頂面與四個側面，十個三角形
 */
function box(
  out: Soup, cx: number, cz: number, y0: number, sx: number, sy: number, sz: number, yaw: number,
  rgb: readonly [number, number, number],
): void {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const hx = sx / 2
  const hz = sz / 2
  const corner = (lx: number, lz: number, y: number): V3 => [cx + lx * c - lz * s, y, cz + lx * s + lz * c]
  const b0 = corner(-hx, -hz, y0)
  const b1 = corner(hx, -hz, y0)
  const b2 = corner(hx, hz, y0)
  const b3 = corner(-hx, hz, y0)
  const t0 = corner(-hx, -hz, y0 + sy)
  const t1 = corner(hx, -hz, y0 + sy)
  const t2 = corner(hx, hz, y0 + sy)
  const t3 = corner(-hx, hz, y0 + sy)
  const centre: V3 = [cx, y0 + sy / 2, cz]
  const quad = (a: V3, b: V3, cc: V3, d: V3): void => {
    tri(out, a, b, cc, centre, rgb)
    tri(out, a, cc, d, centre, rgb)
  }
  quad(t0, t1, t2, t3)
  quad(b0, b1, t1, t0)
  quad(b1, b2, t2, t1)
  quad(b2, b3, t3, t2)
  quad(b3, b0, t0, t3)
}

const rgbOf = (hex: number): [number, number, number] => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

/**
 * 全部障礙物的幾何，世界座標。`heightAt` 給地面高度，零件各自貼著它（埋 `sink`）。
 * 非索引、位置與頂點色，法線由三角形算（平面著色）
 */
export function buildObstacles(
  lines: readonly ObstacleLine[], heightAt: (x: number, z: number) => number,
): BufferGeometry {
  const out: Soup = { pos: [], col: [] }
  const pieces = obstaclePlacements(lines)
  const sink = OBSTACLE_SIZE.sink
  const teeth = rgbOf(OBSTACLE_COLORS.teeth)
  const hog = rgbOf(OBSTACLE_COLORS.hedgehog)
  const post = rgbOf(OBSTACLE_COLORS.post)
  const rail = rgbOf(OBSTACLE_COLORS.rail)
  for (const p of pieces) {
    const g = heightAt(p.x, p.z)
    if (p.kind === 'teeth') {
      const T = OBSTACLE_SIZE.teeth
      // 高度各差一點，不是一排一樣高的尺
      const h = T.height * (0.92 + 0.16 * hash01(p.line * 7919 + p.index))
      box(out, p.x, p.z, g - sink, T.base, h + sink, T.base, p.yaw, teeth)
    } else if (p.kind === 'hedgehog') {
      const H = OBSTACLE_SIZE.hedgehog
      // 三根長條交叉在同一點：兩根平放（互相垂直）、一根直立
      box(out, p.x, p.z, g + H.height - H.thick / 2, H.bar, H.thick, H.thick, p.yaw, hog)
      box(out, p.x, p.z, g + H.height - H.thick / 2, H.thick, H.thick, H.bar, p.yaw, hog)
      box(out, p.x, p.z, g - sink, H.thick, H.height * 2 + sink, H.thick, p.yaw, hog)
    } else {
      const W = OBSTACLE_SIZE.wire
      box(out, p.x, p.z, g - sink, W.post, W.postHeight + sink, W.post, p.yaw, post)
    }
  }
  // 鐵絲網的橫條：同一條線上相鄰兩根木樁之間各兩條
  const W = OBSTACLE_SIZE.wire
  const byLine = new Map<number, ObstaclePiece[]>()
  for (const p of pieces) {
    if (p.kind !== 'wire') continue
    const list = byLine.get(p.line)
    if (list === undefined) byLine.set(p.line, [p])
    else list.push(p)
  }
  for (const list of byLine.values()) {
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i]!
      const b = list[i + 1]!
      const len = Math.hypot(b.x - a.x, b.z - a.z)
      if (len < 0.5) continue
      const yaw = Math.atan2(b.z - a.z, b.x - a.x)
      const mx = (a.x + b.x) / 2
      const mz = (a.z + b.z) / 2
      const g = (heightAt(a.x, a.z) + heightAt(b.x, b.z)) / 2
      for (const h of W.railHeights) box(out, mx, mz, g + h, len, W.rail, W.rail, yaw, rail)
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(out.pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(out.col), 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
