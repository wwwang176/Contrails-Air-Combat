import { beforeAll, describe, expect, it } from 'vitest'
import { buildAircraft, GLB_MODELS, liveryUrlFor } from '../../src/render/geometry/buildAircraft'
import { glbTemplate, registerGlbTemplate } from '../../src/render/geometry/glb'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { BF109K4 } from '../../src/specs/bf109k4'
import { JU87 } from '../../src/specs/ju87'
import { YAK1B } from '../../src/specs/yak1b'
import { A6M5_BOMB_LOADOUT } from '../../src/weapons/stores'
import { loadGlbTemplatesForNode } from '../fixtures/glb'
import { cardWith, readyCard, KILL_CARD } from '../fixtures/mission'

/**
 * # 任務卡帶入的塗裝複寫
 *
 * 與 `loadouts` 同一個概念：卡片以機種 id 指定變體，沒指定的一律用預設塗裝。遭遇戰與機庫不帶這個欄位，
 * 所以不受影響。
 */

beforeAll(loadGlbTemplatesForNode)

describe('塗裝複寫：任務卡 → 戰鬥設定', () => {
  /**
   * 【明列透傳】`missionConfigFrom` 不透傳未知欄位。漏抄的症狀是雪地上一架綠飛機、一台沙黃的
   * 戰車、零戰空手起飛，都不報錯。沒寫的卡連鍵都不放：其他任務的戰鬥設定逐位元不變
   */
  it('卡片的 liveries／groundLivery／loadouts：有就原樣帶進戰鬥設定，沒有就連鍵都沒有', () => {
    const plain = missionConfigFrom(readyCard(KILL_CARD))
    for (const key of ['liveries', 'groundLivery', 'loadouts'] as const) expect(key in plain, key).toBe(false)
    const liveries = { ju87: 'winter' }
    const loadouts = { a6m5: A6M5_BOMB_LOADOUT }
    const cfg = missionConfigFrom(cardWith(KILL_CARD, { liveries, groundLivery: 'winter', loadouts }))
    expect(cfg.liveries).toBe(liveries)
    expect(cfg.groundLivery).toBe('winter')
    expect(cfg.loadouts).toBe(loadouts)
  })

  /** 遭遇戰用同一批機種（Bf 109 K-4）：不受德 M4 的冬季覆寫影響，也沒有地方可以選 */
  it('遭遇戰的戰鬥設定沒有塗裝複寫', () => {
    expect('liveries' in battleConfigFrom(DEFAULT_SKIRMISH)).toBe(false)
  })
})

describe('塗裝複寫：機型定義與貼圖路徑', () => {
  /** 卡片指名的變體沒登記的話，那一關一載入就拋錯 */
  it('每一張卡指名的塗裝變體都有登記，路徑與預設的不同', () => {
    for (const c of Object.values(MISSIONS).flat()) {
      for (const [id, variant] of Object.entries(c.battle?.liveries ?? {})) {
        expect(liveryUrlFor(id, variant), `${c.id} ${id}`).not.toBe(liveryUrlFor(id))
      }
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
