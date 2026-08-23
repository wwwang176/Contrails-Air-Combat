/**
 * **護送關的玩家座位（AI 代飛）逐拍軌跡 —— 交會之後為什麼掉到轟炸機下面？**
 * 不是測試（`.probe.ts`）。跑法：
 *   npx vite-node test/tools/escort-trace.probe.ts > trace.json
 *
 * 【人工回報，2026-08-23】Bf 109 護送 He 111，本來高度很高；迎頭遇上 P-51、
 * 交會結束（P-51 由前方衝到後方）之後，109 **低頭迴轉而不是水平迴轉**，
 * 能量掉很多、進 `extend`，而且高度已經遠低於 He 111，來不及拉回去。
 *
 * 【要分辨的候選機制】低頭可能來自五個不同的地方，它們在資料上長得不一樣：
 *
 *   speedRecover     安全層主動壓機頭 `speedRecoverPitch`——`mode` 會是它
 *   extendPitchAngle 意圖層換速度，速度赤字 0.25 就給滿俯衝——`intent` 是 extend
 *   overshoot        高 yo-yo，`mode` 會是它
 *   sweetPitch       109 在高速是**抬頭** +10°，方向相反，不該是嫌疑犯
 *   純物理           大坡度轉彎時升力的垂直分量不夠，飛機自己往下掉，
 *                    **沒有任何一層在命令低頭**——這一種 `mode` 是 normal、
 *                    `intent` 是 engage/defend，而且 bank 很大
 *
 * 最後一種與前四種的處置完全不同（那是拉桿量不足，不是誰下錯指令），所以
 * 這一支把 `intent`、`mode`、坡度、航跡角、指令俯仰**同時**記下來。
 *
 * 【為什麼玩家座位交給 AI】人工回報的是「我開 109、AI 代飛」時看到的。
 * `createBattle` 的第一個參數就是玩家的 controller，傳 `AiController` 即可。
 *
 * 【輸出】stdout 一份 JSON，給 `escort-trace.html` 用。全程取樣 + 自動框出
 * 「掉到轟炸機下面」的那一段。
 */
import { createBattle, stepBattle } from '../../src/battle/setup'
import { MISSIONS, missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import { Vector3 } from 'three'
import type { Combatant } from '../../src/world/World'
import { instantaneousTurnRate } from '../../src/analysis/envelope'
import { DEFAULT_STEER } from '../../src/ai/steer'

const DT = 1 / 240
const SECONDS = 300
const SEED = 20260805
const STRIDE = 12
const STEP = DT * STRIDE

/** 一個取樣點。欄位名短是因為要進 JSON，3,000 筆 */
interface Sample {
  t: number
  /** 玩家位置 */
  x: number, y: number, z: number
  /** 航跡角（速度向量相對地平線），度。正 = 爬升 */
  ga: number
  /** 坡度，度。正 = 右滾 */
  bk: number
  /** 空速，m/s */
  v: number
  intent: string
  mode: string
  /** TAS ÷ 角落速度 */
  cr: number
  /** 比能量差（對當前目標），m */
  ea: number
  /** 指令的航跡角（aimWorld 相對地平線），度 —— 與 ga 對照就知道是誰在低頭 */
  cmd: number
  /** 被護送單位的平均高度，m */
  by: number
  /** 當前目標的位置與距離；沒有目標時 tr < 0 */
  tx: number, ty: number, tz: number, tr: number
  /**
   * 目標在我的**前半球**還是後半球：我的速度向量與「指向他」的夾角，度。
   * < 90 = 他在我前面
   */
  ta: number
  /** 瞄準方向（單位向量）—— 畫「它到底在指哪裡」 */
  ax: number, ay: number, az: number
  /** 自機姿態四元數 —— 3D 視圖要靠它畫出坡度與機頭指向 */
  qx: number, qy: number, qz: number, qw: number
  /** 目標姿態四元數；沒有目標時全 0 */
  ox: number, oy: number, oz: number, ow: number
  /**
   * 比超量功率，m/s。`ps` 差 = **繼續纏鬥下去誰會先撐不住** ——
   * `airframeTurnAdvantage` 是狀態，這一個是趨勢。
   */
  ps: number, pst: number
  /**
   * **機體**迴旋優勢，rad/s。負 = 我的機體轉不贏他。
   * `DEFAULT_RULES.turnEnter` 是 −0.02 —— 低於它 `extendTurnLatch` 就該點著。
   */
  at: number
  /** 交會時間 s 與進入角 度 —— 回答「`merge` 為什麼沒出現」 */
  tm: number, asp: number
  /** 接近率，m/s。正 = 正在拉近 */
  clo: number
  /** 視線角速度，°/s —— 「機頭跟不跟得上預瞄點」的直接量度 */
  lr: number
  /** 我在當下高度與空速的**瞬時**轉彎率上限，°/s —— 拿來跟 lr 比 */
  str: number
  /**
   * 四個閂鎖的位元遮罩：1 = 能量、2 = 迴旋、4 = 見底、8 = 破防。
   * 「該擋的閘門有沒有響」直接看這一欄。
   */
  L: number
}

const DEG = 180 / Math.PI

function main(): void {
  const card = MISSIONS.axis.find((m) => m.id === 'axis-escort')!
  const b = createBattle(new AiController(), missionConfigFrom(card, 'axis'), SEED)

  const me: Combatant = b.player
  const ai = me.controller
  if (!(ai instanceof AiController)) throw new Error('玩家座位不是 AI 代飛')

  const guarded = b.world.combatants.filter((c) => b.board.protectedMask[c.index] !== 0)

  const out: Sample[] = []
  const fwd = new Vector3()
  const right = new Vector3()
  const los = new Vector3()
  let t = 0

  for (let k = 0; k < Math.round(SECONDS / DT); k++) {
    stepBattle(b, DT)
    if (k % STRIDE !== 0) continue
    t += STEP
    if (!me.alive) break

    const a = me.aircraft
    const p = a.state.position
    const vel = a.state.velocity
    const speed = vel.length()

    // 航跡角：速度向量相對地平線
    const ga = speed > 1e-3 ? Math.asin(vel.y / speed) * DEG : 0

    // 坡度：右翼向量的垂直分量。機翼水平時為 0，右滾時右翼下沉
    right.set(1, 0, 0).applyQuaternion(a.state.orientation)
    const bk = -Math.asin(Math.max(-1, Math.min(1, right.y))) * DEG

    // 指令的航跡角 —— 與實際航跡角對照，就知道低頭是被命令的還是掉下去的
    const aim = me.command.aimWorld
    const ah = Math.hypot(aim.x, aim.z)
    const cmd = Math.atan2(aim.y, ah) * DEG

    let by = 0
    let n = 0
    for (const g of guarded) if (g.alive) { by += g.aircraft.state.position.y; n++ }
    by = n > 0 ? by / n : Number.NaN

    const r = ai.rules
    const tgt = ai.target
    let tx = 0, ty = 0, tz = 0, tr = -1, ta = 0
    let ox = 0, oy = 0, oz = 0, ow = 0
    if (tgt !== null) {
      const q = tgt.state.orientation
      ox = q.x; oy = q.y; oz = q.z; ow = q.w
      const tp = tgt.state.position
      tx = tp.x; ty = tp.y; tz = tp.z
      los.copy(tp).sub(p)
      tr = los.length()
      if (tr > 1e-3 && speed > 1e-3) {
        fwd.copy(vel).divideScalar(speed)
        ta = Math.acos(Math.max(-1, Math.min(1, los.dot(fwd) / tr))) * DEG
      }
    }

    out.push({
      t: +t.toFixed(2),
      x: +p.x.toFixed(1), y: +p.y.toFixed(1), z: +p.z.toFixed(1),
      ga: +ga.toFixed(2), bk: +bk.toFixed(2), v: +speed.toFixed(1),
      intent: ai.intent, mode: ai.mode,
      cr: +ai.sit.cornerRatio.toFixed(3),
      ea: Math.round(ai.sit.energyAdvantage),
      cmd: +cmd.toFixed(2),
      by: +by.toFixed(1),
      tx: +tx.toFixed(1), ty: +ty.toFixed(1), tz: +tz.toFixed(1),
      tr: +tr.toFixed(1), ta: +ta.toFixed(1),
      ax: +aim.x.toFixed(4), ay: +aim.y.toFixed(4), az: +aim.z.toFixed(4),
      qx: +a.state.orientation.x.toFixed(4), qy: +a.state.orientation.y.toFixed(4),
      qz: +a.state.orientation.z.toFixed(4), qw: +a.state.orientation.w.toFixed(4),
      ox: +ox.toFixed(4), oy: +oy.toFixed(4), oz: +oz.toFixed(4), ow: +ow.toFixed(4),
      ps: +ai.sit.psSelf.toFixed(2), pst: +ai.sit.psTarget.toFixed(2),
      at: +ai.sit.airframeTurnAdvantage.toFixed(4),
      tm: Number.isFinite(ai.sit.timeToMerge) ? +ai.sit.timeToMerge.toFixed(2) : -1,
      asp: +(ai.sit.aspectAngle * DEG).toFixed(1),
      clo: +ai.sit.closureRate.toFixed(1),
      lr: +(ai.sit.losRate * DEG).toFixed(1),
      str: +(instantaneousTurnRate(a.spec, a.state.position.y, speed) * DEG).toFixed(1),
      L: (r.extendEnergyLatch ? 1 : 0) | (r.extendTurnLatch ? 2 : 0)
        | (r.extendFloorLatch ? 4 : 0) | (r.defendLatch ? 8 : 0),
    })
  }

  // 【自動框出那一段】人工回報的形狀是「本來高很多 → 交會 → 掉到轟炸機
  // 下面」。找高度差第一次由 >= +400 掉到 <= -400 的那一段，前後各留 25 s。
  let hiAt = -1
  let loAt = -1
  for (let i = 0; i < out.length; i++) {
    const d = out[i]!.y - out[i]!.by
    if (!Number.isFinite(d)) continue
    if (hiAt < 0 && d >= 400) hiAt = i
    if (hiAt >= 0 && d <= -400) { loAt = i; break }
  }
  const pad = Math.round(25 / STEP)
  const from = loAt >= 0 ? Math.max(0, hiAt - pad) : 0
  const to = loAt >= 0 ? Math.min(out.length - 1, loAt + pad) : out.length - 1

  // ── 主判準 ──────────────────────────────────────────────
  //
  // 三個量都是**行為的絕對量測**，不是效率。判準是「玩起來合不合理」——
  // 攻擊效率有沒有提高沒差，那只是附加價值。
  //
  // 【量測窗必須與結果無關】上面那個事件窗的條件是「曾掉到轟炸機下方 400 m」
  // —— 而那正是這一輪要修掉的東西。沿用它的話**修好之後窗就框不出來、摘要
  // 變成空的**，成功反而讀不到數字。這裡改用**交會**當錨點：目標距離第一次
  // 進到 600 m 以內。那件事不論修得成不成功都會發生。
  const MERGE_RANGE = 600
  const LEAD_IN = 10
  const SPAN = 40
  // 坡度低於這個值算「機翼接近水平」。第一段要量的是**平飛時主動壓了多少
  // 機頭**，把已經明顯滾轉的取樣算進來就會混進第二段的「大坡度撐不住」。
  const BANK_LEVEL = 10

  let mergeAt = -1
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!
    if (s.tr > 0 && s.tr < MERGE_RANGE) { mergeAt = i; break }
  }
  if (mergeAt < 0) {
    console.error('主判準  這一場沒有交會（目標距離從未進到 ' + MERGE_RANGE + ' m）')
  } else {
    const lo = Math.max(0, mergeAt - Math.round(LEAD_IN / STEP))
    const hi = Math.min(out.length - 1, mergeAt + Math.round(SPAN / STEP))
    const win = out.slice(lo, hi + 1)

    // 谷底 = 窗內高度最低的取樣
    let trough = win[0]!
    for (const s of win) if (s.y < trough.y) trough = s
    // 峰值 = 谷底**之前**高度最高的取樣
    let peak = win[0]!
    for (const s of win) {
      if (s.t >= trough.t) break
      if (s.y > peak.y) peak = s
    }
    // 第一段 = 峰值之後、坡度首次超過 BANK_LEVEL 之前
    let dive = 0
    for (const s of win) {
      if (s.t < peak.t) continue
      if (Math.abs(s.bk) > BANK_LEVEL) break
      if (s.cmd < dive) dive = s.cmd
    }
    // 【`by` 可能是 NaN】被護送單位全滅時沒有平均高度可言
    const gap = Number.isFinite(trough.by) ? (trough.y - trough.by).toFixed(0) : 'n/a'
    console.error(
      '主判準  谷底對轟炸機 ' + gap + ' m'
      + '  |  峰值→谷底 ' + (peak.y - trough.y).toFixed(0) + ' m'
      + '  |  第一段指令 γ 極值 ' + dive.toFixed(1) + '°'
      + '  |  谷底 ' + trough.y.toFixed(0) + ' m @ ' + trough.t.toFixed(1) + ' s'
      + '  |  交會 @ ' + out[mergeAt]!.t.toFixed(1) + ' s',
    )
  }

  console.log(JSON.stringify({
    card: 'axis-escort', seed: SEED, step: STEP,
    spec: me.aircraft.spec.name ?? 'Bf 109',
    // 事件窗；loAt < 0 表示這一次沒有出現回報的那個形狀
    event: loAt >= 0 ? { hiAt, loAt, from, to } : null,
    samples: out,
  }))
}
/**
 * 【設定覆寫】`TP` 是一段 JSON，逐欄蓋掉 `DEFAULT_STEER`。A/B 與掃描都用它：
 *
 *   TP='{"trackEnter":0}'      —— 整個機制關掉，等於改動前
 *   TP='{"trackHold":5}'       —— 掃描單一參數
 *
 * 【為什麼直接改 `DEFAULT_STEER`】`AiController` 不帶自己的 `SteerConfig`，
 * 走的就是這個預設物件。探針是一次性的行程，就地改比穿一整條參數鏈誠實。
 *
 * 【PowerShell 注意】`$env:TP` 會留在整個工作階段，下一次跑會沉默地沿用。
 * 用 bash 的 `TP=... npx ...`，或每次跑完 `Remove-Item Env:TP`。
 */
// 【就地宣告而不裝 @types/node】與 `b17-ref.measure.ts` 同一個做法 ——
// 不為一支探針多一條開發相依
declare const process: { env: Record<string, string | undefined> }

const override = process.env.TP
if (override !== undefined && override !== '') {
  Object.assign(DEFAULT_STEER, JSON.parse(override) as Partial<typeof DEFAULT_STEER>)
  console.error('TP override: ' + override)
}

main()
