import {
  Color, DataUtils, FogExp2, Mesh, MeshStandardMaterial, PlaneGeometry, Vector2, Vector3,
} from 'three'
import { createScene } from '../render/scene'
import { paletteOf, type DayPalette, type TimeOfDay } from '../render/timeOfDay'
import { createVegetationPools } from '../render/vegetationPools'
import { createVegetationRebuild } from '../render/vegetationRebuild'
import { POOL_NAMES } from '../render/vegetationPolicy'
import { POINT_SIZE, type PointPool, type PoolName } from '../render/floraShapes'
import {
  buildViewShadeTable, createViewShade, pointBaseOf, STAND_BLOCKING, VIEW_SHADE_GLSL, ViewShadeRow,
} from '../render/viewShade'
import { canopyColor, FIELD_COLORS, FLORA_COLORS, type Season } from '../render/season'
import { TREE_DOT_SHADE, WOOD_GRID } from '../render/fields'
import { matteGround } from '../render/matteGround'
import { TREE_SCALE } from '../specs/flora'
import { createFloraBuffer, FloraKind, pushFlora, type FloraBuffer } from '../core/floraBuffer'
import { hash1, hash2 } from '../core/hash'
import { DEG } from '../core/math'

/**
 * 林子遠近展示區 —— 純調校用的開發工具，不屬於遊戲。
 *
 * 【這一頁看什麼】同一片林子、同一批樹，並排畫成四種樣子：立體樹（高模）、簡易樹冠
 * （中級）、點、烘圖（植被圈外的地面）。四塊離鏡頭一樣遠、看的角度一樣，亮度該一樣；
 * 標籤上是每一塊的平均亮度與它和立體樹的差。
 *
 * 【走遊戲的路徑】樹走 `createVegetationPools` ＋ `createVegetationRebuild`（矩陣、
 * 明度抖動、點的顏色與著色器都是遊戲那一份），燈走 `createScene`，換時段走與
 * `terrain.ts` 相同的三件事。烘圖那一塊是遠圖裡樹林田的顏色（`TREE_DOT_SHADE` 乘樹冠色），
 * 材質與光照同田色 clipmap（粗糙度 0.95、`matteGround`）。
 *
 * 點的表是遊戲那一份（`viewShade.ts`）；林子遮擋的滑桿用同一個算法重算表蓋上去。
 *
 * 【烘圖的「新」做法只在這一頁】林間的地照一般地面打光；樹冠那一份照點的算式（`pointBaseOf`
 * × 表）、不反光，佔的比例是點從這個仰角看過去蓋住地面的比例（`gapDensity`）。
 *
 * 進入方式：`npm run dev` 之後開 /tools/canopy.html。**不在 `vite.config.ts` 的建置清單裡**，
 * 不會進正式版。
 */

const SEASON: Season = 'lateAutumn'
/** 德 M3 的地形；色盤的覆寫跟著它 */
const TERRAIN = 'asch' as const
/** 一塊林子左右方向的半寬，m；量亮度的框取中心 ±0.8 倍這個值的方形 */
const HALF = 240
/**
 * 林子前後方向最深多少的一半，m。很平的角度看過去，視線從樹冠底下穿過；林子太淺的話
 * 會一路穿到後面的田，量到的不是林子的顏色
 */
const MAX_DEPTH_HALF = 2000
/** 相鄰兩塊的中心距，m */
const PITCH = 600
const STRIPS = ['立體樹', '簡易樹冠', '點', '烘圖'] as const
/** 三塊有樹的各用哪一級：高模、中級、點（`BROAD_BY_LOD` 的索引） */
const STRIP_LOD = [0, 2, 3] as const

type Species = 'broad' | 'cone'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

// ── 同一批樹 ──────────────────────────────────────────
/**
 * 一塊林子的樹，座標以塊的中心為原點。與 `flora.ts` 的 `woods` 同一套：16 m 一格一株、
 * 雜湊定位置與轉向、`TREE_SCALE` 之間的縮放
 */
interface Tree { readonly u: number; readonly v: number; readonly rot: number; readonly scale: number }
const TREES: Tree[] = []
{
  const n = Math.round(HALF / WOOD_GRID)
  const nd = Math.round(MAX_DEPTH_HALF / WOOD_GRID)
  for (let gz = -nd; gz < nd; gz++) {
    for (let gx = -n; gx < n; gx++) {
      const h = hash2(gx + 1000, gz + 1000)
      const g = hash1(h)
      const g2 = hash1(g)
      TREES.push({
        u: (gx + 0.15 + (h / 4294967296) * 0.7) * WOOD_GRID,
        v: (gz + 0.15 + (g / 4294967296) * 0.7) * WOOD_GRID,
        rot: (g2 / 4294967296) * Math.PI * 2,
        scale: TREE_SCALE[0] + (hash1(g2) / 4294967296) * (TREE_SCALE[1] - TREE_SCALE[0]),
      })
    }
  }
}
/** 樹林田的明度抖動整塊一個值；取中間，乘上去是 1 */
const TREE_TINT = 0.5

// ── 植被池 ────────────────────────────────────────────
const shade = createViewShade(SEASON)
const cap = Object.fromEntries(POOL_NAMES.map((n) => [n, TREES.length + 16])) as Record<PoolName, number>
const pools = createVegetationPools(cap, SEASON, STRIP_LOD.length, shade)
ctx.scene.add(pools.group)
const slotBuf: FloraBuffer[] = STRIP_LOD.map(() => createFloraBuffer(TREES.length))
const tiles = {
  slotBuf,
  slotUsed: new Uint8Array(STRIP_LOD.length).fill(1),
  slotLod: Int8Array.from(STRIP_LOD),
  slotBush: new Int8Array(STRIP_LOD.length).fill(-1),
  // 這一頁不淡化（重建不帶 fade），畫面上的級數不讀
  slotShownLod: Int8Array.from(STRIP_LOD),
  slotShownBush: new Int8Array(STRIP_LOD.length).fill(-1),
  slotKey: Float64Array.from(STRIP_LOD.map((_, i) => i)),
}
const rebuild = createVegetationRebuild(cap, tiles, pools, { overflow: 0, rebuilds: 0 })

// ── 地面：田、林地、烘圖 ───────────────────────────────
/** 地面著色器的 uniform。視角係數的表與太陽方向與點共用，開關各自一個 */
const groundUniforms = {
  uViewShade: shade.uniforms.uViewShade,
  uViewSunH: shade.uniforms.uViewSunH,
  uViewShadeOn: { value: 1 },
  uStripC: { value: [0, 1, 2, 3].map(() => new Vector3()) },
  uStripR: { value: new Vector3(1, 0, 0) },
  uStripF: { value: new Vector3(0, 0, -1) },
  /** 左右的半寬、前後的半深 */
  uStripHalf: { value: new Vector2(HALF, HALF) },
  uFieldColor: { value: new Color(FIELD_COLORS[SEASON].ploughed) },
  uWoodColor: { value: new Color(FIELD_COLORS[SEASON].wood) },
  uBakeColor: { value: new Color() },
  uBakeMode: { value: 0 },
  uCanopyColor: { value: new Color() },
  uCanopyRow: { value: ViewShadeRow.Broad as number },
  uGapDensity: { value: 0 },
  uGapOn: { value: 1 },
}
const groundMaterial = new MeshStandardMaterial({ flatShading: true, roughness: 0.95 })
groundMaterial.onBeforeCompile = (shader) => {
  Object.assign(shader.uniforms, groundUniforms)
  shader.vertexShader = 'varying vec3 vCanopyWorld;\n' + shader.vertexShader.replace(
    '#include <project_vertex>',
    '#include <project_vertex>\nvCanopyWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;')
  // 塊的判定：w 投到塊的左右軸與前後軸，兩個都在半邊長以內。
  // 第 3 塊是烘圖：現在的做法是一般地面、底色是遠圖的樹林色；新做法底色是林地，打完光再把
  // 樹冠那一份換成點的算式
  shader.fragmentShader = `varying vec3 vCanopyWorld;
uniform vec3 uStripC[4];
uniform vec3 uStripR;
uniform vec3 uStripF;
uniform vec2 uStripHalf;
uniform vec3 uFieldColor;
uniform vec3 uWoodColor;
uniform vec3 uBakeColor;
uniform float uBakeMode;
uniform vec3 uCanopyColor;
uniform float uCanopyRow;
uniform float uGapDensity;
uniform float uGapOn;
${VIEW_SHADE_GLSL}
int canopyStripAt(vec3 w) {
  for (int i = 0; i < 4; i++) {
    vec3 d = w - uStripC[i];
    if (abs(dot(d, uStripR)) < uStripHalf.x && abs(dot(d, uStripF)) < uStripHalf.y) return i;
  }
  return -1;
}
` + shader.fragmentShader
    .replace('#include <color_fragment>', `#include <color_fragment>
int canopyStrip = canopyStripAt(vCanopyWorld);
diffuseColor.rgb = canopyStrip < 0 ? uFieldColor
  : canopyStrip == 3 && uBakeMode < 0.5 ? uBakeColor : uWoodColor;`)
    .replace('#include <opaque_fragment>', `if (canopyStrip == 3 && uBakeMode > 0.5) {
  vec3 toCam = normalize(cameraPosition - vCanopyWorld);
  vec3 canopy = uCanopyColor * viewShade(uCanopyRow, toCam);
  float cover = uGapOn > 0.5 ? 1.0 - exp(-uGapDensity / max(toCam.y, 0.02)) : 1.0;
  outgoingLight = mix(outgoingLight, canopy, cover);
}
#include <opaque_fragment>`)
}
groundMaterial.customProgramCacheKey = () => 'canopy-demo-ground'
matteGround(groundMaterial)
const ground = new Mesh(new PlaneGeometry(80000, 80000), groundMaterial)
ground.rotation.x = -Math.PI / 2
ctx.scene.add(ground)

// ── 狀態 ──────────────────────────────────────────────
const state = {
  tod: 'dawn' as TimeOfDay,
  species: 'broad' as Species,
  /** 0 = 背光（太陽在鏡頭背後）、180 = 迎光 */
  az: 0,
  elev: 15,
  dist: 4000,
  /** 林子前後方向的深度，m */
  depth: 480,
  pointK: true,
  bakeNew: false,
  /** 林子的遮擋，1/m。預設是遊戲的值（`STAND_BLOCKING`） */
  blocking: STAND_BLOCKING,
  /** 林間空隙的式子乘多少：1 = 隨機撒的樹 */
  gapScale: 1,
  gap: true,
  fog: false,
}
let palette: DayPalette = paletteOf(state.tod, TERRAIN)
const forward = new Vector3()
const right = new Vector3()
const centres = [0, 1, 2, 3].map(() => new Vector3())

function pointPool(): PointPool {
  return state.species === 'broad' ? 'broadPoint' : 'conePoint'
}

/**
 * 點蓋住地面的比例由 `uGapDensity / sin 仰角` 決定：一格一株、點的平均面積，乘
 * `state.gapScale`。樹排在抖動的格點上，彼此重疊比隨機撒的少，蓋住的比例比隨機的式子高
 */
function gapDensity(): number {
  const s = POINT_SIZE[pointPool()]
  // 縮放在 TREE_SCALE 之間均勻分布，E[scale²] = (b³ − a³) / (3(b − a))
  const [a, b] = TREE_SCALE
  const e2 = (b ** 3 - a ** 3) / (3 * (b - a))
  return (s * s * e2 * state.gapScale) / (WOOD_GRID * WOOD_GRID)
}

/**
 * 遮擋不是遊戲的值（`STAND_BLOCKING`）時，用這一頁的值重算整張表蓋上去。表的算法是遊戲
 * 那一份（`buildViewShadeTable`）
 */
function applyBlocking(): void {
  if (state.blocking === STAND_BLOCKING) return
  const t = buildViewShadeTable(palette, SEASON, state.blocking)
  const tex = shade.uniforms.uViewShade.value
  const data = tex.image.data as Uint16Array
  for (let i = 0; i < t.length; i++) data[i] = DataUtils.toHalfFloat(t[i]!)
  tex.needsUpdate = true
}

function applyPalette(): void {
  palette = paletteOf(state.tod, TERRAIN)
  ctx.setPalette(palette)
  shade.setPalette(palette)
  applyBlocking()
  pools.setPointLight(palette.foliage, palette.foliageTint)
  ;(ctx.scene.fog as FogExp2).density = state.fog ? palette.fogDensity : 0
  // 樹冠那一份 = 點在表乘上去之前的顏色 × 表，與點同一條式子
  pointBaseOf(pointPool(), SEASON, palette, groundUniforms.uCanopyColor.value)
  const leaf = state.species === 'broad' ? FLORA_COLORS[SEASON].broadLeaf : FLORA_COLORS[SEASON].conifer
  groundUniforms.uBakeColor.value.copy(canopyColor(leaf)).multiplyScalar(TREE_DOT_SHADE)
  groundUniforms.uCanopyRow.value = state.species === 'broad' ? ViewShadeRow.Broad : ViewShadeRow.Cone
  groundUniforms.uGapDensity.value = gapDensity()
}

/** 鏡頭與四塊的擺法：四塊排在鏡頭的左右方向上，鏡頭對著中間 */
function layout(): void {
  const sx = palette.sunDir[0]
  const sz = palette.sunDir[2]
  const h = Math.hypot(sx, sz) || 1
  const a = state.az * DEG
  const fx = -sx / h
  const fz = -sz / h
  forward.set(Math.cos(a) * fx - Math.sin(a) * fz, 0, Math.sin(a) * fx + Math.cos(a) * fz)
  right.set(-forward.z, 0, forward.x)
  for (let i = 0; i < 4; i++) centres[i]!.copy(right).multiplyScalar((i - 1.5) * PITCH)
  groundUniforms.uStripR.value.copy(right)
  groundUniforms.uStripF.value.copy(forward)
  groundUniforms.uStripC.value.forEach((c, i) => c.copy(centres[i]!))
  groundUniforms.uStripHalf.value.set(HALF, state.depth / 2)

  const kind = state.species === 'broad' ? FloraKind.BroadTree : FloraKind.ConeTree
  for (let s = 0; s < STRIP_LOD.length; s++) {
    const buf = slotBuf[s]!
    buf.count = 0
    const c = centres[s]!
    for (const t of TREES) {
      if (Math.abs(t.v) >= state.depth / 2) continue
      const x = c.x + right.x * t.u + forward.x * t.v
      const z = c.z + right.z * t.u + forward.z * t.v
      pushFlora(buf, x, 0, z, t.rot, t.scale, TREE_TINT, kind)
    }
  }
  const dirty = Object.fromEntries(POOL_NAMES.map((n) => [n, true])) as Record<PoolName, boolean>
  rebuild.start(dirty)
  while (!rebuild.step(1e9)) { /* 一次寫完 */ }

  const e = Math.min(state.elev, 89.5) * DEG
  const cam = ctx.camera
  cam.position.set(-forward.x * state.dist * Math.cos(e), state.dist * Math.sin(e), -forward.z * state.dist * Math.cos(e))
  cam.up.set(0, 1, 0)
  cam.lookAt(0, 0, 0)
  const halfW = Math.atan((2 * PITCH + 200) / state.dist)
  cam.fov = (2 * Math.atan(Math.tan(halfW) / cam.aspect)) / DEG
  cam.near = 5
  cam.far = 100000
  cam.updateProjectionMatrix()
}

// ── 量亮度 ────────────────────────────────────────────
const srgbToLinear = new Float32Array(256).map((_, i) => {
  const c = i / 255
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
})
const linearToSrgb = (l: number): number =>
  255 * (l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055)
const readings: number[] = [0, 0, 0, 0]
const corner = new Vector3()

/** 每一塊內縮兩成的方框投到畫面上的外接矩形，量裡面的平均亮度（線性，回傳 sRGB 0–255） */
function measure(): void {
  const gl = ctx.renderer.getContext()
  const w = gl.drawingBufferWidth
  const hgt = gl.drawingBufferHeight
  for (let i = 0; i < 4; i++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
    for (const [p, q] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) {
      corner.copy(centres[i]!)
        .addScaledVector(right, p * HALF * 0.8).addScaledVector(forward, q * HALF * 0.8)
        .project(ctx.camera)
      x0 = Math.min(x0, corner.x); x1 = Math.max(x1, corner.x)
      y0 = Math.min(y0, corner.y); y1 = Math.max(y1, corner.y)
    }
    const px0 = Math.max(0, Math.floor((x0 + 1) / 2 * w))
    const px1 = Math.min(w, Math.ceil((x1 + 1) / 2 * w))
    const py0 = Math.max(0, Math.floor((y0 + 1) / 2 * hgt))
    const py1 = Math.min(hgt, Math.ceil((y1 + 1) / 2 * hgt))
    const bw = px1 - px0
    const bh = py1 - py0
    if (bw <= 0 || bh <= 0) { readings[i] = NaN; continue }
    const buf = new Uint8Array(bw * bh * 4)
    gl.readPixels(px0, py0, bw, bh, gl.RGBA, gl.UNSIGNED_BYTE, buf)
    let sum = 0
    for (let k = 0; k < buf.length; k += 4) {
      sum += 0.2126 * srgbToLinear[buf[k]!]! + 0.7152 * srgbToLinear[buf[k + 1]!]! + 0.0722 * srgbToLinear[buf[k + 2]!]!
    }
    readings[i] = linearToSrgb(sum / (bw * bh))
  }
}

// ── 標籤 ──────────────────────────────────────────────
const tags = STRIPS.map(() => {
  const d = document.createElement('div')
  d.className = 'tag'
  document.body.appendChild(d)
  return d
})
function placeTags(): void {
  const rect = canvas.getBoundingClientRect()
  for (let i = 0; i < 4; i++) {
    corner.copy(centres[i]!).addScaledVector(forward, state.depth / 2).setY(30).project(ctx.camera)
    const tag = tags[i]!
    tag.style.left = `${rect.left + (corner.x + 1) / 2 * rect.width}px`
    tag.style.top = `${rect.top + (1 - corner.y) / 2 * rect.height - 6}px`
    const v = readings[i]!
    const ref = readings[0]!
    const diff = i === 0 || !(ref > 0) ? '' : ` (${v / ref >= 1 ? '+' : ''}${((v / ref - 1) * 100).toFixed(0)}%)`
    const name = i === 3 ? `烘圖（${state.bakeNew ? '新' : '現在'}）` : STRIPS[i]!
    tag.textContent = `${name}\n${Number.isFinite(v) ? v.toFixed(1) : '—'}${diff}`
  }
}

// ── 面板 ──────────────────────────────────────────────
function buttons<T>(id: string, items: readonly (readonly [string, T])[], get: () => T, set: (v: T) => void): () => void {
  const host = document.getElementById(id)!
  const els = items.map(([label, v]) => {
    const b = document.createElement('button')
    b.textContent = label
    b.onclick = () => { set(v); refresh() }
    host.appendChild(b)
    return [b, v] as const
  })
  return () => { for (const [b, v] of els) b.classList.toggle('on', v === get()) }
}
const syncs: (() => void)[] = []
/** 整套切換：遊戲現在的做法，與這一頁調出來的新做法 */
const SETS = {
  now: { gapScale: 1, bakeNew: false },
  new: { gapScale: 1.4, bakeNew: true },
} as const
syncs.push(buttons('set', [['現在', 'now'], ['新', 'new']] as const,
  () => (Object.keys(SETS) as (keyof typeof SETS)[])
    .find((k) => Object.entries(SETS[k]).every(([f, v]) => state[f as keyof typeof SETS.now] === v)) ?? null,
  (v) => {
    if (v === null) return
    Object.assign(state, SETS[v])
    groundUniforms.uBakeMode.value = state.bakeNew ? 1 : 0
    applyPalette()
  }))
syncs.push(buttons('tod', [['清晨', 'dawn'], ['正午', 'noon'], ['黃昏', 'dusk']] as const,
  () => state.tod, (v) => { state.tod = v; applyPalette() }))
syncs.push(buttons('species', [['闊葉', 'broad'], ['針葉', 'cone']] as const,
  () => state.species, (v) => { state.species = v; applyPalette() }))
syncs.push(buttons('presetSide', [['背光', 0], ['側光', 90], ['迎光', 180]] as const,
  () => state.az, (v) => { state.az = v }))
syncs.push(buttons('presetElev', [['6°', 6], ['15°', 15], ['30°', 30], ['60°', 60], ['俯視', 90]] as const,
  () => state.elev, (v) => { state.elev = v }))
syncs.push(buttons('pointK', [['角度係數 開', true], ['關', false]] as const,
  () => state.pointK, (v) => { state.pointK = v; shade.uniforms.uViewShadeOn.value = v ? 1 : 0 }))
syncs.push(buttons('bake', [['現在（一般地面）', false], ['新（跟點同一套）', true]] as const,
  () => state.bakeNew, (v) => { state.bakeNew = v; groundUniforms.uBakeMode.value = v ? 1 : 0 }))
syncs.push(buttons('gap', [['算', true], ['不算', false]] as const,
  () => state.gap, (v) => { state.gap = v; groundUniforms.uGapOn.value = v ? 1 : 0 }))
syncs.push(buttons('fog', [['開', true], ['關', false]] as const,
  () => state.fog, (v) => { state.fog = v; applyPalette() }))
for (const [id, key, fmt] of [
  ['az', 'az', (v: number) => `${v}°`],
  ['elev', 'elev', (v: number) => `${v}°`],
  ['dist', 'dist', (v: number) => `${(v / 1000).toFixed(1)} km`],
  ['depth', 'depth', (v: number) => `${(v / 1000).toFixed(2)} km`],
] as const) {
  const el = document.getElementById(id) as HTMLInputElement
  el.oninput = () => { state[key] = Number(el.value); refresh() }
  syncs.push(() => {
    el.value = String(state[key])
    document.getElementById(`${id}V`)!.textContent = fmt(state[key])
  })
}

{
  const el = document.getElementById('gapScale') as HTMLInputElement
  el.oninput = () => { state.gapScale = Number(el.value); applyPalette(); refresh() }
  syncs.push(() => {
    el.value = String(state.gapScale)
    document.getElementById('gapScaleV')!.textContent = `× ${state.gapScale.toFixed(2)}`
  })
}
{
  const el = document.getElementById('blocking') as HTMLInputElement
  el.oninput = () => { state.blocking = Number(el.value); applyPalette(); refresh() }
  syncs.push(() => {
    el.value = String(state.blocking)
    document.getElementById('blockingV')!.textContent = state.blocking.toFixed(3)
  })
}

function refresh(): void {
  layout()
  for (const s of syncs) s()
}

// ── 迴圈 ──────────────────────────────────────────────
let frame = 0
function loop(): void {
  ctx.renderer.render(ctx.scene, ctx.camera)
  // 讀畫素要在同一幀畫完之後馬上讀；每 10 幀讀一次就夠
  if (frame++ % 10 === 0) measure()
  placeTags()
  requestAnimationFrame(loop)
}

/** 截圖腳本用：一次設好狀態、回傳四塊的亮度 */
;(window as unknown as Record<string, unknown>)['__canopy'] = (o: Partial<typeof state> = {}) => {
  Object.assign(state, o)
  shade.uniforms.uViewShadeOn.value = state.pointK ? 1 : 0
  groundUniforms.uBakeMode.value = state.bakeNew ? 1 : 0
  groundUniforms.uGapOn.value = state.gap ? 1 : 0
  applyPalette()
  refresh()
  ctx.renderer.render(ctx.scene, ctx.camera)
  measure()
  return { ...state, readings: [...readings] }
}

applyPalette()
refresh()
loop()
