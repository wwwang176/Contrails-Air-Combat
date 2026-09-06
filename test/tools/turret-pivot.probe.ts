/**
 * 砲塔轉向時，槍管是繞哪一點轉的？
 *
 *   npx tsx test/tools/turret-pivot.probe.ts
 *
 * 【人工回報】「B17 機腹底的機槍，旋轉點好像不對」。
 *
 * 三處都把槍管的**管口釘在 `t.position`**，再把管身朝 −aim 擺出去
 * （`render/turretBarrels.ts`、`render/muzzle.ts`、`world/turrets.ts`）。
 * 那等於**繞管口轉** —— 砲塔追瞄時管口不動、後膛甩出去，而真槍是後膛
 * （樞軸）不動、管口掃出去。兩者差一整根槍管長，而且方向相反。
 *
 * 這一支把兩種模型下的管口與後膛位置逐一算出來對照。**不需要瀏覽器**。
 */
import { Vector3 } from 'three'
import { B17G } from '../../src/specs/b17g'
import { BARREL_LENGTH, turretPivot } from '../../src/weapons/turret'

const DEG = Math.PI / 180
const n = (v: number): string => v.toFixed(3).padStart(7)
const p = (v: Vector3): string => `(${n(v.x)},${n(v.y)},${n(v.z)})`

const ball = B17G.turrets.find((t) => t.id === 'ball')!
const pivot = turretPivot(ball, new Vector3())

console.log(`  ball：position（靜止管口）${p(ball.position)}`)
console.log(`        axis ${p(ball.axis)}   halfAngle ${(ball.halfAngle / DEG).toFixed(0)}°`)
console.log(`        推導的旋轉點 ${p(pivot)}`)
console.log('')
console.log('  aim 由正下方往右偏，兩種模型下的管口與後膛：')
console.log('   偏角      現行管口            現行後膛      |    正確管口            正確後膛')

const aim = new Vector3()
const muzzleNow = new Vector3()
const breechNow = new Vector3()
const muzzleFix = new Vector3()

for (const deg of [0, 20, 40, 60, 80]) {
  // 由 axis（正下方）往 +x 偏 deg
  aim.set(Math.sin(deg * DEG), -Math.cos(deg * DEG), 0)
  // 現行：管口釘在 position，管身朝 −aim
  muzzleNow.copy(ball.position)
  breechNow.copy(ball.position).addScaledVector(aim, -BARREL_LENGTH)
  // 正確：樞軸釘住，管口 = 樞軸 + 管長 × aim
  muzzleFix.copy(pivot).addScaledVector(aim, BARREL_LENGTH)
  console.log(`  ${String(deg).padStart(3)}°  ${p(muzzleNow)}  ${p(breechNow)}`
    + `  |  ${p(muzzleFix)}  ${p(pivot)}`)
}

console.log('')
console.log('  【怎麼讀】現行那兩欄裡，**管口整欄不動**而後膛往 −x 甩 ——')
console.log('  砲塔瞄右邊，整根槍卻往左邊擺。正確那兩欄是後膛不動、管口往 +x 掃。')
