import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { clamp } from '../core/math'
import { makeScratch } from '../core/pool'

const S = makeScratch(7, 4)
const BASIS = new Matrix4()
const ORIGIN = new Vector3()
const WORLD_UP = new Vector3(0, 1, 0)

export interface CameraRigOptions {
  /** 第三人稱相機沿視線往後退的距離，m */
  thirdDistance: number
  /**
   * 再往**世界上方**抬起的高度，m。見 chaseOffset。
   *
   * 【與 thirdDistance 一起決定機身在畫面上的高度】相機看的是機首前方
   * aimPointDistance 處的瞄準點，那個點幾乎在地平線上，所以機身的下沉量
   * ≈ atan(h/d)：相機拉近了就得跟著降，否則機身會掉出畫面下緣。
   *
   * 但也不能太低——準星壓在畫面正中央，機身太靠近中心，垂尾就會擋住它。
   * 3.0/12 是 13.6°，1280×720 下機身落在中心下方約 120 px，垂尾頂端距準星
   * 還有一段。日後改 thirdDistance 一定要連著重算這個值。
   */
  thirdHeight: number
  /** 彈簧剛度，越大越貼合飛機 */
  springStiffness: number
  /** 阻尼比，1.0 為臨界阻尼 */
  springDamping: number
  fovBase: number
  /** 高速時額外增加的 FOV，度 */
  fovSpeedGain: number
  /** FOV 增益飽和的速度，m/s */
  fovSpeedRef: number
  /** 自由視角放開後回正的時間常數，秒 */
  lookReturnTime: number
  /** 相機上方向量靠回世界上方的時間常數，秒。見 baseOrientation */
  levelTime: number
  /**
   * 機首視角的眼點位置（**機體座標**，量自座艙罩）。
   *
   * 預設值是 P-51D 的；`main.ts` 每次建模後改寫成該機種的 `model.eyePoint`。
   */
  firstPersonOffset: Vector3
  /** 相機注視點在機首前方的距離 */
  aimPointDistance: number
  /** 失速抖振的最大位移，m */
  shakeAmplitude: number
}

export const DEFAULT_CAMERA_OPTIONS: CameraRigOptions = {
  // 12 m：11.28 m 翼展在 1280 寬的畫面上約佔 37%（32 m 時只有 14%）。機尾在
  // 機體 z +5.2，所以相機離機尾還有 6.8 m，遠大於 near = 1
  thirdDistance: 12,
  thirdHeight: 3.0,
  springStiffness: 14,
  springDamping: 1.0,
  fovBase: 65,
  fovSpeedGain: 8,
  fovSpeedRef: 200,
  lookReturnTime: 0.25,
  levelTime: 0.25,
  firstPersonOffset: new Vector3(0, 0.80, 0.70),
  aimPointDistance: 400,
  shakeAmplitude: 0.35,
}

/**
 * 相機。第三人稱彈簧阻尼跟隨、機首視角、右鍵自由視角、FOV 隨速度變化、失速抖振。
 *
 * 【相機不隨機體側滾】瞄準點是世界固定的，滑鼠位移繞 `camera.quaternion` 的
 * 右／上軸旋轉它（見 input/aim.ts）。相機若跟著機體滾，「螢幕右」就會跟著坡度
 * 轉——持續右移滑鼠 → 飛機加坡度 → 螢幕右軸再轉 → 更多坡度，正回饋成螺旋。
 * 坡度靠機體模型與坡度儀呈現，不靠相機。
 */
export class CameraRig {
  readonly options: CameraRigOptions
  /**
   * 上一次 update 算出的**視角基準**：無滾轉、且不含自由視角偏移。
   *
   * 瞄準點的畫面夾制（input/aim.ts 的 clampAimToViewport）必須拿它，不能拿
   * camera.quaternion。右鍵轉頭時世界固定的瞄準點會落到相機視野外，用實際
   * 相機姿態去夾就會把它拉回畫面裡——玩家只是轉頭看一眼，飛機卻跟著轉向。
   */
  readonly viewBase = new Quaternion()
  /** 相機相對飛機的偏移，見 chaseOffset。彈簧作用在它身上而不是世界座標 */
  private readonly offset = new Vector3()
  private readonly offsetVel = new Vector3()
  /** 相機的上方向量。逐幀正交化並緩慢靠回世界上方，見 baseOrientation */
  private readonly up = new Vector3(0, 1, 0)
  private initialised = false
  private shake = 0
  private shakePhase = 0
  private appliedYaw = 0
  private appliedPitch = 0

  constructor(options: CameraRigOptions = DEFAULT_CAMERA_OPTIONS) {
    this.options = { ...options, firstPersonOffset: options.firstPersonOffset.clone() }
  }

  /** 失速抖振強度，0..1。 */
  setShake(intensity: number): void {
    this.shake = clamp(intensity, 0, 1)
  }

  /**
   * 重置平滑狀態：偏移歸位、自由視角歸零。重生時呼叫。
   *
   * 不需要位置——彈簧追的是**相對飛機的偏移**，飛機瞬移時相機跟著瞬移，
   * 本來就不會從舊位置飛過來。要清掉的是上一條航跡留下的落後量與視角角度。
   */
  snapTo(orientation: Quaternion): void {
    const base = this.baseOrientation(orientation, 0, S.q[3]!)
    const forward = S.v[0]!.set(0, 0, -1).applyQuaternion(base)
    this.chaseOffset(forward, this.offset)
    this.offsetVel.set(0, 0, 0)
    this.appliedYaw = 0
    this.appliedPitch = 0
    this.initialised = true
  }

  /**
   * 第三人稱相機相對飛機的目標偏移：沿視線往後退，再往**世界上方**抬起。
   *
   * 【為什麼彈簧作用在偏移上而不是世界座標】對世界座標下的移動目標，臨界阻尼
   * 彈簧有穩態誤差 c·v/k = 2·ζ·v/√k——**正比於速度**。以計畫的 k=14、ζ=1 代入
   * 巡航 160 m/s 是 85 m，實測相機被拖到 83 m 外，飛機小成一個點。改成追偏移
   * 之後，等速直線飛行的目標偏移是常數，落後歸零；只有機首**轉向**時偏移才會
   * 移動——那正是 spec §9 要的「大 G 機動時相機略微落後」。
   *
   * 【為什麼抬升用世界上方而不是視角上方】兩者在平飛時完全一樣，差別只出現在
   * 垂直爬升／俯衝——視角上方在那裡指向水平，抬升會把相機甩到側面去，而且
   * 甩去哪一側取決於方位角，正好是接近垂直時最不穩定的量。世界上方沒有這個
   * 問題：整條式子只依賴視線方向，筋斗翻過天頂時相機位置是連續的。
   */
  private chaseOffset(forward: Vector3, out: Vector3): Vector3 {
    return out.copy(WORLD_UP).multiplyScalar(this.options.thirdHeight)
      .addScaledVector(forward, -this.options.thirdDistance)
  }

  /**
   * 視角基準：機首指向 ＋ 一個「幾乎是世界上方」的上方向量，去掉機體的滾轉。
   *
   * 【為什麼不直接拿世界上方去 lookAt】機首垂直朝上／朝下時，世界上方與視線
   * 平行，方位角變成未定義，相機會繞著飛機瞬間甩過去。筋斗每圈會經過兩次，
   * 不是罕見情況。改成自己持有一個上方向量：每幀先把它對視線正交化，再以
   * `levelTime` 為時間常數靠回「世界上方在垂直於視線的平面上的投影」。接近
   * 垂直時那個投影退化，於是**不更新目標**，只靠正交化把上一幀的值帶過去，
   * 相機因此平順地翻過天頂。
   */
  private baseOrientation(orientation: Quaternion, dt: number, out: Quaternion): Quaternion {
    const f = S.v[5]!.set(0, 0, -1).applyQuaternion(orientation).normalize()

    const level = S.v[6]!.copy(WORLD_UP).addScaledVector(f, -WORLD_UP.dot(f))
    // 0.02 ≈ 距垂直 8° 以內就凍結目標，避免在天頂附近追一個亂跳的方向
    const lenSq = level.lengthSq()
    if (lenSq > 0.02) {
      const k = dt > 0 ? 1 - Math.exp(-dt / this.options.levelTime) : 1
      this.up.lerp(level.multiplyScalar(1 / Math.sqrt(lenSq)), k)
    }

    this.up.addScaledVector(f, -this.up.dot(f))
    if (this.up.lengthSq() < 1e-6) {
      // 只有在 up 恰好與視線平行時才會走到，任取一個垂直方向重新起算
      this.up.copy(Math.abs(f.y) < 0.9 ? WORLD_UP : S.v[0]!.set(1, 0, 0))
        .addScaledVector(f, -this.up.dot(f))
    }
    this.up.normalize()

    // up 已與 f 正交且為單位向量，lookAt 取出的 +Y 就是 up 本身，不會退化
    BASIS.lookAt(ORIGIN, f, this.up)
    return out.setFromRotationMatrix(BASIS)
  }

  update(
    camera: PerspectiveCamera,
    position: Vector3,
    orientation: Quaternion,
    tas: number,
    viewMode: 'third' | 'first',
    lookYaw: number,
    lookPitch: number,
    dt: number,
  ): void {
    const o = this.options

    // 自由視角角度以時間常數平滑追隨（放開時目標為 0，自然回正）
    const k = dt > 0 ? 1 - Math.exp(-dt / o.lookReturnTime) : 1
    this.appliedYaw += (lookYaw - this.appliedYaw) * k
    this.appliedPitch += (lookPitch - this.appliedPitch) * k

    // 視角偏移施加於視角座標，因此不影響飛行指令
    const lookQuat = S.q[0]!.setFromAxisAngle(S.v[1]!.set(0, 1, 0), this.appliedYaw)
    const pitchQuat = S.q[1]!.setFromAxisAngle(S.v[2]!.set(1, 0, 0), this.appliedPitch)
    const viewQuat = this.baseOrientation(orientation, dt, S.q[2]!)
    this.viewBase.copy(viewQuat)   // 疊上自由視角**之前**，見 viewBase 的說明
    viewQuat.multiply(lookQuat).multiply(pitchQuat)

    if (viewMode === 'first') {
      // 眼點是機體上的一個座位，**要跟著滾**——用完整姿態；看的方向才用無滾轉基準
      const eye = S.v[3]!.copy(o.firstPersonOffset).applyQuaternion(orientation).add(position)
      camera.position.copy(eye)
      camera.quaternion.copy(viewQuat)
      this.initialised = false // 切回第三人稱時重新吸附
    } else {
      const forward = S.v[3]!.set(0, 0, -1).applyQuaternion(viewQuat)
      const desired = this.chaseOffset(forward, S.v[0]!)

      if (!this.initialised) {
        this.offset.copy(desired)
        this.offsetVel.set(0, 0, 0)
        this.initialised = true
      } else {
        // 彈簧阻尼：加速度 = k(目標 − 現況) − c·速度
        const c = 2 * o.springDamping * Math.sqrt(o.springStiffness)
        const accel = S.v[4]!
          .copy(desired).sub(this.offset).multiplyScalar(o.springStiffness)
          .addScaledVector(this.offsetVel, -c)
        this.offsetVel.addScaledVector(accel, dt)
        this.offset.addScaledVector(this.offsetVel, dt)
      }

      camera.position.copy(position).add(this.offset)
      // 注視機首前方的瞄準點，使準星穩定於畫面中央區
      const target = S.v[4]!.copy(position).addScaledVector(forward, o.aimPointDistance)
      camera.up.set(0, 1, 0).applyQuaternion(viewQuat)
      camera.lookAt(target)
    }

    // 失速抖振：高頻小幅位移
    if (this.shake > 0) {
      this.shakePhase += dt * 47
      const a = this.shake * o.shakeAmplitude
      camera.position.x += Math.sin(this.shakePhase * 1.7) * a
      camera.position.y += Math.sin(this.shakePhase * 2.3) * a
    }

    const fov = o.fovBase + o.fovSpeedGain * clamp(tas / o.fovSpeedRef, 0, 1)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }
}
