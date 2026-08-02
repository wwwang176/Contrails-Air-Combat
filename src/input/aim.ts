import { Quaternion, Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import { AIM_RADIUS } from './InputState'

const S = makeScratch(3, 1)

/** 螢幕平面上的二維量（準星位移／位置）。 */
export interface Vec2 {
  x: number
  y: number
}

/** slewAimWorld 的單幀位移暫存。熱路徑零配置，模組私有不外借。 */
const deltaScratch: Vec2 = { x: 0, y: 0 }

/**
 * 瞄準點相對機首的最大夾角，rad。
 *
 * 是 Task 19 螢幕空間 `AIM_RADIUS`（螢幕半高的 0.35）的角度等價物：
 * 準星最遠只能離開畫面中心 `AIM_RADIUS × 半個 FOV`，65° FOV 下為 11.38°。
 * 兩個作用：準星永遠不會離開畫面；瞄準點永遠不可能跑到機首後方
 * （後者是「指揮儀不得被指令到一個它必須繞半圈才能到達的方向」的硬保證）。
 *
 * 【與螢幕空間夾制的細微差異】Task 19 的螢幕夾制經過 tan：等價角其實是
 * atan(0.35·tan(32.5°)) = 12.56°，比這裡的 11.38° 大 1.18°。採用線性的
 * `AIM_RADIUS × halfFov` 是專案負責人指定的形式，也讓「位移量 → 角度」
 * 在整個可動範圍內是線性的（螢幕空間版本在邊緣會被 tan 拉伸），
 * 手感上更一致。
 */
export function maxAimAngle(fovYRad: number): number {
  return AIM_RADIUS * (fovYRad / 2)
}

/**
 * 依滑鼠位移移動「世界座標」的瞄準點，並夾制在機首前方的圓錐內。
 * 就地修改並回傳 `aimWorld`（熱路徑零配置）。
 *
 * 【為什麼是世界固定而不是機體固定】（專案負責人裁決）
 * 遊戲的瞄準模型是「圓圈是你指的地方、十字是機砲指的地方，兩者重合才開火」。
 * 那要求十字**追得到**圓圈。機體固定的準星在數學上做不到：純橫向的偏移
 * 會讓 rollCommand 恆為 ±90°，飛機永遠滾轉、誤差角一步都不收斂
 * （實測 143°/s 滾轉、8 秒航向只變 3°，見 task-20-report.md §8）。
 * 世界固定則會收斂，代價是「維持轉彎必須持續移動滑鼠」——這是被明示後
 * 選擇的取捨。附帶好處：Task 18 的 120 案例 L4 矩陣本來就是用世界固定的
 * 瞄準方向驗證的，至此驗證過的模型與出貨的模型終於一致。
 *
 * @param aimWorld 世界座標的瞄準單位向量（in/out）
 * @param deltaX   本幀滑鼠水平位移，單位為螢幕半高，右為正
 * @param deltaY   本幀滑鼠垂直位移，單位為螢幕半高，上為正
 * @param cameraOrientation 相機姿態；旋轉軸取自相機的右／上軸，
 *                 所以位移對玩家而言永遠是螢幕相對的
 * @param noseWorld 世界座標的機首方向（單位向量），圓錐夾制的軸
 * @param fovYRad  垂直 FOV，同時決定位移的角度換算與夾制半角
 */
export function slewAimWorld(
  aimWorld: Vector3,
  deltaX: number,
  deltaY: number,
  cameraOrientation: Quaternion,
  noseWorld: Vector3,
  fovYRad: number,
  aspect?: number,
): Vector3 {
  const halfFov = fovYRad / 2

  // 【單幀位移上限】瞄準點無論如何都待在半角 maxAimAngle 的圓錐內，所以
  // 單一幀內最有用的位移就是「從圓錐這一邊掃到另一邊」＝ 2 × maxAimAngle；
  // 再多都會被圓錐夾掉。不設上限則有一個真實的錯誤模式：一次暴力甩鼠
  // （60 fps 下單幀可輕易超過 90°）會把瞄準向量轉到機首**後方**，
  // 圓錐夾制沿大圓拉回時會落在**相反**的一側——玩家往右甩，飛機往左轉。
  // 實測（每幀位移 5 ≈ 162°）確實重現：轉彎中途誤差角突然塌到 0.1°、
  // 轉向反轉。用圓形（而非方形）夾制單幀位移，斜向與軸向的上限才一致。
  const d = clampToCircle(deltaX, deltaY, 2 * AIM_RADIUS, deltaScratch)

  const right = S.v[0]!.set(1, 0, 0).applyQuaternion(cameraOrientation)
  const up = S.v[1]!.set(0, 1, 0).applyQuaternion(cameraOrientation)
  const q = S.q[0]!

  // 水平：繞相機上軸轉 −deltaX（右手系下，繞 +Y 轉正角會把 −Z 推向 −X）
  if (d.x !== 0) aimWorld.applyQuaternion(q.setFromAxisAngle(up, -d.x * halfFov))
  // 垂直：繞相機右軸轉 +deltaY
  if (d.y !== 0) aimWorld.applyQuaternion(q.setFromAxisAngle(right, d.y * halfFov))
  aimWorld.normalize()

  // 給了長寬比就依實際畫面矩形夾制（準星可以拉到四角），否則退回圓錐。
  // 圓錐永遠碰不到左右邊緣：16:9 的半寬約 1.78 個半高，圓形要碰到左右
  // 就會在上下超出畫面。矩形夾制之後仍加一道寬鬆的機首圓錐當保險，
  // 維持「指揮儀不會被指令到必須繞半圈才能到達的方向」這個硬保證。
  if (aspect !== undefined) {
    clampAimToViewport(aimWorld, cameraOrientation, fovYRad, aspect)
    return clampAimToCone(aimWorld, noseWorld, VIEWPORT_NOSE_LIMIT)
  }
  return clampAimToCone(aimWorld, noseWorld, maxAimAngle(fovYRad))
}

/** 矩形夾制模式下，瞄準點相對機首的硬上限（rad）。 */
const VIEWPORT_NOSE_LIMIT = (75 * Math.PI) / 180

/** 夾制到畫面內緣的比例，留一點邊避免準星貼齊像素邊界。HUD 用它畫出可動範圍。 */
export const VIEWPORT_MARGIN = 0.96

/**
 * 把瞄準向量夾制在「相機看得到的畫面矩形」之內。就地修改。
 *
 * 在相機的正切空間做：`(tx, ty) = (v.x, v.y) / forward`，畫面半高對應
 * `tan(fovY/2)`、半寬對應 `aspect × tan(fovY/2)`。分別夾制 tx / ty 就得到
 * 與畫面同形狀的矩形——準星因此能拉到上下左右緣與四角，這是圓錐做不到的。
 *
 * 這裡刻意不是圓形：圓形的用意是讓斜向與軸向的**操縱量**一致，那個性質由
 * 單幀位移的 `clampToCircle` 保留；而可視範圍的邊界本來就是矩形，硬套圓形
 * 只會讓玩家在左右方向被莫名其妙地擋住。
 */
export function clampAimToViewport(
  aimWorld: Vector3,
  cameraOrientation: Quaternion,
  fovYRad: number,
  aspect: number,
  margin: number = VIEWPORT_MARGIN,
): Vector3 {
  const q = S.q[0]!.copy(cameraOrientation).invert()
  const v = S.v[2]!.copy(aimWorld).applyQuaternion(q)

  // 相機朝 −Z。貼齊或跑到相機平面之後時正切座標會發散，夾一個下限讓它
  // 被下面的矩形拉回邊緣，而不是翻到反側。
  const forward = Math.max(-v.z, 1e-4)
  const ty = Math.max(-1, Math.min(1, v.y / forward / (Math.tan(fovYRad / 2) * margin)))
  const tx = Math.max(-1, Math.min(1, v.x / forward / (Math.tan(fovYRad / 2) * margin * aspect)))

  const t = Math.tan(fovYRad / 2) * margin
  v.set(tx * t * aspect, ty * t, -1).normalize()
  return aimWorld.copy(v).applyQuaternion(cameraOrientation).normalize()
}

/**
 * 把瞄準向量夾制在以機首為軸、半角 maxAngle 的圓錐內。就地修改。
 *
 * 每幀無條件執行（不只在滑鼠移動時）：機首自己會動，若只在輸入時夾制，
 * 飛機在劇烈機動後可能把瞄準點甩到身後，指揮儀就會被指令去追一個它得先
 * 翻半圈才能到達的方向。夾制是「沿著大圓往機首拉回」，方位角不變，
 * 所以是圓錐而不是方錐——對角線與軸向的最大偏移量相同。
 */
function clampAimToCone(aimWorld: Vector3, noseWorld: Vector3, maxAngle: number): Vector3 {
  const dot = Math.min(1, Math.max(-1, aimWorld.dot(noseWorld)))
  const angle = Math.acos(dot)
  if (angle <= maxAngle) return aimWorld

  const axis = S.v[2]!.copy(noseWorld).cross(aimWorld)
  if (axis.lengthSq() < 1e-20) {
    // 恰好正後方：方位角在數學上不定，退回機首方向而不是隨便挑一側。
    return aimWorld.copy(noseWorld)
  }
  axis.normalize()
  return aimWorld.copy(noseWorld).applyQuaternion(
    S.q[0]!.setFromAxisAngle(axis, maxAngle),
  ).normalize()
}

/**
 * 由準星的螢幕位置產生機體座標的瞄準方向。
 *
 * 【現況用途】世界固定瞄準點裁決之後，飛行迴圈不再使用本函式——它是
 * 「螢幕位置 → 角度」的映射，保留給 HUD（Task 23）擺放準星圖示，以及
 * 測試中建構已知角度的瞄準方向。
 */
export function aimDirectionBody(
  aimX: number,
  aimY: number,
  fovYRad: number,
  out: Vector3,
): Vector3 {
  const t = Math.tan(fovYRad / 2)
  return out.set(aimX * t, aimY * t, -1).normalize()
}

/**
 * 將 (x, y) 夾制在半徑 radius 的圓內。
 *
 * 圓內的點原樣不變；圓外的點沿原方向縮放投影到圓周上（角度不變）。
 * 必須是圓而不是方形——方形夾制會讓對角線方向的操縱量比軸向多出 √2 倍，
 * 使準星在斜向移動時「跑得更快」，操縱手感不對稱。
 *
 * 【現況用途】世界固定瞄準點裁決之後，飛行迴圈的夾制改由
 * `clampAimToCone` 以圓錐執行（同一個「圓而非方」的性質，見上）。
 * 本函式保留給 HUD（Task 23）把準星圖示夾在畫面上的圓內。
 */
export function clampToCircle(
  x: number,
  y: number,
  radius: number,
  out: Vec2 = { x: 0, y: 0 },
): Vec2 {
  const r = Math.hypot(x, y)
  if (r <= radius) {
    out.x = x
    out.y = y
    return out
  }
  const scale = radius / r
  out.x = x * scale
  out.y = y * scale
  return out
}
