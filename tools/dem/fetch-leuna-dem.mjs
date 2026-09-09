/**
 * 抓洛伊納一帶的真實高程，存成 `public/data/leuna-dem.json`。
 *
 * ```
 *   node tools/dem/fetch-leuna-dem.mjs
 * ```
 *
 * 【只給展示區用】遊戲的 `createTerrain('leuna')` 走的仍然是手擺丘陵的
 * `createLeuna()`。這一份是拿來並排比較的。
 *
 * 【資料來源與出處】EU-DEM v1.1，© European Union, Copernicus Land
 * Monitoring Service，經 opentopodata.org 的公開端點取得。那個端點限
 * 每次 100 點、每秒 1 次、每天 1,000 次 —— 底下的節流不要拿掉。
 *
 * 【座標對應】北 = 遊戲的 −Z、東 = 遊戲的 +X，廠區中心
 * `PLANT_CENTER (0, −7000)` 對到真實的 (51.3085, 12.0048) —— OSM 上
 * Chemiestandort Leuna 三塊廠區的面積加權形心。錨在形心而不是隨手挑的整數
 * 經緯度，河與地形相對廠區的位置才是對的。要換朝向就改 `NORTH_IS` 那一組，
 * 不要去動抓回來的資料。
 *
 * 【為什麼取樣 320 m 而不是高度場的 80 m】376 × 376 要十四萬點，遠超額度；
 * 而那一帶的起伏標準差是 27 m／30 km，320 m 已經比肉眼在飛行高度分得出來的
 * 尺度細。遊戲端雙線性內插補到 80 m。
 */
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

/** 廠區中心的真實座標 */
const PLANT_LAT = 51.3085
const PLANT_LON = 12.0048
/** 廠區中心在遊戲世界的座標（`world/leuna.ts` 的 `PLANT_CENTER`） */
const PLANT_Z = -7000
/** 高度場的範圍：376 格 × 80 m，中心在世界原點 */
const HALF_M = ((376 - 1) / 2) * 80
/** 取樣間距，m */
const STEP = 320

const M_PER_DEG_LAT = 111320
const M_PER_DEG_LON = 111320 * Math.cos((PLANT_LAT * Math.PI) / 180)

/** 遊戲座標 → 真實經緯度。北 = −Z、東 = +X */
function toLatLon(x, z) {
  const north = -(z - PLANT_Z)
  return [PLANT_LAT + north / M_PER_DEG_LAT, PLANT_LON + x / M_PER_DEG_LON]
}

const n = Math.round((HALF_M * 2) / STEP) + 1
const pts = []
for (let j = 0; j < n; j++) {
  for (let i = 0; i < n; i++) {
    pts.push(toLatLon(-HALF_M + i * STEP, -HALF_M + j * STEP))
  }
}
console.log(`取樣 ${n} × ${n} = ${pts.length} 點，間距 ${STEP} m，共 ${Math.ceil(pts.length / 100)} 次呼叫`)

const elev = []
for (let k = 0; k < pts.length; k += 100) {
  const batch = pts.slice(k, k + 100)
  const q = batch.map((p) => `${p[0].toFixed(6)},${p[1].toFixed(6)}`).join('|')
  const res = await fetch(`https://api.opentopodata.org/v1/eudem25m?locations=${q}`)
  const json = await res.json()
  if (json.status !== 'OK') throw new Error(`opentopodata: ${JSON.stringify(json).slice(0, 200)}`)
  // 【null 要補不能留】海面與資料缺口回 null，直接寫進高度場會變成 NaN 的地形
  for (const r of json.results) elev.push(r.elevation === null ? null : Math.round(r.elevation * 10) / 10)
  process.stdout.write(`\r  ${elev.length} / ${pts.length}`)
  await new Promise((s) => setTimeout(s, 1100))
}
process.stdout.write('\n')

const known = elev.filter((e) => e !== null)
const mean = known.reduce((a, b) => a + b, 0) / known.length
for (let i = 0; i < elev.length; i++) if (elev[i] === null) elev[i] = Math.round(mean * 10) / 10
console.log(`缺口 ${elev.length - known.length} 點，補成平均 ${mean.toFixed(1)} m`)

const out = {
  source: 'EU-DEM v1.1 © European Union, Copernicus Land Monitoring Service（via opentopodata.org）',
  plant: { lat: PLANT_LAT, lon: PLANT_LON, z: PLANT_Z },
  north: '-Z',
  halfMetres: HALF_M,
  step: STEP,
  size: n,
  min: Math.min(...known),
  max: Math.max(...known),
  elevation: elev,
}
const path = 'public/data/leuna-dem.json'
mkdirSync(dirname(path), { recursive: true })
writeFileSync(path, JSON.stringify(out))
console.log(`寫入 ${path}：${n}×${n}，${out.min} – ${out.max} m`)
