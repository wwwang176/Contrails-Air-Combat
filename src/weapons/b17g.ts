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
 * ── 位置的來源，逐項標明 ───────────────────────────────────
 *
 * 這個專案的紀律是「能量的就不要用眼睛判斷」，所以每一格都要說得出來歷。
 * 四座**量自參考模型**，四座是**量到的機身剖面 + 史實站位**：
 *
 * ```
 *   chin   量測  球心機體 z −4.98、腹線 −1.056（旁站 −0.60）
 *                 —— 這是舊 B17G_BATTERY 掛架的同一個值，原樣搬過來
 *   top    量測  機體 z −1.58…−0.63、背線量到 2.37（機身蒙皮只到 1.98）
 *   ball   量測  機體 z  4.52…5.72、腹線量到 −1.26（機身蒙皮只到 −0.64）
 *   tail   量測  槍管機體 z 16.4…17.14、y ≈ 1.0、x ±0.14（backlog §2.15）
 *   cheek  推算  z −4.60 取自史實站位（投彈手艙後段）；x 由 b17g.hull.ts
 *                 在該站量到的半寬 0.98 外推一段槍管
 *   waist  推算  z 6.20／6.80 取自史實站位，**左右交錯**是真機就有的
 *                 （見 b17g.hull.ts 的左右對稱化那一段）；x 由該站量到的
 *                 半寬 1.14 外推
 * ```
 *
 * 【為什麼四座是推算不是量測】參考模型的 25 個 mesh **全部叫 `Object_NN`**，
 * 沒有語意名稱；而且有四個三角形數完全相同、都落在同一段 z —— 光看包圍盒
 * 認不出哪個是哪座砲塔。射線法在這裡也失效：從機身裡往外打的射線會**飛過
 * 砲塔打到對側機身或機翼**，實測同一站 maxRadius 0.9 量到 0.89、1.4 量到
 * 1.34，兩個半徑永遠不一致（那正是量測腳本的驗收判準抓到的）。
 *
 * 猜是坑 22 的犯法，所以不猜：改成把砲塔放在**已經逐站量過的機身剖面**上，
 * z 取真機的站位。護欄（回走碰得到機體、朝向符合名字）擋掉粗錯，細節由
 * 試飛裁定。**這幾格日後若量得出來，以量測值為準。**
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
  { id: 'chin', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, -0.70, -5.43),
      new Vector3(0, -0.34, -0.94).normalize()),
    axis: new Vector3(0, -0.34, -0.94).normalize(),
    halfAngle: 45 * DEG, rotationRate: 60 * DEG, guns: 2 },
  { id: 'cheekL', weapon: M2_BROWNING, position: muzzleAt(new Vector3(-1.15, 0.35, -4.60),
      new Vector3(-0.57, 0, -0.82).normalize()),
    axis: new Vector3(-0.57, 0, -0.82).normalize(),
    halfAngle: 35 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'cheekR', weapon: M2_BROWNING, position: muzzleAt(new Vector3(1.15, 0.35, -4.60),
      new Vector3(0.57, 0, -0.82).normalize()),
    axis: new Vector3(0.57, 0, -0.82).normalize(),
    halfAngle: 35 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'top', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, 2.15, -1.10),
      new Vector3(0, 1, 0)),
    axis: new Vector3(0, 1, 0),
    halfAngle: 80 * DEG, rotationRate: 60 * DEG, guns: 2 },
  { id: 'ball', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, -1.20, 5.10),
      new Vector3(0, -1, 0)),
    axis: new Vector3(0, -1, 0),
    halfAngle: 80 * DEG, rotationRate: 60 * DEG, guns: 2 },
  { id: 'waistR', weapon: M2_BROWNING, position: muzzleAt(new Vector3(1.35, 0.55, 6.20),
      new Vector3(1, 0, 0)),
    axis: new Vector3(1, 0, 0),
    halfAngle: 60 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'waistL', weapon: M2_BROWNING, position: muzzleAt(new Vector3(-1.35, 0.55, 6.80),
      new Vector3(-1, 0, 0)),
    axis: new Vector3(-1, 0, 0),
    halfAngle: 60 * DEG, rotationRate: 90 * DEG, guns: 1 },
  { id: 'tail', weapon: M2_BROWNING, position: muzzleAt(new Vector3(0, 1.0, 16.4),
      new Vector3(0, 0.09, 1).normalize()),
    axis: new Vector3(0, 0.09, 1).normalize(),
    halfAngle: 30 * DEG, rotationRate: 90 * DEG, guns: 2 },
]
