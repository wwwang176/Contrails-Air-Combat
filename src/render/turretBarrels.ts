import {
  BufferAttribute, BufferGeometry, DynamicDrawUsage, InstancedMesh, Matrix4,
  MeshBasicMaterial, Quaternion, Vector3,
} from 'three'
import { BARREL_LENGTH, MAX_TURRETS, turretMuzzle, wobbleBasis } from '../weapons/turret'
import { BARREL_SPACING } from '../world/turrets'
import type { Combatant } from '../world/World'

/**
 * 砲塔的槍管 —— 黑色三角柱，**跟著砲塔轉**。
 *
 * 【為什麼不烘進機身】靜態槍管在砲塔轉向時，彈流會從槍管**旁邊**飛出去。
 * 砲塔的重點就是它會轉，這個穿幫每一次射擊都看得到。
 *
 * 【為什麼是 InstancedMesh】跟槍焰走同一條更新路徑，**不新增任何場景節點**。
 *
 * 【8 個三角形/根】3 個側面 ×2 + 2 個端蓋。B-17G 十二根 ≈ 96 個三角形。
 */
export const BARREL_RADIUS = 0.045

/** 一座砲塔最多幾根管子。雙聯是 2。 */
export const MAX_BARRELS_PER_TURRET = 2

/**
 * **`BARREL_LENGTH` 與 `BARREL_SPACING` 不在這裡定義。**
 *
 * 前者由 `weapons/turret.ts`、後者由 `world/turrets.ts` 匯出，這裡 import
 * 過來。理由：`BARREL_SPACING` 同時是彈丸左右輪替的偏移量，各寫一份的話
 * 彈丸與槍管會對不齊。
 *
 * （護欄用的是另一個常數 `TURRET_MOUNT_REACH`，刻意比槍管長 —— 命中盒比
 * 實際機體小，見 `weapons/turret.ts` 的註解。）
 */

export interface TurretBarrels {
  object: InstancedMesh
  update(
    combatants: readonly Combatant[],
    positions: readonly Vector3[],
    quaternions: readonly Quaternion[],
  ): void
  dispose(): void
}

/**
 * 三角柱：局部原點是**槍口**，沿 **+Z** 往後延伸 `BARREL_LENGTH`。
 *
 * 【為什麼是 +Z 而不是 −Z】把 +Z 對準 **−aim** 之後，槍管就由槍口往機體
 * 方向長 —— 也就是「插進砲塔裡」的那個方向。對準 +aim 的話管子會往目標
 * 方向長出去，看起來像一根從槍口再伸出去的天線。
 *
 * 8 個三角形：3 個側面各 2 個 + 前後端蓋各 1 個。
 *
 * 【為什麼匯出】機庫（`tools/hangar.ts`）用同一份幾何把砲塔畫在靜止位置上，
 * 這樣「看到的就是遊戲裡會畫的那根管子」。另外複製一份的話，機庫看起來對
 * 而遊戲裡錯，這個工具反而會製造錯誤的信心 —— 那正是機庫檔頭寫明要避免的事。
 */
export function barrelGeometry(): BufferGeometry {
  const r = BARREL_RADIUS
  const l = BARREL_LENGTH
  // 正三角形的三個角，繞 +Z 軸
  const c: [number, number][] = [0, 1, 2].map((k) => {
    const a = (k / 3) * Math.PI * 2 + Math.PI / 2
    return [Math.cos(a) * r, Math.sin(a) * r]
  }) as [number, number][]

  const v: number[] = []
  const push = (x: number, y: number, z: number): void => { v.push(x, y, z) }

  for (let k = 0; k < 3; k++) {
    const [x0, y0] = c[k]!
    const [x1, y1] = c[(k + 1) % 3]!
    // 側面兩個三角形
    push(x0, y0, 0); push(x1, y1, 0); push(x1, y1, l)
    push(x0, y0, 0); push(x1, y1, l); push(x0, y0, l)
  }
  // 端蓋各一個三角形
  const [ax, ay] = c[0]!
  const [bx, by] = c[1]!
  const [cx, cy] = c[2]!
  push(ax, ay, 0); push(cx, cy, 0); push(bx, by, 0)
  push(ax, ay, l); push(bx, by, l); push(cx, cy, l)

  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(Float32Array.from(v), 3))
  g.computeVertexNormals()
  return g
}

const UNIT_Z = /* @__PURE__ */ new Vector3(0, 0, 1)
/** 熱路徑的暫存。模組私有、每幀重用（熱路徑零配置） */
const M = /* @__PURE__ */ new Matrix4()
const POS = /* @__PURE__ */ new Vector3()
const DIR = /* @__PURE__ */ new Vector3()
const E1 = /* @__PURE__ */ new Vector3()
const E2 = /* @__PURE__ */ new Vector3()
const ROT = /* @__PURE__ */ new Quaternion()
const ONE = /* @__PURE__ */ new Vector3(1, 1, 1)
const ZERO = /* @__PURE__ */ new Vector3(0, 0, 0)

/**
 * 槍管 —— 單一 `InstancedMesh`，每一根管子一個實例。
 *
 * 【位置與姿態在這裡重算而不是由世界帶過來】與槍焰同一個理由：世界的位置
 * 是**物理子步**的，而畫面畫在**內插後**的位置，200 m/s 下差 0.83 m。
 *
 * @param aircraftCapacity 最多幾架飛機。實例數是它乘上
 *   `MAX_TURRETS × MAX_BARRELS_PER_TURRET`
 */
export function createTurretBarrels(aircraftCapacity: number): TurretBarrels {
  const geometry = barrelGeometry()
  const material = new MeshBasicMaterial({ color: 0x101010 })

  const capacity = aircraftCapacity * MAX_TURRETS * MAX_BARRELS_PER_TURRET
  const object = new InstancedMesh(geometry, material, capacity)
  object.instanceMatrix.setUsage(DynamicDrawUsage)
  // 包圍球是建立時算的（全部在原點），開著視錐剔除的話相機一離開原點附近
  // 整批槍管會一起消失 —— 與曳光彈、槍焰同一個坑。
  object.frustumCulled = false

  M.compose(ZERO, ROT.identity(), ZERO)
  for (let i = 0; i < capacity; i++) object.setMatrixAt(i, M)
  object.instanceMatrix.needsUpdate = true

  /**
   * 哪些格已經是零了。
   *
   * 【為什麼要記】舊的寫法每幀把用不到的格重寫成零，再無條件 `needsUpdate`
   * —— three 於是整條 40 KB 重傳（`updateRanges` 是空的，走全緩衝那個分支）。
   * 而戰鬥機對戰鬥機的一場仗裡**一格都用不到**：640 格每幀重寫成零再重傳。
   *
   * **不能只看「用到第幾格」** —— 沒有砲塔的機體照樣要走完它那 16 格，所以
   * 那個水位恆等於容量。判準必須是「這一格的值真的變了嗎」。
   */
  // 【開場全是零】上面那個迴圈已經把每一格寫成零並上傳過了
  const hidden = new Uint8Array(capacity).fill(1)
  /** 這一輪有沒有真的動到矩陣，以及動到的範圍 */
  let touched = false
  let hi = 0

  const hide = (slot: number): void => {
    if (hidden[slot] === 1) return
    M.compose(ZERO, ROT.identity(), ZERO)
    object.setMatrixAt(slot, M)
    hidden[slot] = 1
    touched = true
    if (slot + 1 > hi) hi = slot + 1
  }

  return {
    object,

    update(
      combatants: readonly Combatant[],
      positions: readonly Vector3[],
      quaternions: readonly Quaternion[],
    ): void {
      let slot = 0
      for (let k = 0; k < combatants.length; k++) {
        const c = combatants[k]!
        const turrets = c.aircraft.spec.turrets
        const p = positions[c.index]
        const q = quaternions[c.index]

        for (let i = 0; i < MAX_TURRETS; i++) {
          const t = i < turrets.length ? turrets[i]! : undefined
          const st = i < c.turretStates.length ? c.turretStates[i] : undefined
          for (let b = 0; b < MAX_BARRELS_PER_TURRET; b++) {
            if (slot >= capacity) break
            if (t === undefined || st === undefined || !c.alive
              || p === undefined || q === undefined || b >= t.guns) {
              hide(slot); slot++
              continue
            }
            // 【側偏用的基底與生彈丸時同一組】`stepTurrets` 也是
            // `wobbleBasis(s.aim, ...)` 的 e1 × BARREL_SPACING。共用同一個
            // 推導是唯一能保證「彈丸恰好從畫出來的那根管口出來」的方式。
            wobbleBasis(st.aim, E1, E2)
            const side = t.guns > 1 ? (b === 0 ? -1 : 1) : 0
            // 【槍口跟著 aim 掃】`t.position` 只是靜止時的管口；直接用它
            // 等於讓槍管繞管口轉，見 `weapons/turret.ts` 的 turretMuzzle
            turretMuzzle(t, st.aim, POS).addScaledVector(E1, side * BARREL_SPACING)
              .applyQuaternion(q).add(p)
            // +Z 對準 −aim：管子由槍口往機體方向長
            DIR.copy(st.aim).applyQuaternion(q).negate()
            ROT.setFromUnitVectors(UNIT_Z, DIR)
            M.compose(POS, ROT, ONE)
            object.setMatrixAt(slot, M)
            hidden[slot] = 0
            touched = true
            if (slot + 1 > hi) hi = slot + 1
            slot++
          }
        }
      }
      for (; slot < capacity; slot++) hide(slot)
      // 【沒動過就不傳】見 `hidden`
      if (touched) {
        // 【只傳動到的那一段】容量是 40 架 × 8 座 × 2 管
        object.instanceMatrix.addUpdateRange(0, hi * 16)
        object.instanceMatrix.needsUpdate = true
        touched = false
        hi = 0
      }
    },

    dispose(): void {
      geometry.dispose()
      material.dispose()
      object.dispose()
    },
  }
}
