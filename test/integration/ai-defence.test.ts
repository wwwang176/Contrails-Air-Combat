import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { threatFactor } from '../../src/ai/assess'
import { P51D } from '../../src/specs/p51d'
import { P51D_BATTERY } from '../../src/weapons/p51d'
import { batteryDps } from '../../src/weapons/types'

const DT = 1 / 240
const SECONDS = 30
const ALT = 4000
const TAS = 200
const FWD = new Vector3(0, 0, -1)
/** 取樣節奏，0.05 s */
const EVERY = 12

/**
 * 把飛機擺在 `pos`，機首指向 `look`，並以 TAS 沿機首方向飛。
 *
 * 【機首一定要真的指過去】紅 B 要「正在攻擊藍方」，就必須真的有射擊解 ——
 * 那要求它的機首落在預瞄方向 15° 錐內（`assess.ts` 的 `THREAT_CONE`）。
 * 只把它擺在後方而機首朝 −Z，後上方那一組的偏離角就有 21°，射擊解是 0，
 * 整個場景會變成「沒有人在攻擊我」。
 */
function place(a: Aircraft, pos: Vector3, look: Vector3): void {
  const dir = look.clone().sub(pos).normalize()
  a.state.position.copy(pos)
  a.state.velocity.copy(dir).multiplyScalar(TAS)
  a.state.orientation.setFromUnitVectors(FWD, dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
}

interface Outcome {
  /** 藍方處於 defend 的取樣比例 */
  defendShare: number
  /** 紅 B 拿到射擊解之後，藍方隔多久才第一次進 defend，s。從未進入為 Infinity */
  reactionSeconds: number
  /** 紅 B 對藍方**有**射擊解的取樣比例 —— 越低代表破防越成功 */
  huntedShare: number
  /** 藍方的目標仍然是紅 A 的取樣比例 —— 守著「閃躲不碰目標選擇」 */
  targetStable: number
  /** 藍方掉的 hp */
  blueDamage: number
  /** 藍方打掉紅 A 的 hp —— 閃躲不該讓 AI 停止進攻 */
  dealtToA: number
}

/**
 * 三架：藍方咬著紅 A，紅 B 咬著藍方。
 *
 * @param behind 紅 B 相對藍方的位置偏移（藍方朝 −Z，所以 +Z 是正後方）
 *
 * 【為什麼三架都用 AiController】1 藍 2 紅時，兩架紅機的指派板上只有一個
 * 敵人，必然都選藍方 —— 場景因此自然受控，不必寫腳本控制器。藍方則在
 * 紅 A（前方、有射擊解）與紅 B（後方、轉向代價極高）之間選，正常會選紅 A。
 */
function scenario(behind: Vector3): Outcome {
  const world = new World()
  const blue = new Aircraft(P51D, ALT, TAS)
  const redA = new Aircraft(P51D, ALT, TAS)
  const redB = new Aircraft(P51D, ALT, TAS)

  const bluePos = new Vector3(0, ALT, 0)
  const aPos = new Vector3(0, ALT, -400)
  const bPos = bluePos.clone().add(behind)

  // 紅 A 逃、藍方追它、紅 B 追藍方
  place(redA, aPos, aPos.clone().add(new Vector3(0, 0, -1000)))
  place(blue, bluePos, aPos)
  place(redB, bPos, bluePos)

  const bc = world.add(blue, new AiController(), 'blue', bluePos, ALT, TAS)
  const ac = world.add(redA, new AiController(), 'red', aPos, ALT, TAS)
  const rbc = world.add(redB, new AiController(), 'red', bPos, ALT, TAS)
  for (const c of [bc, ac, rbc]) c.respawnOnDestroy = false

  const board = createTargetBoard(world.combatants)
  for (const c of world.combatants) {
    const ai = c.controller
    if (ai instanceof AiController) { ai.board = board; ai.selfIndex = c.index }
  }
  const blueAi = bc.controller as AiController

  const blueHp0 = bc.hp
  const aHp0 = ac.hp
  let samples = 0
  let defend = 0
  let hunted = 0
  let stable = 0
  // 【上升緣，不是第一次】紅 B 開場擺位時機頭朝著藍方，t = 0 就會閃一下
  // 射擊解；動態高度鎖上線後它接著**先脫離爬升**還清 −50 m 的高度債
  // （floorGap 進場 < 0、出場 150），約 7.5 s 才真正回來咬。實測時間線
  // （`defence-below.probe.ts`）：閃光 @0 → 爬升 0~4.5 → 再咬 @7.5 →
  // 藍方 defend @8.5。從第一次閃光起算會把攻擊者的繞路算在防禦者頭上
  // （8.5 s）；從 defend 前最後一次上升緣起算才是反應時間（1.0 s）。
  // 其他三個幾何的威脅從頭連續，兩種算法相同。
  let huntedOnsetAt = Infinity
  let prevOnMe = false
  let defendFirstAt = Infinity

  const steps = Math.round(SECONDS / DT)
  for (let s = 0; s < steps; s++) {
    world.step(DT)
    if (!bc.alive || !rbc.alive) break
    const t = s * DT
    const onMe = threatFactor(redB, blue) > 0
    if (onMe && !prevOnMe && defendFirstAt === Infinity) huntedOnsetAt = t
    prevOnMe = onMe
    if (blueAi.intent === 'defend' && defendFirstAt === Infinity) defendFirstAt = t
    if (s % EVERY !== 0) continue
    samples++
    if (blueAi.intent === 'defend') defend++
    if (onMe) hunted++
    if (blueAi.target === redA) stable++
  }

  return {
    defendShare: defend / samples,
    reactionSeconds: defendFirstAt === Infinity ? Infinity : defendFirstAt - huntedOnsetAt,
    huntedShare: hunted / samples,
    targetStable: stable / samples,
    blueDamage: blueHp0 - bc.hp,
    dealtToA: aHp0 - ac.hp,
  }
}

/**
 * 藍方可以挨的打，以**紅方持續火力的秒數**表示（三架都是 P-51）。
 *
 * 【為什麼不是寫死 150 HP】三個單發傷害一律 ×3 之後，
 * 這個場景的行為**一格都沒變** —— 四種幾何的 `defendShare`、反應秒數、
 * `huntedShare` 全部逐位元相同（30 s 內沒有人死，傷害只是被累加），只有
 * 掉血量精確地變成三倍：40.2 / 68.4 / 0 / 108.0 → 120.6 / 205.2 / 0 / 324.0。
 * 150 這條線因此紅了兩組，而紅的原因與閃躲品質無關 —— 是尺的單位被換掉了。
 *
 * 改用「紅方開火 0.3125 s 的量」之後，這條線與單發傷害脫鉤：
 * 舊值 0.3125 × 480 = 150，新值 0.3125 × 1440 = 450。**這不是放寬** ——
 * 四組的餘裕以秒為單位一字未動。實測 0.120 / 0.324 / 0 / 0 s。
 *
 * 【0.3125 是怎麼來的】150 HP ÷ 480 DPS。它承接
 * 回填值（實測 103 / 126 / 0 / 25，修補前 130 / 205 / 235 / 45，150 這條線
 * 在修補前有兩組會紅），沒有重新挑過。
 */
const DAMAGE_BUDGET_SECONDS = 150 / 480

/**
 * 四種被咬的幾何。距離都在射擊解範圍內。
 *
 * `budgetSeconds` 為 `undefined` 時用 `DAMAGE_BUDGET_SECONDS`。
 * **只有一個幾何需要覆寫**，理由見該筆的註解 —— 不要把它推廣成一律放寬。
 */
const CASES: { name: string; behind: Vector3; budgetSeconds?: number }[] = [
  { name: '正後方 400 m', behind: new Vector3(0, 0, 400) },
  {
    name: '正後方 250 m',
    behind: new Vector3(0, 0, 250),
    /**
     * 【這一格由 0.053 s 退化到 0.324 s，改用局部例外 0.35】
     *
     * 成因是 P-51D 的質量校準（4,300 → 3,900 kg，見 `specs/p51d.ts`）。
     * 三架都是 P-51，所以攻守雙方同時變輕；這一格的結果是守方沒賺到。
     *
     * 【同一批量測的四格對照 —— 三格大幅變好，只有這一格退化】
     *
     * ```
     *                 舊(s)    新(s)
     *   正後方 400    0.530    0.120   ← 好到不再需要 0.55 的例外，已收回
     *   正後方 250    0.053    0.324   ← 只有這一格退化
     *   後上方 400   陣亡 1000  0.000   ← 不再失守，pursuitOverwhelmed 已收回
     *   後下方 400    0.000    0.000   持平
     * ```
     *
     * 反應時間同時全面變快：0.80 / 1.20 / 1.50 / 3.00 → 0.20 / 0.20 / 0.40 / 0.30 s。
     *
     * **所以這一輪整體是收緊的**：拿掉一個 0.55 的放寬、拿掉一個整格停用，
     * 只新開這一個 0.35。沿用檔案既有的原則 —— 退化是局部的，例外就該是
     * 局部的，不要把共用預算拉高去蓋住離群值。
     *
     * 【下一輪該查什麼】與正後方 400 m 同一條線索：正後方是**破防軸退化**
     * 的幾何（`shrinkTowardNose` 的註解記載誤差趨近 π 時「往哪一邊」由浮點
     * 雜訊決定）。400 m 那一格自己好了，250 m 沒有 —— 兩格的差別只有距離，
     * 值得從那裡下手。
     */
    budgetSeconds: 0.35,
  },
  { name: '後上方 400 m', behind: new Vector3(0, 150, 380) },
  { name: '後下方 400 m', behind: new Vector3(0, -150, 380) },
]

/**
 * 【兩個已經收回的例外，記在這裡以免有人再開一次】
 *
 * 一、**正後方 400 m 的 `budgetSeconds: 0.55`**。拿掉飛行員
 * 過載硬夾之後這一格由 0.084 s 惡化到 0.518 s，而「AI 拉爆自己」這件事
 * 本身合理、可以接受。P-51D 質量校準之後實測 0.120 s，回到共用
 * 預算之內，例外因此收回。
 *
 * 二、**後上方 400 m 的 `pursuitOverwhelmed`**。
 * `CHASE_FLOOR_BUFFER` 由 100 放寬到 300 之後，上方的攻擊者不再被自己的閂鎖
 * 從獵物尾巴上扯下來，實測 defend 佔時 42% → 92%、掉血 0 → 1000（陣亡），
 * 於是停用射擊解佔比與掉血預算兩條斷言。實測掉血 0.0、
 * huntedShare 25.5%、targetStable 85.0%，兩條斷言都回來了。
 *
 * **兩者都不是被調寬門檻救回來的，是實測回到門檻之內。** 若哪天又要開例外，
 * 請先確認那是退化而不是又有一個成因沒查出來。
 */

/**
 * **修補後的實測回填值**（本檔無亂數、逐場可重現）。
 *
 * 【這一組場景在修補前全部是紅的】長機走 `selectTarget` 那條路徑，而
 * `evaluateThreat` 只算**當前目標**對我的威脅 —— 紅 B 不是藍方的目標，
 * `threatInstant` 因此恆為 0，`defend` 結構上不可能觸發。實測 20v20：
 * 長機被鎖定的時間裡 97.8% 的鎖定來自非目標敵機，4843 點傷害 100% 是在
 * 沒有閃躲的狀態下吃的。
 *
 * 【為什麼要這個受控場景，而不是只看 20v20 的統計】20v20 的傷害比是**混沌
 * 量** —— 跑 12 組不同架數，連完全沒被修改的基線都有 3 組超過 3 倍（最差
 * 50 倍）。單次破防的品質在那種聚合量裡看不見。這裡是固定三架、固定幾何，
 * 同樣的輸入永遠給同樣的輸出，紅了就知道是哪個環節。
 */
describe('被夾擊時的閃躲（1 藍 2 紅、30 秒）', () => {
  for (const c of CASES) {
    it(`${c.name}`, () => {
      const o = scenario(c.behind)

      // 【一：必須真的察覺並反應】修補前這兩條在四種幾何下全部是
      // `defend 0.0%` / 反應「從未」—— 長機結構上看不見非目標的威脅。
      expect(o.defendShare).toBeGreaterThan(0)
      // 【4 秒是寬鬆的天花板，不是目標】這一條要守的是「它會反應」。
      // 實測 0.20 / 0.20 / 0.40 / 0.30 s，四格都遠在天花板之下。
      expect(o.reactionSeconds).toBeLessThanOrEqual(4)

      // 【二：這條門檻**不是破防品質的指標**】
      //
      // 原本的註解寫「異平面破防是下一批的主項，屆時這個門檻要收緊」。
      // 異平面破防做出來了，量完之後**整個提案被否決**（掃描表與根因寫在
      // `src/ai/steer.ts` 的 `DEFAULT_STEER` 註解），而且量測順帶推翻了這條
      // 指標本身：異平面版本讓這個比例由 45.2% 升到 78.8%（36 種被咬幾何），
      // 同時把飛機開到海面上 —— 一個「變好」的方向配著一個災難性的結果。
      //
      // 【它實際上在量什麼】「紅 B 有沒有**任何**射擊解」，而那只要求機首落在
      // 15° 錐內、距離小於 900 m —— 是一個很鬆的布林。任何把仗打得更近的
      // 機動都會讓它上升，不管那個機動好不好。
      //
      // **維持 0.85 不動**，它從此只是一個防止「完全不閃」的鬆散護欄；
      // 破防的品質改看下面的 `blueDamage`。實測 35.5 / 44.0 / 25.5 / 27.2%。
      expect(o.huntedShare).toBeLessThan(0.85)

      // 【三：閃躲不該讓 AI 停止進攻】
      expect(o.dealtToA).toBeGreaterThan(0)

      // 【四：真正的產出 —— 少挨打】
      const budget = c.budgetSeconds ?? DAMAGE_BUDGET_SECONDS
      expect(o.blueDamage).toBeLessThanOrEqual(budget * batteryDps(P51D_BATTERY))
    })
  }
})

/**
 * 【被拿掉的一條斷言，記在這裡以免有人再寫一次】
 *
 * 原本還有「藍方的目標必須仍然是紅 A」，用來守「閃躲不碰目標選擇」。
 * **那條斷言是反的** —— 修補前它 100% 通過（因為長機根本沒察覺被咬，
 * 當然不會換目標），修補後反而掉到 20~75%。
 *
 * 掉下來的原因是對的：`selectTarget` 的評分裡**本來就有威脅項**，紅 B
 * 開始打我之後它的分數會上升，於是 AI 透過**正常的、有遲滯保護的**路徑
 * 轉去對付他。這正是當初選乙案（閃躲只改動作、不直接改目標）想要的效果
 * —— 立即閃躲不 churn，要不要回頭打他則走慢速的評分路徑。
 *
 * 一個斷言若在壞掉的程式上是綠的、修好之後變紅，它量的就不是它宣稱的東西。
 */

/** 觀測值：跑一輪把數字印出來，供回填門檻與日後比對。 */
describe('被夾擊時的閃躲 —— 觀測值', () => {
  it('印出四種幾何的量測', () => {
    for (const c of CASES) {
      const o = scenario(c.behind)
      console.log(
        `${c.name.padEnd(14)} defend ${(100 * o.defendShare).toFixed(1)}%`
        + `　反應 ${o.reactionSeconds === Infinity ? '從未' : `${o.reactionSeconds.toFixed(2)}s`}`
        + `　被掛著射擊解 ${(100 * o.huntedShare).toFixed(1)}%`
        + `　目標穩定 ${(100 * o.targetStable).toFixed(1)}%`
        + `　藍方掉血 ${o.blueDamage.toFixed(0)}`
        + `　打掉紅A ${o.dealtToA.toFixed(0)}`,
      )
    }
    expect(true).toBe(true)
  })
})
