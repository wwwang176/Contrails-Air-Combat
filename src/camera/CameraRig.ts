import { Matrix4, Quaternion, Vector3, type PerspectiveCamera } from 'three'
import { clamp } from '../core/math'
import { makeScratch } from '../core/pool'
import { BOMB_CONE_HALF_ANGLE, coneClamp, sightUp } from './bombsight'

/**
 * 【投彈分支只准用 v[9] 以後】前九格是第三人稱／機首視角在用的，其中
 * `S.v[5]` 與 `S.v[6]` 屬於 `baseOrientation` 內部。共用一格的症狀是
 * 「視線偶爾抽一下、而且只在特定姿態下出現」—— 找不回源頭的那一種。
 */
const S = makeScratch(15, 4)
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
  /**
   * 彈簧剛度，越大越貼合。
   *
   * 【為什麼是 120 而不是 14】彈簧追的是 viewDir，而 viewDir 是**滑鼠**方向。
   * 穩態落後角 ≈ 2ω/√k：機身自己轉向時 ω ≤ 25°/s，k=14 只落後 8°；但滑鼠
   * 輕鬆就到 80°/s，同一個 k 落後 42°——機身整個被甩出畫面邊緣（實測）。
   * k=120 在 80°/s 下落後約 12°，收斂約 0.18 s，剩下的是「有重量」而不是
   * 「跟不上」。
   */
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
  /**
   * 自由視角**拖曳中**追隨滑鼠的時間常數，秒。
   *
   * 【為什麼要跟回正分開】回正是相機自己在動，慢一點才順；拖曳是玩家正在
   * 下指令，慢一點就只是延遲。共用 0.25 s 的話，轉頭要等四分之一秒才跟上，
   * 手感像在拖一塊濕布。
   */
  lookFollowTime: number
  /** 相機上方向量靠回世界上方的時間常數，秒。見 baseOrientation */
  levelTime: number
  /**
   * 機首視角的眼點位置（**機體座標**，量自座艙罩）。
   *
   * 預設值是 P-51D 的；`main.ts` 每次建模後改寫成該機種的 `model.eyePoint`。
   */
  firstPersonOffset: Vector3
  /**
   * 投彈瞄具的眼點（**機體座標**），在機腹中央。
   *
   * `main.ts` 每次換飛機後改寫成該機種的 `model.bombPoint`，與
   * `firstPersonOffset` 同一個做法。
   */
  bombPoint: Vector3
  /** 相機注視點在機首前方的距離 */
  aimPointDistance: number
}

/**
 * 投彈視線**追隨落點**的時間常數，秒。**起始值，由試飛裁定。**
 *
 * 只作用在投彈視野之內。切進投彈模式的那一幀是直接對正的 —— 換視角是一個
 * 瞬間，不是一段動作。
 */
export const BOMB_LERP_TIME = 0.25

const CONE_COS = Math.cos(BOMB_CONE_HALF_ANGLE)
const CONE_SIN = Math.sin(BOMB_CONE_HALF_ANGLE)

export const DEFAULT_CAMERA_OPTIONS: CameraRigOptions = {
  // 12 m：11.28 m 翼展在 1280 寬的畫面上約佔 37%（32 m 時只有 14%）。機尾在
  // 機體 z +5.2，所以相機離機尾還有 6.8 m，遠大於 near = 1
  thirdDistance: 12,
  thirdHeight: 3.0,
  springStiffness: 120,
  springDamping: 1.0,
  fovBase: 65,
  fovSpeedGain: 8,
  fovSpeedRef: 200,
  lookReturnTime: 0.25,
  lookFollowTime: 0.04,
  levelTime: 0.25,
  firstPersonOffset: new Vector3(0, 0.80, 0.70),
  // B-17G 的值。`main.ts` 每次建模後改寫成該機種的 `model.bombPoint`
  bombPoint: new Vector3(0, -0.76, 0),
  aimPointDistance: 400,
}

/**
 * 第三人稱那兩個距離的基準翼展，m。**`DEFAULT_CAMERA_OPTIONS` 就是照它訂的**
 * —— P-51D 的 11.28 m 在 1280 寬的畫面上約佔 37%。
 */
export const REFERENCE_SPAN = 11.28

/**
 * 相機距離對翼展的**次線性**指數。
 *
 * 【為什麼不是 1】`d ∝ b` 會讓每一台在畫面上佔一樣寬 —— 數學上乾淨，玩起來
 * 卻是「所有飛機一樣大」，體型完全消失。要的是大小飛機在畫面上讀得出差別，
 * 但大的又不會佔滿整個畫面。
 *
 * 【為什麼不是 0】完全不縮的話 B-17G（31.62 m）的翼尖切出畫面兩側，而且
 * 機尾（機體 z 16.27）比 12 m 的相機還遠 4 m —— 整台戳穿鏡頭。
 *
 * `d ∝ b^k` 之下，佔畫面的比例 ∝ `b^(1−k)`。四個候選各拍過一張 B-17G：
 *
 * ```
 *   k     Bf109  P-51D  He111  B-17G    相機到 B-17G 機尾的餘裕
 *   0.4    34%    37%    56%    69%      1.8 m   ← 急拉時可能穿幫
 *   0.6    35%    37%    49%    56%      6.1 m   ← 出貨值
 *   0.7    36%    37%    46%    50%      8.4 m   ← 兩台轟炸機分不太出來
 *   1.0    37%    37%    37%    37%     21.4 m   ← 全都一樣大
 * ```
 *
 * **0.6 是看四張截圖定的。**
 *
 * 高度用**同一個** k，俯角才不會隨機種變。
 */
export const SPAN_EXPONENT = 0.6

/**
 * 依翼展算第三人稱的距離與高度。基準是 P-51D —— 它逐字給回預設值。
 *
 * ```
 *   機種      翼展    距離    高度
 *   Bf109    9.92   11.1    2.8
 *   P-51D   11.28   12.0    3.0     ← 基準，逐字不變
 *   He 111  22.60   18.2    4.6
 *   B-17G   31.62   22.3    5.6
 * ```
 */
export function thirdPersonFor(span: number): { distance: number; height: number } {
  const k = (span / REFERENCE_SPAN) ** SPAN_EXPONENT
  return {
    distance: DEFAULT_CAMERA_OPTIONS.thirdDistance * k,
    height: DEFAULT_CAMERA_OPTIONS.thirdHeight * k,
  }
}

/**
 * 相機。第三人稱彈簧阻尼跟隨、機首視角、右鍵自由視角、FOV 隨速度變化。
 *
 * 【相機不隨機體側滾】瞄準點是世界固定的，滑鼠位移繞相機的右／上軸旋轉它
 * （見 input/aim.ts）。相機若跟著機體滾，「螢幕右」就會跟著坡度轉——持續右移
 * 滑鼠 → 飛機加坡度 → 螢幕右軸再轉 → 更多坡度，正回饋成螺旋。坡度靠機體模型
 * 與姿態儀呈現，不靠相機。
 */
export class CameraRig {
  readonly options: CameraRigOptions
  /**
   * 上一次 update 算出的**視角基準**：無滾轉、且不含自由視角偏移。
   *
   * 滑鼠位移的旋轉軸（input/aim.ts 的 slewAimWorld）必須拿它，不能拿
   * camera.quaternion——否則右鍵轉頭時，滑鼠的「螢幕右」會跟著轉頭一起轉。
   */
  readonly viewBase = new Quaternion()
  /** 相機相對飛機的偏移，見 chaseOffset。彈簧作用在它身上而不是世界座標 */
  private readonly offset = new Vector3()
  private readonly offsetVel = new Vector3()
  /** 相機的上方向量。逐幀正交化並緩慢靠回世界上方，見 baseOrientation */
  private readonly up = new Vector3(0, 1, 0)
  private initialised = false
  private appliedYaw = 0
  private appliedPitch = 0

  /** 投彈視線。每幀朝夾制後的目標插值，見 `update` 的 `'bomb'` 分支 */
  private readonly bombDir = new Vector3(0, -1, 0)
  /**
   * 投彈視線已經起算了。
   *
   * 【為什麼不共用 `initialised`】那一格的語意是「第三人稱的彈簧要不要吸附」，
   * 而投彈模式**離開時**必須把它留成 false 讓第三人稱重新吸附 —— 兩個意思
   * 塞進一格的話，切回機外視角相機會從投彈時的落後量開始盪。
   */
  private bombInit = false

  constructor(options: CameraRigOptions = DEFAULT_CAMERA_OPTIONS) {
    this.options = {
      ...options,
      firstPersonOffset: options.firstPersonOffset.clone(),
      bombPoint: options.bombPoint.clone(),
    }
  }

  /**
   * 重置平滑狀態：偏移歸位、自由視角歸零。重生時呼叫。
   *
   * 不需要位置——彈簧追的是**相對飛機的偏移**，飛機瞬移時相機跟著瞬移，
   * 本來就不會從舊位置飛過來。要清掉的是上一條航跡留下的落後量與視角角度。
   */
  snapTo(viewDir: Vector3): void {
    const base = this.baseOrientation(viewDir, 0, S.q[3]!)
    const forward = S.v[0]!.set(0, 0, -1).applyQuaternion(base)
    this.chaseOffset(forward, this.offset)
    this.offsetVel.set(0, 0, 0)
    this.appliedYaw = 0
    this.appliedPitch = 0
    this.initialised = true
    this.bombInit = false
  }

  /**
   * 第三人稱相機相對飛機的目標偏移：沿視線往後退，再往**世界上方**抬起。
   *
   * 【為什麼彈簧作用在偏移上而不是世界座標】對世界座標下的移動目標，臨界阻尼
   * 彈簧有穩態誤差 c·v/k = 2·ζ·v/√k——**正比於速度**。以計畫的 k=14、ζ=1 代入
   * 巡航 160 m/s 是 85 m，實測相機被拖到 83 m 外，飛機小成一個點。改成追偏移
   * 之後，等速直線飛行的目標偏移是常數，落後歸零；只有視線**轉向**時偏移才會
   * 移動，剩下的是純粹的轉向重量感。
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
  private baseOrientation(viewDir: Vector3, dt: number, out: Quaternion): Quaternion {
    const f = S.v[5]!.copy(viewDir).normalize()

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

  /**
   * @param orientation 機體姿態。**只**用來擺放機首視角的眼點（座位固定在機身上）
   * @param viewDir 相機要看的世界方向。傳的是**滑鼠瞄準方向**而不是機首方向：
   *   準星因此釘在畫面中央，跟不上的是飛機——機身會斜在畫面裡，指揮儀正在
   *   追的誤差角於是直接看得見。傳機首方向則是相反的呈現方式。
   */
  update(
    camera: PerspectiveCamera,
    position: Vector3,
    orientation: Quaternion,
    viewDir: Vector3,
    tas: number,
    viewMode: 'third' | 'first' | 'bomb',
    lookYaw: number,
    lookPitch: number,
    dt: number,
    bombTarget: Vector3 | null = null,
  ): void {
    const o = this.options

    // 拖曳中追得快、放開後回正得慢——目標歸零就代表玩家鬆手了
    const returning = lookYaw === 0 && lookPitch === 0
    const tau = returning ? o.lookReturnTime : o.lookFollowTime
    const k = dt > 0 ? 1 - Math.exp(-dt / tau) : 1
    this.appliedYaw += (lookYaw - this.appliedYaw) * k
    this.appliedPitch += (lookPitch - this.appliedPitch) * k

    // 視角偏移施加於視角座標，因此不影響飛行指令
    const lookQuat = S.q[0]!.setFromAxisAngle(S.v[1]!.set(0, 1, 0), this.appliedYaw)
    const pitchQuat = S.q[1]!.setFromAxisAngle(S.v[2]!.set(1, 0, 0), this.appliedPitch)
    const viewQuat = this.baseOrientation(viewDir, dt, S.q[2]!)
    this.viewBase.copy(viewQuat)   // 疊上自由視角**之前**，見 viewBase 的說明
    const baseForward = S.v[7]!.set(0, 0, -1).applyQuaternion(viewQuat)
    viewQuat.multiply(lookQuat).multiply(pitchQuat)

    if (viewMode === 'bomb') {
      // 眼點是機體上的一個位置，**要跟著滾** —— 與機首視角同一條理由
      const eye = S.v[9]!.copy(o.bombPoint).applyQuaternion(orientation).add(position)

      // 圓錐軸 = 機體 −Y。**機體固定**：等於機腹上的一個窗口，
      // 側滾大了看到的就是天，機動中投不了彈
      const axis = S.v[10]!.set(0, -1, 0).applyQuaternion(orientation)

      // 解不出落點時就盯著軸自己 —— 不會有 NaN，畫面停在機腹正下方
      const want = S.v[11]!
      if (bombTarget !== null) want.copy(bombTarget).sub(eye).normalize()
      else want.copy(axis)

      // 【回傳值刻意丟掉】有沒有夾制不影響畫面上任何東西：圈畫的恆是真
      // 落點，被夾住的是相機。見 `HudFrame.bombState`
      coneClamp(want.x, want.y, want.z, axis.x, axis.y, axis.z, CONE_COS, CONE_SIN, want)

      if (!this.bombInit) {
        // 【切進來的那一幀直接對正】換視角是一個瞬間。插值只用在視野之內
        // 追隨落點
        this.bombDir.copy(want)
        this.bombInit = true
      } else {
        // 【恰好反向時線性混合會得到零向量】先把起點推離對蹠點一點點
        if (this.bombDir.dot(want) < -0.9999) {
          this.bombDir.x += 1e-3
          this.bombDir.normalize()
        }
        const kb = dt > 0 ? 1 - Math.exp(-dt / BOMB_LERP_TIME) : 1
        // 【nlerp 不是 slerp】`baseOrientation` 的上方向量用的就是 lerp +
        // 正交化。差別只在大角度時的角速度分布，而這裡是 τ = 0.25 s 的追隨
        this.bombDir.lerp(want, kb).normalize()
      }

      // 【螢幕上方 = 機首的投影，不是世界上方】`baseOrientation` 算的是後者，
      // 而且距垂直 8° 以內就凍結目標（那裡投影會退化）—— 投彈視角**永遠**在
      // 那個區域裡，用它的話滾轉是切進來之前留下的殘值再慢慢漂，症狀是
      // 「偶爾右邊朝向機首、偶爾左邊」。見 `sightUp`
      const nose = S.v[12]!.set(0, 0, -1).applyQuaternion(orientation)
      const bodyUp = S.v[13]!.set(0, 1, 0).applyQuaternion(orientation)
      const up = S.v[14]!
      sightUp(
        this.bombDir.x, this.bombDir.y, this.bombDir.z,
        nose.x, nose.y, nose.z, bodyUp.x, bodyUp.y, bodyUp.z, up,
      )
      // up 已與視線正交且為單位向量，lookAt 取出的 +Y 就是 up 本身
      BASIS.lookAt(ORIGIN, this.bombDir, up)
      const look = S.q[2]!.setFromRotationMatrix(BASIS)
      this.viewBase.copy(look)
      camera.position.copy(eye)
      camera.quaternion.copy(look)
      // 【FOV 固定在 fovBase】第三人稱的 FOV 隨速度在 65～73 之間漲，不設回去
      // 的話瞄具的角度尺規會停在「按 B 那一刻多快」，而且之後不再更新
      if (Math.abs(camera.fov - o.fovBase) > 0.01) {
        camera.fov = o.fovBase
        camera.updateProjectionMatrix()
      }
      // 【切回第三人稱要重新吸附】與機首視角那一行同一個理由
      this.initialised = false
      // 【FOV 刻意不套速度增益】投彈時 FOV 一變，落點在畫面上就會跟著抖，
      // 而那是一個與投彈無關的動作
      //
      // 【`this.up` 刻意不更新】投彈分支不經過 `baseOrientation`，所以那個
      // 欄位停在切進來之前的值。切回第三人稱時 `initialised` 已經是 false，
      // 相機重新吸附，第一幀就會把它正交化回去
      return
    }
    this.bombInit = false

    if (viewMode === 'first') {
      // 眼點是機體上的一個座位，**要跟著滾**——用完整姿態；看的方向才用無滾轉基準
      const eye = S.v[3]!.copy(o.firstPersonOffset).applyQuaternion(orientation).add(position)
      camera.position.copy(eye)
      camera.quaternion.copy(viewQuat)
      this.initialised = false // 切回第三人稱時重新吸附
    } else {
      const viewForward = S.v[8]!.set(0, 0, -1).applyQuaternion(viewQuat)
      // 彈簧只吃**機身轉向**造成的偏移變化，所以目標用不含自由視角的 baseForward
      const desired = this.chaseOffset(baseForward, S.v[0]!)

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

      // 【自由視角不經過彈簧】轉頭是玩家自己下的指令，再濾一次就只是延遲。
      // 這裡把彈簧的**落後量**（offset − desired，機動造成的那一份）加到
      // 「已經轉過去的理想偏移」上：不轉頭時 viewForward === baseForward，
      // 整條式子退化成 this.offset，行為與先前完全相同。
      const finalOffset = this.chaseOffset(viewForward, S.v[4]!).add(this.offset).sub(desired)
      camera.position.copy(position).add(finalOffset)
      // 注視機首前方的瞄準點，使準星穩定於畫面中央區
      const target = S.v[0]!.copy(position).addScaledVector(viewForward, o.aimPointDistance)
      camera.up.set(0, 1, 0).applyQuaternion(viewQuat)
      camera.lookAt(target)
    }

    const fov = o.fovBase + o.fovSpeedGain * clamp(tas / o.fovSpeedRef, 0, 1)
    if (Math.abs(camera.fov - fov) > 0.01) {
      camera.fov = fov
      camera.updateProjectionMatrix()
    }
  }
}
