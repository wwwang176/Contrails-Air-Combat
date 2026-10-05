import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../aircraft/Aircraft'
import { maxLevelSpeed } from '../analysis/envelope'
import { STATION_OFFSETS, stationPoint } from '../ai/station'
import type { Controller } from '../control/Controller'
import { atmosphere } from '../physics/atmosphere'
import type { AirData } from '../physics/types'
import { applyFeel, feelFor, type FeelKind } from '../specs/feel'
import type { AircraftSpec } from '../specs/types'
import type { World, Combatant, Team } from '../world/World'
import { STATION_REFERENCE } from './flights'
import type { FlightPlan } from './order'
import type { BattleConfig } from './setup'

/** 生成只讀出生幾何與手感設定，不需要任務、UI 或戰果狀態。 */
type SpawnConfig = Pick<BattleConfig,
  'altitude' | 'tas' | 'entryRange' | 'schwarmSpacing' | 'lateralOffset' | 'altitudeSpread' | 'feels'>

const UP = new Vector3(0, 1, 0)
const FWD = new Vector3(0, 0, -1)
const SPAWN = new Vector3()

/**
 * 高度散布：把**分隊**序號映到 [−1, 1] 的鋸齒。
 *
 * 【M6 起單位是分隊而不是單架】分隊**內部**的高度差由站位偏置給
 * （`STATION_OFFSETS` 的 `up`）。兩者都作用在單架上的話，會互相打架 ——
 * 生成把它推上去、站位控制器又把它拉回來。
 *
 * 【為什麼不是亂數】M5 spec §3.1 條件 7 要求決定性 —— 同一組設定跑兩次要
 * 逐幀一致。亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉決定性。
 *
 * 【週期取 5】剛好是每隊的分隊數，五個分隊落在五個不同的高度層。
 */
function altitudeOffset(flight: number, spread: number): number {
  const cycle = flight % 5
  return ((cycle / 4) * 2 - 1) * spread
}

/**
 * 轟炸機的開局速度取自己最大平飛的這個比例。
 *
 * 【為什麼轟炸機不能用 `BattleConfig.tas`】那是**一個絕對速度套在每一架
 * 上**，而 200 m/s（720 km/h）是照戰鬥機訂的：對三台戰鬥機是它們最大平飛
 * 的 108–122%，也就是「一小筆開局能量存款，開頭三十秒花掉」。同一個絕對值
 * 對轟炸機是 169%（He 111）與 162%（B-17G），而且**超過它們的結構限速**
 * 20% 與 47%。
 *
 * 代價不在極速上，在滾轉：`controlStiffening.aileronK` 讓兩台轟炸機的滾轉率
 * 過了峰值就往下掉（He 111 的峰值在 340 km/h），而 720 遠在下坡側。
 * 四種開局定值下滾 90° 要幾秒，4,000 m：
 *
 * ```
 *                全域 200 m/s   夾 vne   0.80×最大平飛
 *   He 111 H-6      12.0 s       7.5 s       2.2 s
 *   B-17G           37.7 s       8.7 s       3.0 s
 *   三台戰鬥機    0.6–1.7 s     同左        0.7–1.0 s
 * ```
 *
 * 【0.80 的來歷】戰時的巡航速度大致是最大平飛的七到八成，而開局在做的事
 * 就是巡航接敵。它**不是**任何一種「最佳速度」—— 最大平飛的剩餘功率恰好
 * 為零（開局只能減速）、角落速度是已經在纏鬥時的速度、最佳爬升只有
 * 238–246 km/h（等於取消接近段）。0.80 落在 He 111 342 / B-17G 355 km/h。
 *
 * 【為什麼戰鬥機不套這條】套下去是 0.80 × 665 = 532 km/h，開局能量存款就
 * 沒了，而 AI 的能量判準（`steer.ts` 的 `brakeCornerRatio` 那一組）是照
 * 720 km/h 的開局調的。要改那一項得連同那一組門檻一起重新掃描。
 */
export const BOMBER_CRUISE = 0.80

/**
 * 開局空速對 `vne` 的上限比，以 IAS 計。
 *
 * 【為什麼是 0.8】HUD 的 OVERSPEED 在 0.85 亮起、紅線因子也從 0.85 開始把
 * 操縱面變重（`physics/aero.ts` 的 `REDLINE_KNEE`）。留 5% 是給開場推油門
 * 與淺俯衝的餘裕 —— 貼著 0.85 生出來的話，第一秒就在警告裡。
 */
export const OPENING_VNE_FRACTION = 0.8

/** `openingTas` 查大氣用的暫存。出生不是熱路徑，但也不必每架配一份 */
const OPENING_AIR: AirData = { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 }

/**
 * 一架飛機的開局／重生真空速，m/s。
 *
 * 兩條規則，第二條蓋過第一條：
 *
 * 1. **IAS 不得超過 `vne` 的 `OPENING_VNE_FRACTION`。** `vne` 是 IAS
 *    （`specs/types.ts`），開局速度是 TAS，所以要除以 √σ 換算 —— 直接拿
 *    `vne` 夾 TAS 的話，低空的 IAS 幾乎貼著 vne，開場就 OVERSPEED。這條
 *    咬得到誰看高度與機種：A6M5 的 vne 是 145 m/s，在任何高度都被夾住；
 *    P-51D 與 K-4 在 4,000 m 以上不受影響，開局仍是 `DEFAULT_BATTLE.tas`。
 * 2. **轟炸機用自己的巡航速度**（見 `BOMBER_CRUISE`），不是那個照戰鬥機
 *    訂的絕對值。
 *
 * @param nominal  `cfg.tas × entry.speed` —— 戰鬥機仍然拿這個值
 * @param cruise   轟炸機的巡航速度，由呼叫端查表（`maxLevelSpeed` 是搜尋，
 *                 同機種只該算一次）
 * @param altitude 出生高度，決定 IAS 與 TAS 的換算
 */
export function openingTas(
  spec: AircraftSpec, nominal: number, cruise: number, altitude: number,
): number {
  const want = spec.role === 'bomber' ? cruise : nominal
  const sigma = atmosphere(altitude, OPENING_AIR).sigma
  return Math.min(want, (OPENING_VNE_FRACTION * spec.limits.vne) / Math.sqrt(sigma))
}

/**
 * 一個小隊的進場幾何。**逐小隊算一次**，同隊的每一架共用。
 *
 * 【為什麼要抽出來】`createBattle` 與 `reinforce` 都要算它。兩份長得很像的
 * 幾何就是只有一份會被修好的那種危險。
 */
export interface UnitFrame {
  /** 沿 Z 的出生位置，m */
  readonly z: number
  readonly orientation: Quaternion
  /** 機首方向的單位向量。速率逐架乘 */
  readonly heading: Vector3
  /** `cfg.tas × entry.speed` —— 戰鬥機的開局速度 */
  readonly nominalTas: number
  readonly leadX: number
  readonly leadY: number
}

export function unitFrame(cfg: SpawnConfig, unit: FlightPlan): UnitFrame {
  const entry = unit.entry
  // 【`along`／`across` 是係數、`gap` 是絕對公尺】理由見 `SideEntry`：
  // 探針靠覆寫 `entryRange`／`lateralOffset` 換場景，寫死絕對座標會讓
  // 那些覆寫靜靜失效
  // 【縱深是絕對公尺】見 `FlightPlan.depth`。省略時逐位元與舊行為相同
  const z = entry.along * cfg.entryRange + entry.gap + (unit.depth ?? 0)
  const orientation = new Quaternion().setFromAxisAngle(UP, entry.heading)
  // 【方向逐小隊，速率逐架】速率由 `openingTas` 逐機種決定，而同一個
  // 分隊可以是混編的
  const heading = FWD.clone().applyQuaternion(orientation)
  // 【乘法的順序不能換】原式是
  // `(f − (n−1)/2) × schwarmSpacing + across × lateralOffset`，
  // 而 `lane` 就是那個括號裡的中間值。浮點加法不可交換，順序不能換。
  // 【`slide` 排在最後】省略時加的是 0，逐位元與舊行為相同
  const leadX = unit.lane * cfg.schwarmSpacing + entry.across * cfg.lateralOffset + (unit.slide ?? 0)
  // 【`rise` 排在最後】省略時加的是 0，逐位元與舊行為相同
  const leadY = cfg.altitude + entry.climb + altitudeOffset(unit.tier, cfg.altitudeSpread)
    + (unit.rise ?? 0)
  return { z, orientation, heading, nominalTas: cfg.tas * entry.speed, leadX, leadY }
}

/** `base spec → 套過手感的 spec`，每陣營一張。見 `createBattle` 的 `feeled` */
export type FeelCache = { readonly [T in Team]: Map<AircraftSpec, AircraftSpec> }

/**
 * 一個機種套過手感的規格，一側算一次、之後共用同一個物件（下游有依物件識別的快取）。
 * 任務卡的 `feels` 指名了哪一組就用哪一組，沒指名依角色挑（`feelFor`）。
 */
export function feeledSpec(
  cache: Map<AircraftSpec, AircraftSpec>, base: AircraftSpec, feels: Readonly<Record<string, FeelKind>> | undefined,
): AircraftSpec {
  let spec = cache.get(base)
  if (spec === undefined) {
    spec = applyFeel(base, feelFor(base, feels?.[base.id]))
    cache.set(base, spec)
  }
  return spec
}

/**
 * 造一架、加進世界，回傳它的座位。
 *
 * **`createBattle` 與 `reinforce` 共用的唯一一條生成路徑。** 複製一份的話，
 * 手感、開局速度、站位、朝向這四件事會有兩個實作，而只有一份會被修好。
 *
 * @param made 這個分隊**已經造好**的飛機，供 `stationPoint` 當參考機。
 *   呼叫端每一隊給一個新的陣列，這裡會把新造的那一架推進去。
 */
export function spawnMember(
  world: Pick<World, 'add'>, cfg: SpawnConfig, unit: FlightPlan, frame: UnitFrame, k: number,
  made: Aircraft[], feeled: FeelCache, cruises: Map<AircraftSpec, number>,
  controller: Controller,
): Combatant {
  const base = unit.members[k]!
  // 【手感係數在這裡套，不在 spec 檔裡】史實值必須原封不動，否則
  // `test/performance/historical.test.ts` 的整層斷言就失去意義（見
  // `specs/feel.ts`）。這裡是「史實的飛機」變成「玩起來的飛機」的唯一
  // 入口，而且**雙方一起套** —— 玩家與 AI 飛的是同一台。
  //
  // 【為什麼是 feelFor 而不是 GAME_FEEL】轟炸機另有一組（見
  // `specs/feel.ts` 的 `BOMBER_FEEL`）。寫死 `GAME_FEEL` 會把轟炸機當
  // 戰鬥機放大，爬升率變成史實的三倍。
  //
  // 【查表在內層】混編小隊裡兩種機各查各的
  const spec = feeledSpec(feeled[unit.team], base, cfg.feels)

  // 【開局速度逐機種】見 `openingTas`。巡航只有轟炸機用得到，而
  // `maxLevelSpeed` 是一次求根搜尋 —— 戰鬥機不必付這個錢。
  // 它要吃**套過手感的** spec：「玩起來的飛機飛多快」才是它維持得住的
  let cruise = 0
  if (base.role === 'bomber') {
    cruise = cruises.get(base) ?? maxLevelSpeed(spec, cfg.altitude) * BOMBER_CRUISE
    cruises.set(base, cruise)
  }
  // 【分隊內部直接由 stationPoint 生成】出生位置就是站位。兩份長得
  // 很像的幾何就是只有一份會被修好的那種危險 —— 與 `resetBattle`
  // 走 `World.respawn` 是同一個理由。
  //
  // 鏡射是自動的：`stationPoint` 由**參考機的速度方向**建座標框，
  // 而紅隊朝 +Z，所以 `across = +200` 在世界座標是 −X。
  placeMember(frame, k, made, SPAWN)

  // 排在出生點之後：IAS 的換算吃的是這一架真正的出生高度
  const tas = openingTas(base, frame.nominalTas, cruise, SPAWN.y)

  const aircraft = new Aircraft(spec, SPAWN.y, tas)
  aircraft.state.position.copy(SPAWN)
  aircraft.state.orientation.copy(frame.orientation)
  aircraft.state.velocity.copy(frame.heading).multiplyScalar(tas)
  aircraft.prevPosition.copy(aircraft.state.position)
  aircraft.prevOrientation.copy(frame.orientation)
  made.push(aircraft)

  const c = world.add(
    aircraft, controller, unit.team, aircraft.state.position.clone(), SPAWN.y, tas,
  )
  // 【一律不重生】一方全滅要能被偵測到，重生會讓那件事永遠不發生
  c.respawnOnDestroy = false
  return c
}

/**
 * 第 `k` 席的出生點。長機在座標框的長機點，其餘由站位幾何從參考機推。
 *
 * **`spawnMember` 與 `reviveFlight` 共用**：出生位置就是站位，兩份幾何就是
 * 只有一份會被修好的那種危險。
 *
 * @param made 這一隊已經擺好的飛機，`STATION_REFERENCE[k]` 索引它
 */
export function placeMember(
  frame: UnitFrame, k: number, made: readonly Aircraft[], out: Vector3,
): void {
  const ref = STATION_REFERENCE[k]!
  if (ref < 0) out.set(frame.leadX, frame.leadY, frame.z)
  else stationPoint(made[ref]!, STATION_OFFSETS[k]!, 0, out)
}
