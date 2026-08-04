import { describe, it, expect } from 'vitest'
import { DEG } from '../../src/core/math'
import {
  angleDelta, damageWindow, markAngle, markOffAxis,
  createDamageMarks, pushDamageMark, stepDamageMarks, resetDamageMarks,
  DAMAGE_HALF_WIDTH, DAMAGE_MARK_CAPACITY, DAMAGE_MARK_SECONDS,
  type DamageMark,
} from '../../src/hud/damageMarks'

/** 視角座標的一筆痕跡。x=右 y=上 z=後 */
function mark(x: number, y: number, z: number): DamageMark {
  return { x, y, z, intensity: 1 }
}

describe('markAngle', () => {
  it('正右是 0、正上是 π/2', () => {
    expect(markAngle(mark(1, 0, 0))).toBeCloseTo(0, 6)
    expect(markAngle(mark(0, 1, 0))).toBeCloseTo(Math.PI / 2, 6)
  })

  it('「右上 15°」就是 15° —— 專案負責人原話裡的那個例子', () => {
    // 右上 15° 指的是螢幕上偏離正右 15°：右上多一點、右下少一點。
    const m = mark(Math.cos(15 * DEG), Math.sin(15 * DEG), 0)
    expect(markAngle(m) / DEG).toBeCloseTo(15, 6)
  })
})

describe('markOffAxis', () => {
  it('正側面是 1', () => {
    expect(markOffAxis(mark(1, 0, 0))).toBeCloseTo(1, 6)
  })

  it('正後方與正前方都是 0 —— 畫面上沒有角度可言', () => {
    // 【為什麼兩者相同】spec §10：兩者都畫整圈，刻意不區分。
    expect(markOffAxis(mark(0, 0, 1))).toBeCloseTo(0, 6)
    expect(markOffAxis(mark(0, 0, -1))).toBeCloseTo(0, 6)
  })

  it('斜後方 45° 是 sin 45°', () => {
    const s = Math.SQRT1_2
    expect(markOffAxis(mark(s, 0, s))).toBeCloseTo(s, 6)
  })
})

describe('angleDelta', () => {
  it('跨過 ±π 取最短的那一邊', () => {
    // 179° 與 −179° 相距 2°（不是 358°），而 179° 落在 −179° 的**負向**那側
    expect(angleDelta(179 * DEG, -179 * DEG) / DEG).toBeCloseTo(-2, 6)
    expect(angleDelta(-179 * DEG, 179 * DEG) / DEG).toBeCloseTo(2, 6)
  })

  it('絕對值就是兩個角度的最短距離', () => {
    // 【為什麼補這一條】上面那條連號誌一起釘住，容易看成「號誌是對的所以
    // 距離也是對的」。距離是角度窗真正用到的量，值得自己一條。
    expect(Math.abs(angleDelta(179 * DEG, -179 * DEG)) / DEG).toBeCloseTo(2, 6)
    expect(Math.abs(angleDelta(10 * DEG, 350 * DEG)) / DEG).toBeCloseTo(20, 6)
  })

  it('結果永遠落在 −π..π', () => {
    for (let a = -720; a <= 720; a += 17) {
      for (let b = -720; b <= 720; b += 23) {
        const d = angleDelta(a * DEG, b * DEG)
        expect(d).toBeGreaterThanOrEqual(-Math.PI - 1e-9)
        expect(d).toBeLessThanOrEqual(Math.PI + 1e-9)
      }
    }
  })
})

describe('damageWindow', () => {
  const H = DAMAGE_HALF_WIDTH

  it('offAxis = 1：中心是 1、半寬之外是 0', () => {
    expect(damageWindow(0, H, 1)).toBeCloseTo(1, 6)
    expect(damageWindow(H, H, 1)).toBeCloseTo(0, 6)
    expect(damageWindow(H * 1.5, H, 1)).toBe(0)
    expect(damageWindow(-H * 1.5, H, 1)).toBe(0)
  })

  it('offAxis = 0：任何角度都是 1 —— 正後方就是整圈', () => {
    // 【這是主幹不是特例】追尾視角下被咬六點是最常見的中彈方式，而那個
    // 方向正好投影在畫面正中央（spec §2.1）。
    for (let a = -180; a <= 180; a += 15) {
      expect(damageWindow(a * DEG, H, 0)).toBeCloseTo(1, 6)
    }
  })

  it('offAxis = 0.5：最遠處剩一半的底，中心仍然是 1', () => {
    expect(damageWindow(0, H, 0.5)).toBeCloseTo(1, 6)
    expect(damageWindow(Math.PI, H, 0.5)).toBeCloseTo(0.5, 6)
  })

  it('左右對稱', () => {
    expect(damageWindow(0.4, H, 1)).toBeCloseTo(damageWindow(-0.4, H, 1), 9)
  })

  it('在半寬處平滑落地 —— 斜率為 0，所以看不見折痕', () => {
    // 【為什麼是升餘弦而不是線性】線性衰減會在光消失的那個角度留下一道
    // 看得見的折痕（spec §4.2）。斜率為 0 是「看不見」的可測形式。
    const eps = 1e-4
    const slope = (damageWindow(H, H, 1) - damageWindow(H - eps, H, 1)) / eps
    expect(Math.abs(slope)).toBeLessThan(1e-3)
  })

  it('中心也是平的 —— 兩端斜率都是 0', () => {
    const eps = 1e-4
    const slope = (damageWindow(eps, H, 1) - damageWindow(0, H, 1)) / eps
    expect(Math.abs(slope)).toBeLessThan(1e-3)
  })
})

/** 目前還亮著的痕跡 */
function live(marks: DamageMark[]): DamageMark[] {
  return marks.filter((m) => m.intensity > 0)
}

describe('痕跡池', () => {
  it('建出固定容量、全空的池', () => {
    const marks = createDamageMarks()
    expect(marks.length).toBe(DAMAGE_MARK_CAPACITY)
    expect(live(marks).length).toBe(0)
  })

  it('推一發就佔一格，強度是 1', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    expect(live(marks).length).toBe(1)
    expect(live(marks)[0]!.intensity).toBe(1)
  })

  it('幾乎平行的兩發只佔一格，而且方向不動', () => {
    // 【為什麼方向不能動】動了的話連射會讓那團光左右抖。一個攻擊者應該是
    // 一團持續亮著，不是六十團（spec §4.1）。
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS / 2)
    pushDamageMark(marks, Math.cos(10 * DEG), Math.sin(10 * DEG), 0)

    expect(live(marks).length).toBe(1)
    const m = live(marks)[0]!
    expect(m.intensity).toBe(1)
    expect(m.x).toBe(1)
    expect(m.y).toBe(0)
  })

  it('相反方向佔兩格 —— 兩邊夾擊要看得出來', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    pushDamageMark(marks, -1, 0, 0)
    expect(live(marks).length).toBe(2)
  })

  it('正後方來的兩發併成一格 —— 用 3D 方向判斷才擋得住這個退化情形', () => {
    // 【為什麼不用螢幕角度判斷】正後方來的兩發都投影在畫面中心，
    // atan2(0, 0) 沒有意義；但 3D 方向幾乎平行（spec §4.1）。
    const marks = createDamageMarks()
    pushDamageMark(marks, 0, 0, 1)
    pushDamageMark(marks, 0.05, -0.05, Math.sqrt(1 - 0.005))
    expect(live(marks).length).toBe(1)
  })

  it('池滿了就佔強度最小的那一格', () => {
    const marks = createDamageMarks()
    // 先塞滿 CAPACITY 個彼此相距 60° 的方向（> 30° 所以不會互相合併）
    for (let i = 0; i < DAMAGE_MARK_CAPACITY; i++) {
      const a = i * 60 * DEG
      pushDamageMark(marks, Math.cos(a), Math.sin(a), 0)
      // 每一發之間淡一點，最早的那一發最弱
      stepDamageMarks(marks, DAMAGE_MARK_SECONDS / 20)
    }
    expect(live(marks).length).toBe(DAMAGE_MARK_CAPACITY)
    const weakest = marks.reduce((a, b) => (a.intensity <= b.intensity ? a : b))
    expect(weakest.x).toBeCloseTo(1, 6)

    // 第七個方向（與所有既有方向都超過 30°）擠掉最弱的那一格
    pushDamageMark(marks, 0, 0, 1)
    expect(live(marks).length).toBe(DAMAGE_MARK_CAPACITY)
    expect(marks.some((m) => m.z === 1 && m.intensity === 1)).toBe(true)
    expect(marks.some((m) => m.x === 1 && m.y === 0)).toBe(false)
  })

  it('DAMAGE_MARK_SECONDS 之後歸零，而且不會變成負數', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS)
    expect(marks[0]!.intensity).toBe(0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS)
    expect(marks[0]!.intensity).toBe(0)
  })

  it('線性淡出：一半的時間剩一半的強度', () => {
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    stepDamageMarks(marks, DAMAGE_MARK_SECONDS / 2)
    expect(marks[0]!.intensity).toBeCloseTo(0.5, 6)
  })

  it('reset 把全部歸零', () => {
    // 【為什麼需要】不清的話上一場的紅邊會留到新的一場（spec §6.2）。
    const marks = createDamageMarks()
    pushDamageMark(marks, 1, 0, 0)
    pushDamageMark(marks, -1, 0, 0)
    resetDamageMarks(marks)
    expect(live(marks).length).toBe(0)
  })
})
