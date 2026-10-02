/**
 * Ju 87 在 WEP 下的比超量功率（Ps）隨真速的曲線。**一次性量測，不進測試組。**
 *
 * Ps = V(T − D)/W：同一份餘裕要嘛拿去爬（爬升率 = Ps）、要嘛拿去加速（水平飛的加速度 = g·Ps/V）。
 * 同時印 1G 失速速度與安全層介入的失速門檻（1.1 倍），看貼著最佳爬升速度飛離失速多遠。
 *
 * 跑法：`npx vite-node test/tools/ju87-climb.probe.ts`
 */
import { Euler, Vector3 } from 'three'
import { maxClimbRate, specificExcessPower, stallSpeed } from '../../src/analysis/envelope'
import { createDiveBombState, stepDiveBomb } from '../../src/ai/diveBomb'
import { DEFAULT_SAFETY } from '../../src/ai/safety'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { createGroundTarget } from '../../src/world/groundTargets'
import { applyFeel, feelFor } from '../../src/specs/feel'
import { JU87 as HISTORICAL_JU87 } from '../../src/specs/ju87'

/** 場上飛的是套過手感的規格（`battle/setup.ts`）；拿史實規格算出來的不是遊戲裡的飛機 */
const JU87 = applyFeel(HISTORICAL_JU87, feelFor(HISTORICAL_JU87))

// 實際能爬多快：直接餵固定的瞄準仰角給指揮儀，跑 60 秒，取後 20 秒的平均。對照 Ps 的理論值，
// 差多少就是指揮儀、配平與機體動態吃掉的
{
  const DT = 1 / 240
  console.log('固定仰角爬升（1,000 m、WEP、機翼放平、直線），後 20 秒平均：')
  for (const pitchDeg of [5, 6, 7, 8, 9, 10, 12]) {
    const a = new Aircraft(JU87, 1000, 66)
    a.state.position.set(0, 1000, 0)
    a.state.orientation.identity()
    a.state.velocity.set(0, 0, -66)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
    const aim = new Vector3(0, Math.sin((pitchDeg * Math.PI) / 180), -Math.cos((pitchDeg * Math.PI) / 180))
    let vz = 0
    let tas = 0
    let n = 0
    for (let i = 0; i < 60 * 240; i++) {
      a.update(aim, WEP_THROTTLE, DT, 0, false, false)
      if (i >= 40 * 240) {
        vz += a.state.velocity.y
        tas += a.state.velocity.length()
        n++
      }
    }
    const v = tas / n
    console.log(`  瞄準仰角 ${pitchDeg}°：爬升率 ${(vz / n).toFixed(2)} m/s、真速 ${v.toFixed(1)} m/s（理論 Ps ${specificExcessPower(JU87, 1000, v, 1).toFixed(2)}）`)
  }
}

// 脫離指令（`stepDiveBomb` 的 egress）直接餵給單機模擬：從拉起後的狀態開始，記每 10 秒的高度與爬升率
{
  const DT = 1 / 240
  const a = new Aircraft(JU87, 190, 129)
  a.state.position.set(0, 190, 300)
  a.state.orientation.identity()
  a.state.velocity.set(0, 0, 129)
  a.state.orientation.setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'))
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  const target = createGroundTarget(0, 'atGun', 'red', 0, 0, 0)
  const s = createDiveBombState()
  s.phase = 'egress'
  const cmd = createCommand()
  console.log('脫離指令餵給單機（無戰場、無延遲、無安全層），每 10 秒：')
  let last = a.state.position.y
  for (let i = 1; i <= 120 * 240; i++) {
    stepDiveBomb(s, a, target, true, cmd)
    a.update(cmd.aimWorld, cmd.throttle, DT, cmd.brake, cmd.upright, cmd.trackTurn)
    if (i % (10 * 240) === 0) {
      const v = a.state.velocity
      console.log(`  t=${i / 240}s 高 ${a.state.position.y.toFixed(0)} 平均爬升 ${((a.state.position.y - last) / 10).toFixed(1)} m/s 真速 ${v.length().toFixed(0)} 離目標 ${Math.hypot(a.state.position.x, a.state.position.z).toFixed(0)} 過載 ${a.diag.loadFactor.toFixed(2)} 相位 ${s.phase}`)
      last = a.state.position.y
    }
  }
}

// 對照組：同一套爬升角規則（速度係數），航向改成直線。差多少就是繞圈的轉彎吃掉的
{
  const DT = 1 / 240
  const a = new Aircraft(JU87, 190, 129)
  a.state.position.set(0, 190, 300)
  a.state.velocity.set(0, 0, 129)
  a.state.orientation.setFromEuler(new Euler(0, Math.PI, 0, 'YXZ'))
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  const aim = new Vector3()
  console.log('對照組：同樣的爬升角規則、直線飛，每 10 秒：')
  let last = a.state.position.y
  for (let i = 1; i <= 90 * 240; i++) {
    const tas = a.state.velocity.length()
    const k = Math.max(0, Math.min(1, (tas - 55) / (70 - 55)))
    const z = Math.max(0, Math.min(1, (tas - 80) / (110 - 80)))
    const climb = (12 + 23 * z) * k * (Math.PI / 180)
    aim.set(0, Math.sin(climb), Math.cos(climb)).normalize()
    a.update(aim, WEP_THROTTLE, DT, 0, false, false)
    if (i % (10 * 240) === 0) {
      console.log(`  t=${i / 240}s 高 ${a.state.position.y.toFixed(0)} 平均爬升 ${((a.state.position.y - last) / 10).toFixed(1)} m/s 真速 ${a.state.velocity.length().toFixed(0)}`)
      last = a.state.position.y
    }
  }
}

for (const alt of [500, 1000, 1500, 2000]) {
  const best = maxClimbRate(JU87, alt)
  const vs = stallSpeed(JU87, alt, 1)
  console.log(`離地 ${alt} m：1G 失速 ${vs.toFixed(1)} m/s、安全層失速門檻 ${(vs * DEFAULT_SAFETY.stallMargin).toFixed(1)} m/s；最佳爬升 ${best.rate.toFixed(2)} m/s @ ${best.speed.toFixed(1)} m/s`)
  const row: string[] = []
  for (let v = 50; v <= 100; v += 5) {
    const ps = specificExcessPower(JU87, alt, v, 1)
    row.push(`${v}:${ps.toFixed(1)}(加速${((9.80665 * ps) / v).toFixed(2)})`)
  }
  console.log('   Ps(m/s)(水平加速 m/s²) ' + row.join(' '))
}
