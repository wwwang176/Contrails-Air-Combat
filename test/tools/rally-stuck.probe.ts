/**
 * 「集合令永遠解除不掉」的**定位**探針。**不是測試**（`.probe.ts`）。
 * 跑法：npx vite-node test/tools/rally-stuck.probe.ts
 *
 * 【人工回報】種子 1184178389、座位 #8（上帝視角、AI 代飛）：
 * 一張 `rally` 從 t=196s 握到 t=392s 都沒解除，期間 HUD 顯示的
 * 「離集合點」多次進到判定半徑內（t=227s 296 m、t=392s 145 m／判定 300 m），
 * 命令卻仍是第 1 張。症狀是那一架在集合點附近無限繞圈、航跡角在 ±75° 之間
 * 上下甩 —— 也就是「原地垂直繞圈」。
 *
 * 【解除的判準是什麼】`stepCommand` 的 rally 分支呼叫 `leaderDistance`：
 * 掃 `flight.members`，取**第一個存活成員**的距離。而 HUD 印的是**玩家
 * 自己那一架**的距離。兩者是不是同一架，就是這支探針要問的第一件事。
 *
 * 【為什麼要探針而不是讀碼】已經讀過一輪：快照的 `position` 是活參考
 * （`c.aircraft.state.position`）、解除分支沒有提早 `continue`、命令物件
 * 每次新配置所以 HUD 的「第幾張」是可信的。三條都排除了，剩下的要靠量。
 *
 * 【量什麼】每一張 rally 命令的一生：
 *   - 長機（`leaderDistance` 認的那一架）離集合點的**最近**距離
 *   - 全隊任一架離集合點的**最近**距離，以及那是誰
 *   - 長機這個身分在命令期間換過幾次
 * 若「任一架最近」進得了圈而「長機最近」進不了，病因就是**判錯了架**。
 * 若連長機最近距離都 < 半徑卻沒解除，那是解除路徑本身壞了。
 */
import { createBattle, stepBattle, type Battle } from '../../src/battle/setup'
import { battleConfigFrom, DEFAULT_SKIRMISH } from '../../src/battle/skirmish'
import { AiController } from '../../src/ai/AiController'
import type { CommandState, CommandUnit, FlightOrder } from '../../src/ai/command'
import type { Flight } from '../../src/battle/flights'

const DT = 1 / 240
const SECONDS = 600
/**
 * 每幾個物理步取樣一次。
 *
 * 【為什麼是 1】第一版用 24（0.1 秒）量到「長機最近距離中位 305 m、從未進圈」，
 * 差點據此宣告「判定半徑比迴轉半徑小」。那是**取樣假象**：400 km/h 下 0.1 秒
 * 飛 11 m，而解除檢查是每個物理步跑的 —— 真正的最近距離落在取樣格之間。
 * 邊界問題必須用與被測邏輯相同的節奏量。
 */
const STRIDE = 1

/** 與 `command.ts` 的 `leaderDistance` 逐字相同：第一個存活成員 */
function leaderOf(flight: Flight, units: readonly CommandUnit[]): number {
  for (let i = 0; i < flight.count; i++) {
    const u = units[flight.members[i]!]
    if (u === undefined || !u.alive) continue
    return flight.members[i]!
  }
  return -1
}

function dist(u: CommandUnit, p: { x: number, y: number, z: number }): number {
  return Math.hypot(u.position.x - p.x, u.position.y - p.y, u.position.z - p.z)
}

interface Track {
  order: FlightOrder
  since: number
  minLeader: number
  minAny: number
  minAnyWho: number
  /** 長機換過幾次人 */
  leaderChanges: number
  lastLeader: number
  /** 取樣中「長機在圈內」的次數 */
  leaderInside: number
  /** 取樣中「任一架在圈內」的次數 */
  anyInside: number
  samples: number
}

function run(name: string, altitude: number, tas: number): void {
  const cfg = { ...battleConfigFrom(DEFAULT_SKIRMISH), altitude, tas }
  const b: Battle = createBattle(new AiController(), cfg, 20260813)
  const units = b.commandUnits
  const fs = b.flights.flights
  const states: CommandState[] = [b.blueCommand, b.redCommand]
  const live = new Map<number, Track>()
  const done: Track[] = []

  let t = 0
  for (let s = 0; s < Math.round(SECONDS / DT); s++) {
    stepBattle(b, DT)
    t += DT
    if (s % STRIDE !== 0) continue

    for (let f = 0; f < fs.length; f++) {
      const flight = fs[f]!
      const st = flight.team === 'blue' ? states[0]! : states[1]!
      const order = st.orders[f] ?? null
      const tr = live.get(f)

      if (tr !== undefined && tr.order !== order) {
        done.push(tr)
        live.delete(f)
      }
      if (order === null || order.kind !== 'rally') continue

      let cur = live.get(f)
      if (cur === undefined || cur.order !== order) {
        cur = {
          order, since: t, minLeader: Infinity, minAny: Infinity, minAnyWho: -1,
          leaderChanges: 0, lastLeader: -1, leaderInside: 0, anyInside: 0, samples: 0,
        }
        live.set(f, cur)
      }

      const lead = leaderOf(flight, units)
      if (lead >= 0 && cur.lastLeader >= 0 && lead !== cur.lastLeader) cur.leaderChanges++
      cur.lastLeader = lead

      const p = order.point
      const dLead = lead >= 0 ? dist(units[lead]!, p) : Infinity
      if (dLead < cur.minLeader) cur.minLeader = dLead
      if (dLead <= order.radius) cur.leaderInside++

      let dAny = Infinity
      let who = -1
      for (let i = 0; i < flight.count; i++) {
        const idx = flight.members[i]!
        const u = units[idx]
        if (u === undefined || !u.alive) continue
        const d = dist(u, p)
        if (d < dAny) { dAny = d; who = idx }
      }
      if (dAny < cur.minAny) { cur.minAny = dAny; cur.minAnyWho = who }
      if (dAny <= order.radius) cur.anyInside++
      cur.samples++
    }
  }

  const all = [...done, ...live.values()]
  const stuck = [...live.values()]
  const mid = (xs: number[]): number =>
    xs.length === 0 ? Number.NaN : [...xs].sort((a, c) => a - c)[Math.floor(xs.length / 2)]!
  const radius = all.length > 0 ? all[0]!.order.radius : Number.NaN

  console.log(`── ${name}　20v20　${SECONDS} 秒（VETERAN）　pinned = #${b.flights.pinned} ──`)
  console.log(
    `  rally 共 ${all.length} 張　已解除 ${done.length}　跑到結束仍握著 ${stuck.length}　`
    + `判定半徑 ${radius.toFixed(0)} m`,
  )
  console.log(
    `  長機最近距離 m：p10 ${mid(all.map((x) => x.minLeader)).toFixed(0)} 之下…　`
    + `中位 ${mid(all.map((x) => x.minLeader)).toFixed(0)}　`
    + `**從未進圈的張數 ${all.filter((x) => x.leaderInside === 0).length}/${all.length}**`,
  )
  console.log(
    `  任一架最近距離 m：中位 ${mid(all.map((x) => x.minAny)).toFixed(0)}　`
    + `從未進圈 ${all.filter((x) => x.anyInside === 0).length}/${all.length}`,
  )

  // 【冒煙的槍】解除檢查每個物理步都跑，取樣間隔 0.1 秒。長機在圈內被連續
  // 取樣到兩次以上，代表它進圈之後至少過了 0.1 秒命令還在 —— 那不可能是
  // 「剛好在解除的那一格」，只能是解除路徑沒生效。
  const smoking = all.filter((x) => x.leaderInside >= 2)
  console.log(`  **長機在圈內卻沒解除（連續取樣 ≥ 2 次）：${smoking.length} 張**`)
  for (const x of smoking) {
    console.log(
      `    握 ${(x.samples * STRIDE * DT).toFixed(1)}s　`
      + `長機最近 ${x.minLeader.toFixed(0)} m　圈內 ${x.leaderInside}/${x.samples} 次　`
      + `長機換人 ${x.leaderChanges} 次`,
    )
  }
  if (done.length > 0) {
    const lives = done.map((d) => d.samples * STRIDE * DT)
    console.log(
      `  已解除者壽命 s：中位 ${mid(lives).toFixed(1)}　`
      + `最長 ${Math.max(...lives).toFixed(1)}`,
    )
  }
  for (const x of stuck) {
    console.log(
      `  未解除：握 ${(SECONDS - x.since).toFixed(0)}s　`
      + `長機最近 ${x.minLeader.toFixed(0)} m（圈內 ${x.leaderInside} 次）　`
      + `任一架最近 ${x.minAny.toFixed(0)} m ← #${x.minAnyWho}（圈內 ${x.anyInside} 次）`,
    )
  }
  console.log('')
}

console.log('【怎麼讀】')
console.log('　「從未進圈」佔多數 → 半徑比迴轉半徑小，長機物理上進不去，只能繞圈。')
console.log('　「長機在圈內卻沒解除」> 0 → 解除路徑本身壞了。')
console.log('　「任一架最近」進得了圈而長機進不了 → 判錯了架。')
console.log('　變因用**開局**不用種子 —— 種子只取飛行員名字，不進物理路徑。\n')
run('2000/200', 2000, 200)
run('4000/200', 4000, 200)
run('6000/250', 6000, 250)
