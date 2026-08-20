/**
 * 把兩台轟炸機的飛行參數逐項列出來 —— spec 值、套手感後的出貨值、算出來的
 * 性能，三欄並排。P-51D 放在最右邊當比例尺。
 *
 *   npx tsx test/tools/spec-dump.probe.ts
 */
import {
  maxLevelSpeed, maxClimbRate, stallSpeed, serviceCeiling,
  cornerSpeed, bestSustainedTurnRate, maxRollRate,
} from '../../src/analysis/envelope'
import { derivedClMax } from '../../src/specs/types'
import { P51D } from '../../src/specs/p51d'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import { applyFeel, feelFor } from '../../src/specs/feel'
import type { AircraftSpec } from '../../src/specs/types'

const KMH = 3.6
const DEG = 180 / Math.PI
const PS = 735.5
const W = 12

const SPECS = [HE111, B17G, P51D]
const SHIP = SPECS.map((s) => applyFeel(s, feelFor(s)))

const pad = (v: string): string => v.padStart(W)
const num = (v: number, d: number): string => pad(v.toFixed(d))

function line(label: string, f: (s: AircraftSpec) => string, from = SPECS): void {
  console.log('  ' + label.padEnd(26) + from.map(f).join(''))
}
function head(title: string): void {
  console.log(`\n── ${title} ${'─'.repeat(Math.max(0, 58 - title.length))}`)
}

console.log('\n' + ' '.repeat(28) + ['He 111 H-6', 'B-17G', 'P-51D'].map(pad).join(''))

head('機體')
line('定位', (s) => pad(s.role))
line('陣營', (s) => pad(s.faction))
line('戰鬥重量 kg', (s) => num(s.mass, 0))
line('慣量 pitch kg·m²', (s) => num(s.inertia.pitch, 0))
line('慣量 yaw', (s) => num(s.inertia.yaw, 0))
line('慣量 roll', (s) => num(s.inertia.roll, 0))
line('結構 HP', (s) => num(s.hp, 0))

head('機翼')
line('翼面積 m²', (s) => num(s.wing.area, 2))
line('翼展 m', (s) => num(s.wing.span, 2))
line('平均弦長 m', (s) => num(s.wing.chord, 2))
line('展弦比', (s) => num((s.wing.span ** 2) / s.wing.area, 2))
line('翼載 kg/m²', (s) => num(s.mass / s.wing.area, 1))
line('Oswald 效率', (s) => num(s.wing.oswald, 2))

head('升力')
line('升力線斜率 /rad', (s) => num(s.lift.clAlpha, 2))
line('零升迎角 °', (s) => num(s.lift.alphaZero * DEG, 1))
line('失速迎角 °', (s) => num(s.lift.alphaCrit * DEG, 1))
line('失速過渡寬度 °', (s) => num(s.lift.stallBlend * DEG, 1))
line('失速後 CL 比例', (s) => num(s.lift.postStallFactor, 2))
line('前緣縫翼加成 °', (s) => num(s.lift.slatAlphaBonus * DEG, 1))
line('推導 CL_max', (s) => num(derivedClMax(s, false), 3))

head('阻力')
line('cd0', (s) => num(s.drag.cd0, 4))
line('等效平板面積 m²', (s) => num(s.drag.cd0 * s.wing.area, 3))
line('側滑阻力 /rad²', (s) => num(s.drag.cdBeta, 2))
line('臨界馬赫', (s) => num(s.drag.machCrit, 2))
line('超音阻力強度', (s) => num(s.drag.machDragFactor, 0))
line('側力係數 /rad', (s) => num(s.side.cyBeta, 2))

head('力矩與穩定導數')
line('cm0（零迎角俯仰）', (s) => num(s.moments.cm0, 3))
line('cmAlpha（縱向靜穩定）', (s) => num(s.moments.cmAlpha, 2))
line('cmQ（俯仰阻尼）', (s) => num(s.moments.cmQ, 1))
line('cmDe（升降舵權限）', (s) => num(s.moments.cmDe, 2))
line('clBeta（上反效應）', (s) => num(s.moments.clBeta, 3))
line('clP（滾轉阻尼）', (s) => num(s.moments.clP, 2))
line('clDa（副翼權限）', (s) => num(s.moments.clDa, 3))
line('cnBeta（方向靜穩定）', (s) => num(s.moments.cnBeta, 3))
line('cnR（偏航阻尼）', (s) => num(s.moments.cnR, 2))
line('cnDr（方向舵權限）', (s) => num(s.moments.cnDr, 3))

head('高速重舵')
line('參考動壓 Pa', (s) => num(s.controlStiffening.qRef, 0))
line('副翼指數 k', (s) => num(s.controlStiffening.aileronK, 2))
line('升降舵指數 k', (s) => num(s.controlStiffening.elevatorK, 2))
line('方向舵指數 k', (s) => num(s.controlStiffening.rudderK, 2))

head('動力')
line('WEP 海平面 PS', (s) => num(s.engine.gears[0]!.powerSeaLevel / PS, 0))
line('臨界高度功率 PS', (s) => num(s.engine.gears[0]!.powerCritical / PS, 0))
line('臨界高度 m', (s) => num(s.engine.gears[0]!.altCritical, 0))
line('功率重量比 PS/kg', (s) => num(s.engine.gears[0]!.powerSeaLevel / PS / s.mass, 3))
line('衝壓恢復效率', (s) => num(s.engine.ramEfficiency, 2))
line('槳盤直徑 m', (s) => num(s.prop.diameter, 2))
line('etaMax（漸近上界）', (s) => num(s.prop.etaMax, 2))
line('vRef m/s', (s) => num(s.prop.vRef, 0))
line('靜推力品質因子', (s) => num(s.prop.figureOfMerit, 2))

head('限制')
line('正過載 G', (s) => num(s.limits.gPositive, 1))
line('負過載 G', (s) => num(s.limits.gNegative, 1))
line('不可超越速度 km/h', (s) => num(s.limits.vne * KMH, 0))

head('算出來的性能：未套手感（= L2 拿去比史實的那一份）')
line('海平面極速 km/h', (s) => num(maxLevelSpeed(s, 0) * KMH, 1))
line('4,000 m 極速', (s) => num(maxLevelSpeed(s, 4000) * KMH, 1))
line('海平面爬升 m/s', (s) => num(maxClimbRate(s, 0).rate, 2))
line('海平面失速 km/h', (s) => num(stallSpeed(s, 0, 1) * KMH, 1))
line('實用升限 m', (s) => num(serviceCeiling(s), 0))
line('角落速度 km/h @3km', (s) => num(cornerSpeed(s, 3000) * KMH, 1))
line('持續迴旋 °/s @3km', (s) => num(bestSustainedTurnRate(s, 3000) * DEG, 1))
line('滾轉率 °/s @400km/h', (s) => num(maxRollRate(s, 3000, 400 / KMH) * DEG, 1))

head('出貨值：套 GAME_FEEL／BOMBER_FEEL 之後（玩家實際飛到的）')
line('手感輪廓', (s) => pad(s.role === 'bomber' ? 'BOMBER' : 'GAME'), SPECS)
line('海平面極速 km/h', (s) => num(maxLevelSpeed(s, 0) * KMH, 1), SHIP)
line('4,000 m 極速', (s) => num(maxLevelSpeed(s, 4000) * KMH, 1), SHIP)
line('海平面爬升 m/s', (s) => num(maxClimbRate(s, 0).rate, 2), SHIP)
line('海平面失速 km/h', (s) => num(stallSpeed(s, 0, 1) * KMH, 1), SHIP)
line('實用升限 m', (s) => num(serviceCeiling(s), 0), SHIP)
line('角落速度 km/h @3km', (s) => num(cornerSpeed(s, 3000) * KMH, 1), SHIP)
line('持續迴旋 °/s @3km', (s) => num(bestSustainedTurnRate(s, 3000) * DEG, 1), SHIP)
line('滾轉率 °/s @400km/h', (s) => num(maxRollRate(s, 3000, 400 / KMH) * DEG, 1), SHIP)
console.log()
