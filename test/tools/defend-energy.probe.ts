/**
 * `defendEnergyGain` 的掃描。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/defend-energy.probe.ts
 * 低空壓力測試：npx vite-node test/tools/defend-energy.probe.ts low
 *
 * 【與 `defend-tilt.probe.ts` 共用同一支量測】兩者都 import `./drift`，所以
 * 兩張表的「結束高度」與「回落」定義保證相同、可以直接比。
 *
 * 【主判準見 spec §3.1】結束高度漲幅要降，且回落要比 0×錨 明顯變大。
 *
 * 【副判準只報不擋】extend／engage 佔時。若高度降下來而它們沒動，那就證明
 * 「高度 → 角落速度 → extend」的因果鏈是錯的 —— 那個資訊本身就是這次要買的
 * 東西，而只有把它們放在副判準的位置才問得出來。（Task 0 的消融已經給了
 * 不利的初步證據：高度降 1000 m，extend 佔時在一個開局微降、另一個反而上升。）
 *
 * 【否決條件不只安全層】2026-08-13 的前兩次調參失敗都栽在 `safetyShare`
 * （`cornerEnter` 那一輪衝到 65.6%，上限 5%）。但 `safetyAction` 只記
 * `applySafety`，**看不到 `steerCommand` 裡的 `applyFloor`** —— 壓機頭在低空
 * 可能整段被地板接住，那時安全層不會漲，表面上很安全，實際上是地板在替 AI
 * 飛。所以 `floorShare`、`minAlt`、存活數三者一起當否決。
 *
 * 【低空模式】spec §5 風險三：壓機頭在低空是危險的，而 `applyFloor` 從未在
 * 「破防 + 低空 + 低速」三者同時成立時被壓力測試過。`low` 參數把開局換成
 * 1000 m 與 600 m。
 *
 * 【`defendEnergyLimit` 這一輪不掃】它是安全上限而不是調校旋鈕 —— 40° 的
 * 理由是「壓機頭不該變成翻過去」，與效果無關。但這代表高倍率的那幾列量到的
 * 是 gain 與 limit 的**混合**效果（赤字 0.5 以上就撞飽和），挑值時要看
 * `floorShare` 與 `minAlt` 才知道有沒有撞到。
 *
 * 【0×錨 是恆等基準】與這一層不存在時逐位元相同。
 */
import { DEFAULT_STEER } from '../../src/ai/steer'
import { DEFAULT_RULES } from '../../src/ai/rules'
import { measureDrift, showDrift, DRIFT_HEADER, OPENINGS, type Opening } from './drift'

/** 錨：`cornerRatio` 掉到 `cornerEnter` 時剛好抵銷 `defendTilt` */
const ANCHOR = DEFAULT_STEER.defendTilt / (1 - DEFAULT_RULES.cornerEnter)

const LOW: readonly Opening[] = [
  { name: '1000/200', altitude: 1000, tas: 200 },
  { name: '600/180', altitude: 600, tas: 180 },
]

const low = (globalThis as { process?: { argv?: string[] } })
  .process?.argv?.includes('low') ?? false
const openings = low ? LOW : OPENINGS

console.log(
  `20v20、420 秒、VETERAN、${low ? '**低空**' : ''}兩個開局。`
  + `錨 = ${(ANCHOR * 180 / Math.PI).toFixed(0)}° / 單位速度赤字\n`,
)
console.log(DRIFT_HEADER)
for (const mult of [0, 0.5, 1, 1.5, 2]) {
  for (const o of openings) {
    const saved = DEFAULT_STEER.defendEnergyGain
    DEFAULT_STEER.defendEnergyGain = mult * ANCHOR
    try {
      showDrift(`${mult.toFixed(1)}×錨`, o, measureDrift(o))
    } finally {
      DEFAULT_STEER.defendEnergyGain = saved
    }
  }
}
console.log('\n【怎麼讀】0.0×錨 是恆等基準，每一欄都跟同一開局的它比。')
console.log('　主判準：漲幅要降（幅度 > 393 m 才算數），且回落要明顯變大。')
console.log('　否決（任一成立就淘汰）：安全層上升、地板佔比上升、最低高度變低、')
console.log('　　　存活數變少。低空那一輪尤其要看 —— 高度降下來若是「掉下去死掉」')
console.log('　　　或「靠地板抬回來」，死亡機會立刻退出中位，表面上反而好看。')
console.log('　通過的候選裡取**最小 gain**，不是取漲幅最低的。')
