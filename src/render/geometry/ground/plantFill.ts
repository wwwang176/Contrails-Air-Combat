import type { BufferGeometry } from 'three'
import {
  PLANT_CENTER, ROAD_WIDTH, ROADS, TRUCKS, PLANT_LAYOUT, type PlantBlock,
} from '../../../world/leuna'
import { box } from './parts'
import { PLANT_SIZE } from './plant'
import {
  bundRun, fanStack, grime, horizTank, pipeBridge, railCar, railTrack, sawtoothHall,
  sphereTank, trussTower, uprightTank,
} from './plantParts'

/**
 * # 街廓填充器
 *
 * 一個街廓進、一批零件出。街廓的機能決定鋪什麼，街廓的種子決定怎麼排 ——
 * 同一個街廓每次鋪出來都一樣。
 *
 * 【為什麼是格線不是撒點】工廠是人蓋的：槽成排、廠房成列、軌道平行、管廊
 * 直線跨過整個街廓。泊松盤撒出來的是森林，不是工廠。
 *
 * 【避讓是硬約束】可炸構件、卡車與道路上不能有佈景 —— 佈景沒有命中盒，
 * 疊上去會看到炸彈穿過管架在構件上爆，畫面上像是命中判定壞了。
 *
 * 【街廓邊要留巷】每一支都先把街廓內縮 `INSET`，鋪出來的東西才不會貼著
 * 巷道的邊，俯視也才看得出街廓的格線。
 */

/** 街廓四周留的巷，m */
const INSET = 8

/** 種子進、序列出。**不得 `Math.random`** —— 每次建出來要一樣 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export interface Keepout {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
}

/**
 * 不能擺佈景的矩形：可炸構件的腳印加 6 m、卡車加 7 m、道路的半寬加 2 m。
 *
 * 【呼叫端算一次傳進來】`fillBlock` 每次重算就是二十四倍的白工，而它跑在
 * 建構期的地形組裝上，玩家看得到那段延遲。
 */
export function keepouts(): Keepout[] {
  const out: Keepout[] = []
  for (const t of PLANT_LAYOUT) {
    const s = PLANT_SIZE[t.kind]
    out.push({
      x0: PLANT_CENTER.x + t.dx - s.x / 2 - 6,
      x1: PLANT_CENTER.x + t.dx + s.x / 2 + 6,
      z0: PLANT_CENTER.z + t.dz - s.z / 2 - 6,
      z1: PLANT_CENTER.z + t.dz + s.z / 2 + 6,
    })
  }
  for (const t of TRUCKS) {
    out.push({ x0: t.x - 7, x1: t.x + 7, z0: t.z - 7, z1: t.z + 7 })
  }
  const pad = ROAD_WIDTH / 2 + 2
  for (const road of ROADS) {
    for (let s = 0; s + 1 < road.length; s++) {
      const a = road[s]!
      const b = road[s + 1]!
      out.push({
        x0: Math.min(a.x, b.x) - pad, x1: Math.max(a.x, b.x) + pad,
        z0: Math.min(a.z, b.z) - pad, z1: Math.max(a.z, b.z) + pad,
      })
    }
  }
  return out
}

/**
 * 以 (x, z) 為中心、半寬 `hw` × 半深 `hd` 的位子有沒有被佔。
 *
 * 【要傳零件的實際半尺寸】隨手給一個小一點的半徑，長廠房會有一半伸進
 * 構件的腳印裡 —— 而那一頭在畫面上被廠房自己擋住，只有炸彈落下來才看得見。
 */
function freeRect(
  x: number, z: number, hw: number, hd: number, blocked: readonly Keepout[],
): boolean {
  for (const k of blocked) {
    if (x + hw > k.x0 && x - hw < k.x1 && z + hd > k.z0 && z - hd < k.z1) return false
  }
  return true
}

/** 圓形腳印的簡寫 */
function free(x: number, z: number, r: number, blocked: readonly Keepout[]): boolean {
  return freeRect(x, z, r, r, blocked)
}

/**
 * 一條線段扣掉被佔的部分之後剩下的子段。管廊與軌道橫跨整個街廓，遇到
 * 卡車或構件不能整條放棄 —— 那會在畫面上開一個沒有理由的大洞。
 *
 * 太短的子段丟掉：兩公尺的管廊看起來是漂浮的垃圾。
 */
function spans(
  ax: number, az: number, bx: number, bz: number, r: number, blocked: readonly Keepout[],
): { readonly ax: number; readonly az: number; readonly bx: number; readonly bz: number }[] {
  const out: { ax: number; az: number; bx: number; bz: number }[] = []
  const len = Math.hypot(bx - ax, bz - az)
  const steps = Math.max(2, Math.ceil(len / 5))
  let start = -1
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = ax + (bx - ax) * t
    const z = az + (bz - az) * t
    const ok = free(x, z, r, blocked)
    if (ok && start < 0) start = t
    if ((!ok || i === steps) && start >= 0) {
      const end = ok ? t : (i - 1) / steps
      if ((end - start) * len >= 24) {
        out.push({
          ax: ax + (bx - ax) * start, az: az + (bz - az) * start,
          bx: ax + (bx - ax) * end, bz: az + (bz - az) * end,
        })
      }
      start = -1
    }
  }
  return out
}

/** 街廓內縮之後的可用矩形 */
function inner(b: PlantBlock): { x0: number; z0: number; x1: number; z1: number; w: number; d: number } {
  const x0 = b.x0 + INSET
  const x1 = b.x1 - INSET
  const z0 = b.z0 + INSET
  const z1 = b.z1 - INSET
  return { x0, z0, x1, z1, w: x1 - x0, d: z1 - z0 }
}

/**
 * 儲槽區：一圈環形土堤圍住整個街廓，裡面是成排的立式槽，排與排之間一條
 * 低矮的管廊。
 */
function fillTankFarm(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  const rand = makeRand(b.seed)
  // 環形土堤：四邊各自切段，遇到禁區就斷開留成出入口
  const bx0 = a.x0 + 4
  const bx1 = a.x1 - 4
  const bz0 = a.z0 + 4
  const bz1 = a.z1 - 4
  for (const [ax, az, bx, bz] of [
    [bx0, bz0, bx1, bz0], [bx0, bz1, bx1, bz1],
    [bx0, bz0, bx0, bz1], [bx1, bz0, bx1, bz1],
  ] as const) {
    for (const s of spans(ax, az, bx, bz, 2, blocked)) {
      out.push(...bundRun(s.ax, s.az, s.bx, s.bz, 3.5))
    }
  }
  const RADII = [10, 13, 16] as const
  const r = RADII[Math.floor(rand() * RADII.length)]!
  const pitch = r * 2.4
  const nx = Math.max(1, Math.floor((a.w - 20) / pitch))
  const nz = Math.max(1, Math.floor((a.d - 20) / pitch))
  const ox = a.x0 + 10 + (a.w - 20 - nx * pitch) / 2 + pitch / 2
  const oz = a.z0 + 10 + (a.d - 20 - nz * pitch) / 2 + pitch / 2
  let n = 0
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const x = ox + i * pitch
      const z = oz + j * pitch
      if (!free(x, z, r + 2, blocked)) continue
      // 高度分三級：整片一樣高的話俯視是一張規則的圓點紙
      const h = 10 + (i + j) % 3 * 4
      out.push(...uprightTank(x, z, r, h, b.seed * 31 + n++))
    }
    // 排間的管廊
    if (j + 1 < nz) {
      const z = oz + (j + 0.5) * pitch
      for (const s of spans(a.x0 + 2, z, a.x1 - 2, z, 4, blocked)) {
        out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, 4.5, 3, b.seed * 31 + n++))
      }
    }
  }
  return out
}

/**
 * 氫化製程區：橫貫街廓的管廊層層平行，中間插桁架塔與成排的細高塔柱。
 * 整片廠區最高的東西在這裡。
 */
function fillProcess(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  const rand = makeRand(b.seed)
  let n = 0
  // 管廊：沿長軸橫貫，六條平行
  const lanes = 6
  for (let k = 0; k < lanes; k++) {
    const z = a.z0 + (a.d * (k + 0.5)) / lanes
    const height = 6 + (k % 3) * 1.5
    const pipes = 3 + (k % 3)
    for (const s of spans(a.x0, z, a.x1, z, pipes, blocked)) {
      out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, height, pipes, b.seed * 31 + n++))
    }
  }
  // 桁架塔：三座，沿長軸等分
  for (let k = 0; k < 3; k++) {
    const size = 18 + Math.floor(rand() * 3) * 3
    const x = a.x0 + (a.w * (k + 0.5)) / 3
    const z = a.z0 + a.d * 0.28
    if (!free(x, z, size, blocked)) continue
    out.push(...trussTower(x, z, size, 4 + Math.floor(rand() * 3), b.seed * 31 + n++))
  }
  // 塔柱：兩帶成排，間距 9 m
  for (const band of [0.55, 0.82]) {
    const z = a.z0 + a.d * band
    for (let x = a.x0 + 6; x < a.x1 - 6; x += 9) {
      if (!free(x, z, 5, blocked)) continue
      const r = 3.5 + (n % 3) * 0.6
      out.push(...uprightTank(x, z, r, 20 + (n % 4) * 4, b.seed * 31 + n++))
    }
  }
  // 空隙的臥式槽與風扇筒
  for (let k = 0; k < 6; k++) {
    const x = a.x0 + a.w * (0.1 + 0.16 * k)
    const z = a.z0 + a.d * 0.42
    if (k % 2 === 0) {
      if (!freeRect(x, z, 11.5, 4.5, blocked)) continue
      out.push(...horizTank(x, z, 3.5, 22, 90, b.seed * 31 + n++))
    } else {
      if (!free(x, z, 6, blocked)) continue
      out.push(...fanStack(x, z, 5, 9, b.seed * 31 + n++))
    }
  }
  return out
}

/**
 * 廠房區：長條的鋸齒天窗屋頂成列。**鋸齒是俯視最好認的東西** —— 空拍照
 * 上的廠房區就是一排排斜脊。
 */
function fillHalls(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  const rand = makeRand(b.seed)
  let n = 0
  const rows = 3
  const gap = 14
  const d = (a.d - gap * (rows - 1)) / rows
  for (let k = 0; k < rows; k++) {
    const z = a.z0 + d / 2 + k * (d + gap)
    const w = a.w * (0.82 + rand() * 0.16)
    const x = (a.x0 + a.x1) / 2
    if (!freeRect(x, z, w / 2, d * 0.46, blocked)) {
      // 被佔就退成兩棟短的，不要整列消失
      const hw = a.w / 4 - 4
      for (const half of [-1, 1]) {
        const hx = x + half * (a.w / 4)
        if (!freeRect(hx, z, hw, d * 0.45, blocked)) continue
        out.push(...sawtoothHall(hx, z, hw * 2, d * 0.9, 9, 4, 0, b.seed * 31 + n++))
      }
      continue
    }
    const h = 8 + Math.floor(rand() * 4)
    const teeth = 4 + Math.floor(rand() * 3)
    out.push(...sawtoothHall(x, z, w, d * 0.92, h, teeth, 0, b.seed * 31 + n++))
  }
  // 屋頂之間的高管廊
  const z = a.z0 + d + gap / 2
  for (const s of spans(a.x0, z, a.x1, z, 4, blocked)) {
    out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, 13, 3, b.seed * 31 + n++))
  }
  return out
}

/** 調車場：平行的股道、停著的車廂、一端的卸料棚 */
function fillRailyard(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  let n = 0
  const tracks = 5
  const pitch = 9
  const z0 = a.z0 + (a.d - pitch * (tracks - 1)) / 2
  for (let k = 0; k < tracks; k++) {
    const z = z0 + k * pitch
    for (const s of spans(a.x0, z, a.x1, z, 3, blocked)) {
      out.push(...railTrack(s.ax, s.az, s.bx, s.bz))
      // 車廂：一節 12 m，間距 16 m，從子段的起點排
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
      const cars = Math.floor(len / 16)
      for (let c = 0; c < cars; c++) {
        const t = (c + 0.5) / cars
        const x = s.ax + (s.bx - s.ax) * t
        const cz = s.az + (s.bz - s.az) * t
        if (!free(x, cz, 8, blocked)) continue
        out.push(...railCar(x, cz, 90, (c + k) % 2 === 0, b.seed * 31 + n++))
      }
    }
  }
  // 卸料棚：股道的一端一棟，另一端一棟
  for (const band of [0.14, 0.88]) {
    const hx = a.x0 + a.w * band
    const hz = a.z0 + a.d * 0.13
    const hw = a.w * 0.11
    const hd = a.d * 0.1
    if (!freeRect(hx, hz, hw, hd, blocked)) continue
    out.push(...sawtoothHall(hx, hz, hw * 2, hd * 2, 8, 3, 0, b.seed * 31 + n++))
  }
  // 站台：股道南側一條長月台
  const pz = a.z0 + a.d * 0.88
  for (const s of spans(a.x0, pz, a.x1, pz, 6, blocked)) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
    out.push(box(len, 1.2, 10, 0x7d7a72, { x: (s.ax + s.bx) / 2, y: 0.6, z: (s.az + s.bz) / 2 }))
  }
  return out
}

/** 動力雜項：鍋爐房、風扇筒成排、球罐、變電站的框架、堆煤 */
function fillUtility(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  let n = 0
  // 鍋爐房與副廠房：南北各一棟長條
  for (const [band, frac, teeth] of [[0.14, 0.24, 5], [0.9, 0.16, 4]] as const) {
    const hx = (a.x0 + a.x1) / 2
    const hz = a.z0 + a.d * band
    const hw = a.w * 0.36
    const hd = a.d * frac * 0.5
    if (!freeRect(hx, hz, hw, hd, blocked)) continue
    out.push(...sawtoothHall(hx, hz, hw * 2, hd * 2, 12, teeth, 0, b.seed * 31 + n++))
  }
  // 風扇筒：兩排，間距 15 m
  for (const band of [0.36, 0.5]) {
    const fz = a.z0 + a.d * band
    for (let x = a.x0 + 12; x < a.x1 - 12; x += 15) {
      if (!free(x, fz, 6.5, blocked)) continue
      out.push(...fanStack(x, fz, 5.5, 7 + (n % 3) * 1.5, b.seed * 31 + n++))
    }
  }
  // 球罐：一排
  for (let k = 0; k < 4; k++) {
    const x = a.x0 + a.w * (0.15 + 0.23 * k)
    const z = a.z0 + a.d * 0.64
    const r = 8 + (k % 2) * 2
    if (!free(x, z, r + 1, blocked)) continue
    out.push(...sphereTank(x, z, r, b.seed * 31 + n++))
  }
  // 變電站：柱陣列加橫樑
  const sx = a.x0 + a.w * 0.74
  const sz = a.z0 + a.d * 0.78
  if (freeRect(sx, sz, 18, 12, blocked)) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const x = sx - 15 + i * 6
        const z = sz - 6 + j * 6
        out.push(box(0.6, 9, 0.6, 0x33383d, { x, y: 4.5, z }))
        if (j === 0) out.push(box(0.5, 0.5, 12, 0x33383d, { x, y: 8.6, z: z + 6 }))
      }
    }
  }
  // 堆煤：壓扁的長方體
  for (let k = 0; k < 2; k++) {
    const x = a.x0 + a.w * (0.14 + 0.24 * k)
    const z = a.z0 + a.d * 0.78
    if (!freeRect(x, z, a.w * 0.1, 11, blocked)) continue
    out.push(box(a.w * 0.2, 4, 22, 0x2b2723, { x, y: 2, z }))
  }
  // 管廊：四條橫貫
  for (const band of [0.26, 0.44, 0.58, 0.72]) {
    const z = a.z0 + a.d * band
    for (const s of spans(a.x0, z, a.x1, z, 4, blocked)) {
      out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, 7 + band * 4, 3, b.seed * 31 + n++))
    }
  }
  return out
}

/**
 * 留白：堆料場與零星的小屋。**這是刻意的空**，不是還沒做完 —— 沒有空地
 * 就看不出密的地方有多密。
 */
function fillOpen(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  let n = 0
  for (let k = 0; k < 3; k++) {
    const x = a.x0 + a.w * (0.18 + 0.3 * k)
    const z = a.z0 + a.d * (k % 2 === 0 ? 0.3 : 0.7)
    if (!free(x, z, 16, blocked)) continue
    if (k === 1) out.push(box(14, 3.2, 9, grime(b.seed + k), { x, y: 1.6, z }))
    else out.push(...horizTank(x, z, 3, 16, k * 30, b.seed * 31 + n++))
  }
  return out
}

/** 一個街廓的佈景。`blocked` 由呼叫端算一次 */
export function fillBlock(block: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  switch (block.kind) {
    case 'tankFarm': return fillTankFarm(block, blocked)
    case 'process': return fillProcess(block, blocked)
    case 'halls': return fillHalls(block, blocked)
    case 'railyard': return fillRailyard(block, blocked)
    case 'utility': return fillUtility(block, blocked)
    case 'open': return fillOpen(block, blocked)
  }
}
