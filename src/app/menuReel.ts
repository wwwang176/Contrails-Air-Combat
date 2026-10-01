import { Group, type PerspectiveCamera, Quaternion, type Scene, Vector3 } from 'three'
import { buildAircraft, buildAircraftLod, useAircraftLod, type AircraftModel } from '../render/geometry/buildAircraft'
import { createTracers, type Tracers } from '../render/tracers'
import { createMuzzles, type MuzzleSource, type Muzzles } from '../render/muzzle'
import { createShipModels, type ShipModels } from '../render/ships'
import { createShipWakes, shipFoamTexture, type ShipWakes } from '../render/shipWakes'
import { paletteOf, paletteSunDir } from '../render/timeOfDay'
import type { OceanHeightUniforms } from '../render/wake'
import { hash01 } from '../render/scatter'
import { Projectiles, PROJECTILE_LIFETIME } from '../world/Projectiles'
import { FLASH_SECONDS } from '../world/World'
import { createShip, SHIP_CLASSES, type Ship } from '../world/ships'
import type { IslandDesc } from '../world/archipelago'
import type { TimeOfDay } from '../world/timeOfDay'
import { mountDirection } from '../weapons/types'
import type { AircraftSpec } from '../specs/types'
import { t as tr } from '../i18n'
import { createFlight, flightPose, openSeaOrigin, type Flight } from './reelFlight'
import { createReelCamera, reelShots, type ReelEvent, type Shot } from './reelShots'

/**
 * 主選單背景的短片放映機。分鏡在 `reelShots.ts`；這裡負責建／拆演員、推進時間、
 * 照事件表開火與放特效、暗場換景。
 *
 * 【特效走遊戲那一套池子】爆炸、黑雲、殘骸、拖煙都經過 `ReelFx` 交給 `main.ts`
 * 的池子 —— 畫面上與戰鬥裡一模一樣。曳光彈與槍焰是這裡自己的小池子（與機庫的
 * 展示場同一個做法），換景時整批清掉。
 */

export interface ReelFx {
  /**
   * 這一架被擊落：模型交給殘骸池，之後翻滾、燒、落海都是殘骸池的事。
   * **呼叫之後模型歸殘骸池所有**，這裡不再碰它。`blast` = 空中炸一團火。
   */
  kill(model: AircraftModel, spec: AircraftSpec, vx: number, vy: number, vz: number,
    seed: number, blast: boolean): void
  /** 一朵高砲黑雲 */
  flak(x: number, y: number, z: number): void
  /** 受損拖的一團煙 */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number): void
  /** 清掉所有共用特效與殘骸池 */
  clear(): void
}

/** 放映機看得到的地形。地形每一場重建，所以每次都重新問 */
export interface ReelTerrain {
  readonly islands: readonly IslandDesc[]
  readonly oceanHeight: OceanHeightUniforms | null
  heightAt(x: number, z: number, t: number): number
}

export interface ReelStage {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly fx: ReelFx
  terrain(): ReelTerrain
  setTimeOfDay(tod: TimeOfDay): void
  /** 全黑的那一層。opacity 由這裡寫，過渡時間在 CSS */
  readonly fade: HTMLElement
  /** 右下角的地點與年月 */
  readonly caption: HTMLElement
  /**
   * 主角該落在畫面寬度的第幾成。左邊是選單，主角要在右邊空出來的那一塊。
   * 每換一段量一次。
   */
  subjectX(): number
  /** 觸控裝置：配角不出場、黑雲與防空減半 */
  readonly light: boolean
}

export interface MenuReel {
  /** 推進一幀並擺好相機。沒在放就從暗場開一段新的 */
  update(dt: number, time: number): void
  /** 停下：拆演員、清特效、相機視角還原。下一次 `update` 從暗場重新開始 */
  stop(): void
  /** 版面變了（換頁、視窗縮放）：重量主角該落在哪 */
  relayout(): void
  /** 定格：時間不走，畫面照畫。截圖驗收用 —— 跳到某一秒之後截到的就是那一秒 */
  hold: boolean
  /** 放到第幾段的哪一秒、鏡頭在哪看哪。量測與截圖用（每次讀都配置，不要在幀迴圈裡讀） */
  readonly status: {
    readonly shot: string | null, readonly t: number
    readonly camera: number[], readonly target: number[], readonly up: number[]
    readonly facing: number[], readonly lens: number[]
  }
  /**
   * 直接跳到某一段的某一秒（截圖驗收用）。事件從頭重放到那一刻，每一小步之後
   * 呼叫 `stepFx` —— 共用的特效池不跟著推進的話，一路放出來的黑雲全擠在出生那一刻
   */
  seek(shotId: string, t: number, stepFx: (dt: number) => void): void
}

/** 暗場的長度，秒。與 `#reel-fade` 的 CSS 過渡一致 */
export const REEL_FADE = 0.6
/** 拖煙的間隔，秒。135 m/s 時一團隔 2 m，煙團一出生就互相疊著 */
const SMOKE_INTERVAL = 0.015
/** 螺旋槳轉速，rad/s */
const PROP_SPIN = 55
/** 防空曳光的射速（每艘），發/秒；初速 m/s */
const AA_RATE = 14
const AA_SPEED = 850
/** 曳光池容量。戰鬥機連射加兩艘船的防空 */
const REEL_PROJECTILES = 512

interface Actor {
  readonly spec: AircraftSpec
  readonly path: Shot['planes'][number]['path']
  model: AircraftModel | null
  lod: AircraftModel | null
  usingLod: boolean
  smoking: boolean
  smokeTimer: number
  /** 上一幀拖煙的那一點（世界座標） */
  readonly smokeFrom: Vector3
  /** 這一架還在連射幾秒 */
  burstLeft: number
  readonly cooldowns: Float32Array
  readonly muzzleFlash: Float32Array
  readonly flight: Flight
  /** 世界座標的姿態（局部姿態轉過去之後） */
  readonly position: Vector3
  readonly quaternion: Quaternion
  readonly velocity: Vector3
}

interface AaStream {
  ship: number
  actor: number
  until: number
  miss: number
  timer: number
  seed: number
}

/** 短片裡的船沒有砲位可以被打掉。模組層建一次 —— 每幀傳一個新的箭頭函式就是每幀配置 */
const NO_GUN_LOST = (): void => {}

const UP = new Vector3(0, 1, 0)
const V1 = new Vector3()
const V2 = new Vector3()
const V3 = new Vector3()

export function createMenuReel(stage: ReelStage): MenuReel {
  const { scene, camera, fx } = stage
  const group = new Group()
  group.name = 'menuReel'
  const projectiles = new Projectiles(REEL_PROJECTILES)
  const tracers: Tracers = createTracers(REEL_PROJECTILES)
  const muzzles: Muzzles<MuzzleSource> = createMuzzles(12)
  group.add(tracers.object, muzzles.object)
  const restFov = camera.fov

  const shots = reelShots(Math.random())
  let index = Math.floor(Math.random() * shots.length)
  let shot: Shot | null = null
  let t = 0
  let cursor = 0
  let fadingOut = false
  let subjectX = 0.5

  /** 局部 → 世界：繞 Y 轉 `yaw`，再平移到 (ox, oz) */
  let ox = 0
  let oz = 0
  let yaw = 0
  const frameQ = new Quaternion()

  let actors: Actor[] = []
  let ships: Ship[] = []
  let shipModels: ShipModels | null = null
  let shipWakes: ShipWakes | null = null
  let streams: AaStream[] = []
  const sources: MuzzleSource[] = []
  const positions: Vector3[] = []
  const quaternions: Quaternion[] = []
  const cam = createReelCamera()

  function toWorld(v: Vector3): Vector3 {
    const c = Math.cos(yaw)
    const s = Math.sin(yaw)
    const x = v.x * c + v.z * s
    const z = -v.x * s + v.z * c
    return v.set(ox + x, v.y, oz + z)
  }

  function teardown(): void {
    for (const a of actors) {
      if (a.model !== null) {
        group.remove(a.model.group)
        a.model.dispose()
      }
      if (a.lod !== null) {
        group.remove(a.lod.group)
        a.lod.dispose()
      }
    }
    actors = []
    if (shipModels !== null) {
      group.remove(shipModels.object)
      shipModels.dispose()
      shipModels = null
    }
    if (shipWakes !== null) {
      group.remove(shipWakes.object)
      shipWakes.dispose()
      shipWakes = null
    }
    ships = []
    streams = []
    sources.length = 0
    positions.length = 0
    quaternions.length = 0
    projectiles.clear()
    tracers.update(projectiles)
    fx.clear()
  }

  function begin(next: Shot): void {
    teardown()
    shot = next
    t = 0
    cursor = 0
    fadingOut = false
    if (group.parent === null) scene.add(group)
    stage.setTimeOfDay(next.timeOfDay)

    if (next.faceSun) {
      paletteSunDir(paletteOf(next.timeOfDay), V1)
      yaw = Math.atan2(-V1.x, -V1.z)
    } else {
      yaw = 0
    }
    frameQ.setFromAxisAngle(UP, yaw)
    // 動作圈的圓心落在開闊海面上，原點再往回推那一段（局部圓心轉到世界）
    const sea = openSeaOrigin(stage.terrain().islands, next.clear.radius)
    ox = 0
    oz = 0
    V1.set(next.clear.x, 0, next.clear.z)
    toWorld(V1)
    ox = sea.x - V1.x
    oz = sea.z - V1.z

    next.planes.forEach((p, i) => {
      // 【配角不出場時仍佔著索引】事件表用索引指演員，抽掉一格會讓後面全部錯位
      const skip = stage.light && p.extra === true
      const model = skip ? null : buildAircraft(p.spec)
      const lod = skip ? null : buildAircraftLod(p.spec.id)
      if (model !== null) group.add(model.group)
      if (lod !== null) {
        lod.group.visible = false
        group.add(lod.group)
      }
      const mounts = p.spec.battery.mounts.length
      const a: Actor = {
        spec: p.spec, path: p.path, model, lod, usingLod: false,
        smoking: false, smokeTimer: 0, smokeFrom: new Vector3(), burstLeft: 0,
        cooldowns: new Float32Array(mounts), muzzleFlash: new Float32Array(mounts),
        flight: createFlight(), position: new Vector3(), quaternion: new Quaternion(), velocity: new Vector3(),
      }
      actors.push(a)
      positions.push(a.position)
      quaternions.push(a.quaternion)
      sources.push({ index: i, alive: model !== null, muzzleFlash: a.muzzleFlash, aircraft: { spec: { battery: p.spec.battery } } })
    })

    ships = next.ships.map((s, k) => {
      V1.set(s.x, 0, s.z)
      toWorld(V1)
      return createShip(k, SHIP_CLASSES[s.cls], 'blue', V1.x, V1.z, s.heading + yaw, s.speed)
    })
    if (ships.length > 0) {
      shipModels = createShipModels(ships)
      group.add(shipModels.object)
      shipWakes = createShipWakes(ships, shipFoamTexture())
      group.add(shipWakes.object)
    }

    subjectX = stage.subjectX()
    stage.caption.textContent = tr(next.captionKey)
    stage.caption.classList.add('on')
    // 【從停下的狀態回來】暗場是藏著的；先以全黑出現、逼瀏覽器算一次版面，
    // 再寫 0 —— 同一幀裡又顯示又歸零的話過渡不會發生，畫面是直接跳亮
    if (stage.fade.hidden) {
      stage.fade.style.opacity = '1'
      stage.fade.hidden = false
      void stage.fade.offsetWidth
    }
    stage.fade.style.opacity = '0'
  }

  function fire(e: ReelEvent): void {
    switch (e.kind) {
      case 'burst': {
        const a = actors[e.actor]
        if (a !== undefined) a.burstLeft = e.seconds
        break
      }
      case 'smoke': {
        const a = actors[e.actor]
        if (a !== undefined) a.smoking = true
        break
      }
      case 'kill': {
        const a = actors[e.actor]
        if (a === undefined || a.model === null) break
        // 【交出去的一定是正式模型】低模沒有引擎點與完整的面，殘骸近看會穿幫
        a.model.group.visible = true
        a.model.group.position.copy(a.position)
        a.model.group.quaternion.copy(a.quaternion)
        a.model.group.updateMatrixWorld()
        group.remove(a.model.group)
        fx.kill(a.model, a.spec, a.velocity.x, a.velocity.y, a.velocity.z, e.actor * 31 + 7, e.blast)
        a.model = null
        if (a.lod !== null) {
          group.remove(a.lod.group)
          a.lod.dispose()
          a.lod = null
        }
        a.smoking = false
        a.burstLeft = 0
        sources[e.actor] = { ...sources[e.actor]!, alive: false }
        break
      }
      case 'flak': {
        if (stage.light && (cursor & 1) === 1) break
        V1.set(e.x, e.y, e.z)
        toWorld(V1)
        fx.flak(V1.x, V1.y, V1.z)
        break
      }
      case 'aa':
        streams.push({ ship: e.ship, actor: e.actor, until: e.at + e.seconds, miss: e.miss, timer: 0, seed: e.ship * 1000 + e.actor * 97 })
        break
    }
  }

  /** 演員擺位：局部路徑 → 姿態 → 世界 */
  function poseActors(): void {
    for (const a of actors) {
      flightPose(a.path, t, a.flight)
      a.position.copy(a.flight.position)
      toWorld(a.position)
      a.velocity.copy(a.flight.velocity).applyQuaternion(frameQ)
      a.quaternion.copy(frameQ).multiply(a.flight.quaternion)
    }
  }

  function stepActors(dt: number, propRotation: number): void {
    for (let i = 0; i < actors.length; i++) {
      const a = actors[i]!
      if (a.model === null) continue
      const d2 = a.position.distanceToSquared(camera.position)
      a.usingLod = a.lod !== null && useAircraftLod(d2, a.usingLod)
      const shown = a.usingLod ? a.lod! : a.model
      a.model.group.visible = !a.usingLod
      if (a.lod !== null) a.lod.group.visible = a.usingLod
      shown.group.position.copy(a.position)
      shown.group.quaternion.copy(a.quaternion)
      shown.setPropSpin(propRotation, true)

      const engine = a.model.enginePoints[0]
      V1.copy(engine ?? V2.set(0, 0, 0)).applyQuaternion(a.quaternion).add(a.position)
      if (a.smoking) {
        // 【一幀裡的幾團沿著這一幀走過的路排開】全放在這一幀的位置的話，幀率低時
        // 一條煙會斷成一團一團
        a.smokeTimer -= dt
        while (a.smokeTimer <= 0) {
          const f = dt > 0 ? 1 + a.smokeTimer / dt : 1
          a.smokeTimer += SMOKE_INTERVAL
          V3.lerpVectors(a.smokeFrom, V1, f < 0 ? 0 : f)
          fx.smoke(V3.x, V3.y, V3.z, a.velocity.x * 0.25, a.velocity.y * 0.25, a.velocity.z * 0.25)
        }
      }
      a.smokeFrom.copy(V1)
      stepGuns(a, dt)
    }
  }

  /** 連射：與機庫展示場同一個做法，各掛架照自己的射速輪流吐 */
  function stepGuns(a: Actor, dt: number): void {
    const mounts = a.spec.battery.mounts
    const firing = a.burstLeft > 0
    if (firing) a.burstLeft -= dt
    for (let i = 0; i < mounts.length; i++) {
      const flash = a.muzzleFlash[i]! - dt
      a.muzzleFlash[i] = flash > 0 ? flash : 0
      const left = a.cooldowns[i]! - dt
      if (!firing || left > 0) {
        a.cooldowns[i] = left > 0 ? left : 0
        continue
      }
      const weapon = mounts[i]!.weapon
      a.cooldowns[i] = 60 / weapon.roundsPerMinute
      a.muzzleFlash[i] = FLASH_SECONDS
      V1.copy(mounts[i]!.position).applyQuaternion(a.quaternion).add(a.position)
      mountDirection(a.spec.battery, i, V2).applyQuaternion(a.quaternion)
      V2.multiplyScalar(weapon.muzzleVelocity).add(a.velocity)
      projectiles.spawn(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, 0, 0, 0, PROJECTILE_LIFETIME, weapon.caliber)
    }
  }

  /** 船上的防空：從甲板上隨機一點朝目標的前置點打，瞄點偏開 `miss` 公尺 */
  function stepStreams(dt: number): void {
    const rate = stage.light ? AA_RATE / 2 : AA_RATE
    for (const s of streams) {
      if (t > s.until) continue
      const ship = ships[s.ship]
      const a = actors[s.actor]
      if (ship === undefined || a === undefined || a.model === null) continue
      s.timer -= dt
      while (s.timer <= 0) {
        s.timer += 1 / rate
        const k = s.seed++
        const half = SHIP_CLASSES[ship.cls.id].hull[0]!.half.z
        V1.set((hash01(k * 3) * 2 - 1) * 6, ship.impactY + 4, (hash01(k * 3 + 1) * 2 - 1) * half * 0.7)
          .applyQuaternion(ship.orientation).add(ship.position)
        const range = V1.distanceTo(a.position)
        V2.copy(a.position).addScaledVector(a.velocity, range / AA_SPEED)
        V3.set(hash01(k * 3 + 2) * 2 - 1, hash01(k * 5 + 7) * 2 - 1, hash01(k * 7 + 3) * 2 - 1)
        V2.addScaledVector(V3, s.miss)
        V2.sub(V1).normalize().multiplyScalar(AA_SPEED)
        projectiles.spawn(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, 0, 0, 0, PROJECTILE_LIFETIME, 40)
      }
    }
  }

  function stepShips(dt: number, time: number): void {
    if (shot === null) return
    for (let k = 0; k < ships.length; k++) {
      const s = ships[k]!
      const h = s.heading
      s.position.set(s.spawn.x - Math.sin(h) * s.speed * t, 0, s.spawn.z - Math.cos(h) * s.speed * t)
    }
    shipModels?.update(ships, NO_GUN_LOST)
    if (shipWakes !== null) {
      const terrain = stage.terrain()
      shipWakes.bindOcean(terrain.oceanHeight)
      shipWakes.step(ships, dt, time, terrain.heightAt)
    }
  }

  function placeCamera(): void {
    if (shot === null) return
    shot.camera(t, cam)
    toWorld(cam.position)
    toWorld(cam.target)
    if (camera.fov !== cam.fov) {
      camera.fov = cam.fov
      camera.updateProjectionMatrix()
    }
    camera.position.copy(cam.position)
    // 肩後、槍口那幾個鏡頭的上方跟著機身歪；局部座標的方向也要轉到世界
    camera.up.copy(cam.up).applyQuaternion(frameQ)
    camera.lookAt(cam.target)
    // 【主角讓到右邊】左邊是選單。**平移投影，不是平移相機** —— 平移相機會有視差：
    // 照注視點的距離算出來的位移，對貼在鏡頭前的那一架是好幾倍，整架被推出畫面
    const w = window.innerWidth
    const h = window.innerHeight
    const shift = (0.5 - subjectX) * w
    const v = camera.view
    if (v === null || !v.enabled || v.offsetX !== shift || v.fullWidth !== w || v.fullHeight !== h) {
      camera.setViewOffset(w, h, shift, 0, w, h)
    }
  }

  let propRotation = 0

  function advance(dt: number, time: number): void {
    if (shot === null) return
    t += dt
    while (cursor < shot.events.length && shot.events[cursor]!.at <= t) {
      fire(shot.events[cursor]!)
      cursor++
    }
    propRotation += dt * PROP_SPIN
    poseActors()
    placeCamera()
    stepActors(dt, propRotation)
    stepStreams(dt)
    stepShips(dt, time)
    projectiles.step(dt)
    tracers.update(projectiles)
    muzzles.update(sources, positions, quaternions)
  }

  return {
    get status() {
      return {
        shot: shot?.id ?? null, t,
        camera: camera.position.toArray().map(Math.round),
        target: cam.target.toArray().map(Math.round),
        up: camera.up.toArray().map((v) => Math.round(v * 100) / 100),
        facing: camera.getWorldDirection(new Vector3()).toArray().map((v) => Math.round(v * 100) / 100),
        lens: [camera.near, camera.far, camera.fov, camera.aspect, camera.view?.offsetX ?? 0],
      }
    },

    hold: false,

    update(dt, time) {
      if (shot === null) {
        begin(shots[index]!)
      }
      advance(this.hold ? 0 : dt, time)
      const s = shot!
      if (!fadingOut && t >= s.duration - REEL_FADE) {
        fadingOut = true
        stage.fade.style.opacity = '1'
        stage.caption.classList.remove('on')
      }
      if (t >= s.duration) {
        index = (index + 1) % shots.length
        begin(shots[index]!)
        advance(0, time)
      }
    },

    stop() {
      if (shot === null) return
      teardown()
      shot = null
      scene.remove(group)
      camera.fov = restFov
      camera.up.set(0, 1, 0)
      // 【視窗位移要拿掉】戰鬥與機庫用同一台相機
      camera.clearViewOffset()
      // 【暗場要藏起來，不是留著全黑】它蓋在畫布上 —— 留著的話機庫與戰鬥整片黑
      stage.fade.hidden = true
      stage.caption.classList.remove('on')
    },

    relayout() {
      subjectX = stage.subjectX()
    },

    seek(shotId, at, stepFx) {
      const k = shots.findIndex((s) => s.id === shotId)
      if (k < 0) return
      index = k
      begin(shots[k]!)
      // 【事件從頭重放】擊落、拖煙、連射都是事件推出來的狀態，直接跳過去會漏掉
      const step = 1 / 30
      while (t + step < at) {
        advance(step, t)
        stepFx(step)
      }
      const last = at - t
      advance(last, at)
      stepFx(last)
    },
  }
}
