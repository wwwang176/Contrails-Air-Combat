import { describe, expect, it } from 'vitest'
import { createGroundTarget, resetGroundTarget, stepScriptedKill } from '../../src/world/groundTargets'
import { createGroundMotion, stepGroundMotion } from '../../src/world/groundMotion'
import { createImpacts } from '../../src/world/events'
import { countDestroyed } from '../../src/battle/setup'

/**
 * # 事件啟動的縱隊與照劇本擊毀
 *
 * 縱隊：出發時刻放在單位身上（節拍寫入），走到終點**保持車距**停住；藏著的縱隊
 * 出發前不在場上。劇本擊毀：時間到了走擊毀流程，但**不算**進摧毀數。
 */

const PATH = [{ x: 0, z: 0 }, { x: 0, z: -1000 }]
const CAR = { speed: 10, turnRadius: 25, turnRate: 10 / 25 }
const flat = (): number => 0

function column(n: number, gap: number, hold: boolean) {
  const out = []
  for (let i = 0; i < n; i++) {
    // 第一輛在最前面：集結位置往前 (n − 1 − i) × gap，停的時候離終點 i × gap
    const m = createGroundMotion(PATH, CAR, (n - 1 - i) * gap, Infinity, hold ? i * gap : undefined)
    const t = createGroundTarget(i, 'tank', 'red', 0, 0, 0, m)
    stepGroundMotion(t, 0, flat)
    out.push(t)
  }
  return out
}

describe('縱隊的出發', () => {
  it('出發時刻是 Infinity 時永遠停在集結位置', () => {
    const [t] = column(1, 40, true)
    const z0 = t!.position.z
    stepGroundMotion(t!, 500, flat)
    expect(t!.position.z).toBe(z0)
    expect(t!.speed).toBe(0)
  })

  it('寫入出發時刻之後才走，之前不動', () => {
    const [t] = column(1, 40, true)
    t!.departAt = 20
    stepGroundMotion(t!, 15, flat)
    expect(t!.position.z).toBeCloseTo(0, 6)
    stepGroundMotion(t!, 30, flat)
    expect(t!.position.z).toBeCloseTo(-100, 6)
    expect(t!.speed).toBe(10)
  })

  it('走到終點保持車距停住，仍然活著、不算抵達', () => {
    const ts = column(3, 40, true)
    for (const t of ts) t.departAt = 0
    for (const t of ts) stepGroundMotion(t, 1e4, flat)
    expect(ts.map((t) => Math.round(t.position.z))).toEqual([-1000, -960, -920])
    for (const t of ts) {
      expect(t.alive).toBe(true)
      expect(t.arrived).toBe(false)
      expect(t.speed).toBe(0)
    }
  })

  it('不停的仍然走完退場（既有的車隊行為）', () => {
    const [t] = column(1, 40, false)
    t!.departAt = 0
    stepGroundMotion(t!, 1e4, flat)
    expect(t!.arrived).toBe(true)
    expect(t!.alive).toBe(false)
  })

  it('重開把出發時刻抄回開局值', () => {
    const [t] = column(1, 40, true)
    t!.departAt = 5
    stepGroundMotion(t!, 50, flat)
    resetGroundTarget(t!)
    expect(t!.departAt).toBe(Infinity)
    stepGroundMotion(t!, 50, flat)
    expect(t!.position.z).toBeCloseTo(0, 6)
  })
})

describe('藏著的縱隊', () => {
  function hidden() {
    const m = createGroundMotion(PATH, CAR, 0, Infinity, 0)
    const t = createGroundTarget(0, 'tank', 'red', 0, 0, 0, m, true)
    stepGroundMotion(t, 0, flat)
    return t
  }

  it('出發前不在場上：不是活的、不算摧毀', () => {
    const t = hidden()
    expect(t.dormant).toBe(true)
    expect(t.alive).toBe(false)
    expect(countDestroyed([t], [], 'tank')).toBe(0)
  })

  it('出發那一刻出現', () => {
    const t = hidden()
    t.departAt = 10
    stepGroundMotion(t, 9, flat)
    expect(t.alive).toBe(false)
    stepGroundMotion(t, 11, flat)
    expect(t.dormant).toBe(false)
    expect(t.alive).toBe(true)
  })

  it('重開回到藏著', () => {
    const t = hidden()
    t.departAt = 0
    stepGroundMotion(t, 1, flat)
    resetGroundTarget(t)
    expect(t.dormant).toBe(true)
    expect(t.alive).toBe(false)
  })
})

describe('照劇本擊毀', () => {
  function scripted(killAt: number) {
    const t = createGroundTarget(0, 'tankDug', 'red', 0, 0, 0)
    t.killAt = killAt
    return t
  }

  it('時間到了才擊毀，推一筆擊毀事件、兇手 −1', () => {
    const t = scripted(40)
    const ev = createImpacts(8)
    stepScriptedKill(t, 39, ev)
    expect(t.alive).toBe(true)
    stepScriptedKill(t, 40, ev)
    expect(t.alive).toBe(false)
    expect(t.scripted).toBe(true)
    expect(ev.count).toBe(1)
    // 兇手（ny）是 −1；不是開場殘骸，nz = 0（要爆）
    expect(ev.data[4]).toBe(-1)
    expect(ev.data[5]).toBe(0)
  })

  it('開場殘骸（killAt 0）不爆：nz = 1', () => {
    const t = scripted(0)
    const ev = createImpacts(8)
    stepScriptedKill(t, 1 / 240, ev)
    expect(t.alive).toBe(false)
    expect(ev.data[5]).toBe(1)
  })

  it('不算進摧毀數', () => {
    const t = scripted(0)
    stepScriptedKill(t, 1, createImpacts(8))
    expect(countDestroyed([t], [], 'tankDug')).toBe(0)
  })

  it('沒有劇本的不會被打掉', () => {
    const t = createGroundTarget(0, 'tankDug', 'red', 0, 0, 0)
    stepScriptedKill(t, 1e6, createImpacts(8))
    expect(t.alive).toBe(true)
  })

  it('重開之後復活、旗標清掉', () => {
    const t = scripted(0)
    stepScriptedKill(t, 1, createImpacts(8))
    resetGroundTarget(t)
    expect(t.alive).toBe(true)
    expect(t.scripted).toBe(false)
  })
})
