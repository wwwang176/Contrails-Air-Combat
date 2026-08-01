import { describe, it, expect } from 'vitest'
import { buildFuselage } from '../../src/render/geometry/fuselage'
import { buildWingPanel } from '../../src/render/geometry/wing'
import { SILHOUETTES } from '../../src/render/geometry/silhouettes'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { DEG } from '../../src/core/math'

describe('buildFuselage', () => {
  it('產生非空且座標有限的幾何', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage, 8)
    const pos = g.getAttribute('position')
    expect(pos.count).toBeGreaterThan(0)
    for (let i = 0; i < pos.count * 3; i++) {
      expect(Number.isFinite(pos.array[i]!)).toBe(true)
    }
  })

  it('包含法線', () => {
    expect(buildFuselage(SILHOUETTES.p51d!.fuselage, 8).getAttribute('normal')).toBeDefined()
  })

  it('三角形數落在低多邊形預算內', () => {
    const g = buildFuselage(SILHOUETTES.p51d!.fuselage, 8)
    expect(g.getAttribute('position').count / 3).toBeLessThan(200)
  })
})

describe('buildWingPanel', () => {
  const params = {
    rootChord: 2.7, tipChord: 1.3, halfSpan: 5.6,
    sweep: 4 * DEG, dihedral: 5 * DEG, thickness: 0.3, rootZ: -1.5, rootY: -0.3,
  }

  it('右翼延伸至 +X', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let maxX = -Infinity
    for (let i = 0; i < pos.count; i++) maxX = Math.max(maxX, pos.getX(i))
    expect(maxX).toBeCloseTo(params.halfSpan, 3)
  })

  it('左翼延伸至 −X', () => {
    const pos = buildWingPanel(params, true).getAttribute('position')
    let minX = Infinity
    for (let i = 0; i < pos.count; i++) minX = Math.min(minX, pos.getX(i))
    expect(minX).toBeCloseTo(-params.halfSpan, 3)
  })

  it('上反角使翼尖高於翼根', () => {
    const pos = buildWingPanel(params, false).getAttribute('position')
    let tipY = -Infinity
    for (let i = 0; i < pos.count; i++) {
      if (pos.getX(i) > params.halfSpan - 0.01) tipY = Math.max(tipY, pos.getY(i))
    }
    expect(tipY).toBeGreaterThan(params.rootY)
  })
})

describe('buildAircraft', () => {
  for (const spec of [P51D, BF109G6]) {
    describe(spec.name, () => {
      it('產生含子物件的 Group', () => {
        const m = buildAircraft(spec)
        expect(m.group.children.length).toBeGreaterThan(5)
        m.dispose()
      })

      it('setSurfaces 改變舵面旋轉且左右副翼反向', () => {
        const m = buildAircraft(spec)
        m.setSurfaces(1, 0, 0)
        const rotations = m.group.children
          .filter((c) => c.type === 'Group')
          .map((c) => c.rotation.x)
        expect(rotations.some((r) => r > 0)).toBe(true)
        expect(rotations.some((r) => r < 0)).toBe(true)
        m.dispose()
      })

      /**
       * 【計畫原稿的斷言是 expect(Number.isFinite(1)).toBe(true)】
       * 那驗證的是「1 是有限數」——與螺旋槳毫無關係，而且**不可能失敗**：
       * 把 setPropSpin 的實作整個刪成空函式，該版本照樣通過。
       * 一條不會失敗的測試比沒有測試更糟，因為它會讓人誤以為這裡有防護。
       * 改為實際檢查三件事：旋轉角有寫進去、模糊圓盤與槳葉的可見性互斥、
       * 且兩種狀態下恰有一組可見。
       */
      it('setPropSpin 寫入旋轉角，且槳葉與模糊圓盤互斥可見', () => {
        const m = buildAircraft(spec)
        const visibleNames = (): string[] => {
          const out: string[] = []
          m.group.traverse((o) => {
            if ((o as { isMesh?: boolean }).isMesh && o.visible) out.push(o.name || o.uuid)
          })
          return out
        }

        m.setPropSpin(1.2, true)
        const blurred = visibleNames()
        m.setPropSpin(2.5, false)
        const bladed = visibleNames()

        // 兩種狀態必須真的不同——若可見性沒有被切換，這裡會相等
        expect(blurred).not.toEqual(bladed)
        // 且互斥：模糊時可見的那些，換成槳葉時必須隱藏，反之亦然
        const onlyBlurred = blurred.filter((n) => !bladed.includes(n))
        const onlyBladed = bladed.filter((n) => !blurred.includes(n))
        expect(onlyBlurred.length).toBeGreaterThan(0)
        expect(onlyBladed.length).toBeGreaterThan(0)

        // 旋轉角必須真的被寫入（實作寫在 propHub.rotation.z）
        let sawRotation = false
        m.group.traverse((o) => {
          if (Math.abs(o.rotation.z - 2.5) < 1e-9) sawRotation = true
        })
        expect(sawRotation).toBe(true)
        m.dispose()
      })

      /**
       * 【計畫原稿有兩個缺陷，已修正】
       * 一、`position.count / 3` 對**有索引**的幾何算的是唯一頂點數，不是
       *     三角形數。真實三角形數要看 index.count / 3。實測差距很大：
       *     P-51D 真實 384、原公式 267.7；Bf 109 真實 296、原公式 250.0。
       * 二、測試名稱寫「400–1200」，斷言卻是 > 200 且 < 1500，兩者不符。
       *
       * 兩個缺陷剛好互相抵銷才讓原版通過：若量對東西又套用名稱裡的門檻，
       * 兩架飛機都會不及格（384 與 296 都低於 400）。
       *
       * 【門檻依實測訂為 250–800】（專案負責人裁決：維持現有細緻度）
       * 下界只是防止幾何退化成空殼，**不是品質保證**——外型好不好看、
       * 特徵認不認得出來，測試量不到，只有人眼判得出。上界才是有意義的
       * 那一側：它守住低多邊形的效能預算。
       */
      it('全機三角形數落在低多邊形預算內', () => {
        const m = buildAircraft(spec)
        let tris = 0
        m.group.traverse((o) => {
          const g = (o as unknown as {
            geometry?: {
              index?: { count: number } | null
              getAttribute(n: string): { count: number } | undefined
            }
          }).geometry
          if (!g) return
          const p = g.getAttribute('position')
          if (!p) return
          // 有索引就用索引數，那才是真正被畫出來的三角形
          tris += g.index ? g.index.count / 3 : p.count / 3
        })
        expect(tris).toBeGreaterThan(250)
        expect(tris).toBeLessThan(800)
        m.dispose()
      })
    })
  }

  it('未知機種拋出明確錯誤', () => {
    expect(() => buildAircraft({ ...P51D, id: 'unknown' })).toThrow(/未定義機種外型/)
  })

  it('兩台飛機的翼展與外型參數明顯不同', () => {
    expect(SILHOUETTES.p51d!.wing.halfSpan).toBeGreaterThan(SILHOUETTES.bf109g6!.wing.halfSpan)
    expect(SILHOUETTES.p51d!.canopy.teardrop).toBe(true)
    expect(SILHOUETTES.bf109g6!.canopy.teardrop).toBe(false)
  })
})
