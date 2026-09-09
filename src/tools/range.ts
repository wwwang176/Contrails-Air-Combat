import { Quaternion, TextureLoader, Vector3 } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { FixedStepAccumulator } from '../core/loop'
import { createScene } from '../render/scene'
import { createOcean } from '../render/ocean'
import { createTracers } from '../render/tracers'
import { createMuzzles } from '../render/muzzle'
import { createSparks } from '../render/sparks'
import { createSplashes } from '../render/splash'
import { createFireball } from '../render/fireball'
import {
  createShipFireSmoke, createSmoke, emitKillSmoke, emitSmoke, DEBRIS_SMOKE_SIZE,
} from '../render/smoke'
import {
  AIR_BLAST, BLAST_PACE, createBlastSmoke, createDust, createEmberSmoke,
  createFireGlow, emitBlast, emitEmber, type BlastPools,
} from '../render/blast'
import { createFireChunks } from '../render/chunks'
import { createFirePuff } from '../render/firePuff'
import {
  createSpray, emitSpray, DEBRIS_SPRAY_COUNT, WATER_COLOR, WRECK_SPRAY_COUNT,
} from '../render/spray'
import { createDebris } from '../render/debris'
import { createWrecks } from '../render/wrecks'
import { buildAircraft, bodyColorOf, preloadAircraftModels, type AircraftModel } from '../render/geometry/buildAircraft'
import { World, type Combatant } from '../world/World'
import { clearImpacts, createImpacts, IMPACT_STRIDE } from '../world/events'
import { clearKills, KILL_STRIDE } from '../world/kills'

/** 空中擊墜的爆炸繼承多少母機速度。與 `main.ts` 同一個值 */
const KILL_BLAST_INHERIT = 0.5
import { Aircraft } from '../aircraft/Aircraft'
import { P51D } from '../specs/p51d'
import { BF109K4 } from '../specs/bf109k4'
import type { AircraftSpec } from '../specs/types'
import type { Command, Controller } from '../control/Controller'

/**
 * 擊墜試驗場 —— 純驗收用的開發工具，不屬於遊戲。
 *
 * 【為什麼要有它】M8 的四個特效（火球、零件、黑煙、殘骸入水）在 20v20 裡
 * 只能等隨機擊墜，而火球只活 0.5 s —— 想看清楚它長什麼樣子完全是碰運氣。
 * 這裡把場景縮到一架平飛的飛機加一顆按鈕，鏡頭自由，還能放慢到 0.05×。
 *
 * 【為什麼直接用 World 與遊戲的池子，不另外模擬】與機庫同一個理由：工具若
 * 自己抄一份，看到的就不是遊戲裡的東西，這個工具反而會製造錯誤的信心。
 * 這裡走的是與 `main.ts` 完全相同的路徑 —— `world.destroy()` 推事件、
 * 子步排空、渲染層接管模型。
 *
 * 進入方式：`npm run dev` 之後開 /range.html。
 */

const SPECS: AircraftSpec[] = [P51D, BF109K4]
let specIndex = 0

const canvas = document.getElementById('scene') as HTMLCanvasElement
const ctx = createScene(canvas)
// P-51D 與 F6F-5 走 GLB，樣板要先載好 `buildAircraft` 才是同步的
await preloadAircraftModels()
const ocean = createOcean(null)
ctx.scene.add(ocean.mesh)

const controls = new OrbitControls(ctx.camera, ctx.renderer.domElement)
controls.enableDamping = true
controls.dampingFactor = 0.08

/** 平飛：機首朝 −Z、油門固定、不開火。 */
class LevelFlight implements Controller {
  update(a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1).applyQuaternion(a.state.orientation)
    out.throttle = 0.75
    out.brake = 0
    out.firing = false
  }
}

const loop = new FixedStepAccumulator({ stepHz: 240, maxSubsteps: 8, maxFrameSeconds: 0.25 })

// 【與 main.ts 同一批池子】看到的必須就是遊戲裡的那些東西
const tracers = createTracers()
ctx.scene.add(tracers.object)
const sparks = createSparks()
ctx.scene.add(sparks.object)
const splashes = createSplashes()
ctx.scene.add(splashes.object)
const fireball = createFireball()
ctx.scene.add(fireball.object)
const smoke = createSmoke()
ctx.scene.add(smoke.object)
const spray = createSpray(WATER_COLOR)
ctx.scene.add(spray.object)

// ── 爆炸與火焰 ──────────────────────────────────────────
//
// 【與 `main.ts` 同一組配方】擊墜的球塊火球（`AIR_BLAST`）與殘骸的引擎火
// （`createFirePuff`）在遊戲裡長什麼樣，靶場就要長什麼樣 —— 這一頁是它們
// 的驗收處。配方本身在 `render/blast.ts`，`/blast.html` 是那一份的調校台。
const smokeTexture = new TextureLoader().load('/textures/smoke.png')
const blastChunks = createFireChunks(undefined, BLAST_PACE, (x, y, z, vx, vy, vz, d, slot) => {
  emitEmber(blastEmber, slot, x, y, z, vx, vy, vz, d)
})
ctx.scene.add(blastChunks.object)
const blastGlow = createFireGlow(undefined, BLAST_PACE)
ctx.scene.add(blastGlow.object)
const blastEmber = createEmberSmoke(undefined, BLAST_PACE, smokeTexture)
ctx.scene.add(blastEmber.object)
const blastSmoke = createBlastSmoke(undefined, BLAST_PACE, smokeTexture)
ctx.scene.add(blastSmoke.object)
const blastDust = createDust(undefined, BLAST_PACE, smokeTexture)
ctx.scene.add(blastDust.object)
const shipFireSmoke = createShipFireSmoke(undefined, smokeTexture)
ctx.scene.add(shipFireSmoke.object)

/**
 * 【沒有水冠那一組】靶場只放擊墜（`AIR_BLAST`）與火焰（`FIRE_BLAST`），
 * 兩份配方的 `jetCount` 都是 0。省略 `jets` 時水柱退回 `splashEvents`，
 * 而那一格在這裡不會有東西進去。
 */
const BLAST_POOLS: BlastPools = {
  fireball: blastChunks,
  smoke: blastSmoke,
  dust: blastDust,
  spray,
  splashEvents: createImpacts(),
  glow: blastGlow,
}

/** 船火、地面火與殘骸引擎火共用的那一支。**在模組層建一次** */
const emitFirePuff = createFirePuff(BLAST_POOLS, shipFireSmoke)

/**
 * 每幀要步進、重播前要清空的爆炸池。**清單只有這一份** —— 漏掉其中一個
 * 的症狀是「收得到 emit 但一顆粒子都不畫」（實例矩陣在 `step` 裡寫），
 * 或者上一次的火留在畫面上被當成新的。
 */
const BLAST_STEPPED = [blastChunks, blastGlow, blastEmber, blastSmoke, blastDust, shipFireSmoke]
const debris = createDebris()
ctx.scene.add(debris.object)

let world: World
let subject: Combatant
let model: AircraftModel
let wrecked = false
let muzzles = createMuzzles(1)
ctx.scene.add(muzzles.object)

const renderPositions: Vector3[] = [new Vector3()]
const renderQuaternions: Quaternion[] = [new Quaternion()]

const wrecks = createWrecks(4, (m) => {
  ctx.scene.remove(m.group)
  m.dispose()
})

const altSlider = document.getElementById('alt') as HTMLInputElement
const tasSlider = document.getElementById('tas') as HTMLInputElement
const slowSlider = document.getElementById('slow') as HTMLInputElement
const statsEl = document.getElementById('stats') as HTMLDivElement
const followBtn = document.getElementById('follow') as HTMLButtonElement
const specRow = document.getElementById('specRow') as HTMLDivElement

let follow = true

/** 砍掉重練：新的 World、新的飛機、新的模型。殘骸池裡的舊殘骸一併清掉。 */
function reset(): void {
  if (model && !wrecked) {
    ctx.scene.remove(model.group)
    model.dispose()
  }
  wrecks.dispose()
  // 【把池子清空】用一個大到超過所有壽命的 dt 步進一次，等於「全部老死」。
  // 不清的話上一次的煙與零件會留在畫面上，驗收時很容易把舊的當成新的 ——
  // 我第一次就上了這個當。
  fireball.step(999)
  smoke.step(999)
  spray.step(999)
  for (const p of BLAST_STEPPED) p.step(999)
  debris.step(999, () => -1e9, () => -1e9, 0)
  splashes.step(999)

  const spec = SPECS[specIndex]!
  const altitude = Number(altSlider.value)
  const tas = Number(tasSlider.value)

  world = new World()
  const aircraft = new Aircraft(spec, altitude, tas)
  aircraft.state.position.set(0, altitude, 0)
  aircraft.prevPosition.copy(aircraft.state.position)
  subject = world.add(aircraft, new LevelFlight(), 'blue', aircraft.state.position.clone(), altitude, tas)

  model = buildAircraft(spec)
  ctx.scene.add(model.group)
  wrecked = false

  muzzles.dispose()
  ctx.scene.remove(muzzles.object)
  muzzles = createMuzzles(1)
  ctx.scene.add(muzzles.object)

  controls.target.copy(aircraft.state.position)
  ctx.camera.position.set(28, altitude + 10, 34)
  controls.update()
}

function boom(): void {
  if (subject.alive) world.destroy(subject)
}

document.getElementById('boom')!.addEventListener('click', boom)
document.getElementById('reset')!.addEventListener('click', reset)
followBtn.addEventListener('click', () => {
  follow = !follow
  followBtn.classList.toggle('on', follow)
})
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); boom() }
  if (e.code === 'KeyR') reset()
})

for (const [i, s] of SPECS.entries()) {
  const b = document.createElement('button')
  b.textContent = s.name
  b.className = i === specIndex ? 'on' : ''
  b.addEventListener('click', () => {
    specIndex = i
    // HTMLCollection 在這個 tsconfig 的 lib 設定下不可迭代，用索引走
    for (let k = 0; k < specRow.children.length; k++) {
      specRow.children[k]!.classList.remove('on')
    }
    b.classList.add('on')
    reset()
  })
  specRow.appendChild(b)
}

function syncLabels(): void {
  ;(document.getElementById('altV') as HTMLSpanElement).textContent = `${altSlider.value} m`
  ;(document.getElementById('tasV') as HTMLSpanElement).textContent = `${tasSlider.value} m/s`
  ;(document.getElementById('slowV') as HTMLSpanElement).textContent =
    `${Number(slowSlider.value).toFixed(2)}×`
}
altSlider.addEventListener('input', () => { syncLabels(); reset() })
tasSlider.addEventListener('input', () => { syncLabels(); reset() })
slowSlider.addEventListener('input', syncLabels)
syncLabels()

reset()

const subjectPos = new Vector3()
let last = performance.now()
let elapsed = 0

function frame(now: number): void {
  const wall = Math.min((now - last) / 1000, 0.25)
  last = now
  // 【慢動作把整條時間軸一起縮】物理與特效吃同一個 dt，否則放慢時
  // 特效與飛機會脫節
  const dt = wall * Number(slowSlider.value)
  elapsed += dt

  const alpha = loop.advance(dt, (h) => {
    world.step(h)
    sparks.emit(
      world.hitEvents, ctx.camera.position.x, ctx.camera.position.y, ctx.camera.position.z,
    )
    splashes.emit(world.splashEvents, ocean.heightAt, elapsed)
    clearImpacts(world.hitEvents)
    clearImpacts(world.splashEvents)
    // 【擊墜走球塊火球，與 `main.ts` 同一份】靶場一律在海上，而海面的
    // `waterAt` 是有限值 —— 那一支的分支在這裡恆為空爆，所以只留 `AIR_BLAST`
    {
      const d = world.killEvents.data
      for (let e = 0; e < world.killEvents.count; e++) {
        const o = e * KILL_STRIDE
        // 【繼承母機速度】火球完全靜止的話，一架 150 m/s 的飛機在半秒的
        // 壽命內會飛出 75 m —— 畫面上是「爆炸發生在飛機後面」
        emitBlast(BLAST_POOLS, AIR_BLAST, d[o]!, d[o + 1]!, d[o + 2]!,
          (e * 131 + Math.round(world.time * 60)) | 0,
          d[o + 3]! * KILL_BLAST_INHERIT, d[o + 4]! * KILL_BLAST_INHERIT,
          d[o + 5]! * KILL_BLAST_INHERIT)
      }
    }
    emitKillSmoke(smoke, world.killEvents)
    debris.emit(world.killEvents, () => bodyColorOf(subject.aircraft.spec))
    clearKills(world.killEvents)
  })

  // 與 main.ts 相同的規則：模型還有沒有人要用
  if (!wrecked) {
    const a = subject.aircraft
    renderPositions[0]!.lerpVectors(a.prevPosition, a.state.position, alpha)
    renderQuaternions[0]!.slerpQuaternions(a.prevOrientation, a.state.orientation, alpha)
    model.group.position.copy(renderPositions[0]!)
    model.group.quaternion.copy(renderQuaternions[0]!)
    if (subject.alive) {
      model.setPropSpin(elapsed * 40, true)
    } else {
      wrecked = true
      const v = a.state.velocity
      wrecks.adopt(model, a.spec, v.x, v.y, v.z, 0)
    }
  }

  muzzles.update(world.combatants, renderPositions, renderQuaternions)
  tracers.update(world.projectiles)
  sparks.step(dt)
  // 【靶場一律是海】所以水面就是海面
  wrecks.step(dt, ocean.heightAt, (x, z) => ocean.heightAt(x, z, elapsed), elapsed)
  debris.step(dt, ocean.heightAt, (x, z) => ocean.heightAt(x, z, elapsed), elapsed)
  emitSmoke(smoke, wrecks.smokeEvents)
  // 【殘骸的引擎在燒】與 `main.ts` 同一支回呼
  {
    const d = wrecks.fireEvents.data
    for (let e = 0; e < wrecks.fireEvents.count; e++) {
      const o = e * IMPACT_STRIDE
      emitFirePuff(d[o]!, d[o + 1]!, d[o + 2]!)
    }
  }
  emitSmoke(smoke, debris.smokeEvents, DEBRIS_SMOKE_SIZE)
  emitSpray(spray, wrecks.sprayEvents, WRECK_SPRAY_COUNT)
  emitSpray(spray, debris.sprayEvents, DEBRIS_SPRAY_COUNT)
  splashes.emit(wrecks.splashEvents, ocean.heightAt, elapsed)
  splashes.emit(debris.sprayEvents, ocean.heightAt, elapsed)
  splashes.step(dt)
  fireball.step(dt)
  smoke.step(dt)
  spray.step(dt)
  for (const p of BLAST_STEPPED) p.step(dt)

  // 鏡頭跟隨的目標：還沒爆就是飛機，爆了就是殘骸
  subjectPos.copy(wrecked ? model.group.position : renderPositions[0]!)
  if (follow) {
    const delta = subjectPos.clone().sub(controls.target)
    controls.target.add(delta)
    ctx.camera.position.add(delta)
  }
  controls.update()
  ocean.update(elapsed, subjectPos.x, subjectPos.z)
  ctx.renderer.render(ctx.scene, ctx.camera)

  const info = ctx.renderer.info.render
  statsEl.textContent = [
    `狀態      ${subject.alive ? '飛行中' : wrecked ? '殘骸墜落' : '已擊墜'}`,
    `高度      ${subjectPos.y.toFixed(0)} m`,
    `火球      ${fireball.live}`,
    `黑煙      ${smoke.live}`,
    `噴濺      ${spray.live}`,
    `零件      ${debris.live}`,
    `殘骸      ${wrecks.live}`,
    `水柱      ${splashes.live}`,
    `draw call ${info.calls}`,
  ].join('\n')

  requestAnimationFrame(frame)
}

// 【除錯掛勾】開發工具才有。驗收時想知道「畫面上看不到的東西到底存不存在」
// 只能靠讀實際的實例資料 —— 用猜的會浪費更多時間。
;(window as unknown as { __range: unknown }).__range = {
  fireball, smoke, spray, debris, wrecks, splashes,
  camera: ctx.camera, controls,
  get world() { return world },
  get subject() { return subject },
}

window.addEventListener('resize', ctx.resize)
ctx.resize()
requestAnimationFrame(frame)
