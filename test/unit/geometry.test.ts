import { describe, it, expect, beforeAll } from 'vitest'
import { DoubleSide, Mesh, Vector3, type MeshStandardMaterial } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'

/**
 * 機種模型的**跨模組一致性**與**渲染規則**。不測外型。
 *
 *   跨模組一致性  —— 包圍盒翼展要等於 spec.wing.span（飛行模型與視覺模型
 *                    共用同一個數字）、機翼四分之一弦線要落在原點（原點是
 *                    物理模型的重心）、宣告的翼尖要落在網格的翼尖上。
 *   渲染規則      —— 半透明不寫深度、模糊圓盤的繪製順序與兩面可見。
 */

// node 這邊要自己讀 GLB 載樣板
beforeAll(async () => { await loadGlbTemplatesForNode() })

describe('buildAircraft', () => {
  it('未知機種拋出明確錯誤', () => {
    expect(() => buildAircraft({ ...P51D, id: 'unknown' })).toThrow(/未定義機種外型/)
  })

  for (const spec of [P51D, BF109K4, B17G]) {
    describe(spec.name, () => {
      /** 旋轉角有寫進去、模糊圓盤與槳葉的可見性互斥。 */
      it('setPropSpin 寫入旋轉角，且槳葉與模糊圓盤互斥可見', () => {
        const m = buildAircraft(spec)
        const visible = (): string[] => {
          const out: string[] = []
          m.group.traverse((o) => {
            if ((o as { isMesh?: boolean }).isMesh && o.visible) out.push(o.uuid)
          })
          return out
        }
        m.setPropSpin(1.2, true)
        const blurred = visible()
        m.setPropSpin(2.5, false)
        const bladed = visible()

        expect(blurred).not.toEqual(bladed)
        expect(blurred.filter((n) => !bladed.includes(n)).length).toBeGreaterThan(0)
        expect(bladed.filter((n) => !blurred.includes(n)).length).toBeGreaterThan(0)

        let sawRotation = false
        m.group.traverse((o) => {
          if (Math.abs(o.rotation.z - 2.5) < 1e-9) sawRotation = true
        })
        expect(sawRotation).toBe(true)
        m.dispose()
      })

      it('整流罩在最前方，metrics.noseZ 與實際幾何一致', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)
        let minZ = Infinity
        const v = new Vector3()
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          for (let i = 0; i < p.count; i++) {
            minZ = Math.min(minZ, v.set(p.getX(i), p.getY(i), p.getZ(i))
              .applyMatrix4(o.matrixWorld).z)
          }
        })
        expect(m.metrics.noseZ).toBeCloseTo(minZ, 6)
        m.dispose()
      })

      /** 翼展直接對 spec —— 飛行模型與視覺模型用的是同一個數字，兩邊各改各的會在這裡被抓到。 */
      it('包圍盒的翼展等於 spec 的翼展', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)
        const v = new Vector3()
        let minX = Infinity, maxX = -Infinity
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            minX = Math.min(minX, v.x); maxX = Math.max(maxX, v.x)
          }
        })
        expect(maxX - minX).toBeCloseTo(spec.wing.span, 2)
        m.dispose()
      })

      /**
       * 原點是物理模型的**重心**（`state.position` 就是重心），所以模型的
       * 機翼四分之一弦線必須壓在原點上。差的話等於把重心放在氣動中心前後，
       * 物理上說不通，視覺上追尾相機也會對準錯的點。
       *
       * 主翼是標成 part='wingN'、跨越 80% 翼展以上的那片網格，取它在 x≈0 的
       * 翼根弦長。
       */
      it('機翼四分之一弦線落在原點（＝重心）', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)
        // 【判準是整個翼展，不是半翼展】左右兩片是同一個 mesh，跨度是整個翼展
        // —— 用半翼展當門檻的話平尾（B-17G 的平尾 13 m，主翼半翼展 15.8 m）也
        // 會通過，量到的翼根弦於是混了兩片。
        const span = spec.wing.span
        const v = new Vector3()
        let lead = Infinity, trail = -Infinity
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          // 【先用標記，再用形狀】機身與翼板可能落在同一個 mesh 裡，只看「x 向
          // 跨度夠寬」認不出主翼。翼板標成 part='wingN'，下面的跨度判準再分出
          // 主翼與平尾。
          if (!String(o.userData['part'] ?? '').startsWith('wing')) return
          let x0 = Infinity, x1 = -Infinity
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x)
          }
          if (x1 - x0 < span * 0.8) return          // 不是主翼板
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            if (Math.abs(v.x) > 0.02) continue      // 只取翼根站位
            lead = Math.min(lead, v.z); trail = Math.max(trail, v.z)
          }
        })
        expect(lead + 0.25 * (trail - lead)).toBeCloseTo(0, 6)
        m.dispose()
      })

      /**
       * `wingTip` 是寫在 manifest 上的常數，會與網格漂開 —— 症狀是尾跡從機身
       * 中間冒出來，而不會有任何錯誤。宣告的點必須真的落在網格的翼尖上。
       *
       * 【為什麼是「落在範圍內」而不是精確值】翼尖是一片有厚度、有弦長的
       * 剖面，`wingTip` 取的是弦中點。斷言它落在那一站的 y／z 範圍內即可。
       */
      it('宣告的 wingTip 真的落在網格的翼尖上', () => {
        const m = buildAircraft(spec)
        m.group.updateMatrixWorld(true)
        const v = new Vector3()
        // 先找出全機最外側的 |x|（＝半翼展）
        let maxAbsX = 0
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            maxAbsX = Math.max(maxAbsX, Math.abs(v.x))
          }
        })
        // 再取最外側那一站（99% 之外）的 y／z 範圍
        let loY = Infinity, hiY = -Infinity, loZ = Infinity, hiZ = -Infinity
        m.group.traverse((o) => {
          const p = (o as Mesh).geometry?.getAttribute?.('position')
          if (!p) return
          for (let i = 0; i < p.count; i++) {
            v.set(p.getX(i), p.getY(i), p.getZ(i)).applyMatrix4(o.matrixWorld)
            if (Math.abs(v.x) < maxAbsX * 0.99) continue
            loY = Math.min(loY, v.y); hiY = Math.max(hiY, v.y)
            loZ = Math.min(loZ, v.z); hiZ = Math.max(hiZ, v.z)
          }
        })

        expect(m.wingTip.x).toBeCloseTo(maxAbsX, 3)
        expect(m.wingTip.y).toBeGreaterThanOrEqual(loY)
        expect(m.wingTip.y).toBeLessThanOrEqual(hiY)
        expect(m.wingTip.z).toBeGreaterThanOrEqual(loZ)
        expect(m.wingTip.z).toBeLessThanOrEqual(hiZ)
        m.dispose()
      })

      it('wingTip 的展向位置等於 spec 的半翼展', () => {
        // 上面那條守的是「宣告值 vs 網格」，這一條守的是「宣告值 vs 氣動參數」
        // —— 兩邊都對上，尾跡才真的在翼尖。
        const m = buildAircraft(spec)
        expect(m.wingTip.x).toBeCloseTo(spec.wing.span / 2, 3)
        m.dispose()
      })
    })
  }
})

describe('透明材質不寫深度', () => {
  /**
   * 半透明的東西**不可以寫深度緩衝**，否則它會把後面的東西整條丟掉而不是
   * 混合出來 —— 一個 22% 不透明度的模糊圓盤會讓曳光彈完全消失。
   */
  for (const spec of [P51D, BF109K4, B17G]) {
    it(`${spec.id}：機體上每一個 transparent 材質都關掉 depthWrite`, () => {
      const m = buildAircraft(spec)
      const offenders: string[] = []
      m.group.traverse((o) => {
        const mesh = o as Mesh
        if (!mesh.isMesh) return
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
        for (const mat of mats) {
          if (mat.transparent && mat.depthWrite) offenders.push(mesh.geometry.type)
        }
      })
      expect(offenders).toEqual([])
      m.dispose()
    })
  }

  it('模糊圓盤排在其他透明物件之後才畫', () => {
    // 【為什麼只關 depthWrite 還不夠】關掉之後遮擋不再是「丟掉」而是「混合」，
    // 但混合的先後仍然由**逐物件**排序決定 —— 而曳光彈整批是一個
    // InstancedMesh，它的排序深度取的是世界原點，與子彈實際飛在哪裡無關。
    // renderOrder 把常見情形（子彈在圓盤後方）釘成正確的那一邊。
    const m = buildAircraft(P51D)
    const discs: Mesh[] = []
    m.group.traverse((o) => {
      const mesh = o as Mesh
      if (mesh.isMesh && mesh.geometry.type === 'CircleGeometry') discs.push(mesh)
    })
    expect(discs).toHaveLength(1)
    expect(discs[0]!.renderOrder).toBeGreaterThan(0)
    m.dispose()
  })

  /**
   * 圓盤是 `CircleGeometry`，法線指 +Z，而機首朝 −Z。材質若是 `FrontSide`，
   * 圓盤**只有從飛機後方畫得出來**；而油門 > 0.15 時 `setPropSpin` 會把槳葉
   * 全部隱藏。兩件事合起來：**從飛機前方或斜前方看，螺旋槳整個不存在。**
   */
  for (const [name, spec] of [['P-51D', P51D], ['Bf 109 G-6', BF109K4]] as const) {
    it(`${name}：模糊圓盤兩面都畫得出來`, () => {
      const m = buildAircraft(spec)
      const discs: Mesh[] = []
      m.group.traverse((o) => {
        const mesh = o as Mesh
        if (mesh.isMesh && mesh.geometry.type === 'CircleGeometry') discs.push(mesh)
      })
      expect(discs).toHaveLength(1)
      expect((discs[0]!.material as MeshStandardMaterial).side).toBe(DoubleSide)
      m.dispose()
    })
  }
})
