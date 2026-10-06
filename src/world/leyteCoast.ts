import { SEA_FLOOR } from './archipelago'

/** 高度場邊長頂點數。375 × 80 m = 30 km 見方，與農地同一個尺寸 */
export const LEYTE_SIZE = 376
/** 格距，m。平地與緩丘用 80 m 就夠；公路畫在 shader 裡，不吃格距 */
export const LEYTE_CELL = 80

/** 高度場的半邊長，m。場外由遠景陸地（`farHeight`）接上 */
export const FIELD_HALF = ((LEYTE_SIZE - 1) * LEYTE_CELL) / 2
/** 平地的高度，m */
export const PLAIN_HEIGHT = 8
/** 這個高度以下是沙灘色、不長植被，m。`render/leyteGround.ts` 與植被共用 */
export const SAND_TOP = 3
/** 高度場最高處的上界，m：山脈的起伏最多 450 m，疊在最高 `PLAIN_TOP` 的平地上。`LandField.ceiling` 用它 */
export const LEYTE_PEAK_MAX = 470

/** 岸線平均位置，m（世界 z） */
const COAST_Z = -4000
/** 岸線的三道起伏：振幅 m、波長 m、相位 rad。振幅合計 770 m */
const COAST_WAVES = [
  { amp: 400, len: 9000, phase: 0.7 },
  { amp: 250, len: 3700, phase: 2.1 },
  { amp: 120, len: 1700, phase: 4.4 },
] as const
/** 由水線升到平地的斜坡寬，m */
const SHORE_RAMP = 240
/** 海床由水線降到 `SEA_FLOOR` 的距離，m */
const SEABED_RAMP = 200
/**
 * 平地的緩坡起伏，m：疊在 `PLAIN_HEIGHT` 之上，0～12 m。
 *
 * 【上限 12 m 是 AI 的硬約束】AI 的安全層只認得丘陵清單（`IslandDesc` 圓盤），
 * 其餘一律當海平面，戰鬥機的改出餘裕是 30 m（`ai/safety.ts` 的
 * `fighterClearance`）。平地高過那個餘裕的話，低空掃射的 AI 會一頭撞進緩坡。
 * **大的起伏一律做成丘陵**，AI 才看得到。
 */
function roll(x: number, z: number): number {
  return 6 + 4 * Math.sin(x / 900 + 0.5) * Math.sin(z / 1100 + 1.2) + 2 * Math.sin((x - z) / 450 + 2)
}
/** 基準面的最高處，m：平地加上緩坡起伏的上限（6 + 4 + 2） */
export const PLAIN_TOP = PLAIN_HEIGHT + 12
/** 岸邊這麼寬的一帶不起伏，m —— 沙灘與灘頭是平的 */
const ROLL_SHORE = 600
/**
 * 場地邊緣往內這麼寬的一帶，緩坡起伏收回 0，m。
 *
 * 【為什麼】場外的遠景陸地格子比場內粗得多（`render/leyteGround.ts`），兩邊只在
 * 粗格的頂點上對得上。邊緣上的高度若有起伏，粗格那條直線跟不上，接縫會裂開
 * 看得到底下。收平之後邊緣是一條水平線，兩邊都是它。
 */
const ROLL_EDGE = 1000

/** 岸線在這個 x 上的世界 z。陸地在 `z > coastZ(x)` */
export function coastZ(x: number): number {
  let z = COAST_Z
  for (const w of COAST_WAVES) z += w.amp * Math.sin((2 * Math.PI * x) / w.len + w.phase)
  return z
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

/**
 * 沒有丘陵時這一點的高度，m：海床、海岸斜坡、平地與它的緩坡起伏。
 *
 * 【陸地一路延伸到場地邊緣】場外由 `render/leyteGround.ts` 的遠景陸地接上 ——
 * 這座島很大，另外幾面的海岸不在視野裡。
 *
 * 【距離取 z 向】`z − coastZ(x)` 不是到岸線的真正距離，但岸線的最大斜率
 * （Σ 2π·amp/len ≈ 1.13）之下斜坡只會被拉寬到約 1.5 倍，看不出來。
 */
export function baseHeight(x: number, z: number): number {
  const d = z - coastZ(x)
  if (d <= 0) return Math.max(SEA_FLOOR, (d / SEABED_RAMP) * -SEA_FLOOR)
  const edge = Math.min(FIELD_HALF - Math.abs(x), FIELD_HALF - Math.abs(z))
  return PLAIN_HEIGHT * smoothstep(0, SHORE_RAMP, d)
    + roll(x, z) * smoothstep(SHORE_RAMP, SHORE_RAMP + ROLL_SHORE, d) * smoothstep(0, ROLL_EDGE, edge)
}

/** 遠景的山從場地邊緣往外這麼遠才長到全高，m */
const FAR_RISE = 15000
/** 遠景的丘陵從場地邊緣往外這麼遠長到全高，m。比山脈快 —— 出了場地就是丘陵地 */
const FAR_HILL_RISE = 4000
/**
 * 遠景丘陵的幾道起伏：振幅 m、方向 rad、波長 m、相位 rad。方向各不相同，疊出來
 * 不成排；振幅合計 630 m —— 比場內的山脈高，島的中央本來就是山。
 */
const FAR_HILLS = [
  { amp: 260, dir: 0.4, len: 5200, phase: 0.3 },
  { amp: 180, dir: 1.9, len: 3700, phase: 2.1 },
  { amp: 120, dir: 2.8, len: 2600, phase: 4.0 },
  { amp: 70, dir: 5.1, len: 1500, phase: 1.2 },
] as const

/** 遠景丘陵的起伏，m（0～振幅合計）：多道斜向正弦取絕對值疊出稜線 */
function farHills(x: number, z: number): number {
  let h = 0
  for (const w of FAR_HILLS) {
    const s = (x * Math.cos(w.dir) + z * Math.sin(w.dir)) / w.len
    // 【取 1 − |sin|】稜是尖的、谷是圓的，像山；純正弦是一排排圓丘
    h += w.amp * (1 - Math.abs(Math.sin(Math.PI * s + w.phase)))
  }
  return h
}

/**
 * 場外這一點有多「在山上」，0～1：丘陵起伏的上半段與往外升高的山脈。遠景的林相
 * 照它畫（`render/flora.ts` 的 `leyteFarCover`）—— 谷地是草、稜上是林子。
 *
 * 【不能拿「高出基準面多少」】場外的丘陵處處都高出基準面幾十公尺，照場內那一條
 * 算的話整片都是山林，遠景是一片均勻的暗綠。
 */
export function farUpland(x: number, z: number): number {
  const out = Math.max(0, Math.abs(x) - FIELD_HALF, z - FIELD_HALF)
  const hills = farHills(x, z) * smoothstep(0, FAR_HILL_RISE, out)
  return Math.min(1, smoothstep(210, 440, hills) + smoothstep(0.4, 0.9, smoothstep(0, FAR_RISE, out)))
}

/**
 * 場外遠景陸地的高度，m。**只畫不碰撞**（`render/leyteGround.ts`），戰場半徑
 * 12 km（`world/arena.ts`）飛不到那裡。
 *
 * 海岸線照同一條曲線延伸；陸上是場內的基準面（`baseHeight`），疊上丘陵地，再
 * 疊一道往外越來越高的山脈 —— 雷伊泰島中央是山。**在場地邊緣兩者都是 0**，
 * 與場內的地形接得上。
 */
export function farHeight(x: number, z: number): number {
  const base = baseHeight(x, z)
  if (base <= 0) return base
  const out = Math.max(0, Math.abs(x) - FIELD_HALF, z - FIELD_HALF)
  const ridge = 1000 + 300 * Math.sin(x / 7000 + 1) * Math.sin(z / 9000 + 0.4)
  // 【離岸近的地方山也矮】岸邊 3 km 內壓回平地，沙灘後面不會直接是山壁
  const inland = smoothstep(0, 3000, z - coastZ(x))
  return base + (ridge * smoothstep(0, FAR_RISE, out) + farHills(x, z) * smoothstep(0, FAR_HILL_RISE, out)) * inland
}
