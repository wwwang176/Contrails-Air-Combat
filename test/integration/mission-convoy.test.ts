import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, DEFAULT_BATTLE, type BattleConfig } from '../../src/battle/setup'
import {
  missionConfigFrom, type MissionBattle, type ReadyMissionCard,
} from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Battery } from '../../src/weapons/types'
import type { Team } from '../../src/world/World'
import { cardWith, readyCard, INTERCEPT_CARD, KILL_CARD } from '../fixtures/mission'

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
  it('接觸之前滾轉恆為零 —— 一台一個小隊真的消掉了僚機走位', () => {
    const b = battleFor(readyCard('allies-m1'))
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
    const b = battleFor(readyCard('allies-m1'))
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
    const b = battleFor(readyCard('allies-m1'))
    const cv = b.convoy!
    // 【量三維】箱型的上下中隊有高度與縱深偏移，只量 x 會放過它們
    for (const p of cv.points) {
      expect(p.distanceTo(cv.goal)).toBeLessThan(b.mission.targetRadius)
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

  it('被護送的那幾架拿到的是集合令，而且永遠不解除', () => {
    const b = battleFor(readyCard('allies-m1'))
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

  it('每一架的終點離圈心的三維距離都小於半徑', () => {
    const b = boxBattle()
    const cv = b.convoy!
    for (const p of cv.points) expect(p.distanceTo(cv.goal)).toBeLessThan(cv.radius)
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

describe('護送與攔截：一條規則的兩側', () => {
  /**
   * 【為什麼這幾條動卡片的敵機數，而不是照卡片原樣打】它們要釘的是**規則**
   * ——「抵達就贏、全滅就輸、攔截時勝負互換」。卡片的敵機數是**平衡**，由
   * `test/tools/convoy.probe.ts` 量、由負責人定值，會隨試飛移動。
   * 兩者綁在一起的話，每一次調難度都會弄紅一條與難度無關的測試，而那正是
   * 「護欄被改成配合實作」的起點。
   */
  /**
   * 終點拉近到這裡。
   *
   * 【為什麼可以動】判定是「轟炸機進了圈沒有」，與圈在多遠無關 ——
   * 卡片的 12,000 m 是**關卡的長度**，不是判定需要的長度。整隊飛完
   * 12 km 要一百多秒，而這幾條每一條都要飛到底。
   *
   * 【為什麼不歸零】太近的話轟炸機出生就在圈裡，「飛到終點」與「一開始
   * 就在終點」分不出來，那四條會在規則接反的情況下照樣綠。3,000 m 足夠
   * 讓它們真的飛一段。
   */
  const NEAR_GOAL = 3000

  function outcomeOf(
    card: ReadyMissionCard,
    over: Partial<MissionBattle> = {}, disarm: Team | null = null,
  ) {
    const cfg = missionConfigFrom({
      ...card, battle: { ...card.battle, targetDistance: NEAR_GOAL, ...over },
    })
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
    const { b, t } = outcomeOf(readyCard('allies-m1'), {}, 'red')
    expect(b.outcome).toBe('victory')
    // 【看抵達的閂，不看領頭距離】`convoyLead` 只算**還在路上**的那幾架，
    // 所以定案那一刻它指的是下一架、不是剛進圈的那一架
    expect(b.convoy?.arrived.some((x) => x)).toBe(true)
    expect(b.mission.remaining).toBeGreaterThan(0)
    // 【它守的是「真的飛過去」】下界擋「規則接反、開局就判贏」：終點在
    // `NEAR_GOAL` 外，轟炸機全速約 128 m/s，物理上不可能在 20 秒內到。
    // 上界擋「卡住、靠 300 秒的迴圈上限才收場」。實測 68 秒，兩邊都很寬。
    expect(t).toBeGreaterThan(20)
    expect(t).toBeLessThan(200)
  }, 120_000)

  it('護送 —— 轟炸機全部被擊落就輸', () => {
    // 【敵機加到滿編、被護送的減到兩架】要走到的是另一條分支，所以刻意
    // 讓轟炸機活不了。
    //
    // 【為什麼要減架數】20 架敵機在 12 km 的航程裡打不完四架 B-17 ——
    // 打掉兩架、剩下兩架帶傷抵達，判成 `victory`。減的是**要被打光的那個
    // 數量**，也就是這條測試自己的自變數；門檻（「全滅就輸」）沒有動。
    //
    // 【`need: 1`】這一條走的是「全滅」那一條分支。卡片的門檻大於兩架時，
    // 開局就湊不到門檻、當場判敗，量到的是另一條規則
    //
    // 【把藍隊的槍拆掉、偏置釘在 5】兩架轟炸機活不活得到終點，否則就綁在
    // 卡片的 `convoyPriority` 與護航機的火力上 —— 那是平衡，會隨試飛移動。
    // 卡片的偏置 3 時，拆了槍仍有一架抵達
    const { b } = outcomeOf(
      readyCard('allies-m1'),
      { redCount: 20, convoyCount: 2, need: 1, convoyPriority: 5 }, 'blue')
    expect(b.outcome).toBe('defeat')
    expect(b.mission.remaining).toBe(0)
  }, 120_000)

  it('護送 —— 湊不到門檻就提早判輸，不等全滅', () => {
    // 【這一條量的是真的一場仗裡門檻有沒有接上】規則本身由
    // `battle-convoy.test.ts` 的 need 那一組證明；這裡證明 `setup.ts` 餵進去的
    // 已抵達與存活數讓它在半路就定案。
    //
    // 【四架、門檻三】打掉兩架就湊不到。`remaining > 0` 是重點：還有轟炸機在
    // 飛就判敗，才是提早定案而不是等到全滅。偏置與敵機數覆寫的理由同上一條
    const { b } = outcomeOf(
      readyCard('allies-m1'), { redCount: 20, convoyCount: 4, need: 3, convoyPriority: 5 })
    expect(b.outcome).toBe('defeat')
    expect(b.mission.remaining).toBeGreaterThan(0)
  }, 120_000)

  it('攔截 —— 同一件事（敵轟炸機抵達）判成輸', () => {
    // 【把我方的槍拆掉】與上面那條護送的 disarm 完全對稱：要量的是抵達
    // 那一刻的判定，不是十架 P-51 追不追得完四架 He 111。
    //
    // 【沒有 disarm 就會綁在平衡上】攔截方由 4 架改成
    // 10 架之後這條就紅了 —— 轟炸機在抵達前先被打光，`victory` 而不是
    // `defeat`。那正是這個 describe 開頭警告過的事：「每一次調難度都會
    // 弄紅一條與難度無關的測試」。修的是測試的自變數，不是門檻
    const { b } = outcomeOf(readyCard(INTERCEPT_CARD), {}, 'blue')
    expect(b.outcome).toBe('defeat')
    // 理由同上面那一條護送：看的是抵達的閂，不是領頭距離
    expect(b.convoy?.arrived.some((x) => x)).toBe(true)
  }, 120_000)

  it('攔截 —— 敵轟炸機全部被擊落就贏（護航的戰鬥機忽略）', () => {
    // 【我方加到滿編、護航一架、被攔截的減到兩架】火力足夠時打得完，
    // 而且**紅隊的護航機還活著也照樣算贏** —— 那正是「護航的戰鬥機忽略」
    // 那句話。減架數的理由與上面那條護送相同
    //
    // 【護航為什麼只有一架】兩架護航時，20 架 P-51 只打得掉一架 He 111，
    // 另一架在 145 秒抵達終點，判成 `defeat`。一架護航時兩架轟炸機都在
    // 49 秒前掉下來，而那架護航機**一滴血都沒掉** —— 「忽略護航」這句話
    // 要有這個差距才量得到
    const { b } = outcomeOf(readyCard(INTERCEPT_CARD), { blueCount: 20, redCount: 1, convoyCount: 2 })
    expect(b.outcome).toBe('victory')
    expect(b.mission.remaining).toBe(0)
    // 紅隊沒有全滅，贏的判準只看轟炸機
    expect(b.red.some((c) => c.alive)).toBe(true)
  }, 120_000)

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
    for (const id of [KILL_CARD] as const) {
      const b = battleFor(readyCard(id))
      expect(b.convoy).toBeNull()
      expect(b.cfg.rules.kind).toBe('annihilate')
      expect(b.mission.hasTarget).toBe(false)
      expect(b.mission.remaining).toBe(-1)
    }
  })
})
