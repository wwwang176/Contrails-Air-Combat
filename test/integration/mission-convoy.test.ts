import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom, type MissionCard } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { FactionChoice } from '../../src/battle/skirmish'
import type { Battery } from '../../src/weapons/types'
import type { Team } from '../../src/world/World'

/**
 * 讓一支槍不痛。
 *
 * 【為什麼一定要】不隔離戰損的話，「抵達判贏」與「一路被打光」在
 * `outcome` 上分不出是哪一條規則生效。與 `mission-evacuate.test.ts` 同一手。
 */
function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}

const DT = 1 / 240
const SEED = 20260821

/** 玩家席位什麼都不做 —— 這幾條量的是機制，不是打得贏打不贏 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

function battleFor(faction: FactionChoice, id: string) {
  const card = MISSIONS[faction].find((m) => m.id === id)
  if (card === undefined) throw new Error(`沒有這張卡：${id}`)
  return createBattle(new Idle(), missionConfigFrom(card, faction), SEED)
}

/** 由四元數求滾轉角，度。取機體右翼在世界座標的 y 分量 */
function rollDeg(a: Aircraft): number {
  const q = a.state.orientation
  const y = 2 * (q.x * q.y + q.z * q.w)
  return Math.asin(Math.max(-1, Math.min(1, y))) * (180 / Math.PI)
}

describe('護送：被護送的那幾架平行飛向終點', () => {
  it('接觸之前滾轉恆為零 —— 一台一個小隊真的消掉了僚機走位', () => {
    const b = battleFor('allies', 'allies-escort')
    const cv = b.convoy
    expect(cv).not.toBeNull()
    let maxRoll = 0
    // 【只跑到接觸之前】兩隊由 10 km 對頭合攏，前 15 秒還打不到。之後的
    // 滾轉是閃彈（`defendLatch`），那是另一條既有裁定，見 backlog §2.28
    for (let i = 0; i < Math.round(15 / DT); i++) {
      stepBattle(b, DT)
      for (const seat of cv!.seats) {
        const c = b.world.combatants[seat]!
        if (c.alive) maxRoll = Math.max(maxRoll, Math.abs(rollDeg(c.aircraft)))
      }
    }
    // 【門檻 1°，不是 0】浮點與 240 Hz 的積分不會給恰好的零
    expect(maxRoll).toBeLessThan(1)
  })

  it('每一架各自沿一條平行線走 —— 橫向位置不變、縱向朝終點', () => {
    const b = battleFor('allies', 'allies-escort')
    const cv = b.convoy!
    const x0 = cv.seats.map((s) => b.world.combatants[s]!.aircraft.state.position.x)
    const z0 = cv.seats.map((s) => b.world.combatants[s]!.aircraft.state.position.z)
    for (let i = 0; i < Math.round(15 / DT); i++) stepBattle(b, DT)
    for (let t = 0; t < cv.seats.length; t++) {
      const p = b.world.combatants[cv.seats[t]!]!.aircraft.state.position
      // 橫向 15 秒內漂移不到 50 m
      expect(Math.abs(p.x - x0[t]!)).toBeLessThan(50)
      // 縱向朝終點（−Z）推進了 1 km 以上
      expect(z0[t]! - p.z).toBeGreaterThan(1000)
    }
  })

  it('整隊都落得進判定圈 —— 否則最外側那幾架永遠判不到', () => {
    const b = battleFor('allies', 'allies-escort')
    const cv = b.convoy!
    for (const p of cv.points) {
      expect(Math.abs(p.x - cv.goal.x)).toBeLessThan(b.mission.targetRadius)
    }
  })

  it('被護送的小隊不進指揮官的下令清單，但仍在對手的 foe 清單裡', () => {
    const b = battleFor('allies', 'allies-escort')
    // 藍隊 5 支小隊（1 支戰鬥機 + 4 支單機），下令端只剩 1 支
    expect(b.blueFlightIndices).toHaveLength(5)
    expect(b.blueOrderFlights).toHaveLength(1)
    // 紅隊沒有被護送者，兩份一樣
    expect(b.redOrderFlights).toEqual(b.redFlightIndices)
  })

  it('被護送的那幾架拿到的是集合令，而且永遠不解除', () => {
    const b = battleFor('allies', 'allies-escort')
    const cv = b.convoy!
    for (let i = 0; i < Math.round(60 / DT); i++) stepBattle(b, DT)
    for (const seat of cv.seats) {
      const c = b.world.combatants[seat]!
      if (!c.alive) continue
      const ai = c.controller
      expect(ai).toBeInstanceOf(AiController)
      const order = (ai as AiController).order
      expect(order).not.toBeNull()
      expect(order!.kind).toBe('rally')
    }
  })
})

describe('護送與攔截：一條規則的兩側', () => {
  /**
   * 【為什麼這幾條動卡片的敵機數，而不是照卡片原樣打】它們要釘的是**規則**
   * ——「抵達就贏、全滅就輸、攔截時勝負互換」。卡片的敵機數是**平衡**，由
   * `test/tools/convoy.probe.ts` 量、由專案負責人裁定，會隨試飛移動。
   * 兩者綁在一起的話，每一次調難度都會弄紅一條與難度無關的測試，而那正是
   * 「護欄被改成配合實作」的起點。
   */
  function outcomeOf(
    faction: FactionChoice, id: string,
    over: Partial<MissionCard> = {}, disarm: Team | null = null,
  ) {
    const card = MISSIONS[faction].find((m) => m.id === id)!
    const cfg = missionConfigFrom({ ...card, ...over }, faction)
    const b = createBattle(new Idle(), disarm === null ? cfg : {
      ...cfg,
      // 【逐架把槍拆掉】與 `mission-evacuate.test.ts` 同一手。混編也正確 ——
      // 每一種機各自換成自己的無害版本，不是整隊壓成同一台
      units: cfg.units.map((u) => (u.team !== disarm ? u : {
        ...u,
        members: u.members.map((m) => ({ ...m, battery: harmless(m.battery) })),
      })),
    }, SEED)
    let t = 0
    for (let i = 0; i < Math.round(300 / DT); i++) {
      stepBattle(b, DT)
      t += DT
      if (b.outcome !== 'fighting') break
    }
    return { b, t }
  }

  it('護送 —— 轟炸機抵達終點就贏', () => {
    // 【把紅隊的槍拆掉】要量的是抵達那一刻的判定，不是四架 B-17 擋不擋得住
    // 幾架 Bf109。留著戰損的話這條測試會變成一條**平衡**護欄 —— 而平衡每
    // 試飛一次就會動，見上面 `outcomeOf` 的註解。
    //
    // 【為什麼不是「把敵機減到很少」】試過 `redCount: 1`：仍然打掉三架
    // B-17，剩下那一架只有 24% 血。「少到打不動」在這個局面下不存在，
    // 因為被護送的那幾架完全不迴避（`AiController.transit`）
    const { b, t } = outcomeOf('allies', 'allies-escort', {}, 'red')
    expect(b.outcome).toBe('victory')
    // 判定的那一刻，至少一架在圈內
    expect(b.mission.metric).toBeLessThan(b.mission.targetRadius)
    expect(b.mission.remaining).toBeGreaterThan(0)
    // 12 km 的航程，轟炸機全速約 128 m/s —— 兩分鐘上下
    expect(t).toBeGreaterThan(80)
    expect(t).toBeLessThan(200)
  }, 120_000)

  it('護送 —— 轟炸機全部被擊落就輸', () => {
    // 【敵機加到滿編】要走到的是另一條分支，所以刻意讓轟炸機活不了
    const { b } = outcomeOf('allies', 'allies-escort', { redCount: 20 })
    expect(b.outcome).toBe('defeat')
    expect(b.mission.remaining).toBe(0)
  }, 120_000)

  it('攔截 —— 同一件事（敵轟炸機抵達）判成輸', () => {
    const { b } = outcomeOf('allies', 'allies-intercept')
    expect(b.outcome).toBe('defeat')
    expect(b.mission.metric).toBeLessThan(b.mission.targetRadius)
  }, 120_000)

  it('攔截 —— 敵轟炸機全部被擊落就贏（護航的戰鬥機忽略）', () => {
    // 【我方加到滿編、對方不帶護航】火力足夠時打得完，而且**紅隊的護航機
    // 還活著也照樣算贏** —— 那正是「護航的戰鬥機忽略」那句話
    const { b } = outcomeOf('allies', 'allies-intercept', { blueCount: 20, redCount: 2 })
    expect(b.outcome).toBe('victory')
    expect(b.mission.remaining).toBe(0)
    // 紅隊沒有全滅，贏的判準只看轟炸機
    expect(b.red.some((c) => c.alive)).toBe(true)
  }, 120_000)

  it('攔截的終點在 +Z —— 方向跟著轟炸機那一隊的機首走', () => {
    const b = battleFor('allies', 'allies-intercept')
    expect(b.cfg.rules.kind).toBe('convoy')
    expect(b.mission.target.z).toBeGreaterThan(0)
    const e = battleFor('allies', 'allies-escort')
    expect(e.mission.target.z).toBeLessThan(0)
  })
})

describe('沒有被護送者的場次一個字都沒變', () => {
  it('遭遇戰：convoy 是 null，下令清單等於全部小隊', () => {
    const b = createBattle(new Idle(), DEFAULT_BATTLE, SEED)
    expect(b.convoy).toBeNull()
    expect(b.blueOrderFlights).toEqual(b.blueFlightIndices)
    expect(b.redOrderFlights).toEqual(b.redFlightIndices)
    expect(b.mission.remaining).toBe(-1)
  })

  it('殲滅任務：規則仍然是 annihilate，沒有圓環', () => {
    for (const [faction, id] of [['allies', 'allies-sweep'], ['axis', 'axis-patrol']] as const) {
      const b = battleFor(faction, id)
      expect(b.convoy).toBeNull()
      expect(b.cfg.rules.kind).toBe('annihilate')
      expect(b.mission.hasTarget).toBe(false)
      expect(b.mission.remaining).toBe(-1)
    }
  })
})
