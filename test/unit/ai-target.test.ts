import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import {
  countLocks, createTargetBoard, createTargetState, selectTarget, targetScore,
  visionFactor, DEFAULT_TARGET, type TargetCandidate,
} from '../../src/ai/target'
import { trackAngle } from '../../src/ai/assess'
import type { Team } from '../../src/world/World'
import { P51D } from '../../src/specs/p51d'

const UP = new Vector3(0, 1, 0)

/**
 * 把飛機擺在 (x, y, z)，機首繞 Y 軸轉 yaw 弧度（0 = 朝 −Z），並以 200 m/s
 * 沿機首方向飛。
 *
 * 【一定要跑一步】`Aircraft` 的建構子**不填 `diag`** —— 它只在 `update` 裡
 * 由 `stepDynamics` 填。`targetScore` 透過 `turnTime` 讀 `diag.aero.tas`，
 * 讀到 0 會讓 `instantaneousTurnRate` 回 0、`turnTime` 回 `Infinity`、折扣
 * 變成 0，於是**所有目標的分數都是 0**，比較兩個 0 的測試永遠通過。
 * 舊版沒踩到是因為舊 `targetScore` 不碰 `diag`。
 *
 * 【速度也一定要設】威脅項改用 `threatFactor`，而它要解預瞄。兩機速度都是
 * 0 時相對速度為 0，預瞄解退化。
 */
function place(x: number, y: number, z: number, yaw: number): Aircraft {
  const a = new Aircraft(P51D, 4000, 200)
  const q = new Quaternion().setFromAxisAngle(UP, yaw)
  a.state.orientation.copy(q)
  a.state.velocity.set(0, 0, -200).applyQuaternion(q)
  a.prevPosition.copy(a.state.position)
  // 跑一步把 diag 填起來（見上方說明）
  a.update(new Vector3(0, 0, -1).applyQuaternion(q), 0.7, 1 / 240)
  // update 會積分位置、姿態與速度，全部重設回我們要的值
  a.state.position.set(x, y, z)
  a.state.orientation.copy(q)
  a.state.velocity.set(0, 0, -200).applyQuaternion(q)
  return a
}

describe('targetScore 的機會項', () => {
  it('我在他正後方時最高（他背對我）', () => {
    // 我在 z = 0，他在 z = −300 且機首朝 −Z（背對我）
    const me = place(0, 4000, 0, 0)
    const tail = place(0, 4000, -300, 0)
    // 同距離、他機首朝 +Z（正對我）
    const nose = place(0, 4000, -300, Math.PI)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 }
    expect(targetScore(me, tail, 0, cfg)).toBeGreaterThan(targetScore(me, nose, 0, cfg))
  })

  /**
   * 【為什麼不是斷言「分數等於 0」】分數含一個底價（見 `TargetConfig.baseScore`），
   * 所以總分本來就不會是 0。要驗的是**機會項的貢獻**是 0 而不是負的 ——
   * 拿同一架、同樣的折扣、但把機會權重關掉來比，相等就證明它貢獻了 0。
   */
  it('側面時機會項貢獻歸零（不是負的）', () => {
    const me = place(0, 4000, 0, 0)
    const beam = place(0, 4000, -300, Math.PI / 2)
    const on = { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 }
    const off = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 0 }
    expect(targetScore(me, beam, 0, on)).toBeCloseTo(targetScore(me, beam, 0, off), 12)
  })
})

describe('targetScore 的底價', () => {
  /**
   * 【沒有它會發生什麼】開局雙方相距 10 km，前 25 秒敵機都在 THREAT_RANGE
   * 之外（威脅 0）而且迎頭朝我飛（機會 0）—— 每一架的分數都恰好是 0。三個
   * 折扣都是乘法，乘上 0 還是 0，選擇於是退化成「取索引最小的那一架」，
   * 五個分隊的長機全部撲同一架。實測把 `crowdPenalty` 從 1 推到 1000 一格
   * 都沒動，因為它乘的是 0。
   */
  it('既不是機會也不是威脅的敵機，分數仍然大於 0', () => {
    const me = place(0, 4000, 0, 0)
    // 3 km 外（超出 THREAT_RANGE）、機首與我的視線垂直（機會項也是 0）
    const neutral = place(0, 4000, -3000, Math.PI / 2)
    expect(targetScore(me, neutral, 0, DEFAULT_TARGET)).toBeGreaterThan(0)
  })

  it('兩架都中性時，近的贏遠的 —— 折扣重新有東西可折', () => {
    const me = place(0, 4000, 0, 0)
    const near = place(0, 4000, -1500, Math.PI / 2)
    const far = place(0, 4000, -3000, Math.PI / 2)
    expect(targetScore(me, near, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, far, 0, DEFAULT_TARGET))
  })

  it('兩架都中性時，沒人鎖定的贏已經很多人鎖定的', () => {
    const me = place(0, 4000, 0, 0)
    const t = place(0, 4000, -3000, Math.PI / 2)
    expect(targetScore(me, t, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, t, 4, DEFAULT_TARGET))
  })

  /**
   * 【比值不要寫死】兩架的距離、鎖定數、方位都相同，三個折扣完全抵銷，
   * 所以比值恰好是 `(baseScore + 1) / baseScore` —— 寫 `> 3` 會在
   * `baseScore` 調到 0.5 時剛好卡在等號上。要驗的是「真正咬住他明顯比
   * 隨便一架敵機值錢」，取兩倍就夠說明，而且不綁定常數。
   */
  it('交戰時真正的機會與威脅仍然主導底價', () => {
    const me = place(0, 4000, 0, 0)
    const neutral = place(0, 4000, -400, Math.PI / 2)
    const bitten = place(0, 4000, -400, 0)   // 同距離，但我咬著他
    expect(targetScore(me, bitten, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, neutral, 0, DEFAULT_TARGET) * 2)
  })
})

describe('三個折扣的相對重要性', () => {
  const me = () => place(0, 4000, 0, 0)

  /** 權重 0 等於把那一項關掉 —— 折扣恆為 1。 */
  it('權重為 0 時該項完全不起作用', () => {
    const t = place(0, 4000, 3000, 0)   // 正後方且很遠：三項折扣都很重
    const all = targetScore(me(), t, 3, DEFAULT_TARGET)
    const noRange = targetScore(me(), t, 3, { ...DEFAULT_TARGET, rangeWeight: 0 })
    const noCrowd = targetScore(me(), t, 3, { ...DEFAULT_TARGET, crowdWeight: 0 })
    const noTurn = targetScore(me(), t, 3, { ...DEFAULT_TARGET, turnWeight: 0 })
    expect(noRange).toBeGreaterThan(all)
    expect(noCrowd).toBeGreaterThan(all)
    expect(noTurn).toBeGreaterThan(all)
  })

  /**
   * 【在特徵尺度上，權重就是「折幾次半」】x = 1 時折扣恰好是 2⁻ʷ。
   * 這條把那個語意釘住 —— 沒有它，權重就只是一個沒有解釋的旋鈕。
   */
  it('特徵尺度處，權重 w 讓分數折 w 次半', () => {
    const t = place(0, 4000, -DEFAULT_TARGET.rangeScale, 0)
    const at0 = place(0, 4000, -1e-6, 0)
    const base = { ...DEFAULT_TARGET, crowdWeight: 0, turnWeight: 0 }
    const w1 = { ...base, rangeWeight: 1 }
    const w2 = { ...base, rangeWeight: 2 }
    expect(targetScore(me(), t, 0, w1) / targetScore(me(), at0, 0, w1)).toBeCloseTo(0.5, 4)
    expect(targetScore(me(), t, 0, w2) / targetScore(me(), at0, 0, w2)).toBeCloseTo(0.25, 4)
  })

  /**
   * 【角度比距離重要】轉不轉得過去決定打不打得到，而距離只決定命中率。
   * 這條驗的是預設值真的把權重放在角度那一邊。
   */
  it('預設值下，轉向代價的權重高於距離', () => {
    expect(DEFAULT_TARGET.turnWeight).toBeGreaterThan(DEFAULT_TARGET.rangeWeight)
  })
})

/**
 * 威脅項用 `assess.ts` 那個真正的定義：要有預瞄解、機首在 15° 錐內、
 * 900 m 內。
 *
 * 【為什麼要改】舊版的威脅只看「敵機首朝不朝我」，不管距離、不管有沒有
 * 預瞄解、不管機首在不在射擊錐內。三公里外一架剛好朝我飛的敵機，在它
 * 眼裡跟貼著我開火的一樣危險。實測換上後半球目標的當下，`threatInstant`
 * 中位數 0.000、78.3% 為 0 —— AI 掉頭去追的是沒在威脅它的飛機
 * （spec §3.3、§6.1）。
 */
describe('targetScore 的威脅項用真正的定義', () => {
  /**
   * 【比法與機會項那一條相同】分數含底價，所以驗的是**威脅項的貢獻**是 0，
   * 不是總分是 0。
   */
  it('遠處機首朝我的敵機不算威脅', () => {
    const me = place(0, 4000, 0, 0)
    // 3 km 外，機首正對我（舊定義會給滿分）
    const far = place(0, 4000, -3000, Math.PI)
    const on = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 1 }
    const off = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 0 }
    expect(targetScore(me, far, 0, on)).toBeCloseTo(targetScore(me, far, 0, off), 12)
  })

  it('近處機首朝我且有預瞄解的敵機算威脅', () => {
    const me = place(0, 4000, 0, 0)
    const near = place(0, 4000, -300, Math.PI)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 1 }
    expect(targetScore(me, near, 0, cfg)).toBeGreaterThan(0)
  })

  it('他機首正對我時最高', () => {
    const me = place(0, 4000, 0, 0)
    const nose = place(0, 4000, -300, Math.PI)
    const tail = place(0, 4000, -300, 0)
    const cfg = { ...DEFAULT_TARGET, opportunityWeight: 0, threatWeight: 1 }
    expect(targetScore(me, nose, 0, cfg)).toBeGreaterThan(targetScore(me, tail, 0, cfg))
  })

  it('機會與威脅是兩個獨立的權重，不會退化成一個', () => {
    // 若用 0.5(1±b)，兩者相加恆為 1，score 只剩 (ow−tw) 一個自由度。
    // 取正部之後：純尾追時威脅權重完全不影響分數。
    const me = place(0, 4000, 0, 0)
    const tail = place(0, 4000, -300, 0)
    const a = targetScore(me, tail, 0, { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 0 })
    const b = targetScore(me, tail, 0, { ...DEFAULT_TARGET, opportunityWeight: 1, threatWeight: 5 })
    expect(b).toBeCloseTo(a, 9)
  })
})

describe('targetScore 的切換成本', () => {
  /**
   * 【這一項同時修好猶豫與追後方】現任目標的機首已經對準，代價接近 0，
   * 因此天然具有黏性；後半球目標要轉 180°，代價極高，分數被壓下去。
   */
  it('同距離下，正前方的目標分數高於正後方的', () => {
    const me = place(0, 4000, 0, 0)
    // 兩架都背對我（機會項相同）、距離相同，只差在方位
    const front = place(0, 4000, -400, 0)
    const behind = place(0, 4000, 400, Math.PI)
    expect(targetScore(me, front, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, behind, 0, DEFAULT_TARGET))
  })

  /**
   * 【切換成本只是折扣，不會讓飛機黏死】目標本身的價值仍然主導：現任
   * 目標飛到 3 km 外時，距離折扣會把它壓下去，就算轉向代價是 0 也贏不了
   * 近處的目標（spec §4.3）。
   */
  it('正前方但很遠的目標，輸給側面但很近的目標', () => {
    const me = place(0, 4000, 0, 0)
    const farAhead = place(0, 4000, -3000, 0)
    // 【yaw 必須是 −π/2】機首方向是 (−sin yaw, 0, −cos yaw)，−π/2 給出
    // (1, 0, 0) ＝ 朝 +X，也就是背對我。若寫成 0，它的機首與我的視線垂直，
    // 機會項與威脅項**同時為 0**，分數是 0，這條測試就變成在比兩個 0。
    const nearBeam = place(300, 4000, 0, -Math.PI / 2)
    expect(targetScore(me, nearBeam, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, farAhead, 0, DEFAULT_TARGET))
  })

  it('分數恆非負', () => {
    const me = place(0, 4000, 0, 0)
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      for (const z of [-2000, -400, 400, 2000]) {
        expect(targetScore(me, place(0, 4000, z, yaw), 0, DEFAULT_TARGET))
          .toBeGreaterThanOrEqual(0)
      }
    }
  })
})

const DEG = Math.PI / 180

/**
 * ## 視野折扣：只咬後半球
 *
 * 【量到的缺陷】20v20、150 s：**29.6% 的換目標換去後半球**，而 `turnDiscount`
 * 在那裡太平 —— 由 57°（實測中位）到正後方只損失 3.4 倍，而分攤折扣每多一個
 * 隊友鎖定就是 3.0 倍。「正後方、沒人鎖」與「57°、有一個隊友鎖著」幾乎等價。
 *
 * 【為什麼只咬後半球】全域的 cos 斜坡**必定**打破下面那條「正前方但很遠的
 * 目標，輸給側面但很近的目標」（實算餘裕 1.203 → 0.692 / 0.391 / 0.203）。
 * 詳見 `TargetConfig.visionPower`。
 */
/**
 * 【為什麼要一個明確開啟的設定】`DEFAULT_TARGET.visionPower` 是 **0**（關掉）
 * —— 這一項是方向相反的取捨（後方追逐變好、A→B→A 變差），預設由專案負責人
 * 裁定，見 `TargetConfig.visionPower` 的 A/B 表。用 `DEFAULT_TARGET` 來測
 * 這一組的話，量到的會是「關掉時它不動」，那什麼都沒守到。
 */
const VISION_ON = { ...DEFAULT_TARGET, visionPower: 2 }

describe('visionFactor —— 視野折扣', () => {
  const cfg = VISION_ON

  /**
   * 【這一條是那條不變式的結構保證】只要前半球恆為 1，視野折扣就**不可能**
   * 影響任何 θ ≤ 90° 的比較 —— 不必再逐個場景去試。
   */
  it('前半球恆為 1，一個字都不動', () => {
    for (const deg of [0, 15, 30, 45, 57, 60, 75, 89.9, 90]) {
      expect(visionFactor(deg * DEG, cfg)).toBeCloseTo(1, 12)
    }
  })

  it('後半球才開始扣，而且單調遞減', () => {
    let last = 1
    for (const deg of [90, 100, 110, 120, 135, 150, 165, 180]) {
      const v = visionFactor(deg * DEG, cfg)
      expect(v).toBeLessThanOrEqual(last + 1e-12)
      last = v
    }
    expect(visionFactor(180 * DEG, cfg)).toBeLessThan(visionFactor(120 * DEG, cfg))
  })

  /**
   * 【下限不能是 0】三個折扣都是乘法。歸零的話全部候選都會被壓成 0，選擇
   * 退化成「取掃描時第一個碰到的」—— 那正是 `baseScore` 註解記下的缺陷。
   */
  it('正後方仍然大於 0 —— 背後是很差，不是不存在', () => {
    expect(visionFactor(180 * DEG, cfg)).toBe(cfg.visionFloor)
    expect(cfg.visionFloor).toBeGreaterThan(0)
  })

  /** 【90° 是轉折點，不是斷點】硬截斷這個專案吃過虧 */
  it('90° 兩側連續', () => {
    const eps = 1e-6
    const lo = visionFactor((90 - eps) * DEG, cfg)
    const hi = visionFactor((90 + eps) * DEG, cfg)
    expect(Math.abs(lo - hi)).toBeLessThan(1e-4)
  })

  it('visionPower 為 0 時整條規則關掉', () => {
    const off = { ...cfg, visionPower: 0 }
    for (const deg of [0, 90, 120, 180]) {
      expect(visionFactor(deg * DEG, off)).toBe(1)
    }
  })

  /**
   * 【預設是關的，而且那是一個裁定】不是忘了開。實測它讓後方追逐變好、
   * A→B→A 變差六場六場 —— 兩個都是專案負責人抱怨過的事，孰輕孰重是他的
   * 決定。這一條把「現在是關的」釘住，免得日後有人以為它一直在跑。
   */
  it('預設是關掉的 —— 待裁定', () => {
    expect(DEFAULT_TARGET.visionPower).toBe(0)
    for (const deg of [0, 90, 120, 180]) {
      expect(visionFactor(deg * DEG, DEFAULT_TARGET)).toBe(1)
    }
  })
})

describe('targetScore 的視野折扣', () => {
  /**
   * 【這是要修的行為】正後方 400 m 與正前方 400 m，兩架都背對我（機會項
   * 相同）。原本正後方只差 3.4 倍，加了視野折扣之後差距明顯拉開。
   */
  it('正後方的目標被壓得比沒有視野折扣時更低', () => {
    const me = place(0, 4000, 0, 0)
    const behind = place(0, 4000, 400, Math.PI)
    expect(targetScore(me, behind, 0, VISION_ON))
      .toBeLessThan(targetScore(me, behind, 0, DEFAULT_TARGET))
  })

  /** 【前半球逐位元相同】不是「差不多」，是這條規則的結構保證 */
  it('前半球的目標分數逐位元不受影響', () => {
    const me = place(0, 4000, 0, 0)
    for (const [x, z] of [[0, -400], [0, -3000], [300, 0], [-300, 0], [200, -200]] as const) {
      const t = place(x, 4000, z, 0)
      expect(trackAngle(me, t)).toBeLessThanOrEqual(Math.PI / 2 + 1e-9)
      expect(targetScore(me, t, 0, VISION_ON)).toBe(targetScore(me, t, 0, DEFAULT_TARGET))
    }
  })

  /**
   * 【視野折扣用的角與 turnTime 同一個】兩者都由 `trackAngle` 來，所以不會
   * 出現「轉向折扣用航跡、視野折扣用機首」這種一個決策裡兩個方位定義。
   */
  it('用的是航跡而不是機首', () => {
    const me = place(0, 4000, 0, 0)
    // 機首朝 −Z，但速度硬轉成 +Z：目標在 −Z 正前方，對機首是 0°、對航跡是 180°
    me.state.velocity.set(0, 0, 200)
    const t = place(0, 4000, -400, 0)
    expect(trackAngle(me, t) * (180 / Math.PI)).toBeCloseTo(180, 6)
    expect(visionFactor(trackAngle(me, t), VISION_ON)).toBe(VISION_ON.visionFloor)
  })
})

describe('targetScore 的折扣項', () => {
  it('距離越遠分數越低', () => {
    const me = place(0, 4000, 0, 0)
    const near = place(0, 4000, -200, 0)
    const far = place(0, 4000, -2000, 0)
    expect(targetScore(me, near, 0, DEFAULT_TARGET))
      .toBeGreaterThan(targetScore(me, far, 0, DEFAULT_TARGET))
  })

  it('rangeScale 處恰好打對折', () => {
    const cfg = { ...DEFAULT_TARGET, rangeScale: 500, crowdPenalty: 0 }
    const me = place(0, 4000, 0, 0)
    const at0 = place(0, 4000, -1e-6, 0)
    const at500 = place(0, 4000, -500, 0)
    expect(targetScore(me, at500, 0, cfg) / targetScore(me, at0, 0, cfg)).toBeCloseTo(0.5, 4)
  })

  /**
   * 【目標放在射擊錐外】分攤折扣在**有射擊解時不適用**（見下面那一組
   * 測試），所以要驗「鎖定越多分數越低」必須挑一個打不到的目標，否則量到
   * 的是另一條規則。這裡把目標放在正側方 —— 機首偏離 90°，射擊解為 0。
   */
  it('鎖定的人越多分數越低（打不到的目標）', () => {
    const me = place(0, 4000, 0, 0)
    const t = place(300, 4000, 0, 0)
    const s0 = targetScore(me, t, 0, DEFAULT_TARGET)
    const s1 = targetScore(me, t, 1, DEFAULT_TARGET)
    const s3 = targetScore(me, t, 3, DEFAULT_TARGET)
    expect(s1).toBeLessThan(s0)
    expect(s3).toBeLessThan(s1)
  })

  it('分數恆非負——乘法遲滯的前提', () => {
    const me = place(0, 4000, 0, 0)
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      for (const locks of [0, 1, 5, 40]) {
        const t = place(300, 4000, -300, yaw)
        expect(targetScore(me, t, locks, DEFAULT_TARGET)).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

/**
 * **有射擊解時分攤折扣不適用**（2026-08-05）。
 *
 * 【人工驗收看到什麼】AI 把一架已經在槍口上、又近又正的敵機丟掉，去追一架
 * 更遠、角度更差的，然後又切回來，週期 1~2 秒。
 *
 * 【量到的機制】20v20 實測，長機 271 次換目標裡有 **52 次（19.2%）**發生在
 * 「對舊目標仍有射擊解」的當下。把那 52 次的分數比拆成四個乘法因子：
 *
 * ```
 * 因子        新÷舊中位   >1.5 倍的比例
 * 幾何          1.00          10%
 * 距離折扣      0.86           8%
 * 分攤折扣      5.00          87%   ← 只有這一項
 * 轉向折扣      0.58           0%
 * ```
 *
 * 其他三項全部說「不該換」（新目標更遠 678→812 m、角度更差），全被分攤
 * 折扣壓過去。5.00 也不是巧合：舊目標鎖定數中位 2 → `1/(1+2×2) = 1/5`，
 * 新目標 0 → `1`，比值恰好 5。**88% 的案例裡被丟掉的那架身上有隊友。**
 *
 * 【為什麼是缺一塊機制而不是參數沒調好】`crowdPenalty` 降到 0.3 以下才壓得
 * 住這個跳變，但那樣分散就垮了（實測 `crowdPenalty` = 0 時最大鎖定 17–20
 * 架）；`switchMargin` 要拉到 2.0 以上才擋得住，那 AI 對所有事情都會變死
 * 心眼。兩個旋鈕方向相反、沒有中間值。
 *
 * 【修法照抄意圖層已經學過的那一課】`rules.ts` 的 `arbitrate` 有一條分野：
 * 「相對理由（比他弱）→ 有槍在手就先開槍；絕對理由（我飛不動了）→ 開著槍
 * 也得走」。分攤是**相對理由** —— 它談的是分工，不是這架敵機好不好打。
 * 分工該決定「一開始去哪」，不該把到手的機會讓出去。
 */
describe('有射擊解時分攤折扣不適用', () => {
  /** 正前方 300 m、背對我 —— 射擊解充足 */
  const onGun = () => ({ me: place(0, 4000, 0, 0), t: place(0, 4000, -300, 0) })

  it('槍口上的目標，鎖定數不再壓低分數', () => {
    const { me, t } = onGun()
    const s0 = targetScore(me, t, 0, DEFAULT_TARGET)
    const s3 = targetScore(me, t, 3, DEFAULT_TARGET)
    expect(s3).toBeCloseTo(s0, 9)
  })

  it('同一架敵機，離開射擊錐之後分攤就回來了', () => {
    const me = place(0, 4000, 0, 0)
    // 正側方：機首偏離 90°，射擊解為 0
    const off = place(300, 4000, 0, 0)
    expect(targetScore(me, off, 3, DEFAULT_TARGET))
      .toBeLessThan(targetScore(me, off, 0, DEFAULT_TARGET))
  })

  /**
   * 【連續性】免除的程度由 `shotInstant` 連續決定，沒有翻轉點。射擊解
   * 剛好落在 `shotRelief` 上時免除恰好滿額，再往上不會再變 —— 兩側都連續。
   * 這與 `steer.ts` 的 `unloadPull` 是同一手：門檻上的不連續會變成抖動。
   */
  it('免除程度隨射擊解連續變化，沒有跳變', () => {
    const me = place(0, 4000, 0, 0)
    // 【步長要細】1/(1+x) 在免除飽和附近本來就陡（那是連續函數的斜率，
    // 不是跳變）。真正要排除的是**不連續**，所以用 5 m 的步長 —— 若有跳變，
    // 縮小步長也縮不掉。
    let prev = -1
    for (let d = 1000; d >= 200; d -= 5) {
      const t = place(0, 4000, -d, 0)
      const s = targetScore(me, t, 3, DEFAULT_TARGET) / targetScore(me, t, 0, DEFAULT_TARGET)
      if (prev >= 0) {
        expect(Math.abs(s - prev)).toBeLessThan(0.12)
        expect(s).toBeGreaterThanOrEqual(prev - 1e-12)   // 越近免除越多，單調
      }
      prev = s
    }
  })

  it('shotRelief 為 0 時完全回到舊行為', () => {
    const { me, t } = onGun()
    const cfg = { ...DEFAULT_TARGET, shotRelief: 0 }
    expect(targetScore(me, t, 3, cfg)).toBeLessThan(targetScore(me, t, 0, cfg))
  })
})

describe('targetScore 的折扣項（續）', () => {
  it('分數在有射擊解時仍然恆非負', () => {
    const me = place(0, 4000, 0, 0)
    for (let yaw = 0; yaw < Math.PI * 2; yaw += 0.3) {
      for (const locks of [0, 1, 5, 40]) {
        const t = place(300, 4000, -300, yaw)
        expect(targetScore(me, t, locks, DEFAULT_TARGET)).toBeGreaterThanOrEqual(0)
      }
    }
  })
})

describe('targetScore 的退化處理', () => {
  it('兩機重疊時不產生 NaN', () => {
    const me = place(0, 4000, 0, 0)
    const same = place(0, 4000, 0, 0)
    expect(Number.isFinite(targetScore(me, same, 0, DEFAULT_TARGET))).toBe(true)
  })
})

/** 造一組候選：teams 決定陣營，索引即為陣列位置。 */
function candidates(teams: readonly Team[]): TargetCandidate[] {
  return teams.map((team, index) => ({
    index, team, alive: true, aircraft: place(index * 50, 4000, 0, 0),
  }))
}

describe('createTargetBoard', () => {
  it('assignments 長度等於候選數，初值全為 −1', () => {
    const b = createTargetBoard(candidates(['blue', 'blue', 'red']))
    expect(b.assignments).toHaveLength(3)
    expect(Array.from(b.assignments)).toEqual([-1, -1, -1])
  })

  it('index 與陣列位置不符時直接拋錯', () => {
    const cs = candidates(['blue', 'red'])
    const broken = [cs[0]!, { ...cs[1]!, index: 7 }]
    expect(() => createTargetBoard(broken)).toThrow()
  })
})

describe('countLocks', () => {
  it('只數同隊的', () => {
    // 0、1 藍，2、3 紅。全部都鎖定候選 2
    const cs = candidates(['blue', 'blue', 'red', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([2, 2, 2, 2])
    // 站在 0（藍）的角度：同隊的只有 1
    expect(countLocks(b, 'blue', 0, 2)).toBe(1)
  })

  it('不數自己', () => {
    const cs = candidates(['blue', 'blue', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([2, -1, -1])
    expect(countLocks(b, 'blue', 0, 2)).toBe(0)
  })

  it('不數已退場的', () => {
    const cs = candidates(['blue', 'blue', 'blue', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([3, 3, 3, -1])
    cs[1]!.alive = false
    expect(countLocks(b, 'blue', 0, 3)).toBe(1)
  })

  it('沒有人鎖定時回傳 0', () => {
    const cs = candidates(['blue', 'red'])
    const b = createTargetBoard(cs)
    expect(countLocks(b, 'blue', 0, 1)).toBe(0)
  })

  it('不數同一個編隊的隊友 —— 僚機跟上不算搶', () => {
    // 0、1 同編隊；2 是別的編隊；3 是紅機，三架藍機都鎖定它
    const cs = candidates(['blue', 'blue', 'blue', 'red'])
    const b = createTargetBoard(cs, Int32Array.from([0, 0, 1, -1]))
    b.assignments.set([3, 3, 3, -1])
    expect(countLocks(b, 'blue', 0, 3)).toBe(1)
  })

  it('沒有給編隊時逐字照舊 —— 每一架都算', () => {
    const cs = candidates(['blue', 'blue', 'blue', 'red'])
    const b = createTargetBoard(cs)
    b.assignments.set([3, 3, 3, -1])
    expect(countLocks(b, 'blue', 0, 3)).toBe(2)
  })

  it('無編隊（−1）不會互相合併', () => {
    // −1 是「不屬於任何編隊」，不是「同屬第 −1 隊」。兩架獨行俠彼此仍是外人
    const cs = candidates(['blue', 'blue', 'blue', 'red'])
    const b = createTargetBoard(cs, Int32Array.from([-1, -1, -1, -1]))
    b.assignments.set([3, 3, 3, -1])
    expect(countLocks(b, 'blue', 0, 3)).toBe(2)
  })

  it('自己有編隊、隊友沒有時，隊友照算', () => {
    const cs = candidates(['blue', 'blue', 'red'])
    const b = createTargetBoard(cs, Int32Array.from([0, -1, -1]))
    b.assignments.set([2, 2, -1])
    expect(countLocks(b, 'blue', 0, 2)).toBe(1)
  })
})

/** 造一個「藍 0 對紅 1、紅 2」的板，紅 1 在近處、紅 2 在遠處。 */
function board3(): ReturnType<typeof createTargetBoard> {
  const cs: TargetCandidate[] = [
    { index: 0, team: 'blue', alive: true, aircraft: place(0, 4000, 0, 0) },
    { index: 1, team: 'red', alive: true, aircraft: place(0, 4000, -200, 0) },
    { index: 2, team: 'red', alive: true, aircraft: place(0, 4000, -1500, 0) },
  ]
  return createTargetBoard(cs)
}

/**
 * 四藍兩紅：藍 1/2/3 已經鎖定紅 4，紅 4 比紅 5 近。
 *
 * @param onGun `true` = 兩架紅機都在藍 0 的正前方（有射擊解）；
 *              `false` = 都在正側方（機首偏 90°，射擊解為 0）。
 *
 * 【為什麼要能切換】分攤在**有射擊解時不適用**（見 `TargetConfig.shotRelief`）。
 * 原本的幾何把紅機放在正前方，於是同一組場景現在同時受兩條規則管轄 ——
 * 要驗分攤就必須把目標移出射擊錐，否則量到的是另一條。兩種幾何都留著，
 * 兩條規則各有各的守門員。
 */
function crowdBoard(onGun: boolean): ReturnType<typeof createTargetBoard> {
  const at = (d: number) => (onGun ? place(0, 4000, -d, 0) : place(d, 4000, 0, 0))
  const cs: TargetCandidate[] = [
    { index: 0, team: 'blue', alive: true, aircraft: place(0, 4000, 0, 0) },
    { index: 1, team: 'blue', alive: true, aircraft: place(10, 4000, 0, 0) },
    { index: 2, team: 'blue', alive: true, aircraft: place(20, 4000, 0, 0) },
    { index: 3, team: 'blue', alive: true, aircraft: place(30, 4000, 0, 0) },
    { index: 4, team: 'red', alive: true, aircraft: at(300) },
    { index: 5, team: 'red', alive: true, aircraft: at(500) },
  ]
  const b = createTargetBoard(cs)
  b.assignments.set([-1, 4, 4, 4, -1, -1])
  return b
}

describe('selectTarget 的基本選擇', () => {
  it('選分數最高的敵機，並寫進 assignments', () => {
    const b = board3()
    const s = createTargetState()
    const t = selectTarget(s, b, 0, 0.1, DEFAULT_TARGET)
    expect(t).toBe(b.candidates[1]!.aircraft)
    expect(b.assignments[0]).toBe(1)
  })

  it('不會選同隊', () => {
    const cs: TargetCandidate[] = [
      { index: 0, team: 'blue', alive: true, aircraft: place(0, 4000, 0, 0) },
      { index: 1, team: 'blue', alive: true, aircraft: place(0, 4000, -100, 0) },
    ]
    const b = createTargetBoard(cs)
    expect(selectTarget(createTargetState(), b, 0, 0.1, DEFAULT_TARGET)).toBeNull()
  })

  it('沒有存活的敵機時回傳 null 並清掉指派', () => {
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, DEFAULT_TARGET)
    b.candidates[1]!.alive = false
    b.candidates[2]!.alive = false
    expect(selectTarget(s, b, 0, 0.1, DEFAULT_TARGET)).toBeNull()
    expect(b.assignments[0]).toBe(-1)
  })

  it('自己退場時回傳 null', () => {
    const b = board3()
    b.candidates[0]!.alive = false
    expect(selectTarget(createTargetState(), b, 0, 0.1, DEFAULT_TARGET)).toBeNull()
  })
})

describe('selectTarget 的遲滯', () => {
  it('最小停留期間不換目標，即使遠處那架突然變好', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 2, switchMargin: 0 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
    // 把 2 搬到比 1 更近，讓它分數更高
    b.candidates[2]!.aircraft.state.position.set(0, 4000, -50)
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
  })

  it('停留時間走完之後才換', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 0.5, switchMargin: 0 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    b.candidates[2]!.aircraft.state.position.set(0, 4000, -50)
    for (let i = 0; i < 6; i++) selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(2)
  })

  it('換目標門檻擋掉「只好一點點」的候選', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 0, switchMargin: 5 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    // 只把 2 搬到略近於 1，分數差遠低於 500%
    b.candidates[2]!.aircraft.state.position.set(0, 4000, -190)
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
  })

  it('目標退場時立即重選，不受最小停留約束', () => {
    const cfg = { ...DEFAULT_TARGET, minDwell: 999 }
    const b = board3()
    const s = createTargetState()
    selectTarget(s, b, 0, 0.1, cfg)
    expect(s.current).toBe(1)
    b.candidates[1]!.alive = false
    expect(selectTarget(s, b, 0, 0.1, cfg)).toBe(b.candidates[2]!.aircraft)
    expect(s.current).toBe(2)
  })
})

describe('selectTarget 的分攤', () => {
  it('打不到時：隊友都鎖定近的那架，我會挑遠的那架', () => {
    const b = crowdBoard(false)
    selectTarget(createTargetState(), b, 0, 0.1, { ...DEFAULT_TARGET, crowdPenalty: 1 })
    expect(b.assignments[0]).toBe(5)
  })

  it('crowdPenalty 為 0 時分攤完全不起作用', () => {
    const b = crowdBoard(false)
    selectTarget(createTargetState(), b, 0, 0.1, { ...DEFAULT_TARGET, crowdPenalty: 0 })
    expect(b.assignments[0]).toBe(4)
  })

  /**
   * 【這一條是新規則的守門員】同樣三個隊友壓在近的那架上，但這次我有射擊
   * 解 —— 該扣扳機，不該讓位。人工驗收看到的正是相反的行為：AI 把槍口上
   * 的敵機丟給隊友，去追一架更遠、角度更差的（實測佔長機換目標的 19.2%）。
   */
  it('打得到時：隊友再多也不讓位，選近的那架', () => {
    const b = crowdBoard(true)
    selectTarget(createTargetState(), b, 0, 0.1, DEFAULT_TARGET)
    expect(b.assignments[0]).toBe(4)
  })

  /** 關掉免除就回到舊行為 —— 證明差異確實來自這條新規則。 */
  it('shotRelief 為 0 時，打得到也照樣讓位', () => {
    const b = crowdBoard(true)
    selectTarget(createTargetState(), b, 0, 0.1, { ...DEFAULT_TARGET, shotRelief: 0 })
    expect(b.assignments[0]).toBe(5)
  })
})
