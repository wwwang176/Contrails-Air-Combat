import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { PlayerController } from '../../src/control/PlayerController'
import { AiController } from '../../src/ai/AiController'
import {
  DEFAULT_AI_BURST as AI_BURST, DEFAULT_FIRE, BURST_DUTY_EDGE, BURST_LENGTH_MAX, BURST_LENGTH_MIN, burstDuty,
} from '../../src/ai/fire'
import { burstDraw01, stepRandomBurst, type RandomBurstCycle } from '../../src/weapons/burst'
import { createInputState } from '../../src/input/InputState'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const DT = 1 / 240

/**
 * AI 戰鬥機的扳機點放。**AI 的戰鬥機與轟炸機
 * 的機槍一樣，會有冷卻時間（只是頻率可以高一點）」**，隨後補充「AI 代飛的
 * 時候也要有這個機制，但代飛結束要改回來（人接手的時候不需要冷卻）」。
 *
 * 【這一支不驗「幾何成立時真的會打」】那是 `shouldFire` 的四條，
 * `test/unit/ai-fire.test.ts` 已經逐條釘住。點放與它是 AND，兩件事分開驗。
 */
describe('AI 戰鬥機的點放', () => {
  const cmd = createCommand()

  /** 一架在平飛、沒有目標的 AI。點放與「有沒有目標」無關 —— 見第二條。 */
  function flying(selfIndex: number): { self: Aircraft, ai: AiController } {
    const self = new Aircraft(BF109K4, 4000, 180)
    self.update(new Vector3(0, 0, -1), 0.7, DT)
    const ai = new AiController()
    ai.selfIndex = selfIndex
    return { self, ai }
  }

  /**
   * 【沒有目標就是最差的瞄準】`shouldFire` 在算得到夾角之前就擋下來時回報
   * 追蹤錐的邊緣，所以工作週期落在低的那一端。留著上一次的好成績的話，
   * 下一次進錐會立刻是高工作週期。
   */
  it('沒有目標時工作週期落在最低的那一端', () => {
    const { self, ai } = flying(0)
    // 【先暖機】`resetBurst` 用設定值排相位，第一段的長度還是設定值
    for (let k = 0; k < Math.round(3 / DT); k++) ai.update(self, DT, cmd)
    // 【取 400 個週期】開火段長度是隨機的，40 個週期的平均還會飄半個百分點
    const steps = Math.round((AI_BURST.on + AI_BURST.off) * 400 / DT)
    let open = 0
    for (let k = 0; k < steps; k++) {
      ai.update(self, DT, cmd)
      if (ai.burstFiring) open++
    }
    expect(open / steps).toBeCloseTo(BURST_DUTY_EDGE, 2)
  })

  it('頻率比砲塔高 —— 週期短、工作週期高', async () => {
    // 【為什麼在這裡對照而不是各自寫死】「只是頻率可以高一點」是一句
    // **相對**的裁定。兩邊各記一個絕對值的話，日後有人調砲塔的節奏，
    // 這個關係會靜靜地反過來而沒有任何測試變紅。
    const t = await import('../../src/weapons/burst')
    expect(AI_BURST.on + AI_BURST.off).toBeLessThan(t.BURST_ON + t.BURST_OFF)
    expect(AI_BURST.on / (AI_BURST.on + AI_BURST.off))
      .toBeGreaterThan(t.BURST_ON / (t.BURST_ON + t.BURST_OFF))
  })

  it('沒有目標的那幾秒時鐘照走 —— 早退路徑也推進', () => {
    // 【為什麼這一條重要】`update` 有三條 `return`（飛站位、飛集合點、
    // 平飛）。只在交戰那條推進的話，每一架都是從「上次脫離時停下來的
    // 地方」繼續，一場打下來錯開的相位就糊成一團。
    const { self, ai } = flying(0)
    const flips = new Set<boolean>()
    for (let k = 0; k < Math.round(3 / DT); k++) {
      ai.update(self, DT, cmd)
      flips.add(ai.burstFiring)
    }
    expect(flips.size).toBe(2)
  })

  it('座位不同的兩架不同相位 —— 整隊不是同一根扳機', () => {
    const a = flying(0)
    const b = flying(1)
    let differ = 0
    const steps = Math.round((AI_BURST.on + AI_BURST.off) * 4 / DT)
    for (let k = 0; k < steps; k++) {
      a.ai.update(a.self, DT, cmd)
      b.ai.update(b.self, DT, cmd)
      if (a.ai.burstFiring !== b.ai.burstFiring) differ++
    }
    // 完全同相位時這個數是 0。門檻取一成，只是要排除「碰巧幾乎同步」
    expect(differ / steps).toBeGreaterThan(0.1)
  })

  it('off = 0 等於沒有這一層 —— 消融旋鈕真的關得掉', () => {
    // 【為什麼要釘住這個】`test/tools/targeting-burst.probe.ts` 的第一列
    // 靠它代表「上線前的行為」。若 `off: 0` 其實沒關乾淨，那一列量到的
    // 就不是基準，而整張消融表的結論會建立在一個錯的對照組上。
    const { self, ai } = flying(3)
    ai.burstConfig = { on: 1, off: 0 }
    for (let k = 0; k < Math.round(5 / DT); k++) {
      ai.update(self, DT, cmd)
      expect(ai.burstFiring).toBe(true)
    }
  })

  it('人接手時完全沒有冷卻 —— 扣著扳機就是一直開火', () => {
    // 【這一條守的是「代飛結束要改回來」】機制住在 `AiController` 上，而
    // 玩家那一架在人接手時掛的是 `PlayerController`（`main.ts` 換的是
    // `player.controller` 這個參考）。所以「改回來」不是一段要維護的程式碼，
    // 是**換了一個控制器**的結果 —— 這一條把那個結果釘住。
    const self = new Aircraft(P51D, 4000, 180)
    self.update(new Vector3(0, 0, -1), 0.7, DT)
    const input = createInputState()
    input.firing = true
    const pc = new PlayerController(input)
    const steps = Math.round((AI_BURST.on + AI_BURST.off) * 3 / DT)
    for (let k = 0; k < steps; k++) {
      pc.update(self, DT, cmd)
      expect(cmd.firing).toBe(true)
    }
  })
})

/**
 * 【錐內也要有層次】3° 的追蹤錐原本是硬門檻：錐內一律同一個工作週期，
 * 錐外完全不開火。瞄得準就該咬住不放，瞄得爛就該點兩下看看 —— 這一條
 * 把「有多準」接到「開多久」。
 */
describe('點放的工作週期跟著瞄準品質走', () => {
  const CONE = DEFAULT_FIRE.trackingCone

  it('完全對準 80% 開火，錐邊緣 20%', () => {
    expect(burstDuty(0, CONE)).toBeCloseTo(0.8, 6)
    expect(burstDuty(CONE, CONE)).toBeCloseTo(0.2, 6)
  })

  it('中間是線性的', () => {
    expect(burstDuty(CONE / 2, CONE)).toBeCloseTo(0.5, 6)
    expect(burstDuty(CONE / 4, CONE)).toBeCloseTo(0.65, 6)
  })

  /** 錐外本來就不開火（`shouldFire` 擋掉），但週期不該變成負的 */
  it('超出錐與負角度都夾住', () => {
    expect(burstDuty(CONE * 3, CONE)).toBeCloseTo(0.2, 6)
    expect(burstDuty(-1, CONE)).toBeCloseTo(0.8, 6)
  })

  /** 【錐為零時不能除以零】消融或壞資料時回最好的那一端，不是 NaN */
  it('錐為零時不炸', () => {
    expect(burstDuty(0.5, 0)).toBeCloseTo(0.8, 6)
    expect(Number.isFinite(burstDuty(0.5, -1))).toBe(true)
  })

  /**
   * 【平均週期不能跟著準度變】準度只改比例，週期的平均固定是 `on + off`。
   * 拿工作週期去乘 `on` 而不是乘整個週期的話，瞄得爛時整個節奏會慢下來 ——
   * 那是另一種行為，而且不會有任何測試變紅。
   */
  it('接線：每一輪的長度隨機，開火與停火照比例切', () => {
    const src = new TextDecoder().decode(readFileSync('src/ai/AiController.ts'))
    expect(src).toContain('const cycle = burst.on + burst.off')
    expect(src).toMatch(/stepRandomBurst\(\s*this, dt, cycle, duty, Math\.max\(this\.selfIndex, 0\), BURST_LENGTH_MIN, BURST_LENGTH_MAX,\s*\)/)
    // 消融旋鈕：off = 0 時工作週期恆為 1，這一層照樣關得掉
    expect(src).toContain('burst.off > 0 ? burstDuty(this.aim.error, DEFAULT_FIRE.trackingCone) : 1')
  })
})

/**
 * 【掃射也要吃點放】戰鬥機掃射船艦與地面目標走的是另一條路徑
 * （`ai/shipAttack.ts`），`strafeGround` 寫完指令就直接 emit —— 原本整個
 * 跳過點放那一關，對準就一路扣著扳機。
 */
describe('掃射的點放接線', () => {
  const src = new TextDecoder().decode(readFileSync('src/ai/AiController.ts'))

  it('對船與對地兩條路徑都乘上點放', () => {
    expect(src.match(/out\.firing = out\.firing && this\.burstOpen/g) ?? []).toHaveLength(2)
  })

  /** 【夾角要回報】沒有它工作週期永遠停在最差那一端，掃射就變成零星點放 */
  it('兩條路徑都把瞄準夾角回報給工作週期', () => {
    expect(src).toContain('groundAttackCommand(this.groundStrafe, self, t, decide, out, this.aim)')
    expect(src).toContain('shipAttackCommand(self, ship, this.shipAim.gun, out, this.shipAim.point, this.aim)')
    const strafe = new TextDecoder().decode(readFileSync('src/ai/shipAttack.ts'))
    expect(strafe.match(/fireWithinCone\(nose\.dot\(lead\), fireAim\)/g) ?? []).toHaveLength(2)
  })
})

/**
 * 【每次扣扳機多久是隨機的】固定週期時正中目標就是「射 0.84 s、停 0.21 s」
 * 一直重複。每次進入開火段時抽一次長度；平均不變，所以長期開火比例不變。
 */
describe('隨機長度的點放', () => {
  function run(duty: number, seconds: number, k = 5): { share: number, bursts: number[], gaps: number[] } {
    const s: RandomBurstCycle = {
      burstFiring: true, burstTimer: 0.5, burstScale: 1, burstDraw: 0, burstLength: 1,
    }
    const cycle = AI_BURST.on + AI_BURST.off
    let open = 0
    const steps = Math.round(seconds / DT)
    const bursts: number[] = []
    const gaps: number[] = []
    let lastDraw = 0
    let off = 0
    for (let i = 0; i < steps; i++) {
      const firing = stepRandomBurst(s, DT, cycle, duty, k, BURST_LENGTH_MIN, BURST_LENGTH_MAX)
      if (firing) {
        open++
        if (off > 0) { gaps.push(off * DT); off = 0 }
      } else off++
      if (s.burstDraw !== lastDraw) { lastDraw = s.burstDraw; bursts.push(s.burstLength) }
    }
    return { share: open / steps, bursts, gaps }
  }

  /**
   * 【停火段不能跟著縮】整輪一起隨機時，抽到短的那一輪停火只剩 0.03 s ——
   * 比機槍兩發之間還短，畫面上就是一直連發。
   */
  it('停火段固定是 週期 ×（1 − 工作週期），不隨開火段變短', () => {
    const cycle = AI_BURST.on + AI_BURST.off
    const { gaps } = run(0.9, 120)
    expect(gaps.length).toBeGreaterThan(50)
    for (const g of gaps) expect(Math.abs(g - cycle * 0.1)).toBeLessThanOrEqual(DT + 1e-9)
  })

  it('長期的開火比例等於工作週期', () => {
    for (const duty of [0.9, 0.5, 0.1]) {
      expect(run(duty, 600).share, `duty ${duty}`).toBeCloseTo(duty, 1)
    }
  })

  it('每次開火段的長度不一樣，落在固定開火段的 BURST_LENGTH_MIN…MAX 倍之間', () => {
    const on = (AI_BURST.on + AI_BURST.off) * 0.9
    const { bursts } = run(0.9, 120)
    expect(bursts.length).toBeGreaterThan(50)
    for (const b of bursts) {
      expect(b).toBeGreaterThanOrEqual(on * BURST_LENGTH_MIN - 1e-9)
      expect(b).toBeLessThanOrEqual(on * BURST_LENGTH_MAX + 1e-9)
    }
    const min = Math.min(...bursts), max = Math.max(...bursts)
    expect(min).toBeLessThan(on * 0.5)
    expect(max).toBeGreaterThan(on * 1.5)
    const mean = bursts.reduce((a, b) => a + b, 0) / bursts.length
    expect(mean / on).toBeGreaterThan(0.85)
    expect(mean / on).toBeLessThan(1.15)
  })

  /** 【確定性】逐位元重播要求同一架、同一輪抽到同一個長度 */
  it('同一架同一輪抽到同一個值；不同架不同', () => {
    expect(burstDraw01(3, 7)).toBe(burstDraw01(3, 7))
    expect(burstDraw01(3, 7)).not.toBe(burstDraw01(4, 7))
    expect(burstDraw01(3, 7)).not.toBe(burstDraw01(3, 8))
  })
})
