import { createHeightField, type HeightFieldData } from '../world/heightfield'
import { FARM_CELL, FARM_SIZE } from '../world/farmland'
import { PAD_CLEARANCE, PLANT_CENTER, PLANT_PAD, worldToPlant } from '../world/leuna'

/**
 * 洛伊納一帶的**真實高程**，只給展示區並排比較用。
 *
 * 【遊戲不走這條】`createTerrain('leuna')` 仍然是手擺丘陵的 `createLeuna()`。
 * 這一份存在的理由是「照實還原長什麼樣」這個問題本身。
 *
 * 資料：EU-DEM v1.1，© European Union, Copernicus Land Monitoring Service，
 * 由 `tools/dem/fetch-leuna-dem.mjs` 抓成 `public/data/leuna-dem.json`。
 *
 * 【實測的差距】30 km 見方裡真實起伏 197 m、標準差 27 m，而手擺那一版是
 * 41 m 與 4 m，96% 的地完全平坦。差別不在峰高而在**質地**：真實地形到處
 * 都在緩緩起伏，手擺的是平地上放十顆孤立的丘。
 */
export const LEUNA_DEM_URL = '/data/leuna-dem.json'

interface DemFile {
  readonly size: number
  readonly step: number
  readonly halfMetres: number
  readonly elevation: readonly number[]
}

/**
 * 墊面壓平的過渡帶寬度，m。
 *
 * 【墊面一定要平】十二座構件與整片佈景都假設地面高度是 0（`PLANT_PAD` 那一段
 * 在生成器裡是結構上的保證）。真實地形在廠區底下是斜的 —— 不壓平的話儲槽
 * 一半埋進土裡、一半浮在空中。過渡帶用 `PAD_CLEARANCE`，與生成器對丘陵的
 * 要求同一個數字。
 */
const PAD_BLEND = PAD_CLEARANCE

/** `worldToPlant` 的暫存。`demToField` 逐格跑十四萬次，不在迴圈裡建物件 */
const LOCAL = { x: 0, z: 0 }

/** 平滑的 0→1，兩端一階導數為 0 —— 硬邊會在墊面外圍留一圈折線 */
function smoothStep(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return u * u * (3 - 2 * u)
}

/**
 * 邊緣收攏帶的寬度，m。
 *
 * 【一定要收到 0】高度場的場外回 0（`outsideZero`），遠景環也在 0。這一帶
 * 的真實高程在邊上是 30–191 m，不收的話整片實測地形是一塊台地，四周一圈
 * 幾十到上百公尺的懸崖。
 */
const EDGE_FADE = 2600

/**
 * 把 DEM 內插成遊戲的高度場。
 *
 * 【基準是廠區不是最低點】佈景與十二座構件都假設廠區的地面是 0。以最低點
 * 為基準的話墊面會在 59 m，而那些東西全部埋在地下 —— 不會報錯，只是廠區
 * 憑空消失。以廠區為 0 之後薩勒河的谷底是 −22 m，那是對的：它本來就比
 * 廠區低。
 *
 * 【雙線性內插】DEM 的取樣是 320 m，高度場是 80 m。最近鄰會在飛行中看到
 * 320 m 見方的階梯。
 */
export function demToField(dem: DemFile): HeightFieldData {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const half = (FARM_SIZE - 1) / 2

  const raw = (i: number, j: number): number => {
    const ci = i < 0 ? 0 : i > dem.size - 1 ? dem.size - 1 : i
    const cj = j < 0 ? 0 : j > dem.size - 1 ? dem.size - 1 : j
    return dem.elevation[cj * dem.size + ci]!
  }
  /** 世界座標 → 內插後的原始高程，m */
  const sample = (x: number, z: number): number => {
    const gx = (x + dem.halfMetres) / dem.step
    const gz = (z + dem.halfMetres) / dem.step
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const a = raw(i, j) * (1 - fx) + raw(i + 1, j) * fx
    const b = raw(i, j + 1) * (1 - fx) + raw(i + 1, j + 1) * fx
    return a * (1 - fz) + b * fz
  }

  const datum = sample(PLANT_CENTER.x, PLANT_CENTER.z)
  const edge = half * FARM_CELL
  for (let j = 0; j < FARM_SIZE; j++) {
    for (let i = 0; i < FARM_SIZE; i++) {
      const x = (i - half) * FARM_CELL
      const z = (j - half) * FARM_CELL
      // 離墊面矩形多遠（矩形內為 0）。**要先轉進廠區局部座標** —— 墊面轉了
      // `PLANT_HEADING`，拿世界座標去比會把斜出去的兩角留在坡上
      worldToPlant(x, z, LOCAL)
      const dx = Math.max(0, Math.abs(LOCAL.x) - PLANT_PAD.halfX)
      const dz = Math.max(0, Math.abs(LOCAL.z) - PLANT_PAD.halfZ)
      // 【要多退一格半】墊面邊界外第一圈的格點若不是平的，雙線性內插會把它
      // 帶進墊面裡 —— 那會在墊面內留下 0.85 m 的起伏，而佈景假設是 0。
      // 墊面是斜的，格點到斜邊的最近距離最遠可以到一格的 √2 倍
      const pad = smoothStep(Math.max(0, Math.hypot(dx, dz) - FARM_CELL * 1.5) / PAD_BLEND)
      // 邊緣往 0 收：中間一大片完全不動，只有最外圈那條帶子被拉平
      const fade = smoothStep(Math.min(edge - Math.abs(x), edge - Math.abs(z)) / EDGE_FADE)
      field.data[j * FARM_SIZE + i] = (sample(x, z) - datum) * pad * fade
    }
  }
  return field
}

/** 抓 JSON、內插成高度場。展示區在切到「洛伊納（實測）」時叫一次就快取 */
export async function loadLeunaDem(
  fetcher: (url: string) => Promise<DemFile> =
  async (u) => (await fetch(u)).json() as Promise<DemFile>,
): Promise<HeightFieldData> {
  return demToField(await fetcher(LEUNA_DEM_URL))
}
