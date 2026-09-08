import { Vector3 } from 'three'
import { createHeightField, type HeightFieldData } from './heightfield'
import {
  bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc, type LobeDraw,
} from './archipelago'
import { FARM_CELL, FARM_SIZE, HILL_PEAK_MAX } from './farmland'

/**
 * # 洛伊納：盟 M2 專用的地形
 *
 * 薩勒河平原：大片平地、零星的緩丘，西邊幾顆較高的是蓋澤爾谷的露天礦區
 * 土堆。用農地那一套多瓣起伏與高度場（`makeLobes` / `bakeRelief`），但
 * **丘陵全部手擺，不撒隨機** —— 出生線、廠區、砲位、脫離方向的空間關係
 * 是關卡設計的一部分，程序化撒的丘陵沒有人在乎廠區落在哪。
 *
 * 【整張圖的佈局都在這個檔案】卡片（`battle/missions.ts`）引用這裡的常數，
 * 不自己寫座標。廠區、砲位、丘陵三者的關係一眼看得到。
 *
 * 【農地的參數一改廠區不會埋進山裡】農地生成器同時被德 M4 與遭遇戰用；
 * 這張圖不共用它的丘陵清單，只共用生成的機制。
 */

/** 廠區中心。藍隊開局在 z ≈ +5,000 朝 −Z（`headOn`），投彈航路 12 km */
export const PLANT_CENTER = /* @__PURE__ */ new Vector3(0, 0, -7000)
export const PLANT_HEADING = 0

/** 墊面矩形的半邊長，m。墊面內保證高度為 0 */
export const PLANT_PAD = { halfX: 700, halfZ: 400 } as const

/**
 * 丘陵的膨脹圓離墊面矩形至少這麼遠，m。
 *
 * 【為什麼是距離不是壓平】`bakeRelief` 只掃膨脹圓內，圓外回到 `floor = 0`；
 * 圓離墊面有距離，墊面就在**結構上**是 0。壓平運算是多的，而且會遮掉
 * 「丘陵擺錯」這個錯 —— 護欄量的是這個距離，不是只量墊面內的高度。
 */
export const PAD_CLEARANCE = 400

/** 脫離方向：投完繼續往 −Z 飛，不回頭 —— 那是史實的脫離 */
export const EGRESS = /* @__PURE__ */ new Vector3(0, 0, -1)

/**
 * 手擺的丘陵。`outerRadius` 由生成器算 `radius × WOBBLE_MAX`，清單不寫 ——
 * `makeLobes` 信任呼叫端給的值，寫錯的話墊面保證就沒了而且不報錯。
 *
 * 【瓣由各自的種子抽】與群島的錨島同一個做法：改一顆不會動到別顆的形狀。
 */
export const LEUNA_HILLS = [
  // 西側：礦區土堆，較高
  { cx: -9000, cz: -8500, radius: 1200, peak: 110, pa: 0.4, pb: 2.9, seed: 101 },
  { cx: -11500, cz: -4500, radius: 1100, peak: 95, pa: 1.7, pb: 4.1, seed: 102 },
  { cx: -8500, cz: -1500, radius: 900, peak: 70, pa: 3.3, pb: 0.8, seed: 103 },
  // 平原上的緩丘
  { cx: 6000, cz: -10500, radius: 1000, peak: 60, pa: 2.2, pb: 5.0, seed: 104 },
  { cx: 9500, cz: -6000, radius: 1300, peak: 80, pa: 0.9, pb: 3.6, seed: 105 },
  { cx: 4500, cz: -2500, radius: 800, peak: 45, pa: 4.4, pb: 1.3, seed: 106 },
  { cx: -3500, cz: 3500, radius: 900, peak: 55, pa: 5.1, pb: 2.4, seed: 107 },
  { cx: 3000, cz: 8500, radius: 1100, peak: 65, pa: 1.1, pb: 4.8, seed: 108 },
  { cx: -7500, cz: 9000, radius: 1000, peak: 75, pa: 2.8, pb: 0.3, seed: 109 },
  { cx: 8500, cz: 3000, radius: 900, peak: 50, pa: 3.9, pb: 1.9, seed: 110 },
] as const

/**
 * 預定砲位。**這一版只是方塊**：不瞄、不射、不能被打。另一個 worktree
 * 的陸上 Flak 合進來時用同一份座標。環繞廠區 1.5 到 3 km。
 */
export const FLAK_SITES: readonly { x: number; z: number; heading: number }[] = [
  { x: -1800, z: -8600, heading: 0.6 },
  { x: 1800, z: -8600, heading: -0.6 },
  { x: -2400, z: -7000, heading: 1.5 },
  { x: 2400, z: -7000, heading: -1.5 },
  { x: -1800, z: -5400, heading: 2.5 },
  { x: 1800, z: -5400, heading: -2.5 },
  { x: 0, z: -9400, heading: 0 },
  { x: 0, z: -4600, heading: Math.PI },
]

/** 構件的種類。與 `groundTargets.ts` 的 `GroundKind` 相同的字面值 */
export type PlantKind =
  | 'hydroTower' | 'chimney' | 'boilerHouse' | 'oilTank' | 'gasHolder' | 'coolingTower'

/**
 * 12 座構件相對廠區中心的偏移與朝向。氫化塔成排、儲油槽成群、煙囪最高
 * （遠處先看到）。全部在墊面內，離墊面邊至少 40 m。
 */
export const PLANT_LAYOUT: readonly { kind: PlantKind; dx: number; dz: number; heading: number }[] = [
  { kind: 'hydroTower', dx: -300, dz: -120, heading: 0 },
  { kind: 'hydroTower', dx: -240, dz: -120, heading: 0 },
  { kind: 'hydroTower', dx: -180, dz: -120, heading: 0 },
  { kind: 'chimney', dx: -60, dz: -200, heading: 0 },
  { kind: 'chimney', dx: 60, dz: -200, heading: 0 },
  { kind: 'boilerHouse', dx: 0, dz: -60, heading: 0 },
  { kind: 'boilerHouse', dx: 220, dz: -60, heading: 0 },
  { kind: 'oilTank', dx: 380, dz: 160, heading: 0 },
  { kind: 'oilTank', dx: 460, dz: 160, heading: 0 },
  { kind: 'oilTank', dx: 420, dz: 240, heading: 0 },
  { kind: 'gasHolder', dx: -420, dz: 180, heading: 0 },
  { kind: 'coolingTower', dx: 120, dz: 220, heading: 0 },
]

/** 瓣的抽法與農地相同：固定 4 瓣，半徑比在 [0.30, 0.48] */
const HILL_LOBES = 4
const HILL_LOBE_RADIUS = [0.30, 0.48] as const

/** 種子進、序列出。**不得 `Math.random`** —— 與農地同一個理由 */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function drawLobes(rand: () => number): LobeDraw[] {
  const out: LobeDraw[] = []
  for (let k = 0; k < HILL_LOBES; k++) {
    out.push({
      dir: rand() * Math.PI * 2,
      rf: HILL_LOBE_RADIUS[0] + rand() * (HILL_LOBE_RADIUS[1] - HILL_LOBE_RADIUS[0]),
      uOff: rand(),
      uPeak: rand(),
      pa: rand() * Math.PI * 2,
      pb: rand() * Math.PI * 2,
    })
  }
  return out
}

export function createLeuna(): { field: HeightFieldData; hills: IslandDesc[] } {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []
  for (const h of LEUNA_HILLS) {
    const outerRadius = h.radius * WOBBLE_MAX
    const peak = Math.min(HILL_PEAK_MAX, h.peak)
    hills.push({
      cx: h.cx, cz: h.cz, radius: h.radius, outerRadius, peak,
      lobes: makeLobes(h.cx, h.cz, h.radius, outerRadius, peak, h.pa, h.pb, drawLobes(makeRand(h.seed))),
    })
  }
  // 基準面是 0：內陸沒有海
  bakeRelief(field, hills, 0)
  return { field, hills }
}
