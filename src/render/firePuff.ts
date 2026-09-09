import { FIRE_BLAST, emitBlast, type BlastPools } from './blast'
import { hash01 } from './scatter'
import { SHIP_FIRE_PLUME_SPEED } from './smoke'
import type { FirePuffFn } from './shipFires'
import type { Particles } from './particles'

/**
 * # 一朵火災的迷你爆炸
 *
 * 一團小爆燃 ＋ 幾團垂直上升的煙。**燒起來的船、燒起來的建築與燒起來的
 * 飛機共用這一份配方** —— 三者看起來就該是同一種火。
 *
 * 【煙一律往上，不走錐狀噴射】`FIRE_BLAST` 的 `smokeCount` 是 0，這裡的
 * 每一團都給一個**朝上**的初速，只在水平方向抖一點寬度。
 *
 * 【柱高固定 200 m】每一處都一樣。初速由 `plumeSpeed` 從那個高度反解 ——
 * 兩者之間隔著阻尼，寫死一個看起來差不多的速度的話，改了壽命或阻尼之後
 * 就不對了。
 *
 * 【一次三團】0.3 秒一次，一團的話那是一串珠子不是一道柱子。
 */
const FIRE_SMOKE_PER_PUFF = 3
/** 水平散開的最大速度，m/s。柱子的粗細 */
const FIRE_SMOKE_SPREAD = 1.6
/** 上升速度的抖動幅度，比例。0.25 = 落在 0.75×～1.25× 之間 */
const FIRE_SMOKE_RISE_JITTER = 0.25

/**
 * 做一支噴火回呼。**呼叫端在模組層建一次** —— 幀迴圈裡建閉包是每幀一次
 * 配置。
 *
 * @param pools 爆炸那一組池。`FIRE_BLAST` 只用到 `fireball` 與 `glow`
 * @param plume 煙柱的池（`createShipFireSmoke`）
 */
export function createFirePuff(pools: BlastPools, plume: Particles): FirePuffFn {
  /** 散佈序號。爆炸配方與煙的三個抖動都吃它 */
  let seed = 0
  return (x, y, z) => {
    emitBlast(pools, FIRE_BLAST, x, y, z, (seed = (seed + 1) | 0))
    for (let k = 0; k < FIRE_SMOKE_PER_PUFF; k++) {
      // 【三個維度各自抖】方位角、半徑、上升速度全部獨立取樣。
      //
      // 只抖方位角、而且用等角度分佈（黃金角 × 序號）的話，等速上升會把
      // 連續幾朵串成一條**規則的螺旋線** —— 畫面上是兩三股麻花而不是一叢煙。
      // 半徑固定會讓它們貼在同一個圓柱面上；上升速度一致則讓同一朵的三顆
      // 永遠共面。
      const s = seed * FIRE_SMOKE_PER_PUFF + k
      const a = hash01(s * 3 + 1) * Math.PI * 2
      const r = Math.sqrt(hash01(s * 3 + 2)) * FIRE_SMOKE_SPREAD
      const up = SHIP_FIRE_PLUME_SPEED
        * (1 + (hash01(s * 3 + 3) * 2 - 1) * FIRE_SMOKE_RISE_JITTER)
      plume.emit(x, y, z, Math.cos(a) * r, up, Math.sin(a) * r, 1)
    }
  }
}
