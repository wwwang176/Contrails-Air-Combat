/**
 * 過頂翻轉俯衝的物理：飛過目標 `PAST` 公尺後翻到顛倒、強制翻轉後拉（`Command.pull`）、拉過垂直，
 * 機鼻指向後下方、回頭對著目標；機鼻對上視線之後改成放平機翼（`upright`）俯衝。**一次性量測，不進測試組。**
 *
 * 單機模擬：目標在原點，飛機從 (0, H, −PAST) 朝 −Z 以 V 平飛（−Z 是前進方向，所以 −PAST 已經飛過目標）。
 * 瞄準點是飛機到目標的視線（只追視線）。記：翻轉用掉的時間、掉高、前進（過頂）距離；轉成俯衝之後
 * 在投彈高度（離目標 500 m）的機鼻角、滾轉、離目標的水平距離，與炸彈落點（沿視線方向無阻力外推）離目標多遠。
 *
 * 環境變數：H（預設 1,000）、V（預設 90）、PAST（預設 50，掃過頂距離用 `PASTS=0,50,100,...`）。
 *
 * 跑法：`npx vite-node test/tools/ju87-flip.probe.ts`
 */
import { Euler, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { THROTTLE_FLOOR } from '../../src/input/throttle'
import { applyFeel, feelFor } from '../../src/specs/feel'
import { JU87 as HISTORICAL_JU87 } from '../../src/specs/ju87'

const JU87 = applyFeel(HISTORICAL_JU87, feelFor(HISTORICAL_JU87))
const DT = 1 / 240
const DEG = 180 / Math.PI
const H = Number(process.env['H'] ?? 1000)
const V = Number(process.env['V'] ?? 90)
const PASTS = (process.env['PASTS'] ?? process.env['PAST'] ?? '50').split(',').map(Number)
/** 機鼻與視線的夾角小於這個、而且機翼是正的，就算翻完 */
const DONE = Number(process.env['DONE'] ?? 15) / DEG

const NOSE = new Vector3()
const UP = new Vector3()
const RIGHT = new Vector3()
const aim = new Vector3()

for (const past of PASTS) {
  const a = new Aircraft(JU87, H, V)
  a.state.position.set(0, H, -past)
  a.state.orientation.setFromEuler(new Euler(0, 0, 0, 'YXZ'))
  a.state.velocity.set(0, 0, -V)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  let phase: 'flip' | 'dive' = 'flip'
  let tFlip = -1
  let dropFlip = NaN
  let pastFlip = NaN
  let pitchMax = 0
  let rel = ''
  const trace: string[] = []
  for (let i = 1; i <= 40 * 240; i++) {
    const p = a.state.position
    aim.set(0 - p.x, 0 - p.y, 0 - p.z).normalize()
    const horiz = Math.hypot(aim.x, aim.z)
    if (phase === 'dive') {
      // 俯衝：機翼放平、瞄準仰角夾在 −85° 以內，與 `diveBomb.ts` 相同
      const pw = Math.max(-85 / DEG, Math.atan2(aim.y, horiz))
      aim.set((aim.x / (horiz || 1)) * Math.cos(pw), Math.sin(pw), (aim.z / (horiz || 1)) * Math.cos(pw))
    }
    a.update(aim, THROTTLE_FLOOR, DT, 0.5, phase === 'dive', false, phase === 'flip')
    NOSE.set(0, 0, -1).applyQuaternion(a.state.orientation)
    UP.set(0, 1, 0).applyQuaternion(a.state.orientation)
    RIGHT.set(1, 0, 0).applyQuaternion(a.state.orientation)
    const inverted = UP.y < 0
    // 機鼻角：離開 −Z 前進方向往下為正；機鼻往後下方指時超過 90°
    const forward = -NOSE.z
    const below = Math.atan2(-NOSE.y, forward) * DEG // forward < 0 時超過 90°
    if (below > pitchMax) pitchMax = below
    const roll = Math.atan2(RIGHT.y, Math.hypot(RIGHT.x, RIGHT.z)) * DEG
    if (phase === 'flip' && NOSE.angleTo(aim) <= DONE && !inverted) {
      phase = 'dive'
      tFlip = i * DT
      dropFlip = H - p.y
      pastFlip = -p.z
    }
    if (i % 240 === 0 && p.y > 450) {
      trace.push(`${(i / 240).toFixed(0)}s ${p.y.toFixed(0)}m 過頂${(-p.z).toFixed(0)} 機鼻${below.toFixed(0)}° ${inverted ? '顛倒' : '正'}${phase === 'flip' ? '(翻)' : ''} 滾${roll.toFixed(0)}`)
    }
    if (rel === '' && p.y <= 500) {
      // 無阻力外推：從現在的位置與速度拋物線落到目標的地面高度（0）
      const v = a.state.velocity
      const g = 9.80665
      const disc = v.y * v.y + 2 * g * p.y
      const tt = (v.y + Math.sqrt(disc)) / g
      const ix = p.x + v.x * tt
      const iz = p.z + v.z * tt
      rel = `降到 500 m：t=${(i * DT).toFixed(1)}s、機鼻 ${below.toFixed(0)}°、${inverted ? '顛倒' : '機翼正'}（滾 ${roll.toFixed(0)}°）、離目標水平 ${Math.hypot(p.x, p.z).toFixed(0)} m（過頂 ${(-p.z).toFixed(0)}）、無阻力落點離目標 ${Math.hypot(ix, iz).toFixed(0)} m`
    }
    if (p.y < 300) break
  }
  console.log(`飛過目標 ${past} m 後翻轉（H=${H}、V=${V}）：${tFlip < 0 ? '沒翻完（機鼻沒對上視線或一直顛倒）' : `翻完用 ${tFlip.toFixed(1)} s、掉 ${dropFlip.toFixed(0)} m、過頂 ${pastFlip.toFixed(0)} m`}；機鼻最大 ${pitchMax.toFixed(0)}°`)
  console.log(`   ${rel === '' ? '沒降到 500 m' : rel}`)
  console.log('   ' + trace.join(' | '))
}
