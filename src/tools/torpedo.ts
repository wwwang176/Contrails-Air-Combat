import { TextureLoader, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { createShipModels, preloadShipModels } from '../render/ships'
import { createTorpedoes } from '../render/bombs'
import { createWakes } from '../render/wake'
import { createFireChunks } from '../render/chunks'
import { createSpray, emitSpray, WAKE_SPRAY_COUNT, WATER_COLOR } from '../render/spray'
import { createSplashes } from '../render/splash'
import { JET_RISE, createWaterJets } from '../render/waterJets'
import {
  BLAST_PACE, TORPEDO_BLAST, createBlastSmoke, createDust, createEmberSmoke,
  createFireGlow, createWaterMist, emitBlast, emitEmber, emitMist, scaleBlast,
  type BlastParams, type BlastPools,
} from '../render/blast'
import {
  TIME_OF_DAY_IDS, applyTimeOfDay, type TimeOfDay,
} from '../render/timeOfDay'
import { World } from '../world/World'
import { createShip, SHIP_CLASSES, type Ship } from '../world/ships'
import { createShipGuns } from '../world/shipGuns'
import { clearImpacts } from '../world/events'
import { TORPEDO_DEPTH, TORPEDO_RANGE, TORPEDO_SPEED, WAKE_INTERVAL } from '../world/torpedo'
import {
  BOMB_TERMINAL_SPEED, bombDragK, solveImpact,
  type BombState, type Impact,
} from '../world/bomb'
import { canRelease, TORPEDO_ENVELOPE } from '../weapons/releaseEnvelope'
import { loadoutOf } from '../weapons/stores'

/**
 * 魚雷展示區 —— 純調校用的開發工具，不屬於遊戲。
 *
 * 【為什麼要有它】魚雷從投放到命中要走 30 秒以上，中間有四段各自會壞的
 * 接合：投放 → 空中段 → 入水 → 航跡 → 引爆。在關卡裡看的話一次循環要三
 * 分鐘，而且提前量沒抓對就什麼都看不到。
 *
 * 【它走的是遊戲的那條路徑】`World.step` 推進魚雷、`World.dropTorpedo` 投放、
 * 事件由 `torpedoEvents` / `torpedoWakeEvents` 出來 —— 與 `main.ts` 讀的是
 * 同一批。工具自己抄一份彈道的話，看到的就不是遊戲裡的東西。
 *
 * 進入方式：`npm run dev` 之後開 /torpedo.html。
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

const terrain = createTerrain('sea')
ctx.scene.add(terrain.object)

const smokeTex = await new TextureLoader().loadAsync('/textures/smoke.png')
await preloadShipModels(['fletcher'])

// ── 世界 ────────────────────────────────────────────────

const world = new World()
world.groundAt = terrain.collisionHeightAt
world.waterAt = terrain.waterAt
world.bombDrag = bombDragK(BOMB_TERMINAL_SPEED)

/**
 * 靶艦。**艏向 +X** —— 魚雷沿 −Z 過來，所以船是橫著切過航線的，提前量才
 * 看得出來。
 *
 * 【為什麼是 −π/2】船是機體 −Z 轉過 heading 前進。繞 +Y 轉 −90°
 * 才把 (0,0,−1) 轉成 (+1,0,0)；+90° 是往 −X，那會讓下面的「船前方 = x +
 * lead」整個反過來，而症狀是穩定地擦身而過 200 多公尺。
 */
const ship: Ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, -Math.PI / 2, 8)
ship.guns = createShipGuns(ship.cls)
world.ships.push(ship)
const shipModels = createShipModels([ship])
ctx.scene.add(shipModels.object)

// ── 池 ──────────────────────────────────────────────────

const torpedoVisuals = createTorpedoes()
ctx.scene.add(torpedoVisuals.object)

const spray = createSpray(WATER_COLOR)
const splashes = createSplashes()
for (const p of [spray, splashes]) ctx.scene.add(p.object)

/** 這一份的縮放後配方。模組級 —— 每一次引爆不配置 */
const SCALED: { -readonly [K in keyof BlastParams]: number } = { ...TORPEDO_BLAST }

const jetHandoff = (
  x: number, y: number, z: number, height: number, radius: number, slot: number,
): void => {
  emitMist(mist, slot, SCALED.mistPerJet, SCALED.mistSize, x, y, z, height, radius)
}

let mist = createWaterMist(undefined, BLAST_PACE, smokeTex)
let jets = createWaterJets({
  capacity: 256, life: 1.5 * BLAST_PACE, rise: JET_RISE, alphaFrom: 0.8,
  onFade: jetHandoff,
})
/**
 * 火球與它交棒的煙。**與 `main.ts` 同一組建構函數** —— 命中的爆炸是水柱
 * 加一團火，火那一半走的就是球塊那條路。
 */
const ember = createEmberSmoke(undefined, BLAST_PACE, smokeTex)
const chunks = createFireChunks(undefined, BLAST_PACE,
  (x, y, z, vx, vy, vz, d, slot) => { emitEmber(ember, slot, x, y, z, vx, vy, vz, d) })
const glow = createFireGlow(undefined, BLAST_PACE)
const smoke = createBlastSmoke(undefined, BLAST_PACE, smokeTex)
/** 【塵恆是空的】`TORPEDO_BLAST` 的 `dustCount` 是 0 —— 海上沒有土 */
const dust = createDust(undefined, BLAST_PACE, smokeTex)
const wakes = createWakes()
for (const p of [chunks, ember, glow, smoke, dust, mist, jets]) ctx.scene.add(p.object)
ctx.scene.add(wakes.object)

/**
 * 【`splashEvents` 借用 `World` 的那一個】`emitBlast` 在**沒有** `jets`
 * 的呼叫端才會走它；這裡兩者都給，所以它實際上收不到東西。共用一份就不必
 * 多開一個永遠是空的池。
 */
const POOLS = (): BlastPools => ({
  fireball: chunks, smoke, dust, spray,
  splashEvents: world.splashEvents,
  glow, jets,
})

// ── 可調的東西 ──────────────────────────────────────────

/** 投放條件 */
let agl = 60
let tas = 90
let roll = 0
let pitch = 0
/** 投放點離靶艦多遠（水平），m */
let standoff = 700
/** 瞄準的提前量，m。往靶艦航向前方偏這麼多 */
let lead = 240
/** 靶艦航速，m/s */
let shipSpeed = 8
/** 提前量自己解。關掉才拉得動上面那一格 */
let autoLead = true

/** 魚雷的四個設計值 —— 就地換進池子 */
let speed = TORPEDO_SPEED
let range = TORPEDO_RANGE
let depth = TORPEDO_DEPTH
let wakeEvery = WAKE_INTERVAL
let wakeCount = WAKE_SPRAY_COUNT

/** 這一份的爆炸配方 */
type Mutable = { -readonly [K in keyof BlastParams]: BlastParams[K] }
const live: Mutable = { ...TORPEDO_BLAST }

let timeScale = 1
/**
 * 魚雷結束之後**再等**幾秒才重播，s。0 = 關。
 *
 * 【為什麼不是固定間隔】一趟從投放到命中要 17 秒以上，而那個數字隨投放
 * 距離與雷速變動。寫成固定間隔的話，滑桿一拉就會在還沒撞到船之前重播。
 */
let autoAfter = 3
let tod: TimeOfDay = 'noon'
type ViewId = 'release' | 'chase' | 'target'
let view: ViewId = 'chase'

const DT = 1 / 240
let elapsed = 0
let sinceFire = 0
/** 魚雷結束之後過了幾秒。自動重播看它 */
let sinceEnd = 0
let seed = 1

const DAMAGE = loadoutOf('g4m')?.damage ?? 15_000

// ── 重播 ────────────────────────────────────────────────

const DROP = new Vector3()
const AIM = new Vector3()
const VEL = new Vector3()
const NOSE = new Vector3()

const SOLVE: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
const HIT: Impact = { x: 0, y: 0, z: 0, seconds: 0, speed: 0 }

/**
 * 打中所需要的提前量，m。
 *
 * 【為什麼要解而不是拉一個數字】空中段就吃掉大半個投放距離：60 m 高、
 * 90 m/s 之下前拋約 300 m，只有剩下的那一段才是雷跑的。照「投放距離 ÷
 * 雷速」抓提前量會抓太多，魚雷從船的**前面**跑過去。
 *
 * 【幾何是解析的】航線恆是 −Z（提前量只平移 X），所以攔截點的 x 固定在
 * 瞄準點上，總時間 = 空中段 + 入水點到 z = 0 的那一段 ÷ 雷速。
 */
function solveLead(): number {
  SOLVE.x = 0; SOLVE.y = agl; SOLVE.z = standoff
  const p = (pitch * Math.PI) / 180
  SOLVE.vx = 0
  SOLVE.vy = Math.sin(p) * tas
  SOLVE.vz = -Math.cos(p) * tas
  if (!solveImpact(SOLVE, world.bombDrag, () => 0, 1 / 240, HIT)) return 0
  const run = Math.max(0, HIT.z)
  return shipSpeed * (HIT.seconds + run / speed)
}

/**
 * 投放的姿態與位置。**回傳的就是準星的紅綠。**
 *
 * 【投放點由 standoff 與提前量推】從靶艦的**未來位置**往回退 `standoff`，
 * 所以拉提前量的滑桿時，飛機是繞著靶艦走的 —— 那正是雷擊的進場。
 */
function setupRelease(): boolean {
  // 靶艦回到起點，往 +X 走
  ship.position.set(-standoff * 0.5, 0, 0)
  ship.speed = shipSpeed
  ship.hp = ship.cls.hp
  ship.alive = true
  // 【砲位整組重建】`ShipAAZone` 上沒有血量（那是 `weapons/turret.ts` 的），
  // 而重播要的是一艘全新的船
  ship.guns = createShipGuns(ship.cls)

  if (autoLead) {
    lead = Math.round(solveLead())
    for (const b of bindings) b.refresh()
  }

  // 瞄準點：靶艦前方 `lead` 公尺
  AIM.set(ship.position.x + lead, 0, ship.position.z)
  // 投放點：從瞄準點沿 −Z 退開，高度 agl
  DROP.set(AIM.x, agl, AIM.z + standoff)

  // 速度：朝瞄準點，帶上俯仰
  NOSE.set(AIM.x - DROP.x, 0, AIM.z - DROP.z).normalize()
  const p = (pitch * Math.PI) / 180
  VEL.set(NOSE.x * Math.cos(p), Math.sin(p), NOSE.z * Math.cos(p)).multiplyScalar(tas)

  return canRelease(TORPEDO_ENVELOPE, (roll * Math.PI) / 180, p, agl, tas)
}

function fire(): void {
  world.torpedoes.clear()
  clearImpacts(world.torpedoEvents)
  clearImpacts(world.torpedoWakeEvents)
  clearImpacts(world.splashEvents)
  for (const p of [spray, splashes, chunks, ember, glow, smoke, dust, mist, jets]) p.reset()
  wakes.reset()

  world.torpedoes.tuning = { speed, range, depth, wakeInterval: wakeEvery }
  setupRelease()
  world.dropTorpedo(
    DROP.x, DROP.y, DROP.z, VEL.x, VEL.y, VEL.z, DAMAGE, NOSE.x, NOSE.z,
  )
  seed = (seed + 7919) >>> 0
  sinceFire = 0
  sinceEnd = 0
  placeCamera()
}

// ── 鏡頭 ────────────────────────────────────────────────

const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08

function placeCamera(): void {
  if (view === 'release') {
    ctx.camera.position.set(DROP.x + 60, DROP.y + 25, DROP.z + 60)
    controls.target.copy(DROP)
  } else if (view === 'target') {
    ctx.camera.position.set(ship.position.x + 90, 45, ship.position.z + 140)
    controls.target.copy(ship.position)
  } else {
    const t = world.torpedoes
    // 【擺側面，不是正後方】航跡是往魚雷**後方**拉的，鏡頭放在正後方的話
    // 帶子一長過鏡頭的距離就整條跑到背後去 —— 看起來像航跡消失了。側面才
    // 同時框得下魚雷、那條帶子與 46 m 的水柱
    // 【中等仰角】兩頭都不行：貼著海面平看時 2 m 寬的帶子在幾百公尺外只剩
    // 不到一個像素；近乎正上方俯視則會把海面網格的低面數浪冠放大成一塊塊
    // 死白的多邊形。約 35° 同時看得到帶子、魚雷與 46 m 的水柱
    ctx.camera.position.set(t.x[0]! + 92, 68, t.z[0]! + 48)
    controls.target.set(t.x[0]!, 0, t.z[0]! + 60)
  }
  controls.update()
}

// ── 面板 ────────────────────────────────────────────────

const releaseRows = document.getElementById('release') as HTMLElement
const targetRows = document.getElementById('target') as HTMLElement
const torpRows = document.getElementById('torp') as HTMLElement
const rows = document.getElementById('rows') as HTMLElement
const viewTabs = document.getElementById('view') as HTMLElement
const todTabs = document.getElementById('tod') as HTMLElement
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

function tabs(host: HTMLElement, ids: readonly string[], pick: (id: string) => void): void {
  for (const id of ids) {
    const b = document.createElement('button')
    b.textContent = id
    b.dataset['id'] = id
    b.addEventListener('click', () => {
      for (const el of Array.from(host.children)) el.classList.remove('on')
      b.classList.add('on')
      pick(id)
    })
    host.appendChild(b)
  }
}

const n0 = (v: number): string => v.toFixed(0)
const f1 = (v: number): string => v.toFixed(1)
const m = (v: number): string => v.toFixed(0) + ' m'
const deg = (v: number): string => v.toFixed(0) + '°'
const numGet = (k: keyof BlastParams) => (): number => live[k]
const numSet = (k: keyof BlastParams) => (v: number): void => { live[k] = v }
const coneGet = (k: keyof BlastParams) => (): number =>
  Math.round((live[k] * 180) / Math.PI)
const coneSet = (k: keyof BlastParams) => (v: number): void => {
  live[k] = (v * Math.PI) / 180
}

tabs(viewTabs, ['release', 'chase', 'target'], (id) => { view = id as ViewId })
tabs(todTabs, TIME_OF_DAY_IDS, (id) => {
  tod = id as TimeOfDay
  applyTimeOfDay(ctx, terrain, tod)
})

numRow(releaseRows, '投放高度', 5, 250, 5, () => agl, (v) => { agl = v }, m)
numRow(releaseRows, '投放速度', 40, 160, 5, () => tas, (v) => { tas = v },
  (v) => v.toFixed(0) + ' m/s')
numRow(releaseRows, '坡度', -40, 40, 1, () => roll, (v) => { roll = v }, deg)
numRow(releaseRows, '俯仰', -30, 30, 1, () => pitch, (v) => { pitch = v }, deg)
numRow(releaseRows, '投放距離', 200, 1800, 50, () => standoff, (v) => { standoff = v }, m)
numRow(releaseRows, '提前量', 0, 900, 20, () => lead, (v) => { lead = v }, m)

chkRow(releaseRows, '提前量自己解', () => autoLead, (v) => { autoLead = v })

numRow(targetRows, '靶艦航速', 0, 16, 1, () => shipSpeed, (v) => { shipSpeed = v },
  (v) => v.toFixed(0) + ' m/s')

numRow(torpRows, '雷速', 8, 45, 1, () => speed, (v) => { speed = v },
  (v) => v.toFixed(0) + ' m/s')
numRow(torpRows, '射程', 200, 4000, 100, () => range, (v) => { range = v }, m)
numRow(torpRows, '定深', 0.2, 6, 0.2, () => depth, (v) => { depth = v },
  (v) => v.toFixed(1) + ' m')
numRow(torpRows, '航跡間隔', 2, 40, 1, () => wakeEvery, (v) => { wakeEvery = v }, m)
numRow(torpRows, '航跡顆數', 1, 12, 1, () => wakeCount, (v) => { wakeCount = v }, n0)
numRow(torpRows, '播放速度', 0.1, 4, 0.1, () => timeScale, (v) => { timeScale = v }, f1)
numRow(torpRows, '結束後重播', 0, 20, 1, () => autoAfter, (v) => { autoAfter = v },
  (v) => (v === 0 ? '關' : v.toFixed(0) + 's'))

numRow(rows, '水柱根數', 0, 24, 1, numGet('jetCount'), numSet('jetCount'), n0)
numRow(rows, '水冠半徑', 0, 30, 0.5, numGet('jetSpread'), numSet('jetSpread'), f1)
numRow(rows, '水柱高', 0, 100, 1, numGet('jetHeight'), numSet('jetHeight'), n0)
numRow(rows, '水柱粗', 0, 8, 0.1, numGet('jetRadius'), numSet('jetRadius'), f1)
numRow(rows, '水霧／柱', 0, 10, 1, numGet('mistPerJet'), numSet('mistPerJet'), n0)
numRow(rows, '水霧尺寸', 0, 8, 0.1, numGet('mistSize'), numSet('mistSize'), f1)
numRow(rows, '水花顆數', 0, 40, 1, numGet('sprayCount'), numSet('sprayCount'), n0)
numRow(rows, '水花初速', 0, 60, 1, numGet('spraySpeed'), numSet('spraySpeed'), n0)
numRow(rows, '水花錐角', 0, 90, 1, coneGet('sprayCone'), coneSet('sprayCone'), deg)

chkRow(torpRows, '慢動作看入水（0.15×）', () => timeScale < 0.3,
  (v) => { timeScale = v ? 0.15 : 1; for (const b of bindings) b.refresh() })

document.getElementById('fire')!.addEventListener('click', () => fire())
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); fire() }
})
document.getElementById('copy')!.addEventListener('click', () => {
  void navigator.clipboard.writeText(out.textContent ?? '')
})

/** 右下角吐出可以貼回 `blast.ts` 與 `torpedo.ts` 的那一段 */
function dump(): void {
  const cone = (v: number): string =>
    `(${Math.round((v * 180) / Math.PI)} * Math.PI) / 180`
  out.textContent =
    `// world/torpedo.ts\n` +
    `TORPEDO_SPEED = ${speed}\n` +
    `TORPEDO_RANGE = ${range}\n` +
    `TORPEDO_DEPTH = ${depth}\n` +
    `WAKE_INTERVAL = ${wakeEvery}\n` +
    `// render/spray.ts\n` +
    `WAKE_SPRAY_COUNT = ${wakeCount}\n\n` +
    `// render/blast.ts\n` +
    `export const TORPEDO_BLAST: BlastParams = {\n` +
    `  sprayCount: ${live.sprayCount},\n` +
    `  spraySpeed: ${live.spraySpeed},\n` +
    `  sprayCone: ${cone(live.sprayCone)},\n` +
    `  jetCount: ${live.jetCount},\n` +
    `  jetSpread: ${live.jetSpread},\n` +
    `  jetHeight: ${live.jetHeight},\n` +
    `  jetRadius: ${live.jetRadius},\n` +
    `  mistPerJet: ${live.mistPerJet},\n` +
    `  mistSize: ${live.mistSize},\n` +
    `}`
}

for (const el of Array.from(viewTabs.children)) {
  el.classList.toggle('on', (el as HTMLElement).dataset['id'] === view)
}
for (const el of Array.from(todTabs.children)) {
  el.classList.toggle('on', (el as HTMLElement).dataset['id'] === tod)
}
applyTimeOfDay(ctx, terrain, tod)
for (const p of [glow, smoke, dust]) p.reset()
dump()
fire()

// ── 迴圈 ────────────────────────────────────────────────

/**
 * 引爆。**配方由這裡的 `live` 給，位置抬到水面** —— 與 `main.ts` 的
 * `emitTorpedoBlasts` 是同一段。
 */
/** 航跡：只有水中段有 —— 與 `main.ts` 逐字相同 */
function stepWakes(dt: number): void {
  const t = world.torpedoes
  for (let i = 0; i < t.capacity; i++) {
    if (t.active[i] === 0 || t.phase[i] !== 1) continue
    wakes.emit(i, t.x[i]!, t.z[i]!, t.run[i]!)
  }
  wakes.step(dt, elapsed, terrain.heightAt)
}

function drainEvents(): void {
  const d = world.torpedoEvents.data
  for (let e = 0; e < world.torpedoEvents.count; e++) {
    const o = e * 6
    const x = d[o]!
    const z = d[o + 2]!
    const w = terrain.waterAt(x, z)
    scaleBlast(live, 1, SCALED)
    emitBlast(POOLS(), SCALED, x, Number.isFinite(w) ? w : d[o + 1]!, z, seed + e)
  }
  clearImpacts(world.torpedoEvents)

  emitSpray(spray, world.torpedoWakeEvents, wakeCount)
  clearImpacts(world.torpedoWakeEvents)

  splashes.emit(world.splashEvents, terrain.heightAt, elapsed)
  clearImpacts(world.splashEvents)
}

let last = performance.now()

function frame(now: number): void {
  // 【牆鐘不縮放、模擬時間才縮放】地形的浪與相機阻尼要走真實時間
  const wall = Math.min((now - last) / 1000, 0.25)
  last = now
  const dt = wall * timeScale
  elapsed += dt
  sinceFire += wall

  // 【等它真的結束】`live` 歸零之後才開始數那幾秒
  if (autoAfter > 0 && world.torpedoes.live === 0) {
    sinceEnd += wall
    if (sinceEnd >= autoAfter) fire()
  } else sinceEnd = 0

  // 【固定步長推進世界】與遊戲的 240 Hz 相同 —— 彈道不吃畫面更新率
  let acc = dt
  while (acc > 0) {
    const s = Math.min(acc, DT)
    // 【船不在這裡推】`World.step` 自己就會呼叫 `stepShips` —— 再推一次
    // 等於靶艦以兩倍航速前進，提前量因此永遠對不上
    world.step(s)
    drainEvents()
    acc -= s
  }
  shipModels.update([ship], () => {})

  for (const p of [spray, splashes, chunks, ember, glow, smoke, dust, mist, jets]) p.step(dt)
  stepWakes(dt)
  torpedoVisuals.update(world.torpedoes)

  // 【追蹤的兩種視角每幀重擺】`release` 是固定的投放點，另外兩個要跟著
  // 目標走 —— 靶艦一分鐘走 480 m，不跟就只剩一片海
  if (view === 'target' || (view === 'chase' && world.torpedoes.live > 0)) placeCamera()
  controls.update()
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)

  const t = world.torpedoes
  const alive = t.active[0] === 1
  const phase = !alive ? '結束' : t.phase[0] === 0 ? '空中' : '水中'
  const gate = canRelease(
    TORPEDO_ENVELOPE, (roll * Math.PI) / 180, (pitch * Math.PI) / 180, agl, tas,
  )
  const toShip = Math.hypot(t.x[0]! - ship.position.x, t.z[0]! - ship.position.z)
  liveOut.innerHTML =
    `<span id="gate" class="${gate ? 'ok' : 'bad'}">` +
    `${gate ? '可投放' : '包絡外'}</span>\n` +
    `相位 ${phase}\n` +
    `航程 ${alive ? t.run[0]!.toFixed(0) : '—'} / ${range} m\n` +
    `離靶 ${alive ? toShip.toFixed(0) : '—'} m\n` +
    `艦體 ${(ship.hp / ship.cls.hp * 100).toFixed(0)}%\n` +
    `水柱 ${jets.live}　水霧 ${mist.live}　水花 ${spray.live}\n` +
    `航跡 ${wakes.live} 節　火 ${chunks.live}\n` +
    `距上一發 ${sinceFire.toFixed(1)}s`
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)

/**
 * 截圖用的鉤子。**只有 e2e 讀它。**
 *
 * 【為什麼不能只靠 rAF】整條序列走 30 秒以上，而 rAF 的間隔由瀏覽器決定。
 * 這裡用固定 dt 手動推進，每一格恰好差 `dt` 秒。
 */
interface Probe {
  fire(): void
  /** 各池目前有幾顆。診斷「畫面上那一團是誰」用 */
  counts(): Record<string, number>
  /** 逐一關掉某一個物件。同上，診斷用 */
  show(name: string, on: boolean): void
  set(k: 'agl' | 'tas' | 'standoff' | 'lead' | 'shipSpeed', v: number): void
  /**
   * @param skip 開拍之前先快轉幾秒。**引爆只有 0.9 秒**，整條序列卻要 17
   *             秒 —— 用同一個格距拍完全程的話，水柱剛好落在兩格之間
   */
  sheet(
    frames: number, dt: number, cols: number, cellW: number, cellH: number,
    skip?: number,
  ): string
}
const probe: Probe = {
  fire() { fire() },
  show(name, on) {
    const map: Record<string, { visible: boolean }> = {
      chunks: chunks.object, ember: ember.object, glow: glow.object,
      smoke: smoke.object, dust: dust.object, mist: mist.object,
      jets: jets.object, spray: spray.object, splashes: splashes.object,
      wakes: wakes.object, torpedo: torpedoVisuals.object,
      ships: shipModels.object, terrain: terrain.object,
    }
    const o = map[name]
    if (o !== undefined) o.visible = on
  },
  counts() {
    return {
      chunks: chunks.live, ember: ember.live, glow: glow.live, smoke: smoke.live,
      dust: dust.live, mist: mist.live, jets: jets.live, spray: spray.live,
      splashes: splashes.live, wakes: wakes.live,
      splashEvents: world.splashEvents.count,
    }
  },
  set(k, v) {
    if (k === 'agl') agl = v
    else if (k === 'tas') tas = v
    else if (k === 'standoff') standoff = v
    else if (k === 'lead') lead = v
    else shipSpeed = v
    for (const b of bindings) b.refresh()
  },
  sheet(frames, dt, cols, cellW, cellH, skip = 0) {
    const sheet = document.createElement('canvas')
    const rowsN = Math.ceil(frames / cols)
    sheet.width = cols * cellW
    sheet.height = rowsN * cellH
    const g = sheet.getContext('2d')!
    g.fillStyle = '#000'
    g.fillRect(0, 0, sheet.width, sheet.height)

    this.fire()
    // 【快轉不畫】用與拍攝相同的固定步長推進，所以跳過的那一段與拍到的
    // 那一段走的是同一條路徑
    for (let t = 0; t < skip; t += DT) {
      world.step(DT)
      drainEvents()
      for (const p of [spray, splashes, chunks, ember, glow, smoke, dust, mist, jets]) p.step(DT)
      stepWakes(DT)
    }
    for (let f = 0; f < frames; f++) {
      let acc = dt
      while (acc > 0) {
        const s = Math.min(acc, DT)
        world.step(s)
        drainEvents()
        acc -= s
      }
      shipModels.update([ship], () => {})
      for (const p of [spray, splashes, chunks, ember, glow, smoke, dust, mist, jets]) p.step(dt)
  stepWakes(dt)
      torpedoVisuals.update(world.torpedoes)
      if (view === 'target' || (view === 'chase' && world.torpedoes.live > 0)) {
        placeCamera()
      }
      // 【海面網格要跟著鏡頭捲動】少了這一行，鏡頭一飛開就看到網格粗糙的
      // 邊緣 —— 畫面上是幾塊巨大的淺色多邊形，很像某個粒子池壞掉了
      terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
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
    return sheet.toDataURL('image/png')
  },
}
;(window as unknown as Record<string, unknown>)['__torpedoProbe'] = probe
