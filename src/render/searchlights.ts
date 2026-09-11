import {
  AdditiveBlending, BufferAttribute, CanvasTexture, CylinderGeometry, DoubleSide, Group, Mesh,
  MeshBasicMaterial, Quaternion, Sprite, SpriteMaterial, Texture, Vector3,
} from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { GROUND_FLAK_SPEC } from '../world/shipGuns'
import type { Team } from '../world/World'

/**
 * # 探照燈的光束
 *
 * 每一座 `searchlight` 地面目標一根圓錐柱：加法混色、雙面、不寫深度，
 * 從裡面看出去和從外面看都有光柱。**有敵機進到偵測距離才亮**，亮了就
 * 追燈最少的那一架，追的速度有上限；沒有目標就關。
 * 純畫面 —— 不接砲火、不改砲的散布。
 *
 * 【沿大圓弧轉】光束的方向是一個向量，每幀朝目標方向繞兩者的叉積軸轉，
 * 一步最多 `SLEW_RATE × dt`，俯仰與方位同時到。分軸各自限速的話，從天頂
 * 掃下來會先倒到仰角、再繞水平掃過去，看起來像兩段動作。
 *
 * 【偵測距離比重砲的射程遠】砲打得到的那一刻燈已經照著了；反過來的話
 * 玩家會先挨砲才看到燈。
 *
 * 【加法混色不用管排序】透明物件的排序錯誤在加法下看不出來 —— 兩根光柱
 * 交疊只是更亮。
 */
export const BEAM_LENGTH = 5000
const BEAM_BOTTOM = 1.5
/** 頂端半徑：張角與長度一起放大，光柱不變細 */
const BEAM_TOP = 24
/**
 * 鎖定之後的微晃，rad。兩個慢頻率的正弦 —— 操作手在追，不是伺服在追。
 * **要小於光柱的張角**（24 / 5,000 ≈ 0.28°），飛機與鏡頭才一直在光裡；
 * 大過張角的話光束會掃過去而不是罩著，眩光一閃一閃。
 */
const WOBBLE_AMPLITUDE = 0.125 * Math.PI / 180
const BEAM_OPACITY = 0.06
const BEAM_COLOR = 0xdfe8ff
/** 偵測距離，m：重砲射程（初速 × 引信上限）再多四分之一 */
export const SEARCHLIGHT_RANGE = GROUND_FLAK_SPEC.muzzleVelocity * GROUND_FLAK_SPEC.maxFuse * 1.25
/** 光束轉動的速率上限，rad/s */
const SLEW_RATE = 40 * Math.PI / 180
/** 圓柱的分段 —— 光柱不需要圓，八段就夠 */
const SEGMENTS = 8
/** 眩光在畫面上的視角大小，rad：貼圖的邊長 = 距離 × 它 */
const GLARE_ANGULAR_SIZE = 0.08

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

/** 光柱在離燈座 `axial` 公尺處的半徑：底 `BEAM_BOTTOM`、頂 `BEAM_TOP` 之間線性 */
export function beamRadiusAt(axial: number): number {
  return BEAM_BOTTOM + (BEAM_TOP - BEAM_BOTTOM) * (axial / BEAM_LENGTH)
}

/**
 * 眩光強度 0…1：**鏡頭在光柱裡才有**。`axial` 是鏡頭沿光束軸的距離、
 * `radial` 是離軸的垂直距離；出了光柱的長度或半徑就是 0，靠近柱壁略暗。
 */
export function glareStrength(axial: number, radial: number): number {
  if (axial <= 0 || axial > BEAM_LENGTH) return 0
  const r = beamRadiusAt(axial)
  if (radial >= r) return 0
  const t = radial / r
  return 1 - t * t * t * t
}

/**
 * 十字狀的眩光貼圖：兩道細長的光芒加中央的光暈，畫在 canvas 上。
 * **只在瀏覽器裡叫**（node 測試傳一張空的 `Texture`）。
 */
export function makeGlareTexture(size = 256): Texture {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const c = size / 2
  ctx.clearRect(0, 0, size, size)
  // 中央光暈
  const core = ctx.createRadialGradient(c, c, 0, c, c, size * 0.18)
  core.addColorStop(0, 'rgba(255,255,255,1)')
  core.addColorStop(0.4, 'rgba(255,250,235,0.55)')
  core.addColorStop(1, 'rgba(255,250,235,0)')
  ctx.fillStyle = core
  ctx.fillRect(0, 0, size, size)
  // 兩道光芒：沿長軸從中心往兩端淡出，橫向極窄
  for (const [w, h] of [[size, size * 0.05], [size * 0.05, size]] as const) {
    const g = w > h
      ? ctx.createLinearGradient(0, c, size, c)
      : ctx.createLinearGradient(c, 0, c, size)
    g.addColorStop(0, 'rgba(255,255,255,0)')
    g.addColorStop(0.5, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(c - w / 2, c - h / 2, w, h)
  }
  const tex = new CanvasTexture(canvas)
  tex.needsUpdate = true
  return tex
}

/** 探照燈要認的目標：隊伍、活著、位置 —— `Combatant` 就滿足 */
export interface SearchTarget {
  readonly team: Team
  readonly alive: boolean
  readonly aircraft: { readonly state: { readonly position: Vector3 } }
}

export interface Searchlights {
  readonly object: Group
  /**
   * 每一渲染幀呼叫。`seconds` 是畫面時間（轉速由它的差算）；`camera` 是鏡頭
   * 的世界座標，眩光看它
   */
  update(seconds: number, targets: readonly SearchTarget[], camera: Vector3): void
  dispose(): void
}

interface Beam {
  readonly mesh: Mesh
  /** 燈座上的眩光，光束掃到鏡頭才亮 */
  readonly glare: Sprite
  readonly base: GroundTarget
  /** 微晃的相位，每座不同 */
  readonly phase: number
  /** 現在照的是 `targets` 裡第幾架。−1 = 沒有 */
  target: number
  /** 光束此刻的方向，單位向量 */
  readonly dir: Vector3
}

const WANT = { yaw: 0, pitch: 0 }
const UP = /* @__PURE__ */ new Vector3(0, 1, 0)
const WANT_DIR = /* @__PURE__ */ new Vector3()
const AXIS = /* @__PURE__ */ new Vector3()
const Q = /* @__PURE__ */ new Quaternion()
const TO_CAMERA = /* @__PURE__ */ new Vector3()

/**
 * 把 `dir` 朝 `want` 沿大圓弧轉，一步最多 `maxStep` rad；兩者反向時繞 +X
 * 轉（哪一邊都是最短）。轉完仍是單位向量。
 */
function slewDir(dir: Vector3, want: Vector3, maxStep: number): void {
  const angle = Math.acos(Math.min(1, Math.max(-1, dir.dot(want))))
  if (angle <= maxStep) {
    dir.copy(want)
    return
  }
  AXIS.crossVectors(dir, want)
  if (AXIS.lengthSq() < 1e-12) AXIS.set(1, 0, 0)
  else AXIS.normalize()
  Q.setFromAxisAngle(AXIS, maxStep)
  dir.applyQuaternion(Q).normalize()
}

/**
 * @param glareTexture 眩光的貼圖，瀏覽器用 `makeGlareTexture()`。**由呼叫端
 *   持有**，這裡不 dispose —— 每一場重建光束時貼圖不必重畫
 */
export function createSearchlights(targets: readonly GroundTarget[], glareTexture: Texture): Searchlights {
  const object = new Group()
  // 圓柱的軸沿 Y，底在 0、頂在 BEAM_LENGTH —— 姿態用 Euler 轉
  const geometry = new CylinderGeometry(BEAM_TOP, BEAM_BOTTOM, BEAM_LENGTH, SEGMENTS, 1, true)
  geometry.translate(0, BEAM_LENGTH / 2, 0)
  // 【尾端漸層消失】頂點色從底的 1 淡到頂的 0；加法混色下黑就是「沒有光」，
  // 光柱的末端於是沒有一條硬邊
  const pos = geometry.getAttribute('position')
  const col = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const v = 1 - pos.getY(i) / BEAM_LENGTH
    col[i * 3] = v; col[i * 3 + 1] = v; col[i * 3 + 2] = v
  }
  geometry.setAttribute('color', new BufferAttribute(col, 3))
  const material = new MeshBasicMaterial({
    color: BEAM_COLOR, vertexColors: true, transparent: true, opacity: BEAM_OPACITY,
    blending: AdditiveBlending, depthWrite: false, side: DoubleSide, fog: false,
  })
  // 【不做深度測試】眩光是鏡頭裡的現象，不是場景裡的物體 —— 機翼擋在前面
  // 它也該炸開在機翼上
  const glareMaterial = new SpriteMaterial({
    map: glareTexture, color: 0xffffff, blending: AdditiveBlending, transparent: true,
    depthWrite: false, depthTest: false,
  })
  const beams: Beam[] = []
  for (const t of targets) {
    if (t.unit.id !== 'searchlight') continue
    const mesh = new Mesh(geometry, material)
    mesh.visible = false
    object.add(mesh)
    const glare = new Sprite(glareMaterial.clone())
    glare.visible = false
    object.add(glare)
    // 開場朝天：第一次亮起來是從正上方掃下來
    beams.push({ mesh, glare, base: t, phase: beams.length * 1.9, target: -1, dir: new Vector3(0, 1, 0) })
  }
  glareMaterial.dispose()
  let last = -1
  /** 每一架身上有幾盞燈。長度跟著目標清單走，只在清單變長時重配 */
  let loads = new Int32Array(0)

  return {
    object,
    update(seconds, list, camera) {
      const dt = last < 0 ? 0 : Math.min(0.1, Math.max(0, seconds - last))
      last = seconds
      const maxStep = SLEW_RATE * dt
      const range2 = SEARCHLIGHT_RANGE * SEARCHLIGHT_RANGE
      // 【每一架身上有幾盞燈】從上一幀的鎖定數起來，這一幀換鎖時就地增減
      if (loads.length < list.length) loads = new Int32Array(list.length)
      loads.fill(0)
      for (const b of beams) if (b.target >= 0 && b.target < list.length) loads[b.target]!++
      for (const b of beams) {
        const base = b.base
        if (!base.alive) {
          b.mesh.visible = false
          b.glare.visible = false
          continue
        }
        // 【分攤】挑「燈最少的那一架」，同數再比距離 —— 第一架進來時全部照它，
        // 第二架進來就有燈換過去。自己現在照的那一架只要不比別架多超過一盞
        // 就不換，否則兩座燈會每一幀互相換來換去
        let best = -1
        let bestLoad = Infinity
        let bestD2 = range2
        let keepD2 = -1
        for (let i = 0; i < list.length; i++) {
          const c = list[i]!
          if (!c.alive || c.team !== 'blue') continue
          const p = c.aircraft.state.position
          const dx = p.x - base.position.x
          const dy = p.y - base.position.y
          const dz = p.z - base.position.z
          const d2 = dx * dx + dy * dy + dz * dz
          if (d2 >= range2) continue
          if (i === b.target) keepD2 = d2
          const load = loads[i]! - (i === b.target ? 1 : 0)
          if (load < bestLoad || (load === bestLoad && d2 < bestD2)) {
            best = i; bestLoad = load; bestD2 = d2
          }
        }
        if (best < 0) {
          if (b.target >= 0 && b.target < loads.length) loads[b.target]!--
          b.target = -1
          b.mesh.visible = false
          b.glare.visible = false
          continue
        }
        if (keepD2 >= 0 && loads[b.target]! - 1 <= bestLoad) best = b.target
        if (best !== b.target) {
          if (b.target >= 0 && b.target < loads.length) loads[b.target]!--
          loads[best]!++
          b.target = best
        }
        const p = list[best]!.aircraft.state.position
        aimAngles(base.position.x, base.position.y + 2, base.position.z, p.x, p.y, p.z, WANT)
        // 【追的是「目標附近」】瞄準點加一個慢慢繞的偏差，光柱才不會像釘死的
        const w = b.phase
        WANT.yaw += WOBBLE_AMPLITUDE * Math.sin(seconds * 2.7 + w)
        WANT.pitch += WOBBLE_AMPLITUDE * Math.sin(seconds * 1.9 + w * 1.6)
        // 方位 0 = 朝 −Z，與 `aimAngles` 同一個慣例
        const ch = Math.cos(WANT.pitch)
        WANT_DIR.set(-Math.sin(WANT.yaw) * ch, Math.sin(WANT.pitch), -Math.cos(WANT.yaw) * ch)
        slewDir(b.dir, WANT_DIR, maxStep)
        b.mesh.visible = true
        b.mesh.position.set(base.position.x, base.position.y + 2, base.position.z)
        // 圓柱的軸是 +Y；八段對稱，繞軸的滾轉角無所謂
        b.mesh.quaternion.setFromUnitVectors(UP, b.dir)
        // 【眩光】鏡頭在光柱裡才亮。貼圖的邊長隨距離放大，畫面上的視角大小才固定
        TO_CAMERA.copy(camera).sub(b.mesh.position)
        const dist = TO_CAMERA.length()
        const axial = b.dir.dot(TO_CAMERA)
        const radial = Math.sqrt(Math.max(0, dist * dist - axial * axial))
        const strength = glareStrength(axial, radial)
        const glare = b.glare
        if (strength <= 0) {
          glare.visible = false
        } else {
          glare.visible = true
          glare.position.copy(b.mesh.position)
          const size = dist * GLARE_ANGULAR_SIZE
          glare.scale.set(size, size, 1)
          ;(glare.material as SpriteMaterial).opacity = strength
        }
      }
    },
    dispose() {
      geometry.dispose()
      material.dispose()
      for (const b of beams) (b.glare.material as SpriteMaterial).dispose()
    },
  }
}
