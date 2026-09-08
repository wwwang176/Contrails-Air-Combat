import type { BufferGeometry } from 'three'
import {
  PLANT_CENTER, PLANT_STACKS, ROAD_WIDTH, ROADS, TRUCKS, PLANT_LAYOUT, type PlantBlock,
} from '../../../world/leuna'
import { box } from './parts'
import { PLANT_SIZE } from './plant'
import {
  bundRun, fanStack, grime, horizTank, pipeBridge, railCar, railTrack, sawtoothHall, smokeStack,
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
export function spans(
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

/** 格點的決策雜湊。同一格每次問到的答案一樣 */
function cellHash(i: number, j: number, salt: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b) ^ Math.imul(salt | 0, 0x165667b1)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}

/**
 * 街廓的**主軸**。填充器全部照 (沿主軸 u、沿次軸 v) 擺，由這一層翻譯成
 * 世界座標。
 *
 * 【為什麼要有它】主軸寫死的話，六個製程區的管廊全部是同一個方向的平行
 * 線，四個儲槽區是同一張圓點紙 —— 從投彈高度看下去，一眼就認得出那是
 * 同一個模板蓋了幾次。主軸由種子抽，相鄰街廓的紋理才會轉向。
 */
interface Frame {
  /** 主軸長度，m */
  readonly along: number
  /** 次軸長度，m */
  readonly across: number
  /** 沿主軸 `u`、沿次軸 `v` 的世界座標 */
  at(u: number, v: number): { x: number; z: number }
  /**
   * 給**長軸沿 Z** 的零件（`horizTank`、`railCar`）對齊主軸用的 `ry`。
   */
  readonly ry: number
  /**
   * 給**寬沿 X** 的零件（`sawtoothHall`）用的 `ry`。
   *
   * 【兩個角不能共用一個】兩類零件未轉時的長軸差 90°，共用的話廠房會與
   * 管廊互相垂直 —— 而那在畫面上只像「這一區的廠房蓋歪了」。
   */
  readonly hallRy: number
}

function frameOf(a: ReturnType<typeof inner>, alongX: boolean): Frame {
  if (alongX) {
    return {
      along: a.w, across: a.d, ry: 90, hallRy: 0,
      at: (u, v) => ({ x: a.x0 + u, z: a.z0 + v }),
    }
  }
  return {
    along: a.d, across: a.w, ry: 0, hallRy: 90,
    at: (u, v) => ({ x: a.x0 + v, z: a.z0 + u }),
  }
}

/**
 * 儲槽區：一圈環形土堤圍住整個街廓，裡面是成排的立式槽，排與排之間一條
 * 低矮的管廊。
 */
function fillTankFarm(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  const rand = makeRand(b.seed)
  const f = frameOf(a, rand() < 0.5)
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
      out.push(...bundRun(s.ax, s.az, s.bx, s.bz, 3 + rand()))
    }
  }
  // 【同一區混兩級槽】整片同一個尺寸的話，四個儲槽區從空中看是同一張紙
  const big = 10 + Math.floor(rand() * 4) * 1.8
  const small = big * (0.5 + rand() * 0.16)
  const pitch = big * (2.2 + rand() * 0.5)
  const nu = Math.max(1, Math.floor((f.along - 20) / pitch))
  const nv = Math.max(1, Math.floor((f.across - 20) / pitch))
  const ou = 10 + (f.along - 20 - nu * pitch) / 2 + pitch / 2
  const ov = 10 + (f.across - 20 - nv * pitch) / 2 + pitch / 2
  let n = 0
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const h = cellHash(i, j, b.seed)
      // 【留缺口】整齊的滿格陣列看起來是印出來的。空一成的格
      if ((h & 0xff) < 26) continue
      const r = (h >>> 8) % 3 === 0 ? small : big
      const jit = pitch * 0.07
      const p = f.at(
        ou + i * pitch + (((h >>> 12) & 0xff) / 255 - 0.5) * jit,
        ov + j * pitch + (((h >>> 20) & 0xff) / 255 - 0.5) * jit,
      )
      if (!free(p.x, p.z, r + 2, blocked)) continue
      out.push(...uprightTank(p.x, p.z, r, 9 + ((h >>> 4) & 0x3) * 4, b.seed * 31 + n++))
    }
    // 排間的管廊：不是每一排都有
    if (j + 1 < nv && (cellHash(j, 77, b.seed) & 1) === 0) {
      const v = ov + (j + 0.5) * pitch
      const p0 = f.at(2, v)
      const p1 = f.at(f.along - 2, v)
      for (const s of spans(p0.x, p0.z, p1.x, p1.z, 4, blocked)) {
        out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, 4 + rand() * 2, 3, b.seed * 31 + n++))
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
  const f = frameOf(a, rand() < 0.5)
  let n = 0
  // 管廊：沿主軸橫貫。條數與間距抽 —— 條數寫死的話每個製程區都是同一組
  // 平行線
  const lanes = 4 + Math.floor(rand() * 4)
  for (let k = 0; k < lanes; k++) {
    const v = f.across * ((k + 0.5) / lanes + (rand() - 0.5) * 0.07)
    const pipes = 3 + Math.floor(rand() * 3)
    const p0 = f.at(0, v)
    const p1 = f.at(f.along, v)
    for (const s of spans(p0.x, p0.z, p1.x, p1.z, pipes, blocked)) {
      out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, 5.5 + rand() * 5, pipes, b.seed * 31 + n++))
    }
  }
  // 桁架塔：兩到四座，沿主軸等分再抖
  const towers = 2 + Math.floor(rand() * 3)
  const towerV = f.across * (0.16 + rand() * 0.2)
  for (let k = 0; k < towers; k++) {
    const size = 16 + Math.floor(rand() * 5) * 2.5
    const p = f.at(f.along * ((k + 0.5) / towers + (rand() - 0.5) * 0.08), towerV)
    if (!free(p.x, p.z, size, blocked)) continue
    out.push(...trussTower(p.x, p.z, size, 3 + Math.floor(rand() * 4), b.seed * 31 + n++))
  }
  // 塔柱：一到兩帶成排，間距與缺席由格點的雜湊決定
  const bands = 1 + Math.floor(rand() * 2)
  const step = 8 + rand() * 5
  for (let t = 0; t < bands; t++) {
    const v = f.across * (0.52 + t * 0.28 + (rand() - 0.5) * 0.1)
    let i = 0
    for (let u = 6; u < f.along - 6; u += step) {
      const h = cellHash(i++, t, b.seed + 13)
      if ((h & 0xff) < 38) continue
      const p = f.at(u, v)
      const r = 3.2 + ((h >>> 8) & 0x3) * 0.7
      if (!free(p.x, p.z, r + 1.5, blocked)) continue
      out.push(...uprightTank(p.x, p.z, r, 18 + ((h >>> 10) & 0x7) * 3, b.seed * 31 + n++))
    }
  }
  // 空隙的臥式槽與風扇筒
  const fillers = 4 + Math.floor(rand() * 4)
  const fillV = f.across * (0.32 + rand() * 0.12)
  for (let k = 0; k < fillers; k++) {
    const p = f.at(f.along * ((k + 0.5) / fillers + (rand() - 0.5) * 0.06), fillV)
    if (k % 2 === 0) {
      const len = 16 + rand() * 12
      if (!freeRect(p.x, p.z, len / 2 + 1, 6, blocked)) continue
      out.push(...horizTank(p.x, p.z, 3 + rand(), len, f.ry, b.seed * 31 + n++))
    } else {
      if (!free(p.x, p.z, 6, blocked)) continue
      out.push(...fanStack(p.x, p.z, 4 + rand() * 2, 7 + rand() * 4, b.seed * 31 + n++))
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
  const alongX = rand() < 0.5
  const f = frameOf(a, alongX)
  let n = 0
  // 排數、每棟的長度與對齊都抽 —— 三棟等長置中的話，五個廠房區從空中看
  // 是同一個梳子
  const rows = 2 + Math.floor(rand() * 3)
  const gap = 12 + rand() * 8
  const span = (f.across - gap * (rows - 1)) / rows
  for (let k = 0; k < rows; k++) {
    const v = span / 2 + k * (span + gap)
    const len = f.along * (0.5 + rand() * 0.48)
    // 對齊：靠一端、置中、靠另一端
    const anchor = rand()
    const u = anchor < 0.34 ? len / 2 + 2
      : anchor < 0.67 ? f.along / 2
        : f.along - len / 2 - 2
    const p = f.at(u, v)
    const hw = alongX ? len / 2 : span * 0.46
    const hd = alongX ? span * 0.46 : len / 2
    const h = 7 + rand() * 7
    const teeth = 3 + Math.floor(rand() * 5)
    if (!freeRect(p.x, p.z, hw, hd, blocked)) {
      // 被佔就退成兩棟短的，不要整列消失
      const half = len * 0.4
      for (const side of [-1, 1]) {
        const q = f.at(u + side * len * 0.28, v)
        const qw = alongX ? half / 2 : span * 0.45
        const qd = alongX ? span * 0.45 : half / 2
        if (!freeRect(q.x, q.z, qw, qd, blocked)) continue
        out.push(...sawtoothHall(
          q.x, q.z, half, span * 0.9, h, Math.max(2, teeth - 1), f.hallRy, b.seed * 31 + n++,
        ))
      }
      continue
    }
    out.push(...sawtoothHall(p.x, p.z, len, span * 0.92, h, teeth, f.hallRy, b.seed * 31 + n++))
  }
  // 屋頂之間的高管廊
  const v = span + gap / 2
  const p0 = f.at(0, v)
  const p1 = f.at(f.along, v)
  for (const s of spans(p0.x, p0.z, p1.x, p1.z, 4, blocked)) {
    out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, 12 + rand() * 4, 3, b.seed * 31 + n++))
  }
  return out
}

/** 調車場：平行的股道、停著的車廂、一端的卸料棚 */
function fillRailyard(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  const rand = makeRand(b.seed)
  const alongX = rand() < 0.5
  const f = frameOf(a, alongX)
  let n = 0
  // 股數、間距與整束的位置都抽 —— 五股置中的話三個調車場是同一把梳子
  const tracks = 3 + Math.floor(rand() * 4)
  const pitch = 8 + rand() * 4
  const v0 = (f.across - pitch * (tracks - 1)) * (0.25 + rand() * 0.5)
  for (let k = 0; k < tracks; k++) {
    const v = v0 + k * pitch
    // 【股道不必等長】調車場的股道本來就是一頭岔出去、長度不一
    const u0 = f.along * rand() * 0.12
    const u1 = f.along * (1 - rand() * 0.18)
    const p0 = f.at(u0, v)
    const p1 = f.at(u1, v)
    for (const s of spans(p0.x, p0.z, p1.x, p1.z, 3, blocked)) {
      out.push(...railTrack(s.ax, s.az, s.bx, s.bz))
      const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
      const gap = 15 + rand() * 8
      const cars = Math.floor(len / gap)
      for (let c = 0; c < cars; c++) {
        const h = cellHash(c, k, b.seed + 5)
        // 空車位：整串排滿的話每一股都一樣長
        if ((h & 0xff) < 64) continue
        const t = (c + 0.5) / cars
        const x = s.ax + (s.bx - s.ax) * t
        const cz = s.az + (s.bz - s.az) * t
        if (!free(x, cz, 8, blocked)) continue
        out.push(...railCar(x, cz, f.ry, ((h >>> 8) & 1) === 0, b.seed * 31 + n++))
      }
    }
  }
  // 卸料棚：股道的一端一棟到兩棟
  const sheds = 1 + Math.floor(rand() * 2)
  for (let k = 0; k < sheds; k++) {
    const p = f.at(f.along * (0.1 + rand() * 0.8), f.across * (0.06 + rand() * 0.1))
    const hu = f.along * (0.08 + rand() * 0.06)
    const hv = f.across * 0.09
    const hw = alongX ? hu : hv
    const hd = alongX ? hv : hu
    if (!freeRect(p.x, p.z, hw, hd, blocked)) continue
    out.push(...sawtoothHall(p.x, p.z, hu * 2, hv * 2, 8, 3, f.hallRy, b.seed * 31 + n++))
  }
  // 站台：股道旁一條長月台
  const pv = f.across * (0.82 + rand() * 0.12)
  const q0 = f.at(0, pv)
  const q1 = f.at(f.along, pv)
  for (const s of spans(q0.x, q0.z, q1.x, q1.z, 6, blocked)) {
    const len = Math.hypot(s.bx - s.ax, s.bz - s.az)
    out.push(box(len, 1.2, 10, 0x7d7a72, {
      x: (s.ax + s.bx) / 2, y: 0.6, z: (s.az + s.bz) / 2, ry: f.hallRy,
    }))
  }
  return out
}

/** 動力雜項：鍋爐房、風扇筒成排、球罐、變電站的框架、堆煤 */
function fillUtility(b: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const out: BufferGeometry[] = []
  const a = inner(b)
  const rand = makeRand(b.seed)
  const alongX = rand() < 0.5
  const f = frameOf(a, alongX)
  let n = 0
  // 【元素的帶位置由種子重排】固定的上中下三層，六個動力區從空中看是
  // 同一張分層圖
  const lanes = [0.12 + rand() * 0.1, 0.34 + rand() * 0.12, 0.58 + rand() * 0.12,
    0.8 + rand() * 0.12]
  // 鍋爐房與副廠房
  for (const [k, teeth] of [[0, 5], [3, 4]] as const) {
    const len = f.along * (0.5 + rand() * 0.28)
    const p = f.at(f.along * (0.3 + rand() * 0.4), f.across * lanes[k]!)
    const hu = len / 2
    const hv = f.across * (0.07 + rand() * 0.04)
    if (!freeRect(p.x, p.z, alongX ? hu : hv, alongX ? hv : hu, blocked)) continue
    out.push(...sawtoothHall(p.x, p.z, hu * 2, hv * 2, 10 + rand() * 4, teeth, f.hallRy,
      b.seed * 31 + n++))
  }
  // 風扇筒：一到兩排，間距抽
  const fanRows = 1 + Math.floor(rand() * 2)
  const fanStep = 13 + rand() * 6
  for (let t = 0; t < fanRows; t++) {
    const v = f.across * (lanes[1]! + t * 0.1)
    let i = 0
    for (let u = 12; u < f.along - 12; u += fanStep) {
      const h = cellHash(i++, t, b.seed + 21)
      if ((h & 0xff) < 30) continue
      const p = f.at(u, v)
      if (!free(p.x, p.z, 6.5, blocked)) continue
      out.push(...fanStack(p.x, p.z, 4.5 + ((h >>> 8) & 0x3) * 0.6, 6 + ((h >>> 10) & 0x7),
        b.seed * 31 + n++))
    }
  }
  // 球罐：三到五顆
  const spheres = 3 + Math.floor(rand() * 3)
  for (let k = 0; k < spheres; k++) {
    const p = f.at(f.along * ((k + 0.5) / spheres + (rand() - 0.5) * 0.1), f.across * lanes[2]!)
    const r = 7 + rand() * 4
    if (!free(p.x, p.z, r + 1, blocked)) continue
    out.push(...sphereTank(p.x, p.z, r, b.seed * 31 + n++))
  }
  // 變電站：柱陣列加橫樑
  const su = f.along * (0.15 + rand() * 0.7)
  const sv = f.across * lanes[3]!
  const sp = f.at(su, sv)
  if (freeRect(sp.x, sp.z, 18, 18, blocked)) {
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < 3; j++) {
        const p = f.at(su - 15 + i * 6, sv - 6 + j * 6)
        out.push(box(0.6, 9, 0.6, 0x33383d, { x: p.x, y: 4.5, z: p.z }))
        if (j === 0) {
          const q = f.at(su - 15 + i * 6, sv)
          out.push(box(0.5, 0.5, 12, 0x33383d, { x: q.x, y: 8.6, z: q.z, ry: f.hallRy }))
        }
      }
    }
  }
  // 堆煤：一到兩堆
  const piles = 1 + Math.floor(rand() * 2)
  for (let k = 0; k < piles; k++) {
    const len = f.along * (0.14 + rand() * 0.1)
    const p = f.at(f.along * (0.12 + rand() * 0.7), f.across * lanes[3]!)
    const hu = len / 2
    const hv = 11
    if (!freeRect(p.x, p.z, alongX ? hu : hv, alongX ? hv : hu, blocked)) continue
    // 高度是抽的，所以中心也要跟著抽 —— 寫死的 y 會讓高一點的那幾堆陷地
    const ph = 3 + rand() * 2
    out.push(box(len, ph, 22, 0x2b2723, { x: p.x, y: ph / 2, z: p.z, ry: f.hallRy }))
  }
  // 管廊：三到五條橫貫
  const bridges = 3 + Math.floor(rand() * 3)
  for (let k = 0; k < bridges; k++) {
    const v = f.across * ((k + 0.5) / bridges + (rand() - 0.5) * 0.08)
    const p0 = f.at(0, v)
    const p1 = f.at(f.along, v)
    for (const s of spans(p0.x, p0.z, p1.x, p1.z, 4, blocked)) {
      out.push(...pipeBridge(s.ax, s.az, s.bx, s.bz, 6 + rand() * 5, 3, b.seed * 31 + n++))
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

/**
 * 落在這個街廓裡的佈景煙囪。**幾何與 `PLANT_STACKS` 是同一份座標** ——
 * 分家的話煙會從空中冒出來。
 */
function fillStacks(b: PlantBlock): BufferGeometry[] {
  const out: BufferGeometry[] = []
  let n = 0
  for (const s of PLANT_STACKS) {
    if (s.x < b.x0 || s.x >= b.x1 || s.z < b.z0 || s.z >= b.z1) continue
    out.push(...smokeStack(s.x, s.z, s.y, b.seed * 7 + n++))
  }
  return out
}

/** 一個街廓的佈景。`blocked` 由呼叫端算一次 */
export function fillBlock(block: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  const stacks = fillStacks(block)
  if (stacks.length > 0) return [...fillOne(block, blocked), ...stacks]
  return fillOne(block, blocked)
}

function fillOne(block: PlantBlock, blocked: readonly Keepout[]): BufferGeometry[] {
  switch (block.kind) {
    case 'tankFarm': return fillTankFarm(block, blocked)
    case 'process': return fillProcess(block, blocked)
    case 'halls': return fillHalls(block, blocked)
    case 'railyard': return fillRailyard(block, blocked)
    case 'utility': return fillUtility(block, blocked)
    case 'open': return fillOpen(block, blocked)
  }
}
