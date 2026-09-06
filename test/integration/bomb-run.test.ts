import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { G4M } from '../../src/specs/g4m'
import { resetBombBay } from '../../src/weapons/bomb'
import type { Loadout } from '../../src/weapons/stores'
import type { Combatant } from '../../src/world/World'

/** 與 `japan-m4` 的 `blueLoadout` 同一組：500 kg × 2。 */
const BOMB_LOAD: Loadout = { kind: 'bomb', count: 2, damage: 11_700, reloadSeconds: 20 }

/**
 * # 攻擊航路的乾淨試驗場
 *
 * **一台 G4M、一艘不開火的船。**
 *
 * 【為什麼不在 `japan-m4` 裡量】專案負責人 2026-09-06 裁定：那一關有六架
 * F6F、八艘船的防空火網、九架互相影響的僚機 —— 量到的東西分不出是航路
 * 好還是運氣好。與 2026-09-04「測試專用的無誤差砲」同一條規矩。
 *
 * 【船不開火】砲位不建（`guns = []`），所以整場沒有任何防空。轟炸機的
 * 存活率因此只由航路決定，而不是由火網的隨機性決定。
 */

const DT = 1 / 240

/**
 * 一艘沒有砲的船。**`guns = []` 就是沒有防空。**
 *
 * 【為什麼用威奇塔不用弗萊徹】G4M 一趟兩枚共 23,400 傷害，而弗萊徹只有
 * 20,000 —— **第一趟就沉了**，循環根本跑不到第二趟。威奇塔 40,000 撐得住
 * 一趟，才量得到脫離與再進場。
 */
function bareShip(w: World, speed: number, cls = SHIP_CLASSES.wichita): Ship {
  const s = createShip(w.ships.length, cls, 'red', 0, -4000, 0, speed)
  s.guns = []
  s.gunCooldowns = new Float32Array(0)
  w.ships.push(s)
  return s
}

interface Rig {
  w: World
  ship: Ship
  c: Combatant
  ai: AiController
}

/** 一台 G4M 從 5 km 外、1,000 m 高度、朝船飛過去。 */
function rig(shipSpeed: number): Rig {
  const w = new World()
  // 【關掉墜地】這一支要量的是航路，不是撞海。開著的話低空的那幾趟會混進
  // 「被地形殺掉」的樣本
  w.crashPolicy = () => false
  const ship = bareShip(w, shipSpeed)
  const ai = new AiController()
  const c = w.add(new Aircraft(G4M), ai, 'blue', new Vector3(0, 1000, 1000), 1000, 110)
  // 【`w.add` 只存重生點，不會把飛機放過去】少了這兩行它會留在
  // `new Aircraft()` 的預設高度（4,000 m），而那是完全不同的彈道
  c.aircraft.state.position.set(0, 1000, 1000)
  c.aircraft.prevPosition.copy(c.aircraft.state.position)
  // 【明講掛炸彈】G4M 的**預設**掛載是九一式航空魚雷（`LOADOUT_BY_AIRCRAFT`），
  // 而這一支測的是轟炸航路。任務裡走的是同一條路 —— `japan-m4` 用
  // `MissionBattle.blueLoadout` 覆寫成炸彈。
  c.loadout = BOMB_LOAD
  resetBombBay(c.bombBay, c.loadout)
  ai.board = createTargetBoard([c])
  ai.selfIndex = 0
  ai.ships = w.ships
  ai.bombBay = c.bombBay
  ai.bombDrag = w.bombDrag
  return { w, ship, c, ai }
}

interface Result {
  passes: number
  bombs: number
  hp: number
  /** 每一趟的落彈與船的最短水平距離 */
  misses: number[]
}

function fly(r: Rig, seconds: number): Result {
  const hp0 = r.ship.hp
  let passes = 0
  let loaded = true
  const misses: number[] = []
  let seen = 0

  for (let i = 0; i < seconds * 240; i++) {
    // 落彈點：這一步新出現的彈著事件
    const before = r.w.bombEvents.count
    r.w.step(DT)
    for (let e = before; e < r.w.bombEvents.count; e++) {
      const o = e * 6
      const d = Math.hypot(
        r.w.bombEvents.data[o]! - r.ship.position.x,
        r.w.bombEvents.data[o + 2]! - r.ship.position.z,
      )
      misses.push(d)
    }
    // 【呼叫端要排空】與 `main.ts` 同一個約定
    if (r.w.bombEvents.count > seen) seen = r.w.bombEvents.count
    r.w.bombEvents.count = 0

    const L = r.c.bombBay.load > 0
    if (loaded && !L) passes++
    loaded = L
  }
  return { passes, bombs: r.w.bombs.dropped, hp: hp0 - r.ship.hp, misses }
}

describe('攻擊航路（一台 G4M、一艘不開火的船）', () => {
  /**
   * 【靜止的船是最寬鬆的條件】連這個都投不中的話，後面的一切都不必談。
   */
  it('靜止的船：五分鐘之內投得中，而且不只一趟', () => {
    const r = rig(0)
    const out = fly(r, 300)
    console.log(`靜止：趟數 ${out.passes}、投彈 ${out.bombs}、扣血 ${out.hp}`)
    console.log(`  落彈離船 ${out.misses.map((m) => m.toFixed(0)).join(' ')} m`)
    expect(out.bombs).toBeGreaterThan(0)
    expect(out.passes).toBeGreaterThan(1)
    expect(out.hp).toBeGreaterThan(0)
  })

  /**
   * 【會動的船才是真的驗收】外推那一段的正面反證：8 m/s、落彈約 14 秒，
   * 不外推的話每一顆都落在船尾之後 112 m。
   */
  it('8 m/s 的船：一樣投得中', () => {
    const r = rig(8)
    const out = fly(r, 300)
    console.log(`8 m/s：趟數 ${out.passes}、投彈 ${out.bombs}、扣血 ${out.hp}`)
    console.log(`  落彈離船 ${out.misses.map((m) => m.toFixed(0)).join(' ')} m`)
    expect(out.bombs).toBeGreaterThan(0)
    expect(out.passes).toBeGreaterThan(1)
    expect(out.hp).toBeGreaterThan(0)
  })

  /**
   * 【循環必須真的轉起來】三個狀態都要走到。少了脫離就是第一版那個
   * 「投完繼續往船飛、鑽進火網」的行為（spec §5.1）。
   */
  it('三個狀態都走得到', () => {
    const r = rig(8)
    const seen = new Set<string>()
    for (let i = 0; i < 300 * 240; i++) {
      r.w.step(DT)
      if (i % 60 === 0) seen.add(r.ai.strike.phase)
    }
    expect(seen).toContain('approach')
    expect(seen).toContain('run')
    expect(seen).toContain('egress')
  })
})
