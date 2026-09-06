import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { createCommand } from '../../src/control/Controller'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { G4M } from '../../src/specs/g4m'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import { bombBayOf } from '../../src/weapons/bomb'
import type { Controller } from '../../src/control/Controller'

/** 什麼都不做的控制器。這幾條要驗的是彈艙與投彈，不是 AI。 */
const IDLE: Controller = { update() {} }

function add(w: World, spec = G4M): ReturnType<World['add']> {
  return w.add(new Aircraft(spec), IDLE, 'blue', new Vector3(0, 1000, 0))
}

describe('Command.bombing', () => {
  /**
   * 【預設必須是 false】它與 `firing` 是兩套武器，而一個新建的指令代表
   * 「什麼都不做」。預設 true 的話，任何忘記寫這一格的控制器都會讓那一架
   * 一出生就把整艙投光。
   */
  it('新建的指令不投彈', () => {
    expect(createCommand().bombing).toBe(false)
  })

  it('與 firing 是兩格', () => {
    const c = createCommand()
    c.firing = true
    expect(c.bombing).toBe(false)
  })
})

describe('Combatant.bombBay', () => {
  it('容量取自機種，一出場就滿艙', () => {
    const w = new World()
    const g4m = add(w, G4M)
    expect(g4m.bombBay.capacity).toBe(bombBayOf('g4m'))
    expect(g4m.bombBay.capacity).toBe(2)
    expect(g4m.bombBay.load).toBe(2)
  })

  /**
   * 【戰鬥機是零容量，不是「沒有這一格」】`stepBombBay` 在
   * `load === 0 && queue === 0` 時進回補、而回補又補回 0，所以空艙的機種
   * 結構上投不出東西 —— 不必在投彈那一段另外擋一次。
   */
  it('沒有彈艙的機種容量是 0', () => {
    const w = new World()
    expect(add(w, P51D).bombBay.capacity).toBe(0)
  })

  /**
   * 【換裝機種容量要跟著變】與 `cooldowns`／`muzzleFlash`／砲塔同一段。
   * 漏了的話：G4M 換成 P-51 之後那一架仍然投得出兩枚 500 kg，而畫面上
   * 沒有任何東西不對。
   */
  it('setSpec 之後容量跟著換，而且滿艙', () => {
    const w = new World()
    const c = add(w, P51D)
    expect(c.bombBay.capacity).toBe(0)

    w.setSpec(c, B17G)
    expect(c.bombBay.capacity).toBe(bombBayOf('b17g'))
    expect(c.bombBay.capacity).toBe(10)
    expect(c.bombBay.load).toBe(10)

    // 反向也要成立：換回沒有彈艙的機種，艙要歸零
    w.setSpec(c, P51D)
    expect(c.bombBay.capacity).toBe(0)
    expect(c.bombBay.load).toBe(0)
  })

  /**
   * 【換裝要取消回補計時】沿用舊計時的話，換完之後那一架會在滿艙的狀態下
   * 「正在回補」，扳機被吃掉最多 20 秒。
   */
  it('setSpec 取消回補與待投佇列', () => {
    const w = new World()
    const c = add(w, G4M)
    c.bombBay.load = 0
    c.bombBay.queue = 1
    c.bombBay.timer = 12
    c.bombBay.reloading = true

    w.setSpec(c, G4M)
    expect(c.bombBay.reloading).toBe(false)
    expect(c.bombBay.queue).toBe(0)
    expect(c.bombBay.timer).toBe(0)
    expect(c.bombBay.load).toBe(2)
  })
})
