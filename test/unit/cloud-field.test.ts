import { describe, expect, it } from 'vitest'
import { MISSIONS, CAMPAIGNS } from '../../src/battle/missions'
import type { ReadyMissionCard } from '../../src/battle/missions'
import {
  CLOUD_DENSITY, CLOUD_FIELD_MARGIN, SKIRMISH_CLOUD_BASE, cloudFieldCount, skirmishCloudField, type CloudField,
} from '../../src/world/cloudField'
import {
  CLOUD_FIELD_R_MAX, CLOUD_FIELD_R_MIN, CLOUD_PUFF_CAPACITY, cloudFieldSpecs, cloudPuffCount,
} from '../../src/render/clouds'
import { DAY_PALETTES } from '../../src/render/timeOfDay'
import { SKIRMISH_ARENA, type ArenaBounds } from '../../src/world/arena'
import type { TerrainKind } from '../../src/world/terrainKind'
import type { TimeOfDay } from '../../src/world/timeOfDay'

const ready = CAMPAIGNS.flatMap((c) => MISSIONS[c]).filter((m): m is ReadyMissionCard => m.battle !== null)
const terrains = Object.keys(SKIRMISH_CLOUD_BASE) as TerrainKind[]
const times = Object.keys(DAY_PALETTES) as TimeOfDay[]

describe('雲場的朵數', () => {
  it('密度 × 圓面積（半徑 + 8 km）', () => {
    const f: CloudField = { yMin: 800, yMax: 1500, amount: 'some' }
    const r = 12000 + CLOUD_FIELD_MARGIN
    expect(cloudFieldCount(f, 12000)).toBe(Math.round(CLOUD_DENSITY.some * Math.PI * r * r / 1e6))
    expect(cloudFieldCount({ ...f, amount: 'many' }, 12000)).toBeGreaterThan(cloudFieldCount(f, 12000))
    expect(cloudFieldCount({ ...f, amount: 'few' }, 12000)).toBeLessThan(cloudFieldCount(f, 12000))
  })
})

describe('cloudFieldSpecs：一場的雲', () => {
  const f: CloudField = { yMin: 800, yMax: 1500, amount: 'some' }
  const b: ArenaBounds = { x: 2000, z: -3000, radius: 11000 }

  it('朵數照公式、都在「半徑 + 8 km」的圓內、高度與大小在範圍內', () => {
    const list = cloudFieldSpecs(f, b, 'test')
    expect(list.length).toBe(cloudFieldCount(f, b.radius))
    for (const c of list) {
      expect(Math.hypot(c.x - b.x, c.z - b.z)).toBeLessThanOrEqual(b.radius + CLOUD_FIELD_MARGIN + 1e-6)
      expect(c.y).toBeGreaterThanOrEqual(f.yMin)
      expect(c.y).toBeLessThanOrEqual(f.yMax)
      expect(c.radius).toBeGreaterThanOrEqual(CLOUD_FIELD_R_MIN)
      expect(c.radius).toBeLessThanOrEqual(CLOUD_FIELD_R_MAX)
    }
  })

  it('同一個鍵每次一樣、不同的鍵不一樣', () => {
    expect(cloudFieldSpecs(f, b, 'allies-m1')).toEqual(cloudFieldSpecs(f, b, 'allies-m1'))
    expect(cloudFieldSpecs(f, b, 'allies-m2')).not.toEqual(cloudFieldSpecs(f, b, 'allies-m1'))
  })
})

describe('遭遇戰的雲場', () => {
  it('每一種地形 × 時段都有雲場，雲底範圍合理', () => {
    for (const t of terrains) {
      for (const tod of times) {
        const f = skirmishCloudField(t, tod)
        expect(f.yMin).toBeGreaterThan(0)
        expect(f.yMax).toBeGreaterThan(f.yMin)
      }
    }
  })

  it('暴雨多、夜間少、其餘中等', () => {
    expect(skirmishCloudField('sea', 'storm').amount).toBe('many')
    expect(skirmishCloudField('sea', 'night').amount).toBe('few')
    expect(skirmishCloudField('sea', 'noon').amount).toBe('some')
  })
})

describe('雲塊容量', () => {
  /** 超過容量的雲塊被 `createClouds` 靜靜截掉：遠處少一片雲，不會報錯 */
  const puffs = (list: readonly { radius: number }[]): number => list.reduce((n, c) => n + cloudPuffCount(c.radius), 0)

  it('每一關任務的雲塊總數放得進容量', () => {
    for (const card of ready) {
      const n = puffs(cloudFieldSpecs(card.battle.clouds, card.battle.arena, card.id))
      expect(n, card.id).toBeLessThanOrEqual(CLOUD_PUFF_CAPACITY)
    }
  })

  it('每一種遭遇戰組合的雲塊總數放得進容量', () => {
    for (const t of terrains) {
      for (const tod of times) {
        const key = `skirmish:${t}:${tod}`
        const n = puffs(cloudFieldSpecs(skirmishCloudField(t, tod), SKIRMISH_ARENA, key))
        expect(n, key).toBeLessThanOrEqual(CLOUD_PUFF_CAPACITY)
      }
    }
  })
})
