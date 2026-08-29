import {
  BoxGeometry, Color, DynamicDrawUsage, InstancedMesh, Matrix4,
  MeshStandardMaterial, Quaternion, Vector3,
} from 'three'
import { coneDirection, hash01 } from './scatter'
import { tumble } from './tumble'
import {
  DEBRIS_SMOKE_COUNT, DEBRIS_SMOKE_INTERVAL,
  DEBRIS_SMOKE_SECONDS_MAX, DEBRIS_SMOKE_SECONDS_MIN,
  smokePuffs, smokeTimer,
} from './smoke'
import { KILL_STRIDE, type KillEvents } from '../world/kills'
import { clearImpacts, createImpacts, pushImpact, type ImpactEvents } from '../world/events'
import type { HeightField } from '../aircraft/crash'
import type { WaterField } from './wrecks'

/**
 * 一次擊墜噴幾片。
 *
 * 【人工驗收後由 12 改成 36】在試驗場上 12 片 0.8–2.0 m 的方塊讀起來像
 * 「飛機掉了幾塊板子」而不是解體 —— 專案負責人裁決縮小五倍、數量三倍。
 * 小而多才像碎片。
 */
export const DEBRIS_COUNT = 36

/**
 * 最小／最大邊長，m。
 *
 * 【人工驗收後由 0.8–2.0 縮小五倍】原本一片碎片有機翼弦長的一半那麼大，
 * 在試驗場上與機體並排看非常突兀。現在最大的一片 0.4 m 約是機身直徑的
 * 三分之一，才是碎片該有的尺度。
 */
export const DEBRIS_SIZE_MIN = 0.16
export const DEBRIS_SIZE_MAX = 0.4

/**
 * 散射的初速，m/s。疊在母機速度之上。
 *
 * 【人工驗收後由 20 提到 40】原本讀起來不夠散。這個值直接決定碎片雲擴張
 * 得多快：40 m/s 配阻尼 0.4 s⁻¹，一秒後雲的半徑約 33 m。
 *
 * **它必須小於母機速度**，否則往後噴的碎片會真的往後跑 —— 見
 * `DEBRIS_CONE` 的說明與那條測試。
 */
export const DEBRIS_SPEED = 40

/**
 * 散射錐的半角。**等向（180°）** —— 不是錐。
 *
 * 【由 40° 改成等向】專案負責人裁決：「零件可以是 360 度噴射，只是又繼承
 * 飛機速度，所以看起來像散狀」。那正是實際發生的事 —— 一架 140 m/s 的
 * 飛機解體，40 m/s 的等向散射疊上去，**每一片的淨速度仍然朝前**，於是
 * 畫面上是一團往前擴張的碎片雲而不是往四周炸開的球。
 *
 * 【這也解釋了先前那條測不到東西的測試】舊測試斷言「零件在母機前方」，
 * 把散射錐改成等向時它照樣通過 —— 因為繼承速度本來就主導。當時那是測試
 * 的缺陷；現在它是設計本身。
 *
 * 常數留著而不是把 `coneDirection` 的呼叫拿掉：半角是這個特效的參數，
 * 寫在這裡才看得到它現在是多少。
 */
export const DEBRIS_CONE = Math.PI

/**
 * 指數阻尼，s⁻¹。終端速度 9.80665 / 0.4 = 24.5 m/s。
 *
 * 零件比殘骸輕得多，所以終端速度低得多（24.5 vs 80 m/s）—— 畫面上零件會被
 * 殘骸拋在後面，那是對的（M8 spec §7）。
 */
export const DEBRIS_DRAG = 0.4

/** 三軸角速度的上限，rad/s。±180°/s。 */
export const DEBRIS_SPIN = Math.PI

/**
 * 每一片各自的壽命範圍，s。**逐片隨機**。
 *
 * 【40 → 5 → 1.5~2】專案負責人在試驗場上一路縮短。40 s 原本是為了讓零件
 * 盡量掉到海裡才退場，但一片 0.4 m 的方塊在幾百公尺外只有一兩個像素 ——
 * 讓它飛那麼久換不到任何觀感，只是讓池子裡永遠有東西。
 *
 * 【為什麼是範圍而不是一個值】與煙的壽命抖動同一個理由：同一個壽命會讓
 * 整團碎片在同一瞬間一起消失，那比一片一片散掉明顯得多。
 *
 * 【代價：高空擊墜的零件不會濺水】阻尼終端速度 24.5 m/s，2 s 只掉約 20 m。
 * 只有低空（或本來就在俯衝、繼承了向下速度）的零件才來得及碰到海面。入水
 * 的判定、噴濺與水柱照舊，只是觸發得少了。
 */
export const DEBRIS_LIFE_MIN = 1.5
export const DEBRIS_LIFE_MAX = 2

/** 池子大小。40 架 × 36 片 = 1,440。三角形 1,440 × 12 ≈ 17,000。 */
export const DEBRIS_CAPACITY = 40 * DEBRIS_COUNT

/** 重力，m/s²。與 `physics/` 用的是同一個值。 */
const G = -9.80665

export interface Debris {
  object: InstancedMesh
  /** 目前還活著幾片。測試與 telemetry 用 */
  readonly live: number
  /**
   * 這一次 `step` 產生的冒煙位置。**每次 `step` 開頭排空** —— 呼叫端在
   * `step` 之後讀，不必自己清。
   */
  readonly smokeEvents: ImpactEvents
  /**
   * 這一次 `step` 產生的入水位置。與 `smokeEvents` 同樣的生命週期。
   *
   * 【一份事件，兩個消費者】呼叫端同時餵給噴濺池（四散的水珠）與水柱池
   * （一根小水柱）—— 兩者是同一次入水的兩個表現，位置完全相同，沒有理由
   * 存兩份。水柱的高低粗細本來就依池子的格子隨機（見 `splashSize`），
   * 所以「每一片各濺一個隨機的水花」不需要這裡再做什麼。
   */
  readonly sprayEvents: ImpactEvents
  /**
   * 依擊墜事件噴一批零件。
   *
   * @param colorOf combatant 索引 → 機身色。渲染層知道機種對應哪個塗裝，
   *                `World` 不需要知道有塗裝這回事
   */
  emit(events: KillEvents, colorOf: (index: number) => number): void
  /** 積分一幀。**在渲染幀率呼叫，不在物理步。** */
  /**
   * @param waterAt 水面高度，**沒有水的地方回 `-Infinity`**。落地與落水
   * 都會收掉零件，但只有落水才推噴濺 —— 內陸每一次墜毀都噴水是這一個
   * 參數存在的全部理由。
   */
  step(dt: number, heightAt: HeightField, waterAt: WaterField, time: number): void
  /** 全部歸零。換一場戰鬥時呼叫 —— 上一場的零件不該留在新的一場裡 */
  reset(): void
  dispose(): void
}

/** 模組私有的暫存。熱路徑：不配置。 */
const M = new Matrix4()
const POS = new Vector3()
const DIR = new Vector3()
const SCALE = new Vector3()
const ROT = new Quaternion()
const IDENTITY = new Quaternion()
const TINT = new Color()
const ZERO = new Vector3(0, 0, 0)

/**
 * 零件 —— **單一** `InstancedMesh` 的環形緩衝。
 *
 * 【為什麼是方塊而不是真的把機體切開】專案負責人裁決「同色的 BOX 模擬就好，
 * 不用太精細」。真正切開程序化機體幾何是另一個量級的工作，而在交戰距離上
 * 一片 1 m 的碎片只有幾個像素（M8 spec §15）。
 *
 * 【為什麼姿態是年齡的函數而不是每幀積分】見 `tumble` 的註解 —— 沒有漂移，
 * 而且測得起來。基準姿態取單位四元數：翻滾本來就是隨機的，一個隨機的起點
 * 疊在隨機的角速度上看不出差別，卻要多存四個陣列。
 */
export function createDebris(capacity: number = DEBRIS_CAPACITY): Debris {
  const px = new Float32Array(capacity)
  const py = new Float32Array(capacity)
  const pz = new Float32Array(capacity)
  const vx = new Float32Array(capacity)
  const vy = new Float32Array(capacity)
  const vz = new Float32Array(capacity)
  const rx = new Float32Array(capacity)
  const ry = new Float32Array(capacity)
  const rz = new Float32Array(capacity)
  const size = new Float32Array(capacity)
  const timer = new Float32Array(capacity)
  const smokes = new Uint8Array(capacity)
  /** 這一片的壽命，s。逐片隨機（`DEBRIS_LIFE_MIN`~`MAX`）。 */
  const lifeOf = new Float32Array(capacity).fill(DEBRIS_LIFE_MAX)
  /** 這一片冒煙冒到幾秒。逐片隨機，且不晚於它自己的壽命。 */
  const smokeUntil = new Float32Array(capacity)
  /**
   * 【死亡哨兵用 Infinity】每一片的壽命各不相同，判準是 `age >= lifeOf[i]`。
   * 填一個具體的值就得保證它大於任何可能的壽命，而 float32 的來回轉換可以
   * 讓一個和存成比它自己還小的值（`splash.ts` 踩過這個坑）。
   */
  const age = new Float32Array(capacity).fill(Infinity)
  let next = 0
  let live = 0

  const geometry = new BoxGeometry(1, 1, 1)
  // 【與機體同一種材質】零件是機體掉下來的，光照不一致會讓它看起來像貼紙
  const material = new MeshStandardMaterial({ flatShading: true, roughness: 0.75 })

  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  object.frustumCulled = false

  M.compose(ZERO, IDENTITY, ZERO)
  for (let i = 0; i < capacity; i++) {
    object.setMatrixAt(i, M)
    object.setColorAt(i, TINT.setRGB(1, 1, 1))
  }
  object.instanceMatrix.needsUpdate = true
  if (object.instanceColor) object.instanceColor.needsUpdate = true

  const smokeEvents = createImpacts(capacity)
  const sprayEvents = createImpacts(capacity)

  /** 讓某一格退場並縮成 0。 */
  /**
   * 這一輪有沒有真的動到矩陣。
   *
   * 【為什麼要記】`needsUpdate` 一設，three 就整條 92 KB 重傳（`updateRanges`
   * 是空的，走的是全緩衝那個分支）。而一場沒有人被打下來的仗裡，這裡一片
   * 碎片都沒有 —— 每幀白傳 92 KB。2026-08-29 實測那一下要 3.92 ms，
   * 三十秒的量測裡佔掉 13.4 秒，將近一半的幀時間。
   */
  let touched = false

  function kill(i: number): void {
    age[i] = Infinity
    M.compose(ZERO, IDENTITY, ZERO)
    object.setMatrixAt(i, M)
    touched = true
  }

  return {
    object,
    smokeEvents,
    sprayEvents,
    get live() { return live },

    emit(events: KillEvents, colorOf: (index: number) => number): void {
      const d = events.data
      const mid = (DEBRIS_SIZE_MIN + DEBRIS_SIZE_MAX) / 2
      for (let e = 0; e < events.count; e++) {
        const o = e * KILL_STRIDE
        const x = d[o]!
        const y = d[o + 1]!
        const z = d[o + 2]!
        const pvx = d[o + 3]!
        const pvy = d[o + 4]!
        const pvz = d[o + 5]!
        TINT.set(colorOf(d[o + 6]!))
        // 飛行方向：速度的單位向量。速度為零時退回 +Z，散射仍然成立
        const speed = Math.hypot(pvx, pvy, pvz)
        const fx = speed > 1e-6 ? pvx / speed : 0
        const fy = speed > 1e-6 ? pvy / speed : 0
        const fz = speed > 1e-6 ? pvz / speed : 1

        for (let k = 0; k < DEBRIS_COUNT; k++) {
          const i = next
          next = next + 1 >= capacity ? 0 : next + 1
          // 【先用舊壽命判生死，再寫新的】反過來會把一格活著的粒子誤判成
          // 原本是死的而重複計數
          if (age[i]! >= lifeOf[i]!) live++
          const seed = e * DEBRIS_COUNT + k

          // 【沿飛行方向散射】繼承母機速度，再疊一個朝前的錐 —— 一架
          // 150 m/s 的飛機解體，碎片的動量本來就還在（M8 spec §7）
          coneDirection(fx, fy, fz, DEBRIS_CONE, seed, DIR)
          px[i] = x
          py[i] = y
          pz[i] = z
          vx[i] = pvx + DIR.x * DEBRIS_SPEED
          vy[i] = pvy + DIR.y * DEBRIS_SPEED
          vz[i] = pvz + DIR.z * DEBRIS_SPEED

          rx[i] = (hash01(seed * 3) * 2 - 1) * DEBRIS_SPIN
          ry[i] = (hash01(seed * 3 + 1) * 2 - 1) * DEBRIS_SPIN
          rz[i] = (hash01(seed * 3 + 2) * 2 - 1) * DEBRIS_SPIN

          // 【前幾片是大的，而且只有它們冒煙】36 條煙會糊成一片，讀不出
          // 「零件在散開」（M8 spec §6.1）
          const big = k < DEBRIS_SMOKE_COUNT
          const h = hash01(seed * 5 + 4)
          size[i] = big
            ? mid + (DEBRIS_SIZE_MAX - mid) * h
            : DEBRIS_SIZE_MIN + (mid - DEBRIS_SIZE_MIN) * h
          smokes[i] = big ? 1 : 0
          // 壽命與停煙各取一個獨立的雜湊 —— 長命的不一定冒得久
          lifeOf[i] = DEBRIS_LIFE_MIN
            + (DEBRIS_LIFE_MAX - DEBRIS_LIFE_MIN) * hash01(seed * 7 + 5)
          smokeUntil[i] = DEBRIS_SMOKE_SECONDS_MIN
            + (DEBRIS_SMOKE_SECONDS_MAX - DEBRIS_SMOKE_SECONDS_MIN) * hash01(seed * 11 + 3)
          timer[i] = 0
          age[i] = 0
          object.setColorAt(i, TINT)
        }
      }
      if (object.instanceColor) object.instanceColor.needsUpdate = true
    },

    step(dt: number, heightAt: HeightField, waterAt: WaterField, time: number): void {
      // 【每次 step 開頭排空】呼叫端在 step 之後讀就好，不必記得清
      clearImpacts(smokeEvents)
      clearImpacts(sprayEvents)
      const damp = Math.exp(-DEBRIS_DRAG * dt)
      live = 0
      for (let i = 0; i < capacity; i++) {
        const old = age[i]!
        if (old >= lifeOf[i]!) continue
        const na = old + dt
        age[i] = na
        if (na >= lifeOf[i]!) {
          kill(i)
          continue
        }

        const nvx = vx[i]! * damp
        const nvy = vy[i]! * damp + G * dt
        const nvz = vz[i]! * damp
        vx[i] = nvx
        vy[i] = nvy
        vz[i] = nvz
        const nx = px[i]! + nvx * dt
        const ny = py[i]! + nvy * dt
        const nz = pz[i]! + nvz * dt
        px[i] = nx
        py[i] = ny
        pz[i] = nz

        // 【用中心點判定入水】一片零件最大 2 m，用中心與用角點的差距在半片
        // 零件之內。角點的解析式（`lowestPoint`）是為翼展 11 m 的翻滾整機
        // 而存在的（M8 spec §7）
        const surface = heightAt(nx, nz, time)
        if (ny <= surface) {
          // 【只有落水才噴濺】陸地上噴水柱是純內陸每一次墜毀都會發生的
          // 缺陷，群島上則是「摔在島上噴水」
          if (Number.isFinite(waterAt(nx, nz))) {
            pushImpact(sprayEvents, nx, surface, nz, 0, 1, 0)
          }
          kill(i)
          continue
        }

        live++
        // 【煙不晚於零件收】見 `DEBRIS_SMOKE_SECONDS_MIN/MAX`
        if (smokes[i] === 1 && na < smokeUntil[i]!) {
          const t = timer[i]!
          const puffs = smokePuffs(t, dt, DEBRIS_SMOKE_INTERVAL)
          timer[i] = smokeTimer(t, dt, DEBRIS_SMOKE_INTERVAL)
          for (let k = 0; k < puffs; k++) pushImpact(smokeEvents, nx, ny, nz, 0, 1, 0)
        }

        tumble(rx[i]!, ry[i]!, rz[i]!, na, IDENTITY, ROT)
        POS.set(nx, ny, nz)
        const s = size[i]!
        SCALE.set(s, s, s)
        M.compose(POS, ROT, SCALE)
        object.setMatrixAt(i, M)
        touched = true
      }
      // 【沒動過就不傳】見 `touched`
      if (touched) {
        object.instanceMatrix.needsUpdate = true
        touched = false
      }
    },

    reset(): void {
      for (let i = 0; i < capacity; i++) kill(i)
      live = 0
      next = 0
      object.instanceMatrix.needsUpdate = true
      clearImpacts(smokeEvents)
      clearImpacts(sprayEvents)
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
