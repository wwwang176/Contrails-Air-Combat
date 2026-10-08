import { beforeAll, describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Color, Mesh, type BufferGeometry } from 'three'
import { groundGeometry, preloadGroundModels } from '../../src/render/geometry/ground'
import { liveryGeometry } from '../../src/render/geometry/ground/livery'
import { GUN_TURRET_KEY, type GunTurretParts } from '../../src/render/geometry/ground/turret'
import { HUE, WINTER_PAINT } from '../../src/render/geometry/ground/palette'
import { GROUND_UNITS, type GroundUnit } from '../../src/specs/ground'
import { createGroundModels } from '../../src/render/groundTargets'
import { createGroundTarget } from '../../src/world/groundTargets'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'

/**
 * 地面單位的冬季塗裝：烤漆那幾種材質換成雪白，鋼、履帶、輪胎、玻璃不變。純頂點色，不用貼圖。
 * 任務卡的 `groundLivery` 在開局帶入。
 */
beforeAll(async () => {
  await preloadGroundModels(async (url) => {
    const b = readFileSync(`public${url}`)
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
  })
})

const unit = (id: string): GroundUnit => GROUND_UNITS.find((u) => u.id === id)!
const hex = (n: number): string => new Color(n).getHexString()

/** 這份幾何每個頂點的顏色（十六進位字串）出現幾次 */
function colorCounts(g: BufferGeometry): Map<string, number> {
  const c = g.getAttribute('color')
  const out = new Map<string, number>()
  const col = new Color()
  for (let i = 0; i < c.count; i++) {
    const k = col.setRGB(c.getX(i), c.getY(i), c.getZ(i)).getHexString()
    out.set(k, (out.get(k) ?? 0) + 1)
  }
  return out
}

describe('冬季塗裝的幾何', () => {
  it('烤漆換成雪白：綠與沙黃都不見，鋼與履帶的頂點數不變', () => {
    expect(WINTER_PAINT['LP_ArmorGreen']).toBe(HUE.winterWhite)
    expect(WINTER_PAINT['LP_TruckGreen']).toBe(HUE.winterWhite)
    expect(WINTER_PAINT['LP_GunGrey']).toBe(HUE.winterWhite)
    expect(WINTER_PAINT['LP_Canvas']).toBeUndefined()
    for (const id of ['panzer4', 'tank', 'atGun', 'truck']) {
      const base = groundGeometry(unit(id))
      const win = liveryGeometry(base, 'winter')
      const a = colorCounts(base)
      const b = colorCounts(win)
      expect(b.has(hex(HUE.armyGreen)), id).toBe(false)
      expect(b.has(hex(HUE.sandYellow)), id).toBe(false)
      expect(b.get(hex(HUE.winterWhite)) ?? 0, id).toBeGreaterThan(0)
      for (const k of [hex(HUE.steel), hex(HUE.rubber), hex(HUE.canvas)]) expect(b.get(k), `${id} ${k}`).toBe(a.get(k))
      // 形狀不動
      expect(Array.from(win.getAttribute('position').array)).toEqual(Array.from(base.getAttribute('position').array))
    }
  })

  it('砲塔那兩塊一起換；原本共用的幾何不被改到', () => {
    const base = groundGeometry(unit('panzer4'))
    const before = Array.from(base.getAttribute('color').array)
    const win = liveryGeometry(base, 'winter')
    const parts = win.userData[GUN_TURRET_KEY] as GunTurretParts
    expect(parts).toBeDefined()
    expect(colorCounts(parts.traverse).has(hex(HUE.sandYellow))).toBe(false)
    expect(colorCounts(parts.traverse).get(hex(HUE.winterWhite)) ?? 0).toBeGreaterThan(0)
    expect(Array.from(base.getAttribute('color').array)).toEqual(before)
    const baseParts = base.userData[GUN_TURRET_KEY] as GunTurretParts
    expect(colorCounts(baseParts.traverse).get(hex(HUE.sandYellow)) ?? 0).toBeGreaterThan(0)
  })

  it('程序化的單位（步兵、火車）沒有冬季資料：回原物', () => {
    const g = groundGeometry(unit('infantry'))
    expect(liveryGeometry(g, 'winter')).toBe(g)
    g.dispose()
  })
})

describe('開局帶入', () => {
  it('createGroundModels 給了冬季：車身與砲塔都是雪白；不給是原本的共用幾何', () => {
    const t = createGroundTarget(0, 'panzer4', 'blue', 0, 0, 0)
    const plain = createGroundModels([t])
    expect((plain.object.children[0] as Mesh).geometry).toBe(groundGeometry(unit('panzer4')))
    plain.dispose()
    const winter = createGroundModels([t], 'winter')
    const body = winter.object.children[0] as Mesh
    const trav = body.children[0] as Mesh
    expect(colorCounts(body.geometry).has(hex(HUE.sandYellow))).toBe(false)
    expect(colorCounts(trav.geometry).has(hex(HUE.sandYellow))).toBe(false)
    winter.dispose()
    // 釋放的是冬季那一份，共用的原物還能用
    expect(groundGeometry(unit('panzer4')).getAttribute('color')).toBeDefined()
  })

  it('德 M4 勒熱夫是冬季；其他關沒有', () => {
    const cards = Object.values(MISSIONS).flat()
    expect(cards.some((c) => c.id === 'germany-m4')).toBe(true)
    for (const card of cards) {
      if (card.battle === undefined) continue
      const cfg = missionConfigFrom(card as ReadyMissionCard)
      expect(cfg.groundLivery, card.id).toBe(card.id === 'germany-m4' ? 'winter' : undefined)
    }
  })
})
