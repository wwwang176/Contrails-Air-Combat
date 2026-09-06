import { describe, it, expect, beforeEach } from 'vitest'
import { Vector3, Quaternion } from 'three'
import { Projectiles } from '../../src/world/Projectiles'
import {
  createTurretStates, resetTurretStates, stepTurrets, stepBurst,
  WOBBLE_AMPLITUDE, BURST_ON, BURST_OFF, BURST_SCATTER, FIRE_THRESHOLD,
  SEARCH_INTERVAL,
} from '../../src/world/turrets'
import type { TurretCombatant, TurretState } from '../../src/world/turrets'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { HE111 } from '../../src/specs/he111'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240

function fake(spec: AircraftSpec, index: number, team: 'blue' | 'red',
  pos: Vector3, vel: Vector3): TurretCombatant {
  const aircraft = new Aircraft(spec, 3000, 100)
  aircraft.state.position.copy(pos)
  aircraft.state.velocity.copy(vel)
  aircraft.state.orientation.copy(new Quaternion())
  return {
    index, team, alive: true, hp: spec.hp, aircraft,
    turretStates: createTurretStates(spec, index),
    turretCooldowns: new Float32Array(spec.turrets.length),
  }
}

const bomberAt = (z: number): TurretCombatant =>
  fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3(0, 0, z))
const fighterAt = (z: number, vz: number): TurretCombatant =>
  fake(P51D, 1, 'red', new Vector3(0, 3000, z), new Vector3(0, 0, vz))

const freshState = (): TurretState => ({
  aim: new Vector3(0, 0, 1), phase: 0, targetIndex: -1, targetShip: -1, targetGun: -1,
  searchCooldown: 0, burstFiring: true, burstTimer: BURST_ON, burstScale: 1,
  flash: 0, lastBarrel: 0,
})

describe('點放狀態機', () => {
  /**
   * 【為什麼直接測狀態機而不是數「有子彈的步數」】800 rpm ÷ 240 Hz 表示
   * 即使連續開火也只有約 1/18 = 5.6% 的物理步會生出子彈。用「生彈的步數
   * 佔比」當判準的話，**把點放整個拿掉也會通過** —— 那個測試測不到它宣稱
   * 的東西。
   */
  it('在開火段與停火段之間交替，週期正確', () => {
    const s = freshState()
    let firing = 0
    const steps = Math.round((BURST_ON + BURST_OFF) * 10 / DT)
    for (let k = 0; k < steps; k++) if (stepBurst(s, DT)) firing++
    const duty = firing / steps
    expect(duty).toBeCloseTo(BURST_ON / (BURST_ON + BURST_OFF), 2)
  })

  it('大步長也不會卡住 —— 一步跨過好幾個週期', () => {
    const s = freshState()
    // 一步 10 秒，遠大於 BURST_ON + BURST_OFF
    for (let k = 0; k < 20; k++) stepBurst(s, 10)
    expect(s.burstTimer).toBeGreaterThan(0)
    expect(Number.isFinite(s.burstTimer)).toBe(true)
  })

  /**
   * 【這一條守的是火力平衡，不是節奏】週期倍率同時乘開火段與停火段，
   * 所以不管倍率是多少，每一座仍然是同樣比例的時間在開火 —— 錯開節奏
   * **不可以順便改動火力總量**（那是另一個決定，見 `TURRET_DAMAGE_SCALE`）。
   * 只乘其中一段的話這一條會紅。
   */
  it('週期倍率不改工作週期 —— 火力總量不受錯開影響', () => {
    for (const scale of [1 - BURST_SCATTER, 1, 1 + BURST_SCATTER]) {
      const s = freshState()
      s.burstScale = scale
      s.burstTimer = BURST_ON * scale
      let firing = 0
      const steps = Math.round((BURST_ON + BURST_OFF) * scale * 40 / DT)
      for (let k = 0; k < steps; k++) if (stepBurst(s, DT)) firing++
      expect(firing / steps).toBeCloseTo(BURST_ON / (BURST_ON + BURST_OFF), 2)
    }
  })
})

/**
 * 人工回報：「開火時間、冷卻時間都一樣」。改之前實測是**完全
 * 同步** —— 260 座砲塔每一步不是全開就是全關。
 */
describe('點放的錯開', () => {
  it('同一架的八座，開火段的起點各不相同', () => {
    const states = createTurretStates(B17G, 0)
    const starts = new Set(states.map((s) => s.burstTimer.toFixed(6)))
    expect(states.length).toBe(8)
    expect(starts.size).toBe(8)
  })

  it('同一架的八座，週期各不相同 —— 相對關係不會凍結', () => {
    const states = createTurretStates(B17G, 0)
    const scales = new Set(states.map((s) => s.burstScale.toFixed(6)))
    expect(scales.size).toBe(8)
  })

  /**
   * 【判準刻意是「嚴格介於 0 與全部之間」，沒有可調的門檻】改之前這一條
   * 是 100% 違反（每一步都是 0 或 260），不是「差一點」。用標準差當門檻就
   * 會多一個要有人裁定的數字。
   *
   * 混編是必要的：`MAX_TURRETS` 當 stride 的理由就是不同砲塔數的機種不能
   * 撞號（見 `wobblePhase` 的註解）。
   */
  it('混編機隊不會出現「全部一起開火」或「全部一起停火」的一步', () => {
    const all: TurretState[] = []
    let index = 0
    for (let k = 0; k < 8; k++) all.push(...createTurretStates(B17G, index++))
    for (let k = 0; k < 8; k++) all.push(...createTurretStates(HE111, index++))
    const N = all.length
    for (let k = 0; k < Math.round(30 / DT); k++) {
      let on = 0
      for (const s of all) if (stepBurst(s, DT)) on++
      expect(on).toBeGreaterThan(0)
      expect(on).toBeLessThan(N)
    }
  })
})

describe('stepTurrets', () => {
  let projectiles: Projectiles
  beforeEach(() => { projectiles = new Projectiles(4000) })

  const run = (b: TurretCombatant, all: TurretCombatant[], steps: number): void => {
    for (let k = 0; k < steps; k++) stepTurrets(b, all, projectiles, k * DT, DT)
  }

  it('沒有敵人時不開火', () => {
    const b = bomberAt(-100)
    run(b, [b], 480)
    expect(projectiles.live).toBe(0)
  })

  it('敵人在尾後、射界內、射程內 —— 會開火', () => {
    const b = bomberAt(-100)
    const f = fighterAt(300, -150)
    run(b, [b, f], 480)
    expect(projectiles.live).toBeGreaterThan(0)
  })

  it('敵人在正前方時尾砲塔沒有目標', () => {
    const b = bomberAt(-100)
    const f = fighterAt(-300, -150)
    const tail = B17G.turrets.findIndex((t) => t.id === 'tail')
    run(b, [b, f], 480)
    expect(b.turretStates[tail]!.targetIndex).toBe(-1)
  })

  it('太遠（攔截時間超過彈丸壽命）不開火', () => {
    const b = bomberAt(-100)
    const f = fighterAt(5000, -150)
    run(b, [b, f], 480)
    expect(projectiles.live).toBe(0)
  })

  it('打爆的載機不再開火', () => {
    const b = bomberAt(-100)
    const f = fighterAt(300, -150)
    b.hp = 0
    run(b, [b, f], 480)
    expect(projectiles.live).toBe(0)
  })

  it('同隊的不會被當成目標', () => {
    const b = bomberAt(-100)
    const mate = fake(P51D, 1, 'blue', new Vector3(0, 3000, 300), new Vector3(0, 0, -150))
    run(b, [b, mate], 480)
    expect(projectiles.live).toBe(0)
  })

  /**
   * 【真正的換目標測試】只斷言常數大於零的話，完全不使用那個常數的實作也
   * 會通過。這裡讓兩個敵機中途交換遠近，斷言冷卻期間不換、到期才換。
   */
  it('換目標有冷卻 —— 冷卻內不換，到期才換', () => {
    const b = bomberAt(0)
    const near = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    const far = fake(P51D, 2, 'red', new Vector3(0, 3000, 600), new Vector3())
    const all = [b, near, far]
    const tail = B17G.turrets.findIndex((t) => t.id === 'tail')
    // 【要先跑過初始錯開】searchCooldown 的初值是黃金比攤出來的非零值，
    // 第一步不會搜尋。直接在第一步斷言 targetIndex 會必紅。跑滿一個
    // SEARCH_INTERVAL 保證至少搜過一次。
    const warm = Math.ceil(SEARCH_INTERVAL / DT) + 1
    for (let k = 0; k < warm; k++) stepTurrets(b, all, projectiles, k * DT, DT)
    expect(b.turretStates[tail]!.targetIndex).toBe(1)
    // 把原本近的挪遠、原本遠的挪近
    near.aircraft.state.position.z = 900
    far.aircraft.state.position.z = 250
    /**
     * 【時序要讀實際的 cooldown，不能用固定比例】warm-up 之後距離下一次
     * 搜尋還剩多少取決於初始錯開（黃金比攤出來的值，每一座不同）。用
     * 「再跑 0.4 × SEARCH_INTERVAL」這種固定比例會**剛好跨過**下一次搜尋，
     * 斷言「還沒換」就必紅。
     */
    const remain = b.turretStates[tail]!.searchCooldown
    expect(remain).toBeGreaterThan(0)
    // 冷卻期間內（剩餘時間的一半）：不換
    const half = warm + Math.floor((remain * 0.5) / DT)
    for (let k = warm; k < half; k++) stepTurrets(b, all, projectiles, k * DT, DT)
    expect(b.turretStates[tail]!.targetIndex).toBe(1)
    // 跑完剩餘時間再多一點：換成 2
    const past = warm + Math.ceil((remain + SEARCH_INTERVAL * 0.1) / DT)
    for (let k = half; k < past; k++) stepTurrets(b, all, projectiles, k * DT, DT)
    expect(b.turretStates[tail]!.targetIndex).toBe(2)
  })

  /**
   * 【為什麼要測「沒有目標時也不能每步全掃」】搜尋是 O(架數)，而 20 架
   * B-17 × 8 座砲塔 × 40 個候選 = 每步 6,400 次 solveLead。若節流條件寫成
   * 「有目標才節流」，**找不到目標時每一步都重掃** —— 而那正是最常見的
   * 開局狀態。
   */
  it('沒有目標時搜尋也受冷卻節流 —— 數搜尋次數，不是看 cooldown 有沒有變小', () => {
    const b = bomberAt(-100)
    const far = fighterAt(9000, -150)   // 永遠搜不到
    const all = [b, far]
    const tail = B17G.turrets.findIndex((t) => t.id === 'tail')
    /**
     * 【為什麼要數次數】只斷言「cooldown 變小了」的話，一個「每步照樣全掃、
     * 順便也把 cooldown 遞減」的壞實作也會通過。搜尋發生的唯一外顯是
     * `searchCooldown` **變大**（`+= SEARCH_INTERVAL`），所以數變大的次數
     * 就是數搜尋次數，不必在正式碼裡加計數器。
     */
    let searches = 0
    let prev = b.turretStates[tail]!.searchCooldown
    const seconds = 10
    for (let k = 0; k < seconds / DT; k++) {
      stepTurrets(b, all, projectiles, k * DT, DT)
      const now = b.turretStates[tail]!.searchCooldown
      if (now > prev) searches++
      prev = now
    }
    // 10 秒、間隔 1 秒 ⇒ 9 或 10 次（看初始錯開落在哪）。**不是 2400 次**
    expect(searches).toBeGreaterThanOrEqual(seconds - 2)
    expect(searches).toBeLessThanOrEqual(seconds + 1)
  })

  it('射出去的方向偏離正後方不超過搖晃上界 + 開火門檻', () => {
    const b = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3())
    const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    run(b, [b, f], 960)
    const straight = new Vector3(0, 0, 1)
    const v = new Vector3()
    let worst = 0
    for (let i = 0; i < projectiles.capacity; i++) {
      if (projectiles.owner[i] !== 0) continue
      v.set(projectiles.vx[i]!, projectiles.vy[i]!, projectiles.vz[i]!).normalize()
      worst = Math.max(worst, straight.angleTo(v))
    }
    expect(worst).toBeGreaterThan(0)
    expect(worst).toBeLessThan(WOBBLE_AMPLITUDE * Math.SQRT2 + FIRE_THRESHOLD + 1e-6)
  })

  it('確定性 —— 同樣的輸入跑兩次，彈丸速度逐位元相同', () => {
    const once = (): number[] => {
      const p = new Projectiles(4000)
      const b = bomberAt(-100)
      const f = fighterAt(300, -150)
      for (let k = 0; k < 960; k++) stepTurrets(b, [b, f], p, k * DT, DT)
      const out: number[] = []
      for (let i = 0; i < p.capacity; i++) {
        if (p.owner[i] === 0) out.push(p.vx[i]!, p.vy[i]!, p.vz[i]!)
      }
      return out
    }
    expect(once()).toEqual(once())
  })

  it('resetTurretStates 就地重設，不換陣列參考', () => {
    const b = bomberAt(-100)
    const f = fighterAt(300, -150)
    run(b, [b, f], 480)
    const before = b.turretStates
    const firstAim = b.turretStates[0]!.aim
    resetTurretStates(b.turretStates, B17G, 0)
    expect(b.turretStates).toBe(before)
    expect(b.turretStates[0]!.aim).toBe(firstAim)
    expect(b.turretStates[0]!.aim.equals(B17G.turrets[0]!.axis)).toBe(true)
    expect(b.turretStates[0]!.targetIndex).toBe(-1)
    expect(b.turretStates[0]!.flash).toBe(0)
  })

  it('槍焰計時器在開火時被設起來', () => {
    const b = bomberAt(0)
    const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    let sawFlash = false
    for (let k = 0; k < 480; k++) {
      stepTurrets(b, [b, f], projectiles, k * DT, DT)
      if (b.turretStates.some((s) => s.flash > 0)) sawFlash = true
    }
    expect(sawFlash).toBe(true)
  })

  /**
   * 雙聯砲塔的兩根管口輪流出彈 —— 仍然只有一道彈流，但每一發都從某一根
   * 真的管口出來。缺陷情境：彈丸全部從砲塔中心生，而畫面上有兩根管子，
   * 於是彈流從兩根管子**中間**冒出來。
   */
  it('雙聯砲塔的彈丸左右輪替', () => {
    const b = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3())
    const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    run(b, [b, f], 960)
    const xs = new Set<string>()
    for (let i = 0; i < projectiles.capacity; i++) {
      if (projectiles.owner[i] !== 0) continue
      xs.add(projectiles.sx[i]!.toFixed(3))
    }
    // 尾砲塔是雙聯，所以至少有兩個不同的生成 x
    expect(xs.size).toBeGreaterThanOrEqual(2)
  })

  it('lastBarrel 記的是剛剛發射的那一根 —— 槍焰要畫在那裡', () => {
    const b = fake(B17G, 0, 'blue', new Vector3(0, 3000, 0), new Vector3())
    const f = fake(P51D, 1, 'red', new Vector3(0, 3000, 300), new Vector3())
    const tail = B17G.turrets.findIndex((t) => t.id === 'tail')
    const seen = new Set<number>()
    for (let k = 0; k < 960; k++) {
      const before = projectiles.live
      stepTurrets(b, [b, f], projectiles, k * DT, DT)
      if (projectiles.live > before) seen.add(b.turretStates[tail]!.lastBarrel)
    }
    // 雙聯：兩根都用過
    expect(seen.size).toBe(2)
  })
})
