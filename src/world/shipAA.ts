import { Vector3 } from 'three'

/**
 * # 軍艦的防空砲位 —— **位置是量出來的，射界與血量不是**
 *
 * 這一份由 `tools/blender/export_ship_aa.py` 從 `build_*.py` 直接產生，
 * 不要手改：座標與 `public/models/*.glb` 是同一份來源，手抄一份的話，改了
 * 建模腳本而忘了改表，砲口就會離開砲塔而**沒有任何測試會紅**。
 *
 * ## 三層，行為不一樣
 *
 * | tier | 口徑 | 交戰 | 視覺 | 有效射程 |
 * | --- | --- | --- | --- | --- |
 * | `flak` | 5"/38 兩用砲 | **空中引爆**（定時／VT 引信）| 黑色煙團 | 8–10 km |
 * | `autocannon` | 40 mm Bofors | 直射命中 | 曳光彈流 | 2.7–3.5 km |
 * | `mg` | 20 mm Oerlikon | 直射命中 | 曳光彈流 | 0.9–1.5 km |
 *
 * 20 mm 與 40 mm 雖然叫「砲」，但它們是機關砲、打的是直射曳光彈 —— 行為與
 * 轟炸機的自衛機槍同一類。**會做出黑霧的只有 5 吋兩用砲。**
 *
 * ## 座標系
 *
 * 與 GLB 一致：X 橫向（+X 右舷）、**Y 上**、**−Z 艦首**，原點在水線 × 艦體
 * 中點 × 中線。`position` 是**砲口**（與 `weapons/turret.ts` 的 `Turret.position`
 * 同一個約定），不是樞軸。
 *
 * ## 這裡刻意沒有的東西
 *
 * `axis`／`halfAngle`／`rotationRate`／`hp` **不在這裡**。`weapons/turret.ts`
 * 已經寫明射界是「設計值，不是量測值」，理由是這個專案為「從照片讀來的前提」
 * 付過一整輪的代價（見 `.claude/skills/aircraft-from-reference` 坑 22）。
 * 從外型模型硬讀一個射界出來，正好是那條規則要擋的事 —— 那幾個值由試飛裁定。
 *
 * ## 接進遊戲請用 `*_AA_ZONES`，不是這一份
 *
 * `weapons/turret.ts` 的 `MAX_TURRETS = 8`（一台單位最多八座），而 Essex 逐門
 * 列出來有 46 個。超過的話**三件事會同時靜靜地壞掉**：
 *
 * 1. 第 9 座起畫不出砲管與槍焰（那兩個迴圈跑的是 `MAX_TURRETS` 次），但開火
 *    邏輯跑的是「這艘有幾座」—— 子彈會從空氣裡冒出來
 * 2. 抖動相位與點放節奏的種子是 `單位編號 × MAX_TURRETS + 砲塔編號`，編號一旦
 *    超過 7 就與**下一個單位的第 0 座**撞號，好幾座砲完全同步地抖
 * 3. 不報錯、測試也不紅
 *
 * 所以下面每艘再給一份 `*_AA_ZONES`：**一區推一門真實存在的砲當代表**
 * （負責人 2026-09-04 裁決）。分區方式一層不一樣：
 *
 * | 層 | 分區 | 為什麼 |
 * | --- | --- | --- |
 * | `flak`、`autocannon` | 一舷一區 | 本來就只有幾座，位置也集中 |
 * | `mg` | 一舷**前後各一區** | 一舷一個點涵蓋不了 185 m 的近迫火網 |
 *
 * 前後的分界是**該舷 20 mm 自己的 y 範圍的中點**，不是艦體中點（Fletcher 的四門
 * 全在艦橋附近，用艦體中點切後半段是空的），也不是最大空隙（Essex 右舷 17 門會
 * 被切成 15/2，一個代表涵蓋 15 門那一長串，等於沒拆）。
 *
 * 切完是 Essex 8 區、Fletcher 6 區、Wichita 8 區 —— **兩艘正好卡在上限 8**。
 * 再想細分任何一層之前要先擴容 `MAX_TURRETS`。
 */
export type ShipAATier = 'flak' | 'autocannon' | 'mg'

export interface ShipEmplacement {
  /** 穩定 id：`<tier>_<舷><序號>`，舷是 p 左／s 右／c 中線。 */
  id: string
  tier: ShipAATier
  /** 口徑，mm。127 = 5 吋。 */
  calibreMm: number
  /** 砲口，艦體座標，m。 */
  position: Vector3
  /** 幾管。四聯裝 40 mm 填 4 —— 注意 `render/turretBarrels.ts` 只畫得出 2 根。 */
  guns: number
}

/**
 * 併區之後的砲位 —— **接進遊戲用這一份**。
 *
 * 一區推**一門真實存在的砲**當代表：位置就是那一門量到的槍口，所以槍焰一定長在
 * 畫得出來的那根砲管上。取形心會落在兩層甲板之間的空中（Essex 左舷那排 20 mm
 * 沿著彎曲的走廊跨了 250 m）。
 *
 * id 的尾巴 `f`／`a` 是前／後（只有 20 mm 有，其他層一舷就一區）。
 */
export interface ShipAAZone extends ShipEmplacement {
  /**
   * 這一區實際上有幾門砲。**只是記錄，不是倍率** —— 負責人 2026-09-04 裁決：
   * 一區一門代替就好、血量不加倍。要拿它去乘血量或傷害之前請先想清楚：
   * 玩家看到的就是一門砲，打起來卻像 27 門，那是兩回事。
   */
  mountsInZone: number
  /** 代表的是逐門清單裡的哪一門（對得回 `*_AA`）。 */
  representative: string
}

/**
 * 射界的**起始值**，一層一組 —— 與 `WOBBLE_AMPLITUDE` 同一個性質：
 * **設計值，由試飛裁定**，不是從模型量出來的。
 *
 * `elevationDeg` 是錐軸抬離水平的角度；錐軸的水平分量一律朝**舷外**（中線上的
 * 砲改成朝正上）。半角越大、涵蓋越廣但也越不像有死角。
 *
 * 起始值的想法：口徑越大打得越遠越高、指向越接近天頂；小口徑近迫防禦則壓低、
 * 涵蓋窄一點，玩家貼海面進場時才有「先穿過黑霧、再進彈幕」的層次。
 * 機庫（`hangar.html` 選船 → 射界）可以直接看這三層疊出來的樣子。
 */
export const SHIP_AA_ARC_DEFAULTS: Readonly<Record<ShipAATier,
  { elevationDeg: number; halfAngleDeg: number }>> = {
  flak: { elevationDeg: 55, halfAngleDeg: 75 },
  autocannon: { elevationDeg: 45, halfAngleDeg: 65 },
  mg: { elevationDeg: 40, halfAngleDeg: 55 },
}

/** USS Essex CV-9 逐門 —— 兩用砲 8、40 mm 11、20 mm 27。**量測來源，不是遊戲用的那一份。** */
export const ESSEX_AA: readonly ShipEmplacement[] = [
  { id: 'flak_p1', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-16.80, 15.37, -96.00) },
  { id: 'flak_p2', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-16.80, 18.11, -60.00) },
  { id: 'flak_s1', tier: 'flak', calibreMm: 127, guns: 2,
    position: new Vector3(13.90, 20.05, -46.50) },
  { id: 'flak_s2', tier: 'flak', calibreMm: 127, guns: 2,
    position: new Vector3(14.05, 20.05, -37.00) },
  { id: 'flak_s3', tier: 'flak', calibreMm: 127, guns: 2,
    position: new Vector3(12.90, 20.05, 25.00) },
  { id: 'flak_s4', tier: 'flak', calibreMm: 127, guns: 2,
    position: new Vector3(12.90, 20.05, 33.00) },
  { id: 'flak_p3', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-22.90, 18.11, 42.50) },
  { id: 'flak_p4', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-22.90, 15.37, 78.00) },
  { id: 'autocannon_p1', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-16.60, 17.26, -118.00) },
  { id: 'autocannon_s1', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(15.10, 17.26, -118.00) },
  { id: 'autocannon_p2', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-16.60, 15.35, -96.00) },
  { id: 'autocannon_p3', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-17.60, 15.35, -86.50) },
  { id: 'autocannon_p4', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-18.10, 16.35, -78.00) },
  { id: 'autocannon_p5', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-16.60, 17.49, -56.00) },
  { id: 'autocannon_p6', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-20.10, 17.49, 13.00) },
  { id: 'autocannon_p7', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-16.60, 16.35, 99.50) },
  { id: 'autocannon_p8', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-17.60, 15.35, 108.00) },
  { id: 'autocannon_p9', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-15.10, 17.49, 118.00) },
  { id: 'autocannon_s2', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(14.60, 17.49, 118.00) },
  { id: 'mg_p1', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-14.05, 16.95, -105.50) },
  { id: 'mg_s1', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.05, 18.09, -105.50) },
  { id: 'mg_s2', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(15.55, 18.09, -93.50) },
  { id: 'mg_s3', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.05, 18.09, -77.50) },
  { id: 'mg_s4', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.05, 18.09, -70.50) },
  { id: 'mg_p2', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-17.05, 18.09, -65.50) },
  { id: 'mg_s5', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.55, 18.09, -61.50) },
  { id: 'mg_p3', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-19.05, 18.09, -43.50) },
  { id: 'mg_p4', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-19.05, 18.09, -36.50) },
  { id: 'mg_p5', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-19.05, 18.09, -29.50) },
  { id: 'mg_s6', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.55, 14.18, -29.50) },
  { id: 'mg_s7', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(17.55, 15.95, -15.50) },
  { id: 'mg_s8', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(17.55, 15.95, -8.50) },
  { id: 'mg_p6', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-19.05, 18.09, -3.50) },
  { id: 'mg_s9', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(17.55, 15.95, -1.50) },
  { id: 'mg_s10', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(17.55, 15.95, 8.50) },
  { id: 'mg_s11', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(13.05, 18.77, 16.50) },
  { id: 'mg_p7', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-20.55, 17.83, 22.50) },
  { id: 'mg_p8', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-20.55, 17.83, 29.50) },
  { id: 'mg_s12', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.55, 18.09, 40.50) },
  { id: 'mg_p9', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-24.05, 18.09, 44.50) },
  { id: 'mg_s13', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.55, 18.09, 47.50) },
  { id: 'mg_s14', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(16.05, 18.09, 58.50) },
  { id: 'mg_p10', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-20.55, 18.77, 62.50) },
  { id: 'mg_s15', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(16.05, 18.09, 65.50) },
  { id: 'mg_s16', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(14.55, 18.09, 98.50) },
  { id: 'mg_s17', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(15.05, 18.09, 112.50) },
]

/** USS Essex CV-9 併區（8 區）。 */
export const ESSEX_AA_ZONES: readonly ShipAAZone[] = [
  { id: 'flak_p', tier: 'flak', calibreMm: 127, guns: 1, mountsInZone: 4,
    representative: 'flak_p2', position: new Vector3(-16.80, 18.11, -60.00) },
  { id: 'flak_s', tier: 'flak', calibreMm: 127, guns: 2, mountsInZone: 4,
    representative: 'flak_s2', position: new Vector3(14.05, 20.05, -37.00) },
  { id: 'autocannon_p', tier: 'autocannon', calibreMm: 40, guns: 4, mountsInZone: 9,
    representative: 'autocannon_p6', position: new Vector3(-20.10, 17.49, 13.00) },
  { id: 'autocannon_s', tier: 'autocannon', calibreMm: 40, guns: 4, mountsInZone: 2,
    representative: 'autocannon_s1', position: new Vector3(15.10, 17.26, -118.00) },
  { id: 'mg_pf', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 5,
    representative: 'mg_p2', position: new Vector3(-17.05, 18.09, -65.50) },
  { id: 'mg_pa', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 5,
    representative: 'mg_p8', position: new Vector3(-20.55, 17.83, 29.50) },
  { id: 'mg_sf', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 9,
    representative: 'mg_s5', position: new Vector3(14.55, 18.09, -61.50) },
  { id: 'mg_sa', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 8,
    representative: 'mg_s14', position: new Vector3(16.05, 18.09, 58.50) },
]

/** USS Fletcher DD-445 逐門 —— 兩用砲 5、40 mm 1、20 mm 4。**量測來源，不是遊戲用的那一份。** */
export const FLETCHER_AA: readonly ShipEmplacement[] = [
  { id: 'flak_c1', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(0.00, 7.53, -38.00) },
  { id: 'flak_c2', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(0.00, 9.26, -30.55) },
  { id: 'flak_c3', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(0.00, 7.65, 20.05) },
  { id: 'flak_c4', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(0.00, 7.41, 31.00) },
  { id: 'flak_c5', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(0.00, 5.05, 39.10) },
  { id: 'autocannon_c1', tier: 'autocannon', calibreMm: 40, guns: 2,
    position: new Vector3(0.00, 10.66, 26.00) },
  { id: 'mg_p1', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-3.52, 8.03, -25.40) },
  { id: 'mg_s1', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(3.52, 8.03, -25.40) },
  { id: 'mg_p2', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-3.95, 10.76, -18.60) },
  { id: 'mg_s2', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(3.95, 10.76, -18.60) },
]

/** USS Fletcher DD-445 併區（6 區）。 */
export const FLETCHER_AA_ZONES: readonly ShipAAZone[] = [
  { id: 'flak_c', tier: 'flak', calibreMm: 127, guns: 1, mountsInZone: 5,
    representative: 'flak_c3', position: new Vector3(0.00, 7.65, 20.05) },
  { id: 'autocannon_c', tier: 'autocannon', calibreMm: 40, guns: 2, mountsInZone: 1,
    representative: 'autocannon_c1', position: new Vector3(0.00, 10.66, 26.00) },
  { id: 'mg_pf', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 1,
    representative: 'mg_p1', position: new Vector3(-3.52, 8.03, -25.40) },
  { id: 'mg_pa', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 1,
    representative: 'mg_p2', position: new Vector3(-3.95, 10.76, -18.60) },
  { id: 'mg_sf', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 1,
    representative: 'mg_s1', position: new Vector3(3.52, 8.03, -25.40) },
  { id: 'mg_sa', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 1,
    representative: 'mg_s2', position: new Vector3(3.95, 10.76, -18.60) },
]

/** USS Wichita CA-45 逐門 —— 兩用砲 8、40 mm 2、20 mm 10。**量測來源，不是遊戲用的那一份。** */
export const WICHITA_AA: readonly ShipEmplacement[] = [
  { id: 'flak_p1', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-6.10, 7.30, -31.30) },
  { id: 'flak_s1', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(6.10, 7.30, -31.30) },
  { id: 'flak_p2', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-7.00, 9.73, -19.20) },
  { id: 'flak_s2', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(7.00, 9.73, -19.20) },
  { id: 'flak_p3', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-5.30, 9.72, 31.20) },
  { id: 'flak_s3', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(5.30, 9.72, 31.20) },
  { id: 'flak_p4', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(-5.25, 7.90, 87.60) },
  { id: 'flak_s4', tier: 'flak', calibreMm: 127, guns: 1,
    position: new Vector3(5.25, 7.90, 87.60) },
  { id: 'autocannon_p1', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(-6.30, 11.68, -12.20) },
  { id: 'autocannon_s1', tier: 'autocannon', calibreMm: 40, guns: 4,
    position: new Vector3(6.30, 11.68, -12.20) },
  { id: 'mg_p1', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-1.50, 8.22, -85.20) },
  { id: 'mg_s1', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(1.50, 8.22, -85.20) },
  { id: 'mg_p2', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-4.75, 8.79, -3.60) },
  { id: 'mg_s2', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(4.75, 8.79, -3.60) },
  { id: 'mg_p3', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-4.75, 8.71, -1.25) },
  { id: 'mg_s3', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(4.75, 8.71, -1.25) },
  { id: 'mg_p4', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-4.75, 8.71, 1.10) },
  { id: 'mg_s4', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(4.75, 8.71, 1.10) },
  { id: 'mg_p5', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(-4.75, 8.66, 4.00) },
  { id: 'mg_s5', tier: 'mg', calibreMm: 20, guns: 1,
    position: new Vector3(4.75, 8.66, 4.00) },
]

/** USS Wichita CA-45 併區（8 區）。 */
export const WICHITA_AA_ZONES: readonly ShipAAZone[] = [
  { id: 'flak_p', tier: 'flak', calibreMm: 127, guns: 1, mountsInZone: 4,
    representative: 'flak_p3', position: new Vector3(-5.30, 9.72, 31.20) },
  { id: 'flak_s', tier: 'flak', calibreMm: 127, guns: 1, mountsInZone: 4,
    representative: 'flak_s3', position: new Vector3(5.30, 9.72, 31.20) },
  { id: 'autocannon_p', tier: 'autocannon', calibreMm: 40, guns: 4, mountsInZone: 1,
    representative: 'autocannon_p1', position: new Vector3(-6.30, 11.68, -12.20) },
  { id: 'autocannon_s', tier: 'autocannon', calibreMm: 40, guns: 4, mountsInZone: 1,
    representative: 'autocannon_s1', position: new Vector3(6.30, 11.68, -12.20) },
  { id: 'mg_pf', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 1,
    representative: 'mg_p1', position: new Vector3(-1.50, 8.22, -85.20) },
  { id: 'mg_pa', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 4,
    representative: 'mg_p4', position: new Vector3(-4.75, 8.71, 1.10) },
  { id: 'mg_sf', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 1,
    representative: 'mg_s1', position: new Vector3(1.50, 8.22, -85.20) },
  { id: 'mg_sa', tier: 'mg', calibreMm: 20, guns: 1, mountsInZone: 4,
    representative: 'mg_s4', position: new Vector3(4.75, 8.71, 1.10) },
]

export const SHIP_AA: Readonly<Record<string, readonly ShipEmplacement[]>> = {
  essex: ESSEX_AA,
  fletcher: FLETCHER_AA,
  wichita: WICHITA_AA,
}

/** 接進遊戲用這一份。 */
export const SHIP_AA_ZONES: Readonly<Record<string, readonly ShipAAZone[]>> = {
  essex: ESSEX_AA_ZONES,
  fletcher: FLETCHER_AA_ZONES,
  wichita: WICHITA_AA_ZONES,
}
