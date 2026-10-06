import { hash01 } from '../../core/hash'
import type { Particles } from '../../render/particles'

/**
 * 短片裡受損拖的煙，相對殘骸煙池（`wreckFireSmoke`）的出生尺寸。
 *
 * 【走殘骸那一池，不走通用煙池】通用的那一份是 2.5 秒的實心軟圓，一路拖出來是
 * 一串分開的黑球；殘骸那一份有煙的貼圖與受光、活 20 秒、慢慢散開 —— 拖出來是
 * 一條連著的煙，與殘骸墜落時那一條是同一種東西
 */
const REEL_SMOKE_SIZE = 0.32

/**
 * 短片拖煙：蜿蜒的外飄速度幅度、每團各自的小亂數（m/s）、大小的相對抖動。
 * 煙本來就細，幅度一大整條就散掉、不連貫
 */
const REEL_SMOKE_WANDER = 0.84
const REEL_SMOKE_JITTER = 0.4
const REEL_SMOKE_SIZE_JITTER = 0.35

/** 每個放映機持有自己的發射序列；換分鏡時仍延續序號。 */
export function createReelSmoke(pool: Pick<Particles, 'emit'>) {
  let reelSmokeSeed = 0
  return function smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number): void {
    // 【平順地蜿蜒，不是各自亂飄】外飄速度由出生位置決定（幾條不同波長的正弦），
    // 相鄰兩團幾乎一樣 —— 整條煙緩緩彎曲但仍連成一條。不加的話直飛的飛機把煙排成
    // 一條筆直的管子；每團各自亂數的話又散成一片、讀不出是一條煙
    const wx = Math.sin(x * 0.031 + z * 0.017) + 0.5 * Math.sin(y * 0.043 + x * 0.011)
    const wy = Math.sin(z * 0.027 - x * 0.019) + 0.5 * Math.sin(x * 0.047 + y * 0.013)
    const wz = Math.sin(y * 0.029 + z * 0.023)
    const s = (reelSmokeSeed = (reelSmokeSeed + 1) | 0)
    const j = REEL_SMOKE_JITTER
    const size = REEL_SMOKE_SIZE * (1 + (hash01(s * 5 + 4) * 2 - 1) * REEL_SMOKE_SIZE_JITTER)
    pool.emit(x, y, z,
      vx + REEL_SMOKE_WANDER * wx + (hash01(s * 5 + 1) * 2 - 1) * j,
      vy + REEL_SMOKE_WANDER * wy + (hash01(s * 5 + 2) * 2 - 1) * j,
      vz + REEL_SMOKE_WANDER * wz + (hash01(s * 5 + 3) * 2 - 1) * j, size)
  }
}
