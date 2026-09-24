import { describe, it, expect } from 'vitest'
import { CAMPAIGNS, MISSIONS, missionConfigFrom, missionRules } from '../../src/battle/missions'
import { DEFAULT_BATTLE } from '../../src/battle/setup'
import { VETERAN } from '../../src/ai/profile'
import { MAX_SIDE, MIN_SIDE } from '../../src/battle/skirmish'
import { ENTRY_PLANS } from '../../src/battle/entry'
import { readyCard, ESCORT_CARD, INTERCEPT_CARD, KILL_CARD } from '../fixtures/mission'
import type { ReadyMissionCard } from '../../src/battle/missions'
import { A6M5_BOMB_LOADOUT } from '../../src/weapons/stores'

/**
 * # 卡片 → 規則／設定
 *
 * 卡片本身的形狀（三落各四關、哪幾張打得起來、機種是不是同一個物件）由
 * `campaigns.test.ts` 守。這一份守的是**翻譯**：同一張卡產出的勝負條件與
 * 戰鬥設定。
 */

const ALL = CAMPAIGNS.flatMap((c) => MISSIONS[c])
const playable = ALL.filter((m): m is ReadyMissionCard => m.battle !== null)

/**
 * 一張撤離卡。**自己建，不從 `MISSIONS` 找。**
 *
 * 【為什麼】9 關裡沒有撤離卡 —— 那個玩法的使用者是德 M3 的返航節拍。
 * 但撤離的**判定**還在，而且正是德 M3 靠的那一條，所以它的幾何仍然要驗。
 * 從卡表找的話，這一份會跟著關卡設計一起漂。
 */
function evacCard(distance = 20000, radius = 1000, seconds = 176): ReadyMissionCard {
  const kill = readyCard(KILL_CARD).battle
  return {
    id: 'test-evac', title: '測試用撤離', type: '撤離', summary: '',
    place: '測試', period: '測試',
    battle: {
      objective: '飛抵撤離點',
      blueSpec: kill.blueSpec, redSpec: kill.redSpec, convoySpec: null,
      blueCount: 4, redCount: 8, convoyCount: 0, convoyPriority: 1,
      targetDistance: distance, targetRadius: radius, seconds,
      entry: 'pursuit', terrain: 'archipelago',
    },
  }
}

describe('關卡資料', () => {
  it('掛在批數上的波次，那張卡一定有重生，而且批數到得了', () => {
    // 【為什麼這條非有不可】沒有重生的卡批數永遠是 0，`batch` 的波次永遠
    // 不來；`at` 大於 `batches` 同理 —— 兩種都不報錯，那一關只是打不完
    for (const m of playable) {
      for (const w of m.battle.waves ?? []) {
        if (w.when.kind !== 'batch') continue
        expect(m.battle.recycle, m.id).toBeDefined()
        expect(w.when.at, m.id).toBeLessThanOrEqual(m.battle.recycle!.batches)
        expect(w.when.at, m.id).toBeGreaterThanOrEqual(1)
      }
    }
  })

  it('每一張可玩卡的架數都是 1~MAX_SIDE 的整數（敵方可以是 0）', () => {
    // 【為什麼這條非有不可】`missionConfigFrom` 刻意不夾制架數（來源是本檔的
    // 常數表，夾制只會把寫錯的關卡藏起來）。而大於 MAX_SIDE 不會拋 ——
    // 只會建一個超出特效池容量假設的超大戰場
    //
    // 【敵方的下限是 0】對手全是地面的關沒有敵機（德 M2）
    for (const m of playable) {
      for (const [k, v, min] of [
        ['blue', m.battle.blueCount, MIN_SIDE], ['red', m.battle.redCount, 0],
      ] as const) {
        expect(Number.isInteger(v), `${m.id} ${k}`).toBe(true)
        expect(v, `${m.id} ${k}`).toBeGreaterThanOrEqual(min)
        expect(v, `${m.id} ${k}`).toBeLessThanOrEqual(MAX_SIDE)
      }
      const total = m.battle.blueCount + m.battle.redCount + m.battle.convoyCount
      expect(total, m.id).toBeLessThanOrEqual(MAX_SIDE * 2)
    }
  })

  it('每張卡指的擺法都真的在表上', () => {
    for (const m of playable) expect(ENTRY_PLANS[m.battle.entry], m.id).toBeDefined()
  })

  it('可玩卡都有目標列的文字', () => {
    for (const m of playable) expect(m.battle.objective.length, m.id).toBeGreaterThan(0)
  })
})

describe('missionRules', () => {
  const ALT = DEFAULT_BATTLE.altitude
  const LAT = DEFAULT_BATTLE.lateralOffset

  it('殲滅卡給 annihilate', () => {
    expect(missionRules(readyCard(KILL_CARD), ALT, LAT).kind).toBe('annihilate')
  })

  it('撤離卡給 evacuate，撤離點在 −Z、高度取自參數', () => {
    const r = missionRules(evacCard(), ALT, LAT)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.x).toBe(0)
    expect(r.point.y).toBe(ALT)
    expect(r.point.z).toBe(-20000)
    expect(r.radius).toBe(1000)
    expect(r.seconds).toBe(176)
  })

  it('高度改了，撤離點跟著改', () => {
    // 【擋的是寫死 4000】兩者靜靜差開的症狀是「圓環浮在戰場上方，
    // 飛過去卻沒判到」
    const r = missionRules(evacCard(), 1234, LAT)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.y).toBe(1234)
  })

  it('撤離點真的在敵人那一側 —— 藍隊開局朝 −Z', () => {
    const r = missionRules(evacCard(), ALT, LAT)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.z).toBeLessThan(0)
  })

  it('護送的終點在敵人後方、攔截的在我方後方', () => {
    // 【這一行就是兩張卡的全部差別】判定那一側是同一條規則
    const e = missionRules(readyCard(ESCORT_CARD), ALT, LAT)
    const i = missionRules(readyCard(INTERCEPT_CARD), ALT, LAT)
    if (e.kind !== 'convoy' || i.kind !== 'convoy') throw new Error('應為 convoy')
    expect(e.owner).toBe('blue')
    expect(i.owner).toBe('red')
    expect(e.point.z).toBeLessThan(0)
    expect(i.point.z).toBeGreaterThan(0)
  })

  it('判定圈放在那一隊自己的航道上，不是 x = 0', () => {
    // 【擋的是「轟炸機從圈旁邊飛過去，任務永遠不結束」】兩隊對頭時各自橫向
    // 偏 ∓750 m，圈釘在 0 的話最外側那一架到圈心 1,050 m，永遠判不到
    const e = missionRules(readyCard(ESCORT_CARD), ALT, LAT)
    if (e.kind !== 'convoy') throw new Error('應為 convoy')
    expect(e.point.x).toBeCloseTo(ENTRY_PLANS.headOn.blue.across * LAT, 9)
    expect(e.point.x).not.toBe(0)
  })
})

describe('missionConfigFrom', () => {
  it('雙方的機種照卡片', () => {
    const m = readyCard(ESCORT_CARD)
    const cfg = missionConfigFrom(m)
    const first = (team: 'blue' | 'red') =>
      cfg.units.find((u) => u.team === team && u.duty === 'combat')!.members[0]!
    expect(first('blue')).toBe(m.battle.blueSpec)
    expect(first('red')).toBe(m.battle.redSpec)
  })

  it('難度套 VETERAN —— 與 battleConfigFrom 同一條理由', () => {
    expect(missionConfigFrom(readyCard(KILL_CARD)).aiProfile).toBe(VETERAN)
  })

  it('rules 由卡片產生，高度取自 DEFAULT_BATTLE', () => {
    const cfg = missionConfigFrom(evacCard())
    if (cfg.rules.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(cfg.rules.point.y).toBe(DEFAULT_BATTLE.altitude)
  })

  it('其餘幾何沿用 DEFAULT_BATTLE', () => {
    const cfg = missionConfigFrom(readyCard(KILL_CARD))
    expect(cfg.entryRange).toBe(DEFAULT_BATTLE.entryRange)
    expect(cfg.altitude).toBe(DEFAULT_BATTLE.altitude)
    expect(cfg.tas).toBe(DEFAULT_BATTLE.tas)
  })

  it('只有護送規則偏離中性的 convoyPriority', () => {
    // 【看規則不看 type】攻擊隊的卡也可以是「護航」，但那幾架不是被護送者，
    // 偏置不作用在它們身上 —— 寫了大於 1 的值只是一個沒有人讀的數字
    for (const m of playable) {
      // 【判準是規則不是 type】德 M1 的 type 是攔截，規則卻是 hunt —— 沒有
      // 被護送者可以加權。用 type 推導的話那一張會被要求有偏置
      const cfg = missionConfigFrom(m)
      expect(cfg.tuning.convoyPriority > 1, `${m.id}／${m.type}`).toBe(cfg.rules.kind === 'convoy')
    }
  })

  it('護送／攔截少填被護送的機種就拋錯', () => {
    // 【為什麼要拋而不是落回一台】少填的症狀是那一隊沒有轟炸機，而勝負條件
    // 是「轟炸機抵達／全滅」—— 一場永遠不會結束的仗，畫面上一切正常
    const m = readyCard(ESCORT_CARD)
    const broken: ReadyMissionCard = { ...m, battle: { ...m.battle, convoySpec: null } }
    expect(() => missionConfigFrom(broken)).toThrow()
  })
})

describe('艦隊', () => {
  /**
   * 【為什麼這一條是關鍵】`missionConfigFrom` 明列回傳欄位、**不透傳未知
   * 資料**。只在 `MissionBattle` 上加一格的話型別檢查會過、卡片也讀得到，
   * 但進戰鬥之後一艘船都不會有 —— 而且不報錯。
   */
  it('japan-m3 的艦隊真的流進 BattleConfig', () => {
    const card = MISSIONS.japan.find((c) => c.id === 'japan-m3') as ReadyMissionCard
    expect(card.battle).not.toBeNull()
    expect(card.battle.fleet).toBeDefined()
    expect(missionConfigFrom(card).fleet?.ships.length).toBe(8)
  })

  /**
   * 【驗透傳本身，不維護一張「哪幾張有艦隊」的名單】名單會漂：多一張帶
   * 艦隊的卡就要回來改一次，而漏改的症狀是這一條紅在一個與缺陷無關的
   * 地方。比對**卡片上的那一個物件**則永遠成立 —— 沒有艦隊的卡兩邊都是
   * `undefined`。
   */
  it('fleet 原樣透傳，沒有的卡就是沒有', () => {
    expect(missionConfigFrom(readyCard(KILL_CARD)).fleet).toBeUndefined()
    for (const m of playable) {
      expect(missionConfigFrom(m).fleet, m.id).toBe(m.battle.fleet)
    }
  })

  /**
   * 【史實組】倫內爾島的 TF 18 是巡洋艦編隊：接戰時六巡六驅，兩艘護航
   * 航母開打前就被留在後面。遊戲裡放八艘、巡洋與驅逐各四，維持一比一。
   *
   * **Essex 不准出現** —— 1943 年 1 月它還沒到太平洋，差九個月。
   */
  it('倫內爾島是四艘 Wichita 加四艘 Fletcher，全部紅隊，沒有航母', () => {
    const card = MISSIONS.japan.find((c) => c.id === 'japan-m3') as ReadyMissionCard
    const f = card.battle.fleet!
    const by = (id: string) => f.ships.filter((x) => x.cls === id).length
    expect(by('wichita')).toBe(4)
    expect(by('fletcher')).toBe(4)
    expect(by('essex')).toBe(0)
    for (const x of f.ships) expect(x.team).toBe('red')
  })
})

describe('開場高度', () => {
  /**
   * 【為什麼這一條值得存在】在 `MissionBattle.altitude` 之前，每一關的開場
   * 高度全部寫死成 `DEFAULT_BATTLE.altitude`。倫內爾島是**低空**雷擊，
   * 用 4,000 m 的話玩家開場在 3,850 m 而艦隊在 3.85 km 正下方 ——
   * **不低頭看不到船**，而那一關的第一印象本來就該是海面上的艦隊。
   */
  it('倫內爾島是低空的，其餘沿用預設', () => {
    const m4 = MISSIONS.japan.find((c) => c.id === 'japan-m3') as ReadyMissionCard
    expect(missionConfigFrom(m4).altitude).toBe(1000)
    expect(missionConfigFrom(readyCard(KILL_CARD)).altitude).toBe(DEFAULT_BATTLE.altitude)
  })

  /**
   * 【撤離點要跟著卡片的高度走】`missionRules` 拿高度算撤離點與集合點。
   * 一邊讀卡片、一邊讀預設的話，圓環會浮在編隊上方幾千公尺 —— 不報錯。
   */
  it('有終點的關，圓環的高度等於開場高度', () => {
    for (const m of playable) {
      const cfg = missionConfigFrom(m)
      const r = cfg.rules
      // 【`defend`、`interdict` 也沒有點】它們與殲滅同一種形狀：沒有終點、沒有半徑。
      // 截斷關的撤離點在返航節拍上，由 `campaigns.test.ts` 守它的高度
      if (
        r.kind === 'annihilate' || r.kind === 'sink' || r.kind === 'destroy'
        || r.kind === 'defend' || r.kind === 'hunt' || r.kind === 'interdict'
      ) continue
      expect(r.point.y, m.id).toBeCloseTo(cfg.altitude, 6)
    }
  })
})

/**
 * 掛載的複寫。
 *
 * 【為什麼這一條非有不可】`missionConfigFrom` **明列回傳欄位、不透傳未知
 * 資料**（那是它自己的註解寫的），所以新增一欄而忘了在那裡抄一次，症狀是
 * 「複寫靜靜失效、玩家掛著預設的東西起飛」——型別過得去，畫面也正常。
 */
describe('卡片可以複寫玩家的掛載', () => {
  const OVERRIDE = {
    kind: 'bomb', count: 4, damage: 1234, reloadSeconds: 7,
  } as const

  it('卡片上有就傳得到 BattleConfig', () => {
    const card = readyCard(KILL_CARD)
    const withLoadout: ReadyMissionCard = {
      ...card,
      battle: { ...card.battle, blueLoadout: OVERRIDE },
    }
    expect(missionConfigFrom(withLoadout).blueLoadout).toEqual(OVERRIDE)
  })

  it('卡片上沒有就不出現 —— 下游才分得出「沒複寫」與「複寫成空的」', () => {
    for (const m of playable) {
      if (m.battle.blueLoadout !== undefined) continue
      expect(missionConfigFrom(m).blueLoadout, m.id).toBeUndefined()
    }
  })
})

/**
 * 依機種複寫掛載。**與 `blueLoadout` 同一條理由要明列透傳**，而且它不分
 * 隊伍：盟 M3 的紅隊有零戰也有陸攻，整隊複寫的話陸攻的魚雷會被換掉。
 */
describe('卡片可以依機種複寫掛載', () => {
  it('卡片上有就傳得到 BattleConfig', () => {
    const card = readyCard(KILL_CARD)
    const loadouts = { a6m5: A6M5_BOMB_LOADOUT }
    const withLoadouts: ReadyMissionCard = { ...card, battle: { ...card.battle, loadouts } }
    expect(missionConfigFrom(withLoadouts).loadouts).toEqual(loadouts)
  })

  /** 【爆戦只在盟 M3】沖繩外海的零戰掛彈攻艦隊；其他關的零戰是空手的 */
  it('盟 M3 的零戰掛爆戦，日 M1 的零戰不掛', () => {
    const byId = (id: string) => playable.find((m) => m.id === id)!
    expect(missionConfigFrom(byId('allies-m3')).loadouts).toEqual({ a6m5: A6M5_BOMB_LOADOUT })
    expect(missionConfigFrom(byId('japan-m1')).loadouts).toBeUndefined()
  })
})

describe('目標橫幅', () => {
  /** 【每一張可玩卡都要有】沒有的話進場那 3 秒是空的；要短，玩家一眼讀完 */
  it('每一張可玩卡都有橫幅，而且不超過 14 個字', () => {
    for (const m of playable) {
      expect(m.battle.banner, m.id).toBeTruthy()
      expect(m.battle.banner!.length, m.id).toBeLessThanOrEqual(14)
    }
  })
})
