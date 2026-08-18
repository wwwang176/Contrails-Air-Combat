import { Vector3 } from 'three'
import { DEG } from '../../core/math'
import { createHull, type AircraftModel, type Blister, type FinParams, type LoftPart } from './assembly'
import type { FrameSpec } from './canopy'
import type { GlassPatch } from './hull'
import { B17G_HULL } from './b17g.hull'
import type { WingParams } from './wing'

/**
 * Boeing B-17G-60-VE Flying Fortress 的程序化外型 —— 真機翼展 31.62 m、
 * 全長 22.66 m、翼面積 131.92 m²、四具 Wright R-1820-97 各 1,200 hp、
 * 三葉槳各 3.53 m。
 *
 * 照片上最能認出它的四件事：
 *   1. **四具發動機**，內外艙各一對，內艙後面收主輪
 *   2. 極大的圓垂尾，配上一路從機腰延伸過來的**背鰭整流罩**
 *   3. 機腹的**球形砲塔**與機首下方的**下巴砲塔**（G 型才有）
 *   4. 又長又細的機身，橫剖面接近圓形（半寬 1.18、半高 1.15）
 *
 * 【全部座標量自參考模型】機身、機翼、四具發動機艙、尾翼、透明件都是同一次
 * 切片、同一個座標系量出來的（坑 16），最後整體平移 +1.1212 換成機體座標
 * （見 `b17g.hull.ts`）。量法見 `.claude/skills/aircraft-from-reference`。
 *
 * ── 這台在量測上比前三台難的地方 ──────────────────────────
 *
 * 機背長滿東西（上部砲塔、無線電艙的開放槍位與頂窗、背鰭整流罩），而且
 * **正上方那條射線與垂尾共面** —— Z 8.85 之後整段回 0。逐片試過也沒有任何
 * 一個 mesh 是完整的機身蒙皮（這個模型按材質分片不是按零件分片）。
 *
 * 解法是把射線原點挪開：後段用 (x 0.35, y 0.90) 那一組，量到的背線從
 * Z 7.0 到 13.0 完全連續而且單調。細節寫在 `b17g.hull.ts`。
 */

/**
 * 主翼。**單一梯形**（不像 He 111 有轉折）——量到的前後緣斜率沿翼展只在
 * 0.12～0.14 之間變，配一條直線就夠。
 *
 * 【量測值，機體座標】沿翼展 79 刀，`uWindow` 限住 Z 排掉螺旋槳與平尾。
 * 外推到 X = 0 用的是**乾淨段 X 2.2…4.0** —— 避開翼根整流罩（X < 2.2 前緣
 * 斜率 0.225，是整流罩不是翼）與內側發動機艙（X 2.40…3.80）：
 *
 * ```
 *   前緣  X 2.2 −1.237、X 4.0 −1.021  斜率 0.1217/m  → X0 −1.5045
 *   後緣  X 2.2  4.310、X 4.0  4.146  斜率 0.0922/m  → X0  4.5131
 *   翼根弦 6.018    翼尖（X 14.4）弦 2.735
 * ```
 *
 * 【交叉驗證：翼面積（坑 16）】這條梯形 (6.018 + 2.413)/2 × 15.81 × 2 =
 * **133.3 m²** 對真機 131.92，**+1.0%**。
 *
 * 注意量測腳本直接梯形積分得到的是 140.2（+6.4%）—— 那含 X < 1.2 的站位，
 * 而那些站位量到的「弦長 7.9、厚弦比 33%」是**機身**不是翼。
 *
 * 【上反角 3.87° 是量到的，不是史實值】中厚線 (vMin+vMax)/2 沿翼展：
 * X 4.4 → 0.199、X 9.0 → 0.509、X 15.0 → 0.915，兩段斜率 0.0674 / 0.0677
 * 完全一致。史實常引 4.5°，差 0.6° —— 依坑 21，這一項量測值自己內部一致
 * 而且有 6 m 的基線，採量測值。
 *
 * 【厚度】翼根 1.155（t/c 19.2%，史實翼型 NACA 0018）、翼尖 0.22
 * （史實 0010 × 弦長 2.413 = 0.241）。量到的逐站厚度由 X 1.4 的 1.072 到
 * X 14.4 的 0.297，斜率 −0.0596/m，兩端外推就是這兩個數。
 */
const WING: WingParams = {
  rootChord: 6.018, tipChord: 2.413, halfSpan: 15.81, rootZ: -1.5045,
  sweep: 7.53 * DEG, dihedral: 3.87 * DEG, rootY: -0.10,
  thickness: 1.155, tipThickness: 0.220,
  /**
   * 【0.45 與 He 111 同一個取捨】量到的翼尖是「撐住弦長到 95% 半翼展才急收」
   * ——X 15.00 弦長還有 2.440，15.40 剩 1.865，15.80 只有 0.246。`tipRound`
   * 只控制收多少、控制不了從哪裡開始收（坑 18），0.45 讓兩端都在 0.3 m 內。
   */
  tipRound: 0.45,
}

/**
 * 水平尾翼。量測值（機體座標）：
 *
 * ```
 *   X 1.0 → 5.8   前緣 10.901 → 12.070（後掠 13.7°）
 *                 後緣 14.065 → 13.743
 *                 弦長  3.163 →  1.674   厚度 0.345 → 0.168
 *   半展 6.500（全展 13.00，真機 13.11，−0.8%）
 * ```
 *
 * 【X < 1.0 要丟】那幾站量到的厚度是 1.87～1.04，那是**機身**不是尾翼。
 *
 * 【rootY 1.26 是量到的】沿 Z 切、`uWindow` 只留單邊平尾，中厚線在內段
 * 1.264、外段 1.253 —— 幾乎不變，所以上反角是 0。
 *
 * 這一項順帶驗了姿態：套上 pitch −1.03° 之後，外段（殘差 RMS 只有 0.006 的
 * 那一把尺）的斜率變成 **+0.04°**，等於歸零。
 */
const TAILPLANE: WingParams = {
  rootChord: 3.475, tipChord: 1.460, halfSpan: 6.50,
  sweep: 13.68 * DEG, dihedral: 0, thickness: 0.382, tipThickness: 0.140,
  rootZ: 10.658, rootY: 1.26, tipRound: 0.35,
}

/**
 * 垂尾 —— **下半**（含背鰭整流罩）。沿 Y 切 45 刀量到的側視平面形
 * （機體座標）：
 *
 * ```
 *   Y      2.40    3.02    4.03    4.65    5.03    5.65
 *   前緣   4.948   6.673   9.435  11.161  12.196  13.415
 *   後緣  15.343  15.210  15.015  14.874  14.699  13.827
 * ```
 *
 * 前緣在 Y 2.40…5.03 幾乎是一條直線（dz/dy = 2.756），之後才急收 —— 與
 * He 111 一樣配不進單一梯形，所以拆成主片與頂蓋兩片。
 *
 * 【rootY 1.30 必須低於整段機尾背線】坑 17：取「前緣所在站位的背線」很直覺，
 * 但背線一路降到尾錐。量到的機尾背線由 Z 4.5 的 1.695 降到 Z 12.85 的 1.559，
 * 取 1.30 讓虛擬翼根低於每一個機身環，多出來的部分埋進機身反正看不到。
 *
 * ── 為什麼是三片不是兩片 ──────────────────────────────
 *
 * 第一版用兩片（主片 rootY 1.30 → 4.40、頂蓋 4.40 → 5.65），驗收對切抓到
 * **垂尾前緣在 Y 2.40 少了 1.22 m**，而且缺口一路線性收到 Y 4.40 才歸零 ——
 * 那正是背鰭整流罩被一條直線吃掉的形狀。
 *
 * 直接把主片的根部外推到 Y 1.30 會得到前緣 z 1.91，那在**機翼後緣之前**，
 * 整流罩會長到機翼上面去。參考模型的整流罩前緣是**凹的**，一條直線只能
 * 二選一。所以下面那 1.1 m 另外切一片（`DORSAL`），折線就配得上了。
 *
 * 坑 20b 的另一面：這一次「少」的量大到看得出來（1.22 m 是全機長的 5%），
 * 那就不該再用「寧可少」帶過。
 */
const DORSAL: FinParams = {
  chordRoot: 11.80, chordTip: 10.395, height: 1.10, sweep: 50.8 * DEG,
  z: 3.60, rootY: 1.30,
}

const FIN: FinParams = {
  chordRoot: 10.395, chordTip: 4.471, height: 2.00, sweep: 70.1 * DEG,
  z: 4.948, rootY: 2.40,
}

/** 垂尾 —— 上半的圓頂。前緣 10.470 → 13.415、後緣 14.941 → 13.827 */
const FIN_CAP: FinParams = {
  chordRoot: 4.471, chordTip: 0.412, height: 1.25, sweep: 67.0 * DEG,
  z: 10.470, rootY: 4.40,
}

/**
 * 四具發動機艙。**沿 Z 切、`uWindow` 只留該艙那一條翼展帶**量出來的。
 *
 * 【為什麼不用射線】第一版把射線原點放進艙裡（座艙罩那一招），但艙與機翼是
 * **連在一起**的：側向射線一出艙就沿著機翼跑，量到的「半寬」是機翼。座艙罩
 * 那招成立是因為罩子與機身之間有一圈明顯的凹陷，發動機艙沒有。
 *
 * 【內外艙不是同一個形狀】外艙整個高 0.28（機翼上反角），而且**沒有主輪
 * 艙的鼓包** —— B-17 的主輪只收在內艙。內艙量到腹線在機體 z −1.5…−0.9
 * 掉到 −1.15，其餘各站是 −0.75 上下，那 0.4 就是輪艙。
 */
const NAC_X_INNER = 3.10
const NAC_X_OUTER = 6.50

/**
 * 【艙的半寬 0.70 是從 `wing` 那一格讀的，不是從艙的縱剖】
 *
 * 縱剖那一趟用 `uWindow` 把 X 限在艙的那一條帶（內艙 [2.6, 3.6]），量到的
 * 「X 幅度」整段都是 0.99 上下 —— 那是**窗口自己的寬度**不是艙的寬度。
 * 照抄下去半寬變成 0.50，驗收對切立刻抓到：X 3.80 那一站自家的前緣比參考
 * 晚了 **1.99 m**（參考在那裡有艙、自家只有機翼）。
 *
 * 這是坑 6 的同一條在另一個參數上：**上限／窗口不會報錯，它只是把答案
 * 換成自己**。正確的來源是沿翼展切的那一趟 —— 厚度突然變兩倍的區間就是艙：
 * 內艙 X 2.40…3.80、外艙 5.80…7.20，兩者半寬都是 0.70。
 *
 * 交叉驗證：Wright R-1820 的整流罩直徑約 1.4 m，正好對上。
 *
 * 下面兩串截面的 `halfWidth` 就是縱剖那一趟的值乘 1.4 再夾在 0.70。
 */
const NACELLE_INNER: LoftPart = {
  roundness: 2.3,
  segments: 12,
  caps: { front: false },
  sections: [
    { z: -3.15, halfWidth: 0.658, halfHeight: 0.700, centerY: -0.020 },
    { z: -2.88, halfWidth: 0.700, halfHeight: 0.764, centerY: -0.020 },
    { z: -2.48, halfWidth: 0.696, halfHeight: 0.767, centerY: -0.014 },
    { z: -2.08, halfWidth: 0.668, halfHeight: 0.798, centerY: -0.007 },
    { z: -1.68, halfWidth: 0.697, halfHeight: 0.901, centerY: -0.106 },
    { z: -1.28, halfWidth: 0.692, halfHeight: 0.972, centerY: -0.182 },
    { z: -0.88, halfWidth: 0.697, halfHeight: 0.918, centerY: -0.138 },
    { z: -0.48, halfWidth: 0.700, halfHeight: 0.758, centerY: 0.004 },
    { z: 0.12, halfWidth: 0.686, halfHeight: 0.711, centerY: -0.012 },
    { z: 0.72, halfWidth: 0.689, halfHeight: 0.593, centerY: 0.005 },
    { z: 1.32, halfWidth: 0.676, halfHeight: 0.571, centerY: -0.070 },
    { z: 1.92, halfWidth: 0.655, halfHeight: 0.403, centerY: 0.003 },
    { z: 2.52, halfWidth: 0.616, halfHeight: 0.220, centerY: 0.100 },
    { z: 3.00, halfWidth: 0.532, halfHeight: 0.110, centerY: 0.150 },
  ],
}

const NACELLE_OUTER: LoftPart = {
  roundness: 2.3,
  segments: 12,
  caps: { front: false },
  sections: [
    { z: -2.75, halfWidth: 0.602, halfHeight: 0.660, centerY: 0.260 },
    { z: -2.48, halfWidth: 0.692, halfHeight: 0.737, centerY: 0.245 },
    { z: -2.08, halfWidth: 0.678, halfHeight: 0.766, centerY: 0.246 },
    { z: -1.48, halfWidth: 0.676, halfHeight: 0.799, centerY: 0.245 },
    { z: -0.88, halfWidth: 0.645, halfHeight: 0.766, centerY: 0.265 },
    { z: -0.28, halfWidth: 0.694, halfHeight: 0.742, centerY: 0.241 },
    { z: 0.32, halfWidth: 0.658, halfHeight: 0.597, centerY: 0.273 },
    { z: 0.92, halfWidth: 0.560, halfHeight: 0.442, centerY: 0.273 },
    { z: 1.52, halfWidth: 0.504, halfHeight: 0.343, centerY: 0.303 },
    { z: 2.12, halfWidth: 0.476, halfHeight: 0.274, centerY: 0.281 },
    { z: 2.92, halfWidth: 0.322, halfHeight: 0.101, centerY: 0.199 },
  ],
}

/**
 * 三座砲塔。**位置與尺寸都是量到的**，不是照片讀的（坑 22）：
 *
 * ```
 *   下巴（Bendix）  Z −5.48…−4.48  腹線量到 −1.056（旁邊各站是 −0.60）
 *   上部（Sperry）  Z −1.68…−0.88  背線量到  2.372（旁邊各站是  1.56）
 *   球形（Sperry）  Z  4.52… 5.72  腹線量到 −1.263（旁邊各站是 −0.65）
 * ```
 *
 * 尾砲塔（Cheyenne）在機體 Z 13.97 之後，那一段機身環整圈打不到 —— 由
 * `b17g.hull.ts` 最後五環的手工尾錐代表，不另外貼球。
 */
const TURRETS: readonly Blister[] = [
  { x: 0, y: -0.55, z: -4.98, width: 0.95, height: 1.00, length: 1.05, round: true },
  { x: 0, y: 1.95, z: -1.28, width: 0.90, height: 0.85, length: 0.90, round: true },
  { x: 0, y: -0.68, z: 5.12, width: 1.10, height: 1.15, length: 1.10, round: true },
]

/**
 * 玻璃。**這張表是量的不是讀照片的**（坑 22）——同一組射線打兩次，一次不
 * 過濾、一次只打材質透明的那一片（`Object_50`），兩者相等就是那一格最外面
 * 是玻璃。機體座標：
 *
 * ```
 *   −6.16…−5.66  整圈       投彈手的機首罩 → `GLASS_SPLIT_Z`
 *   −5.28…−5.03  正上與 30°  領航員的頰窗
 *   −4.53…−4.16  正上與 30°  天文導航罩那一帶
 *    2.72… 3.72  只有正上    無線電艙的頂窗
 *    8.22        只有 150°   腰部槍窗（左右**交錯**，B-17G 本來就是）
 *   15.72        只有正上    尾槍手
 * ```
 *
 * ── ⚠ 座艙玻璃是判斷，不是量到的 ────────────────────────
 *
 * 機體 Z −3.4…−2.0（座艙）整段量到「**連凹進去的玻璃都沒有**」——把判準
 * 從「玻璃在最外」放寬成「有沒有打到玻璃」重跑，那一段仍然全是蒙皮。
 * 這台參考模型的座艙玻璃不是獨立的透明 mesh。
 *
 * 所以 `COCKPIT` 那一片的範圍是**人工定的**，錨在量到的機身站位上。這一條
 * 照實記著：He 111 的機腹就是敗在「從照片讀來的前提沒有進過任何量測表」，
 * 六次修正每一次都合理、每一次都不對（坑 22）。這裡至少知道自己在猜。
 */
const GLASS_SPLIT_Z = -5.66
const GLASS_PATCHES: readonly GlassPatch[] = [
  // 領航員的頰窗與天文導航罩那一帶：正上到 42°
  { from: -5.30, to: -4.16, i0: 0, i1: 4 },
  // 座艙 —— 見上方的 ⚠
  { from: -3.40, to: -2.05, i0: 1, i1: 4, recess: true },
  // 無線電艙的頂窗
  { from: 2.72, to: 3.72, i0: 0, i1: 2 },
  // 腰部槍窗。量到的只有左側那一格（Z 8.22、150°），但兩側都有，只是縱向
  // 交錯；這一檔的環是左右鏡像的，所以做成同一段 z（坑 20b：寧可少）
  { from: 7.90, to: 8.60, i0: 4, i1: 6, recess: true },
]

/**
 * 機首罩的結構條。B-17G 的投彈手罩是分格的，沒有骨架的話那一段從外面看
 * 就是一顆光滑的玻璃球。
 *
 * 【材質是雙面的】窄帶只有一個朝向，全玻璃的罩子看得到對側骨架的**背面**
 * ——不加雙面材質那幾條從背面看整個消失（坑 25）。`h.frames` 自己用
 * `bothSides`。
 */
const FRAMES: FrameSpec = {
  hoops: [-6.00, -5.83, GLASS_SPLIT_Z],
  rails: [0, 4, 8],
  from: -6.03, to: GLASS_SPLIT_Z,
  width: 0.030, out: 0.012,
}

export const B17G_BODY_COLOR = 0x8d9299

export function buildB17G(): AircraftModel {
  const h = createHull({
    bodyColor: B17G_BODY_COLOR,
    accentColor: 0x3c4147,
    realLength: 22.66,
    // 平移已經烘進 b17g.hull.ts 的站位裡（量測系 +1.1212）
    offsetZ: 0,
    /**
     * 眼點：正駕駛在座艙的**左**座。z −2.9 落在座艙段中間，y 1.05 在該站
     * 背線（1.57）之下、腹線（−0.78）之上。
     */
    eyePoint: new Vector3(-0.38, 1.05, -2.90),
    /**
     * 右翼尖弦的中點，由 `WING` 推出：
     *   x = halfSpan                              = 15.810
     *   y = rootY + tan(3.87°) × 15.81            = −0.10 + 1.0693 = 0.969
     *   翼尖前緣 = rootZ + tan(7.53°) × 15.81      = −1.5045 + 2.0906 = 0.586
     *   翼尖弦  = tipChord × tipFactor(1, 0.45)    = 2.413 × 0.45 = 1.086
     *   前緣   = 0.586 + (2.413 − 1.086) × 0.3     = 0.984   （TIP_ANCHOR）
     *   z     = 前緣 + 弦/2                        = 1.527
     */
    wingTip: new Vector3(15.810, 0.969, 1.527),
  })

  // 機首罩：外殼切成兩截，前段玻璃、後段機身色
  h.glazedNose(B17G_HULL, GLASS_SPLIT_Z, GLASS_PATCHES)
  h.frames(B17G_HULL, FRAMES)

  /**
   * 四具發動機艙。機身色而不是強調色 —— 它們是蒙皮的一部分。
   *
   * 【內外各一串截面】兩者的高度差 0.28（機翼上反角）、而且只有內艙有主輪
   * 艙的鼓包。壓進同一串截面就會整圈一起跳（He 111 的 `NACELLE` 檔頭記過
   * 這一條：底線該掉的那一步把頂線也憑空抬了 0.045）。
   */
  for (const sx of [1, -1]) {
    h.loft(NACELLE_INNER, h.body).position.x = sx * NAC_X_INNER
    h.loft(NACELLE_OUTER, h.body).position.x = sx * NAC_X_OUTER
  }

  h.wingPair(WING)
  h.wingPair(TAILPLANE)
  // 主垂尾的頂不圓化（頂蓋接在上面）；頂蓋自己收圓
  h.upright(DORSAL, 0.20)
  h.upright(FIN, 0.18)
  h.upright(FIN_CAP, 0.16, 0.80)

  h.blisters(TURRETS)

  /**
   * 四具螺旋槳。
   *
   * 【`noseZ` 是整流罩的**底座**不是尖端】`assembly.propeller` 把圓錐擺在
   * `noseZ − spinnerLength / 2`、頂點朝 −Z，所以錐體佔 `noseZ − length` 到
   * `noseZ`。He 111 那次照「機首尖端」填，整具整流罩前伸了 0.55 m，而艙的
   * loft 又從同一點長一個錐尖接上去，接縫看不出來、只是引擎長了半公尺
   * （坑 27）。
   *
   * 這裡的 `noseZ` 直接取每一具艙的**首站**：內艙 −3.15、外艙 −2.75。
   *
   * 【槳盤半徑 1.765】真機三葉槳直徑 11 ft 7 in = 3.53 m。注意
   * `specs/b17g.ts` 的 `prop.diameter` 是**等效單槳盤**（四具的合計面積換算
   * 成一個），與這裡的視覺尺寸是兩件事。
   */
  for (const sx of [1, -1]) {
    for (const [x, noseZ] of [
      [sx * NAC_X_INNER, -3.15], [sx * NAC_X_OUTER, -2.75],
    ] as const) {
      h.propeller({
        x, noseZ, spinnerRadius: 0.30, spinnerLength: 0.42, spinnerY: 0,
        blades: 3, propZ: noseZ - 0.18, propRadius: 1.765,
      }, B17G_HULL[0]!.z)
    }
  }

  return h.finish()
}
