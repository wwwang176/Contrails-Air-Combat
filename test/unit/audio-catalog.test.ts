import { describe, it, expect } from 'vitest'
import { impactSound } from '../../src/audio/catalog'
import { MATERIAL } from '../../src/world/material'

/**
 * 【查不到材質要有預設】新目標忘了定材質、或材質加了而表沒跟上時，
 * 整個沒聲音是最難查的壞法 —— 不報錯、不當掉，只是那個東西打起來悶不吭聲。
 */
describe('撞擊材質', () => {
  it('每一種材質都有定義', () => {
    for (const [name, m] of Object.entries(MATERIAL)) {
      expect(impactSound(m).pool, name).toBeTruthy()
    }
  })

  /** 厚鋼板比建築低沉 */
  it('船比地面目標低沉', () => {
    expect(impactSound(MATERIAL.ship).rate).toBeLessThan(impactSound(MATERIAL.ground).rate)
  })

  it('沒定義的材質走預設，不是沒聲音', () => {
    for (const bad of [99, -1, 1.5, NaN]) {
      expect(impactSound(bad).pool, String(bad)).toBe('hit')
      expect(impactSound(bad).rate, String(bad)).toBe(1)
    }
  })
})

import { readFileSync } from 'node:fs'
import { ALL_FILES, POOLS, engineFile, fireFile, turretFile } from '../../src/audio/catalog'
import { ALL_SPECS } from '../../src/battle/skirmish'

const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as Record<string, unknown>

describe('音效目錄', () => {
  it('目錄用到的每個檔都在清單裡', () => {
    for (const f of ALL_FILES) expect(manifest[f], f).toBeDefined()
  })

  it('每個音效庫都不是空的', () => {
    for (const [k, v] of Object.entries(POOLS)) expect(v.length, k).toBeGreaterThan(0)
  })

  /** 【空爆要短】高射砲一秒炸四次，長尾巴的爆炸會把聲道佔滿 */
  it('空爆庫有三個，而且都比爆炸庫短', () => {
    expect(POOLS.flakBurst).toHaveLength(3)
    for (const f of POOLS.flakBurst) expect(manifest[f], f).toBeDefined()
  })

  it('每個機種都有引擎聲；有前射武器的才有開火聲', () => {
    for (const s of ALL_SPECS) {
      expect(manifest[engineFile(s.id)], s.id).toBeDefined()
      const f = fireFile(s.id)
      if (s.battery.mounts.length > 0) expect(manifest[f!], s.id).toBeDefined()
      else expect(f, s.id).toBeNull()
    }
  })

  it('每種轟炸機砲塔都對得到檔案', () => {
    for (const s of ALL_SPECS) {
      for (const t of s.turrets) expect(manifest[turretFile(t.weapon.id, t.guns)], `${s.id} ${t.id}`).toBeDefined()
    }
  })
})
