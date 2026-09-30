import {
  CanvasTexture, ClampToEdgeWrapping, Group, RepeatWrapping, Vector3, type Texture,
} from 'three'
import { createWakes, type WakeStyle, type Wakes } from './wake'
import type { Ship } from '../world/ships'

/**
 * # 船的航跡
 *
 * 與魚雷同一套貼著海面的白帶（`wake.ts`），每艘船兩條：
 *
 * - **艦尾**：從艦尾拖出去、慢慢散開變淡的一長條
 * - **艦首**：從艦首落節點、幾秒就散到比船還寬 —— 節點落在船身底下，散開之後從
 *   兩舷露出來，就是船頭切開水面翻起的白浪
 *
 * 寬度照艦寬（每格的寬度倍率 = 半艦寬）。停著的船（灘頭擱淺的 LST）不落節點，
 * 所以沒有航跡；沉了的船不再落，已經落的照常淡掉。
 *
 * 全部船的艦尾共用一個網格、艦首共用一個網格：多兩次繪製。
 */

/**
 * 艦尾的航跡。半寬是**半艦寬的倍數**。**起始值，由截圖裁定。**
 *
 * 節點數要蓋得住「航速 × 壽命 ÷ 間隔」：15 m/s × 70 s ÷ 10 m = 105。
 */
export const SHIP_STERN_WAKE: WakeStyle = {
  nodes: 128, spacing: 10, life: 70, halfFrom: 0.7, halfTo: 4.0, alpha: 0.7, foamTile: 40,
}

/**
 * 艦首的白浪。半寬是半艦寬的倍數：出生時比船頭還窄（艦首是尖的，太寬的話船頭前面
 * 會露出一片白），幾秒內散到將近兩倍寬、從兩舷露出來。**起始值，由截圖裁定。**
 *
 * 節點數：15 m/s × 7 s ÷ 3 m = 35。
 */
export const SHIP_BOW_WAKE: WakeStyle = {
  nodes: 48, spacing: 3, life: 7, halfFrom: 0.2, halfTo: 2.8, alpha: 1.0, foamTile: 20,
}

/**
 * 泡沫紋理：白色，alpha 是泡沫的濃淡。橫向（u）兩邊淡出、中間濃；縱向（v，沿航向）
 * 是一條條斷斷續續的泡沫紋，縱向重複。**只在瀏覽器裡跑。**
 *
 * 【為什麼要紋理】沒有紋理的帶子是一條濃淡均勻、邊緣很硬的平帶，看起來像一條路。
 */
export function shipFoamTexture(): CanvasTexture {
  const W = 64, H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  // 一條條沿航向的泡沫紋：寬窄、長短、濃淡隨機；上下各畫一份，縱向接得起來
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const len = 10 + Math.random() * 70
    const w = 1 + Math.random() * 4
    g.fillStyle = `rgba(255,255,255,${(0.15 + Math.random() * 0.5).toFixed(3)})`
    for (const oy of [0, -H]) g.fillRect(x - w / 2, y + oy, w, len)
  }
  // 橫向的軟邊：中間濃、兩邊淡到 0
  g.globalCompositeOperation = 'destination-in'
  const edge = g.createLinearGradient(0, 0, W, 0)
  edge.addColorStop(0, 'rgba(0,0,0,0)')
  edge.addColorStop(0.3, 'rgba(0,0,0,0.9)')
  edge.addColorStop(0.5, 'rgba(0,0,0,1)')
  edge.addColorStop(0.7, 'rgba(0,0,0,0.9)')
  edge.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = edge
  g.fillRect(0, 0, W, H)
  const t = new CanvasTexture(c)
  t.wrapS = ClampToEdgeWrapping
  t.wrapT = RepeatWrapping
  return t
}

/** 航速低於它就不落節點，m/s。灘頭擱淺的 LST 是 0 */
export const SHIP_WAKE_MIN_SPEED = 0.5

/** 船的半長與半寬，m：取第一個碰撞盒（船體），艦首在 −Z */
export function shipHalfSize(ship: Ship): { halfLength: number, halfBeam: number } {
  const hull = ship.cls.hull[0]!
  return {
    halfLength: Math.abs(hull.center.z) + hull.half.z,
    halfBeam: Math.abs(hull.center.x) + hull.half.x,
  }
}

const V = /* @__PURE__ */ new Vector3()

/** 艦首（`end` = −1）或艦尾（+1）在海面上的點，寫進 `out` */
export function shipWakePoint(ship: Ship, end: -1 | 1, out: Vector3): Vector3 {
  const { halfLength } = shipHalfSize(ship)
  return out.set(0, 0, end * halfLength).applyQuaternion(ship.orientation).add(ship.position)
}

export interface ShipWakes {
  readonly object: Group
  /** 渲染幀率呼叫。`heightAt` 是浪高場，帶子跟著浪起伏 */
  step(ships: readonly Ship[], dt: number, time: number,
    heightAt: (x: number, z: number, t: number) => number): void
  dispose(): void
}

/**
 * @param foam 泡沫紋理（`shipFoamTexture`）。node 測試傳 null
 */
export function createShipWakes(ships: readonly Ship[], foam: Texture | null = null): ShipWakes {
  const slots = Math.max(1, ships.length)
  const stern: Wakes = createWakes(slots, SHIP_STERN_WAKE, foam)
  const bow: Wakes = createWakes(slots, SHIP_BOW_WAKE, foam)
  for (let k = 0; k < ships.length; k++) {
    const { halfBeam } = shipHalfSize(ships[k]!)
    stern.widen(k, halfBeam)
    bow.widen(k, halfBeam)
  }
  const object = new Group()
  object.add(stern.object, bow.object)

  return {
    object,
    step(list, dt, time, heightAt) {
      for (let k = 0; k < list.length && k < slots; k++) {
        const s = list[k]!
        if (!s.alive || !(s.speed >= SHIP_WAKE_MIN_SPEED)) continue
        shipWakePoint(s, 1, V)
        stern.emit(k, V.x, V.z, s.index)
        shipWakePoint(s, -1, V)
        bow.emit(k, V.x, V.z, s.index)
      }
      stern.step(dt, time, heightAt)
      bow.step(dt, time, heightAt)
    },
    dispose() {
      stern.dispose()
      bow.dispose()
      foam?.dispose()
    },
  }
}
