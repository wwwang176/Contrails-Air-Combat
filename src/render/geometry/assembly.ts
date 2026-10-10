import type { Group, Vector3 } from 'three'

/** 從模型量出來的尺寸讀數。 */
export interface HullMetrics {
  /** 真機全長（含整流罩），m。機庫拿它跟模型包圍盒對照。 */
  realLength: number
  /** 機首尖端在**機體座標**的 Z（已含重心位移）。 */
  noseZ: number
}

export interface AircraftModel {
  group: Group
  metrics: HullMetrics
  /** 機首視角的眼點，**機體座標**（已含重心位移）。見 `GlbAircraft.eyePoint` */
  eyePoint: Vector3
  /** **右**翼尖，**機體座標**（已含重心位移）。左翼取 −x。見 `GlbAircraft.wingTip` */
  wingTip: Vector3
  /** 投彈瞄具的眼點，**機體座標**。**`null` = 這一台掛不了彈。**見 `GlbAircraft.bombPoint` */
  bombPoint: Vector3 | null
  /**
   * 每一具引擎的位置，**機體座標**。單發機一個、四發機四個，順序即
   * `props` 的順序。
   *
   * 【取的是槳轂】引擎本體在整流罩裡，模型上標得出來的只有槳轂 —— 差幾十
   * 公分，對一團火來說沒有分別。殘骸的燃燒（`render/wrecks.ts`）長在這裡。
   */
  enginePoints: readonly Vector3[]
  /**
   * rotation 為槳轂的累積弧度；blurred 為 true 時切換為殘影圓盤。
   * throttle（0–1，省略 = 1）是這一架的油門：殘影轉速照它等比例（`render/propBlur.ts` 的 `propBlurRate`）
   */
  setPropSpin(rotation: number, blurred: boolean, throttle?: number): void
  dispose(): void
}

/**
 * 模糊圓盤的繪製順序。**要比所有其他透明物件都晚畫。**
 *
 * 【為什麼只關 `depthWrite` 還不夠】關掉之後遮擋不再是「把後面的東西丟掉」
 * 而是「混合」，但混合的先後仍然由 three 的**逐物件**排序決定 —— 而曳光彈
 * 整批是一個 `InstancedMesh`，它的排序深度取的是**世界原點**，與子彈實際
 * 飛在哪裡無關。同一時刻必然有些子彈在圓盤前、有些在後，一個 draw call
 * 不可能同時排對，所以「把順序排正確」這個選項根本不存在。
 *
 * 於是選一個對常見情形正確的固定順序：子彈**在圓盤後方**時，圓盤最後畫、
 * 22% 混合上去，那正是應該看到的樣子。代價是「子彈在圓盤與相機之間」時
 * 會被蓋上 22% 的顏色 —— 少見，而且不刺眼。
 *
 * 【為什麼是 10】任何正數都可以（全專案只有天空球設過 renderOrder，而它是
 * −1000）。取 10 是留位子給日後可能插進來的東西。
 */
export const PROP_DISC_RENDER_ORDER = 10
