import {
  BoxGeometry, CanvasTexture, CylinderGeometry,
  Group, Line, BufferGeometry, LineBasicMaterial,
  Mesh, MeshStandardMaterial, PerspectiveCamera, SphereGeometry, Sprite,
  SpriteMaterial, Vector3,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildAircraft, GLB_MODELS } from '../render/geometry/buildAircraft'
import { loadGlbTemplate } from '../render/geometry/glb'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import { A6M5 } from '../specs/a6m5'
import { createDistanceBattlefield } from './audioDistanceBattlefield'
import { atmosphericAbsorption } from '../audio/atmosphere'
import { createDistanceAudio, type DistanceAudioMode } from './audioDistanceAudio'

const el = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T
const sourceSelect = el<HTMLSelectElement>('source'), sampleSelect = el<HTMLSelectElement>('sample')
const distanceInput = el<HTMLInputElement>('distance'), distanceRange = el<HTMLInputElement>('distance-range')
const frequencyInput = el<HTMLInputElement>('frequency'), frequencyRange = el<HTMLInputElement>('frequency-range')
const playButton = el<HTMLButtonElement>('play'), status = el('status')
const audio = createDistanceAudio()
let distance = 500, mode: DistanceAudioMode = 'physical', view = 'listener', flashUntil = 0
let loadGeneration = 0, starting = false, wasPlaying = false
const SAMPLES = {
  gun: [['fire-m2x6', 'P-51 · 六挺 M2 機槍'], ['fire-bf109k4', 'Bf 109 · 機槍與機砲'], ['fire-a6m5', 'A6M · 機槍與機砲']],
  explosion: [['explosion-1', '爆炸 1'], ['explosion-2', '爆炸 2'], ['explosion-3', '爆炸 3'], ['explosion-4', '爆炸 4'], ['explosion-5', '爆炸 5']],
}

const battlefield = await createDistanceBattlefield(el<HTMLCanvasElement>('scene'))
const { renderer, scene, camera, origin } = battlefield
const detailCamera = new PerspectiveCamera(42, 1, 0.1, 100)
detailCamera.position.copy(origin).add(new Vector3(15, 10, 20)); detailCamera.lookAt(origin.x, origin.y + 3, origin.z)
const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true
const sourceGroup = new Group(); sourceGroup.position.copy(origin); sourceGroup.position.y += 3; scene.add(sourceGroup)
const planeGroup = new Group(); sourceGroup.add(planeGroup)
const models = new Map<string, Group>()
const speaker = new Group()
speaker.add(new Mesh(new BoxGeometry(2, 3, 1.4), new MeshStandardMaterial({ color: 0x456477, roughness: 0.7 })))
for (const y of [-0.7, 0.7]) {
  const cone = new Mesh(new CylinderGeometry(0.55, 0.4, 0.2, 24), new MeshStandardMaterial({ color: 0x111c22 }))
  cone.rotation.x = Math.PI / 2; cone.position.set(0, y, 0.75); speaker.add(cone)
}
sourceGroup.add(speaker)
const bomb = new Mesh(new SphereGeometry(1.3, 20, 12), new MeshStandardMaterial({ color: 0x686f4a, roughness: 0.6 }))
bomb.scale.set(0.6, 0.6, 1.6); sourceGroup.add(bomb)
const ear = new Mesh(new SphereGeometry(1, 16, 12), new MeshStandardMaterial({ color: 0x76d9aa, emissive: 0x123626 }))
scene.add(ear)

function marker(text: string, color: string): Sprite {
  const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 80
  const g = canvas.getContext('2d')!
  g.fillStyle = '#101b26e8'; g.beginPath(); g.roundRect(2, 2, 252, 76, 12); g.fill()
  g.fillStyle = color; g.font = 'bold 30px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 40)
  const sprite = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), sizeAttenuation: false, depthTest: false }))
  sprite.scale.set(0.15, 0.047, 1); sprite.renderOrder = 10
  return sprite
}
const sourceMarker = marker('● 聲源', '#9bd8ff'), earMarker = marker('● 聽者', '#a0edc5')
scene.add(sourceMarker, earMarker)
const lineGeometry = new BufferGeometry().setFromPoints([new Vector3(), new Vector3()])
scene.add(new Line(lineGeometry, new LineBasicMaterial({ color: 0x71b7b4, transparent: true, opacity: 0.6 })))
const muzzle = new Mesh(new SphereGeometry(0.5, 8, 6), new MeshStandardMaterial({ color: 0xffd78a, emissive: 0xff9a30, emissiveIntensity: 4 }))
muzzle.position.copy(sourceGroup.position); muzzle.position.z -= 3; scene.add(muzzle)

function placeCamera(): void {
  const span = Math.max(distance, 35)
  if (view === 'source') { camera.position.copy(origin).add(new Vector3(15, 10, 20)); controls.target.copy(sourceGroup.position) }
  else if (view === 'listener') {
    camera.position.copy(ear.position)
    if (distance < 8) camera.position.z = origin.z + 8
    controls.target.copy(sourceGroup.position)
  } else {
    controls.target.copy(sourceGroup.position).lerp(ear.position, 0.5)
    const halfFov = Math.min(camera.fov * Math.PI / 360,
      Math.atan(Math.tan(camera.fov * Math.PI / 360) * camera.aspect))
    const radius = span * 0.5 + 10
    camera.position.copy(controls.target).addScaledVector(new Vector3(0.9, 0.7, 1.1).normalize(), radius / Math.sin(halfFov) * 1.4)
  }
  controls.enablePan = view !== 'listener'; controls.enableZoom = view !== 'listener'
  ear.visible = earMarker.visible = view !== 'listener' && distance > 3
  controls.update()
}

function describe(): void {
  el('distance-label').textContent = `${Math.round(distance).toLocaleString()} m`
  el('explanation').textContent = mode === 'physical'
    ? '新版大氣吸收 · 20°C / 70% 濕度 / 標準氣壓'
    : mode === 'legacy' ? '原版低通 · 與修改前遊戲相同的距離曲線' : '原始音色 · 不套用大氣吸收'
  const hz = sourceSelect.value === 'tone' ? Number(frequencyInput.value) : 4000
  el('readout').textContent = `大氣模型：${hz.toLocaleString()} Hz 在此距離吸收 ${(atmosphericAbsorption(hz) * distance).toFixed(1)} dB。視角只改畫面，聽者為綠色標記。`
}

function setDistance(value: number): void {
  distance = Math.max(0, Math.min(8000, Number.isFinite(value) ? value : 0))
  distanceInput.value = String(Math.round(distance)); distanceRange.value = String(Math.log1p(distance / 10) / Math.log(801) * 1000)
  let horizontal = distance
  let listenerY = sourceGroup.position.y
  for (let i = 0; i < 5; i++) {
    listenerY = battlefield.terrain.heightAt(0, origin.z + horizontal, 0) + 3
    const rise = Math.max(-distance * 0.9, Math.min(distance * 0.9, listenerY - sourceGroup.position.y))
    listenerY = sourceGroup.position.y + rise
    horizontal = Math.sqrt(Math.max(0, distance * distance - rise * rise))
  }
  ear.position.set(0, listenerY, origin.z + horizontal)
  const lift = Math.max(5, distance * 0.02)
  sourceMarker.position.copy(sourceGroup.position); sourceMarker.position.y += lift
  earMarker.position.copy(ear.position); earMarker.position.y += lift
  earMarker.visible = distance > 3
  const positions = lineGeometry.getAttribute('position')
  positions.setXYZ(0, origin.x, origin.y + 0.2, origin.z)
  positions.setXYZ(1, ear.position.x, ear.position.y - 2.8, ear.position.z); positions.needsUpdate = true
  lineGeometry.computeBoundingSphere()
  audio.setDistance(distance); describe(); placeCamera()
}

function setFrequency(value: number): void {
  const hz = Math.max(50, Math.min(Math.min(16000, audio.sampleRate * 0.45), value))
  frequencyInput.value = String(Math.round(hz)); frequencyRange.value = String(Math.log(hz / 50) / Math.log(320) * 1000)
  audio.setFrequency(hz); describe()
}

async function loadModel(): Promise<void> {
  const generation = ++loadGeneration
  speaker.visible = sourceSelect.value === 'tone'; bomb.visible = sourceSelect.value === 'explosion'
  planeGroup.visible = sourceSelect.value === 'gun'
  if (!planeGroup.visible) return
  const spec = sampleSelect.value === 'fire-bf109k4' ? BF109K4 : sampleSelect.value === 'fire-a6m5' ? A6M5 : P51D
  await loadGlbTemplate(spec.id, GLB_MODELS[spec.id]!)
  if (generation !== loadGeneration) return
  let model = models.get(spec.id)
  if (!model) { model = buildAircraft(spec).group; models.set(spec.id, model) }
  planeGroup.clear(); planeGroup.add(model)
}

async function play(): Promise<void> {
  starting = true; playButton.disabled = true; status.classList.remove('error'); status.textContent = '準備播放…'
  const explosion = sourceSelect.value === 'explosion'
  try {
    const started = await audio.play(sourceSelect.value === 'tone' ? null : sampleSelect.value,
      sourceSelect.value === 'gun', el<HTMLInputElement>('delay').checked)
    if (!started) return
    flashUntil = performance.now() + (explosion ? 1500 : 300)
    if (explosion) battlefield.explode()
    status.textContent = el<HTMLInputElement>('delay').checked
      ? `已發聲，約 ${(distance / 343).toFixed(2)} 秒後傳到聽者。` : '播放中，可直接切換距離與處理方式。'
  } catch (error) { status.classList.add('error'); status.textContent = `無法播放：${String(error)}` }
  finally { starting = false; playButton.disabled = false }
}

function populateSamples(): void {
  const tone = sourceSelect.value === 'tone'
  el('tone-row').hidden = !tone; el('sample-row').hidden = tone
  sampleSelect.replaceChildren()
  if (!tone) for (const [value, text] of SAMPLES[sourceSelect.value as keyof typeof SAMPLES]) {
    sampleSelect.add(new Option(text, value))
  }
}

sourceSelect.addEventListener('change', () => {
  audio.stop(); wasPlaying = false; populateSamples(); describe()
  void loadModel().catch(error => { status.textContent = `模型載入失敗：${String(error)}`; status.classList.add('error') })
  status.textContent = '已切換內容，按播放開始試聽。'
})
sampleSelect.addEventListener('change', () => { audio.stop(); wasPlaying = false; void loadModel().catch(console.error); status.textContent = '已切換素材，按播放開始試聽。' })
distanceInput.addEventListener('change', () => setDistance(Number(distanceInput.value)))
distanceRange.addEventListener('input', () => setDistance((Math.exp(Number(distanceRange.value) / 1000 * Math.log(801)) - 1) * 10))
frequencyInput.addEventListener('change', () => setFrequency(Number(frequencyInput.value)))
frequencyRange.addEventListener('input', () => setFrequency(50 * 320 ** (Number(frequencyRange.value) / 1000)))
for (const distance of [0, 100, 500, 1000, 3000, 8000]) {
  const b = document.createElement('button'); b.textContent = distance >= 1000 ? `${distance / 1000} km` : `${distance} m`
  b.addEventListener('click', () => setDistance(distance)); el('distance-presets').append(b)
}
for (const frequency of [125, 500, 1000, 4000, 8000]) {
  const b = document.createElement('button'); b.textContent = frequency >= 1000 ? `${frequency / 1000} kHz` : `${frequency} Hz`
  b.addEventListener('click', () => setFrequency(frequency)); el('frequency-presets').append(b)
}
el('modes').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-mode]')
  if (!button) return
  mode = button.dataset['mode'] as DistanceAudioMode; audio.setMode(mode)
  for (const b of Array.from(el('modes').querySelectorAll('button'))) {
    const active = b === button; b.classList.toggle('on', active); b.setAttribute('aria-pressed', String(active))
  }
  describe()
})
el('views').addEventListener('click', event => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-view]')
  if (!button) return
  view = button.dataset['view']!; placeCamera()
  for (const b of Array.from(el('views').querySelectorAll('button'))) b.classList.toggle('on', b === button)
})
el('attenuate').addEventListener('change', () => audio.setAttenuation(el<HTMLInputElement>('attenuate').checked))
el('volume').addEventListener('input', () => {
  const db = Number(el<HTMLInputElement>('volume').value); audio.setVolume(db); el('volume-label').textContent = `${db} dB`
})
playButton.addEventListener('click', () => { void play() })
el('stop').addEventListener('click', () => { audio.stop(); wasPlaying = false; status.textContent = '已停止。' })
document.addEventListener('visibilitychange', () => { if (document.hidden) { audio.stop(); wasPlaying = false; status.textContent = '已暫停，按播放繼續。' } })

function resize(): void {
  const host = renderer.domElement.parentElement!
  renderer.setSize(host.clientWidth, host.clientHeight, false)
  camera.aspect = host.clientWidth / host.clientHeight; camera.updateProjectionMatrix()
  placeCamera()
}
new ResizeObserver(resize).observe(renderer.domElement.parentElement!)
populateSamples(); setFrequency(1000); setDistance(500); resize()
let last = performance.now()
function frame(now: number): void {
  const dt = Math.min(0.05, (now - last) / 1000); last = now
  controls.update(); audio.tick(); battlefield.step(dt)
  muzzle.visible = sourceSelect.value === 'gun' && audio.playing && Math.sin(now * 0.08) > 0.6
  speaker.scale.setScalar(sourceSelect.value === 'tone' && audio.playing ? 1 + 0.012 * Math.sin(now * 0.012) : 1)
  bomb.visible = sourceSelect.value === 'explosion' && now > flashUntil
  sourceMarker.visible = sourceSelect.value !== 'explosion' || now > flashUntil
  if (wasPlaying && !audio.playing && !starting) status.textContent = '播放完畢，可按播放重聽。'
  wasPlaying = audio.playing
  battlefield.render()
  const inset = el('model-detail')
  inset.hidden = view !== 'overview' || sourceSelect.value === 'explosion'
  if (!inset.hidden) {
    const rect = inset.getBoundingClientRect(), host = renderer.domElement.getBoundingClientRect()
    const x = rect.left - host.left, y = host.bottom - rect.bottom
    renderer.setScissor(x, y, rect.width, rect.height); renderer.setViewport(x, y, rect.width, rect.height)
    renderer.setScissorTest(true)
    detailCamera.aspect = rect.width / rect.height; detailCamera.updateProjectionMatrix()
    const earVisible = earMarker.visible
    sourceMarker.visible = earMarker.visible = false
    renderer.render(scene, detailCamera)
    sourceMarker.visible = true; earMarker.visible = earVisible
    renderer.setScissorTest(false); renderer.setViewport(0, 0, host.width, host.height)
  }
  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
playButton.disabled = true
try { await Promise.all([audio.prepare(), loadModel()]); status.textContent = '準備完成，按播放開始試聽。' }
catch (error) { status.classList.add('error'); status.textContent = `準備失敗：${String(error)}` }
finally { playButton.disabled = false }

/** 開發檢查：讀取實際輸出，不另開一條模擬音訊路徑。 */
Object.assign(window, { __audioDistance: { measure: audio.measure, get distance() { return distance }, get mode() { return mode } } })
