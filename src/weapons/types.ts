import type { Vector3 } from 'three'

export interface WeaponSpec {
  id: string
  name: string
  /** 槍口初速，m/s */
  muzzleVelocity: number
  /** 射速，發/分 */
  roundsPerMinute: number
  /** 單發傷害（倍率 1.0 的部位，即機身） */
  damage: number
}

export interface Mount {
  weapon: WeaponSpec
  /** 槍口位置，**機體座標**，m */
  position: Vector3
}

export interface Battery {
  mounts: readonly Mount[]
  /**
   * 匯聚距離，m。所有掛架的射向在**橫向**收斂到機體座標的 x = 0。
   *
   * 【為什麼只匯聚橫向】本模型沒有重力（spec §2 裁決）。若縱向也指向
   * (0, 0, −convergence)，槍口在 y = −0.5 的翼槍飛過匯聚點之後就會爬到
   * 瞄準線上方——實測 980 m 處高出 1.13 m，而機身命中盒頂只到 y = 0.80，
   * 750 m 尾追的整串子彈從目標上方飛過去，命中 0 發（改為僅橫向後 180 發）。
   *
   * 真機的射擊校正也是「橫向匯聚、縱向設定重力下墜補償」；沒有重力時，
   * 正確的縱向設定就是與瞄準線平行。
   */
  convergence: number
  /**
   * 預瞄環依這一挺的初速計算。
   *
   * 【為什麼要指定而不是取第一挺】109 身上有兩種初速（705 與 750）。
   * 取傷害最高的那一挺（也是最慢的那一挺）算出來的提前量比較保守，
   * 對準它開火時另一挺只會更靠前，不會落後。
   */
  sight: WeaponSpec
}

/** 理論每秒傷害（機身部位）：Σ 射速/60 × 單發傷害。 */
export function batteryDps(b: Battery): number {
  let dps = 0
  for (const m of b.mounts) dps += (m.weapon.roundsPerMinute / 60) * m.weapon.damage
  return dps
}

/**
 * 掛架的射向，**機體座標**的單位向量。橫向收斂到匯聚點，縱向保持平行。
 * 寫進 out 並回傳同一參考（熱路徑，禁止配置）。
 */
export function mountDirection(b: Battery, index: number, out: Vector3): Vector3 {
  const p = b.mounts[index]!.position
  return out.set(-p.x, 0, -b.convergence - p.z).normalize()
}

/**
 * 一台飛機最多有幾個掛架。
 *
 * 【它是容量上界不是描述】槍焰的 `InstancedMesh` 用「架數 × MAX_MOUNTS」
 * 預配實例。某天有人加一台九挺槍的飛機，第九挺會**靜靜地畫不出來** ——
 * 沒有錯誤、沒有警告，只是那一管永遠不閃。所以 `weapons.test.ts` 有一條
 * 斷言把所有機種都掃過一次。
 *
 * 【8 怎麼來】目前最多的是 P-51D 的 6 挺，留兩格餘裕。
 */
export const MAX_MOUNTS = 8
