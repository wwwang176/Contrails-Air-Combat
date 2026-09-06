import { describe, it, expect } from 'vitest'
import {
  BOMB_ENVELOPE, TORPEDO_ENVELOPE, canRelease, envelopeFor,
} from '../../src/weapons/releaseEnvelope'

const DEG = Math.PI / 180

/** 一組在兩張表裡都合法的基準狀態：平飛、100 m、80 m/s */
const LEVEL = { roll: 0, pitch: 0, agl: 100, tas: 80 }

function ok(env: typeof BOMB_ENVELOPE, o: Partial<typeof LEVEL> = {}): boolean {
  const s = { ...LEVEL, ...o }
  return canRelease(env, s.roll, s.pitch, s.agl, s.tas)
}

describe('投放包絡', () => {
  it('基準的平飛狀態在兩張表裡都投得出去', () => {
    expect(ok(BOMB_ENVELOPE)).toBe(true)
    expect(ok(TORPEDO_ENVELOPE)).toBe(true)
  })

  /**
   * 【負責人指定的那一條】「例如顛倒飛不能投彈」。
   */
  it('倒飛在兩張表裡都投不出去', () => {
    for (const env of [BOMB_ENVELOPE, TORPEDO_ENVELOPE]) {
      for (const roll of [180 * DEG, -180 * DEG, 91 * DEG, -91 * DEG, 120 * DEG]) {
        expect(ok(env, { roll })).toBe(false)
      }
    }
  })

  it('坡度看的是絕對值 —— 左右一樣', () => {
    for (const env of [BOMB_ENVELOPE, TORPEDO_ENVELOPE]) {
      const d = env.maxRoll * 0.5
      expect(ok(env, { roll: d })).toBe(ok(env, { roll: -d }))
      const over = env.maxRoll * 1.5
      expect(ok(env, { roll: over })).toBe(false)
      expect(ok(env, { roll: -over })).toBe(false)
    }
  })
})

describe('炸彈的包絡只擋退化狀態', () => {
  it('平飛時整條高度帶都投得出去，速度不設限', () => {
    for (const agl of [60, 200, 1000, 4000, 8000]) {
      for (const tas of [0, 50, 120, 300, 1e9]) {
        expect(ok(BOMB_ENVELOPE, { agl, tas })).toBe(true)
      }
    }
  })

  /** 【60 m 是自己的爆炸半徑的兩倍】基準彈 30 m */
  it('太低不能投 —— 會炸到自己', () => {
    expect(ok(BOMB_ENVELOPE, { agl: 59.9 })).toBe(false)
    expect(ok(BOMB_ENVELOPE, { agl: 60 })).toBe(true)
  })

  it('沒有高度上界', () => {
    expect(BOMB_ENVELOPE.maxAgl).toBe(Infinity)
    expect(ok(BOMB_ENVELOPE, { agl: 1e9 })).toBe(true)
  })

  it('大角度俯衝／拉起才擋得住', () => {
    expect(ok(BOMB_ENVELOPE, { pitch: 69 * DEG })).toBe(true)
    expect(ok(BOMB_ENVELOPE, { pitch: 71 * DEG })).toBe(false)
    expect(ok(BOMB_ENVELOPE, { pitch: -71 * DEG })).toBe(false)
  })
})

describe('魚雷的包絡：姿態與高度兩個維度', () => {
  it('坡度的上界', () => {
    expect(ok(TORPEDO_ENVELOPE, { roll: TORPEDO_ENVELOPE.maxRoll })).toBe(true)
    expect(ok(TORPEDO_ENVELOPE, { roll: TORPEDO_ENVELOPE.maxRoll * 1.01 })).toBe(false)
  })

  it('俯仰的上下界', () => {
    expect(ok(TORPEDO_ENVELOPE, { pitch: TORPEDO_ENVELOPE.maxPitch })).toBe(true)
    expect(ok(TORPEDO_ENVELOPE, { pitch: TORPEDO_ENVELOPE.maxPitch + 0.01 })).toBe(false)
    expect(ok(TORPEDO_ENVELOPE, { pitch: TORPEDO_ENVELOPE.minPitch })).toBe(true)
    expect(ok(TORPEDO_ENVELOPE, { pitch: TORPEDO_ENVELOPE.minPitch - 0.01 })).toBe(false)
  })

  it('高度的上下界 —— 太高雷體會折斷，太低來不及定深', () => {
    expect(ok(TORPEDO_ENVELOPE, { agl: TORPEDO_ENVELOPE.minAgl })).toBe(true)
    expect(ok(TORPEDO_ENVELOPE, { agl: TORPEDO_ENVELOPE.minAgl - 0.1 })).toBe(false)
    expect(ok(TORPEDO_ENVELOPE, { agl: TORPEDO_ENVELOPE.maxAgl })).toBe(true)
    expect(ok(TORPEDO_ENVELOPE, { agl: TORPEDO_ENVELOPE.maxAgl + 0.1 })).toBe(false)
  })

  /**
   * 【負責人 2026-09-06】「魚雷包絡先不要限制飛機速度好了，不然很難投彈」。
   * 欄位仍然留著 —— 重新開限制時改的是一個數字。
   */
  it('不限速度', () => {
    expect(TORPEDO_ENVELOPE.minTas).toBe(0)
    expect(TORPEDO_ENVELOPE.maxTas).toBe(Infinity)
    for (const tas of [0, 40, 80, 200, 1e9]) {
      expect(ok(TORPEDO_ENVELOPE, { tas })).toBe(true)
    }
  })

  it('比炸彈的嚴 —— 每一個維度都不寬於它', () => {
    expect(TORPEDO_ENVELOPE.maxRoll).toBeLessThan(BOMB_ENVELOPE.maxRoll)
    expect(TORPEDO_ENVELOPE.maxPitch).toBeLessThan(BOMB_ENVELOPE.maxPitch)
    expect(TORPEDO_ENVELOPE.minPitch).toBeGreaterThan(BOMB_ENVELOPE.minPitch)
    expect(TORPEDO_ENVELOPE.maxAgl).toBeLessThan(BOMB_ENVELOPE.maxAgl)
  })
})

describe('envelopeFor', () => {
  it('掛什麼就用哪一張', () => {
    expect(envelopeFor('bomb')).toBe(BOMB_ENVELOPE)
    expect(envelopeFor('torpedo')).toBe(TORPEDO_ENVELOPE)
  })
})

describe('退化的輸入', () => {
  it('NaN 一律投不出去 —— 讀不到姿態時不該放行', () => {
    expect(ok(TORPEDO_ENVELOPE, { roll: NaN })).toBe(false)
    expect(ok(TORPEDO_ENVELOPE, { pitch: NaN })).toBe(false)
    expect(ok(TORPEDO_ENVELOPE, { agl: NaN })).toBe(false)
    expect(ok(BOMB_ENVELOPE, { agl: NaN })).toBe(false)
  })
})
