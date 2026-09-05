import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain, type Terrain } from '../render/terrain'
import { createFireball } from '../render/fireball'
import { createSmoke } from '../render/smoke'
import { createSpray, WATER_COLOR } from '../render/spray'
import { createSplashes } from '../render/splash'
import {
  LAND_BLAST, WATER_BLAST, createDust, emitBlast, type BlastParams, type BlastPools,
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

let terrain: Terrain = createTerrain('sea')
ctx.scene.add(terrain.object)

const fireball = createFireball()
const smoke = createSmoke()
const dust = createDust()
const spray = createSpray(WATER_COLOR)
const splashes = createSplashes()
for (const p of [fireball, smoke, dust, spray, splashes]) ctx.scene.add(p.object)

const splashEvents = createImpacts()
const pools: BlastPools = { fireball, smoke, dust, spray, splashEvents }

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

function fire(): void {
  if (clearFirst) {
    for (const p of [fireball, smoke, dust, spray, splashes]) p.reset()
  }
  if (!fixedSeed) seed = (seed + 7919) >>> 0
  const y = terrain.heightAt(BX, BZ, elapsed)
  emitBlast(pools, live(), BX, y, BZ, seed)
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

numRow(sceneRows, '時間', 0.05, 1, 0.05, () => timeScale, (v) => { timeScale = v }, f1)
numRow(sceneRows, '自動重播', 0, 8, 0.5,
  () => autoEvery, (v) => { autoEvery = v }, (v) => (v === 0 ? '關' : v.toFixed(1) + 's'))
chkRow(sceneRows, '重播前清場', () => clearFirst, (v) => { clearFirst = v })
chkRow(sceneRows, '固定亂數（同一發）', () => fixedSeed, (v) => { fixedSeed = v })

numRow(rows, '火　顆數', 0, 60, 1, numGet('fireCount'), numSet('fireCount'), n0)
numRow(rows, '火　初速', 0, 60, 1, numGet('fireSpeed'), numSet('fireSpeed'), n0)
numRow(rows, '火　尺寸', 0.2, 5, 0.1, numGet('fireSize'), numSet('fireSize'), f1)
numRow(rows, '火　錐角', 0, 90, 1, coneGet('fireCone'), coneSet('fireCone'), deg)
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
numRow(rows, '水柱根數', 0, 12, 1, numGet('jetCount'), numSet('jetCount'), n0)
numRow(rows, '水柱半徑', 0, 15, 0.5, numGet('jetSpread'), numSet('jetSpread'), f1)

/** 吐成可以直接貼回 `blast.ts` 的字面值。 */
function dump(): void {
  const p = live()
  const d = (v: number): string => '(' + Math.round((v * 180) / Math.PI) + ' * Math.PI) / 180'
  out.textContent = [
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

const terrainTabs = document.getElementById('terrain') as HTMLElement
tabs(terrainTabs, [
  { id: 'sea', name: '海面' }, { id: 'archipelago', name: '群島' },
  { id: 'farmland', name: '內陸' },
], (id) => setTerrain(id as TerrainKind))

let tod: TimeOfDay = 'noon'
const todTabs = document.getElementById('tod') as HTMLElement
tabs(todTabs, TIME_OF_DAY_IDS.map((t) => ({ id: t, name: DAY_PALETTES[t].name })), (id) => {
  tod = id as TimeOfDay
  applyTimeOfDay(ctx, terrain, tod)
})

function setTerrain(k: TerrainKind): void {
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrain = createTerrain(k)
  ctx.scene.add(terrain.object)
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
ctx.camera.position.set(52, 26, 62)
controls.target.set(0, 12, 0)
controls.update()

for (const el of Array.from(kindTabs.children)) {
  el.classList.toggle('on', (el as HTMLElement).dataset.id === 'land')
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

  for (const p of [fireball, smoke, dust, spray, splashes]) p.step(dt)
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
