/**
 * 護送／攔截的實測探針。
 *
 * 量四件事，四件都是「這一輪的設計成立與否」的直接證據：
 *
 * ```
 *   一  被護送的那幾架**飛不飛得到** —— 判定要多久、還剩幾架
 *   二  它們有沒有平行飛 —— 逐秒量橫向散布與**滾轉角**（僚機走位的症狀）
 *   三  四張卡各自的結果 —— 護送贏不贏得了、攔截攔不攔得住
 *   四  沒有被護送者的那幾種任務逐字不變 —— 遭遇戰與殲滅
 * ```
 *
 * 跑法：`npx tsx test/tools/convoy.probe.ts`
 */
import { createBattle, stepBattle, DEFAULT_BATTLE } from '../../src/battle/setup'
import { missionConfigFrom } from '../../src/battle/missions'
import { AiController } from '../../src/ai/AiController'
import type { Command, Controller } from '../../src/control/Controller'
import type { Aircraft } from '../../src/aircraft/Aircraft'
import { readyCard, INTERCEPT_CARD } from '../fixtures/mission'

const DT = 1 / 240
const SEED = 20260821

/** 玩家席位放一顆什麼都不做的控制器 —— 量的是 AI 與判定，不是操作 */
class Idle implements Controller {
  update(_self: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.8
    out.brake = 0
    out.firing = false
  }
}

/** 弧度轉度 */
const DEG = 180 / Math.PI

/**
 * 由四元數求滾轉角。
 *
 * 【為什麼不直接讀某一個歐拉角】滾轉要**繞機體縱軸**量。做法是取機體右翼
 * 方向在世界座標的 y 分量 —— 平飛時為 0，滾 90° 時為 ±1。
 */
function rollDeg(a: Aircraft): number {
  const q = a.state.orientation
  // 機體 +X（右翼）轉到世界座標之後的 y 分量
  const y = 2 * (q.x * q.y + q.z * q.w)
  return Math.asin(Math.max(-1, Math.min(1, y))) * DEG
}

/** 接觸之前的秒數。**兩隊由 10 km 對頭合攏**，前 20 秒還打不到 */
const BEFORE_CONTACT = 20

interface Result {
  outcome: string
  seconds: number
  convoyLeft: number
  /** 全程橫向散布的最大值，m（被護送的那幾架的 x 極差） */
  spread: number
  /** 接觸**之前**滾轉角絕對值的最大值，度 —— 這才是「走位造成的滾轉」 */
  rollBefore: number
  /** 接觸**之後**滾轉角絕對值的最大值，度 —— 含閃彈 */
  rollAfter: number
  /** 全程滾轉角絕對值的平均，度 */
  meanRoll: number
}

/**
 * @param aiPlayer 玩家席位放 AI（代飛）而不是空控制器。**量「這一關打不打得贏」
 *                 一定要用它** —— 空控制器等於少一架，而那一架是主力。
 */
function run(
  label: string, cardId: string, aiPlayer = false, limit = 400,
): Result {
  const cfg = missionConfigFrom(readyCard(cardId))
  const b = createBattle(aiPlayer ? new AiController() : new Idle(), cfg, SEED)
  const cv = b.convoy
  if (cv === null) throw new Error(`${label}：這一場沒有被護送者`)

  let spread = 0
  let rollBefore = 0
  let rollAfter = 0
  let rollSum = 0
  let rollN = 0
  let t = 0
  const steps = Math.round(limit / DT)
  for (let i = 0; i < steps; i++) {
    stepBattle(b, DT)
    t += DT
    if (b.outcome !== 'fighting') break
    // 【每秒取樣一次】240 Hz 全取會讓平均被「大部分時間都在平飛」洗掉，
    // 而要看的是走位造成的**尖峰**
    if (i % 240 !== 0) continue
    let lo = Infinity
    let hi = -Infinity
    for (const seat of cv.seats) {
      const c = b.world.combatants[seat]!
      if (!c.alive) continue
      const x = c.aircraft.state.position.x
      if (x < lo) lo = x
      if (x > hi) hi = x
      const r = Math.abs(rollDeg(c.aircraft))
      if (t < BEFORE_CONTACT) { if (r > rollBefore) rollBefore = r }
      else if (r > rollAfter) rollAfter = r
      rollSum += r
      rollN++
    }
    if (hi > lo && hi - lo > spread) spread = hi - lo
  }

  let left = 0
  for (const seat of cv.seats) if (b.world.combatants[seat]!.alive) left++
  return {
    outcome: b.outcome,
    seconds: t,
    convoyLeft: left,
    spread,
    rollBefore,
    rollAfter,
    meanRoll: rollN > 0 ? rollSum / rollN : 0,
  }
}

const CARDS: Array<[string, string]> = [
  ['護送 B-17（盟 M1）', 'allies-m1'],
  ['攔截 B-17（測試卡）', INTERCEPT_CARD],
]

function table(title: string, aiPlayer: boolean): void {
  console.log(title)
  console.log('卡片                     結局      秒數   剩餘  橫向散布  滾轉前  滾轉後  平均')
  for (const [label, id] of CARDS) {
    const r = run(label, id, aiPlayer)
    console.log(
      `${label.padEnd(20)} ${r.outcome.padEnd(9)} ${r.seconds.toFixed(1).padStart(6)}`
      + ` ${String(r.convoyLeft).padStart(5)} ${r.spread.toFixed(0).padStart(9)} m`
      + ` ${r.rollBefore.toFixed(1).padStart(6)}° ${r.rollAfter.toFixed(1).padStart(6)}°`
      + ` ${r.meanRoll.toFixed(1).padStart(5)}°`,
    )
  }
  console.log('')
}

/** 表一：玩家席位空著 —— 量的是「AI 自己打成什麼樣」 */
table('── 表一：玩家不動（Idle）─────────────────────', false)
/** 表二：玩家席位交給 AI 代飛 —— 量的是「這一關打不打得贏」 */
table('── 表二：玩家席位由 AI 代飛 ──────────────────', true)

/**
 * 表三：攔截打不贏的消融。
 *
 * 四張卡的攔截都輸、而且**轟炸機一架都沒掉**。要分清楚是機制壞了還是配置
 * 太難，唯一的辦法是量「轟炸機到底有沒有挨過打」：
 *
 * ```
 *   血量掉了但沒死  →  打得到，只是不夠時間／火力  →  配置問題
 *   血量一格沒掉    →  根本沒有人去打它            →  機制或目標挑選問題
 * ```
 */
console.log('── 表三：攔截的消融（玩家由 AI 代飛）─────────')
console.log('護航機  終點距離   結局      秒數   轟炸機剩  轟炸機血量（各架 %）')
for (const escorts of [0, 2, 4]) {
  for (const dist of [12000, 20000]) {
    const base = readyCard(INTERCEPT_CARD)
    const card = { ...base, redCount: escorts, targetDistance: dist }
    const cfg = missionConfigFrom(card)
    const b = createBattle(new AiController(), cfg, SEED)
    const cv = b.convoy!
    let t = 0
    for (let i = 0; i < Math.round(400 / DT); i++) {
      stepBattle(b, DT)
      t += DT
      if (b.outcome !== 'fighting') break
    }
    const hp = cv.seats.map((s) => {
      const c = b.world.combatants[s]!
      return c.alive ? `${Math.round((c.hp / c.aircraft.spec.hp) * 100)}` : '死'
    })
    let left = 0
    for (const s of cv.seats) if (b.world.combatants[s]!.alive) left++
    console.log(
      `${String(escorts).padStart(6)} ${String(dist).padStart(9)}`
      + `   ${b.outcome.padEnd(9)} ${t.toFixed(1).padStart(6)} ${String(left).padStart(9)}`
      + `  ${hp.join(' / ')}`,
    )
  }
}
console.log('')

/**
 * 表四：攔截要多少火力才打得完。
 *
 * 表三已經定位出兩件互相疊加的事：護航機把目標**全部**吸走，而且就算沒有
 * 護航機，火力也不夠。這一張把第二件量成數字 —— 掃「攔截機數 × 轟炸機數」，
 * 護航機一律 0（先把第一件隔離掉）。
 */
console.log('── 表四：火力夠不夠（0 護航機、12 km、AI 代飛）──')
console.log('攔截機  轟炸機   結局      秒數   轟炸機剩   血量（各架 %）')
for (const fighters of [4, 8, 12]) {
  for (const bombers of [1, 2, 4]) {
    const base = readyCard(INTERCEPT_CARD)
    const card = { ...base, blueCount: fighters, redCount: 0, convoyCount: bombers }
    const cfg = missionConfigFrom(card)
    const b = createBattle(new AiController(), cfg, SEED)
    const cv = b.convoy!
    let t = 0
    for (let i = 0; i < Math.round(400 / DT); i++) {
      stepBattle(b, DT)
      t += DT
      if (b.outcome !== 'fighting') break
    }
    const hp = cv.seats.map((s) => {
      const c = b.world.combatants[s]!
      return c.alive ? `${Math.round((c.hp / c.aircraft.spec.hp) * 100)}` : '死'
    })
    let left = 0
    for (const s of cv.seats) if (b.world.combatants[s]!.alive) left++
    console.log(
      `${String(fighters).padStart(6)} ${String(bombers).padStart(7)}`
      + `   ${b.outcome.padEnd(9)} ${t.toFixed(1).padStart(6)} ${String(left).padStart(9)}`
      + `   ${hp.join(' / ')}`,
    )
  }
}
console.log('')

/**
 * 表五：`convoyPriority` 的掃描。**這一輪的主判準。**
 *
 * 表三定位出「只要有護航機，轟炸機一發都不會挨到」。這一張直接掃那個偏置，
 * 兩張卡都掃 —— 護送與攔截吃的是**同一個機制的兩側**，所以它們必須一起看：
 * 偏置調高會讓攔截變容易、同時讓護送變難。
 *
 * 【怎麼看這張表】要找的不是「攔截贏」，是**轟炸機開始掉血**。勝負由編制
 * 決定（表四），而這個旋鈕決定的是「火力有沒有落在該落的地方」。
 */
console.log('── 表五：convoyPriority 掃描（AI 代飛）──────────')
console.log('偏置   卡片              結局      秒數   轟炸機剩   血量（各架 %）')
for (const bias of [1, 2, 3, 5]) {
  for (const [label, id] of [
    ['攔截', INTERCEPT_CARD],
    ['護送', 'allies-m1'],
  ] as const) {
    const base = readyCard(id)
    const cfg = missionConfigFrom(
      { ...base, battle: { ...base.battle, convoyPriority: bias } })
    const b = createBattle(new AiController(), cfg, SEED)
    const cv = b.convoy!
    let t = 0
    for (let i = 0; i < Math.round(400 / DT); i++) {
      stepBattle(b, DT)
      t += DT
      if (b.outcome !== 'fighting') break
    }
    const hp = cv.seats.map((s) => {
      const c = b.world.combatants[s]!
      return c.alive ? `${Math.round((c.hp / c.aircraft.spec.hp) * 100)}` : '死'
    })
    let left = 0
    for (const s of cv.seats) if (b.world.combatants[s]!.alive) left++
    console.log(
      `${String(bias).padStart(4)}   ${label.padEnd(16)} ${b.outcome.padEnd(9)}`
      + ` ${t.toFixed(1).padStart(6)} ${String(left).padStart(9)}`
      + `   ${hp.join(' / ')}`,
    )
  }
}
console.log('')

/** 表二：沒有被護送者的那幾種，確認一個字都沒變 */
console.log('')
console.log('── 表二：沒有被護送者的場次 ──────────────────')
{
  const b = createBattle(new Idle(), DEFAULT_BATTLE, SEED)
  console.log(`遭遇戰 20v20   convoy = ${b.convoy === null ? 'null' : '不是 null（錯）'}`
    + `   下令端分隊 ${b.blueOrderFlights.length} + ${b.redOrderFlights.length}`
    + `   全部分隊 ${b.flights.flights.length}`)
}
for (const id of ['japan-m3'] as const) {
  const card = readyCard(id)
  const b = createBattle(new Idle(), missionConfigFrom(card), SEED)
  console.log(`${card.title.padEnd(12)} convoy = ${b.convoy === null ? 'null' : '不是 null（錯）'}`
    + `   規則 ${b.cfg.rules.kind}`)
}

/** 表三：編組表本身 —— 誰在哪一層、誰是 transit */
console.log('')
console.log('── 表三：護送 B-17 的編組表 ──────────────────')
{
  const card = readyCard('allies-m1')
  const cfg = missionConfigFrom(card)
  console.log('隊伍  職責     架數  機種      lane    tier  玩家')
  for (const u of cfg.units) {
    console.log(
      `${u.team.padEnd(5)} ${u.duty.padEnd(8)} ${String(u.members.length).padStart(4)}`
      + `  ${u.members[0]!.id.padEnd(9)} ${u.lane.toFixed(2).padStart(6)}`
      + ` ${String(u.tier).padStart(5)}  ${u.player === true ? '★' : ''}`,
    )
  }
  const b = createBattle(new Idle(), cfg, SEED)
  console.log('')
  console.log('被護送的那幾架：座位 / 出生座標 / 各自的終點')
  const cv = b.convoy!
  for (let i = 0; i < cv.seats.length; i++) {
    const p = b.world.combatants[cv.seats[i]!]!.aircraft.state.position
    const g = cv.points[i]!
    console.log(
      `  座位 ${String(cv.seats[i]).padStart(2)}`
      + `  出生 (${p.x.toFixed(0).padStart(6)}, ${p.y.toFixed(0)}, ${p.z.toFixed(0).padStart(6)})`
      + `  終點 (${g.x.toFixed(0).padStart(6)}, ${g.y.toFixed(0)}, ${g.z.toFixed(0).padStart(7)})`,
    )
  }
  console.log(`判定點 (${cv.goal.x.toFixed(0)}, ${cv.goal.y.toFixed(0)}, ${cv.goal.z.toFixed(0)})`
    + `   半徑 ${b.mission.targetRadius}`)
  // 【最外側那一架到判定點的橫向距離必須小於半徑】否則它永遠判不到
  const worst = Math.max(...cv.points.map((p) => Math.abs(p.x - cv.goal.x)))
  console.log(`最外側的橫向偏移 ${worst.toFixed(0)} m ——`
    + ` ${worst < b.mission.targetRadius ? '在半徑內 ✓' : '超出半徑 ✗'}`)
  console.log(`接手名單排除 ${cv.seats.length} 個座位`
    + `　控制器是 AI：${cv.seats.every((s) => b.world.combatants[s]!.controller instanceof AiController)}`)
}
