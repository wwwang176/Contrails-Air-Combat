import { beforeAll, describe, it, expect } from 'vitest'
import { createBattle, stepBattle, resetBattle, DEFAULT_BATTLE, type Battle, type BattleConfig } from '../../src/battle/setup'
import {
  missionConfigFrom, type MissionBattle, type ReadyMissionCard,
} from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import { cardWith, readyCard, INTERCEPT_CARD, KILL_CARD } from '../fixtures/mission'

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

function battleFor(card: ReadyMissionCard) {
  return createBattle(new Idle(), missionConfigFrom(card), SEED)
}

/** 由四元數求滾轉角，度。取機體右翼在世界座標的 y 分量 */
function rollDeg(a: Aircraft): number {
  const q = a.state.orientation
  const y = 2 * (q.x * q.y + q.z * q.w)
  return Math.asin(Math.max(-1, Math.min(1, y))) * (180 / Math.PI)
}

describe('護送：被護送的那幾架平行飛向終點', () => {
  /**
   * 美 M1 開場飛 `SECONDS` 秒，全部在接觸之前（兩隊相距 10 km 以上）：之後的滾轉是
   * 閃彈（`defendLatch`），速度也會被戰損帶走。
   *
   * 【定速三秒就分得出來】拿掉集合令上的 `cruiseTas` 時，B-17 以全油門加速，三秒內
   * 偏離巡航速度十幾 km/h；定速控制下不到 2 km/h。
   */
  const SECONDS = 3
  let b: Battle
  let cruise: number
  /** 開場那一步的空速，km/h，依 `convoy.seats` */
  let spawnKmh: number[]
  /** 全程空速離巡航速度最遠多少，km/h */
  let maxSpeedOff = 0
  let maxRoll = 0

  beforeAll(() => {
    b = battleFor(readyCard('allies-m1'))
    cruise = b.cfg.convoyCruiseTas! * 3.6
    const seats = b.convoy!.seats
    spawnKmh = seats.map((s) => b.world.combatants[s]!.aircraft.state.velocity.length() * 3.6)
    for (let i = 0; i < Math.round(SECONDS / DT); i++) {
      stepBattle(b, DT)
      for (const seat of seats) {
        const c = b.world.combatants[seat]!
        if (!c.alive) continue
        maxRoll = Math.max(maxRoll, Math.abs(rollDeg(c.aircraft)))
        maxSpeedOff = Math.max(maxSpeedOff, Math.abs(c.aircraft.state.velocity.length() * 3.6 - cruise))
      }
    }
  })

  it('B-17 開場就是卡片的巡航速度，航行中維持它而不是全油門加速', () => {
    expect(b.cfg.convoyCruiseTas).toBeDefined()
    for (const v of spawnKmh) expect(v).toBeCloseTo(cruise, 6)
    expect(maxSpeedOff).toBeLessThan(2)
    for (const seat of b.convoy!.seats) {
      const c = b.world.combatants[seat]!
      if (c.alive) expect(c.command.throttle).toBeLessThan(WEP_THROTTLE)
    }
  })

  it('接觸之前滾轉恆為零 —— 一台一個小隊真的消掉了僚機走位', () => {
    // 【門檻 1°，不是 0】浮點與 240 Hz 的積分不會給恰好的零
    expect(maxRoll).toBeLessThan(1)
  })

  /**
   * 【終點的 x 就是出生的 x】每一架瞄自己的點，所以飛的是一條與 Z 軸平行的線。
   * 全部瞄同一個點的話整隊沿途向內收攏。
   */
  it('每一架各自沿一條平行線走 —— 終點的 x 就是自己出生的 x', () => {
    const cv = b.convoy!
    expect(cv.points).toHaveLength(cv.seats.length)
    for (const [t, seat] of cv.seats.entries()) {
      expect(cv.points[t]!.x).toBe(b.world.combatants[seat]!.spawnPosition.x)
    }
  })

  it('被護送的那幾架拿到的是自己那一點的集合令，而且照 transit 飛', () => {
    const cv = b.convoy!
    let checked = 0
    for (const [t, seat] of cv.seats.entries()) {
      const c = b.world.combatants[seat]!
      if (!c.alive) continue
      const ai = c.controller
      expect(ai).toBeInstanceOf(AiController)
      const order = (ai as AiController).order
      expect(order).not.toBeNull()
      expect(order!.kind).toBe('rally')
      expect(order!.point).toBe(cv.points[t])
      expect((ai as AiController).transit).toBe(true)
      checked++
    }
    // 【全部陣亡時上面一條都沒跑】那樣的綠沒有意義
    expect(checked).toBeGreaterThan(0)
  })

  /** 【重開走 `settle`】出生速度存在 `spawnTas`，不是重算一次 */
  it('重開之後 B-17 回到巡航速度', () => {
    resetBattle(b)
    for (const seat of b.convoy!.seats) {
      expect(b.world.combatants[seat]!.aircraft.state.velocity.length() * 3.6).toBeCloseTo(cruise, 6)
    }
  })

  it('被護送的小隊不進指揮官的下令清單，但仍在對手的 foe 清單裡', () => {
    const b = battleFor(readyCard('allies-m1'))
    // 藍隊 1 支戰鬥機小隊 + 每架被護送的各一支單機小隊，下令端只剩 1 支
    expect(b.blueFlightIndices).toHaveLength(1 + b.convoy!.seats.length)
    expect(b.blueOrderFlights).toHaveLength(1)
    // 紅隊沒有被護送者，兩份一樣
    expect(b.redOrderFlights).toEqual(b.redFlightIndices)
  })
})

/**
 * 箱型的終點。**卡片由 `cardWith` 開箱型**，所以這一組量的是機制，不隨盟 M1
 * 的架數或偏移移動。
 */
describe('箱型：每一架的終點帶著自己的高度與縱深', () => {
  function boxBattle(patch: (cfg: BattleConfig) => BattleConfig = (c) => c) {
    const cfg = missionConfigFrom(cardWith('allies-m1', { convoyBox: true, convoyCount: 16 }))
    return createBattle(new Idle(), patch(cfg), SEED)
  }
  const transitOf = (cfg: BattleConfig) => cfg.units.filter((u) => u.duty === 'transit')

  it('終點的 y、z 偏移就是那一架的 rise 與 depth', () => {
    const b = boxBattle()
    const cv = b.convoy!
    const transit = transitOf(b.cfg)
    expect(cv.points).toHaveLength(transit.length)
    // 【對照組】箱型真的有三個高度、兩個縱深，否則下面逐項相等是同義反覆
    expect(new Set(transit.map((u) => u.rise)).size).toBe(3)
    expect(new Set(transit.map((u) => u.depth)).size).toBe(2)
    for (const [t, p] of cv.points.entries()) {
      expect(p.y).toBe(cv.goal.y + (transit[t]!.rise ?? 0))
      expect(p.z).toBe(cv.goal.z + (transit[t]!.depth ?? 0))
    }
  })

  it('出生高度到終點高度的差整隊相同 —— 飛到終點還是同一個箱子', () => {
    const b = boxBattle()
    const cv = b.convoy!
    const drops = cv.seats.map((s, t) => b.world.combatants[s]!.spawnPosition.y - cv.points[t]!.y)
    for (const d of drops) expect(d).toBeCloseTo(drops[0]!, 6)
    // 出生時的高度確實分成三層
    const ys = new Set(cv.seats.map((s) => Math.round(b.world.combatants[s]!.spawnPosition.y)))
    expect(ys.size).toBe(3)
  })

  /**
   * 【擋的是只量 x】橫向在圈內、縱深把它推出圈外的那一架，飛到自己的終點時
   * 仍然不在圈裡 —— 它永遠判不到，而畫面上只是從圈後面飛過去。
   */
  it('縱深把一架推出圈外時拋錯，即使橫向在圈內', () => {
    const far = (cfg: BattleConfig): BattleConfig => {
      let first = true
      return {
        ...cfg,
        units: cfg.units.map((u) => {
          if (u.duty !== 'transit' || !first) return u
          first = false
          return { ...u, depth: 2000 }
        }),
      }
    }
    expect(() => boxBattle(far)).toThrow(/永遠判不到/)
  })
})

/**
 * 「抵達就贏、全滅就輸、攔截時勝負互換」。轟炸機直接擺進自己的終點、或由測試
 * 擊落（`World.destroy`，與實戰陣亡同一條路），然後走一步 —— 勝負只由規則決定，
 * 與誰打得準、飛得多快無關。
 */
describe('護送與攔截：一條規則的兩側', () => {
  function convoyBattle(id: string, over: Partial<MissionBattle> = {}): Battle {
    return battleFor(cardWith(id, over))
  }

  function need(b: Battle): number {
    if (b.rules.kind !== 'convoy') throw new Error('應為 convoy')
    return b.rules.need ?? 1
  }

  /** 前 `n` 架被護送的擺到自己的終點上 */
  function arrive(b: Battle, n: number): void {
    const cv = b.convoy!
    for (let t = 0; t < n; t++) {
      b.world.combatants[cv.seats[t]!]!.aircraft.state.position.copy(cv.points[t]!)
    }
  }

  function shootDown(b: Battle, n: number): void {
    for (const seat of b.convoy!.seats.slice(0, n)) b.world.destroy(b.world.combatants[seat]!)
  }

  it('護送 —— 轟炸機抵達終點就贏', () => {
    const b = convoyBattle('allies-m1')
    // 【對照組】還沒到的那一步不判贏 —— 擋「規則接反、開局就判贏」
    stepBattle(b, DT)
    expect(b.outcome).toBe('fighting')
    arrive(b, need(b))
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
    // 【看抵達的閂，不看領頭距離】`convoyLead` 只算**還在路上**的那幾架
    expect(b.convoy?.arrived.filter(Boolean)).toHaveLength(need(b))
    expect(b.mission.remaining).toBeGreaterThan(0)
  })

  it('護送 —— 轟炸機全部被擊落就輸', () => {
    // `need: 1`：走的是「全滅」那一條分支，不是門檻
    const b = convoyBattle('allies-m1', { convoyCount: 2, need: 1 })
    shootDown(b, 2)
    stepBattle(b, DT)
    expect(b.outcome).toBe('defeat')
    expect(b.mission.remaining).toBe(0)
  })

  it('護送 —— 湊不到門檻就提早判輸，不等全滅', () => {
    // 【四架、門檻三、擊落兩架】`remaining > 0` 是重點：還有轟炸機在飛就判敗，
    // 才是提早定案而不是等到全滅
    const b = convoyBattle('allies-m1', { convoyCount: 4, need: 3 })
    shootDown(b, 2)
    stepBattle(b, DT)
    expect(b.outcome).toBe('defeat')
    expect(b.mission.remaining).toBeGreaterThan(0)
  })

  it('攔截 —— 敵轟炸機全部被擊落就贏（護航的戰鬥機忽略）', () => {
    // 護航機一架都沒掉也照樣算贏 —— 那正是「護航的戰鬥機忽略」那句話
    const b = convoyBattle(INTERCEPT_CARD, { convoyCount: 2 })
    shootDown(b, 2)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
    expect(b.mission.remaining).toBe(0)
    // 紅隊沒有全滅，贏的判準只看轟炸機
    expect(b.red.some((c) => c.alive)).toBe(true)
  })

  it('攔截的終點在 +Z —— 方向跟著轟炸機那一隊的機首走', () => {
    const b = battleFor(readyCard(INTERCEPT_CARD))
    expect(b.cfg.rules.kind).toBe('convoy')
    expect(b.mission.target.z).toBeGreaterThan(0)
    const e = battleFor(readyCard('allies-m1'))
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
    // 【出貨的九關沒有殲滅卡】樣本是 fixture 組的合成殲滅卡
    const b = battleFor(readyCard(KILL_CARD))
    expect(b.convoy).toBeNull()
    expect(b.cfg.rules.kind).toBe('annihilate')
    expect(b.mission.hasTarget).toBe(false)
    expect(b.mission.remaining).toBe(-1)
  })
})
