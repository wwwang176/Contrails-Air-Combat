import { describe, it, expect } from 'vitest'
import { MISSIONS, missionConfigFrom, missionRules } from '../../src/battle/missions'
import { DEFAULT_BATTLE } from '../../src/battle/setup'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'
import { VETERAN } from '../../src/ai/profile'
import { MAX_SIDE, MIN_SIDE } from '../../src/battle/skirmish'
import { ENTRY_PLANS } from '../../src/battle/entry'
import type { BattleConfig } from '../../src/battle/setup'
import { sideCount } from '../../src/battle/order'

describe('任務卡（M10 spec §10）', () => {
  it('兩個陣營各五張', () => {
    expect(MISSIONS.allies).toHaveLength(5)
    expect(MISSIONS.axis).toHaveLength(5)
  })

  it('難度落在 1~5', () => {
    for (const list of [MISSIONS.allies, MISSIONS.axis]) {
      for (const m of list) {
        expect(m.difficulty).toBeGreaterThanOrEqual(1)
        expect(m.difficulty).toBeLessThanOrEqual(5)
        expect(Number.isInteger(m.difficulty)).toBe(true)
      }
    }
  })

  it('全部標題不重複', () => {
    const all = [...MISSIONS.allies, ...MISSIONS.axis].map((m) => m.title)
    expect(new Set(all).size).toBe(all.length)
  })

  it('五種任務類型各出現一次', () => {
    for (const list of [MISSIONS.allies, MISSIONS.axis]) {
      expect(new Set(list.map((m) => m.type)).size).toBe(5)
    }
  })

  it('每一張都有一行說明', () => {
    for (const m of [...MISSIONS.allies, ...MISSIONS.axis]) {
      expect(m.summary.length).toBeGreaterThan(0)
    }
  })
})

describe('關卡資料（任務框架 spec §7.3）', () => {
  /*
   * 【這裡原本有一條「可打的只有殲滅與撤離」】拿掉了。專案負責人
   * 2026-08-16：「幾張卡這個不用寫測試吧?」—— 對，那條在數卡片，而
   * **哪幾張開著是負責人裁定的事**（關掉撤離就是一次）。每開關一張卡就要
   * 改一次測試，那是雜訊不是護欄。
   *
   * 真正該由機器守的兩件事都還在，而且開關旗標時一個字都不用動：
   *
   *   可打的卡 ⇒ 有目標文字與編制        （下面「可打的卡都有目標文字與編制」）
   *   沒有目標文字 ⇒ 資料全空且不可點    （下面「沒有目標文字的卡＝還沒做」）
   */
  it('每張卡的 id 全域唯一', () => {
    const ids = [...MISSIONS.allies, ...MISSIONS.axis].map((m) => m.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /**
   * 【為什麼要釘前綴】`main.ts` 的 `onMission` 由 `id.startsWith('axis')` 推
   * 陣營。少了這一條，某天新增一張 id 沒照規矩取的卡，玩家會拿到錯的機種
   * —— 而畫面上沒有任何東西會透露原因。
   */
  it('id 的前綴就是陣營', () => {
    for (const m of MISSIONS.allies) expect(m.id.startsWith('allies-'), m.id).toBe(true)
    for (const m of MISSIONS.axis) expect(m.id.startsWith('axis-'), m.id).toBe(true)
  })

  it('可打的卡都有目標文字與編制', () => {
    for (const m of [...MISSIONS.allies, ...MISSIONS.axis]) {
      if (!m.playable) continue
      expect(m.objective.length, m.title).toBeGreaterThan(0)
      expect(m.blueCount, m.title).toBeGreaterThanOrEqual(1)
      expect(m.redCount, m.title).toBeGreaterThanOrEqual(1)
    }
  })

  /**
   * 【為什麼要守上界】`missionConfigFrom` 刻意不夾制（夾制會把寫錯的關卡
   * 藏起來），而 `createBattle` 只有在 `blueCount === 0` 時才拋 ——
   * **大於 MAX_SIDE 不會拋**，只會建一個超出特效池容量假設的超大戰場
   * （Codex 審查 2026-08-16）。這一條就是那道保險。
   */
  it('每一張卡的架數都是 1~MAX_SIDE 的整數', () => {
    for (const m of [...MISSIONS.allies, ...MISSIONS.axis]) {
      for (const [name, n] of [['藍', m.blueCount], ['紅', m.redCount]] as const) {
        expect(Number.isInteger(n), `${m.title} ${name}`).toBe(true)
        expect(n, `${m.title} ${name}`).toBeGreaterThanOrEqual(MIN_SIDE)
        expect(n, `${m.title} ${name}`).toBeLessThanOrEqual(MAX_SIDE)
      }
    }
  })

  /**
   * 【為什麼要逐值釘死時限】它們是算出來的（`實測直飛 × EVAC_MARGIN`），
   * 而我在註解裡把 `168.2 × 1.4` 心算成 235.5 進位到 236 —— 實際是 235.48，
   * `Math.round` 給 235。**程式一直是對的，錯的是註解**，而當時沒有任何
   * 測試看得出這件事（Codex 審查 2026-08-16）。
   */
  it('兩張撤離卡的時限是實測算出來的那兩個值', () => {
    const allies = MISSIONS.allies.find((m) => m.type === '撤離')!
    const axis = MISSIONS.axis.find((m) => m.type === '撤離')!
    expect(allies.seconds, '125.5 × 1.4 = 175.70').toBe(176)
    expect(axis.seconds, '168.2 × 1.4 = 235.48').toBe(235)
    // 【軸心國一定要比較久】它開 Bf109 逃、被更快的 P-51 追（spec §8.4）
    expect(axis.seconds).toBeGreaterThan(allies.seconds)
  })

  /**
   * 【判準為什麼從 `playable` 換成 `objective`】原本這一條讀的是「未開放的卡
   * 一定全空」。撤離被關掉之後那句話不再成立 —— 它**做好了才被關掉**，資料
   * 是實測推導出來的，清掉等於把 `evacuate.probe.ts` 量的東西丟了。
   *
   * 所以要守的不變量其實一直是：**卡片資料要嘛完整、要嘛全空，不能半套。**
   * 而「做好了沒」的標記是 `objective`（HUD 目標列的文字）不是 `playable`
   * （這一版要不要開放）。半套的話，哪天翻開旗標會冒出一個沒有目標列的任務。
   */
  it('沒有目標文字的卡＝還沒做，資料必須全空而且不可點', () => {
    for (const m of [...MISSIONS.allies, ...MISSIONS.axis]) {
      if (m.objective !== '') continue
      expect(m.targetDistance, m.title).toBe(0)
      expect(m.targetRadius, m.title).toBe(0)
      expect(m.seconds, m.title).toBe(Infinity)
      expect(m.playable, m.title).toBe(false)
    }
  })

  /**
   * 【為什麼要正面釘住這幾個數字】關掉一張卡最省事的做法是把它的資料一起
   * 清空 —— 而那會靜靜地丟掉 `evacuate.probe.ts` 實測出來的
   * 20 km／1,000 m／176 s／235 s。這一條讓「清掉」變成一次紅燈而不是一次
   * 無聲的刪除。
   *
   * 【它不讀 `playable`】所以撤離翻回來的那一天，這一條也不用改；判定機制
   * 本身則由 `mission.test.ts` 與 `mission-evacuate.test.ts` 繼續守著
   * （那兩支同樣不讀 `playable`）。
   */
  it('撤離：實測推導出來的資料一個都沒掉', () => {
    for (const list of [MISSIONS.allies, MISSIONS.axis]) {
      const evac = list.find((m) => m.type === '撤離')!
      expect(evac.objective.length, evac.title).toBeGreaterThan(0)
      expect(evac.targetDistance, evac.title).toBe(20000)
      expect(evac.targetRadius, evac.title).toBe(1000)
      expect(Number.isFinite(evac.seconds), evac.title).toBe(true)
    }
  })
})

describe('missionRules', () => {
  const kill = MISSIONS.allies.find((m) => m.type === '殲滅')!
  const evac = MISSIONS.allies.find((m) => m.type === '撤離')!

  it('殲滅卡給 annihilate', () => {
    expect(missionRules(kill, 4000, 1500).kind).toBe('annihilate')
  })

  it('撤離卡給 evacuate，撤離點在 −Z、高度取自參數', () => {
    const r = missionRules(evac, 4000, 1500)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.x).toBe(0)
    expect(r.point.y).toBe(4000)
    expect(r.point.z).toBe(-evac.targetDistance)
    expect(r.radius).toBe(evac.targetRadius)
    expect(r.seconds).toBe(evac.seconds)
  })

  /** 【高度是參數不是常數】否則某次調高度之後，圓環會浮在戰場上方 */
  it('高度改了，撤離點跟著改', () => {
    const r = missionRules(evac, 6000, 1500)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.y).toBe(6000)
  })

  it('撤離點真的在敵人那一側 —— 藍隊開局朝 −Z', () => {
    const r = missionRules(evac, 4000, 1500)
    if (r.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(r.point.z).toBeLessThan(-DEFAULT_BATTLE.entryRange / 2)
  })
})

describe('missionConfigFrom', () => {
  const evacAllies = MISSIONS.allies.find((m) => m.type === '撤離')!
  const evacAxis = MISSIONS.axis.find((m) => m.type === '撤離')!

  /**
   * 編組表版本的讀取器。**斷言的意思一個字沒變** —— 改動前讀
   * `cfg.blueSpec`，現在取那一隊第一個小隊的長機。
   */
  const specOf = (c: BattleConfig, team: 'blue' | 'red') =>
    c.units.find((u) => u.team === team)!.members[0]!

  it('同盟國：藍隊飛 P-51、紅隊飛 Bf 109，架數照卡片', () => {
    const cfg = missionConfigFrom(evacAllies, 'allies')
    expect(specOf(cfg, 'blue').id).toBe(P51D.id)
    expect(specOf(cfg, 'red').id).toBe(BF109G6.id)
    expect(sideCount(cfg.units, 'blue')).toBe(evacAllies.blueCount)
    expect(sideCount(cfg.units, 'red')).toBe(evacAllies.redCount)
  })

  it('軸心國：藍隊飛 Bf 109 —— 玩家恆在藍隊，換的是機種不是顏色', () => {
    const cfg = missionConfigFrom(evacAxis, 'axis')
    expect(specOf(cfg, 'blue').id).toBe(BF109G6.id)
    expect(specOf(cfg, 'red').id).toBe(P51D.id)
  })

  it('難度套 VETERAN —— 與 battleConfigFrom 同一條理由', () => {
    expect(missionConfigFrom(MISSIONS.allies[0]!, 'allies').aiProfile).toBe(VETERAN)
  })

  it('rules 由卡片產生，高度取自 DEFAULT_BATTLE', () => {
    const cfg = missionConfigFrom(evacAllies, 'allies')
    if (cfg.rules.kind !== 'evacuate') throw new Error('應為 evacuate')
    expect(cfg.rules.point.y).toBe(DEFAULT_BATTLE.altitude)
  })

  /**
   * 【擺法是每張卡自己的欄位】撤離用追擊（敵機在正後方 800 m、高 1,000 m），
   * 其餘用對頭。這一條驗的是**卡片指的那份表真的被套上去**，不是它好不好玩
   * —— 後者由試飛裁定（專案負責人 2026-08-16）。
   */
  it('撤離用追擊，其餘用對頭', () => {
    for (const [faction, cards] of Object.entries(MISSIONS)) {
      for (const m of cards) {
        expect(m.entry, `${m.title}`).toBe(m.type === '撤離' ? 'pursuit' : 'headOn')
        const cfg = missionConfigFrom(m, faction as 'allies' | 'axis')
        // 【編組表版本】改動前 `cfg.entry` 是整份 `EntryPlan`；現在每個小隊
        // 各帶自己那一側的 `SideEntry`，所以逐側比
        expect(cfg.units.find((u) => u.team === 'blue')!.entry, m.title)
          .toBe(ENTRY_PLANS[m.entry].blue)
        expect(cfg.units.find((u) => u.team === 'red')!.entry, m.title)
          .toBe(ENTRY_PLANS[m.entry].red)
      }
    }
  })

  it('每張卡指的擺法都真的在表上', () => {
    for (const m of [...MISSIONS.allies, ...MISSIONS.axis]) {
      expect(ENTRY_PLANS[m.entry], m.title).toBeDefined()
    }
  })

  it('殲滅卡的 rules 是 annihilate', () => {
    const kill = MISSIONS.axis.find((m) => m.type === '殲滅')!
    expect(missionConfigFrom(kill, 'axis').rules.kind).toBe('annihilate')
  })

  it('其餘幾何沿用 DEFAULT_BATTLE', () => {
    const cfg = missionConfigFrom(evacAllies, 'allies')
    expect(cfg.entryRange).toBe(DEFAULT_BATTLE.entryRange)
    expect(cfg.altitude).toBe(DEFAULT_BATTLE.altitude)
    expect(cfg.tas).toBe(DEFAULT_BATTLE.tas)
  })
})
