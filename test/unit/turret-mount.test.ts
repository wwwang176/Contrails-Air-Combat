import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import { G4M } from '../../src/specs/g4m'
import { segmentBox, NO_HIT } from '../../src/world/hit'
import { TURRET_MOUNT_REACH } from '../../src/weapons/turret'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * 【為什麼是新檔而不是加進 hitbox.test.ts】那一支的 `CASES` 一擴大，整套
 * **外形**斷言（頂點數、命中盒幾何）就會開始跑兩台轟炸機，違反
 * 「不為飛機外形寫測試」的既有裁決。這裡只跑砲塔的跨模組一致性。
 */
const TURRET_CASES: readonly AircraftSpec[] = [HE111, B17G, G4M]

describe('砲塔的位置與射界', () => {
  for (const spec of TURRET_CASES) {
    describe(spec.name, () => {
      it('axis 是單位向量', () => {
        for (const t of spec.turrets) {
          expect(t.axis.length(), `${t.id} 的 axis 不是單位向量`).toBeCloseTo(1, 6)
        }
      })

      /**
       * 【為什麼要另外測方向】下面那條「回走會碰到機體」抓不到正負號打反：
       * 下巴砲塔與機首槍的槍口**本來就在座艙盒內**，`segmentBox` 的起點
       * 在盒內時回傳 `0`，所以 axis 正著反著都判成「有接觸」。
       *
       * 這一條直接斷言每一座朝哪邊，抓的就是那個最容易犯的錯。
       */
      it('每一座砲塔的朝向符合它的名字', () => {
        const dir = (id: string): { axis: 'x' | 'y' | 'z'; sign: number } | undefined => {
          if (id === 'chin' || id === 'nose' || id.startsWith('cheek')) {
            return { axis: 'z', sign: -1 }   // 朝機首
          }
          if (id === 'tail' || id === 'dorsal' || id === 'ventral') {
            return { axis: 'z', sign: +1 }   // 朝機尾
          }
          if (id === 'top') return { axis: 'y', sign: +1 }
          if (id === 'ball') return { axis: 'y', sign: -1 }
          if (id.endsWith('L')) return { axis: 'x', sign: -1 }
          if (id.endsWith('R')) return { axis: 'x', sign: +1 }
          return undefined
        }
        for (const t of spec.turrets) {
          const want = dir(t.id)
          expect(want, `砲塔 ${t.id} 沒有登記朝向 —— 新增砲塔時要一起補`)
            .not.toBeUndefined()
          const v = want!.axis === 'x' ? t.axis.x : want!.axis === 'y' ? t.axis.y : t.axis.z
          expect(Math.sign(v), `砲塔 ${t.id} 的 ${want!.axis} 分量方向錯了`)
            .toBe(want!.sign)
        }
      })

      /**
       * 【為什麼不是「槍口在命中盒內」】真機的槍管本來就伸出蒙皮之外。
       * B-17G 的尾砲塔槍口在 z ≈ 16.4，而它的 tail 命中盒只到 15.30
       * （`src/specs/b17g.ts`）—— 那條斷言必然紅，而正確的反應不是把命中盒
       * 撐大，是換一條有意義的護欄。
       *
       * 真正要守的是「這挺槍**接在飛機上**」：從槍口沿 −axis 回走
       * `TURRET_MOUNT_REACH`，必須碰到某個命中盒。**那個距離刻意比槍管長**
       * —— 命中盒是簡化的傷害體積，比實際機體小（B-17G 的機身外殼到
       * z 16.25，而 tail 盒只到 15.30）。缺陷情境：某座砲塔的位置打錯而飄在
       * 機外三公尺。
       *
       * 【判準用 `!== NO_HIT` 而不是 `> 0`】`segmentBox` 的回傳值有三種語意：
       * `NO_HIT`（−1）沒打到、**`0` 起點就在盒內**、`(0, 1]` 進入參數。
       * 下巴砲塔與機首槍的槍口本來就在座艙盒內，用 `> 0` 判斷會**必假紅**。
       */
      it('每個砲塔沿 −axis 回走 TURRET_MOUNT_REACH 都會碰到機體', () => {
        const back = new Vector3()
        for (const t of spec.turrets) {
          back.copy(t.position).addScaledVector(t.axis, -TURRET_MOUNT_REACH)
          const attached = spec.hitBoxes.some((b) => segmentBox(
            t.position.x, t.position.y, t.position.z,
            back.x, back.y, back.z, b,
          ) !== NO_HIT)
          expect(attached, `砲塔 ${t.id} 回走 ${TURRET_MOUNT_REACH} m 沒有碰到機體`).toBe(true)
        }
      })
    })
  }
})

describe('兩台轟炸機沒有固定前射武器', () => {
  /**
   * He 111 的機首 MG 15 是球形槍座上的**手持活動槍**、B-17G 的下巴是 Bendix
   * **動力砲塔遙控瞄準** —— 兩者都是投彈手操作的，不是駕駛員能扣的槍。
   * 專案負責人裁定：可以轉向的都交給 AI，玩家不控火砲。
   */
  it('mounts 是空的', () => {
    for (const s of TURRET_CASES) {
      expect(s.battery.mounts, `${s.id} 的掛架該是空的`).toHaveLength(0)
    }
  })

  it('sight 仍然保留 —— ai/assess.ts 與 ai/steer.ts 有四處在讀它', () => {
    expect(HE111.battery.sight.muzzleVelocity).toBeGreaterThan(0)
    expect(B17G.battery.sight.muzzleVelocity).toBeGreaterThan(0)
  })
})

describe('砲塔數量與管數', () => {
  it('B-17G 八座、槍管合計 12 根', () => {
    expect(B17G.turrets).toHaveLength(8)
    expect(B17G.turrets.reduce((sum, t) => sum + t.guns, 0)).toBe(12)
  })

  it('He 111 五座、槍管合計 6 根（機腹是雙聯）', () => {
    expect(HE111.turrets).toHaveLength(5)
    expect(HE111.turrets.reduce((sum, t) => sum + t.guns, 0)).toBe(6)
  })

  it('He 111 的機背是 13 mm，其餘是 7.92 mm', () => {
    const byId = new Map(HE111.turrets.map((t) => [t.id, t.weapon.id]))
    expect(byId.get('dorsal')).toBe('mg131')
    for (const id of ['nose', 'ventral', 'beamL', 'beamR']) {
      expect(byId.get(id)).toBe('mg15')
    }
  })
})
