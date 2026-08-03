import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  DEFAULT_WINGMAN, LEVEL_COVER, LEVEL_FOCUS, LEVEL_SELF_DEFENCE,
  createWingmanState, selectWingmanTarget,
} from '../../src/ai/wingman'
import { createTargetBoard, type TargetBoard, type TargetCandidate } from '../../src/ai/target'
import { THREAT_RANGE } from '../../src/ai/assess'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'

const DT = 1 / 10

interface Scene { board: TargetBoard; craft: Aircraft[] }

/**
 * 6 架：0..2 藍（0 = 長機、1 = 僚機、2 = 另一架友機）、3..5 紅。
 * 全部平飛朝 −Z，彼此相隔 10 km —— 遠超 THREAT_RANGE，所以初始狀態下
 * 沒有任何人威脅任何人。呼叫端再把要用的那幾架搬過來。
 */
function scene(): Scene {
  const candidates: TargetCandidate[] = []
  const craft: Aircraft[] = []
  for (let i = 0; i < 6; i++) {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(i * 10000, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.state.orientation.identity()
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.identity()
    craft.push(a)
    candidates.push({ index: i, aircraft: a, team: i < 3 ? 'blue' : 'red', alive: true })
  }
  return { board: createTargetBoard(candidates), craft }
}

/** 把 hunter 擺到 prey 正後方 range m 並瞄著他。prey 朝 −Z，正後方是 +Z。 */
function tail(hunter: Aircraft, prey: Aircraft, range: number): void {
  hunter.state.position.copy(prey.state.position).add(new Vector3(0, 0, range))
  hunter.state.velocity.set(0, 0, -200)
  hunter.state.orientation.identity()
  hunter.prevOrientation.identity()
}

describe('四級優先序（M6 spec §7.1）', () => {
  it('第一級：有人咬我 → 打他', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)
    const st = createWingmanState()
    const t = selectWingmanTarget(st, s.board, 1, 0, 0, DT)
    expect(t).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
    expect(s.board.assignments[1]).toBe(3)
  })

  it('自衛優先於掩護 —— 一架咬我、一架咬長機時選咬我的', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)   // 咬僚機自己
    tail(s.craft[4]!, s.craft[0]!, 300)   // 咬長機
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
  })

  it('第二級：沒人咬我、有人咬長機 → 掩護', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
    expect(st.level).toBe(LEVEL_COVER)
  })

  it('同級取威脅值最大的（近的比遠的大）', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[0]!, 700)
    tail(s.craft[4]!, s.craft[0]!, 200)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
  })

  it('第三級：都沒有威脅時跟長機集火', () => {
    const s = scene()
    // 長機的現任目標是紅 5，離長機夠近，但沒瞄著任何人所以不構成威脅
    s.craft[5]!.state.position.copy(s.craft[0]!.state.position).add(new Vector3(400, 0, 0))
    s.board.assignments[0] = 5
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[5])
    expect(st.level).toBe(LEVEL_FOCUS)
  })

  it('第四級：什麼都沒有 → null，而且槽位歸 −1', () => {
    const s = scene()
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
    expect(s.board.assignments[1]).toBe(-1)
  })
})

describe('集火的距離門（M6 spec §7.1）—— 開局編隊的守門員', () => {
  it('長機的目標離長機超過 THREAT_RANGE 時不跟', () => {
    // 【拿掉這一道會怎樣】M5 的 AI 全知，開局 10 km 外長機就已經選定
    // 目標並朝它飛。僚機會跟著撲出去，而 breakRange 擋不住它 —— 目標
    // 大致就在航向上，僚機偏離站位大約 450 m，永遠碰不到 1,200 m 的
    // 放棄門檻。開局那 21 秒的編隊會一路融成一條線。
    const s = scene()
    s.craft[5]!.state.position.copy(s.craft[0]!.state.position)
      .add(new Vector3(THREAT_RANGE + 500, 0, 0))
    s.board.assignments[0] = 5
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
  })

  it('剛好在門檻之內就跟', () => {
    const s = scene()
    s.craft[5]!.state.position.copy(s.craft[0]!.state.position)
      .add(new Vector3(THREAT_RANGE - 50, 0, 0))
    s.board.assignments[0] = 5
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[5])
  })
})

describe('breakRange 遲滯（M6 spec §7.3）', () => {
  it('離站位太遠時放棄掩護，回到門檻內才重新交戰', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()

    // 在站位上 → 交戰
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
    expect(st.engaging).toBe(true)

    // 走到 1,000 m：低於離開門檻 1,200，仍然交戰
    selectWingmanTarget(st, s.board, 1, 0, 1000, DT)
    expect(st.engaging).toBe(true)

    // 超過 1,200 → 放棄
    selectWingmanTarget(st, s.board, 1, 0, 1300, DT)
    expect(st.engaging).toBe(false)

    // 回到 1,000：仍在遲滯帶裡，**不**重新交戰
    selectWingmanTarget(st, s.board, 1, 0, 1000, DT)
    expect(st.engaging).toBe(false)

    // 回到 700（低於進入門檻 800）→ 重新交戰
    selectWingmanTarget(st, s.board, 1, 0, 700, DT)
    expect(st.engaging).toBe(true)
  })

  it('自衛完全不受 breakRange 限制', () => {
    // 有人在打你，這件事跟你離站位多遠無關
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)
    const st = createWingmanState()
    const t = selectWingmanTarget(st, s.board, 1, 0, 5000, DT)
    expect(st.engaging).toBe(false)
    expect(t).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
  })
})

describe('最小停留（M6 spec §7.4）', () => {
  it('同一級之內，停留時間走完之前不換目標', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[0]!, 400)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])

    // 換一架更近的（威脅值更大）湊過來 —— 但停留還沒走完
    tail(s.craft[4]!, s.craft[0]!, 150)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])

    // 走滿停留時間之後才換
    const ticks = Math.ceil(DEFAULT_WINGMAN.minDwell / DT) + 1
    let last: unknown = null
    for (let i = 0; i < ticks; i++) last = selectWingmanTarget(st, s.board, 1, 0, 0, DT)
    expect(last).toBe(s.craft[4])
  })

  it('更緊急的一級可以立刻插隊 —— 掩護中被咬就馬上轉自衛', () => {
    // 【為什麼必須立刻】defend 意圖靠自衛級提供目標，而「有人在打我」
    // 不能等停留走完。與 rules.ts 讓 defend 豁免 minDwell 同一條原則。
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
    expect(st.level).toBe(LEVEL_COVER)

    tail(s.craft[3]!, s.craft[1]!, 300)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])
    expect(st.level).toBe(LEVEL_SELF_DEFENCE)
  })

  it('現任目標退場時立刻重選，繞過停留', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])

    s.board.candidates[3]!.alive = false
    tail(s.craft[4]!, s.craft[0]!, 400)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[4])
  })
})

describe('降級與退場', () => {
  it('參考機陣亡時只剩自衛級', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    s.board.candidates[0]!.alive = false
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()

    tail(s.craft[3]!, s.craft[1]!, 300)
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBe(s.craft[3])
  })

  it('referenceIndex 為 −1（沒有站位）時也只剩自衛級', () => {
    const s = scene()
    tail(s.craft[4]!, s.craft[0]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, -1, 0, DT)).toBeNull()
  })

  it('自己退場時回 null 並把自己的槽位歸 −1', () => {
    const s = scene()
    tail(s.craft[3]!, s.craft[1]!, 300)
    const st = createWingmanState()
    selectWingmanTarget(st, s.board, 1, 0, 0, DT)
    expect(s.board.assignments[1]).toBe(3)

    s.board.candidates[1]!.alive = false
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
    expect(s.board.assignments[1]).toBe(-1)
  })

  it('不會選到友機', () => {
    const s = scene()
    // 把友機 2 擺到會構成「威脅」的位置 —— 同隊過濾必須擋掉它
    tail(s.craft[2]!, s.craft[1]!, 300)
    const st = createWingmanState()
    expect(selectWingmanTarget(st, s.board, 1, 0, 0, DT)).toBeNull()
  })
})
