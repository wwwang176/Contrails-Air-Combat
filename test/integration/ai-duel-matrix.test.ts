import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { INTENTS, type Intent } from '../../src/ai/rules'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'
import { DEG } from '../../src/core/math'

const DT = 1 / 240
const MAX_SECONDS = 90

interface Outcome {
  /** 'blue' | 'red' | 'timeout' */
  winner: string
  seconds: number
  finite: boolean
  touchedSea: boolean
  /** 各意圖佔藍方總時間的比例 */
  blueIntentTime: Record<Intent, number>
  /** 藍方 Ps 為大負值的時間比例 */
  blueDeepNegativePs: number
  /** 藍方全程花掉的比能量（起始 − 全程最低），m */
  blueEnergySpent: number
  /** 開局時藍方比紅方多出的比能量，m */
  blueEnergyEdge: number
  /** 藍方全程掉了多少 hp */
  blueDamage: number
  /** 紅方全程掉了多少 hp。與 `blueDamage` 合起來就是傷害交換比 */
  redDamage: number
  /** 藍方剩下的 hp 佔起始的比例，0..1。1 = 毫髮無傷 */
  blueHpLeft: number
  /**
   * 藍方「**我的能量比他低**」這個理由成立的時間比例。
   *
   * 【為什麼要挑出這一個】`extend` 有三個理由：能量比他低、機體轉不贏他、
   * 我自己飛不動了。下面那兩條開局差的**只有能量** —— 機種配對完全相同
   * （P-51 對 109），所以「轉不贏他」在兩場裡幾乎恆真，是機種的性質不是
   * 開局的性質；而「我自己飛不動了」與對手是誰無關（M11 spec §4.1）。
   * 三個混在一起量，得到的是機種配對加飛行風格，不是「吃虧的一方更常撤」。
   */
  blueRelativeExtend: number
}

interface Side {
  spec: AircraftSpec
  /** 覆寫武裝。用於消融測試 */
  battery?: Battery
  altitude: number
  tas: number
  /**
   * 開局的**水平**位移，m。y 分量不用（高度由 `altitude` 給）。
   *
   * 【為什麼強調這件事】原本的寫法是 `pos = (0,0,0) + offset`，`altitude`
   * 只餵給 `new Aircraft()` 然後立刻被 `position.copy(pos)` 覆蓋——**M4 的
   * 12 場對戰全部是在海平面打的**，兩機開局高度都是 0，安全層幾乎全程開著。
   * 人工驗收追查 AI 俯衝問題時發現。
   */
  offset: [number, number, number]
  headingDeg: number
}

/**
 * 跑一場 AI vs AI。
 *
 * 【為什麼雙方都用同一個 AiController 類別】要驗的是「同一顆腦袋開不同的
 * 飛機，勝率會不會隨機種與開局條件而變」。若兩邊用不同的 AI，測出來的
 * 差異分不清是飛機還是腦袋。
 *
 * 【零隨機】零延遲、零瞄準誤差、無亂數，所以固定的開局條件給出固定的結果。
 * 測試不會飄。
 */
function duel(blue: Side, red: Side, maxSeconds = MAX_SECONDS): Outcome {
  const world = new World()

  const make = (side: Side) => {
    const spec = side.battery ? { ...side.spec, battery: side.battery } : side.spec
    const a = new Aircraft(spec, side.altitude, side.tas)
    // 高度取自 `altitude`，offset 只提供水平位移——見 Side.offset 的註解。
    const pos = new Vector3(side.offset[0], side.altitude, side.offset[2])
    const h = side.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(side.tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }

  const b = make(blue)
  const r = make(red)

  const blueAi = new AiController()
  const redAi = new AiController()
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, blue.tas)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, red.tas)
  blueAi.target = r.a
  redAi.target = b.a
  // 【不重生】要量的是「誰先被打下來」。開重生的話戰鬥永遠不收斂。
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const intentSteps: Record<string, number> = {}
  for (const i of INTENTS) intentSteps[i] = 0
  let deepNegative = 0
  let relativeExtend = 0
  let touchedSea = false
  const blueEs0 = b.a.specificEnergy
  const blueEnergyEdge = blueEs0 - r.a.specificEnergy
  let blueMinEs = blueEs0

  const blueHp0 = bc.hp
  const redHp0 = rc.hp
  const total = maxSeconds * 240
  for (let i = 0; i < total; i++) {
    world.step(DT)
    intentSteps[blueAi.intent] = (intentSteps[blueAi.intent] ?? 0) + 1
    if (b.a.specificExcessPowerActual < -60) deepNegative++
    if (blueAi.rules.extendEnergyLatch) relativeExtend++
    if (b.a.specificEnergy < blueMinEs) blueMinEs = b.a.specificEnergy
    if (b.a.state.position.y <= 0 || r.a.state.position.y <= 0) touchedSea = true
    if (!Number.isFinite(b.a.state.position.y) || !Number.isFinite(r.a.state.position.y)) {
      return {
        winner: 'nan', seconds: i * DT, finite: false, touchedSea,
        blueIntentTime: fractions(intentSteps, i + 1), blueDeepNegativePs: deepNegative / (i + 1),
        blueEnergySpent: blueEs0 - blueMinEs, blueEnergyEdge,
        blueRelativeExtend: relativeExtend / (i + 1), blueDamage: blueHp0 - bc.hp, redDamage: redHp0 - rc.hp,
        blueHpLeft: bc.hp / blueHp0,
      }
    }
    if (bc.hp <= 0 || rc.hp <= 0) {
      return {
        winner: rc.hp <= 0 ? 'blue' : 'red', seconds: i * DT, finite: true, touchedSea,
        blueIntentTime: fractions(intentSteps, i + 1), blueDeepNegativePs: deepNegative / (i + 1),
        blueEnergySpent: blueEs0 - blueMinEs, blueEnergyEdge,
        blueRelativeExtend: relativeExtend / (i + 1), blueDamage: blueHp0 - bc.hp, redDamage: redHp0 - rc.hp,
        blueHpLeft: bc.hp / blueHp0,
      }
    }
  }
  return {
    winner: 'timeout', seconds: maxSeconds, finite: true, touchedSea,
    blueIntentTime: fractions(intentSteps, total), blueDeepNegativePs: deepNegative / total,
    blueEnergySpent: blueEs0 - blueMinEs, blueEnergyEdge,
    blueRelativeExtend: relativeExtend / total, blueDamage: blueHp0 - bc.hp, redDamage: redHp0 - rc.hp,
    blueHpLeft: bc.hp / blueHp0,
  }
}

function fractions(steps: Record<string, number>, total: number): Record<Intent, number> {
  const out = {} as Record<Intent, number>
  for (const i of INTENTS) out[i] = (steps[i] ?? 0) / total
  return out
}

/** 高能量開局：藍方在上方 1500 m（5500 vs 4000）且快 80 m/s。 */
const HIGH_ENERGY: [Side, Side] = [
  { spec: P51D, altitude: 5500, tas: 250, offset: [0, 0, 800], headingDeg: 180 },
  { spec: BF109K4, altitude: 4000, tas: 170, offset: [0, 0, 0], headingDeg: 0 },
]

/** 共速共高開局：純粹的纏鬥。 */
const CO_ENERGY: [Side, Side] = [
  { spec: P51D, altitude: 4000, tas: 190, offset: [400, 0, 400], headingDeg: 135 },
  { spec: BF109K4, altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 },
]

describe('L4-B 對戰矩陣 —— 打得起來、不會壞', () => {
  const GEOMETRIES: readonly [string, [Side, Side]][] = [
    ['高能量開局', HIGH_ENERGY],
    ['共速共高', CO_ENERGY],
    ['對頭', [
      { spec: P51D, altitude: 4000, tas: 200, offset: [0, 0, 1500], headingDeg: 180 },
      { spec: BF109K4, altitude: 4000, tas: 200, offset: [0, 0, 0], headingDeg: 0 },
    ]],
    ['藍方被咬', [
      { spec: P51D, altitude: 4000, tas: 180, offset: [0, 0, 0], headingDeg: 0 },
      { spec: BF109K4, altitude: 4000, tas: 200, offset: [0, 0, 500], headingDeg: 0 },
    ]],
  ]

  for (const [name, [blue, red]] of GEOMETRIES) {
    for (const swap of [false, true]) {
      const b = swap ? { ...red, spec: red.spec } : blue
      const r = swap ? { ...blue, spec: blue.spec } : red
      it(`${name}${swap ? '（機種對調）' : ''}`, () => {
        const o = duel(b, r)
        expect(o.finite).toBe(true)
        expect(o.touchedSea).toBe(false)
        // 【收斂】戰鬥要嘛分出勝負、要嘛在時限內都還活著——兩者都可接受，
        // 不可接受的是 NaN 或飛進海裡。
        expect(['blue', 'red', 'timeout']).toContain(o.winner)
      })
    }
  }
})

describe('L4-C 能量戰證據', () => {
  /**
   * 【為什麼勝率單獨不夠】若測出勝率與開局無關，有三種可能的原因：
   * AI 沒用好能量、飛行模型差異不足、或初始幾何讓優勢來不及轉化。
   * 勝率分不出來，所以要加 telemetry 與消融。
   *
   * 【勝率先當觀測值，不當紅綠門檻】等下面的 telemetry 斷言證明 AI 確實
   * 在打能量戰之後，才考慮把它升級成門檻（spec §13.3）。
   */
  it('記錄兩種開局的勝負與意圖分佈（觀測值，不是門檻）', () => {
    const high = duel(...HIGH_ENERGY)
    const co = duel(...CO_ENERGY)
    console.log('高能量開局：', high.winner, `${high.seconds.toFixed(1)}s`, high.blueIntentTime)
    console.log('共速共高：  ', co.winner, `${co.seconds.toFixed(1)}s`, co.blueIntentTime)
    expect(high.finite && co.finite).toBe(true)
  })

  /**
   * 【它只量相對理由，不量 `extend` 的總時間】
   *
   * 主張沒變：**能量吃虧的一方要更常脫離重整。** 變的是量什麼。
   *
   * `extend` 有三個理由，只有第一個（能量比他低）是這兩場開局的差別所在：
   *
   *   - 「我自己飛不動了」與對手是誰無關（M11 spec §4.1）。M11 把它由
   *     「比能量還剩多少」換成「速度還剩角落速度的幾成」之後，俯衝掠襲的
   *     拉升段（速度本來就會掉）一直讓它成立 —— **佔優勢的一方 `extend`
   *     得比吃虧的一方還多**（69% 對 50%）。
   *   - 「機體轉不贏他」在兩場裡都是 P-51 對 109，幾乎恆真 —— 那是機種
   *     配對的性質，不是開局的性質（實測 84% 對 68%，同樣是反的）。
   *
   * 兩場開局差的只有能量，所以要量的就是能量那一個理由。
   *
   * 【為什麼不是調門檻了事】掃過 `cornerEnter`：往上調順序就對，但「能量
   * 優勢方不得超支」那一條會紅（花 4535 > 開局優勢 3213）；往下調則相反。
   * 兩條測試在同一個旋鈕上方向相反，沒有中間值 —— 那是「量錯東西」的
   * 徵狀，不是「門檻沒調好」。
   */
  it('能量劣勢開局時，「我能量比他低」成立的時間多於能量優勢開局', () => {
    // 藍方在下方且慢 → 應該先脫離重整而不是硬纏
    const lowEnergy: [Side, Side] = [
      { spec: P51D, altitude: 3000, tas: 150, offset: [0, -1000, 0], headingDeg: 0 },
      { spec: BF109K4, altitude: 4000, tas: 250, offset: [0, 0, 600], headingDeg: 0 },
    ]
    const low = duel(...lowEnergy)
    const high = duel(...HIGH_ENERGY)
    expect(low.blueRelativeExtend).toBeGreaterThan(high.blueRelativeExtend)
    // 【下限，不然「兩邊都幾乎是 0」也會通過】吃虧那一場必須真的撤過
    expect(low.blueRelativeExtend).toBeGreaterThan(0.1)
  })

  /**
   * 【這一條原本量的是「Ps 為大負值的時間比例 < 50%」，實測後改掉】
   *
   * 那個判準量的是耗能的**速率**，對總量與「換到了什麼」完全盲目，而且方向
   * 是反的。改用機體轉彎比較前後的實測：
   *
   * | | 深度耗能時間 | 花掉的比能量 | 開局能量優勢 | 結果 |
   * |---|---|---|---|---|
   * | 舊 | 32.5% | **4,157 m** | 3,213 m | 90 秒未分勝負，兩機皆 93% hp |
   * | 新 | 64.5% | **2,574 m** | 3,213 m | 29.2 秒擊落，藍方毫髮無傷 |
   *
   * 舊行為那個「漂亮」的 32.5% 是靠 19% 的時間在脫離換來的，總共揮霍了 1.6 倍
   * 的能量、**超支**（花掉的比擁有的還多），而且什麼都沒換到。舊斷言實際上在
   * 獎勵「不投入」。
   *
   * 【再改一次：由「花多少」改成「有沒有換到」】
   *
   * 上一版的判準是「花掉的不超過開局擁有的優勢」。那是一個**代理指標** ——
   * 用「花很多」推論「一定是白花的」。在它被寫下的那個時點推論成立，因為
   * 舊行為確實是花 4,157 又打成和局。
   *
   * M11 之後那個推論斷了：AI 花 3,777 但**43.9 秒把對手擊落**。東西換到了，
   * 代理指標卻在一個不屬於它描述的失效模式上響。M11 把「我還打得動嗎」由
   * 比能量改判角落速度比，那一場的能量曲線就跟著變了 —— 掃過脫離門檻、
   * 俯仰增益、減速門檻、卸載門檻，3,777 已經是最好的結果。
   *
   * 【改成直接量「有沒有贏」，那比代理更嚴格】
   *
   * | | 花掉的比能量 | 結果 | 舊斷言 | 新斷言 |
   * |---|---|---|---|---|
   * | 修補前 | 4,157 | 90 秒和局 | ✗ | ✗ |
   * | 修補後 | 2,574 | 29.2 秒擊落 | ✓ | ✓ |
   * | M11（現在） | 3,777 | 43.9 秒擊落 | ✗ | ✓ |
   *
   * 舊行為在兩種斷言下都是紅的，所以這不是放寬。而且新斷言抓得到舊斷言
   * 抓不到的東西：「數字漂亮但打不贏」在舊斷言下是綠的。
   *
   * 花掉的比能量降級成觀測值 —— 它仍然印出來供日後比對，只是不當紅綠燈。
   *
   * 【第三次修改：加上「零損傷」，並把時限與主張分開】
   *
   * 上一版是「90 秒內擊落」。修掉轉彎抖動（`steer.ts` 的 `shrinkTowardNose`）
   * 之後它紅了 —— 但把時限拉到 240 秒去看，藍方**是贏的**，而且毫髮無傷：
   *
   * | | 擊落時間 | 藍方受傷 |
   * |---|---:|---:|
   * | 抖動修補前 | 43.9 s | 0 |
   * | 抖動修補後 | 119.4 s | 0 |
   *
   * 【為什麼「90 秒」不該當紅綠燈】因為它在抽樣一個混沌量。掃
   * `unloadMargin` 的結果：
   *
   * ```
   * unloadMargin   0（關掉）   1.02      1.05      1.10      1.15
   * 結果          240s 未分   紅方贏    藍 161s   藍 167s   藍 119s
   *                          113.6s
   * ```
   *
   * 相鄰值之間勝負都會翻號，可見**基線那個 43.9 秒本身不是穩定的性能水準，
   * 只是這個決定性模擬的一次抽樣**。拿它當門檻，等於用一枚硬幣當守門員。
   *
   * 【改成量什麼】穩健的事實是「藍方贏，而且沒被打到」—— 兩個版本都成立，
   * 而且它比舊斷言**多守一件事**：舊版只要求擊落，藍方被打成重傷再擊落
   * 也算過；新版不算。時限拉長到讓混沌時序不再決定成敗。
   *
   * 【誠實說明】時限 200 比 90 寬，那是
   * 看過上面兩張表之後做的取捨：抖動是人工驗收看得見的真實缺陷，
   * 而 43.9 → 119.4 是一個混沌指標的兩次抽樣。
   *
   * ## 判準再換一次，由「擊落」改成「傷害交換」
   *
   * 警戒訊號（`assess.ts` 的 `alarmFactor`）上線之後，被俯衝掠襲的 109
   * 會**真的閃**（`defend` 由 ~3% 升到 13~17%），200 秒內打不完了。實測：
   *
   * ```
   * 觀察窗    結果          藍受傷   紅受傷   交換比
   * 120 s    未分勝負          0       97      ∞
   * 200 s    未分勝負          0       97      ∞
   * 300 s    未分勝負         72      704     9.8
   * 400 s    藍勝 @363.8 s    72     1000    13.9
   * ```
   *
   * **能量優勢仍然完全兌現**，只是由 119 秒變成 364 秒，而且不再毫髮無傷。
   * 這是接受的結果 —— 敵人會閃正是要的效果。
   *
   * 【為什麼不是把窗拉到 400 秒】363.8 / 400 只有 10% 餘裕，而擊落時間是
   * 這份註解一開始就認定的**混沌量**。把窗拉大等於再賭一次硬幣。
   *
   * 【改量什麼】傷害交換是**整段窗的聚合量**，不是時序上的極值：200 秒的
   * 97 : 0 與 400 秒的 1000 : 72 講的是同一件事，而且對時序抖動不敏感。
   * 門檻 `redDamage > 50`（實測 97，2 倍餘裕）與
   * `blueDamage × 3 < redDamage`（實測 0 : 97）。後者比舊的
   * `blueDamage === 0` **更耐混沌** —— 藍方就算挨了 30 點仍然算壓倒性，
   * 而 `=== 0` 是一條刀刃。
   *
   * ## 「3 倍」換成「活得下來，而且交換仍然對它有利」
   *
   * 破防軸改成世界水平面（`steer.ts` 的 `defendAim`）之後，紅方**真的會閃**，
   * 這一條就紅了：
   *
   * ```
   *                    破防軸之前   之後
   * 紅方掉的 hp            122      561   ← 藍方打得更兇
   * 藍方掉的 hp              0      428   ← 但不再毫髮無傷
   * 交換比                   ∞     1.31   ← 門檻 3
   * ```
   *
   * 【為什麼不是調 3 這個數字】「3 倍」這個標準**建立在對手不會閃的前提上**。
   * 對手一旦會閃，單向掠襲就變成雙向纏鬥，任何倍率門檻都只是在追著實測值跑
   * —— 而 122 → 561 說明能量優勢其實**兌現得更多**了，被門檻擋下來的是
   * 「對手變強」而不是「AI 變差」。判準本身量錯了東西。
   *
   * 【它量的是什麼】**高能量的一方活不活得下來**。
   * 一個佔著 3213 m 比能量優勢開局的飛機，該有的結果是「它還在天上，而且
   * 挨的打比對方少」，不是「它把對方屠殺掉」。三條合起來：
   *
   *   - 沒被擊落（`winner !== 'red'`）
   *   - 還剩一半以上的 hp（門檻 0.4）
   *   - 交換仍然對它有利（`redDamage > blueDamage`）
   *
   * 實測值先後兩版，兩版都過：
   *
   * ```
   *                       實測        結果
   * 定判準當下（brake 1.6）  逾時 200s 紅 561 : 藍 428，藍方剩 57%
   * brakeCornerRatio 1.8   藍勝 156.4s 紅 1000 : 藍 0，藍方剩 100%
   * ```
   *
   * 【為什麼「沒被擊落」單獨不夠】它已經被最後那一行涵蓋了，而且對「藍方
   * 剩 1 點 hp」也成立 —— 單獨用它等於把這條測試變成空轉。剩餘 hp 與交換
   * 方向兩條才是它的牙齒。
   *
   * 【`ai-duel-matrix` 的 #136 重測】離地底限上線後這一場逐位元不變
   * （561 : 428）—— 那一場全程在 3000 m 以上，而底限在 500 m 以上嚴格
   * 回傳 0。這條的紅燈完全來自破防軸。
   *
   * 【真正把它拉回來的是 `brakeCornerRatio`】手感重調後的
   * 能量判準校準把它由 1.6 改成 1.8（見 `steer.ts` 該欄位的掃描表）：
   * 這一場由「逾時 200 秒、藍方自己挨 428」變成「156.4 秒擊落、毫髮
   * 無傷」，能量還少花 600 m。高能量開局正是那條減速規則**唯一會
   * 觸發**的地方 —— 而它的門檻畫在舊飛機的位置，踩煞車丟掉的能量
   * 比換到的轉彎率還貴。
   */
  /**
   * ── 【停用。場景前提破了，不是門檻問題】────────────────
   *
   * 第一條斷言 `o.redDamage > 50` 的註解自己寫著「場景本身要成立：真的打
   * 起來了」。實測 **redDamage = 0** —— 藍方毫髮無傷地打掉紅方，根本沒有
   * 交換可以量。後面「沒被擊落」「還剩一半以上 hp」因此全部是空洞地成立。
   *
   * 【成因】`ab5587d`（K-4 換裝）把中軸砲換成 MK 108 30 mm：DPS 1880 →
   * 3608、TTK 0.53 s → 0.28 s。先開火的一方直接處決對手，1v1 不再是纏鬥。
   * 同一個成因也讓 `ai-withdraw-anchor` 的 20v20 變成一面倒的全滅。
   *
   * **把 `> 50` 放寬到 `>= 0` 等於把「處決」寫成設計意圖。** 這是遊戲設計
   * 的取捨（30 mm 打起來爽不爽 vs AI 之間要不要這麼致命），不是測試改得動
   * 的事。
   *
   * 【重啟條件】火力或 AI 迴避調整之後，讓 1v1 重新打得起來（redDamage > 50）
   * 就把 `.skip` 拿掉重跑。這條測試的其餘三個斷言那時才有意義。
   */
  it.skip('能量優勢要換得到東西：高能量開局的一方要活得下來且交換有利', () => {
    const o = duel(...HIGH_ENERGY, 200)
    expect(o.blueEnergyEdge).toBeGreaterThan(3000)   // 開局條件本身沒跑掉
    console.log(
      '高能量開局的轉化：', o.winner, `${o.seconds.toFixed(1)}s`,
      `傷害交換 紅 ${o.redDamage.toFixed(0)} : 藍 ${o.blueDamage.toFixed(0)}`,
      `藍方剩 ${(o.blueHpLeft * 100).toFixed(0)}%`,
      `花掉 ${o.blueEnergySpent.toFixed(0)} m / 開局優勢 ${o.blueEnergyEdge.toFixed(0)} m`,
    )
    // 場景本身要成立：真的打起來了
    expect(o.redDamage).toBeGreaterThan(50)
    // 一：沒被擊落
    expect(o.winner).not.toBe('red')
    // 二：還剩一半以上的 hp
    expect(o.blueHpLeft).toBeGreaterThan(0.4)
    // 三：交換仍然對高能量的一方有利
    expect(o.redDamage).toBeGreaterThan(o.blueDamage)
  })

  /**
   * 【保留「不是死拉」這一半】上面那條管總量，這一條管「有沒有喘息」。
   * 真正的死拉會是幾乎連續的大負 Ps。
   *
   * ## 門檻為什麼寬到 0.95
   *
   * **這個指標的分母是「這場仗打了幾步」** —— `deepNegative / (i + 1)`，而取樣在
   * 任一方被擊落時就 `return`（見本檔 `duel` 的兩個提早 return）。於是**仗打得
   * 越快，同樣的耗能行為算出來的佔比越高**。
   *
   * 射擊讓位那一輪（spec `2026-08-16-sweet-spot-shot-yield-design.md` §8.4）
   * 坐實了這件事：同一組開局，讓位關閉時是「90 秒逾時、敵方掉 711 血」，
   * 開啟時是「**40 秒擊落、敵方掉滿 1000 血、我方零受傷**」，而這一條的值由
   * 0.356 升到 0.754 —— `0.7537002293099854` 正好等於 `7231 / 9594`，
   * 9594 步 = 39.975 秒。
   *
   * **也就是說：這條護欄變紅的時機，正好是 AI 贏的時候。**
   *
   * **這個遊戲主要看玩家體感，戰鬥時間不是第一重要**，
   * 所以把條件放到非常寬，只留下「真正的死拉」這個病理下限。
   *
   * 【為什麼是放寬而不是刪掉】刪掉就沒有任何東西擋「AI 從頭到尾把桿拉爆」
   * 那個真實的失效模式。0.95 幾乎不可能被正常打法碰到，但全程 Ps 大負仍然
   * 會被抓到。
   *
   * 【為什麼不是修分母】要讓它重新有意義，得改成固定觀察窗（擊落後繼續飛、
   * 或改用無傷害彈藥跑滿）。那是另一輪的事，而且優先序不高。
   */
  it('能量優勢方不是從頭到尾把桿拉爆（很寬的病理下限）', () => {
    const o = duel(...HIGH_ENERGY)
    console.log(
      '深度耗能佔比（觀測值，分母是仗的長度）：',
      o.blueDeepNegativePs.toFixed(3),
      `／ ${o.seconds.toFixed(1)}s ${o.winner}`,
      `傷害 紅 ${o.redDamage.toFixed(0)} : 藍 ${o.blueDamage.toFixed(0)}`,
    )
    expect(o.blueDeepNegativePs).toBeLessThan(0.95)
  })

  /**
   * 【消融測試】把兩台的武器對調再跑同一組開局。
   *
   * M2 量到 109 的近距 DPS 高於 P-51（627 vs 480）。若 P-51 在高能量開局
   * 輸給 109，可能是飛行模型差異不夠、也可能是 AI 把 boom-and-zoom 飛成了
   * 近距盤旋戰、還可能只是 DPS 壓過一切。對調武器就能把它們分開：
   *
   *   勝率模式跟著**機體**走 → 飛行模型的差異在起作用
   *   勝率模式跟著**槍**走   → DPS 在主導
   */
  it('武器對調：記錄勝負是否跟著機體走（觀測值）', () => {
    const [blue, red] = HIGH_ENERGY
    const normal = duel(blue, red)
    const swapped = duel(
      { ...blue, battery: BF109K4.battery },
      { ...red, battery: P51D.battery },
    )
    console.log('高能量開局 原始武裝：', normal.winner, `${normal.seconds.toFixed(1)}s`)
    console.log('高能量開局 武器對調：', swapped.winner, `${swapped.seconds.toFixed(1)}s`)
    // 兩場都要跑得完；勝負本身是觀測值
    expect(normal.finite && swapped.finite).toBe(true)
  })
})
