import { beforeAll, describe, expect, it } from 'vitest'
import { buildAircraft, GLB_MODELS, liveryUrlFor } from '../../src/render/geometry/buildAircraft'
import { glbTemplate, registerGlbTemplate } from '../../src/render/geometry/glb'
import { missionConfigFrom } from '../../src/battle/missions'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { BF109K4 } from '../../src/specs/bf109k4'
import { JU87 } from '../../src/specs/ju87'
import { YAK1B } from '../../src/specs/yak1b'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { readyCard } from '../fixtures/mission'

/**
 * # 任務卡帶入的塗裝複寫
 *
 * 與 `loadouts` 同一個概念：卡片以機種 id 指定變體，沒指定的一律用預設塗裝。遭遇戰與機庫不帶這個欄位，
 * 所以不受影響。
 */

beforeAll(loadGlbTemplatesForNode)

const WINTER_TYPES = ['ju87', 'yak1b', 'bf109k4'] as const

describe('塗裝複寫：任務卡 → 戰鬥設定', () => {
  it('德 M4 卡片指定 Ju 87、Yak-1B、Bf 109 K-4 三型用冬季塗裝，帶進戰鬥設定', () => {
    const cfg = missionConfigFrom(readyCard('germany-m4'))
    expect(cfg.liveries).toEqual({ ju87: 'winter', yak1b: 'winter', bf109k4: 'winter' })
  })

  it('沒有 liveries 的卡片，戰鬥設定也沒有這個鍵（其他任務逐位元不變）', () => {
    for (const id of ['germany-m1', 'germany-m2', 'germany-m3']) {
      const cfg = missionConfigFrom(readyCard(id))
      expect('liveries' in cfg, id).toBe(false)
    }
  })

  /** 遭遇戰用同一批機種（Bf 109 K-4）：不受德 M4 的冬季覆寫影響，也沒有地方可以選 */
  it('遭遇戰的戰鬥設定沒有塗裝複寫', () => {
    expect('liveries' in battleConfigFrom(DEFAULT_SKIRMISH)).toBe(false)
  })
})

describe('塗裝複寫：機型定義與貼圖路徑', () => {
  it('三型都登記了 winter 變體，路徑與預設的不同', () => {
    for (const id of WINTER_TYPES) {
      const def = GLB_MODELS[id]!
      expect(def.liveryVariants?.['winter'], id).toBeDefined()
      expect(def.liveryVariants!['winter'], id).not.toBe(def.livery!.url)
    }
  })

  it('liveryUrlFor：不給變體是預設、給了是變體；沒登記的變體拋錯', () => {
    const def = GLB_MODELS['ju87']!
    expect(liveryUrlFor('ju87')).toBe(def.livery!.url)
    expect(liveryUrlFor('ju87', 'winter')).toBe(def.liveryVariants!['winter'])
    expect(() => liveryUrlFor('ju87', 'nope')).toThrow(/nope/)
    // 沒有登記任何變體的機種
    expect(() => liveryUrlFor('p51d', 'winter')).toThrow(/winter/)
  })
})

describe('塗裝複寫：建模型', () => {
  it('依變體取樣板；請求了沒載入的變體就拋錯，不靜靜落回預設', () => {
    expect(() => buildAircraft(JU87, 'winter')).toThrow(/winter/)
    const base = glbTemplate('ju87')!
    const winter = { ...base, group: base.group.clone(true) }
    winter.group.userData['tag'] = 'winter'
    registerGlbTemplate('ju87', winter, 'winter')
    expect(glbTemplate('ju87', 'winter')).toBe(winter)
    expect(glbTemplate('ju87')).toBe(base)
    expect(buildAircraft(JU87, 'winter').group.userData['tag']).toBe('winter')
  })

  it('不給變體就是預設的樣板，註冊了變體也不受影響', () => {
    expect(buildAircraft(JU87).group.userData['tag']).toBeUndefined()
    expect(buildAircraft(YAK1B).group.userData['tag']).toBeUndefined()
    expect(buildAircraft(BF109K4).group.userData['tag']).toBeUndefined()
  })
})
