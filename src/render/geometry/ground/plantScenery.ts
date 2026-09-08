import type { BufferGeometry } from 'three'
import { assemble, box } from './parts'
import {
  FLAK_SITES, PLANT_BLOCKS, PLANT_CENTER, PLANT_LANES, PLANT_PAD, PLANT_SCENERY, ROADS,
} from '../../../world/leuna'
import { fillBlock, keepouts } from './plantFill'
import { pipeBridge } from './plantParts'

/**
 * # 洛伊納廠區的佈景
 *
 * 二十四個街廓各自的填充器、跨街廓的管廊骨幹、圍牆、砲位的沙包、沿路的
 * 電線桿 —— **一顆合併網格、一個 draw call、沒有命中盒**。子彈與炸彈穿過去
 * 落到地面；可炸的只有 `PLANT_LAYOUT` 那十二座構件（它們是地面目標，
 * 各自一顆 Mesh）。
 *
 * 【這一支只負責組裝】鋪什麼在 `plantFill.ts`、用什麼堆在 `plantParts.ts`、
 * 擺在哪在 `world/leuna.ts`。
 *
 * 【避讓表算一次】`keepouts()` 走十二座構件、八台卡車與每一條道路；二十四
 * 個街廓共用同一份。每個街廓重算是二十四倍的白工，而它跑在地形組裝上。
 *
 * 【三角形預算】整顆網格 40 萬個三角形以內，而且不得低於 15 萬 ——
 * `plant-scenery.test.ts` 兩頭都守著。俯視覆蓋率也在那裡。
 */

const WALL_HUE = 0x9a9488
const SANDBAG_HUE = 0x8a7a58
const POLE_HUE = 0x5a4a38

export function buildPlantScenery(): BufferGeometry {
  const parts: BufferGeometry[] = []
  const cx = PLANT_CENTER.x
  const cz = PLANT_CENTER.z
  const blocked = keepouts()

  // ── 街廓 ──────────────────────────────────────────────
  for (const b of PLANT_BLOCKS) parts.push(...fillBlock(b, blocked))

  // ── 管廊骨幹：沿巷道貫穿整個廠區，把各街廓串起來 ────────
  {
    const hx = PLANT_PAD.halfX
    const hz = PLANT_PAD.halfZ
    let n = 0
    for (const dx of PLANT_LANES.x) {
      const x = cx + dx
      parts.push(...pipeBridge(x, cz - hz + 20, x, cz + hz - 20, 7 + (n % 3), 4, 900 + n++))
    }
    for (const dz of PLANT_LANES.z) {
      const z = cz + dz
      parts.push(...pipeBridge(cx - hx + 20, z, cx + hx - 20, z, 9 + (n % 2), 5, 900 + n++))
    }
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
          ry: (-a * 180) / Math.PI,
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
