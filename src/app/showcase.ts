import { Group, type PerspectiveCamera, Quaternion, type Scene, Vector3 } from 'three'
import { buildAircraft, type AircraftModel } from '../render/geometry/buildAircraft'
import { createTracers, type Tracers } from '../render/tracers'
import { createMuzzles, type MuzzleSource, type Muzzles } from '../render/muzzle'
import { createBombs, createTorpedoes, type BombVisuals } from '../render/bombs'
import { Bombs, BOMB_TERMINAL_SPEED, bombDragK } from '../world/bomb'
import { BOMB_SALVO_INTERVAL } from '../weapons/bomb'
import { Projectiles, PROJECTILE_LIFETIME } from '../world/Projectiles'
import { FLASH_SECONDS } from '../weapons/muzzleFlash'
import { mountDirection } from '../weapons/types'
import { LOADOUT_BY_AIRCRAFT } from '../weapons/stores'
import { DEG } from '../core/math'
import type { AircraftSpec } from '../specs/types'
import {
  SHOWCASE_SPEED, SHOWCASE_PITCH_LIMIT, showcaseDistance, createFlightPose, showcaseRollOmega,
  showcaseFlight, showcaseQuaternion, showcaseCamera, createOrbitState, stepOrbit,
} from './showcaseMotion'

export {
  SHOWCASE_ALTITUDE, SHOWCASE_RADIUS, SHOWCASE_SPEED, SHOWCASE_PITCH_LIMIT, FIGHTER_DISTANCE,
  BOMBER_DISTANCE, SHOWCASE_MAX_DISTANCE, showcaseDistance, type FlightPose, createFlightPose,
  ROLL_WOBBLE, ALT_WOBBLE, DRIFT_WOBBLE, showcaseRollOmega, showcaseFlight, showcaseQuaternion,
  showcaseCamera, AUTO_SPIN, FOLLOW_DT_CAP, type OrbitState, createOrbitState, stepOrbit,
} from './showcaseMotion'

/**
 * 機庫的展示場 —— 一架飛在海上的飛機，鏡頭繞著它轉。
 *
 * 【它沒有物理】飛行軌跡與鏡頭運動由 `showcaseMotion.ts` 計算，高度只在
 * 固定範圍內起伏。所以這裡不可能失速、不可能撞海，也不需要任何保護。真正
 * 會掉下去的是**鏡頭** —— 玩家把視角拖到飛機底下時，相機會往海面鑽；
 * 那件事由 `SHOWCASE_PITCH_LIMIT` 與距離上界一起擋住（見
 * `showcase.test.ts` 的那一條）。
 *
 * 【為什麼開火與投彈直接借用戰鬥的那幾個池】曳光彈、槍焰、炸彈的外觀必須
 * 與遊戲裡一模一樣 —— 機庫的唯一價值是「讓人看到實際會飛的那一架」，另外
 * 複製一份特效等於讓這一頁說謊。彈道也是同一支（`Projectiles.step`、
 * `Bombs.step`），只是沒有任何命中判定。
 */

/**
 * 主體在畫面上的水平位置，0.5 = 正中央。**量不到版面時的落點。**
 *
 * 【為什麼不是置中】左半邊是卷宗。相機看的是飛機，所以飛機預設就落在畫面
 * 正中央 —— 也就是紙的背面，整頁看起來像沒有飛機。
 *
 * 【為什麼是平移相機而不是挪注視點】挪注視點會讓相機轉一個角度，那等於
 * 偷偷改掉玩家拖出來的視角；平移是純位移，角度一格都不動。
 */
const DEFAULT_SUBJECT_X = 0.7
/** 拖曳靈敏度，rad/px */
const DRAG_RATE = 0.006

/** 連射週期與長度，秒。中間要有夠長的空檔，否則整頁都在閃 */
const BURST_PERIOD = 5
const BURST_SECONDS = 0.8
/**
 * 投完一整串之後歇多久，秒。
 *
 * 【整串投完才算一輪】B-17G 掛十枚，一次只丟一枚看起來像故障。串內的
 * 間隔用戰鬥裡的 `BOMB_SALVO_INTERVAL`，不另外定一個 —— 彈著間距是那一個
 * 數字決定的，展示場跟著它才是同一台飛機。
 */
const BOMB_PERIOD = 6
/** 螺旋槳轉速，rad/s。與戰鬥裡全油門同一個量級（`main.ts` 的 `propRotation`） */
const PROP_SPIN = 55

/** 彈丸池只放這一架自己的連射。0.8 秒 × 六挺 × 13 發/秒 ＝ 63 發 */
const SHOWCASE_PROJECTILES = 128
/**
 * 炸彈池。
 *
 * 【要放得下整串】B-17G 一串十枚、0.35 秒一枚共 3.2 秒撒完，而從 300 m
 * 落到海面要 8 秒 —— 十枚會同時在空中。池子小於這個數的話環狀指標會繞回來
 * 覆寫最舊的那一枚，症狀是**串頭那幾枚在半空中憑空消失**。
 */
const SHOWCASE_BOMBS = 16

/**
 * 投彈點，機體座標。
 *
 * 【為什麼不用 `model.bombPoint`】那一個是**投彈瞄具的眼點**，在機首的玻璃
 * 裡；炸彈從那裡長出來看起來像從駕駛臉上掉下去。戰鬥裡的投放點就是機體
 * 座標原點（`World.dropBomb` 收的是飛機的位置），這裡只往下挪一點讓它
 * 離開機腹。
 */
const BOMB_RELEASE = new Vector3(0, -1.2, 0)

const SCRATCH_POS = new Vector3()
const SCRATCH_DIR = new Vector3()
const SCRATCH_VEL = new Vector3()
const CAMERA_POSE = { position: new Vector3(), target: new Vector3() }

export interface Showcase {
  /** 換一架。舊的那一架連同它的彈都清掉 */
  setAircraft(spec: AircraftSpec): void
  /** 推進一幀並擺好相機。`camera` 會被就地改寫 */
  update(frameSeconds: number, camera: PerspectiveCamera): void
  dispose(): void
}

/**
 * @param view  吃拖曳的那一塊 DOM。展示場自己掛監聽器，也自己拆
 * @param stage 飛機要站在哪 —— 版面上留給它的那個空格子，只量不畫。
 *              **給它而不是給一個比例**：版面有最大寬度，寬螢幕上整條
 *              內容帶會置中，飛機得跟著帶子走而不是跟著視窗走
 */
export function createShowcase(scene: Scene, view: HTMLElement, stage: HTMLElement): Showcase {
  const group = new Group()
  scene.add(group)

  const tracers: Tracers = createTracers(SHOWCASE_PROJECTILES)
  group.add(tracers.object)
  const muzzles: Muzzles<MuzzleSource> = createMuzzles(1)
  group.add(muzzles.object)
  const bombVisuals: BombVisuals = createBombs()
  group.add(bombVisuals.object)
  const torpedoVisuals: BombVisuals = createTorpedoes()
  group.add(torpedoVisuals.object)

  const projectiles = new Projectiles(SHOWCASE_PROJECTILES)
  const bombs = new Bombs(SHOWCASE_BOMBS)
  const bombDrag = bombDragK(BOMB_TERMINAL_SPEED)
  /** 海面就是平的。展示場沒有陸地 */
  const seaLevel = (): number => 0
  const noImpact = (): void => {}

  const flight = createFlightPose()
  const quaternion = new Quaternion()
  /** `muzzles.update` 依 `index` 取位置與姿態，所以兩個陣列都只有一格 */
  const positions = [new Vector3()]
  const quaternions = [quaternion]

  let model: AircraftModel | null = null
  let spec: AircraftSpec | null = null
  let ordnance: BombVisuals = bombVisuals
  /** 每個掛架的射擊時鐘與槍焰餘秒。長度隨機種變，見 `World.setSpec` */
  let cooldowns = new Float32Array(0)
  let muzzleFlash = new Float32Array(0)
  /**
   * 餵給槍焰池的那一架。**還沒選機種時是空陣列** —— 池子讀不到任何一格，
   * 也就什麼都不畫。
   */
  const sources: MuzzleSource[] = []

  let elapsed = 0
  /** 拖曳寫 `want*`，畫面上的鏡頭每幀追過去（見 `stepOrbit`） */
  const orbit = createOrbitState()
  /** 這一台的左右擺動有多快。每台不同，見 `showcaseRollOmega` */
  let rollOmega = 0.5
  let propRotation = 0
  let burstTimer = 1.5
  let burstLeft = 0
  let bombTimer = 2
  /** 這一串還剩幾枚沒投。歸零就歇 `BOMB_PERIOD` 再排下一串 */
  let stickLeft = 0

  /**
   * 飛機落在畫面寬度的第幾成。
   *
   * 【為什麼快取而不是每幀量】`getBoundingClientRect` 會逼瀏覽器把版面算完；
   * 一幀一次不貴，但它只在視窗尺寸或卷宗寬度變了才會變。
   *
   * 【量到 0 就不動】畫面藏起來的時候元素沒有盒子，rect 全是 0 —— 寫進去
   * 的話飛機會被推到畫面最左邊，而那一幀正好是回到機庫的第一幀。
   */
  let subjectX = DEFAULT_SUBJECT_X
  function measureStage(): void {
    const rect = stage.getBoundingClientRect()
    if (rect.width <= 0 || window.innerWidth <= 0) return
    subjectX = (rect.left + rect.width / 2) / window.innerWidth
  }
  measureStage()
  window.addEventListener('resize', measureStage)

  function clearShots(): void {
    projectiles.clear()
    bombs.clear()
    // 【兩個池都要推一次空的】切換機種時另一個池留著上一架的彈，而那些
    // 實例矩陣沒人再寫 —— 畫面上會留下一串停在半空的炸彈
    bombVisuals.update(bombs)
    torpedoVisuals.update(bombs)
    tracers.update(projectiles)
  }

  function setAircraft(next: AircraftSpec): void {
    // 【第一台不拉】進機庫的第一幀沒有「前一台」可以對比，從預設距離拉
    // 過去只是開場莫名其妙推一次鏡頭
    const first = spec === null
    if (model !== null) {
      group.remove(model.group)
      model.dispose()
    }
    spec = next
    model = buildAircraft(next)
    group.add(model.group)
    orbit.wantDistance = showcaseDistance(next)
    if (first) orbit.distance = orbit.wantDistance
    rollOmega = showcaseRollOmega(next)
    // 【換機種也量一次】卷宗的內容長度會變，而它撐著版面 —— 建立時量的那
    // 一次是上一台的版面
    measureStage()
    cooldowns = new Float32Array(next.battery.mounts.length)
    muzzleFlash = new Float32Array(next.battery.mounts.length)
    sources[0] = { index: 0, alive: true, muzzleFlash, aircraft: { spec: { battery: next.battery } } }
    const load = LOADOUT_BY_AIRCRAFT[next.id]
    ordnance = load !== undefined && load.kind === 'torpedo' ? torpedoVisuals : bombVisuals
    burstLeft = 0
    burstTimer = 1.5
    bombTimer = 2
    stickLeft = load?.count ?? 0
    clearShots()
  }

  /** 連射：到時間就開一段，開火期間各掛架照自己的射速輪流吐 */
  function stepGuns(dt: number): void {
    if (spec === null) return
    const mounts = spec.battery.mounts
    burstTimer -= dt
    if (burstTimer <= 0) {
      burstTimer = BURST_PERIOD
      burstLeft = BURST_SECONDS
    }
    const firing = burstLeft > 0
    if (firing) burstLeft -= dt

    for (let i = 0; i < mounts.length; i++) {
      const flash = muzzleFlash[i]! - dt
      muzzleFlash[i] = flash > 0 ? flash : 0
      const left = cooldowns[i]! - dt
      if (!firing) {
        cooldowns[i] = left > 0 ? left : 0
        continue
      }
      if (left > 0) {
        cooldowns[i] = left
        continue
      }
      const weapon = mounts[i]!.weapon
      cooldowns[i] = 60 / weapon.roundsPerMinute
      muzzleFlash[i] = FLASH_SECONDS
      SCRATCH_POS.copy(mounts[i]!.position).applyQuaternion(quaternion).add(flight.position)
      mountDirection(spec.battery, i, SCRATCH_DIR).applyQuaternion(quaternion)
      // 【要加上機速】槍口初速是相對飛機的。少了這一項，曳光彈離機的速度
      // 就比實際慢一個機速，而那正是畫面上唯一讀得出來的東西
      SCRATCH_VEL.copy(SCRATCH_DIR).multiplyScalar(weapon.muzzleVelocity)
      SCRATCH_VEL.x -= Math.sin(flight.yaw) * SHOWCASE_SPEED
      SCRATCH_VEL.z -= Math.cos(flight.yaw) * SHOWCASE_SPEED
      projectiles.spawn(
        SCRATCH_POS.x, SCRATCH_POS.y, SCRATCH_POS.z,
        SCRATCH_VEL.x, SCRATCH_VEL.y, SCRATCH_VEL.z,
        weapon.damage, 0, 0, PROJECTILE_LIFETIME, weapon.caliber,
      )
    }
  }

  /** 投彈：固定間隔放一顆，彈道與遊戲裡同一支，落到海面就回收 */
  function stepOrdnance(dt: number): void {
    if (spec === null) return
    const load = LOADOUT_BY_AIRCRAFT[spec.id]
    if (load !== undefined && spec.role === 'bomber') {
      bombTimer -= dt
      if (bombTimer <= 0) {
        SCRATCH_POS.copy(BOMB_RELEASE).applyQuaternion(quaternion).add(flight.position)
        bombs.spawn(
          SCRATCH_POS.x, SCRATCH_POS.y, SCRATCH_POS.z,
          -Math.sin(flight.yaw) * SHOWCASE_SPEED, 0, -Math.cos(flight.yaw) * SHOWCASE_SPEED,
          load.damage,
        )
        // 【串投完才重排下一串】掛十枚就要看到十枚一枚接一枚掉出去
        stickLeft -= 1
        if (stickLeft > 0) {
          bombTimer = BOMB_SALVO_INTERVAL
        } else {
          bombTimer = BOMB_PERIOD
          stickLeft = load.count
        }
      }
    }
    bombs.step(dt, bombDrag, seaLevel, noImpact)
    ordnance.update(bombs)
  }

  /**
   * 拖曳中。
   *
   * 【按下在 view 上，移動與放開掛在 window 上】滑鼠拖到畫面外或拖過卷宗
   * 時，事件不會再送到 `view` —— 只掛在它身上的話，視角會在半路卡住，而且
   * 放開之後還以為使用者還按著。
   */
  let dragging = false
  function onPointerDown(): void {
    dragging = true
  }
  function onPointerMove(e: PointerEvent): void {
    if (!dragging) return
    orbit.wantYaw -= e.movementX * DRAG_RATE
    const pitch = orbit.wantPitch + e.movementY * DRAG_RATE
    orbit.wantPitch = pitch > SHOWCASE_PITCH_LIMIT ? SHOWCASE_PITCH_LIMIT
      : pitch < -SHOWCASE_PITCH_LIMIT ? -SHOWCASE_PITCH_LIMIT : pitch
  }
  function onPointerUp(): void {
    dragging = false
  }
  view.addEventListener('pointerdown', onPointerDown)
  window.addEventListener('pointermove', onPointerMove)
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', onPointerUp)

  return {
    setAircraft,

    update(frameSeconds: number, camera: PerspectiveCamera): void {
      elapsed += frameSeconds
      stepOrbit(orbit, frameSeconds, dragging)
      showcaseFlight(elapsed, rollOmega, flight)
      showcaseQuaternion(flight, quaternion)
      positions[0]!.copy(flight.position)

      if (model !== null) {
        model.group.position.copy(flight.position)
        model.group.quaternion.copy(quaternion)
        propRotation += frameSeconds * PROP_SPIN
        model.setPropSpin(propRotation, true)
      }

      if (spec !== null && spec.role === 'fighter') stepGuns(frameSeconds)
      projectiles.step(frameSeconds)
      tracers.update(projectiles)
      muzzles.update(sources, positions, quaternions)
      stepOrdnance(frameSeconds)

      showcaseCamera(flight, orbit.orbitYaw, orbit.orbitPitch, orbit.distance, CAMERA_POSE)
      camera.position.copy(CAMERA_POSE.position)
      camera.up.set(0, 1, 0)
      camera.lookAt(CAMERA_POSE.target)
      // 【先看好再平移】`translateX` 走的是相機自己的右方向，所以這一行只
      // 改位置不改朝向。半寬要用相機當下的 fov 與長寬比算，換視窗大小才跟著變
      const halfWidth = Math.tan(camera.fov * DEG * 0.5) * orbit.distance * camera.aspect
      camera.translateX(-(subjectX - 0.5) * 2 * halfWidth)
    },

    dispose(): void {
      window.removeEventListener('resize', measureStage)
      view.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('pointermove', onPointerMove)
      window.removeEventListener('pointerup', onPointerUp)
      window.removeEventListener('pointercancel', onPointerUp)
      if (model !== null) model.dispose()
      tracers.dispose()
      muzzles.dispose()
      bombVisuals.dispose()
      torpedoVisuals.dispose()
      scene.remove(group)
      group.clear()
      model = null
      spec = null
    },
  }
}
