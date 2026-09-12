import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import { B17G } from '../../specs/b17g'
import { HE111 } from '../../specs/he111'
import { FLARE_DROPS } from '../../world/poltava'
import {
  DUMPS as ASCH_DUMPS, LIGHT_FLAK_SITES as ASCH_FLAK, PARKED_ROWS as ASCH_PARKED, TAKEOFF_LINE,
} from '../../world/asch'
import { GROUND_FLAK_SPEC } from '../../world/shipGuns'
import { POLTAVA_GROUND } from './shared'
import type { GroundEntry, MissionCard } from './types'

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

/** 德軍線的三關。**這一條線的卡片只住在這裡。** */
export const GERMANY: readonly MissionCard[] = [
  {
    id: 'germany-m1', title: '梅澤堡上空', type: '攔截',
    summary: '駕駛 Bf 109 K-4 在薩勒河平原上空攔截飛往洛伊納的 B-17 轟炸機流，把它們的損失推上去。',
    place: '德國中部　梅澤堡—洛伊納', period: '1944 年 11 月',
    battle: {
      objective: '擊落 B-17', banner: '攔截轟炸機流，擊落 B-17',
      blueSpec: BF109K4, redSpec: P51D, convoySpec: B17G,
      /**
       * 【在路途上攔截】B-17 是 transit：從進場點直飛終點、不迴轉、不投彈。
       * 到了終點就從進場點重新進場（`conveyor` 節拍），轟炸機流因此不斷。
       * 終點不判勝負 —— 數的是累計擊落，攔下哪一批不重要。
       *
       * 【沒有地面目標】廠區屬於盟 M2；地形留洛伊納是因為薩勒河平原本來就對。
       *
       * 【開場沒有戰鬥機】護航的 P-51 全部由波次給，`redSpec` 是它們的機種。
       */
      blueCount: 8, redCount: 0,
      convoyCount: 8, convoyDuty: 'stream', convoyPriority: 1,
      // 【終點在我方後方 12 km】紅方從 z = −5,000 出發，一趟 17 km。**起始值**
      targetDistance: 12000, targetRadius: 1000, seconds: Infinity,
      entry: 'headOn',
      terrain: 'leuna',
      timeOfDay: 'novemberNoon',
      // 【只算轟炸機】打護航機過不了關。**起始值，由試飛裁定**
      huntCount: 6, huntRole: 'bomber',
      // 紅隊席位 8 + 4 + 4 = 16
      waves: [
        {
          when: { kind: 'clock', at: 0 },
          warn: '前方轟炸機群，P-51 護航',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4,
        },
        {
          when: { kind: 'clock', at: 60 },
          warn: '警告：敵方護航機接近中',
          warnLead: 4,
          side: 'theirs', spec: P51D, count: 4,
        },
      ],
    },
  },
  {
    id: 'germany-m2', title: '波爾塔瓦之夜', type: '打擊',
    summary: '駕駛 KG 55 的 He 111 夜襲波爾塔瓦機場，炸掉穿梭轟炸落地的 B-17。',
    place: '烏克蘭　波爾塔瓦機場上空', period: '1944 年 6 月',
    battle: {
      objective: '炸毀停放的 B-17', banner: '夜襲機場，炸毀 B-17',
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
      // 【炸毀任意十二座】池是 24 架 B-17、3 堆、22 座砲位、6 座探照燈。
      // 8 架 × 8 枚 = 64 枚。**起始值**
      destroyCount: 12,
      // 【重砲照 5 吋艦砲的路數】高射速、小範圍、單發輕 —— 與盟 M4 的艦隊
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
    id: 'germany-m4', title: '底板行動', type: '打擊',
    summary: '駕駛 Bf 109 K-4 貼著樹梢撲向 Y-29 前進機場，趁野馬還在跑道上把它們打掉。',
    place: '比利時　阿什 Y-29 機場', period: '1945 年 1 月',
    battle: {
      objective: '摧毀地面上的 P-51', banner: '掃射機場，打掉野馬',
      blueSpec: BF109K4, redSpec: P51D, convoySpec: null,
      // 【開場沒有敵機在我方前方】巡邏隊與起飛的野馬全部由波次給。
      // 紅隊席位：巡邏 4 + 停機線 12（三個小隊）= 16
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
      // 【炸毀八架停放的 P-51】油桶堆與輕砲打得掉但不算。起飛離場的不在池裡。
      // **起始值**
      destroyCount: 8, destroyUnit: 'parkedP51',
      /**
       * 【停機線上的每一架最後都起得來】三批各一個小隊、席位合計 12，等於停機線。
       * 被打掉的起不來：那一批地上剩幾架就上幾架（`setup.ts` 的 `reinforce`），
       * 一架都不剩就不來。打得慢就全部升空 —— 那正是這一關的壓力。
       * 秒數與第一批的門檻是**起始值，由試飛裁定**。
       */
      waves: [
        {
          when: { kind: 'clock', at: 0 },
          // 第 366 大隊的 P-47 已經在空中；由 P-51 代打
          warn: '上空有 P-51 巡邏',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, altitude: 2000,
        },
        {
          // 【打得快就沒人上來】40 秒時地上的摧毀數不到 6，第一個小隊開始滾行
          when: { kind: 'ground', below: 6, byLatest: 40 },
          warn: '跑道上的野馬開始滾行',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, takeoff: TAKEOFF_LINE, departs: 'parkedP51',
        },
        {
          when: { kind: 'clock', at: 80 },
          warn: '又一個小隊的野馬起飛',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, takeoff: TAKEOFF_LINE, departs: 'parkedP51',
        },
        {
          when: { kind: 'clock', at: 120 },
          warn: '停機線上的野馬全部升空',
          warnLead: 0,
          side: 'theirs', spec: P51D, count: 4, takeoff: TAKEOFF_LINE, departs: 'parkedP51',
        },
      ],
    },
  },
]
