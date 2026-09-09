import { createHeightField, type HeightFieldData } from '../world/heightfield'
import { FARM_CELL, FARM_SIZE } from '../world/farmland'
import { PAD_CLEARANCE, PLANT_CENTER, PLANT_PAD } from '../world/leuna'

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

/** 平滑的 0→1，兩端一階導數為 0 —— 硬邊會在墊面外圍留一圈折線 */
function smoothStep(t: number): number {
  const u = t < 0 ? 0 : t > 1 ? 1 : t
  return u * u * (3 - 2 * u)
}

/**
 * 把 DEM 內插成遊戲的高度場。
 *
 * 【最低點歸零】高度場的場外回 0（`outsideZero`），而真實高程在這一帶是
 * 51–249 m —— 不歸零的話地圖邊緣會出現一圈五十公尺深的懸崖。
 *
 * 【雙線性內插】DEM 的取樣是 320 m，高度場是 80 m。最近鄰會在飛行中看到
 * 320 m 見方的階梯。
 */
export function demToField(dem: DemFile): HeightFieldData {
  const field = createHeightField(FARM_SIZE, FARM_CELL)
  const half = (FARM_SIZE - 1) / 2
  let min = Infinity
  for (const e of dem.elevation) if (e < min) min = e

  const at = (i: number, j: number): number => {
    const ci = i < 0 ? 0 : i > dem.size - 1 ? dem.size - 1 : i
    const cj = j < 0 ? 0 : j > dem.size - 1 ? dem.size - 1 : j
    return dem.elevation[cj * dem.size + ci]! - min
  }
  /** 世界座標 → 內插後的高度 */
  const sample = (x: number, z: number): number => {
    const gx = (x + dem.halfMetres) / dem.step
    const gz = (z + dem.halfMetres) / dem.step
    const i = Math.floor(gx)
    const j = Math.floor(gz)
    const fx = gx - i
    const fz = gz - j
    const a = at(i, j) * (1 - fx) + at(i + 1, j) * fx
    const b = at(i, j + 1) * (1 - fx) + at(i + 1, j + 1) * fx
    return a * (1 - fz) + b * fz
  }

  const padH = sample(PLANT_CENTER.x, PLANT_CENTER.z)
  for (let j = 0; j < FARM_SIZE; j++) {
    for (let i = 0; i < FARM_SIZE; i++) {
      const x = (i - half) * FARM_CELL
      const z = (j - half) * FARM_CELL
      // 離墊面矩形多遠（矩形內為 0）
      const dx = Math.max(0, Math.abs(x - PLANT_CENTER.x) - PLANT_PAD.halfX)
      const dz = Math.max(0, Math.abs(z - PLANT_CENTER.z) - PLANT_PAD.halfZ)
      // 【要多退一格】墊面邊界外第一圈的格點若不是平的，雙線性內插會把它
      // 帶進墊面裡 —— 實測會在墊面內留下 0.85 m 的起伏，而佈景假設是 0
      const d = Math.max(0, Math.hypot(dx, dz) - FARM_CELL)
      const t = smoothStep(d / PAD_BLEND)
      field.data[j * FARM_SIZE + i] = padH * (1 - t) + sample(x, z) * t
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
