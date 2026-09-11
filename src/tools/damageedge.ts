import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { buildAircraft, preloadAircraftModels } from '../render/geometry/buildAircraft'
import { DEG } from '../core/math'
import { P51D } from '../specs/p51d'
import { createHudFrame, type HudLayout } from '../hud/types'
import {
  markAngle, markOffAxis, pushDamageMark, resetDamageMarks, stepDamageMarks,
  DAMAGE_HALF_WIDTH, DAMAGE_MARK_CAPACITY, DAMAGE_MARK_SECONDS,
} from '../hud/damageMarks'
import {
  drawDamageEdge, DAMAGE_DEPTH, DAMAGE_PEAK_ALPHA,
} from '../hud/widgets/damageEdge'

/**
 * 受擊方向指示器 —— **驗證頁**，跑的是遊戲裡的那一份程式碼。
 *
 * spec §7 的三個數字（張角、深度、最亮）是在這一頁的滑桿上調出來的；
 * 邏輯住在 `src/hud/`，這一頁 import 它 —— **不留第二份**
 * （spec §11）。留兩份不只是重複，那一份還會反過來製造錯誤的信心，因為它
 * 看起來像在驗證正式的東西。要再調參數就改
 * `damageMarks.ts` / `damageEdge.ts` 的常數。
 *
 * 進入方式：`npm run dev` 之後開 /tools/damageedge.html。
 */

// ── 3D 背景：只是為了判斷紅色在天空與海面上讀不讀得出來 ────────────────
const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx3d = createScene(canvas)
const terrain = createTerrain('sea')
terrain.object.position.y = -300
ctx3d.scene.add(terrain.object)
await preloadAircraftModels()
const model = buildAircraft(P51D)
ctx3d.scene.add(model.group)
const controls = new OrbitControls(ctx3d.camera, ctx3d.renderer.domElement)
controls.target.set(0, 0, -2)
ctx3d.camera.position.set(4.6, 1.7, 13)
controls.update()

// ── 遊戲用的那一份 ─────────────────────────────────────────────────────
const frame = createHudFrame()
const marks = frame.damageMarks
const edge = document.getElementById('edge') as HTMLCanvasElement
const g = edge.getContext('2d')!
const L: HudLayout = { width: 0, height: 0, cx: 0, cy: 0, unit: 0, scale: 1 }

// ── 控制面板 ───────────────────────────────────────────────────────────
let azimuth = 90
let elevation = 0
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

// 參數不再可調——它們是正式模組裡的常數。顯示出來只是為了對照畫面。
document.getElementById('consts')!.textContent = [
  `持續　${DAMAGE_MARK_SECONDS.toFixed(2)} s`,
  `張角　${(DAMAGE_HALF_WIDTH / DEG).toFixed(0)}°`,
  `深度　${DAMAGE_DEPTH.toFixed(2)}`,
  `最亮　${DAMAGE_PEAK_ALPHA.toFixed(2)}`,
].join('\n')

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
  pushDamageMark(marks, x, y, z)
}

document.getElementById('hit')!.addEventListener('click', () => hitNow())
document.getElementById('both')!.addEventListener('click', () => {
  hitNow(90, 10)
  hitNow(-90, -10)
})
document.getElementById('clear')!.addEventListener('click', () => resetDamageMarks(marks))
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

function loop(now: number): void {
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
  stepDamageMarks(marks, dt)

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
  // 【這一頁要自己清】遊戲裡是 `Hud.render` 開頭的 clearRect 負責，
  // `drawDamageEdge` 自己不清畫布。
  g.clearRect(0, 0, w, h)
  L.width = w
  L.height = h
  L.cx = w / 2
  L.cy = h / 2
  L.unit = h / 2
  drawDamageEdge(g, L, frame)

  controls.update()
  terrain.update(now / 1000, ctx3d.camera.position.x, ctx3d.camera.position.z)
  ctx3d.renderer.render(ctx3d.scene, ctx3d.camera)

  const live = marks.filter((m) => m.intensity > 0)
  stats.textContent = `活著的痕跡 ${live.length} / ${DAMAGE_MARK_CAPACITY}\n`
    + live
      .map((m) => `  ${(markAngle(m) / DEG).toFixed(0).padStart(4)}°`
        + `　偏離 ${markOffAxis(m).toFixed(2)}　強度 ${m.intensity.toFixed(2)}`)
      .join('\n')

  requestAnimationFrame(loop)
}
requestAnimationFrame(loop)
