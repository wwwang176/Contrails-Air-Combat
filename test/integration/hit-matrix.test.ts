import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { solveLead, NO_INTERCEPT } from '../../src/world/lead'
import { createHitResult, hitAircraft } from '../../src/world/hit'
import { Projectiles, PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { stepCadence } from '../../src/weapons/cadence'
import { mountDirection } from '../../src/weapons/types'
import { P51D } from '../../src/specs/p51d'
import { DEG, RAD } from '../../src/core/math'

/**
 * 【L4 命中矩陣】（spec §9.4）
 *
 * 把預瞄解、彈丸推進、命中判定三個模組**綁在一起**驗證。任何一個算錯——
 * 預瞄公式、彈丸繼承速度、機體座標轉換、匯聚幾何——都會在這裡露出來，
 * 而且看得出是哪一類組合失敗。
 *
 * 【為什麼用運動學靶機而不是完整的 Aircraft】這一條測的是**武器數學**，
 * 不是飛行模型。用解析積分的靶機，「定盤旋 10°/s」就精確是 10°/s，
 * 曲率界 R(1 − cos ωt) 才是可驗證的閉式量；換成完整 Aircraft 的話，
 * 指揮儀的追隨誤差會混進來，失敗時分不清是誰的問題。
 * 靶機跟玩家同一套物理這件事由 Task 6 的 controllers.test.ts 守。
 */
const DT = 1 / 240
const SIM_SECONDS = 2
const SHOOTER_SPEED = 200
const TURN_RATE = 10 * DEG

const BATTERY = P51D.battery
const SIGHT = BATTERY.sight
const BOXES = P51D.hitBoxes

interface Outcome {
  hits: number
  /** 最小脫靶距離（彈丸到靶機重心），m */
  miss: number
  /** 首次解出的攔截時間，s */
  firstT: number
}

/**
 * 跑一個案例。
 *
 * 射手位於原點、以 SHOOTER_SPEED 沿 −Z 前進；靶機在正前方 distance 處，
 * 速度方向與射手前方夾 aspect（0 = 尾追、180 = 迎頭）。
 *
 * 每一步：解預瞄 → 把機首轉到預瞄方向 → 依射速時鐘發射 → 推進 → 判定。
 * 「把機首對準預瞄環開火」就是這個動作的字面實作。
 */
function run(distance: number, aspectDeg: number, targetSpeed: number, omega: number): Outcome {
  const shooterPos = new Vector3(0, 0, 0)
  const shooterVel = new Vector3(0, 0, -SHOOTER_SPEED)
  const targetPos = new Vector3(0, 0, -distance)
  const th = aspectDeg * DEG
  const targetVel = new Vector3(Math.sin(th), 0, -Math.cos(th)).multiplyScalar(targetSpeed)

  const P = new Vector3()
  const V = new Vector3()
  const lead = new Vector3()
  const FWD = new Vector3(0, 0, -1)
  const shooterQ = new Quaternion()
  const targetQ = new Quaternion()
  const muzzle = new Vector3()
  const dir = new Vector3()
  const bulletVel = new Vector3()
  const s0 = new Vector3()
  const s1 = new Vector3()
  const tmp = new Vector3()

  // 【池子不用開到 4000】2 秒連射的穩態存量是 6 挺 × 13.3 發/s × 1.2 s ≈ 96。
  // 開 4000 的話 pool.step 每步空掃 4000 個槽位，64 個案例乘起來就是幾億次
  // 迴圈，整支測試會慢到沒人想跑。
  const pool = new Projectiles(512)
  const cooldowns = new Float32Array(BATTERY.mounts.length)
  const result = createHitResult()

  let hits = 0
  let miss = Infinity
  let firstT = NO_INTERCEPT

  for (let step = 0; step < SIM_SECONDS * 240; step++) {
    P.copy(targetPos).sub(shooterPos)
    V.copy(targetVel).sub(shooterVel)
    const t = solveLead(P, V, SIGHT.muzzleVelocity, lead)
    if (firstT === NO_INTERCEPT) firstT = t

    // 【開火條件與預瞄環的顯示條件是同一個】有解 且 t ≤ 彈丸壽命。
    const canFire = t !== NO_INTERCEPT && t <= PROJECTILE_LIFETIME
    if (canFire) shooterQ.setFromUnitVectors(FWD, lead)

    for (let i = 0; i < BATTERY.mounts.length; i++) {
      const mount = BATTERY.mounts[i]!
      const shots = stepCadence(cooldowns, i, mount.weapon.roundsPerMinute, canFire, DT)
      if (shots === 0) continue
      muzzle.copy(mount.position).applyQuaternion(shooterQ).add(shooterPos)
      mountDirection(BATTERY, i, dir).applyQuaternion(shooterQ)
      bulletVel.copy(dir).multiplyScalar(mount.weapon.muzzleVelocity).add(shooterVel)
      for (let n = 0; n < shots; n++) {
        pool.spawn(
          muzzle.x, muzzle.y, muzzle.z,
          bulletVel.x, bulletVel.y, bulletVel.z, mount.weapon.damage, 0,
        )
      }
    }

    // 飛機先推進，彈丸後推進（spec §4.2）
    shooterPos.addScaledVector(shooterVel, DT)
    if (omega !== 0) {
      const ca = Math.cos(omega * DT)
      const sa = Math.sin(omega * DT)
      targetVel.set(
        targetVel.x * ca + targetVel.z * sa, 0, -targetVel.x * sa + targetVel.z * ca,
      )
    }
    targetPos.addScaledVector(targetVel, DT)
    targetQ.setFromUnitVectors(FWD, tmp.copy(targetVel).normalize())

    pool.step(DT)

    for (let i = 0; i < pool.capacity; i++) {
      if (pool.owner[i] === -1) continue
      s0.set(pool.sx[i]!, pool.sy[i]!, pool.sz[i]!)
      s1.set(pool.x[i]!, pool.y[i]!, pool.z[i]!)
      miss = Math.min(miss, s1.distanceTo(targetPos))
      if (hitAircraft(BOXES, targetPos, targetQ, s0, s1, result)) {
        hits++
        pool.kill(i)
      }
    }
  }
  return { hits, miss, firstT }
}

const DISTANCES = [100, 300, 500, 750] as const
const ASPECTS = [
  ['尾追', 0], ['側方 45°', 45], ['正交 90°', 90], ['迎頭', 180],
] as const
const SPEEDS = [150, 250] as const

describe('L4-A 等速直線 —— 32 個組合全部必須命中', () => {
  for (const d of DISTANCES) {
    for (const [name, aspect] of ASPECTS) {
      for (const v of SPEEDS) {
        it(`${d} m / ${name} / ${v} m/s`, () => {
          const r = run(d, aspect, v, 0)
          expect(r.firstT).toBeGreaterThan(0)
          // spec §9.4：全部在 1.2 s 壽命內到得了
          expect(r.firstT).toBeLessThanOrEqual(PROJECTILE_LIFETIME)
          expect(r.hits).toBeGreaterThan(0)
          // 全域健全性：預瞄解若整個算錯，脫靶量會是 v·t 的量級（數十到
          // 數百公尺）。實測最差組合是 750 m 尾追 250 m/s 的 2.26 m。
          expect(r.miss).toBeLessThan(20)
        })
      }
    }
  }
})

describe('L4-B 定盤旋 10°/s', () => {
  /**
   * 【為什麼不是全部「必須命中」】預瞄解假設等速直線。目標在彈丸飛行的
   * t 秒內轉了 ω·t，於是偏離預測位置 R(1 − cos ωt)，其中 R = v/ω 是盤旋
   * 半徑。這個誤差是**模型本身的**，不是缺陷——1944 年的實戰有效射程
   * 本來就在 400 m 以內。
   *
   * 所以分兩段：轉角小（≤ 5°）時必須命中；轉角大時斷言脫靶量不超過曲率
   * 界。後者比「必須命中」更嚴格——預瞄公式或彈丸積分只要算錯，脫靶量
   * 會是 v·t 的量級（數十到數百公尺），一定超標。
   */
  const SMALL_TURN = 5 * DEG

  for (const d of DISTANCES) {
    for (const [name, aspect] of ASPECTS) {
      for (const v of SPEEDS) {
        it(`${d} m / ${name} / ${v} m/s`, () => {
          const r = run(d, aspect, v, TURN_RATE)
          expect(r.firstT).toBeGreaterThan(0)
          expect(r.firstT).toBeLessThanOrEqual(PROJECTILE_LIFETIME)

          expect(r.miss).toBeLessThan(20)

          const turned = TURN_RATE * r.firstT
          if (turned <= SMALL_TURN) {
            expect(r.hits, `轉角僅 ${(turned * RAD).toFixed(1)}°，必須命中`).toBeGreaterThan(0)
            return
          }
          const radius = v / TURN_RATE
          const curvature = radius * (1 - Math.cos(turned))
          expect(
            r.miss,
            `轉角 ${(turned * RAD).toFixed(1)}°，曲率界 ${curvature.toFixed(1)} m`,
          ).toBeLessThanOrEqual(1.5 * curvature + 1)
        })
      }
    }
  }
})

describe('L4-C 匯聚幾何', () => {
  // 全域的 20 m 脫靶上界已經逐案例寫進 L4-A 與 L4-B 了，這裡不再把整個
  // 矩陣重跑第三遍——那要多花兩倍時間換同一個結論。
  it('射手不動、目標不動時，六挺在 300 m 處打成一點', () => {
    // 匯聚幾何的獨立驗證，不經過預瞄解。
    const dir = new Vector3()
    let worst = 0
    for (let i = 0; i < BATTERY.mounts.length; i++) {
      const p = BATTERY.mounts[i]!.position
      mountDirection(BATTERY, i, dir)
      const s = BATTERY.convergence / -dir.z
      worst = Math.max(worst, Math.abs(p.x + dir.x * s))
    }
    expect(worst).toBeLessThan(0.01)
  })
})
