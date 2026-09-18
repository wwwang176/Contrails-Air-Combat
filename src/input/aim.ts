import { Matrix4, Quaternion, Vector3 } from 'three'
import { makeScratch } from '../core/pool'

const S = makeScratch(4, 1)
const BASIS = new Matrix4()

/**
 * 投彈模式下滑鼠位移的倍率，相對一般飛行。玩家還能微調航向與俯仰，但同樣的
 * 滑鼠位移只轉四分之一 —— 瞄準中不會一推就把落點甩走。
 */
export const BOMB_AIM_SCALE = 0.25

/**
 * 以瞄準方向本身建的水平座標系：−Z 是瞄準方向，右軸是水平的，上軸靠世界上方。
 * 給 `slewAimWorld` 當 `cameraOrientation` 用。
 *
 * 【投彈模式要用它，不能用相機】投彈相機朝下看、螢幕上方是機首，拿它的右／上
 * 軸去轉瞄準點的話，「滑鼠往上」變成繞一條斜的軸轉，飛機會跟著滾。這個座標系
 * 與一般飛行的相機基準（無滾轉、朝瞄準方向）同義：滑鼠左右是偏航、上下是俯仰。
 *
 * 瞄準方向接近垂直時水平右軸退化，改用世界 +X。熱路徑：不配置。
 */
export function levelAimBasis(aim: Vector3, out: Quaternion): Quaternion {
  const f = S.v[2]!.copy(aim).normalize()
  // 右 = 前 × 世界上。朝 −Z 時是 +X
  const right = S.v[3]!.set(-f.z, 0, f.x)
  if (right.lengthSq() < 1e-8) right.set(1, 0, 0)
  right.normalize()
  const up = S.v[0]!.crossVectors(right, f)
  const back = S.v[1]!.copy(f).negate()
  BASIS.makeBasis(right, up, back)
  return out.setFromRotationMatrix(BASIS)
}

/**
 * 依滑鼠位移旋轉「世界座標」的瞄準點。就地修改並回傳（熱路徑零配置）。
 *
 * 【為什麼是世界固定而不是機體固定】
 * 遊戲的瞄準模型是「圓圈是你指的地方、十字是機砲指的地方，兩者重合才開火」。
 * 那要求十字**追得到**圓圈。機體固定的準星在數學上做不到：純橫向的偏移
 * 會讓 rollCommand 恆為 ±90°，飛機永遠滾轉、誤差角一步都不收斂
 * （實測 143°/s 滾轉、8 秒航向只變 3°，見 task-20-report.md §8）。
 * 世界固定則會收斂，代價是「維持轉彎必須持續移動滑鼠」——這是被明示後
 * 選擇的取捨。附帶好處：Task 18 的 120 案例 L4 矩陣本來就是用世界固定的
 * 瞄準方向驗證的，至此驗證過的模型與出貨的模型終於一致。
 *
 * 【為什麼沒有任何夾制】玩家可以自由轉。機首圓錐、畫面矩形、單幀位移上限
 * 那三道都是「準星不能離開畫面」這個前提的產物，而相機跟著瞄準點走
 * （見 camera/CameraRig 的 viewDir），準星恆在畫面正中央 —— 那個前提
 * 不存在。
 *
 * 移掉圓錐的代價是瞄準點可以指到機身後方，指揮儀因此可能收到接近 180° 的
 * 誤差角。那個奇點（滾轉方向數學上不定）由指揮儀自己的遲滯處理，本來就
 * 在它的規格內（spec §8），不需要輸入層再擋一次。
 *
 * @param aimWorld 世界座標的瞄準單位向量（in/out）
 * @param deltaX   本幀滑鼠水平位移，單位為螢幕半高，右為正
 * @param deltaY   本幀滑鼠垂直位移，單位為螢幕半高，上為正
 * @param cameraOrientation 相機姿態；旋轉軸取自相機的右／上軸，
 *                 所以位移對玩家而言永遠是螢幕相對的
 * @param fovYRad  垂直 FOV，決定位移的角度換算
 */
export function slewAimWorld(
  aimWorld: Vector3,
  deltaX: number,
  deltaY: number,
  cameraOrientation: Quaternion,
  fovYRad: number,
): Vector3 {
  const halfFov = fovYRad / 2
  const right = S.v[0]!.set(1, 0, 0).applyQuaternion(cameraOrientation)
  const up = S.v[1]!.set(0, 1, 0).applyQuaternion(cameraOrientation)
  const q = S.q[0]!

  // 水平：繞相機上軸轉 −deltaX（右手系下，繞 +Y 轉正角會把 −Z 推向 −X）
  if (deltaX !== 0) aimWorld.applyQuaternion(q.setFromAxisAngle(up, -deltaX * halfFov))
  // 垂直：繞相機右軸轉 +deltaY
  if (deltaY !== 0) aimWorld.applyQuaternion(q.setFromAxisAngle(right, deltaY * halfFov))
  return aimWorld.normalize()
}
