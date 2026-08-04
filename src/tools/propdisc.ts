import {
  Matrix4, Mesh, MeshStandardMaterial, Vector3,
  type WebGLProgramParametersWithUniforms,
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createScene } from '../render/scene'
import { createTerrain } from '../render/terrain'
import { createTracers } from '../render/tracers'
import { buildAircraft } from '../render/geometry/buildAircraft'
import { Projectiles } from '../world/Projectiles'
import { P51D } from '../specs/p51d'

/**
 * 螺旋槳圓盤遮擋比較 —— 純驗收用的開發工具，**不屬於遊戲**。
 *
 * 【為什麼要有它】M10 驗收時發現「某些角度螺旋槳的半透明圓盤會把子彈遮掉」。
 * 成因是圓盤的材質沒有關掉 `depthWrite`，而候選解法各有各的代價，光用文字
 * 講不清楚 —— 這一頁把三種做法擺在同一個機位上，切換即可比較。
 *
 * 【為什麼用遊戲真正的模型與曳光彈池】與機庫、試驗場同一個理由：工具若自己
 * 抄一份，看到的就不是遊戲裡的東西，反而會製造錯誤的信心。這裡的圓盤是
 * `buildAircraft(P51D)` 建出來的那一個、曳光彈是 `createTracers()` 那一個、
 * 彈丸走的是 `Projectiles.step`。**三個模式只改材質旗標，不改任何遊戲程式。**
 *
 * 進入方式：`npm run dev` 之後開 /propdisc.html。
 */

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)

const terrain = createTerrain('sea')
/**
 * 【海面往下搬，而不是把飛機抬高】排序鍵取的是物件的世界座標原點，而曳光彈
 * 那一整批的 `InstancedMesh` **恆在世界原點**。把飛機抬到 400 m，原點就永遠
 * 在腳下 400 m 處、永遠比圓盤遠 —— 排序就永遠落在「正確」的那一邊，這一頁
 * 反而示範不出東西。飛機留在原點附近、海面往下移，兩者都成立。
 */
terrain.object.position.y = -400
ctx.scene.add(terrain.object)

const model = buildAircraft(P51D)
ctx.scene.add(model.group)

const tracers = createTracers()
ctx.scene.add(tracers.object)

const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)
controls.target.set(0, 0, -3)
ctx.camera.position.set(4.6, 1.7, 13)
controls.update()

/**
 * 模糊圓盤那一個 Mesh。
 *
 * 【怎麼認出它】槳葉是 `BoxGeometry`、圓盤是 `CircleGeometry`，機體其餘部分
 * 都不是 —— 這是全機唯一的一個（見 `geometry/assembly.ts` 的 propeller）。
 */
let disc: Mesh | null = null
model.group.traverse((o) => {
  if ((o as Mesh).isMesh && (o as Mesh).geometry.type === 'CircleGeometry') disc = o as Mesh
})
if (disc === null) throw new Error('找不到模糊圓盤 —— assembly.ts 的槳盤幾何換過了？')
const DISC = disc as Mesh
DISC.geometry.computeBoundingSphere()
const PROP_RADIUS = DISC.geometry.boundingSphere?.radius ?? 1.7

/** 遊戲現在用的那一個材質。三個模式都從它出發，只改旗標 */
const blended = DISC.material as MeshStandardMaterial

/**
 * 模式 C：圖案挖空。
 *
 * `transparent: false` 所以它走**不透明流程**、正常寫深度 —— 深度在每個角度
 * 都對，連穿插都對。半透明的觀感靠片段端 `discard` 出來的葉片抹痕假裝：
 * 靠近轂心較密、葉尖較透（真實的模糊槳盤就是這樣，因為葉片在大半徑處佔圓環
 * 面積的比例較小）。
 *
 * **這正是它的代價所在**：圖案必須隨角度變化才像槳葉，而隨角度變化的圖案轉
 * 起來就會頻閃（馬車輪效應）。把槳速拉到滿油門就看得到。
 */
const CUT_BLADES = 4
const cutout = new MeshStandardMaterial({ color: 0xc8d0d8, roughness: 0.5 })
cutout.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms) => {
  shader.uniforms.uRadius = { value: PROP_RADIUS }
  shader.uniforms.uBlades = { value: CUT_BLADES }
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', `#include <common>
       varying vec2 vLocal;`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
       vLocal = position.xy;`)
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', `#include <common>
       varying vec2 vLocal;
       uniform float uRadius;
       uniform float uBlades;`)
    .replace('#include <dithering_fragment>', `#include <dithering_fragment>
       float rNorm = clamp(length(vLocal) / uRadius, 0.0, 1.0);
       float ang = atan(vLocal.y, vLocal.x);
       float sector = fract((ang / 6.28318530718) * uBlades);
       // 靠近轂心較密、葉尖較透
       float density = mix(0.55, 0.10, rNorm);
       if (sector > density) discard;`)
}

type Mode = 0 | 1 | 2
const NOTES: Record<Mode, string> = {
  0: '子彈飛到圓盤後方時整條消失。轉動「離原點」滑桿會看到它時好時壞 —— '
    + '曳光彈整批是一個 InstancedMesh，排序深度取的是世界原點。',
  1: '子彈在圓盤後方時被 22% 的圓盤蓋住，那是正確的樣子。'
    + '最壞情況是「子彈在圓盤與相機之間」時被蓋上 22% 的顏色 —— 少見且不刺眼。',
  2: '深度永遠正確，離原點怎麼調都一樣。代價：把槳速拉到滿油門，'
    + '看那個挖空圖案會不會變成慢慢轉、停住、甚至倒轉。',
}

let mode: Mode = 0
function applyMode(): void {
  if (mode === 2) {
    DISC.material = cutout
    DISC.renderOrder = 0
  } else {
    DISC.material = blended
    // 【模式 0 就是遊戲現在的樣子】depthWrite 用 three 的預設值 true
    blended.depthWrite = mode === 0
    DISC.renderOrder = mode === 1 ? 10 : 0
  }
  for (let i = 0; i < 3; i++) {
    document.getElementById(`m${i}`)!.classList.toggle('on', i === mode)
  }
  document.getElementById('note')!.textContent = NOTES[mode]
}

/**
 * 一串朝相機飛來的曳光彈，**穿過圓盤所在的平面**。
 *
 * 藍隊機首朝 −Z，所以槳盤在 z ≈ −2.6。彈丸從 z = −400 往 +Z 飛，於是任何
 * 時刻都同時有「在圓盤後面」與「在圓盤前面」的彈丸 —— 那正是逐物件排序
 * 永遠處理不了的情形。
 */
const MUZZLE_SPEED = 887
const SPAWN_INTERVAL = 0.055
/**
 * 飛過這個 z 就回收，m（機體座標的 +Z 是機尾方向）。
 *
 * 【為什麼要有】不回收的話彈丸會直接穿過相機 —— 一條 14 m 的曳光彈在鏡頭
 * 前 1 m 處會鋪滿整個畫面。
 */
const CULL_Z = 6
const projectiles = new Projectiles()
let spawnTimer = 0
let spawnIndex = 0

function spawnBurst(): void {
  // 橫向與高度都撒開一點，才看得到不同深度的彈丸同時在場
  const lateral = ((spawnIndex % 5) - 2) * 0.85
  const vertical = (((spawnIndex >> 1) % 3) - 1) * 0.55
  spawnIndex++
  // 【彈丸在世界座標，跟著場景偏移一起搬】而 `tracers.object` 本身恆在原點
  // —— 那正是遊戲裡的樣子，也是排序會翻轉的原因
  projectiles.spawn(lateral, vertical, -400 + sceneOffset, 0, 0, MUZZLE_SPEED, 1, 0)
}

let sceneOffset = 0
let slow = 0.08
let propRate = 8
let paused = false
let propRotation = 0

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

range('rpm', (v) => { propRate = v }, (v) => `${v} rad/s`)
range('slow', (v) => { slow = v }, (v) => `${v.toFixed(2)}×`)
// 【相機與注視點跟著一起搬】只搬飛機的話畫面會跑掉；一起搬則相對機位不變，
// 唯一改變的就是「世界原點離相機多遠」—— 那正是要示範的變數
range('off', (v) => {
  const d = v - sceneOffset
  sceneOffset = v
  model.group.position.z = v
  ctx.camera.position.z += d
  controls.target.z += d
  controls.update()
}, (v) => `${v} m`)

for (let i = 0; i < 3; i++) {
  document.getElementById(`m${i}`)!.addEventListener('click', () => {
    mode = i as Mode
    applyMode()
  })
}
const pauseBtn = document.getElementById('pause') as HTMLButtonElement
const togglePause = (): void => {
  paused = !paused
  pauseBtn.classList.toggle('on', paused)
  pauseBtn.textContent = paused ? '繼續（空白鍵）' : '暫停（空白鍵）'
}
pauseBtn.addEventListener('click', togglePause)
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); togglePause() }
  if (e.code === 'Digit1') { mode = 0; applyMode() }
  if (e.code === 'Digit2') { mode = 1; applyMode() }
  if (e.code === 'Digit3') { mode = 2; applyMode() }
})

applyMode()

/**
 * 複製 three 對透明物件的排序鍵，好把「誰先畫」直接顯示出來。
 *
 * 【為什麼值得顯示】這個 bug 之所以難查，是因為決定它的東西完全看不見。
 * 把排序鍵印在畫面上，「有些角度會有些角度不會」就變成一個看得到的數字。
 */
const projScreen = new Matrix4()
const probe = new Vector3()
function sortKeyOf(o: { matrixWorld: Matrix4 }): number {
  return probe.setFromMatrixPosition(o.matrixWorld).applyMatrix4(projScreen).z
}

const stats = document.getElementById('stats')!
let last = performance.now()

function frame(now: number): void {
  const wall = Math.min((now - last) / 1000, 0.1)
  last = now
  const dt = paused ? 0 : wall * slow

  // 【槳的轉速走真實時間，不吃慢動作】頻閃是「每幀轉多少角度」與圖案週期
  // 之間的關係 —— 把它放慢就等於把要觀察的現象消掉了
  if (!paused) propRotation += wall * propRate
  model.setPropSpin(propRotation, true)

  spawnTimer += dt
  while (spawnTimer >= SPAWN_INTERVAL) {
    spawnTimer -= SPAWN_INTERVAL
    spawnBurst()
  }
  if (dt > 0) projectiles.step(dt)
  for (let i = 0; i < projectiles.capacity; i++) {
    if (projectiles.owner[i] !== -1 && projectiles.z[i]! > sceneOffset + CULL_Z) {
      projectiles.kill(i)
    }
  }
  // 【`tracers.object` 不搬】它恆在世界原點，與遊戲一致
  tracers.update(projectiles)

  controls.update()
  terrain.update(now / 1000, ctx.camera.position.x, ctx.camera.position.z)
  ctx.renderer.render(ctx.scene, ctx.camera)

  projScreen.multiplyMatrices(ctx.camera.projectionMatrix, ctx.camera.matrixWorldInverse)
  const kDisc = sortKeyOf(DISC)
  const kTracers = sortKeyOf(tracers.object)
  // 透明清單由遠而近繪製：排序鍵**大**的先畫
  const discFirst = kDisc > kTracers
  const opaque = mode === 2
  stats.innerHTML = opaque
    ? '圓盤走不透明流程\n深度由 GPU 仲裁，<b>與排序無關</b>'
    : `圓盤排序鍵　${kDisc.toFixed(4)}\n`
      + `曳光彈排序鍵 ${kTracers.toFixed(4)}\n`
      + `先畫的是　　<b>${discFirst ? '圓盤' : '曳光彈'}</b>`
      + (discFirst && mode === 0 ? '\n<b>→ 後方的子彈會被丟掉</b>' : '')

  requestAnimationFrame(frame)
}
requestAnimationFrame(frame)
