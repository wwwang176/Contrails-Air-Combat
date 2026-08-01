import type { Quaternion } from 'three'
import { G0 } from '../core/math'
import { makeScratch } from '../core/pool'
import { liftCoefficient } from '../physics/aero'
import type { AircraftSpec } from '../specs/types'
import type { AeroState } from '../physics/types'

const S = makeScratch(1, 1)

/** 飛行員持續耐 G 上限。超過此值畫面開始漸暗（黑視）。 */
export const PILOT_G_POSITIVE = 6.5
// 【Task 17 尚未消費】brief 要求此常數存在，但目前沒有任何負 G 限制
// 邏輯讀取它（正俯仰率限制只處理正過載）。保留匯出供 Task 18 的負 G／
// 倒飛限制與黑視／紅視系統消費；在那之前它是「已宣告、未使用」的合法
// 狀態，不是遺漏——mutation 測試（−3 → −6 仍 22/22 綠）已確認目前沒有
// 任何斷言覆蓋它，Task 18 引入負 G 邏輯時必須補上對應測試。
export const PILOT_G_NEGATIVE = -3
/** 迎角指令相對於失速迎角的餘裕比例。 */
export const ALPHA_MARGIN = 0.95
/**
 * qMax 的地板值，rad/s。倒飛或大俯仰姿態下 n_limit − gLoad 可能落到
 * 零或負值；沒有地板會讓限制器完全鎖死俯仰權限甚至指令反向角速度，
 * 這在物理上不合理（飛行員在任何姿態下都應保有最小操縱權限）。
 * 0.01 rad/s（≈0.57°/s）遠低於正常操作範圍觀測到的 0.03~0.53 rad/s，
 * 因此只在極端姿態（倒飛、大迎角爬升）或恰好貼著失速邊緣的低速
 * 平飛才會被夾到，不會偽裝成一個真實可用的俯仰率。
 */
export const QMAX_FLOOR = 0.01

export type LimiterSource = 'alpha' | 'structure' | 'pilot' | 'none'

export interface PitchLimit {
  /** 期望俯仰率上限，rad/s */
  qMax: number
  /** 實際採用的過載上限 */
  nLimit: number
  /** 純氣動可達的過載（未計結構與飛行員限制） */
  nAero: number
  source: LimiterSource
}

export function createPitchLimit(): PitchLimit {
  return { qMax: 0, nLimit: 1, nAero: 1, source: 'none' }
}

/**
 * 由機體姿態四元數計算 gLoad = cosγ·cosφ——重力沿機體 Y（座艙上方）軸
 * 的分量，除以 G0 的無因次值。正立平飛 gLoad=1（重力已提供 1G 的向心
 * 分量，舵面只需再拉出 n−1 個 G）；90° 坡度轉彎或垂直爬升 gLoad=0；
 * 倒飛 gLoad=−1（重力反向幫倒忙，需要拉出 n+1 個 G）。
 *
 * 熱路徑零配置：使用模組私有 scratch（不可與其他模組共用），只回傳純量。
 */
export function gLoadFromOrientation(orientation: Quaternion): number {
  const invQ = S.q[0]!.copy(orientation).invert()
  const gravityBody = S.v[0]!.set(0, -G0, 0).applyQuaternion(invQ)
  return -gravityBody.y / G0
}

/**
 * 計算期望俯仰率上限。
 *
 * 限制作用在「期望角速度」而非舵面上——指揮儀只負責
 * 不要求飛機做做不到的事，物理層永遠是唯一的真相。
 *
 * 注意本函數只擋失速，不擋能量流失：高速大 G 時
 * 限制器完全不介入，玩家可盡情拉 G 並承受速度暴跌。
 *
 * 【簽名修正】brief 原稿在 spec 與 aero 之間多帶一個 air: AirData 參數，
 * 但函式本體從未讀取它——tsc 的 noUnusedParameters 抓到了這點。
 * 追查後確認這不是「忘記用」，而是參數本身多餘：nAero 只需要
 * qbar·S·CL/(m·g)，而 qbar 早已由呼叫端的 computeAeroState 用 air.density
 * 算進 aero.qbar 裡；本模組目前也沒有任何馬赫相依的 CL 模型會用到
 * air.soundSpeed（liftCoefficient 完全不吃 mach，只有 dragCoefficient
 * 才用，且那是阻力不是升力）。這與 aeroForceMoment 的既有模式一致——
 * 它同樣只吃 aero 不吃 air（Task 10 曾在該函式發現一模一樣的多餘
 * AirData 參數，當時的結論是整個移除，不是改名忽略）。因此這裡採同一
 * 結論：直接從簽名移除 air，而非用底線遮蓋編譯錯誤。若未來任務需要
 * 隨高度／密度變化的失速模型（例如壓縮性對 CL_max 的影響），屆時
 * 應該加回 aero.mach（AeroState 已有）而非重新引入整個 AirData。
 *
 * 【公式修正：加回重力支持項】brief 原稿用 qMax = n_limit·g/V，等同
 * 假設穩態轉彎不需要重力幫忙——但正確的準穩態關係是
 * n = qV/g + cosγ·cosφ，重力沿機體 Y 軸的分量（gLoad）本來就先
 * 頂掉一部分向心力，舵面只需要再拉出 (n − gLoad) 這麼多。
 * 原公式在正立平飛（gLoad=1）時等於整整多要求 1G 的俯仰率，
 * 且誤差在 n_limit 小的低速氣動限制段最嚴重（協調者以 stepDynamics
 * 模擬驗證：V0=70 m/s 時原公式使 α 衝破 α_crit 達 14°~28°，是真正
 * 的失速保護失效，見 task-17-report.md「臨界修正」章節）。
 * gLoad 由呼叫端經 gLoadFromOrientation() 從姿態四元數算出並傳入，
 * 而非在此函式內部假設飛行姿態。
 */
export function pitchRateLimit(
  spec: AircraftSpec,
  aero: AeroState,
  slatsDeployed: boolean,
  gLoad: number,
  out: PitchLimit,
): PitchLimit {
  const clAtMargin = liftCoefficient(
    spec,
    spec.lift.alphaCrit * ALPHA_MARGIN + (slatsDeployed ? spec.lift.slatAlphaBonus : 0),
    slatsDeployed,
  )
  const nAero = (aero.qbar * spec.wing.area * clAtMargin) / (spec.mass * G0)
  out.nAero = nAero

  let nLimit = nAero
  let source: LimiterSource = 'alpha'
  // 【結構分支目前對出貨機隊不可達】P-51D gPositive=8、Bf109 G-6=7.5，
  // 兩者皆高於 PILOT_G_POSITIVE=6.5，所以 nLimit 在觸及結構極限前
  // 必定已先被飛行員上限夾住，source==='structure' 對這兩款機體
  // 實際上永遠不會發生（下方 :37-43 一帶的測試目前是靠飛行員上限
  // 通過，不是靠這個分支）。保留此分支是因為未來機體（例如結構更
  // 脆弱、飛行員耐力設定更高的載具）可能讓它成為真正的限制來源。
  if (spec.limits.gPositive < nLimit) {
    nLimit = spec.limits.gPositive
    source = 'structure'
  }
  if (PILOT_G_POSITIVE < nLimit) {
    nLimit = PILOT_G_POSITIVE
    source = 'pilot'
  }

  out.nLimit = Math.max(nLimit, 0)
  out.source = source
  // qMax = g·(n_limit − gLoad)/V —— 見上方函式注釋的公式修正說明。
  if (aero.tas > 1) {
    const raw = (G0 * (out.nLimit - gLoad)) / aero.tas
    out.qMax = raw > QMAX_FLOOR ? raw : QMAX_FLOOR
  } else {
    out.qMax = 0
  }
  return out
}
