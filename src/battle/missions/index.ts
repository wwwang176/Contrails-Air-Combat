import { Quaternion, Vector3 } from 'three'
import { DEFAULT_BATTLE, type BattleConfig } from '../setup'
import { createGroundMotion, motionPose } from '../../world/groundMotion'
import { VETERAN } from '../../ai/profile'
import { ENTRY_PLANS, type EntryPlan, type SideEntry } from '../entry'
import {
  WAVE_LANE, convoyLine, lineAbreast, pincer, rotateEntry, soloBombers, stackedEntry,
} from '../order'
import { SCHWARM_SIZE } from '../flights'
import type { Beat, BeatCondition, RecycleBeat, ReinforceBeat, WithdrawBeat } from '../beats'
import type { MissionRules } from '../mission'
import type { AircraftSpec } from '../../specs/types'
import type { Team } from '../../world/World'
import { ALLIES } from './allies'
import { GERMANY } from './germany'
import { JAPAN } from './japan'
import type {
  Campaign, GroundEntry, MissionBattle, MissionCard, MissionRecycle, MissionSide, MissionTrigger,
  MissionVehicleConvoy, MissionWave, MissionWithdraw, ReadyMissionCard,
} from './types'

/**
 * # 任務卡的門面
 *
 * **對外的 import 路徑仍然是 `battle/missions`。** 這一檔只做三件事：把三條
 * 線的卡片組成一張表、由卡片推導出勝負規則與 `BattleConfig`、再把型別轉出去。
 *
 * 【卡片不住在這裡】三條線各自一個檔案（`allies.ts` / `germany.ts` /
 * `japan.ts`），彼此不相干也不互相 import。改一條線不會動到另外兩條。
 */

export * from './types'
export { CONVOY, KILL } from './shared'

/** 三條線的全部卡片。**選單與測試都掃這一張表。** */
export const MISSIONS: Record<Campaign, readonly MissionCard[]> = {
  allies: ALLIES,
  germany: GERMANY,
  japan: JAPAN,
}

/**
 * 撤離點的座標。**返航節拍與撤離卡共用這一條。**
 *
 * 【為什麼是固定的世界座標而不是「從玩家位置往前 distance」】藍隊開局在
 * z ≈ +5,000，所以 `distance = 12,000` 實際要飛約 17 km。那是刻意的：終點
 * 是關卡設計的一部分，不該隨玩家開場飄。
 *
 * 【高度取戰場高度，不是玩家那一架的】單一分隊的高度層會偏 ±300 m
 * （`altitudeOffset`），而判定半徑是 1,000 m —— 差得進去。
 */
function evacuatePoint(altitude: number, distance: number): Vector3 {
  return new Vector3(0, altitude, -distance)
}

/**
 * 卡片 → 勝負條件。
 *
 * 【為什麼撤離點的高度是參數而不是常數】高度設定改了，撤離點要自動跟上。
 * 寫死 4000 的話兩者會在某次調整之後靜靜地差開 —— 而症狀是「圓環浮在
 * 戰場上方，飛過去卻沒判到」。
 *
 * 【為什麼判準是 `type` 而不是 `targetDistance > 0`】後者把「這是撤離任務」
 * 這件事編碼進一個數字的正負，而那個數字的意思是距離。
 */
export function missionRules(
  card: ReadyMissionCard, altitude: number, lateralOffset: number,
): MissionRules {
  const b = card.battle
  // 【截斷排在最前】它與其他數數量的規則不共存；排前面只是讓讀的人先看到它
  if (b.interdict !== undefined) {
    return { kind: 'interdict', count: b.interdict.count, leak: b.interdict.leak, unit: b.interdict.unit }
  }
  // 【擊沉排在最前面】判準是卡片上有沒有 `sinkCount`，不是 `type` ——
  // `type` 是給玩家看的分類（打擊／殲滅／護航…），一張打擊卡可能是炸機場、
  // 也可能是雷擊。用 type 推導的話，日後多一張「打擊」卡就會靜靜地變成
  // 擊沉任務。
  if (b.sinkCount !== undefined) {
    // 【有攻擊隊才有護衛編制】其餘藍隊飛機就是護衛，全滅判敗。沒有攻擊隊的
    // 擊沉關（日 M2 全是陸攻）連鍵都不放，否則戰鬥機數恆為 0 會開場判敗
    return b.convoyDuty === 'strike'
      ? { kind: 'sink', count: b.sinkCount, escorts: true }
      : { kind: 'sink', count: b.sinkCount }
  }
  // 【炸毀與擊沉並列】同樣是「卡片上有沒有那一格」，同樣排在守住艦隊之前
  if (b.destroyCount !== undefined) {
    // 【單位省略時連鍵都不放】理由同下面的 `huntRole`
    return b.destroyUnit === undefined
      ? { kind: 'destroy', count: b.destroyCount }
      : { kind: 'destroy', count: b.destroyCount, unit: b.destroyUnit }
  }
  // 【擊落也並列】三者是同一種形狀：「數到幾個就贏」。`huntRole` 省略時
  // 連鍵都不放 —— `exactOptionalPropertyTypes` 下 `role: undefined` 與
  // 「沒有 role」是兩件事，而基準快照會看得出差別
  if (b.huntCount !== undefined) {
    return b.huntRole === undefined
      ? { kind: 'hunt', count: b.huntCount }
      : { kind: 'hunt', count: b.huntCount, role: b.huntRole }
  }
  // 【判準是「艦隊裡有沒有要害艦」，不是 `type`】理由同上面那一段：`type`
  // 是給玩家看的分類，用它推導的話日後多一張「殲滅」卡就會靜靜地變成
  // 守住艦隊。**排在擊沉之後** —— 進攻的規則優先，而日 M3 的艦隊一艘
  // `vital` 都沒有，所以順序不影響它
  if (b.fleet?.ships.some((s) => s.vital === true) === true) {
    return { kind: 'defend' }
  }
  if (card.type === '撤離') {
    return {
      kind: 'evacuate',
      point: evacuatePoint(altitude, b.targetDistance),
      radius: b.targetRadius,
      seconds: b.seconds,
    }
  }
  if (card.type === '護航' || card.type === '攔截') {
    // 【護航是我方的轟炸機、攔截是敵方的】這一行就是兩張卡的**全部**差別，
    // 判定那一側是同一條規則（見 `mission.ts` 的 convoy）
    const owner: Team = card.type === '護航' ? 'blue' : 'red'
    const point = routePoint(b, owner, altitude, lateralOffset)
    // 【門檻省略時連鍵都不放】理由同 `huntRole`：`need: undefined` 與「沒有
    // need」在基準快照上看得出差別，而不寫 `need` 的四張卡一個位元都不該動
    return b.need === undefined
      ? { kind: 'convoy', owner, point, radius: b.targetRadius }
      : { kind: 'convoy', owner, point, radius: b.targetRadius, need: b.need }
  }
  return { kind: 'annihilate' }
}

/**
 * transit 那一隊的終點。**護送、攔截與轟炸機流共用。**
 *
 * 【方向跟著那一隊的機首】藍隊開局朝 −Z、紅隊朝 +Z。所以護送的終點在敵人後方
 * （要打穿出去，理由同撤離），而攔截的終點在**我方**後方 —— 那正是「別讓它
 * 飛過去」的意思。
 *
 * 【圈要放在那一隊自己的航道上，不是 x = 0】兩隊對頭時各自橫向偏
 * `across × lateralOffset`（起始值 ∓750 m）—— 那是為了不對撞。判定圈釘在 0 的
 * 話，最外側那一架到圈心是 750 + 300 = 1,050 m，**永遠判不到**，而症狀是「轟炸
 * 機從圈旁邊飛過去，任務永遠不結束」（`test/tools/convoy.probe.ts` 表三）。
 */
function routePoint(
  b: MissionBattle, owner: Team, altitude: number, lateralOffset: number,
): Vector3 {
  const z = owner === 'blue' ? -b.targetDistance : b.targetDistance
  const x = ENTRY_PLANS[b.entry][owner].across * lateralOffset
  return new Vector3(x, altitude, z)
}

/**
 * 卡片 → 戰鬥設定。與 `skirmish.ts` 的 `battleConfigFrom` 對稱 ——
 * **兩者都是「設定 → `BattleConfig`」的唯一入口**，難度也在這裡套
 * （理由見 `setup.ts` 的 `aiProfile` 註解）。
 *
 * 【玩家恆在藍隊】換的是機種不是隊伍顏色（M9 spec §14、M10 spec §7.1）。
 *
 * 【不再吃陣營】雙方飛什麼由卡片自己說。三條戰役之後「另外一個陣營」不存在
 * ——盟軍線的「沖繩外海」敵人是日本魚雷機。
 *
 * 【為什麼架數不夾制】`battleConfigFrom` 要夾是因為那些數字從 DOM 讀進來；
 * 這裡的來源是本檔的常數表，夾制只會把一個寫錯的關卡藏起來。
 *
 * 【但「寫錯就會炸」只對一半】`blueCount` 為 0 時 `createBattle` 確實會拋
 * 「玩家沒有被建立」；**大於 `MAX_SIDE` 不會拋**，只會建一個超出特效池容量
 * 假設的超大戰場。所以那道保險由
 * `test/unit/campaigns.test.ts` 補上。
 */
export function missionConfigFrom(card: ReadyMissionCard): BattleConfig {
  const b = card.battle
  // 【高度只讀一次，兩邊共用】`missionRules` 拿它算撤離點與集合點的高度。
  // 一邊讀卡片、一邊讀預設的話，圓環會浮在編隊上方幾千公尺而不報錯。
  const altitude = b.altitude ?? DEFAULT_BATTLE.altitude
  const rules = missionRules(card, altitude, DEFAULT_BATTLE.lateralOffset)
  // 【擺法是生成器的第一個參數】`entry` 仍然是 `ENTRY_PLANS` 的鍵，那張表
  // 一個字不動
  const plan = ENTRY_PLANS[b.entry]
  // 【省略時連鍵都不放】理由同 `need`：沒寫 `convoyBox` 的卡一個位元都不該動
  const box = b.convoyBox === true ? { box: true } as const : {}
  // 【轟炸機一架一隊】見 `soloBombers`。波次在 `cardBeats` 過同一支
  const units = soloBombers(rules.kind === 'convoy'
    ? convoyLine(plan, {
      fighter: b.blueSpec,
      fighters: b.blueCount,
      bomber: rules.owner === 'blue' ? convoyOf(card) : null,
      bombers: b.convoyCount,
      ...box,
    }, {
      fighter: b.redSpec,
      fighters: b.redCount,
      bomber: rules.owner === 'red' ? convoyOf(card) : null,
      bombers: b.convoyCount,
      ...box,
    })
    // 【攻擊隊走同一支編組，職務換成 combat】少了這一條，`convoySpec` 那幾架
    // 根本不會被生出來，而卡片與簡報看起來一切正常
    : b.convoyDuty === 'strike'
      ? convoyLine(plan, {
        fighter: b.blueSpec,
        fighters: b.blueCount,
        bomber: convoyOf(card),
        bombers: b.convoyCount,
        bomberDuty: 'strike',
      }, {
        fighter: b.redSpec,
        fighters: b.redCount,
        bomber: null,
        bombers: 0,
      })
    // 【轟炸機流排進紅隊，職務是 transit】終點由下面的 `route` 給
    : b.convoyDuty === 'stream'
      ? convoyLine(plan, {
        fighter: b.blueSpec,
        fighters: b.blueCount,
        bomber: null,
        bombers: 0,
      }, {
        fighter: b.redSpec,
        fighters: b.redCount,
        bomber: convoyOf(card),
        bombers: b.convoyCount,
      })
    : b.blueStacked === true
      ? stackedEntry(plan, b.blueSpec, b.blueCount, b.redSpec, b.redCount)
      : b.redStarboard === undefined
        ? lineAbreast(plan, b.blueSpec, b.blueCount, b.redSpec, b.redCount)
        : pincer(
          plan, b.blueSpec, b.blueCount, b.redSpec, b.redCount, b.redStarboard,
          DEFAULT_BATTLE.entryRange, DEFAULT_BATTLE.lateralOffset,
        ), DEFAULT_BATTLE.schwarmSpacing)
  const beats = cardBeats(card, plan, altitude)
  return {
    ...DEFAULT_BATTLE,
    units,
    altitude,
    aiProfile: VETERAN,
    rules,
    // 【只有護送／攔截會偏離中性值】其餘卡片的 `convoyPriority` 是 1，
    // 那時這一份與 `NEUTRAL_TUNING` 的行為逐字相同
    tuning: {
      convoyPriority: b.convoyPriority,
      ...(b.priorityGroundUnit === undefined
        ? {}
        : { priorityGroundUnit: b.priorityGroundUnit }),
    },
    ...(beats === undefined ? {} : { beats }),
    // 【轟炸機流的終點】不判勝負，只給 transit 的那幾架一個飛去的點
    ...(b.convoyDuty === 'stream'
      ? {
        route: {
          owner: 'red' as const,
          point: routePoint(b, 'red', altitude, DEFAULT_BATTLE.lateralOffset),
          radius: b.targetRadius,
        },
      }
      : {}),
    ...(b.fleet === undefined ? {} : { fleet: b.fleet }),
    // 【車隊併進地面目標】兩者都有時串起來；只有車隊時就是車隊
    ...(b.ground === undefined && b.vehicleConvoy === undefined
      ? {}
      : {
        ground: [
          ...(b.ground ?? []),
          ...(b.vehicleConvoy === undefined ? [] : convoyGround(b.vehicleConvoy)),
        ],
      }),
    ...(b.flakSpec === undefined ? {} : { flakSpec: b.flakSpec }),
    // 【明列，因為這一支不透傳】漏抄的症狀是複寫靜靜失效、玩家掛著預設的
    // 東西起飛，而且不報錯。護欄在 `missions.test.ts`
    ...(b.blueLoadout === undefined ? {} : { blueLoadout: b.blueLoadout }),
    ...(b.loadouts === undefined ? {} : { loadouts: b.loadouts }),
  }
}

/**
 * 卡片上的車隊 → 地面目標的條目。
 *
 * 【集結位置】全部車輛排在路線起點往前的同一條線上：第一批的車頭最遠，最後一批
 * 的車尾在起點（沿路線距離 0）。沿路線距離 = 之後還有幾輛 × `gap`。
 *
 * 【開場的 x、z 就是 motion 在第 0 秒的位置】`World.step` 第一步才會改寫它；
 * 擺成別的值的話開場那一幀車會閃一下。航向取第一段的 —— 集結位置都在第一段上
 * （`leyte.test.ts` 守第一段夠長）。
 *
 * 載入期跑一次，不在熱路徑上。
 */
export function convoyGround(c: MissionVehicleConvoy): GroundEntry[] {
  const motion = { speed: c.speed, turnRadius: c.turnRadius, turnRate: c.speed / c.turnRadius }
  const total = c.batches.reduce((n, x) => n + x.units.length, 0)
  const pose = {
    position: new Vector3(), velocity: new Vector3(),
    orientation: new Quaternion(), angularVelocity: new Vector3(),
  }
  const out: GroundEntry[] = []
  let k = 0
  for (const batch of c.batches) {
    for (const unit of batch.units) {
      const m = createGroundMotion(c.route, motion, (total - 1 - k) * c.gap, batch.departAt)
      motionPose(m, 0, pose)
      out.push({
        unit, team: 'red', x: pose.position.x, z: pose.position.z,
        heading: m.startHeading, motion: m,
      })
      k++
    }
  }
  return out
}

/**
 * 被護送／被攔截的機種。**護送與攔截一定要有，否則那一關贏不了。**
 *
 * 【為什麼拋錯而不是落回一台】少填的症狀是那一隊沒有轟炸機，而勝負條件
 * 是「轟炸機抵達／全滅」—— 一場永遠不會結束的仗，畫面上一切正常。
 */
function convoyOf(card: ReadyMissionCard): AircraftSpec {
  const s = card.battle.convoySpec
  if (s === null) throw new Error(`${card.id} 是${card.type}，但沒有指定被護送的機種`)
  return s
}

/**
 * 卡片上的波次與返航 → 節拍。**沒有任何一種就回 undefined。**
 *
 * 【為什麼返航排在波次後面】`createBattle` 的 `reserve` 是照 `beats` 裡
 * reinforce 的順序推的，而 `stepBeats` 依陣列順序判斷。返航不佔預留的位子，
 * 所以排哪裡都不影響行為 —— 寫死在最後只是為了讀起來一致。
 */
function cardBeats(
  card: ReadyMissionCard, plan: EntryPlan, altitude: number,
): readonly Beat[] | undefined {
  const b = card.battle
  const out: Beat[] = []
  // 【重生排在波次前面】掛在 `batch` 條件上的波次讀的是同一步剛加上的批數，
  // 排在後面會晚一個物理步預警，而兩則預警本該同一刻
  if (b.recycle !== undefined) out.push(recycleBeat(b.recycle, plan))
  // 【轟炸機的波次拆成幾個同時生效的節拍】一個增援節拍帶一個小隊，而轟炸機
  // 一架一隊（`soloBombers`）。同一個條件、同一則預警，同一步一起進場
  b.waves?.forEach((w, i) => {
    const wave = waveBeat(w, i, plan, altitude)
    for (const flight of soloBombers([wave.flight], DEFAULT_BATTLE.schwarmSpacing)) {
      out.push({ ...wave, flight })
    }
  })
  if (b.flares !== undefined) {
    out.push({ kind: 'flare', when: triggerToCondition(b.flares.when), points: b.flares.points })
  }
  if (b.withdraw !== undefined) out.push(withdrawBeat(b.withdraw, altitude))
  if (b.convoyDuty === 'stream') out.push({ kind: 'conveyor' })
  return out.length === 0 ? undefined : out
}

/**
 * 一個返航 → 一個 `WithdrawBeat`。撤離點與 `missionRules` 走同一條路。
 *
 * 【高度跟著卡片】撤離的判定是三維距離（`mission.ts` 的 `distanceTo`）。用預設的
 * 4,000 m 的話，低空關的圓環浮在玩家頭上兩三公里、飛不進去。
 */
function withdrawBeat(w: MissionWithdraw, altitude: number): WithdrawBeat {
  return {
    kind: 'withdraw',
    when: triggerToCondition(w.when),
    message: w.message,
    point: evacuatePoint(altitude, w.distance),
    radius: w.radius,
    seconds: w.seconds,
  }
}

/**
 * 一個波次 → 一個增援節拍。
 *
 * 【橫向槽位逐波次 +1，而且從 `WAVE_LANE` 起跳】出生點是
 * `lane × schwarmSpacing + across × lateralOffset`（`unitFrame`），而高度那一軸
 * 的鋸齒**週期只有 5**（`altitudeOffset`）—— 光靠 `tier` 的話第 1 與第 6 個
 * 波次會生在完全相同的一點上。橫向槽位每支差 1，任何兩支就至少差一個
 * `schwarmSpacing`。
 */
function waveBeat(
  w: MissionWave, index: number, plan: EntryPlan, altitude: number,
): ReinforceBeat {
  if (!Number.isInteger(w.count) || w.count < 1 || w.count > SCHWARM_SIZE) {
    throw new Error(`波次的架數要是 1…${SCHWARM_SIZE} 的整數，收到 ${w.count}`)
  }
  const ours = w.side === 'mine'
  const turned = turnedEntry(plan, w.side, w.starboard)
  // 【卡片寫絕對高度，`SideEntry` 存的是相對任務高度的加成】換算只有這一處
  const base = w.altitude === undefined
    ? turned
    : { ...turned, climb: w.altitude - altitude }
  return {
    kind: 'reinforce',
    when: triggerToCondition(w.when),
    warn: w.warn,
    warnLead: w.warnLead,
    flight: {
      team: ours ? 'blue' : 'red',
      members: Array.from({ length: w.count }, () => w.spec),
      // 【只覆寫縱深】橫向、高度、朝向與速度沿用那一邊的擺法 ——
      // 它們仍然是那一隊的飛機，只是在路的另一段等你
      entry: w.along === undefined ? base : { ...base, along: w.along },
      duty: 'combat',
      lane: WAVE_LANE + index,
      tier: index,
      ...(w.takeoff === undefined ? {} : { takeoff: w.takeoff }),
      ...(w.departs === undefined ? {} : { departs: w.departs }),
    },
  }
}

/**
 * 那一邊開局的擺法，依卡片指定的方位轉過去。
 *
 * 【方位先轉，高度與縱深後套】旋轉是繞原點的幾何，改的是 across／along／
 * heading；呼叫端另外覆寫的那兩格是獨立的，順序因此不影響結果。
 */
function turnedEntry(plan: EntryPlan, side: MissionSide, starboard?: number): SideEntry {
  const base = side === 'mine' ? plan.blue : plan.red
  if (starboard === undefined) return base
  return rotateEntry(
    base, starboard, DEFAULT_BATTLE.entryRange, DEFAULT_BATTLE.lateralOffset,
  )
}

/** 卡片的重生 → 重生節拍 */
function recycleBeat(r: MissionRecycle, plan: EntryPlan): RecycleBeat {
  if (!Number.isInteger(r.batches) || r.batches < 1) {
    throw new Error(`重生的批數要是正整數，收到 ${r.batches}`)
  }
  return {
    kind: 'recycle',
    team: r.side === 'mine' ? 'blue' : 'red',
    ...(r.role === undefined ? {} : { role: r.role }),
    batches: r.batches,
    warn: r.warn,
    warnLead: r.warnLead,
    entry: turnedEntry(plan, r.side, r.starboard),
  }
}

/** 卡片的說法 → 引擎的說法。`mine`／`theirs` 在這裡才變成藍／紅 */
function triggerToCondition(t: MissionTrigger): BeatCondition {
  if (t.kind === 'clock') return { kind: 'clock', at: t.at }
  if (t.kind === 'batch') return { kind: 'batch', at: t.at }
  if (t.kind === 'ground') return { kind: 'ground', below: t.below, byLatest: t.byLatest }
  if (t.kind === 'destroyed') {
    return {
      kind: 'destroyed', atLeast: t.atLeast,
      ...(t.unit === undefined ? {} : { unit: t.unit }),
      ...(t.byLatest === undefined ? {} : { byLatest: t.byLatest }),
    }
  }
  return {
    kind: 'alive',
    team: t.side === 'mine' ? 'blue' : 'red',
    ...(t.role === undefined ? {} : { role: t.role }),
    atMost: t.atMost,
    byLatest: t.byLatest,
  }
}
