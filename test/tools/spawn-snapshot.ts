/**
 * 決定性測試共用的場景與狀態校驗和。**沒有頂層執行碼**。
 *
 * 使用者都是「同一個程序裡跑兩場、比兩個校驗和」：`replay-determinism`（同一組
 * 設定跑兩次）、`god-view` 與 `vortex-neutrality`（開關一個只該影響畫面的東西）。
 * **不存基準值** —— 校驗和只在同一次執行裡互相比，調 AI、改武器都不會讓它們紅。
 */
import { DEFAULT_BATTLE, type Battle, type BattleConfig } from '../../src/battle/setup'
import { lineAbreast } from '../../src/battle/order'
import { HEAD_ON, PURSUIT } from '../../src/battle/entry'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { B17G } from '../../src/specs/b17g'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import type { Command, Controller } from '../../src/control/Controller'

// 【這四個都要 export】探針與測試必須用同一組值，各寫一份就是遲早會漂開的
// 那種。`createBattle` / `stepBattle` **不要** import 進來 —— 這個檔只組
// 設定與讀快照，跑模擬的是它的兩個使用者（`noUnusedLocals` 開著）
export const DT = 1 / 240
export const SEED = 20260821
export const STEPS = 240 * 30

export class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.firing = false
    out.throttle = 0.7
  }
}

/**
 * **可觀測狀態**的 SHA-256，外加元素個數。
 *
 * 【為什麼不是 32 位元 FNV-1a】32 位元的碰撞空間只有
 * 43 億，而這裡比的是四萬多個浮點數。長度相同 + 32 位元雜湊相同**推不出**
 * 位元相同。SHA-256 在密碼學意義上碰撞不可行，所以它是**高可信校驗**
 * —— 不是數學上的逐位元比較，但足以當護欄。
 *
 * 【為什麼連元素個數一起回】校驗和相同但長度不同是「少抓了一個欄位」的
 * 典型症狀。**注意它補不了「兩邊都漏同一個欄位」** —— 那只能靠涵蓋得夠。
 *
 * 【`crypto.subtle` 不需要 @types/node】它在 `lib: ["DOM"]` 裡，實測
 * `npx tsx` 與 vitest 下都可用。代價是這支必須是 async。
 *
 * ── 【它涵蓋什麼、不涵蓋什麼】────────────────────────────
 *
 * **涵蓋**：飛機的完整運動狀態（含 `prev*` 與作動器 `surfaces`）、血量、
 * 命中數、射速時鐘、槍焰、全部砲塔狀態、全部彈丸的並排陣列、彈丸環狀游標、
 * `World.damageTime`、指派板、編制的壓縮結果、任務狀態與勝負。
 *
 * **不涵蓋**：`AiController` 的決策計時器與延遲佇列、`FlightDirector` 的
 * PID 積分、`World` 的事件緩衝區 —— 那些都是 private 或需要新增
 * production API 才讀得到。
 *
 * 【為什麼不補那些】要補就要在 `World`、`Aircraft`、`AiController`、
 * `FlightDirector` **四個生產檔各開一個 replay snapshot 方法**，只為了測試。
 *
 * 【為什麼這樣仍然守得住】隱藏狀態分岔**不會沉默**：AI 讀位置、寫控制面，
 * 控制面改變位置，而這條回饋迴路每秒跑 240 次。一個分岔的 `decisionTimer`
 * 會改變決策時刻 → 改變控制輸入 → 改變位置。30 秒之後仍然一模一樣的位置，
 * 幾乎不可能來自一個真的分岔了的世界。
 */
export async function replayDigest(b: Battle): Promise<string> {
  const cs = b.world.combatants
  const p = b.world.projectiles
  const v: number[] = [b.world.time, p.live]
  // 【勝負與任務狀態】它們由 `stepBattle` 每步更新，而且是玩家真的看得到的
  v.push(b.outcome === 'victory' ? 1 : b.outcome === 'defeat' ? -1 : 0)
  v.push(b.mission.secondsLeft, b.mission.metric, b.mission.hasTarget ? 1 : 0)
  for (let i = 0; i < b.world.damageTime.length; i++) v.push(b.world.damageTime[i]!)
  for (const c of cs) {
    const st = c.aircraft.state
    v.push(st.position.x, st.position.y, st.position.z)
    v.push(st.velocity.x, st.velocity.y, st.velocity.z)
    v.push(st.angularVelocity.x, st.angularVelocity.y, st.angularVelocity.z)
    v.push(st.orientation.x, st.orientation.y, st.orientation.z, st.orientation.w)
    // 【prev* 也是每步變動的】內插算圖讀它們；漏掉等於漏掉一整條每步寫入
    v.push(c.aircraft.prevPosition.x, c.aircraft.prevPosition.y, c.aircraft.prevPosition.z)
    v.push(c.aircraft.prevOrientation.x, c.aircraft.prevOrientation.y,
      c.aircraft.prevOrientation.z, c.aircraft.prevOrientation.w)
    v.push(c.hp, c.alive ? 1 : 0, c.hitsDealt)
    // 【controls 與 surfaces 都要】`surfaces`
    // 是作動器落後的狀態，**會延續到下一步**。漏掉它等於漏掉一整條積分。
    for (const k of ['aileron', 'elevator', 'rudder', 'throttle', 'brake'] as const) {
      v.push(c.aircraft.controls[k], c.aircraft.surfaces[k])
    }
    for (let i = 0; i < c.cooldowns.length; i++) v.push(c.cooldowns[i]!)
    for (let i = 0; i < c.muzzleFlash.length; i++) v.push(c.muzzleFlash[i]!)
    for (const t of c.turretStates) {
      v.push(t.aim.x, t.aim.y, t.aim.z, t.phase, t.targetIndex, t.searchCooldown)
      v.push(t.burstFiring ? 1 : 0, t.burstTimer, t.burstScale, t.flash, t.lastBarrel)
    }
    for (let i = 0; i < c.turretCooldowns.length; i++) v.push(c.turretCooldowns[i]!)
  }
  // 【編制與指派板】壓縮結果與指派板必須進表 —— 它們是「僚機認錯長機」
  // 那個症狀唯一的外顯
  for (let i = 0; i < b.flights.flightOf.length; i++) {
    v.push(b.flights.flightOf[i]!, b.flights.positionOf[i]!)
  }
  v.push(b.flights.pinned)
  for (let i = 0; i < b.board.assignments.length; i++) v.push(b.board.assignments[i]!)
  // 【環狀游標也要】它決定下一發覆寫哪一格。兩場的彈丸完全相同但游標差一格，
  // 之後就會分岔 —— 而分岔要好幾秒才顯現，那時已經查不出源頭。
  //
  // 【它是 private，所以 `Projectiles` 開了一個唯讀的 `writeCursor`】
  v.push(p.writeCursor, p.peakLive)
  for (let i = 0; i < p.capacity; i++) {
    v.push(p.owner[i]!, p.damage[i]!, p.age[i]!)
    v.push(p.sx[i]!, p.sy[i]!, p.sz[i]!)
    v.push(p.x[i]!, p.y[i]!, p.z[i]!, p.vx[i]!, p.vy[i]!, p.vz[i]!)
  }
  const f = Float64Array.from(v)
  const bytes = new Uint8Array(f.buffer, f.byteOffset, f.byteLength)
  const hash = await crypto.subtle.digest('SHA-256', bytes)
  const hex = Array.from(new Uint8Array(hash))
    .map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${f.length}:${hex}`
}

/**
 * 三個場景：對頭、鏡像追擊（守 applyFeel 的記憶化）、帶砲塔的護航。
 *
 * 【每一支的回傳型別要明寫 `BattleConfig`】不寫的話 TS 推斷出來的是那個字面值
 * 自己的型別，而 `createBattle(…, SCENES[name](), …)` 收的**不是新鮮的物件
 * 字面值**，多餘屬性檢查因此不會跑：多寫一個不存在的欄位會**靜靜地被忽略**，
 * spread 進來的 `DEFAULT_BATTLE.units` 照舊生效，場景悄悄變成另一場。
 */
export const SCENES = {
  HEADON_20V20: (): BattleConfig => ({
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, P51D, 20, BF109K4, 20),
  }),
  PURSUIT_MIRROR_8V8: (): BattleConfig => ({
    ...DEFAULT_BATTLE, units: lineAbreast(PURSUIT, P51D, 8, P51D, 8),
  }),
  /**
   * 【帶砲塔的場景】前兩個是 P-51D 與 Bf 109，只跑得到 `World.fire` 的固定
   * 掛架，**跑不到 `stepTurrets` 生彈丸那一行**。
   */
  ESCORT_B17: (): BattleConfig => ({
    ...DEFAULT_BATTLE, units: lineAbreast(HEAD_ON, B17G, 4, BF109K4, 8),
  }),
}
