/**
 * **側翼與集火這兩個戰術，執行了到底有沒有比較好。**
 * 不是測試（`.probe.ts`）。跑法：npx vite-node test/tools/tactics-effect.probe.ts
 *
 * 【為什麼這三個數字不是護欄】它們回答的是「這個戰術是不是個好主意」——
 * 設計判斷，由試飛裁定。護欄回答的是另一個問題：「命令發出去之後，飛機
 * 有沒有照做」，那是是非題，一場仗就答得完，守在
 * `test/integration/ai-command-tactics.test.ts`。
 *
 * ── 【為什麼要跑十九場】──────────────────────────────
 *
 * 因為模擬是**完全決定性的**：同一組設定跑一百次會跑出一百場逐位元相同的
 * 仗，seed 只拿去取飛行員名字，不進物理路徑。所以「多跑幾次取平均」在這裡
 * 不存在。
 *
 * 唯一能生出不同軌跡的是**換一支分隊來接命令** —— 位置不同、對手不同、
 * 機種也不同。方位角一場只收得到約 66 個取樣（受命分隊在命令期間本來就
 * 不開火，自由窗口天然很短），九支分隊合併才約 600 個。
 *
 * ```
 *    1 場   對照：什麼命令都不下，同時建逐步方位角索引
 *    9 場   側翼：每支受命分隊各一場
 *    9 場   集火：每支受命分隊各一場
 * ```
 *
 * ── 【看數字時要知道的三件事】────────────────────────
 *
 * **一、方位角一定要看時間對齊的那一對。** 方位角受戰局階段支配的程度
 * 遠大於戰術本身：同一批分隊不下任何命令，整場 +0.858、後半場 −0.600
 *（開場對頭接面是正值，後期咬尾是負值）。任何把開火時機往後推的處理都會
 * 讓它變好看，而側翼恰恰就會 —— 繞路途中不開槍。沒對齊的比較給出
 * 0.061 對 0.769 的「大勝」，**那完全是時間效應**，所以兩個都印。
 *
 * **二、集火的分母取同一場、同一隊的其他敵機。** 「這場仗打得兇不兇」
 * 因此自動消掉，不需要對照組。
 *
 * **三、參考線是跑之前定死的**（方位角低 0.05 以上且 n ≥ 300、集火 1.5 倍、
 * 總傷害不低於對照的 0.55）。看到結果再定線等於量到綠為止。超出參考線
 * 不代表壞掉 —— 那是要人去判斷的事。
 */
import {
  allVictims, observe, runControl, merge, type Observed,
} from './tactics-observe'

const VICTIMS = allVictims()

const { ctrl, run: off } = runControl(VICTIMS)
const flankRuns: Observed[] = VICTIMS.map((v) => observe('flank', v, ctrl))
const focusRuns: Observed[] = VICTIMS.map((v) => observe('focus', v))
const flank = merge(flankRuns)
const focus = merge(focusRuns)

const mark = (ok: boolean): string => (ok ? '　' : '←超出參考線')

console.log(`受命分隊 ${VICTIMS.length} 支，共跑 ${1 + flankRuns.length + focusRuns.length} 場\n`)

// 側翼：開火那一刻的方位角。越接近 −1 代表越是從他背後打
{
  const on = flank.matchedOnSum / Math.max(flank.matchedOnCount, 1)
  const base = flank.matchedOffSum / Math.max(flank.matchedOffCount, 1)
  const naiveOn = flank.aspectSumOwn / Math.max(flank.aspectCountOwn, 1)
  const naiveOff = off.aspectSumOwn / Math.max(off.aspectCountOwn, 1)
  console.log('【側翼】開火時的方位角（越負越是從背後打）')
  console.log(`  時間對齊   側翼 ${on.toFixed(3)}　對照 ${base.toFixed(3)}`
    + `　差 ${(on - base).toFixed(3)}　參考 ≤ −0.05`
    + mark(on <= base - 0.05))
  console.log(`  取樣數     ${flank.matchedOnCount} vs ${flank.matchedOffCount}`
    + `　參考 ≥ 300` + mark(flank.matchedOnCount >= 300))
  console.log(`  未對齊     側翼 ${naiveOn.toFixed(3)}　對照 ${naiveOff.toFixed(3)}`
    + '　←這一對是時間效應，不要拿來下結論')
}

// 集火：被指名那一架掉血有沒有比同隊其他敵機快
{
  const focused = focus.focusedLoss / Math.max(focus.focusedTime, 1e-9)
  const others = focus.othersLoss / Math.max(focus.othersTime, 1e-9)
  console.log('\n【集火】被指名那一架的掉血速率')
  console.log(`  被指名 ${focused.toFixed(4)} hp/s　其他敵機 ${others.toFixed(4)} hp/s`
    + `　比值 ${(focused / Math.max(others, 1e-9)).toFixed(3)}　參考 ≥ 1.5`
    + mark(focused > others * 1.5))
  console.log(`  指名時間 ${focus.focusedTime.toFixed(1)} s`)
}

// 總傷害：側翼會減少交戰時間，但不該讓整場仗停擺
{
  const on = (flank.redDamage + flank.blueDamage) / flankRuns.length
  const base = off.redDamage + off.blueDamage
  console.log('\n【側翼】整場總傷害（側翼會縮短交戰時間，但不該讓仗停擺）')
  console.log(`  側翼每場 ${on.toFixed(0)}　對照 ${base.toFixed(0)}`
    + `　比值 ${(on / Math.max(base, 1)).toFixed(3)}　參考 ≥ 0.55`
    + mark(on > base * 0.55))
}
