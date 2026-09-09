import { describe, expect, it } from 'vitest'
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'
import type { Controller } from '../../src/control/Controller'

/**
 * 攻擊路徑的逐位元基準。
 *
 * 【為什麼不用 `replayDigest`】它不含船、炸彈池、魚雷池與攻擊狀態機 ——
 * 30 秒時飛機姿態相同不代表投放時刻相同。這一份把那幾樣全部摺進去：
 * 每一架的位置、血量、彈艙、攻擊相位與鎖定；每一艘船的位置與血量；
 * 兩個池的投放計數。
 *
 * 【基準是凍結的】兩個雜湊是改 AI 的目標型別之前跑出來的。改完之後
 * 必須相同 —— 用兩次新程式互比是恆真的，抓不到任何東西。
 */
const IDLE: Controller = { update() {} }
const DT = 1 / 240
const SEED = 1234

function wire(b: Battle): void {
  for (const c of b.world.combatants) {
    const ctl = c.controller
    if (!(ctl instanceof AiController)) continue
    ctl.ships = b.world.ships
    ctl.groundTargets = b.world.groundTargets
    ctl.bombBay = c.bombBay
    ctl.bombDrag = b.world.bombDrag
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
  }
}

/** `String(x)` 是雙精度的最短往返表示 —— 逐位元，不是四捨五入。−0 另外標 */
function num(x: number): string { return x === 0 && 1 / x < 0 ? '-0' : String(x) }

function strikeDigest(b: Battle): string {
  const lines: string[] = []
  for (const c of b.world.combatants) {
    const s = c.aircraft.state
    const q = s.orientation
    const w = s.angularVelocity
    const u = c.aircraft.controls
    lines.push(`a ${c.index} ${c.alive ? 1 : 0} ${num(s.position.x)} ${num(s.position.y)} ${num(s.position.z)}`
      + ` ${num(s.velocity.x)} ${num(s.velocity.y)} ${num(s.velocity.z)}`
      + ` ${num(q.x)} ${num(q.y)} ${num(q.z)} ${num(q.w)} ${num(c.hp)}`
      + ` ${num(w.x)} ${num(w.y)} ${num(w.z)}`
      + ` ${num(u.aileron)} ${num(u.elevator)} ${num(u.rudder)} ${num(u.throttle)}`)
    const ctl = c.controller
    if (ctl instanceof AiController) {
      // `strike.target` 是直飛段鎖定的目標索引，鎖定前是 −1
      const k = ctl.strike
      lines.push(`k ${k.phase} ${num(k.seconds)} ${k.target} ${k.release ? 1 : 0}`
        + ` ${num(k.heading.x)} ${num(k.heading.z)} ${num(k.plan.lockRange)} ${num(k.plan.egressRange)}`
        + ` ${num(k.plan.aim.x)} ${num(k.plan.aim.z)} ${ctl.shipAim.ship} ${ctl.shipAim.gun}`)
    }
    const bay = c.bombBay
    lines.push(`b ${bay.load} ${bay.queue} ${num(bay.timer)} ${bay.reloading ? 1 : 0}`)
  }
  for (const sh of b.world.ships) {
    const q = sh.orientation
    let guns = ''
    for (let g = 0; g < sh.guns.length; g++) {
      guns += ` ${sh.guns[g]!.alive ? 1 : 0}:${num(sh.guns[g]!.hp)}:${num(sh.gunCooldowns[g]!)}`
    }
    lines.push(`s ${sh.index} ${sh.alive ? 1 : 0} ${num(sh.position.x)} ${num(sh.position.z)}`
      + ` ${num(sh.speed)} ${num(q.y)} ${num(q.w)} ${num(sh.hp)}${guns}`)
  }
  const bombs = b.world.bombs
  for (let i = 0; i < bombs.capacity; i++) {
    if (bombs.active[i] === 0) continue
    lines.push(`p ${i} ${num(bombs.x[i]!)} ${num(bombs.y[i]!)} ${num(bombs.z[i]!)}`
      + ` ${num(bombs.vx[i]!)} ${num(bombs.vy[i]!)} ${num(bombs.vz[i]!)}`
      + ` ${num(bombs.age[i]!)} ${num(bombs.damage[i]!)} ${bombs.team[i]}`)
  }
  const torps = b.world.torpedoes
  for (let i = 0; i < torps.capacity; i++) {
    if (torps.active[i] === 0) continue
    lines.push(`t ${i} ${num(torps.x[i]!)} ${num(torps.y[i]!)} ${num(torps.z[i]!)}`
      + ` ${num(torps.vx[i]!)} ${num(torps.vz[i]!)} ${num(torps.run[i]!)} ${torps.phase[i]}`)
  }
  lines.push(`bombs ${b.world.bombs.dropped} torps ${b.world.torpedoes.dropped}`)
  return lines.join('\n')
}

function hash(s: string): string {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619) >>> 0
  }
  return h.toString(16)
}

function run(card: ReadyMissionCard, seconds: number): Battle {
  const b = createBattle(IDLE, missionConfigFrom(card), SEED)
  for (let i = 0; i < seconds * 240; i++) {
    wire(b)
    stepBattle(b, DT)
  }
  return b
}

const japan = MISSIONS.japan.find((c) => c.id === 'japan-m4') as ReadyMissionCard
const allies = MISSIONS.allies.find((c) => c.id === 'allies-m4') as ReadyMissionCard

describe('攻擊路徑的逐位元基準', () => {
  it('japan-m4 跑 90 秒', () => {
    expect(hash(strikeDigest(run(japan, 90)))).toBe('6177d990')
  }, 180_000)

  it('allies-m4 跑 90 秒', () => {
    // 盟 M4 的值對應「零戰整隊重生 + 陸攻掛在第五批」的編成
    expect(hash(strikeDigest(run(allies, 90)))).toBe('9bee4056')
  }, 180_000)
})
