import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { createCommand } from '../../src/control/Controller'
import { CommandDelay } from '../../src/ai/delay'
import { applySafety } from '../../src/ai/safety'
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

describe('bombing 穿過既有的指令管線', () => {
  /**
   * 【投彈直通 `CommandDelay`，不進緩衝區】反應延遲模型的是「看到→動作」
   * 的遲滯，而投彈的判準是 AI 對**自己此刻的彈道**算出來的。延遲 0.3 s
   * 之後飛機已經走了 27 m（90 m/s），大於最小的釋放半徑 12.08 m ——
   * 每一顆都會系統性地落在船尾之後。
   *
   * 【這一條守的是「整個功能靜靜地不動作」】漏掉這一格的話，`bombRunCommand`
   * 寫了也送不出去，AI 一顆都投不出來而且不報錯。
   */
  it('有反應延遲時投彈仍然當步送達', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.bombing = true
    // 0.3 s 的延遲、1/240 的步長 —— 緩衝區有 72 格
    d.push(input, 0.3, 1 / 240, out)
    expect(out.bombing).toBe(true)
  })

  it('放開之後也是當步歸零，不會殘留', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.bombing = true
    d.push(input, 0.3, 1 / 240, out)
    input.bombing = false
    d.push(input, 0.3, 1 / 240, out)
    expect(out.bombing).toBe(false)
  })

  it('零延遲那條捷徑也要傳遞', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    input.bombing = true
    d.push(input, 0, 1 / 240, out)
    expect(out.bombing).toBe(true)
  })
})

describe('applySafety 取消投彈', () => {
  /**
   * 【接管時航向已經被改掉】而釋放的判準是照原本那條航路算的 —— 不取消的話
   * 炸彈會在偏離解算航路之後才出去。兩個接管分支（撞地、失速）都要關。
   */
  it('撞地接管時關掉 bombing', () => {
    const a = new Aircraft(G4M)
    // 低空、下沉：撞地接管的條件
    a.state.position.set(0, 40, 0)
    a.state.velocity.set(0, -60, -80)
    const out = createCommand()
    out.bombing = true
    out.firing = true
    const action = applySafety(a, 0, out)
    expect(action).not.toBe('none')
    expect(out.firing).toBe(false)
    expect(out.bombing).toBe(false)
  })
})
