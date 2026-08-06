import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { ACE, VETERAN } from '../../src/ai/profile'
import { DEFAULT_BATTLE } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { P51D } from '../../src/specs/p51d'
import { DEG } from '../../src/core/math'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

const DT = 1 / 240
const SECONDS = 300

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

/**
 * 這一層守的是**出貨設定**。
 *
 * 【為什麼需要它】`DEFAULT_BATTLE.aiProfile` 是 `ACE` —— 那是刻意的，
 * 因為 `ai-manoeuvre` / `ai-duel-matrix` / `ai-defence` 量的是 AI 的天花板，
 * 讓遊戲的難度設定去移動那些基準會分不清是誰改的。代價是**沒有任何其他
 * 測試碰得到 `VETERAN`**，所以這個檔案是它唯一的守門人。
 */

interface Side {
  altitude: number
  tas: number
  offset: [number, number, number]
  headingDeg: number
}

interface Duel {
  /** 'blue' | 'red' | 'timeout' */
  winner: string
  seconds: number
}

/**
 * 一對一，同機種（P-51D），一邊有反應延遲、另一邊沒有。
 *
 * 【為什麼不用 `createBattle`】它是 20v20 的編隊生成。要量的是「延遲讓
 * 追瞄變差多少」，20v20 的混戰把那件事埋在目標選擇與分攤裡面。
 */
function duel(blue: Side, red: Side, delayed: string): Duel {
  const world = new World()
  const make = (s: Side) => {
    const a = new Aircraft(P51D, s.altitude, s.tas)
    const pos = new Vector3(s.offset[0], s.altitude, s.offset[2])
    const h = s.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(s.tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }
  const b = make(blue)
  const r = make(red)
  const blueAi = new AiController()
  const redAi = new AiController()
  blueAi.profile = delayed === 'blue' ? VETERAN : ACE
  redAi.profile = delayed === 'red' ? VETERAN : ACE
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, blue.tas)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, red.tas)
  blueAi.target = r.a
  redAi.target = b.a
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  const total = SECONDS * 240
  for (let i = 0; i < total; i++) {
    world.step(DT)
    if (bc.hp <= 0 || rc.hp <= 0) {
      return { winner: rc.hp <= 0 ? 'blue' : 'red', seconds: i * DT }
    }
  }
  return { winner: 'timeout', seconds: SECONDS }
}

/**
 * 12 種開局。每一種都跑兩次、把延遲換邊，**因為開局本身不對稱** ——
 * 「藍在後 600」對後方那一架有利，只跑一次量到的是開局不是延遲。
 * 零延遲對照（兩邊都 0）在這一組上剛好 12:12，證明換邊確實抵銷掉了。
 */
const GEOMETRIES: readonly [Side, Side][] = [
  [{ altitude: 4000, tas: 200, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 4000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 220, offset: [0, 0, 3000], headingDeg: 180 }, { altitude: 4000, tas: 220, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [400, 0, 400], headingDeg: 135 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [900, 0, 0], headingDeg: 90 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [0, 0, 600], headingDeg: 0 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }, { altitude: 4000, tas: 190, offset: [0, 0, 600], headingDeg: 0 }],
  [{ altitude: 5000, tas: 200, offset: [0, 0, 1200], headingDeg: 180 }, { altitude: 4000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 200, offset: [0, 0, 1200], headingDeg: 180 }, { altitude: 5000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 250, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 4000, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 4000, tas: 190, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 4000, tas: 250, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 3000, tas: 200, offset: [1200, 0, 600], headingDeg: 45 }, { altitude: 3000, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 6000, tas: 210, offset: [1200, 0, 600], headingDeg: 45 }, { altitude: 6000, tas: 210, offset: [0, 0, 0], headingDeg: 0 }],
]

describe('反應延遲 —— 出貨設定', () => {
  it('VETERAN 打不贏 ACE，而且咬得住殺不掉', () => {
    let aceWin = 0
    let lagWin = 0
    let seconds = 0
    let n = 0
    for (const [blue, red] of GEOMETRIES) {
      for (const delayed of ['blue', 'red'] as const) {
        const o = duel(blue, red, delayed)
        n++
        seconds += o.seconds
        if (o.winner === 'timeout') continue
        if (o.winner === delayed) lagWin++
        else aceWin++
      }
    }
    const mean = seconds / n

    // 實測（`profile.ts` 有完整掃描表）：
    //
    //   零延遲雙方（對照）  12 勝 : 12 勝    平均 65 s
    //   VETERAN vs ACE      14 勝 :  6 勝    平均 133 s（4 場平手）
    //
    // 【門檻取 8 而不是 6】24 場在 p=0.5 的二項標準差就有 2.4 場，門檻貼著
    // 實測值會變成量測雜訊的偵測器。8 仍然遠低於對照組的 12。
    expect(lagWin).toBeLessThanOrEqual(8)

    // 【為什麼還要量戰鬥長度】勝負在 24 場的取樣下區分力有限（見 profile.ts
    // 的掃描表），但**戰鬥被拖長**這件事是單調且大幅的：65 → 133 s。它直接
    // 對應到「延遲讓 AI 咬得住但殺不掉」，也就是這個旋鈕的目的。
    // 100 s 落在對照組（65）與實測（133）之間。
    expect(mean).toBeGreaterThan(100)
  }, 10 * 60 * 1000)

  it('遊戲實際開打的那一局吃得到 VETERAN', () => {
    // 【為什麼釘 `battleConfigFrom` 而不是 `DEFAULT_BATTLE`】前者是遊戲
    // 唯一的入口（`main.ts:326`），後者是測試的基準。兩者刻意不同值。
    expect(battleConfigFrom(DEFAULT_SKIRMISH).aiProfile).toBe(VETERAN)
    expect(DEFAULT_BATTLE.aiProfile).toBe(ACE)
  })

  it('低空纏鬥不會把自己飛進海裡 —— 任何反應延遲都一樣', () => {
    // 這一條同時守兩件事：
    //
    //   1. **安全層排在延遲之後**（延遲 spec §4.2）。撞地保護是反射不是判讀；
    //      一起延遲的話玩家不會覺得敵人變弱，只會覺得敵人會自殺。
    //   2. **撞地保護會前瞻俯衝角**（`DEFAULT_SAFETY.lookahead`）。閉式解假設
    //      γ 不再變陡，而 AI 在檢查通過後還在繼續加深俯衝。
    //
    // 【為什麼掃四個延遲而不是只測出貨值】這個缺陷在 `VETERAN`（0.3 s）下
    // **看不到** —— 只有 0.5 s 那一列會觸海（修補前 644 步）。只測出貨值的
    // 話，這條斷言在壞掉的程式上是綠的。
    //
    // 【為什麼是低空受控場景而不是 20v20】20v20 在 4000 m 開打，120 秒內
    // 沒有任何一架靠近地面（實測全隊最低 2210 m），對這個問題零訊號。
    //
    // 【為什麼判準是「不觸海」而不是一個高度下限】安全層的 `clearance`
    // （120 m）是**觸發時的餘裕**，不是最低高度的保證 —— 觸發之後拉平還要
    // 時間，那段時間高度還在掉。實測全場最低在 46~275 m 之間漂，而且**是
    // 混沌的**（同一場在六個 lookahead 下是 115/54/16/121/106/114，沒有趨勢），
    // 拿它當門檻等於在測雜訊。「不摔死」才是玩家在意的，也是穩定的。
    //
    // 修補前後（五場、120 秒、全場最低高度／觸海步數）：
    //
    //   延遲          0      0.3      0.5      0.8    觸海
    //   lookahead 0  115      63    −0 ✗      275    644 步
    //   lookahead .25 54      74      46      275      0
    for (const delay of [0, 0.3, 0.5, 0.8]) {
      let sea = 0
      for (const [blue, red] of LOW_CASES) sea += lowFight(blue, red, delay).sea
      expect(sea, `反應延遲 ${delay} s`).toBe(0)
    }
  }, 15 * 60 * 1000)
})

/** 五個貼地纏鬥的開局。安全層在這些場景裡幾乎全程都在動。 */
const LOW_CASES: readonly [Side, Side][] = [
  [{ altitude: 600, tas: 200, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 600, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 400, tas: 200, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 400, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 500, tas: 210, offset: [0, 0, 600], headingDeg: 0 }, { altitude: 500, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 700, tas: 200, offset: [1200, 0, 600], headingDeg: 45 }, { altitude: 700, tas: 200, offset: [0, 0, 0], headingDeg: 0 }],
  [{ altitude: 2000, tas: 240, offset: [0, 0, 1500], headingDeg: 180 }, { altitude: 800, tas: 190, offset: [0, 0, 0], headingDeg: 0 }],
]

/**
 * 兩架同樣延遲的 AI 在低空纏鬥 120 秒，回報全程最低高度與觸海步數。
 *
 * 【子彈無傷害】要量的是 AI 會不會把自己開進海裡，不是誰先被打下來。低空
 * 對頭在有傷害時三、四秒就分勝負，那個窗口看不到任何飛行問題。
 */
function lowFight(blue: Side, red: Side, delay: number): { minY: number; sea: number } {
  const world = new World()
  const make = (s: Side) => {
    const a = new Aircraft(BLUNT, s.altitude, s.tas)
    const pos = new Vector3(s.offset[0], s.altitude, s.offset[2])
    const h = s.headingDeg * DEG
    const dir = new Vector3(-Math.sin(h), 0, -Math.cos(h))
    a.state.position.copy(pos)
    a.state.velocity.copy(dir).multiplyScalar(s.tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    return { a, pos }
  }
  const b = make(blue)
  const r = make(red)
  const blueAi = new AiController()
  const redAi = new AiController()
  blueAi.profile = { reactionDelay: delay, aimError: 0 }
  redAi.profile = { reactionDelay: delay, aimError: 0 }
  const bc = world.add(b.a, blueAi, 'blue', b.pos, blue.altitude, blue.tas)
  const rc = world.add(r.a, redAi, 'red', r.pos, red.altitude, red.tas)
  blueAi.target = r.a
  redAi.target = b.a
  bc.respawnOnDestroy = false
  rc.respawnOnDestroy = false

  let minY = Infinity
  let sea = 0
  for (let i = 0; i < 120 * 240; i++) {
    world.step(DT)
    for (const a of [b.a, r.a]) {
      if (a.state.position.y < minY) minY = a.state.position.y
      if (a.state.position.y <= 0) sea++
    }
  }
  return { minY, sea }
}
