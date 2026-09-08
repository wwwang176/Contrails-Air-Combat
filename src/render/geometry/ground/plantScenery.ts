import type { BufferGeometry } from 'three'
import { assemble, box } from './parts'
import {
  FLAK_SITES, PLANT_BLOCKS, PLANT_CENTER, PLANT_LANES, PLANT_PAD, PLANT_SCENERY, ROADS,
} from '../../../world/leuna'
import { fillBlock, keepouts, spans } from './plantFill'
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

  // ── 管廊骨幹：沿巷道蜿蜒，把各街廓串起來 ────────────────
  //
  // 【不是貫穿全廠的十字】每條巷道各拉一條直的主幹，從投彈高度看下去是一張
  // 規則的網 —— 而那正是「這是程式鋪出來的」最明顯的破綻。改成幾條會轉彎、
  // 長度不一的主幹：它們仍沿著巷道走（管廊不會從廠房上面壓過去），但轉折點
  // 與起訖由種子決定。
  {
    const xs = [cx - PLANT_PAD.halfX + 30, ...PLANT_LANES.x.map((d) => cx + d),
      cx + PLANT_PAD.halfX - 30]
    const zs = [cz - PLANT_PAD.halfZ + 30, ...PLANT_LANES.z.map((d) => cz + d),
      cz + PLANT_PAD.halfZ - 30]
    let s = 0x51ed2701
    const roll = (): number => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0
      return s / 4294967296
    }
    const trunks = 5
    for (let t = 0; t < trunks; t++) {
      // 起點：邊界上的一個節點，交替從縱橫兩側出發
      let i = t % 2 === 0 ? 0 : Math.floor(roll() * xs.length)
      let j = t % 2 === 0 ? Math.floor(roll() * zs.length) : 0
      let horizontal = t % 2 === 0
      const height = 6 + roll() * 6
      const pipes = 3 + Math.floor(roll() * 3)
      const legs = 3 + Math.floor(roll() * 4)
      for (let k = 0; k < legs; k++) {
        const ni = horizontal ? Math.min(xs.length - 1, i + 1 + Math.floor(roll() * 2)) : i
        const nj = horizontal ? j : Math.min(zs.length - 1, j + 1 + Math.floor(roll() * 2))
        if (ni === i && nj === j) break
        for (const sp of spans(xs[i]!, zs[j]!, xs[ni]!, zs[nj]!, pipes, blocked)) {
          parts.push(...pipeBridge(sp.ax, sp.az, sp.bx, sp.bz, height, pipes, 900 + t * 10 + k))
        }
        i = ni
        j = nj
        // 【轉彎才有蜿蜒】一路直走就退回原本那條貫穿線
        if (roll() < 0.62) horizontal = !horizontal
      }
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
