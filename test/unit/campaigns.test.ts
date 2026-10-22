import { describe, it, expect } from 'vitest'
import { MISSIONS, CAMPAIGNS, convoyGround, missionConfigFrom } from '../../src/battle/missions'
import { LEYTE_ROAD } from '../../src/world/leyte'
import { ALL_SPECS, MAX_SIDE } from '../../src/battle/skirmish'
import { createBattle, stepBattle } from '../../src/battle/setup'
import { stepMissionProgress } from '../../src/battle/missionProgress'
import { destroyedInPool, inDestroyPool } from '../../src/battle/objectiveQueries'
import type { MissionRules } from '../../src/battle/mission'
import type { MissionCard, MissionWithdraw, ReadyMissionCard } from '../../src/battle/missions'
import { createGroundTarget } from '../../src/world/groundTargets'
import type { Combatant } from '../../src/world/combatant'
import { BOMBS_CAPACITY } from '../../src/world/bomb'
import { TORPEDOES_CAPACITY, TORPEDO_RANGE, TORPEDO_SPEED } from '../../src/world/torpedo'
import { WAKE_SLOTS } from '../../src/render/wake'
import { loadoutOf } from '../../src/weapons/stores'
import { LANGS, setLang, t } from '../../src/i18n'
import { A6M5 } from '../../src/specs/a6m5'
import { G4M } from '../../src/specs/g4m'
import { cardWith, INTERCEPT_CARD, KILL_CARD } from '../fixtures/mission'

/**
 * # 三條戰役與它們的卡
 *
 * 每一條線幾張、每一關的內容都不由測試鎖：關卡是討論過才定的。這裡守兩件事：
 *
 * - **全部卡片的資料合法性**：前綴、唯一性、數量夠不夠打完、池子裝不裝得下。
 *   寫錯的症狀是那一關打不完或特效靜靜消失，不會報錯
 * - **卡片 → 戰鬥設定的翻譯**：用 `cardWith` 改一兩格的合成卡驗，期望值從卡片的
 *   欄位推，不讀任何一關的內容
 *
 * 卡片拆成兩層：**目錄**（選單畫得出來就靠它）與**戰鬥設定**（`battle`）。
 * `battle === null` 就是「還沒做」，「資料要嘛完整、要嘛全空」由型別保證。
 */

const ALL: readonly MissionCard[] = CAMPAIGNS.flatMap((c) => MISSIONS[c])

const ready = (m: MissionCard): m is ReadyMissionCard => m.battle !== null

const IDLE = { update() {} }
const DT = 1 / 240

describe('三條戰役', () => {
  it('id 唯一，而且前綴就是戰役', () => {
    expect(new Set(ALL.map((m) => m.id)).size).toBe(ALL.length)
    for (const c of CAMPAIGNS) {
      for (const m of MISSIONS[c]) expect(m.id.startsWith(`${c}-`), m.id).toBe(true)
    }
  })

  it('兩種語言的標題都不重複，而且每一張都有一行說明', () => {
    try {
      for (const lang of LANGS) {
        setLang(lang)
        expect(new Set(ALL.map((m) => t(m.titleKey))).size, lang).toBe(ALL.length)
        for (const m of ALL) expect(t(m.summaryKey).length, `${lang} ${m.id}`).toBeGreaterThan(0)
      }
    } finally {
      setLang('zh')
    }
  })
})

describe('可玩卡的戰鬥設定', () => {
  const playable = ALL.filter(ready)

  it('機種是 ALL_SPECS 裡的同一個物件，不是等值的複本', () => {
    // 【為什麼是 toBe 不是 toEqual】下游三張依物件識別的快取（envelope、
    // doctrine、ceilings）認的是參考。等值的複本會讓那三張表全部落空，
    // 症狀是進場那一瞬間的卡頓，而且沒有任何錯誤
    for (const m of playable) {
      const b = m.battle
      expect(ALL_SPECS, `${m.id} blue`).toContain(b.blueSpec)
      expect(ALL_SPECS, `${m.id} red`).toContain(b.redSpec)
      if (b.convoySpec !== null) expect(ALL_SPECS, `${m.id} convoy`).toContain(b.convoySpec)
    }
  })

  it('convoySpec 與 convoyCount 同時有或同時沒有', () => {
    for (const m of playable) {
      // 【只問兩格一致，不問 type】德 M1 的 type 是攔截但規則是 hunt（轟炸機
      // 是一般的敵機、沒有 convoySpec），日 M1 有 convoySpec 但規則是 sink
      // （攻擊隊）—— 用 type 推導的話這兩張都會被判錯。誰該有被護送者由下面
      // 那一條依規則與職務管
      expect(m.battle.convoySpec !== null, m.id).toBe(m.battle.convoyCount > 0)
    }
  })

  /**
   * 【transit 的那幾架只在護送規則下有終點】攻擊隊（strike）不是被護送者，
   * 它要有自己能打的東西，否則那幾架轟炸機起飛之後無事可做。
   */
  it('被護送者只出現在護送規則的卡上，攻擊隊一定配著擊沉或炸毀', () => {
    for (const m of playable) {
      const b = m.battle
      if (b.convoySpec === null) continue
      const convoy = missionConfigFrom(m).rules.kind === 'convoy'
      expect(convoy, `${m.id} 的 convoyDuty`).toBe(b.convoyDuty === undefined || b.convoyDuty === 'transit')
      // 【轟炸機流的終點不判勝負】那一關要有自己的勝負 —— 擊落
      if (b.convoyDuty === 'stream') expect(b.huntCount, m.id).toBeDefined()
      if (b.convoyDuty === 'strike') {
        expect(b.sinkCount !== undefined || b.destroyCount !== undefined, m.id).toBe(true)
      }
    }
  })

  it('我方架數是正整數、敵方架數是非負整數', () => {
    for (const m of playable) {
      const b = m.battle
      expect(Number.isInteger(b.blueCount), `${m.id} blue`).toBe(true)
      expect(b.blueCount, `${m.id} blue`).toBeGreaterThan(0)
      expect(Number.isInteger(b.redCount), `${m.id} red`).toBe(true)
      // 【0 是合法的】對手全是地面的關沒有敵機
      expect(b.redCount, `${m.id} red`).toBeGreaterThanOrEqual(0)
    }
  })
})

describe('missionConfigFrom', () => {
  it('只吃可玩的卡，不再吃陣營', () => {
    for (const m of ALL.filter(ready)) {
      const cfg = missionConfigFrom(m)
      expect(cfg.units.length, m.id).toBeGreaterThan(0)
    }
  })

  /**
   * 【100 m 是絕對高度，不是離地高】地形高度要建整張高度場才量得到。開場貼地或
   * 埋進地裡的那一架第一步就墜毀，而且不報錯。只看活著的：預留給增援的席位
   * 開場不在場上，進場時才擺位
   */
  it('每一張卡開場在天上的每一架都高於 100 m', () => {
    for (const m of ALL.filter(ready)) {
      const b = createBattle(IDLE, missionConfigFrom(m), 1)
      const flying = b.world.combatants.filter((c) => c.alive)
      expect(flying.length, m.id).toBeGreaterThan(0)
      for (const c of flying) {
        expect(c.aircraft.state.position.y, `${m.id} ${c.aircraft.spec.id} #${c.index}`).toBeGreaterThan(100)
      }
    }
  })

  /**
   * 【護衛編制要有護衛】`escorts` 讓「藍隊戰鬥機全滅」判敗。藍隊一架戰鬥機都沒有的
   * 卡帶著它，開場第一步就判敗。戰鬥機的判準與 `stepMissionProgress` 數
   * `aliveBlueFighters` 的同一條：角色不是轟炸機
   */
  it('規則帶護衛編制的卡，開場藍隊一定有戰鬥機', () => {
    for (const m of ALL.filter(ready)) {
      const cfg = missionConfigFrom(m)
      if (cfg.rules.kind !== 'sink' || cfg.rules.escorts !== true) continue
      const fighters = cfg.units.some((u) => u.team === 'blue' && u.members.some((s) => s.role !== 'bomber'))
      expect(fighters, m.id).toBe(true)
    }
  })
})

/**
 * # 卡片 → 編組與規則的翻譯
 *
 * 每一條只用 `cardWith` 改合成卡的一兩格，期望值從卡片的欄位推。
 */
describe('卡片 → 編組與規則（合成卡）', () => {
  /**
   * 【我方攔截】被攔的轟炸機是紅隊、職務 transit（有終點可飛）；規則的 owner 是紅隊，
   * 抵達就判敗。`interceptConvoy: 'mine'` 翻成 `tuning.interceptConvoy: 'blue'`
   * —— 藍隊的 AI 以那一隊轟炸機為首要目標，翻錯邊的話我方戰鬥機去纏護航機
   */
  it('攔截：轟炸機排進紅隊、職務 transit，規則是紅方的 convoy，攔截方是藍隊', () => {
    const card = cardWith(INTERCEPT_CARD, { interceptConvoy: 'mine' })
    const cfg = missionConfigFrom(card)
    const bombers = cfg.units.filter((u) => u.members[0] === card.battle.convoySpec)
    expect(bombers.reduce((n, u) => n + u.members.length, 0)).toBe(card.battle.convoyCount)
    for (const u of bombers) {
      expect(u.team).toBe('red')
      expect(u.duty).toBe('transit')
    }
    expect(cfg.rules).toMatchObject({ kind: 'convoy', owner: 'red' })
    expect(cfg.tuning.interceptConvoy).toBe('blue')
    expect((cfg.beats ?? []).some((x) => x.kind === 'conveyor')).toBe(false)
    createBattle(IDLE, cfg, 1)
  })

  /** 【整隊換，不在小隊裡混】玩家那一隊照 `blueSpec`，其餘藍隊小隊整隊是 `blueOthers` */
  it('blueOthers：玩家那一隊照 blueSpec，其餘藍隊小隊整隊換機種，總架數不變', () => {
    const card = cardWith(KILL_CARD, { blueOthers: A6M5 })
    const cfg = missionConfigFrom(card)
    const blue = cfg.units.filter((f) => f.team === 'blue')
    const player = blue.filter((f) => f.player === true)
    expect(player).toHaveLength(1)
    for (const s of player[0]!.members) expect(s).toBe(card.battle.blueSpec)
    const others = blue.filter((f) => f.player !== true)
    expect(others.length).toBeGreaterThan(0)
    for (const f of others) for (const s of f.members) expect(s).toBe(A6M5)
    expect(blue.reduce((n, f) => n + f.members.length, 0)).toBe(card.battle.blueCount)
    expect(createBattle(IDLE, cfg, 1).player.aircraft.spec.id).toBe(card.battle.blueSpec.id)
  })

  /**
   * 【攻擊隊不是被護送者】strike 的轟炸機排進藍隊、職務 combat；排成 transit 的話
   * `createBattle` 拋「沒有終點可飛」。規則是帶護衛編制的擊沉，同一張卡拿掉
   * `convoyDuty` 就沒有護衛編制
   */
  it('攻擊隊：轟炸機在藍隊、職務 combat，規則帶護衛編制，不建被護送者', () => {
    const card = cardWith(KILL_CARD, { convoySpec: G4M, convoyCount: 2, convoyDuty: 'strike', sinkCount: 1 })
    const cfg = missionConfigFrom(card)
    const strike = cfg.units.filter((u) => u.members[0] === G4M)
    expect(strike.reduce((n, u) => n + u.members.length, 0)).toBe(card.battle.convoyCount)
    for (const u of strike) {
      expect(u.team).toBe('blue')
      expect(u.duty).toBe('combat')
    }
    expect(cfg.rules).toStrictEqual({ kind: 'sink', count: 1, escorts: true })
    expect(missionConfigFrom(cardWith(KILL_CARD, { sinkCount: 1 })).rules).toStrictEqual({ kind: 'sink', count: 1 })
    expect(createBattle(IDLE, cfg, 1).convoy).toBeNull()
  })

  /**
   * 【護衛全滅就判敗，要真的接上】規則本身在 `mission.test.ts`；這一條守的是
   * `stepMissionProgress` 依角色數出藍隊存活的戰鬥機填進判定。只走那一支函數一步
   */
  it('護衛編制：藍隊戰鬥機還剩一架不判敗，全滅就判敗（攻擊隊還活著）', () => {
    const card = cardWith(KILL_CARD, { convoySpec: G4M, convoyCount: 2, convoyDuty: 'strike', sinkCount: 1 })
    const b = createBattle(IDLE, missionConfigFrom(card), 1)
    const fighters = b.blue.filter((c) => c.aircraft.spec.role !== 'bomber')
    expect(fighters.length).toBeGreaterThan(1)
    for (const c of fighters.slice(1)) c.alive = false
    stepMissionProgress(b, DT)
    expect(b.mission.outcome).toBe('fighting')
    fighters[0]!.alive = false
    stepMissionProgress(b, DT)
    expect(b.blue.some((c) => c.alive && c.aircraft.spec.role === 'bomber')).toBe(true)
    expect(b.mission.outcome).toBe('defeat')
  })
})

/**
 * # 炸毀池的計數
 *
 * 停機線上的飛機會起飛：地上那一台退場，那一席上天。兩者各自的 `alive` 都會變，
 * 數錯的症狀是起飛那一刻就算成摧毀，或打下來了也不算。
 */
describe('炸毀池的計數', () => {
  const RULES: MissionRules = { kind: 'destroy', count: 2, unit: 'parkedP51' }
  const target = (unit: 'parkedP51' | 'fuelDump' | 'usFlakTrack', team: 'red' | 'blue' = 'red') =>
    createGroundTarget(0, unit, team, 0, 0, 0)

  it('規則指定單位時只有那一種敵方單位進池：油桶、防空車、我方的同型都不算', () => {
    expect(inDestroyPool(target('parkedP51'), RULES)).toBe(true)
    expect(inDestroyPool(target('fuelDump'), RULES)).toBe(false)
    expect(inDestroyPool(target('usFlakTrack'), RULES)).toBe(false)
    expect(inDestroyPool(target('parkedP51', 'blue'), RULES)).toBe(false)
    // 對照：不指定單位時敵方的每一座都進池
    expect(inDestroyPool(target('fuelDump'), { kind: 'destroy', count: 2 })).toBe(true)
  })

  it('每一架只算一次、不管死在哪裡：停著被打掉算；起飛之後看那一席還活不活著', () => {
    const t = target('parkedP51')
    const seat = { alive: true } as unknown as Combatant
    const cs = [seat]
    expect(destroyedInPool(t, cs)).toBe(false)
    t.alive = false
    expect(destroyedInPool(t, cs)).toBe(true)
    // 起飛離場：地上那一台退場（alive = false），那一席還在天上 —— 不算
    t.departed = true
    t.departedAs = 0
    expect(destroyedInPool(t, cs)).toBe(false)
    seat.alive = false
    expect(destroyedInPool(t, cs)).toBe(true)
  })
})

describe('有 interdict 的卡一定打得贏', () => {
  const cards = ALL.filter(ready).filter((m) => m.battle.interdict !== undefined)

  for (const card of cards) {
    const b = card.battle
    const rule = b.interdict!

    it(`${card.id}：有「摧毀 ≥ count」觸發的返航`, () => {
      const w = b.withdraw!
      expect(w.when.kind).toBe('destroyed')
      if (w.when.kind !== 'destroyed') return
      expect(w.when.atLeast).toBe(rule.count)
      expect(w.when.unit).toBe(rule.unit)
    })

    /** 總數連停著不動的那幾輛一起算（日 M2 灘頭的卡車停放場）：它們一樣算進摧毀數 */
    it(`${card.id}：count 不超過那一種車的總數，count + leak 大於總數`, () => {
      const parked = (b.ground ?? []).filter((g) => g.unit === rule.unit && g.team === 'red').length
      const total = parked + b.vehicleConvoy!.batches.reduce(
        (n, x) => n + x.units.filter((u) => u === rule.unit).length, 0)
      expect(rule.count).toBeLessThanOrEqual(total)
      expect(rule.count + rule.leak).toBeGreaterThan(total)
    })

    it(`${card.id}：開場整條車隊都在路線上，最前面那一輛離終點還有一段`, () => {
      const g = convoyGround(b.vehicleConvoy!)
      for (const e of g) expect(e.motion!.offsetSeconds).toBeLessThan(e.motion!.totalSeconds * 0.8)
    })

    it(`${card.id}：車隊一路透傳成地面目標，每一台都帶 motion`, () => {
      const cfg = missionConfigFrom(card)
      const moving = (cfg.ground ?? []).filter((g) => g.motion !== undefined)
      const n = b.vehicleConvoy!.batches.reduce((k, x) => k + x.units.length, 0)
      expect(moving.length).toBe(n)
      const battle = createBattle({ update() {} }, cfg, 1)
      expect(battle.world.groundTargets.filter((t) => t.motion !== null).length).toBe(n)
    })
  }
})

/**
 * # 截斷 → 撤離（合成卡）
 *
 * 截斷規則只判敗；炸夠了由返航節拍換成撤離，飛進撤離圈才判勝。返航的 `destroyed`
 * 條件數的是戰場上那一種單位的摧毀數（`stepBeats` 自己數，不借規則的池）。
 */
describe('截斷 → 撤離（合成卡）', () => {
  const TRUCKS = [0, 1, 2].map((i) => ({
    unit: 'truck' as const, team: 'red' as const, x: i * 60, z: -3000, heading: 0,
  }))
  const WITHDRAW: MissionWithdraw = {
    when: { kind: 'destroyed', atLeast: 1, unit: 'truck' }, messageKey: 'mission.type.withdraw',
    distance: -3000, from: 'player', radius: 600, seconds: 120,
  }
  const ALTITUDE = 1234
  const card = (): ReadyMissionCard => cardWith(KILL_CARD, {
    ground: TRUCKS, interdict: { count: 1, leak: 1, unit: 'truck' }, withdraw: WITHDRAW, altitude: ALTITUDE,
  })

  /**
   * 【撤離點的高度跟著卡片】撤離的判定是三維距離。讀預設任務高度的話，低空關的
   * 圓環浮在玩家頭上幾千公尺、飛不進去
   */
  it('返航節拍：從玩家量、縱深是 −distance、高度是卡片的任務高度', () => {
    const w = missionConfigFrom(card()).beats?.find((x) => x.kind === 'withdraw')
    if (w?.kind !== 'withdraw') throw new Error('應有返航節拍')
    expect(w.fromPlayer).toBe(true)
    expect([w.point.x, w.point.y, w.point.z]).toEqual([0, ALTITUDE, -WITHDRAW.distance])
  })

  it('炸到 count 輛換成撤離、不判勝；飛進撤離圈才判勝', () => {
    const b = createBattle(IDLE, missionConfigFrom(card()), 1)
    stepBattle(b, DT)
    expect(b.rules.kind).toBe('interdict')
    b.world.groundTargets[0]!.alive = false
    stepBattle(b, DT)
    expect(b.rules.kind).toBe('evacuate')
    expect(b.mission.outcome).toBe('fighting')
    if (b.rules.kind !== 'evacuate') return
    b.player.aircraft.state.position.copy(b.rules.point)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('victory')
  })

  /** 【節拍排在勝負判定之前】同一步炸夠又有一輛抵達：先換成撤離，抵達就不再判敗 */
  it('同一步炸夠又有卡車抵達：撤離先生效、不判敗', () => {
    const b = createBattle(IDLE, missionConfigFrom(card()), 1)
    const [hit, leaked] = b.world.groundTargets
    hit!.alive = false
    leaked!.alive = false
    leaked!.arrived = true
    stepBattle(b, DT)
    // 【兩個都要看】返航會重設 `mission`；判敗若先發生，定案的是 `outcome` 那一份
    expect(b.outcome).toBe('fighting')
    expect(b.mission.outcome).toBe('fighting')
    expect(b.rules.kind).toBe('evacuate')
  })
})

describe('convoyGround', () => {
  const c = {
    route: LEYTE_ROAD, speed: 10, turnRadius: 25, gap: 30, batchGap: 500,
    batches: [
      { units: ['truck', 'truck'] as const },
      { units: ['tank'] as const },
    ],
  }

  it('前車在前：同一批差一個車距，兩批之間再差一個批次間距', () => {
    const g = convoyGround(c)
    expect(g.map((e) => Math.round(e.motion!.offsetSeconds * 10))).toEqual([530, 500, 0])
  })

  it('開場就全部在走 —— 沒有停在原地等出發的', () => {
    const g = convoyGround(c)
    expect(g.map((e) => e.motion!.departAt)).toEqual([0, 0, 0])
  })

  it('開場的車頭朝向那一輛所在的路段', () => {
    for (const e of convoyGround(c)) {
      // 離它最近的那一段
      let best = Infinity
      let dir = { x: 0, z: 0 }
      for (let i = 1; i < LEYTE_ROAD.length; i++) {
        const a = LEYTE_ROAD[i - 1]!
        const b2 = LEYTE_ROAD[i]!
        const len = Math.hypot(b2.x - a.x, b2.z - a.z)
        const d = Math.hypot(e.x - (a.x + b2.x) / 2, e.z - (a.z + b2.z) / 2)
        if (d < best) { best = d; dir = { x: (b2.x - a.x) / len, z: (b2.z - a.z) / len } }
      }
      const f = { x: -Math.sin(e.heading), z: -Math.cos(e.heading) }
      expect(f.x * dir.x + f.z * dir.z).toBeGreaterThan(0.9)
    }
  })

  it('列在 armed 裡的單位帶機槍，其餘不帶', () => {
    const g = convoyGround({ ...c, armed: ['tank'] })
    expect(g.map((e) => e.guns)).toEqual([undefined, undefined, 'mg'])
  })

  it('開場擺位就是 motion 在第 0 秒的位置', () => {
    const g = convoyGround(c)
    expect(g[2]!.x).toBeCloseTo(LEYTE_ROAD[0]!.x, 6)
    expect(g[2]!.z).toBeCloseTo(LEYTE_ROAD[0]!.z, 6)
  })
})

describe('擊沉任務', () => {
  /**
   * 【要求擊沉卻沒有艦隊 = 永遠打不完】而且畫面上一切正常：目標列顯示
   * 「還差三艘」，海上一艘船都沒有。這是關卡資料的錯，要在這一層擋掉，
   * 不是在戰鬥中判一個玩家看不懂的敗北。
   */
  it('有 sinkCount 就一定要有 fleet，而且艦隊數量夠', () => {
    for (const m of ALL.filter(ready)) {
      const n = m.battle.sinkCount
      if (n === undefined) continue
      expect(m.battle.fleet, `${m.id} 要求擊沉卻沒有艦隊`).toBeDefined()
      const enemies = m.battle.fleet!.ships.filter((x) => x.team === 'red').length
      expect(enemies, `${m.id} 目標 ${n} 艘但敵艦只有 ${enemies} 艘`).toBeGreaterThanOrEqual(n)
    }
  })

  it('沒有艦隊的卡不會要求擊沉', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.fleet === undefined) expect(m.battle.sinkCount, m.id).toBeUndefined()
    }
  })
})

describe('炸毀任務', () => {
  /** 【要求炸毀卻沒有廠區 = 永遠打不完】與擊沉同一個理由，在資料層擋 */
  it('有 destroyCount 就一定要有 ground，而且敵方構件數量夠', () => {
    for (const m of ALL.filter(ready)) {
      const n = m.battle.destroyCount
      if (n === undefined) continue
      expect(m.battle.ground, `${m.id} 要求炸毀卻沒有廠區`).toBeDefined()
      const unit = m.battle.destroyUnit
      const hostile = m.battle.ground!
        .filter((e) => e.team === 'red' && (unit === undefined || e.unit === unit)).length
      expect(hostile, `${m.id} 目標 ${n} 座但敵方構件只有 ${hostile} 座`).toBeGreaterThanOrEqual(n)
    }
  })

  /**
   * 【換目標的第二段也要打得完】數的是地面清單加縱隊裡的紅方，劇本會打掉的不算 ——
   * 那幾台不會算進摧毀數，數進來的話第二段可能永遠湊不滿
   */
  it('換目標：必須有第一段，第二段的敵方單位數量夠', () => {
    for (const m of ALL.filter(ready)) {
      const r = m.battle.retarget
      if (r === undefined) continue
      expect(m.battle.destroyCount, `${m.id} 換目標卻沒有第一段`).toBeDefined()
      const inGround = (m.battle.ground ?? [])
        .filter((e) => e.team === 'red' && e.unit === r.destroyUnit && e.killAt === undefined).length
      const inColumns = (m.battle.columns ?? [])
        .filter((c) => c.team === 'red')
        .reduce((n, c) => n + c.units.filter((u) => u === r.destroyUnit).length, 0)
      expect(inGround + inColumns, m.id).toBeGreaterThanOrEqual(r.destroyCount)
    }
  })

  it('劇本不打任務目標：killAt 的單位不是兩段要數的那一種', () => {
    for (const m of ALL.filter(ready)) {
      const targets = [m.battle.destroyUnit, m.battle.retarget?.destroyUnit]
      for (const e of m.battle.ground ?? []) {
        if (e.killAt === undefined || e.team === 'blue') continue
        expect(targets.includes(e.unit), `${m.id} 劇本打掉了目標 ${e.unit}`).toBe(false)
      }
    }
  })

  it('縱隊的路線至少兩點、至少一輛', () => {
    for (const m of ALL.filter(ready)) {
      for (const c of m.battle.columns ?? []) {
        expect(c.route.length, m.id).toBeGreaterThanOrEqual(2)
        expect(c.units.length, m.id).toBeGreaterThan(0)
      }
    }
  })

  it('沒有廠區的卡不會要求炸毀', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.ground === undefined) expect(m.battle.destroyCount, m.id).toBeUndefined()
    }
  })

  /**
   * 【三種進攻規則不共存】`missionRules` 依序看擊沉、炸毀、擊落，落選的那
   * 幾格會靜靜地被忽略 —— 而它們在卡片上看起來完全正常。
   */
  it('sinkCount、destroyCount、huntCount 三者只能有一個', () => {
    for (const m of ALL.filter(ready)) {
      const counts = [m.battle.sinkCount, m.battle.destroyCount, m.battle.huntCount]
      expect(counts.filter((c) => c !== undefined).length, m.id).toBeLessThanOrEqual(1)
    }
  })

  /**
   * 【`huntRole` 不能單獨出現】只寫角色不寫數量的話 `missionRules` 根本走不到
   * 擊落那一條，那一格就是一句沒有人讀的話。
   */
  it('有 huntRole 就一定要有 huntCount', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.huntRole !== undefined) expect(m.battle.huntCount, m.id).toBeDefined()
    }
  })

  /**
   * 【`need` 只有護送與攔截讀得到】寫在別種卡上不會報錯，但它不會有任何
   * 效果 —— 而卡片上看起來像是設了一個門檻。
   */
  it('need 只出現在護航與攔截的卡上，而且不超過被護送的架數', () => {
    for (const m of ALL.filter(ready)) {
      if (m.battle.need === undefined) continue
      expect(m.type === 'escort' || m.type === 'intercept', m.id).toBe(true)
      expect(m.battle.need, m.id).toBeGreaterThan(0)
      expect(m.battle.need, m.id).toBeLessThanOrEqual(m.battle.convoyCount)
    }
  })
})

/** 【轟炸機不編隊】每一關的開場編組與增援波次，轟炸機都是一架一個小隊 */
describe('任務的轟炸機一架一個小隊', () => {
  it('開場與波次都沒有兩架以上的轟炸機小隊', () => {
    for (const card of Object.values(MISSIONS).flat()) {
      if (card.battle === null) continue
      const cfg = missionConfigFrom(card as ReadyMissionCard)
      const flights = [
        ...cfg.units,
        ...(cfg.beats ?? []).flatMap((x) => (x.kind === 'reinforce' ? [x.flight] : [])),
      ]
      for (const f of flights) {
        if (f.members.some((m) => m.role === 'bomber')) {
          expect(f.members.length, card.id).toBe(1)
        }
      }
    }
  })
})

/**
 * 【炸彈池裝得下每一關】池是環狀寫入，滿了就把還在空中的炸彈蓋掉 —— 那幾顆
 * 從空中消失，不爆也不報錯。上限取「開場每一架掛滿 + 每一個增援波次掛滿」。
 *
 * 【transit 不算】被護送／被攔截的轟炸機不挑目標，掛著彈也不會投。
 */
describe('炸彈池裝得下每一關同時掛著的炸彈', () => {
  it('每一關會投彈的飛機掛彈總數不超過 BOMBS_CAPACITY', () => {
    for (const card of Object.values(MISSIONS).flat()) {
      if (card.battle === null) continue
      const cfg = missionConfigFrom(card as ReadyMissionCard)
      const flights = [
        ...cfg.units,
        ...(cfg.beats ?? []).flatMap((x) => (x.kind === 'reinforce' ? [x.flight] : [])),
      ]
      let bombs = 0
      for (const f of flights) {
        if (f.duty === 'transit') continue
        for (const m of f.members) {
          const l = (f.team === 'blue' ? cfg.blueLoadout : undefined)
            ?? cfg.loadouts?.[m.id] ?? loadoutOf(m.id)
          if (l?.kind === 'bomb') bombs += l.count
        }
      }
      expect(bombs, card.id).toBeLessThanOrEqual(BOMBS_CAPACITY)
    }
  })
})

/**
 * 魚雷池同理：池滿時第 capacity + 1 枚蓋掉最舊的一枚，還在水裡跑的魚雷
 * 從海面消失，不爆也不報錯。
 *
 * 【一架不只一枚】跑滿射程要 `TORPEDO_RANGE / TORPEDO_SPEED`，比補雷的時間長 ——
 * 同一架可以前一枚還在跑就投下一枚。一架最多同時 ⌊跑的時間 ÷ 補雷時間⌋ + 1 枚。
 */
describe('魚雷池裝得下每一關同時在水裡的魚雷', () => {
  const RUN = TORPEDO_RANGE / TORPEDO_SPEED
  const perCarrier = (reload: number): number => Math.floor(RUN / reload) + 1

  it('每一關', () => {
    for (const card of Object.values(MISSIONS).flat()) {
      if (card.battle === null) continue
      const cfg = missionConfigFrom(card as ReadyMissionCard)
      const flights = [
        ...cfg.units,
        ...(cfg.beats ?? []).flatMap((x) => (x.kind === 'reinforce' ? [x.flight] : [])),
      ]
      let torps = 0
      for (const f of flights) {
        for (const m of f.members) {
          const l = (f.team === 'blue' ? cfg.blueLoadout : undefined)
            ?? cfg.loadouts?.[m.id] ?? loadoutOf(m.id)
          if (l?.kind === 'torpedo') torps += l.count * perCarrier(l.reloadSeconds)
        }
      }
      expect(torps, card.id).toBeLessThanOrEqual(TORPEDOES_CAPACITY)
    }
  })

  it('遭遇戰兩隊全選掛雷的機種', () => {
    let worst = 0
    for (const spec of ALL_SPECS) {
      const l = loadoutOf(spec.id)
      if (l?.kind === 'torpedo') worst = Math.max(worst, l.count * perCarrier(l.reloadSeconds))
    }
    expect(worst).toBeGreaterThan(0)
    expect(2 * MAX_SIDE * worst).toBeLessThanOrEqual(TORPEDOES_CAPACITY)
  })

  it('航跡池與魚雷池一樣大', () => {
    expect(WAKE_SLOTS).toBe(TORPEDOES_CAPACITY)
  })
})
