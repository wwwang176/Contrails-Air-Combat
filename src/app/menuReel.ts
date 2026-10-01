import {
  type BufferAttribute, type BufferGeometry, Color, Group, Matrix4, Mesh, MeshStandardMaterial,
  type PerspectiveCamera, Quaternion, type Scene, Vector3,
} from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildDecor, DECOR_DEFAULT } from '../render/geometry/ground/plantDecor'
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
import { createFlight, flightPose, openSeaOrigin, type Flight } from './reelFlight'
import {
  BOMB_RELEASE_Y, bombAt, createReelCamera, pickIsland, reelShots, torpedoAt, torpedoEntry,
  type ReelDecor, type ReelEvent, type ReelGround, type ReelPoint, type Shot,
} from './reelShots'
import type { SiteLayout } from '../render/fields'
import { createBombs, createTorpedoes, type BombVisuals, type OrdnancePool } from '../render/bombs'
import { createGroundModels, type GroundModels } from '../render/groundTargets'
import { createGroundTarget, type GroundTarget } from '../world/groundTargets'
import { createHitResult, hitAircraft, segmentPointDistanceSq } from '../world/hit'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../world/events'

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
  /** 一枚炸彈落地（`water` = 落在海上）。`y` 是地面或海面高度 */
  bomb(x: number, y: number, z: number, water: boolean): void
  /** 魚雷入水那一下的水花 */
  torpedoSplash(x: number, z: number): void
  /** 魚雷在水中跑：落一個航跡節點。`slot` 是第幾條航跡，`serial` 換一條魚雷就換 */
  torpedoWake(slot: number, x: number, z: number, serial: number): void
  /** 魚雷打中船：水柱 */
  torpedoHit(x: number, z: number): void
  /** 地面物件炸毀：一團落地的火、留下燃燒的火點。`fires` 是幾處火點（油桶堆、油槽多一點） */
  groundKill(x: number, y: number, z: number, fires: number): void
  /** 炸彈落在船上：甲板高度的一團火（不掀水冠） */
  shipHit(x: number, y: number, z: number): void
  /** 船上的火點冒一朵火與黑煙（船火那一套煙柱） */
  shipFire(x: number, y: number, z: number): void
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
   * `site` 只對 `'farmland'` 有意義
   */
  setTerrain(kind: 'archipelago' | 'farmland', site?: ReelSiteRequest): void
  setTimeOfDay(tod: TimeOfDay): void
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
/** 防空曳光的射速（每艘），發/秒；初速 m/s */
const AA_RATE = 14
const AA_SPEED = 850
/** 曳光池容量。幾架戰鬥機連射、轟炸機的機槍手加兩艘船的防空 */
const REEL_PROJECTILES = 1024
/** 一段最多幾架飛機。槍焰池照它建；`reel-shots.test.ts` 守這一條 */
export const REEL_MAX_PLANES = 16

interface Actor {
  readonly spec: AircraftSpec
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

/** 一道持續的曳光：從一艘船（`ship`）或一架飛機的機槍手（`shooter`）打向 `actor` */
interface AaStream {
  /** 打的那艘船；−1 = 是飛機的機槍手 */
  ship: number
  /** 打的那一架；−1 = 是船 */
  shooter: number
  actor: number
  until: number
  miss: number
  timer: number
  seed: number
}

/** 短片裡的船沒有砲位可以被打掉。模組層建一次 —— 每幀傳一個新的箭頭函式就是每幀配置 */
const NO_GUN_LOST = (): void => {}

/** 防空與機槍手曳光的射手編號：負數不做命中判定（−1 是彈丸池的空槽，不能用） */
const STREAM_OWNER = -2
const S0 = new Vector3()
const S1 = new Vector3()
const HIT = createHitResult()

/**
 * 短片自己的炸彈或魚雷。**位置每幀由 `bombAt`／`torpedoAt` 從投下那一刻算出來**，
 * 填進外觀池讀的那幾格（`OrdnancePool`）。起點都是世界座標 —— 重力只往下，
 * 局部座標的旋轉不影響彈道
 */
interface Ordnance extends OrdnancePool {
  readonly t0: Float64Array
  readonly p0: Vector3[]
  readonly v0: Vector3[]
  /** 魚雷：入水的秒數（投下後）、瞄點、打不打中、上一幀的階段、航跡的序號 */
  readonly entry: Float64Array
  readonly aimX: Float64Array
  readonly aimZ: Float64Array
  readonly hit: Uint8Array
  readonly phase: Int8Array
  readonly serial: Int32Array
  next: number
}

function createOrdnance(capacity: number): Ordnance {
  const f = (): Float64Array => new Float64Array(capacity)
  return {
    active: new Uint8Array(capacity), x: f(), y: f(), z: f(), vx: f(), vy: f(), vz: f(),
    t0: f(), p0: Array.from({ length: capacity }, () => new Vector3()),
    v0: Array.from({ length: capacity }, () => new Vector3()),
    entry: f(), aimX: f(), aimZ: f(), hit: new Uint8Array(capacity),
    phase: new Int8Array(capacity), serial: new Int32Array(capacity), next: 0,
  }
}

/** 炸彈槽數（外觀池 `BOMBS_CAPACITY` 之內）；魚雷同時在水中的上限 —— 航跡池的槽數 */
const REEL_BOMBS = 96
const REEL_TORPEDOES = 8
/** 發動機起火：一朵火的間隔，秒 */
const FIRE_INTERVAL = 0.09
const AIM = { x: 0, z: 0 }
/** 換頁時主角從舊位置滑到新位置要幾秒 */
const SUBJECT_SLIDE = 0.6
/** 炸彈落在地面物件命中盒外多少公尺內就算炸到 */
const PROP_BLAST_REACH = 15
/** 炸彈落在船體碰撞盒外多少公尺內算打中船（甲板上爆、留火點），m */
const SHIP_HIT_REACH = 2
/** 船上火點冒一朵的間隔，秒（與戰鬥的 `FIRE_PUFF` 同一個節奏） */
const SHIP_FIRE_INTERVAL = 0.3
/** 一艘船最多幾處火點 —— 再多煙柱糊成一片，也多花粒子 */
const SHIP_FIRES_PER_SHIP = 6

/** 一件佈景建築：在合併幾何裡的頂點範圍、世界位置、炸彈多近算炸到 */
interface DecorItem {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly reach: number
  readonly start: number
  readonly count: number
  burnt: boolean
}
const DECOR_M = new Matrix4()
/** 燒黑的佈景建築。與地面目標殘骸同一個焦黑（`render/groundTargets.ts`） */
const DECOR_BURNT = new Color(0x2a2421)

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

/** 魚雷的瞄點離船體多近算打中那一艘（測試要求瞄點在碰撞盒外擴 4 m 內） */
const TORPEDO_SHIP_REACH = 6
const LOCAL = new Vector3()
const INV_Q = new Quaternion()
/**
 * `shipUnder` 找到的那一點正下方最高的盒頂，m。**不是 `Ship.impactY`** —— 那是主甲板；
 * 落在 LST 艉樓、Essex 艦島上的炸彈要在它們的頂上爆，不是穿進去到甲板才爆
 */
let underTop = 0

/** 船上的一處火：位置記在艦體座標，跟著船走 */
interface ShipFire {
  readonly ship: number
  readonly local: Vector3
  timer: number
}
/** 炸毀後整片燒的：油桶堆、彈藥堆、油槽、儲氣槽 */
const BURNS_LONG: ReadonlySet<string> = new Set(['fuelDump', 'bombDump', 'oilTank', 'gasHolder'])

const UP = new Vector3(0, 1, 0)
const V1 = new Vector3()
const V2 = new Vector3()
const V3 = new Vector3()

export function createMenuReel(stage: ReelStage): MenuReel {
  const { scene, camera, fx } = stage
  const group = new Group()
  group.name = 'menuReel'
  const projectiles = new Projectiles(REEL_PROJECTILES)
  const impacts = createImpacts()
  const tracers: Tracers = createTracers(REEL_PROJECTILES)
  const muzzles: Muzzles<MuzzleSource> = createMuzzles(REEL_MAX_PLANES)
  const bombVisuals: BombVisuals = createBombs()
  const torpedoVisuals: BombVisuals = createTorpedoes()
  group.add(tracers.object, muzzles.object, bombVisuals.object, torpedoVisuals.object)
  const bombs = createOrdnance(REEL_BOMBS)
  const torpedoes = createOrdnance(REEL_TORPEDOES)
  let torpedoSerial = 0
  /** 排著還沒投的炸彈：一串炸彈的每一枚在自己的秒數才掉出去 */
  let pendingBombs: { at: number, actor: number }[] = []
  const restFov = camera.fov

  const shots = reelShots()
  let index = Math.floor(Math.random() * shots.length)
  let shot: Shot | null = null
  let t = 0
  let cursor = 0
  let fadingOut = false
  let hitCount = 0
  /**
   * 主角現在落在畫面寬度的第幾成。換頁或縮放時改的是 `subjectGoal`，這裡用
   * `SUBJECT_SLIDE` 秒前後放慢滑過去 —— 直接寫進來的話整個畫面在一幀內橫移兩成寬
   */
  let subjectX = 0.5
  let subjectGoal = 0.5
  let slideFrom = 0.5
  let slideAge = SUBJECT_SLIDE

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
  let groundModels: GroundModels | null = null
  /** 佈景建築：整批一顆網格；`decor` 是每一件在合併幾何裡的頂點範圍與世界位置 */
  let decorMesh: Mesh | null = null
  let decor: DecorItem[] = []
  const decorMaterial = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.06,
  })
  let shipFires: ShipFire[] = []
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
    if (groundModels !== null) {
      group.remove(groundModels.object)
      groundModels.dispose()
      groundModels = null
    }
    props = []
    if (decorMesh !== null) {
      group.remove(decorMesh)
      decorMesh.geometry.dispose()
      decorMesh = null
    }
    decor = []
    shipFires = []
    streams = []
    pendingBombs = []
    bombs.active.fill(0)
    torpedoes.active.fill(0)
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
    t = 0
    cursor = 0
    fadingOut = false
    hitCount = 0
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
      // 落在地形上（與戰鬥的 `settleGroundTargets` 同一條）
      g.position.y = terrain.collisionHeightAt(V1.x, V1.z)
      g.spawn.y = g.position.y
      return g
    })
    if (props.length > 0) {
      groundModels = createGroundModels(props)
      group.add(groundModels.object)
    }
    if (next.decor !== undefined && next.decor.length > 0) buildDecorMesh(next.decor, terrain)

    // 【換段時直接到位】暗場蓋著，看不到跳
    subjectGoal = subjectX = stage.subjectX()
    slideAge = SUBJECT_SLIDE
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
        for (let k = 0; k < e.count; k++) pendingBombs.push({ at: e.at + k * e.interval, actor: e.actor })
        break
      case 'destroy': {
        const g = props[e.prop]
        if (g !== undefined) destroyProp(g)
        break
      }
      case 'torpedo': {
        const a = actors[e.actor]
        if (a === undefined || a.model === null) break
        const i = torpedoes.next
        torpedoes.next = (i + 1) % REEL_TORPEDOES
        // 【姿態取事件那一刻的】事件在擺位之前觸發，演員身上還是上一幀的位置；
        // 導演的鏡頭照 `at` 那一刻算魚雷，差一幀就是一兩公尺
        releasePose(a, e.at, torpedoes.p0[i]!, torpedoes.v0[i]!)
        torpedoes.t0[i] = e.at
        torpedoes.entry[i] = torpedoEntry(torpedoes.p0[i]!, torpedoes.v0[i]!)
        V1.set(e.aim.x, 0, e.aim.z)
        toWorld(V1)
        torpedoes.aimX[i] = V1.x
        torpedoes.aimZ[i] = V1.z
        torpedoes.hit[i] = e.hit ? 1 : 0
        torpedoes.phase[i] = 0
        torpedoes.serial[i] = ++torpedoSerial
        torpedoes.active[i] = 1
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
        streams.push({
          ship: e.ship, shooter: -1, actor: e.actor, until: e.at + e.seconds, miss: e.miss, timer: 0,
          seed: e.ship * 1000 + e.actor * 97,
        })
        break
      case 'gunner':
        streams.push({
          ship: -1, shooter: e.actor, actor: e.target, until: e.at + e.seconds, miss: e.miss, timer: 0,
          seed: 50000 + e.actor * 1000 + e.target * 97,
        })
        break
    }
  }

  /**
   * 這一點在哪一艘船的船體上（俯視：碰撞盒外擴 `reach` m）。沒有回 −1。
   * 只看水平 —— 呼叫端拿 `underTop` 判斷高度
   */
  function shipUnder(p: Vector3, reach = SHIP_HIT_REACH): number {
    for (let k = 0; k < ships.length; k++) {
      const s = ships[k]!
      LOCAL.copy(p).sub(s.position).applyQuaternion(INV_Q.copy(s.orientation).invert())
      let top = -Infinity
      for (const b of s.cls.hull) {
        if (Math.abs(LOCAL.x - b.center.x) < b.half.x + reach
          && Math.abs(LOCAL.z - b.center.z) < b.half.z + reach) top = Math.max(top, b.center.y + b.half.y)
      }
      if (top > -Infinity) {
        underTop = top
        return k
      }
    }
    return -1
  }

  /** 第 `k` 艘船在世界座標 `p` 那裡起火：記成艦體座標，之後跟著船走 */
  function igniteShip(k: number, p: Vector3): void {
    let n = 0
    for (const f of shipFires) if (f.ship === k) n++
    if (n >= SHIP_FIRES_PER_SHIP) return
    const s = ships[k]!
    const local = p.clone().sub(s.position).applyQuaternion(INV_Q.copy(s.orientation).invert())
    shipFires.push({ ship: k, local, timer: 0 })
  }

  /** 船上的火點：每 `SHIP_FIRE_INTERVAL` 秒在它現在的位置冒一朵 */
  function stepShipFires(dt: number): void {
    for (const f of shipFires) {
      f.timer -= dt
      if (f.timer > 0) continue
      f.timer += SHIP_FIRE_INTERVAL
      const s = ships[f.ship]!
      V1.copy(f.local).applyQuaternion(s.orientation).add(s.position)
      fx.shipFire(V1.x, V1.y, V1.z)
    }
  }

  /** 地面物件炸毀：換殘骸（`alive` false 由外觀池換材質）、爆一團、起火 */
  function destroyProp(g: GroundTarget): void {
    if (!g.alive) return
    g.alive = false
    g.hp = 0
    fx.groundKill(g.position.x, g.position.y, g.position.z, BURNS_LONG.has(g.unit.id) ? 5 : 1)
  }

  /** 佈景建築合併成一顆網格，落在地形上。換段的暗場裡建一次 */
  function buildDecorMesh(list: readonly ReelDecor[], terrain: ReelTerrain): void {
    const parts: BufferGeometry[] = []
    let start = 0
    for (const d of list) {
      const g = buildDecor(d.kind, d.w, d.d, d.h)
      V1.set(d.x, 0, d.z)
      toWorld(V1)
      const y = terrain.collisionHeightAt(V1.x, V1.z)
      DECOR_M.makeRotationY(d.heading + yaw).setPosition(V1.x, y, V1.z)
      g.applyMatrix4(DECOR_M)
      const count = g.getAttribute('position').count
      const def = DECOR_DEFAULT[d.kind]
      decor.push({
        x: V1.x, y, z: V1.z, reach: Math.hypot(d.w ?? def.w, d.d ?? def.d) / 2,
        start, count, burnt: false,
      })
      start += count
      parts.push(g)
    }
    const merged = mergeGeometries(parts)
    for (const p of parts) p.dispose()
    if (merged === null) throw new Error('佈景建築合併失敗 —— 屬性不一致')
    merged.computeBoundingSphere()
    decorMesh = new Mesh(merged, decorMaterial)
    group.add(decorMesh)
  }

  /**
   * 炸彈落在 (x, z)：附近的佈景建築燒黑、起火。頂點色就地改寫 —— 一件一次，
   * 只在炸彈落地那一幀跑
   */
  function burnDecor(x: number, z: number): void {
    if (decorMesh === null) return
    const color = decorMesh.geometry.getAttribute('color') as BufferAttribute
    for (const d of decor) {
      if (d.burnt) continue
      const reach = d.reach + PROP_BLAST_REACH
      if ((d.x - x) ** 2 + (d.z - z) ** 2 >= reach * reach) continue
      d.burnt = true
      for (let i = d.start; i < d.start + d.count; i++) {
        color.setXYZ(i, DECOR_BURNT.r, DECOR_BURNT.g, DECOR_BURNT.b)
      }
      color.needsUpdate = true
      fx.groundKill(d.x, d.y, d.z, 2)
    }
  }

  const RELEASE = createFlight()
  /** 這一架在 `time` 那一刻機腹投放點與速度（世界座標），寫進 `outP`、`outV` */
  function releasePose(a: Actor, time: number, outP: Vector3, outV: Vector3): void {
    flightPose(a.path, time, RELEASE)
    outP.set(0, BOMB_RELEASE_Y, 0).applyQuaternion(RELEASE.quaternion).add(RELEASE.position)
    toWorld(outP)
    outV.copy(RELEASE.velocity).applyQuaternion(frameQ)
  }

  /**
   * 炸彈與魚雷的一幀：照投下那一刻算出現在的位置，填進外觀池。炸彈碰到地面或海面
   * 就爆；魚雷入水掀水花、在水中落航跡、跑到瞄點時（打中的話）炸水柱
   */
  function stepOrdnance(): void {
    // 排著的炸彈到了秒數就投
    for (let k = pendingBombs.length - 1; k >= 0; k--) {
      const p = pendingBombs[k]!
      if (p.at > t) continue
      pendingBombs.splice(k, 1)
      const a = actors[p.actor]
      if (a === undefined || a.model === null) continue
      const i = bombs.next
      bombs.next = (i + 1) % REEL_BOMBS
      releasePose(a, p.at, bombs.p0[i]!, bombs.v0[i]!)
      bombs.t0[i] = p.at
      bombs.active[i] = 1
    }
    const terrain = stage.terrain()
    for (let i = 0; i < REEL_BOMBS; i++) {
      if (bombs.active[i] === 0) continue
      const tau = t - bombs.t0[i]!
      bombAt(bombs.p0[i]!, bombs.v0[i]!, tau, V1)
      // 【先看有沒有打中船】船不是地形：落在船上要在甲板高度爆，不是掉到海面掀水柱
      const k = shipUnder(V1)
      if (k >= 0 && V1.y <= underTop) {
        V1.y = underTop
        fx.shipHit(V1.x, V1.y, V1.z)
        igniteShip(k, V1)
        bombs.active[i] = 0
        continue
      }
      const ground = terrain.collisionHeightAt(V1.x, V1.z)
      if (V1.y <= ground) {
        const water = terrain.waterAt(V1.x, V1.z) > -Infinity
        fx.bomb(V1.x, water ? 0 : ground, V1.z, water)
        bombs.active[i] = 0
        // 落在地面物件旁邊就炸毀它
        for (const g of props) {
          if (!g.alive) continue
          const reach = g.radius + PROP_BLAST_REACH
          if ((g.position.x - V1.x) ** 2 + (g.position.z - V1.z) ** 2 < reach * reach) destroyProp(g)
        }
        burnDecor(V1.x, V1.z)
        continue
      }
      bombAt(bombs.p0[i]!, bombs.v0[i]!, tau + 0.02, V2)
      writeOrdnance(bombs, i, V1, V2)
    }
    for (let i = 0; i < REEL_TORPEDOES; i++) {
      if (torpedoes.active[i] === 0) continue
      const tau = t - torpedoes.t0[i]!
      AIM.x = torpedoes.aimX[i]!
      AIM.z = torpedoes.aimZ[i]!
      const phase = torpedoAt(torpedoes.p0[i]!, torpedoes.v0[i]!, torpedoes.entry[i]!, AIM, tau, V1)
      if (phase >= 1 && torpedoes.phase[i] === 0) fx.torpedoSplash(V1.x, V1.z)
      torpedoes.phase[i] = phase
      if (phase === 2) {
        if (torpedoes.hit[i] === 1) {
          fx.torpedoHit(AIM.x, AIM.z)
          // 打中的那艘：命中那一側的船舷水線上方留一處火、甲板上再一處
          V1.set(AIM.x, 0, AIM.z)
          const k = shipUnder(V1, TORPEDO_SHIP_REACH)
          if (k >= 0) {
            V1.y = 4
            igniteShip(k, V1)
            V1.y = underTop
            igniteShip(k, V1)
          }
        }
        torpedoes.active[i] = 0
        continue
      }
      if (phase === 1) fx.torpedoWake(i, V1.x, V1.z, torpedoes.serial[i]!)
      torpedoAt(torpedoes.p0[i]!, torpedoes.v0[i]!, torpedoes.entry[i]!, AIM, tau + 0.02, V2)
      writeOrdnance(torpedoes, i, V1, V2)
    }
    bombVisuals.update(bombs)
    torpedoVisuals.update(torpedoes)
  }

  /** 外觀池讀的那幾格：位置與（由下一刻差出來的）速度 —— 彈體順著速度轉正 */
  function writeOrdnance(o: Ordnance, i: number, now: Vector3, next: Vector3): void {
    o.x[i] = now.x
    o.y[i] = now.y
    o.z[i] = now.z
    o.vx[i] = (next.x - now.x) / 0.02
    o.vy[i] = (next.y - now.y) / 0.02
    o.vz[i] = (next.z - now.z) / 0.02
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
      stepGuns(a, i, dt)
    }
  }

  /** 連射：與機庫展示場同一個做法，各掛架照自己的射速輪流吐 */
  function stepGuns(a: Actor, owner: number, dt: number): void {
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
      // 【曳光沿機槍的實際方向，不修正】要打中是導演的事：把飛機飛到機首對著目標的位置
      mountDirection(a.spec.battery, i, V2).applyQuaternion(a.quaternion)
      V2.multiplyScalar(weapon.muzzleVelocity).add(a.velocity)
      projectiles.spawn(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, 0, owner, 0, PROJECTILE_LIFETIME, weapon.caliber)
    }
  }

  /**
   * 固定機槍的彈打中飛機：用遊戲的命中盒判定，噴遊戲那一套火花、彈丸停在機身上。
   * 射手自己不算。船的防空與機槍手的曳光（`STREAM_OWNER`）不判定 —— 它們照設計是擦身而過
   */
  function stepHits(): void {
    const p = projectiles
    for (let i = 0; i < p.capacity; i++) {
      const owner = p.owner[i]!
      if (owner < 0) continue
      S0.set(p.sx[i]!, p.sy[i]!, p.sz[i]!)
      S1.set(p.x[i]!, p.y[i]!, p.z[i]!)
      for (let j = 0; j < actors.length; j++) {
        const a = actors[j]!
        if (j === owner || a.model === null) continue
        const r = a.spec.wing.span
        if (segmentPointDistanceSq(S0.x, S0.y, S0.z, S1.x, S1.y, S1.z,
          a.position.x, a.position.y, a.position.z) > r * r) continue
        if (!hitAircraft(a.spec.hitBoxes, a.position, a.quaternion, S0, S1, HIT)) continue
        V3.lerpVectors(S0, S1, HIT.t)
        // 法線是機體座標；彈從盒內出發（沒有入射面）就朝來向噴
        if (HIT.nx === 0 && HIT.ny === 0 && HIT.nz === 0) V2.subVectors(S0, S1).normalize()
        else V2.set(HIT.nx, HIT.ny, HIT.nz).applyQuaternion(a.quaternion)
        pushImpact(impacts, V3.x, V3.y, V3.z, V2.x, V2.y, V2.z)
        hitCount++
        p.kill(i)
        break
      }
    }
    if (impacts.count > 0) {
      fx.hits(impacts)
      clearImpacts(impacts)
    }
  }

  /**
   * 持續的曳光：船上的防空從甲板上隨機一點、機槍手從機身上隨機一點，朝目標的前置點打，
   * 瞄點偏開 `miss` 公尺
   */
  function stepStreams(dt: number): void {
    const rate = stage.light ? AA_RATE / 2 : AA_RATE
    for (const s of streams) {
      if (t > s.until) continue
      const ship = s.ship >= 0 ? ships[s.ship] : undefined
      const shooter = s.shooter >= 0 ? actors[s.shooter] : undefined
      const a = actors[s.actor]
      if (a === undefined || a.model === null) continue
      if (ship === undefined && (shooter === undefined || shooter.model === null)) continue
      s.timer -= dt
      while (s.timer <= 0) {
        s.timer += 1 / rate
        const k = s.seed++
        if (ship !== undefined) {
          // 甲板上隨機一點
          const half = SHIP_CLASSES[ship.cls.id].hull[0]!.half.z
          V1.set((hash01(k * 3) * 2 - 1) * 6, ship.impactY + 4, (hash01(k * 3 + 1) * 2 - 1) * half * 0.7)
            .applyQuaternion(ship.orientation).add(ship.position)
        } else {
          // 機身上隨機一個砲塔位置：沿機身前後、略高略低
          const len = shooter!.spec.wing.span * 0.3
          V1.set((hash01(k * 3) * 2 - 1) * 1.2, (hash01(k * 3 + 1) * 2 - 1) * 1.2, (hash01(k * 11 + 5) * 2 - 1) * len)
            .applyQuaternion(shooter!.quaternion).add(shooter!.position)
        }
        const range = V1.distanceTo(a.position)
        V2.copy(a.position).addScaledVector(a.velocity, range / AA_SPEED)
        V3.set(hash01(k * 3 + 2) * 2 - 1, hash01(k * 5 + 7) * 2 - 1, hash01(k * 7 + 3) * 2 - 1)
        V2.addScaledVector(V3, s.miss)
        V2.sub(V1).normalize().multiplyScalar(AA_SPEED)
        // 機槍手的彈要加上自己的機速
        if (shooter !== undefined) V2.add(shooter.velocity)
        projectiles.spawn(V1.x, V1.y, V1.z, V2.x, V2.y, V2.z, 0, STREAM_OWNER, 0, PROJECTILE_LIFETIME, ship !== undefined ? 40 : 13)
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

  /** 主角位置往 `subjectGoal` 滑一幀（smoothstep，起停都放慢） */
  function slideSubject(dt: number): void {
    if (slideAge >= SUBJECT_SLIDE) return
    slideAge = Math.min(SUBJECT_SLIDE, slideAge + dt)
    const k = slideAge / SUBJECT_SLIDE
    subjectX = slideFrom + (subjectGoal - slideFrom) * k * k * (3 - 2 * k)
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
    stepOrdnance()
    stepShipFires(dt)
    projectiles.step(dt)
    stepHits()
    tracers.update(projectiles)
    muzzles.update(sources, positions, quaternions)
  }

  return {
    get status() {
      return {
        shot: shot?.id ?? null, t, hits: hitCount,
        camera: camera.position.toArray().map(Math.round),
        target: cam.target.toArray().map(Math.round),
        up: camera.up.toArray().map((v) => Math.round(v * 100) / 100),
        facing: camera.getWorldDirection(new Vector3()).toArray().map((v) => Math.round(v * 100) / 100),
        lens: [camera.near, camera.far, camera.fov, camera.aspect, camera.view?.offsetX ?? 0],
      }
    },

    hold: false,

    get props() { return props },

    update(dt, time) {
      if (shot === null) {
        begin(shots[index]!)
      }
      // 定格時也照牆鐘滑完 —— 版面換了，主角的位置不該跟著畫面一起停住
      slideSubject(dt)
      advance(this.hold ? 0 : dt, time)
      const s = shot!
      if (!fadingOut && t >= s.duration - REEL_FADE) {
        fadingOut = true
        stage.fade.style.opacity = '1'
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
    },

    relayout() {
      const goal = stage.subjectX()
      if (goal === subjectGoal) return
      subjectGoal = goal
      slideFrom = subjectX
      slideAge = 0
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
