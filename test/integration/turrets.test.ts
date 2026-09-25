import { describe, it, expect, beforeAll } from 'vitest'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../../src/battle/setup'
import { PROJECTILE_CAPACITY } from '../../src/world/Projectiles'
import { HEAD_ON } from '../../src/battle/entry'
import { lineAbreast } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

/**
 * # 砲塔滿載時的彈丸池容量
 *
 * P-51D 20 架對 B-17G 20 架（每架 B-17 八座砲塔）對頭進場，跑完之後看彈丸池
 * 的高水位。
 */
const DT = 1 / 240
const SEED = 20260821
/** 跑這麼久，s。雙方進入彼此射程之後砲塔才開火，高水位要在交戰中量 */
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
 * 得到的是「藍隊 B-17G vs 紅隊 Bf 109」，場景裡根本沒有 P-51D。
 */
const config = (): typeof DEFAULT_BATTLE => ({
  ...DEFAULT_BATTLE,
  units: lineAbreast(HEAD_ON, P51D, 20, B17G, 20),
})

function run(): Battle {
  const b = createBattle(new Idle(), config(), SEED)
  for (let k = 0; k < SECONDS / DT; k++) stepBattle(b, DT)
  return b
}

describe('砲塔的彈丸池（P-51D 20 對 B-17G 20、150 秒）', () => {
  let battle: Battle

  // 【放 beforeAll 而不是 describe 本體】reporter 只算 it 與 hook 的時間
  beforeAll(() => { battle = run() }, 10 * 60 * 1000)

  /**
   * 【為什麼要看池子】池滿時是**覆寫最舊的那一發**，不是拒絕發射 —— 溢位
   * 不會有任何錯誤，只會讓遠處的曳光彈憑空消失。
   *
   * 【為什麼讀 peakLive 而不是 live】在 `stepBattle` 回來之後讀 `live` 會
   * 低估：一步之內是生成 → 推進／過期 → 命中／回收，讀到的是回收後的殘量。
   */
  it('彈丸池的高水位沒有逼近容量', () => {
    const peak = battle.world.projectiles.peakLive
    expect(peak, `高水位 ${peak} / ${PROJECTILE_CAPACITY}`)
      .toBeLessThan(PROJECTILE_CAPACITY * 0.9)
  })
})
