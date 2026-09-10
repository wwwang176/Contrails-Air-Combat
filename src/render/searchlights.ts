import {
  AdditiveBlending, CylinderGeometry, DoubleSide, Euler, Group, Mesh, MeshBasicMaterial,
} from 'three'
import type { GroundTarget } from '../world/groundTargets'

/**
 * # 探照燈的光束
 *
 * 每一座 `searchlight` 地面目標一根圓錐柱：加法混色、雙面、不寫深度，
 * 從裡面看出去和從外面看都有光柱。掃描是時間的純函數（兩個不同週期的
 * 正弦），每座相位不同，**不接砲火、不接目標**。死了就藏，復活回來。
 *
 * 【加法混色不用管排序】透明物件的排序錯誤在加法下看不出來 —— 兩根光柱
 * 交疊只是更亮。
 */
export const BEAM_LENGTH = 2500
const BEAM_BOTTOM = 1.5
const BEAM_TOP = 12
const BEAM_OPACITY = 0.06
const BEAM_COLOR = 0xdfe8ff
/** 仰角的中心與擺幅，rad */
const PITCH_MID = 55 * Math.PI / 180
const PITCH_SWING = 20 * Math.PI / 180
/** 兩個掃描週期，s。互質才不會每隔幾秒重複同一個姿態 */
const YAW_PERIOD = 37
const PITCH_PERIOD = 23
/** 圓柱的分段 —— 光柱不需要圓，八段就夠 */
const SEGMENTS = 8

/** 這一座此刻指向哪裡。`yaw` 繞 Y、`pitch` 是仰角 */
export function sweepAngles(phase: number, seconds: number, out: { yaw: number; pitch: number }): void {
  out.yaw = (seconds * (Math.PI * 2 / YAW_PERIOD) + phase) % (Math.PI * 2)
  out.pitch = PITCH_MID + PITCH_SWING * Math.sin(seconds * (Math.PI * 2 / PITCH_PERIOD) + phase * 1.7)
}

export interface Searchlights {
  readonly object: Group
  /** 每一渲染幀呼叫。目標在建構時就綁定了，這裡只要畫面時間 */
  update(seconds: number): void
  dispose(): void
}

const ANGLES = { yaw: 0, pitch: 0 }
const E = /* @__PURE__ */ new Euler()

export function createSearchlights(targets: readonly GroundTarget[]): Searchlights {
  const object = new Group()
  // 圓柱的軸沿 Y，底在 0、頂在 BEAM_LENGTH —— 姿態用 Euler 轉
  const geometry = new CylinderGeometry(BEAM_TOP, BEAM_BOTTOM, BEAM_LENGTH, SEGMENTS, 1, true)
  geometry.translate(0, BEAM_LENGTH / 2, 0)
  const material = new MeshBasicMaterial({
    color: BEAM_COLOR, transparent: true, opacity: BEAM_OPACITY,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
  })
  const beams: { mesh: Mesh; target: GroundTarget; phase: number }[] = []
  for (const t of targets) {
    if (t.unit.id !== 'searchlight') continue
    const mesh = new Mesh(geometry, material)
    object.add(mesh)
    beams.push({ mesh, target: t, phase: beams.length * 1.9 })
  }

  return {
    object,
    update(seconds) {
      for (const b of beams) {
        const t = b.target
        b.mesh.visible = t.alive
        if (!t.alive) continue
        sweepAngles(b.phase, seconds, ANGLES)
        b.mesh.position.set(t.position.x, t.position.y + 2, t.position.z)
        // 先把軸從 +Y 倒成仰角，再繞 Y 轉方位
        E.set(Math.PI / 2 - ANGLES.pitch, ANGLES.yaw, 0, 'YXZ')
        b.mesh.quaternion.setFromEuler(E)
      }
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
