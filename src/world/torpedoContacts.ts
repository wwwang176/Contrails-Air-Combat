import { Quaternion } from 'three'
import { makeScratch } from '../core/pool'
import { NO_HIT, segmentBox, segmentPointDistanceSq } from './hit'
import { pushImpact, type ImpactEvents } from './events'
import { sinkIfDead } from './targetDeaths'
import type { Ship } from './ships'
import type { TorpedoBlockFn, TorpedoEndFn, TorpedoPointFn } from './torpedo'

interface TorpedoContactWorld {
  readonly ships: readonly Ship[]
  waterAt(x: number, z: number): number
  readonly shipHitEvents: ImpactEvents
  readonly shipKillEvents: ImpactEvents
  readonly torpedoEvents: ImpactEvents
  readonly torpedoWakeEvents: ImpactEvents
}

/** 碰撞查詢同步執行，共用暫存，不在物理步內配置。 */
const S = makeScratch(2)
const SHIP_INV = /* @__PURE__ */ new Quaternion()

/** 每個世界持有自己的最近命中；查詢後由同一枚魚雷的結束回呼消費。 */
export function createTorpedoContacts(world: TorpedoContactWorld) {
  let torpedoShip: Ship | null = null

  /**
   * 魚雷引爆。**接觸引爆：只有直接命中的那一艘扣血。**
   *
   * 【沒有範圍傷害，也不掃飛機】真實魚雷是接觸引信，而「水下
   * 爆炸炸傷了空中的飛機」講不通。所以這一支與 `applyBombBlast` 不共用。
   */
  const onTorpedoEnd: TorpedoEndFn = (x, y, z, kind, damage, team, owner) => {
    const sh = torpedoShip
    // 【同隊的船擋得住雷，但雷對它無效】船是實體，不是空氣 —— 友軍艦擋在
    // 航路上時雷撞上去就沒了。但它**不扣血、也不推爆炸事件**：畫面上不該
    // 在自家船邊長出一根水柱。
    if (kind === 1 && sh !== null && (sh.team === 'blue' ? 0 : 1) === team) return
    // 【沉船只擋，不再扣血】`sinkIfDead` 對已經沉的船本來就早退，這一行的
    // `sh.alive` 是讓意圖看得出來
    if (kind === 1 && sh !== null && sh.alive) {
      // 【推在扣血之前】沉沒事件由 `sinkIfDead` 推進另一個緩衝，兩者的
      // 先後由消費端的排空次序決定（`drainReports`），不是這裡
      pushImpact(world.shipHitEvents, x, y, z, sh.index, owner, 0)
      sh.hp -= damage
      sinkIfDead(sh, owner, world.shipKillEvents)
    }
    // 【`nz` 帶命中的那一艘，撞岸是 −1】與炸彈同一個約定，見 `onBombImpact`
    pushImpact(
      world.torpedoEvents, x, y, z, kind, damage,
      kind === 1 && sh !== null ? sh.index : -1,
    )
  }

  /**
   * 魚雷入水。**與航跡走同一個管道** —— 兩者的表現都是水面上的一叢水花。
   *
   * 【高度改讀含浪的水面】`Torpedoes` 給的 `y` 是平海的碰撞高度（那一個
   * 值要與瞄具的落點逐位元相同，護欄在 `torpedo.test.ts`）；水花要浮在
   * **看得見**的水面上。讀不到水面時退回原值 —— 那是岸邊的淺帶，兩支
   * 地形 API 在那裡的答案本來就不一致。
   */
  const onTorpedoEntry: TorpedoPointFn = (x, y, z) => {
    const w = world.waterAt(x, z)
    pushImpact(world.torpedoWakeEvents, x, Number.isFinite(w) ? w : y, z, 0, 0, 0)
  }

  const onTorpedoWake: TorpedoPointFn = (x, y, z) => {
    pushImpact(world.torpedoWakeEvents, x, y, z, 0, 0, 0)
  }

  /**
   * 魚雷這一步有沒有撞上船。**只掃船體盒，不掃砲位。**
   *
   * 【這是成本決定，不是行為差異】炸彈是面殺傷，落在砲座上與落在甲板上都
   * 算打中，所以那一支兩種盒都掃。魚雷在水面下 1 m，而砲位盒全部在甲板上
   * （Essex 最低的在 y = 14.18）—— 掃了也永遠不會命中，只是白花錢。
   * 掃與不掃在行為上等價，`torpedo-vs-ship.test.ts` 的護欄因此分不出兩者；
   * 它守的是「砲位不會被魚雷打掉」這條規則本身。
   *
   * 【比較的形狀】`NO_HIT` 是 **−1** 不是 `Infinity`，所以不能只寫
   * `t >= best`：初值 −1 會讓每一個合法的 `t ≥ 0` 都被跳過。
   */
  const onTorpedoBlocked: TorpedoBlockFn = (x0, y0, z0, x1, y1, z1) => {
    torpedoShip = null
    if (world.ships.length === 0) return NO_HIT
    let best = NO_HIT
    // 【沉船照樣擋】它不再開火、不再算勝負，但船體還浮在那裡 —— 跳過它的話
    // 雷會穿過一艘船去打後面那一艘，而畫面上看得一清二楚。
    // 同隊的船也擋（雷對它無效由 `onTorpedoEnd` 處理）
    for (const sh of world.ships) {
      if (segmentPointDistanceSq(
        x0, y0, z0, x1, y1, z1, sh.position.x, sh.position.y, sh.position.z,
      ) > sh.cls.radius * sh.cls.radius) continue

      SHIP_INV.copy(sh.orientation).conjugate()
      const a = S.v[0]!.set(x0, y0, z0).sub(sh.position).applyQuaternion(SHIP_INV)
      const b = S.v[1]!.set(x1, y1, z1).sub(sh.position).applyQuaternion(SHIP_INV)

      for (const box of sh.cls.hull) {
        const t = segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box)
        if (t === NO_HIT || (best !== NO_HIT && t >= best)) continue
        best = t
        torpedoShip = sh
      }
    }
    return best
  }

  return { end: onTorpedoEnd, entry: onTorpedoEntry, wake: onTorpedoWake, block: onTorpedoBlocked }
}
