import { Vector3 } from 'three'
import type { Battery, WeaponSpec } from './types'
import type { Turret } from './turret'
import { muzzleAt } from './turret'
import { MG131 } from './bf109g6'
import { DEG } from '../core/math'

/**
 * MG 15，7.92 mm。**步槍口徑**，這件事是整個轟炸機難度的關鍵。
 *
 * 【傷害怎麼定的】專案裡最接近的是 P-51D 的 M2 .50（12.7 mm，傷害 18）與
 * 109 的 MG 131（13 mm，傷害 30）。MG 15 的彈頭質量約是 .50 的四分之一
 * （12.8 g 對 46 g），動能約 3.7 kJ 對 17 kJ。依動能等比推得 18 × 0.22 ≈ 4，
 * 取 **5** —— 略高於等比，因為機槍座打的是掠過的戰鬥機側面而不是正面裝甲。
 *
 * 【為什麼這件事重要】沒有散佈的模型裡，一挺零延遲的機槍是必殺的（見
 * `docs/superpowers/specs/` 的轟炸機 spec §4）。轟炸機的壓力必須來自
 * 「你不能久留」而不是「你進來就死」，而那個分寸完全由這個數字與射速決定。
 *
 * **這是起始值，由試飛裁定。**
 *
 * 【砲塔實際打出來的傷害不是這個數字】它還要乘上 `turret.ts` 的
 * `TURRET_DAMAGE_SCALE` —— 那個倍率統一調整全部轟炸機的自衛火力，而
 * `WeaponSpec.damage` 是「這款槍本身多痛」。
 */
export const MG15: WeaponSpec = {
  id: 'mg15',
  name: 'MG 15',
  muzzleVelocity: 765,
  roundsPerMinute: 1050,
  damage: 5,
}

/**
 * He 111 H-6 的 `Battery` —— **掛架是空的**。
 *
 * 【為什麼空的】機首那挺 MG 15 是球形槍座上的**手持活動槍**，由投彈手操作，
 * 駕駛員扣不到。專案負責人 2026-08-20 裁定：可以轉向的都交給 AI，玩家不控
 * 火砲。所以它搬到 `HE111_TURRETS` 的 `nose` 那一座。
 *
 * 【為什麼還留著這個 Battery】`sight` 仍然被讀：`ai/assess.ts` 與
 * `ai/steer.ts` 共四處用它的 `muzzleVelocity` 解射擊提前量。`convergence`
 * 沒有掛架可以匯聚，留著只是欄位必填。
 */
export const HE111_BATTERY: Battery = {
  mounts: [],
  convergence: 300,
  sight: MG15,
}

/**
 * He 111 的自衛砲塔 —— **五座、槍管合計 6 根**。
 *
 * 真機的槍位編號是 A（機首）／B（機背）／C（機腹吊艙後）／D（兩側腰窗）。
 * 側窗兩挺不是每一架都裝，這裡照最完整的配置。
 *
 * ```
 *   nose     MG 15    7.92 mm 單管
 *   dorsal   MG 131   13 mm 單管      ← H-16 起的配置
 *   ventral  MG 15    7.92 mm 雙聯    ← MG 81Z
 *   beamL/R  MG 15    7.92 mm 單管
 * ```
 *
 * 【它仍然遠弱於 B-17G】那是對的：十三挺 .50 對這六根，He 111 是「會咬人
 * 但咬不死」，B-17 是「不能久留」。兩台的難度差距來自槍的口徑與數量，不是
 * 來自射界 —— 射界反而是 He 111 的機腹那座比較好。
 *
 * ── 位置的來源，逐項標明 ───────────────────────────────────
 *
 * ```
 *   nose     量測  機體 z −2.93（機首尖端 −3.23 之後 0.30）、**偏右 x 0.25**
 *                   —— 真機的機首機槍座就是偏右的，那也是它機首不對稱的
 *                   原因（he111.hull.ts 量到固定 0.147 的橫向偏心）。
 *                   這是舊 HE111_BATTERY 掛架的同一個值，原樣搬過來
 *   dorsal   量測  開口機體 z 1.85…3.05（he111.hull.ts 標為「射線穿過開口
 *                   量到艙內」而丟掉的那一段），取中段 2.40；機身背線在該
 *                   站 1.59，槍口取罩子外的 1.72
 *   ventral  量測  吊艙後窗機體 z 4.51…5.51（BOLA_PARTS 的實測表），艙底
 *                   在 z 4.911 是 −1.077（BOLA 截面 centerY −0.732 −
 *                   halfHeight 0.345）；槍口取艙尾 5.30、y −0.85
 *   beam     推算  z 2.80 取自史實站位（腰窗與吊艙前段同一段機身）；
 *                   x 由 he111.hull.ts 在該站量到的半寬 0.91 外推一段槍管
 * ```
 *
 * 【三座量測、兩座推算】側窗那兩挺量不出來 —— 參考模型的側窗是機身蒙皮上
 * 的一塊玻璃，玻璃本身量得到、**槍座量不到**（那是艙內的東西，射線先打到
 * 玻璃就停了）。與 B-17G 的頰槍、腰槍同一個處境，處理方式也相同：放在已經
 * 逐站量過的機身剖面上，z 取真機站位，護欄擋粗錯、試飛裁細節。
 *
 * 【半角與旋轉速率是設計值】理由與 `weapons/b17g.ts` 的 `B17G_TURRETS`
 * 完全相同 —— 射界不規則而照片讀不出邊界，一個中心方向 + 一個半角才是
 * 可以被試飛推翻的形式（坑 22）。五挺全是手持槍，所以旋轉速率一律 90 °/s。
 */
export const HE111_TURRETS: readonly Turret[] = [
  { id: 'nose', weapon: MG15, position: muzzleAt(new Vector3(0.25, 0.35, -2.93),
      new Vector3(0, 0, -1)),
    axis: new Vector3(0, 0, -1),
    halfAngle: 40 * DEG, rotationRate: 90 * DEG, guns: 1 },
  // 【機背是 MG 131】H-16 起的實際配置，13 mm 取代原本的 7.92 mm。
  // 與 Bf109 的機首兩挺是**同一份** `MG131` —— 同一款槍就該是同一個物件
  { id: 'dorsal', weapon: MG131, position: muzzleAt(new Vector3(0, 1.72, 2.40),
      new Vector3(0, 0.64, 0.77).normalize()),
    axis: new Vector3(0, 0.64, 0.77).normalize(),
    halfAngle: 70 * DEG, rotationRate: 90 * DEG, guns: 1 },
  // 【腹艙後是雙聯】H-16 起的 MG 81Z（Zwilling）。這裡用 `guns: 2` 表達 ——
  // 乘的是傷害不是射速，理由見 `turret.ts` 的 `Turret.guns`
  { id: 'ventral', weapon: MG15, position: muzzleAt(new Vector3(0, -0.85, 5.30),
      new Vector3(0, -0.64, 0.77).normalize()),
    axis: new Vector3(0, -0.64, 0.77).normalize(),
    halfAngle: 60 * DEG, rotationRate: 90 * DEG, guns: 2 },
  { id: 'beamR', weapon: MG15, position: muzzleAt(new Vector3(1.05, 0.20, 2.80),
      new Vector3(1, 0, 0)),
    axis: new Vector3(1, 0, 0),
    halfAngle: 45 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'beamL', weapon: MG15, position: muzzleAt(new Vector3(-1.05, 0.20, 2.80),
      new Vector3(-1, 0, 0)),
    axis: new Vector3(-1, 0, 0),
    halfAngle: 45 * DEG, rotationRate: 90 * DEG, guns: 1 },
]
