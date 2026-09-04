import { describe, it, expect } from 'vitest'
import { SHIP_CLASSES, createShip, resetShip, stepShips } from '../../src/world/ships'
import { SHIP_AA_ZONES } from '../../src/world/shipAA'
import { boundingRadius } from '../../src/world/hit'

describe('SHIP_CLASSES', () => {
  it('三個艦級都有，砲區表對得上 shipAA', () => {
    expect(SHIP_CLASSES.wichita.zones).toBe(SHIP_AA_ZONES.wichita)
    expect(SHIP_CLASSES.fletcher.zones).toBe(SHIP_AA_ZONES.fletcher)
    expect(SHIP_CLASSES.essex.zones).toBe(SHIP_AA_ZONES.essex)
  })

  /**
   * 【包圍球必須是上界】算小了會靜靜地漏掉命中 —— 子彈穿過艦艏卻不扣血，
   * 而且只在特定角度發生。與 `hit.ts` 的 `boundingRadius` 同一條規則。
   *
   * 砲位一起檢查：它們在上層建築上，可能比船體盒的角更遠。
   */
  it('包圍球半徑覆蓋得住船體盒與所有砲位', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      expect(cls.radius).toBeGreaterThanOrEqual(boundingRadius(cls.hull))
      for (const z of cls.zones) {
        expect(cls.radius).toBeGreaterThanOrEqual(z.position.length())
      }
    }
  })

  it('船體盒不是空的，而且每個盒的半尺寸都是正的', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      expect(cls.hull.length).toBeGreaterThan(0)
      for (const b of cls.hull) {
        expect(b.half.x).toBeGreaterThan(0)
        expect(b.half.y).toBeGreaterThan(0)
        expect(b.half.z).toBeGreaterThan(0)
      }
    }
  })

  /**
   * 【船體盒要含得住砲位的高度】砲位盒掛在砲口上，而砲口在上層建築上。
   * 船體盒若只到主甲板，子彈會從艦橋「裡面」穿過去打到對舷的砲位。
   */
  it('船體盒的最高點高於最高的砲位', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      const top = Math.max(...cls.hull.map((b) => b.center.y + b.half.y))
      const gunTop = Math.max(...cls.zones.map((z) => z.position.y))
      expect(top).toBeGreaterThanOrEqual(gunTop)
    }
  })
})

describe('stepShips', () => {
  it('艏向 0 時朝 −Z 前進，60 秒走 480 m', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 8)
    for (let i = 0; i < 60 * 240; i++) stepShips([s], 1 / 240)
    expect(s.position.z).toBeCloseTo(-480, 2)
    expect(s.position.x).toBeCloseTo(0, 6)
    expect(s.position.y).toBe(0)
  })

  it('艏向 90° 時朝 −X 前進', () => {
    const s = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, Math.PI / 2, 8)
    for (let i = 0; i < 240; i++) stepShips([s], 1 / 240)
    expect(s.position.x).toBeCloseTo(-8, 4)
    expect(s.position.z).toBeCloseTo(0, 6)
  })

  /** 【不轉向】負責人裁定：固定艏向、不閃避。 */
  it('艏向從頭到尾不變', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 100, 200, 1.1, 8)
    const q = s.orientation.clone()
    for (let i = 0; i < 1000; i++) stepShips([s], 1 / 240)
    expect(s.orientation.equals(q)).toBe(true)
  })

  it('速度 0 的船原地不動', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 10, 20, 0.3, 0)
    for (let i = 0; i < 1000; i++) stepShips([s], 1 / 240)
    expect(s.position.x).toBe(10)
    expect(s.position.z).toBe(20)
  })
})

describe('resetShip', () => {
  it('位置回到起點、血量回滿', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 300, -400, 0.5, 8)
    for (let i = 0; i < 2400; i++) stepShips([s], 1 / 240)
    s.hp = 1
    resetShip(s)
    expect(s.position.x).toBeCloseTo(300, 6)
    expect(s.position.z).toBeCloseTo(-400, 6)
    expect(s.hp).toBe(SHIP_CLASSES.wichita.hp)
  })
})
