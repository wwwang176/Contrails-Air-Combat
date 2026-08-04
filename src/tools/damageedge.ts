import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { buildAircraft } from '../render/geometry/buildAircraft'
import { DEG } from '../core/math'
import { P51D } from '../specs/p51d'

/**
 * 受擊方向指示器 —— **原型**，不屬於遊戲。
 *
 * 【為什麼邏輯先寫在這裡而不是 `src/hud/`】設計還沒定案。這一頁存在的目的
 * 就是讓專案負責人把張角、深度、持續時間這幾個數字調到滿意 —— 定案之後
 * 純邏輯（痕跡池與角度窗）會搬進 `src/hud/damageMarks.ts` 並補測試，繪製
 * 搬進 `src/hud/widgets/damageEdge.ts`。
 *
 * 進入方式：`npm run dev` 之後開 /damageedge.html。
 */

// ── 3D 背景：只是為了判斷紅色在天空與海面上讀不讀得出來 ────────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx3d = createScene(canvas)
const terrain = createTerrain('sea')
terrain.object.position.y = -300
ctx3d.scene.add(terrain.object)
const model = buildAircraft(P51D)
ctx3d.scene.add(model.group)
const controls = new OrbitControls(ctx3d.camera, ctx3d.renderer.domElement)
controls.target.set(0, 0, -2)
ctx3d.camera.position.set(4.6, 1.7, 13)
controls.update()

// ── 痕跡池（原型）──────────────────────────────────────────────────────
interface DamageMark {
  /** 中彈當下的**視角座標**來彈方向，單位向量。x=右 y=上 z=後 */
  x: number
  y: number
  z: number
  /** 剩餘強度 0..1。0 = 空格 */
  intensity: number
}

const CAPACITY = 6
/** 方向夾角小於這個值就併進既有那一格，不新增 */
const MERGE_DOT = Math.cos(30 * DEG)

const marks: DamageMark[] = []
for (let i = 0; i < CAPACITY; i++) marks.push({ x: 0, y: 0, z: 1, intensity: 0 })

/**
 * 記一次中彈。
 *
 * 【為什麼用 3D 方向判斷合併而不是螢幕角度】正後方來的兩發**沒有螢幕角度
 * 可以比**（它們都投影在畫面中心），但 3D 方向幾乎平行 —— 用點積判斷，
 * 那個退化情形自然就對了。
 *
 * 【合併時不動方向】動了的話連射會讓那團光左右抖。
 */
function pushMark(x: number, y: number, z: number): void {
  let weakest = 0
  for (let i = 0; i < CAPACITY; i++) {
    const m = marks[i]!
    if (m.intensity > 0 && m.x * x + m.y * y + m.z * z > MERGE_DOT) {
      m.intensity = 1
      return
    }
    if (m.intensity < marks[weakest]!.intensity) weakest = i
  }
  const m = marks[weakest]!
  m.x = x
  m.y = y
  m.z = z
  m.intensity = 1
}

function stepMarks(dt: number, life: number): void {
  const drop = life > 0 ? dt / life : 1
  for (const m of marks) m.intensity = Math.max(0, m.intensity - drop)
}

/** 這一發偏離視線多少：1 = 正側面、0 = 正前或正後（畫面上沒有角度） */
const offAxis = (m: DamageMark): number => Math.hypot(m.x, m.y)

/** 螢幕上的角度。0 = 正右、π/2 = 正上 */
const markAngle = (m: DamageMark): number => Math.atan2(m.y, m.x)

/**
 * 角度窗：中心最亮，往兩側以餘弦落到 0。
 *
 * 【為什麼要與「均勻一圈」混合】偏離視線越小，方向越不可信 —— 極限是正後方
 * 的整圈。用 `offAxis` 當混合比例，兩端都對而且中間是連續的：側面來彈是
 * 一團、斜後方是一團加一圈微亮的底、正後方就是整圈。
 */
function window0(delta: number, half: number, m: number): number {
  const d = Math.abs(delta)
  const lobe = d >= half ? 0 : 0.5 * (1 + Math.cos((Math.PI * d) / half))
  return m * lobe + (1 - m)
}

/** 兩個角度的最短夾角，−π..π */
function angleDelta(a: number, b: number): number {
  let d = a - b
  while (d > Math.PI) d -= Math.PI * 2
  while (d < -Math.PI) d += Math.PI * 2
  return d
}

// ── 繪製 ───────────────────────────────────────────────────────────────
const edge = document.getElementById('edge') as HTMLCanvasElement
const g = edge.getContext('2d')!
/** 沿邊界取樣的段數。64 段 = 每段 5.6°，角度窗夠平滑，看不出接縫 */
const SEGMENTS = 64

/** 由畫面中心朝角度 `theta` 射出去，打在畫面邊界的哪一點。 */
function borderPoint(
  theta: number, cx: number, cy: number, out: { x: number; y: number; dx: number; dy: number },
): void {
  // 【螢幕 y 向下】所以 sin 要取負，θ 才是「數學正向、上為正」
  const dx = Math.cos(theta)
  const dy = -Math.sin(theta)
  const tx = Math.abs(dx) > 1e-9 ? cx / Math.abs(dx) : Infinity
  const ty = Math.abs(dy) > 1e-9 ? cy / Math.abs(dy) : Infinity
  const t = Math.min(tx, ty)
  out.dx = dx
  out.dy = dy
  out.x = cx + dx * t
  out.y = cy + dy * t
}

const A = { x: 0, y: 0, dx: 0, dy: 0 }
const B = { x: 0, y: 0, dx: 0, dy: 0 }

function drawEdge(w: number, h: number, half: number, depth: number, peak: number): void {
  g.clearRect(0, 0, w, h)
  const cx = w / 2
  const cy = h / 2
  const D = Math.min(w, h) * depth

  for (let s = 0; s < SEGMENTS; s++) {
    const t0 = (s / SEGMENTS) * Math.PI * 2
    const t1 = ((s + 1) / SEGMENTS) * Math.PI * 2
    // 【用兩端的平均】段夠密（5.6°）而角度窗是平滑的，看不出階梯
    const mid = (t0 + t1) / 2

    let a = 0
    for (const m of marks) {
      if (m.intensity <= 0) continue
      a += m.intensity * window0(angleDelta(mid, markAngle(m)), half, offAxis(m))
    }
    a = Math.min(1, a) * peak
    if (a <= 0.002) continue

    borderPoint(t0, cx, cy, A)
    borderPoint(t1, cx, cy, B)
    const ix0 = A.x - A.dx * D
    const iy0 = A.y - A.dy * D
    const ix1 = B.x - B.dx * D
    const iy1 = B.y - B.dy * D

    // 由邊界往內衰減到全透明 —— 光只在邊緣，不會跑到中心
    const grad = g.createLinearGradient((A.x + B.x) / 2, (A.y + B.y) / 2, (ix0 + ix1) / 2, (iy0 + iy1) / 2)
    grad.addColorStop(0, `rgba(255, 42, 32, ${a})`)
    grad.addColorStop(1, 'rgba(255, 42, 32, 0)')
    g.fillStyle = grad
    g.beginPath()
    g.moveTo(A.x, A.y)
    g.lineTo(B.x, B.y)
    g.lineTo(ix1, iy1)
    g.lineTo(ix0, iy0)
    g.closePath()
    g.fill()
  }
}

// ── 控制面板 ───────────────────────────────────────────────────────────
let azimuth = 90
let elevation = 0
let life = 0.5
let halfWidth = 70 * DEG
let depth = 0.22
let peak = 0.55
let auto = false
let autoTimer = 0

const range = (id: string, onChange: (v: number) => void, fmt: (v: number) => string): void => {
  const el = document.getElementById(id) as HTMLInputElement
  const out = document.getElementById(`${id}V`)!
  const sync = (): void => {
    const v = Number(el.value)
    onChange(v)
    out.textContent = fmt(v)
  }
  el.addEventListener('input', sync)
  sync()
}
range('az', (v) => { azimuth = v }, (v) => `${v}°`)
range('el', (v) => { elevation = v }, (v) => `${v}°`)
range('life', (v) => { life = v }, (v) => `${v.toFixed(2)} s`)
range('half', (v) => { halfWidth = v * DEG }, (v) => `${v}°`)
range('depth', (v) => { depth = v }, (v) => v.toFixed(2))
range('peak', (v) => { peak = v }, (v) => v.toFixed(2))

/**
 * 方位／俯仰 → 視角座標的單位向量。
 *
 * 方位 0 = 正前方、90 = 正右、180 = 正後方。相機看向 −Z，所以正前方是 z = −1。
 */
function direction(azDeg: number, elDeg: number): [number, number, number] {
  const a = azDeg * DEG
  const e = elDeg * DEG
  return [Math.sin(a) * Math.cos(e), Math.sin(e), -Math.cos(a) * Math.cos(e)]
}

function hitNow(azDeg = azimuth, elDeg = elevation): void {
  const [x, y, z] = direction(azDeg, elDeg)
  pushMark(x, y, z)
}

document.getElementById('hit')!.addEventListener('click', () => hitNow())
document.getElementById('both')!.addEventListener('click', () => {
  hitNow(90, 10)
  hitNow(-90, -10)
})
const autoBtn = document.getElementById('auto') as HTMLButtonElement
autoBtn.addEventListener('click', () => {
  auto = !auto
  autoBtn.classList.toggle('on', auto)
})

// 【不用展開運算子】專案的 lib 目標下 NodeListOf 沒有 Symbol.iterator
const presets = Array.prototype.slice.call(
  document.querySelectorAll('.grid button'),
) as HTMLButtonElement[]
presets.forEach((b, i) => {
  const apply = (): void => {
    const az = document.getElementById('az') as HTMLInputElement
    const el = document.getElementById('el') as HTMLInputElement
    az.value = b.dataset['az']!
    el.value = b.dataset['el']!
    az.dispatchEvent(new Event('input'))
    el.dispatchEvent(new Event('input'))
    hitNow()
  }
  b.addEventListener('click', apply)
  window.addEventListener('keydown', (e) => {
    if (e.code === `Digit${i + 1}`) apply()
  })
})
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); hitNow() }
})

// ── 迴圈 ───────────────────────────────────────────────────────────────
const stats = document.getElementById('stats')!
let last = performance.now()

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.1)
  last = now

  if (auto) {
    autoTimer += dt
    // 六挺 .50 大約 80 發/s，但命中率遠低於此 —— 取 12 次/s 當「被咬住」
    while (autoTimer >= 1 / 12) {
      autoTimer -= 1 / 12
      hitNow()
    }
  }
  stepMarks(dt, life)

  const dpr = Math.min(window.devicePixelRatio || 1, 2)
  const w = window.innerWidth
  const h = window.innerHeight
  if (edge.width !== Math.round(w * dpr) || edge.height !== Math.round(h * dpr)) {
    edge.width = Math.round(w * dpr)
    edge.height = Math.round(h * dpr)
    edge.style.width = `${w}px`
    edge.style.height = `${h}px`
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0)
  drawEdge(w, h, halfWidth, depth, peak)

  controls.update()
  terrain.update(now / 1000, ctx3d.camera.position.x, ctx3d.camera.position.z)
  ctx3d.renderer.render(ctx3d.scene, ctx3d.camera)

  const live = marks.filter((m) => m.intensity > 0)
  stats.textContent = `活著的痕跡 ${live.length} / ${CAPACITY}\n`
    + live
      .map((m) => `  ${(markAngle(m) / DEG).toFixed(0).padStart(4)}°`
        + `　偏離 ${offAxis(m).toFixed(2)}　強度 ${m.intensity.toFixed(2)}`)
      .join('\n')

  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
