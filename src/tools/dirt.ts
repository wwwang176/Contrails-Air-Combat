import { TextureLoader, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain, preloadTerrainScenery, type Terrain } from '../render/terrain'
import {
  DIRT_IMPACT, DIRT_POOL_TUNE, createDirtPools, dirtPoolList, emitDirtImpact,
  type DirtImpactParams, type DirtPoolTune, type DirtPools, type DirtSurface,
} from '../render/dirtImpact'
import { createSparks } from '../render/sparks'
import { SMOKE_WIND } from '../render/wind'
import { createImpacts, clearImpacts, pushImpact } from '../world/events'
import { applyTimeOfDay } from '../render/timeOfDay'
import { hash01 } from '../core/hash'
import type { TerrainKind } from '../world/terrainKind'
import { assetUrl } from '../core/asset'

/**
 * 彈著土柱展示區 —— 調校用的開發工具，不屬於遊戲。
 *
 * 子彈打進地面的土柱、土塊、煙塵。地形、日照、粒子池與遊戲同一批建構函數。
 * 「掃射」模擬一串機槍彈沿著地面推進，看的是落點記號在地上留多久、從機上
 * 讀不讀得出來；「疊上火花」是遊戲目前打到地形時的效果，對照用。
 *
 * 進入方式：`npm run dev` 之後開 /tools/dirt.html。
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

await preloadTerrainScenery('rzhev')

let terrainKind: TerrainKind = 'farmland'
let terrain: Terrain = createTerrain(terrainKind)
ctx.scene.add(terrain.object)

const dustTex = await new TextureLoader().loadAsync(assetUrl('/textures/smoke.png'))

const params: { -readonly [K in keyof DirtImpactParams]: number } = { ...DIRT_IMPACT }
const tune: { -readonly [K in keyof DirtPoolTune]: number } = { ...DIRT_POOL_TUNE }

let surface: DirtSurface = 'soil'
let pools: DirtPools = createDirtPools(surface, tune, dustTex)
for (const p of dirtPoolList(pools)) ctx.scene.add(p.object)

function rebuildPools(): void {
  for (const p of dirtPoolList(pools)) {
    ctx.scene.remove(p.object)
    p.dispose()
  }
  pools = createDirtPools(surface, tune, dustTex)
  for (const p of dirtPoolList(pools)) ctx.scene.add(p.object)
}

const sparks = createSparks()
ctx.scene.add(sparks.object)
const sparkEvents = createImpacts()
let showSparks = false

// ── 射擊 ────────────────────────────────────────────────

type Mode = 'single' | 'strafe'
let mode: Mode = 'strafe'

/** 掃射：槍數 × 每挺射速 = 每秒落地幾發 */
const strafe = {
  guns: 6,
  rpm: 800,
  /** 落點沿 +x 推進的速度，m/s */
  walk: 45,
  seconds: 1.2,
  /** 落點的散布半徑，m */
  spread: 3,
}

let timeScale = 1
let autoEvery = 3
let elapsed = 0
let sinceFire = 0
/** 每一發一個種子，整場遞增 */
let shotSeed = 1
/** 掃射進行到第幾秒；負值 = 沒在掃 */
let strafeT = -1
let shotsFired = 0

/**
 * 落點中心。雙擊地面改它；鏡頭與掃射線都相對它擺。各地形的預設值是空地 ——
 * 原點附近可能是林子，樹會擋住整個效果。
 */
const AIM_DEFAULT: Partial<Record<TerrainKind, readonly [number, number]>> = {
  farmland: [0, 220],
}
let aimX = AIM_DEFAULT[terrainKind]?.[0] ?? 0
let aimZ = AIM_DEFAULT[terrainKind]?.[1] ?? 0

/** `x`、`z` 是相對落點中心的位移 */
function hitAt(dx: number, dz: number): void {
  const x = aimX + dx
  const z = aimZ + dz
  const y = terrain.heightAt(x, z, elapsed)
  emitDirtImpact(pools, params, x, y, z, shotSeed++)
  if (showSparks) pushImpact(sparkEvents, x, y, z, 0, 1, 0)
}

function fire(): void {
  sinceFire = 0
  if (mode === 'single') {
    strafeT = -1
    hitAt(0, 0)
    return
  }
  strafeT = 0
  shotsFired = 0
}

/** 掃射的發射排程走模擬時間，慢動作時落點也跟著慢 */
function stepStrafe(dt: number): void {
  if (strafeT < 0) return
  strafeT += dt
  const rate = (strafe.guns * strafe.rpm) / 60
  const due = Math.min(Math.floor(strafeT * rate), Math.floor(strafe.seconds * rate))
  const x0 = -(strafe.walk * strafe.seconds) / 2
  while (shotsFired < due) {
    const t = shotsFired / rate
    const s = shotSeed
    const a = hash01(s * 0x9e3779b1) * Math.PI * 2
    const r = Math.sqrt(hash01(s * 0x85ebca6b)) * strafe.spread
    hitAt(x0 + strafe.walk * t + Math.cos(a) * r, Math.sin(a) * r)
    shotsFired++
  }
  if (strafeT >= strafe.seconds) strafeT = -1
}

// ── 面板 ────────────────────────────────────────────────

const out = document.getElementById('out') as HTMLElement
const liveOut = document.getElementById('live') as HTMLElement

function row(host: HTMLElement, label: string): HTMLElement {
  const d = document.createElement('div')
  d.className = 'row'
  const l = document.createElement('label')
  l.textContent = label
  d.appendChild(l)
  host.appendChild(d)
  return d
}

function numRow(
  host: HTMLElement, label: string, min: number, max: number, step: number,
  get: () => number, set: (v: number) => void, fmt: (v: number) => string,
): void {
  const d = row(host, label)
  const input = document.createElement('input')
  input.type = 'range'
  input.min = String(min)
  input.max = String(max)
  input.step = String(step)
  input.value = String(get())
  const val = document.createElement('span')
  val.className = 'val'
  val.textContent = fmt(get())
  input.addEventListener('input', () => {
    set(Number(input.value))
    val.textContent = fmt(get())
    dump()
  })
  d.append(input, val)
}

function chkRow(
  host: HTMLElement, label: string, get: () => boolean, set: (v: boolean) => void,
): void {
  const d = document.createElement('div')
  d.className = 'chk'
  const input = document.createElement('input')
  input.type = 'checkbox'
  input.checked = get()
  input.addEventListener('change', () => set(input.checked))
  const l = document.createElement('label')
  l.textContent = label
  d.append(input, l)
  host.appendChild(d)
}

const n0 = (v: number): string => v.toFixed(0)
const f1 = (v: number): string => v.toFixed(1)
const f2 = (v: number): string => v.toFixed(2)
const deg = (v: number): string => v.toFixed(0) + '°'

type ParamKey = keyof DirtImpactParams
const pGet = (k: ParamKey) => (): number => params[k]
const pSet = (k: ParamKey) => (v: number): void => { params[k] = v }
const coneGet = (k: ParamKey) => (): number => Math.round((params[k] * 180) / Math.PI)
const coneSet = (k: ParamKey) => (v: number): void => { params[k] = (v * Math.PI) / 180 }
type TuneKey = keyof DirtPoolTune
const tGet = (k: TuneKey) => (): number => tune[k]
const tSet = (k: TuneKey) => (v: number): void => { tune[k] = v; rebuildPools() }

const sceneRows = document.getElementById('scene-rows') as HTMLElement
numRow(sceneRows, '播放速度', 0.05, 1, 0.05, () => timeScale, (v) => { timeScale = v }, f2)
numRow(sceneRows, '自動重播', 0, 8, 0.5, () => autoEvery, (v) => { autoEvery = v },
  (v) => (v === 0 ? '關' : v.toFixed(1) + 's'))
numRow(sceneRows, '風速', 0, 10, 0.5, () => SMOKE_WIND.x, (v) => { SMOKE_WIND.x = v },
  (v) => v.toFixed(1) + ' m/s')
chkRow(sceneRows, '疊上現行火花', () => showSparks, (v) => { showSparks = v })

const strafeRows = document.getElementById('strafe-rows') as HTMLElement
numRow(strafeRows, '槍數', 1, 8, 1, () => strafe.guns, (v) => { strafe.guns = v }, n0)
numRow(strafeRows, '每挺射速', 300, 1200, 50, () => strafe.rpm, (v) => { strafe.rpm = v },
  (v) => v.toFixed(0) + '/分')
numRow(strafeRows, '推進速度', 0, 120, 5, () => strafe.walk, (v) => { strafe.walk = v },
  (v) => v.toFixed(0) + ' m/s')
numRow(strafeRows, '掃射秒數', 0.2, 3, 0.1, () => strafe.seconds, (v) => { strafe.seconds = v }, f1)
numRow(strafeRows, '散布', 0, 10, 0.5, () => strafe.spread, (v) => { strafe.spread = v },
  (v) => v.toFixed(1) + ' m')

const rows = document.getElementById('rows') as HTMLElement
numRow(rows, '土塊顆數', 0, 20, 1, pGet('clodCount'), pSet('clodCount'), n0)
numRow(rows, '土塊初速', 0, 30, 0.5, pGet('clodSpeed'), pSet('clodSpeed'), f1)
numRow(rows, '土塊錐角', 0, 90, 1, coneGet('clodCone'), coneSet('clodCone'), deg)
numRow(rows, '土塊尺寸', 0.2, 4, 0.1, pGet('clodSize'), pSet('clodSize'), f1)
numRow(rows, '土柱顆數', 0, 20, 1, pGet('spoutCount'), pSet('spoutCount'), n0)
numRow(rows, '土柱初速', 0, 80, 1, pGet('spoutSpeed'), pSet('spoutSpeed'), n0)
numRow(rows, '土柱錐角', 0, 60, 1, coneGet('spoutCone'), coneSet('spoutCone'), deg)
numRow(rows, '土柱尺寸', 0.2, 4, 0.1, pGet('spoutSize'), pSet('spoutSize'), f1)
numRow(rows, '煙塵顆數', 0, 10, 1, pGet('dustCount'), pSet('dustCount'), n0)
numRow(rows, '煙塵初速', 0, 10, 0.5, pGet('dustSpeed'), pSet('dustSpeed'), f1)
numRow(rows, '煙塵錐角', 0, 90, 1, coneGet('dustCone'), coneSet('dustCone'), deg)
numRow(rows, '煙塵尺寸', 0.2, 4, 0.1, pGet('dustSize'), pSet('dustSize'), f1)
numRow(rows, '雪夾土', 0, 1, 0.05, pGet('mixRatio'), pSet('mixRatio'), f2)

const poolRows = document.getElementById('pool-rows') as HTMLElement
numRow(poolRows, '土塊壽命', 0.3, 3, 0.1, tGet('clodLife'), tSet('clodLife'), f1)
numRow(poolRows, '土柱壽命', 0.2, 2, 0.05, tGet('spoutLife'), tSet('spoutLife'), f2)
numRow(poolRows, '土柱初徑', 0.2, 4, 0.1, tGet('spoutFrom'), tSet('spoutFrom'), f1)
numRow(poolRows, '土柱末徑', 0.2, 8, 0.1, tGet('spoutTo'), tSet('spoutTo'), f1)
numRow(poolRows, '土柱阻尼', 1, 15, 0.5, tGet('spoutDrag'), tSet('spoutDrag'), f1)
numRow(poolRows, '煙塵壽命', 0.5, 8, 0.25, tGet('dustLife'), tSet('dustLife'), f2)
numRow(poolRows, '煙塵初徑', 0.2, 6, 0.1, tGet('dustFrom'), tSet('dustFrom'), f1)
numRow(poolRows, '煙塵末徑', 0.5, 16, 0.5, tGet('dustTo'), tSet('dustTo'), f1)
numRow(poolRows, '煙塵濃度', 0.05, 1, 0.05, tGet('dustAlpha'), tSet('dustAlpha'), f2)

/** 吐成可以直接貼回 `dirtImpact.ts` 的字面值 */
function dump(): void {
  const d = (v: number): string => '(' + Math.round((v * 180) / Math.PI) + ' * Math.PI) / 180'
  const cones = new Set<string>(['clodCone', 'spoutCone', 'dustCone'])
  out.textContent = [
    'export const DIRT_IMPACT: DirtImpactParams = {',
    ...(Object.keys(params) as ParamKey[]).map((k) =>
      '  ' + k + ': ' + (cones.has(k) ? d(params[k]) : String(params[k])) + ','),
    '}',
    '',
    'export const DIRT_POOL_TUNE: DirtPoolTune = {',
    ...(Object.keys(tune) as TuneKey[]).map((k) => '  ' + k + ': ' + tune[k] + ','),
    '}',
  ].join('\n')
}

// ── 分頁按鈕 ────────────────────────────────────────────

function tabs(host: HTMLElement, items: readonly { id: string, name: string }[],
  initial: string, pick: (id: string) => void): void {
  for (const it of items) {
    const b = document.createElement('button')
    b.dataset.id = it.id
    b.textContent = it.name
    b.classList.toggle('on', it.id === initial)
    b.addEventListener('click', () => {
      pick(it.id)
      for (const other of Array.from(host.children)) {
        other.classList.toggle('on', (other as HTMLElement).dataset.id === it.id)
      }
    })
    host.appendChild(b)
  }
}

function markTab(host: HTMLElement, id: string): void {
  for (const b of Array.from(host.children)) {
    b.classList.toggle('on', (b as HTMLElement).dataset.id === id)
  }
}

tabs(document.getElementById('mode') as HTMLElement, [
  { id: 'single', name: '單發' }, { id: 'strafe', name: '掃射' },
], mode, (id) => { mode = id as Mode; fire() })

const surfaceTabs = document.getElementById('surface') as HTMLElement
function setSurface(s: DirtSurface): void {
  surface = s
  markTab(surfaceTabs, s)
  rebuildPools()
}
tabs(surfaceTabs, [
  { id: 'soil', name: '土' }, { id: 'snow', name: '雪＋土' },
], surface, (id) => { setSurface(id as DirtSurface); fire() })

tabs(document.getElementById('terrain') as HTMLElement, [
  { id: 'farmland', name: '內陸' }, { id: 'autumnFarmland', name: '晚秋' },
  { id: 'rzhev', name: '勒熱夫' },
], terrainKind, (id) => setTerrain(id as TerrainKind))

/**
 * 鏡頭位置。**機上**是 30° 俯衝、斜距約 560 m —— 掃射時飛行員看到的距離，
 * 落點記號在這裡讀不讀得出來才是重點。
 */
type View = 'near' | 'mid' | 'pilot'
let view: View = 'pilot'
tabs(document.getElementById('view') as HTMLElement, [
  { id: 'near', name: '近看' }, { id: 'mid', name: '中距' }, { id: 'pilot', name: '機上' },
], view, (id) => { view = id as View; placeCamera() })

function placeCamera(): void {
  const y = terrain.heightAt(aimX, aimZ, elapsed)
  if (view === 'near') {
    ctx.camera.position.set(aimX + 22, y + 8, aimZ + 26)
    controls.target.set(aimX, y + 2, aimZ)
  } else if (view === 'mid') {
    ctx.camera.position.set(aimX, y + 50, aimZ + 180)
    controls.target.set(aimX + 5, y, aimZ)
  } else {
    ctx.camera.position.set(aimX - 480, y + 280, aimZ)
    controls.target.set(aimX + 10, y, aimZ)
  }
  controls.update()
}

/**
 * 雙擊地面設落點。沿視線步進到低於地面為止 —— 只問 `heightAt`，樹與建築
 * 不擋，落點永遠在地面上。
 */
const RAY = new Vector3()
canvas.addEventListener('dblclick', (e) => {
  const r = canvas.getBoundingClientRect()
  RAY.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1, 0.5)
    .unproject(ctx.camera).sub(ctx.camera.position).normalize()
  const o = ctx.camera.position
  for (let d = 0; d < 5000; d += 1) {
    const x = o.x + RAY.x * d, y = o.y + RAY.y * d, z = o.z + RAY.z * d
    if (y > terrain.heightAt(x, z, elapsed)) continue
    aimX = x
    aimZ = z
    controls.target.set(x, y, z)
    fire()
    return
  }
})

function setTerrain(k: TerrainKind): void {
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrainKind = k
  terrain = createTerrain(k)
  ctx.scene.add(terrain.object)
  const aim = AIM_DEFAULT[k] ?? [0, 0]
  aimX = aim[0]
  aimZ = aim[1]
  applyTimeOfDay(ctx, terrain, 'noon')
  setSurface(k === 'rzhev' ? 'snow' : 'soil')
  placeCamera()
  fire()
}

const fireBtn = document.getElementById('fire') as HTMLButtonElement
fireBtn.addEventListener('click', () => fire())
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault()
    fire()
  }
})

const copy = document.getElementById('copy') as HTMLButtonElement
copy.addEventListener('click', () => {
  void navigator.clipboard.writeText(out.textContent ?? '')
  copy.textContent = '已複製'
  window.setTimeout(() => { copy.textContent = '複製設定' }, 1200)
})

// ── 相機與主迴圈 ────────────────────────────────────────

const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
placeCamera()
applyTimeOfDay(ctx, terrain, 'noon')
dump()
fire()

function stepAll(dt: number): void {
  stepStrafe(dt)
  if (sparkEvents.count > 0) {
    const c = ctx.camera.position
    sparks.emit(sparkEvents, c.x, c.y, c.z)
    clearImpacts(sparkEvents)
  }
  for (const p of dirtPoolList(pools)) p.step(dt)
  sparks.step(dt)
}

/**
 * 截圖用的鉤子：固定 dt 推進後立刻畫一張，時間點才對得起來。
 * `toDataURL` 要在 `render()` 的同一個同步區塊裡讀。
 */
const probe = {
  set(opts: {
    mode?: Mode, view?: View, terrain?: TerrainKind, autoEvery?: number, timeScale?: number,
    aim?: readonly [number, number],
  }): void {
    if (opts.aim !== undefined) { aimX = opts.aim[0]; aimZ = opts.aim[1]; placeCamera() }
    if (opts.autoEvery !== undefined) autoEvery = opts.autoEvery
    if (opts.timeScale !== undefined) timeScale = opts.timeScale
    if (opts.terrain !== undefined && opts.terrain !== terrainKind) setTerrain(opts.terrain)
    if (opts.view !== undefined) { view = opts.view; placeCamera() }
    if (opts.mode !== undefined) mode = opts.mode
  },
  /** 清場、開火、推進 `seconds` 秒後回傳一張畫面 */
  shot(seconds: number): string {
    this.clear()
    fire()
    const dt = 1 / 60
    for (let t = 0; t < seconds; t += dt) stepAll(dt)
    controls.update()
    ctx.renderer.render(ctx.scene, ctx.camera)
    return canvas.toDataURL('image/png')
  },
  /**
   * 清場並立刻畫一張。【reset 之後要先畫】reset 靠「下一次上傳是整條緩衝」把
   * 舊粒子歸零；先 step 再畫的話上傳範圍只剩新粒子那幾格，舊的留在畫面上
   */
  clear(): void {
    for (const p of dirtPoolList(pools)) p.reset()
    sparks.reset()
    strafeT = -1
    ctx.renderer.render(ctx.scene, ctx.camera)
  },
  /** 開火後每隔 `dt` 秒截一格，拼成一張 `cols` 欄的圖。`crop` 是取畫面中央多寬的比例 */
  sheet(
    frames: number, dt: number, cols: number, cellW: number, cellH: number, crop = 0.5,
  ): string {
    const sheetCanvas = document.createElement('canvas')
    sheetCanvas.width = cols * cellW
    sheetCanvas.height = Math.ceil(frames / cols) * cellH
    const g = sheetCanvas.getContext('2d')!
    this.clear()
    fire()
    const sub = 1 / 120
    for (let f = 0; f < frames; f++) {
      for (let t = 0; t < dt - 1e-6; t += sub) stepAll(sub)
      controls.update()
      ctx.renderer.render(ctx.scene, ctx.camera)
      const col = f % cols
      const rowI = Math.floor(f / cols)
      // 取畫面中央、與格子同比例的一塊
      const sw = canvas.width * crop
      const sh = (sw * cellH) / cellW
      g.drawImage(canvas, (canvas.width - sw) / 2, (canvas.height - sh) / 2, sw, sh,
        col * cellW, rowI * cellH, cellW, cellH)
      g.font = '13px ui-monospace, monospace'
      g.fillStyle = '#7dfba8'
      g.fillText(((f + 1) * dt).toFixed(2) + 's', col * cellW + 8, rowI * cellH + 18)
    }
    return sheetCanvas.toDataURL('image/png')
  },
}
;(window as unknown as Record<string, unknown>)['__dirtProbe'] = probe

let last = performance.now()

function frame(now: number): void {
  const wall = Math.min((now - last) / 1000, 0.25)
  last = now
  const dt = wall * timeScale
  elapsed += dt
  sinceFire += wall

  if (autoEvery > 0 && sinceFire >= autoEvery) fire()

  stepAll(dt)
  controls.update()
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)

  const live = dirtPoolList(pools).reduce((n, p) => n + p.live, 0)
  liveOut.textContent =
    `土柱 ${pools.spout.live}　土塊 ${pools.clods.live + (pools.mixClods?.live ?? 0)}　` +
    `煙塵 ${pools.dust.live}\n合計 ${live}　火花 ${sparks.live}\n` +
    `距上一輪 ${sinceFire.toFixed(1)}s`
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
