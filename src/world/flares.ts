/**
 * # 照明彈 —— 傘降、慢慢搖著下來、燒五分鐘
 *
 * SoA 池，**永遠不配置**。它在 `World.step` 裡推進，所以逐位元重播含它；
 * 現在沒有任何判定讀它，渲染層讀位置與年齡畫光。
 *
 * 【為什麼放世界層而不是渲染層】之後若要「被照到的飛機防空砲散布縮小」，
 * 判定要讀它 —— 那時它必須已經是決定性的、在物理步裡的東西。
 */
export const FLARE_CAPACITY = 16
/** 下墜速率，m/s。傘降照明彈的量級 */
export const FLARE_DESCENT = 2.5
/** 燃燒秒數。LC 50 是 5 到 6 分鐘 */
export const FLARE_BURN = 300
/** 橫向搖晃的振幅，m，與週期，s */
export const FLARE_SWAY = 3
export const FLARE_SWAY_PERIOD = 6

export interface Flares {
  readonly capacity: number
  /** 這一步的位置（已含搖晃）。搖晃是相對 `ox`／`oz` 算的，不累積誤差 */
  readonly x: Float32Array
  readonly y: Float32Array
  readonly z: Float32Array
  /** 生成點：搖晃繞著 `ox`／`oz` 擺，高度從 `oy` 算 */
  readonly ox: Float32Array
  readonly oy: Float32Array
  readonly oz: Float32Array
  /**
   * 已燒幾秒。**float64** —— 1/240 用 float32 累加五分鐘，誤差會讓熄滅提早
   * 好幾步、高度偏掉半公尺；位置全部由它絕對算，不做逐步積分
   */
  readonly age: Float64Array
  /** 搖晃的相位，rad。生成時給，之後不變 */
  readonly phase: Float32Array
  /** 1 = 亮著 */
  readonly live: Uint8Array
  /** 亮著的枚數 */
  count: number
}

export function createFlares(capacity: number = FLARE_CAPACITY): Flares {
  const f = (): Float32Array => new Float32Array(capacity)
  return {
    capacity, x: f(), y: f(), z: f(), ox: f(), oy: f(), oz: f(),
    age: new Float64Array(capacity), phase: f(),
    live: new Uint8Array(capacity), count: 0,
  }
}

/** 點一枚。回槽位；**滿了回 −1**（與高砲彈同一條規則：滿了代表別處出錯） */
export function spawnFlare(f: Flares, x: number, y: number, z: number, phase: number): number {
  for (let i = 0; i < f.capacity; i++) {
    if (f.live[i] !== 0) continue
    f.x[i] = x; f.y[i] = y; f.z[i] = z
    f.ox[i] = x; f.oy[i] = y; f.oz[i] = z
    f.age[i] = 0
    f.phase[i] = phase
    f.live[i] = 1
    f.count++
    return i
  }
  return -1
}

const TWO_PI = Math.PI * 2

/**
 * 推進一步。位置全部是年齡的函數（下墜是線性、搖晃是正弦），不做逐步積分
 * —— 240 Hz 積分五分鐘會漂。燒滿或落到地面就熄。
 */
export function stepFlares(f: Flares, dt: number, groundAt: (x: number, z: number) => number): void {
  for (let i = 0; i < f.capacity; i++) {
    if (f.live[i] === 0) continue
    const age = f.age[i]! + dt
    f.age[i] = age
    const y = f.oy[i]! - FLARE_DESCENT * age
    f.y[i] = y
    const t = age * (TWO_PI / FLARE_SWAY_PERIOD) + f.phase[i]!
    f.x[i] = f.ox[i]! + FLARE_SWAY * Math.sin(t)
    f.z[i] = f.oz[i]! + FLARE_SWAY * Math.sin(t * 0.7 + 1.3)
    if (age >= FLARE_BURN || y <= groundAt(f.x[i]!, f.z[i]!)) {
      f.live[i] = 0
      f.count--
    }
  }
}

export function clearFlares(f: Flares): void {
  f.live.fill(0)
  f.count = 0
}
