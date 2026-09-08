import { TextureLoader, type Texture } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain, type Terrain } from '../render/terrain'
import { preloadPlantScenery } from '../render/geometry/ground/plantScenery'
import { createFireball } from '../render/fireball'
import { createFireChunks } from '../render/chunks'
import { createSpray, WATER_COLOR } from '../render/spray'
import { createSplashes } from '../render/splash'
import { JET_RISE, createWaterJets } from '../render/waterJets'
import {
  BLAST_PACE, LAND_BLAST, WATER_BLAST, createBlastSmoke, createDust, createEmberSmoke,
  createFireGlow, createWaterMist, emitBlast, emitEmber, emitMist,
  blastScale, scaleBlast,
  type BlastParams, type BlastPools,
} from '../render/blast'
import { createImpacts, clearImpacts } from '../world/events'
import {
  DAY_PALETTES, TIME_OF_DAY_IDS, applyTimeOfDay, type TimeOfDay,
} from '../render/timeOfDay'
import type { TerrainKind } from '../world/terrainKind'

/**
 * 爆炸展示區 —— 純調校用的開發工具，不屬於遊戲。
 *
 * 【為什麼要有它】爆炸只發生 2.5 秒，而配方有十六個數字。在關卡裡調的話，
 * 每改一個值要起飛、對準、投彈、等落地 —— 一次循環一分鐘，而且看到的是
 * 一個從 4,000 m 高空看下去的小點。
 *
 * 【它走的是遊戲的那條路徑】`createScene` + `createTerrain` + `applyTimeOfDay`
 * 與 `main.ts` 相同，粒子池也是同一批建構函數。工具自己抄一份的話，看到的就
 * 不是遊戲裡的東西。
 *
 * 【爆炸還沒接進遊戲】`World.onBombImpact` 目前只推水柱。這裡調出來的配方
 * 之後才會接上去。
 *
 * 進入方式：`npm run dev` 之後開 /blast.html。
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

// 【廠區的佈景是 GLB】切到洛伊納要先載完，`createTerrain` 是同步的
await preloadPlantScenery()

let terrain: Terrain = createTerrain('sea')
ctx.scene.add(terrain.object)

const fireball = createFireball()
const spray = createSpray(WATER_COLOR)
const splashes = createSplashes()
for (const p of [fireball, spray, splashes]) ctx.scene.add(p.object)

const splashEvents = createImpacts()

/**
 * 整個爆炸的快慢。**改它要重建池** —— 粒子的壽命在建構時就固定了。
 */
let pace = BLAST_PACE
/**
 * 當量倍率。1 = 500 lb。**尺寸、顆數、時間全部由它一個值推導** ——
 * 見 `scaleBlast` 的表。
 */
let yieldRatio = 1
/** 池的壽命也吃當量：時間與尺寸同樣是立方根律 */
const paced = (): number => pace * blastScale(yieldRatio)

/**
 * 煙與塵的不透明度貼圖。**專案的第一張貼圖。**
 *
 * 【為什麼要它】沒有貼圖時每一顆都是一個乾淨的軟邊圓，十幾顆疊起來仍然是
 * 一團均勻的灰 —— 那就是「太平面」。這張圖自帶 noise，每一顆的內部就有明暗。
 */
const smokeTex = await new TextureLoader().loadAsync('/textures/smoke.png')
/** 貼圖版 / 純圓片版。開關留著才比得出它值不值得 */
let textured = true
const tex = (): Texture | undefined => (textured ? smokeTex : undefined)

/** 光暈開關。關掉等於 `glowSize = 0` */
let glowOn = true
let glow = createFireGlow(undefined, paced())
let mist = createWaterMist(undefined, paced(), tex())
let ember = createEmberSmoke(undefined, paced(), tex())
/**
 * 【水柱交棒給水霧】一根柱子開始塌時，沿著柱身留下幾團往外下沉的白霧 ——
 * 與火球交棒給黑煙同一個手法。
 */
const jetHandoff = (
  x: number, y: number, z: number, height: number, radius: number, slot: number,
): void => {
  emitMist(mist, slot, SCALED.mistPerJet, SCALED.mistSize, x, y, z, height, radius)
}
let jets = createWaterJets({
  capacity: 256, life: 1.5 * paced(), rise: JET_RISE, alphaFrom: 0.8,
  onFade: jetHandoff,
})
/**
 * 【火交棒給煙】每一塊火球開始淡出時，在**同一個位置、同一個尺寸**留下一顆
 * 煙。`EMBER_SIZE_FROM` 是 1，所以直徑直接就是倍率。
 */
const handoff = (
  x: number, y: number, z: number,
  vx: number, vy: number, vz: number, d: number, slot: number,
): void => { emitEmber(ember, slot, x, y, z, vx, vy, vz, d) }

let chunks = createFireChunks(undefined, paced(), handoff)
let smoke = createBlastSmoke(undefined, paced(), tex())
let dust = createDust(undefined, paced(), tex())
for (const p of [glow, chunks, ember, smoke, dust, mist, jets]) ctx.scene.add(p.object)

function rebuildPaced(): void {
  for (const p of [glow, chunks, ember, smoke, dust, mist, jets]) {
    ctx.scene.remove(p.object)
    p.dispose()
  }
  glow = createFireGlow(undefined, paced())
  mist = createWaterMist(undefined, paced(), tex())
  jets = createWaterJets({
    capacity: 256, life: 1.5 * paced(), rise: JET_RISE, alphaFrom: 0.8,
    onFade: jetHandoff,
  })
  ember = createEmberSmoke(undefined, paced(), tex())
  chunks = createFireChunks(undefined, paced(), handoff)
  smoke = createBlastSmoke(undefined, paced(), tex())
  dust = createDust(undefined, paced(), tex())
  for (const p of [glow, chunks, ember, smoke, dust, mist, jets]) ctx.scene.add(p.object)
}

/**
 * 火球的畫法。**兩者實作同一個 `Particles` 介面**，所以切換就是換
 * `BlastPools.fireball` 指向哪一個池 —— `emitBlast` 一行都不用改。
 */
type FireStyle = 'billboard' | 'chunks'
let fireStyle: FireStyle = 'billboard'
/** 每幀要步進、重播前要清的全部。水柱不是 `Particles`，但這兩支都有 */
interface Steppable {
  step(dt: number): void
  reset(): void
}
const ALL = (): Steppable[] =>
  [fireball, glow, chunks, ember, smoke, dust, mist, jets, spray, splashes]
const pools = (): BlastPools => ({
  fireball: fireStyle === 'chunks' ? chunks : fireball,
  smoke, dust, spray, splashEvents,
  glow: glowOn ? glow : undefined,
  jets,
})

/** 爆點的水平位置。原點 —— 相機繞著它轉 */
const BX = 0
const BZ = 0

/**
 * 兩種爆炸各自可調的那一份。
 *
 * 【為什麼是兩份而不是一份】切到落水再切回墜地時，墜地那一組的調整要還在
 * ——否則每切一次就要重調一次。
 */
type Mutable = { -readonly [K in keyof BlastParams]: BlastParams[K] }
const LIVE: Record<'land' | 'water', Mutable> = {
  land: { ...LAND_BLAST },
  water: { ...WATER_BLAST },
}
type Kind = keyof typeof LIVE
let kind: Kind = 'land'
const live = (): Mutable => LIVE[kind]

/** 時間縮放。爆炸只有 2.5 秒，慢動作是唯一看得清結構的方式 */
let timeScale = 1
/** 自動重播的間隔，s。0 = 關 */
let autoEvery = 0
/** 重播前清場 */
let clearFirst = true
/** 固定亂數 —— 這才是「重播」；關掉則每一發都是新的一組方向 */
let fixedSeed = true

let seed = 1
let elapsed = 0
let sinceFire = 0

/** 縮放後的配方。模組級 —— 每次重播不配置 */
const SCALED: { -readonly [K in keyof BlastParams]: number } = { ...LAND_BLAST }

function fire(): void {
  if (clearFirst) for (const p of ALL()) p.reset()
  if (!fixedSeed) seed = (seed + 7919) >>> 0
  const y = terrain.heightAt(BX, BZ, elapsed)
  scaleBlast(live(), yieldRatio, SCALED)
  emitBlast(pools(), SCALED, BX, y, BZ, seed)
  splashes.emit(splashEvents, terrain.heightAt, elapsed)
  clearImpacts(splashEvents)
  sinceFire = 0
}

// ── 面板 ────────────────────────────────────────────────

const rows = document.getElementById('rows') as HTMLElement
const sceneRows = document.getElementById('scene-rows') as HTMLElement
const out = document.getElementById('out') as HTMLElement
const liveOut = document.getElementById('live') as HTMLElement

interface Binding { refresh(): void }
const bindings: Binding[] = []

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
  const val = document.createElement('span')
  val.className = 'val'
  const refresh = (): void => {
    input.value = String(get())
    val.textContent = fmt(get())
  }
  input.addEventListener('input', () => {
    set(Number(input.value))
    val.textContent = fmt(get())
    dump()
  })
  d.append(input, val)
  bindings.push({ refresh })
  refresh()
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
const deg = (v: number): string => v.toFixed(0) + '°'
/** 錐角的旋鈕以**度**操作，存的是弧度 */
const coneGet = (k: keyof BlastParams) => (): number =>
  Math.round((live()[k] * 180) / Math.PI)
const coneSet = (k: keyof BlastParams) => (v: number): void => {
  live()[k] = (v * Math.PI) / 180
}
const numGet = (k: keyof BlastParams) => (): number => live()[k]
const numSet = (k: keyof BlastParams) => (v: number): void => { live()[k] = v }

numRow(sceneRows, '當量', 0.2, 8, 0.2, () => yieldRatio,
  (v) => { yieldRatio = v; rebuildPaced(); fire() },
  (v) => v.toFixed(1) + '× (尺度 ' + blastScale(v).toFixed(2) + ')')
numRow(sceneRows, '爆炸速度', 0.3, 3, 0.1, () => pace,
  (v) => { pace = v; rebuildPaced(); fire() }, (v) => v.toFixed(1) + '×')
numRow(sceneRows, '播放速度', 0.05, 1, 0.05, () => timeScale, (v) => { timeScale = v }, f1)
numRow(sceneRows, '自動重播', 0, 8, 0.5,
  () => autoEvery, (v) => { autoEvery = v }, (v) => (v === 0 ? '關' : v.toFixed(1) + 's'))
chkRow(sceneRows, '光暈', () => glowOn, (v) => { glowOn = v; fire() })
chkRow(sceneRows, '煙用貼圖', () => textured,
  (v) => { textured = v; rebuildPaced(); fire() })
chkRow(sceneRows, '重播前清場', () => clearFirst, (v) => { clearFirst = v })
chkRow(sceneRows, '固定亂數（同一發）', () => fixedSeed, (v) => { fixedSeed = v })

numRow(rows, '火　顆數', 0, 60, 1, numGet('fireCount'), numSet('fireCount'), n0)
numRow(rows, '火　初速', 0, 60, 1, numGet('fireSpeed'), numSet('fireSpeed'), n0)
numRow(rows, '火　尺寸', 0.2, 5, 0.1, numGet('fireSize'), numSet('fireSize'), f1)
numRow(rows, '火　錐角', 0, 90, 1, coneGet('fireCone'), coneSet('fireCone'), deg)
numRow(rows, '光暈尺寸', 0, 4, 0.1, numGet('glowSize'), numSet('glowSize'), f1)
numRow(rows, '光暈濃度', 0, 1, 0.05, numGet('glowAlpha'), numSet('glowAlpha'), f1)
numRow(rows, '煙　顆數', 0, 60, 1, numGet('smokeCount'), numSet('smokeCount'), n0)
numRow(rows, '煙　初速', 0, 40, 1, numGet('smokeSpeed'), numSet('smokeSpeed'), n0)
numRow(rows, '煙　尺寸', 0.2, 6, 0.1, numGet('smokeSize'), numSet('smokeSize'), f1)
numRow(rows, '煙　錐角', 0, 90, 1, coneGet('smokeCone'), coneSet('smokeCone'), deg)
numRow(rows, '塵　顆數', 0, 80, 1, numGet('dustCount'), numSet('dustCount'), n0)
numRow(rows, '塵　初速', 0, 50, 1, numGet('dustSpeed'), numSet('dustSpeed'), n0)
numRow(rows, '塵　尺寸', 0.2, 6, 0.1, numGet('dustSize'), numSet('dustSize'), f1)
numRow(rows, '塵　錐角', 0, 90, 1, coneGet('dustCone'), coneSet('dustCone'), deg)
numRow(rows, '水霧顆數', 0, 100, 1, numGet('sprayCount'), numSet('sprayCount'), n0)
numRow(rows, '水霧初速', 0, 60, 1, numGet('spraySpeed'), numSet('spraySpeed'), n0)
numRow(rows, '水霧錐角', 0, 90, 1, coneGet('sprayCone'), coneSet('sprayCone'), deg)
numRow(rows, '水柱根數', 0, 24, 1, numGet('jetCount'), numSet('jetCount'), n0)
numRow(rows, '水冠半徑', 0, 30, 0.5, numGet('jetSpread'), numSet('jetSpread'), f1)
numRow(rows, '水柱高', 0, 80, 1, numGet('jetHeight'), numSet('jetHeight'), n0)
numRow(rows, '水柱粗', 0, 8, 0.1, numGet('jetRadius'), numSet('jetRadius'), f1)
numRow(rows, '水霧／柱', 0, 8, 1, numGet('mistPerJet'), numSet('mistPerJet'), n0)
numRow(rows, '水霧尺寸', 0, 8, 0.1, numGet('mistSize'), numSet('mistSize'), f1)

/** 吐成可以直接貼回 `blast.ts` 的字面值。 */
function dump(): void {
  const p = live()
  const d = (v: number): string => '(' + Math.round((v * 180) / Math.PI) + ' * Math.PI) / 180'
  out.textContent = [
    '// BLAST_PACE = ' + pace + '　當量 ' + yieldRatio + '×',
    'export const ' + (kind === 'land' ? 'LAND_BLAST' : 'WATER_BLAST') +
      ': BlastParams = {',
    '  fireCount: ' + p.fireCount + ',',
    '  fireSpeed: ' + p.fireSpeed + ',',
    '  fireSize: ' + p.fireSize + ',',
    '  fireCone: ' + d(p.fireCone) + ',',
    '  smokeCount: ' + p.smokeCount + ',',
    '  smokeSpeed: ' + p.smokeSpeed + ',',
    '  smokeSize: ' + p.smokeSize + ',',
    '  smokeCone: ' + d(p.smokeCone) + ',',
    '  dustCount: ' + p.dustCount + ',',
    '  dustSpeed: ' + p.dustSpeed + ',',
    '  dustSize: ' + p.dustSize + ',',
    '  dustCone: ' + d(p.dustCone) + ',',
    '  sprayCount: ' + p.sprayCount + ',',
    '  spraySpeed: ' + p.spraySpeed + ',',
    '  sprayCone: ' + d(p.sprayCone) + ',',
    '  jetCount: ' + p.jetCount + ',',
    '  jetSpread: ' + p.jetSpread + ',',
    '  jetHeight: ' + p.jetHeight + ',',
    '  jetRadius: ' + p.jetRadius + ',',
    '  mistPerJet: ' + p.mistPerJet + ',',
    '  mistSize: ' + p.mistSize + ',',
    '  glowSize: ' + p.glowSize + ',',
    '  glowAlpha: ' + p.glowAlpha + ',',
    '}',
  ].join('\n')
}

// ── 分頁按鈕 ────────────────────────────────────────────

function tabs(host: HTMLElement, items: readonly { id: string, name: string }[],
  pick: (id: string) => void): void {
  for (const it of items) {
    const b = document.createElement('button')
    b.dataset.id = it.id
    b.textContent = it.name
    b.addEventListener('click', () => {
      pick(it.id)
      for (const other of Array.from(host.children)) {
        other.classList.toggle('on', (other as HTMLElement).dataset.id === it.id)
      }
    })
    host.appendChild(b)
  }
}

const kindTabs = document.getElementById('kind') as HTMLElement
tabs(kindTabs, [{ id: 'land', name: '墜地' }, { id: 'water', name: '落水' }], (id) => {
  kind = id as Kind
  for (const b of bindings) b.refresh()
  dump()
  fire()
})

const styleTabs = document.getElementById('style') as HTMLElement
tabs(styleTabs, [
  { id: 'billboard', name: '圓片' }, { id: 'chunks', name: '球塊' },
], (id) => {
  fireStyle = id as FireStyle
  fire()
})

const terrainTabs = document.getElementById('terrain') as HTMLElement
tabs(terrainTabs, [
  { id: 'sea', name: '海面' }, { id: 'archipelago', name: '群島' },
  { id: 'farmland', name: '內陸' }, { id: 'leuna', name: '洛伊納' },
], (id) => setTerrain(id as TerrainKind))

let tod: TimeOfDay = 'noon'
const todTabs = document.getElementById('tod') as HTMLElement
tabs(todTabs, TIME_OF_DAY_IDS.map((t) => ({ id: t, name: DAY_PALETTES[t].name })), (id) => {
  tod = id as TimeOfDay
  applyTimeOfDay(ctx, terrain, tod)
})

/**
 * 相機擺到爆點旁邊。
 *
 * 【要跟著地面走】內陸的地面在幾百公尺高，釘死在 y = 0 的話鏡頭會埋在土裡。
 * 【47 m】爆炸的量體約 30 m，65° 視野在這個距離的畫面寬是 70 m —— 再遠就
 * 只是一個點，再近則塵團會蓋滿整個畫面。
 */
function placeCamera(): void {
  const y = terrain.heightAt(BX, BZ, elapsed)
  ctx.camera.position.set(30, y + 16, 36)
  controls.target.set(BX, y + 10, BZ)
  controls.update()
}

function setTerrain(k: TerrainKind): void {
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrain = createTerrain(k)
  ctx.scene.add(terrain.object)
  placeCamera()
  // 【新地形不知道現在是幾點】剛建出來是正午 —— 少了這一行，切完地形天是
  // 黃昏而海是中午的藍（`daylight.ts` 為同一件事留過同一句）
  applyTimeOfDay(ctx, terrain, tod)
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

for (const el of Array.from(kindTabs.children)) {
  el.classList.toggle('on', (el as HTMLElement).dataset.id === 'land')
}
for (const el of Array.from(styleTabs.children)) {
  el.classList.toggle('on', (el as HTMLElement).dataset.id === 'billboard')
}
for (const el of Array.from(terrainTabs.children)) {
  el.classList.toggle('on', (el as HTMLElement).dataset.id === 'sea')
}
for (const el of Array.from(todTabs.children)) {
  el.classList.toggle('on', (el as HTMLElement).dataset.id === 'noon')
}
applyTimeOfDay(ctx, terrain, tod)
dump()
fire()

/**
 * 截圖用的鉤子。**只有 `test/e2e/blast-sheet.e2e.ts` 讀它。**
 *
 * 【為什麼不能只靠 rAF 加 setTimeout】爆炸整個只有 2.5 秒，而 rAF 的間隔
 * 由瀏覽器決定 —— 兩種畫法各截十二張的話，兩排的時間點對不起來，比對就
 * 沒有意義。這裡改用固定 dt 手動推進，每一格恰好差 0.1 s。
 *
 * 【`toDataURL` 為什麼讀得到】WebGL 的繪圖緩衝在 rAF 之外預設已經被清掉，
 * 但 `render()` 之後的**同一個同步區塊**內仍然讀得到。
 */
interface Probe {
  fire(k: Kind, style: FireStyle): void
  /** 截圖前設定當量。會重建池 */
  setYield(v: number): void
  /** 煙用不用貼圖。會重建池 */
  setTextured(v: boolean): void
  /** 火球要不要光暈 */
  setGlow(v: boolean): void
  sheet(k: Kind, style: FireStyle, frames: number, dt: number,
    cols: number, cellW: number, cellH: number): string
}
const probe: Probe = {
  fire(k, style) {
    kind = k
    fireStyle = style
    fire()
  },
  setYield(v) {
    yieldRatio = v
    rebuildPaced()
    for (const b of bindings) b.refresh()
  },
  setTextured(v) {
    textured = v
    rebuildPaced()
  },
  setGlow(v) {
    glowOn = v
  },
  sheet(k, style, frames, dt, cols, cellW, cellH) {
    const sheetCanvas = document.createElement('canvas')
    const rowsN = Math.ceil(frames / cols)
    sheetCanvas.width = cols * cellW
    sheetCanvas.height = rowsN * cellH
    const g = sheetCanvas.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, sheetCanvas.width, sheetCanvas.height)

    this.fire(k, style)
    for (let f = 0; f < frames; f++) {
      for (const p of ALL()) p.step(dt)
      ctx.renderer.render(ctx.scene, ctx.camera)
      const col = f % cols
      const rowI = Math.floor(f / cols)
      g.drawImage(canvas, col * cellW, rowI * cellH, cellW, cellH)
      g.font = '13px ui-monospace, monospace'
      g.fillStyle = '#7dfba8'
      g.fillText(((f + 1) * dt).toFixed(1) + 's', col * cellW + 8, rowI * cellH + 18)
      g.strokeStyle = 'rgba(125,251,168,0.25)'
      g.strokeRect(col * cellW + 0.5, rowI * cellH + 0.5, cellW - 1, cellH - 1)
    }
    return sheetCanvas.toDataURL('image/png')
  },
}
;(window as unknown as Record<string, unknown>)['__blastProbe'] = probe

let last = performance.now()

function frame(now: number): void {
  // 【牆鐘不縮放、模擬時間才縮放】地形的浪與相機阻尼要走真實時間，否則
  // 慢動作下整個場景像卡住
  const wall = Math.min((now - last) / 1000, 0.25)
  last = now
  const dt = wall * timeScale
  elapsed += dt
  sinceFire += wall

  if (autoEvery > 0 && sinceFire >= autoEvery) fire()

  for (const p of ALL()) p.step(dt)
  controls.update()
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)

  liveOut.textContent =
    `火 ${fireball.live}　煙 ${smoke.live}　塵 ${dust.live}\n` +
    `水霧 ${spray.live}　水柱 ${splashes.live}\n` +
    `距上一發 ${sinceFire.toFixed(1)}s`
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
