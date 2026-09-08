import { beforeAll, describe, expect, it } from 'vitest'
import { createBattle, stepBattle, type Battle, type BattleConfig } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type ReadyMissionCard } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { BOMB_PROFILE } from '../../src/ai/bombRun'
import { TORPEDO_PROFILE } from '../../src/ai/torpedoRun'
import { PLANT_CENTER, PLANT_PAD } from '../../src/world/leuna'
import { IMPACT_STRIDE, clearImpacts } from '../../src/world/events'
import type { Controller } from '../../src/control/Controller'

/**
 * # 盟 M2：三架 AI B-17 真的炸得到廠區
 *
 * 「疊新的一層之前先量它跑不跑得到」：地面目標、打擊目標視圖、卡片三層
 * 各自的單元測試都綠，也不代表 AI 在這一關投得出去 —— 接線漏一處（例如
 * `wireTerrain` 沒接 `groundTargets`）的症狀是一枚都不投、畫面上一切正常。
 *
 * 【兩個情境】
 *
 * - **無攔截**：開場就把紅方全部打掉、不放波次。守的是接線 —— 三架 AI
 *   **各自**都要投得出去。只驗總數的話，兩架僚機因為站位或索引問題從頭
 *   到尾不投也是綠的。
 * - **完整卡片**：守的是卡片本身 —— 至少一枚落在墊面內、第二批從後方來。
 *   四架 B-17 對八架 K-4 有幾架活到投彈點是平衡度，由試飛裁定，不在這裡釘。
 *
 * 【模擬呼叫端的排空】`World` 不排空落點事件；不清的話每一步都把歷史
 * 重複算進去。彈艙 20 秒回補，所以看的是全程的最小艙量。
 */
const card = MISSIONS.allies.find((c) => c.id === 'allies-m2') as ReadyMissionCard
const IDLE: Controller = { update() {} }
const DT = 1 / 240
const SEED = 1234
const SECONDS = 240

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

interface Run {
  b: Battle
  /** 每一架藍機全程的最小艙量（load + queue）。開場滿艙 10 */
  minLoad: Map<number, number>
  impacts: { x: number; z: number; kind: number }[]
  /** 第二批進場那一步：新來那幾架的出生點與機首方向 */
  lateSpawn: { z: number; forwardZ: number }[]
  blueZAtWave: number
}

function simulate(cfg: BattleConfig, noEnemies: boolean): Run {
  const b = createBattle(IDLE, cfg, SEED)
  if (noEnemies) {
    for (const c of b.world.combatants) if (c.team === 'red') b.world.applyDamage(c, 1e9, 'fuselage')
  }
  const run: Run = { b, minLoad: new Map(), impacts: [], lateSpawn: [], blueZAtWave: NaN }
  const opening = b.world.combatants.length
  for (let i = 0; i < SECONDS * 240; i++) {
    wire(b)
    stepBattle(b, DT)
    for (const c of b.world.combatants) {
      if (c.team !== 'blue') continue
      const load = c.bombBay.load + c.bombBay.queue
      const prev = run.minLoad.get(c.index)
      if (prev === undefined || load < prev) run.minLoad.set(c.index, load)
    }
    const d = b.world.bombEvents.data
    for (let e = 0; e < b.world.bombEvents.count; e++) {
      const o = e * IMPACT_STRIDE
      run.impacts.push({ x: d[o]!, z: d[o + 2]!, kind: d[o + 3]! })
    }
    clearImpacts(b.world.bombEvents)
    clearImpacts(b.world.groundKillEvents)
    if (run.lateSpawn.length === 0 && b.world.combatants.length > opening) {
      run.lateSpawn = b.world.combatants.slice(opening).map((c) => {
        const q = c.aircraft.state.orientation
        // 自身 −Z 轉到世界的 z 分量
        return { z: c.spawnPosition.z, forwardZ: -(1 - 2 * (q.x * q.x + q.y * q.y)) }
      })
      let sum = 0
      let n = 0
      for (const c of b.world.combatants) {
        if (c.team === 'blue' && c.alive) { sum += c.aircraft.state.position.z; n++ }
      }
      run.blueZAtWave = n > 0 ? sum / n : NaN
    }
  }
  return run
}

function inPad(impacts: readonly { x: number; z: number }[]): number {
  return impacts.filter((p) =>
    Math.abs(p.x - PLANT_CENTER.x) <= PLANT_PAD.halfX
    && Math.abs(p.z - PLANT_CENTER.z) <= PLANT_PAD.halfZ).length
}

describe('盟 M2：無攔截時三架 AI B-17 各自都炸得到廠區', () => {
  let r: Run
  beforeAll(() => {
    const cfg = missionConfigFrom(card)
    // 【拿掉波次】守接線的情境不要第二批進場
    const { beats: _beats, ...quiet } = cfg
    r = simulate(quiet, true)
  }, 600_000)

  it('三架 AI 的彈艙全程各自都減少過', () => {
    const ai = r.b.world.combatants.filter((c) => c.team === 'blue' && c.controller instanceof AiController)
    expect(ai).toHaveLength(3)
    for (const c of ai) expect(r.minLoad.get(c.index), `#${c.index} 全程最小艙量`).toBeLessThan(10)
  })

  it('大半的落點在墊面內，至少一座構件掉血', () => {
    const hurt = r.b.world.groundTargets.filter((t) => t.hp < t.value)
    console.log(`無攔截：落點 ${r.impacts.length} 筆、墊面內 ${inPad(r.impacts)} 筆、掉血 ${hurt.length} 座`)
    expect(inPad(r.impacts)).toBeGreaterThan(r.impacts.length / 2)
    expect(hurt.length).toBeGreaterThan(0)
  })
})

describe('盟 M2：完整卡片', () => {
  let r: Run
  beforeAll(() => { r = simulate(missionConfigFrom(card), false) }, 600_000)

  it('至少一枚落在墊面內、至少一座構件掉血', () => {
    const hurt = r.b.world.groundTargets.filter((t) => t.hp < t.value)
    console.log(`完整卡片：落點 ${r.impacts.length} 筆、墊面內 ${inPad(r.impacts)} 筆、掉血 ${hurt.length} 座`)
    expect(inPad(r.impacts)).toBeGreaterThan(0)
    expect(hurt.length).toBeGreaterThan(0)
  })

  it('第二批 Bf 109 生在藍隊後方、機首朝 −Z', () => {
    expect(r.lateSpawn.length).toBeGreaterThanOrEqual(4)
    for (const s of r.lateSpawn) {
      expect(s.z).toBeGreaterThan(r.blueZAtWave)
      expect(s.forwardZ).toBeLessThan(0)
    }
  })
})
