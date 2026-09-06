/**
 * **遭遇戰就是「一個沒有時限的殲滅任務」。**
 *
 * 【為什麼要這樣接】判定路徑因此**每一場都在走**，不是一條等著被第一次使用的
 * 死碼 —— 與地形「種類沒變也重建」是同一條紀律（M10 spec §5.3）。
 *
 * 【代價由誰守】`annihilate` 的行為必須等於 `setup.ts` 原本那兩行的判定，
 * 否則現有護欄會集體移動。這一支釘住接線，逐字的判定順序由
 * `test/unit/mission.test.ts` 釘住，全套的數字由回歸比較守。
 */
import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { createBattle, resetBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { ScriptedController } from '../../src/control/ScriptedController'
import { ENTRY_PLANS, HEAD_ON, PURSUIT, type EntryPlan } from '../../src/battle/entry'
import { BF109K4 } from '../../src/specs/bf109k4'
import { P51D } from '../../src/specs/p51d'
import { lineAbreast } from '../../src/battle/order'

const DT = 1 / 240

describe('遭遇戰＝沒有時限的殲滅任務', () => {
  it('DEFAULT_BATTLE 的 rules 是 annihilate', () => {
    expect(DEFAULT_BATTLE.rules.kind).toBe('annihilate')
  })

  it('Battle 一建好就有 mission 狀態，且與 outcome 一致', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 2) },
    )
    expect(b.mission.outcome).toBe('fighting')
    expect(b.outcome).toBe('fighting')
    expect(b.mission.hasTarget).toBe(false)
    expect(b.mission.secondsLeft).toBe(Infinity)
  })

  it('紅隊全滅時 outcome 與 mission.outcome 同步翻成 victory', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 2) },
    )
    for (const c of b.red) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('victory')
    expect(b.outcome).toBe('victory')
  })

  it('藍隊全滅時同步翻成 defeat', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 2) },
    )
    for (const c of b.blue) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.mission.outcome).toBe('defeat')
    expect(b.outcome).toBe('defeat')
  })

  it('metric 是剩餘敵機數', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 3) },
    )
    stepBattle(b, DT)
    expect(b.mission.metric).toBe(3)
    b.world.destroy(b.red[0]!)
    stepBattle(b, DT)
    expect(b.mission.metric).toBe(2)
  })

  it('resetBattle 之後任務狀態回到開局', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 2) },
    )
    for (const c of b.red) b.world.destroy(c)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
    resetBattle(b)
    expect(b.mission.outcome).toBe('fighting')
    expect(b.outcome).toBe('fighting')
  })
})

describe('撤離規則接得上 Battle', () => {
  const rules = {
    kind: 'evacuate' as const,
    point: new Vector3(0, 4000, -20000),
    radius: 1000,
    seconds: 240,
  }

  it('把玩家放到撤離點上，下一步就 victory', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 2), rules },
    )
    expect(b.mission.hasTarget).toBe(true)
    expect(b.mission.target.equals(rules.point)).toBe(true)
    b.player.aircraft.state.position.set(0, 4000, -19800)
    stepBattle(b, DT)
    expect(b.outcome).toBe('victory')
  })

  /**
   * 【為什麼要有這一條】倒數若沒有接上 `dt`，撤離任務永遠不會超時 ——
   * 而那件事在一場正常的仗裡看不出來（會先分出別的勝負）。
   */
  it('倒數每一步都在走', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 2), rules },
    )
    stepBattle(b, DT)
    const after1 = b.mission.secondsLeft
    expect(after1).toBeCloseTo(240 - DT, 9)
    for (let i = 0; i < 239; i++) stepBattle(b, DT)
    expect(b.mission.secondsLeft).toBeCloseTo(239, 6)
  })

  it('撤離場重設之後倒數回到滿的', () => {
    const b = createBattle(
      new ScriptedController(), { ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 2, BF109K4, 2), rules },
    )
    for (let i = 0; i < 240; i++) stepBattle(b, DT)
    expect(b.mission.secondsLeft).toBeLessThan(240)
    resetBattle(b)
    expect(b.mission.secondsLeft).toBe(240)
    expect(b.mission.hasTarget).toBe(true)
  })
})

/**
 * **開局擺法：只驗擺位對不對。**
 *
 * 【範圍】任務的測試只寫「是否擺位正常就好，
 * 玩起來怎樣還是以玩家自己測得為主。」所以這一段**不量難度、不量存活率、
 * 不量到達時間** —— 那些是試飛的事。這裡只回答一個問題：**`entry.ts` 那張
 * 表裡寫的東西，有沒有原封不動地變成飛機的出生狀態。**
 *
 * 反過來說，這一段守得住的是「改了表就會照著變、沒改就一個字不動」——
 * 而那正是把擺法變成資料之後唯一該由機器守的東西。
 */
describe('開局擺法（entry.ts 的表）', () => {
  /**
   * 一隊的**分隊長機**，用來與 `SideEntry` 逐欄對照。
   *
   * 【為什麼讀長機而不是全隊的中位數】`entryRange` 與 `lateralOffset` 定義
   * 在**分隊原點**上，不是重心 —— `BattleConfig.entryRange` 的註解寫得很
   * 清楚：站位偏置的 `along` 全是負的（僚機在後方），平均 −90 m，而「後方」
   * 對兩隊是反向的，所以重心比分隊原點多拉開 180 m。橫向同理，站位的
   * 累積橫向量讓中位數多偏 250 m。
   *
   * 長機在 `STATION_REFERENCE[0] < 0` 的位置 —— 也就是分隊原點本身。
   * 讀它，量到的才是這張表寫的那個數字。
   */
  function read(cs: readonly { aircraft: { state: { position: Vector3, velocity: Vector3 } } }[]) {
    const a = cs[0]!.aircraft.state
    return {
      z: a.position.z, x: a.position.x, y: a.position.y,
      vz: a.velocity.z, speed: a.velocity.length(),
    }
  }

  /** 架數相同時兩隊的分隊數、高度鋸齒、站位都逐項對稱，差值才乾淨 */
  function even(entry: EntryPlan) {
    return createBattle(new ScriptedController(), {
      ...DEFAULT_BATTLE, units: lineAbreast(entry, P51D, 4, BF109K4, 4),
    })
  }

  it('DEFAULT_BATTLE 用的是對頭 —— 全部既有護欄都建立在它上面', () => {
    // 【編組表版本】擺法現在住在每個小隊上。斷言的意思一個字沒變：
    // 藍隊那些小隊拿的是 HEAD_ON.blue、紅隊拿的是 HEAD_ON.red
    const u = DEFAULT_BATTLE.units
    expect(u.find((f) => f.team === 'blue')!.entry).toBe(HEAD_ON.blue)
    expect(u.find((f) => f.team === 'red')!.entry).toBe(HEAD_ON.red)
    expect(HEAD_ON.id).toBe('headOn')
  })

  it('表上的每一份都有 id，而且與鍵一致', () => {
    for (const [key, plan] of Object.entries(ENTRY_PLANS)) {
      expect(plan.id, key).toBe(key)
    }
  })

  describe('對頭', () => {
    it('沿 Z 的間距就是 entryRange，兩隊對稱於原點', () => {
      const r = read(even(HEAD_ON).blue)
      const b = read(even(HEAD_ON).red)
      expect(r.z - b.z).toBeCloseTo(DEFAULT_BATTLE.entryRange, 6)
      expect(r.z + b.z).toBeCloseTo(0, 6)
    })

    it('橫向錯開就是 lateralOffset，兩隊對稱於原點', () => {
      const w = even(HEAD_ON)
      const bl = read(w.blue)
      const rd = read(w.red)
      expect(rd.x - bl.x).toBeCloseTo(DEFAULT_BATTLE.lateralOffset, 6)
      expect(rd.x + bl.x).toBeCloseTo(0, 6)
    })

    it('兩隊對飛：藍朝 −Z、紅朝 +Z', () => {
      const w = even(HEAD_ON)
      expect(read(w.blue).vz).toBeLessThan(0)
      expect(read(w.red).vz).toBeGreaterThan(0)
    })

    it('同高、同速', () => {
      const w = even(HEAD_ON)
      expect(read(w.red).y - read(w.blue).y).toBeCloseTo(0, 6)
      expect(read(w.red).speed).toBeCloseTo(DEFAULT_BATTLE.tas, 3)
      expect(read(w.blue).speed).toBeCloseTo(DEFAULT_BATTLE.tas, 3)
    })
  })

  describe('追擊', () => {
    it('藍隊的出生點與對頭時完全相同 —— 撤離的時限是照那個位置量的', () => {
      expect(read(even(PURSUIT).blue).z).toBeCloseTo(read(even(HEAD_ON).blue).z, 6)
    })

    it('紅隊在藍隊後方，間距就是表上的 gap', () => {
      const w = even(PURSUIT)
      expect(read(w.red).z - read(w.blue).z).toBeCloseTo(PURSUIT.red.gap, 6)
    })

    it('紅隊比藍隊高，高度差就是表上的 climb', () => {
      const w = even(PURSUIT)
      const bl = w.blue.map((c) => c.aircraft.state.position.y)
      const rd = w.red.map((c) => c.aircraft.state.position.y)
      for (let i = 0; i < bl.length; i++) {
        expect(rd[i]! - bl[i]!, `第 ${i} 架`).toBeCloseTo(PURSUIT.red.climb, 6)
      }
    })

    it('兩隊同向 —— 不同向的話那不是追擊，是又一次對頭', () => {
      const w = even(PURSUIT)
      for (const c of [...w.blue, ...w.red]) {
        expect(c.aircraft.state.velocity.z, `座位 #${c.index}`).toBeLessThan(0)
      }
    })

    /**
     * 【橫向要歸零】`lateralOffset` 是為了解**對頭**的匯聚問題。追擊沒有
     * 對頭，而 1,500 m 的橫向錯開會把「後方 800 m」變成「側後方 62°」——
     * 那不是被咬，是並排飛。
     */
    it('橫向不錯開 —— 追兵在正後方而不是側後方', () => {
      const w = even(PURSUIT)
      expect(read(w.red).x - read(w.blue).x).toBeCloseTo(0, 6)
    })

    /**
     * 【為什麼比長機而不是比極值】「最低的紅高於最高的藍」在 `climb = 1000`
     * 時成立，但那**是巧合不是設計** —— 高度散布是 ±`altitudeSpread`（300），
     * 所以 `climb` 一旦被調到 300 以下，那樣寫就會因為「調參數」而不是
     * 「壞掉」變紅。
     *
     * 真正的不變量是：**`climb` 有沒有被套上去，與兩隊各有幾個分隊無關。**
     * 分隊長機在分隊原點上，比它才量得到這件事。
     */
    it('4v16 的實戰編制下，長機的高度差仍然是表上的 climb', () => {
      const w = createBattle(new ScriptedController(), {
        ...DEFAULT_BATTLE, units: lineAbreast(PURSUIT, P51D, 4, BF109K4, 16),
      })
      expect(read(w.red).y - read(w.blue).y).toBeCloseTo(PURSUIT.red.climb, 6)
    })
  })
})
