import { describe, it, expect } from 'vitest'
import { createBattle, stepBattle, DEFAULT_BATTLE, type Battle } from '../../src/battle/setup'
import { PURSUIT } from '../../src/battle/entry'
import { lineAbreast } from '../../src/battle/order'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SEED = 20260820
const STEPS = 240 * 30

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

/**
 * 【要自己組 BattleConfig，不要用 battleConfigFrom】那個函數的 `redSpec`
 * 取的是**敵方陣營的第一台**，不是你指定的那台 —— 傳
 * `{ faction: 'allies', specId: 'b17g' }` 得到的是「藍隊 B-17G vs 紅隊
 * Bf 109」，場景裡根本沒有 P-51D。
 *
 * 【要近距離】砲塔的射程上界只有約 1.46 km，而預設遭遇戰兩隊相距約 10 km，
 * 跑 30 秒可能一發都沒射 —— 那樣「逐位元相同」就只證明了飛機的確定性。
 *
 * 編制由 `lineAbreast(擺法, 藍機種, 藍架數, 紅機種, 紅架數)` 組出來；擺法
 * 取 `battle/entry.ts` 匯出的 `PURSUIT`：兩隊同向同速、紅隊在後方 400 m
 * 且高 200 m。
 */
function config(): typeof DEFAULT_BATTLE {
  return {
    ...DEFAULT_BATTLE,
    units: lineAbreast(PURSUIT, P51D, 8, B17G, 8),
  }
}

/**
 * 把整個世界壓成一條固定順序的浮點序列。
 *
 * 【為什麼要涵蓋這麼多】只比飛機位置的話，一個「砲塔完全不動」的壞實作
 * 也會通過 —— 砲塔不影響飛行。彈丸的**速度與生成點**是搖晃唯一的外顯，
 * 不比它就等於沒測到搖晃的確定性。
 */
function snapshot(b: Battle): Float64Array {
  const cs = b.world.combatants
  const p = b.world.projectiles
  const out: number[] = [b.world.time, p.live]
  for (const c of cs) {
    const st = c.aircraft.state
    out.push(st.position.x, st.position.y, st.position.z)
    out.push(st.velocity.x, st.velocity.y, st.velocity.z)
    out.push(st.angularVelocity.x, st.angularVelocity.y, st.angularVelocity.z)
    out.push(st.orientation.x, st.orientation.y, st.orientation.z, st.orientation.w)
    out.push(c.hp, c.alive ? 1 : 0, c.hitsDealt)
    for (let i = 0; i < c.cooldowns.length; i++) out.push(c.cooldowns[i]!)
    for (let i = 0; i < c.muzzleFlash.length; i++) out.push(c.muzzleFlash[i]!)
    for (const t of c.turretStates) {
      out.push(t.aim.x, t.aim.y, t.aim.z)
      out.push(t.phase, t.targetIndex, t.searchCooldown)
      out.push(t.burstFiring ? 1 : 0, t.burstTimer, t.flash, t.lastBarrel)
    }
    for (let i = 0; i < c.turretCooldowns.length; i++) out.push(c.turretCooldowns[i]!)
  }
  for (let i = 0; i < p.capacity; i++) {
    out.push(p.owner[i]!, p.damage[i]!, p.age[i]!)
    out.push(p.sx[i]!, p.sy[i]!, p.sz[i]!)
    out.push(p.x[i]!, p.y[i]!, p.z[i]!)
    out.push(p.vx[i]!, p.vy[i]!, p.vz[i]!)
  }
  return Float64Array.from(out)
}

function run(): Battle {
  const b = createBattle(new Idle(), config(), SEED)
  for (let k = 0; k < STEPS; k++) stepBattle(b, DT)
  return b
}

/**
 * 真正的逐位元比較。
 *
 * 【為什麼不用 `!==`】`+0 !== -0` 是 false（會被當成相同），而
 * `NaN !== NaN` 是 true（會被當成不同）—— 兩個方向都與「逐位元」相反。
 * 比較底層的位元組才是逐位元。
 */
function expectIdentical(a: Float64Array, c: Float64Array): void {
  expect(a.length).toBe(c.length)
  const ba = new Uint8Array(a.buffer, a.byteOffset, a.byteLength)
  const bc = new Uint8Array(c.buffer, c.byteOffset, c.byteLength)
  for (let i = 0; i < ba.length; i++) {
    if (ba[i] !== bc[i]) {
      const el = Math.floor(i / 8)
      throw new Error(`第 ${el} 個元素的第 ${i % 8} 個位元組不同：${a[el]} vs ${c[el]}`)
    }
  }
}

describe('砲塔的逐位元重播（P-51D 8 對 B-17G 8、追擊起始、30 秒）', () => {
  /**
   * 【要逐步累積，不能只看結束時還活著的彈丸】彈丸壽命只有 1.2 秒。整場
   * 打了幾千發、但最後 1.2 秒剛好沒打，收場時 `live` 就是 0 —— 那個檢查
   * 會誤報「整場沒開火」。
   */
  it('砲塔真的開火了 —— 否則下一條只證明了飛機的確定性', () => {
    const b = createBattle(new Idle(), config(), SEED)
    const bomberIndices = new Set(
      b.world.combatants.filter((c) => c.aircraft.spec.turrets.length > 0)
        .map((c) => c.index))
    let sawTurretShot = 0
    let prevLive = 0
    for (let k = 0; k < STEPS; k++) {
      stepBattle(b, DT)
      const p = b.world.projectiles
      if (p.live > prevLive) {
        for (let i = 0; i < p.capacity; i++) {
          if (bomberIndices.has(p.owner[i]!)) { sawTurretShot++; break }
        }
      }
      prevLive = p.live
    }
    expect(sawTurretShot, '整場沒有任何一發來自砲塔，重播測試等於沒測到搖晃')
      .toBeGreaterThan(0)
  }, 5 * 60 * 1000)

  it('兩場全新的相同戰局逐位元相同', () => {
    expectIdentical(snapshot(run()), snapshot(run()))
  }, 5 * 60 * 1000)
})
