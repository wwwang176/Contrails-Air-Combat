import { Quaternion, Vector3 } from 'three'
import { hash01 } from './scatter'
import { tumble } from './tumble'
import { WRECK_SMOKE_INTERVAL, WRECK_SMOKE_SECONDS, smokePuffs, smokeTimer } from './smoke'
import { lowestPoint } from '../world/hit'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../world/events'
import type { HitBox } from '../world/hit'
import type { HeightField } from '../aircraft/crash'
import type { AircraftModel } from './geometry/buildAircraft'

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
const G = -9.80665

/** 終端速度，m/s。一具翻滾的機體大約掉這麼快。 */
export const WRECK_TERMINAL = 80

/**
 * 指數阻尼，s⁻¹。**由終端速度反推**：線性阻尼下 `v_term = g / k`。
 *
 * 時間常數 `1 / 0.1226 = 8.2 s` —— 水平速度也在這個尺度上散掉，所以一具
 * 150 m/s 的殘骸會往前飄約 1.2 km 才轉為近乎垂直。從 4,000 m 掉到海面
 * 約 58 s（M8 spec §8.2）。
 */
export const WRECK_DRAG = -G / WRECK_TERMINAL

/** 三軸角速度的上限，rad/s。±120°/s。 */
export const WRECK_SPIN = (120 * Math.PI) / 180

/**
 * 壽命上限，s。
 *
 * 正常路徑（掉到海裡再沉 25 m）約 60 s，所以這條只在異常情形觸發 —— 例如
 * 殘骸飄出海面網格（10 km 見方，`ocean.ts:39`）之外，永遠碰不到水。它是
 * 一道保險，不是主要路徑（M8 spec §8.3）。
 */
export const WRECK_MAX_LIFE = 120

/**
 * 沉到接觸點下方多深就回收，m。
 *
 * 25 m 是最大包圍球半徑 7.1 m 的三倍多 —— 即使殘骸以最不利的姿態翻滾，
 * 也早已整具沒入。海面不透明，所以這段完全看不見（M8 spec §9.3）。
 */
export const WRECK_SINK_DEPTH = 25

/** 入水時在接觸點周圍生幾根水柱。用數量換規模，`splash.ts` 不用改。 */
export const WRECK_SPLASH_COLUMNS = 10

/** 那幾根水柱的散佈半徑，m。 */
export const WRECK_SPLASH_RADIUS = 6

export interface Wrecks {
  /** 目前有幾具在場。測試與 telemetry 用 */
  readonly live: number
  /** 這一次 `step` 產生的冒煙位置。**每次 `step` 開頭排空** */
  readonly smokeEvents: ImpactEvents
  /** 這一次 `step` 產生的入水噴濺。同樣的生命週期 */
  readonly sprayEvents: ImpactEvents
  /** 這一次 `step` 產生的水柱位置。同樣的生命週期 */
  readonly splashEvents: ImpactEvents
  /**
   * 接管一架飛機的模型，讓它變成殘骸。
   *
   * **初始位置與旋轉直接讀 `model.group`** —— 那是內插後的姿態。用擊墜事件
   * 裡的子步位置會讓殘骸在誕生的那一幀跳最多 0.83 m（M8 spec §3.1）。
   *
   * @param boxes 那架飛機的 `spec.hitBoxes`，入水判定用
   * @param seed  決定翻滾方向的索引。同一個 seed 恆得同一種翻法
   */
  adopt(
    model: AircraftModel, boxes: readonly HitBox[],
    vx: number, vy: number, vz: number, seed: number,
  ): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步。** */
  step(dt: number, heightAt: HeightField, time: number): void
  /**
   * 全部歸零，**每一具模型都還給建構時傳入的回收回呼**。換一場戰鬥時呼叫。
   *
   * 【為什麼它比其他池子的 reset 重要】這個池子**持有**上一場的模型。
   * 不歸零就是每換一場洩漏一批（M10 spec §5.5）。
   */
  reset(): void
  dispose(): void
}

/** 模組私有的暫存。每幀每具殘骸重用：不配置。 */
const LOWEST = new Vector3()
const BEST = new Vector3()
const ROT = new Quaternion()

interface Slot {
  model: AircraftModel | null
  boxes: readonly HitBox[]
  base: Quaternion
  vx: number; vy: number; vz: number
  rx: number; ry: number; rz: number
  age: number
  timer: number
  sunk: boolean
  hideY: number
}

/**
 * 殘骸池。
 *
 * 【為什麼不新建幾何】它**接管**那架飛機既有的 `AircraftModel` —— 模型在
 * 它活著時已經在畫，變成殘骸只是換一個東西寫它的 `position` 與
 * `quaternion`。**渲染成本等於它活著時的成本，沒有增加**（M8 spec §8.1）。
 *
 * 【為什麼用物件陣列而不是平行的 typed array】容量是參戰架數（40），而且
 * 每一格要存一個模型參考與一組 hitBox 參考 —— 那本來就不是數字。四十個
 * 物件不是熱路徑。
 *
 * @param release 模型不再需要時的回收回呼。`main.ts` 用它把 group 移出
 *                場景並 `dispose()` —— 殘骸池不該知道有場景這回事
 */
export function createWrecks(
  capacity: number, release: (model: AircraftModel) => void,
): Wrecks {
  const slots: Slot[] = []
  for (let i = 0; i < capacity; i++) {
    slots.push({
      model: null, boxes: [], base: new Quaternion(),
      vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0,
      age: 0, timer: 0, sunk: false, hideY: -Infinity,
    })
  }
  let next = 0
  let live = 0

  const smokeEvents = createImpacts(capacity * 8)
  const sprayEvents = createImpacts(capacity)
  const splashEvents = createImpacts(capacity * WRECK_SPLASH_COLUMNS)

  function free(s: Slot): void {
    const m = s.model
    s.model = null
    if (m) release(m)
  }

  return {
    smokeEvents,
    sprayEvents,
    splashEvents,
    get live() { return live },

    adopt(model, boxes, vx, vy, vz, seed): void {
      const s = slots[next]!
      next = next + 1 >= capacity ? 0 : next + 1
      // 【滿了就回收最舊的】容量等於參戰架數，所以這在一場戰鬥之內不會發生；
      // 但若真的發生，覆蓋最舊的比拒絕新的好 —— 剛被打爆的那一架才是玩家
      // 正在看的。
      if (s.model) free(s)

      s.model = model
      s.boxes = boxes
      s.base.copy(model.group.quaternion)
      s.vx = vx
      s.vy = vy
      s.vz = vz
      s.rx = (hash01(seed * 3) * 2 - 1) * WRECK_SPIN
      s.ry = (hash01(seed * 3 + 1) * 2 - 1) * WRECK_SPIN
      s.rz = (hash01(seed * 3 + 2) * 2 - 1) * WRECK_SPIN
      s.age = 0
      s.timer = 0
      s.sunk = false
      s.hideY = -Infinity
      // 陣亡那一幀 main.ts 可能已經把它藏起來了
      model.group.visible = true
      // 【螺旋槳停轉】失去動力的飛機槳是停的。切回葉片（不是模糊圓盤），
      // 之後 step 不再動它。
      model.setPropSpin(0, false)
    },

    step(dt: number, heightAt: HeightField, time: number): void {
      clearImpacts(smokeEvents)
      clearImpacts(sprayEvents)
      clearImpacts(splashEvents)
      const damp = Math.exp(-WRECK_DRAG * dt)
      live = 0

      for (let i = 0; i < capacity; i++) {
        const s = slots[i]!
        const model = s.model
        if (!model) continue

        s.age += dt
        if (s.age >= WRECK_MAX_LIFE) {
          free(s)
          continue
        }

        s.vx *= damp
        s.vy = s.vy * damp + G * dt
        s.vz *= damp
        const g = model.group
        g.position.x += s.vx * dt
        g.position.y += s.vy * dt
        g.position.z += s.vz * dt

        tumble(s.rx, s.ry, s.rz, s.age, s.base, ROT)
        g.quaternion.copy(ROT)

        if (s.sunk) {
          // 【水下不模擬】運動完全不變 —— 海面不透明，這段沒有觀察者，
          // 為它寫水阻力是純粹的浪費（M8 spec §9.3）
          if (g.position.y < s.hideY) free(s)
          else live++
          continue
        }

        live++

        // 【冒煙只在水面上】沉下去之後看不見，繼續發射只是白費池子
        //
        // 【而且只在前 WRECK_SMOKE_SECONDS 秒】殘骸活 120 s、從 4,000 m
        // 掉到海面要三十秒以上 —— 整段都冒的話天空最後會被一堆看不到頭的
        // 煙柱塞滿，那已經不是「剛剛有人被打下來」的訊號了
        if (s.age < WRECK_SMOKE_SECONDS) {
          const puffs = smokePuffs(s.timer, dt, WRECK_SMOKE_INTERVAL)
          s.timer = smokeTimer(s.timer, dt, WRECK_SMOKE_INTERVAL)
          for (let k = 0; k < puffs; k++) {
            pushImpact(smokeEvents, g.position.x, g.position.y, g.position.z, 0, 1, 0)
          }
        }

        // 【入水判定用 hitBox 的角點】殘骸是翻滾的，翼尖會比重心早很多碰到
        // 水；用重心判定會讓水花晚一整個翼展才出現（M8 spec §9.1）
        let lowY = Infinity
        for (const box of s.boxes) {
          const y = lowestPoint(box, g.quaternion, g.position, LOWEST)
          if (y < lowY) {
            lowY = y
            BEST.copy(LOWEST)
          }
        }
        // 浪高在最低角點的水平位置取樣 —— 海面振幅 ±2.15 m，在機身尺度上
        // 是有差別的
        const surface = heightAt(BEST.x, BEST.z, time)
        if (lowY > surface) continue

        s.sunk = true
        s.hideY = surface - WRECK_SINK_DEPTH
        pushImpact(sprayEvents, BEST.x, surface, BEST.z, 0, 1, 0)
        for (let k = 0; k < WRECK_SPLASH_COLUMNS; k++) {
          const a = hash01(i * 64 + k * 2) * Math.PI * 2
          const r = Math.sqrt(hash01(i * 64 + k * 2 + 1)) * WRECK_SPLASH_RADIUS
          pushImpact(
            splashEvents,
            BEST.x + Math.cos(a) * r, surface, BEST.z + Math.sin(a) * r,
            0, 1, 0,
          )
        }
      }
    },

    reset(): void {
      // 【一定要走 free 而不是把 model 設成 null】`free` 會呼叫建構時傳入的
      // 回收回呼，那是模型被移出場景並釋放的唯一途徑
      for (let i = 0; i < capacity; i++) free(slots[i]!)
      next = 0
      live = 0
      clearImpacts(smokeEvents)
      clearImpacts(sprayEvents)
      clearImpacts(splashEvents)
    },

    dispose(): void {
      for (const s of slots) free(s)
      live = 0
    },
  }
}
