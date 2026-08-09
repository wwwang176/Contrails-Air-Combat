/**
 * 視野項候選形狀對**既有不變式**的影響。**不是測試**（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/vision-shape.probe.ts`
 *
 * 【為什麼要先算這個】`ai-target.test.ts` 有一條「正前方但很遠的目標，輸給
 * 側面但很近的目標」—— 它守的是「切換成本只是折扣，不會讓飛機黏死」，也
 * 正是當年殺掉 `turnWeight = 3` 的那一條。任何壓低側面目標的乘法項都可能
 * 打破它。先算，不要先寫。
 */
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { targetScore, DEFAULT_TARGET } from '../../src/ai/target'
import { instantaneousTurnRate } from '../../src/analysis/envelope'
import { P51D } from '../../src/specs/p51d'

const UP = new Vector3(0, 1, 0)
const RAD = 180 / Math.PI

function place(x: number, y: number, z: number, yaw: number): Aircraft {
  const a = new Aircraft(P51D, 4000, 200)
  const q = new Quaternion().setFromAxisAngle(UP, yaw)
  a.state.orientation.copy(q)
  a.state.velocity.set(0, 0, -200).applyQuaternion(q)
  a.prevPosition.copy(a.state.position)
  a.update(new Vector3(0, 0, -1).applyQuaternion(q), 0.7, 1 / 240)
  a.state.position.set(x, y, z)
  a.state.orientation.copy(q)
  a.state.velocity.set(0, 0, -200).applyQuaternion(q)
  return a
}

/** 由**我的速度向量**量到目標的夾角，度。與 `turnTime` 同一個基準 */
function offAxisDeg(self: Aircraft, target: Aircraft): number {
  const los = target.state.position.clone().sub(self.state.position)
  los.normalize()
  const v = self.state.velocity.clone().normalize()
  return Math.acos(Math.max(-1, Math.min(1, v.dot(los)))) * RAD
}

/** 甲類：全域的 cos 斜坡。`floor + (1−floor)·((1+cosθ)/2)^k` */
const wide = (deg: number, k: number, floor: number): number =>
  floor + (1 - floor) * Math.pow((1 + Math.cos(deg / RAD)) / 2, k)

/**
 * 乙類：**只咬後半球**。`floor + (1−floor)·min(1, 1+cosθ)^k`
 *
 * θ ≤ 90° 時 `1 + cosθ ≥ 1`，夾成 1 —— 前半球一個字都不動。
 */
const rearOnly = (deg: number, k: number, floor: number): number =>
  floor + (1 - floor) * Math.pow(Math.min(1, 1 + Math.cos(deg / RAD)), k)

const SHAPES: { name: string, f: (deg: number) => number }[] = [
  { name: '現行（無視野項）', f: () => 1 },
  { name: '全域 淺 k=1 fl=0.15', f: (d) => wide(d, 1, 0.15) },
  { name: '全域 中 k=2 fl=0.10', f: (d) => wide(d, 2, 0.10) },
  { name: '全域 深 k=3 fl=0.05', f: (d) => wide(d, 3, 0.05) },
  { name: '後半球 k=1 fl=0.10', f: (d) => rearOnly(d, 1, 0.10) },
  { name: '後半球 k=2 fl=0.10', f: (d) => rearOnly(d, 2, 0.10) },
  { name: '後半球 k=2 fl=0.05', f: (d) => rearOnly(d, 2, 0.05) },
]

// ── 不變式：正前方但很遠（3 km）vs 側面但很近（300 m）──────────
const me = place(0, 4000, 0, 0)
const farAhead = place(0, 4000, -3000, 0)
const nearBeam = place(300, 4000, 0, -Math.PI / 2)
const sFar = targetScore(me, farAhead, 0, DEFAULT_TARGET)
const sBeam = targetScore(me, nearBeam, 0, DEFAULT_TARGET)
const dFar = offAxisDeg(me, farAhead)
const dBeam = offAxisDeg(me, nearBeam)

console.log('=== 既有不變式：「正前方但很遠的目標，輸給側面但很近的目標」===')
console.log(`遠處正前方  離軸 ${dFar.toFixed(1)}°、3000 m、分數 ${sFar.toFixed(4)}`)
console.log(`近處側面    離軸 ${dBeam.toFixed(1)}°、 300 m、分數 ${sBeam.toFixed(4)}`)
console.log(`現行餘裕 ${(sBeam / sFar).toFixed(3)} 倍（必須 > 1）\n`)

console.log('形狀                  側面×視野   正前×視野   餘裕     不變式')
for (const s of SHAPES) {
  const beam = sBeam * s.f(dBeam)
  const far = sFar * s.f(dFar)
  const ratio = beam / far
  console.log(
    s.name.padEnd(22) + `${beam.toFixed(4).padStart(9)}  ${far.toFixed(4).padStart(9)}  `
    + `${ratio.toFixed(3).padStart(6)}   ${ratio > 1 ? '通過' : '**打破**'}`,
  )
}

// ── 後半球的壓制力 ────────────────────────────────────
const RATE = instantaneousTurnRate(P51D, 4000, 200)
const turnD = (deg: number): number => {
  const x = ((deg / RAD) / RATE) / DEFAULT_TARGET.turnTimeScale
  return Math.pow(1 / (1 + x), DEFAULT_TARGET.turnWeight)
}

console.log('\n=== 後半球壓制力（含既有 turnDiscount）===')
console.log('形狀                  57°→120°  57°→150°  57°→180°  90° 有沒有被動到')
for (const s of SHAPES) {
  const g = (d: number): number => turnD(d) * s.f(d)
  console.log(
    s.name.padEnd(22) + `${(g(57) / g(120)).toFixed(1).padStart(8)} ×`
    + `${(g(57) / g(150)).toFixed(1).padStart(8)} ×`
    + `${(g(57) / g(180)).toFixed(1).padStart(8)} ×`
    + `   ${s.f(90) === 1 ? '沒有' : `有（×${s.f(90).toFixed(3)}）`}`,
  )
}
console.log(`\n（一個隊友鎖定 = ${(1 + DEFAULT_TARGET.crowdPenalty).toFixed(2)} 倍、`
  + `換敵門檻 = ${(1 + DEFAULT_TARGET.switchMargin).toFixed(2)} 倍）`)
console.log('實測新目標的離軸分布：90-120° 13.5%、120-150° 10.6%、150-180° 5.5%'
  + '（後半球合計 29.6%）')
