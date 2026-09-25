import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { World } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { AiController } from '../../src/ai/AiController'
import { buildEngageBasis, createEngageBasis, type EngageBasis } from '../../src/ai/steer'
import { createTargetBoard } from '../../src/ai/target'
import { alarmFactor, threatFactor } from '../../src/ai/assess'
import { VETERAN } from '../../src/ai/profile'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { P51D } from '../../src/specs/p51d'
import { RAD } from '../../src/core/math'
import { createCommand, type Command, type Controller } from '../../src/control/Controller'
import type { AircraftSpec } from '../../src/specs/types'
import type { Battery } from '../../src/weapons/types'

/**
 * # 閃躲觸發與預瞄點的合約
 *
 * 全部是 O(1) 的幾何合約，不跑戰鬥場景：
 *
 * - **手電筒觀測儀**：一架沿等速直線移動、機首永遠指著目標彈道預瞄點的
 *   觀測機。驗 `alarmFactor` / `threatFactor` 的距離閘門、「瞄預瞄點 vs
 *   瞄本體」對 `defend` 門檻的差別，以及 `AiController` 確實靠
 *   `alarmFactor` 進入 `defend` 並認得威脅來源。
 * - **預測誤差**：「一秒前外推的預瞄方向」與「實際預瞄方向」的夾角。驗這把
 *   尺的零點（等速直線恆為 0），以及水平收速、往上拉起兩種偏移量得到。
 *   兩者都走產線的 `buildEngageBasis` 彈道解。
 */

const DT = 1 / 240
const ALT = 4000
const TAS = 200
const FWD = new Vector3(0, 0, -1)

function harmless(b: Battery): Battery {
  return { ...b, mounts: b.mounts.map((m) => ({ ...m, weapon: { ...m.weapon, damage: 0 } })) }
}
const BLUNT: AircraftSpec = { ...P51D, battery: harmless(P51D.battery) }

/**
 * 腳本飛機：固定角速度的慵懶水平盤旋，永不開火。
 *
 * 接線測試只拿它佔住世界裡的座位（不跑 `world.step`），受測的 `AiController`
 * 另外手動餵決策。
 */
class Lazy implements Controller {
  private t = 0
  update(_self: Aircraft, dt: number, out: Command): void {
    this.t += dt
    const h = 0.05 * this.t
    out.aimWorld.set(-Math.sin(h), 0, -Math.cos(h))
    out.throttle = 0.85
    out.brake = 0
    out.firing = false
  }
}

// ══ 手電筒觀測儀 ═══════════════════════════════════════════

/** 觀測儀的等速直線軌跡 —— 兩個參數就定義了它的一生 */
interface LampTrack {
  /** 起點（世界座標） */
  start: Vector3
  /** 恆定速度。位置 = `start + vel × elapsed`，與被觀測者無關 */
  vel: Vector3
}

/**
 * 把觀測儀放到軌跡上 `elapsed` 秒處，機首指向對 `prey` 的**彈道預瞄點**，
 * 並把那個方向寫進 `outDir` 回傳。
 *
 * 【位置只由軌跡決定，**絕對不參考 `prey` 的當下位置**】黏在目標身上的話，
 * 從它指向目標的向量恆等於 −offset、是個常數 —— 預瞄方向一格都不會動，
 * 任何以它為準的量測都恆為 0，看起來像一致的結果，實際是假綠。
 * **自由的是轉動，不是位置。**
 *
 * 【先算預瞄點、再擺機首 —— 順序反了就是另一個致命缺陷】`alarmFactor`
 * 比的是「機首 vs **彈道預瞄方向**」，不是「機首 vs 目標」（見 `assess.ts`
 * 的 `alarmFactor`）。指著目標本體的話，橫向相對速度 200 m/s 就產生 12.7°
 * 的提前角，而 `defend` 的門檻只有 9.75°（`ALARM_CONE` 15° ×
 * (1 − `threatEnter` 0.35)）—— **AI 閃得越用力，手電筒越照不到它**。
 * 而且警戒斜坡（`ALARM_SATURATION` = 0.5 s）一歸零就要重來，等於閃躲
 * 本身把威脅關掉了。
 *
 * 指著預瞄點則讓 `alarmFactor` 在**建構上**恆等於 1（同樣的 `solveLead`、
 * 同樣的輸入），那道閘門於是退化成純粹的彈道有效性：解存在，且飛行時間
 * ≤ `PROJECTILE_LIFETIME`。那才是「玩家的預瞄環真的套在它身上」。
 *
 * 【`buildEngageBasis` 在這裡不吃姿態】`leadPoint` 只由雙方的位置與速度
 * 決定。姿態只影響 `losAxis` 的退化退路與 `verticalAxis`，兩者本函數都
 * 不用 —— 所以「用上一格的姿態算這一格的預瞄點」沒有循環。量測值因此與
 * 觀測儀的姿態無關；姿態存在的唯一理由是讓 AI 感覺被瞄準。
 *
 * 【`angularVelocity` 要清零】位置被外部改寫之後它是垃圾值，而物理是直接
 * 累積 `state.angularVelocity`（不是從 `prevOrientation` 反推）。
 */
function advanceLamp(
  lamp: Aircraft,
  prey: Aircraft,
  track: LampTrack,
  elapsed: number,
  basis: EngageBasis,
  outDir: Vector3,
): Vector3 {
  lamp.state.position.copy(track.start).addScaledVector(track.vel, elapsed)
  lamp.state.velocity.copy(track.vel)
  lamp.state.angularVelocity.set(0, 0, 0)

  buildEngageBasis(lamp, prey, basis)
  outDir.copy(basis.leadPoint).normalize()
  lamp.state.orientation.setFromUnitVectors(FWD, outDir)

  lamp.prevPosition.copy(lamp.state.position)
  lamp.prevOrientation.copy(lamp.state.orientation)
  return outDir
}

describe('手電筒觀測儀的合約（O(1)，不跑場景）', () => {
  /** 造一架擺在指定位置、機首指向 look 的飛機 */
  const at = (pos: Vector3, look: Vector3, vel: Vector3): Aircraft => {
    const a = new Aircraft(BLUNT, ALT, TAS)
    a.state.position.copy(pos)
    a.state.velocity.copy(vel)
    a.state.orientation.setFromUnitVectors(FWD, look)
    a.prevPosition.copy(pos)
    a.prevOrientation.copy(a.state.orientation)
    return a
  }

  /**
   * 【一】800 m 精準瞄準時，觸發閃躲的是 `alarmFactor` 而不是 `threatFactor`。
   *
   * `threatFactor` 有距離因子，800 m 時只有 1 − 800/900 ≈ 0.111，遠低於
   * `threatEnter`（0.35）；`alarmFactor` 沒有距離因子，所以 800 m 被精準
   * 瞄準仍然滿值。這一條紅了，代表被人從 800 m 瞄著時 AI 不會閃。
   */
  it('800 m 精準瞄準：alarmFactor 滿值，threatFactor 遠低於門檻', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(lamp, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(lamp, prey)).toBeCloseTo(1, 6)
    expect(threatFactor(lamp, prey)).toBeLessThan(DEFAULT_RULES.threatEnter)
  })

  /** 【二】彈丸壽命是 `alarmFactor` 唯一的距離閘門。1200 m 在壽命外，過不了。 */
  it('彈丸壽命是唯一的距離閘門', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 1200), vel: new Vector3(0, 0, -TAS) }
    const far = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(far, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(far, prey)).toBe(0)
  })

  /**
   * 【二之二 —— 排除固定截斷】1000 m 仍然要有值。
   *
   * 只驗「800 過、1200 不過」的話，一個把 `THREAT_RANGE`（900）或任何
   * 900~1000 的固定截斷加進 `alarmFactor` 的實作照樣全綠。1000 m 在
   * 彈丸壽命內（1.2 s × 887 m/s ≈ 1064 m）卻在 900 m 外，正好把兩者分開。
   */
  it('900 m 外、彈丸壽命內：仍然有警戒', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 1000), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(lamp, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(lamp, prey)).toBeGreaterThan(0)
    expect(threatFactor(lamp, prey)).toBe(0)
  })

  /**
   * 【三 —— 「瞄準敵機」那個歧義的守門員】機首要指**預瞄點**，不是目標本體。
   *
   * `alarmFactor` 比的是「機首 vs 彈道預瞄方向」。橫向相對速度 200 m/s 對
   * 887 m/s 的機砲產生 atan(200 × 0.9 / 800) ≈ 12.7° 的提前角，而 `defend`
   * 的門檻只有 `ALARM_CONE` × (1 − `threatEnter`) = 15° × 0.65 = 9.75°。
   *
   * 也就是說：指著目標本體的手電筒，**在 AI 開始橫向閃躲的那一刻就失去了
   * 觸發 defend 的資格** —— 閃得越用力越量不到，是最壞的一種選樣偏差。
   *
   * 這一條同時證明「瞄預瞄點」不是風格選擇，而是這條路唯一能走的走法。
   */
  it('橫向閃躲時：瞄目標本體會掉出 defend 門檻，瞄預瞄點不會', () => {
    // 目標帶 200 m/s 的橫向速度 —— 這就是「正在往旁邊閃」
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(200, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 正確：advanceLamp 指向預瞄點 —— 在建構上滿值
    advanceLamp(lamp, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(lamp, prey)).toBeCloseTo(1, 6)

    // 對照：指向目標本體
    const los = new Vector3().subVectors(prey.state.position, lamp.state.position).normalize()
    lamp.state.orientation.setFromUnitVectors(FWD, los)
    const atBody = alarmFactor(lamp, prey)
    expect(atBody).toBeGreaterThan(0)                        // 還在 15° 錐內
    expect(atBody).toBeLessThan(DEFAULT_RULES.threatEnter)   // 但不足以觸發 defend
  })

  /**
   * 【四 —— 「黏在目標身上」的守門員】觀測儀必須有自己獨立的軌跡。
   *
   * 若位置永遠是「目標當下位置 + 固定位移」，從它指向目標的向量恆等於
   * −位移，是個常數 —— 預瞄方向一格都不會動。
   *
   * 【這一條必須呼叫 `advanceLamp` 本人】手工擺兩個狀態的話，一個仍然
   * 黏著的實作照樣全綠。所以下面直接斷言 helper 產出
   * 的位置**等於軌跡公式**、且**不等於黏著公式**。
   */
  it('歸位函數不黏在目標身上：位置逐位元由軌跡決定', () => {
    const basis = createEngageBasis()
    const dir0 = new Vector3()
    const dir1 = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // t=0：同向並飛，觀測儀在正後方 800 m
    const prey0 = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    advanceLamp(lamp, prey0, track, 0, basis, dir0)
    expect(lamp.state.position.distanceTo(track.start)).toBeLessThan(1e-6)

    // t=1 秒：目標**轉了 90°**往 −X 飛，而且離開了原本的航跡
    const prey1 = at(new Vector3(-150, ALT, -150), new Vector3(-1, 0, 0), new Vector3(-TAS, 0, 0))
    advanceLamp(lamp, prey1, track, 1, basis, dir1)

    // 位置 = start + vel × 1，與目標做了什麼無關
    const onTrack = track.start.clone().addScaledVector(track.vel, 1)
    expect(lamp.state.position.distanceTo(onTrack)).toBeLessThan(1e-6)
    // 而且**不是**「目標當下位置 + 固定位移」—— 黏著版本會落在這裡
    const glued = prey1.state.position.clone().add(new Vector3(0, 0, 800))
    expect(lamp.state.position.distanceTo(glued)).toBeGreaterThan(100)
    // 目標轉了向，看過去的方向就必須改變
    expect(dir0.angleTo(dir1) * RAD).toBeGreaterThan(5)
  })

  /**
   * 【五 —— 接線】前四條都只驗純函數。這一條驗**產線真的走這條路**：
   * `AiController.scanThreat` 用 `alarmFactor` 掃全場、挑出手電筒當
   * `threatSource`，最後意圖變成 `defend`。
   *
   * 少了它，前四條可以全綠而 AI 被手電筒瞄著卻從不進 `defend`。
   *
   * 【不跑 `world.step`】幾何由手動維持，只餵決策 —— 480 次 `update`，
   * 仍然是毫秒級。警戒斜坡 `ALARM_SATURATION` = 0.5 s，2 秒綽綽有餘。
   *
   * 【遠處那一架紅隊的用途】沒有它的話 `threatSource === lamp` 是唯一解，
   * 證明不了「掃描真的在比較」。
   */
  it('接線：AI 靠 alarmFactor 進 defend，且認得是手電筒在瞄它', () => {
    const world = new World()
    const prey = new Aircraft(BLUNT, ALT, TAS)
    const lamp = new Aircraft(BLUNT, ALT, TAS)
    const far = new Aircraft(BLUNT, ALT, TAS)

    const preyPos = new Vector3(0, ALT, 0)
    const farPos = new Vector3(3000, ALT, 0)
    const vel = new Vector3(0, 0, -TAS)
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: vel.clone() }

    const pc = world.add(prey, new Lazy(), 'blue', preyPos, ALT, TAS)
    const lc = world.add(lamp, new Lazy(), 'red', track.start, ALT, TAS)
    const fc = world.add(far, new Lazy(), 'red', farPos, ALT, TAS)
    for (const c of [pc, lc, fc]) c.respawnOnDestroy = false

    const ai = new AiController()
    ai.board = createTargetBoard(world.combatants)
    ai.selfIndex = pc.index
    ai.profile = VETERAN

    const basis = createEngageBasis()
    const dir = new Vector3()
    const cmd = createCommand()
    for (let i = 0; i < 2 * 240; i++) {
      const t = i * DT
      // 手動維持幾何：受測方與遠處那架都等速直飛，間距因此恆定
      prey.state.position.copy(preyPos).addScaledVector(vel, t)
      prey.state.velocity.copy(vel)
      far.state.position.copy(farPos).addScaledVector(vel, t)
      far.state.velocity.copy(vel)
      advanceLamp(lamp, prey, track, t, basis, dir)
      ai.update(prey, DT, cmd)
    }

    expect(ai.threatSource).toBe(lamp)
    expect(ai.intent).toBe('defend')
  })
})

// ══ 預測誤差 ═══════════════════════════════════════════════

/**
 * 把一組位置與速度直線外推 `seconds` 秒，寫進 `ghost` 並回傳它。
 *
 * 【吃裸的位置速度】外推只需要這兩個；收 `Aircraft` 的話會把對方的其他
 * 實際狀態一起帶進預測。
 *
 * 【幽靈機只是資料載體】它不進世界、不受物理、不被任何人看見。存在的
 * 唯一理由是 `buildEngageBasis` 吃的是 `Aircraft`，而我們必須用**產線
 * 那一份**彈道解，不能自己重寫一個 `solveLead`。
 */
function predictAhead(
  pos: Vector3, vel: Vector3, seconds: number, ghost: Aircraft, look: Vector3,
): Aircraft {
  ghost.state.position.copy(pos).addScaledVector(vel, seconds)
  ghost.state.velocity.copy(vel)
  ghost.state.angularVelocity.set(0, 0, 0)
  // 【姿態取速度方向，不複製當下的 prey 姿態】前者與「它照這樣飛下去」
  // 自洽；後者會把**實際狀態**漏進預測裡，那正是這個量要排除的東西
  const speed = vel.length()
  if (speed > 1e-6) {
    ghost.state.orientation.setFromUnitVectors(FWD, look.copy(vel).divideScalar(speed))
  }
  ghost.prevPosition.copy(ghost.state.position)
  ghost.prevOrientation.copy(ghost.state.orientation)
  return ghost
}

/**
 * 從 `lamp` 的當下位置看出去，「實際的預瞄方向」與「預測的預瞄方向」
 * 差幾度。
 *
 * 【兩條都用同一個 `lamp`】差距因此純粹來自目標狀態的不同，不含觀測者
 * 自己的位移。
 *
 * 【比方向不比位置】玩家修正的是**準星的角度**，不是目標的公尺數。
 * 同樣 50 m 的偏移，在 300 m 與 900 m 對玩家的意義差三倍。
 */
function aimErrorDeg(
  lamp: Aircraft, actual: Aircraft, predicted: Aircraft,
  basis: EngageBasis, a: Vector3, b: Vector3,
): number {
  buildEngageBasis(lamp, actual, basis)
  a.copy(basis.leadPoint).normalize()
  buildEngageBasis(lamp, predicted, basis)
  b.copy(basis.leadPoint).normalize()
  return a.angleTo(b) * RAD
}

describe('預測誤差的合約（O(1)，不跑場景）', () => {
  /**
   * 【六 —— 零點】理想等速直線的目標，預測誤差恆為 0。這是代數上的
   * 零點，與方位無關。
   *
   * 【限定：理想】真實飛機受推力與阻力，速度大小不是嚴格常數，所以
   * **物理**直飛只能接近 0。這一條驗的是代數，不是物理。
   */
  it('理想等速直線的目標：預測誤差是 0', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 目標帶一個任意的斜向等速 —— 直線就好，不必與觀測儀同向
    const vel = new Vector3(60, -10, -TAS)
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(0, ALT, 0)
    prey.state.velocity.copy(vel)
    prey.state.orientation.setFromUnitVectors(FWD, vel.clone().normalize())

    // 一秒前的位置拿來外推，與「一秒後的實際狀態」比
    const pastPos = prey.state.position.clone().addScaledVector(vel, -1)

    advanceLamp(lamp, prey, track, 0, basis, new Vector3())
    expect(aimErrorDeg(lamp, prey, predictAhead(pastPos, vel, 1, ghost, look), basis, a, b))
      .toBeCloseTo(0, 6)
  })

  /**
   * 【七 —— 「角度變小也算閃」的守門員】
   *
   * 目標在一秒前是往 −X 橫飛的；一秒之內它**把橫向速度收掉**（拉回同向）。
   * 從觀測者看過去，預瞄點跑的**距離變短了** —— 只看預瞄點移動量的話會判成
   * 「動得比較少 = 沒在閃」。預測誤差比的是落點，而落點差很多。
   */
  it('角度變小也是閃躲：預測誤差抓得到', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    // 一秒前：往 −X 橫飛
    const pastPos = new Vector3(0, ALT, 0)
    const pastVel = new Vector3(-150, 0, -TAS)
    // 一秒後的實際：橫向收掉了，所以位置落在「繼續橫飛」的右邊
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(-40, ALT, -TAS)
    prey.state.velocity.set(0, 0, -TAS)

    // 【17.3° 由獨立解彈道得出】
    //   實際   p=(-40,0,-800) v=(0,0,0)      → t=0.903，lead 方向偏 2.9°
    //   預測   p=(-150,0,-800) v=(-150,0,0)  → t=0.961，lead 方向偏 20.2°
    // 差 17.33°。用區間而不是 toBeCloseTo：容得下浮點與求根分支的差異，
    // 但擋得住「少乘一個提前量」或「正負號寫反」那一類的錯
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    const err = aimErrorDeg(lamp, prey, predictAhead(pastPos, pastVel, 1, ghost, look), basis, a, b)
    expect(err).toBeGreaterThan(14)
    expect(err).toBeLessThan(21)
  })

  /**
   * 【八 —— 「往上下偏開也算閃」的守門員】同樣的位移量，改成鉛直方向。
   *
   * 預瞄點往上或往下也是成功閃躲。
   * 這一條確認判準不是只對水平面敏感。
   */
  it('往上偏開也是閃躲：預測誤差抓得到', () => {
    const basis = createEngageBasis()
    const ghost = new Aircraft(BLUNT, ALT, TAS)
    const a = new Vector3()
    const b = new Vector3()
    const look = new Vector3()
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)

    const pastPos = new Vector3(0, ALT, 0)
    const pastVel = new Vector3(0, 0, -TAS)
    // 一秒後：它拉起來了，比「繼續直飛」高 40 m
    const prey = new Aircraft(BLUNT, ALT, TAS)
    prey.state.position.set(0, ALT + 40, -TAS)
    prey.state.velocity.set(0, 60, -TAS)

    // 獨立解一次彈道：預測是純尾追（相對速度 0，lead 就是 (0,0,-1)），
    // 實際 p=(0,40,-800) v=(0,60,0) → t=0.908，lead=(0,94.5,-800)，偏 6.74°
    advanceLamp(lamp, prey, track, 1, basis, new Vector3())
    const err = aimErrorDeg(lamp, prey, predictAhead(pastPos, pastVel, 1, ghost, look), basis, a, b)
    expect(err).toBeGreaterThan(5)
    expect(err).toBeLessThan(9)
  })
})
