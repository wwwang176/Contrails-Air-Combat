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
import { YAK1B } from '../../specs/yak1b'
import {
  ARTILLERY_ZONE, AT_GUNS, BATTLE_HAZE, COLUMN_GAP, COLUMN_SPEED, COLUMN_TURN_RADIUS, FRONT_T34, FRONT_T34_SCRIPTED,
  GERMAN_INFANTRY, GERMAN_MORTARS, RZHEV_DUSTS, RZHEV_SMOKES, PANZER_ROUTE_A, PANZER_ROUTE_B, SOVIET_FLAK, SOVIET_INFANTRY,
  SOVIET_MORTARS, SOVIET_TRUCKS, STALLED_PANZERS, T34_RESERVE_EAST, T34_RESERVE_WEST, WRECK_PANZERS, WRECK_T34,
} from '../../world/rzhev'
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
 * 庫斯克的固定地面單位。佈局在 `world/rzhev.ts`。
 *
 * 【殘骸與劇本】`killAt: 0` 的是開場就燒著的殘骸；其餘 `killAt` 是地面戰的戲裡
 * 照劇本被打掉的那幾輛。劇本打掉的不算進摧毀數。
 */
const RZHEV_GROUND: readonly GroundEntry[] = [
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
  ...SOVIET_MORTARS.map((s): GroundEntry => ({ unit: 'mortar', team: 'red', ...s })),
  ...GERMAN_MORTARS.map((s): GroundEntry => ({ unit: 'mortar', team: 'blue', ...s })),
  ...SOVIET_TRUCKS.map((s): GroundEntry => ({ unit: 'truck', team: 'red', ...s })),
]

/**
 * 第一段要炸掉幾門反坦克砲。**不必全部殲滅** —— 炸到這個數，缺口就開了，德軍的戰車往前推，
 * 剩下的由它們打掉（`mopUp`）。史實上德軍當面是一整個裝甲師的一個團，不是十二輛；戰車的數量
 * 夠多，地面戰才有「隊友在打」的分量。**起始值，由試飛裁定。**
 */
const BREAKTHROUGH_GUNS = 7

/** 反坦克砲炸夠數：德軍推進、蘇軍反擊、目標換成反擊的 T-34、剩下的砲被打掉，同一刻 */
const RZHEV_BREAKTHROUGH: MissionTrigger = { kind: 'destroyed', atLeast: BREAKTHROUGH_GUNS, unit: 'atGun' }

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
      // 【開場沒有敵機】`redCount` 是 0，`redSpec` 只是型別要填；蘇軍戰鬥機走下面的 `waves`
      // 【2 + 2 + 2】三批各兩架，相鄰兩批前後差 2,300 m：開場速度約 95 m/s，晚約 24 秒到目標；
      // Ju 87 一輪約 72 秒，三批的俯衝大致錯開三分之一輪。**起始值，由試飛裁定**
      //
      // 【護航六架】與 Ju 87 同一刻生成：3 + 3 兩個小隊，在轟炸機上方 600 m、落在中間那一批旁邊
      // （落後 2,300 m）、左右各 ±400 m。Bf 109 K-4 只是代用的機型
      blueCount: 6, redCount: 0,
      blueWaves: { size: 2, depth: 2300, escort: { spec: BF109K4, count: 6, depth: 2300 } },
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'strikeDeep',
      terrain: 'rzhev',
      // 【清晨】日出後的低太陽；砲擊與車輛揚起的塵土，地平線一片黃褐
      timeOfDay: 'julyMorning',
      /**
       * 【2,000 m】俯衝轟炸要有高度可以換；輕型防空的射程 2,640 m 打得到。
       * **起始值，由試飛裁定。**
       */
      altitude: 2000,
      ground: RZHEV_GROUND,
      /**
       * 【兩路德軍開場就在、蘇軍預備隊藏著】四支同一個觸發出發。德軍兩支都走路（A 在斜路、
       * B 在南路跟在後面）；蘇軍兩支出發前不在場上、從村北沿村的東西外側南下 —— 第一段先炸掉
       * 它們的話，第二段一開始就達成了
       */
      columns: [
        {
          team: 'blue', route: PANZER_ROUTE_A, speed: COLUMN_SPEED, turnRadius: COLUMN_TURN_RADIUS,
          gap: COLUMN_GAP, units: ['panzer4', 'panzer4', 'tiger', ...Array<'panzer4'>(7).fill('panzer4')],
          depart: RZHEV_BREAKTHROUGH,
        },
        {
          team: 'blue', route: PANZER_ROUTE_B, speed: COLUMN_SPEED, turnRadius: COLUMN_TURN_RADIUS,
          gap: COLUMN_GAP, units: ['panzer4', 'tiger', ...Array<'panzer4'>(8).fill('panzer4')],
          depart: RZHEV_BREAKTHROUGH,
        },
        {
          team: 'red', route: T34_RESERVE_WEST, speed: COLUMN_SPEED, turnRadius: COLUMN_TURN_RADIUS,
          gap: COLUMN_GAP, units: Array<'tank'>(10).fill('tank'),
          depart: RZHEV_BREAKTHROUGH, hidden: true,
        },
        {
          team: 'red', route: T34_RESERVE_EAST, speed: COLUMN_SPEED, turnRadius: COLUMN_TURN_RADIUS,
          gap: COLUMN_GAP, units: Array<'tank'>(10).fill('tank'),
          depart: RZHEV_BREAKTHROUGH, hidden: true,
        },
      ],
      // 【第一段：反坦克砲炸掉七門】防空、步兵、半埋的 T-34 打得掉但不算
      destroyCount: BREAKTHROUGH_GUNS, destroyUnit: 'atGun',
      // 【炸夠數之後，剩下的砲由前進的德軍坦克打掉】劇本打掉的不算摧毀數；畫面上由地面戰的戲補
      // 一發命中的砲彈。**起始值，由試飛裁定**
      mopUp: { when: RZHEV_BREAKTHROUGH, unit: 'atGun', within: [12, 45] },
      // 【第二段：反擊的預備隊 T-34 炸掉 8 輛】二十輛裡的八輛，其餘由德軍的戰車對付。**起始值，由試飛裁定**
      retarget: {
        when: RZHEV_BREAKTHROUGH, messageKey: 'mission.germany-m4.retarget',
        destroyCount: 8, destroyUnit: 'tank',
      },
      // 【節奏】一台平均 4 秒一發，步兵的班也一樣；再慢從空中看起來像沒在交火。砲兵的彈著 1.6 秒一柱
      theater: {
        shooters: ['panzer4', 'tiger', 'tank', 'tankDug', 'atGun', 'infantry', 'mortar'],
        period: 4,
        range: 1500,
        artillery: { ...ARTILLERY_ZONE, period: 1.6 },
        smokes: RZHEV_SMOKES,
        haze: BATTLE_HAZE,
        dusts: RZHEV_DUSTS,
      },
      /**
       * 【蘇軍戰鬥機六架】開場後 90 秒（預警 5 秒）兩批各三架 Yak-1B 從北邊進場。
       *
       * 【Yak 先打 Ju 87】`bomberPriority` 讓 Ju 87 在 Yak 的目標評分裡值 20 倍，不去纏護航機。
       *
       * 【護航機只打飛機】`airOnly`：沒被分到目標的僚機預設去掃射地面，敵機進場前整隊也會離開
       * 轟炸機去掃地、或直飛出場；開了之後沒有空中目標時，僚機飛站位跟長機，長機守在最近的友軍
       * 轟炸機旁（後 150 m、側 350 m、上 450 m），Yak 進場後去打 Yak。
       *
       * 【Ju 87 全滅就敗】`defeatOnBombers`：護航機還活著也一樣。
       *
       * 全 AI 量測：Ju 87 六架到 420 秒還剩三架（沒有護航時 177 秒全滅），護航六架都活著、Yak 掉兩架。
       * 架數與時間都是**起始值，由試飛裁定**。
       */
      bomberPriority: 20,
      airOnly: true,
      defeatOnBombers: true,
      waves: [
        {
          when: { kind: 'clock', at: 85 },
          warnKey: 'mission.germany-m4.wave.fighters',
          warnLead: 5,
          side: 'theirs', spec: YAK1B, count: 3,
        },
        {
          when: { kind: 'clock', at: 85 },
          warnKey: 'mission.germany-m4.wave.fighters',
          warnLead: 5,
          side: 'theirs', spec: YAK1B, count: 3,
        },
      ],
    },
  },
]
