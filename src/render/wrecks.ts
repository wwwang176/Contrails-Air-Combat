import { Quaternion, Vector3 } from 'three'
import { hash01 } from './scatter'
import { FIRE_SECONDS } from './shipFires'
import { seedWreckSpin, stepWreckSpin } from './wreckAero'
import type { Anchors } from './anchors'
import type { AircraftSpec } from '../specs/types'
import { lowestPoint } from '../world/hit'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../world/events'
import type { HitBox } from '../world/hit'
import type { HeightField } from '../aircraft/crash'

/**
 * 水面的高度，m。**沒有水的地方回 `-Infinity`。**
 *
 * 【為什麼與 `HeightField` 分家】那一支回的是「陸地與海面取 max」——
 * 拿它當「這裡是水嗎」的判準，殘骸摔在島上會噴水柱。見
 * `render/terrain.ts` 的 `waterAt`。
 */
export type WaterField = (x: number, z: number) => number
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

/**
 * 撞地之後沉多深才收掉，m。
 *
 * 【為什麼比入水淺得多】陸地上沒有殘骸的視覺，所以它只需要在撞擊的煙裡
 * 消失。25 m 會讓它在地面下滑行一段可見的時間。**真正的地面殘骸是另一份
 * 工作。**
 */
export const WRECK_GROUND_DEPTH = 3

/**
 * 引擎燃燒每幾秒一朵，s。
 *
 * 【比船火密】它同時是殘骸的拖煙來源 —— 每一朵帶三團煙（`firePuff.ts`），
 * 而殘骸每秒掉八十公尺。間隔拉大到船火那一級的話，煙變成一串分得開的
 * 圓球而不是一道尾跡。
 */
export const WRECK_FIRE_INTERVAL = 0.1

/**
 * 引擎燒幾秒，s。**與船火同一個時長**（`shipFires.ts` 的 `FIRE_SECONDS`）。
 *
 * 【為什麼要有上限】正常路徑是落海或落地就收掉（四千公尺掉到海面約
 * 五十八秒），但 `WRECK_MAX_LIFE` 那道保險是兩分鐘 —— 飄出海面網格、
 * 永遠碰不到水的那一具會在天上燒滿兩分鐘。
 */
export const WRECK_FIRE_SECONDS = FIRE_SECONDS

/**
 * 引擎火的線性尺寸倍率，相對船火。燒的是一具發動機艙，不是整艘燃燒的
 * 軍艦。呼叫端傳給 `createFirePuff`
 */
export const WRECK_FIRE_SCALE = 0.25

/**
 * 引擎火的**煙**的線性尺寸倍率，相對船火。**與火球分開**（見
 * `createFirePuff`）。
 *
 * 這是殘骸唯一的煙來源，而它要在幾公里外看得出「有一架掉下去了」——
 * 跟著火球一起縮的話那道尾跡會細到看不見。
 */
export const WRECK_FIRE_SMOKE_SCALE = 2

/** 入水時在接觸點周圍生幾根水柱。用數量換規模，`splash.ts` 不用改。 */
export const WRECK_SPLASH_COLUMNS = 10

/** 那幾根水柱的散佈半徑，m。 */
export const WRECK_SPLASH_RADIUS = 6

export interface Wrecks {
  /** 目前有幾具在場。測試與 telemetry 用 */
  readonly live: number
  /**
   * 這一次 `step` 產生的燃燒位置，**殘骸的機體座標**。**每次 `step` 開頭
   * 排空**。
   *
   * 呼叫端把每一筆餵給船火那一支噴煙回呼（`main.ts` 的 `emitFirePuff`）
   * —— 燃燒的表現只該有一份配方。**殘骸的煙也全部出自這裡**：每一朵火
   * 帶三團往上長的煙，那就是拖煙。
   *
   * 【`nx` 是錨點編號，就是這一具在池子裡的格號】火吸附在那一格上
   * （`anchors.ts`），世界座標由粒子池每一幀自己組。這一份事件沒有法線
   * 可言，那三格是現成的空位。
   */
  readonly fireEvents: ImpactEvents
  /**
   * 每一格殘骸當下的世界變換。**把它交給裝著吸附火的粒子池的 `step`。**
   *
   * 格號就是 `fireEvents` 的 `nx`。格子空了就回 `false`，掛在上面的火
   * 當場收掉。
   */
  readonly anchors: Anchors
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
   * @param spec 那架飛機的機種資料。入水判定讀 `hitBoxes`，翻滾讀慣性矩、
   *             翼面幾何與角速率阻尼（見 `wreckAero.ts`）
   * @param seed 決定翻滾方向的索引。同一個 seed 恆得同一種翻法
   */
  adopt(
    model: AircraftModel, spec: AircraftSpec,
    vx: number, vy: number, vz: number, seed: number,
  ): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步。** */
  /**
   * @param waterAt 水面高度，**沒有水的地方回 `-Infinity`**。落地與落水
   * 都會收掉殘骸，但只有落水才推水柱與噴濺。
   */
  step(dt: number, heightAt: HeightField, waterAt: WaterField, time: number): void
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

interface Slot {
  model: AircraftModel | null
  boxes: readonly HitBox[]
  spec: AircraftSpec | null
  /** 姿態。**逐幀積分，不是年齡的純函數** —— 轉速自己找平衡 */
  quat: Quaternion
  vx: number; vy: number; vz: number
  /** 角速度，機體座標，rad/s */
  spin: Vector3
  /**
   * 燒的是第幾具引擎。**接管時挑一次，之後不換** —— 每一朵各挑一具的話
   * 火會在機翼之間跳。`−1` = 這個模型沒有引擎點
   */
  engine: number
  /** 距離下一朵火還有幾秒 */
  fire: number
  age: number
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
      model: null, boxes: [], spec: null, quat: new Quaternion(),
      vx: 0, vy: 0, vz: 0, spin: new Vector3(),
      engine: -1, fire: 0,
      age: 0, sunk: false, hideY: -Infinity,
    })
  }
  let next = 0
  let live = 0

  // 【一步一具最多一朵】容量給參戰架數就夠
  const fireEvents = createImpacts(capacity)
  const sprayEvents = createImpacts(capacity)
  const splashEvents = createImpacts(capacity * WRECK_SPLASH_COLUMNS)

  function free(s: Slot): void {
    const m = s.model
    s.model = null
    if (m) release(m)
  }

  return {
    fireEvents,
    anchors: {
      frame(id, outPos, outQuat) {
        const s = slots[id]
        // 【沉下去的也算不在了】水面不透明，火在水下燒完剩下的壽命只是
        // 白費池子
        if (s === undefined || s.model === null || s.sunk) return false
        outPos.copy(s.model.group.position)
        outQuat.copy(s.quat)
        return true
      },
    },
    sprayEvents,
    splashEvents,
    get live() { return live },

    adopt(model, spec, vx, vy, vz, seed): void {
      const s = slots[next]!
      next = next + 1 >= capacity ? 0 : next + 1
      // 【滿了就回收最舊的】容量等於參戰架數，所以這在一場戰鬥之內不會發生；
      // 但若真的發生，覆蓋最舊的比拒絕新的好 —— 剛被打爆的那一架才是玩家
      // 正在看的。
      if (s.model) free(s)

      s.model = model
      s.boxes = spec.hitBoxes
      s.spec = spec
      s.quat.copy(model.group.quaternion)
      s.vx = vx
      s.vy = vy
      s.vz = vz
      // 【爆炸那一下的角衝量】大小以這個尺寸機體的平衡轉速為尺度，所以
      // 轟炸機被踢得比戰鬥機慢 —— 見 `wreckAero.ts`
      seedWreckSpin(spec, Math.hypot(vx, vy, vz), seed, s.spin)
      // 【多發機隨機挑一具，之後不換】用與翻滾不同的雜湊段，否則兩者
      // 在同一個種子上相關 —— 往同一邊翻的殘骸永遠燒同一邊的引擎
      const engines = model.enginePoints.length
      s.engine = engines === 0 ? -1 : Math.min(engines - 1, Math.floor(hash01(seed * 3 + 7919) * engines))
      // 【第一朵立刻放】與船火同一個做法：爆炸那一刻就看得到火
      s.fire = 0
      s.age = 0
      s.sunk = false
      s.hideY = -Infinity
      // 陣亡那一幀 main.ts 可能已經把它藏起來了
      model.group.visible = true
      // 【螺旋槳停轉】失去動力的飛機槳是停的。切回葉片（不是模糊圓盤），
      // 之後 step 不再動它。
      model.setPropSpin(0, false)
    },

    step(dt: number, heightAt: HeightField, waterAt: WaterField, time: number): void {
      clearImpacts(fireEvents)
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

        // 【角向走氣動，平移不變】失去操縱與動力的機體怎麼翻，由慣性矩、
        // 翼面幾何與角速率阻尼決定 —— B-17 因此翻得比 Bf 109 慢得多
        stepWreckSpin(s.spec!, s.vx, s.vy, s.vz, g.position.y, s.quat, s.spin, dt)
        g.quaternion.copy(s.quat)

        // 【引擎在燒】火點是引擎在**世界座標**的位置，每一步從機體座標轉
        // 過來 —— 存世界座標放著不動的話，火會留在爆炸那一點而殘骸掉下去。
        // 【沉下去就不放】水面不透明，那一段沒有觀察者。殘骸被回收時
        // 這一格連同整個 slot 一起沒了，所以「飛機不見火也不見」是免費的
        if (s.engine >= 0 && !s.sunk && s.age < WRECK_FIRE_SECONDS) {
          let t = s.fire - dt
          if (t <= 0) {
            // 【一步只放一朵】掉幀時補放沒有意義 —— 同一個位置疊三朵只是
            // 一團更亮的火。理由同 `stepShipFires`
            do { t += WRECK_FIRE_INTERVAL } while (t <= 0)
            // 【推的是機體座標與格號，不是世界座標】火吸附在這一格上
            // （`anchors.ts`），每一幀由殘骸當下的變換組回世界
            const e = model.enginePoints[s.engine]!
            pushImpact(fireEvents, e.x, e.y, e.z, i, 0, 0)
          }
          s.fire = t
        }

        if (s.sunk) {
          // 【水下不模擬】運動完全不變 —— 海面不透明，這段沒有觀察者，
          // 為它寫水阻力是純粹的浪費（M8 spec §9.3）
          if (g.position.y < s.hideY) free(s)
          else live++
          continue
        }

        live++

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
        // 【落地與落水收得一樣快，但只有落水噴水】陸地上沒有殘骸的視覺，
        // 所以照樣往下沉、只是沉得淺 —— 讀起來是「撞地之後在煙裡不見了」。
        // 真正的地面殘骸是另一份工作
        const onWater = Number.isFinite(waterAt(BEST.x, BEST.z))
        s.hideY = surface - (onWater ? WRECK_SINK_DEPTH : WRECK_GROUND_DEPTH)
        if (!onWater) continue
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
      clearImpacts(fireEvents)
      clearImpacts(sprayEvents)
      clearImpacts(splashEvents)
    },

    dispose(): void {
      for (const s of slots) free(s)
      live = 0
    },
  }
}
