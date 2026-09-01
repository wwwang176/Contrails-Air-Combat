import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World, FLASH_SECONDS, SEA_KILL_Y, SEA_SURFACE_Y } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { clearImpacts } from '../../src/world/events'
import { boundingRadius } from '../../src/world/hit'
import { CRASH_CLEARANCE } from '../../src/aircraft/crash'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'

const DT = 1 / 240

/** 固定指令的假控制器 —— 讓測試完全掌控扳機與瞄準。 */
class Fixed implements Controller {
  constructor(public aim = new Vector3(0, 0, -1), public throttle = 0.7, public firing = false) {}
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.copy(this.aim)
    out.throttle = this.throttle
    out.firing = this.firing
  }
}

/** 把飛機釘回指定位置，速度可指定（預設靜止）。 */
function pin(a: Aircraft, x: number, y: number, z: number, vz = 0): void {
  a.state.position.set(x, y, z)
  a.prevPosition.copy(a.state.position)
  a.state.velocity.set(0, 0, vz)
}

describe('World 的組裝', () => {
  it('add 回傳的 Combatant 帶滿血與遞增索引', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109K4), new Fixed(), 'red', new Vector3(0, 0, -800))
    expect(a.index).toBe(0)
    expect(b.index).toBe(1)
    // 【對各自的 spec.hp，不要寫死 1000】2026-09-01 起血量正比於質量，
    // 戰鬥機不再一律 1000（P-51D 1000、K-4 760、F6F-5 1270）。這一條守的是
    // 「新加入的人是滿血」，不是那個數字本身。
    expect(a.hp).toBe(P51D.hp)
    expect(b.hp).toBe(BF109K4.hp)
    expect(w.combatants).toHaveLength(2)
  })

  it('射速時鐘的長度等於掛架數', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    expect(a.cooldowns).toHaveLength(P51D.battery.mounts.length)
  })

  it('setSpec 換裝時重配射速時鐘（掛架數不同）', () => {
    // 【為什麼這條非有不可】P-51 六個掛架、109 三個。由 109 換回 P-51 時
    // 若沿用長度 3 的舊陣列，fire 迴圈會讀到 cooldowns[3..5]——在
    // noUncheckedIndexedAccess 下那是 undefined，算術一路變成 NaN，
    // 那三挺槍從此永遠不發射，而且畫面上只是「威力好像變小了」。
    const w = new World()
    const c = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    expect(c.cooldowns).toHaveLength(6)

    w.setSpec(c, BF109K4)
    expect(c.cooldowns).toHaveLength(BF109K4.battery.mounts.length)
    expect(c.hp).toBe(BF109K4.hp)

    w.setSpec(c, P51D)
    expect(c.cooldowns).toHaveLength(6)
    expect([...c.cooldowns]).toEqual(Array(6).fill(0))
  })
})

describe('開火', () => {
  it('不扣扳機不產生彈丸', () => {
    const w = new World()
    w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(w.projectiles.live).toBe(0)
  })

  it('扣住扳機一秒，發數接近 6 挺 × 800 rpm', () => {
    const w = new World()
    const ctrl = new Fixed()
    ctrl.firing = true
    w.add(new Aircraft(P51D), ctrl, 'blue', new Vector3())
    for (let i = 0; i < 240; i++) w.step(DT)
    // 6 挺 × 14 發 = 84（壽命 1.2 s > 1 s，所以一發都還沒回收）
    expect(w.projectiles.live).toBe(84)
  })

  it('打爆的飛機不會繼續射擊', () => {
    const w = new World()
    const ctrl = new Fixed()
    ctrl.firing = true
    const c = w.add(new Aircraft(P51D), ctrl, 'blue', new Vector3())
    c.hp = 0
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(w.projectiles.live).toBe(0)
  })

  it('彈丸繼承射手速度 —— 這是偏射困難的來源，也是零成本的真實性', () => {
    const w = new World()
    const ctrl = new Fixed()
    ctrl.firing = true
    const c = w.add(new Aircraft(P51D), ctrl, 'blue', new Vector3())
    c.aircraft.state.velocity.set(0, 0, -200)
    w.step(DT)
    // 第一發的速度大小必須是 887 + 200 這個量級，不是 887
    const i = 0
    const speed = Math.hypot(w.projectiles.vx[i]!, w.projectiles.vy[i]!, w.projectiles.vz[i]!)
    expect(speed).toBeGreaterThan(1000)
    expect(speed).toBeLessThan(1120)
  })

  it('槍口位置用的是推進後的姿態（不是上一步的殘影）', () => {
    // 飛機以 200 m/s 前進，一步走 0.83 m。若用推進前的位置，第一發會落在
    // 後方 0.83 m 處——在 240 Hz 下小，但在高速接近時就是可觀察的誤差。
    const w = new World()
    const ctrl = new Fixed()
    ctrl.firing = true
    const c = w.add(new Aircraft(P51D), ctrl, 'blue', new Vector3())
    c.aircraft.state.velocity.set(0, 0, -200)
    const z0 = c.aircraft.state.position.z
    w.step(DT)
    // 槍口在機體 z ≈ −0.9，飛機已前進 −200·dt
    expect(w.projectiles.sz[0]!).toBeLessThan(z0 - 0.9)
  })
})

describe('命中與損傷', () => {
  /** 射手在原點朝 −Z，靶機在正前方 60 m 處靜止。 */
  function duel(firing = true) {
    const w = new World()
    const shooter = new Fixed()
    shooter.firing = firing
    const s = w.add(new Aircraft(P51D), shooter, 'blue', new Vector3())
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3(0, 4000, -60))
    t.respawnOnDestroy = false
    return { w, s, t }
  }

  it('打中會扣血', () => {
    const { w, s, t } = duel()
    pin(s.aircraft, 0, 4000, 0)
    pin(t.aircraft, 0, 4000, -60)
    for (let i = 0; i < 60; i++) {
      pin(s.aircraft, 0, 4000, 0)
      pin(t.aircraft, 0, 4000, -60)
      w.step(DT)
    }
    expect(t.hp).toBeLessThan(1000)
  })

  it('不扣扳機就不扣血（避免「其他東西也在扣血」的偽陽性）', () => {
    const { w, t } = duel(false)
    for (let i = 0; i < 60; i++) w.step(DT)
    expect(t.hp).toBe(1000)
  })

  it('打不到自己 —— owner 必須被排除', () => {
    const w = new World()
    const ctrl = new Fixed()
    ctrl.firing = true
    const s = w.add(new Aircraft(P51D), ctrl, 'blue', new Vector3())
    for (let i = 0; i < 240; i++) {
      pin(s.aircraft, 0, 4000, 0)
      w.step(DT)
    }
    expect(s.hp).toBe(1000)
  })

  it('命中之後彈丸消失（同一發不會扣兩次血）', () => {
    const { w, s, t } = duel()
    for (let i = 0; i < 240; i++) {
      pin(s.aircraft, 0, 4000, 0)
      pin(t.aircraft, 0, 4000, -60)
      w.step(DT)
    }
    // 若命中不回收，池子裡會累積到 6 × 14 × ... 甚至滿池
    expect(w.projectiles.live).toBeLessThan(84)
    expect(t.hp).toBeLessThan(1000)
  })

  it('部位倍率與防護力都生效：打座艙比打機翼痛', () => {
    // 直接呼叫損傷入口，避免依賴彈道幾何
    //
    // 【2026-09-01 數字改了，因為多除了一個防護力】扣血公式現在是
    // 傷害 × PART_MULTIPLIER ÷ protection。P-51D 的座艙防護力 1.15
    //（座椅後 11 mm 裝甲板），機翼 1.00：
    //
    //   座艙  10 × 2.5 ÷ 1.15 = 21.739
    //   機翼  10 × 0.7 ÷ 1.00 =  7.000
    //
    // 【為什麼不用 spec 的常數算期望值】那會變成用被測物驗被測物 —— 公式
    // 打錯（例如乘成除）兩邊會一起錯，測試照樣綠。所以期望值是手算後寫死的。
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    const full = P51D.hp
    w.applyDamage(t, 10, 'cockpit')
    const cockpit = full - t.hp
    t.hp = full
    w.applyDamage(t, 10, 'wingLeft')
    const wing = full - t.hp
    expect(cockpit).toBeCloseTo(21.739, 3)
    expect(wing).toBeCloseTo(7, 6)
    // 這一條與上面兩個數字無關，公式怎麼變都該成立
    expect(cockpit).toBeGreaterThan(wing)
  })

  it('射手的 hitsDealt 在命中的那一步為正，下一步歸零', () => {
    // HUD 的 X 標記靠它觸發（0.15 s 計時由 HUD 那一層做）
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    const s = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 6, 'fuselage', s)
    expect(s.hitsDealt).toBe(1)
    w.step(DT)
    expect(s.hitsDealt).toBe(0)
  })
})

describe('擊墜', () => {
  it('HP 歸零且 respawnOnDestroy 為真時滿血重生在出生點', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3(100, 4000, -800))
    t.respawnOnDestroy = true
    t.aircraft.state.position.set(0, 0, 0)
    w.applyDamage(t, 1000, 'cockpit')
    expect(t.hp).toBe(1000)
    expect(t.aircraft.state.position.toArray()).toEqual([100, 4000, -800])
  })

  it('respawnOnDestroy 為假時停在 HP 0，不重生（玩家走這條）', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3(100, 4000, -800))
    t.aircraft.state.position.set(0, 0, 0)
    w.applyDamage(t, 1000, 'cockpit')
    expect(t.hp).toBe(0)
    expect(t.aircraft.state.position.toArray()).toEqual([0, 0, 0])
  })

  it('HP 不會變成負數', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    expect(t.hp).toBe(0)
  })

  it('respawn 清空該架的射速時鐘（重生不該接續上一條命的節奏）', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.cooldowns.fill(0.05)
    w.respawn(t)
    expect([...t.cooldowns]).toEqual(Array(t.cooldowns.length).fill(0))
  })
})

describe('一步的順序（spec §4.2）', () => {
  it('彈丸推進在飛機之後 —— 判定用的是這一步的新位置', () => {
    /**
     * 【幾何是刻意設計成只有正確順序才會命中的】
     *
     * 靶機機首朝 +Z（繞 Y 轉 180°），以 300 m/s 沿 +Z 飛。步長取 0.05 s，
     * 所以它一步走 15 m。命中盒在機體座標的 z 範圍是 −3.42…6.58，機首朝
     * +Z 之後對映到世界的 −6.58…+3.42（相對重心）。
     *
     *   推進前  靶機在 z = 0    → 盒子佔 z ∈ [−6.58, 3.42]
     *   推進後  靶機在 z = 15   → 盒子佔 z ∈ [ 8.42, 18.42]
     *
     * 彈丸從 z = 56 以 −887 m/s 射出，一步走 44.35 m，線段是 [11.65, 56]。
     * 它**完全構不到**推進前的盒子（差 8.2 m），卻穩穩壓在推進後的盒子上
     * （重疊 6.75 m）。所以「有沒有扣血」精確等於「順序有沒有寫對」。
     *
     * 用 toBeLessThan 而不是 toBeLessThanOrEqual：後者在完全沒命中時
     * （hp 不變）也會通過，那種斷言抓不到任何迴歸。
     */
    const w = new World()
    // 指令方向與靶機的飛行方向一致，指揮儀才不會在這 0.05 s 內硬扯機首
    const t = w.add(new Aircraft(P51D), new Fixed(new Vector3(0, 0, 1)), 'red', new Vector3())
    t.respawnOnDestroy = false
    t.aircraft.state.orientation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    t.aircraft.prevOrientation.copy(t.aircraft.state.orientation)
    pin(t.aircraft, 0, 4000, 0, 300)

    const before = t.hp
    w.projectiles.spawn(0, 4000, 56, 0, 0, -887, 6, 1)   // owner 1 = 不存在的射手
    w.step(0.05)

    expect(t.aircraft.state.position.z).toBeGreaterThan(14)
    expect(t.hp).toBeLessThan(before)
  })

  it('連續步進 5 秒不拋錯，且彈丸數維持有界', () => {
    const w = new World()
    const ctrl = new Fixed()
    ctrl.firing = true
    w.add(new Aircraft(P51D), ctrl, 'blue', new Vector3())
    for (let i = 0; i < 240 * 5; i++) w.step(DT)
    // 穩態存量 = 射速 × 壽命 = 6 × 13.33 × 1.2 ≈ 96
    expect(w.projectiles.live).toBeGreaterThan(80)
    expect(w.projectiles.live).toBeLessThan(120)
    expect(PROJECTILE_LIFETIME).toBe(1.2)
  })
})

describe('退場', () => {
  it('add 出來的 Combatant 是活的', () => {
    const w = new World()
    const c = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    expect(c.alive).toBe(true)
  })

  it('HP 歸零且不重生 → alive 轉為 false', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    expect(t.alive).toBe(false)
  })

  it('HP 歸零但會重生 → 仍然是活的', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = true
    w.applyDamage(t, 99999, 'cockpit')
    expect(t.alive).toBe(true)
    expect(t.hp).toBe(P51D.hp)
  })

  it('退場之後不再推進物理', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'red', new Vector3(0, 4000, 0))
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    const before = t.aircraft.state.position.clone()
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(t.aircraft.state.position.distanceTo(before)).toBe(0)
  })

  it('退場之後打不中', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    // 已經是 0 血；再打一次不應該讓 hitsDealt 增加
    const s = w.add(new Aircraft(BF109K4), new Fixed(), 'blue', new Vector3(0, 0, 100))
    w.applyDamage(t, 10, 'fuselage', s)
    expect(s.hitsDealt).toBe(0)
  })

  it('重生把 alive 設回 true', () => {
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 99999, 'cockpit')
    w.respawn(t)
    expect(t.alive).toBe(true)
    expect(t.hp).toBe(P51D.hp)
  })
})

describe('同隊彈丸穿透（M5 spec §3.1 條件 8）', () => {
  /**
   * 把射手擺在原點朝 −Z，目標擺在正前方 300 m，連射兩秒，回傳目標掉的血。
   *
   * 【為什麼是 300 m 而不是更近】P-51 的六挺翼槍在 300 m 處才收斂
   * （M2 spec §5）。擺在 60 m 的話子彈還散在機身兩側一公尺外，可能整輪
   * 都打不中——那會讓下面兩條「同隊為 0」變成空的斷言。
   *
   * 【為什麼每步都重新釘住】兩機都沒有空速，放著會一路掉下去；釘住之後
   * 這條測試量的才是「同隊會不會扣血」，不是「掉多快」。
   */
  function shootAt(shooterTeam: 'blue' | 'red', targetTeam: 'blue' | 'red'): number {
    const w = new World()
    const shooter = w.add(
      new Aircraft(P51D), new Fixed(new Vector3(0, 0, -1), 0, true),
      shooterTeam, new Vector3(0, 0, 0),
    )
    const target = w.add(
      new Aircraft(BF109K4), new Fixed(), targetTeam, new Vector3(0, 0, -300),
    )
    target.respawnOnDestroy = false
    const before = target.hp
    for (let i = 0; i < 480; i++) {
      pin(shooter.aircraft, 0, 4000, 0)
      pin(target.aircraft, 0, 4000, -300)
      w.step(DT)
    }
    return before - target.hp
  }

  it('敵隊會被打中——先確認這個測試佈置真的打得到', () => {
    expect(shootAt('blue', 'red')).toBeGreaterThan(0)
  })

  it('同隊的傷害恆為 0', () => {
    expect(shootAt('blue', 'blue')).toBe(0)
  })

  it('紅隊對紅隊同樣為 0', () => {
    expect(shootAt('red', 'red')).toBe(0)
  })
})

describe('撞地退場（M5 spec §7）', () => {
  it('預設政策：重心低於海平面就退場', () => {
    const w = new World()
    const c = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3())
    c.respawnOnDestroy = false
    c.aircraft.state.position.set(0, -1, 0)
    w.step(DT)
    expect(c.alive).toBe(false)
    expect(c.hp).toBe(0)
  })

  it('撞地也適用於 AI 駕駛的飛機，不只玩家', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109K4, 4000, 200), new Fixed(), 'red', new Vector3())
    a.respawnOnDestroy = false
    b.respawnOnDestroy = false
    a.aircraft.state.position.set(0, -1, 0)
    b.aircraft.state.position.set(0, -1, 0)
    w.step(DT)
    expect(a.alive).toBe(false)
    expect(b.alive).toBe(false)
  })

  it('注入的政策取代預設值', () => {
    const w = new World()
    const c = w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3())
    c.respawnOnDestroy = false
    // 3,000 m 以下就算撞地——用一個絕不會與預設值混淆的門檻
    w.crashPolicy = (x) => x.aircraft.state.position.y <= 3000
    c.aircraft.state.position.set(0, 2999, 0)
    w.step(DT)
    expect(c.alive).toBe(false)
  })

  it('respawnOnDestroy 為真時撞地會重生而不是退場', () => {
    const w = new World()
    const c = w.add(
      new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3(0, 4000, 0), 4000, 200,
    )
    c.respawnOnDestroy = true
    c.aircraft.state.position.set(0, -1, 0)
    w.step(DT)
    expect(c.alive).toBe(true)
    expect(c.aircraft.state.position.y).toBeCloseTo(4000, 3)
  })
})

describe('槍焰計時器（M7 spec §5.1）', () => {
  /** 造一個只有一架飛機的世界，扳機由回傳的控制器控制。 */
  function oneShooter() {
    const w = new World()
    const a = new Aircraft(P51D, 4000, 200)
    const ctrl = new Fixed(new Vector3(0, 0, -1), 0.7, false)
    const c = w.add(a, ctrl, 'blue', a.state.position.clone(), 4000, 200)
    return { w, c, ctrl }
  }

  it('每個掛架一個計時器，長度等於掛架數', () => {
    const { c } = oneShooter()
    expect(c.muzzleFlash.length).toBe(P51D.battery.mounts.length)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('擊發的那一步把計時器設成 FLASH_SECONDS', () => {
    const { w, c, ctrl } = oneShooter()
    ctrl.firing = true
    w.step(DT)
    // 【精度取 6 而不是 9】計時器存在 Float32Array 裡，0.03 會變成
    // 0.029999999329447746 —— float32 只有約 7 位有效數字。
    expect(Math.max(...Array.from(c.muzzleFlash))).toBeCloseTo(FLASH_SECONDS, 6)
  })

  it('放開扳機之後計時器遞減到 0 並停在 0', () => {
    const { w, c, ctrl } = oneShooter()
    ctrl.firing = true
    w.step(DT)
    ctrl.firing = false
    const steps = Math.ceil(FLASH_SECONDS / DT) + 4
    for (let i = 0; i < steps; i++) w.step(DT)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('不會變成負數', () => {
    const { w, c } = oneShooter()
    for (let i = 0; i < 240; i++) w.step(DT)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('退場的飛機計時器也會熄掉', () => {
    // 【為什麼要測】退場的飛機在 step 的第一段就被 continue 掉了。
    // 遞減若寫在 continue 之後，被打爆那一瞬間亮著的槍焰會永遠停在那裡。
    const { w, c, ctrl } = oneShooter()
    ctrl.firing = true
    w.step(DT)
    expect(Math.max(...Array.from(c.muzzleFlash))).toBeGreaterThan(0)
    w.destroy(c)
    const steps = Math.ceil(FLASH_SECONDS / DT) + 4
    for (let i = 0; i < steps; i++) w.step(DT)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('換機種時陣列跟著重建', () => {
    // 【不重建會怎樣】P-51 六挺換成 109 三挺之後，多出來的三格永遠不會
    // 被遞減也不會被設定 —— 若換機種那一刻它們是亮的，就變成三管永遠
    // 不熄的槍焰。與 cooldowns 必須重配是同一個理由。
    const { w, c, ctrl } = oneShooter()
    ctrl.firing = true
    w.step(DT)
    w.setSpec(c, BF109K4)
    expect(c.muzzleFlash.length).toBe(BF109K4.battery.mounts.length)
    expect(Array.from(c.muzzleFlash).every((v) => v === 0)).toBe(true)
  })

  it('FLASH_SECONDS 落在「一幀」與「最快射擊間隔」之間', () => {
    // 下界：60 fps 的一幀 16.7 ms。短於它就會被抽樣漏掉
    expect(FLASH_SECONDS).toBeGreaterThan(1 / 60)
    // 上界：MG 131 是 900 rpm = 66.7 ms 一發。工作週期必須明顯低於 1，
    // 不然讀起來是一盞常亮的燈而不是閃爍
    expect(FLASH_SECONDS / (60 / 900)).toBeLessThan(0.6)
  })
})

describe('命中事件（M7 spec §2.2）', () => {
  /** 一步走 887 × 0.02 = 17.7 m —— 足以讓線段從 −280 跨過 −300 的紅機。 */
  const HIT_DT = 0.02

  /** 藍 0 在原點朝 −Z；紅 1 在 −Z 方向 300 m 處。 */
  function duel() {
    const w = new World()
    const blue = new Aircraft(P51D, 4000, 200)
    blue.state.position.set(0, 4000, 0)
    blue.prevPosition.copy(blue.state.position)
    const red = new Aircraft(P51D, 4000, 200)
    red.state.position.set(0, 4000, -300)
    red.prevPosition.copy(red.state.position)
    const b = w.add(blue, new Fixed(), 'blue', blue.state.position.clone(), 4000, 200)
    const r = w.add(red, new Fixed(), 'red', red.state.position.clone(), 4000, 200)
    return { w, b, r }
  }

  it('打中飛機時推一筆事件，命中點落在紅機附近', () => {
    const { w, r } = duel()
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.projectiles.step(HIT_DT)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(1)
    const z = w.hitEvents.data[2]!
    expect(z).toBeLessThan(-280)
    expect(Math.abs(z - r.aircraft.state.position.z)).toBeLessThan(10)
  })

  it('法線是世界座標的單位向量', () => {
    const { w } = duel()
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.projectiles.step(HIT_DT)
    w.resolveHits()
    const d = w.hitEvents.data
    expect(Math.hypot(d[3]!, d[4]!, d[5]!)).toBeCloseTo(1, 5)
  })

  it('法線大致迎著彈丸 —— 從前方射來就朝 +Z', () => {
    // 【為什麼只要求「大致」】命中盒是機體座標的 AABB，法線是盒面的法線，
    // 不是機體外殼的真實曲面法線。要求的是「不會朝著彈丸飛去的方向」。
    const { w } = duel()
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.projectiles.step(HIT_DT)
    w.resolveHits()
    // 彈丸往 −Z 飛，所以法線的 Z 分量必須為正（迎著它）
    expect(w.hitEvents.data[5]!).toBeGreaterThan(0)
  })

  it('沒打中就沒有事件', () => {
    const { w } = duel()
    w.projectiles.spawn(500, 4000, -280, 0, 0, -887, 10, 0)
    w.projectiles.step(HIT_DT)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(0)
  })

  it('一步之內多發命中就有多筆', () => {
    const { w } = duel()
    for (let i = 0; i < 3; i++) w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.projectiles.step(HIT_DT)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(3)
  })

  it('事件不會跨步累積 —— 呼叫端排空之後就是乾淨的', () => {
    const { w } = duel()
    w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 10, 0)
    w.projectiles.step(HIT_DT)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(1)
    clearImpacts(w.hitEvents)
    w.step(DT)
    expect(w.hitEvents.count).toBe(0)
  })

  it('緩衝滿了不會越界，dropped 會計數', () => {
    const { w } = duel()
    for (let i = 0; i < w.hitEvents.capacity + 5; i++) {
      w.projectiles.spawn(0, 4000, -280, 0, 0, -887, 1, 0)
    }
    w.projectiles.step(HIT_DT)
    w.resolveHits()
    expect(w.hitEvents.count).toBe(w.hitEvents.capacity)
    expect(w.hitEvents.dropped).toBeGreaterThan(0)
  })
})

describe('入海回收與水柱事件（M7 spec §4）', () => {
  /** 只有一架飛機的空世界，用來單獨觀察彈丸。 */
  function empty() {
    const w = new World()
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.prevPosition.copy(a.state.position)
    w.add(a, new Fixed(), 'blue', a.state.position.clone(), 4000, 200)
    return w
  }

  it('線段跨過水面時推一筆水柱事件，交點內插正確', () => {
    const w = empty()
    // 從 y = 10 往下走一步到 y = −10：交點在中間，t = 10/20 = 0.5
    const i = w.projectiles.spawn(100, 10, 200, 20, -20, 40, 10, 0)
    w.projectiles.step(1)
    expect(w.projectiles.y[i]).toBeCloseTo(-10, 6)
    w.resolveHits()
    expect(w.splashEvents.count).toBe(1)
    const d = w.splashEvents.data
    expect(d[0]).toBeCloseTo(110, 4)   // x: 100 + 0.5 × 20
    expect(d[1]).toBeCloseTo(0, 6)     // y: 水面
    expect(d[2]).toBeCloseTo(220, 4)   // z: 200 + 0.5 × 40
  })

  it('水柱的法線朝上 —— 它就是「法線朝上的撞擊」', () => {
    const w = empty()
    w.projectiles.spawn(0, 10, 0, 0, -20, 0, 10, 0)
    w.projectiles.step(1)
    w.resolveHits()
    const d = w.splashEvents.data
    expect([d[3], d[4], d[5]]).toEqual([0, 1, 0])
  })

  it('一發彈丸只噴一根柱子', () => {
    // 【為什麼會噴兩根】判準若寫成「y <= 0」而不是「跨過 0」，彈丸在
    // 水面下的每一步都會再推一筆，一發變成一串。
    const w = empty()
    w.projectiles.spawn(0, 1, 0, 0, -100, 0, 10, 0)
    for (let n = 0; n < 5; n++) {
      w.projectiles.step(1 / 240)
      w.resolveHits()
    }
    expect(w.splashEvents.count).toBe(1)
  })

  it('低於 SEA_KILL_Y 才回收，不是一入水就回收', () => {
    const w = empty()
    const i = w.projectiles.spawn(0, 1, 0, 0, -100, 0, 10, 0)
    // 一步走 −100/240 ≈ −0.42 m。走到 y ≈ −1 時仍該活著
    for (let n = 0; n < 5; n++) {
      w.projectiles.step(1 / 240)
      w.resolveHits()
    }
    expect(w.projectiles.y[i]!).toBeLessThan(0)
    expect(w.projectiles.y[i]!).toBeGreaterThan(SEA_KILL_Y)
    expect(w.projectiles.owner[i]).toBe(0)

    // 繼續走到 SEA_KILL_Y 以下
    for (let n = 0; n < 60; n++) {
      w.projectiles.step(1 / 240)
      w.resolveHits()
    }
    expect(w.projectiles.owner[i]).toBe(-1)
  })

  it('往上飛的彈丸不會誤判', () => {
    const w = empty()
    w.projectiles.spawn(0, 1, 0, 0, 100, 0, 10, 0)
    w.projectiles.step(1 / 240)
    w.resolveHits()
    expect(w.splashEvents.count).toBe(0)
  })

  it('SEA_KILL_Y 低於任何存活飛機的命中盒可能到達的最低點', () => {
    // 【這是 §4.3 的證明本身，不是它的一個抽樣】
    // 存活 ⟹ 原點 > 浪谷 + CRASH_CLEARANCE。取保守的浪谷 −5 m、
    // CRASH_CLEARANCE = 2 → 原點 > −3。命中盒最遠伸到原點下方一個包圍半徑。
    const worstOrigin = -5 + CRASH_CLEARANCE
    const maxR = Math.max(boundingRadius(P51D.hitBoxes), boundingRadius(BF109K4.hitBoxes))
    expect(SEA_KILL_Y).toBeLessThanOrEqual(worstOrigin - maxR)
  })

  it('SEA_SURFACE_Y 與 SEA_KILL_Y 是兩個不同的高度', () => {
    expect(SEA_SURFACE_Y).toBe(0)
    expect(SEA_KILL_Y).toBeLessThan(SEA_SURFACE_Y)
  })
})

describe('擊墜歸屬（M9 spec §4）', () => {
  it('被打爆時，事件帶著兇手的座位索引', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109K4), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.applyDamage(b, 99999, 'fuselage', a)
    expect(w.killEvents.count).toBe(1)
    expect(w.killEvents.data[6]).toBe(b.index)
    expect(w.killEvents.data[7]).toBe(a.index)
  })

  it('兇手是第 0 座位時也記得住', () => {
    // 【為什麼特別測 0】`killer ? killer.index : -1` 這種寫法在索引為 0 時
    // 會把真正的兇手寫成 −1。要判斷的是「有沒有射手」，不是索引的真假值。
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109K4), new Fixed(), 'red', new Vector3(0, 0, -800))
    expect(a.index).toBe(0)
    w.applyDamage(b, 99999, 'fuselage', a)
    expect(w.killEvents.data[7]).toBe(0)
  })

  it('撞海不算任何人的擊墜 —— 兇手欄是 −1', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    w.destroy(a)
    expect(w.killEvents.count).toBe(1)
    expect(w.killEvents.data[7]).toBe(-1)
  })
})

describe('世界時鐘與傷害時刻表（M9 spec §5.1）', () => {
  it('時鐘隨 step 累加', () => {
    const w = new World()
    w.add(new Aircraft(P51D, 4000, 200), new Fixed(), 'blue', new Vector3(0, 4000, 0))
    expect(w.time).toBe(0)
    w.step(DT)
    w.step(DT)
    expect(w.time).toBeCloseTo(DT * 2, 9)
  })

  it('表格的初值是 −Infinity', () => {
    // 【為什麼不能是 0】世界時間從 0 開始。用 0 當「沒打過」等於宣稱每個人
    // 在 t=0 都打過每個人，於是第一次擊墜會發出滿場的助攻。
    const w = new World()
    w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    w.add(new Aircraft(BF109K4), new Fixed(), 'red', new Vector3(0, 0, -800))
    for (let i = 0; i < w.damageTime.length; i++) {
      expect(w.damageTime[i]).toBe(-Infinity)
    }
  })

  it('表格的邊長跟著參戰架數長', () => {
    const w = new World()
    for (let i = 0; i < 5; i++) {
      w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3(i * 100, 0, 0))
    }
    expect(w.damageStride).toBe(5)
    expect(w.damageTime.length).toBe(25)
  })

  it('命中會記下當時的世界時間', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109K4), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.time = 12.5
    w.applyDamage(b, 10, 'wingLeft', a)
    expect(w.damageTime[a.index * w.damageStride + b.index]).toBeCloseTo(12.5, 4)
    // 反向沒有被寫到
    expect(w.damageTime[b.index * w.damageStride + a.index]).toBe(-Infinity)
  })

  it('沒有射手的傷害不寫表格', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    w.time = 3
    w.applyDamage(a, 10, 'fuselage')
    for (let i = 0; i < w.damageTime.length; i++) {
      expect(w.damageTime[i]).toBe(-Infinity)
    }
  })

  it('重生清掉打過它的那一欄', () => {
    // 【為什麼】不清的話，重生後的第一次擊墜會把上一條命的攻擊者算進助攻。
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109K4), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.time = 5
    w.applyDamage(b, 10, 'fuselage', a)
    w.respawn(b)
    expect(w.damageTime[a.index * w.damageStride + b.index]).toBe(-Infinity)
  })

  it('clearDamageLog 把整張表清成 −Infinity', () => {
    const w = new World()
    const a = w.add(new Aircraft(P51D), new Fixed(), 'blue', new Vector3())
    const b = w.add(new Aircraft(BF109K4), new Fixed(), 'red', new Vector3(0, 0, -800))
    w.time = 5
    w.applyDamage(b, 10, 'fuselage', a)
    w.clearDamageLog()
    for (let i = 0; i < w.damageTime.length; i++) {
      expect(w.damageTime[i]).toBe(-Infinity)
    }
  })
})
