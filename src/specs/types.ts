import type { HitBox } from '../world/hit'
import type { Battery } from '../weapons/types'

export interface AircraftSpec {
  id: string
  name: string
  faction: 'allied' | 'axis'

  /** 戰鬥重量，kg */
  mass: number
  /** 機體軸慣量，kg·m²。pitch = Ixx、yaw = Iyy、roll = Izz */
  inertia: { pitch: number; yaw: number; roll: number }

  wing: {
    /** m² */
    area: number
    /** m */
    span: number
    /** 平均氣動弦長，m */
    chord: number
    /** Oswald 效率因子 */
    oswald: number
  }

  lift: {
    /** 升力線斜率，/rad */
    clAlpha: number
    /** 零升迎角，rad（有彎度翼型為負） */
    alphaZero: number
    /** 失速迎角，rad */
    alphaCrit: number
    /** 失速後 CL 崩塌的過渡寬度，rad */
    stallBlend: number
    /** 崩塌終點的 CL 相對於 CL_max 的比例 */
    postStallFactor: number
    /** 前緣縫翼展開時 alphaCrit 的增量，rad。無縫翼為 0 */
    slatAlphaBonus: number
    /** 縫翼展開迎角，rad */
    slatDeployAlpha: number
    /** 縫翼收回迎角，rad（小於展開值，形成遲滯） */
    slatRetractAlpha: number
  }

  drag: {
    /** 零升阻力係數 */
    cd0: number
    /** 側滑阻力係數，/rad² */
    cdBeta: number
    /** 臨界馬赫數 */
    machCrit: number
    /** 超過臨界馬赫後 cd0 的上升強度 */
    machDragFactor: number
  }

  side: {
    /** 側力係數，/rad。負值代表正側滑產生向左的力 */
    cyBeta: number
  }

  /** 力矩係數與穩定導數，全部以標準氣動軸定義 */
  moments: {
    cm0: number
    cmAlpha: number
    cmQ: number
    cmDe: number
    clBeta: number
    clP: number
    /** 全偏轉（δa = 1）時的滾轉力矩係數 */
    clDa: number
    cnBeta: number
    cnR: number
    cnDr: number
  }
  // 操縱導數符號約定（與教科書的 δ 正負相反，此處以「玩家意圖」為正）：
  //   aileron  +1 = 向右滾轉  → clDa 為正
  //   elevator +1 = 機首上仰  → cmDe 為正
  //   rudder   +1 = 機首右偏  → cnDr 為正

  /** 高速舵面變重：δ_eff = δ × min(1, (qRef/q)^k) */
  controlStiffening: {
    /** 參考動壓，Pa。低於此值舵面權限為滿 */
    qRef: number
    aileronK: number
    elevatorK: number
    rudderK: number
  }

  engine: {
    /** 增壓器檔位。功率為 WEP 值（throttle = 1.1），單位 W */
    gears: readonly { powerSeaLevel: number; powerCritical: number; altCritical: number }[]
    /** 進氣衝壓恢復效率，0..1。見 Spec 修訂 2 */
    ramEfficiency: number
  }

  prop: {
    /** m */
    diameter: number
    etaMax: number
    /** 螺旋槳效率曲線的特徵速度，m/s */
    vRef: number
    /** 靜推力相對於動量理論理想值的比例 */
    figureOfMerit: number
  }

  limits: {
    gPositive: number
    gNegative: number
    /** 不可超越速度，m/s IAS */
    vne: number
  }

  /**
   * 結構強度，HP。實際扣血 = 單發傷害 × 部位倍率（見 world/hit.ts）。
   * spec §6.3：戰鬥機一律 1000。
   */
  hp: number

  /**
   * 命中盒，**機體座標**。六個部位各一，數值取自 M1 量出來的機身資料。
   *
   * 【為什麼放在這裡而不是 weapons/】它描述的是**機體**不是武器——與翼展、
   * 重量、慣量是同一類東西，所以跟 AircraftSpec 一起走。型別放在消費它的
   * world/hit.ts。
   */
  hitBoxes: readonly HitBox[]

  /** 機載武裝。資料在 src/weapons/，這裡只是把它掛上機體。 */
  battery: Battery
}

/** 史實性能參考值，供 L2 測試斷言。全部為 SI 單位。 */
export interface HistoricalReference {
  /** 臨界高度的極速 */
  vmaxAtCritical: { speed: number; altitude: number }
  /** 海平面極速，m/s */
  vmaxSeaLevel: number
  /** 海平面爬升率，m/s */
  climbRateSeaLevel: number
  /** 乾淨構型失速速度，m/s */
  stallSpeed: number
  /** 實用升限，m */
  serviceCeiling: number
  /** 史實 CL_max，供推導值的合理性檢查（±8%） */
  clMax: number
}

/**
 * 推導 CL_max。見 Spec 修訂 1：CL_max 不是獨立參數，
 * 而是由升力線斜率與失速迎角推導，確保 CL 曲線在失速點連續。
 */
export function derivedClMax(spec: AircraftSpec, slatsDeployed: boolean): number {
  const alphaCrit = spec.lift.alphaCrit + (slatsDeployed ? spec.lift.slatAlphaBonus : 0)
  return spec.lift.clAlpha * (alphaCrit - spec.lift.alphaZero)
}
