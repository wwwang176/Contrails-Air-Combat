import { beforeAll, describe, expect, it } from 'vitest'
import { CircleGeometry, type Mesh, type Object3D } from 'three'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { PROP_BLUR_SPIN } from '../../src/render/propBlur'
import { A6M5 } from '../../src/specs/a6m5'
import { B17G } from '../../src/specs/b17g'
import { BF109K4 } from '../../src/specs/bf109k4'
import { F4F4 } from '../../src/specs/f4f4'
import { F6F5 } from '../../src/specs/f6f5'
import { G4M } from '../../src/specs/g4m'
import { HE111 } from '../../src/specs/he111'
import { JU87 } from '../../src/specs/ju87'
import { KI84 } from '../../src/specs/ki84'
import { P51D } from '../../src/specs/p51d'
import { YAK1B } from '../../src/specs/yak1b'

beforeAll(async () => { await loadGlbTemplatesForNode() })

const discsOf = (g: Object3D): Mesh[] => {
  const out: Mesh[] = []
  g.traverse((o) => { const m = o as Mesh; if (m.isMesh && m.geometry.type === 'CircleGeometry') out.push(m) })
  return out
}

/** 槳葉片數：P-51D、Ki-84、G4M 二四型是四葉，其餘三葉 */
const BLADES: [string, typeof P51D, number][] = [
  ['p51d', P51D, 4], ['ki84', KI84, 4], ['g4m', G4M, 4], ['bf109k4', BF109K4, 3], ['a6m5', A6M5, 3],
  ['f4f4', F4F4, 3], ['f6f5', F6F5, 3], ['yak1b', YAK1B, 3], ['ju87', JU87, 3], ['b17g', B17G, 3], ['he111', HE111, 3],
]

describe('遊戲的槳盤用殘影材質', () => {
  it.each(BLADES)('%s：殘影材質、圓盤 64 邊、槳葉片數照模型', (_id, spec, blades) => {
    const discs = discsOf(buildAircraft(spec).group)
    expect(discs.length).toBeGreaterThan(0)
    for (const d of discs) {
      expect(d.material).toHaveProperty('userData.propBlades', blades)
      expect((d.geometry as CircleGeometry).parameters.segments).toBe(64)
    }
  })

  /**
   * 【殘影不跟著槳轂轉】槳轂照真實轉速轉，殘影另外照 `PROP_BLUR_SPIN.angle` —— 跟著槳轂轉的話
   * 圖案每幀跨過的角度與槳葉間隔打拍子，看起來慢轉、停住或倒轉
   */
  it('殘影的實際角度只看殘影時鐘與這一架的油門，不看槳轂', () => {
    const model = buildAircraft(P51D)
    const disc = discsOf(model.group)[0]!
    const net = (): number => disc.parent!.rotation.z + disc.rotation.z
    // 兩個角度差多少（取 −π～π，殘影角度會繞圈）
    const turned = (from: number, to: number): number => Math.atan2(Math.sin(to - from), Math.cos(to - from))
    PROP_BLUR_SPIN.clock = 10
    model.setPropSpin(0.3, true, 1)
    const a = net()
    // 時鐘沒走：槳轂怎麼轉，殘影都不動
    model.setPropSpin(2.7, true, 1)
    expect(turned(a, net())).toBeCloseTo(0, 9)
    // 時鐘走 0.02 s、油門 100%：轉 25 × 0.02 = 0.5 rad
    PROP_BLUR_SPIN.clock = 10.02
    model.setPropSpin(1.1, true, 1)
    const b = net()
    expect(turned(a, b)).toBeCloseTo(0.5, 9)
    // 再走 0.02 s、油門 70%：轉 17.5 × 0.02 = 0.35 rad
    PROP_BLUR_SPIN.clock = 10.04
    model.setPropSpin(0.2, true, 0.7)
    expect(turned(b, net())).toBeCloseTo(0.35, 9)
  })
})
