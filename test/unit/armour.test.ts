import { describe, it, expect } from 'vitest'
import { NO_PENETRATION_DAMAGE, penetrationDamage } from '../../src/weapons/armour'
import { SHIP_CLASSES } from '../../src/world/ships'
import { SHIP_GUN_SPECS } from '../../src/world/shipGuns'
import { A6M5 } from '../../src/specs/a6m5'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { KI84 } from '../../src/specs/ki84'
import { F4F4 } from '../../src/specs/f4f4'
import { F6F5 } from '../../src/specs/f6f5'
import { G4M } from '../../src/specs/g4m'
import { B17G } from '../../src/specs/b17g'
import { HE111 } from '../../src/specs/he111'

/**
 * # 口徑免疫
 *
 * 一條規則、一支函數，**每一次子彈結算都問它**。哪裡會咬人由資料決定：
 * 裝甲值 0 = 任何口徑都打得穿，而目前只有船體填了非零的值。
 */
describe('penetrationDamage', () => {
  it('裝甲 0 時原值通過', () => {
    expect(penetrationDamage(37, 7.7, 0)).toBe(37)
    expect(penetrationDamage(37, 0, 0)).toBe(37)
  })

  it('口徑打得穿就是原值', () => {
    expect(penetrationDamage(100, 20, 20)).toBe(100)
    expect(penetrationDamage(100, 30, 20)).toBe(100)
  })

  /**
   * 【穿不了也要扣 1】免疫要有底線。單發 1 點之下，六百發打中六萬血的
   * 航母只扣 600 —— 實質免疫，但不是無敵。
   */
  it('口徑打不穿就只扣地板值', () => {
    expect(penetrationDamage(100, 7.7, 20)).toBe(NO_PENETRATION_DAMAGE)
    expect(penetrationDamage(100, 12.7, 102)).toBe(NO_PENETRATION_DAMAGE)
  })

  /** 【地板不會把小傷害放大】穿不了的那一發不該比穿得過的還痛 */
  it('原值低於地板時取原值', () => {
    expect(penetrationDamage(0.4, 7.7, 20)).toBe(0.4)
  })
})

describe('口徑資料', () => {
  const specs = [A6M5, P51D, BF109K4, KI84, F4F4, F6F5, G4M, B17G, HE111]

  /** 【每一挺都要有】漏填的那一挺會被當成 0，對任何裝甲都打不穿 */
  it('每一款飛機的槍都填了正的口徑', () => {
    for (const s of specs) {
      for (const m of s.battery.mounts) {
        expect(m.weapon.caliber, `${s.id} / ${m.weapon.name}`).toBeGreaterThan(0)
      }
      expect(s.battery.sight.caliber, s.id).toBeGreaterThan(0)
    }
  })

  it('船上的三級防空砲也填了', () => {
    for (const tier of Object.values(SHIP_GUN_SPECS)) {
      expect(tier.caliber).toBeGreaterThan(0)
    }
  })
})

describe('艦種的裝甲', () => {
  /**
   * 【驅逐艦擋不住機砲】弗萊徹沒有裝甲帶，船殼只有半吋級的鋼板 —— 20 mm
   * 打得動它，而那正是掃射驅逐艦在史實上有意義的原因。
   */
  it('驅逐艦擋得住步槍口徑，擋不住 20 mm', () => {
    const a = SHIP_CLASSES.fletcher.armour
    expect(penetrationDamage(100, 7.7, a)).toBe(NO_PENETRATION_DAMAGE)
    expect(penetrationDamage(100, 20, a)).toBe(100)
  })

  /**
   * 【巡洋艦與航母擋得住場上每一挺槍】機槍打不沉主力艦。要害在甲板上的
   * 砲位與人員，而那幾個盒子的裝甲是 0，照樣打得掉。
   */
  it('巡洋艦與航母擋得住 30 mm 以下的一切', () => {
    for (const cls of [SHIP_CLASSES.wichita, SHIP_CLASSES.essex]) {
      expect(penetrationDamage(100, 30, cls.armour), cls.id).toBe(NO_PENETRATION_DAMAGE)
    }
  })

  /** 【砲位不吃裝甲】它是甲板上的一座露天砲，不是艦體 */
  it('砲位沒有裝甲那一格', () => {
    for (const tier of Object.values(SHIP_GUN_SPECS)) {
      expect(penetrationDamage(100, 7.7, 0), String(tier.caliber)).toBe(100)
    }
  })
})
