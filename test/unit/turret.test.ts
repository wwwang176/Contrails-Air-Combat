import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  inArc, wobbleBasis, wobblePhase, applyWobble, slew,
  BASIS_PARALLEL, GOLDEN, MAX_TURRETS, BARREL_LENGTH, TURRET_MOUNT_REACH,
} from '../../src/weapons/turret'
import type { Turret } from '../../src/weapons/turret'
import { M2_BROWNING } from '../../src/weapons/p51d'

const DEG = Math.PI / 180

const TAIL: Turret = {
  id: 'test-tail',
  weapon: M2_BROWNING,
  position: new Vector3(0, 1, 16.4),
  axis: new Vector3(0, 0, 1),
  halfAngle: 30 * DEG,
  rotationRate: 90 * DEG,
  guns: 2,
}

describe('射界錐', () => {
  it('偏 29° 在錐內、偏 31° 在錐外、30° 邊界算內', () => {
    const at = (d: number): Vector3 =>
      new Vector3(0, Math.sin(d * DEG), Math.cos(d * DEG))
    expect(inArc(TAIL, at(29))).toBe(true)
    expect(inArc(TAIL, at(30))).toBe(true)
    expect(inArc(TAIL, at(31))).toBe(false)
  })

  it('正後方（與中心相反）在錐外', () => {
    expect(inArc(TAIL, new Vector3(0, 0, -1))).toBe(false)
  })
})

describe('搖晃基底', () => {
  const e1 = new Vector3()
  const e2 = new Vector3()

  it('兩軸與 aim 互相垂直且都是單位長', () => {
    const aim = new Vector3(0.3, 0.2, -0.9).normalize()
    wobbleBasis(aim, e1, e2)
    expect(e1.length()).toBeCloseTo(1, 10)
    expect(e2.length()).toBeCloseTo(1, 10)
    expect(e1.dot(aim)).toBeCloseTo(0, 10)
    expect(e2.dot(aim)).toBeCloseTo(0, 10)
    expect(e1.dot(e2)).toBeCloseTo(0, 10)
  })

  /**
   * 【為什麼要測門檻兩側】aim 指向正上方時 `aim × (0,1,0)` 是零向量，
   * normalize 之後整條彈流變成 NaN 而且不會有任何錯誤 —— Sperry 上部砲塔
   * 的中心方向就是正上方。只測「不是 NaN」不夠：壞實作若在門檻兩側都走
   * 備援分支，正常方向的基底就會是錯的，而測試看不出來。
   */
  it('門檻兩側都給出有效且垂直的基底', () => {
    const inside = new Vector3(Math.sqrt(1 - 0.985 ** 2), 0.985, 0).normalize()
    const outside = new Vector3(Math.sqrt(1 - 0.995 ** 2), 0.995, 0).normalize()
    expect(Math.abs(inside.y)).toBeLessThan(BASIS_PARALLEL)
    expect(Math.abs(outside.y)).toBeGreaterThan(BASIS_PARALLEL)
    for (const aim of [inside, outside, new Vector3(0, 1, 0), new Vector3(0, -1, 0)]) {
      wobbleBasis(aim, e1, e2)
      expect(Number.isFinite(e1.x + e1.y + e1.z), `${aim.toArray().join()}`).toBe(true)
      expect(e1.length()).toBeCloseTo(1, 10)
      expect(e2.length()).toBeCloseTo(1, 10)
      expect(e1.dot(aim)).toBeCloseTo(0, 10)
      expect(e2.dot(aim)).toBeCloseTo(0, 10)
    }
  })
})

describe('搖晃相位', () => {
  it('同一架的各座互不相同', () => {
    const phases = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => wobblePhase(3, i))
    expect(new Set(phases.map((p) => p.toFixed(6))).size).toBe(8)
  })

  it('相鄰兩架的同一座也不同 —— 編隊不會同步擺動', () => {
    expect(Math.abs(wobblePhase(3, 0) - wobblePhase(4, 0))).toBeGreaterThan(1e-3)
  })

  it('落在 [0, 2π)', () => {
    for (let k = 0; k < 200; k++) {
      const p = wobblePhase(k, k % 8)
      expect(p).toBeGreaterThanOrEqual(0)
      expect(p).toBeLessThan(Math.PI * 2)
    }
  })

  /**
   * 【混編機種不得有兩座同相位】Codex 2026-08-21 抓到的真缺陷：stride 用
   * 「這台有幾座」的話，砲塔數不同的兩個機種編號區間會重疊。20 架 B-17G
   * （8 座）加 20 架 He 111（5 座）共 260 座，舊實作只有 200 個唯一相位、
   * **60 對完全同步**。
   *
   * 這一條直接用兩個不同的砲塔數建索引，抓的就是那個。
   */
  it('混編機種（8 座 + 5 座）沒有任何兩座同相位', () => {
    const seen = new Set<string>()
    let total = 0
    for (let c = 0; c < 20; c++) {
      for (let i = 0; i < 8; i++) { seen.add(wobblePhase(c, i).toFixed(12)); total++ }
    }
    for (let c = 20; c < 40; c++) {
      for (let i = 0; i < 5; i++) { seen.add(wobblePhase(c, i).toFixed(12)); total++ }
    }
    expect(total).toBe(260)
    expect(seen.size, `${total} 座只有 ${seen.size} 個唯一相位`).toBe(total)
  })
})

describe('搖晃', () => {
  const e1 = new Vector3()
  const e2 = new Vector3()
  const out = new Vector3()
  const AIM = new Vector3(0, 0, -1)
  const A = 1.0 * DEG
  const W = 2 * Math.PI * 0.7

  it('確定性 —— 同一個 t 與相位逐位元相同', () => {
    const a = applyWobble(AIM, A, W, 0.5, 3.25, e1, e2, out).clone()
    const b = applyWobble(AIM, A, W, 0.5, 3.25, e1, e2, out).clone()
    expect([a.x, a.y, a.z]).toEqual([b.x, b.y, b.z])
  })

  it('偏離的上界恰好是 A√2，而且真的掃到八成以上', () => {
    let worst = 0
    for (let k = 0; k < 20000; k++) {
      applyWobble(AIM, A, W, 0.7, k * 0.003, e1, e2, out)
      worst = Math.max(worst, AIM.angleTo(out))
    }
    expect(worst).toBeLessThanOrEqual(A * Math.SQRT2 * 1.0001)
    expect(worst).toBeGreaterThan(A * 0.8)
  })

  /**
   * 【為什麼要測「多個週期都不重複」】兩個頻率若整除，李薩茹圖形會退化成
   * 一條封閉曲線，目標只要待在曲線之外就永遠打不到 —— 那正是這個設計要
   * 避免的。只比一個週期不夠：頻率比若是 2 或 3，第一個週期看起來也不重複。
   */
  it('連續 12 個基本週期都沒有回到同一點', () => {
    const period = (2 * Math.PI) / W
    const first = applyWobble(AIM, A, W, 0, 0, e1, e2, out).clone()
    for (let n = 1; n <= 12; n++) {
      const later = applyWobble(AIM, A, W, 0, n * period, e1, e2, out)
      expect(first.angleTo(later), `第 ${n} 個週期回到原點了`).toBeGreaterThan(A * 0.05)
    }
  })

  it('回傳的是單位向量', () => {
    applyWobble(AIM, A, W, 1.1, 7.3, e1, e2, out)
    expect(out.length()).toBeCloseTo(1, 10)
  })
})

describe('轉向', () => {
  it('目標在範圍內時一步到位', () => {
    const aim = new Vector3(0, 0, -1)
    const want = new Vector3(0, Math.sin(2 * DEG), -Math.cos(2 * DEG))
    slew(aim, want, 5 * DEG)
    expect(aim.angleTo(want)).toBeCloseTo(0, 6)
  })

  it('目標在範圍外時恰好轉 maxAngle，而且離目標更近', () => {
    const aim = new Vector3(0, 0, -1)
    const start = aim.clone()
    const want = new Vector3(0, Math.sin(40 * DEG), -Math.cos(40 * DEG))
    slew(aim, want, 5 * DEG)
    expect(start.angleTo(aim)).toBeCloseTo(5 * DEG, 6)
    expect(aim.angleTo(want)).toBeLessThan(start.angleTo(want))
  })

  /**
   * 【為什麼要測正反向，而且要測「真的轉了」】aim 與 want 完全相反時外積
   * 是零向量，轉軸 normalize 之後是 NaN。但只斷言「不是 NaN」抓不到壞實作
   * —— 一個「遇到退化就原地不動」的版本也會通過，而那會讓砲塔在目標繞到
   * 正後方時永遠卡住。
   */
  it('目標正好在反方向時仍然轉了 maxAngle', () => {
    const aim = new Vector3(0, 0, -1)
    const start = aim.clone()
    slew(aim, new Vector3(0, 0, 1), 5 * DEG)
    expect(Number.isFinite(aim.x + aim.y + aim.z)).toBe(true)
    expect(aim.length()).toBeCloseTo(1, 10)
    expect(start.angleTo(aim)).toBeCloseTo(5 * DEG, 6)
  })

  it('反覆呼叫之後仍是單位向量', () => {
    const aim = new Vector3(0.1, 0.2, -0.9).normalize()
    for (let k = 0; k < 500; k++) slew(aim, new Vector3(1, 0, 0), 1 * DEG)
    expect(aim.length()).toBeCloseTo(1, 8)
  })
})

describe('常數', () => {
  it('MAX_TURRETS 撐得住 B-17G 的八座', () => {
    expect(MAX_TURRETS).toBeGreaterThanOrEqual(8)
  })

  it('GOLDEN 是黃金比', () => {
    expect(GOLDEN).toBeCloseTo((1 + Math.sqrt(5)) / 2, 9)
  })

  /**
   * 護欄的回走距離**必須**比槍管長：命中盒是簡化的傷害體積，比實際機體小
   * （B-17G 的機身外殼到 z 16.25，而 tail 盒只到 15.30）。兩者相等的話
   * 尾砲塔會被判成「沒接在飛機上」。
   */
  it('TURRET_MOUNT_REACH 比 BARREL_LENGTH 長', () => {
    expect(TURRET_MOUNT_REACH).toBeGreaterThan(BARREL_LENGTH)
  })
})
