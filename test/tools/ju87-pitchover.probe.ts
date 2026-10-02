/**
 * 俯衝進場的兩種壓法：推頭（`upright`，機翼放平、負過載）對翻轉後拉（不加 `upright`，指揮儀自己選）。
 * **一次性量測，不進測試組。**
 *
 * 單機模擬：離目標高 H、水平 D，以 V 平飛，瞄準點是飛機到目標的視線（只追視線）。記機鼻第一次壓到
 * −70° 時的掉高、前進距離、用掉的時間與機翼的實際滾轉（機體右向量的仰角），以及降到投彈高度（離目標
 * 500 m）時機翼是否顛倒（投放包絡擋 90° 以上的滾轉）。
 *
 * 環境變數：H（預設 1,100）、D（預設 600）、V（預設 90）。
 *
 * 跑法：`npx vite-node test/tools/ju87-pitchover.probe.ts`
 */
import { Euler, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { THROTTLE_FLOOR } from '../../src/input/throttle'
import { applyFeel, feelFor } from '../../src/specs/feel'
import { JU87 as HISTORICAL_JU87 } from '../../src/specs/ju87'

const JU87 = applyFeel(HISTORICAL_JU87, feelFor(HISTORICAL_JU87))
const DT = 1 / 240
const DEG = 180 / Math.PI
const H = Number(process.env['H'] ?? 1100)
const D = Number(process.env['D'] ?? 600)
const V = Number(process.env['V'] ?? 90)

const NOSE = new Vector3()
const RIGHT = new Vector3()
const UP = new Vector3()

// 第三種：先在平飛時滾到顛倒（起點直接擺成顛倒），拉下去；到 −70° 之後才改成 upright 滾回正
// （投放包絡擋 90° 以上的滾轉，投彈要正飛）。起點顛倒不計入「滾到顛倒」那段（平飛 1.5～2 秒）
const VARIANTS: { name: string; upright: boolean; roll0: number; flipAt: number }[] = [
  { name: '推頭（upright）', upright: true, roll0: 0, flipAt: -1 },
  { name: '指揮儀自選（不加 upright）', upright: false, roll0: 0, flipAt: -1 },
  { name: '顛倒起手、拉到 −70° 再滾回正', upright: false, roll0: Math.PI, flipAt: -70 },
]
for (const variant of VARIANTS) {
  let upright = variant.upright
  const a = new Aircraft(JU87, H, V)
  a.state.position.set(0, H, D)
  a.state.orientation.setFromEuler(new Euler(0, 0, variant.roll0, 'YXZ'))
  a.state.velocity.set(0, 0, -V)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  const aim = new Vector3()
  let t70 = -1
  let drop70 = NaN
  let dist70 = NaN
  let roll70 = NaN
  let tRel = -1
  let rollRel = NaN
  let pitchRel = NaN
  let maxAbsRoll = 0
  let minH = H
  const trace: string[] = []
  for (let i = 1; i <= 40 * 240; i++) {
    const p = a.state.position
    aim.set(0 - p.x, 0 - p.y, 0 - p.z).normalize()
    // 瞄準仰角夾在 −85° 以內，與 `diveBomb.ts` 相同
    const hl = Math.hypot(aim.x, aim.z)
    const pitchWant = Math.max(-85 / DEG, Math.atan2(aim.y, hl))
    aim.set((aim.x / (hl || 1)) * Math.cos(pitchWant), Math.sin(pitchWant), (aim.z / (hl || 1)) * Math.cos(pitchWant))
    a.update(aim, THROTTLE_FLOOR, DT, 0.5, upright, false)
    NOSE.set(0, 0, -1).applyQuaternion(a.state.orientation)
    RIGHT.set(1, 0, 0).applyQuaternion(a.state.orientation)
    UP.set(0, 1, 0).applyQuaternion(a.state.orientation)
    const pitch = Math.asin(NOSE.y) * DEG
    // 機翼的實際滾轉：機體右向量的仰角；顛倒時機體上方向量朝下
    const absRoll = Math.abs(Math.atan2(RIGHT.y, Math.hypot(RIGHT.x, RIGHT.z)) * DEG)
    const inverted = UP.y < 0
    const roll = inverted ? 180 - absRoll : absRoll
    if (roll > maxAbsRoll) maxAbsRoll = roll
    if (p.y < minH) minH = p.y
    if (t70 < 0 && pitch <= -70) {
      t70 = i * DT
      drop70 = H - p.y
      dist70 = D - p.z
      roll70 = roll
    }
    if (variant.flipAt !== -1 && pitch <= variant.flipAt) upright = true
    if (tRel < 0 && p.y <= 500) {
      tRel = i * DT
      rollRel = roll
      pitchRel = pitch
    }
    if (i % (2 * 240) === 0 && p.y > 450) trace.push(`${(i / 240).toFixed(0)}s:${p.y.toFixed(0)}m 俯${pitch.toFixed(0)} 滾${roll.toFixed(0)}${inverted ? '(顛倒)' : ''}`)
    if (p.y < 300) break
  }
  console.log(`${variant.name}：` +
    `${t70 < 0 ? '沒壓到 −70°' : `壓到 −70° 用 ${t70.toFixed(1)} s、掉 ${drop70.toFixed(0)} m、前進 ${dist70.toFixed(0)} m、當時滾轉 ${roll70.toFixed(0)}°`}；` +
    `降到 500 m 時 ${tRel < 0 ? '沒到' : `t=${tRel.toFixed(1)} s、機鼻 ${pitchRel.toFixed(0)}°、滾轉 ${rollRel.toFixed(0)}°（${rollRel > 90 ? '顛倒，投放包絡擋掉' : '可投'}）`}；` +
    `途中最大滾轉 ${maxAbsRoll.toFixed(0)}°`)
  console.log('   ' + trace.join(' | '))
}
