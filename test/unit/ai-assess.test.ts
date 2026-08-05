import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import {
  createSituation, evaluateEnergy, evaluateGeometry, evaluateThreat, threatFactor, trackingFactor,
  THREAT_RANGE, TRACK_SATURATION, turnTime,
} from '../../src/ai/assess'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { RAD } from '../../src/core/math'

/**
 * 【為什麼用 Aircraft 而不是自訂的輕量結構】評估層要讀的東西
 * （position、velocity、orientation、specificEnergy、diag）全部住在 Aircraft
 * 上。另外發明一個「態勢輸入」結構等於多一份要同步的資料——M2 的命中盒
 * 與外型分岔就是這樣發生的。
 */
function place(a: Aircraft, pos: [number, number, number], vel: [number, number, number]) {
  a.state.position.set(...pos)
  a.state.velocity.set(...vel)
  a.prevPosition.copy(a.state.position)
}

/** 讓機首指向 dir（世界座標）。 */
function face(a: Aircraft, dir: Vector3) {
  a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir.clone().normalize())
  a.prevOrientation.copy(a.state.orientation)
}

describe('evaluateGeometry', () => {
  const sit = createSituation()

  it('range 與 closureRate：正面接近時 closureRate 為正', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, 100])
    evaluateGeometry(self, target, sit)

    expect(sit.range).toBeCloseTo(500, 6)
    // 我以 200 往 −Z、他以 100 往 +Z，接近率 300
    expect(sit.closureRate).toBeCloseTo(300, 6)
  })

  it('拉開時 closureRate 為負，且 timeToMerge 為 Infinity', () => {
    // 【為什麼 timeToMerge 要是 Infinity 而不是負數或很大的數】規則表拿它
    // 當「還有多久要撞在一起」的門檻。拉開時答案是「永遠不會」，用
    // range / closureRate 會得到一個負數，而負數小於任何門檻——所有
    // 「timeToMerge < 門檻」的規則會全部誤觸發。
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -100])
    place(target, [0, 4000, -500], [0, 0, -300])
    evaluateGeometry(self, target, sit)

    expect(sit.closureRate).toBeLessThan(0)
    expect(sit.timeToMerge).toBe(Infinity)
  })

  it('timeToMerge = range / closureRate', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -600], [0, 0, -50])
    evaluateGeometry(self, target, sit)
    expect(sit.closureRate).toBeCloseTo(150, 6)
    expect(sit.timeToMerge).toBeCloseTo(4, 6)
  })

  it('aspectAngle：目標在正前方為 0，正後方為 180°', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    face(self, new Vector3(0, 0, -1))

    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -200])
    evaluateGeometry(self, target, sit)
    expect(sit.aspectAngle * RAD).toBeCloseTo(0, 4)

    place(target, [0, 4000, 500], [0, 0, -200])
    evaluateGeometry(self, target, sit)
    expect(sit.aspectAngle * RAD).toBeCloseTo(180, 4)
  })

  it('angleOffTail：我咬在他正後方為 0，正面對頭為 180°', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -200])

    // 他也朝 −Z：我在他正後方
    face(target, new Vector3(0, 0, -1))
    evaluateGeometry(self, target, sit)
    expect(sit.angleOffTail * RAD).toBeCloseTo(0, 4)

    // 他朝 +Z：正面對頭
    face(target, new Vector3(0, 0, 1))
    evaluateGeometry(self, target, sit)
    expect(sit.angleOffTail * RAD).toBeCloseTo(180, 4)
  })

  it('losRate：純徑向接近時為 0', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -100])
    evaluateGeometry(self, target, sit)
    expect(sit.losRate).toBeCloseTo(0, 9)
  })

  it('losRate：橫向掠過時等於 |橫向相對速度| / 距離', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, 0])
    place(target, [0, 4000, -500], [150, 0, 0])
    evaluateGeometry(self, target, sit)
    expect(sit.losRate).toBeCloseTo(150 / 500, 9)
  })

  it('兩機重疊時不產生 NaN', () => {
    // 重生的瞬間有可能發生。NaN 一旦進入態勢，整個規則表的比較全部變成
    // false，AI 會靜靜地退化成「永遠走預設意圖」——而且完全不會報錯。
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, 0], [0, 0, -200])
    evaluateGeometry(self, target, sit)
    for (const v of [sit.range, sit.closureRate, sit.aspectAngle, sit.angleOffTail, sit.losRate]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })

  it('不修改輸入的兩架飛機', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [10, 4100, -500], [5, 1, -150])
    const before = target.state.position.clone()
    const beforeQ = self.state.orientation.clone()
    evaluateGeometry(self, target, sit)
    expect(target.state.position.equals(before)).toBe(true)
    expect(self.state.orientation.angleTo(beforeQ)).toBe(0)
  })

  it('連續呼叫不配置：一萬次結果一致', () => {
    const self = new Aircraft(P51D)
    const target = new Aircraft(P51D)
    place(self, [0, 4000, 0], [0, 0, -200])
    place(target, [0, 4000, -500], [0, 0, -100])
    evaluateGeometry(self, target, sit)
    const first = sit.range
    for (let i = 0; i < 10000; i++) evaluateGeometry(self, target, sit)
    expect(sit.range).toBe(first)
  })
})

describe('evaluateEnergy', () => {
  const sit = createSituation()

  /** 把飛機放在指定高度與速度，機首朝 −Z。 */
  const at = (spec: typeof P51D, altitude: number, tas: number): Aircraft => {
    const a = new Aircraft(spec, altitude, tas)
    // 跑一步讓 diag（loadFactor、aero.tas）填上真實值
    a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
    return a
  }

  it('energyAdvantage：高度優勢為正', () => {
    const self = at(P51D, 5000, 150)
    const target = at(P51D, 4000, 150)
    evaluateEnergy(self, target, sit)
    expect(sit.energyAdvantage).toBeCloseTo(1000, 0)
  })

  it('energyAdvantage：速度優勢為正', () => {
    const self = at(P51D, 4000, 250)
    const target = at(P51D, 4000, 150)
    evaluateEnergy(self, target, sit)
    // ΔEs = (250² − 150²) / (2g) ≈ 2039 m
    expect(sit.energyAdvantage).toBeCloseTo((250 * 250 - 150 * 150) / (2 * 9.80665), 0)
  })

  /**
   * 【這一條是整個專案的核心命題在 AI 層的第一次兌現】
   *
   * M1 §13.3 量到兩台的海平面持續轉彎率交叉點落在 280–380 km/h。所以
   * 低速時 109 轉得贏、高速時 P-51 轉得贏。AI 的 turnAdvantage 必須看得到
   * 這件事——若它用機種常數而不是當前高度與速度去查，這個關係會被抹平，
   * 「能量戰」就退化成「誰的參數表比較好」。
   */
  it('turnAdvantage 隨速度換邊：低速 109 佔優、高速 P-51 佔優', () => {
    const slow109 = at(BF109G6, 0, 250 / 3.6)
    const slowP51 = at(P51D, 0, 250 / 3.6)
    evaluateEnergy(slow109, slowP51, sit)
    expect(sit.turnAdvantage).toBeGreaterThan(0)

    const fast109 = at(BF109G6, 0, 500 / 3.6)
    const fastP51 = at(P51D, 0, 500 / 3.6)
    evaluateEnergy(fastP51, fast109, sit)
    expect(sit.turnAdvantage).toBeGreaterThan(0)
  })

  it('turnAdvantage 反號：交換雙方角色時符號必須相反', () => {
    const a = at(BF109G6, 0, 250 / 3.6)
    const b = at(P51D, 0, 250 / 3.6)
    evaluateEnergy(a, b, sit)
    const forward = sit.turnAdvantage
    evaluateEnergy(b, a, sit)
    expect(sit.turnAdvantage).toBeCloseTo(-forward, 9)
  })

  it('cornerRatio：高速遠大於 1、低速小於 1', () => {
    evaluateEnergy(at(P51D, 4000, 250), at(P51D, 4000, 150), sit)
    expect(sit.cornerRatio).toBeGreaterThan(1)

    evaluateEnergy(at(P51D, 4000, 90), at(P51D, 4000, 150), sit)
    expect(sit.cornerRatio).toBeLessThan(1)
  })

  /**
   * 水平飛 1 秒讓指揮儀把攻角配平出來。
   *
   * 【為什麼 stallMargin 一定要用配平過的狀態測】`createFlightState` 給的是
   * 攻角 0 的初始狀態，而 `stallMargin = V / Vs(n)` 恆等於 `√(CLmax / CL)`
   * ——它量的是「當前升力係數離失速多遠」，跟速度無關。攻角固定為 0 時，
   * 不管飛多快這個值都一模一樣（實測皆為 2.793）。要看到它隨速度變化，
   * 必須讓飛機真的去配平：慢的那台得用大攻角才撐得住，CL 才會逼近 CLmax。
   */
  const trimmed = (spec: typeof P51D, altitude: number, tas: number): Aircraft => {
    const a = new Aircraft(spec, altitude, tas)
    for (let i = 0; i < 240; i++) a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
    return a
  }

  it('stallMargin：接近失速時趨近 1', () => {
    const fast = trimmed(P51D, 4000, 250)
    const slow = trimmed(P51D, 4000, 80)
    evaluateEnergy(fast, at(P51D, 4000, 150), sit)
    const marginFast = sit.stallMargin
    evaluateEnergy(slow, at(P51D, 4000, 150), sit)
    expect(sit.stallMargin).toBeLessThan(marginFast)
    expect(sit.stallMargin).toBeGreaterThan(0)
  })

  it('psSelf 與 psTarget 各自用自己的狀態', () => {
    // 【為什麼用油門而不是高度區分兩邊】同一個 TAS 下，高空的 Ps 其實
    // **高於**低空（1000 m 實測 −13.7、9000 m −2.55）——阻力隨密度下降得
    // 比引擎功率快。「高空 Ps 較低」只在同 IAS 或各自最佳速度下才成立。
    // 這條測試要驗的是「兩個欄位各查各的狀態、沒有共用同一架飛機」，
    // 油門是最乾淨的區分：推力單調遞增，方向不可能反過來。
    const wep = at(P51D, 4000, 180)
    wep.update(new Vector3(0, 0, -1), 1.0, 1 / 240)
    const idle = at(P51D, 4000, 180)
    idle.update(new Vector3(0, 0, -1), 0.2, 1 / 240)
    evaluateEnergy(wep, idle, sit)
    expect(sit.psSelf).toBeGreaterThan(sit.psTarget)
  })

  it('全部欄位都是有限值', () => {
    evaluateEnergy(at(P51D, 4000, 200), at(BF109G6, 6000, 120), sit)
    for (const v of [sit.energyAdvantage, sit.psSelf, sit.psTarget,
      sit.turnAdvantage, sit.cornerRatio, sit.stallMargin]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('trackingFactor', () => {
  it('剛進入射擊錐時為 0 —— 一瞬間掃過去不是威脅', () => {
    expect(trackingFactor(0)).toBe(0)
  })

  it('達到飽和時間後為 1', () => {
    expect(trackingFactor(TRACK_SATURATION)).toBeCloseTo(1, 12)
    expect(trackingFactor(TRACK_SATURATION * 3)).toBe(1)
  })

  it('中間單調遞增', () => {
    const a = trackingFactor(TRACK_SATURATION * 0.3)
    const b = trackingFactor(TRACK_SATURATION * 0.7)
    expect(b).toBeGreaterThan(a)
    expect(a).toBeGreaterThan(0)
  })

  it('負的時間視為 0（計時器被重置的那一格）', () => {
    expect(trackingFactor(-1)).toBe(0)
  })
})

describe('evaluateThreat', () => {
  const sit = createSituation()

  const armed = (spec: typeof P51D, alt: number, tas: number): Aircraft => {
    const a = new Aircraft(spec, alt, tas)
    a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
    return a
  }

  it('他機首對準我且很近 → threatInstant 高', () => {
    const self = armed(P51D, 4000, 180)
    const target = armed(P51D, 4000, 180)
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, 300], [0, 0, -180])   // 在我正後方 300 m，同向
    face(target, new Vector3(0, 0, -1))            // 機首朝我
    evaluateThreat(self, target, sit)
    expect(sit.threatInstant).toBeGreaterThan(0.5)
  })

  it('他在我後方但機首偏開 → threatInstant 低', () => {
    const self = armed(P51D, 4000, 180)
    const target = armed(P51D, 4000, 180)
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, 300], [0, 0, -180])
    face(target, new Vector3(1, 0, 0))             // 機首指向側面
    evaluateThreat(self, target, sit)
    expect(sit.threatInstant).toBeLessThan(0.1)
  })

  it('距離很遠 → threatInstant 為 0', () => {
    const self = armed(P51D, 4000, 180)
    const target = armed(P51D, 4000, 180)
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, THREAT_RANGE * 2], [0, 0, -180])
    face(target, new Vector3(0, 0, -1))
    evaluateThreat(self, target, sit)
    expect(sit.threatInstant).toBe(0)
  })

  /**
   * 【這一條擋掉的是會直接出貨的死鎖】正面對衝時雙方都有預瞄解、機首也
   * 都對著對方——若威脅只看 `solveLead` 有沒有解，兩邊都會判定自己被威脅、
   * 兩邊都進 `defend`，然後永遠卡在那裡。
   *
   * 對衝之所以不該是「高威脅」，是因為它**持續不了**：相對速度極高，
   * 射擊窗口只有零點幾秒。真正危險的是穩定咬在後面的那個。這個性質由
   * 「持續跟蹤時間」因子表達，而它在 AiController 累積——所以這裡只斷言
   * 對衝的瞬時威脅**不高於**尾後同樣距離的情形。
   */
  it('正面對衝的瞬時威脅不高於尾後咬住', () => {
    const self = armed(P51D, 4000, 180)
    const headOn = armed(P51D, 4000, 180)
    const onTail = armed(P51D, 4000, 180)

    place(self, [0, 4000, 0], [0, 0, -180])

    place(headOn, [0, 4000, -400], [0, 0, 180])
    face(headOn, new Vector3(0, 0, 1))
    evaluateThreat(self, headOn, sit)
    const head = sit.threatInstant

    place(onTail, [0, 4000, 400], [0, 0, -180])
    face(onTail, new Vector3(0, 0, -1))
    evaluateThreat(self, onTail, sit)
    const tail = sit.threatInstant

    expect(head).toBeLessThanOrEqual(tail + 1e-9)
  })

  it('shotInstant 是對稱的：交換雙方角色，威脅與射擊機會互換', () => {
    const a = armed(P51D, 4000, 180)
    const b = armed(P51D, 4000, 180)
    place(a, [0, 4000, 0], [0, 0, -180])
    place(b, [0, 4000, 300], [0, 0, -180])
    face(a, new Vector3(0, 0, -1))
    face(b, new Vector3(0, 0, -1))

    evaluateThreat(a, b, sit)
    const aThreat = sit.threatInstant
    const aShot = sit.shotInstant

    evaluateThreat(b, a, sit)
    expect(sit.shotInstant).toBeCloseTo(aThreat, 9)
    expect(sit.threatInstant).toBeCloseTo(aShot, 9)
  })

  it('兩個值都夾在 [0, 1]', () => {
    const self = armed(P51D, 4000, 180)
    const target = armed(P51D, 4000, 180)
    for (const d of [10, 50, 200, 600, 1500]) {
      place(self, [0, 4000, 0], [0, 0, -180])
      place(target, [0, 4000, d], [0, 0, -180])
      face(target, new Vector3(0, 0, -1))
      evaluateThreat(self, target, sit)
      expect(sit.threatInstant).toBeGreaterThanOrEqual(0)
      expect(sit.threatInstant).toBeLessThanOrEqual(1)
      expect(sit.shotInstant).toBeGreaterThanOrEqual(0)
      expect(sit.shotInstant).toBeLessThanOrEqual(1)
    }
  })

  it('重疊時不產生 NaN', () => {
    const self = armed(P51D, 4000, 180)
    const target = armed(P51D, 4000, 180)
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, 0], [0, 0, -180])
    evaluateThreat(self, target, sit)
    expect(Number.isFinite(sit.threatInstant)).toBe(true)
    expect(Number.isFinite(sit.shotInstant)).toBe(true)
  })
})

describe('speedMargin —— 與 stallMargin 是兩個不同的失效模式', () => {
  const sit = createSituation()

  const at = (spec: typeof P51D, altitude: number, tas: number): Aircraft => {
    const a = new Aircraft(spec, altitude, tas)
    a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
    return a
  }

  /**
   * 【這一條是 M4 出貨後抓到的缺陷】`stallMargin = TAS / Vs(當前過載)`
   * 恆等於 `√(CLmax / CL)`，它量的是「升力係數離失速多遠」。
   *
   * 垂直爬升時飛機**不需要升力**（重力沿著航跡而非垂直於航跡），所以攻角
   * 停在 0 附近、過載趨近 0，而 `Vs ∝ √n` 也跟著縮小 —— 比值於是被撐大。
   * P-51D 由 720 km/h 垂直爬升的實測：
   *
   *   279 km/h → stallMargin 8.51、speedMargin 1.46
   *   132 km/h → stallMargin 4.63、speedMargin 0.68
   *    51 km/h → stallMargin 2.33、speedMargin 0.26
   *
   * 吊機首閘門的門檻是 1.25，所以 `stallMargin` 要掉到約 20 km/h 才觸發。
   * **它對「我快沒空速了」實質上是瞎的**，需要另一個無視過載的判準。
   */
  it('垂直爬升時 stallMargin 仍遠高於閘門門檻，但 speedMargin 已經示警', () => {
    const a = new Aircraft(P51D, 3000, 37)
    // 姿態與速度都朝正上方：不需要升力，過載趨近 0
    a.state.position.set(0, 3000, 0)
    a.state.velocity.set(0, 37, 0)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), new Vector3(0, 1, 0))
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    a.update(new Vector3(0, 1, 0), 1.1, 1 / 240)

    evaluateEnergy(a, at(P51D, 3000, 180), sit)
    expect(Math.abs(a.diag.loadFactor)).toBeLessThan(0.2)
    // 遠高於 DEFAULT_STEER.stallGuardMargin（1.25）→ 舊判準不會叫
    expect(sit.stallMargin).toBeGreaterThan(2)
    // 低於 1 → 連 1 G 都撐不住的速度，新判準會叫
    expect(sit.speedMargin).toBeLessThan(1)
  })

  it('speedMargin = TAS ÷ 1G 失速速度，與當前過載無關', () => {
    // 同一個速度、不同過載：speedMargin 不該變
    const level = at(P51D, 3000, 150)
    evaluateEnergy(level, at(P51D, 3000, 180), sit)
    const a = sit.speedMargin

    // 【為什麼要拉滿一秒】過載不是瞬間建立的：實測由 0 到 5.28 要約
    // 2.5 秒（升降舵有作動速率、迎角要長出來）。跑一步的話 n 還是 0，
    // 這條測試會拿兩個相同的狀態互比，什麼都沒驗到。
    const pulling = new Aircraft(P51D, 3000, 150)
    for (let i = 0; i < 240; i++) pulling.update(new Vector3(0, 1, 0), 1.1, 1 / 240)
    evaluateEnergy(pulling, at(P51D, 3000, 180), sit)
    expect(Math.abs(pulling.diag.loadFactor)).toBeGreaterThan(Math.abs(level.diag.loadFactor))
    // 速度在這一秒內掉了一些，所以只比較「同一個數量級、沒有被過載扭曲」：
    // 舊的 stallMargin 在 4.7 G 下會掉到 1/√4.7 ≈ 46%，speedMargin 不會。
    expect(sit.speedMargin).toBeGreaterThan(a * 0.9)
  })

  it('speedMargin 隨速度單調遞增，且高速時遠大於 1', () => {
    evaluateEnergy(at(P51D, 3000, 250), at(P51D, 3000, 180), sit)
    const fast = sit.speedMargin
    evaluateEnergy(at(P51D, 3000, 90), at(P51D, 3000, 180), sit)
    expect(sit.speedMargin).toBeLessThan(fast)
    expect(fast).toBeGreaterThan(3)
  })
})

describe('threatFactor —— 供僚機掩護判斷使用（M6 spec §7.2）', () => {
  /** 造一架擺在指定位置、朝指定方向平飛的 P-51D。 */
  function at(x: number, y: number, z: number, yaw = 0): Aircraft {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(x, y, z)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw)
    a.state.orientation.copy(q)
    a.prevOrientation.copy(q)
    a.state.velocity.set(0, 0, -200).applyQuaternion(q)
    a.prevPosition.copy(a.state.position)
    return a
  }

  it('咬在正後方 300 m 時為正', () => {
    const victim = at(0, 4000, 0)
    const shooter = at(0, 4000, 300)   // 受害者朝 −Z，射手在他後方 300 m
    expect(threatFactor(shooter, victim)).toBeGreaterThan(0)
  })

  it('背對時為 0', () => {
    const victim = at(0, 4000, 0)
    const shooter = at(0, 4000, 300, Math.PI)  // 射手朝 +Z，背對受害者
    expect(threatFactor(shooter, victim)).toBe(0)
  })

  it('超過 THREAT_RANGE 為 0', () => {
    const victim = at(0, 4000, 0)
    const shooter = at(0, 4000, THREAT_RANGE + 100)
    expect(threatFactor(shooter, victim)).toBe(0)
  })

  it('越近越大', () => {
    const victim = at(0, 4000, 0)
    const near = threatFactor(at(0, 4000, 200), victim)
    const far = threatFactor(at(0, 4000, 600), victim)
    expect(near).toBeGreaterThan(far)
  })

  it('與 evaluateThreat 填進 Situation 的是同一個數字', () => {
    // 【為什麼要測這一條】匯出這件事的全部價值就是「只有一個答案」。
    // 若 evaluateThreat 沒有改成呼叫它，兩者會各自演化而沒有任何測試會紅。
    const self = at(0, 4000, 0)
    const enemy = at(0, 4000, 300)
    const sit = createSituation()
    evaluateThreat(self, enemy, sit)
    expect(sit.threatInstant).toBe(threatFactor(enemy, self))
    expect(sit.shotInstant).toBe(threatFactor(self, enemy))
  })
})

/**
 * 平飛、機首朝 −Z 的飛機。
 *
 * 【一定要跑一步】`Aircraft` 的建構子**不填 `diag`** —— 它只在 `update`
 * 裡由 `stepDynamics` 填。沒跑過的飛機 `diag.aero.tas` 是 0，
 * `instantaneousTurnRate` 於是回 0，`turnTime` 就恆為 `Infinity`。
 */
function flyer(): Aircraft {
  const a = new Aircraft(P51D, 4000, 180)
  a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
  return a
}

describe('turnTime', () => {
  /**
   * 【為什麼不用 `toBeCloseTo(0, 6)`】`acos` 在 0° 附近的精度下限是
   * √ε ≈ 1.7e-4 rad —— 點積差 1e-16 就會放大成 1e-8 rad 的角度。實測殘差
   * 是 1.35e-5 rad（0.0008°），正好落在那個底噪上，不是實作有問題。
   * 要主張的是「正前方的代價可忽略」，一毫秒已經遠低於任何有意義的尺度。
   */
  it('目標在正前方時代價可忽略', () => {
    const self = flyer()
    const target = flyer()
    self.state.position.set(0, 4000, 0)
    target.state.position.set(0, 4000, -500)
    const t = turnTime(self, target)
    expect(t).toBeGreaterThanOrEqual(0)
    expect(t).toBeLessThan(1e-3)
  })

  it('目標在正後方最貴，正側面居中', () => {
    const self = flyer()
    const behind = flyer()
    const beam = flyer()
    self.state.position.set(0, 4000, 0)
    behind.state.position.set(0, 4000, 500)     // 機首朝 −Z，所以 +Z 是後方
    beam.state.position.set(500, 4000, 0)
    const tBehind = turnTime(self, behind)
    const tBeam = turnTime(self, beam)
    expect(tBehind).toBeGreaterThan(tBeam)
    expect(tBeam).toBeGreaterThan(0)
    // 180° 恰好是 90° 的兩倍
    expect(tBehind / tBeam).toBeCloseTo(2, 3)
  })

  /**
   * 【慢的飛機轉得比較快，但角度需求一樣】所以同一個角度下，速度低的
   * 那一架 `turnTime` 反而短 —— 這正是要的：能量低的飛機轉得動，代價是
   * 它轉完之後沒有能量做別的事，而那由評分裡的其他項處理。
   */
  it('轉不動時回傳 Infinity', () => {
    const self = flyer()
    const target = flyer()
    self.state.position.set(0, 4000, 0)
    target.state.position.set(0, 4000, 500)
    // 速度趨近 0：可用過載 ≤ 1，瞬時轉彎率為 0
    self.state.velocity.set(0, 0, -0.001)
    self.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
    expect(turnTime(self, target)).toBe(Infinity)
  })

  it('兩機重疊時回傳 0，不產生 NaN', () => {
    const self = flyer()
    const target = flyer()
    self.state.position.set(0, 4000, 0)
    target.state.position.set(0, 4000, 0)
    expect(turnTime(self, target)).toBe(0)
  })

  it('連續呼叫不配置：一萬次結果一致', () => {
    const self = flyer()
    const target = flyer()
    self.state.position.set(0, 4000, 0)
    target.state.position.set(300, 4000, 400)
    const first = turnTime(self, target)
    for (let i = 0; i < 10000; i++) turnTime(self, target)
    expect(turnTime(self, target)).toBe(first)
  })
})
