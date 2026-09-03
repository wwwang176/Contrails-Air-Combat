import { describe, it, expect } from 'vitest'
import { CommandDelay, MAX_REACTION_DELAY } from '../../src/ai/delay'
import { createCommand, type Command } from '../../src/control/Controller'

const DT = 1 / 240

/**
 * 把序號 `k` 蓋在指令的每一個欄位上，讓輸出可以反查是第幾步的輸入。
 *
 * 【為什麼用整數】緩衝區存的是 `Float32Array`，只有整數與 2 的冪次的分數
 * 才能位元等價地存回來。用 `k / 100` 這種值會在斷言裡多出捨入誤差，那是
 * 測試自己製造的問題，不是被測物的。
 *
 * 【`firing` 也蓋，但不參與 `step` 的反查】它不走緩衝區，所以它的值指的
 * 永遠是**這一步**，不是被延遲的那一步。專屬的斷言在「開火不參與延遲」。
 */
function mark(cmd: Command, k: number): void {
  cmd.aimWorld.set(k, k + 0.5, k + 0.25)
  cmd.throttle = k
  cmd.brake = k * 0.5
  cmd.firing = k % 2 === 0
}

/** 反查輸出來自第幾步。走緩衝區的三個欄位必須指向同一步，否則回 NaN */
function step(cmd: Command): number {
  const k = cmd.aimWorld.x
  if (cmd.aimWorld.y !== k + 0.5) return NaN
  if (cmd.aimWorld.z !== k + 0.25) return NaN
  if (cmd.throttle !== k) return NaN
  if (cmd.brake !== k * 0.5) return NaN
  return k
}

describe('CommandDelay', () => {
  it('零延遲是位元等價的無作用', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    // 非整數也要位元等價 —— 零延遲時不該碰到 Float32Array
    input.aimWorld.set(0.1, -0.7, 0.30000000000000004)
    input.throttle = 1.1
    input.brake = 0.3333333333333333
    input.firing = true

    d.push(input, 0, DT, out)

    expect(out.aimWorld.x).toBe(input.aimWorld.x)
    expect(out.aimWorld.y).toBe(input.aimWorld.y)
    expect(out.aimWorld.z).toBe(input.aimWorld.z)
    expect(out.throttle).toBe(input.throttle)
    expect(out.brake).toBe(input.brake)
    expect(out.firing).toBe(input.firing)
  })

  it('延遲 n 步之後，輸出是 n 步之前的輸入', () => {
    const n = 5
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    const seen: number[] = []
    for (let k = 0; k < 20; k++) {
      mark(input, k)
      d.push(input, n * DT, DT, out)
      seen.push(step(out))
    }
    // 前 n 步還沒有那麼舊的輸入，讀到的是開場填進去的第 0 步
    expect(seen).toEqual([0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
  })

  /**
   * 【省略第六個參數 = 舊行為】`fireSeconds` 預設等於 `delaySeconds`，
   * 所以既有呼叫端（與這一支以外的全部測試）看到的仍然是四個欄位一起延遲。
   */
  it('省略扳機延遲時，開火跟著瞄準一起延遲', () => {
    const n = 5
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    const fired: boolean[] = []
    for (let k = 0; k < 12; k++) {
      mark(input, k)
      d.push(input, n * DT, DT, out)
      fired.push(out.firing)
    }
    // 輸入是 `k % 2 === 0`；落後 5 步之後奇偶翻面，前 5 步讀開場填的第 0 步
    expect(fired).toEqual([true, true, true, true, true, true,
      false, true, false, true, false, true])
  })

  /**
   * 【扳機走自己的那一格】瞄準落後 n 步、扳機落後 m 步，同一次呼叫。
   *
   * 反過來說：把 `out.firing` 改回讀 `r`（瞄準那一格），這一條會紅，
   * 而上面那條「延遲 n 步」仍然全綠 —— 兩者守的不是同一件事。
   */
  it('扳機的延遲與瞄準各自獨立', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    const aimStep: number[] = []
    const fired: boolean[] = []
    for (let k = 0; k < 12; k++) {
      mark(input, k)
      d.push(input, 5 * DT, DT, out, 0, 2 * DT)
      aimStep.push(step(out))
      fired.push(out.firing)
    }
    // 瞄準落後 5 步
    expect(aimStep).toEqual([0, 0, 0, 0, 0, 0, 1, 2, 3, 4, 5, 6])
    // 扳機只落後 2 步 —— 前兩步讀開場填的第 0 步（true），之後是 (k−2) 的奇偶
    expect(fired).toEqual([true, true, true, false, true, false,
      true, false, true, false, true, false])
  })

  it('扳機延遲為 0 時是直通，瞄準照樣延遲', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    const fired: boolean[] = []
    for (let k = 0; k < 8; k++) {
      mark(input, k)
      d.push(input, 5 * DT, DT, out, 0, 0)
      fired.push(out.firing)
    }
    expect(fired).toEqual([true, false, true, false, true, false, true, false])
  })

  it('扳機延遲在 trim 補償開著的時候也照走自己那一格', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    for (let k = 0; k < 8; k++) {
      mark(input, k)
      input.firing = k === 7
      d.push(input, 0.3, DT, out, 1, 0)
      expect(out.firing, `第 ${k} 步`).toBe(k === 7)
    }
  })

  it('開場先把緩衝區填滿，不會吐出零向量', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    mark(input, 7)
    d.push(input, 0.3, DT, out)
    expect(step(out)).toBe(7)
  })

  it('超過上限的延遲被夾住，不會讀出界', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    // 一小時的延遲。夾不住的話 index 會變成負的或超出槽數
    const absurd = 3600
    const seen: number[] = []
    for (let k = 0; k < 400; k++) {
      mark(input, k)
      d.push(input, absurd, DT, out)
      seen.push(step(out))
    }
    // 夾住之後仍然是一個「合法的、單調不減的、落後的」序列
    expect(seen.every((v) => Number.isFinite(v))).toBe(true)
    expect(seen[0]).toBe(0)
    for (let k = 1; k < seen.length; k++) {
      expect(seen[k]!).toBeGreaterThanOrEqual(seen[k - 1]!)
      expect(seen[k]!).toBeLessThanOrEqual(k)
    }
    // 上限是 MAX_REACTION_DELAY，所以最後一步落後的量不會超過它
    const lag = 399 - seen[399]!
    expect(lag).toBeLessThanOrEqual(Math.round(MAX_REACTION_DELAY / DT))
  })

  it('關掉延遲再打開，重新填滿，不吐出陳舊指令', () => {
    const d = new CommandDelay()
    const input = createCommand()
    const out = createCommand()
    for (let k = 0; k < 30; k++) {
      mark(input, k)
      d.push(input, 5 * DT, DT, out)
    }
    // 關掉：直通
    mark(input, 100)
    d.push(input, 0, DT, out)
    expect(step(out)).toBe(100)
    // 再打開：讀到的必須是當下這一步，不是關掉之前留在槽裡的 20 幾
    mark(input, 200)
    d.push(input, 5 * DT, DT, out)
    expect(step(out)).toBe(200)
  })
})
