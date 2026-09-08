import type { Vector3 } from 'three'
import { makeScratch } from '../core/pool'
import type { InputState } from '../input/InputState'

const S = makeScratch(1, 2)

/**
 * 玩家陣亡那一幀對輸入狀態的整理。之後到接手為止 `main.ts` 每幀維持
 * `input.dead`，輸入層靠它擋掉新的轉頭與 `B`。
 *
 * 【視角一律退回機外】投彈瞄具那條相機分支完全不看視線，留在 `bomb` 的話
 * `deathCamAim` 轉出來的視線整段被蓋掉，畫面停在殘骸機腹的瞄具；座艙視角
 * 則是從殘骸裡面往外看。死亡鏡頭只在機外成立。
 *
 * 【右鍵正按著就取消】不取消的話 `lookYaw/lookPitch` 留著死前的偏移，
 * 視線被那個偏移整個歪掉；放開右鍵的事件也可能在指標鎖掉了之後才來。
 */
export function enterDeathCam(input: InputState): void {
  input.viewMode = 'third'
  input.lookActive = false
  input.lookYaw = 0
  input.lookPitch = 0
  input.dead = true
}

/**
 * 視線轉向擊殺者的時間常數，s。
 *
 * 【0.35 s 怎麼來】接手延遲是 2 s（`TAKEOVER_DELAY`）。指數收斂在 3 個時間
 * 常數之後幾乎到位，所以 0.35 s 讓鏡頭在**第一秒之內**就轉到擊殺者身上，
 * 剩下的一秒是「看著他」而不是「正在轉」。再慢就會在還沒轉到時就被接手
 * 打斷，再快就不像鏡頭而像瞬移。
 */
export const DEATH_LOOK_TIME = 0.35

/**
 * 死亡鏡頭的視線：**位置定在死亡點不動**，方向平滑轉向擊殺者。
 *
 * 就地修改 `aim` 並回傳。位置那一半不在這裡 —— `main.ts` 的內插迴圈在飛機
 * 退場時就不再更新它的 `Visual.position`，而相機讀的正是那個值，所以「定點」
 * 是自動成立的。這個函數只管「轉向」。
 *
 * 【為什麼是旋轉四元數而不是 `lerp` + `normalize`】被咬住尾巴打下來是最常見
 * 的死法，而那正好是視線與目標差 180° 的情形 —— 兩個反向的單位向量做線性
 * 內插，中途會經過零向量，正規化出 NaN，鏡頭從此壞掉。
 * `setFromUnitVectors` 在反向時自己挑一個垂直軸，沒有這個奇點。
 *
 * @param aim    視線單位向量（in/out）
 * @param from   死亡點（相機的定點）
 * @param killer 擊殺者的位置；`null` = 沒有兇手（自摔），視線不動 ——
 *               那時定定看著自己的火球與零件才是對的畫面
 */
export function deathCamAim(
  aim: Vector3, from: Vector3, killer: Vector3 | null, dt: number,
): Vector3 {
  if (killer === null || dt <= 0) return aim

  const want = S.v[0]!.copy(killer).sub(from)
  // 【兇手就在死亡點上】方向未定義。轉去任何地方都是瞎猜，不如不動
  if (want.lengthSq() < 1e-12) return aim
  want.normalize()

  const full = S.q[0]!.setFromUnitVectors(aim, want)
  const step = S.q[1]!.identity().slerp(full, 1 - Math.exp(-dt / DEATH_LOOK_TIME))
  return aim.applyQuaternion(step).normalize()
}
