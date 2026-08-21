/**
 * 彈丸池的高水位 —— **「池子夠不夠大」只有量得出來。**
 *
 *   npx tsx test/tools/projectile-peak.probe.ts
 *
 * 【為什麼要量】池滿時是**覆寫最舊的那一發**，不是拒絕發射（`Projectiles`
 * 的 `spawn` 註解：射擊永遠有反應，比「扣了扳機沒動靜」好）。也就是說
 * 溢位不會有任何錯誤，只會讓遠處的曳光彈憑空消失 —— 一個看得到但查不到的
 * 缺陷。160 座砲塔把每步的生成量提高了一個量級，所以這一輪必須重量。
 *
 * 【為什麼讀 `peakLive` 而不是每步讀 `live`】在 `stepBattle` 回來之後讀
 * 會低估：一步之內是生成 → 推進／過期 → 命中／回收，讀到的是回收後的殘量。
 * `peakLive` 在 `spawn()` 裡更新，抓得到生成瞬間的尖峰。
 */
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { PROJECTILE_CAPACITY } from '../../src/world/Projectiles'
import { P51D } from '../../src/specs/p51d'
import { B17G } from '../../src/specs/b17g'
import { BF109G6 } from '../../src/specs/bf109g6'
import type { AircraftSpec } from '../../src/specs/types'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

const DT = 1 / 240
const SECONDS = 300

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

function measure(label: string, red: AircraftSpec): void {
  const b = createBattle(new Idle(), {
    ...DEFAULT_BATTLE, blueSpec: P51D, redSpec: red, blueCount: 20, redCount: 20,
  }, 20260821)
  let sum = 0
  const steps = SECONDS / DT
  for (let k = 0; k < steps; k++) {
    stepBattle(b, DT)
    sum += b.world.projectiles.live
  }
  const peak = b.world.projectiles.peakLive
  const pct = (peak / PROJECTILE_CAPACITY) * 100
  console.log(`  ${label.padEnd(22)}峰值 ${String(peak).padStart(5)}`
    + `  平均 ${(sum / steps).toFixed(0).padStart(5)}`
    + `  佔容量 ${pct.toFixed(1).padStart(5)}%`)
}

console.log(`  20v20、300 秒、池容量 ${PROJECTILE_CAPACITY}`)
measure('P-51D vs Bf 109 G-6', BF109G6)
measure('P-51D vs B-17G（砲塔）', B17G)
