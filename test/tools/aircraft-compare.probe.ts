/**
 * P-51D 與 Bf 109 K-4 的性能對照表。不是測試（`.probe.ts`），**不斷言任何事**。
 *
 * 跑法：`npx vite-node test/tools/aircraft-compare.probe.ts`
 *（`node_modules/.bin` 不存在時改用
 *  `node node_modules/vite-node/vite-node.mjs test/tools/aircraft-compare.probe.ts`）
 *
 * 【為什麼要一支探針而不是抄註解】`specs/*.ts` 的註解記的是**調參當下**的
 * 值，而升限、爬升率、迴旋率全是由 `analysis/envelope.ts` 從空氣動力係數
 * 實算出來的。任何一次調參都可能讓註解與現況分家 —— 這支永遠問現在的程式。
 * `docs/aircraft-balance.md` 的快照也是從這裡貼出去的，那份文件會過期，這支不會。
 *
 * 【印四張表】
 *   一　史實層　　`specs/*.ts` 未經包裝 —— `historical.test.ts` 守的就是這一層
 *   二　遊戲層　　套上 `GAME_FEEL` —— 玩家實際飛的那一台
 *   三　高度階梯　極速／爬升／持續迴旋隨高度的變化（優勢會換手，見文件）
 *   四　史實偏差　兩台各自對真機的百分比
 */
import { P51D, P51D_HISTORICAL } from '../../src/specs/p51d'
import { BF109K4, BF109K4_HISTORICAL } from '../../src/specs/bf109k4'
import { applyFeel, feelFor } from '../../src/specs/feel'
import { batteryDps } from '../../src/weapons/types'
import {
  bestSustainedTurnRate, cornerSpeed, instantaneousTurnRate, maxClimbRate,
  maxLevelSpeed, maxRollRate, serviceCeiling, specificExcessPower, stallSpeed,
} from '../../src/analysis/envelope'
import type { AircraftSpec, HistoricalReference } from '../../src/specs/types'

const MS_KMH = 3.6
const RAD = 180 / Math.PI
const PS = 735.5
/** 遊戲的預設交戰高度（`DEFAULT_BATTLE.altitude`） */
const ALT = 4000

interface Row {
  label: string
  /** 兩機的值。`NaN` = 這一列是分節標題 */
  p: number
  b: number
  digits: number
  /**
   * true = 數字大的比較強；false = 小的比較強；null = **不可比**。
   *
   * 【為什麼要有 null】匯聚距離就是一個：109 的武裝全在中軸線上，匯聚對它
   * 根本沒有意義（`weapons/bf109k4.ts`）。硬標一個贏家會讀成一項優勢。
   */
  higherIsBetter: boolean | null
}

function boxVolume(s: AircraftSpec): number {
  let v = 0
  for (const b of s.hitBoxes) v += 8 * b.half.x * b.half.y * b.half.z
  return v
}

/** 角速處的瞬時迴旋率 —— 「能拉滿 G 的最低速度」上的迴旋率 */
function turnAtCorner(s: AircraftSpec): number {
  return instantaneousTurnRate(s, ALT, cornerSpeed(s, ALT)) * RAD
}

function buildRows(P: AircraftSpec, B: AircraftSpec): Row[] {
  const rows: Row[] = []
  const add = (label: string, p: number, b: number, digits: number,
    higherIsBetter: boolean | null): void => {
    rows.push({ label, p, b, digits, higherIsBetter })
  }
  const section = (label: string): void => {
    rows.push({ label, p: NaN, b: NaN, digits: 0, higherIsBetter: null })
  }
  const powerToWeight = (s: AircraftSpec): number =>
    s.engine.gears[0]!.powerSeaLevel / PS / s.mass

  section('【體格】')
  add('質量 (kg)', P.mass, B.mass, 0, false)
  add('翼面積 (m²)', P.wing.area, B.wing.area, 2, true)
  add('翼展 (m)', P.wing.span, B.wing.span, 2, true)
  add('翼負荷 (kg/m²)', P.mass / P.wing.area, B.mass / B.wing.area, 1, false)
  add('功率重量比 (PS/kg)', powerToWeight(P), powerToWeight(B), 3, true)
  add('命中盒體積 (m³)', boxVolume(P), boxVolume(B), 1, false)

  section('【速度】')
  for (const h of [0, ALT, 7000, 9000]) {
    add(`${h.toLocaleString('en-US')} m 極速 (km/h)`,
      maxLevelSpeed(P, h) * MS_KMH, maxLevelSpeed(B, h) * MS_KMH, 0, true)
  }
  add('VNE (km/h)', P.limits.vne * MS_KMH, B.limits.vne * MS_KMH, 0, true)
  add('零升阻力係數 cd0', P.drag.cd0, B.drag.cd0, 4, false)

  section('【爬升與高度】')
  for (const h of [0, ALT, 8000]) {
    add(`${h.toLocaleString('en-US')} m 爬升 (m/min)`,
      maxClimbRate(P, h).rate * 60, maxClimbRate(B, h).rate * 60, 0, true)
  }
  add('實用升限 (m)', serviceCeiling(P), serviceCeiling(B), 0, true)

  section('【迴旋】')
  add('失速速度 (km/h)', stallSpeed(P, 0, 1) * MS_KMH, stallSpeed(B, 0, 1) * MS_KMH, 0, false)
  add(`角速 @${ALT} m (km/h)`,
    cornerSpeed(P, ALT) * MS_KMH, cornerSpeed(B, ALT) * MS_KMH, 0, false)
  add('瞬時迴旋 @角速 (°/s)', turnAtCorner(P), turnAtCorner(B), 1, true)
  for (const h of [0, ALT, 8000]) {
    add(`持續迴旋 @${h.toLocaleString('en-US')} m (°/s)`,
      bestSustainedTurnRate(P, h) * RAD, bestSustainedTurnRate(B, h) * RAD, 2, true)
  }
  add('結構 G 限（正）', P.limits.gPositive, B.limits.gPositive, 1, true)

  section('【滾轉】')
  for (const v of [400, 550, 650]) {
    add(`滾轉率 @${v} km/h (°/s)`,
      maxRollRate(P, ALT, v / MS_KMH) * RAD, maxRollRate(B, ALT, v / MS_KMH) * RAD, 0, true)
  }

  section(`【能量　Ps @${ALT} m，1 G 平飛的剩餘爬升能力】`)
  for (const v of [300, 450, 600, 700]) {
    add(`${v} km/h (m/s)`,
      specificExcessPower(P, ALT, v / MS_KMH, 1),
      specificExcessPower(B, ALT, v / MS_KMH, 1), 2, true)
  }

  section('【火力】')
  add('DPS (傷害/s)', batteryDps(P.battery), batteryDps(B.battery), 1, true)
  add('瞄準槍初速 (m/s)',
    P.battery.sight.muzzleVelocity, B.battery.sight.muzzleVelocity, 0, true)
  add('匯聚距離（不可比，見上）', P.battery.convergence, B.battery.convergence, 0, null)

  return rows
}

const LABEL_W = 28

function printSheet(title: string, note: string, P: AircraftSpec, B: AircraftSpec): void {
  console.log(`\n${'='.repeat(76)}\n${title}\n${note}\n${'='.repeat(76)}`)
  console.log(`${'項目'.padEnd(LABEL_W - 2)}${'P-51D'.padStart(11)}${'Bf 109 K-4'.padStart(12)}`
    + `  ${'誰佔優'.padEnd(7)} P÷K`)
  console.log('─'.repeat(76))

  let winP = 0
  let winB = 0
  for (const r of buildRows(P, B)) {
    if (Number.isNaN(r.p)) { console.log(r.label); continue }
    const win = r.higherIsBetter === null ? '—'
      : r.higherIsBetter
        ? (r.p > r.b ? 'P-51' : r.p < r.b ? 'K-4' : '相同')
        : (r.p < r.b ? 'P-51' : r.p > r.b ? 'K-4' : '相同')
    if (win === 'P-51') winP++
    else if (win === 'K-4') winB++
    console.log(`  ${r.label.padEnd(LABEL_W - 2)}`.slice(0, LABEL_W).padEnd(LABEL_W)
      + r.p.toFixed(r.digits).padStart(11) + r.b.toFixed(r.digits).padStart(12)
      + `  ${win.padEnd(7)} ${(r.p / r.b).toFixed(2)}`)
  }
  console.log('─'.repeat(76))
  // 【勝場數只是索引，不是結論】它把「爬升快 42%」與「翼展多 14%」算成同一票。
  // 真正的判讀在 docs/aircraft-balance.md。
  console.log(`勝場：P-51 ${winP} 項、K-4 ${winB} 項　（**只是索引，不是強弱結論** —— `
    + '每一項都算一票，量級被抹平了）')
}

function printLadder(): void {
  console.log(`\n${'='.repeat(76)}\n【三】高度階梯 —— 史實層`)
  console.log('優勢會換手：兩台的增壓器換檔高度不同（P-51 在 1,900／5,900 m，K-4 單檔 6,000 m）')
  console.log('='.repeat(76))
  console.log('高度        極速 P-51    K-4     差     爬升比 K÷P     持續迴旋差 P−K')
  console.log('─'.repeat(76))
  for (const h of [0, 1000, 2000, 3000, 4000, 5000, 6000, 7000, 8000, 9000, 10000]) {
    const vp = maxLevelSpeed(P51D, h) * MS_KMH
    const vb = maxLevelSpeed(BF109K4, h) * MS_KMH
    const cp = maxClimbRate(P51D, h).rate * 60
    const cb = maxClimbRate(BF109K4, h).rate * 60
    const tp = bestSustainedTurnRate(P51D, h) * RAD
    const tb = bestSustainedTurnRate(BF109K4, h) * RAD
    const signed = (x: number, d: number): string => (x >= 0 ? '+' : '') + x.toFixed(d)
    console.log(`${(`${h} m`).padStart(9)}  ${vp.toFixed(0).padStart(8)}${vb.toFixed(0).padStart(8)}`
      + `${signed(vp - vb, 0).padStart(7)}${(cb / cp).toFixed(2).padStart(13)}`
      + `${signed(tp - tb, 2).padStart(19)}`)
  }
}

function printHistorical(): void {
  const hp: HistoricalReference = P51D_HISTORICAL
  const hb: HistoricalReference = BF109K4_HISTORICAL
  console.log(`\n${'='.repeat(76)}\n【四】史實層對真機的偏差`)
  console.log('`historical.test.ts` 守的就是這幾項（兩台都是 ±5%）')
  console.log('='.repeat(76))
  const rows: [string, number, number, number, number][] = [
    ['海平面極速 km/h', hp.vmaxSeaLevel * MS_KMH, hb.vmaxSeaLevel * MS_KMH,
      maxLevelSpeed(P51D, 0) * MS_KMH, maxLevelSpeed(BF109K4, 0) * MS_KMH],
    ['臨界高度極速 km/h', hp.vmaxAtCritical.speed * MS_KMH, hb.vmaxAtCritical.speed * MS_KMH,
      maxLevelSpeed(P51D, hp.vmaxAtCritical.altitude) * MS_KMH,
      maxLevelSpeed(BF109K4, hb.vmaxAtCritical.altitude) * MS_KMH],
    ['海平面爬升 m/min', hp.climbRateSeaLevel * 60, hb.climbRateSeaLevel * 60,
      maxClimbRate(P51D, 0).rate * 60, maxClimbRate(BF109K4, 0).rate * 60],
    ['實用升限 m', hp.serviceCeiling, hb.serviceCeiling,
      serviceCeiling(P51D), serviceCeiling(BF109K4)],
    ['失速速度 km/h', hp.stallSpeed * MS_KMH, hb.stallSpeed * MS_KMH,
      stallSpeed(P51D, 0, 1) * MS_KMH, stallSpeed(BF109K4, 0, 1) * MS_KMH],
  ]
  console.log(`${'項目'.padEnd(20)}${'P-51 史實'.padStart(10)}${'模型'.padStart(9)}${'偏差'.padStart(9)}`
    + `${'K-4 史實'.padStart(11)}${'模型'.padStart(9)}${'偏差'.padStart(9)}`)
  console.log('─'.repeat(76))
  const dev = (m: number, h: number): string => {
    const e = (m - h) / h * 100
    return `${e >= 0 ? '+' : ''}${e.toFixed(2)}%`
  }
  for (const [label, histP, histB, modelP, modelB] of rows) {
    console.log(label.padEnd(20)
      + histP.toFixed(0).padStart(10) + modelP.toFixed(0).padStart(9) + dev(modelP, histP).padStart(9)
      + histB.toFixed(0).padStart(11) + modelB.toFixed(0).padStart(9) + dev(modelB, histB).padStart(9))
  }
  const ratioModel = maxClimbRate(BF109K4, 0).rate / maxClimbRate(P51D, 0).rate
  const ratioHist = hb.climbRateSeaLevel / hp.climbRateSeaLevel
  console.log(`\n海平面爬升比 K-4÷P-51：模型 ${ratioModel.toFixed(4)}、`
    + `史實 ${ratioHist.toFixed(4)}（${dev(ratioModel, ratioHist)}）`)
}

printSheet(
  '【一】史實層 —— `specs/*.ts` 未經包裝',
  '`historical.test.ts` 跑的就是這一層。它守著「這兩台仍然是真飛機」。',
  P51D, BF109K4,
)
printSheet(
  '【二】遊戲層 —— 套上 `GAME_FEEL`',
  '玩家實際飛的那一台。倍率見 `specs/feel.ts`，對兩台一視同仁。',
  applyFeel(P51D, feelFor(P51D)), applyFeel(BF109K4, feelFor(BF109K4)),
)
printLadder()
printHistorical()
console.log(`\nGAME_FEEL 倍率：${JSON.stringify(feelFor(P51D))}\n`)
