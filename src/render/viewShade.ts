import {
  ClampToEdgeWrapping, Color, DataTexture, DataUtils, HalfFloatType, LinearFilter, RGBAFormat,
  Vector2, Vector3, type BufferGeometry,
} from 'three'
import { createFloraGeometries, disposeFloraGeometries } from './floraShapes'
import { DAY_PALETTES, type DayPalette } from './timeOfDay'
import type { Season } from './season'

/**
 * # 遠處的點隨視角變亮暗
 *
 * 3～6 km 的樹是不吃光照的點，顏色定死；它取代的中級樹冠卻看鏡頭在太陽哪一側：
 * 迎光看到背光面、背光看到受光面。不補的話迎著太陽飛過 3 km，林子突然暗一截。
 *
 * 這裡算**視角係數** `K(V) = R(V) / R(正上方)`，逐通道。`R(V)` 是一個樹種從方向 `V`
 * （物件指向鏡頭）看過去每單位投影面積的平均輻射，面取實際的中級幾何、轉向平均：
 *
 * ```
 * R(V) = Σ A·max(0, n·V)·albedo·E(n) / Σ A·max(0, n·V)
 * E(n) = 太陽·max(0, n·L) + mix(地色, 天色, ½ + ½·n.y)·半球 + 環境光
 * ```
 *
 * 與 three 的 Lambert 相同（1/π 約掉），鏡面項不算（材質粗糙度 0.9）。
 *
 * 【正上方 = 1】點的亮度（`POINT_TOPDOWN_GAIN`）是俯視校的，俯視時不動，其他角度乘 K。
 *
 * 【查表】太陽開局後固定，K 只與兩個數有關：c = 水平視線與太陽水平方向的夾角
 * 餘弦（迎光 1、背光 −1）、s = 鏡頭的仰角正弦（物件指向鏡頭那條線的 y）。CPU 在
 * `setPalette` 時算一張表，著色器查一次（`VIEW_SHADE_GLSL`）。
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

/** 轉向平均取幾個方位。實例的轉向是亂數；八面體四重、錐六重對稱，16 個夠密 */
const YAWS = 16

/** 算係數的一個面：法線、面積、顏色（線性） */
export interface ShadeFace {
  readonly nx: number
  readonly ny: number
  readonly nz: number
  readonly area: number
  readonly r: number
  readonly g: number
  readonly b: number
}

/** 三盞燈換成算係數用的形式：都是線性、已乘強度；`sun` 指向光源 */
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
 * 顏色取每個三角形第一個頂點的頂點色（池幾何的一面一色）。
 */
export function shadeFaces(geo: BufferGeometry): ShadeFace[] {
  const pos = geo.getAttribute('position')
  const col = geo.getAttribute('color')
  const idx = geo.getIndex()
  const n = idx === null ? pos.count : idx.count
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
    out.push({
      nx: t.n.x, ny: t.n.y, nz: t.n.z, area: t.area,
      r: col.getX(t.k), g: col.getY(t.k), b: col.getZ(t.k),
    })
  }
  return out
}

/**
 * 一類物件轉向平均後由 `V` 看過去的平均輻射，寫進 `out`（RGB）。
 *
 * 【分子分母各自加總再相除】遠處一個像素蓋好幾株轉向不同的樹，看到的是總輻射除以
 * 總投影面積，不是每個轉向的比值再平均
 */
function radianceOf(faces: readonly ShadeFace[], V: Vector3, L: ShadeLights, out: number[]): void {
  let r = 0
  let g = 0
  let b = 0
  let den = 0
  for (let y = 0; y < YAWS; y++) {
    const t = (y / YAWS) * Math.PI * 2
    const cs = Math.cos(t)
    const sn = Math.sin(t)
    for (const f of faces) {
      // 實例轉向的寫法與 `vegetation.ts` 的矩陣相同：繞 Y 轉
      const nx = f.nx * cs + f.nz * sn
      const nz = -f.nx * sn + f.nz * cs
      const pr = nx * V.x + f.ny * V.y + nz * V.z
      if (pr <= 0) continue
      const w = f.area * pr
      const nl = Math.max(0, nx * L.sun.x + f.ny * L.sun.y + nz * L.sun.z)
      const hw = 0.5 + 0.5 * f.ny
      r += w * f.r * (L.sunColor.r * nl + L.ground.r + (L.sky.r - L.ground.r) * hw + L.ambient.r)
      g += w * f.g * (L.sunColor.g * nl + L.ground.g + (L.sky.g - L.ground.g) * hw + L.ambient.g)
      b += w * f.b * (L.sunColor.b * nl + L.ground.b + (L.sky.b - L.ground.b) * hw + L.ambient.b)
      den += w
    }
  }
  const d = den > 0 ? den : 1
  out[0] = r / d
  out[1] = g / d
  out[2] = b / d
}

/** 表格點 (i, j) 的 c、s 換成物件指向鏡頭的方向。太陽水平方向是 `(sx, sz)` */
function cellToCamera(i: number, j: number, sx: number, sz: number, out: Vector3): Vector3 {
  const c = -1 + (2 * i) / (VIEW_SHADE_COLS - 1)
  const s = j / (VIEW_SHADE_ROWS - 1)
  const phi = Math.acos(Math.max(-1, Math.min(1, c)))
  const vx = sx * Math.cos(phi) - sz * Math.sin(phi)
  const vz = sx * Math.sin(phi) + sz * Math.cos(phi)
  const ce = Math.sqrt(Math.max(0, 1 - s * s))
  return out.set(-vx * ce, s, -vz * ce)
}

/**
 * 整張表，RGBA（A 恆為 1），列優先：第 `row` 類、第 `j` 個 s、第 `i` 個 c 在
 * `((row·ROWS + j)·COLS + i)·4`。
 *
 * **建地形與換時段時跑**，會配置。
 */
export function buildViewShadeTable(L: ShadeLights, season: Season): Float32Array {
  const geos = createFloraGeometries(season)
  const classes = [shadeFaces(geos.broadMid), shadeFaces(geos.coneMid), shadeFaces(geos.bushMid)]
  disposeFloraGeometries(geos)
  const h = Math.hypot(L.sun.x, L.sun.z)
  // 太陽在正頂上時沒有水平方向，K 與 c 無關，隨便取一個
  const sx = h > 1e-6 ? L.sun.x / h : 1
  const sz = h > 1e-6 ? L.sun.z / h : 0
  const up = new Vector3(0, 1, 0)
  const top = classes.map((f) => {
    const o = [0, 0, 0]
    radianceOf(f, up, L, o)
    return o
  })
  const out = new Float32Array(VIEW_SHADE_CLASSES * VIEW_SHADE_ROWS * VIEW_SHADE_COLS * 4)
  const V = new Vector3()
  const rad = [0, 0, 0]
  for (let j = 0; j < VIEW_SHADE_ROWS; j++) {
    for (let i = 0; i < VIEW_SHADE_COLS; i++) {
      cellToCamera(i, j, sx, sz, V)
      for (let row = 0; row < classes.length; row++) {
        radianceOf(classes[row]!, V, L, rad)
        const o = ((row * VIEW_SHADE_ROWS + j) * VIEW_SHADE_COLS + i) * 4
        const t = top[row]!
        out[o] = rad[0]! / t[0]!
        out[o + 1] = rad[1]! / t[1]!
        out[o + 2] = rad[2]! / t[2]!
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

/** 一張地形的係數：貼圖與 uniform。**所有用它的材質共用同一組 uniform 物件** */
export interface ViewShade {
  readonly uniforms: {
    readonly uViewShade: { value: DataTexture }
    readonly uViewSunH: { value: Vector2 }
    readonly uViewShadeOn: { value: number }
  }
  /** 換時段：重算整張表。與三盞燈同一份色盤（`applyTimeOfDay`） */
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
    const L = shadeLightsOf(p)
    const t = buildViewShadeTable(L, season)
    for (let i = 0; i < t.length; i++) data[i] = DataUtils.toHalfFloat(t[i]!)
    tex.needsUpdate = true
    const h = Math.hypot(L.sun.x, L.sun.z)
    if (h > 1e-6) sunH.set(L.sun.x / h, L.sun.z / h)
    else sunH.set(1, 0)
  }
  fill(DAY_PALETTES.noon)
  return {
    uniforms: { uViewShade: { value: tex }, uViewSunH: { value: sunH }, uViewShadeOn: { value: 1 } },
    setPalette: fill,
    dispose() { tex.dispose() },
  }
}
