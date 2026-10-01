import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { createBattle, settleAtSpawn } from '../../src/battle/setup'

/**
 * 玩家重生要回到**開局的朝向**，不是 `Aircraft.reset` 的預設朝向（−Z）。
 * 藍隊不朝 −Z 出生的關卡（德 M3 從東邊朝西）壞掉時不報錯：玩家開場就被
 * 轉去朝北飛。
 */
describe('玩家重生的朝向', () => {
  const card = MISSIONS.germany.find((m) => m.id === 'germany-m3') as ReadyMissionCard

  it('reset 之後 settleAtSpawn 放回開局的位置、姿態與速度', () => {
    const b = createBattle({ update() {} }, missionConfigFrom(card), 1)
    const p = b.player
    const q = b.spawnOrientations[p.index]!.clone()
    p.aircraft.respawn(new Vector3(), b.cfg.altitude, p.spawnTas)
    settleAtSpawn(b, p)
    const s = p.aircraft.state
    expect(s.orientation.angleTo(q)).toBeLessThan(1e-9)
    expect(s.position.distanceTo(p.spawnPosition)).toBeLessThan(1e-9)
    const fwd = new Vector3(0, 0, -1).applyQuaternion(q)
    expect(s.velocity.clone().normalize().dot(fwd)).toBeCloseTo(1, 9)
    expect(s.velocity.length()).toBeCloseTo(p.spawnTas, 9)
  })

  it('main.ts 的 respawnPlayer 走 settleAtSpawn，瞄準點排在它之後放回機首', () => {
    const src = new TextDecoder().decode(readFileSync('src/main.ts')).replace(/\r\n/g, '\n').split('\n')
    const at = src.findIndex((l) => l.startsWith('function respawnPlayer('))
    expect(at).toBeGreaterThanOrEqual(0)
    let end = at + 1
    while (end < src.length && src[end] !== '}') end++
    const fn = src.slice(at, end + 1).join('\n')
    const settleAt = fn.indexOf('settleAtSpawn(battle, p)')
    const aimAt = fn.indexOf('input.aimWorld.set(0, 0, -1).applyQuaternion(p.aircraft.state.orientation)')
    expect(settleAt).toBeGreaterThan(0)
    expect(aimAt).toBeGreaterThan(settleAt)
  })
})
