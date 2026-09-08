import type { BufferGeometry } from 'three'
import { assemble, box, cyl, HUE } from './parts'
import {
  FLAK_SITES, PLANT_CENTER, PLANT_PAD, PLANT_SCENERY, ROADS,
} from '../../../world/leuna'

/**
 * # 洛伊納廠區的佈景
 *
 * 管架、鋼骨塔與樓梯、棚屋、圍牆、沙包、電線桿 —— **一顆合併網格、一個
 * draw call、沒有命中盒**。子彈與炸彈穿過去落到地面；可炸的只有
 * `PLANT_LAYOUT` 那十二座構件（它們是地面目標，各自一顆 Mesh）。
 *
 * 【圓管是三角柱】`cyl(…, seg = 3)`。一根管子從遠處看只是一條線，三個面
 * 與十二個面在畫面上分不出來，而管子是廠區裡數量最多的東西。
 *
 * 【資料在 `world/leuna.ts`】這裡只把資料變成幾何。擺法改了不必動這裡。
 *
 * 【三角形預算】整顆網格 15 萬個三角形以內 —— `plant-scenery.test.ts` 守著。
 */

const PIPE_HUE = 0x7a7d78
const FRAME_HUE = HUE.steelDark
const SHED_WALL = 0x8c7b66
const SHED_ROOF = 0x4a4d4a
const WALL_HUE = 0x9a9488
const SANDBAG_HUE = 0x8a7a58
const POLE_HUE = 0x5a4a38

/** 管架的門型鋼架間距，m */
const RACK_BAY = 12
/** 管子的直徑，m。並排時大小交錯 */
const PIPE_DIAMETERS = [1.2, 0.8, 1.0, 0.6, 0.9] as const

export function buildPlantScenery(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const cx = PLANT_CENTER.x
  const cz = PLANT_CENTER.z

  // ── 管架 ──────────────────────────────────────────────
  for (const rack of PLANT_SCENERY.pipeRacks) {
    const pts = rack.points
    for (let s = 0; s + 1 < pts.length; s++) {
      const a = pts[s]!
      const b = pts[s + 1]!
      const dx = b.dx - a.dx
      const dz = b.dz - a.dz
      const len = Math.hypot(dx, dz)
      const ry = Math.atan2(dx, dz) * 180 / Math.PI
      const mx = cx + (a.dx + b.dx) / 2
      const mz = cz + (a.dz + b.dz) / 2
      const width = rack.pipes * 1.4 + 1
      // 門型鋼架：兩根柱一根橫樑
      const bays = Math.max(1, Math.floor(len / RACK_BAY))
      for (let k = 0; k <= bays; k++) {
        const t = bays === 0 ? 0.5 : k / bays
        const px = cx + a.dx + dx * t
        const pz = cz + a.dz + dz * t
        const side = Math.cos(ry * Math.PI / 180)
        const fwd = Math.sin(ry * Math.PI / 180)
        const ox = width / 2 * side
        const oz = -width / 2 * fwd
        parts.push(box(0.4, rack.height, 0.4, FRAME_HUE, { x: px + ox, y: rack.height / 2, z: pz + oz }))
        parts.push(box(0.4, rack.height, 0.4, FRAME_HUE, { x: px - ox, y: rack.height / 2, z: pz - oz }))
        parts.push(box(width + 0.6, 0.4, 0.4, FRAME_HUE, { x: px, y: rack.height - 0.2, z: pz, ry }))
      }
      // 管子：並排在樑上，一段一根三角柱
      for (let p = 0; p < rack.pipes; p++) {
        const d = PIPE_DIAMETERS[p % PIPE_DIAMETERS.length]!
        const off = (p - (rack.pipes - 1) / 2) * 1.4
        const side = Math.cos(ry * Math.PI / 180)
        const fwd = Math.sin(ry * Math.PI / 180)
        parts.push(cyl(d / 2, len, PIPE_HUE, {
          x: mx + off * side, y: rack.height + d / 2, z: mz - off * fwd, rx: 90, ry,
        }, 3))
      }
    }
  }

  // ── 鋼骨塔與樓梯 ────────────────────────────────────────
  for (const t of PLANT_SCENERY.steelTowers) {
    const x = cx + t.dx
    const z = cz + t.dz
    const h = t.size / 2
    const floorH = 5
    const top = t.floors * floorH
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        parts.push(box(0.6, top, 0.6, FRAME_HUE, { x: x + sx * h, y: top / 2, z: z + sz * h }))
      }
    }
    for (let f = 1; f <= t.floors; f++) {
      const y = f * floorH
      // 每層一片平台（薄盒）與一圈欄杆
      parts.push(box(t.size, 0.3, t.size, FRAME_HUE, { x, y, z }))
      parts.push(box(t.size, 1.0, 0.15, FRAME_HUE, { x, y: y + 0.65, z: z - h }))
      parts.push(box(t.size, 1.0, 0.15, FRAME_HUE, { x, y: y + 0.65, z: z + h }))
      parts.push(box(0.15, 1.0, t.size, FRAME_HUE, { x: x - h, y: y + 0.65, z }))
      // 樓梯：一片斜板，層與層之間交錯方向。抬 0.3 m：斜板的下角不得穿到
      // 地面下（護欄量整顆網格的最低點）
      const dir = f % 2 === 0 ? 1 : -1
      parts.push(box(1.2, 0.2, floorH * 1.4, FRAME_HUE, {
        x: x + dir * (h - 1), y: y - floorH / 2 + 0.3, z, rx: dir * 45,
      }))
    }
    // 頂上一根細管
    parts.push(cyl(0.8, top * 0.4, PIPE_HUE, { x: x + h * 0.4, y: top + top * 0.2, z: z + h * 0.4 }, 3))
  }

  // ── 棚屋 ──────────────────────────────────────────────
  for (const s of PLANT_SCENERY.sheds) {
    const x = cx + s.dx
    const z = cz + s.dz
    parts.push(box(8, 3.6, 6, SHED_WALL, { x, y: 1.8, z }))
    parts.push(box(8.6, 0.4, 6.6, SHED_ROOF, { x, y: 3.8, z }))
  }

  // ── 圍牆 ──────────────────────────────────────────────
  {
    const { height, segment, gate } = PLANT_SCENERY.wall
    const hx = PLANT_PAD.halfX
    const hz = PLANT_PAD.halfZ
    // 門口：連外道路穿過墊面邊的地方
    const gates: { x: number; z: number }[] = []
    for (const road of ROADS) {
      for (const p of road) {
        const onEdge = Math.abs(Math.abs(p.x - cx) - hx) < 1 || Math.abs(Math.abs(p.z - cz) - hz) < 1
        if (onEdge) gates.push({ x: p.x, z: p.z })
      }
    }
    const nearGate = (x: number, z: number): boolean =>
      gates.some((g) => Math.hypot(g.x - x, g.z - z) < gate)
    // 南北兩道（沿 X）
    for (const sz of [-1, 1]) {
      const z = cz + sz * hz
      for (let x = cx - hx + segment / 2; x < cx + hx; x += segment) {
        if (nearGate(x, z)) continue
        parts.push(box(segment - 0.5, height, 0.4, WALL_HUE, { x, y: height / 2, z }))
      }
    }
    // 東西兩道（沿 Z）
    for (const sx of [-1, 1]) {
      const x = cx + sx * hx
      for (let z = cz - hz + segment / 2; z < cz + hz; z += segment) {
        if (nearGate(x, z)) continue
        parts.push(box(0.4, height, segment - 0.5, WALL_HUE, { x, y: height / 2, z }))
      }
    }
  }

  // ── 沙包 ──────────────────────────────────────────────
  {
    const { radius, count } = PLANT_SCENERY.sandbags
    for (const site of FLAK_SITES) {
      for (let k = 0; k < count; k++) {
        const a = (k / count) * Math.PI * 2
        parts.push(box(1.0, 0.6, 0.5, SANDBAG_HUE, {
          x: site.x + Math.cos(a) * radius, y: 0.3, z: site.z + Math.sin(a) * radius,
          ry: -a * 180 / Math.PI,
        }))
      }
    }
  }

  // ── 電線桿 ────────────────────────────────────────────
  {
    const { spacing, height } = PLANT_SCENERY.poles
    for (const road of ROADS) {
      // 只沿連外的道路；廠內的短路不放
      let total = 0
      for (let s = 0; s + 1 < road.length; s++) {
        total += Math.hypot(road[s + 1]!.x - road[s]!.x, road[s + 1]!.z - road[s]!.z)
      }
      if (total < 4000) continue
      for (let s = 0; s + 1 < road.length; s++) {
        const a = road[s]!
        const b = road[s + 1]!
        const len = Math.hypot(b.x - a.x, b.z - a.z)
        const n = Math.floor(len / spacing)
        // 桿子立在路肩：路的右側 8 m
        const nx = (b.z - a.z) / len
        const nz = -(b.x - a.x) / len
        for (let k = 0; k < n; k++) {
          const t = (k + 0.5) / n
          parts.push(box(0.3, height, 0.3, POLE_HUE, {
            x: a.x + (b.x - a.x) * t + nx * 8, y: height / 2, z: a.z + (b.z - a.z) * t + nz * 8,
          }))
        }
      }
    }
  }

  return assemble(parts)
}
