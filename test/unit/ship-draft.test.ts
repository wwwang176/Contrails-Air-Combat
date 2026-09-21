import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { SHIP_CLASSES } from '../../src/world/ships'
import { flashScale } from '../../src/render/ships'
import { pointBoxDistance, type Box } from '../../src/world/hit'
import { BOMB_BLAST_DAMAGE, bombBlastDamage } from '../../src/weapons/bomb'

/**
 * # 船的吃水
 *
 * 命中盒原本的底都在水線（y = 0），水下什麼都沒有 —— 定深 1 m 的魚雷會從
 * 每一艘船的底下穿過去，而且**不報錯**：看起來像沒瞄準，不像 bug。與
 * `ShipClass.radius` 那條註解是同一種病。
 *
 * 這一份守兩件事：盒真的往下拉了，而且**炸彈的近失傷害逐位元不變**。
 */

/** 盒的最低點與最高點，艦體座標 */
const bottom = (b: Box): number => b.center.y - b.half.y
const top = (b: Box): number => b.center.y + b.half.y

describe('艦體盒有水下的部分', () => {
  it('三個艦級的吃水就是這三個數字', () => {
    expect(bottom(SHIP_CLASSES.fletcher.hull[0]!)).toBeCloseTo(-4.0, 9)
    expect(bottom(SHIP_CLASSES.wichita.hull[0]!)).toBeCloseTo(-6.5, 9)
    expect(bottom(SHIP_CLASSES.essex.hull[0]!)).toBeCloseTo(-8.5, 9)
  })

  /**
   * 【盒頂不得順手動到】它是「盒頂一律低於最低的砲位」那條護欄的另一半，
   * 也是 §4.1 逐位元不變的前提 —— 垂直距離只跟盒頂有關。
   */
  it('盒頂一個都沒動', () => {
    expect(top(SHIP_CLASSES.fletcher.hull[0]!)).toBeCloseTo(4.5, 9)
    expect(top(SHIP_CLASSES.wichita.hull[0]!)).toBeCloseTo(7.0, 9)
    expect(top(SHIP_CLASSES.essex.hull[0]!)).toBeCloseTo(12.0, 9)
  })

  /**
   * 【飛行甲板不是艦體】Essex 的第二個盒是甲板，一片薄板貼在真甲板的高度
   * —— 它跟著艦體一起往下拉的話，甲板會變成一塊實心板。
   */
  it('Essex 的飛行甲板是貼在 18.3 的薄板', () => {
    const deck = SHIP_CLASSES.essex.hull[1]!
    expect(bottom(deck)).toBeCloseTo(17.7, 9)
    expect(top(deck)).toBeCloseTo(18.3, 9)
  })

  it('每個艦級都有一個伸到水線下的盒', () => {
    for (const cls of Object.values(SHIP_CLASSES)) {
      expect(Math.min(...cls.hull.map(bottom)), cls.id).toBeLessThan(0)
    }
  })
})

/**
 * 同一個盒，但底切回水線。**用真的盒推出來，不是抄一份座標** —— 抄的話
 * 日後改了盒頂，這一份會靜靜地量錯東西。
 */
function bottomAtWaterline(b: Box): Box {
  const t = top(b)
  return {
    center: new Vector3(b.center.x, t / 2, b.center.z),
    half: new Vector3(b.half.x, t / 2, b.half.z),
  }
}

describe('把盒底往下拉，對炸彈是零影響', () => {
  /**
   * 【為什麼這一條非有不可】整個改動押在「炸彈的爆心到不了水線之下」上：
   * 落水的那一顆 `y` 是 `collisionHeightAt` 的 0，打中船的那一顆是
   * `segmentBox` 的進入點，而炸彈由上而下，進入面恆是盒頂。
   *
   * 【殺傷半徑取得比吃水大】用基準彈的 30 m 的話，差異會被「反正都在半徑
   * 外」蓋掉 —— 那樣改壞了也不會紅。
   */
  it('水線以上的每一個爆心，傷害逐位元相同', () => {
    const damage = BOMB_BLAST_DAMAGE * 2 // 半徑 60 m，比任何一個吃水都深
    let checked = 0
    for (const cls of Object.values(SHIP_CLASSES)) {
      for (const box of cls.hull) {
        if (bottom(box) >= 0) continue
        const old = bottomAtWaterline(box)
        for (const y of [0, 1, 2, 4, 7, 12, 14, 25]) {
          for (let x = -30; x <= 30; x += 2.5) {
            for (let z = -150; z <= 150; z += 7.5) {
              const a = bombBlastDamage(pointBoxDistance(x, y, z, old), damage)
              const b = bombBlastDamage(pointBoxDistance(x, y, z, box), damage)
              expect(Object.is(a, b), `${cls.id} y=${y} x=${x} z=${z}`).toBe(true)
              checked++
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20_000)
  })

  /**
   * 【對照組】水線**之下**確實會變 —— 少了它，上面那一條可能只是因為
   * 取樣點都在殺傷半徑外而全等。
   */
  it('水線之下確實變了 —— 上面那一條不是因為都在半徑外', () => {
    const damage = BOMB_BLAST_DAMAGE * 2
    const box = SHIP_CLASSES.fletcher.hull[0]!
    const old = bottomAtWaterline(box)
    const a = bombBlastDamage(pointBoxDistance(0, -2, 0, old), damage)
    const b = bombBlastDamage(pointBoxDistance(0, -2, 0, box), damage)
    expect(a).not.toBe(b)
    expect(b).toBeGreaterThan(a)
  })
})

/**
 * 【五吋砲的火光要比 20 mm 大】三層砲原本共用同一個大小。那一聲巨響沒有對應的
 * 畫面，而聲音本來就有音速延遲（200 m 外半秒多）—— 看起來就像慢半拍。
 */
describe('艦砲槍焰的大小', () => {
  it('口徑越大火光越大：20 mm 是 1 倍，五吋約 3.6 倍', () => {
    expect(flashScale(20)).toBeCloseTo(1, 6)
    expect(flashScale(40)).toBeCloseTo(1.62, 2)
    expect(flashScale(127)).toBeCloseTo(3.65, 2)
  })

  it('口徑為零也不會變成零或負的', () => {
    expect(flashScale(0)).toBeGreaterThan(0)
    expect(Number.isFinite(flashScale(-5))).toBe(true)
  })
})
