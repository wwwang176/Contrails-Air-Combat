import { createHeightField, type HeightFieldData } from './heightfield'
import {
  bakeRelief, makeLobes, WOBBLE_MAX, type IslandDesc, type LobeDraw,
} from './archipelago'

/**
 * 內陸農地的生成器。
 *
 * 【與群島的關係】起伏用的是同一套多瓣機制（`makeLobes` / `bakeRelief`），
 * 差別只有兩個數字：基準面是 `0` 而不是 `SEA_FLOOR`，尺度由「島」換成
 * 「丘陵」。**不抽共用模組** —— 抽出來會讓 `archipelago.test.ts` 的 20 條
 * 變成在測另一個檔案，而那批測試正是這次改動唯一的安全網。
 *
 * 【丘陵為什麼用 `IslandDesc`】名字不精確，但換到的是 AI 的避障、
 * `terrainCeiling`、`checkClimb`、遮蔽判斷一行都不用改。`islands: []` 的話
 * AI 對地形會完全沒有感知，而貼地纏鬥正是這張圖最常發生的事。
 */

/** 高度場的邊長頂點數。376 個頂點 = 375 格 × 80 m = 30 km 見方 */
export const FARM_SIZE = 376

/**
 * 格距，m。
 *
 * 【為什麼比群島的 40 粗一倍】30 km 見方在 40 m 下是 1.125 M 個三角形，
 * 是現在整個場景（陸地 126k + 海面 287k）的 2.7 倍。80 m 下是 281k，而純內陸
 * 把海面整個拿掉了，所以總量反而下降。
 *
 * 【粗格不會讓畫面變空】田與防風林是片段著色器算的，銳利度與網格密度脫鉤。
 */
export const FARM_CELL = 80

/** 場地的邊長，m */
export const FARM_EXTENT = (FARM_SIZE - 1) * FARM_CELL

/** 丘陵的峰高上限，m。`LandField.ceiling` 用它 */
export const HILL_PEAK_MAX = 120

/**
 * 丘陵的地形不得超出這個半徑，m。
 *
 * 【為什麼要留一圈】場地半徑是 15,000，而丘陵被邊界切掉的話外圈會出現一道
 * 垂直的崖；遠景環是平的，接縫會變成畫面上一條線。留 1 km 的平地讓兩者
 * 在 `y = 0` 上接得上。
 */
export const HILL_LIMIT = 14000

/** 丘陵中心的候選網格。9 × 9 = 81 個候選，放不下的丟掉 */
const HILL_GRID = 9
const HILL_STEP = 3000
const HILL_JITTER = 700
const HILL_RADIUS = [700, 1300] as const

/**
 * 峰高佔半徑的比例。**峰高由半徑推得，不是獨立抽的。**
 *
 * 【為什麼】坡度是 `1.5 × peak / radius`。獨立抽會抽出「又小又高」的尖丘，
 * 而綁在一起之後坡度的上限就是 `1.5 × 0.10 = 0.15`（8.5°）—— 一個常數，
 * 不必事後檢查。
 */
const HILL_SLOPE = [0.06, 0.10] as const

/**
 * 兩顆丘陵的膨脹圓之間至少要留的間隙，m。
 *
 * **這一條是 AI 的硬約束，不是美學選擇。** `ai/terrainSense.ts` 的
 * `findThreat` 只保留航跡上最早撞到的那一座，`senseTerrain` 也只對它做爬升
 * 判斷 —— 圓盤重疊時，前面一顆矮丘會把後面一顆高丘整個遮掉。重疊版的參數
 * 實跑是 86 座丘陵、225 組重疊、最大重疊 2,923 m。
 *
 * 要讓丘陵連綿就得改 AI 讓它對路徑上所有重疊的丘陵取聯集。代價是地形變成
 * 平原上散布的緩丘 —— 起伏仍然在，來自每一顆丘陵自己的多瓣。
 */
const HILL_GAP = 200

/** 每顆丘陵除主瓣外的瓣數。與群島同一個理由：固定，不隨機 */
const HILL_LOBES = 4
const HILL_LOBE_RADIUS = [0.30, 0.48] as const

/** 亂數的種子。私有 —— 與 `archipelago.ts` 同一個理由 */
const SEED = 20260828

/** 種子進、序列出。**不得 `Math.random`** */
function makeRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

export function createFarmland(): { field: HeightFieldData; hills: IslandDesc[] } {
  const rand = makeRand(SEED)
  const between = (lo: number, hi: number): number => lo + rand() * (hi - lo)
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const hills: IslandDesc[] = []

  const first = -((HILL_GRID - 1) / 2) * HILL_STEP
  for (let j = 0; j < HILL_GRID; j++) {
    for (let i = 0; i < HILL_GRID; i++) {
      // 【所有 rand() 都要無條件抽完，篩選在之後】與 `archipelago.ts` 的
      // rejection sampling 同一個理由：條件式的抽樣會讓序列漂
      const cx = first + i * HILL_STEP + between(-HILL_JITTER, HILL_JITTER)
      const cz = first + j * HILL_STEP + between(-HILL_JITTER, HILL_JITTER)
      const radius = between(HILL_RADIUS[0], HILL_RADIUS[1])
      const peak = Math.min(HILL_PEAK_MAX, radius * between(HILL_SLOPE[0], HILL_SLOPE[1]))
      const pa = rand() * Math.PI * 2
      const pb = rand() * Math.PI * 2
      const draws: LobeDraw[] = []
      for (let k = 0; k < HILL_LOBES; k++) {
        draws.push({
          dir: rand() * Math.PI * 2,
          rf: HILL_LOBE_RADIUS[0] + rand() * (HILL_LOBE_RADIUS[1] - HILL_LOBE_RADIUS[0]),
          uOff: rand(),
          uPeak: rand(),
          pa: rand() * Math.PI * 2,
          pb: rand() * Math.PI * 2,
        })
      }

      const outerRadius = radius * WOBBLE_MAX
      // 【留一圈平地接遠景環】見 HILL_LIMIT
      if (Math.hypot(cx, cz) + outerRadius > HILL_LIMIT) continue
      // 【膨脹圓不得重疊】見 HILL_GAP
      let clash = false
      for (const o of hills) {
        if (Math.hypot(cx - o.cx, cz - o.cz) < outerRadius + o.outerRadius + HILL_GAP) {
          clash = true
          break
        }
      }
      if (clash) continue

      hills.push({
        cx, cz, radius, outerRadius, peak,
        lobes: makeLobes(cx, cz, radius, outerRadius, peak, pa, pb, draws),
      })
    }
  }

  // 【基準面是 0，不是負的】內陸沒有海，島緣沉到水下那條理由不存在
  bakeRelief(field, hills, 0)
  return { field, hills }
}

/**
 * 把高度場包成「出界回 0」的一份。**讀的仍然是同一個 `data`。**
 *
 * 【為什麼需要它】`HeightFieldData.sample` 出界回 `-Infinity`，而農地的
 * 遮蔽判準是 `h > landAbove` 而 `landAbove` 也是 `-Infinity` —— 兩個一比
 * 是 false，30 km 之外的平地會不擋視線、也不吃子彈（子彈會掉進海面水柱
 * 那條路徑）。
 *
 * 【為什麼不直接改 `createHeightField`】群島靠出界的 `-Infinity` 退回平
 * 海面（`render/terrain.ts` 的 `heightAt` 取 max）。那一條是對的。
 */
export function outsideZero(f: HeightFieldData): HeightFieldData {
  return {
    size: f.size,
    cell: f.cell,
    data: f.data,
    sample(x, z) {
      const h = f.sample(x, z)
      return h > 0 ? h : 0
    },
  }
}
