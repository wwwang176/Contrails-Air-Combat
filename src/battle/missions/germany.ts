import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import { B17G } from '../../specs/b17g'
import { HE111 } from '../../specs/he111'
import { FLARE_DROPS, PARKED_ROWS as POLTAVA_PARKED } from '../../world/poltava'
import {
  DUMPS as ASCH_DUMPS, LIGHT_FLAK_SITES as ASCH_FLAK, PARKED_ROWS as ASCH_PARKED, TAKEOFF_LINE,
} from '../../world/asch'
import { GROUND_FLAK_SPEC } from '../../world/shipGuns'
import { JU87 } from '../../specs/ju87'
import {
  ARTILLERY_ZONE, AT_GUNS, COLUMN_GAP, COLUMN_SPEED, COLUMN_TURN_RADIUS, FRONT_T34, FRONT_T34_SCRIPTED,
  GERMAN_INFANTRY, KURSK_SMOKES, PANZER_ROUTE_EAST, PANZER_ROUTE_WEST, SOVIET_FLAK, SOVIET_INFANTRY,
  SOVIET_TRUCKS, STALLED_PANZERS, T34_ROUTE, WRECK_PANZERS, WRECK_T34,
} from '../../world/kursk'
import { POLTAVA_GROUND } from './shared'
import type { GroundEntry, MissionCard, MissionTrigger } from './types'

/**
 * Y-29 的地面目標：12 架停放的 P-51、兩堆油桶、6 座輕高砲，全部是紅方的。
 * 佈局在 `world/asch.ts`。
 */
const ASCH_GROUND: readonly GroundEntry[] = [
  ...ASCH_PARKED.map((p): GroundEntry => ({
    unit: 'parkedP51', team: 'red', x: p.x, z: p.z, heading: p.heading,
  })),
  ...ASCH_DUMPS.map((d): GroundEntry => ({
    unit: d.kind, team: 'red', x: d.x, z: d.z, heading: d.heading,
  })),
  ...ASCH_FLAK.map((s): GroundEntry => ({
    unit: 'flakLight', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
]

/**
 * 庫斯克的固定地面單位。佈局在 `world/kursk.ts`。
 *
 * 【殘骸與劇本】`killAt: 0` 的是開場就燒著的殘骸；其餘 `killAt` 是地面戰的戲裡
 * 照劇本被打掉的那幾輛。劇本打掉的不算進摧毀數。
 */
const KURSK_GROUND: readonly GroundEntry[] = [
  ...AT_GUNS.map((s): GroundEntry => ({ unit: 'atGun', team: 'red', ...s })),
  ...FRONT_T34.map((s, i): GroundEntry => ({
    unit: 'tankDug', team: 'red', ...s,
    ...(i === FRONT_T34_SCRIPTED.index ? { killAt: FRONT_T34_SCRIPTED.at } : {}),
  })),
  ...WRECK_T34.map((s): GroundEntry => ({ unit: 'tankDug', team: 'red', ...s, killAt: 0 })),
  ...WRECK_PANZERS.map((s): GroundEntry => ({ unit: 'panzer4', team: 'blue', ...s, killAt: 0 })),
  ...STALLED_PANZERS.map((s): GroundEntry => ({
    unit: 'panzer4', team: 'blue', x: s.x, z: s.z, heading: s.heading, killAt: s.killAt,
  })),
  ...SOVIET_INFANTRY.map((s): GroundEntry => ({ unit: 'infantry', team: 'red', ...s })),
  ...GERMAN_INFANTRY.map((s): GroundEntry => ({ unit: 'infantry', team: 'blue', ...s })),
  ...SOVIET_FLAK.map((s): GroundEntry => ({ unit: 'flakLight', team: 'red', ...s })),
  ...SOVIET_TRUCKS.map((s): GroundEntry => ({ unit: 'truck', team: 'red', ...s })),
]

/** 反坦克砲全部炸掉：德軍推進、蘇軍反擊、目標換成反擊的 T-34，同一刻 */
const KURSK_BREAKTHROUGH: MissionTrigger = { kind: 'destroyed', atLeast: AT_GUNS.length, unit: 'atGun' }

/** 德軍線的卡片。**這一條線的卡片只住在這裡。** */
export const GERMANY: readonly MissionCard[] = [
  {
    id: 'germany-m1', titleKey: 'mission.germany-m1.title', type: 'intercept',
    summaryKey: 'mission.germany-m1.summary',
    placeKey: 'mission.germany-m1.place', period: { year: 1944, month: 11 },
    battle: {
      objectiveKey: 'mission.germany-m1.objective', bannerKey: 'mission.germany-m1.banner',
      blueSpec: BF109K4, redSpec: P51D, convoySpec: B17G,
      /**
       * 【在路途上攔截】B-17 是 transit：從進場點直飛終點、不迴轉、不投彈。
       * 到了終點就從進場點重新進場（`conveyor` 節拍），轟炸機流因此不斷。
       * 終點不判勝負 —— 數的是累計擊落，攔下哪一批不重要。
       *
       * 【沒有地面目標、沒有廠區】廠區屬於盟 M2。地形是晚秋的內陸（農地的高度場
       * 配洛伊納的色盤）—— `leuna` 會把廠區的墊面與佈景烤進地形，拿掉 `ground`
       * 之後靜態的工廠仍然在。
       *
       * 【開場沒有戰鬥機】護航的 P-51 全部由波次給，`redSpec` 是它們的機種。
       */
      blueCount: 8, redCount: 0,
      convoyCount: 8, convoyDuty: 'stream', convoyPriority: 1,
      // 【終點在我方後方 12 km】紅方從 z = −5,000 出發，一趟 17 km。**起始值**
      targetDistance: 12000, targetRadius: 1000, seconds: Infinity,
      entry: 'headOn',
      terrain: 'autumnFarmland',
      timeOfDay: 'novemberNoon',
      // 【只算轟炸機】打護航機過不了關。**起始值，由試飛裁定**
      huntCount: 6, huntRole: 'bomber',
      // 紅隊席位 8 + 4 + 4 = 16
      waves: [
        {
          when: { kind: 'clock', at: 0 },
          warnKey: 'mission.germany-m1.wave.escort',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4,
        },
        {
          when: { kind: 'clock', at: 60 },
          warnKey: 'mission.germany-m1.wave.more',
          warnLead: 4,
          side: 'theirs', spec: P51D, count: 4,
        },
      ],
    },
  },
  {
    id: 'germany-m2', titleKey: 'mission.germany-m2.title', type: 'strike',
    summaryKey: 'mission.germany-m2.summary',
    placeKey: 'mission.germany-m2.place', period: { year: 1944, month: 6 },
    battle: {
      objectiveKey: 'mission.germany-m2.objective', bannerKey: 'mission.germany-m2.banner',
      blueSpec: HE111, redSpec: P51D, convoySpec: null,
      // 【沒有敵機】史實上蘇軍夜戰機沒有攔到任何一架；壓力全在地面的防空。
      // `redSpec` 只是型別要填：野馬就在皮里亞廷，沒起飛
      blueCount: 8, redCount: 0,
      blueStacked: true,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'poltava',
      timeOfDay: 'night',
      /**
       * 【1,500 m】輕型砲射程 2,640 m 打得到、重砲也打得到；爬到 3,000 以上
       * 輕砲搆不著但瞄準變難 —— 那是這一關的取捨。**起始值，由試玩裁定。**
       */
      altitude: 1500,
      ground: POLTAVA_GROUND,
      // 【停機線上的 B-17 全部炸毀】堆、砲位、探照燈打得掉但不算。
      // 8 架 × 8 枚 = 64 枚
      destroyCount: POLTAVA_PARKED.length, destroyUnit: 'parkedB17',
      // 【重砲照 5 吋艦砲的路數】高射速、小範圍、單發輕 —— 與盟 M3 的艦隊
      // 防空同一種壓力：黑雲多而不致命
      flakSpec: { ...GROUND_FLAK_SPEC, roundsPerMinute: 20, burstRadius: 50, burstDamage: 100 },
      /**
       * 【80 秒】He 111 約 85 m/s 從 12 km 外進場，80 秒時離機場約 5 km；
       * 照明彈燒到 380 秒，整個投彈段都亮著。各枚的高度與時間差在
       * `FLARE_DROPS`，都在投彈高度之下 —— 光在飛機下面，照的是地。
       * **起始值，由試玩裁定。**
       */
      flares: { when: { kind: 'clock', at: 80 }, points: FLARE_DROPS },
    },
  },
  {
    id: 'germany-m3', titleKey: 'mission.germany-m3.title', type: 'strike',
    summaryKey: 'mission.germany-m3.summary',
    placeKey: 'mission.germany-m3.place', period: { year: 1945, month: 1 },
    battle: {
      objectiveKey: 'mission.germany-m3.objective', bannerKey: 'mission.germany-m3.banner',
      blueSpec: BF109K4, redSpec: P51D, convoySpec: null,
      // 【敵機全部從地上來】沒有空中巡邏，起飛的野馬全部由波次給。
      // 紅隊席位：停機線 12（三個小隊）
      blueCount: 8, redCount: 0,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'asch',
      timeOfDay: 'dawn',
      /**
       * 【500 m】分隊的高度層是任務高度 ±`altitudeSpread`（300 m），最低那一隊
       * 生在 200 m。再低的話最低那一隊開場就在撞地判定之下。**起始值，由試飛裁定。**
       */
      altitude: 500,
      ground: ASCH_GROUND,
      // 【第三張任務卡限定】先完成機場掃射；已升空的 P-51 只有形成直接射擊威脅
      // 時才插隊。AI 核心只看單位 id，不知道 germany-m3，也不污染其他關卡。
      priorityGroundUnit: 'parkedP51',
      // 【停機線上的 P-51 全部擊毀】地上打掉的、起飛後被擊落的都算（每一架只算
      // 一次，見 `setup.ts` 的 `destroyedInPool`），所以這就是「所有野馬」。
      // 油桶堆與輕砲打得掉但不算
      destroyCount: ASCH_PARKED.length, destroyUnit: 'parkedP51',
      /**
       * 【停機線上的每一架最後都起得來】三批各一個小隊、席位合計 12，等於停機線。
       * 被打掉的起不來：那一批地上剩幾架就上幾架（`setup.ts` 的 `reinforce`），
       * 一架都不剩就不來。打得慢就全部升空 —— 那正是這一關的壓力。
       *
       * 【從停機墊滑出去】每一架沿滑行帶滑到跑道口（`world/asch.ts` 的
       * `taxiRoute`），滑到就滾行，不等小隊到齊。第一批開場就開始滑，玩家約
       * 37 秒到場時看得到它們在滑行道上。三批的秒數是**起始值，由試飛裁定**。
       */
      waves: [
        {
          when: { kind: 'clock', at: 0 },
          warnKey: 'mission.germany-m3.wave.taxi',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, takeoff: TAKEOFF_LINE, departs: 'parkedP51',
        },
        {
          when: { kind: 'clock', at: 30 },
          warnKey: 'mission.germany-m3.wave.more',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, takeoff: TAKEOFF_LINE, departs: 'parkedP51',
        },
        {
          when: { kind: 'clock', at: 60 },
          warnKey: 'mission.germany-m3.wave.last',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, takeoff: TAKEOFF_LINE, departs: 'parkedP51',
        },
      ],
    },
  },
  {
    id: 'germany-m4', titleKey: 'mission.germany-m4.title', type: 'strike',
    summaryKey: 'mission.germany-m4.summary',
    placeKey: 'mission.germany-m4.place', period: { year: 1943, month: 7 },
    battle: {
      objectiveKey: 'mission.germany-m4.objective', bannerKey: 'mission.germany-m4.banner',
      blueSpec: JU87, redSpec: P51D, convoySpec: null,
      // 【沒有敵機】壓力全在地面的防空。`redSpec` 只是型別要填
      blueCount: 4, redCount: 0,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'strikeDeep',
      terrain: 'kursk',
      // 【塵霾】乾熱、砲擊與車輛揚起的塵土，地平線一片黃褐
      timeOfDay: 'julyNoon',
      /**
       * 【2,000 m】俯衝轟炸要有高度可以換；輕型防空的射程 2,640 m 打得到。
       * **起始值，由試飛裁定。**
       */
      altitude: 2000,
      ground: KURSK_GROUND,
      /**
       * 【兩路德軍開場就在、蘇軍反擊縱隊藏著】三支同一個觸發出發。蘇軍那一支出發前
       * 不在場上 —— 第一段先炸掉它們的話，第二段一開始就達成了
       */
      columns: [
        {
          team: 'blue', route: PANZER_ROUTE_WEST, speed: COLUMN_SPEED, turnRadius: COLUMN_TURN_RADIUS,
          gap: COLUMN_GAP, units: ['panzer4', 'panzer4', 'tiger', 'panzer4', 'panzer4'],
          depart: KURSK_BREAKTHROUGH,
        },
        {
          team: 'blue', route: PANZER_ROUTE_EAST, speed: COLUMN_SPEED, turnRadius: COLUMN_TURN_RADIUS,
          gap: COLUMN_GAP, units: ['panzer4', 'tiger', 'panzer4', 'panzer4', 'panzer4'],
          depart: KURSK_BREAKTHROUGH,
        },
        {
          team: 'red', route: T34_ROUTE, speed: COLUMN_SPEED, turnRadius: COLUMN_TURN_RADIUS,
          gap: COLUMN_GAP, units: ['tank', 'tank', 'tank', 'tank', 'tank', 'tank'],
          depart: KURSK_BREAKTHROUGH, hidden: true,
        },
      ],
      // 【第一段：反坦克砲全毀】防空、步兵、第一線的 T-34 打得掉但不算
      destroyCount: AT_GUNS.length, destroyUnit: 'atGun',
      // 【第二段：反擊的 T-34 炸掉 4 輛】**起始值，由試飛裁定**
      retarget: {
        when: KURSK_BREAKTHROUGH, messageKey: 'mission.germany-m4.retarget',
        destroyCount: 4, destroyUnit: 'tank',
      },
      theater: {
        shooters: ['panzer4', 'tiger', 'tank', 'tankDug', 'atGun', 'infantry'],
        period: 7,
        range: 1500,
        artillery: { ...ARTILLERY_ZONE, period: 2.5 },
        smokes: KURSK_SMOKES,
      },
    },
  },
]
