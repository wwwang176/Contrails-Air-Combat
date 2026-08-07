import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { AiController } from '../../src/ai/AiController'
import { DEFAULT_COMMAND } from '../../src/ai/command'
import { DEFAULT_WINGMAN } from '../../src/ai/wingman'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'

const DT = 1 / 240
const SECONDS = 120

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
}

function observe(): Observed {
  const b: Battle = createBattle(new Idle())
  const o: Observed = {
    issued: 0, arrived: 0, defendUnderOrder: 0,
    groundUnderOrder: 0, strayUnderOrder: 0, belowClearance: 0,
    orderedSamples: 0, aliveSamples: 0,
    strayFree: 0, wingmanFree: 0, wingmanUnderOrder: 0,
    tightened: 0, loosened: 0,
  }
  // 上一格每個分隊有沒有命令，用來數「新發出」與「解除」
  const had = new Array<boolean>(b.flights.flights.length).fill(false)
  /** 發令當下該分隊僚機的平均站位誤差，解除時拿來比。−1 = 那一張沒量到 */
  const issuedError = new Array<number>(b.flights.flights.length).fill(-1)

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

    for (let f = 0; f < b.flights.flights.length; f++) {
      const flight = b.flights.flights[f]!
      const state = flight.team === 'blue' ? b.blueCommand : b.redCommand
      const now = state.orders[f] != null
      if (now && !had[f]) {
        o.issued++
        issuedError[f] = meanWingmanError(f)
      }
      if (!now && had[f] && flight.count > 0) {
        o.arrived++
        // 【全滅的那一張不算】`meanWingmanError` 對空分隊回 −1，而且分隊被
        // 打光時「編隊收攏了」是沒有意義的 —— 那不是命令的功勞
        const at0 = issuedError[f]!
        const at1 = meanWingmanError(f)
        if (at0 > 0 && at1 >= 0) {
          if (at1 < at0) o.tightened++
          else o.loosened++
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
        if (ai.stationReference !== null) {
          o.wingmanFree++
          if (stray) o.strayFree++
        }
        continue
      }
      o.orderedSamples++
      if (ai.intent === 'defend') o.defendUnderOrder++
      if (ai.safetyAction === 'ground') o.groundUnderOrder++
      if (ai.stationReference !== null) {
        o.wingmanUnderOrder++
        if (stray) o.strayUnderOrder++
      }
    }
  }
  return o
}

describe('指令通道（20v20、120 秒）', () => {
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
   * 分隊**，選擇效應自然被抵銷掉。取多數而不是全部：混戰是混沌的，個別一張
   * 命令在途中被新的攻擊者打斷是正常的。
   *
   * 2026-08-07 實測：五張命令，四張收攏。平均 697 → 559 m。
   * 機制確認在動：僚機 92.2% 的取樣 `target === null`、長機 95.8% 在 `rally`。
   *
   * 【這一條有倖存者偏誤，要與上面那條一起看】它只量得到**走完**的命令。
   * 負控制（關掉僚機的停止出擊）下 7 張只到 2 張，而那 2 張全部收攏 ——
   * 這一條照樣綠。守著那個壞法的是上面的「多數命令會因為到達而解除」。
   */
  it('命令期間編隊收攏', () => {
    console.log(JSON.stringify({
      issued: o.issued, arrived: o.arrived,
      share: (o.orderedSamples / Math.max(o.aliveSamples, 1) * 100).toFixed(2) + '%',
      tightened: o.tightened, loosened: o.loosened,
      strayUnderOrder: `${o.strayUnderOrder}/${o.wingmanUnderOrder}`,
      strayFree: `${o.strayFree}/${o.wingmanFree}`,
    }))
    // 【要有量到的張數】否則下面那條會空洞地通過
    expect(o.tightened + o.loosened).toBeGreaterThan(0)
    expect(o.tightened).toBeGreaterThan(o.loosened)
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
    for (const v of [400, 800, 1500, 2500]) {
      restore(); DEFAULT_COMMAND.withdrawClimb = v; report('withdrawClimb', v)
    }
    for (const v of [1, 2, 5, 10]) {
      restore(); DEFAULT_COMMAND.planPeriod = v; report('planPeriod', v)
    }
    restore()
  }, 60 * 60 * 1000)
}, 10 * 60 * 1000)
