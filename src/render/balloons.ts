import {
  BufferAttribute, BufferGeometry, Group, LineBasicMaterial, LineSegments, Quaternion, Vector3,
  type Object3D,
} from 'three'
import { createGltfLoader } from './geometry/gltfLoader'
import { assetUrl } from '../core/asset'
import { BALLOON_ENVELOPE, type Balloon } from '../world/balloons'

/**
 * # 防空氣球的畫面
 *
 * 氣囊用 `models-src/balloon.glb`（`tools/blender/build_balloon.py`），材質照
 * GLB 原樣畫 —— 與船同一個做法。鋼索是一條 1 像素的線：真的鋼索在幾百公尺外
 * 細得看不見，但遊戲要讓人看得到它在哪。
 *
 * 【破了之後】氣球起火往下掉：愈掉愈快（到終端速度為止）、艇首慢慢垂下，每隔
 * `BURN_PERIOD` 呼叫一次 `onBurn` 讓呼叫端在那裡放一朵火；掉到地面或海面就不
 * 畫了。鋼索在破的那一刻就收掉 —— `World` 那邊它也不再擋東西。**純畫面**，
 * 不參與判定。
 */

export const BALLOON_GLB_URL = '/models/balloon.glb'
/** 開場要載的 GLB 支數（載入進度用） */
export const BALLOON_MODEL_COUNT = 1

let template: Object3D | null = null

/** 開場 await 一次。重複呼叫是 no-op */
export async function preloadBalloonModel(onLoaded: () => void = () => {}): Promise<void> {
  if (template === null) {
    const gltf = await createGltfLoader().loadAsync(assetUrl(BALLOON_GLB_URL))
    template = gltf.scene
  }
  onLoaded()
}

/** 掉落的加速度與終端速度。**純畫面的起始值** */
const FALL_ACCEL = 6
const FALL_TERMINAL = 28
/** 艇首垂下的速率與上限，rad/s、rad */
const DROOP_RATE = 0.35
const DROOP_MAX = 1.1
/** 燒著掉下來時多久放一朵火，s */
const BURN_PERIOD = 0.15

export interface BalloonModels {
  readonly object: Group
  /**
   * 每幀一次。
   *
   * @param dt      畫面時間，s —— 掉落與火都是純裝飾
   * @param groundAt 那一點的地面或海面高度（掉到那裡就不畫）
   * @param onBurn  燒著的氣球在 (x, y, z) 放一朵火
   */
  update(
    balloons: readonly Balloon[], dt: number,
    groundAt: (x: number, z: number) => number,
    onBurn: (x: number, y: number, z: number) => void,
  ): void
  dispose(): void
}

const P = /* @__PURE__ */ new Vector3()
const C = /* @__PURE__ */ new Vector3()
const Q = /* @__PURE__ */ new Quaternion()
const DROOP = /* @__PURE__ */ new Quaternion()
const RIGHT = /* @__PURE__ */ new Vector3(1, 0, 0)

export function createBalloonModels(balloons: readonly Balloon[]): BalloonModels {
  if (template === null) throw new Error('氣球的 GLB 還沒載入 —— 少了 preloadBalloonModel()')
  const object = new Group()
  const bodies = balloons.map(() => {
    const g = template!.clone(true)
    object.add(g)
    return g
  })
  // 每一顆一段：錨點 → 匯集點
  const pos = new Float32Array(balloons.length * 6)
  const lineGeo = new BufferGeometry()
  const attr = new BufferAttribute(pos, 3)
  lineGeo.setAttribute('position', attr)
  const lineMat = new LineBasicMaterial({ color: 0x3a3a36 })
  const lines = new LineSegments(lineGeo, lineMat)
  lines.frustumCulled = false
  object.add(lines)

  // 掉落的狀態，一顆一格
  const fall = new Float32Array(balloons.length)
  const speed = new Float32Array(balloons.length)
  const droop = new Float32Array(balloons.length)
  const burn = new Float32Array(balloons.length)
  const gone = new Uint8Array(balloons.length)

  return {
    object,
    update(list, dt, groundAt, onBurn) {
      for (let i = 0; i < list.length; i++) {
        const b = list[i]!
        const body = bodies[i]!
        const o = i * 6
        if (b.alive) {
          // 【重開的那一場長回來】掉落的狀態全部歸零
          fall[i] = 0; speed[i] = 0; droop[i] = 0; burn[i] = 0; gone[i] = 0
          body.visible = true
          body.position.copy(b.top)
          body.quaternion.copy(b.orientation)
          pos[o] = b.anchor.x; pos[o + 1] = b.anchor.y; pos[o + 2] = b.anchor.z
          pos[o + 3] = b.top.x; pos[o + 4] = b.top.y; pos[o + 5] = b.top.z
          continue
        }
        // 鋼索收成一點
        pos[o + 3] = pos[o]!; pos[o + 4] = pos[o + 1]!; pos[o + 5] = pos[o + 2]!
        if (gone[i] === 1) continue
        speed[i] = Math.min(FALL_TERMINAL, speed[i]! + FALL_ACCEL * dt)
        fall[i] = fall[i]! + speed[i]! * dt
        droop[i] = Math.min(DROOP_MAX, droop[i]! + DROOP_RATE * dt)
        // 艇首朝下：繞氣球自己的橫軸轉（−Z 艇首往下 = 繞 +X 負方向）
        DROOP.setFromAxisAngle(RIGHT, -droop[i]!)
        Q.copy(b.orientation).multiply(DROOP)
        P.copy(b.top)
        P.y -= fall[i]!
        body.position.copy(P)
        body.quaternion.copy(Q)
        C.copy(BALLOON_ENVELOPE.center).applyQuaternion(Q).add(P)
        if (C.y < groundAt(C.x, C.z) + 2) {
          gone[i] = 1
          body.visible = false
          continue
        }
        burn[i] = burn[i]! - dt
        if (burn[i]! <= 0) {
          burn[i] = BURN_PERIOD
          onBurn(C.x, C.y, C.z)
        }
      }
      attr.needsUpdate = true
    },
    dispose() {
      lineGeo.dispose()
      lineMat.dispose()
      // 【模型的幾何與材質是樣板共用的】`clone(true)` 不複製 geometry／material，
      // 在這裡 dispose 的話下一場的氣球是一團空的 GPU 緩衝
    },
  }
}
