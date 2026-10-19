import {
  ClampToEdgeWrapping, Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat,
  Vector2, Vector3, type BufferGeometry,
} from 'three'
import { createFloraGeometries, disposeFloraGeometries, pointColorOf, type PointPool } from './floraShapes'
import { DAY_PALETTES, type DayPalette } from './timeOfDay'
import { TINT_RANGE } from './vegetationPolicy'
import type { Season } from './season'

/**
 * # 遠處的點照此刻的燈算亮度
 *
 * 3～6 km 的樹是不吃光照的點；它取代的中級樹冠吃光照，而且看鏡頭在太陽哪一側：迎光看到
 * 背光面、背光看到受光面。點的顏色因此由一張表給：
 *
 * ```
 * 點畫出來 = 樹冠色 × 明度 × 材質色 × 表(V)
 * 表(V)    = R(V) / (樹冠色 × 明度中值 × 材質色)
 * ```
 *
 * `R(V)` 是一個樹種的中級樹冠從方向 `V`（物件指向鏡頭）看過去每單位投影面積的平均輻射，
 * 面取實際的中級幾何、轉向平均，與 three 標準材質的輸出同一個單位：
 *
 * ```
 * R(V) = Σ w·[albedo·E(n) / π + 太陽·max(0, n·L)·GGX(n, V, L)] / Σ w
 * E(n) = 太陽·max(0, n·L) + mix(地色, 天色, ½ + ½·n.y)·半球 + 環境光
 * w    = 面積 · max(0, n·V) · 林子的遮擋
 * ```
 *
 * 材質色（`setPointLight` 設的時段倍率與染色）在表裡除掉，點的亮度只由燈決定。
 *
 * 【查表】太陽開局後固定，表只與兩個數有關：c = 水平視線與太陽水平方向的夾角餘弦（迎光
 * 1、背光 −1）、s = 鏡頭的仰角正弦（物件指向鏡頭那條線的 y）。CPU 在 `setPalette` 時算
 * 一張，著色器查一次（`VIEW_SHADE_GLSL`）。
 *
 * 量測在展示區（/tools/canopy.html）：同一片林子並排畫成立體樹、簡易樹冠、點，三個時段、
 * 背光／側光／迎光、仰角 15°～90°，點與立體樹的差均方根 3.6%。
 */

/** 表的 c 方向幾格：c 由 −1（背光）到 1（迎光） */
export const VIEW_SHADE_COLS = 32
/** 表的 s 方向幾格：s 由 0（平視）到 1（正上方） */
export const VIEW_SHADE_ROWS = 16

/** 表的列：一個樹種一列，點池各查自己那一列 */
export const enum ViewShadeRow {
  Broad = 0,
  Cone = 1,
  Bush = 2,
}
export const VIEW_SHADE_CLASSES = 3

/** 每一列是哪一個點池的顏色 */
const ROW_POOL: readonly PointPool[] = ['broadPoint', 'conePoint', 'bushPoint']

/**
 * 植被材質（`createVegetationPools` 的 `MeshStandardMaterial`）的粗糙度。表裡的鏡面
 * 反射用同一個值
 */
export const FLORA_ROUGHNESS = 0.9

/**
 * 林子裡每公尺水平視線被樹冠擋掉的比例，1/m。
 *
 * 林子裡低角度看過去，後排樹冠的下半部被前排擋住，看到的多半是被照亮的上半部。每一面
 * 取樣點的權重乘 `exp(−σ·(樹頂 − y) / tan 仰角)`。展示區 16 m 一格的闊葉林，0.015～0.05
 * 之間側光的誤差由 6.6% 降到 4.7%、背光由 1.9% 升到 3.5%，取 0.03。
 *
 * 只套在闊葉、針葉；灌木多半在樹籬與林下，沒有成片的密度可校
 */
export const STAND_BLOCKING = 0.03

/** 轉向平均取幾個方位。實例的轉向是亂數；八面體四重、錐六重對稱，16 個夠密 */
const YAWS = 16

/** 一面取幾個高度：每邊 4 段的重心格點，10 點 */
const DEPTH_STEPS = 4

/** 仰角正切的下限：平視時整面只剩最頂上那一點看得到 */
const MIN_TAN_ELEVATION = 0.02

/** 算表的一個面：法線、面積、顏色（線性）、面上取樣點在幾何最高點之下多深（m） */
export interface ShadeFace {
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly area: number
  readonly r: number
  readonly g: number
  readonly b: number
  readonly depth: readonly number[]
}

/** 三盞燈換成算表用的形式：都是線性、已乘強度；`sun` 指向光源 */
export interface ShadeLights {
  readonly sun: Vector3
  readonly sunColor: Color
  readonly sky: Color
  readonly ground: Color
  readonly ambient: Color
}

/** 與 `lighting.ts` 的 `applyLightPalette` 同一套換算 */
export function shadeLightsOf(p: DayPalette): ShadeLights {
  return {
    sun: new Vector3(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize(),
    sunColor: new Color(p.sunColor).multiplyScalar(p.sunIntensity),
    sky: new Color(p.hemiSky).multiplyScalar(p.hemiIntensity),
    ground: new Color(p.hemiGround).multiplyScalar(p.hemiIntensity),
    ambient: new Color(p.ambientColor).multiplyScalar(p.ambientIntensity),
  }
}

/** 射線 `o + t·d`（t > 0）碰不碰得到三角形 abc */
function rayHits(o: Vector3, d: Vector3, a: Vector3, b: Vector3, c: Vector3): boolean {
  const e1 = new Vector3().subVectors(b, a)
  const e2 = new Vector3().subVectors(c, a)
  const pv = new Vector3().crossVectors(d, e2)
  const det = e1.dot(pv)
  if (Math.abs(det) < 1e-9) return false
  const tv = new Vector3().subVectors(o, a)
  const u = tv.dot(pv) / det
  if (u < 0 || u > 1) return false
  const qv = tv.cross(e1)
  const v = d.dot(qv) / det
  if (v < 0 || u + v > 1) return false
  return e2.dot(qv) / det > 1e-4
}

/**
 * 一個幾何的面。**從面心沿法線射出去碰得到別的面就剔掉** —— 藏在別的面底下的面
 * 看不到（例如房子的箱體頂面藏在屋頂底下），算進去的話平均輻射是錯的。凸的形狀
 * （樹冠）不受影響。
 *
 * 顏色取每個三角形第一個頂點的頂點色（池幾何的一面一色）
 */
export function shadeFaces(geo: BufferGeometry): ShadeFace[] {
  const pos = geo.getAttribute('position')
  const col = geo.getAttribute('color')
  const idx = geo.getIndex()
  const n = idx === null ? pos.count : idx.count
  let top = -Infinity
  for (let i = 0; i < pos.count; i++) top = Math.max(top, pos.getY(i))
  const tris: { a: Vector3; b: Vector3; c: Vector3; n: Vector3; ctr: Vector3; area: number; k: number }[] = []
  for (let i = 0; i + 2 < n; i += 3) {
    const ia = idx === null ? i : idx.getX(i)
    const ib = idx === null ? i + 1 : idx.getX(i + 1)
    const ic = idx === null ? i + 2 : idx.getX(i + 2)
    const a = new Vector3().fromBufferAttribute(pos, ia)
    const b = new Vector3().fromBufferAttribute(pos, ib)
    const c = new Vector3().fromBufferAttribute(pos, ic)
    const cr = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a))
    const area = cr.length() / 2
    if (area < 1e-9) continue
    const ctr = new Vector3().add(a).add(b).add(c).divideScalar(3)
    tris.push({ a, b, c, n: cr.normalize(), ctr, area, k: ia })
  }
  const out: ShadeFace[] = []
  for (const t of tris) {
    if (tris.some((u) => u !== t && rayHits(t.ctr, t.n, u.a, u.b, u.c))) continue
    const depth: number[] = []
    for (let u = 0; u < DEPTH_STEPS; u++) {
      for (let v = 0; u + v < DEPTH_STEPS; v++) {
        const y = t.a.y + (t.b.y - t.a.y) * ((u + 1 / 3) / DEPTH_STEPS) + (t.c.y - t.a.y) * ((v + 1 / 3) / DEPTH_STEPS)
        depth.push(Math.max(0, top - y))
      }
    }
    out.push({
      nx: t.n.x, ny: t.n.y, nz: t.n.z, area: t.area,
      r: col.getX(t.k), g: col.getY(t.k), b: col.getZ(t.k), depth,
    })
  }
  return out
}

/**
 * 太陽在一面上的鏡面反射（BRDF × n·L），與 three 標準材質的 `BRDF_GGX` 同一條式子：
 * 非金屬 F0 = 0.04、F90 = 1，平面著色的法線在面內不變，粗糙度就是材質的值。沒有環境
 * 貼圖時天空光與環境光不產生鏡面反射，只有太陽這一項
 */
export function sunSpecular(nx: number, ny: number, nz: number, V: Vector3, L: Vector3): number {
  const nl = Math.max(0, nx * L.x + ny * L.y + nz * L.z)
  if (nl <= 0) return 0
  const nv = Math.max(0, nx * V.x + ny * V.y + nz * V.z)
  let hx = L.x + V.x
  let hy = L.y + V.y
  let hz = L.z + V.z
  const hl = Math.hypot(hx, hy, hz) || 1
  hx /= hl
  hy /= hl
  hz /= hl
  const nh = Math.max(0, nx * hx + ny * hy + nz * hz)
  const vh = Math.max(0, V.x * hx + V.y * hy + V.z * hz)
  const alpha = FLORA_ROUGHNESS * FLORA_ROUGHNESS
  const a2 = alpha * alpha
  const fr = 0.04 + 0.96 * 2 ** ((-5.55473 * vh - 6.98316) * vh)
  const vis = 0.5 / Math.max(nl * Math.sqrt(a2 + (1 - a2) * nv * nv) + nv * Math.sqrt(a2 + (1 - a2) * nl * nl), 1e-6)
  const den = nh * nh * (a2 - 1) + 1
  const d = a2 / (Math.PI * den * den)
  return fr * vis * d * nl
}

/**
 * 一類物件轉向平均後由 `V` 看過去的平均輻射（線性，three 的輸出單位），寫進 `out`。
 *
 * 【分子分母各自加總再相除】遠處一個像素蓋好幾株轉向不同的樹，看到的是總輻射除以
 * 總投影面積，不是每個轉向的比值再平均。
 *
 * `blocking` 是林子的遮擋（`STAND_BLOCKING`），0 = 孤樹
 */
export function radianceOf(
  faces: readonly ShadeFace[], V: Vector3, L: ShadeLights, blocking: number, out: number[],
): void {
  const tanE = Math.max(MIN_TAN_ELEVATION, V.y / Math.max(1e-9, Math.hypot(V.x, V.z)))
  let r = 0
  let g = 0
  let b = 0
  let den = 0
  for (const f of faces) {
    let vis = 1
    if (blocking > 0) {
      let s = 0
      for (const d of f.depth) s += Math.exp((-blocking * d) / tanE)
      vis = s / f.depth.length
    }
    for (let y = 0; y < YAWS; y++) {
      const t = (y / YAWS) * Math.PI * 2
      const cs = Math.cos(t)
      const sn = Math.sin(t)
      // 實例轉向的寫法與 `vegetationRebuild.ts` 的矩陣相同：繞 Y 轉
      const nx = f.nx * cs + f.nz * sn
      const nz = -f.nx * sn + f.nz * cs
      const pr = nx * V.x + f.ny * V.y + nz * V.z
      if (pr <= 0) continue
      const w = f.area * pr * vis
      const nl = Math.max(0, nx * L.sun.x + f.ny * L.sun.y + nz * L.sun.z)
      const hw = 0.5 + 0.5 * f.ny
      // 鏡面那一項沒有 1/π：先乘 π，最後與漫射一起除
      const sp = Math.PI * sunSpecular(nx, f.ny, nz, V, L.sun)
      r += w * (f.r * (L.sunColor.r * nl + L.ground.r + (L.sky.r - L.ground.r) * hw + L.ambient.r) + sp * L.sunColor.r)
      g += w * (f.g * (L.sunColor.g * nl + L.ground.g + (L.sky.g - L.ground.g) * hw + L.ambient.g) + sp * L.sunColor.g)
      b += w * (f.b * (L.sunColor.b * nl + L.ground.b + (L.sky.b - L.ground.b) * hw + L.ambient.b) + sp * L.sunColor.b)
      den += w
    }
  }
  const d = (den > 0 ? den : 1) * Math.PI
  out[0] = r / d
  out[1] = g / d
  out[2] = b / d
}

/** 表格點 (i, j) 的 c、s 換成物件指向鏡頭的方向。太陽水平方向是 `(sx, sz)` */
export function cellToCamera(i: number, j: number, sx: number, sz: number, out: Vector3): Vector3 {
  const c = -1 + (2 * i) / (VIEW_SHADE_COLS - 1)
  const s = j / (VIEW_SHADE_ROWS - 1)
  const phi = Math.acos(Math.max(-1, Math.min(1, c)))
  const vx = sx * Math.cos(phi) - sz * Math.sin(phi)
  const vz = sx * Math.sin(phi) + sz * Math.cos(phi)
  const ce = Math.sqrt(Math.max(0, 1 - s * s))
  return out.set(-vx * ce, s, -vz * ce)
}

/**
 * 點在表乘上去之前的顏色（線性）：樹冠色 × 明度中值 × 材質色。材質色是時段倍率乘染色，
 * 與 `createVegetationPools` 的 `setPointLight` 同一條式子
 */
export function pointBaseOf(pool: PointPool, season: Season, p: DayPalette, out = new Color()): Color {
  const t = (TINT_RANGE.plant[0] + TINT_RANGE.plant[1]) / 2
  return out.set(pointColorOf(pool, season))
    .multiply(new Color().setHex(p.foliageTint ?? 0xffffff).multiplyScalar(p.foliage))
    .multiplyScalar(t)
}

/**
 * 整張表，RGBA（A 恆為 1），列優先：第 `row` 類、第 `j` 個 s、第 `i` 個 c 在
 * `((row·ROWS + j)·COLS + i)·4`。
 *
 * **建地形與換時段時跑**，會配置。`blocking` 是林子的遮擋（量測用可給 0）
 */
export function buildViewShadeTable(p: DayPalette, season: Season, blocking = STAND_BLOCKING): Float32Array {
  const geos = createFloraGeometries(season)
  const classes = [shadeFaces(geos.broadMid), shadeFaces(geos.coneMid), shadeFaces(geos.bushMid)]
  disposeFloraGeometries(geos)
  const L = shadeLightsOf(p)
  const h = Math.hypot(L.sun.x, L.sun.z)
  // 太陽在正頂上時沒有水平方向，表與 c 無關，隨便取一個
  const sx = h > 1e-6 ? L.sun.x / h : 1
  const sz = h > 1e-6 ? L.sun.z / h : 0
  const base = ROW_POOL.map((pool) => pointBaseOf(pool, season, p))
  // 灌木不算遮擋：見 `STAND_BLOCKING`
  const block = [blocking, blocking, 0]
  const out = new Float32Array(VIEW_SHADE_CLASSES * VIEW_SHADE_ROWS * VIEW_SHADE_COLS * 4)
  const V = new Vector3()
  const rad = [0, 0, 0]
  for (let j = 0; j < VIEW_SHADE_ROWS; j++) {
    for (let i = 0; i < VIEW_SHADE_COLS; i++) {
      cellToCamera(i, j, sx, sz, V)
      for (let row = 0; row < classes.length; row++) {
        radianceOf(classes[row]!, V, L, block[row]!, rad)
        const o = ((row * VIEW_SHADE_ROWS + j) * VIEW_SHADE_COLS + i) * 4
        const b = base[row]!
        out[o] = rad[0]! / b.r
        out[o + 1] = rad[1]! / b.g
        out[o + 2] = rad[2]! / b.b
        out[o + 3] = 1
      }
    }
  }
  return out
}

/**
 * 查表，與 `VIEW_SHADE_GLSL` 的 `viewShade` 同一套索引（雙線性）。`toCam` 是物件指向
 * 鏡頭的單位向量，`(sunX, sunZ)` 是太陽的水平方向（單位向量）
 */
export function viewShadeAt(
  table: Float32Array, row: ViewShadeRow, toCam: Vector3, sunX: number, sunZ: number,
): [number, number, number] {
  const hl = Math.hypot(toCam.x, toCam.z)
  const c = hl > 1e-5 ? (-toCam.x / hl) * sunX + (-toCam.z / hl) * sunZ : 0
  const s = Math.min(1, Math.max(0, toCam.y))
  const fx = (c * 0.5 + 0.5) * (VIEW_SHADE_COLS - 1)
  const fy = s * (VIEW_SHADE_ROWS - 1)
  const i0 = Math.min(VIEW_SHADE_COLS - 2, Math.floor(fx))
  const j0 = Math.min(VIEW_SHADE_ROWS - 2, Math.floor(fy))
  const tx = fx - i0
  const ty = fy - j0
  const at = (i: number, j: number, k: number): number =>
    table[((row * VIEW_SHADE_ROWS + j) * VIEW_SHADE_COLS + i) * 4 + k]!
  const out: [number, number, number] = [0, 0, 0]
  for (let k = 0; k < 3; k++) {
    const a = at(i0, j0, k) + (at(i0 + 1, j0, k) - at(i0, j0, k)) * tx
    const b = at(i0, j0 + 1, k) + (at(i0 + 1, j0 + 1, k) - at(i0, j0 + 1, k)) * tx
    out[k] = a + (b - a) * ty
  }
  return out
}

/**
 * 著色器那一半：uniform 宣告與 `vec3 viewShade(float row, vec3 toCam)`。`toCam` 是
 * 物件指向鏡頭的**單位**向量（世界座標）。`uViewShadeOn` 為 0 時回 1（同頁 A/B 用）。
 *
 * 【取樣點落在格心】第 i 格的中心在 `(i + 0.5) / COLS`，表的兩端是格心不是貼圖邊 ——
 * 直接用 c 當 u 的話迎光那一端讀到的是半格外的夾邊值，整列往背光偏半格
 */
export const VIEW_SHADE_GLSL = `
uniform sampler2D uViewShade;
uniform vec2 uViewSunH;
uniform float uViewShadeOn;
vec3 viewShade(float row, vec3 toCam) {
  float hl = length(toCam.xz);
  float c = hl > 1.0e-5 ? dot(-toCam.xz / hl, uViewSunH) : 0.0;
  float s = clamp(toCam.y, 0.0, 1.0);
  vec2 uv = vec2(
    ((c * 0.5 + 0.5) * ${(VIEW_SHADE_COLS - 1).toFixed(1)} + 0.5) / ${VIEW_SHADE_COLS.toFixed(1)},
    (row * ${VIEW_SHADE_ROWS.toFixed(1)} + s * ${(VIEW_SHADE_ROWS - 1).toFixed(1)} + 0.5) / ${(VIEW_SHADE_CLASSES * VIEW_SHADE_ROWS).toFixed(1)});
  return mix(vec3(1.0), texture(uViewShade, uv).rgb, uViewShadeOn);
}
`

/** 一張地形的表：貼圖與 uniform。**所有用它的材質共用同一組 uniform 物件** */
export interface ViewShade {
  readonly uniforms: {
    readonly uViewShade: { value: DataTexture }
    readonly uViewSunH: { value: Vector2 }
    readonly uViewShadeOn: { value: number }
  }
  /** 換時段：重算整張表。與三盞燈、`setPointLight` 同一份色盤（`applyTimeOfDay`） */
  setPalette(p: DayPalette): void
  dispose(): void
}

/**
 * 建的時候先用正午算一次 —— 沒有呼叫 `setPalette` 的場合（工具頁、量測台）與正午的
 * 燈對得上
 */
export function createViewShade(season: Season): ViewShade {
  const data = new Uint16Array(VIEW_SHADE_CLASSES * VIEW_SHADE_ROWS * VIEW_SHADE_COLS * 4)
  const tex = new DataTexture(data, VIEW_SHADE_COLS, VIEW_SHADE_CLASSES * VIEW_SHADE_ROWS, RGBAFormat, HalfFloatType)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  const sunH = new Vector2(1, 0)
  const fill = (p: DayPalette): void => {
    const t = buildViewShadeTable(p, season)
    for (let i = 0; i < t.length; i++) data[i] = DataUtils.toHalfFloat(t[i]!)
    tex.needsUpdate = true
    const h = Math.hypot(p.sunDir[0], p.sunDir[2])
    if (h > 1e-6) sunH.set(p.sunDir[0] / h, p.sunDir[2] / h)
    else sunH.set(1, 0)
  }
  fill(DAY_PALETTES.noon)
  return {
    uniforms: { uViewShade: { value: tex }, uViewSunH: { value: sunH }, uViewShadeOn: { value: 1 } },
    setPalette: fill,
    dispose() { tex.dispose() },
  }
}
