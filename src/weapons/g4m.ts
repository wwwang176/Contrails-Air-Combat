import { Vector3 } from 'three'
import type { Battery, WeaponSpec } from './types'
import type { Turret } from './turret'
import { muzzleAt } from './turret'
import { DEG } from '../core/math'

/**
 * 九二式七粍七旋回機銃。**機首與左右腰窗，共三挺。**
 *
 * 7.7 × 56R（＝ .303 British，**與陸軍的 7.7 mm 不通用**）。初速 745 m/s、
 * 射速 700 発/分、97 発彈盤 —— 出自海軍航空本部『昭和19年3月 飛行長主管
 * 兵器（第2類）説明資料（1）』。美方 TAIC 給 762 m/s／600 rpm，**兩格都
 * 自己標了 est.**，取日方一手值。
 *
 * 【傷害 5 —— 直接沿用 He 111 的 MG 15】兩者同為步槍口徑的旋回機槍，
 * 彈頭 11.2 g 對 12.8 g。**同一格是刻意的**：轟炸機的壓力應該來自
 * 「你不能久留」而不是「你進來就死」，而那個分寸已經在 He 111 那一輪由
 * 試飛裁定過。
 */
export const TYPE92: WeaponSpec = {
  id: 'type92',
  name: '九二式 7.7mm',
  muzzleVelocity: 745,
  roundsPerMinute: 700,
  damage: 5,
}

/**
 * 九九式二〇粍一号旋回機銃 一一型。**機背動力銃塔與尾部銃座各一門。**
 *
 * 20 × 72RB。初速 600 m/s、射速 535 発/分、45 発彈鼓 —— 同樣出自
 * 海軍航空本部『昭和19年3月 説明資料』。美方 TAIC 給 610 m/s／500 rpm
 *（est.）、A. G. Williams 給 600 m/s／480 rpm。**Williams 另有一個
 * 525 m/s 的值，那是離群值，不要用。**
 *
 * 【與 A6M5 的九九式不是同一款槍】那台是**二号四型固定式**（20 × 101RB、
 * 750 m/s、620 発/分、彈帶）。彈殼長度都不同，初速差 150 m/s。
 * 見 `weapons/a6m5.ts`。
 *
 * 【傷害 80】彈頭 128 g @ 600 m/s ＝ 23.0 kJ，與 MG 151/20（92 g @ 705，
 * 22.9 kJ，傷害 84）幾乎相同。取 80：動能同級、裝藥更少。
 * **初速只有 600 是它真正的代價** —— 提前量要比 MG 131 多給四成，而那一項
 * 模型裡本來就有，不必再從傷害扣。
 *
 * ⚠️ **這是全專案自衛火力最痛的一款**（B-17G 的十三挺 .50 是每發 18）。
 * 背部與尾部各一門，試飛時要特別看 —— 那個分寸由 `TURRET_DAMAGE_SCALE`
 * 與這個數字一起決定。
 */
export const TYPE99_1: WeaponSpec = {
  id: 'type99-1',
  name: '九九式二〇粍一号',
  muzzleVelocity: 600,
  roundsPerMinute: 535,
  damage: 80,
}

/**
 * G4M2a 的 `Battery` —— **掛架是空的**。
 *
 * 【為什麼空的】機首那挺是電動迴轉鼻錐上的**手持活動槍**，由偵察／爆撃手
 * 操作，駕駛員扣不到。專案負責人 2026-08-20 裁定：可以轉向的都交給 AI，
 * 玩家不控火砲。所以它搬到 `G4M_TURRETS` 的 `nose` 那一座。
 *
 * 【為什麼還留著這個 Battery】`sight` 仍然被讀：`ai/assess.ts` 與
 * `ai/steer.ts` 共四處用它的 `muzzleVelocity` 解射擊提前量。與
 * `weapons/he111.ts`、`weapons/b17g.ts` 同一個處境。
 */
export const G4M_BATTERY: Battery = {
  mounts: [],
  convergence: 300,
  sight: TYPE92,
}

/**
 * G4M2a 二四型的自衛砲塔 —— **五座、槍管五根**。
 *
 * 二四型的武裝「準じる二二型」（『世界の傑作機』No.60）。TAIC Manual No.1 的
 * ARMAMENT 表與 Profile Publications No. 210 的 Table VI 逐項一致：
 *
 * ```
 *   nose     九二式七粍七        電動 360° 迴轉鼻錐、球窩座   6–7 × 97 発
 *   dorsal   九九式二〇粍一号     電動動力銃塔                6 × 45 発
 *   beamL/R  九二式七粍七        左右側方窗各一              各 6 × 97 発
 *   tail     九九式二〇粍一号     滑軌座、手動                6 × 45 発
 *   機腹     無
 * ```
 *
 * 【與 He 111 剛好同一個形狀】那台也是五座（機首、機背、機腹、兩側腰窗），
 * 但槍管六根（機腹是雙聯）。**難度差距來自口徑不是射界** —— G4M 有兩門
 * 20 mm，He 111 只有一挺 13 mm。
 *
 * ── 要更正三個常見的誤植 ────────────────────────────────────
 *
 * ```
 *   二四型甲   把**側方** 7.7 mm 換成 20 mm 一号
 *   二四型乙   把**上方動力銃塔**的 20 mm 一号換成**二号**
 *   二四型丙   把**機首**那挺換成 13 mm（二式十三粍），不是 20 mm
 *   尾部       從二二型到二四型丙一律是**一号**，沒有任何來源說改過二号
 * ```
 *
 * 機首另有一挺**可左右互換的預備銃**（Profile 210：腰部隔框上另備一挺）。
 * 日方諸元寫 7.7 mm ×3、Francillon 寫 4 挺，差別就在這挺算不算一個銃座。
 * **取常態編制的 3 挺**，預備槍不建模。
 *
 * ── 位置的來源，逐項標明 ───────────────────────────────────
 *
 * 全部由 `ID=g4m npx vite-node test/tools/japan-hit.measure.ts` 的零件包圍盒
 * 讀出來 —— 這台的 GLB 節點分得很乾淨，四個銃座的位置**都是量到的**，
 * 不像 He 111 的腰窗要靠推算。
 *
 * ```
 *   nose     `G4M_NoseGlass`  Z −6.100…−4.070   機首尖端 −6.10，槍口取 −6.05
 *   dorsal   `G4M_Turret`     Y 1.043…1.463、Z 2.350…3.350   罩頂 1.46、中段 2.85
 *   beamL/R  `G4M_BlisterL/R` X ±0.969…1.219、Z 4.550…5.950   腰部玻璃球
 *   tail     `G4M_TailGlass`  Z 13.050…13.650   尾端 13.65，槍口取 13.60
 * ```
 *
 * 【半角與旋轉速率是設計值不是量測值】理由與 `weapons/he111.ts`、
 * `weapons/b17g.ts` 完全相同 —— 射界不規則而照片讀不出邊界，一個中心方向
 * 加一個半角才是**可以被試飛推翻的形式**（技能坑 22）。
 *
 * 【只有機背是動力銃塔】所以它的旋轉速率給 110 °/s，其餘四座手持槍一律
 * 90 °/s（與 He 111 一致）。
 */
export const G4M_TURRETS: readonly Turret[] = [
  {
    id: 'nose',
    weapon: TYPE92,
    position: muzzleAt(new Vector3(0, 0.10, -6.05), new Vector3(0, 0, -1)),
    axis: new Vector3(0, 0, -1),
    halfAngle: 45 * DEG, // 電動 360° 迴轉鼻錐，射界比 He 111 的球窩座好
    rotationRate: 90 * DEG,
    guns: 1,
  },
  {
    id: 'dorsal',
    weapon: TYPE99_1,
    position: muzzleAt(new Vector3(0, 1.46, 2.85), new Vector3(0, 0.64, 0.77).normalize()),
    axis: new Vector3(0, 0.64, 0.77).normalize(),
    halfAngle: 70 * DEG,
    rotationRate: 110 * DEG, // 唯一一座動力銃塔
    guns: 1,
  },
  {
    id: 'beamR',
    weapon: TYPE92,
    position: muzzleAt(new Vector3(1.22, -0.15, 5.25), new Vector3(1, 0, 0)),
    axis: new Vector3(1, 0, 0),
    halfAngle: 45 * DEG,
    rotationRate: 90 * DEG,
    guns: 1,
  },
  {
    id: 'beamL',
    weapon: TYPE92,
    position: muzzleAt(new Vector3(-1.22, -0.15, 5.25), new Vector3(-1, 0, 0)),
    axis: new Vector3(-1, 0, 0),
    halfAngle: 45 * DEG,
    rotationRate: 90 * DEG,
    guns: 1,
  },
  {
    id: 'tail',
    weapon: TYPE99_1,
    position: muzzleAt(new Vector3(0, -0.10, 13.60), new Vector3(0, 0, 1)),
    axis: new Vector3(0, 0, 1),
    halfAngle: 50 * DEG,
    rotationRate: 90 * DEG, // 滑軌座、手動
    guns: 1,
  },
]
