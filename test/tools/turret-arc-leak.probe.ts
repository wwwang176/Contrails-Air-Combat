/**
 * 射出去的子彈到底有沒有超出射界錐？超出多少？
 *
 *   npx tsx test/tools/turret-arc-leak.probe.ts      # 不需要瀏覽器
 *
 * 【人工回報】「偶爾會看到機槍開火超出射界？是不是機槍開始射擊
 * 時，不是每一發都檢查射界？因為飛機會旋轉」。
 *
 * ── 程式碼上的縫在哪 ──────────────────────────────────────
 *
 * `stepTurrets` 的射界檢查在 `leadInBody` 裡，而它檢查的是**預瞄方向
 * `WANT`**，不是真正射出去的方向。射出去的是：
 *
 * ```
 *   s.aim                  ← slew 之後的實際指向，沒有任何一處夾在錐內
 *   → applyWobble(...)     ← 再加最多 A√2 的搖晃
 * ```
 *
 * 開火條件是 `s.aim.angleTo(WANT) < FIRE_THRESHOLD`（2°），而 `WANT` 在錐
 * 內 —— 但那**不等於** `s.aim` 在錐內。
 *
 * 【為什麼要掃旋轉率】人工回報的假設是「飛機會旋轉」。載機一轉，同一個
 * 世界方向的目標在機體座標裡就跟著移動，`WANT` 每步都在動而 `s.aim` 以
 * `rotationRate` 追 —— 追不上的那一段就是誤差。這一支把載機的滾轉率當自
 * 變數掃過去，看溢出量是不是跟著長。
 *
 * 【判準】逐發算「射出方向與該座砲塔 axis 的夾角」減 `halfAngle`。
 * 正值就是溢出。要看的是**最大值**與**溢出的發數佔比**，不是平均。
 */
import { Vector3, Quaternion } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { B17G } from '../../src/specs/b17g'
import { P51D } from '../../src/specs/p51d'
import { createTurretStates, stepTurrets, type TurretCombatant } from '../../src/world/turrets'
import { turretMuzzle } from '../../src/weapons/turret'
import { segmentBox } from '../../src/world/hit'
import type { Projectiles } from '../../src/world/Projectiles'

const DT = 1 / 240
const DEG = Math.PI / 180
const SECONDS = 60

interface Shot { px: number; py: number; pz: number; vx: number; vy: number; vz: number }

/** 只記錄不模擬 —— `stepTurrets` 只會呼叫 `spawn`。 */
function recorder(out: Shot[]): Projectiles {
  return {
    spawn(px: number, py: number, pz: number,
      vx: number, vy: number, vz: number): number {
      out.push({ px, py, pz, vx, vy, vz })
      return 0
    },
  } as unknown as Projectiles
}

function fake(spec: typeof B17G, index: number, team: 'blue' | 'red'): TurretCombatant {
  const aircraft = new Aircraft(spec, 3000, 100)
  return {
    index, team, alive: true, hp: spec.hp, aircraft,
    turretStates: createTurretStates(spec, index),
    turretCooldowns: new Float32Array(spec.turrets.length),
  }
}

interface Result {
  max: number
  over: number
  total: number
  who: string
  /** 出膛後 60 m 內**由外而內穿過**自己某個命中盒的發數。 */
  selfHit: number
  /** 槍口本身就落在某個命中盒裡的發數（那是簡化的傷害體積，不是穿模）。 */
  startInside: number
  /** 逐座砲塔：發數、最大用到的離軸角。 */
  perTurret: Map<string, { n: number; maxOff: number; self: number }>
}

/** 一次掃描：載機以 `rollRate` 滾轉，敵機繞著它轉。 */
function run(rollRate: number): Result {
  const shots: Shot[] = []
  const projectiles = recorder(shots)
  const b = fake(B17G, 0, 'blue')
  const f = fake(P51D as unknown as typeof B17G, 1, 'red')

  const q = new Quaternion()
  const spin = new Quaternion()
  const axisZ = new Vector3(0, 0, 1)
  const muzzle = new Vector3()
  const dir = new Vector3()
  const invQ = new Quaternion()

  let max = -Infinity
  let over = 0
  let total = 0
  let who = ''
  let selfHit = 0
  let startInside = 0
  const perTurret = new Map<string, { n: number; maxOff: number; self: number }>()
  /**
   * 【為什麼要量「打穿自己」】這是實作計畫 Task 4 把「射界錐不撞自己」那條
   * 硬斷言拿掉時，講好的替代驗收（同隊已被 World 跳過、不造成
   * 傷害，所以不值得用測試綁一個接近史實的半角，改成目視）。目視在無頭
   * 環境做不到，但**算得出來** —— 從槍口沿射向拉一段線段，去撞自己的命中盒。
   */
  const tip = new Vector3()
  const far = new Vector3()

  for (let k = 0; k < SECONDS / DT; k++) {
    const t = k * DT
    // 載機：原地滾轉，速度 100 m/s 朝 +z
    spin.setFromAxisAngle(axisZ, rollRate * t)
    q.copy(spin)
    b.aircraft.state.orientation.copy(q)
    b.aircraft.state.position.set(0, 3000, 100 * t)
    b.aircraft.state.velocity.set(0, 0, 100)
    // 敵機：在載機周圍繞一個大圈，逼砲塔掃過整個射界
    const a = t * 0.6
    f.aircraft.state.position.set(
      Math.cos(a) * 320, 3000 + Math.sin(a * 0.7) * 220, 100 * t + Math.sin(a) * 320)
    f.aircraft.state.velocity.set(-Math.sin(a) * 190, 0, Math.cos(a) * 190 + 100)

    shots.length = 0
    stepTurrets(b, [b, f], projectiles, t, DT)
    if (shots.length === 0) continue

    invQ.copy(q).conjugate()
    for (const s of shots) {
      // 射出方向（機體座標）= (彈丸速度 − 載機速度) 轉回機體
      dir.set(s.vx, s.vy, s.vz).sub(b.aircraft.state.velocity).normalize().applyQuaternion(invQ)
      // 用槍口位置認出是哪一座
      let best = -1
      let bestD = Infinity
      for (let i = 0; i < B17G.turrets.length; i++) {
        turretMuzzle(B17G.turrets[i]!, b.turretStates[i]!.aim, muzzle)
          .applyQuaternion(q).add(b.aircraft.state.position)
        const d = (muzzle.x - s.px) ** 2 + (muzzle.y - s.py) ** 2 + (muzzle.z - s.pz) ** 2
        if (d < bestD) { bestD = d; best = i }
      }
      const turret = B17G.turrets[best]!
      const off = turret.axis.angleTo(dir)
      const excess = off - turret.halfAngle
      total++
      if (excess > 1e-9) over++
      if (excess > max) { max = excess; who = turret.id }

      /**
       * 打不打得到自己：從槍口往射向拉 60 m，撞自己的命中盒。
       *
       * 【判準必須是 `> 0`，不能是 `!== NO_HIT`】`segmentBox` 起點在盒內時
       * 回傳 **0**，而下巴與球形砲塔的槍口本來就落在（被簡化放大的）命中盒
       * 裡 —— 用 `!== NO_HIT` 會把那兩座算成 100% 打穿自己，那是假的。
       * `> 0` 才是「射線**從外面進去**」，也就是真的穿過機體。
       */
      tip.set(s.px, s.py, s.pz).sub(b.aircraft.state.position).applyQuaternion(invQ)
      far.copy(tip).addScaledVector(dir, 60)
      let crosses = false
      let inside = false
      for (const box of B17G.hitBoxes) {
        const r = segmentBox(tip.x, tip.y, tip.z, far.x, far.y, far.z, box)
        if (r > 0) crosses = true
        else if (r === 0) inside = true
      }
      const hitsSelf = crosses
      if (hitsSelf) selfHit++
      if (inside) startInside++

      const e = perTurret.get(turret.id) ?? { n: 0, maxOff: 0, self: 0 }
      e.n++
      if (off > e.maxOff) e.maxOff = off
      if (hitsSelf) e.self++
      perTurret.set(turret.id, e)
    }
  }
  return { max, over, total, who, selfHit, startInside, perTurret }
}

console.log(`  B-17G 原地滾轉、敵機繞圈，各跑 ${SECONDS} 秒`)
console.log('')
console.log('  ── 一、射出方向有沒有超出射界錐 ──')
console.log('  滾轉 °/s    發數   溢出發數    佔比     最大溢出   最嚴重的那座')
let detail: Result | null = null
for (const deg of [0, 15, 30, 60, 120, 240]) {
  const r = run(deg * DEG)
  if (deg === 0) detail = r
  const pct = r.total === 0 ? 0 : (r.over / r.total) * 100
  console.log(`  ${String(deg).padStart(8)}${String(r.total).padStart(8)}`
    + `${String(r.over).padStart(11)}${pct.toFixed(1).padStart(8)}%`
    + `${(r.max / DEG).toFixed(2).padStart(11)}°   ${r.who}`)
}

console.log('')
console.log('  ── 二、出膛 60 m 內打穿自己的機體（滾轉 0 那一輪）──')
if (detail) {
  const pct = (detail.selfHit / detail.total) * 100
  console.log(`  真的穿過機體：${detail.selfHit} / ${detail.total} 發，${pct.toFixed(1)}%`)
  console.log(`  （槍口本來就在命中盒裡：${detail.startInside} 發 —— 命中盒是簡化的`
    + '傷害體積，比機體大，那不是穿模）')
  console.log('')
  console.log('  砲塔        半角    發數   最大離軸   打穿自己   佔該座')
  for (const t of B17G.turrets) {
    const e = detail.perTurret.get(t.id)
    if (!e) continue
    const sp = (e.self / e.n) * 100
    console.log(`  ${t.id.padEnd(10)}${(t.halfAngle / DEG).toFixed(0).padStart(5)}°`
      + `${String(e.n).padStart(8)}${(e.maxOff / DEG).toFixed(1).padStart(10)}°`
      + `${String(e.self).padStart(10)}${sp.toFixed(0).padStart(8)}%`)
  }
}
