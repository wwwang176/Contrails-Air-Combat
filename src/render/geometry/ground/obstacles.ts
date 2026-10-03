import { BufferAttribute, BufferGeometry, Color } from 'three'
import { hash01 } from '../../scatter'
import { toLocal, type ObstacleKind, type ObstacleLine } from '../../../world/rzhev'

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
 * 【放大的是占地，不是高度】照實的一公尺上下，從投彈高度看不到，所以占地放大；高度壓在
 * 坦克（T-34 約 2.6 m）之下，從低空看才不會有比坦克還高的反坦克障礙。常數在 `OBSTACLE_SIZE`。
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
  /**
   * 反坦克樁：底寬、頂寬、高、同一排的間距、幾排、兩排之間的距離，m。實物的龍牙是三排以上、
   * 排內幾乎貼著擺，一排一排錯開
   */
  teeth: { base: 2.2, top: 1.0, height: 1.1, spacing: 3.0, rows: 3, rowGap: 6 },
  /** 捷克刺蝟：長條的長與粗、同一排的間距、幾排、兩排之間的距離，m。立起來的高度是長 × sin 35° */
  hedgehog: { bar: 2.8, thick: 0.28, spacing: 6, rows: 2, rowGap: 6 },
  /**
   * 鐵絲網（蛇腹形，concertina）：一條連續的螺旋，像拉開的彈簧。`radius` 是螺旋的半徑、`thick` 是鐵絲
   * 的粗、`pitch` 是繞一圈往前走多遠、`segs` 是一圈用幾根短條（四根＝菱形）。一段（`run`）的長度範圍與
   * 兩段之間的缺口（`gap`）。`spacing` 只給擺位用：沿每一段每隔這麼遠取一點，測試靠它量離路、離單位的距離。
   * 單位 m
   */
  wire: {
    spacing: 3.2, radius: 0.55, thick: 0.1, pitch: 1.5, segs: 4,
    run: [40, 90], gap: [8, 22],
  },
  /** 埋進地面的深度，m */
  sink: 0.25,
} as const

/**
 * 三角形上限。實測全部約 7.8 萬個、建構約 90 ms；同頁 GPU 計時對照「有障礙物」與「沒有」（三輪交錯）：
 * 轟炸高度 1500 m 差 0.0 ms、低空 250 m 差約 0.6 ms，繪製呼叫只多 2（一個材質、頂點色，切成 1 km 的
 * 格各自剔除）。總量仍小，所以不做遠近層級；超過的話要先想辦法省
 */
export const OBSTACLE_MAX_TRIS = 100_000

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

/** 折線的取樣器：沿弧長 `s` 取點與線向（弧度，局部 x 軸朝線向）。`s` 夾在 0 與總長之間 */
interface PathSampler {
  readonly length: number
  at(s: number): { x: number; z: number; dir: number }
}

function pathSampler(pts: readonly { x: number; z: number }[]): PathSampler {
  const cum: number[] = [0]
  for (let k = 0; k + 1 < pts.length; k++) {
    cum.push(cum[k]! + Math.hypot(pts[k + 1]!.x - pts[k]!.x, pts[k + 1]!.z - pts[k]!.z))
  }
  const length = cum[cum.length - 1]!
  return {
    length,
    at(s) {
      const c = Math.min(length, Math.max(0, s))
      let k = 0
      while (k + 2 < cum.length && cum[k + 1]! < c) k++
      const a = pts[k]!
      const b = pts[k + 1]!
      const seg = cum[k + 1]! - cum[k]!
      const t = seg === 0 ? 0 : (c - cum[k]!) / seg
      return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t, dir: Math.atan2(b.z - a.z, b.x - a.x) }
    },
  }
}

/** 一段鐵絲網在線上的範圍：離起點的弧長，m */
export interface WireRun {
  readonly s0: number
  readonly s1: number
}

/** 短於這個的段不要（一圈螺旋都放不滿），m */
const MIN_RUN = 12

/**
 * 一條鐵絲網線上的各段。**實物的鐵絲網是分段的**：蛇腹形一卷拉開約 15 m，接成一段，段與段之間留缺口
 * （自己人的通道，平時用可移動的段擋著；路口與地形的邊也會斷）。段長在 `run`、缺口在 `gap` 範圍內
 * 各由雜湊決定，第一段從 0 到缺口的一半內開始。**純函數**：同一條線同一組結果。
 */
export function wireRuns(points: readonly { x: number; z: number }[], seed: number): WireRun[] {
  const W = OBSTACLE_SIZE.wire
  const length = pathSampler(points).length
  const out: WireRun[] = []
  const lerp = (r: readonly number[], u: number): number => r[0]! + (r[1]! - r[0]!) * u
  let s = hash01(seed) * lerp(W.gap, 0.5)
  for (let k = 0; s < length; k++) {
    const s1 = Math.min(length, s + lerp(W.run, hash01(seed + 2 * k + 1)))
    if (s1 - s >= MIN_RUN) out.push({ s0: s, s1 })
    s = s1 + lerp(W.gap, hash01(seed + 2 * k + 2))
  }
  return out
}

/**
 * 每一個零件的位置與朝向。**純函數**：同一份資料同一組結果，測試與幾何共用這一份。
 * 反坦克樁兩排錯開（第二排往德軍那一側退 `rowGap`、沿線錯半格）；鐵絲網只給**沿每一段每隔
 * `spacing` 取的點**（缺口裡沒有），幾何另外用 `coilPath` 畫連續的螺旋
 */
export function obstaclePlacements(lines: readonly ObstacleLine[]): ObstaclePiece[] {
  const out: ObstaclePiece[] = []
  lines.forEach((ln, li) => {
    const seed = (li + 1) * 100003
    if (ln.kind === 'teeth') {
      const T = OBSTACLE_SIZE.teeth
      for (let row = 0; row < T.rows; row++) {
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
      for (let row = 0; row < H.rows; row++) {
        walk(ln.points, H.spacing, H.spacing / 2 + row * (H.spacing / 2)).forEach((p, i) => {
          const j = seed + row * 50021 + i
          // 與反坦克樁一樣，後一排往德軍那一側退 `rowGap`
          const nx = -Math.sin(p.dir)
          const nz = Math.cos(p.dir)
          const toward = toLocal(p.x + nx, p.z + nz).lz > toLocal(p.x, p.z).lz ? 1 : -1
          out.push({
            kind: 'hedgehog',
            x: p.x + nx * toward * row * H.rowGap + (hash01(j) - 0.5) * 1.2,
            z: p.z + nz * toward * row * H.rowGap + (hash01(j + 7) - 0.5) * 1.2,
            yaw: hash01(j + 13) * Math.PI * 2, line: li, index: row * 100000 + i,
          })
        })
      }
    } else {
      const sm = pathSampler(ln.points)
      let i = 0
      for (const run of wireRuns(ln.points, seed)) {
        // 每一段的頭尾都取一點，段才有頭有尾
        for (let s = run.s0; ; s += OBSTACLE_SIZE.wire.spacing) {
          const p = sm.at(Math.min(s, run.s1))
          out.push({ kind: 'wire', x: p.x, z: p.z, yaw: p.dir, line: li, index: i++ })
          if (s >= run.s1) break
        }
      }
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
 * 一段鐵絲網的螺旋：沿線在 `s0`～`s1` 之間，每走 `pitch / segs` 一個頂點，頂點繞著線轉
 * `360° / segs`，所以一圈（`pitch`）有 `segs` 根短條、整段是**一條連續的螺旋**，像拉開的彈簧。
 * 螺旋的軸貼著地面，最低的頂點離地面 0.08 m 以內；頭尾各一圈半徑從一半長回全寬，段有頭有尾。
 * 回頂點，世界座標；相鄰兩個頂點之間是一根短條。
 */
export function coilPath(
  points: readonly { x: number; z: number }[], s0: number, s1: number, groundAt: (x: number, z: number) => number,
): V3[] {
  const W = OBSTACLE_SIZE.wire
  const sm = pathSampler(points)
  const n = Math.max(2, Math.round(((s1 - s0) * W.segs) / W.pitch))
  const out: V3[] = []
  for (let k = 0; k <= n; k++) {
    const p = sm.at(s0 + ((s1 - s0) * k) / n)
    const th = (2 * Math.PI * k) / W.segs
    const r = W.radius * Math.min(1, 0.5 + (0.5 * Math.min(k, n - k)) / W.segs)
    out.push([
      p.x - Math.sin(p.dir) * Math.cos(th) * r,
      groundAt(p.x, p.z) + W.radius - 0.08 + Math.sin(th) * r,
      p.z + Math.cos(p.dir) * Math.cos(th) * r,
    ])
  }
  return out
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
 * 一根長條，從 `a` 到 `b`，斷面是方形（`sides` 4，八個三角形）或三角形（3，六個三角形；細鐵絲用）。
 * 兩端各伸出 `extend`（接頭用）；`caps` 為真時兩端封起來（懸空的長條要封，只有方形的支援），
 * 為假時只畫長面
 */
function prism(
  out: Soup, a: V3, b: V3, thick: number, rgb: readonly [number, number, number], caps: boolean, extend: number,
  sides: 3 | 4 = 4,
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
  // 方形的角在 45° 上、離軸 h√2（邊長 = thick）；三角形的頂點離軸 0.65 × thick（外接圓，面積與方形相近）
  const radius = sides === 4 ? (thick / 2) * Math.SQRT2 : thick * 0.65
  const ang0 = sides === 4 ? Math.PI / 4 : Math.PI / 2
  const p0: V3 = [a[0] - dx * extend, a[1] - dy * extend, a[2] - dz * extend]
  const q0: V3 = [b[0] + dx * extend, b[1] + dy * extend, b[2] + dz * extend]
  const ring = (o: V3): V3[] => Array.from({ length: sides }, (_, k) => {
    const ang = ang0 + (k * 2 * Math.PI) / sides
    const cv = Math.cos(ang) * radius
    const cw = Math.sin(ang) * radius
    return [o[0] + vx * cv + wx * cw, o[1] + vy * cv + wy * cw, o[2] + vz * cv + wz * cw] as V3
  })
  const p = ring(p0)
  const q = ring(q0)
  const centre: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
  for (let k = 0; k < sides; k++) quad(out, p[k]!, p[(k + 1) % sides]!, q[(k + 1) % sides]!, q[k]!, centre, rgb)
  if (caps && sides === 4) {
    quad(out, p[0]!, p[1]!, p[2]!, p[3]!, centre, rgb)
    quad(out, q[0]!, q[1]!, q[2]!, q[3]!, centre, rgb)
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
    }
  }
  // 鐵絲網：每一條線的每一段一條連續的螺旋。相鄰兩根短條在頂點處各伸出半個粗細，接頭與對方的外表面
  // 齊平、蓋住開口，不必封口
  const W = OBSTACLE_SIZE.wire
  lines.forEach((ln, li) => {
    if (ln.kind !== 'wire') return
    for (const run of wireRuns(ln.points, (li + 1) * 100003)) {
      const path = coilPath(ln.points, run.s0, run.s1, heightAt)
      for (let k = 0; k + 1 < path.length; k++) prism(out, path[k]!, path[k + 1]!, W.thick, wire, false, W.thick / 2, 3)
    }
  })
  const geo = new BufferGeometry()
  geo.setAttribute('position', new BufferAttribute(new Float32Array(out.pos), 3))
  geo.setAttribute('color', new BufferAttribute(new Float32Array(out.col), 3))
  geo.computeVertexNormals()
  geo.computeBoundingSphere()
  return geo
}
