import { createHeightField, type HeightFieldData } from './heightfield'

/**
 * 群島地形的生成器。
 *
 * 【為什麼島形是解析的，不用 noise 函式庫】決定性天然成立（沒有可變狀態）、
 * 沒有第三方相依，而且**輪廓的變化由兩道正弦給就夠了** —— 在 40 m 的格子
 * 下已經看不出它是正弦。專案負責人的裁定是「先做一版簡單的」。
 *
 * 【為什麼沒有 seed 參數】這一輪 `main.ts` 只有一種群島。公開一個沒有需求的
 * 擴充點，代價是它會長出「不同 seed 要不要不同」這種沒人回答得了的測試。
 * 真的要隨機地圖時再加。
 */

/** 高度場的邊長頂點數。1024 × 40 m = 40.92 km 見方 */
export const FIELD_SIZE = 1024
/**
 * 格距，m。
 *
 * 【40 是由三角形數推導的，不是調的】陸地三角形約 126k，而海面是 286,720
 * （近海 clipmap 253,952 加遠海 32,768）—— 地形因此約是海面的四成。20 m
 * 會變成海面的 1.8 倍，80 m 則讓 300 m 的小島只剩 3.75 格、塌成一團。
 *
 * 【它不影響 `sample` 的成本】雙線性插值是 O(1)。粗格省的是三角形。
 */
export const FIELD_CELL = 40

/**
 * 島的直徑下限，m。
 *
 * 40 m 格子下，直徑 300 m 是 7–8 格 —— 剛好長得出一塊有三四個面的礁石。
 * 再小就只剩兩三格，變成一團三角錐。
 */
export const ISLAND_MIN_DIAMETER = 300

/**
 * 峰高上限，m。
 *
 * 【上限訂在地形這一側，不是 AI 那一側】AI 的爬升率與轉彎半徑是物理，
 * 改不動；地形是設計，想怎麼擺都行。所以「AI 閃不掉」這件事的第一道防線
 * 是這個常數，不是讓 AI 更聰明。
 */
export const PEAK_MAX = 1000

/**
 * 島形 `wobble` 的最大值，也就是地形延伸到標稱半徑的幾倍。
 *
 * **這一行與下面 `WOBBLE_A`／`WOBBLE_B` 綁死** —— 1 + 0.18 + 0.11。
 * 動了振幅就要回來重算，否則 `outerRadius` 會小於地形實際的延伸範圍，
 * 而症狀是飛機撞到一片畫面上沒有的陸地。
 */
export const WOBBLE_MAX = 1.29
const WOBBLE_A = 0.18
const WOBBLE_B = 0.11

/**
 * 兩座島的膨脹圓之間至少要留的間隙，m。
 *
 * 【為什麼需要它】「左右有島、中間通得過」是這個地形要能成立的情境。
 * 兩座島的膨脹圓若貼在一起，AI 的圓盤判斷會認為沒有出路，於是去繞遠路或
 * 拉高 —— 而玩家看到的是一條明明飛得過去的水道。
 */
export const CHANNEL_MIN = 1500

/** 島心的散布半徑，m。場地半徑是 20.46 km，留邊避免島被切在邊界上 */
const SPREAD = 15000

/** 亂數的種子。私有 —— 見檔頭 */
const SEED = 20260827

export interface IslandDesc {
  readonly cx: number
  readonly cz: number
  /** 標稱半徑，m。高度剖面以它為尺 */
  readonly radius: number
  /**
   * 地形實際延伸到的半徑，m。**mesh 切它、視錐包圍球用它、AI 的圓盤也用它。**
   * 三個消費者共用同一個數字，就不會有人切得比別人小。
   */
  readonly outerRadius: number
  readonly peak: number
}

/**
 * 島的三個級距。**混合是專案負責人指定的**：少數大島當戰術核心，
 * 多數小島當景。
 */
const TIERS = [
  { count: 2, radius: [1300, 1600], peak: [800, PEAK_MAX] },
  { count: 6, radius: [500, 800], peak: [300, 500] },
  { count: 40, radius: [ISLAND_MIN_DIAMETER / 2, 260], peak: [60, 160] },
] as const

/** 每座島最多試幾個位置。試不下就少放一座 —— 間距是硬約束，數量不是 */
const PLACE_TRIES = 300

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

export function createArchipelago(): {
  field: HeightFieldData
  islands: readonly IslandDesc[]
} {
  // 【不得 Math.random】LCG，種子進、序列出。決定性是這整套 replayDigest
  // 校驗和的前提
  let s = SEED
  const rand = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
  const between = (lo: number, hi: number): number => lo + rand() * (hi - lo)

  const field = createHeightField(FIELD_SIZE, FIELD_CELL)
  const islands: IslandDesc[] = []
  // wobble 的兩個相位，逐島。與 islands 同索引
  const phase: { a: number; b: number }[] = []

  for (const tier of TIERS) {
    for (let n = 0; n < tier.count; n++) {
      const radius = between(tier.radius[0], tier.radius[1])
      const peak = between(tier.peak[0], tier.peak[1])
      const outerRadius = radius * WOBBLE_MAX
      // 相位先抽 —— 抽不抽得到位置都要抽，序列才不會因為 rejection 而漂
      const pa = rand() * Math.PI * 2
      const pb = rand() * Math.PI * 2

      for (let t = 0; t < PLACE_TRIES; t++) {
        const cx = (rand() - 0.5) * 2 * SPREAD
        const cz = (rand() - 0.5) * 2 * SPREAD
        let ok = true
        for (const o of islands) {
          const gap = Math.hypot(cx - o.cx, cz - o.cz) - outerRadius - o.outerRadius
          if (gap < CHANNEL_MIN) { ok = false; break }
        }
        if (!ok) continue
        islands.push({ cx, cz, radius, outerRadius, peak })
        phase.push({ a: pa, b: pb })
        break
      }
    }
  }

  bake(field, islands, phase)
  return { field, islands }
}

/**
 * 把島烘進高度場。
 *
 * 【只掃每座島的 bounding box】全圖是 1,048,576 個頂點，逐點對 48 座島算
 * 距離是五千萬次運算。逐島只掃自己的方框之後總量降到約五萬格。
 */
function bake(
  field: HeightFieldData, islands: readonly IslandDesc[],
  phase: readonly { a: number; b: number }[],
): void {
  const { size, cell, data } = field
  const half = (size - 1) / 2
  const last = size - 1

  for (let k = 0; k < islands.length; k++) {
    const isl = islands[k]!
    const ph = phase[k]!
    const c0 = Math.max(0, Math.floor((isl.cx - isl.outerRadius) / cell + half))
    const c1 = Math.min(last, Math.ceil((isl.cx + isl.outerRadius) / cell + half))
    const r0 = Math.max(0, Math.floor((isl.cz - isl.outerRadius) / cell + half))
    const r1 = Math.min(last, Math.ceil((isl.cz + isl.outerRadius) / cell + half))

    for (let row = r0; row <= r1; row++) {
      const z = (row - half) * cell
      const dz = z - isl.cz
      for (let col = c0; col <= c1; col++) {
        const x = (col - half) * cell
        const dx = x - isl.cx
        const d = Math.hypot(dx, dz)
        if (d > isl.outerRadius) continue

        const theta = Math.atan2(dz, dx)
        const wobble = 1
          + WOBBLE_A * Math.sin(3 * theta + ph.a)
          + WOBBLE_B * Math.sin(5 * theta + ph.b)
        const h = isl.peak * smoothstep(1, 0, d / isl.radius / wobble)

        const i = row * size + col
        // 取 max：島若重疊，高的那一座說了算。間距約束讓這件事不該發生，
        // 但取 max 保證即使發生也不會挖出一個洞
        if (h > data[i]!) data[i] = h
      }
    }
  }
}
