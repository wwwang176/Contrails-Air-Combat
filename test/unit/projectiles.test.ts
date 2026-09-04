import { describe, it, expect } from 'vitest'
import { Projectiles, PROJECTILE_CAPACITY, PROJECTILE_LIFETIME } from '../../src/world/Projectiles'

const DT = 1 / 240

describe('Projectiles', () => {
  it('容量預設 4000（按 M5 的 40 架抓，不是 M2 的 2 架）', () => {
    expect(PROJECTILE_CAPACITY).toBe(4000)
    expect(new Projectiles().owner).toHaveLength(4000)
  })

  it('壽命 1.2 s —— 與預瞄環的顯示條件是同一個數字', () => {
    expect(PROJECTILE_LIFETIME).toBe(1.2)
  })

  it('新池是空的，所有槽位的 owner 為 −1', () => {
    const p = new Projectiles(8)
    expect(p.live).toBe(0)
    expect([...p.owner]).toEqual(Array(8).fill(-1))
  })

  it('spawn 寫入位置、速度、傷害與射手，age 歸零', () => {
    const p = new Projectiles(8)
    const i = p.spawn(1, 2, 3, 10, 20, 30, 6, 2, 0, PROJECTILE_LIFETIME)
    expect(p.x[i]).toBeCloseTo(1, 6)
    expect(p.vy[i]).toBeCloseTo(20, 6)
    expect(p.damage[i]).toBe(6)
    expect(p.owner[i]).toBe(2)
    expect(p.age[i]).toBe(0)
    expect(p.live).toBe(1)
  })

  it('spawn 當下線段起點就是槍口 —— 第一步的判定不能從原點開始', () => {
    const p = new Projectiles(8)
    const i = p.spawn(1, 2, 3, 10, 0, 0, 6, 0, 0, PROJECTILE_LIFETIME)
    expect([p.sx[i], p.sy[i], p.sz[i]]).toEqual([1, 2, 3])
  })

  it('step 以等速直線推進，無阻力也無重力（spec §2 裁決）', () => {
    const p = new Projectiles(8)
    const i = p.spawn(0, 0, 0, 100, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    for (let n = 0; n < 240; n++) p.step(DT)
    expect(p.x[i]).toBeCloseTo(100, 2)
    expect(p.y[i]).toBeCloseTo(0, 9)        // 重力若沒被移除，這裡會是 −4.9
    expect(p.z[i]).toBeCloseTo(-887, 1)
    expect(p.vz[i]).toBeCloseTo(-887, 6)    // 速度一步都沒衰減
  })

  it('每步的線段起點是上一步的終點（命中判定靠這一段，不能有縫）', () => {
    const p = new Projectiles(8)
    const i = p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    p.step(DT)
    const firstEnd = p.z[i]!
    p.step(DT)
    expect(p.sz[i]).toBeCloseTo(firstEnd, 9)
  })

  it('超過壽命即回收，而且判準是壽命不是射程', () => {
    // spec §5.1.1：彈丸繼承射手速度之後，能不能打到取決於攔截點而不是
    // 目前距離。這一顆走了 1500 m 才到壽命。
    const p = new Projectiles(8)
    const i = p.spawn(0, 0, 0, 0, 0, -1250, 6, 0, 0, PROJECTILE_LIFETIME)   // 887 + 射手 363
    for (let n = 0; n < 240 * 2; n++) p.step(DT)
    expect(p.owner[i]).toBe(-1)
    expect(p.live).toBe(0)
  })

  it('壽命內的最後一步仍然參與判定（不可提早一步就回收）', () => {
    const p = new Projectiles(8)
    const i = p.spawn(0, 0, 0, 0, 0, -100, 6, 0, 0, PROJECTILE_LIFETIME)
    const steps = Math.floor(PROJECTILE_LIFETIME / DT) - 1
    for (let n = 0; n < steps; n++) p.step(DT)
    expect(p.owner[i]).toBe(0)
    expect(p.age[i]).toBeLessThanOrEqual(PROJECTILE_LIFETIME)
  })

  it('池滿時覆寫最舊的，不是拒絕發射', () => {
    // spec §10：射擊永遠有反應，比「扣了扳機沒動靜」好——後者玩家會當成 bug。
    const p = new Projectiles(4)
    const first = p.spawn(0, 0, 0, 0, 0, -1, 6, 7, 0, PROJECTILE_LIFETIME)
    for (let n = 0; n < 3; n++) p.spawn(0, 0, 0, 0, 0, -1, 6, 8, 0, PROJECTILE_LIFETIME)
    expect(p.live).toBe(4)
    const reused = p.spawn(0, 0, 0, 0, 0, -1, 6, 9, 0, PROJECTILE_LIFETIME)
    expect(reused).toBe(first)          // 覆寫的正是最舊的那一發
    expect(p.owner[first]).toBe(9)
    expect(p.live).toBe(4)              // 沒有變多，也沒有拒絕
  })

  it('回收後的槽位會被重複利用', () => {
    const p = new Projectiles(2)
    p.spawn(0, 0, 0, 0, 0, -1, 6, 0, 0, PROJECTILE_LIFETIME)
    p.spawn(0, 0, 0, 0, 0, -1, 6, 0, 0, PROJECTILE_LIFETIME)
    for (let n = 0; n < 240 * 2; n++) p.step(DT)
    expect(p.live).toBe(0)
    p.spawn(0, 0, 0, 0, 0, -1, 6, 1, 0, PROJECTILE_LIFETIME)
    expect(p.live).toBe(1)
  })

  it('kill 立刻釋放槽位（命中之後彈丸不該繼續飛）', () => {
    const p = new Projectiles(4)
    const i = p.spawn(0, 0, 0, 5, 0, 0, 6, 0, 0, PROJECTILE_LIFETIME)
    p.kill(i)
    expect(p.owner[i]).toBe(-1)
    expect(p.live).toBe(0)
    const before = p.x[i]!
    p.step(DT)
    expect(p.x[i]).toBe(before)         // 死掉的槽位不再被推進
  })

  it('clear 清空整池', () => {
    const p = new Projectiles(4)
    for (let n = 0; n < 4; n++) p.spawn(0, 0, 0, 0, 0, -1, 6, 0, 0, PROJECTILE_LIFETIME)
    p.clear()
    expect(p.live).toBe(0)
  })

  it('滿載推進：live 數穩定且座標保持有限', () => {
    const p = new Projectiles(PROJECTILE_CAPACITY)
    for (let n = 0; n < PROJECTILE_CAPACITY; n++) p.spawn(0, 0, 0, 0, 0, -887, 6, 0, 0, PROJECTILE_LIFETIME)
    for (let n = 0; n < 100; n++) p.step(DT)
    expect(p.live).toBe(PROJECTILE_CAPACITY)
    for (let i = 0; i < PROJECTILE_CAPACITY; i++) expect(Number.isFinite(p.z[i]!)).toBe(true)
  })
})

describe('Projectiles 的 team 與 life', () => {
  it('spawn 記下陣營', () => {
    const p = new Projectiles(8)
    const i = p.spawn(0, 0, 0, 1, 0, 0, 10, 3, 1, PROJECTILE_LIFETIME)
    expect(p.team[i]).toBe(1)
  })

  /**
   * 【壽命是每發自己的】艦上的 40 mm 要飛 2.4 秒才到得了 2,110 m，而固定槍
   * 仍然是 1.2 秒。共用一個全域常數的話兩者只能有一個是對的。
   */
  it('壽命各自獨立，到期各自回收', () => {
    const p = new Projectiles(8)
    p.spawn(0, 0, 0, 1, 0, 0, 10, 0, 0, 1.2)
    p.spawn(0, 0, 0, 1, 0, 0, 10, 0, 0, 2.4)
    expect(p.live).toBe(2)
    for (let i = 0; i < 130; i++) p.step(1 / 100)   // 1.30 s
    expect(p.live).toBe(1)
    for (let i = 0; i < 120; i++) p.step(1 / 100)   // 2.50 s
    expect(p.live).toBe(0)
  })

  it('clear 之後回到空槽', () => {
    const p = new Projectiles(4)
    p.spawn(0, 0, 0, 1, 0, 0, 10, 2, 1, 3)
    p.clear()
    expect(p.live).toBe(0)
    expect(p.owner[0]).toBe(-1)
  })
})
