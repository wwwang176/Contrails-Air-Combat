import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import { B17G } from '../../specs/b17g'
import { HE111 } from '../../specs/he111'
import { FLARE_DROPS, PARKED_ROWS as POLTAVA_PARKED } from '../../world/poltava'
import {
  DUMPS as ASCH_DUMPS, FLAK_SITES as ASCH_FLAK, HOLD_ROWS as ASCH_HOLD, PARKED_ROWS as ASCH_PARKED,
  TAKEOFF_LINE,
} from '../../world/asch'
import { GROUND_FLAK_SPEC } from '../../world/shipGuns'
import { POLTAVA_GROUND } from './shared'
import type { GroundEntry, MissionCard } from './types'

/**
 * Y-29 的地面目標：16 架 P-51（停機墊 12、跑道頭 4）、兩堆油桶、12 輛 M16 防空
 * 半履帶車，全部是紅方的。佈局在 `world/asch.ts`；營房、補給堆與其餘的車是佈景，
 * 不在這裡。
 */
const ASCH_GROUND: readonly GroundEntry[] = [
  ...[...ASCH_PARKED, ...ASCH_HOLD].map((p): GroundEntry => ({
    unit: 'parkedP51', team: 'red', x: p.x, z: p.z, heading: p.heading,
  })),
  ...ASCH_DUMPS.map((d): GroundEntry => ({
    unit: d.kind, team: 'red', x: d.x, z: d.z, heading: d.heading,
  })),
  ...ASCH_FLAK.map((s): GroundEntry => ({
    unit: 'usFlakTrack', team: 'red', x: s.x, z: s.z, heading: s.heading,
  })),
]

/** 德軍線的三關。**這一條線的卡片只住在這裡。** */
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
      // 紅隊席位：跑道頭 4 ＋ 停機墊 12（四個小隊）；藍隊 4 ＋ 4 ＋ 2
      blueCount: 10, redCount: 0,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      // 【從東邊橫切】史實上 JG 11 從德國那一側來。橫切跑道與停機線，一趟只
      // 掃得到一兩架
      entry: 'aschEast',
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
      // 油桶堆與防空車打得掉但不算
      destroyCount: ASCH_PARKED.length + ASCH_HOLD.length, destroyUnit: 'parkedP51',
      /**
       * 【地上的每一架最後都起得來】四批各一個小隊、席位合計 16，等於地上的架數。
       * 被打掉的起不來：那一批地上剩幾架就上幾架（`setup.ts` 的 `reinforce`），
       * 一架都不剩就不來。打得慢就全部升空 —— 那正是這一關的壓力。
       *
       * 【跑道頭那一批排第一】每一批挑離起飛點最近、還停著的那幾架，所以第一批
       * 就是 `HOLD_ROWS` 那 4 架：滑幾十公尺上跑道，玩家約 37 秒到場前全部升空。
       *
       * 【其餘從停機墊滑出去】每一架沿滑行帶滑到跑道口（`world/asch.ts` 的
       * `taxiRoute`），滑到就滾行，不等小隊到齊。停機墊的第一批開場就開始滑，
       * 玩家到場時看得到它們在滑行道上。各批的秒數是**起始值，由試飛裁定**。
       *
       * 【同一秒兩批只剩一句預警】`b.message` 只有一格，後寫的蓋掉先寫的；兩批
       * 用同一句
       */
      waves: [
        {
          when: { kind: 'clock', at: 0 },
          warnKey: 'mission.germany-m3.wave.taxi',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, takeoff: TAKEOFF_LINE, departs: 'parkedP51',
        },
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
]
