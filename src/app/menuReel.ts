import { createReelGunnery, type ReelGunActor } from './reel/reelGunnery'
import { createReelDecor } from './reel/reelDecor'
import { readSeenShots, saveSeenShots } from './reel/shotHistory'
import { markShotSeen, pickNextShot } from './reel/shotSelection'
export { markShotSeen, pickNextShot, shotWeight } from './reel/shotSelection'
import {
  Group,
  type PerspectiveCamera, Quaternion, type Scene, Vector3,
} from 'three'
import { buildAircraft, buildAircraftLod, useAircraftLod, type AircraftModel } from '../render/geometry/buildAircraft'
import { createTracers, type Tracers } from '../render/tracers'
import { createMuzzles, type MuzzleSource, type Muzzles } from '../render/muzzle'
import { createShipModels, type ShipModels } from '../render/ships'
import { createShipWakes, type ShipWakes } from '../render/shipWakes'
import { shipFoamTexture } from '../render/shipFoamTexture'
import { paletteOf, paletteSunDir } from '../render/timeOfDay'
import type { OceanHeightUniforms } from '../render/wake'
import { hash01 } from '../core/hash'
import { Projectiles } from '../world/Projectiles'
import { createShip, SHIP_CLASSES, type Ship } from '../world/ships'
import type { IslandDesc } from '../world/archipelago'
import type { TimeOfDay } from '../world/timeOfDay'
import type { AircraftSpec } from '../specs/types'
import { createFlight, flightPose, openSeaOrigin, type Flight } from './reelFlight'
import {
  BOMB_RELEASE_Y, createReelCamera, jumpAt, pickIsland, propSpeedAt, propTravel, reelShots, speedAt,
  type ReelEvent, type ReelGround, type ReelPoint, type ReelTerrainKind, type Shot,
} from './reelShots'
import type { SiteLayout } from '../render/siteSurface'
import type { CloudSpec } from '../render/clouds'
import { createBombs, createTorpedoes, type BombVisuals } from '../render/bombs'
import { createGroundModels, type GroundModels } from '../render/groundTargets'
import { TRACK_DUST_EVERY } from '../render/groundBattle'
import { createGroundTarget, type GroundTarget } from '../world/groundTargets'
import type { ImpactEvents } from '../world/events'
import { createReelBombardment, PROP_BLAST_REACH, type ReelBombardmentFx, type ReelReleaseActor } from './reel/reelBombardment'

/**
 * 主選單背景的短片放映機。分鏡在 `reelShots.ts`；這裡負責建／拆演員、推進時間、
 * 照事件表開火與放特效、暗場換景。
 *
 * 【特效走遊戲那一套池子】爆炸、黑雲、殘骸、拖煙都經過 `ReelFx` 交給 `main.ts`
 * 的池子 —— 畫面上與戰鬥裡一模一樣。曳光彈與槍焰是這裡自己的小池子（與機庫的
 * 展示場同一個做法），換景時整批清掉。
 */

export interface ReelFx extends ReelBombardmentFx {
  /**
   * 這一架被擊落：模型交給殘骸池，之後翻滾、燒、落海都是殘骸池的事。
   * **呼叫之後模型歸殘骸池所有**，這裡不再碰它。`blast` = 空中炸一團火。
   */
  kill(model: AircraftModel, spec: AircraftSpec, vx: number, vy: number, vz: number,
    seed: number, blast: boolean): void
  /**
   * 第 `seat` 架這一幀的兩個翼尖（世界座標）與過載。凝結尾的座位要穩定 —— 同一架每幀
   * 同一個號碼，否則白線會從別架的翼尖接過來
   */
  vortex(seat: number, loadFactor: number,
    lx: number, ly: number, lz: number, rx: number, ry: number, rz: number): void
  /** 機槍彈打中機身：遊戲那一套命中火花。**呼叫完就清空**，不要留著事件 */
  hits(events: ImpactEvents): void
  /** 一朵高砲黑雲 */
  flak(x: number, y: number, z: number): void
  /** 受損拖的一團煙 */
  smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number): void
  /** 發動機起火的一朵火 */
  fire(x: number, y: number, z: number): void
  /** 開動的車在車尾貼地揚起一團塵（與地面戰的行進揚塵同一個配方） */
  trackDust(x: number, y: number, z: number): void
  /** 清掉所有共用特效與殘骸池 */
  clear(): void
}

/** 放映機看得到的地形。地形每一場重建，所以每次都重新問 */
export interface ReelTerrain {
  readonly islands: readonly IslandDesc[]
  readonly oceanHeight: OceanHeightUniforms | null
  heightAt(x: number, z: number, t: number): number
  /** 判定用的地面高度：海面是 0、陸地讀高度場。炸彈落地看它 */
  collisionHeightAt(x: number, z: number): number
  /** 水面高度，沒有水回 −Infinity */
  waterAt(x: number, z: number): number
}

/**
 * 地上要畫的廠區。`layout` 拿到新地形的山丘才算得出原點，所以是函式；`key` 一樣就
 * 不必重建（同一段的廠區每次都一樣）
 */
export interface ReelSiteRequest {
  readonly key: string
  layout(hills: readonly IslandDesc[]): SiteLayout
}

export interface ReelStage {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly fx: ReelFx
  terrain(): ReelTerrain
  /**
   * 換成這張地形（種類與廠區都與現在的相同就不動）。換景的暗場裡呼叫。
   * `site` 只對兩種農地有意義
   */
  setTerrain(kind: ReelTerrainKind, site?: ReelSiteRequest): void
  setTimeOfDay(tod: TimeOfDay): void
  /** 換成這一批雲（世界座標，空陣列 = 沒有雲）。雲色照現在的時段，所以在 `setTimeOfDay` 之後呼叫 */
  setClouds(list: readonly CloudSpec[]): void
  /** 全黑的那一層。opacity 由這裡寫，過渡時間在 CSS */
  readonly fade: HTMLElement
  /**
   * 主角該落在畫面寬度的第幾成。左邊是選單，主角要在右邊空出來的那一塊。
   * 每換一段、每次 `relayout` 量一次。
   */
  subjectX(): number
  /** 觸控裝置：配角不出場、黑雲與防空減半 */
  readonly light: boolean
}

export interface MenuReel {
  /** 推進一幀並擺好相機。沒在放就從暗場開一段新的 */
  update(dt: number, time: number): void
  /** 這一段地上的物件（活著的與炸毀的都在）。冒白煙的是 `main.ts` 的事 */
  readonly props: readonly GroundTarget[]
  /** 停下：拆演員、清特效、相機視角還原。下一次 `update` 從暗場重新開始 */
  stop(): void
  /** 版面變了（換頁、視窗縮放）：重量主角該落在哪 */
  relayout(): void
  /** 定格：時間不走，畫面照畫。截圖驗收用 —— 跳到某一秒之後截到的就是那一秒 */
  hold: boolean
  /**
   * 現在的播放倍速（`Shot.speed`）。共用的特效池要用「畫面秒數 × 這個」推進 —— 用畫面
   * 秒數的話，慢動作裡的煙、火、曳光照常速散開，只有飛機在慢
   */
  readonly rate: number
  /** 放到第幾段的哪一秒、鏡頭在哪看哪。量測與截圖用（每次讀都配置，不要在幀迴圈裡讀） */
  readonly status: {
    readonly shot: string | null, readonly t: number
    /** 這一段到現在機槍打中飛機幾發 */
    readonly hits: number
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
/** 地面物件慢過這個速度（煞停中）就不再揚塵，m/s */
const TRACK_DUST_MIN_SPEED = 1
/** 跳接時被跳過那段裡的高砲黑雲，只補放跳點前這麼多秒內的，s */
const JUMP_FLAK_KEEP = 0.5
/** 曳光池容量。幾架戰鬥機連射、轟炸機的機槍手加兩艘船的防空 */
const REEL_PROJECTILES = 1024
/** 一段最多幾架飛機。槍焰池照它建；`reel-shots.test.ts` 守這一條 */
export const REEL_MAX_PLANES = 16

interface Actor extends ReelGunActor {
  readonly path: Shot['planes'][number]['path']
  model: AircraftModel | null
  lod: AircraftModel | null
  usingLod: boolean
  smoking: boolean
  smokeTimer: number
  /** 從第幾具發動機冒煙 */
  smokeEngine: number
  /** 冒煙的同時冒火；`fireTimer` 是距離下一朵火的秒數 */
  burning: boolean
  fireTimer: number
  /** 上一幀拖煙的那一點（世界座標） */
  readonly smokeFrom: Vector3
  readonly flight: Flight
}

/** 短片裡的船沒有砲位可以被打掉。模組層建一次 —— 每幀傳一個新的箭頭函式就是每幀配置 */
const NO_GUN_LOST = (): void => {}

/** 發動機起火：一朵火的間隔，秒 */
const FIRE_INTERVAL = 0.09
/** 廠區道路與鐵路的預設寬，m（與洛伊納同一組） */
const SITE_ROAD_WIDTH = 12
const SITE_RAIL_WIDTH = 26

/**
 * 局部座標的廠區 → 地形著色器吃的 `SiteLayout`。局部轉世界是「繞 Y 轉 `yaw` 再平移到
 * (ox, oz)」；`SiteLayout` 的世界轉局部是 `R_y(heading)`，所以 `heading = −yaw`。
 * 道路與鐵路在 `SiteLayout` 裡是世界座標，逐點轉過去
 */
export function reelSiteLayout(g: ReelGround, ox: number, oz: number, yaw: number): SiteLayout {
  const c = Math.cos(yaw)
  const s = Math.sin(yaw)
  const line = (pts: readonly ReelPoint[]): { x: number, z: number }[] =>
    pts.map((p) => ({ x: ox + p.x * c + p.z * s, z: oz - p.x * s + p.z * c }))
  return {
    pivot: { x: ox, z: oz },
    heading: -yaw,
    pad: g.pad,
    ...(g.patches === undefined ? {} : { patches: g.patches }),
    ...(g.treeClear === undefined ? {} : { treeClear: g.treeClear }),
    roads: (g.roads ?? []).map(line),
    roadWidth: g.roadWidth ?? SITE_ROAD_WIDTH,
    rails: (g.rails ?? []).map(line),
    railWidth: g.railWidth ?? SITE_RAIL_WIDTH,
  }
}

const UP = new Vector3(0, 1, 0)
const V1 = new Vector3()
const V2 = new Vector3()
const V3 = new Vector3()

export function createMenuReel(stage: ReelStage): MenuReel {
  const { scene, camera, fx } = stage
  const group = new Group()
  group.name = 'menuReel'
  const projectiles = new Projectiles(REEL_PROJECTILES)
  const gunnery = createReelGunnery(projectiles, stage)
  const tracers: Tracers = createTracers(REEL_PROJECTILES)
  const muzzles: Muzzles<MuzzleSource> = createMuzzles(REEL_MAX_PLANES)
  const bombVisuals: BombVisuals = createBombs()
  const torpedoVisuals: BombVisuals = createTorpedoes()
  group.add(tracers.object, muzzles.object, bombVisuals.object, torpedoVisuals.object)
  const restFov = camera.fov

  const shots = reelShots()
  const shotIds = shots.map((s) => s.id)
  let seenShots = readSeenShots()
  let index = pickNextShot(shotIds, seenShots, Math.random())
  let shot: Shot | null = null
  let t = 0
  let cursor = 0
  let fadingOut = false
  /** 主角落在畫面寬度的第幾成（`stage.subjectX`）。換段與 `relayout` 時重量 */
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
  let props: GroundTarget[] = []
  /** 每一台開動的車距下一團車尾揚塵還有幾秒（與 `props` 同索引）。換段時重建 */
  let trackClock = new Float32Array(0)
  let groundModels: GroundModels | null = null
  const reelDecor = createReelDecor(group, fx, PROP_BLAST_REACH)
  const bombardment = createReelBombardment(stage, releasePose, toWorld, reelDecor.burn)
  const { bombs, torpedoes } = bombardment
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
    if (groundModels !== null) {
      group.remove(groundModels.object)
      groundModels.dispose()
      groundModels = null
    }
    props = []
    reelDecor.clear()
    gunnery.clearStreams()
    bombardment.clear()
    bombVisuals.update(bombs)
    torpedoVisuals.update(torpedoes)
    sources.length = 0
    positions.length = 0
    quaternions.length = 0
    projectiles.clear()
    tracers.update(projectiles)
    fx.clear()
  }

  /** 這一段的局部原點：島心，或讓動作圈整個落在開闊處（局部圓心轉到世界再往回推） */
  function placeOrigin(next: Shot, islands: readonly IslandDesc[]): void {
    const island = next.site === 'island' ? pickIsland(islands) : null
    if (island !== null) {
      ox = island.cx
      oz = island.cz
      return
    }
    const sea = openSeaOrigin(islands, next.clear.radius)
    ox = 0
    oz = 0
    V1.set(next.clear.x, 0, next.clear.z)
    toWorld(V1)
    ox = sea.x - V1.x
    oz = sea.z - V1.z
  }

  function begin(next: Shot): void {
    teardown()
    shot = next
    seenShots = markShotSeen(shotIds, seenShots, next.id)
    saveSeenShots(seenShots)
    t = 0
    cursor = 0
    fadingOut = false
    gunnery.resetHits()
    if (group.parent === null) scene.add(group)
    // 【yaw 要在換地形之前定】廠區畫在地形上，轉到世界要用它
    if (next.faceSun) {
      paletteSunDir(paletteOf(next.timeOfDay), V1)
      yaw = Math.atan2(-V1.x, -V1.z)
    } else {
      yaw = 0
    }
    frameQ.setFromAxisAngle(UP, yaw)
    // 【先換地形再換時段】時段要套到新的那一張地形上
    const ground = next.ground
    stage.setTerrain(next.terrain ?? 'archipelago', ground === undefined ? undefined : {
      key: next.id,
      layout: (hills) => {
        placeOrigin(next, hills)
        return reelSiteLayout(ground, ox, oz, yaw)
      },
    })
    stage.setTimeOfDay(next.timeOfDay)
    // 【地形沒重建時 layout 不會被叫】原點照樣要算；山丘相同，算出來的也相同
    placeOrigin(next, stage.terrain().islands)
    // 雲：局部座標轉到世界（沒有雲的段給空陣列，把上一段的雲拿掉）
    stage.setClouds((next.clouds ?? []).map((c) => {
      V1.set(c.x, c.y, c.z)
      toWorld(V1)
      return { x: V1.x, y: V1.y, z: V1.z, radius: c.radius }
    }))

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
        smoking: false, smokeTimer: 0, smokeEngine: 0, burning: false, fireTimer: 0,
        smokeFrom: new Vector3(), burstLeft: 0,
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

    const terrain = stage.terrain()
    props = (next.props ?? []).map((p, k) => {
      V1.set(p.x, 0, p.z)
      toWorld(V1)
      const g = createGroundTarget(k, p.id, 'red', V1.x, V1.z, p.heading + yaw)
      g.speed = p.speed ?? 0
      // 落在地形上（與戰鬥的 `settleGroundTargets` 同一條）
      g.position.y = terrain.collisionHeightAt(V1.x, V1.z)
      g.spawn.y = g.position.y
      return g
    })
    // 【起點錯開】全部從 0 起算的話整條縱隊同一幀一起冒，讀起來是一排節拍
    trackClock = new Float32Array(props.length)
    for (let k = 0; k < props.length; k++) trackClock[k] = hash01(k * 13 + 5) * TRACK_DUST_EVERY
    if (props.length > 0) {
      groundModels = createGroundModels(props)
      group.add(groundModels.object)
    }
    if (next.decor !== undefined && next.decor.length > 0) reelDecor.build(next.decor, terrain, toWorld, yaw)

    subjectX = stage.subjectX()
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
        if (a !== undefined) {
          a.smoking = true
          a.smokeEngine = e.engine ?? 0
          a.burning = e.fire === true
        }
        break
      }
      case 'bomb':
        bombardment.queueBomb(e)
        break
      case 'destroy': {
        const g = props[e.prop]
        if (g !== undefined) bombardment.destroyProp(g)
        break
      }
      case 'blast': {
        V1.set(e.x, 0, e.z)
        toWorld(V1)
        const ground = stage.terrain().collisionHeightAt(V1.x, V1.z)
        fx.blast(V1.x, ground + e.y, V1.z, e.size)
        break
      }
      case 'torpedo':
        bombardment.releaseTorpedo(e, actors)
        break
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
      case 'gunner':
      case 'groundFire':
        gunnery.startStream(e)
        break
    }
  }

  const RELEASE = createFlight()
  /** 這一架在 `time` 那一刻機腹投放點與速度（世界座標），寫進 `outP`、`outV` */
  function releasePose(a: ReelReleaseActor, time: number, outP: Vector3, outV: Vector3): void {
    flightPose(a.path, time, RELEASE)
    outP.set(0, BOMB_RELEASE_Y, 0).applyQuaternion(RELEASE.quaternion).add(RELEASE.position)
    toWorld(outP)
    outV.copy(RELEASE.velocity).applyQuaternion(frameQ)
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

      const engine = a.model.enginePoints[a.smokeEngine] ?? a.model.enginePoints[0]
      V1.copy(engine ?? V2.set(0, 0, 0)).applyQuaternion(a.quaternion).add(a.position)
      if (a.smoking && a.burning) {
        a.fireTimer -= dt
        if (a.fireTimer <= 0) {
          a.fireTimer += FIRE_INTERVAL
          fx.fire(V1.x, V1.y, V1.z)
        }
      }
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
      // 翼尖凝結尾：與戰鬥同一條規則，過載夠大才拉出白線
      const tip = a.model.wingTip
      V1.set(-tip.x, tip.y, tip.z).applyQuaternion(a.quaternion).add(a.position)
      V2.set(tip.x, tip.y, tip.z).applyQuaternion(a.quaternion).add(a.position)
      fx.vortex(i, a.flight.loadFactor, V1.x, V1.y, V1.z, V2.x, V2.y, V2.z)
      gunnery.stepGuns(a, i, dt)
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
    const terrain = stage.terrain()
    if (shipWakes !== null) {
      shipWakes.bindOcean(terrain.oceanHeight)
      shipWakes.step(ships, dt, time, terrain.heightAt)
    }
    // 開動的地面物件照時間往前開、貼著地形；炸毀的停在原地。開了多遠是 `propTravel`
    // （含煞車），與 `propAt` 同一條。還在動的每隔 `TRACK_DUST_EVERY` 秒在車尾貼地揚一團塵
    const specs = shot.props ?? []
    for (let k = 0; k < props.length; k++) {
      const g = props[k]!
      if (g.speed === 0 || !g.alive) continue
      const spec = specs[k]!
      const sin = Math.sin(g.heading)
      const cos = Math.cos(g.heading)
      const d = propTravel(spec, t)
      const x = g.spawn.x - sin * d
      const z = g.spawn.z - cos * d
      g.position.set(x, terrain.collisionHeightAt(x, z), z)
      if (propSpeedAt(spec, t) < TRACK_DUST_MIN_SPEED) continue
      trackClock[k]! -= dt
      if (trackClock[k]! > 0) continue
      trackClock[k]! += TRACK_DUST_EVERY
      const back = g.unit.realLength / 2
      fx.trackDust(x + sin * back, g.position.y + 0.5, z + cos * back)
    }
    // 地面物件：炸毀的換殘骸、停放飛機的槳照時間轉
    groundModels?.update(props, camera.position, dt)
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
  /** 這一幀的播放倍速（`speedAt`）。`update` 每幀照片內時間更新 */
  let rate = 1

  function advance(dt: number, time: number): void {
    if (shot === null) return
    t += dt
    // 跳接：走進跳過的那一段就直接到它的終點。中間的事件由下面照常補放；炸彈、地面物件
    // 照時間算位置，直接出現在那一刻。曳光與共用特效池清空 —— 留著的話白線、拖煙從舊位置
    // 一路拉到新位置，畫面上一條長線
    const jump = jumpAt(shot.jumps, t)
    let staleFlak = -Infinity
    if (jump !== undefined) {
      t = jump.to
      staleFlak = jump.to - JUMP_FLAK_KEEP
      projectiles.clear()
      fx.clear()
    }
    while (cursor < shot.events.length && shot.events[cursor]!.at <= t) {
      const e = shot.events[cursor]!
      // 【跳過那段的黑雲不補】補放的話全在同一幀冒出來、年紀一樣，一整片同時炸開
      if (!(e.kind === 'flak' && e.at < staleFlak)) fire(e)
      cursor++
    }
    propRotation += dt * PROP_SPIN
    poseActors()
    placeCamera()
    stepActors(dt, propRotation)
    gunnery.stepStreams(actors, ships, props, t, dt)
    stepShips(dt, time)
    bombardment.step(t, actors, ships, props)
    bombVisuals.update(bombs)
    torpedoVisuals.update(torpedoes)
    bombardment.stepShipFires(ships, dt)
    projectiles.step(dt)
    gunnery.stepHits(actors)
    tracers.update(projectiles)
    muzzles.update(sources, positions, quaternions)
  }

  return {
    get status() {
      return {
        shot: shot?.id ?? null, t, hits: gunnery.hitCount,
        camera: camera.position.toArray().map(Math.round),
        target: cam.target.toArray().map(Math.round),
        up: camera.up.toArray().map((v) => Math.round(v * 100) / 100),
        facing: camera.getWorldDirection(new Vector3()).toArray().map((v) => Math.round(v * 100) / 100),
        lens: [camera.near, camera.far, camera.fov, camera.aspect, camera.view?.offsetX ?? 0],
      }
    },

    hold: false,

    get props() { return props },

    get rate() { return rate },

    update(dt, time) {
      if (shot === null) {
        begin(shots[index]!)
      }
      rate = speedAt(shot!.speed, t)
      advance(this.hold ? 0 : dt * rate, time)
      const s = shot!
      if (!fadingOut && t >= s.duration - REEL_FADE) {
        fadingOut = true
        stage.fade.style.opacity = '1'
      }
      if (t >= s.duration) {
        index = pickNextShot(shotIds, seenShots, Math.random())
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
      // 【雲要拿掉】雲是舞台的，留著的話機庫與戰鬥的天上掛著短片的雲
      stage.setClouds([])
      // 【暗場要藏起來，不是留著全黑】它蓋在畫布上 —— 留著的話機庫與戰鬥整片黑
      stage.fade.hidden = true
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
      // 【跳進跳接那一段】`at` 落在跳過的秒數裡時，上面的迴圈已經跳到它的終點、超過 `at`
      const last = Math.max(0, at - t)
      advance(last, at)
      stepFx(last)
    },
  }
}
