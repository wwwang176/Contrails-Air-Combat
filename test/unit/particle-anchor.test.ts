import { describe, it, expect } from 'vitest'
import { Matrix4, Quaternion, Vector3 } from 'three'
import { createSmoke } from '../../src/render/smoke'
import { createFireChunks } from '../../src/render/chunks'
import type { Anchors } from '../../src/render/anchors'
import type { Particles } from '../../src/render/particles'

/**
 * # 粒子吸附在會動的物件上
 *
 * 兩個池各有各的實作（圓片走 `particles.ts`、球塊走 `chunks.ts`），錨點
 * 這條路兩邊都要有 —— 火球是球塊、光暈是圓片，同一團火用到兩個池。
 *
 * 【這一支守的是什麼】三件靜靜壞掉的事：粒子沒有跟著錨點走（火飄到機翼
 * 外面）、錨點消失之後粒子還掛在最後的變換上燒完、以及沒有錨點的粒子被
 * 這條新路徑影響到（爆炸的火球本來就該自由飛）。
 */

/** 一個位置與姿態都可以現場改的錨點 */
function movable(): { at: Vector3; q: Quaternion; alive: boolean; anchors: Anchors } {
  const state = {
    at: new Vector3(),
    q: new Quaternion(),
    alive: true,
    anchors: {} as Anchors,
  }
  state.anchors = {
    frame(id, outPos, outQuat) {
      if (id !== 0 || !state.alive) return false
      outPos.copy(state.at)
      outQuat.copy(state.q)
      return true
    },
  }
  return state
}

/** 第 `i` 格實例矩陣的平移。池子不寫旋轉，只寫位置與縮放 */
function instanceAt(p: Particles, i: number): Vector3 {
  const m = new Matrix4()
  p.object.getMatrixAt(i, m)
  return new Vector3().setFromMatrixPosition(m)
}

/** 第 `i` 格的縮放。0 = 這一格是死的 */
function instanceScale(p: Particles, i: number): number {
  const m = new Matrix4()
  p.object.getMatrixAt(i, m)
  return new Vector3().setFromMatrixScale(m).x
}

const POOLS: [string, () => Particles][] = [
  ['圓片（particles.ts）', () => createSmoke()],
  ['球塊（chunks.ts）', () => createFireChunks()],
]

for (const [name, make] of POOLS) {
  describe(`${name} 的錨點`, () => {
    /**
     * 【位置存的是區域座標】存世界座標的話，錨點一動粒子就被留在原地 ——
     * 那正是「發射時繼承速度」已經做到的事，這一層要的是更多。
     */
    it('錨點平移時粒子跟著走', () => {
      const p = make()
      const a = movable()
      p.emit(0, 0, -3, 0, 0, 0, 1, 0)
      p.step(1 / 60, a.anchors)
      const first = instanceAt(p, 0)
      expect(first.z).toBeCloseTo(-3, 1)

      a.at.set(100, 200, 300)
      p.step(1 / 60, a.anchors)
      const moved = instanceAt(p, 0)
      expect(moved.x).toBeCloseTo(100, 1)
      expect(moved.y).toBeCloseTo(200, 1)
      expect(moved.z).toBeCloseTo(297, 1)
    })

    /**
     * 【姿態也要跟】只抄位置不套四元數的話，翻滾的殘骸上那團火會停在
     * 固定的方位 —— 機體轉過去了，火還在原來那一側。
     */
    it('錨點旋轉時粒子繞著它轉', () => {
      const p = make()
      const a = movable()
      p.emit(0, 0, -3, 0, 0, 0, 1, 0)
      // 繞 Y 轉 90°：區域 −Z 指向世界 −X
      a.q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      p.step(1 / 60, a.anchors)
      const at = instanceAt(p, 0)
      expect(at.x).toBeCloseTo(-3, 1)
      expect(Math.abs(at.z)).toBeLessThan(0.5)
    })

    /**
     * 【錨點不見了就收掉】不收的話殘骸被回收之後，它的火會掛在最後那個
     * 變換上燒完剩下的壽命 —— 畫面上是空中一團燒了半秒的火。
     */
    it('錨點消失時粒子當場收掉', () => {
      const p = make()
      const a = movable()
      p.emit(0, 0, -3, 0, 0, 0, 1, 0)
      p.step(1 / 60, a.anchors)
      expect(p.live).toBe(1)
      a.alive = false
      p.step(1 / 60, a.anchors)
      expect(p.live).toBe(0)
      expect(instanceScale(p, 0)).toBe(0)
    })

    /** 【速度也在區域座標裡積分】火往前噴，錨點轉過去時噴的方向跟著轉 */
    it('速度在錨點的區域座標裡積分', () => {
      const p = make()
      const a = movable()
      p.emit(0, 0, 0, 0, 0, -10, 1, 0)
      for (let i = 0; i < 6; i++) p.step(1 / 60, a.anchors)
      const straight = instanceAt(p, 0)
      expect(straight.z).toBeLessThan(-0.5)

      const q = make()
      const b = movable()
      b.q.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
      q.emit(0, 0, 0, 0, 0, -10, 1, 0)
      for (let i = 0; i < 6; i++) q.step(1 / 60, b.anchors)
      const turned = instanceAt(q, 0)
      expect(turned.x).toBeLessThan(-0.5)
      expect(Math.abs(turned.z)).toBeLessThan(0.2)
    })

    /**
     * 【沒有錨點的粒子完全不受影響】同一個池子同時裝著爆炸的火球（自由飛）
     * 與掛在殘骸上的火。省略錨點的那一路必須逐位元照舊。
     */
    it('未指定錨點的粒子照舊在世界座標飛', () => {
      const free = make()
      const withAnchors = make()
      const a = movable()
      free.emit(10, 20, 30, 1, 2, 3)
      withAnchors.emit(10, 20, 30, 1, 2, 3)
      for (let i = 0; i < 10; i++) {
        free.step(1 / 60)
        withAnchors.step(1 / 60, a.anchors)
      }
      const x = instanceAt(free, 0)
      const y = instanceAt(withAnchors, 0)
      expect(y.x).toBe(x.x)
      expect(y.y).toBe(x.y)
      expect(y.z).toBe(x.z)
    })

    /** 【重用格子時錨點要清掉】不清的話新的自由粒子會繼承上一顆的錨點 */
    it('同一格重新發射成自由粒子時不再吸附', () => {
      const p = make()
      const a = movable()
      p.emit(0, 0, -3, 0, 0, 0, 1, 0)
      p.step(1 / 60, a.anchors)
      // 繞完一圈回到第 0 格
      for (let i = 0; i < p.object.count; i++) p.emit(5, 6, 7, 0, 0, 0)
      a.at.set(1000, 0, 0)
      p.step(1 / 60, a.anchors)
      expect(instanceAt(p, 0).x).toBeCloseTo(5, 1)
    })
  })
}
