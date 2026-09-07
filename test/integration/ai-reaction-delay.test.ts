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

/**
 * 【「VETERAN 打不贏 ACE」不在這裡】那是 24 場對決的**勝負與平均長度**，
 * 也就是這顆旋鈕調出來的手感 —— 判它合不合理是試飛的事，不是護欄。
 * 量它的是 `test/tools/fire-delay.probe.ts`，那支沿用同一組開局，
 * 連扣扳機步數與每秒傷害一起印。
 *
 * 這顆旋鈕的**機制**分三處守，各自獨立、各自便宜：
 *
 *   `test/unit/ai-delay.test.ts`        `CommandDelay` 本身的行為
 *   `test/unit/ai-controller.test.ts`   `profile.reactionDelay` 真的走到它
 *   本檔下面那一條                       延遲之後安全層仍然攔得住撞地
 */
describe('反應延遲 —— 出貨設定', () => {
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
