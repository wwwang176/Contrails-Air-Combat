import { Vector3 } from 'three'
import type { Battery } from './types'
import type { Turret } from './turret'
import { muzzleAt } from './turret'
import { M2_BROWNING } from './p51d'
import { DEG } from '../core/math'

/**
 * B-17G 的 `Battery` —— **掛架是空的**。
 *
 * 【為什麼空的】真機 G 型的十三挺 .50 沒有一挺是固定前射的。最接近的下巴
 * Bendix Model D 是**動力砲塔**，由機首的投彈手遙控瞄準，駕駛員扣不到。
 * **可以轉向的都交給 AI，玩家不控火砲**，所以十三挺全部在 `B17G_TURRETS`，
 * 這裡一挺都不留。
 *
 * 【為什麼還留著這個 Battery】`sight` 仍然被讀：`ai/assess.ts` 與
 * `ai/steer.ts` 共四處用它的 `muzzleVelocity` 解射擊提前量。一台沒有前射
 * 武器的飛機仍然需要知道「如果我朝那邊開槍，彈道大概多快」—— AI 用它判斷
 * 該不該進入攻擊姿態。`convergence` 沒有掛架可以匯聚，留著只是欄位必填。
 */
export const B17G_BATTERY: Battery = {
  mounts: [],
  convergence: 300,
  sight: M2_BROWNING,
}

/**
 * B-17G 的自衛砲塔 —— **八座、槍管合計 12 根**。
 *
 * 真機 G 型有十三挺：下巴 ×2、機首兩側頰槍 ×2、上部 ×2、球形腹部 ×2、
 * 腰部 ×2、無線電艙 ×1、尾部 ×2。這裡少的那一挺是**無線電艙那挺朝上的**
 * —— 它的射界與上部砲塔幾乎完全重疊，多一座只是多一份每步的計算。
 *
 * ── `position` 是槍口，不是樞軸 ────────────────────────────
 *
 * 真機的槍管本來就伸出蒙皮之外，所以尾砲塔的槍口（z 16.4）落在 `tail`
 * 命中盒（止於 15.30）**之外**，那是對的。護欄因此不是「槍口在盒內」，
 * 而是「沿 −axis 回走 `TURRET_MOUNT_REACH` 會碰到機體」，判準用
 * `!== NO_HIT`（`segmentBox` 起點在盒內時回傳 `0`）。
 * 見 `test/unit/turret-mount.test.ts`。
 *
 * 雙聯砲塔的 `position` 填**兩根管口的中點**，兩根實際的管口在它左右各
 * `BARREL_SPACING`（`world/turrets.ts` 匯出）。
 *
 * ── 位置的來源：出貨的 GLB（`b17g.glb`）───────────────────────
 *
 * 旋轉點 = 蒙皮點 − `BARREL_PROTRUDE` × axis（`turretPivot`），所以表裡的蒙皮點
 * 一律照「旋轉點該在哪」反推：
 *
 * ```
 *   chin／top／ball  動力砲塔：旋轉點在砲塔球的球心（`B17_ChinTurret`
 *                    (0, −0.55, −4.98)、`B17_TopTurret` (0, 1.95, −1.28)、
 *                    `B17_BallTurret` (0, −0.68, 5.12)），蒙皮點 = 球心 + 0.45 × axis
 *   cheek            手持槍：蒙皮點在頰槍窗的玻璃中心，左右錯開 ——
 *                    左 `B17_PaneNavFL` (−1.03, 0.56, −4.34)、右 `B17_PaneNavAR`
 *                    (0.85, 0.53, −5.18)；槍管從玻璃中間伸出去
 *   waist            手持槍：蒙皮點在腰窗的玻璃中心，左右錯開 ——
 *                    右 `B17_PaneWaistFR` (1.07, 0.98, 6.28)、左 `B17_PaneWaistAL`
 *                    (−0.96, 0.98, 7.84)
 *   tail             槍管機體 z 16.4…17.14、y ≈ 1.0、x ±0.14（backlog §2.15）
 * ```
 *
 * 窗的位置量法：玻璃那一面的包圍盒中心（`B17_Pane*` 是有厚度的玻璃塊，朝外那面
 * 是玻璃）。
 *
 * ── 半角與旋轉速率都是設計值 ───────────────────────────────
 *
 * 真機的射界不規則（腰部被機身擋、球塔打不到正上方），但**照片讀不出精確
 * 邊界**，而這個專案已經為「從照片讀來的前提」付過一整輪的代價（坑 22）。
 * 一個中心方向 + 一個半角是**可以被試飛推翻的形式**，多邊形不是。見 spec §5。
 *
 * 旋轉速率：動力砲塔 60 °/s（馬達與減速機構，轉得穩但慢）、手持槍 90 °/s
 * （轉得快但射界小）。**兩個數字都沒有實測支撐**，由試飛裁定。
 */
export const B17G_TURRETS: readonly Turret[] = [
  { id: 'chin', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, -0.703, -5.403),
      new Vector3(0, -0.34, -0.94).normalize()),
    axis: new Vector3(0, -0.34, -0.94).normalize(),
    halfAngle: 45 * DEG, rotationRate: 60 * DEG, guns: 2 },
  { id: 'cheekL', weapon: M2_BROWNING, position: muzzleAt(new Vector3(-1.03, 0.56, -4.34),
      new Vector3(-0.57, 0, -0.82).normalize()),
    axis: new Vector3(-0.57, 0, -0.82).normalize(),
    halfAngle: 35 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'cheekR', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0.85, 0.53, -5.18),
      new Vector3(0.57, 0, -0.82).normalize()),
    axis: new Vector3(0.57, 0, -0.82).normalize(),
    halfAngle: 35 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'top', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, 2.40, -1.28),
      new Vector3(0, 1, 0)),
    axis: new Vector3(0, 1, 0),
    halfAngle: 80 * DEG, rotationRate: 60 * DEG, guns: 2 },
  { id: 'ball', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, -1.13, 5.12),
      new Vector3(0, -1, 0)),
    axis: new Vector3(0, -1, 0),
    halfAngle: 80 * DEG, rotationRate: 60 * DEG, guns: 2 },
  { id: 'waistR', weapon: M2_BROWNING, position: muzzleAt(new Vector3(1.07, 0.98, 6.28),
      new Vector3(1, 0, 0)),
    axis: new Vector3(1, 0, 0),
    halfAngle: 60 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'waistL', weapon: M2_BROWNING, position: muzzleAt(new Vector3(-0.96, 0.98, 7.84),
      new Vector3(-1, 0, 0)),
    axis: new Vector3(-1, 0, 0),
    halfAngle: 60 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'tail', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, 1.0, 16.4),
      new Vector3(0, 0.09, 1).normalize()),
    axis: new Vector3(0, 0.09, 1).normalize(),
    halfAngle: 30 * DEG, rotationRate: 90 * DEG, guns: 2 },
]
