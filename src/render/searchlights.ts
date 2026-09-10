import {
  AdditiveBlending, CylinderGeometry, DoubleSide, Euler, Group, Mesh, MeshBasicMaterial, type Vector3,
} from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { GROUND_FLAK_SPEC } from '../world/shipGuns'
import type { Team } from '../world/World'

/**
 * # 探照燈的光束
 *
 * 每一座 `searchlight` 地面目標一根圓錐柱：加法混色、雙面、不寫深度，
 * 從裡面看出去和從外面看都有光柱。**有敵機進到偵測距離才亮**，亮了就
 * 追最近的那一架，追的速度有上限（機械式的搖擺）；沒有目標就關。
 * 純畫面 —— 不接砲火、不改砲的散布。
 *
 * 【偵測距離比重砲的射程遠】砲打得到的那一刻燈已經照著了；反過來的話
 * 玩家會先挨砲才看到燈。
 *
 * 【加法混色不用管排序】透明物件的排序錯誤在加法下看不出來 —— 兩根光柱
 * 交疊只是更亮。
 */
export const BEAM_LENGTH = 2500
const BEAM_BOTTOM = 1.5
const BEAM_TOP = 12
const BEAM_OPACITY = 0.06
const BEAM_COLOR = 0xdfe8ff
/** 偵測距離，m：重砲射程（初速 × 引信上限）再多四分之一 */
export const SEARCHLIGHT_RANGE = GROUND_FLAK_SPEC.muzzleVelocity * GROUND_FLAK_SPEC.maxFuse * 1.25
/** 光束轉動的速率上限，rad/s */
const SLEW_RATE = 40 * Math.PI / 180
/** 圓柱的分段 —— 光柱不需要圓，八段就夠 */
const SEGMENTS = 8

/** 從光束底座指向目標的方位與仰角。`yaw` 繞 Y（0 = 朝 −Z）、`pitch` 是仰角 */
export function aimAngles(
  bx: number, by: number, bz: number, tx: number, ty: number, tz: number,
  out: { yaw: number; pitch: number },
): void {
  const dx = tx - bx
  const dy = ty - by
  const dz = tz - bz
  out.yaw = Math.atan2(-dx, -dz)
  out.pitch = Math.atan2(dy, Math.hypot(dx, dz))
}

/** 探照燈要認的目標：隊伍、活著、位置 —— `Combatant` 就滿足 */
export interface SearchTarget {
  readonly team: Team
  readonly alive: boolean
  readonly aircraft: { readonly state: { readonly position: Vector3 } }
}

export interface Searchlights {
  readonly object: Group
  /** 每一渲染幀呼叫。`seconds` 是畫面時間（轉速由它的差算） */
  update(seconds: number, targets: readonly SearchTarget[]): void
  dispose(): void
}

interface Beam {
  readonly mesh: Mesh
  readonly base: GroundTarget
  yaw: number
  pitch: number
}

const WANT = { yaw: 0, pitch: 0 }
const E = /* @__PURE__ */ new Euler()
const TWO_PI = Math.PI * 2

/** 朝目標角度轉，一步最多轉 `maxStep`；方位角走短的那一邊 */
function slewTo(now: number, want: number, maxStep: number, wrap: boolean): number {
  let d = want - now
  if (wrap) d = ((d + Math.PI) % TWO_PI + TWO_PI) % TWO_PI - Math.PI
  if (d > maxStep) d = maxStep
  else if (d < -maxStep) d = -maxStep
  return now + d
}

export function createSearchlights(targets: readonly GroundTarget[]): Searchlights {
  const object = new Group()
  // 圓柱的軸沿 Y，底在 0、頂在 BEAM_LENGTH —— 姿態用 Euler 轉
  const geometry = new CylinderGeometry(BEAM_TOP, BEAM_BOTTOM, BEAM_LENGTH, SEGMENTS, 1, true)
  geometry.translate(0, BEAM_LENGTH / 2, 0)
  const material = new MeshBasicMaterial({
    color: BEAM_COLOR, transparent: true, opacity: BEAM_OPACITY,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
  })
  const beams: Beam[] = []
  for (const t of targets) {
    if (t.unit.id !== 'searchlight') continue
    const mesh = new Mesh(geometry, material)
    mesh.visible = false
    object.add(mesh)
    // 開場朝天：第一次亮起來是從正上方掃下來
    beams.push({ mesh, base: t, yaw: 0, pitch: Math.PI / 2 })
  }
  let last = -1

  return {
    object,
    update(seconds, list) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, seconds - last))
      last = seconds
      const maxStep = SLEW_RATE * dt
      const range2 = SEARCHLIGHT_RANGE * SEARCHLIGHT_RANGE
      for (const b of beams) {
        const base = b.base
        if (!base.alive) {
          b.mesh.visible = false
          continue
        }
        // 最近的一架活著的藍方，在偵測距離內
        let best: SearchTarget | null = null
        let bestD2 = range2
        for (const c of list) {
          if (!c.alive || c.team !== 'blue') continue
          const p = c.aircraft.state.position
          const dx = p.x - base.position.x
          const dy = p.y - base.position.y
          const dz = p.z - base.position.z
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 < bestD2) { bestD2 = d2; best = c }
        }
        if (best === null) {
          b.mesh.visible = false
          continue
        }
        const p = best.aircraft.state.position
        aimAngles(base.position.x, base.position.y + 2, base.position.z, p.x, p.y, p.z, WANT)
        b.yaw = slewTo(b.yaw, WANT.yaw, maxStep, true)
        b.pitch = slewTo(b.pitch, WANT.pitch, maxStep, false)
        b.mesh.visible = true
        b.mesh.position.set(base.position.x, base.position.y + 2, base.position.z)
        // 先把軸從 +Y 往 −Z 倒成仰角（繞 X 負轉），再繞 Y 轉方位 ——
        // 方位 0 = 朝 −Z，與 `aimAngles` 同一個慣例
        E.set(b.pitch - Math.PI / 2, b.yaw, 0, 'YXZ')
        b.mesh.quaternion.setFromEuler(E)
      }
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
