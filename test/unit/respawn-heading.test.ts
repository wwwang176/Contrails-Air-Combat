import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { World } from '../../src/world/World'
import { P51D } from '../../src/specs/p51d'
import { settleAtSpawn } from '../../src/battle/flightSpawn'

/**
 * 玩家重生要回到**開局的朝向**，不是 `Aircraft.reset` 的預設朝向（−Z）。
 * 藍隊不朝 −Z 出生的關卡壞掉時不報錯：玩家重生就被轉去朝北飛。
 */
describe('玩家重生的朝向', () => {
  it('reset 之後 settleAtSpawn 放回開局的位置、姿態與速度', () => {
    // 開局朝西（機首 −X），不是 reset 的預設朝向
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    const w = new World()
    const p = w.add(new Aircraft(P51D, 2000, 150), { update() {} }, 'blue', new Vector3(7500, 2000, 300), 2000, 150)
    const b = { spawnOrientations: [q.clone()] }
    p.aircraft.respawn(new Vector3(), 2000, p.spawnTas)
    expect(p.aircraft.state.orientation.angleTo(q)).toBeGreaterThan(0.1)
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
