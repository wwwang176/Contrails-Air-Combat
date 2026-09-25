/**
 * # 地表的真實地物：聚落、高速公路、露天礦
 *
 * 純資料與幾何，不碰 three。畫的部分在 `render/settlements.ts`、
 * `render/motorway.ts`、`render/mines.ts`。資料由
 * `tools/dem/fetch-leuna-features.mjs` 從 OSM 抓成 `public/data/leuna-features.json`。
 */

export interface Place {
  readonly name: string
  readonly kind: 'town' | 'village' | 'hamlet'
  readonly x: number
  readonly z: number
  /** 人口（OSM 的現值）。很多村沒有 */
  readonly pop?: number
}

export interface FeatureFile {
  /** 高速公路的車道中心線，上下行各一條 */
  readonly a9: readonly (readonly (readonly [number, number])[])[]
  readonly places: readonly Place[]
  /** 露天礦坑的外圈，不閉合（最後一點不重複第一點） */
  readonly mines: readonly { readonly name: string; readonly ring: readonly (readonly [number, number])[] }[]
}

/** 名字的雜湊。聚落的形狀與房子由它決定 —— 每次進場一樣 */
export function nameHash(name: string): number {
  let h = 2166136261
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619)
  return h >>> 0
}

/**
 * 聚落的半徑，m。
 *
 * - 鎮：`260 × √(人口 / 5000)`，夾在 160～900；沒有人口的 250。梅澤堡 3.6 萬人
 *   是 700 m。下限再高的話，一千多人的小鎮一棟住不到三個人
 * - 村：有人口的 `90 + 45 × √(人口 / 100)`，夾在 110～260；沒有的 120～170。
 * - 小聚落：70 m。
 *
 * 【人口是現值】戰後有併村、有擴張，所以這只是大小的次序，不是 1944 年的範圍。
 */
export function settlementRadius(p: Place): number {
  const h = nameHash(p.name)
  if (p.kind === 'town') {
    if (p.pop === undefined) return 250
    return Math.max(160, Math.min(900, 260 * Math.sqrt(p.pop / 5000)))
  }
  if (p.kind === 'village') {
    if (p.pop === undefined) return 120 + ((h & 0xff) / 255) * 50
    return Math.max(110, Math.min(260, 90 + 45 * Math.sqrt(p.pop / 100)))
  }
  return 70
}

/**
 * 聚落的輪廓在方位 `theta` 的半徑倍率：兩個不同頻率的起伏疊起來，
 * 不是正圓。範圍約 0.78～1.22。
 */
export function outlineScale(p: Place, theta: number): number {
  const h = nameHash(p.name)
  const a = ((h >>> 8) & 0xff) / 255 * Math.PI * 2
  const b = ((h >>> 16) & 0xff) / 255 * Math.PI * 2
  return 1 + 0.22 * (0.6 * Math.sin(3 * theta + a) + 0.4 * Math.sin(5 * theta + b))
}

/** 這一點在聚落的輪廓內嗎 */
export function insideSettlement(p: Place, x: number, z: number): boolean {
  const dx = x - p.x
  const dz = z - p.z
  const r = Math.hypot(dx, dz)
  return r <= settlementRadius(p) * outlineScale(p, Math.atan2(dz, dx))
}

/** 點在多邊形內（偶奇規則）。`ring` 不閉合 */
export function insideRing(ring: readonly (readonly [number, number])[], x: number, z: number): boolean {
  let c = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!
    const b = ring[j]!
    if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) c = !c
  }
  return c
}

/** 點到多邊形邊界的距離，m。`ring` 不閉合 */
export function ringDistance(ring: readonly (readonly [number, number])[], x: number, z: number): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!
    const b = ring[(i + 1) % ring.length]!
    const vx = b[0] - a[0]
    const vz = b[1] - a[1]
    const l2 = vx * vx + vz * vz
    const t = l2 <= 0 ? 0 : Math.max(0, Math.min(1, ((x - a[0]) * vx + (z - a[1]) * vz) / l2))
    const d = Math.hypot(x - (a[0] + vx * t), z - (a[1] + vz * t))
    if (d < best) best = d
  }
  return best
}

// ── 高速公路的縱剖面 ─────────────────────────────────

/** 路面的取樣間距，m。地形一格 80 m，要比它細路面才貼得住 */
export const ROAD_STEP = 20
/** 路面高出地面多少，m。與河岸草甸同一個理由：閃爍靠 `polygonOffset`，這只是餘裕 */
export const ROAD_LIFT = 0.3
/** 離河的中心線這個距離內算「在河上」，要架橋，m。水面半寬 45 加兩岸 */
export const BRIDGE_REACH = 75
/** 橋面比水面高多少，m */
export const DECK_CLEARANCE = 7
/** 引道的坡度（高 ÷ 水平），高速公路的上限約 4% */
export const RAMP_SLOPE = 0.04

export interface RoadProfile {
  readonly points: readonly (readonly [number, number])[]
  /** 路面高度，m */
  readonly height: readonly number[]
  /** 地面高度，m */
  readonly ground: readonly number[]
  /** 這一點在河上（橋面，底下是水） */
  readonly overWater: readonly boolean[]
}

/** 折線依固定間距重新取樣（保留頭尾） */
export function resampleLine(pts: readonly (readonly [number, number])[], step: number): [number, number][] {
  const out: [number, number][] = [[pts[0]![0], pts[0]![1]]]
  let carry = 0
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i]!
    const b = pts[i + 1]!
    const len = Math.hypot(b[0] - a[0], b[1] - a[1])
    if (len < 1e-6) continue
    for (let d = step - carry; d < len; d += step) {
      const t = d / len
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t])
    }
    carry = (carry + len) % step
  }
  out.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]])
  return out
}

/**
 * 一條車道的縱剖面：平常貼著地面，過河的地方墊成橋。
 *
 * `riverDistance` 回到最近一條河的中心線的距離（查不到回 `Infinity`），
 * `riverLevel` 回那裡的水面高度。
 *
 * ```
 *   1. 離河 BRIDGE_REACH 以內的連續幾點是一座橋的橋面
 *   2. 橋面高 = 那一段最高的水面 + DECK_CLEARANCE
 *   3. 往兩邊照 RAMP_SLOPE 降回地面（取與地面的較高者）
 * ```
 */
export function roadProfile(
  line: readonly (readonly [number, number])[],
  ground: (x: number, z: number) => number,
  riverDistance: (x: number, z: number) => number,
  riverLevel: (x: number, z: number) => number,
): RoadProfile {
  const points = resampleLine(line, ROAD_STEP)
  const n = points.length
  const g = points.map(([x, z]) => ground(x, z))
  const over = points.map(([x, z]) => riverDistance(x, z) <= BRIDGE_REACH)
  const h = g.slice()
  // 沿線的累計距離，算引道用
  const s: number[] = [0]
  for (let i = 1; i < n; i++) {
    s.push(s[i - 1]! + Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1]))
  }
  for (let i = 0; i < n;) {
    if (!over[i]) { i++; continue }
    let j = i
    let deck = -Infinity
    while (j < n && over[j]) {
      deck = Math.max(deck, riverLevel(points[j]![0], points[j]![1]), g[j]!)
      j++
    }
    deck += DECK_CLEARANCE
    const s0 = s[i]!
    const s1 = s[j - 1]!
    for (let k = 0; k < n; k++) {
      const dist = s[k]! < s0 ? s0 - s[k]! : s[k]! > s1 ? s[k]! - s1 : 0
      const lift = deck - dist * RAMP_SLOPE
      if (lift > h[k]!) h[k] = lift
    }
    i = j
  }
  return { points, height: h.map((v) => v + ROAD_LIFT), ground: g, overWater: over }
}

/**
 * 車道延伸到資料範圍外：沿最後一段的方向直直拉 `reach` 公尺。高速公路本來
 * 就直，出了地圖在霧裡只要它繼續。
 */
export function extendStraight(
  line: readonly (readonly [number, number])[], reach: number,
): [number, number][] {
  const out: [number, number][] = line.map((p) => [p[0], p[1]])
  const grow = (a: readonly [number, number], b: readonly [number, number]): [number, number] => {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1
    return [b[0] + ((b[0] - a[0]) / len) * reach, b[1] + ((b[1] - a[1]) / len) * reach]
  }
  const n = line.length
  out.unshift(grow(line[1]!, line[0]!))
  out.push(grow(line[n - 2]!, line[n - 1]!))
  return out
}
