import { Quaternion, Vector3 } from 'three'

const AX = new Vector3(1, 0, 0)
const AY = new Vector3(0, 1, 0)
const AZ = new Vector3(0, 0, 1)
/** 模組私有的暫存。熱路徑（每幀每片零件一次）：不配置。 */
const QX = new Quaternion()
const QY = new Quaternion()
const QZ = new Quaternion()

/**
 * 三軸等速翻滾：年齡 → 姿態。零件與殘骸共用。
 *
 * 【為什麼是年齡的純函數而不是每幀積分】每幀 `q += 0.5·ω⊗q·dt` 會累積誤差
 * 而漂離單位長度，要定期正規化；寫成 `t` 的函數之後第 10,000 幀與第 1 幀
 * 一樣精確，**而且測得起來**（繪製迴圈進不了單元測試，純函數進得去 ——
 * 與 `splashScale`、`edgeIndicatorPosition` 是同一個做法）。
 *
 * 【為什麼是三軸而不是單一隨機軸】繞單一固定軸轉讀起來是「機械式旋轉」，
 * 而失控的機體是**翻滾**的。三個速率不同的軸疊起來就沒有週期性
 * （M8 spec §14.2.14）。
 *
 * @param rx,ry,rz 三軸角速度，rad/s
 * @param t        年齡，s
 * @param base     初始姿態（陣亡那一刻的機體姿態）
 */
export function tumble(
  rx: number, ry: number, rz: number, t: number,
  base: Quaternion, out: Quaternion,
): void {
  QX.setFromAxisAngle(AX, rx * t)
  QY.setFromAxisAngle(AY, ry * t)
  QZ.setFromAxisAngle(AZ, rz * t)
  out.copy(QZ).multiply(QY).multiply(QX).multiply(base)
}
