import { describe, it, expect, beforeAll } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { shouldFire } from '../../src/ai/fire'
import { buildEngageBasis, createEngageBasis } from '../../src/ai/steer'
import { createSituation, evaluateGeometry, evaluateThreat } from '../../src/ai/assess'
import { createArchipelago, PEAK_MAX } from '../../src/world/archipelago'
import { clearImpacts } from '../../src/world/events'
import type { LandField } from '../../src/world/occlusion'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { findOcclusionCase } from '../fixtures/occlusion-case'

/**
 * 山要擋得住子彈與視線。
 *
 * ── 考題怎麼來的 ────────────────────────────────────────
 *
 * `test/fixtures/occlusion-case.ts` 在真的高度場上搜一條弦：兩架同高、
 * 離地 120 m（安全層的 clearance）、相距 ≤ 1 km，取山頂高出連線最多的
 * 那一組 —— 高出越多，兩架接近時遮蔽維持得越久。
 *
 * 座標是搜出來而不是抄下來的 —— 山改矮改緩這裡跟著動，而下面「考題本身
 * 要成立」那三條會在幾何不再成立時直接紅，不會靜靜地變成一個不再遮蔽的
 * 場景。
 *
 * ── 每一條都有對照組 ──────────────────────────────────
 *
 * 沒有對照組的話，「命中 0」也可能只是因為兩架根本打不到對方 —— 初稿的
 * 探針就犯過這個錯（把兩架擺在 1,800 m 外，量到的是射程不是遮蔽）。
 *
 * ── 為什麼不去仗裡量發生率 ────────────────────────────
 *
 * 在一場仗裡數「有幾發穿山」會數到 0，而那個 0 只代表這一場沒撞上。
 * 遮蔽是一個確定的幾何事實，直接把情境造出來就好。
 */

const DT = 1 / 240
const FWD = new Vector3(0, 0, -1)
const TAS = 200

const arch = createArchipelago()
const LAND: LandField = { field: arch.field, ceiling: PEAK_MAX, landAbove: 0 }

const CASE = findOcclusionCase(arch.field, arch.islands)
const D = CASE.d
const Y = CASE.y
const A = new Vector3(CASE.ax, Y, CASE.az)
const B = new Vector3(CASE.bx, Y, CASE.bz)

/** 擺一架在 `pos`、機首指向 `look`、以 TAS 沿機首飛 */
function place(a: Aircraft, pos: Vector3, look: Vector3): void {
  const dir = look.clone().sub(pos).normalize()
  a.state.position.copy(pos)
  a.state.velocity.copy(dir).multiplyScalar(TAS)
  a.state.orientation.setFromUnitVectors(FWD, dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
}

describe('考題本身要成立', () => {
  it('兩架都在飛 —— 離地不低於安全層的 clearance', () => {
    expect(A.y - arch.field.sample(A.x, A.z)).toBeGreaterThanOrEqual(120 - 1e-9)
    expect(B.y - arch.field.sample(B.x, B.z)).toBeGreaterThanOrEqual(120 - 1e-9)
  })

  it('在有效射程之內', () => {
    expect(A.distanceTo(B)).toBeCloseTo(2 * D, 6)
  })

  it('山頂比兩者的連線高', () => {
    console.log(JSON.stringify({
      半弦: D, 高度: Y.toFixed(1), 稜線: CASE.ridge.toFixed(1), 高出: CASE.drop.toFixed(1),
    }))
    expect(CASE.ridge).toBeGreaterThan(Y)
  })
})

// ── 彈丸 ──────────────────────────────────────────────────

/**
 * 從 A 往 B 射一發，回報它有沒有到得了 B、以及一路上有幾朵火花。
 *
 * 【為什麼不擺一架飛機當靶、不走飛行模型】那樣量到的會是「機首追不追得上
 * 預瞄點」——1 km 外 3° 的機首誤差就是 52 m，對照組會因為打不準而紅，
 * 與遮蔽無關。這一段要問的是**子彈到不到得了**，所以直接生彈丸。
 */
function shot(land: LandField | null) {
  const w = new World()
  w.land = land
  const dir = B.clone().sub(A).normalize()
  const speed = 887
  // owner 0：這一支沒有 combatants，射手是 undefined、陣營 −1，等於不做
  // 同隊過濾。**不能給 −1**，那是彈丸池的空槽哨兵
  w.projectiles.spawn(A.x, A.y, A.z, dir.x * speed, dir.y * speed, dir.z * speed, 10, 0, 0, PROJECTILE_LIFETIME)

  let sparks = 0
  let closest = Infinity
  for (let i = 0; i < Math.round(2 / DT); i++) {
    w.step(DT)
    sparks += w.hitEvents.count
    clearImpacts(w.hitEvents)
    clearImpacts(w.splashEvents)
    if (w.projectiles.live > 0) {
      // 池子裡只有這一發
      const d = Math.hypot(
        w.projectiles.x[0]! - B.x, w.projectiles.y[0]! - B.y, w.projectiles.z[0]! - B.z)
      if (d < closest) closest = d
    }
  }
  return { closest, sparks, dropped: w.hitEvents.dropped }
}

describe('彈丸：山擋得住子彈', () => {
  // 【模擬放 beforeAll，不放 describe 本體】放本體會在收集階段就跑，
  // reporter 記不到它的時間，而且 `.skip` 與 `-t` 過濾都擋不住它
  let withLand: ReturnType<typeof shot>
  let without: ReturnType<typeof shot>
  beforeAll(() => {
    withLand = shot(LAND)
    without = shot(null)
  }, 60_000)

  it('有山：到不了對面，而且山壁上有火花', () => {
    console.log(JSON.stringify({
      closest: withLand.closest.toFixed(0), sparks: withLand.sparks,
    }))
    // 兩架相距 1 km —— 到不了「對面 100 m 之內」就是被擋住了
    expect(withLand.closest).toBeGreaterThan(100)
    expect(withLand.sparks).toBeGreaterThan(0)
  })

  it('沒山：飛得到 —— 對照組，證明這一發本來就到得了', () => {
    console.log(JSON.stringify({ closest: without.closest.toFixed(1) }))
    // 【為什麼是 5 m 而不是 0】240 Hz、887 m/s 下一步走 3.7 m，取樣只落在
    // 步的邊界上 —— 最近的那一步不會剛好是 0
    expect(without.closest).toBeLessThan(5)
    expect(without.sparks).toBe(0)
  })

  it('火花的緩衝沒有溢位', () => {
    expect(withLand.dropped).toBe(0)
  })
})

// ── 戰鬥機 AI ─────────────────────────────────────────────

function fireDecision(land: LandField | null): boolean {
  const shooter = new Aircraft(P51D)
  const target = new Aircraft(BF109K4)
  place(shooter, A, B)
  place(target, B, A)
  target.state.velocity.set(0, 0, 0)
  const sit = createSituation()
  const basis = createEngageBasis()
  // 【geometry 要先跑】range 與 losRate 是它填的，而 shouldFire 讀那兩個。
  // 只跑 evaluateThreat 的話 range 是 0，第二個條件就直接擋掉了
  evaluateGeometry(shooter, target, sit)
  evaluateThreat(shooter, target, sit)
  buildEngageBasis(shooter, target, basis)
  return shouldFire(sit, basis, shooter, undefined, land)
}

describe('戰鬥機 AI：不對山後面的敵人開火', () => {
  it('有山：不開火', () => {
    expect(fireDecision(LAND)).toBe(false)
  })

  it('沒山：開火 —— 對照組', () => {
    expect(fireDecision(null)).toBe(true)
  })
})

/**
 * 【這一條要跑控制器，不能只測純函式】只測 `shouldFire` 抓不到「遮蔽的
 * mask 沒接上 `danger`」——而那正是最容易漏的地方（可選參數漏接哪一條
 * 都不會有型別錯誤）。
 *
 * 要跑滿反應延遲與 `alarmRamp` 的飽和時間，所以 8 秒。
 */
function defendShare(land: LandField | null): { all: number; early: number } {
  const w = new World()
  const victim = new Aircraft(P51D)
  const hunter = new Aircraft(BF109K4)
  place(victim, A, B)
  place(hunter, B, A)
  const vc = w.add(victim, new AiController(), 'blue', A.clone(), Y, TAS)
  const hc = w.add(hunter, new AiController(), 'red', B.clone(), Y, TAS)
  const board = createTargetBoard(w.combatants)
  for (const c of w.combatants) {
    const ai = c.controller as AiController
    ai.board = board
    ai.selfIndex = c.index
    if (land !== null) ai.terrain = { islands: arch.islands, land }
  }
  void vc
  void hc

  let samples = 0
  let defending = 0
  let earlySamples = 0
  let earlyDefending = 0
  for (let i = 0; i < Math.round(8 / DT); i++) {
    w.step(DT)
    if (i % 12 !== 0) continue
    const isDefend = (w.combatants[0]!.controller as AiController).intent === 'defend'
    samples++
    if (isDefend) defending++
    if (i * DT < EARLY_SECONDS) {
      earlySamples++
      if (isDefend) earlyDefending++
    }
  }
  return {
    all: defending / Math.max(1, samples),
    early: earlyDefending / Math.max(1, earlySamples),
  }
}

/**
 * 【為什麼要分「前 6 秒」與「整段 8 秒」】兩架都是 AI，8 秒之內會互相接近
 * 與機動，**山到後段就不再擋在兩者之間了**。實測有山那一組的 defend 全部
 * 出現在 7.40–7.95 s（前 7.4 秒一次都沒有），也就是遮蔽在它成立的期間確實
 * 有效，只是場景跑到後面遮蔽自己失效了。
 *
 * 原本斷言整段 8 秒**恰好為 0**，那是靠幾何剛好沒漂到那一步；P-51D 改用
 * 試飛重量之後兩機的相對位置變了，同一個窗口就會碰到解除遮蔽的那一刻。
 * 8 秒不能縮 —— 檔頭寫著那是 `alarmRamp` 飽和所需。所以改成兩段各自判。
 */
const EARLY_SECONDS = 6

describe('戰鬥機 AI：不對山後面的瞄準做防禦機動', () => {
  it('沒山：會進 defend —— 對照組', () => {
    const share = defendShare(null)
    console.log(JSON.stringify({ noLand: share.all.toFixed(3), early: share.early.toFixed(3) }))
    expect(share.all).toBeGreaterThan(0)
    expect(share.early, '對照組必須在前 6 秒內就進 defend').toBeGreaterThan(0)
  })

  it('有山：遮蔽成立的期間完全不進 defend', () => {
    const withLand = defendShare(LAND)
    const noLand = defendShare(null)
    console.log(JSON.stringify({
      withLand: withLand.all.toFixed(3), early: withLand.early.toFixed(3),
      noLand: noLand.all.toFixed(3),
    }))
    // 前 6 秒山確實擋在中間 —— 一次都不准
    expect(withLand.early).toBe(0)
    // 【整段只要求不多於對照組】搜出來的島半徑 800 m 上下，兩架 2.5 秒就
    // 交錯，之後遮蔽自己失效、兩組的行為一樣；整段的份額分不出遮蔽的效果，
    // 效果由上面「前 6 秒為 0」那一條守。這一條擋的是「遮蔽反而多出 defend」
    expect(withLand.all).toBeLessThanOrEqual(noLand.all)
  })
})

// ── 砲塔 AI ───────────────────────────────────────────────

/**
 * 【它要守的規則】轟炸機身上的自動機槍不應該把山後的敵人
 * 列入考慮。
 *
 * 【只擋選目標，不擋扳機】搜尋每 `SEARCH_INTERVAL`（1 秒）一次，所以這裡
 * 跑 1.5 秒 —— 保證至少搜尋過一次。
 */
function turretLocked(land: LandField | null): number {
  const w = new World()
  w.land = land
  const bomber = new Aircraft(B17G)
  const enemy = new Aircraft(BF109K4)
  place(bomber, A, B)
  place(enemy, B, A)
  const bc = w.add(bomber, { update: () => {} } as never, 'blue', A.clone(), Y, TAS)
  const ec = w.add(enemy, { update: () => {} } as never, 'red', B.clone(), Y, TAS)
  void ec
  for (let i = 0; i < Math.round(1.5 / DT); i++) {
    bc.command.aimWorld.copy(bomber.state.velocity).normalize()
    bc.command.throttle = 0.7
    w.step(DT)
  }
  return bc.turretStates.filter((t) => t.targetIndex >= 0).length
}

describe('砲塔 AI：不把山後的敵人列入考慮', () => {
  it('沒山：有砲塔咬上 —— 對照組', () => {
    const n = turretLocked(null)
    console.log(JSON.stringify({ noLand: n }))
    expect(n).toBeGreaterThan(0)
  })

  it('有山：一座都不咬', () => {
    const n = turretLocked(LAND)
    console.log(JSON.stringify({ withLand: n }))
    expect(n).toBe(0)
  })
})
