import { beforeAll, describe, expect, it } from 'vitest'
import {
  AIRCRAFT_LOD_DIST, AIRCRAFT_LOD_HYSTERESIS, buildAircraft, buildAircraftLod, useAircraftLod,
} from '../../src/render/geometry/buildAircraft'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'
import { P51D } from '../../src/specs/p51d'

/** 距離平方 —— `useAircraftLod` 吃的是平方，熱路徑上不開根號 */
const d2 = (m: number): number => m * m

describe('飛機的距離 LOD', () => {
  const OUT = AIRCRAFT_LOD_DIST + AIRCRAFT_LOD_HYSTERESIS

  it('近的用正式模型，遠的用低模', () => {
    expect(useAircraftLod(d2(OUT - 1), false)).toBe(false)
    expect(useAircraftLod(d2(OUT + 1), false)).toBe(true)
  })

  it('低模不會出現在門檻以內 —— 遲滯只往外', () => {
    expect(useAircraftLod(d2(AIRCRAFT_LOD_DIST - 1), true)).toBe(false)
    expect(useAircraftLod(d2(AIRCRAFT_LOD_DIST + 1), true)).toBe(true)
  })

  it('遲滯帶有寬度 —— 停在門檻上不會逐幀換', () => {
    expect(OUT - AIRCRAFT_LOD_DIST).toBeGreaterThan(0)
    // 帶子裡：答案取決於上一幀
    const mid = (AIRCRAFT_LOD_DIST + OUT) / 2
    expect(useAircraftLod(d2(mid), false)).toBe(false)
    expect(useAircraftLod(d2(mid), true)).toBe(true)
  })
})

describe('低模的量測值與正式模型一致', () => {
  beforeAll(async () => {
    await loadGlbTemplatesForNode()
  })

  // 【為什麼要守】`main.ts` 只讀 `v.model` 的這幾個點（凝結尾、瞄具、座艙
  // 眼點），不分現在顯示的是哪一具。兩邊漂掉的話症狀是尾跡與投彈從機身旁邊
  // 冒出來，而畫面上看不出模型換過
  for (const spec of [B17G, HE111]) {
    it(`${spec.id} 有低模，而且翼尖／眼點／投彈點逐項相同`, () => {
      const full = buildAircraft(spec)
      const lod = buildAircraftLod(spec.id)
      expect(lod).not.toBeNull()
      expect(lod!.wingTip.toArray()).toEqual(full.wingTip.toArray())
      expect(lod!.eyePoint.toArray()).toEqual(full.eyePoint.toArray())
      expect(lod!.bombPoint!.toArray()).toEqual(full.bombPoint!.toArray())
      expect(lod!.enginePoints.length).toBe(full.enginePoints.length)
      full.dispose()
      lod!.dispose()
    })
  }

  it('沒列在表上的機種回 null', () => {
    expect(buildAircraftLod(P51D.id)).toBeNull()
  })
})
