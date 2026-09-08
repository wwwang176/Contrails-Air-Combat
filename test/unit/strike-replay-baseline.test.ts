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
    ctl.bombBay = c.bombBay
    ctl.bombDrag = b.world.bombDrag
    ctl.strikeProfile = c.loadout?.kind === 'torpedo' ? TORPEDO_PROFILE : BOMB_PROFILE
  }
}

function num(x: number): string { return x.toPrecision(12) }

function strikeDigest(b: Battle): string {
  const lines: string[] = []
  for (const c of b.world.combatants) {
    const s = c.aircraft.state
    lines.push(`a ${c.index} ${c.alive ? 1 : 0} ${num(s.position.x)} ${num(s.position.y)} ${num(s.position.z)} ${num(c.hp)}`)
    const ctl = c.controller
    if (ctl instanceof AiController) {
      lines.push(`k ${ctl.strike.phase} ${ctl.strike.seconds.toPrecision(6)} ${ctl.strike.ship}`)
    }
    lines.push(`b ${c.bombBay.load} ${c.bombBay.queue}`)
  }
  for (const sh of b.world.ships) {
    lines.push(`s ${sh.index} ${sh.alive ? 1 : 0} ${num(sh.position.x)} ${num(sh.position.z)} ${num(sh.hp)}`)
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
    expect(hash(strikeDigest(run(japan, 90)))).toBe('1284581')
  }, 180_000)

  it('allies-m4 跑 90 秒', () => {
    expect(hash(strikeDigest(run(allies, 90)))).toBe('17160514')
  }, 180_000)
})
