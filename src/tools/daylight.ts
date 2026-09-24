import { Quaternion, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createLeunaTerrainWithField, createTerrain, type Terrain } from '../render/terrain'
import { loadLeunaDem } from './leunaDem'
import { preloadTerrainScenery } from '../render/terrain'
import { createShipModels, preloadShipModels } from '../render/ships'
import { buildAircraft, preloadAircraftModels } from '../render/geometry/buildAircraft'
import {
  DAY_PALETTES, TIME_OF_DAY_IDS, applyTimeOfDay, type DayPalette, type TimeOfDay,
} from '../render/timeOfDay'
import { createShip, SHIP_CLASSES, type Ship } from '../world/ships'
import { createShipGuns } from '../world/shipGuns'
import { B17G } from '../specs/b17g'
import type { TerrainKind } from '../world/terrainKind'
import { createGroundModels } from '../render/groundTargets'
import { preloadGroundModels } from '../render/geometry/ground'
import { createGroundTarget, type GroundTarget } from '../world/groundTargets'
import { FLAK_SITES, PLANT_TARGETS } from '../world/leuna'

/**
 * 時段展示區 —— 純調校用的開發工具，不屬於遊戲。
 *
 * 【為什麼要有它】四個時段各有十五個旋鈕，而它們只有在「天、海、船、飛機
 * 同時在畫面上」時才判斷得出來。在關卡裡調的話每改一個數字要重開一場。
 *
 * 【它走的是遊戲的那條路徑】`createScene` + `createTerrain` + `applyTimeOfDay`，
 * 與 `main.ts` 完全相同。工具若自己抄一份光照，看到的就不是遊戲裡的東西。
 *
 * 進入方式：`npm run dev` 之後開 /tools/daylight.html。
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

/**
 * 目前的地形。**換地形走與 `main.ts` 的 `enterBattle` 完全相同的三步**：
 * 移除、`dispose`、重建 —— 那條路徑每一場都在走，工具照走才測得到它。
 */
// 【廠區的佈景與河道】切到洛伊納要先載完，`createTerrain` 是同步的
await preloadTerrainScenery('leuna')

/**
 * 展示區自己的地形清單：遊戲的四種，加一種只有這裡有的。
 *
 * 【`leuna-real` 不是 `TerrainKind`】把它加進那個聯集會讓遭遇戰、關卡卡片、
 * 存檔全部看得到一個遊戲裡不存在的地形。展示區的分頁是展示區的事。
 */
type DemoTerrain = TerrainKind | 'leuna-real'

// 【實測高程先載好】與 GLB 同一個理由：`createTerrain` 那條路徑是同步的
const leunaRealField = await loadLeunaDem()

let terrain: Terrain = createTerrain('sea')
ctx.scene.add(terrain.object)

function setTerrain(kind: DemoTerrain): void {
  ctx.scene.remove(terrain.object)
  terrain.dispose()
  terrain = kind === 'leuna-real'
    ? createLeunaTerrainWithField(leunaRealField)
    : createTerrain(kind)
  ctx.scene.add(terrain.object)
  // 【新的地形不知道現在是幾點】它剛建出來是正午 —— 少了這一行，切完地形
  // 天是黃昏而海是中午的藍
  terrain.setPalette(live)
  const leuna = kind === 'leuna' || kind === 'leuna-real'
  // 內陸沒有海，船浮在田上很怪
  const inland = kind === 'farmland' || leuna
  shipModels.object.visible = !inland
  // 【洛伊納把廠區擺上去】12 座構件與 8 座砲位，就是任務裡的那一份佈局；
  // 飛機停在投彈航路上 —— 地形、廠區、天色三者只有同時在畫面上才判斷得出來
  plantModels.object.visible = leuna
  if (leuna) {
    plane.group.position.set(0, 4000, -3000)
    plane.group.quaternion.identity()
  } else {
    // 【內陸把飛機抬高】田地的丘陵最高到 HILL_PEAK_MAX，60 m 會插進山裡
    plane.group.position.set(-45, kind === 'farmland' ? 420 : 60, -140)
    plane.group.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.55)
  }
  placeCamera(kind)
  // 【洛伊納的色盤是為深秋正午調的】切到它時段跟著切
  if (leuna) selectTod('novemberNoon')
}

/** 內陸的視野要拉遠拉高才看得到田與樹的層次；洛伊納從廠區上空看投彈航路。 */
function placeCamera(kind: DemoTerrain): void {
  if (kind === 'leuna' || kind === 'leuna-real') {
    ctx.camera.position.set(0, 4600, -2500)
    controls.target.set(0, 0, -7000)
  } else if (kind === 'farmland') {
    ctx.camera.position.set(0, 520, 900)
    controls.target.set(0, 60, -600)
  } else {
    ctx.camera.position.set(0, 95, 260)
    controls.target.set(0, 30, -420)
  }
  controls.update()
}

/**
 * 定格機位，給截圖用（`test/e2e/leuna-relief.e2e.ts`）。與 `main.ts` 的
 * `__still` 同一個用途 —— 沒有它，展示區只能靠拖曳，兩張圖就沒得比。
 */
;(window as unknown as Record<string, unknown>)['__cam'] = (
  x: number, y: number, z: number, tx: number, ty: number, tz: number,
) => {
  ctx.camera.position.set(x, y, z)
  controls.target.set(tx, ty, tz)
  controls.update()
}

/** 場景的檢查出口，給截圖腳本除錯用 */
;(window as unknown as Record<string, unknown>)['__scene'] = () => ctx.scene

await preloadShipModels(['wichita', 'fletcher'])
await preloadAircraftModels()
await preloadGroundModels()

/** 洛伊納的廠區與砲位，照任務卡的佈局。墊面高度是 0，不必落地 */
const plantTargets: GroundTarget[] = [
  ...PLANT_TARGETS.map((p, i) => createGroundTarget(i, p.kind, 'red', p.x, p.z, p.heading)),
  ...FLAK_SITES.map((s, i) => createGroundTarget(
    PLANT_TARGETS.length + i, 'flakHeavy', 'red', s.x, s.z, s.heading,
  )),
]
const plantModels = createGroundModels(plantTargets)
plantModels.update(plantTargets, ctx.camera.position)
plantModels.object.visible = false
ctx.scene.add(plantModels.object)

/** 三艘船排成一個看得出縱深的斜列。 */
const ships: Ship[] = [
  createShip(0, SHIP_CLASSES.wichita, 'red', 60, -420, 0.35, 0),
  createShip(1, SHIP_CLASSES.fletcher, 'red', -230, -700, 0.35, 0),
  createShip(2, SHIP_CLASSES.wichita, 'red', 380, -1050, 0.35, 0),
]
for (const s of ships) s.guns = createShipGuns(s.cls)
const shipModels = createShipModels(ships)
ctx.scene.add(shipModels.object)
shipModels.update(ships, () => {})

// 一架 B-17 當機體受光的參照 —— 機身上的明暗才判斷得出太陽的方向對不對；
// 洛伊納那一關玩家開的就是它
const plane = buildAircraft(B17G)
plane.group.position.set(-45, 60, -140)
plane.group.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 0.55)
ctx.scene.add(plane.group)

const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08
placeCamera('sea')

/**
 * 可調的那一份 palette。
 *
 * 【按鈕載入預設值，滑桿改的是這一份】所以「切到黃昏再微調」不會回頭汙染
 * `DAY_PALETTES`，而右下角吐出來的就是可以貼回 `timeOfDay.ts` 的那段。
 */
type Mutable = { -readonly [K in keyof DayPalette]: DayPalette[K] }
let live: Mutable = { ...DAY_PALETTES.dusk }

/** 太陽方向以仰角／方位角操作 —— 直接調三個分量沒有人調得動。 */
let sunElev = 0
let sunAzim = 0

function readSunAngles(): void {
  const [x, y, z] = live.sunDir
  const m = Math.hypot(x, y, z)
  sunElev = (Math.asin(y / m) * 180) / Math.PI
  sunAzim = (Math.atan2(x / m, z / m) * 180) / Math.PI
}

function writeSunDir(): void {
  const e = (sunElev * Math.PI) / 180
  const a = (sunAzim * Math.PI) / 180
  live.sunDir = [Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a)]
}

function apply(): void {
  ctx.setPalette(live)
  terrain.setPalette(live)
  dump()
}

const panel = document.getElementById('rows') as HTMLElement
const out = document.getElementById('out') as HTMLElement

function row(label: string): HTMLElement {
  const d = document.createElement('div')
  d.className = 'row'
  const l = document.createElement('label')
  l.textContent = label
  d.appendChild(l)
  panel.appendChild(d)
  return d
}

interface Binding { refresh(): void }
const bindings: Binding[] = []

type ColorKey = 'skyHorizon' | 'skyZenith' | 'sunColor' | 'hemiSky' | 'hemiGround'
  | 'ambientColor' | 'seaColor' | 'seaHorizon'

function colorRow(label: string, key: ColorKey): void {
  const d = row(label)
  const input = document.createElement('input')
  input.type = 'color'
  const hex = document.createElement('span')
  hex.className = 'val'
  const refresh = (): void => {
    input.value = '#' + live[key].toString(16).padStart(6, '0')
    hex.textContent = input.value
  }
  input.addEventListener('input', () => {
    live[key] = parseInt(input.value.slice(1), 16)
    hex.textContent = input.value
    apply()
  })
  d.append(input, hex)
  bindings.push({ refresh })
  refresh()
}

function numRow(
  label: string, min: number, max: number, step: number,
  get: () => number, set: (v: number) => void, fmt: (v: number) => string,
): void {
  const d = row(label)
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
    apply()
  })
  d.append(input, val)
  bindings.push({ refresh })
  refresh()
}

const f2 = (v: number): string => v.toFixed(2)
const deg1 = (v: number): string => v.toFixed(1) + '°'
const deg0 = (v: number): string => v.toFixed(0) + '°'

colorRow('天　地平', 'skyHorizon')
colorRow('天　天頂', 'skyZenith')
numRow('漸層指數', 0.3, 1.5, 0.01, () => live.skyPower, (v) => { live.skyPower = v }, f2)
numRow('星點', 0, 1, 0.05, () => live.stars, (v) => { live.stars = v }, f2)
numRow('日　仰角', -5, 90, 0.5, () => sunElev, (v) => { sunElev = v; writeSunDir() }, deg1)
numRow('日　方位', -180, 180, 1, () => sunAzim, (v) => { sunAzim = v; writeSunDir() }, deg0)
colorRow('日　色', 'sunColor')
numRow('日　強度', 0, 3, 0.02, () => live.sunIntensity, (v) => { live.sunIntensity = v }, f2)
colorRow('半球　天', 'hemiSky')
colorRow('半球　地', 'hemiGround')
numRow('半球強度', 0, 1.6, 0.02, () => live.hemiIntensity,
  (v) => { live.hemiIntensity = v }, f2)
colorRow('環境色', 'ambientColor')
numRow('環境強度', 0, 0.6, 0.01, () => live.ambientIntensity,
  (v) => { live.ambientIntensity = v }, f2)
colorRow('海　本色', 'seaColor')
colorRow('海　地平', 'seaHorizon')
numRow('碎光', 0, 1.5, 0.01, () => live.sparkle, (v) => { live.sparkle = v }, f2)
numRow('植被點', 0, 1.5, 0.01, () => live.foliage, (v) => { live.foliage = v }, f2)
numRow('霧密度', 0.1, 10, 0.05, () => live.fogDensity * 1e5,
  (v) => { live.fogDensity = v * 1e-5 }, (v) => v.toFixed(2) + 'e-5')

function refreshAll(): void {
  readSunAngles()
  for (const b of bindings) b.refresh()
}

/** 吐成可以直接貼回 `timeOfDay.ts` 的字面值。 */
function dump(): void {
  const h = (v: number): string => '0x' + v.toString(16).padStart(6, '0')
  const d = live.sunDir.map((v) => Number(v.toFixed(3)))
  out.textContent = [
    '  ' + live.id + ': {',
    "    id: '" + live.id + "',",
    "    name: '" + live.name + "',",
    '    skyHorizon: ' + h(live.skyHorizon) + ',',
    '    skyZenith: ' + h(live.skyZenith) + ',',
    '    skyPower: ' + live.skyPower + ',',
    '    stars: ' + live.stars + ',',
    '    sunDir: [' + d[0] + ', ' + d[1] + ', ' + d[2] + '],',
    '    sunColor: ' + h(live.sunColor) + ',',
    '    sunIntensity: ' + live.sunIntensity + ',',
    '    hemiSky: ' + h(live.hemiSky) + ',',
    '    hemiGround: ' + h(live.hemiGround) + ',',
    '    hemiIntensity: ' + live.hemiIntensity + ',',
    '    ambientColor: ' + h(live.ambientColor) + ',',
    '    ambientIntensity: ' + live.ambientIntensity + ',',
    '    seaColor: ' + h(live.seaColor) + ',',
    '    seaHorizon: ' + h(live.seaHorizon) + ',',
    '    sparkle: ' + live.sparkle + ',',
    '    foliage: ' + live.foliage + ',',
    '    fogDensity: ' + live.fogDensity.toExponential(1) + ',',
    '  },',
  ].join('\n')
}

const terrainTabs = document.getElementById('terrain') as HTMLElement

const TERRAINS: readonly { kind: DemoTerrain, name: string }[] = [
  { kind: 'sea', name: '海面' },
  { kind: 'archipelago', name: '群島' },
  { kind: 'farmland', name: '內陸' },
  { kind: 'leuna', name: '洛伊納' },
  { kind: 'leuna-real', name: '洛伊納（實測高程）' },
  { kind: 'poltava', name: '波爾塔瓦' },
]

function selectTerrain(kind: DemoTerrain): void {
  setTerrain(kind)
  for (const b of Array.from(terrainTabs.children)) {
    b.classList.toggle('on', b.id === 'k-' + kind)
  }
}

for (const t of TERRAINS) {
  const b = document.createElement('button')
  b.id = 'k-' + t.kind
  b.textContent = t.name
  b.addEventListener('click', () => selectTerrain(t.kind))
  terrainTabs.appendChild(b)
}

const tabs = document.getElementById('tabs') as HTMLElement

function selectTod(tod: TimeOfDay): void {
  live = { ...DAY_PALETTES[tod] }
  for (const b of Array.from(tabs.children)) b.classList.toggle('on', b.id === 't-' + tod)
  refreshAll()
  // 【走 applyTimeOfDay 而不是 apply()】按鈕代表「遊戲裡看到的那一組」，
  // 所以它要經過與 `main.ts` 完全相同的那一支
  applyTimeOfDay(ctx, terrain, tod)
  dump()
}

for (const tod of TIME_OF_DAY_IDS) {
  const b = document.createElement('button')
  b.id = 't-' + tod
  b.textContent = DAY_PALETTES[tod].name
  b.addEventListener('click', () => selectTod(tod))
  tabs.appendChild(b)
}

const copy = document.getElementById('copy') as HTMLButtonElement
copy.addEventListener('click', () => {
  void navigator.clipboard.writeText(out.textContent ?? '')
  copy.textContent = '已複製'
  window.setTimeout(() => { copy.textContent = '複製設定' }, 1200)
})

selectTerrain('sea')
selectTod('dusk')

const SPIN = new Quaternion()
let last = performance.now()
let elapsed = 0

function frame(now: number): void {
  const dt = Math.min((now - last) / 1000, 0.25)
  last = now
  elapsed += dt
  controls.update()
  // 螺旋槳照轉 —— 圓盤在夜間看起來差很多，那也是要看的東西之一
  plane.setPropSpin(elapsed * 120, true)
  plane.group.quaternion.slerp(SPIN.setFromAxisAngle(new Vector3(0, 1, 0), 0.55), 1)
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
