import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { reportText } from '../../src/hud/battleReport'
import { createGroundTarget } from '../../src/world/groundTargets'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { createShipGuns } from '../../src/world/shipGuns'
import { BOMB_BLAST_DAMAGE } from '../../src/weapons/bomb'
import { loadoutOf } from '../../src/weapons/stores'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const TORPEDO = loadoutOf('g4m')!

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

/**
 * 一場戰鬥，海面在 y = 0。
 *
 * 【為什麼把整張圖改成海】船要浮著，而飛機在三千公尺上 —— 這一支測的是
 * 戰果歸屬，地形長什麼樣與它無關。
 */
function battle(): Battle {
  const b = createBattle(new Idle())
  b.world.groundAt = () => 0
  b.world.waterAt = () => 0
  return b
}

/**
 * 把彈藥推到底，**用 `world.step` 而不是 `stepBattle`**。
 *
 * 【為什麼可以這樣】兩者推進的是同一個世界，差別只在後者多跑編制、指揮與
 * 通報。魚雷飛幾秒鐘是上千步，每一步都跑一次完整的戰鬥層只是在燒時間 ——
 * 而事件會留在緩衝裡等人排空，最後補一次 `stepBattle` 就全部收得到。
 */
function settle(b: Battle): void {
  const w = b.world
  for (let i = 0; i < 240 * 60 && (w.bombs.live > 0 || w.torpedoes.live > 0); i++) {
    w.step(DT)
  }
  // 【要跑滿一秒】通報進的是出場佇列，每 `REPORT_RELEASE_INTERVAL` 才放
  // 一條 —— 只跑一步的話同一瞬間的兩筆只看得到第一筆
  for (let i = 0; i < 240; i++) stepBattle(b, DT)
}

describe('戰果通報的接線', () => {
  it('玩家擊墜敵機 —— 通報受害者的機種', () => {
    const b = battle()
    const victim = b.red[0]!
    b.world.applyDamage(victim, 99999, 'fuselage', b.player)
    stepBattle(b, DT)
    expect(b.report.count).toBe(1)
    expect(reportText(b.report.lines[0]!)).toBe(`擊墜　${victim.aircraft.spec.name}`)
  })

  /**
   * 這一條與「只報玩家自己的」是同一件事。少了它，通報會變成一張全場的
   * 戰報流 —— 而那是刻意不做的（見 `battleReport.ts` 的檔頭）。
   */
  it('僚機擊墜不通報', () => {
    const b = battle()
    b.world.applyDamage(b.red[0]!, 99999, 'fuselage', b.blue[1]!)
    stepBattle(b, DT)
    expect(b.report.count).toBe(0)
  })

  it('自摔不通報 —— 沒有人的功勞', () => {
    const b = battle()
    b.world.destroy(b.red[0]!)
    stepBattle(b, DT)
    expect(b.report.count).toBe(0)
  })

  it('玩家的炸彈炸掉地面目標 —— 通報那一台的名字', () => {
    const b = battle()
    const t = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    b.world.groundTargets.push(t)
    b.world.dropBomb(0, 60, 0, 0, -120, 0, BOMB_BLAST_DAMAGE, 0, b.player.index)
    settle(b)
    expect(t.alive).toBe(false)
    expect(reportText(b.report.lines[0]!)).toBe('擊毀　ZIS-150 卡車')
  })

  /**
   * 【為什麼兇手與爆風旗標一定要分成兩格】渲染層靠第六格決定放不放第二團
   * 火。用「兇手 = −1 就是炸彈」代替的話，玩家投的彈兩者同時成立，症狀是
   * 同一個地方爆兩次、鏡頭震兩次，而且不會報錯。
   */
  it('炸彈擊毀的事件帶爆風旗標，子彈擊毀的不帶', () => {
    const b = battle()
    const t = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    b.world.groundTargets.push(t)
    b.world.dropBomb(0, 60, 0, 0, -120, 0, BOMB_BLAST_DAMAGE, 0, b.player.index)
    settle(b)
    const e = b.world.groundKillEvents
    expect(e.count).toBe(1)
    expect(e.data[4]).toBe(b.player.index)
    expect(e.data[5]).toBe(1)
  })

  /**
   * 與上面那一條是一對：只有一條的話，「炸彈完全不記投放者」與「記對了」
   * 都會綠。
   */
  it('別人的炸彈炸掉地面目標不通報', () => {
    const b = battle()
    const t = createGroundTarget(0, 'truck', 'red', 0, 0, 0)
    b.world.groundTargets.push(t)
    b.world.dropBomb(0, 60, 0, 0, -120, 0, BOMB_BLAST_DAMAGE, 0, b.blue[1]!.index)
    settle(b)
    expect(t.alive).toBe(false)
    expect(b.report.count).toBe(0)
  })

  it('玩家的魚雷命中 —— 通報艦名', () => {
    const b = battle()
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    ship.guns = createShipGuns(ship.cls)
    b.world.ships.push(ship)
    // 【500 m 不是隨便取的】從 40 m 投下要落 2.9 秒，那段空中行程就走掉
    // 260 m —— 投得太近的話雷會從船的另一側入水。與 `torpedo-vs-ship` 同一組
    b.world.dropTorpedo(0, 40, -500, 0, 0, 90, TORPEDO.damage, 0, 1, 0, b.player.index)
    settle(b)
    expect(ship.hp).toBeLessThan(SHIP_CLASSES.fletcher.hp)
    expect(reportText(b.report.lines[0]!)).toBe('雷擊命中　USS Fletcher DD-445')
  })

  /**
   * 命中與擊沉是兩拍，次序不能顛倒 —— 玩家看到的是先中再沉。
   */
  it('同一枚把船打沉 —— 命中在下、擊沉在上', () => {
    const b = battle()
    const ship = createShip(0, SHIP_CLASSES.fletcher, 'red', 0, 0, 0, 0)
    ship.guns = createShipGuns(ship.cls)
    ship.hp = 10
    b.world.ships.push(ship)
    // 【500 m 不是隨便取的】從 40 m 投下要落 2.9 秒，那段空中行程就走掉
    // 260 m —— 投得太近的話雷會從船的另一側入水。與 `torpedo-vs-ship` 同一組
    b.world.dropTorpedo(0, 40, -500, 0, 0, 90, TORPEDO.damage, 0, 1, 0, b.player.index)
    settle(b)
    expect(ship.alive).toBe(false)
    expect(b.report.count).toBe(2)
    expect(reportText(b.report.lines[0]!)).toBe('擊沉　USS Fletcher DD-445')
    expect(reportText(b.report.lines[1]!)).toBe('雷擊命中　USS Fletcher DD-445')
  })
})
