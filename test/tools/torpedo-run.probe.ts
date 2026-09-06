import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { G4M } from '../../src/specs/g4m'
import { A6M5 } from '../../src/specs/a6m5'
import { resetBombBay } from '../../src/weapons/bomb'
import { TORPEDO_PROFILE, diagnose } from '../../src/ai/torpedoRun'
import { TORPEDO_ENVELOPE, canRelease } from '../../src/weapons/releaseEnvelope'
import { attitudeFromOrientation as att2 } from '../../src/hud/attitude-math'
import type { StrikeProfile } from '../../src/ai/strikeRun'
import { TORPEDO_RANGE } from '../../src/world/torpedo'
import { attitudeFromOrientation } from '../../src/hud/attitude-math'
import { DEG } from '../../src/core/math'
import type { Loadout } from '../../src/weapons/stores'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * # 雷擊的乾淨戰場
 *
 * **一台掛雷的飛機、一艘不還擊也沉不了的船，五分鐘。** 與
 * `bomb-run-ab.probe.ts` 同一個形狀 —— 那一支的註解寫著為什麼靶要打不沉：
 * 船沉了就沒有下一趟，四組都會停在「趟數 2」，快慢完全看不出來。
 *
 * 要回答的是負責人 2026-09-07 的三件事：投得出去嗎、會不會自殺、命中率
 * 多少。夾角不設門檻（見 `ai/torpedoRun.ts`），但**要量出來** —— 之後決定
 * 要不要加門檻靠的是這張表。
 *
 * ```
 *   npx vite-node test/tools/torpedo-run.probe.ts
 * ```
 */

const DT = 1 / 240
const TRACE = process.env.TRACE === '1'
const SECONDS = 300

/** 掛一枚魚雷。零戰不在機種表裡（負責人裁定：只在測試場裡掘），直接塞。 */
const TORPEDO: Loadout = {
  kind: 'torpedo', count: 1, damage: 15_000, reloadSeconds: 45,
}

interface Drop {
  /** 投放時刻，s */
  at: number
  /** 投放高度（海面之上），m */
  alt: number
  /** 坡度與俯仰，deg */
  roll: number
  pitch: number
  /** 投放時離船多遠，m */
  range: number
  /**
   * 夾角，deg。**0 = 尾追、90 = 正橫、180 = 迎面。**
   * 雷的航向與船艏向的夾角 —— 決定目標投影是 12 m 還是 114 m。
   */
  aspect: number
  /** 這一枚最接近船心多少，m。`Infinity` = 還沒結束就收工了 */
  closest: number
  /** 0 = 撞岸／1 = 命中船／−1 = 射程用盡（無事件） */
  end: number
}

function trial(
  name: string, spec: AircraftSpec, shipSpeed: number,
  profile: StrikeProfile = TORPEDO_PROFILE,
  shipId: keyof typeof SHIP_CLASSES = 'fletcher',
): void {
  const w = new World()
  const ship = createShip(0, SHIP_CLASSES[shipId], 'red', 0, -4000, 0, shipSpeed)
  // 【打不沉、不還擊】要量的是循環時間與命中率，不是誰先死
  ship.guns = []
  ship.gunCooldowns = new Float32Array(0)
  ship.hp = 1e9
  w.ships.push(ship)

  const ai = new AiController()
  const c = w.add(new Aircraft(spec), ai, 'blue', new Vector3(0, 1000, 1000), 1000, 110)
  c.aircraft.state.position.set(0, 1000, 1000)
  c.aircraft.prevPosition.copy(c.aircraft.state.position)
  c.loadout = TORPEDO
  resetBombBay(c.bombBay, TORPEDO)
  ai.board = createTargetBoard([c])
  ai.selfIndex = 0
  ai.ships = w.ships
  ai.bombBay = c.bombBay
  ai.bombDrag = w.bombDrag
  ai.strikeProfile = profile

  const drops: Drop[] = []
  /** 池子的格子 → `drops` 的索引。−1 = 這一格不是這一輪的 */
  const slotOf = new Int32Array(w.torpedoes.capacity).fill(-1)
  let loaded = true
  let died = -1
  let lowTicks = 0
  let runTicks = 0
  const blocked = { env: 0, geom: 0, both: 0 }
  const SHIP_DIR = new Vector3()

  for (let i = 0; i < SECONDS * 240; i++) {
    const before = w.torpedoEvents.count
    const dropped0 = w.torpedoes.dropped
    w.step(DT)

    // ── 投放的那一拍 ────────────────────────────────
    if (w.torpedoes.dropped > dropped0) {
      const p = c.aircraft.state.position
      const v = c.aircraft.state.velocity
      const att = attitudeFromOrientation(c.aircraft.state.orientation)
      const hl = Math.hypot(v.x, v.z)
      SHIP_DIR.set(0, 0, -1).applyQuaternion(ship.orientation)
      const cos = hl > 1e-9
        ? (v.x / hl) * SHIP_DIR.x + (v.z / hl) * SHIP_DIR.z
        : 1
      drops.push({
        at: i / 240,
        alt: p.y,
        roll: att.roll / DEG,
        pitch: att.pitch / DEG,
        range: Math.hypot(ship.position.x - p.x, ship.position.z - p.z),
        aspect: Math.acos(Math.max(-1, Math.min(1, cos))) / DEG,
        closest: Infinity,
        end: -1,
      })
      // 剛生出來的那一格：`spawn` 的 cursor 是 dropped−1 對 capacity 取模
      slotOf[(w.torpedoes.dropped - 1) % w.torpedoes.capacity] = drops.length - 1
    }

    // ── 每一枚活著的雷離船多近 ──────────────────────
    const t = w.torpedoes
    for (let k = 0; k < t.capacity; k++) {
      const di = slotOf[k]!
      if (di < 0 || t.active[k] === 0 || t.phase[k] !== 1) continue
      const d = Math.hypot(t.x[k]! - ship.position.x, t.z[k]! - ship.position.z)
      const rec = drops[di]!
      if (d < rec.closest) rec.closest = d
    }

    // ── 引爆事件 ────────────────────────────────────
    for (let e = before; e < w.torpedoEvents.count; e++) {
      const o = e * 6
      const kind = w.torpedoEvents.data[o + 3]!
      // 【事件不帶格子】用「最近一枚還沒收尾的」對上去 —— 一次只有一枚在飛
      for (let d = drops.length - 1; d >= 0; d--) {
        if (drops[d]!.end === -1) { drops[d]!.end = kind; break }
      }
    }
    w.torpedoEvents.count = 0

    if (died < 0 && c.hp <= 0) died = i / 240
    if (c.aircraft.state.position.y < 5) lowTicks++
    // ── 直飛段：為什麼這一拍沒投 ──────────────────
    if (i % 120 === 0 && ai.strike.phase === 'run' && c.bombBay.load > 0) {
      runTicks++
      const d = diagnose(c.aircraft, ship)
      const a = att2(c.aircraft.state.orientation)
      const p2 = c.aircraft.state.position
      const env = canRelease(TORPEDO_ENVELOPE, a.roll, a.pitch, p2.y,
        c.aircraft.diag.aero.tas)
      if (!env) blocked.env++
      if (!d.ok) blocked.geom++
      if (env && d.ok) blocked.both++
      if (TRACE) {
        console.log(`      run t=${(i / 240).toFixed(0).padStart(3)}s`
          + ` alt=${p2.y.toFixed(0).padStart(3)}`
          + ` range=${Math.hypot(ship.position.x - p2.x, ship.position.z - p2.z).toFixed(0).padStart(4)}`
          + ` 航程=${d.run.toFixed(0).padStart(4)}`
          + ` 沿艦=${d.along.toFixed(0).padStart(6)}/${d.wAlong.toFixed(0)}`
          + ` 橫艦=${d.across.toFixed(0).padStart(6)}/${d.wAcross.toFixed(0)}`
          + ` 坡度=${(a.roll / DEG).toFixed(1).padStart(6)}`
          + ` 俯仰=${(a.pitch / DEG).toFixed(1).padStart(5)}`
          + ` 包絡=${env ? '過' : '擋'}`)
      }
    }
    const L = c.bombBay.load > 0
    loaded = L
    void loaded
  }

  // ── 報表 ────────────────────────────────────────
  const gaps: number[] = []
  for (let i = 1; i < drops.length; i++) gaps.push(drops[i]!.at - drops[i - 1]!.at)
  const mean = (a: number[]): number =>
    a.length === 0 ? NaN : a.reduce((x, y) => x + y, 0) / a.length
  const hits = drops.filter((d) => d.end === 1).length
  const spent = drops.filter((d) => d.end === -1).length
  const shore = drops.filter((d) => d.end === 0).length
  const closest = drops.filter((d) => Number.isFinite(d.closest)).map((d) => d.closest)

  console.log(`  ${name.padEnd(26)}`
    + ` 投=${String(drops.length).padStart(2)}`
    + ` 中=${String(hits).padStart(2)}`
    + ` 射程用盡=${String(spent).padStart(2)}`
    + ` 撞岸=${String(shore).padStart(2)}`
    + ` 循環=${gaps.length === 0 ? '  －' : mean(gaps).toFixed(0).padStart(3)}s`
    + ` 最近=${closest.length === 0 ? ' －' : mean(closest).toFixed(0).padStart(4)}m`
    + (died >= 0 ? `  ☠ ${died.toFixed(0)}s` : '')
    + (lowTicks > 240 ? `  ⚠ 貼海 ${(lowTicks / 240).toFixed(0)}s` : ''))
  if (runTicks > 0) {
    console.log(`      直飛段抽樣 ${runTicks} 拍：包絡擋 ${blocked.env}`
      + `　幾何不成立 ${blocked.geom}　兩者都過 ${blocked.both}`)
  }
  if (drops.length > 0) {
    console.log(`      投放時：高度 ${mean(drops.map((d) => d.alt)).toFixed(0)} m`
      + `　坡度 ${mean(drops.map((d) => Math.abs(d.roll))).toFixed(1)}°`
      + `　俯仰 ${mean(drops.map((d) => d.pitch)).toFixed(1)}°`
      + `　距離 ${mean(drops.map((d) => d.range)).toFixed(0)} m`
      + `　夾角 ${drops.map((d) => d.aspect.toFixed(0)).join('/')}`)
    console.log(`      最近距離 ${drops.map((d) =>
      Number.isFinite(d.closest) ? d.closest.toFixed(0) : '－').join(', ')} m`)
  }
}

console.log(`雷程 ${TORPEDO_RANGE} m｜航路高度 ${TORPEDO_PROFILE.runAltitude} m`
  + `｜${SECONDS} 秒｜靶：不還擊、打不沉`)
for (const speed of [0, 8]) {
  console.log(`── 船速 ${speed} m/s ──`)
  trial('G4M 一式陸攻', G4M, speed)
  if (!TRACE) trial('A6M5 零戰（測試場限定）', A6M5, speed)
  console.log('')
}
