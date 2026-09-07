import { describe, it, expect, beforeAll } from 'vitest'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../../src/battle/setup'
import { PROJECTILE_CAPACITY } from '../../src/world/Projectiles'
import { HEAD_ON } from '../../src/battle/entry'
import { lineAbreast } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SEED = 20260821
/**
 * 兩場各跑這麼久，s。
 *
 * 【為什麼 150 夠】這四條要的是「砲塔造成了壓力」，而壓力在雙方進入彼此
 * 射程之後就開始累積；跑更久只是把同一個差距拉大。150 秒的實測差距是
 * **P-51 存活 4 架對 20 架** —— 主判準只要求「開著的比較少」，餘裕十六架。
 *
 * 【要縮之前先看主判準印出來的那一行】最緊的一項是「P-51 的戰果 > 0」，
 * 實測 3 架。時間再短會先撞到它。
 */
const SECONDS = 150

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

/**
 * 【要自己組 BattleConfig，不要用 battleConfigFrom】那個函數的 `redSpec`
 * 取的是**敵方陣營的第一台** —— 傳 `{ faction: 'allies', specId: 'b17g' }`
 * 得到的是「藍隊 B-17G vs 紅隊 Bf 109」，場景裡根本沒有 P-51D，而主判準
 * 寫的是「P-51 的存活數」。
 */
const config = (): typeof DEFAULT_BATTLE => ({
  ...DEFAULT_BATTLE,
  units: lineAbreast(HEAD_ON, P51D, 20, B17G, 20),
})

function run(turretsOn: boolean): Battle {
  const b = createBattle(new Idle(), config(), SEED)
  if (!turretsOn) {
    /**
     * 【為什麼不是 `{ ...B17G, turrets: [] }`】`setup.ts` 在建場時已經套過
     * `applyFeel(base, feelFor(base))`。用原始的 `B17G` 覆蓋回去會**同時**
     * 把手感倍率拿掉 —— 飛行性能跟著變，A/B 就不再只差砲塔，主判準失效。
     *
     * 【為什麼不加全域開關】那會多一條只有測試在走的路徑。`setSpec` 是
     * 正式碼本來就有的入口，走它等於順便驗了 Task 6 的接線。
     */
    for (const c of b.world.combatants) {
      if (c.aircraft.spec.turrets.length === 0) continue
      b.world.setSpec(c, { ...c.aircraft.spec, turrets: [] })
    }
  }
  for (let k = 0; k < SECONDS / DT; k++) stepBattle(b, DT)
  return b
}

const alive = (b: Battle, spec: typeof P51D): number =>
  b.world.combatants.filter((c) => c.alive && c.aircraft.spec.id === spec.id).length

const kills = (b: Battle, spec: typeof P51D): number =>
  b.world.combatants.filter((c) => c.aircraft.spec.id !== spec.id && !c.alive).length

describe('砲塔的整合驗收（P-51D 20 對 B-17G 20、300 秒）', () => {
  let on: Battle
  let off: Battle

  /**
   * 【四條斷言共用一次 beforeAll】每一條各跑一次 300 秒的話這一檔會變成
   * 全套裡最慢的一支，而四條看的是同一場的四個面向。
   */
  beforeAll(() => {
    on = run(true)
    off = run(false)
  }, 10 * 60 * 1000)

  /**
   * **主判準。** 砲塔存在的唯一理由就是「尾追一台轟炸機不再完全安全」，
   * 而那件事的外顯就是攻擊方的損失變多。
   *
   * 【為什麼是 A/B 而不是絕對值】「P-51 死了幾架」受 AI、手感、進場幾何
   * 影響，訂一個絕對門檻等於把那些全部凍結。同一顆種子、同一份設定、
   * 只差砲塔 —— 差值才是這一輪造成的。
   */
  it('砲塔開著時 P-51 的存活數比關著時少', () => {
    const a = alive(on, P51D)
    const b = alive(off, P51D)
    // 【印出四個量】判斷「這是迴歸還是雜訊」需要整組，而且它是
    // `SECONDS` 還夠不夠的依據
    console.log(
      `[砲塔] P-51 存活 開 ${a} / 關 ${b}`
      + `　B-17 的戰果 ${kills(on, B17G)}　P-51 的戰果 ${kills(on, P51D)}`
      + `　彈丸高水位 ${on.world.projectiles.peakLive} / ${PROJECTILE_CAPACITY}`,
    )
    expect(a, `砲塔開 ${a} 架、關 ${b} 架 —— 砲塔沒有造成任何壓力`).toBeLessThan(b)
  })

  it('B-17 打下了東西 —— 砲塔真的打得到', () => {
    expect(kills(on, B17G)).toBeGreaterThan(0)
  })

  it('P-51 也打下了東西 —— 砲塔不是無敵的', () => {
    expect(kills(on, P51D)).toBeGreaterThan(0)
  })

  /**
   * 【為什麼要看池子】池滿時是**覆寫最舊的那一發**，不是拒絕發射 —— 溢位
   * 不會有任何錯誤，只會讓遠處的曳光彈憑空消失。160 座砲塔把每步的生成量
   * 提高了一個量級，所以這一輪必須重新確認容量還夠。
   *
   * 【為什麼讀 peakLive 而不是 live】在 `stepBattle` 回來之後讀 `live` 會
   * 低估：一步之內是生成 → 推進／過期 → 命中／回收，讀到的是回收後的殘量。
   */
  it('彈丸池的高水位沒有逼近容量', () => {
    const peak = on.world.projectiles.peakLive
    expect(peak, `高水位 ${peak} / ${PROJECTILE_CAPACITY}`)
      .toBeLessThan(PROJECTILE_CAPACITY * 0.9)
  })
})
