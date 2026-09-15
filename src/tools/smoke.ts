import {
  BoxGeometry,
  ConeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  TextureLoader,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Stats from 'three/addons/libs/stats.module.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { preloadPlantScenery } from '../render/geometry/ground/plantScenery'
import { applyTimeOfDay, type TimeOfDay } from '../render/timeOfDay'
import {
  createShipFireSmoke,
  SHIP_FIRE_PLUME_SPEED,
} from '../render/smoke'
import {
  BLAST_PACE,
  LAND_BLAST,
  createBlastSmoke,
  createEmberSmoke,
  createFireGlow,
  emitBlast,
  emitEmber,
  type BlastParams,
  type BlastPools,
} from '../render/blast'
import { createFireChunks } from '../render/chunks'
import { createFirePuff } from '../render/firePuff'
import {
  createGroundFires,
  lightGroundFire,
  stepGroundFires,
} from '../render/groundFires'
import { createImpacts } from '../world/events'
import { hash01 } from '../render/scatter'
import {
  createLowResTransparencyPass,
  useLowResTransparency,
  type TransparencyScale,
} from '../render/lowResTransparency'
import { addSmokeLighting } from '../render/smokeLighting'

const FIRE_COUNT = 12
const FIRE_SPACING = 24
const PUFF_INTERVAL = 0.3
const PUFFS_PER_FIRE = 18
const SMOKE_SPREAD = 1.6
const RISE_JITTER = 0.25
const PREWARM_SECONDS = 20
const FIRE_SMOKE_BLAST: BlastParams = {
  ...LAND_BLAST,
  // 這個頁籤只看火焰如何交棒給煙；揚塵是航空炸彈的另一個視覺層。
  dustCount: 0,
}

type DemoTab = 'stress' | 'blast'

const canvas = document.getElementById('scene') as HTMLCanvasElement
const statsRoot = document.getElementById('stats') as HTMLElement
const statsInfo = document.createElement('div')
statsRoot.appendChild(statsInfo)

const performanceStats = new Stats()
performanceStats.showPanel(0)
performanceStats.dom.title = '點擊切換 FPS / MS / MB'
performanceStats.dom.style.cssText = [
  'position:static',
  'display:block',
  'width:80px',
  'height:48px',
  'margin:8px 0 0 auto',
  'cursor:pointer',
  'opacity:.95',
  'transform:scale(1.35)',
  'transform-origin:top right',
  'margin-bottom:17px',
].join(';')
statsRoot.appendChild(performanceStats.dom)
const flyButton = document.getElementById('fly') as HTMLButtonElement
const reblastButton = document.getElementById('reblast') as HTMLButtonElement
const description = document.getElementById('description') as HTMLParagraphElement
const legend = document.getElementById('legend') as HTMLElement
const stressActions = document.getElementById('stress-actions') as HTMLElement
const blastActions = document.getElementById('blast-actions') as HTMLElement
const tabButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-tab]'),
)
const timeButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-time]'),
)
const qualityButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-scale]'),
)
const depthButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-depth]'),
)
const lightingButtons = Array.from(
  document.querySelectorAll<HTMLButtonElement>('[data-lighting]'),
)

const ctx = createScene(canvas, 'noon')
await preloadPlantScenery()
const terrain = createTerrain('farmland')
ctx.scene.add(terrain.object)
// 內陸地形的固定結構：index 3 是植被。爆炸頁籤暫時隱藏它，避免樹冠擋住
// 火球轉煙的短短一秒；壓力測試仍保留完整場景作為真實負載。
const terrainVegetation = terrain.object.children[3]!

const smokeTexture = await new TextureLoader().loadAsync('/textures/smoke.png')
const smoke = createShipFireSmoke(16384, smokeTexture)
const smokeLighting = addSmokeLighting(
  smoke,
  ctx.lights.sun.position,
  ctx.lights.sun.color,
  ctx.lights.sun.intensity,
)
useLowResTransparency(smoke.object)
ctx.scene.add(smoke.object)

// 航空炸彈頁籤使用遊戲真正的「火球 → 交棒煙」鏈，另加配方本身噴出的煙。
const blastEmber = createEmberSmoke(undefined, BLAST_PACE, smokeTexture)
const blastFire = createFireChunks(
  undefined,
  BLAST_PACE,
  (x, y, z, vx, vy, vz, diameter, slot) => {
    emitEmber(blastEmber, slot, x, y, z, vx, vy, vz, diameter)
  },
)
const blastGlow = createFireGlow(undefined, BLAST_PACE)
const blastSmoke = createBlastSmoke(undefined, BLAST_PACE, smokeTexture)
// 炸彈落地後留下的持續火點使用獨立煙池，不能挪用壓力測試那堵煙牆。
const burnSmoke = createShipFireSmoke(4096, smokeTexture)
// 爆炸煙用乘法式受光；不加固定亮色，才不會蓋掉黑 → 深灰的年齡曲線。
const blastEmberLighting = addSmokeLighting(
  blastEmber,
  ctx.lights.sun.position,
  ctx.lights.sun.color,
  ctx.lights.sun.intensity,
  0,
)
const blastSmokeLighting = addSmokeLighting(
  blastSmoke,
  ctx.lights.sun.position,
  ctx.lights.sun.color,
  ctx.lights.sun.intensity,
  0,
)
const burnSmokeLighting = addSmokeLighting(
  burnSmoke,
  ctx.lights.sun.position,
  ctx.lights.sun.color,
  ctx.lights.sun.intensity,
)
useLowResTransparency(blastEmber.object)
useLowResTransparency(blastSmoke.object)
useLowResTransparency(burnSmoke.object)
ctx.scene.add(
  blastFire.object,
  blastGlow.object,
  blastEmber.object,
  blastSmoke.object,
  burnSmoke.object,
)

// FIRE_SMOKE_BLAST 的塵、水花、水柱數全為 0；未使用的槽可安全指向同一煙池。
const blastPools: BlastPools = {
  fireball: blastFire,
  glow: blastGlow,
  smoke: blastSmoke,
  dust: blastSmoke,
  spray: blastSmoke,
  splashEvents: createImpacts(1),
}
const groundFire = createGroundFires(1)
const emitGroundFirePuff = createFirePuff(blastPools, burnSmoke)

const pass = createLowResTransparencyPass(ctx.renderer, 0.5)

const fireMaterial = new MeshBasicMaterial({ color: 0xff7a21 })
const frontMaterial = new MeshStandardMaterial({
  color: 0x27d3d0, roughness: 0.72, metalness: 0.05,
})
const backMaterial = new MeshStandardMaterial({
  color: 0xffd34d, roughness: 0.72, metalness: 0.05,
})

const fireGeometry = new ConeGeometry(3.4, 13, 5)
const towerGeometry = new BoxGeometry(16, 54, 16)
const barGeometry = new BoxGeometry(210, 5, 5)
const fires = new Group()
const depthMarkers = new Group()
const fireY = new Float32Array(FIRE_COUNT)

for (let i = 0; i < FIRE_COUNT; i++) {
  const x = (i - (FIRE_COUNT - 1) / 2) * FIRE_SPACING
  const y = terrain.heightAt(x, 0, 0)
  fireY[i] = y
  const flame = new Mesh(fireGeometry, fireMaterial)
  flame.position.set(x, y + 6.5, 0)
  flame.rotation.y = i * 1.7
  fires.add(flame)
}
ctx.scene.add(fires)

function addDepthMarkers(z: number, material: MeshStandardMaterial): void {
  for (const x of [-84, 0, 84]) {
    const y = terrain.heightAt(x, z, 0)
    const tower = new Mesh(towerGeometry, material)
    tower.position.set(x, y + 27, z)
    tower.rotation.y = Math.PI / 4
    depthMarkers.add(tower)
  }
  const y = terrain.heightAt(0, z, 0)
  const bar = new Mesh(barGeometry, material)
  bar.position.set(0, y + 72, z)
  depthMarkers.add(bar)
}

// 初始鏡頭位於 +Z，青色在煙牆前、黃色在煙牆後。
addDepthMarkers(68, frontMaterial)
addDepthMarkers(-88, backMaterial)
ctx.scene.add(depthMarkers)

const controls = new OrbitControls(ctx.camera, canvas)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.minDistance = 18
controls.maxDistance = 700
controls.target.set(0, 64, 0)
ctx.camera.position.set(0, 64, 230)
controls.update()

let autoFly = true
let flyClock = 0
let puffClock = 0
let puffSeed = 0
let blastSeed = 0
let activeTab: DemoTab = 'stress'
let activeTime: TimeOfDay = 'noon'

function setAutoFly(on: boolean): void {
  autoFly = on
  flyButton.classList.toggle('on', on)
  flyButton.textContent = on ? '停止自動穿越' : '重新自動穿越'
}

controls.addEventListener('start', () => setAutoFly(false))
flyButton.addEventListener('click', () => {
  flyClock = 0
  setAutoFly(!autoFly)
})

function setScale(scale: TransparencyScale): void {
  pass.setScale(scale)
  for (const button of qualityButtons) {
    button.classList.toggle('on', Number(button.dataset.scale) === scale)
  }
}

for (const button of qualityButtons) {
  button.addEventListener('click', () => {
    setScale(Number(button.dataset.scale) as TransparencyScale)
  })
}

function setDepthAware(enabled: boolean): void {
  pass.setDepthAware(enabled)
  for (const button of depthButtons) {
    button.classList.toggle('on', (button.dataset.depth === 'true') === enabled)
  }
}

for (const button of depthButtons) {
  button.addEventListener('click', () => {
    setDepthAware(button.dataset.depth === 'true')
  })
}

function setLighting(enabled: boolean): void {
  smokeLighting.setEnabled(enabled)
  blastEmberLighting.setEnabled(enabled)
  blastSmokeLighting.setEnabled(enabled)
  burnSmokeLighting.setEnabled(enabled)
  for (const button of lightingButtons) {
    button.classList.toggle(
      'on',
      (button.dataset.lighting === 'true') === enabled,
    )
  }
}

for (const button of lightingButtons) {
  button.addEventListener('click', () => {
    setLighting(button.dataset.lighting === 'true')
  })
}

function syncSmokeSun(): void {
  for (const lighting of [
    smokeLighting,
    blastEmberLighting,
    blastSmokeLighting,
    burnSmokeLighting,
  ]) {
    lighting.setLight(
      ctx.lights.sun.position,
      ctx.lights.sun.color,
      ctx.lights.sun.intensity,
    )
  }
}

function setTimeOfDay(time: TimeOfDay): void {
  activeTime = time
  applyTimeOfDay(ctx, terrain, time)
  syncSmokeSun()
  for (const button of timeButtons) {
    button.classList.toggle('on', button.dataset.time === time)
  }
}

for (const button of timeButtons) {
  button.addEventListener('click', () => {
    setTimeOfDay(button.dataset.time as TimeOfDay)
  })
}

function setTab(tab: DemoTab): void {
  activeTab = tab
  const stress = tab === 'stress'
  smoke.object.visible = stress
  fires.visible = stress
  depthMarkers.visible = stress
  terrainVegetation.visible = stress
  blastFire.object.visible = !stress
  blastGlow.object.visible = !stress
  blastEmber.object.visible = !stress
  blastSmoke.object.visible = !stress
  burnSmoke.object.visible = !stress
  stressActions.hidden = !stress
  blastActions.hidden = stress
  legend.hidden = !stress
  description.textContent = stress
    ? '12 個橫向火源，保留原有的 14,000 顆煙霧 FPS 壓力測試。'
    : '航空炸彈爆炸後會留下持續火點：小爆燃不斷補上垂直煙柱。'
  for (const button of tabButtons) {
    button.classList.toggle('on', button.dataset.tab === tab)
  }

  if (stress) {
    ctx.camera.position.set(0, 64, 230)
    controls.target.set(0, 64, 0)
    flyClock = 0
    setAutoFly(true)
  } else {
    setAutoFly(false)
    ctx.camera.position.set(52, 34, 78)
    controls.target.set(0, 14, 0)
    triggerBlast()
  }
  controls.update()
}

for (const button of tabButtons) {
  button.addEventListener('click', () => {
    setTab(button.dataset.tab as DemoTab)
  })
}

function emitPuff(): void {
  for (let i = 0; i < FIRE_COUNT; i++) {
    const x = (i - (FIRE_COUNT - 1) / 2) * FIRE_SPACING
    for (let k = 0; k < PUFFS_PER_FIRE; k++) {
      const s = ++puffSeed
      const angle = hash01(s * 3 + 1) * Math.PI * 2
      const radius = Math.sqrt(hash01(s * 3 + 2)) * SMOKE_SPREAD
      const up = SHIP_FIRE_PLUME_SPEED
        * (1 + (hash01(s * 3 + 3) * 2 - 1) * RISE_JITTER)
      smoke.emit(
        x, fireY[i]! + 7, 0,
        Math.cos(angle) * radius, up, Math.sin(angle) * radius,
      )
    }
  }
}

function stepSmoke(dt: number): void {
  puffClock -= dt
  while (puffClock <= 0) {
    emitPuff()
    puffClock += PUFF_INTERVAL
  }
  smoke.step(dt)
}

function triggerBlast(): void {
  blastFire.reset()
  blastGlow.reset()
  blastEmber.reset()
  blastSmoke.reset()
  burnSmoke.reset()
  groundFire.reset()
  const y = terrain.heightAt(0, 0, 0)
  emitBlast(blastPools, FIRE_SMOKE_BLAST, 0, y + 1, 0, ++blastSeed * 197)
  lightGroundFire(groundFire, 0, y + 1, 0)
}

function stepBlast(dt: number): void {
  // 第一朵立刻放，之後沿用遊戲每 0.3 秒一朵的持續燃燒節拍。
  stepGroundFires(groundFire, dt, emitGroundFirePuff)
  // 火球先走；它在淡出那一幀生成的交棒煙，接著立刻積分同一幀。
  blastFire.step(dt)
  blastGlow.step(dt)
  blastEmber.step(dt)
  blastSmoke.step(dt)
  burnSmoke.step(dt)
}

reblastButton.addEventListener('click', triggerBlast)

// 一開頁面就已經是一堵成熟煙牆，不必先等二十秒。
for (let t = 0; t < PREWARM_SECONDS; t += 0.1) stepSmoke(0.1)
setTab('stress')

let last = performance.now()
let elapsed = 0

function frame(now: number): void {
  performanceStats.begin()
  const wall = Math.min((now - last) / 1000, 0.1)
  last = now
  elapsed += wall
  if (activeTab === 'stress') stepSmoke(wall)
  else stepBlast(wall)

  if (activeTab === 'stress') {
    for (let i = 0; i < fires.children.length; i++) {
      const flame = fires.children[i]!
      const pulse = 0.86 + Math.sin(elapsed * 9 + i * 1.31) * 0.14
      flame.scale.set(1 / pulse, pulse, 1 / pulse)
    }
  }

  if (autoFly) {
    flyClock = (flyClock + wall) % 12
    const t = flyClock / 12
    const z = 230 - t * 460
    ctx.camera.position.set(Math.sin(t * Math.PI * 2) * 12, 64, z)
    controls.target.set(0, 64, z - 80)
  }
  controls.update()
  terrain.update(elapsed, ctx.camera.position.x, ctx.camera.position.z)
  pass.render(ctx.scene, ctx.camera)
  performanceStats.end()

  const percent = Math.round(pass.scale * pass.scale * 10000) / 100
  const resolution = pass.scale === 1
    ? '主畫面完整解析度'
    : `${pass.width} × ${pass.height}（${percent}% 像素）`
  const smokeLive = activeTab === 'stress'
    ? smoke.live
    : blastSmoke.live + blastEmber.live + burnSmoke.live
  const effectInfo = activeTab === 'stress'
    ? `壓力煙霧　${smokeLive} 顆`
    : `爆炸＋燃燒　火焰 ${blastFire.live}／煙霧 ${smokeLive} 顆`
  statsInfo.textContent =
    `${effectInfo}\n` +
    `時段　${activeTime}\n` +
    `煙霧緩衝　${resolution}\n` +
    `放大方式　${pass.depthAware ? '深度感知' : '普通雙線性'}\n` +
    `煙霧光照　${smokeLighting.enabled ? '日照＋自遮蔽' : '原始顏色'}`

  requestAnimationFrame(frame)
}

;(window as unknown as Record<string, unknown>)['__smokeDemo'] = {
  setScale,
  setDepthAware,
  setLighting,
  setTab,
  setTimeOfDay,
  triggerBlast,
  get state() {
    return {
      scale: pass.scale,
      depthAware: pass.depthAware,
      width: pass.width,
      height: pass.height,
      tab: activeTab,
      timeOfDay: activeTime,
      smoke: activeTab === 'stress'
        ? smoke.live
        : blastSmoke.live + blastEmber.live + burnSmoke.live,
      burningSmoke: activeTab === 'blast' ? burnSmoke.live : 0,
      fire: activeTab === 'blast' ? blastFire.live : 0,
      lighting: smokeLighting.enabled,
      autoFly,
    }
  },
}

window.addEventListener('beforeunload', () => {
  pass.dispose()
  smoke.dispose()
  blastFire.dispose()
  blastGlow.dispose()
  blastEmber.dispose()
  blastSmoke.dispose()
  burnSmoke.dispose()
  terrain.dispose()
  fireGeometry.dispose()
  towerGeometry.dispose()
  barGeometry.dispose()
  fireMaterial.dispose()
  frontMaterial.dispose()
  backMaterial.dispose()
})

requestAnimationFrame(frame)
