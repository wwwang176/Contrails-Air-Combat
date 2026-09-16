import { Vector3 } from 'three'
import type { Ship } from '../world/ships'
import type { GroundFires } from './groundFires'
import type { ShipFires } from './shipFires'

/**
 * # 擠在一起的火少冒一點煙
 *
 * 一次密集轟炸會在很小的一塊地上點起上百處火，而每一處都每 0.3 秒吐三顆
 * 煙、各自升到 200 m。那些煙柱在螢幕上完全重疊 —— 半透明疊加是逐像素的
 * 成本，第五層之後根本看不出差別，顯示卡卻照樣每一層都畫。
 *
 * 所以：**一處火周圍越擠，它自己的出煙間隔就拉得越長。** 周圍的火燒完了，
 * 間隔再收回來。
 *
 * 【曲線是 √(1+N) 而不是 ÷(1+N)】除以 N 會讓整團的總煙量永遠等於一處孤火
 * —— 炸平一座工廠跟點著一台卡車冒一樣多的煙。開根號仍砍掉大半，但保留
 * 「炸得越慘煙越多」：十處火一起燒，總量是單處的 3.2 倍。
 *
 * 【只看水平距離】煙柱一律往上長，兩根柱子重不重疊只由水平距離決定。用
 * 三維距離的話，同一艘船上高低差二十公尺的兩處火會被判成互不相鄰，而那
 * 正是最該互相抑制的情形。
 *
 * 【純裝飾】不參與任何判定，也不需要決定性。
 */

/** 多近算「擠在一起」，公尺（水平）。**起始值，由試飛裁定** */
export const FIRE_CROWD_RADIUS = 35

/** 多久重算一次鄰居，秒。煙的視覺變化沒那麼快，每幀算是浪費 */
export const FIRE_CROWD_RECALC = 0.25

/**
 * 因子追上目標值的時間常數，秒。
 *
 * 【為什麼不能直接跳】鄰居燒完的那一瞬間出煙量會突然變回兩倍，畫面上是
 * 「噗」的一團。慢慢收回來才看不出接縫。
 */
export const FIRE_CROWD_SMOOTH = 1

/**
 * 出煙間隔的倍率，逐火點：1 = 照原本的速率，2 = 間隔兩倍（煙少一半）。
 *
 * 【索引與火池的格子一一對應】不是「活著的第幾顆」—— 那個編號每幀都在變，
 * 對不回原本的格子。
 */
export interface FireCrowd {
  /** 現值。兩支 `step` 直接讀這兩個 */
  readonly ground: Float32Array
  readonly ship: Float32Array
  /** 重算時寫入，現值每幀往它走 */
  readonly groundTarget: Float32Array
  readonly shipTarget: Float32Array
  /** 距離下一次重算還有幾秒 */
  next: number
  /** 這一輪蒐集到的水平座標與它屬於哪一格 */
  readonly px: Float32Array
  readonly pz: Float32Array
  /** ≥ 0 = 地面火的格號；< 0 = 船火的格號取補數（`~i`） */
  readonly owner: Int32Array
  readonly count: Uint8Array
}

/** 熱路徑不配置 */
const P = /* @__PURE__ */ new Vector3()

export function createFireCrowd(ground: GroundFires, ship: ShipFires): FireCrowd {
  const total = ground.capacity + ship.capacity
  return {
    ground: new Float32Array(ground.capacity).fill(1),
    ship: new Float32Array(ship.capacity).fill(1),
    groundTarget: new Float32Array(ground.capacity).fill(1),
    shipTarget: new Float32Array(ship.capacity).fill(1),
    next: 0,
    px: new Float32Array(total),
    pz: new Float32Array(total),
    owner: new Int32Array(total),
    count: new Uint8Array(total),
  }
}

/**
 * 重算目標值並讓現值追過去。**每幀呼叫**，節流在裡面。
 *
 * 【兩組火合在一起算】同一艘船上的兩處火、岸邊的火與剛中彈的船，彼此都該
 * 互相抑制。分開算的話那些情形全部漏掉。
 *
 * @param dt 畫面時間，與兩支 `step` 吃的是同一個
 */
export function updateFireCrowd(
  crowd: FireCrowd, ground: GroundFires, ship: ShipFires, ships: readonly Ship[], dt: number,
): void {
  crowd.next -= dt
  if (crowd.next <= 0) {
    // 【掉幀時不補算】節流只是省算，補算沒有意義而且會連跑好幾輪
    crowd.next = FIRE_CROWD_RECALC
    recount(crowd, ground, ship, ships)
  }
  // 【平滑每幀都做】只在重算那一幀動的話，因子還是階梯狀的
  const k = dt >= FIRE_CROWD_SMOOTH ? 1 : dt / FIRE_CROWD_SMOOTH
  ease(crowd.ground, crowd.groundTarget, k)
  ease(crowd.ship, crowd.shipTarget, k)
}

function ease(factor: Float32Array, target: Float32Array, k: number): void {
  for (let i = 0; i < factor.length; i++) {
    const cur = factor[i]!
    factor[i] = cur + (target[i]! - cur) * k
  }
}

function recount(
  crowd: FireCrowd, ground: GroundFires, ship: ShipFires, ships: readonly Ship[],
): void {
  let n = 0

  for (let i = 0; i < ground.capacity; i++) {
    if (ground.live[i] === 0) {
      // 【熄掉的格子立刻歸 1】它會被下一處火重用，不該讓新的火繼承別人
      // 收斂到一半的因子 —— 那會讓孤零零的一處火一出生就少冒煙
      crowd.ground[i] = 1
      crowd.groundTarget[i] = 1
      continue
    }
    crowd.px[n] = ground.x[i]!
    crowd.pz[n] = ground.z[i]!
    crowd.owner[n] = i
    n++
  }

  for (let i = 0; i < ship.capacity; i++) {
    const index = ship.ship[i]!
    const s = index === -1 ? undefined : ships[index]
    if (s === undefined) {
      crowd.ship[i] = 1
      crowd.shipTarget[i] = 1
      continue
    }
    // 艦體 → 世界。**船在動**，池裡存的是艦體座標
    P.set(ship.x[i]!, ship.y[i]!, ship.z[i]!).applyQuaternion(s.orientation).add(s.position)
    crowd.px[n] = P.x
    crowd.pz[n] = P.z
    crowd.owner[n] = ~i
    n++
  }

  crowd.count.fill(0, 0, n)
  const r2 = FIRE_CROWD_RADIUS * FIRE_CROWD_RADIUS
  // 【半邊比較】一對只算一次，兩邊各加一
  for (let a = 0; a < n; a++) {
    const ax = crowd.px[a]!
    const az = crowd.pz[a]!
    for (let b = a + 1; b < n; b++) {
      const dx = crowd.px[b]! - ax
      const dz = crowd.pz[b]! - az
      if (dx * dx + dz * dz > r2) continue
      crowd.count[a]!++
      crowd.count[b]!++
    }
  }

  for (let a = 0; a < n; a++) {
    const f = Math.sqrt(1 + crowd.count[a]!)
    const o = crowd.owner[a]!
    if (o >= 0) crowd.groundTarget[o] = f
    else crowd.shipTarget[~o] = f
  }
}
