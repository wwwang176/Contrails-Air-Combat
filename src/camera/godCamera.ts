import { Vector3 } from 'three'
import { clamp } from '../core/math'

/**
 * 上帝視角的鏡頭：離開座艙、在水平面上自由移動的觀察鏡頭。
 *
 * 【為什麼不用 `CameraRig`】理由由 `app/menuCamera.ts` 的既有註解寫好了 ——
 * 「那一整套是為了追一架飛機而存在的（彈簧、自由視角、FOV 隨速度變化）」。
 * 上帝視角也沒有飛機：彈簧追的是「相對飛機的偏移」、FOV 吃的是飛機的 TAS、
 * 瞄準點是飛機要飛去的地方，四樣東西在這裡沒有一樣適用。
 *
 * 【為什麼是純狀態機】與 `menuCameraPose` 同一個範式：不認識 three 的場景、
 * 不認識飛機、不認識 `PerspectiveCamera`。回報是移動軸、夾擠、進場姿態全都
 * 是普通的單元測試 —— `main.ts` 沒有測試護著，能搬出來的都要搬出來。
 */
export interface GodCameraOptions {
  /** 水平與垂直的基本速率，m/s */
  moveSpeed: number
  /** 按住 Shift 時的倍率 */
  boostFactor: number
  /** 高度下限，m */
  minAltitude: number
  /** 高度上限，m */
  maxAltitude: number
  /** 俯仰的絕對值上限，rad */
  pitchLimit: number
  /** 進場時高於自機多少，m */
  entryHeight: number
  /** 進場時的俯角，rad */
  entryPitch: number
  /** 每移動「一個螢幕半高」轉多少弧度 */
  lookSensitivity: number
}

/**
 * 八個起始值。**全部是推理出來的，待手動試飛回填**（spec §8.7）——
 * 這一份沒有可以自動掃描的判準，它是觀測工具不是戰術。
 *
 * - `moveSpeed` 300 —— 略高於巡航 TAS（`DEFAULT_BATTLE.tas` 200），追得上
 *   一團正在移動的纏鬥。低於它就永遠在後面追。
 * - `boostFactor` 4 —— 1200 m/s，橫越幾公里的戰場約幾秒。
 * - `minAltitude` 50 —— 高於浪。撞地判定見 `aircraft/crash.ts`。
 * - `maxAltitude` 12000 —— P-51D 的升限量級。
 * - `pitchLimit` 85° —— 不夾的話鏡頭會翻過天頂，而「上」的定義在那一瞬
 *   反過來，之後每一個滑鼠位移都是反的。
 * - `entryHeight` 800 —— 看得到一個分隊的散布（分隊尺度約 1 km）。
 * - `entryPitch` 45° —— 這個俯角下自機落在畫面中央。
 * - `lookSensitivity` **3.4375 = 5.5 ÷ 1.6**，實際靈敏度因此等於自由視角。
 *   【那個除法不能省】餵進來的 `lookX` 是 `InputState.aimDeltaX`，而
 *   `input/bindings.ts` 累積它時**已經乘過** `MOUSE_SENSITIVITY`（1.6）；
 *   自由視角走的是另一條路徑，用的是**原始比值**乘 `LOOK_SENSITIVITY`
 *   （5.5）。直接寫 5.5 的話實際值會是 8.8 —— 比自由視角高六成，而註解
 *   卻寫著「沿用」。這是審查抓到的（I7）。
 */
export const DEFAULT_GOD_CAMERA: GodCameraOptions = {
  moveSpeed: 300,
  boostFactor: 4,
  minAltitude: 50,
  maxAltitude: 12000,
  pitchLimit: 85 * (Math.PI / 180),
  entryHeight: 800,
  entryPitch: 45 * (Math.PI / 180),
  lookSensitivity: 5.5 / 1.6,
}

export interface GodCameraState {
  /** 世界座標。**參考固定**，每步寫進去而不是換掉 */
  readonly position: Vector3
  /**
   * 方位角，rad。**與 `hud/attitude-math.ts` 的 `headingFromOrientation`
   * 同一個約定**：0 = −Z 方向，順時針（往 +X）為正。`enterGodCamera`
   * 因此可以直接吃那個函式的輸出，不需要換算。
   *
   * 【不夾也不取模】取模會在 ±π 的邊界上製造一個沒有必要的不連續，
   * 而三角函數本來就是週期的。
   */
  yaw: number
  /** 俯仰角，rad。負值為俯視。夾在 ±`pitchLimit` */
  pitch: number
}

/**
 * 一幀的輸入。
 *
 * `lookX` / `lookY` 的單位與正負號**與 `InputState.aimDeltaX` / `aimDeltaY`
 * 完全相同**（螢幕半高、右為正、上為正）—— 上帝視角下 `main.ts` 就是把
 * 那兩個欄位餵進來的，換一套約定只會製造一個要記住的轉換。
 */
export interface GodCameraInput {
  forward: boolean
  back: boolean
  left: boolean
  right: boolean
  up: boolean
  down: boolean
  boost: boolean
  lookX: number
  lookY: number
}

export function createGodCameraState(): GodCameraState {
  return { position: new Vector3(), yaw: 0, pitch: 0 }
}

/**
 * 進場：放到自機正上方，朝自機當下的航向，固定俯角。
 *
 * 【每次進場都重新定位】不記憶上次離開的位置 —— 按下去永遠知道自己在看
 * 哪裡。記憶的話，飛機已經飛遠了的時候你會回到一片空海中間。
 *
 * @param from    自機位置
 * @param heading 自機航向，rad。約定見 `GodCameraState.yaw`
 */
export function enterGodCamera(
  s: GodCameraState,
  from: Vector3,
  heading: number,
  cfg: GodCameraOptions = DEFAULT_GOD_CAMERA,
): void {
  s.position.set(
    from.x,
    // 【進場也要夾】自機在升限附近時 +entryHeight 會超過 maxAltitude
    clamp(from.y + cfg.entryHeight, cfg.minAltitude, cfg.maxAltitude),
    from.z,
  )
  s.yaw = heading
  s.pitch = -cfg.entryPitch
}

/**
 * 推進一幀。
 *
 * 【水平移動完全不看 `pitch`】這是保持高度的平面式移動：W/S/A/D 只在水平面
 * 上走。俯視著按 W 就一頭栽進海裡的那種自由鏡頭在這裡是錯的 ——
 * 45° 俯視正是預設的進場姿態。
 *
 * 【垂直是獨立的一軸】Q/E 像直升機的總距，與「往哪裡飛」是兩個不同的意圖，
 * 所以**只有水平那一對正規化**。W+E 的合速率是 √2 倍，那是設計不是漏掉。
 *
 * 【視角轉動不吃 `dt`】滑鼠位移本身已經是「這一幀移了多少」，再乘一次 `dt`
 * 會讓靈敏度隨幀率變化。移動吃 `dt`（速率是每秒），轉動不吃 —— 這與既有的
 * `input/aim.ts` 是同一個處理方式。
 *
 * 不配置：整條路徑只有純量運算，最後寫進 `s.position`。**不改動 `input`。**
 */
export function stepGodCamera(
  s: GodCameraState,
  input: GodCameraInput,
  dt: number,
  cfg: GodCameraOptions = DEFAULT_GOD_CAMERA,
): void {
  s.yaw += input.lookX * cfg.lookSensitivity
  s.pitch = clamp(
    s.pitch + input.lookY * cfg.lookSensitivity, -cfg.pitchLimit, cfg.pitchLimit,
  )

  // 水平的兩個基底向量。yaw = 0 時前方是 −Z、右方是 +X
  const sy = Math.sin(s.yaw)
  const cy = Math.cos(s.yaw)
  let fx = 0
  let fz = 0
  if (input.forward) { fx += sy; fz -= cy }
  if (input.back) { fx -= sy; fz += cy }
  if (input.right) { fx += cy; fz += sy }
  if (input.left) { fx -= cy; fz -= sy }

  // 【對角線正規化】不正規化的話斜著走比直著走快 41%
  const len = Math.hypot(fx, fz)
  if (len > 0) { fx /= len; fz /= len }

  const vy = (input.up ? 1 : 0) - (input.down ? 1 : 0)
  const speed = cfg.moveSpeed * (input.boost ? cfg.boostFactor : 1) * dt

  s.position.set(
    s.position.x + fx * speed,
    clamp(s.position.y + vy * speed, cfg.minAltitude, cfg.maxAltitude),
    s.position.z + fz * speed,
  )
}

/**
 * 注視點離鏡頭多遠，m。
 *
 * 【為什麼要遠】`camera.lookAt` 只看方向，但注視點離鏡頭太近時，方向向量
 * 的相對誤差會被鏡頭自身的位移放大。取 1000 m 與 HUD 的投影距離同一個量級
 * （`main.ts` 的 `HUD_PROJECT_DISTANCE`）。
 */
const TARGET_DISTANCE = 1000

/** 注視點：鏡頭前方 `TARGET_DISTANCE` 處。寫進 `out` 並回傳它，不配置 */
export function godCameraTarget(s: GodCameraState, out: Vector3): Vector3 {
  const cp = Math.cos(s.pitch)
  return out.set(
    s.position.x + Math.sin(s.yaw) * cp * TARGET_DISTANCE,
    s.position.y + Math.sin(s.pitch) * TARGET_DISTANCE,
    s.position.z - Math.cos(s.yaw) * cp * TARGET_DISTANCE,
  )
}
