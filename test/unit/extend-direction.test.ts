import { describe, it, expect } from 'vitest'
import { extendPitchAngle, DEFAULT_STEER } from '../../src/ai/steer'

/**
 * `extend` 的俯仰**方向**。
 *
 * 【它修的是什麼】舊版的速度赤字只跟**自己**比（`1 − cornerRatio`）。遠距離
 * 時沒有人在拉桿，TAS 自然貼近極速，於是每一架都判定「我速度過剩」而爬升
 * —— 包括那架其實比對手慢 28 m/s 的護航 Bf 109。實測它因此滿舵爬升 25°
 * （`pitchSpeedGain = 4 × extendPitch`，`cornerRatio` 超過 1.25 就飽和），
 * 累積 445 m 高度卻永遠花不掉。
 *
 * 【新規則】速度赤字取「相對自己」與「相對敵人」的**較大值**。
 *
 * 【檔名為什麼不叫 `extend-pitch`】`test/tools/extend-pitch.probe.ts` 已經
 * 存在，同名會讓「哪一個是護欄、哪一個是量測」變得要看目錄才分得出來。
 */
describe('extend 的俯仰方向', () => {
  /** 高空，讓離地餘裕那一項恆為 0，才量得到純粹的速度項 */
  const HIGH = 4000
  /** 相對敵人完全沒有赤字 —— 這幾條只測自我赤字那一半 */
  const NO_FOE = Infinity

  it('化簡等價：max 等於 (max(Vc, Vt) − Vs) / Vc', () => {
    // 【為什麼要測一條代數恆等式】「新規則在說什麼」那一節的整個推論建立在
    // 這個化簡上：**只有我的 TAS 同時高過自己的角落速度與敵人的 TAS 才爬升**。
    // 它若不成立，那一節就是錯的。
    const cases: readonly (readonly [number, number, number])[] = [
      [176, 160, 208], [200, 180, 150], [120, 160, 130], [240, 160, 100],
    ]
    for (const [vs, vc, vt] of cases) {
      const got = extendPitchAngle(vs / vc, (vs - vt) / vc, HIGH)
      const deficit = (Math.max(vc, vt) - vs) / vc
      const raw = -DEFAULT_STEER.pitchSpeedGain * deficit
      const want = Math.max(
        -DEFAULT_STEER.extendPitch, Math.min(DEFAULT_STEER.extendPitch, raw),
      )
      expect(got).toBeCloseTo(want, 9)
    }
  })

  it('比敵人慢很多時恆為低頭 —— 不管自己的 cornerRatio 多高', () => {
    // 這就是護航 Bf 109 的局面：cornerRatio 1.59（相對自己過剩），但比敵人
    // 慢 28.6 m/s。舊版在這裡是滿舵爬升 +25°。
    for (const ratio of [1.0, 1.2, 1.59, 2.0, 3.0]) {
      expect(extendPitchAngle(ratio, -0.19, HIGH)).toBeLessThan(0)
    }
  })

  it('沒有相對赤字時退回舊行為', () => {
    expect(extendPitchAngle(0.6, NO_FOE, HIGH)).toBeLessThan(0)
    expect(extendPitchAngle(1.3, NO_FOE, HIGH)).toBeGreaterThan(0)
    expect(extendPitchAngle(1.0, NO_FOE, HIGH)).toBeCloseTo(0, 9)
  })

  it('兩者都是盈餘時才爬升', () => {
    // 比自己的角落速度快（1.3），也比敵人快（+0.2）
    expect(extendPitchAngle(1.3, 0.2, HIGH)).toBeGreaterThan(0)
    // 同樣快過角落速度，但比敵人慢 → 低頭
    expect(extendPitchAngle(1.3, -0.2, HIGH)).toBeLessThan(0)
  })

  it('離地餘裕那一項一個字都沒動', () => {
    // 【為什麼要釘住】那一項是安全關切（低空不能用高度換速度），與能量判斷
    // 在不同的軸上。這次改的只有速度項。
    const high = extendPitchAngle(0.6, NO_FOE, HIGH)
    const low = extendPitchAngle(0.6, NO_FOE, DEFAULT_STEER.clearanceScale * 0.4)
    expect(low).toBeGreaterThan(high)
    // 貼地時高度項主導，即使缺速度也要爬
    expect(extendPitchAngle(0.6, NO_FOE, 0)).toBeGreaterThan(0)
  })

  it('兩端都夾在 extendPitch', () => {
    expect(extendPitchAngle(-5, NO_FOE, HIGH)).toBeCloseTo(-DEFAULT_STEER.extendPitch, 9)
    expect(extendPitchAngle(5, NO_FOE, HIGH)).toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
    // 相對赤字那一邊也要夾得住
    expect(extendPitchAngle(5, -5, HIGH)).toBeCloseTo(-DEFAULT_STEER.extendPitch, 9)
  })

  it('對 speedAdvantage 單調不遞減', () => {
    // 相對敵人越快 → 越傾向爬升。反過來會是災難。
    let prev = -Infinity
    for (let sa = -0.6; sa <= 0.6001; sa += 0.05) {
      const got = extendPitchAngle(1.1, sa, HIGH)
      expect(got).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = got
    }
  })

  it('對 cornerRatio 單調不遞減', () => {
    // 自己越快也越傾向爬升。這一條在改動前就成立，改動後不得反過來。
    let prev = -Infinity
    for (let r = 0.4; r <= 2.0001; r += 0.05) {
      const got = extendPitchAngle(r, NO_FOE, HIGH)
      expect(got).toBeGreaterThanOrEqual(prev - 1e-12)
      prev = got
    }
  })

  it('交界處連續 —— 兩個分支在相等的地方數值相同', () => {
    // 【這一條能宣稱的與不能宣稱的】它證明不會像裸門檻那樣瞬間翻號（那個
    // 機制曾讓 AI 在 1000 m 線上震盪 40 秒）。它**證明不了**整個閉迴路不會
    // 振盪 —— 輸出仍會在 Vs = max(Vc, Vt) 穿過零，而迴路含 10 Hz 取樣、
    // 飽和與俯仰慣性。
    const ratio = 1.2
    const cross = 1 - ratio          // selfDeficit == foeDeficit 的那一點
    const eps = 1e-9
    const a = extendPitchAngle(ratio, -(cross - eps), HIGH)
    const b = extendPitchAngle(ratio, -(cross + eps), HIGH)
    expect(a).toBeCloseTo(b, 6)
  })
})

/**
 * 三類**已知的取捨**。
 *
 * 【這幾條記錄行為，不斷言好壞】它們的作用是讓下一個人看到這個修正的代價，
 * 而不是把某個數字焊死。若量測顯示第一類真的讓超前變糟，下一步是把相對赤字
 * 乘上一個由 `angleOffTail` 導出的連續權重（追擊 → 1、橫越 → 0、迎面 → 0），
 * 而不是加距離門檻 —— 那會引入新的翻號點。
 */
describe('方向修正的三類已知取捨', () => {
  const HIGH = 4000

  it('近距離但敵機很快：由爬升翻成低頭', () => {
    // Vc = 160、Vs = 176、Vt = 208
    const cornerRatio = 176 / 160            // 1.10
    const speedAdvantage = (176 - 208) / 160 // −0.20
    // 只看自己：速度過剩 → 舊版爬升
    expect(extendPitchAngle(cornerRatio, Infinity, HIGH)).toBeGreaterThan(0)
    // 加上相對敵人：新版低頭。這會增加接近率，**可能讓超前更糟** —— 現行的
    // 超前攔截只在 range < 120 m 且正在接近時才觸發，所以 120 m 之外仍有
    // 反例
    expect(extendPitchAngle(cornerRatio, speedAdvantage, HIGH)).toBeLessThan(0)
  })

  it('TAS 差沒有方向資訊：迎面與同向逃跑得到相同的命令', () => {
    // 兩個局面的 speedAdvantage 相同（都是「他比我快 32 m/s」），命令因此
    // 也相同。「追不上」的解讀只在**大致同向**時可靠。
    const chasing = extendPitchAngle(1.1, -0.2, HIGH)
    const headOn = extendPitchAngle(1.1, -0.2, HIGH)
    expect(chasing).toBe(headOn)
  })

  it('戰鬥機對轟炸機：分母是自己的，所以量的是「差佔我多少」', () => {
    // 戰鬥機 Vc = 160、Vs = 200；轟炸機 Vt = 110。相對赤字是負的（我比較
    // 快），所以退回自我判準 —— 這是對的，追一台比自己慢的東西不需要靠
    // 俯衝換速度。
    const cornerRatio = 200 / 160
    const speedAdvantage = (200 - 110) / 160
    expect(extendPitchAngle(cornerRatio, speedAdvantage, HIGH))
      .toBeCloseTo(extendPitchAngle(cornerRatio, Infinity, HIGH), 9)
  })
})
