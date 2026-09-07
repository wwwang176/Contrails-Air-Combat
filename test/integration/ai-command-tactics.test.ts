import { describe, it, expect } from 'vitest'
import {
  allVictims, observe, runControl, wingmanRate, type Observed,
} from '../tools/tactics-observe'

/**
 * 指揮官下的側翼／集火命令，**受命分隊有沒有真的照做**。
 *
 * ── 【這一支不問「照做了有沒有比較好」】────────────────────
 *
 * 那是兩個不同的問題：
 *
 * ```
 *   照做了嗎        飛到指定的位置沒有、途中有沒有亂開槍、有沒有撞地
 *                   —— 是非題，一場仗就答得完
 *   照做有用嗎      繞過去之後開的那幾槍，角度有沒有比較好
 *                   —— 平均值，而且抖得很，要十幾場才問得出來
 * ```
 *
 * **第二個問題不是護欄該回答的。**「繞側翼是不是個好戰術」是設計判斷，
 * 由試飛裁定；想看數字跑 `test/tools/tactics-effect.probe.ts`。
 *
 * ── 【拆掉那一段之後，還有誰在守】──────────────────────
 *
 * ```
 *   側翼點算得對不對（繞到後面還是前面）   test/unit/ai-command.test.ts
 *   命令發不發得出來、配額對不對           同上
 *   飛機真的飛過去了、到位才解除           本檔
 *   途中不開槍、不撞地、僚機不掉目標       本檔
 * ```
 *
 * 側翼點的幾何有純函數測試釘死，所以「點放到錯的地方」不可能悄悄過關 ——
 * 那正是把效果統計搬走之後最容易被想成破洞的那一塊。
 *
 * ── 【三場，各跑一個受命分隊】────────────────────────
 *
 * 對照一場、側翼一場、集火一場。**這裡的每一條都是是非題或計數比，不是
 * 平均值**，所以不需要跨場合併取樣。
 *
 * 【樣本小不等於會飄】一場只注入得到個位數張命令（實測側翼 3 張、集火
 * 7 張），但**模擬是完全決定性的** —— 每次跑都是同樣那幾張、同樣的結果。
 * 小樣本在這裡只影響涵蓋多少情境，不會讓測試時綠時紅。真正需要大樣本的
 * 是平均值那一類，而那一類已經搬去探針了。
 */
const VICTIMS = allVictims()
const VICTIM = VICTIMS[0]!

const { ctrl, run: controlRun } = runControl(VICTIMS)
const flankRun: Observed = observe('flank', VICTIM, ctrl)
const focusRun: Observed = observe('focus', VICTIM)

describe('強制注入側翼（20v20、120 秒）', () => {
  const o = flankRun

  /** 【場景要成立】一張都沒注入的話，下面每一條都會空洞地通過 */
  it('真的注入過側翼命令', () => {
    expect(o.injected).toBeGreaterThan(0)
  })

  /**
   * 【側翼要到得了】spec §7.2 的第 24 條。**這就是「派了有沒有被執行」**
   * —— 命令是因為飛到位才解除的。
   *
   * 判準取多數而不是全部：混戰是混沌的，個別一張在途中被新的攻擊者打斷
   * 是正常的 —— 與第一份 §9.3 的「編隊收攏」同一個形狀，理由也相同。
   */
  it('多數側翼命令因為到位而解除', () => {
    console.log(JSON.stringify({
      injected: o.injected, cleared: o.cleared,
      firing: `${o.firingUnderOrder}/${o.samplesUnderOrder}`,
      wingmanRate: wingmanRate(o).toFixed(3),
      firingDefend: o.firingWhileDefend, firingRally: o.firingWhileRally,
      ground: o.groundUnderOrder,
    }))
    expect(o.cleared).toBeGreaterThan(o.injected / 2)
  })

  /**
   * 【途中不交戰】spec §4.4。
   *
   * 【為什麼量的是「意圖為 rally 的那些格」而不是全部】閃躲永遠優先是
   * 既定的規則：破防閂上時意圖是 `defend`，那些格**不受命令管**，
   * 而一架正在閃躲的飛機偶爾會打到一槍。要求「命令期間一槍都不開」等於
   * 順帶要求「閃躲時不准開槍」—— 那是一條沒有人下過的規定，而且對一個
   * 基線非零的量要求零，這個專案已經踩過三次。
   *
   * 開火的取樣幾乎全是 `defend`；`rally` 必須是 0。剩下零星幾格是僚機在
   * 「目標被清掉」的那一瞬，反應延遲管線裡還留著上一格的開火旗標
   *（每次轉換 ≤ 0.2 秒），那些格的意圖不是 `rally`。
   */
  it('側翼期間受命飛機一槍都不開', () => {
    expect(o.firingWhileRally).toBe(0)
  })

  /** 【安全層不豁免】判準與第一份的六場護欄同一條線 */
  it('側翼期間不動用安全層的撞地接管', () => {
    expect(o.groundUnderOrder).toBe(0)
  })

  it('沒有飛機掉到安全層的 clearance 以下', () => {
    expect(o.belowClearance).toBe(0)
  })
}, 10 * 60 * 1000)

describe('強制注入集火（20v20、120 秒）', () => {
  const on = focusRun
  const off = controlRun

  it('真的注入過集火命令', () => {
    expect(on.injected).toBeGreaterThan(0)
  })

  /**
   * 【集火要真的集中】spec §7.2 的第 27 條。**這是集火那一側的「有沒有被
   * 執行」** —— 量的是「受命分隊裡鎖著同一架的平均架數佔存活架數的
   * 比例」。
   *
   * 【0.30 的來歷】實測 0.476（四架的分隊約當兩架同時咬同一個），取約
   * 1.6 倍餘裕。**這是護欄不是參數** —— 它由實測定值，不隨掃描移動。
   */
  it('受命分隊鎖同一架的比例高於對照', () => {
    const share = on.focusLockSum / Math.max(on.focusLockDen, 1)
    console.log(JSON.stringify({
      injected: on.injected,
      focusShare: share.toFixed(3),
      offInjected: off.injected,
      onAll: (on.wingmanArmedAll / Math.max(on.wingmanSamplesAll, 1)).toFixed(3),
      offAll: (off.wingmanArmedAll / Math.max(off.wingmanSamplesAll, 1)).toFixed(3),
    }))
    expect(share).toBeGreaterThan(0.30)
  })

  /**
   * 【僚機不能被清掉目標】spec §7.2 的第 28 條，也是 §6.4 第 2 點最容易
   * 寫錯的地方。集火時僚機要靠 `LEVEL_FOCUS` 跟上，清掉目標會讓它掉進
   * 「沒有目標 → 飛站位」，集火就只剩長機一架在打。
   *
   * 【三方對照，門檻是中點】寫成「集火要比側翼高幾倍」的話會被全域效應
   * 推著跑：強制注入只釘住受命的那一支，另外九支仍然照配額走，所以整場
   * 仗本來就不同，三個母體會一起漂移。
   *
   * 改成問**同一次量測裡的三個母體誰站在哪一邊**：集火要落在自由與側翼的
   * 中點之上。這直接說出要防的失效模式 ——「集火會不會像側翼那樣把僚機的
   * 目標清掉」—— 而且**沒有可調的數字**，三個值一起漂移時它不動。
   */
  it('集火期間僚機仍然有目標', () => {
    const onRate = wingmanRate(on)
    const flankRate = wingmanRate(flankRun)
    const freeRate = off.wingmanArmedAll / Math.max(off.wingmanSamplesAll, 1)
    const mid = (freeRate + flankRate) / 2
    console.log(JSON.stringify({
      focusRate: onRate.toFixed(3),
      flankRate: flankRate.toFixed(3),
      freeRate: freeRate.toFixed(3),
      mid: mid.toFixed(3),
    }))
    // 【自由要真的高於側翼】否則中點沒有意義，兩條斷言會一起空洞地通過
    expect(freeRate).toBeGreaterThan(flankRate)
    expect(onRate).toBeGreaterThan(mid)
  })

  it('集火期間不動用安全層的撞地接管', () => {
    expect(on.groundUnderOrder).toBe(0)
  })
}, 10 * 60 * 1000)
