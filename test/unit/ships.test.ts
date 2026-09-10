import { describe, it, expect } from 'vitest'
import { SHIP_GUN_SPECS } from '../../src/world/shipGuns'
import {
  SHIP_CLASSES, createShip, deckHeightOf, resetShip, stepShips,
} from '../../src/world/ships'
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
   * 【硬性不變量：船體盒不得包含任何砲位】包住的話，從上方來的子彈會在
   * 更早的物理步就被船體吃掉，**砲位永遠打不掉而且沒有任何錯誤** ——
   * 同一個物理步之內的優先權救不了跨步的問題，所以規則訂在資料這一層。
   */
  it('沒有任何砲位落在船體盒內', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      for (const z of cls.zones) {
        for (const b of cls.hull) {
          const inside = Math.abs(z.position.x - b.center.x) <= b.half.x
            && Math.abs(z.position.y - b.center.y) <= b.half.y
            && Math.abs(z.position.z - b.center.z) <= b.half.z
          expect(`${cls.id}/${z.id} 在盒內=${inside}`).toBe(`${cls.id}/${z.id} 在盒內=false`)
        }
      }
    }
  })

  /**
   * 【砲位也不得在任何盒的正下方】從上方來的子彈是垂直穿過盒子的柱體
   * 打下來的：砲位在盒的腳印裡、又比盒頂低，子彈一樣先被盒吃掉。Essex 的
   * 甲板盒因此只鋪中央那一條（|x| ≤ 12），砲廊上的砲位全在它旁邊。
   */
  it('沒有任何砲位在船體盒的正下方', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      for (const z of cls.zones) {
        for (const b of cls.hull) {
          const under = Math.abs(z.position.x - b.center.x) <= b.half.x
            && Math.abs(z.position.z - b.center.z) <= b.half.z
            && z.position.y < b.center.y + b.half.y
          expect(`${cls.id}/${z.id} 在盒下=${under}`).toBe(`${cls.id}/${z.id} 在盒下=false`)
        }
      }
    }
  })

  /**
   * 【Essex 的盒照 GLB】飛行甲板在 18.3、艦島到 41.6。甲板盒抬到真甲板之後
   * 炸彈才開在甲板上而不是甲板底下；艦島有盒飛機才撞得到。
   */
  it('Essex 的甲板在 18.3、艦島有盒', () => {
    const essex = SHIP_CLASSES.essex
    expect(deckHeightOf(essex)).toBeCloseTo(18.3, 6)
    const island = essex.hull.filter((b) => b.center.x - b.half.x >= 9)
    expect(island.length).toBeGreaterThanOrEqual(3)
    expect(Math.max(...island.map((b) => b.center.y + b.half.y))).toBeGreaterThan(40)
  })
})

describe('deckHeightOf', () => {
  /**
   * 【它是甲板，不是「船有多高」】它取的是**蓋住中線的盒**裡最高的盒頂：
   * 驅逐艦與巡洋艦的船體盒止於主甲板，Essex 的艦島雖然有盒、但不蓋中線，
   * 所以取到的是甲板。拿它當「整艘船的最高點」用的話，標記會插在艦橋中間。
   * 真正的最高點問的是模型 —— `render/ships.ts` 的 `shipModelTop`。
   */
  it('取蓋住中線的盒頂，艦島不算', () => {
    for (const id of ['fletcher', 'wichita', 'essex'] as const) {
      const cls = SHIP_CLASSES[id]
      const all = Math.max(...cls.hull.map((b) => b.center.y + b.half.y))
      const centre = Math.max(...cls.hull
        .filter((b) => Math.abs(b.center.x) <= b.half.x)
        .map((b) => b.center.y + b.half.y))
      expect(deckHeightOf(cls), id).toBeCloseTo(centre, 9)
      if (id === 'essex') expect(all).toBeGreaterThan(centre)
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

  /** 【不轉向】固定艏向、不閃避。 */
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

  /**
   * 【沉了要滑行，不是煞停】一萬噸的船在同一個物理步之內從 8 m/s 變成 0，
   * 畫面上像撞到牆。
   */
  it('沉了之後速度慢慢降、位置繼續前進', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 0, 0, 0, 8)
    s.alive = false
    for (let i = 0; i < 240; i++) stepShips([s], 1 / 240)
    expect(s.speed).toBeLessThan(8)
    expect(s.speed).toBeGreaterThan(0)
    expect(s.position.z).toBeLessThan(0)
  })

  /**
   * 【一定要真的停下來】用指數衰減的話它永遠到不了 0 —— 畫面上是一艘
   * 永遠在慢慢爬的船。
   */
  it('滑行到最後真的停住', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 0, 0, 0, 8)
    s.alive = false
    for (let i = 0; i < 120 * 240; i++) stepShips([s], 1 / 240)
    expect(s.speed).toBe(0)
    const z = s.position.z
    for (let i = 0; i < 240; i++) stepShips([s], 1 / 240)
    expect(s.position.z).toBe(z)
  })

  /** 【還活著就不減速】減速條件寫錯邊的話整支艦隊會慢慢停下來。 */
  it('活著的船速度不變', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 0, 0, 0, 8)
    for (let i = 0; i < 60 * 240; i++) stepShips([s], 1 / 240)
    expect(s.speed).toBe(8)
  })
})

describe('resetShip', () => {
  /**
   * 【航速也要復原】`speed` 從「固定不變」變成會被滑行歸零的欄位之後，
   * 不抄回去的話第二場的沉船從 0 起步 —— 而 `rematch` 那一組護欄比的是
   * 耗時，抓不到這件事。
   */
  it('航速回到開場值', () => {
    const s = createShip(0, SHIP_CLASSES.wichita, 'red', 0, 0, 0, 8)
    s.alive = false
    for (let i = 0; i < 120 * 240; i++) stepShips([s], 1 / 240)
    expect(s.speed).toBe(0)
    resetShip(s)
    expect(s.speed).toBe(8)
  })

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

describe('砲位的血量', () => {
  /**
   * 【上界是艦體血量】血量可以加倍，**但不超過船體
   * 血量**。砲位比船還耐打的話，「打掉防空砲」會變成比擊沉還難的事。
   *
   * 兩個尺度都要守：單一砲位不得超過最小的艦體，整艘船的砲位加起來也不得
   * 超過那一艘的艦體。
   */
  it('單一砲位的血量遠低於最小的艦體血量', () => {
    const hulls = Object.values(SHIP_CLASSES).map((c) => c.hp)
    const minHull = Math.min(...hulls)
    for (const [tier, spec] of Object.entries(SHIP_GUN_SPECS)) {
      expect(spec.hp, tier).toBeLessThan(minHull)
    }
  })

  it('整艘船的砲位血量加起來也不超過艦體', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      let total = 0
      for (const z of cls.zones) total += SHIP_GUN_SPECS[z.tier].hp
      expect(total, cls.id).toBeLessThan(cls.hp)
    }
  })
})
