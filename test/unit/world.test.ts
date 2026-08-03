import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'
import { PROJECTILE_LIFETIME } from '../../src/world/Projectiles'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

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
    const b = w.add(new Aircraft(BF109G6), new Fixed(), 'red', new Vector3(0, 0, -800))
    expect(a.index).toBe(0)
    expect(b.index).toBe(1)
    expect(a.hp).toBe(1000)
    expect(b.hp).toBe(1000)
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

    w.setSpec(c, BF109G6)
    expect(c.cooldowns).toHaveLength(BF109G6.battery.mounts.length)
    expect(c.hp).toBe(BF109G6.hp)

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

  it('部位倍率生效：打座艙比打機翼痛', () => {
    // 直接呼叫損傷入口，避免依賴彈道幾何
    const w = new World()
    const t = w.add(new Aircraft(P51D), new Fixed(), 'red', new Vector3())
    t.respawnOnDestroy = false
    w.applyDamage(t, 10, 'cockpit')
    const cockpit = 1000 - t.hp
    t.hp = 1000
    w.applyDamage(t, 10, 'wingLeft')
    const wing = 1000 - t.hp
    expect(cockpit).toBeCloseTo(25, 6)
    expect(wing).toBeCloseTo(7, 6)
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
    const s = w.add(new Aircraft(BF109G6), new Fixed(), 'blue', new Vector3(0, 0, 100))
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
      new Aircraft(BF109G6), new Fixed(), targetTeam, new Vector3(0, 0, -300),
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
