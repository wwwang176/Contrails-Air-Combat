import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createGroundBattery, GROUND_FLAK_MUZZLE_Y, GROUND_FLAK_SPEC, SHIP_GUN_SPECS, stepGunPlatform,
} from '../../src/world/shipGuns'
import { createGroundTarget } from '../../src/world/groundTargets'
import { Projectiles } from '../../src/world/Projectiles'
import { createFlak, spawnFlak, type FlakShells } from '../../src/world/flak'
import { World } from '../../src/world/World'
import type { TurretCombatant } from '../../src/world/turrets'

/** 一架不會動的假飛機。只填射控讀得到的欄位 */
function target(index: number, x: number, y: number, z: number, team = 'blue'): TurretCombatant {
  return {
    index, team, alive: true, hp: 100,
    aircraft: {
      spec: { turrets: [] },
      state: {
        position: new Vector3(x, y, z),
        velocity: new Vector3(0, 0, 0),
        orientation: new Quaternion(),
      },
    },
    turretStates: [], turretCooldowns: new Float32Array(0),
  } as unknown as TurretCombatant
}

/** 天上有幾發高砲彈。`team === -1` 是空槽（`flak.ts`） */
function inFlight(f: FlakShells): number {
  let n = 0
  for (let i = 0; i < f.capacity; i++) if (f.team[i] !== -1) n++
  return n
}

/** 一座掛好砲的重高砲位，擺在原點 */
function battery(index = 0): ReturnType<typeof createGroundTarget> {
  const t = createGroundTarget(index, 'flakHeavy', 'red', 0, 0, 0)
  t.guns = createGroundBattery()
  return t
}

/** 跑 `seconds` 秒，回傳這段時間內**射出過**幾發 —— 引信到期會清空槽位 */
function fired(b: ReturnType<typeof battery>, all: TurretCombatant[], seconds: number): number {
  const dt = 1 / 240
  const p = new Projectiles(256)
  const flak = createFlak()
  let seen = 0
  let live = 0
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    stepGunPlatform(b, all, p, flak, i * dt, dt, [b])
    const now = inFlight(flak)
    if (now > live) seen += now - live
    live = now
  }
  return seen
}

/**
 * # 陸上的 8.8 cm Flak —— 機制
 *
 * 射控、時間引信、黑雲與傷害都是艦砲那一套（`shipGuns.ts` / `flak.ts`），
 * 只是發射端本來綁在 `Ship` 上。這一組驗的是**規格與接線**：射得出來、
 * 引信對、射程對、目標會分攤。
 *
 * 【強弱不在這裡】「一趟下來打掉幾架」是遊戲性，由試飛裁定 —— 寫進護欄的話
 * 每一次調數值都要跟著改門檻，而那條紅說明不了任何事。
 */
describe('8.8 cm Flak 的規格', () => {
  it('走引信不進彈丸池', () => {
    const b = battery()
    const p = new Projectiles(256)
    const flak = createFlak()
    const dt = 1 / 240
    for (let i = 0; i < 8 * 240; i++) {
      stepGunPlatform(b, [target(0, 0, 1500, -3000)], p, flak, i * dt, dt, [b])
    }
    expect(inFlight(flak), '一發高砲彈都沒有').toBeGreaterThan(0)
    expect(p.live, '高砲彈跑進了彈丸池').toBe(0)
  })

  /**
   * 【延遲引信】88 用的是時間引信：發射時就把秒數轉好，飛到那一刻炸開。
   * 引信 ≈ 攔截距離 ÷ 初速；算錯的話雲會開在目標的前面或後面一大段。
   */
  it('引信秒數約等於攔截距離除以初速', () => {
    const b = battery()
    const p = new Projectiles(64)
    const f = createFlak()
    const dt = 1 / 240
    let i = -1
    for (let k = 0; k < 12 * 240 && i < 0; k++) {
      stepGunPlatform(b, [target(0, 0, 2000, 0)], p, f, k * dt, dt, [b])
      i = f.team.findIndex((t) => t !== -1)
    }
    expect(i).toBeGreaterThanOrEqual(0)
    // 砲口在 2.2 m，目標在正上方 2,000 m
    const exact = (2000 - GROUND_FLAK_MUZZLE_Y) / GROUND_FLAK_SPEC.muzzleVelocity
    const e = GROUND_FLAK_SPEC.fuseError
    expect(f.fuse[i]!).toBeGreaterThanOrEqual(exact * (1 - e))
    expect(f.fuse[i]!).toBeLessThanOrEqual(exact * (1 + e))
  })

  /**
   * 【誤差是逐發的確定性擾動】同種子逐位元相同，但同一門砲連續幾發不會開在
   * 同一點 —— 少了它，每一朵時機對的雲都必中，黑雲就從招牌變成判決。
   */
  it('引信誤差在 ±fuseError 之內、逐發不同、而且可重現', () => {
    function fuses(): number[] {
      const b = battery()
      const p = new Projectiles(64)
      const f = createFlak()
      const dt = 1 / 240
      const out: number[] = []
      for (let k = 0; k < 90 * 240; k++) {
        stepGunPlatform(b, [target(0, 0, 2000, 0)], p, f, k * dt, dt, [b])
        for (let i = 0; i < f.fuse.length; i++) {
          if (f.team[i] === -1) continue
          out.push(f.fuse[i]!)
          f.team[i] = -1
        }
      }
      return out
    }
    const a = fuses()
    expect(a.length, '取樣不足').toBeGreaterThan(10)
    const exact = (2000 - GROUND_FLAK_MUZZLE_Y) / GROUND_FLAK_SPEC.muzzleVelocity
    const e = GROUND_FLAK_SPEC.fuseError
    for (const x of a) {
      expect(x).toBeGreaterThanOrEqual(exact * (1 - e - 0.01))
      expect(x).toBeLessThanOrEqual(exact * (1 + e + 0.01))
    }
    // 兩端都用得到：不是一個縮在中間的小抖動
    const mean = a.reduce((s, x) => s + x, 0) / a.length
    expect(Math.min(...a)).toBeLessThan(mean * (1 - e * 0.5))
    expect(Math.max(...a)).toBeGreaterThan(mean * (1 + e * 0.5))
    expect(fuses(), '同種子不可重現').toEqual(a)
  })

  /** 射程 = 初速 × 引信上限。負責人裁定維持在 4.9 km */
  it('射程是初速乘引信上限，約 4.9 km', () => {
    const reach = GROUND_FLAK_SPEC.muzzleVelocity * GROUND_FLAK_SPEC.maxFuse
    expect(reach).toBeGreaterThan(4700)
    expect(reach).toBeLessThan(5100)
  })

  it('射程內開火、射程外不開火', () => {
    expect(fired(battery(), [target(0, 0, 1500, -3000)], 8), '射程內不開火')
      .toBeGreaterThan(0)
    expect(fired(battery(), [target(0, 0, 1500, -8000)], 8), '射程外還在開火')
      .toBe(0)
  })

  /** 射速是表上的值。**一分鐘的量**，短窗會被起始的轉砲時間吃掉 */
  it('射速不超過標稱值', () => {
    const n = fired(battery(), [target(0, 0, 2000, 0)], 60)
    expect(n, `一分鐘射了 ${n} 發`).toBeLessThanOrEqual(GROUND_FLAK_SPEC.roundsPerMinute)
    expect(n).toBeGreaterThan(GROUND_FLAK_SPEC.roundsPerMinute * 0.5)
  })

  /** 【一朵雲的半徑與傷害逐發帶】做成模組常數的話調陸砲會動到日 M3 的艦砲 */
  it('射出來的砲彈帶的是陸砲的半徑與傷害，不是艦砲的', () => {
    const b = battery()
    const p = new Projectiles(64)
    const f = createFlak()
    const dt = 1 / 240
    let i = -1
    for (let k = 0; k < 12 * 240 && i < 0; k++) {
      stepGunPlatform(b, [target(0, 0, 2000, 0)], p, f, k * dt, dt, [b])
      i = f.team.findIndex((t) => t !== -1)
    }
    expect(i).toBeGreaterThanOrEqual(0)
    expect(f.radius[i]).toBe(GROUND_FLAK_SPEC.burstRadius)
    expect(f.damage[i]).toBe(GROUND_FLAK_SPEC.burstDamage)
    expect(f.radius[i]).not.toBe(SHIP_GUN_SPECS.flak.burstRadius)
  })

  it('同隊的飛機不打', () => {
    expect(fired(battery(), [target(0, 0, 1500, -3000, 'red')], 8)).toBe(0)
  })

  /** 【炸掉的砲位不再還手】少了這一條，玩家把砲位炸了畫面上仍然在挨打 */
  it('砲位被炸掉之後一發都不打', () => {
    const b = battery()
    b.alive = false
    expect(fired(b, [target(0, 0, 1500, -3000)], 8)).toBe(0)
  })
})

/**
 * # 目標不能全部咬在同一架上
 *
 * 十六座砲位一起打四架 B-17，全部咬長機的話那一架瞬間被十六倍火力打下來，
 * 另外三架一路順風。分攤與定期重選是艦砲那一套現成的（`LOCKS` 與
 * `SEARCH_INTERVAL`），這裡驗的是**陸上砲位有把整組傳進去** —— 少了那一步，
 * 每一座只數自己的鎖定，分攤等於沒有。
 */
describe('砲位之間的目標分攤', () => {
  /**
   * 八座砲位擠在一個 100 m 的圈裡。
   *
   * 【一定要擠在一起】散開成廠區那樣的話，每一座最近的本來就是不同的飛機
   * —— 分攤壞掉測試照樣綠（實測過）。擠在一起之後「最近的」對八座是同一架，
   * 能把它們分開的只剩鎖定數。
   */
  function ring(): ReturnType<typeof battery>[] {
    const out: ReturnType<typeof battery>[] = []
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const t = createGroundTarget(i, 'flakHeavy', 'red',
        Math.cos(a) * 100, Math.sin(a) * 100, 0)
      t.guns = createGroundBattery()
      out.push(t)
    }
    return out
  }

  /** 四架排成縱隊，一架比一架遠 —— 最近的那一架對每一座砲位都相同 */
  function flight(): TurretCombatant[] {
    return [0, 1, 2, 3].map((i) => target(i, 0, 1500, -1000 - i * 400))
  }

  function settle(batteries: ReturnType<typeof battery>[], all: TurretCombatant[]): void {
    const dt = 1 / 240
    const p = new Projectiles(1024)
    const flak = createFlak()
    for (let i = 0; i < Math.round(4 / dt); i++) {
      for (const b of batteries) stepGunPlatform(b, all, p, flak, i * dt, dt, batteries)
    }
  }

  it('八座打四架時沒有一架吃超過一半的鎖定', () => {
    const bs = ring()
    const all = flight()
    settle(bs, all)
    const locks = [0, 0, 0, 0]
    for (const b of bs) for (const g of b.guns) if (g.targetIndex >= 0) locks[g.targetIndex]!++
    const total = locks.reduce((a, b) => a + b, 0)
    expect(total, '沒有任何一座鎖上目標').toBeGreaterThanOrEqual(4)
    for (let i = 0; i < 4; i++) {
      expect(locks[i], `第 ${i} 架被 ${locks[i]} 門鎖住（分佈 ${locks.join('/')}）`)
        .toBeLessThanOrEqual(Math.ceil(total / 2))
    }
  })

  /**
   * 【咬死的砲位打不到換位的敵機】搜尋冷卻到期就重挑。少了它，一架飛出射界
   * 的飛機會把那一門砲永遠鎖住。
   */
  it('目標死掉之後會在搜尋冷卻內改挑別架', () => {
    const bs = ring()
    const all = flight()
    settle(bs, all)
    const first = bs[0]!.guns[0]!.targetIndex
    expect(first).toBeGreaterThanOrEqual(0)
    all[first]!.alive = false
    settle(bs, all)
    const now = bs[0]!.guns[0]!.targetIndex
    expect(now, '還咬著死掉的那一架').not.toBe(first)
    expect(now, '改成沒有目標').toBeGreaterThanOrEqual(0)
  })
})

/**
 * # 逐關複寫的規格要真的傳到砲上
 *
 * `flakHeavy` 在盟 M2、德 M2、日 M3 都出現。洛伊納的彈幕該比
 * 路邊一座砲位猛得多，所以那一關在卡片上複寫規格 —— 而**漏接一處的症狀是
 * 「複寫靜靜失效」**：那一關照著通用規格打，畫面上一切正常。
 */
describe('陸砲規格的逐關複寫', () => {
  it('createGroundBattery 省略參數時用通用規格', () => {
    expect(createGroundBattery()[0]!.spec).toBe(GROUND_FLAK_SPEC)
  })

  it('給了規格就用那一份，射速跟著變', () => {
    const fast = { ...GROUND_FLAK_SPEC, roundsPerMinute: GROUND_FLAK_SPEC.roundsPerMinute * 2 }
    const b = createGroundTarget(0, 'flakHeavy', 'red', 0, 0, 0)
    b.guns = createGroundBattery(fast)
    expect(b.guns[0]!.spec.roundsPerMinute).toBe(fast.roundsPerMinute)
    const slow = battery()
    // 【量一分鐘】短窗會被起始的轉砲時間吃掉，兩邊的比值就失真
    const n = fired(b, [target(0, 0, 2000, 0)], 60)
    const m = fired(slow, [target(0, 0, 2000, 0)], 60)
    expect(n, `複寫 ${n} 發 vs 通用 ${m} 發`).toBeGreaterThan(m * 1.5)
  })
})

/**
 * # 尺度要一路帶到渲染端
 *
 * `World` 有兩份引爆緩衝：`stepBursts` 算傷害、`burstEvents` 給渲染層。從前者
 * 抄到後者時**漏抄任何一格，`pushBurst` 都會補上 5 吋艦砲的預設值** —— 陸砲的
 * 雲、閃光與震動於是全部照艦砲畫，而且不報錯。
 *
 * 【一定要跑真的 `World`】只驗 `spawnFlak` → `stepFlak` 的話，那一段抄寫不在
 * 路徑上，漏抄照樣綠。
 */
describe('引爆尺度傳到渲染端', () => {
  it('burstEvents 帶的是陸砲的四個尺度，不是艦砲的預設值', () => {
    const w = new World()
    const t = createGroundTarget(0, 'flakHeavy', 'red', 0, 0, 0)
    t.guns = createGroundBattery()
    w.groundTargets.push(t)
    // 【直接餵一發】走完整的射控要先有 combatant，那是另一條路徑的事。
    // 【引信給 0】`fuse` 是 Float32，填 1/240 存進去比 double 的 dt 大 2e-10，
    // 第一步不會引爆
    spawnFlak(
      w.flak, 0, 500, 0, 0, 1, 0, 0, 1,
      GROUND_FLAK_SPEC.burstRadius, GROUND_FLAK_SPEC.burstDamage,
      GROUND_FLAK_SPEC.burstSmoke, GROUND_FLAK_SPEC.burstBlast, GROUND_FLAK_SPEC.burstShake,
    )
    w.step(1 / 240)
    expect(w.burstEvents.count, '沒有引爆事件').toBe(1)
    // 【逐格比對，容 Float32 的捨入】SoA 是 Float32Array，存回來不是原值
    expect(w.burstEvents.radius[0], '半徑').toBeCloseTo(GROUND_FLAK_SPEC.burstRadius, 3)
    expect(w.burstEvents.damage[0], '傷害').toBeCloseTo(GROUND_FLAK_SPEC.burstDamage, 3)
    expect(w.burstEvents.smoke[0], '黑煙').toBeCloseTo(GROUND_FLAK_SPEC.burstSmoke, 3)
    expect(w.burstEvents.blast[0], '閃光').toBeCloseTo(GROUND_FLAK_SPEC.burstBlast, 3)
    expect(w.burstEvents.shake[0], '震動').toBeCloseTo(GROUND_FLAK_SPEC.burstShake, 3)
    // 【與艦砲的預設值不同才測得出漏抄】兩者相同的話這一條恆綠
    expect(GROUND_FLAK_SPEC.burstShake).not.toBe(SHIP_GUN_SPECS.flak.burstShake)
  })
})
