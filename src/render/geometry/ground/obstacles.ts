import { BufferAttribute, BufferGeometry, Color } from 'three'
import { hash01 } from '../../scatter'
import { toLocal, type ObstacleKind, type ObstacleLine } from '../../../world/kursk'

/**
 * # 戰場的障礙物：反坦克樁、捷克刺蝟、鐵絲網
 *
 * - **反坦克樁**：上窄的截頭錐（底寬、頂面是平的），兩排錯開
 * - **捷克刺蝟**：三根互相垂直的長條交在一點，各傾斜 35°（方位差 120°），立在三個下端上
 * - **鐵絲網**：一圈圈的蛇腹。每一圈是四根短條圍成的圓（立著的菱形），圈面垂直於網的走向，
 *   沿線每隔一小段一圈
 *
 * **一顆合併的非索引三角形湯、只有位置與頂點色**，走地形的「佈景」機制（`render/terrain.ts` 的
 * `scenery`、`sceneryChunks.ts` 切成 1 km 的格各自剔除）。沒有命中盒，子彈與炸彈穿過去；沒有
 * 遠近層級，總量約 4 萬個三角形、建構 50 ms 上下。
 *
 * 【尺寸比實物放大】與壕溝同理：照實的一公尺上下，從投彈高度看不到。常數在 `OBSTACLE_SIZE`。
 *
 * 【埋地的零件不畫底面，懸空的零件畫封閉的盒體】反坦克樁的底面與地面共面，拉遠會閃（z-fight），
 * 所以埋進地面 `sink` 公尺、只畫頂面與側面；刺蝟與鐵絲網的長條是懸空的，從下面看得到，兩端
 * 封起來。鐵絲網圈上相接的兩根短條各伸出半個粗細，接頭與對方的外表面齊平、蓋住開口，不必封口。
 *
 * 【頂點色是線性色】`new Color(hex)` 取 `.r/.g/.b`，與其他佈景同一個轉法；直接寫 hex / 255 整片偏亮。
 */

export const OBSTACLE_COLORS = {
  teeth: 0x8f8c84,
  hedgehog: 0x5a4a3c,
  wire: 0x34332f,
} as const

export const OBSTACLE_SIZE = {
  /** 反坦克樁：底寬、頂寬、高、同一排的間距、兩排之間的距離，m */
  teeth: { base: 1.8, top: 0.8, height: 2.6, spacing: 4.2, rowGap: 9 },
  /** 捷克刺蝟：長條的長與粗、間距，m */
  hedgehog: { bar: 5.0, thick: 0.45, spacing: 14 },
  /** 鐵絲網：圈與圈的間距、圈的半徑（菱形的半對角線）、短條的粗，m */
  wire: { spacing: 3.2, radius: 1.1, thick: 0.16 },
  /** 埋進地面的深度，m */
  sink: 0.25,
} as const

/** 三角形上限。總量小，所以不做遠近層級；超過的話要先想辦法省 */
export const OBSTACLE_MAX_TRIS = 60_000

/** 捷克刺蝟三根長條的仰角：互相垂直的三根、體對角線朝上時，每一根與水平面夾 asin(1/√3) */
const HEDGEHOG_ELEVATION = Math.asin(1 / Math.sqrt(3))

export interface ObstaclePiece {
  readonly kind: ObstacleKind
  readonly x: number
  readonly z: number
  /** 零件的朝向：反坦克樁與刺蝟是隨機的小抖動，鐵絲網是線的走向（圈面垂直於它） */
  readonly yaw: number
  /** 第幾條線、線上第幾個 */
  readonly line: number
  readonly index: number
}

type V3 = readonly [number, number, number]
type Seg = readonly [V3, V3]

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
 * 反坦克樁兩排錯開（第二排往德軍那一側退 `rowGap`、沿線錯半格），鐵絲網的圈含線的兩端
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
          yaw: hash01(j + 13) * Math.PI * 2, line: li, index: i,
        })
      })
    } else {
      const rings = walk(ln.points, OBSTACLE_SIZE.wire.spacing, 0)
      // 終點補一圈，線才有頭有尾
      const last = ln.points[ln.points.length - 1]!
      const tail = rings[rings.length - 1]
      if (tail === undefined || Math.hypot(last.x - tail.x, last.z - tail.z) > OBSTACLE_SIZE.wire.spacing / 2) {
        rings.push({ x: last.x, z: last.z, dir: tail?.dir ?? 0 })
      }
      rings.forEach((p, i) => {
        out.push({ kind: 'wire', x: p.x, z: p.z, yaw: p.dir, line: li, index: i })
      })
    }
  })
  return out
}

/**
 * 捷克刺蝟的三根長條，相對於中心：互相垂直、各仰起 35°、方位差 120°，兩端各離中心 `length / 2`。
 * 三個下端同高（著地）、三個上端朝外上方。`yaw` 轉整個刺蝟
 */
export function hedgehogBars(yaw: number, length: number): Seg[] {
  const out: Seg[] = []
  const c = Math.cos(HEDGEHOG_ELEVATION)
  const s = Math.sin(HEDGEHOG_ELEVATION)
  for (let k = 0; k < 3; k++) {
    const phi = yaw + (k * 2 * Math.PI) / 3
    const d: V3 = [c * Math.cos(phi), s, c * Math.sin(phi)]
    const h = length / 2
    out.push([[-d[0] * h, -d[1] * h, -d[2] * h], [d[0] * h, d[1] * h, d[2] * h]])
  }
  return out
}

/**
 * 鐵絲網的一圈，相對於圈心：四根短條圍成一個立著的圓（菱形），首尾相接。圈面垂直於網的走向
 * `dir`（弧度，局部 x 軸朝線向）：橫向軸 `(−sin dir, 0, cos dir)` 與鉛直軸張成這個面
 */
export function wireRingBars(dir: number, radius: number): Seg[] {
  const nx = -Math.sin(dir) * radius
  const nz = Math.cos(dir) * radius
  const v: V3[] = [[nx, 0, nz], [0, radius, 0], [-nx, 0, -nz], [0, -radius, 0]]
  return [[v[0]!, v[1]!], [v[1]!, v[2]!], [v[2]!, v[3]!], [v[3]!, v[0]!]]
}

interface Soup {
  readonly pos: number[]
  readonly col: number[]
}

/** 一個三角形，繞向朝外：與「重心離中心」同向，不同向就換兩個頂點 */
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

function quad(out: Soup, a: V3, b: V3, c: V3, d: V3, centre: V3, rgb: readonly [number, number, number]): void {
  tri(out, a, b, c, centre, rgb)
  tri(out, a, c, d, centre, rgb)
}

/**
 * 截頭錐：底面在 `y0`、邊長 `base`，頂面在 `y0 + h`、邊長 `top`，繞 y 轉 `yaw`。
 * **不畫底面**：頂面與四個側面，十個三角形
 */
function frustum(
  out: Soup, cx: number, cz: number, y0: number, base: number, top: number, h: number, yaw: number,
  rgb: readonly [number, number, number],
): void {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const at = (half: number, sx: number, sz: number, y: number): V3 => {
    const lx = sx * half
    const lz = sz * half
    return [cx + lx * c - lz * s, y, cz + lx * s + lz * c]
  }
  const hb = base / 2
  const ht = top / 2
  const b = [at(hb, -1, -1, y0), at(hb, 1, -1, y0), at(hb, 1, 1, y0), at(hb, -1, 1, y0)] as const
  const t = [at(ht, -1, -1, y0 + h), at(ht, 1, -1, y0 + h), at(ht, 1, 1, y0 + h), at(ht, -1, 1, y0 + h)] as const
  const centre: V3 = [cx, y0 + h / 2, cz]
  quad(out, t[0], t[1], t[2], t[3], centre, rgb)
  for (let k = 0; k < 4; k++) quad(out, b[k]!, b[(k + 1) % 4]!, t[(k + 1) % 4]!, t[k]!, centre, rgb)
}

/**
 * 一根方形斷面的長條，從 `a` 到 `b`。兩端各伸出 `extend`（接頭用）；`caps` 為真時兩端封起來
 * （懸空的長條要封），為假時只畫四個長面（八個三角形）
 */
function prism(
  out: Soup, a: V3, b: V3, thick: number, rgb: readonly [number, number, number], caps: boolean, extend: number,
): void {
  let dx = b[0] - a[0]
  let dy = b[1] - a[1]
  let dz = b[2] - a[2]
  const len = Math.hypot(dx, dy, dz)
  dx /= len
  dy /= len
  dz /= len
  // 垂直於軸的兩個方向：軸與鉛直不平行時取 軸 × 上，否則取 軸 × x
  let vx = -dz
  let vy = 0
  let vz = dx
  if (Math.hypot(vx, vz) < 0.2) {
    vx = 0
    vy = dz
    vz = -dy
  }
  const vl = Math.hypot(vx, vy, vz)
  vx /= vl
  vy /= vl
  vz /= vl
  const wx = dy * vz - dz * vy
  const wy = dz * vx - dx * vz
  const wz = dx * vy - dy * vx
  const h = thick / 2
  const p0: V3 = [a[0] - dx * extend, a[1] - dy * extend, a[2] - dz * extend]
  const q0: V3 = [b[0] + dx * extend, b[1] + dy * extend, b[2] + dz * extend]
  const corner = (o: V3, sv: number, sw: number): V3 => [
    o[0] + (vx * sv + wx * sw) * h, o[1] + (vy * sv + wy * sw) * h, o[2] + (vz * sv + wz * sw) * h,
  ]
  const p = [corner(p0, 1, 1), corner(p0, -1, 1), corner(p0, -1, -1), corner(p0, 1, -1)] as const
  const q = [corner(q0, 1, 1), corner(q0, -1, 1), corner(q0, -1, -1), corner(q0, 1, -1)] as const
  const centre: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  for (let k = 0; k < 4; k++) quad(out, p[k]!, p[(k + 1) % 4]!, q[(k + 1) % 4]!, q[k]!, centre, rgb)
  if (caps) {
    quad(out, p[0], p[1], p[2], p[3], centre, rgb)
    quad(out, q[0], q[1], q[2], q[3], centre, rgb)
  }
}

const rgbOf = (hex: number): [number, number, number] => {
  const c = new Color(hex)
  return [c.r, c.g, c.b]
}

/**
 * 全部障礙物的幾何，世界座標。`heightAt` 給地面高度，零件各自貼著它。
 * 非索引、位置與頂點色，法線由三角形算（平面著色）
 */
export function buildObstacles(
  lines: readonly ObstacleLine[], heightAt: (x: number, z: number) => number,
): BufferGeometry {
  const out: Soup = { pos: [], col: [] }
  const sink = OBSTACLE_SIZE.sink
  const teeth = rgbOf(OBSTACLE_COLORS.teeth)
  const hog = rgbOf(OBSTACLE_COLORS.hedgehog)
  const wire = rgbOf(OBSTACLE_COLORS.wire)
  for (const p of obstaclePlacements(lines)) {
    const g = heightAt(p.x, p.z)
    if (p.kind === 'teeth') {
      const T = OBSTACLE_SIZE.teeth
      // 高度各差一點，不是一排一樣高的尺。頂面的高度不變，底面埋進地下 `sink`
      const h = T.height * (0.92 + 0.16 * hash01(p.line * 7919 + p.index))
      frustum(out, p.x, p.z, g - sink, T.base, T.top, h + sink, p.yaw, teeth)
    } else if (p.kind === 'hedgehog') {
      const H = OBSTACLE_SIZE.hedgehog
      // 三個下端剛好在地面以下 `sink`：中心離下端的高度是 (長 / 2) × sin 35°
      const cy = g - sink + (H.bar / 2) * Math.sin(HEDGEHOG_ELEVATION)
      for (const [a, b] of hedgehogBars(p.yaw, H.bar)) {
        prism(out, [p.x + a[0], cy + a[1], p.z + a[2]], [p.x + b[0], cy + b[1], p.z + b[2]], H.thick, hog, true, 0)
      }
    } else {
      const W = OBSTACLE_SIZE.wire
      // 圈心在地面之上一個半徑：最低的頂點剛好貼地
      const cy = g + W.radius - 0.08
      for (const [a, b] of wireRingBars(p.yaw, W.radius)) {
        prism(out, [p.x + a[0], cy + a[1], p.z + a[2]], [p.x + b[0], cy + b[1], p.z + b[2]], W.thick, wire, false, W.thick / 2)
      }
    }
  }
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(out.pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(out.col), 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
