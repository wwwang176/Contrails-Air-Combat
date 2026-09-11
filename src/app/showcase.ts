import { Euler, Group, type PerspectiveCamera, Quaternion, type Scene, Vector3 } from 'three'
import { buildAircraft, type AircraftModel } from '../render/geometry/buildAircraft'
import { createTracers, type Tracers } from '../render/tracers'
import { createMuzzles, type MuzzleSource, type Muzzles } from '../render/muzzle'
import { createBombs, createTorpedoes, type BombVisuals } from '../render/bombs'
import { Bombs, BOMB_TERMINAL_SPEED, bombDragK } from '../world/bomb'
import { BOMB_SALVO_INTERVAL } from '../weapons/bomb'
import { Projectiles, PROJECTILE_LIFETIME } from '../world/Projectiles'
import { FLASH_SECONDS } from '../world/World'
import { mountDirection } from '../weapons/types'
import { LOADOUT_BY_AIRCRAFT } from '../weapons/stores'
import { DEG } from '../core/math'
import type { AircraftSpec } from '../specs/types'

/**
 * 機庫的展示場 —— 一架飛在海上的飛機，鏡頭繞著它轉。
 *
 * 【它沒有物理】飛行是一條寫死的圓，高度是一個常數，每一幀直接寫進
 * `position.y`。所以這裡不可能失速、不可能撞海，也不需要任何保護。真正
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
 * 展示高度，m。
 *
 * 【為什麼不高】海面細浪網格以相機為中心捲動，離得愈高，網格的邊就愈接近
 * 視線。300 m 時那條邊在 3.4° 俯角，落在地平線裡看不到。
 */
export const SHOWCASE_ALTITUDE = 300
/**
 * 繞行半徑，m。
 *
 * 【為什麼是繞圈而不是直線】直線飛十分鐘會離開地形資料的範圍，海面以外的
 * 東西（島、遠海接縫）就開始出現不該有的樣子。繞一個大圈永遠待在同一片
 * 海上；半徑夠大時看起來仍然是平飛。
 */
export const SHOWCASE_RADIUS = 8000
/** 展示速度，m/s。約 360 km/h —— 九台在這個高度都飛得到 */
export const SHOWCASE_SPEED = 100
/**
 * 鏡頭俯仰的上下限，rad。**它是防止相機鑽進海裡的那道界。**
 *
 * 見檔頭：飛機本身鎖死在 `SHOWCASE_ALTITUDE`，會掉下去的只有相機。
 */
export const SHOWCASE_PITCH_LIMIT = 70 * DEG
/**
 * 鏡頭距離，m。**戰鬥機一個、轟炸機一個，同一類裡不隨機種變。**
 *
 * 【為什麼不照翼展各配一個】那樣每一台都剛好塞滿畫面，於是**看不出誰大誰
 * 小** —— 零戰與地獄貓差 2.1 m 翼展，在畫面上會一樣大。固定值之下同一類
 * 裡的體型差直接讀得出來。
 *
 * 【為什麼兩類不共用一個】翼展從 9.9 m 到 31.6 m 是 3.2 倍。共用一個距離
 * 的話，要嘛戰鬥機小成一個點，要嘛 B-17 兩端都出畫面。跨類的大小本來就
 * 不是這一頁要回答的問題 —— 翼展寫在事實列裡。
 *
 * 【定值怎麼來】取該類最大的那一台（F6F-5 的 13.1 m、B-17G 的 31.6 m）
 * 乘 1.6，也就是它剛好在畫面裡留點邊。
 */
export const FIGHTER_DISTANCE = 21
export const BOMBER_DISTANCE = 50

/** 相機最遠會離飛機多遠。護欄用它掃「相機會不會鑽進海裡」 */
export const SHOWCASE_MAX_DISTANCE = BOMBER_DISTANCE

export const showcaseDistance = (role: AircraftSpec['role']): number =>
  (role === 'bomber' ? BOMBER_DISTANCE : FIGHTER_DISTANCE)

/** 展示機的姿態。角度單位 rad */
export interface FlightPose {
  readonly position: Vector3
  /** 機首方向：(−sin yaw, 0, −cos yaw)，與 `world/` 同一套約定 */
  yaw: number
  /** 正值 = 左翼下沉（轉彎那一側） */
  bank: number
  pitch: number
}

export function createFlightPose(): FlightPose {
  return { position: new Vector3(), yaw: 0, bank: 0, pitch: 0 }
}

/**
 * 協調轉彎的滾轉角，rad。`atan(v² / (r·g))`。
 *
 * 【為什麼要算它而不是直接給一個好看的角度】機身往轉彎的外側傾就是錯的，
 * 而那個錯誤在慢速繞圈時只差幾度，看不出來也說不出哪裡怪。
 */
const TURN_BANK = Math.atan((SHOWCASE_SPEED * SHOWCASE_SPEED) / (SHOWCASE_RADIUS * 9.81))
/** 呼吸用的擺動。兩個週期互質，合起來不會有明顯的節拍 */
const BANK_WOBBLE = 1.6 * DEG
const PITCH_WOBBLE = 0.7 * DEG

/**
 * 展示機這一刻在哪、什麼姿態。**純函數。**
 *
 * 【高度是常數】這一行就是「飛機不會掉進海裡」的全部實作。
 */
export function showcaseFlight(elapsed: number, out: FlightPose): void {
  const theta = (elapsed * SHOWCASE_SPEED) / SHOWCASE_RADIUS
  out.position.set(
    Math.sin(theta) * SHOWCASE_RADIUS,
    SHOWCASE_ALTITUDE,
    Math.cos(theta) * SHOWCASE_RADIUS,
  )
  // 【yaw = θ − π/2】圓上的速度方向是 (cos θ, 0, −sin θ)，而機首方向的
  // 定義是 (−sin yaw, 0, −cos yaw)；兩者相等就解出這一項。差 π/2 的話飛機
  // 會側著飛，而且因為它仍然在動，讀起來像「飄移」而不像「轉錯」。
  out.yaw = theta - Math.PI / 2
  out.bank = TURN_BANK + Math.sin(elapsed * 0.29) * BANK_WOBBLE
  out.pitch = Math.sin(elapsed * 0.17) * PITCH_WOBBLE
}

/**
 * 姿態 → 四元數。**與機首方向的約定綁在一起**（Euler 的順序是 YXZ：先滾轉、
 * 再俯仰、最後偏航），所以算繪與測試用同一支，不會各自組一份。
 */
export function showcaseQuaternion(flight: FlightPose, out: Quaternion): Quaternion {
  SCRATCH_EULER.set(flight.pitch, flight.yaw, flight.bank)
  return out.setFromEuler(SCRATCH_EULER)
}

/**
 * 鏡頭擺位。`orbitYaw` 是**相對機首**的角度 —— 拖曳轉的是視角，飛機在
 * 畫面上的朝向因此不會被它自己的轉彎慢慢帶走。
 *
 * `orbitYaw = 0` 是正後方、`π` 是正前方。
 */
export function showcaseCamera(
  flight: FlightPose, orbitYaw: number, orbitPitch: number, distance: number,
  out: { position: Vector3; target: Vector3 },
): void {
  const yaw = flight.yaw + orbitYaw
  const flat = Math.cos(orbitPitch) * distance
  out.target.copy(flight.position)
  out.position.set(
    flight.position.x + Math.sin(yaw) * flat,
    flight.position.y + Math.sin(orbitPitch) * distance,
    flight.position.z + Math.cos(yaw) * flat,
  )
}

/**
 * 主體在畫面上的水平位置，0.5 = 正中央。
 *
 * 【為什麼不是置中】左半邊是卷宗。相機看的是飛機，所以飛機預設就落在畫面
 * 正中央 —— 也就是紙的背面，整頁看起來像沒有飛機。
 *
 * 【為什麼是平移相機而不是挪注視點】挪注視點會讓相機轉一個角度，那等於
 * 偷偷改掉玩家拖出來的視角；平移是純位移，角度一格都不動。
 */
const SUBJECT_X = 0.7

/** 進場時的視角：機首左前方 40°、略高一點 */
const DEFAULT_ORBIT_YAW = Math.PI + 40 * DEG
const DEFAULT_ORBIT_PITCH = 12 * DEG
/** 拖曳靈敏度，rad/px */
const DRAG_RATE = 0.006
/**
 * 視角追上拖曳的速率，1/s。
 *
 * 【為什麼要跟丟一點】滑鼠的位移是一格一格跳的，直接寫進角度時，畫面會
 * 跟著滑鼠的抖動一起抖。追過去的寫法是 `1 - exp(-k·dt)` 而不是固定比例
 * ——固定比例在不同幀率下的手感不一樣（144 Hz 的機器會轉得比 60 Hz 快
 * 一倍多）。
 *
 * 12 /s ≈ 追到一半要 58 ms：拖起來仍然跟手，放手時會輕輕滑一下停住。
 */
const ORBIT_FOLLOW = 12

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
const SCRATCH_EULER = new Euler(0, 0, 0, 'YXZ')
const CAMERA_POSE = { position: new Vector3(), target: new Vector3() }

export interface Showcase {
  /** 換一架。舊的那一架連同它的彈都清掉 */
  setAircraft(spec: AircraftSpec): void
  /** 推進一幀並擺好相機。`camera` 會被就地改寫 */
  update(frameSeconds: number, camera: PerspectiveCamera): void
  dispose(): void
}

/**
 * @param view 吃拖曳的那一塊 DOM。展示場自己掛監聽器，也自己拆
 */
export function createShowcase(scene: Scene, view: HTMLElement): Showcase {
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
  /** 拖曳寫的是這一組，畫面上的鏡頭每幀追過去（見 `ORBIT_FOLLOW`） */
  let wantYaw = DEFAULT_ORBIT_YAW
  let wantPitch = DEFAULT_ORBIT_PITCH
  let orbitYaw = DEFAULT_ORBIT_YAW
  let orbitPitch = DEFAULT_ORBIT_PITCH
  let distance = FIGHTER_DISTANCE
  let propRotation = 0
  let burstTimer = 1.5
  let burstLeft = 0
  let bombTimer = 2
  /** 這一串還剩幾枚沒投。歸零就歇 `BOMB_PERIOD` 再排下一串 */
  let stickLeft = 0

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
    if (model !== null) {
      group.remove(model.group)
      model.dispose()
    }
    spec = next
    model = buildAircraft(next)
    group.add(model.group)
    distance = showcaseDistance(next.role)
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
    wantYaw -= e.movementX * DRAG_RATE
    const pitch = wantPitch + e.movementY * DRAG_RATE
    wantPitch = pitch > SHOWCASE_PITCH_LIMIT ? SHOWCASE_PITCH_LIMIT
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
      // 【追上拖曳】指數逼近，與幀率無關，見 `ORBIT_FOLLOW`
      const follow = 1 - Math.exp(-ORBIT_FOLLOW * frameSeconds)
      orbitYaw += (wantYaw - orbitYaw) * follow
      orbitPitch += (wantPitch - orbitPitch) * follow
      showcaseFlight(elapsed, flight)
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

      showcaseCamera(flight, orbitYaw, orbitPitch, distance, CAMERA_POSE)
      camera.position.copy(CAMERA_POSE.position)
      camera.up.set(0, 1, 0)
      camera.lookAt(CAMERA_POSE.target)
      // 【先看好再平移】`translateX` 走的是相機自己的右方向，所以這一行只
      // 改位置不改朝向。半寬要用相機當下的 fov 與長寬比算，換視窗大小才跟著變
      const halfWidth = Math.tan(camera.fov * DEG * 0.5) * distance * camera.aspect
      camera.translateX(-(SUBJECT_X - 0.5) * 2 * halfWidth)
    },

    dispose(): void {
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
