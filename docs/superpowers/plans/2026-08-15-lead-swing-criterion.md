# 預瞄點偏移判準 Implementation Plan(第四版:手電筒觀測儀)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用一隻**始終瞄準敵機、不受物理支配**的觀測儀,量「照著 N 秒之後,預瞄點相對 N 秒前偏移幾度」,四個方位各一個值。

**Architecture:** 在 `test/integration/ai-visible-evasion.test.ts` **新增**一條獨立的量測路徑。既有的 `measure()`、`scripted()`、`Sniper`、六場墜海護欄、700 / 900 兩條可見度測試 —— **一個字都不動**。

**Tech Stack:** TypeScript、vitest。無新相依、無新檔案、不動任何 `src/`。

**Spec:** `docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md`(第四版)

## 這一版與前幾版的差異

專案負責人 2026-08-15:

> 射手不要用真的飛機去測量,因為真的飛機轉向瞄準也是需要滾轉的時間。把射手當成一隻可以自由轉動的手電筒,始終瞄準在敵機身上就好。原本的「預瞄點動了幾度」直接當判準就可以保留。

**把污染源移除,比把污染扣掉簡單。** 這一句話同時消掉了前兩版的三個問題:

| 前兩版的問題 | 為什麼消失 |
|---|---|
| 主判準無法歸因(審查 C4):射手自己的滾轉與拉桿灌進預瞄點位移 | 觀測儀不機動,貢獻是 0。**配對消融整個不要了** |
| 垂直場景 2.5 秒就收斂成尾追(審查 C3) | 觀測儀不追擊,所以不會**主動**壓上去。方位仍會隨 AI 自己的機動漂移 —— 但那正是訊號 |
| `Command.aimWorld` 同時是飛行方向與射擊方向,「維持站位」與「機首指著目標」互斥 | 觀測儀不飛,死結不存在 |

連帶不再需要:方位閘門 `aspectHolds`、場景有效性計數 `aspectSamples`、`hunterLook`、對 `scripted` 的改動、以及整套「逐位元恆等」的驗證負擔(因為根本不碰既有路徑)。

## Global Constraints

- **不動任何 `src/` 檔案。** 本輪只在一個測試檔裡新增。
- **不動 `measure()`、`scripted()`、`Sniper`、六場墜海護欄、700 / 900 兩條既有測試。** 新路徑是獨立函數。這一條讓「有沒有破壞既有基準」變成一個**看 diff 就能回答**的問題。
- **門檻由專案負責人依試玩裁定,不由掃描的現況推導。** 2026-08-05 的「位移 ≥ 5°」是猜的;第一版的「現況最小值 × 0.8」是照著現況畫靶 —— 同一類錯誤的兩面。
- **量的形狀不變:** 滑動窗、窗長 `WINDOW`(240 步 = 1 秒)、取「現在的預瞄方向」與「1 秒前」的淨夾角。沿用既有的 `Swing`。
- **「只改一個檔案」指的是程式碼。** Task 3 回填 spec 是文件,不在那條約束裡。
- **觀察窗不是一個猜出來的常數。** 既有路徑的 180 秒是為了等真射手追上來;觀測儀從第一格就在位,而且**照得住多久是被幾何決定的** —— 量測只取第一段連續的彈道有效期,`LAMP_SECONDS = 20` 只是「跑到這裡也要停」的上界。實際窗長由 `validSeconds` 印出來,它本身就是一項發現。

## 第三版又被推翻了一次 —— 記著這個坑

Codex 第四輪審查抓到一個**致命**問題:計畫原本寫「觀測儀位置 = 受測 AI 的**當下**位置 + 固定位移」,也就是把它**黏在目標身上**。

那樣的話,從觀測儀指向 AI 的向量**恆等於 −位移**,是個常數;相對速度又是 0,於是預瞄方向**一格都不會動**。`leadSwing ≡ 0`、`straightness ≡ 0` —— 量測會忠實地回報「AI 完全沒動」,不管它做什麼,而且**四個方位、開關兩組全部都是 0**,看起來像一致的結果。

專案負責人的原話是「可以**自由轉動**的手電筒」—— **自由的是轉動,不是位置**。

**改成等速直線:** 起點 = AI 的開局位置 + 方位位移,初速 = AI 的開局速度,之後只按 `位置 += 初速 × dt` 前進,姿態始終指向預瞄點。

**這件事三行代數就能發現,不該蓋完 180 秒場景才知道 —— 所以這一版加了 Task 0。**

## 第四版:手電筒瞄的是預瞄點,不是目標

Codex 第五輪審查又抓到一個**致命**問題,而且它藏在「手電筒始終瞄準敵機」這句話的歧義裡。

`assess.ts:444-446` —— `alarmFactor` 比的是**機首方向 vs 彈道預瞄方向 `lead`**:

```ts
const fwd = A.v[0]!.copy(FWD).applyQuaternion(shooter.state.orientation)
const off = Math.acos(clampUnit(fwd.dot(lead)))
if (off >= ALARM_CONE) return 0
return 1 - off / ALARM_CONE
```

第三版把機首指向 `prey.state.position`(**視線**),兩者差一個提前角。`ALARM_CONE = 15°`,而 `defend` 的門檻 `threatEnter = 0.35` 對應 `15° × (1 − 0.35) = 9.75°`。橫向相對速度 200 m/s 對 887 m/s 的機砲就是 **13° 的提前角** —— 也就是說:

> **AI 一開始橫向閃躲,手電筒反而不再構成足以觸發 `defend` 的瞄準。**

這是最壞的一種偏差:**閃得越用力,越量不到**。而且新加的 `alarmFactor > 0` 閘門不但沒擋住,還會把提前角超過 15°(往往正是位移最大)的樣本整段丟掉,同時把 `0 < alarmFactor ≤ 0.35`(AI 根本不會進 defend)的樣本收進來。

**修法:先算預瞄點,再擺機首。** 順序反了就是這個缺陷。改完之後 `alarmFactor` 在建構上恆等於 1,那道閘門於是退化成純粹的**彈道有效性**(`solveLead` 有解且飛行時間 ≤ 1.2 s)—— 那才是「玩家的預瞄環真的套在它身上」該有的定義。

**Task 0 因此也要改。** 第五輪同時指出:第三版的三條合約是**手工擺出來的狀態**,一個仍然把手電筒黏在目標身上的 `lampMeasure` 照樣會全綠 —— 守門員守不住它宣稱要擋的東西。修法是把歸位邏輯抽成**唯一一份** `advanceLamp`,合約與量測共用同一份。

---

### Task 0: 歸位函數 + O(1) 合約檢查(不跑場景)

**這個任務可能會結束整個計畫。** 成本是毫秒級,但它守的是前三版各死一次的那個位置。

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`(新增一個 `describe` 與一個 helper)

**Interfaces:**
- Produces: `interface LampTrack { start, vel }`、`function advanceLamp(lamp, prey, track, elapsed, basis, outDir): Vector3`

- [ ] **Step 1: 先寫歸位函數 —— 合約與量測必須共用同一份**

**這一步的順序不能調。** Codex 第五輪指出:第三版的合約是**手工擺出來的狀態**,一個仍然把手電筒黏在目標身上的 `lampMeasure` 會讓三條全綠 —— 守門員守不住它宣稱要擋的東西。唯一的修法是讓合約去呼叫**量測真正會跑的那一份程式**。

在檔案末尾新增:

```ts
// ══ 手電筒觀測儀 ═══════════════════════════════════════════

/** 觀測儀的等速直線軌跡 —— 兩個參數就定義了它的一生 */
interface LampTrack {
  /** 起點(世界座標) */
  start: Vector3
  /** 恆定速度。位置 = `start + vel × elapsed`，與被觀測者無關 */
  vel: Vector3
}

/**
 * 把觀測儀放到軌跡上 `elapsed` 秒處，機首指向對 `prey` 的**彈道預瞄點**，
 * 並把那個方向寫進 `outDir` 回傳。
 *
 * 【這是唯一一份歸位邏輯】Task 0 的合約與 `lampMeasure` 都呼叫它。分成兩份
 * 的話，合約驗的就不是量測真正跑的東西（Codex 第五輪 C2）。
 *
 * 【位置只由軌跡決定，**絕對不參考 `prey` 的當下位置**】黏在目標身上的話，
 * 從它指向目標的向量恆等於 −offset、是個常數 —— 預瞄方向一格都不會動，
 * `leadSwing` 恆為 0，而且四個方位、開關兩組全部都是 0，看起來像一致的
 * 結果（Codex 第四輪抓到的致命缺陷）。**自由的是轉動，不是位置。**
 *
 * 【先算預瞄點、再擺機首 —— 順序反了就是第三版的致命缺陷】`alarmFactor`
 * 比的是「機首 vs **彈道預瞄方向**」，不是「機首 vs 目標」（`assess.ts:444`）。
 * 指著目標本體的話，橫向相對速度 200 m/s 就產生 13° 的提前角，而 `defend`
 * 的門檻只有 9.75°（`ALARM_CONE` 15° × (1 − `threatEnter` 0.35））——
 * **AI 閃得越用力，手電筒越照不到它**。而且 `alarmSeconds` 的斜坡
 * （`ALARM_SATURATION` = 0.5 s）一旦歸零就要重來，等於閃躲直接關掉威脅。
 *
 * 指著預瞄點則讓 `alarmFactor` 在**建構上**恆等於 1（同樣的 `solveLead`、
 * 同樣的輸入），那道閘門於是退化成純粹的彈道有效性：解存在，且飛行時間
 * ≤ `PROJECTILE_LIFETIME`。那才是「玩家的預瞄環真的套在它身上」。
 *
 * 【`buildEngageBasis` 在這裡不吃姿態】`leadPoint` 只由雙方的位置與速度決定
 * （`steer.ts:76-86`）。姿態只影響 `losAxis` 的退化退路與 `verticalAxis`，
 * 兩者本函數都不用 —— 所以「用上一格的姿態去算這一格的預瞄點」沒有循環。
 * 量測值因此與觀測儀的姿態無關；姿態存在的唯一理由是讓 AI 感覺被瞄準。
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
```

檔頭補 import:

```ts
import { alarmFactor } from '../../src/ai/assess'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { createCommand } from '../../src/control/Controller'
import type { EngageBasis } from '../../src/ai/steer'
```

(`threatFactor`、`buildEngageBasis`、`createEngageBasis`、`Vector3`、`World`、`Aircraft`、`AiController`、`createTargetBoard`、`VETERAN` 已在 import 清單裡,別重複。`Lazy`、`ScriptedBreaker`、`Swing`、`median`、`BLUNT`、`ALT`、`TAS`、`DT`、`FWD`、`WINDOW` 都是**這個檔案裡既有的區域符號**,直接用。)

- [ ] **Step 2: 寫五條合約**

```ts
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
   * `threatEnter`（0.35）。本專案早就發現並修過那個缺陷（`AiController` 的
   * 註解：「實測 700/900 m 被連續射擊 180 秒，`defend` 進入率 0.0%」），
   * 修法就是另做 `alarmFactor` —— 它沒有距離因子。
   *
   * 少了這一條，整個掃描會在「AI 從頭到尾不閃」的情況下跑完，而讀表的人
   * 會以為那是 AI 的問題。
   */
  it('800 m 精準瞄準：alarmFactor 滿值，threatFactor 遠低於門檻', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 800), vel: new Vector3(0, 0, -TAS) }
    const lamp = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(lamp, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(lamp, prey)).toBeCloseTo(1, 6)
    expect(threatFactor(lamp, prey)).toBeLessThan(DEFAULT_RULES.threatEnter)
  })

  /**
   * 【二】彈丸壽命是 `alarmFactor` 唯一的距離閘門。800 m 過得了，
   * 1200 m 過不了 —— 這條把「為什麼 standoff 選 800」釘在測試裡。
   */
  it('彈丸壽命是唯一的距離閘門', () => {
    const prey = at(new Vector3(0, ALT, 0), FWD, new Vector3(0, 0, -TAS))
    const track: LampTrack = { start: new Vector3(0, ALT, 1200), vel: new Vector3(0, 0, -TAS) }
    const far = new Aircraft(BLUNT, ALT, TAS)
    advanceLamp(far, prey, track, 0, createEngageBasis(), new Vector3())
    expect(alarmFactor(far, prey)).toBe(0)
  })

  /**
   * 【二之二 —— 排除「偷偷加回固定截斷」】1000 m 仍然要有值。
   *
   * 只驗「800 過、1200 不過」的話，一個把 `THREAT_RANGE`（900）或任何
   * 900~1000 的固定截斷加回來的實作照樣全綠（Codex 第五輪 C2）。1000 m 在
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
   * 【三 —— 第三版致命缺陷的守門員】機首要指**預瞄點**，不是目標本體。
   *
   * `alarmFactor` 比的是「機首 vs 彈道預瞄方向」（`assess.ts:444-446`）。
   * 橫向相對速度 200 m/s 對 887 m/s 的機砲產生 atan(200×0.9 / 800) ≈ 12.7°
   * 的提前角，而 `defend` 的門檻只有 `ALARM_CONE` × (1 − `threatEnter`)
   * = 15° × 0.65 = 9.75°。
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

    // 第三版的做法：指向目標本體
    const los = new Vector3().subVectors(prey.state.position, lamp.state.position).normalize()
    lamp.state.orientation.setFromUnitVectors(FWD, los)
    const atBody = alarmFactor(lamp, prey)
    expect(atBody).toBeGreaterThan(0)                        // 還在 15° 錐內
    expect(atBody).toBeLessThan(DEFAULT_RULES.threatEnter)   // 但不足以觸發 defend
  })

  /**
   * 【四 —— 第四版致命缺陷的守門員】觀測儀**不能黏在目標身上**。
   *
   * 若位置永遠是「目標當下位置 + 固定位移」，從它指向目標的向量恆等於
   * −位移，是個常數 —— 預瞄方向一格都不會動，`leadSwing` 恆為 0，而且
   * 四個方位、開關兩組**全部**都是 0，看起來像一致的結果。
   *
   * 【這一條必須呼叫 `advanceLamp` 本人】第三版的版本是手工擺兩個狀態，
   * 一個仍然黏著的 `lampMeasure` 照樣全綠（Codex 第五輪 C2）。所以下面
   * 直接斷言 helper 產出的位置**等於軌跡公式**、且**不等於黏著公式**。
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
    // 而且**不是**「目標當下位置 + 固定位移」—— 黏著版本會落在這裡（差 150 m）
    const glued = prey1.state.position.clone().add(new Vector3(0, 0, 800))
    expect(lamp.state.position.distanceTo(glued)).toBeGreaterThan(100)
    // 目標轉了向，看過去的方向就必須改變
    expect(dir0.angleTo(dir1) * (180 / Math.PI)).toBeGreaterThan(5)
  })

  /**
   * 【五 —— 接線】前四條都只驗純函數。這一條驗**產線真的走這條路**：
   * `AiController.scanThreat` 用 `alarmFactor` 掃全場、挑出手電筒當
   * `threatSource`，最後意圖變成 `defend`。
   *
   * 少了它，前四條可以全綠而 `lampMeasure` 仍然量到一架從頭到尾不閃的 AI
   * （Codex 第五輪 C2）。
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
```

檔頭補 import:

```ts
import { alarmFactor, threatFactor } from '../../src/ai/assess'
import { DEFAULT_RULES } from '../../src/ai/rules'
```

(`threatFactor` 可能已經在 import 清單裡,別重複。)

- [ ] **Step 3: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "合約"`
Expected: 五條全綠,秒級完成。

**任何一條紅就停** —— 那代表這條路的前提不成立,整個計畫要重想,而不是繼續往下蓋。

各條紅掉分別代表什麼:

| 紅掉的合約 | 代表 |
|---|---|
| 一 | 800 m 的手電筒根本不構成威脅 —— 整條路不成立 |
| 二 / 二之二 | 距離閘門不是彈丸壽命 —— standoff 選 800 的理由要重寫 |
| 三 | 瞄預瞄點沒有讓 `alarmFactor` 滿值 —— `advanceLamp` 的順序寫反了 |
| 四 | `advanceLamp` 還黏在目標身上 —— 量測會恆為 0 |
| 五 | 產線不走 `alarmFactor` 這條路 —— 前四條全部只是純函數的自言自語 |

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 手電筒的歸位函數與五條 O(1) 合約 —— 蓋場景之前先驗前提"
```

---

### Task 1: 觀測儀與量測函數

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`(只新增,不改既有符號)

**Interfaces:**
- Consumes: Task 0 的 `LampTrack`、`advanceLamp`;既有的 `Swing`、`WINDOW`、`median`、`BLUNT`、`Lazy`、`ScriptedBreaker`、`ALT`、`TAS`、`DT`、`FWD`、`createEngageBasis`、`createTargetBoard`、`VETERAN`
- Produces:
  - `type Probe = 'tail' | 'beam' | 'high' | 'low'`
  - `probeOffset(probe, standoff, out): Vector3`
  - `interface SwingResult { leadSwing, straightness, defendShare, lampShare, samples, validSeconds, allAlive, onBait }`
  - `function lampMeasure(standoff: number, probe: Probe, evade: boolean): SwingResult`

- [ ] **Step 1: 觀測儀的擺位**

接在 Task 0 的 `advanceLamp` 之後新增(同一段,`// ══ 手電筒觀測儀 ══` 那條分隔線 Task 0 已經放過了):

```ts
// 【為什麼要另一條量測路徑】上面那一套用的是**真飛機**射手，而真飛機要
// 滾轉、要拉桿才轉得過來 —— 那些動作全都灌進「預瞄點動了幾度」，量到的
// 不只是 AI 的閃躲（2026-08-15 Codex 審查 C4；同一份檔案記錄的
// `ordinaryMedian` 6~11° 就是證據）。
//
// 專案負責人 2026-08-15 的解法：把射手當成一隻**可以自由轉動的手電筒**，
// 始終瞄準在敵機身上。污染源直接移除，比把污染扣掉簡單。
//
// 【這是新增不是取代】完美的手電筒瞄準誤差恆為 0，所以上面那條路徑的主
// 判準 `shootableShare`（機首落在預瞄錐內的佔比）在它身上恆為 1、完全失
// 去意義。兩條路徑回答兩個不同的問題：真射手問「一個受物理限制的追擊者
// 跟不跟得住」，手電筒問「預瞄點本身動了多少」。見 spec §3.3。

/** 觀測儀相對受測 AI 的方位 */
type Probe = 'tail' | 'beam' | 'high' | 'low'

/**
 * 觀測儀相對受測 AI 的固定位移。
 *
 * 【這是**開局**的相對方位，不是全程】位移是世界固定方向；AI 一轉向，
 * `+Z` 就不再是它的正後方。文件與表頭都必須這樣寫（spec §5 風險三）——
 * 宣稱「180 秒全程維持 tail」是錯的。
 *
 * 【但方位漂移在這裡不是問題】觀測儀不追擊，所以漂移**完全由被測者造成**，
 * 那正是要量的訊號。前兩版需要方位閘門，是為了濾掉「射手自己壓上來造成的
 * 方位改變」—— 污染源移除之後那道閘門就沒有存在的理由了。
 */
function probeOffset(probe: Probe, standoff: number, out: Vector3): Vector3 {
  if (probe === 'tail') return out.set(0, 0, standoff)
  if (probe === 'beam') return out.set(standoff, 0, 0)
  return out.set(0, probe === 'high' ? standoff : -standoff, 0)
}
```

- [ ] **Step 2: 量測函數**

```ts
interface SwingResult {
  /** **主判準**：預瞄方向的 1 秒窗淨角位移中位數，度 */
  leadSwing: number
  /** 淨位移 ÷ 逐格位移總和。直線接近 1、來回抽搐接近 0 */
  straightness: number
  /** 有效取樣裡受測 AI 進 `defend` 的比例。觀測值 —— 見下面的註解 */
  defendShare: number
  /**
   * 有效取樣裡 AI 認定「在瞄我的是手電筒」的比例 —— **歸因護欄**。
   *
   * `defendShare` 很高但 `lampShare` 很低的話，AI 是在閃**誘餌**（或別的
   * 東西），這條路量到的位移就不是手電筒造成的（Codex 第五輪 I4）。
   */
  lampShare: number
  /** 有效取樣數 */
  samples: number
  /**
   * 第一段**連續**有效窗的長度，秒 —— **場景有效性**。
   *
   * 【為什麼是「連續」而不是「總和」】觀測儀等速直線而 AI 走弧線，兩者會
   * 分開；分開之後彈道解失效，AI 不再感覺被瞄準。若之後幾何又湊巧回到
   * 射程內，那是**另一段**攻擊，中間的空窗把 `Swing` 的 1 秒窗污染成
   * 「跨越無威脅歷史」的值。把樣本數乘 0.05 秒當窗長會把這幾段加總成一段，
   * 讀表的人會以為是一次連續的攻擊（Codex 第五輪 I1）。
   *
   * 所以量測只取**第一段**，失效即停。
   */
  validSeconds: number
  /** 三架飛機全程都活著 —— 場景護欄 */
  allAlive: boolean
  /** **全程**目標都是誘餌（逐格累積，不是只看結束那一瞬間） */
  onBait: boolean
}

/**
 * 這條路徑的觀察窗上界，秒。
 *
 * 【它是上界，不是實際窗長】實際有效的是第一段連續彈道有效期（見
 * `validSeconds`），迴圈在那一段結束時就 `break`。這個常數只是「萬一那段
 * 永遠不結束，跑到這裡也要停」的保險。
 *
 * 【為什麼從 60 降到 20】粗算有效窗約 11 秒：誘餌 `Lazy` 以 0.05 rad/s
 * 左轉（半徑 4 km），追著它的 AI 因此走弧線，與直飛的觀測儀橫向分離約
 * `4000 × (1 − cos 0.05t)`，t ≈ 11 秒就多開 600 m —— 再加上初始的 800 m
 * 就超過彈丸壽命閘門（1.2 s × 887 m/s ≈ 1064 m）。60 秒等於在資料收完
 * 之後再空跑 49 秒，只增加墜海與狀態污染的機會（Codex 第五輪 I2）。
 *
 * 【那個粗算只是量級】不同方位的分離是向量合成、攔截時間也隨相對速度變，
 * 所以 20 是留了足夠餘裕的上界，不是預測值。真正的窗長由 `validSeconds`
 * 印出來 —— **它本身就是要回報給專案負責人的發現之一**。
 */
const LAMP_SECONDS = 20

/**
 * 手電筒量測：觀測儀沿等速直線飛，機首始終指向對受測 AI 的**彈道預瞄點**，
 * 量預瞄方向的 1 秒窗淨角位移。
 *
 * @param evade `false` 時把受測方換成腳本直飛（`ScriptedBreaker` + `mode='none'`）
 *              —— 那是「完全不閃」的地板，任何數字都要跟它並排看。
 *
 * 【觀測儀怎麼實作】它是一個真的 `Combatant`（受測 AI 要靠
 * `alarmFactor(觀測儀, AI)` 才會進入 `defend`，那需要姿態與武裝），但每個
 * 物理步之後用 `advanceLamp` 把它的狀態**直接覆寫**。移除的是它的飛行
 * 動力學，不是它的存在。
 *
 * 【覆寫為什麼排在 `world.step` 之後】`World.step` 是「先全部跑控制器、
 * 再全部積分物理」。排在之後，AI 下一格才讀到修正過的位置 —— 延遲一個
 * 物理步（4 ms），可忽略；排在之前會被同一步的積分立刻蓋掉。
 *
 * 【代價：覆寫發生在撞海判定**之後**】某一格的暫態物理仍可能先把觀測儀
 * 判死。等速直線的能量跳變比舊的黏附版本小很多，但那不等於已驗證無害
 * ——所以 `allAlive` 是回傳值的一部分，Task 2 會斷言它（Codex 第五輪 I3）。
 *
 * 【`alarmFactor` 在這裡恆等於 1】機首就是指著預瞄點，而 `alarmFactor`
 * 比的正是機首與預瞄方向的夾角、用的是同一組 `solveLead` 輸入。所以
 * 「`alarmFactor > 0`」這道閘門在這條路徑上退化成純粹的**彈道有效性**：
 * 解存在，且飛行時間 ≤ `PROJECTILE_LIFETIME`。這正是「玩家的預瞄環真的
 * 套在它身上」的操作型定義 —— 也是專案負責人原話裡的限定：
 * 「**當我瞄準攻擊時**，預瞄點在我的視角 N 秒內有偏移 N 度」。
 *
 * 【仍然呼叫產線的 `alarmFactor` 而不是自己重算】條件雖然等價，但用產線
 * 那一份的話，AI 的觸發判準與量測的取樣判準在定義上就不可能漂開。
 */
function lampMeasure(standoff: number, probe: Probe, evade: boolean): SwingResult {
  const world = new World()
  const prey = new Aircraft(BLUNT, ALT, TAS)
  const bait = new Aircraft(BLUNT, ALT, TAS)
  const lamp = new Aircraft(BLUNT, ALT, TAS)

  const preyPos = new Vector3(0, ALT, 0)
  const baitPos = new Vector3(0, ALT, -500)
  const lampPos = probeOffset(probe, standoff, new Vector3()).add(preyPos)
  for (const [a, p] of [[prey, preyPos], [bait, baitPos], [lamp, lampPos]] as const) {
    a.state.position.copy(p)
    a.state.velocity.copy(FWD).multiplyScalar(TAS)
    a.state.orientation.setFromUnitVectors(FWD, FWD)
    a.prevPosition.copy(a.state.position)
    a.prevOrientation.copy(a.state.orientation)
  }

  const ai = new AiController()
  const breaker = new ScriptedBreaker()
  breaker.mode = 'none'
  breaker.threat = lamp
  const pc = world.add(prey, evade ? ai : breaker, 'blue', preyPos, ALT, TAS)
  const bc = world.add(bait, new Lazy(), 'red', baitPos, ALT, TAS)
  // 【觀測儀不開火】它是量測儀器，不是戰鬥單位（spec §6）
  const lc = world.add(lamp, new Lazy(), 'red', lampPos, ALT, TAS)
  for (const c of [pc, bc, lc]) c.respawnOnDestroy = false

  const board = createTargetBoard(world.combatants)
  ai.board = board
  ai.selfIndex = pc.index
  ai.target = bait
  // 【釘住誘餌】只設 `target` 沒有用 —— `board` 非 null 時每個決策節拍都會
  // 呼叫 `selectTarget` 覆寫它，而觀測儀也是紅隊候選，AI 可能中途改去追
  // 儀器（審查 I4）。`focusTarget` 是既有的覆寫入口（`AiController` 在沒有
  // 站位參考時會用它蓋掉 `target`）。
  ai.focusTarget = bait
  ai.profile = VETERAN

  const basis = createEngageBasis()
  const dir = new Vector3()
  const swing = new Swing()
  /**
   * 觀測儀的軌跡。初速刻意取 AI 的**開局速度** —— 開局相對速度為零，
   * 這讓彈道有效窗盡可能長；之後的分離完全由被測者的機動造成。
   */
  const track: LampTrack = { start: lampPos.clone(), vel: new Vector3(0, 0, -TAS) }
  const swings: number[] = []
  const straights: number[] = []
  let defendN = 0
  let lampN = 0
  let samples = 0
  /** 有效窗的三態：還沒進去 / 在裡面 / 已經出來（出來就停） */
  let phase: 'before' | 'inside' = 'before'
  let validFrom = 0
  let validTo = 0
  let allAlive = true
  let onBait = true

  for (let s = 0; s < LAMP_SECONDS * 240; s++) {
    world.step(DT)
    // 【任何一架死了就整場作廢】不是 `break` 之後照樣回報既有樣本 ——
    // 那會讓一場提早結束的測量看起來像一場正常的測量（Codex 第五輪 I4）
    if (!pc.alive || !bc.alive || !lc.alive) {
      allAlive = false
      break
    }

    advanceLamp(lamp, prey, track, (s + 1) * DT, basis, dir)

    // ── 有效窗：第一段連續的「彈道解成立」 ──────────────
    //
    // 【為什麼一定要這道閘門】觀測儀等速直線、AI 走弧線，兩者會分開。分開
    // 之後 AI 不再感覺被瞄準，取樣到的全是「沒有威脅時的正常追擊」——
    // 那正是要排除的東西。
    //
    // 【失效就停，不等它回來】見 `validSeconds` 的註解。
    const valid = alarmFactor(lamp, prey) > 0
    if (phase === 'before') {
      if (!valid) continue
      phase = 'inside'
      validFrom = s
    } else if (!valid) {
      break
    }
    validTo = s

    swing.push(dir)
    if (evade) onBait &&= ai.target === bait

    // 【1 秒窗必須整段落在有效期內】`swing.ready` 只保證窗填滿了，不保證
    // 窗裡那 240 格都是有效的。有效期不是從 s=0 開始時，第一個 ready 的窗
    // 會跨進無威脅的歷史（Codex 第五輪 I1）。
    if (!swing.ready || s - validFrom < WINDOW || s % 12 !== 0) continue

    samples++
    swings.push(swing.net)
    if (swing.straightness > 0) straights.push(swing.straightness)
    if (evade && ai.intent === 'defend') defendN++
    if (evade && ai.threatSource === lamp) lampN++
  }

  const n = Math.max(samples, 1)
  return {
    leadSwing: median(swings),
    straightness: median(straights),
    defendShare: defendN / n,
    lampShare: lampN / n,
    samples,
    validSeconds: (validTo - validFrom) * DT,
    allAlive,
    onBait,
  }
}
```

- [ ] **Step 3: 型別檢查**

Run: `npx tsc --noEmit`
Expected: 無輸出。

若 `ScriptedBreaker` 的 `threat` 欄位型別或 `Lazy` 的建構不合,依既有用法調整 —— **但不得修改那兩個類別**。

- [ ] **Step 4: 確認既有路徑一個字都沒動**

Run: `git diff test/integration/ai-visible-evasion.test.ts`

Expected: diff **只有新增的行**,沒有任何一行被刪除或修改。

**有任何既有行被動到 = 違反 Global Constraints,回退重做。**

- [ ] **Step 5: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 手電筒觀測儀 —— 量預瞄點偏移，排除射手自身機動的污染"
```

---

### Task 2: 掃描四個方位

**Files:**
- Modify: `test/integration/ai-visible-evasion.test.ts`

- [ ] **Step 1: 寫掃描的 describe**

```ts
describe('預瞄點偏移（手電筒觀測儀、開局 800 m）', () => {
  for (const probe of ['tail', 'beam', 'high', 'low'] as const) {
    it(`開局 ${probe}：手電筒照著 1 秒，預瞄點偏移幾度`, () => {
      const on = lampMeasure(800, probe, true)
      const off = lampMeasure(800, probe, false)
      console.log(
        `[手電筒] 開局${probe} 800m`
        + ` 閃躲=${on.leadSwing.toFixed(2)}°`
        + ` 直飛地板=${off.leadSwing.toFixed(2)}°`
        + ` 倍率=${(on.leadSwing / Math.max(off.leadSwing, 1e-6)).toFixed(1)}`
        + ` 同向性=${on.straightness.toFixed(3)}`
        + ` defend佔時=${(on.defendShare * 100).toFixed(1)}%`
        + ` 瞄我的是手電筒=${(on.lampShare * 100).toFixed(1)}%`
        + ` 有效窗=${on.validSeconds.toFixed(1)}s／地板 ${off.validSeconds.toFixed(1)}s`
        + ` 取樣=${on.samples}／地板 ${off.samples}`,
      )
      // 【這一輪的斷言只驗「量測有效」，不驗「AI 夠好」】後者的門檻由專案
      // 負責人裁定（Task 3）。審查 I5 指出上一版只驗 defendShare 不夠 ——
      // `defendShare` 可以很高而 `leadSwing` 與 `straightness` 同時是 0，
      // 那正是黏在目標身上那個致命缺陷的表現。

      // ── 兩組都要驗，不能只驗閃躲組 ──────────────────────
      //
      // 【為什麼】`median([])` 回 0，而 0 是 finite。地板組若在收滿樣本
      // 之前就墜毀，`off.leadSwing = 0` 會讓下面的 `on > off` **更容易**
      // 通過 —— 一場失敗的對照反而讓結論看起來更漂亮（Codex 第五輪 I4）。
      for (const [name, r] of [['閃躲', on], ['地板', off]] as const) {
        expect(r.allAlive, `${name}：三架飛機要全程活著`).toBe(true)
        expect(r.samples, `${name}：要有取樣`).toBeGreaterThan(0)
        // 有效窗至少要有幾秒，中位數才有意義。3 秒是下界不是目標 ——
        // 實際值由這張表決定，過短本身就是要回報的發現
        expect(r.validSeconds, `${name}：連續有效窗`).toBeGreaterThan(3)
        expect(Number.isFinite(r.leadSwing)).toBe(true)
      }
      // 場景成立：AI 真的感覺到被瞄準、而且知道是誰在瞄，全程都在追誘餌
      expect(on.defendShare).toBeGreaterThan(0.5)
      // 【歸因】位移必須是手電筒造成的。`defendShare` 高而 `lampShare` 低
      // 的話，AI 是在閃別的東西，這張表就不能拿來談手電筒判準
      expect(on.lampShare).toBeGreaterThan(0.8)
      expect(on.onBait).toBe(true)
      // 量測非退化：閃躲一定要比「完全不閃」動得多，而且是閃不是抽搐
      expect(on.leadSwing).toBeGreaterThan(off.leadSwing)
      expect(on.straightness).toBeGreaterThan(0.5)
    }, 10 * 60 * 1000)
  }
})
```

**這一輪的斷言全部都是「量測有效」,沒有一條是「AI 夠好」。** 主判準 `leadSwing` 的門檻是 Task 3 的事,而且由專案負責人定 —— 這一輪連寫都不寫。

- [ ] **Step 2: 跑**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts -t "手電筒"`
Expected: 四列 `[手電筒]`。把表抄下來。

- [ ] **Step 3: 判讀**

1. **`有效窗`** —— **先看這一欄**。它決定後面每一個中位數是由幾秒的資料算出來的。粗算約 11 秒;若實測只有 4~5 秒,那本身就是要回報給專案負責人的發現(「800 m 的手電筒只照得住 AI 幾秒」),而不是偷偷放寬。
2. **`瞄我的是手電筒`** —— 應該接近 100%。低的話代表 AI 認定的威脅來源是誘餌,這張表就不能拿來談手電筒判準。
3. **`defend佔時`** —— 應該很高(觀測儀始終瞄著、`alarmFactor` 恆為 1)。若某個方位接近 0,先查威脅判定,不要繼續。
4. **`閃躲` vs `直飛地板`** —— 地板應該在 1° 上下。倍率就是「閃躲讓預瞄點多動了幾倍」。
5. **`high` / `low` 與水平兩個的差距** —— spec 預期它們**比較差**,因為 `defendAim` 在視線接近鉛直時走的是**沒有抬角的退化路徑**。若成立,那是一個新的待辦(要不要補那條路徑),交專案負責人。
6. **`同向性`** —— 應該遠高於 0.5。低的話代表那是抽搐不是閃躲。

- [ ] **Step 4: Commit**

```bash
git add test/integration/ai-visible-evasion.test.ts
git commit -m "test: 手電筒量測四個方位的掃描"
```

---

### Task 3: 交裁定、回填門檻、全套回歸

**前置:** Task 2 的表。**沒有專案負責人的裁定就不做 Step 2 之後。**

- [ ] **Step 1: 交專案負責人**

把四列表與 Task 2 Step 3 的四點判讀交出去。要裁定的是:

- **`leadSwing` 的下限,度**(主判準)—— 依他的試玩感受定,不由現況推導
- 是否要調整**滑動窗長**(現況 1 秒)。他的敘述是「N 秒內偏移 N 度」,兩個 N 都是他的

同時要**回報**(不是請他裁定):

- **`有效窗` 實測幾秒。** 800 m 的手電筒照得住 AI 多久是幾何決定的,不是設計選的。若只有 4~5 秒,那代表「當我瞄準攻擊時」這個前提在 800 m 只成立幾秒 —— 他可能會想改 standoff,或改用別的場景。

若他的判斷是「現況不夠好」,那本身就是下一輪的入口(`defendTilt` 由 20° 調低 —— 2026-08-15 已量到 0° 讓玩家壓得住準星的時間由 6.23% 降到 1.28%),而不是把門檻降到現況之下。

- [ ] **Step 2: 回填**

```ts
/**
 * 預瞄點偏移的下限：手電筒照著 1 秒，預瞄方向的淨角位移中位數，度。
 *
 * **這就是「玩家看得出 AI 在閃」的直接判準** —— 預瞄點在玩家視角裡動了
 * 多少度，正是他手上必須修正的量。
 *
 * 【為什麼用手電筒而不是真射手】真飛機要滾轉、要拉桿才轉得過來，那些動作
 * 全都會灌進這個數字（同檔的 `ordinaryMedian` 6~11° 就是證據）。觀測儀不
 * 機動，量到的只剩 AI 自己的動作。專案負責人 2026-08-15 裁定。
 *
 * 【讀這個數字一定要並排看直飛地板】完全不閃是 1° 上下。
 *
 * 【定值】專案負責人依試玩裁定，不由掃描的現況推導 —— 那會照著現況畫靶。
 */
const LEAD_SWING_FLOOR = <負責人裁定>
```

```ts
      expect(on.leadSwing).toBeGreaterThan(LEAD_SWING_FLOOR)
```

- [ ] **Step 3: 單檔與全套**

Run: `npx vitest run test/integration/ai-visible-evasion.test.ts`
Expected: 全綠。

Run: `npx vitest run`
Expected: 與基準相同的 4 條紅(`ai-command-channel` 編隊收攏、`ai-command-channel` 命令佔時、`ai-command-tactics` 側翼方位角、`ai-withdraw-anchor` 半徑)。`perf-gate` 在全套並行下假紅,單獨跑會綠。

**本輪只在一個測試檔裡新增、不動任何 `src/`,所以多出任何一條紅都是異常。**

- [ ] **Step 4: 寫「實作結果」進 spec,commit**

含:四列掃描表、四點判讀、門檻的定值與裁定理由、`high` / `low` 是否真的比較差(以及那對 `defendAim` 鉛直退化路徑的意義)、全套紅燈清單、下一輪的入口。

```bash
git add test/integration/ai-visible-evasion.test.ts docs/superpowers/specs/2026-08-15-lead-swing-criterion-design.md
git commit -m "test: 預瞄點偏移判準回填定值 + docs: 實作結果"
```
