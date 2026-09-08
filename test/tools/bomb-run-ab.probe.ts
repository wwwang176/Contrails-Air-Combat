import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { SHIP_CLASSES, createShip } from '../../src/world/ships'
import { G4M } from '../../src/specs/g4m'
import { makeBombProfile, RUN_SETTLE } from '../../src/ai/bombRun'
import { Vector3 } from 'three'
import type { StrikeProfile } from '../../src/ai/strikeRun'

/**
 * 三組對照：直線段與脫離距離該不該存在。
 *
 * 【為什麼要對照組】要驗的疑點是「投彈直飛 1,200 m 不該存在，
 * AI 只要算得中就該投」。物理上那是對的（解算吃的是當下的速度向量，與姿態
 * 無關），但拿掉直線段之後落點誤差進不了窗（最近 37 m，窗 18.8 m）。
 * 這一支就是去分辨那 1,200 m 到底在做什麼。
 *
 * 一台 G4M、一艘不開火的威奇塔，五分鐘。
 */

const DT = 1 / 240

function trial(name: string, profile: StrikeProfile, shipSpeed: number): void {
  const w = new World()
  w.crashPolicy = () => false
  const ship = createShip(0, SHIP_CLASSES.wichita, 'red', 0, -4000, 0, shipSpeed)
  ship.guns = []
  ship.gunCooldowns = new Float32Array(0)
  // 【打不沉的靶】要量的是循環時間，而船沉了就沒有下一趟 —— 前一版四組
  // 都停在「趟數 2」正是因為威奇塔在兩趟內就沉了，快慢完全看不出來
  ship.hp = 1e9
  w.ships.push(ship)
  const ai = new AiController()
  const c = w.add(new Aircraft(G4M), ai, 'blue', new Vector3(0, 1000, 1000), 1000, 110)
  c.aircraft.state.position.set(0, 1000, 1000)
  c.aircraft.prevPosition.copy(c.aircraft.state.position)
  ai.board = createTargetBoard([c])
  ai.selfIndex = 0
  ai.ships = w.ships
  ai.bombBay = c.bombBay
  ai.bombDrag = w.bombDrag
  ai.strikeProfile = profile

  const hp0 = ship.hp
  const misses: number[] = []
  let passes = 0
  let loaded = true
  const dropTimes: number[] = []

  for (let i = 0; i < 300 * 240; i++) {
    const before = w.bombEvents.count
    w.step(DT)
    for (let e = before; e < w.bombEvents.count; e++) {
      const o = e * 6
      misses.push(Math.hypot(
        w.bombEvents.data[o]! - ship.position.x,
        w.bombEvents.data[o + 2]! - ship.position.z,
      ))
    }
    w.bombEvents.count = 0
    const L = c.bombBay.load > 0
    if (loaded && !L) { passes++; dropTimes.push(i / 240) }
    loaded = L
  }

  const hits = misses.filter((m) => m < 40).length
  const gaps: number[] = []
  for (let i = 1; i < dropTimes.length; i++) gaps.push(dropTimes[i]! - dropTimes[i - 1]!)
  const cycle = gaps.length === 0 ? NaN : gaps.reduce((a, b) => a + b, 0) / gaps.length
  void hp0
  console.log(
    `  ${name.padEnd(22)} 趟=${String(passes).padStart(2)} 枚=${String(misses.length).padStart(3)}`
    + ` 命中(<40m)=${String(hits).padStart(3)}`
    + ` 平均循環=${cycle.toFixed(0).padStart(4)}s`
    + `  投彈時刻 ${dropTimes.map((t) => t.toFixed(0)).join(',')}`,
  )
}

/**
 * 【脫離距離已經是推導的，不再是變因】剩下唯一的旋鈕是直線段，它是投彈窗
 * 的餘裕（見 `bombRun.ts` 的 `RUN_SETTLE`）。0 那一組是對照：餘裕歸零時
 * 飛機在窗口正中央才轉直飛。
 */
const CASES: [string, StrikeProfile][] = [
  ['直線段 0', makeBombProfile(0)],
  [`直線段 ${RUN_SETTLE}（上場的）`, makeBombProfile(RUN_SETTLE)],
  ['直線段 1200', makeBombProfile(1200)],
]

for (const speed of [0, 8]) {
  console.log(`── 船速 ${speed} m/s ──`)
  for (const [name, prof] of CASES) trial(name, prof, speed)
  console.log('')
}
