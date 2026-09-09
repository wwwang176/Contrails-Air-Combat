import { Quaternion, Vector3 } from 'three'
import { FIRE_BLAST, emitBlast, scaleBlast, type BlastParams, type BlastPools } from './blast'
import type { Anchors } from './anchors'
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

/** 熱路徑：每朵火三團煙，不配置 */
const SMOKE_AT = new Vector3()
const ANCHOR_POS = new Vector3()
const ANCHOR_QUAT = new Quaternion()

/**
 * 做一支噴火回呼。**呼叫端在模組層建一次** —— 幀迴圈裡建閉包是每幀一次
 * 配置。
 *
 * @param pools 爆炸那一組池。`FIRE_BLAST` 只用到 `fireball` 與 `glow`
 * @param plume 煙柱的池（`createShipFireSmoke`）
 * @param scale 火球的線性尺寸倍率。1 = 燒起來的船那一級
 * @param smokeScale 煙的線性尺寸倍率，**與火球分開**。省略即跟著 `scale`。
 *                   一具引擎的火苗很小，但拖在後面的煙要遠遠看得到 ——
 *                   共用一個倍率的話，火縮到看得順眼時煙也跟著細到消失
 * @param plumeAnchors 呼叫端要用錨點時必須給。**火吸附、煙不吸附**，所以
 *                   煙的出生點要在這裡自己組回世界座標
 */
export function createFirePuff(
  pools: BlastPools, plume: Particles, scale = 1, smokeScale = scale,
  plumeAnchors?: Anchors,
): FirePuffFn {
  /** 散佈序號。爆炸配方與煙的三個抖動都吃它 */
  let seed = 0
  // 【尺寸在建的時候縮一次】`scaleBlast` 吃的是**當量**，而尺寸正比於它的
  // 立方根（`blastScale`）—— 線性倍率要先立方回去
  const recipe: { -readonly [K in keyof BlastParams]: number } = { ...FIRE_BLAST }
  if (scale !== 1) {
    scaleBlast(FIRE_BLAST, scale * scale * scale, recipe)
    // 【噴出速度也要縮】`scaleBlast` 刻意不動它 —— 爆炸相似律下噴出速度與
    // 裝藥量無關。但這一份不是爆炸，是掛在引擎上的一團火：原速每秒十一
    // 公尺、活零點八五秒會散開七公尺，而縮到四分之一的球只有一點七五公尺
    // 寬。散開量成了球徑的四倍，畫面上就是一顆顆飄在空中的球，不是燒在
    // 螺旋槳上的火
    recipe.fireSpeed = FIRE_BLAST.fireSpeed * scale
  }
  return (x, y, z, anchor = -1) => {
    // 【錨點查不到就整朵不放】火沒有錨點無處可放；而煙拿到的是還沒組回
    // 世界的區域座標 —— 一團煙會生在世界原點旁邊，燒滿它的整條壽命。
    //
    // 這條路真的會走到：殘骸入水的那一步先推火點事件，`sunk` 在同一步
    // 稍後才設，呼叫端消費事件時錨點已經沒了
    const held = anchor >= 0 && plumeAnchors !== undefined
      && plumeAnchors.frame(anchor, ANCHOR_POS, ANCHOR_QUAT)
    if (anchor >= 0 && !held) return

    // 【火吸附在錨點上】火燒在物件上，整段跟著它的位置與姿態走。給了錨點
    // 時 `x/y/z` 是那個錨點的區域座標
    emitBlast(pools, recipe, x, y, z, (seed = (seed + 1) | 0), 0, 0, 0, anchor)
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
      // 【煙**不**吸附】它離開之後就是空氣裡的一團煙，被拋在後面才會連成
      // 尾跡；跟著錨點走的話整叢煙一起平移，柱子與尾跡都不見了。船火也是
      // 這樣：噴煙的**源頭**每幀跟著艦體算，噴出去的每一團留在原地
      //
      // 【所以要自己組世界座標】`x/y/z` 在有錨點時是區域座標。錨點的變換
      // 上面查過並留在 `ANCHOR_*` 裡
      SMOKE_AT.set(x, y, z)
      if (held) SMOKE_AT.applyQuaternion(ANCHOR_QUAT).add(ANCHOR_POS)
      // 【水平擴散跟著煙的倍率，不是火的】柱子要跟著它自己的粗細長寬
      plume.emit(
        SMOKE_AT.x, SMOKE_AT.y, SMOKE_AT.z,
        Math.cos(a) * r * smokeScale, up, Math.sin(a) * r * smokeScale, smokeScale,
      )
    }
  }
}
