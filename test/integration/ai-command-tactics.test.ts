import { describe, it, expect } from 'vitest'
import { allVictims, observe, type Observed } from '../tools/tactics-observe'

/**
 * 指揮官下的側翼／集火命令，**受命分隊有沒有真的照做**。
 *
 * 這一支只問「照做了嗎」—— 飛到指定的位置沒有、途中有沒有亂開槍、有沒有
 * 撞地，都是是非題或計數比，一場仗就答得完。「照做了有沒有比較好」是設計
 * 判斷，由試飛裁定；想看數字跑 `test/tools/tactics-effect.probe.ts`。
 *
 * ```
 *   側翼點算得對不對（繞到後面還是前面）   test/unit/ai-command.test.ts
 *   命令發不發得出來、配額對不對           同上
 *   飛機真的飛過去了、到位才解除           本檔
 *   途中不開槍、不撞地                     本檔
 * ```
 *
 * 側翼一場、集火一場，各對同一個受命分隊強制注入。模擬是完全決定性的，
 * 每次跑都是同樣那幾張命令、同樣的結果。
 */
const VICTIM = allVictims()[0]!

const flankRun: Observed = observe('flank', VICTIM)
const focusRun: Observed = observe('focus', VICTIM)

describe('強制注入側翼（20v20、120 秒）', () => {
  const o = flankRun

  /** 【場景要成立】一張都沒注入的話，下面每一條都會空洞地通過 */
  it('真的注入過側翼命令', () => {
    expect(o.injected).toBeGreaterThan(0)
  })

  /**
   * 【側翼要到得了】命令是因為飛到位才解除的。
   *
   * 判準取多數而不是全部：混戰是混沌的，個別一張在途中被新的攻擊者打斷
   * 是正常的。
   */
  it('多數側翼命令因為到位而解除', () => {
    expect(o.cleared).toBeGreaterThan(o.injected / 2)
  })

  /**
   * 【途中不交戰】量的是意圖為 `rally` 的那些格，不是全部。
   *
   * 閃躲永遠優先：破防閂上時意圖是 `defend`，那些格不受命令管，而一架正在
   * 閃躲的飛機偶爾會打到一槍。僚機在「目標被清掉」的那一瞬，反應延遲管線
   * 裡還留著上一格的開火旗標（每次轉換 ≤ 0.2 秒），那些格的意圖也不是
   * `rally`。命令真的在生效的 `rally` 格必須是 0。
   */
  it('側翼期間受命飛機一槍都不開', () => {
    expect(o.firingWhileRally).toBe(0)
  })

  /** 【安全層不豁免】 */
  it('側翼期間不動用安全層的撞地接管', () => {
    expect(o.groundUnderOrder).toBe(0)
  })

  it('沒有飛機掉到安全層的 clearance 以下', () => {
    expect(o.belowClearance).toBe(0)
  })
}, 10 * 60 * 1000)

describe('強制注入集火（20v20、120 秒）', () => {
  const on = focusRun

  it('真的注入過集火命令', () => {
    expect(on.injected).toBeGreaterThan(0)
  })

  it('集火期間不動用安全層的撞地接管', () => {
    expect(on.groundUnderOrder).toBe(0)
  })
}, 10 * 60 * 1000)
