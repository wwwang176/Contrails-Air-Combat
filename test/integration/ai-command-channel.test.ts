import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_COMMAND } from '../../src/ai/command'
import { DEFAULT_WINGMAN } from '../../src/ai/wingman'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
/**
 * 【2026-08-09 由 120 改成 300】專案負責人裁定。
 *
 * 接敵約在開場 60 秒，所以 120 秒的窗口有一半在量開場巡航 —— 撤退令幾乎
 * 都發生在後半。撤退令改錨（`withdrawRange` 的語意換成「離敵群多遠」、
 * 加上殼外不發令的閘門）之後它不再自我延續，於是 120 秒窗口量到的離場
 * 佔時掉到 2.13%，而同一個指標在 300 秒是 7.20% —— 落在下面那條 5%~25%
 * 的帶內。**改的是取樣區間，5% 下界的語意原封不動。**
 *
 * 順帶一提：2026-08-07 那 22 組掃描用的正是這個 120 秒窗口，而撤退令的
 * 棘輪（每撤一次就再往外一個 withdrawRange）要到接敵之後才展開 ——
 * 窗口太短正是它當初漏掉的原因之一。
 */
const SECONDS = 300

/** 玩家座位放一個什麼都不做的控制器：平飛，不參戰 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.throttle = 0.7
    out.brake = 0
    out.firing = false
  }
}

interface Observed {
  /** 有沒有任何小隊收過命令 */
  issued: number
  /** 命令解除時是不是因為到達（而不是全滅） */
  arrived: number
  /** 命令期間，受命飛機進入 defend 的取樣數 */
  defendUnderOrder: number
  /** 命令期間，安全層的撞地接管取樣數 */
  groundUnderOrder: number
  /**
   * 命令期間，僚機的站位誤差超過 breakExit 的取樣數。
   *
   * 【觀測值，刻意不設門檻】原本的判準是「必須為 0」，實測否決：**沒有命令
   * 時的基線就是 8.31%**（`strayFree` / `wingmanFree`）。對一個基線非零的量
   * 要求零是不可能滿足的，與 task #136 那條 `minAlt > 500` 是同一類錯誤。
   *
   * 而且「有命令時比較高」（11.73% vs 8.31%）本身也不成立為證據 —— 命令正是
   * 發給**已經打散了的**小隊（發令當下僚機平均站位誤差 697 m），兩者有選擇
   * 效應。真正守著 spec §7.2 的是 `tightened` / `loosened`。
   */
  strayUnderOrder: number
  /** 命令解除時僚機平均站位誤差**小於**發令當下的張數 */
  tightened: number
  /**
   * 依命令種類分開的同一組量。**只為診斷存在，沒有任何斷言讀它** ——
   * 第一份的五條判準是為 `rally` 一種命令寫的，第二份加了兩種之後要先
   * 分得出「是哪一種讓總量動的」才談得上判斷。
   */
  byKind: Record<string, { issued: number, arrived: number, samples: number,
    tightened: number, loosened: number, ground: number,
    errSum0: number, errSum1: number, errN: number }>
  /** 無命令的飛機的撞地接管取樣數，與 `wingmanFree` 同一個對照組 */
  groundFree: number
  /** 無命令的取樣總數，當 `groundFree` 的分母 */
  freeSamples: number
  /** 反之。`tightened + loosened` = 有量到的命令張數 */
  loosened: number
  /** 任何飛機掉到安全層 clearance 以下的取樣數 */
  belowClearance: number
  /** 有命令的（飛機 × 取樣）數，除以總取樣數 = 命令佔時比例 */
  orderedSamples: number
  /** 存活的 AI 總取樣數，當分母 */
  aliveSamples: number
  /** 有站位參考機、且**沒有**命令時，站位誤差超過 breakExit 的取樣數 */
  strayFree: number
  /** 有站位參考機、沒有命令的取樣數，當 strayFree 的分母 */
  wingmanFree: number
  /** 有站位參考機、有命令的取樣數，當 strayUnderOrder 的分母 */
  wingmanUnderOrder: number
  /** 紅方全程掉的 hp */
  redDamage: number
  /** 藍方全程掉的 hp */
  blueDamage: number
  /**
   * 【spec §2.3 的觀測值，刻意不設門檻】命令發出的那一格，受命飛機正握有
   * 射擊解（`shotInstant > 0`）的架數累計。
   *
   * 「命令絕對」明知會重踩 `rules.ts` 記載的坑（AI 咬在敵機後方 236 m、
   * 正在開火時被切走，直飛 21 秒）而選擇踩它。這個數字把坑照亮：它高
   * **而且**傷害交換變差，才是同一個病復發；單看它高不算失敗，那是裁定
   * 接受的代價。
   */
  pulledWhileShooting: number
}

/**
 * 跑一場 20v20 並收集觀測值。
 *
 * @param commanders `false` = 關掉指揮層（每步把命令清乾淨），供 §7.3 對照。
 *   **不改生產程式碼**，因為那會讓「關掉」與「開著」跑的是兩份不同的東西。
 */
/**
 * 「離場」的兩種命令：`rally` 與 `flank`。**`focus` 不算。**
 *
 * 【為什麼要分】第一份的兩條判準（佔時上界、編隊收攏）都是為 `rally` 一種
 * 命令寫的，而它們的理由都建立在「這架飛機正在離開戰鬥」上：
 *
 * - 佔時上界 25% 的理由逐字是「場上有四分之一的飛機在離場 —— 那不是空戰」。
 * - 收攏量的是僚機的站位誤差，而它會縮小是因為僚機被清掉目標、掉進
 *   「沒有目標 → 飛站位」。
 *
 * `focus` 兩者都不成立：它是「打那一架」，一秒都沒有離場，而且僚機**刻意**
 * 保留目標去打（那正是 spec §6.4 第 2 點的機制）。把它算進去，兩條判準量的
 * 就不是它們自己在問的東西了。專案負責人 2026-08-07 裁定：兩條都只算
 * `rally` 與 `flank`。
 */
const LEAVING: readonly string[] = ['rally', 'flank']

/** 只算「離場」那兩種命令的佔時取樣 */
function leavingSamples(o: Observed): number {
  let n = 0
  for (const k of LEAVING) n += o.byKind[k]!.samples
  return n
}

function observe(commanders = true): Observed {
  const b: Battle = createBattle(new Idle())
  const o: Observed = {
    issued: 0, arrived: 0, defendUnderOrder: 0,
    groundUnderOrder: 0, strayUnderOrder: 0, belowClearance: 0,
    orderedSamples: 0, aliveSamples: 0,
    strayFree: 0, wingmanFree: 0, wingmanUnderOrder: 0,
    tightened: 0, loosened: 0,
    byKind: {
      rally: { issued: 0, arrived: 0, samples: 0, tightened: 0, loosened: 0, ground: 0, errSum0: 0, errSum1: 0, errN: 0 },
      flank: { issued: 0, arrived: 0, samples: 0, tightened: 0, loosened: 0, ground: 0, errSum0: 0, errSum1: 0, errN: 0 },
      focus: { issued: 0, arrived: 0, samples: 0, tightened: 0, loosened: 0, ground: 0, errSum0: 0, errSum1: 0, errN: 0 },
    },
    groundFree: 0, freeSamples: 0,
    redDamage: 0, blueDamage: 0, pulledWhileShooting: 0,
  }
  /** 開場的 hp，用來算全程掉了多少。與 `ai-duel-matrix` 同一個算法 */
  const hp0 = b.world.combatants.map((c) => c.hp)
  // 上一格每個分隊有沒有命令，用來數「新發出」與「解除」
  const had = new Array<boolean>(b.flights.flights.length).fill(false)
  /** 發令當下該分隊僚機的平均站位誤差，解除時拿來比。−1 = 那一張沒量到 */
  const issuedError = new Array<number>(b.flights.flights.length).fill(-1)
  /** 上一格那張命令是哪一種。解除時要知道是誰結束的 */
  const hadKind = new Array<string>(b.flights.flights.length).fill('')

  /**
   * 這個分隊**僚機**的平均站位誤差，m。沒有僚機時回 −1。
   *
   * 【為什麼只算僚機】長機沒有站位參考機，`stationError` 恆為 0，把它算進
   * 平均等於用一個常數稀釋訊號。
   */
  function meanWingmanError(f: number): number {
    const flight = b.flights.flights[f]!
    let sum = 0
    let n = 0
    for (let p = 0; p < flight.count; p++) {
      const c = b.world.combatants[flight.members[p]!]!
      if (!c.alive) continue
      const ai = c.controller
      if (!(ai instanceof AiController) || ai.stationReference === null) continue
      sum += ai.stationError
      n++
    }
    return n > 0 ? sum / n : -1
  }

  for (let s = 0; s < SECONDS * 240; s++) {
    stepBattle(b, DT)

    // 【關掉指揮層 = 每步把命令清乾淨】比改生產程式碼誠實：兩邊跑的是
    // 完全同一份程式，差別只有「命令有沒有真的傳到戰機端」
    if (!commanders) {
      b.blueCommand.orders.fill(null)
      b.redCommand.orders.fill(null)
      for (const c of b.world.combatants) {
        const ai = c.controller
        if (ai instanceof AiController) ai.order = null
      }
    }

    for (let f = 0; f < b.flights.flights.length; f++) {
      const flight = b.flights.flights[f]!
      const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
      const cur = state.orders[f] ?? null
      const now = cur !== null
      if (now && !had[f]) {
        o.issued++
        o.byKind[cur!.kind]!.issued++
        hadKind[f] = cur!.kind
        issuedError[f] = meanWingmanError(f)
        // 【把「命令絕對」那個坑照亮】發令的那一格，這個分隊有幾架正握有
        // 射擊解。刻意不設門檻 —— 見 `pulledWhileShooting` 的註解
        for (let p = 0; p < flight.count; p++) {
          const ai = b.world.combatants[flight.members[p]!]!.controller
          if (ai instanceof AiController && ai.shotInstant > 0) o.pulledWhileShooting++
        }
      }
      if (!now && had[f] && flight.count > 0) {
        o.arrived++
        const k = o.byKind[hadKind[f]!]
        if (k !== undefined) k.arrived++
        // 【全滅的那一張不算】`meanWingmanError` 對空分隊回 −1，而且分隊被
        // 打光時「編隊收攏了」是沒有意義的 —— 那不是命令的功勞
        const at0 = issuedError[f]!
        const at1 = meanWingmanError(f)
        if (at0 > 0 && at1 >= 0) {
          const kk = o.byKind[hadKind[f]!]
          if (at1 < at0) { o.tightened++; if (kk !== undefined) kk.tightened++ }
          else { o.loosened++; if (kk !== undefined) kk.loosened++ }
          // 【連續量，判準讀這一組】計數是離散的：整場只有個位數張命令，
          // 「幾張變緊」量化成 0/1 之後 n = 4 的 2:2 與 n = 5 的 4:1 分不
          // 開。誤差的**大小**每一張都帶著資訊。這個專案已經為「連續量勝過
          // 門檻量」裁定過四次（危險核、extendPitchAngle、卸載係數、
          // 用傷害取代擊墜）
          if (kk !== undefined) { kk.errSum0 += at0; kk.errSum1 += at1; kk.errN++ }
        }
      }
      if (!now) issuedError[f] = -1
      had[f] = now
    }

    for (const c of b.world.combatants) {
      if (!c.alive) continue
      if (c.aircraft.state.position.y < DEFAULT_SAFETY.clearance) o.belowClearance++
      const ai = c.controller
      if (!(ai instanceof AiController)) continue
      o.aliveSamples++
      const stray = ai.stationReference !== null
        && ai.stationError > DEFAULT_WINGMAN.breakExit
      if (ai.order === null) {
        o.freeSamples++
        if (ai.safetyAction === 'ground') o.groundFree++
        if (ai.stationReference !== null) {
          o.wingmanFree++
          if (stray) o.strayFree++
        }
        continue
      }
      o.orderedSamples++
      const bk = o.byKind[ai.order.kind]
      if (bk !== undefined) bk.samples++
      if (ai.intent === 'defend') o.defendUnderOrder++
      if (ai.safetyAction === 'ground') {
        o.groundUnderOrder++
        if (bk !== undefined) bk.ground++
      }
      if (ai.stationReference !== null) {
        o.wingmanUnderOrder++
        if (stray) o.strayUnderOrder++
      }
    }
  }

  for (const c of b.world.combatants) {
    const lost = hp0[c.index]! - c.hp
    if (c.team === 'blue') o.blueDamage += lost
    else o.redDamage += lost
  }
  return o
}

describe('指令通道（20v20、300 秒）', () => {
  const o = observe()

  /**
   * 【場景要成立】指揮層若一次都沒發過命令，下面每一條都會空洞地通過。
   * 起始參數（見 `DEFAULT_COMMAND` 的註解）在 20v20 混戰下應該會發不少張。
   */
  it('指揮層真的發過命令', () => {
    expect(o.issued).toBeGreaterThan(0)
  })

  /**
   * 【命令要到得了】發出去卻永遠到不了的命令，等於把小隊永久移出戰場。
   * 這一條是通道存在的意義。
   *
   * 【為什麼是多數而不是 `> 0`】原本寫 `> 0`，負控制證明那太鬆：把僚機的
   * 「停止出擊」限制關掉之後（`AiController` 裡那一行），2026-08-07 實測
   * **7 張發出、只有 2 張到達** —— 僚機繼續纏鬥，小隊質心永遠走不到集合點。
   * 而 `> 0` 對那個壞掉的版本照樣是綠的。開著限制時是 5 張發出、5 張到達。
   *
   * 這一條同時是下面「編隊收攏」那一條的補位：後者只量得到**走完**的命令，
   * 有倖存者偏誤（壞掉的版本 2 張全部收攏，照樣綠）。兩條一起才守得住。
   */
  it('多數命令會因為到達而解除，不是只會累積', () => {
    expect(o.arrived).toBeGreaterThan(o.issued / 2)
  })

  /**
   * 【安全層不豁免】spec §5.2、§7.2。命令期間撞地接管必須是 0 —— 政策層
   * 把飛機送進硬限制的作用區就是設計失敗。判準與 task #136 的六場護欄
   * 同一條線。
   */
  it('命令期間不動用安全層的撞地接管', () => {
    expect(o.groundUnderOrder).toBe(0)
  })

  it('沒有飛機掉到安全層的 clearance 以下', () => {
    expect(o.belowClearance).toBe(0)
  })

  /**
   * 【僚機貼著長機一起走】spec §7.2。命令對僚機的意思是「停止出擊」，於是它
   * 掉進既有的「沒有目標 → 飛站位」那一格，編隊在撤離途中應該**收攏**。
   *
   * 【判準為什麼是「收攏」而不是「站位誤差為 0 條超標」】原本寫的是
   * `strayUnderOrder === 0`，實測否決 —— 沒有命令時的基線就是 8.31%，要求零
   * 不可能滿足（與 task #136 的 `minAlt > 500` 同一類錯誤）。而「有命令時比
   * 較高」也不成立為證據：命令正是發給已經打散了的小隊，那是選擇效應。
   *
   * 「解除當下比發令當下小」直接對應設計主張本身，而且兩端量的是**同一個
   * 分隊**，選擇效應自然被抵銷掉。
   *
   * 【2026-08-08 由計數改成連續量】原本取的是「幾張變緊 > 幾張變鬆」。
   * 整場只有個位數張離場命令，把每一張量化成 0/1 之後，n = 4 的 2:2 與
   * n = 5 的 4:1 在統計上分不開 —— 第三份加上配額後就撞上了這件事。改成
   * **平均站位誤差的變化**：同一批命令、同一個主張，但每一張的幅度都帶著
   * 資訊。門檻是 0，**沒有可調的數字**。
   *
   * 2026-08-07 實測（改判準之前）：五張命令，四張收攏。平均 697 → 559 m。
   * 機制確認在動：僚機 92.2% 的取樣 `target === null`、長機 95.8% 在 `rally`。
   *
   * 【這一條有倖存者偏誤，要與上面那條一起看】它只量得到**走完**的命令。
   * 負控制（關掉僚機的停止出擊）下 7 張只到 2 張，而那 2 張全部收攏 ——
   * 這一條照樣綠。守著那個壞法的是上面的「多數命令會因為到達而解除」。
   */
  /**
   * ── 【2026-08-27：停用，因為它在結構上量不到東西】───────────────────
   *
   * 這一條與下面「命令佔時比例」都是為**離場類**命令（`rally` / `flank`）
   * 設計的。實測 20v20 三百秒：
   *
   *   issued 12  →  focus 12 / rally 0 / flank 0
   *   leavingShare 0.00%   leavingErr "0 → 0 m"   n = 0
   *
   * `flank` 是被明確關掉的（`command.ts` 的 `FLANK_ENABLED = false`，那裡
   * 有完整的理由與重啟條件）。`rally` 則是一張都沒觸發：它的閘門是
   * `gap >= withdrawRange − arriveRadius × MIN_TRIP_RATIO` 才不發，而
   * `d9839e0`（energyExit +100 → −100）與 `d0d5d41`（recoveredExit 預設
   * 關閉）之後，撤退在這個場景已經不再發生。
   *
   * **所以樣本數是 0，不是門檻太嚴。** 把門檻降到 0 以下會讓它變成一條
   * 永遠通過的空斷言 —— 那正是這個檔案自己警告的「看起來像功能沒用，
   * 其實是功能沒裝」。停用並把證據留在原地，比假綠誠實。
   *
   * 【重啟條件】`rally` 在這個場景恢復觸發（`byKind.rally.issued > 0`），
   * 或 `FLANK_ENABLED` 打開。任一成立就把 `.skip` 拿掉、重跑、照實測重定值。
   *
   * 【它不在的期間誰在守】上面「多數命令會因為到達而解除」（`arrived`
   * 9/12）與「命令期間不動用安全層的撞地接管」仍然對 `focus` 生效。
   */
  it.skip('命令期間編隊收攏', () => {
    console.log(JSON.stringify({
      issued: o.issued, arrived: o.arrived,
      share: (o.orderedSamples / Math.max(o.aliveSamples, 1) * 100).toFixed(2) + '%',
      leavingShare: (leavingSamples(o) / Math.max(o.aliveSamples, 1) * 100).toFixed(2) + '%',
      tightened: o.tightened, loosened: o.loosened,
      byKind: o.byKind,
      groundFree: o.groundFree + '/' + o.freeSamples,
      strayUnderOrder: `${o.strayUnderOrder}/${o.wingmanUnderOrder}`,
      strayFree: `${o.strayFree}/${o.wingmanFree}`,
    }))
    // 【只算離場的那兩種】見 `LEAVING` 的註解
    let s0 = 0
    let s1 = 0
    let n = 0
    for (const k of LEAVING) {
      s0 += o.byKind[k]!.errSum0
      s1 += o.byKind[k]!.errSum1
      n += o.byKind[k]!.errN
    }
    console.log(JSON.stringify({
      leavingErr: `${(s0 / Math.max(n, 1)).toFixed(0)} → ${(s1 / Math.max(n, 1)).toFixed(0)} m`,
      n,
    }))
    // 【要有量到的張數】否則下面那條會空洞地通過
    expect(n).toBeGreaterThan(0)
    // 【門檻是 0，沒有可調的數字】斷言就是設計主張本身：命令期間編隊平均
    // 要收攏。2026-08-08 由「幾張變緊 > 幾張變鬆」改成這個形式 —— 改的是
    // 量什麼，不是寬鬆度。舊形式在配額之後給出 2:2（n = 4），而同一批命令
    // 的平均誤差仍然是收攏的：計數把每一張的幅度丟掉了
    expect(s1 / n).toBeLessThan(s0 / n)
  })

  it.skip('掃描指揮參數（量測用，不是判準）', () => {
    const base = { ...DEFAULT_COMMAND }
    const restore = () => Object.assign(DEFAULT_COMMAND, base)
    const report = (knob: string, v: number) => {
      const r = observe()
      console.log(JSON.stringify({
        knob, v,
        issued: r.issued, arrived: r.arrived,
        share: (r.orderedSamples / Math.max(r.aliveSamples, 1) * 100).toFixed(2) + '%',
        ground: r.groundUnderOrder,
        stray: `${r.strayUnderOrder}/${r.wingmanUnderOrder}`,
        strayFree: `${r.strayFree}/${r.wingmanFree}`,
      }))
    }
    for (const v of [0.4, 0.5, 0.6, 0.7, 0.75]) {
      restore(); DEFAULT_COMMAND.spentRatio = v; report('spentRatio', v)
    }
    for (const v of [1, 2, 3, 5, 8]) {
      restore(); DEFAULT_COMMAND.spentSeconds = v; report('spentSeconds', v)
    }
    for (const v of [1500, 3000, 5000, 8000]) {
      restore(); DEFAULT_COMMAND.withdrawRange = v; report('withdrawRange', v)
    }
    // 【withdrawClimb 已於 2026-08-09 刪除】撤退不再改變高度：舊版的
    // 「小隊質心 + 800」讓兩隊互相加價一路頂到升限，而撤退要補的是速度、
    // 爬升是消耗速度的動作。見 2026-08-09-withdraw-anchor-design.md §3.2。
    for (const v of [0, 1]) {
      restore(); DEFAULT_COMMAND.spentRank = v; report('spentRank', v)
    }
    for (const v of [1, 2, 5, 10]) {
      restore(); DEFAULT_COMMAND.planPeriod = v; report('planPeriod', v)
    }
    restore()
  }, 60 * 60 * 1000)
}, 10 * 60 * 1000)

describe('指揮層的效果（20v20 開／關對照、300 秒）', () => {
  const on = observe(true)
  const off = observe(false)

  /**
   * 【為什麼是開／關對照而不是「有指揮的一方打贏」】spec §2.1：兩隊都有
   * 指揮官（只有玩家那一隊自治），所以沒有「有指揮 vs 沒指揮」的兩方可比。
   */
  it('傷害交換不得崩掉', () => {
    console.log(JSON.stringify({
      on: `R${on.redDamage.toFixed(0)}:B${on.blueDamage.toFixed(0)}`,
      off: `R${off.redDamage.toFixed(0)}:B${off.blueDamage.toFixed(0)}`,
      share: (on.orderedSamples / Math.max(on.aliveSamples, 1) * 100).toFixed(2) + '%',
      leavingShare: (leavingSamples(on) / Math.max(on.aliveSamples, 1) * 100).toFixed(2) + '%',
      pulledWhileShooting: on.pulledWhileShooting,
      issuedOn: on.issued, issuedOff: off.issued,
    }))
    // 【判準的邏輯】兩隊對稱，所以總傷害是「這場仗打得多激烈」的量。指揮層
    // 讓小隊定期離場，總傷害本來就會降 —— 判準是**不得崩掉**，取關指揮的
    // 一半。實測餘裕若很小要報告給專案負責人重新定值。
    expect(on.redDamage + on.blueDamage)
      .toBeGreaterThan((off.redDamage + off.blueDamage) * 0.5)
  }, 10 * 60 * 1000)

  /**
   * 【關掉之後真的沒有命令流到戰機端】否則上面那條對照是拿同一件事跟自己比。
   * `issued` 數的是 `CommandState.orders`，關掉的那一路每步清空，所以它應該
   * 恆為 0。
   */
  it('關掉的那一路真的沒有命令', () => {
    expect(off.issued).toBe(0)
    expect(off.orderedSamples).toBe(0)
  }, 10 * 60 * 1000)

  /**
   * 【2026-08-27：停用】與上面「命令期間編隊收攏」同一個成因 ——
   * `leavingShare` 量的是**離場類**命令的佔時，而 `rally` 與 `flank` 都不再
   * 發生（focus 12 / rally 0 / flank 0），所以它恆為 0。上界（< 0.25）在
   * share = 0 時是空洞地成立，下界（> 0.05）則量不到東西。詳見上面那一條的
   * 註解，包含證據與重啟條件。
   */
  it.skip('命令佔時比例落在掃描定出的區間', () => {
    // 【量的是「離場佔時」而不是「受命佔時」】見 `LEAVING` 的註解。
    // 專案負責人 2026-08-07 裁定：上界的語意本來就是離場，`focus` 不算。
    const share = leavingSamples(on) / Math.max(on.aliveSamples, 1)
    expect(share).toBeGreaterThan(0.05)
    expect(share).toBeLessThan(0.25)
  }, 10 * 60 * 1000)
})
