import { describe, it, expect } from 'vitest'
import { Mesh, Vector3 } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { HIT_PARTS, segmentBox } from '../../src/world/hit'
import { mountDirection } from '../../src/weapons/types'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * 【幾何一致性測試】（spec §7.2）
 *
 * 這是 M1 那條「機翼四分之一弦線必須壓在原點」的同一個模式：外型改了而
 * 命中盒沒跟上，測試會紅。沒有這條，兩份資料會靜靜地分岔，而且只會在玩家
 * 抱怨「明明打中了卻沒扣血」時才被發現。
 *
 * 【為什麼是「聯集覆蓋」而不是「每個盒包住對應 mesh」】機身是**一個** mesh，
 * 從機首一路到機尾——座艙、引擎、尾翼都是它的一段，沒有「對應的 mesh」
 * 可以逐一比對。改成三條合起來等價、而且不會循環論證的斷言：
 *
 *   1. 每個頂點都落在至少一個盒內（不能有打不到的地方）
 *   2. 每個盒都至少含一個頂點（不能有空盒）
 *   3. 六個盒的體積總和 < 整機包圍盒體積（不能拿六個巨盒交差）
 *
 * 【螺旋槳排除在外】槳葉與模糊圓盤掃出的是一個半徑 1.7 m 的圓面，把它
 * 包起來要一個 3.4 × 3.4 m 的盒子擋在機首前方——那不是命中面，是動畫。
 * 它們在 assembly.ts 標了 userData.spinning。
 */
const CASES: readonly AircraftSpec[] = [P51D, BF109G6]

interface Sample {
  verts: Vector3[]
  bboxVolume: number
}

function sample(spec: AircraftSpec): Sample {
  const m = buildAircraft(spec)
  m.group.updateMatrixWorld(true)
  const verts: Vector3[] = []
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity
  m.group.traverse((o) => {
    if (o.userData['spinning']) return
    const p = (o as Mesh).geometry?.getAttribute?.('position')
    if (!p) return
    for (let i = 0; i < p.count; i++) {
      const v = new Vector3(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
      verts.push(v)
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x)
      y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y)
      z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z)
    }
  })
  m.dispose()
  return { verts, bboxVolume: (x1 - x0) * (y1 - y0) * (z1 - z0) }
}

const inside = (v: Vector3, b: { center: Vector3; half: Vector3 }): boolean =>
  Math.abs(v.x - b.center.x) <= b.half.x
  && Math.abs(v.y - b.center.y) <= b.half.y
  && Math.abs(v.z - b.center.z) <= b.half.z

describe('命中盒與外型的一致性', () => {
  for (const spec of CASES) {
    describe(spec.name, () => {
      it('六個部位齊全且不重複', () => {
        const parts = spec.hitBoxes.map((b) => b.part).sort()
        expect(parts).toEqual([...HIT_PARTS].sort())
      })

      it('每個頂點都落在至少一個命中盒內', () => {
        const { verts } = sample(spec)
        const missed = verts.filter((v) => !spec.hitBoxes.some((b) => inside(v, b)))
        // 失敗時把前幾個漏網的座標印出來——直接就是該調哪個盒的哪一面
        expect(missed.slice(0, 5).map((v) => v.toArray())).toEqual([])
        expect(missed).toHaveLength(0)
      })

      it('每個命中盒都至少含一個頂點（沒有空盒）', () => {
        const { verts } = sample(spec)
        for (const b of spec.hitBoxes) {
          expect(verts.some((v) => inside(v, b)), `${b.part} 是空盒`).toBe(true)
        }
      })

      it('六個盒的體積總和小於整機包圍盒（不能用巨盒交差）', () => {
        const { bboxVolume } = sample(spec)
        const sum = spec.hitBoxes.reduce(
          (a, b) => a + 8 * b.half.x * b.half.y * b.half.z, 0)
        expect(sum).toBeLessThan(bboxVolume)
      })

      it('左右翼盒左右對稱', () => {
        const l = spec.hitBoxes.find((b) => b.part === 'wingLeft')!
        const r = spec.hitBoxes.find((b) => b.part === 'wingRight')!
        expect(l.center.x).toBeCloseTo(-r.center.x, 9)
        expect(l.center.y).toBeCloseTo(r.center.y, 9)
        expect(l.center.z).toBeCloseTo(r.center.z, 9)
        expect(l.half.toArray()).toEqual(r.half.toArray())
      })

      it('每個槍口都長在自己的機體上（落在至少一個命中盒內）', () => {
        // 槍口位置與命中盒是兩份各自量出來的資料。這一條讓「機翼改了而
        // 槍口沒跟上」不會變成「子彈從機翼外面憑空冒出來」。
        for (const mount of spec.battery.mounts) {
          expect(
            spec.hitBoxes.some((b) => inside(mount.position, b)),
            `槍口 ${mount.weapon.id} @ ${mount.position.toArray()} 不在任何命中盒內`,
          ).toBe(true)
        }
      })

      it('槍口的射線不會打到自己的機身、座艙或尾翼', () => {
        // 從槍口沿射向走 12 m（遠超過機身全長），不得**進入**機身類的盒子。
        // 起點就在盒內（軸心武裝本來就裝在引擎裡）不算，那是槍座的位置。
        // 缺陷情境：翼槍站位訂得太靠內，子彈一出膛就打在自己機首上。
        const dir = new Vector3()
        for (let i = 0; i < spec.battery.mounts.length; i++) {
          const p = spec.battery.mounts[i]!.position
          mountDirection(spec.battery, i, dir)
          const end = p.clone().addScaledVector(dir, 12)
          for (const box of spec.hitBoxes) {
            if (box.part === 'wingLeft' || box.part === 'wingRight') continue
            const t = segmentBox(p.x, p.y, p.z, end.x, end.y, end.z, box)
            expect(t, `${spec.id} 掛架 ${i} 會打到自己的 ${box.part}`).toBeLessThanOrEqual(0)
          }
        }
      })
    })
  }
})

describe('AircraftSpec 的新欄位', () => {
  it('戰鬥機 HP 為 1000（spec §6.3）', () => {
    for (const spec of CASES) expect(spec.hp).toBe(1000)
  })

  it('TTK 對得上 spec §6.3 的表（P-51 0.69 s、109 0.53 s）', () => {
    // HP / DPS，全中機身（倍率 1.0）。
    //
    // 【2026-08-09：三個單發傷害一律 ×3】專案負責人的調參決定，TTK 因此
    // 由 2.08 / 1.60 s 縮到約三分之一。**精度沒有放寬** —— 還是 2 位小數
    // （原本寫 1 位，那對 0.69 與 0.53 太鬆，兩者只差 0.16）。
    const ttk = (s: AircraftSpec): number =>
      s.hp / s.battery.mounts.reduce(
        (a, m) => a + (m.weapon.roundsPerMinute / 60) * m.weapon.damage, 0)
    expect(ttk(P51D)).toBeCloseTo(0.694, 2)
    expect(ttk(BF109G6)).toBeCloseTo(0.532, 2)
  })
})
