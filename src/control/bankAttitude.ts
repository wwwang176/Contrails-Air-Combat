import { Vector3, type Quaternion } from 'three'

// 幾何計算共用的模組私有暫存，與飛行指揮儀的瞄準向量分開；每步不配置。
const WORLD_UP = new Vector3(0, 1, 0)
const RIGHT = new Vector3()
const UP = new Vector3()

export interface BankAttitude {
  /** 坡度角，rad。正值＝左坡度（右翼上揚），負值＝右坡度。 */
  angle: number
  /**
   * 坡度角的可信度，0~1，等於 |cos(俯仰角)|。
   *
   * 機首指向正上或正下時「坡度」在幾何上沒有意義（世界上方向量與機首平行，
   * 它在機體右／上平面內的投影長度為零，方位角是 0/0）。此值就是那個投影
   * 的長度，所以它天然地在奇異點歸零——不需要額外的分支判斷，機翼改平
   * 會自己在垂直飛行時鬆手，而不是去追一個沒有意義的角度。
   */
  authority: number
}

export function createBankAttitude(): BankAttitude {
  return { angle: 0, authority: 1 }
}

/**
 * 由姿態四元數求坡度角。熱路徑零配置（使用模組私有 scratch）。
 *
 * 【為什麼不從歐拉角取】專案的硬性約束是「狀態絕不以歐拉角儲存」。
 * 這裡直接把世界上方向量轉進機體座標的右／上平面求方位角，
 * 與 gLoadFromOrientation 由四元數求 cosγ·cosφ 是同一手法。
 * （已與 Euler 'YXZ' 的 z 分量逐案比對，60 秒極限環的每個視窗端點
 * 都吻合到小數點後一位，見 task-20-report.md §20。）
 */
export function bankAttitude(orientation: Quaternion, out: BankAttitude): BankAttitude {
  const bodyRight = RIGHT.set(1, 0, 0).applyQuaternion(orientation)
  const bodyUp = UP.set(0, 1, 0).applyQuaternion(orientation)
  const lateral = WORLD_UP.dot(bodyRight)
  const vertical = WORLD_UP.dot(bodyUp)
  out.angle = Math.atan2(lateral, vertical)
  out.authority = Math.hypot(lateral, vertical)
  return out
}

/**
 * 同 `bankAttitude`，但參考方向是 `ref`（單位向量）而不是世界上方：機體要
 * 滾多少才讓機體上方對準 `ref`。符號與 `bankAttitude` 相同。
 *
 * 【分成兩支而不是讓 `bankAttitude` 帶參數】`trackTurn` 關著、或瞄準方向
 * 不轉時，輸出要與沒有這個機制時逐位元相同，`bankAttitude` 的運算一個都不能動。
 */
export function bankToward(orientation: Quaternion, ref: Vector3, out: BankAttitude): BankAttitude {
  const bodyRight = RIGHT.set(1, 0, 0).applyQuaternion(orientation)
  const bodyUp = UP.set(0, 1, 0).applyQuaternion(orientation)
  const lateral = ref.dot(bodyRight)
  const vertical = ref.dot(bodyUp)
  out.angle = Math.atan2(lateral, vertical)
  out.authority = Math.hypot(lateral, vertical)
  return out
}
