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
import {
  createShipFireSmoke,
  SHIP_FIRE_PLUME_SPEED,
} from '../render/smoke'
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
    ctx.scene.add(tower)
  }
  const y = terrain.heightAt(0, z, 0)
  const bar = new Mesh(barGeometry, material)
  bar.position.set(0, y + 72, z)
  ctx.scene.add(bar)
}

// 初始鏡頭位於 +Z，青色在煙牆前、黃色在煙牆後。
addDepthMarkers(68, frontMaterial)
addDepthMarkers(-88, backMaterial)

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

// 一開頁面就已經是一堵成熟煙牆，不必先等二十秒。
for (let t = 0; t < PREWARM_SECONDS; t += 0.1) stepSmoke(0.1)

let last = performance.now()
let elapsed = 0

function frame(now: number): void {
  performanceStats.begin()
  const wall = Math.min((now - last) / 1000, 0.1)
  last = now
  elapsed += wall
  stepSmoke(wall)

  for (let i = 0; i < fires.children.length; i++) {
    const flame = fires.children[i]!
    const pulse = 0.86 + Math.sin(elapsed * 9 + i * 1.31) * 0.14
    flame.scale.set(1 / pulse, pulse, 1 / pulse)
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
  statsInfo.textContent =
    `煙霧　${smoke.live} 顆\n` +
    `煙霧緩衝　${resolution}\n` +
    `放大方式　${pass.depthAware ? '深度感知' : '普通雙線性'}\n` +
    `煙霧光照　${smokeLighting.enabled ? '日照＋自遮蔽' : '原始顏色'}`

  requestAnimationFrame(frame)
}

;(window as unknown as Record<string, unknown>)['__smokeDemo'] = {
  setScale,
  setDepthAware,
  setLighting,
  get state() {
    return {
      scale: pass.scale,
      depthAware: pass.depthAware,
      width: pass.width,
      height: pass.height,
      smoke: smoke.live,
      lighting: smokeLighting.enabled,
      autoFly,
    }
  },
}

window.addEventListener('beforeunload', () => {
  pass.dispose()
  smoke.dispose()
  terrain.dispose()
  fireGeometry.dispose()
  towerGeometry.dispose()
  barGeometry.dispose()
  fireMaterial.dispose()
  frontMaterial.dispose()
  backMaterial.dispose()
})

requestAnimationFrame(frame)
