import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  WRECK_AUTOROTATION, WRECK_MIN_SPEED,
  autorotationRate, seedWreckSpin, stepWreckSpin,
} from '../../src/render/wreckAero'
import { B17G } from '../../src/specs/b17g'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * # 殘骸的角向氣動
 *
 * 純表現：不進判定、不影響任何模擬。所以它住在算繪層，與 `tumble.ts`
 * 同一個性質 —— 但它是積分而不是年齡的純函數，因為轉速要隨機體大小、
 * 速度與阻尼自己找到平衡。
 *
 * 【這一支守的是什麼】三件靜靜壞掉的事：轟炸機與戰鬥機轉得一樣快（就是
 * 這一層存在的理由）、轉速衰減到零讓殘骸像磚頭一樣僵直落下、以及低速時
 * 無因次角速率除以速度而爆掉。
 */

const DT = 1 / 60

/** 一具殘骸的角向狀態積分 `seconds` 秒，回傳最後的角速度大小 */
function settle(spec: AircraftSpec, speed: number, seed: number, seconds: number): number {
  const w = new Vector3()
  seedWreckSpin(spec, speed, seed, w)
  const q = new Quaternion()
  // 【速度朝 −Z】機首方向與速度一致，迎角從 0 開始
  for (let i = 0; i < seconds / DT; i++) {
    stepWreckSpin(spec, 0, 0, -speed, 3000, q, w, DT)
  }
  return w.length()
}

describe('autorotationRate：平衡轉速', () => {
  /**
   * 【這就是這一層存在的理由】固定角速度上限之下，B-17 與 Bf 109 亂轉得
   * 一樣快。平衡轉速是 `AUTOROT × 2V / 翼展` —— 翼展大的轉得慢。
   */
  it('轟炸機的平衡轉速明顯低於戰鬥機', () => {
    const v = 120
    const bomber = autorotationRate(B17G, v)
    const fighter = autorotationRate(BF109K4, v)
    expect(bomber).toBeGreaterThan(0)
    // 翼展 31.62 對 9.87 —— 比值就是它
    expect(fighter / bomber).toBeCloseTo(B17G.wing.span / BF109K4.wing.span, 6)
    expect(fighter / bomber).toBeGreaterThan(3)
  })

  it('速度越快轉得越快，正比', () => {
    expect(autorotationRate(P51D, 160)).toBeCloseTo(autorotationRate(P51D, 80) * 2, 6)
  })

  /**
   * 【速度有下限】平衡轉速正比於速度，而無因次角速率是**除以**速度的。
   * 沒有下限的話速度趨近零時力矩會爆掉 —— 而殘骸在水面下確實會被減速。
   */
  it('速度低於下限時當成下限，不會歸零也不會爆掉', () => {
    const slow = autorotationRate(P51D, 0)
    expect(slow).toBe(autorotationRate(P51D, WRECK_MIN_SPEED))
    expect(Number.isFinite(slow)).toBe(true)
    expect(slow).toBeGreaterThan(0)
  })

  /**
   * 【下限擋的是「幾乎不轉」】每秒 15 度在六十秒的墜落裡是兩圈半 —— 低於
   * 它，殘骸看起來會像一塊姿態鎖死的磚頭。上限擋的是「快到看不出機型」。
   */
  it('戰鬥機在終端速度下的平衡轉速落在合理範圍', () => {
    const deg = (autorotationRate(BF109K4, 80) * 180) / Math.PI
    expect(deg).toBeGreaterThan(15)
    expect(deg).toBeLessThan(240)
  })
})

describe('seedWreckSpin：爆炸那一下的角衝量', () => {
  /** 【三軸都要有】只給一軸的話每一具殘骸都繞同一個軸轉，那是機械式旋轉 */
  it('三軸都非零，而且量級在平衡轉速附近', () => {
    const w = new Vector3()
    seedWreckSpin(BF109K4, 120, 7, w)
    const eq = autorotationRate(BF109K4, 120)
    for (const c of [w.x, w.y, w.z]) {
      expect(Math.abs(c)).toBeGreaterThan(0)
      expect(Math.abs(c)).toBeLessThanOrEqual(eq * 1.5 + 1e-9)
    }
  })

  /** 【同一個種子恆得同一種翻法】與專案其他隨機同一條紀律 */
  it('決定性：同一個種子逐位元相同', () => {
    const a = new Vector3()
    const b = new Vector3()
    seedWreckSpin(P51D, 120, 42, a)
    seedWreckSpin(P51D, 120, 42, b)
    expect(a.x).toBe(b.x)
    expect(a.y).toBe(b.y)
    expect(a.z).toBe(b.z)
  })

  it('不同種子翻得不一樣', () => {
    const a = new Vector3()
    const b = new Vector3()
    seedWreckSpin(P51D, 120, 1, a)
    seedWreckSpin(P51D, 120, 2, b)
    expect(a.equals(b)).toBe(false)
  })

  /** 【方向要有正有負】只取正的話所有殘骸都朝同一邊翻 */
  it('取樣夠多時每一軸正負都出現', () => {
    const w = new Vector3()
    let pos = 0
    let neg = 0
    for (let s = 0; s < 60; s++) {
      seedWreckSpin(P51D, 120, s, w)
      if (w.z > 0) pos++
      else neg++
    }
    expect(pos).toBeGreaterThan(5)
    expect(neg).toBeGreaterThan(5)
  })
})

describe('stepWreckSpin：收斂到平衡而不是停下來', () => {
  /**
   * 【不可以衰減到零】只有阻尼項的話 B-17 的滾轉時間常數約 0.2 秒 ——
   * 殘骸在半秒內就完全不轉，剩下六十秒像一塊磚頭直直落下。自轉平衡就是
   * 補這個洞的：低於平衡轉速時氣動力**推**它，高於才阻尼。
   */
  for (const [name, spec] of [['B-17G', B17G], ['Bf 109 K-4', BF109K4]] as [string, AircraftSpec][]) {
    it(`${name}：五秒之後仍在轉，而且收斂到平衡轉速附近`, () => {
      const speed = 120
      const eq = autorotationRate(spec, speed)
      const end = settle(spec, speed, 3, 5)
      expect(end).toBeGreaterThan(eq * 0.5)
      expect(end).toBeLessThan(eq * 2.5)
    })
  }

  /**
   * 【從零也要轉起來】殘骸的角速度被某條路徑清成零時（例如接管前的模型
   * 姿態剛好靜止），只有阻尼的模型會永遠停在那裡。
   */
  it('角速度為零時會被推離，不會卡住', () => {
    const w = new Vector3()
    const q = new Quaternion()
    for (let i = 0; i < 120; i++) stepWreckSpin(BF109K4, 0, 0, -120, 3000, q, w, DT)
    expect(w.length()).toBeGreaterThan(autorotationRate(BF109K4, 120) * 0.3)
  })

  /**
   * 【不可以發散】高於平衡轉速時要被拉回來。
   *
   * 【三軸都要給】只繞單一主慣性軸轉的話陀螺項 `ω × Iω` 恰為零，而那正是
   * 會讓顯式 Euler 灌入數值能量的那一項 —— 只轉一軸的版本抓不到發散。
   */
  it('起始轉速遠高於平衡時會被拉回來', () => {
    const speed = 120
    const eq = autorotationRate(BF109K4, speed)
    const w = new Vector3(eq * 8, eq * 5, eq * 6)
    const q = new Quaternion()
    for (let i = 0; i < 5 / DT; i++) stepWreckSpin(BF109K4, 0, 0, -speed, 3000, q, w, DT)
    expect(w.length()).toBeLessThan(eq * 3)
  })

  /**
   * 【掉幀不可以炸掉】呼叫端傳的是**畫面時間**：`main.ts` 沒有上限，
   * `tools/range.ts` 夾在 0.25 秒。陀螺項 `ω × Iω` 在顯式 Euler 下會灌入
   * 數值能量，單步大 dt 會正回饋 —— 實測 dt = 0.1 時 Bf 109 的角速率在
   * 五秒內衝到 10⁹ rad/s。角向積分必須自己分子步。
   */
  for (const bigDt of [0.1, 0.25]) {
    it(`dt = ${bigDt} 秒時角速度仍然有界`, () => {
      const speed = 200
      const eq = autorotationRate(BF109K4, speed)
      const w = new Vector3()
      seedWreckSpin(BF109K4, speed, 0, w)
      const q = new Quaternion()
      for (let i = 0; i < 8 / bigDt; i++) {
        stepWreckSpin(BF109K4, 0, 0, -speed, 3000, q, w, bigDt)
        expect(Number.isFinite(w.length())).toBe(true)
      }
      expect(w.length()).toBeLessThan(eq * 3)
    })
  }

  /**
   * 【大 dt 與小 dt 要收斂到同一個平衡】分子步之後兩者只差在到達平衡的
   * 路徑，終點必須一樣。
   */
  it('大 dt 與小 dt 收斂到同一個平衡轉速', () => {
    const speed = 150
    const coarse = new Vector3()
    const fine = new Vector3()
    seedWreckSpin(BF109K4, speed, 4, coarse)
    seedWreckSpin(BF109K4, speed, 4, fine)
    const qa = new Quaternion()
    const qb = new Quaternion()
    for (let i = 0; i < 6 / 0.2; i++) stepWreckSpin(BF109K4, 0, 0, -speed, 3000, qa, coarse, 0.2)
    for (let i = 0; i < 6 / DT; i++) stepWreckSpin(BF109K4, 0, 0, -speed, 3000, qb, fine, DT)
    expect(coarse.length()).toBeCloseTo(fine.length(), 1)
  })

  /** 【姿態要維持單位四元數】不正規化的話矩陣會慢慢把模型拉歪 */
  it('姿態四元數保持單位長度', () => {
    const w = new Vector3()
    seedWreckSpin(P51D, 150, 11, w)
    const q = new Quaternion()
    for (let i = 0; i < 20 / DT; i++) stepWreckSpin(P51D, 0, 0, -150, 3000, q, w, DT)
    expect(q.length()).toBeCloseTo(1, 9)
  })

  /** 【姿態真的有在轉】只積分角速度卻忘了寫回四元數不會報錯 */
  it('姿態隨時間改變', () => {
    const w = new Vector3()
    seedWreckSpin(P51D, 150, 5, w)
    const q = new Quaternion()
    const start = q.clone()
    for (let i = 0; i < 30; i++) stepWreckSpin(P51D, 0, 0, -150, 3000, q, w, DT)
    expect(q.angleTo(start)).toBeGreaterThan(0.1)
  })

  /**
   * 【轟炸機整段都轉得比戰鬥機慢】平衡轉速那一條是靜態的比較；這一條走
   * 完整的積分，把陀螺耦合與慣性矩一起算進去。
   */
  it('同樣的種子與速度下，B-17 全程轉得比 Bf 109 慢', () => {
    const speed = 120
    expect(settle(B17G, speed, 9, 5)).toBeLessThan(settle(BF109K4, speed, 9, 5))
  })

  /** 【高空收斂慢，但平衡點一樣】空氣稀薄只改變到達平衡的快慢 */
  it('平衡轉速不隨高度改變', () => {
    const speed = 120
    const eq = autorotationRate(BF109K4, speed)
    const w = new Vector3()
    const q = new Quaternion()
    for (let i = 0; i < 20 / DT; i++) stepWreckSpin(BF109K4, 0, 0, -speed, 9000, q, w, DT)
    expect(w.length()).toBeGreaterThan(eq * 0.5)
    expect(w.length()).toBeLessThan(eq * 2.5)
  })

  /** 【不配置】熱路徑每幀每具殘骸一次 */
  it('不回傳新物件，就地寫入', () => {
    const w = new Vector3(1, 2, 3)
    const q = new Quaternion()
    const same = stepWreckSpin(BF109K4, 0, 0, -120, 3000, q, w, DT)
    expect(same).toBeUndefined()
  })

  it('WRECK_AUTOROTATION 是無因次的，落在 0 到 1 之間', () => {
    expect(WRECK_AUTOROTATION).toBeGreaterThan(0)
    expect(WRECK_AUTOROTATION).toBeLessThan(1)
  })
})
