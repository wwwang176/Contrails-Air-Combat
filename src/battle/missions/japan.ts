import { Vector3 } from 'three'
import { F4F4 } from '../../specs/f4f4'
import { F6F5 } from '../../specs/f6f5'
import { KI84_BOMB_LOADOUT } from '../../weapons/stores'
import { GROUND_FLAK_SPEC } from '../../world/shipGuns'
import {
  LEYTE_BALLOONS, LEYTE_BEACH, LEYTE_FLAK_SITES, LEYTE_JUNCTIONS, LEYTE_LSTS, LEYTE_ROAD, LST_BALLOON_DECK,
} from '../../world/leyte'
import { KI84 } from '../../specs/ki84'
import { A6M5 } from '../../specs/a6m5'
import { G4M } from '../../specs/g4m'
import { KILL, RENNELL_FLEET } from './shared'
import type { BalloonEntry, GroundEntry, MissionCard, MissionFleet } from './types'

/**
 * 瓜島外海登陸船團的護衛艦隊。**美軍，全部是紅隊，沒有要害艦。**
 *
 * ## 史實
 *
 * 1942 年 8 月 7 日，第 62 特遣艦隊的運輸船停在瓜島北岸的倫加角外，由
 * Crutchley 少將的巡洋艦與驅逐艦護衛。遊戲沒有運輸船模型，這一關的目標群
 * 用現有艦級組成「護衛艦隊」。
 *
 * ## 為什麼擠在原點 ±300 × ±1,100 m 之內
 *
 * 群島地形的兩座島在 (±2,500, ∓950)，最外緣半徑 1,806 與 1,935 m，外面
 * 還有 200 m 的岸帶。艦隊寬過 ±300 m 就有船落在淺灘或島上，而且不報錯。
 * 航速 8 m/s 朝 −Z，三分鐘漂 1.4 km，仍在兩座島之間。
 *
 * **艦數與陣型是起始值，由試飛裁定。**
 */
const GUADALCANAL_FLEET: MissionFleet = {
  center: new Vector3(0, 0, 0),
  heading: 0,
  speed: 8,
  ships: [
    // 巡洋艦：中線縱隊，−Z 是艦首方向
    { cls: 'wichita', team: 'red', offset: new Vector3(0, 0, -250) },
    { cls: 'wichita', team: 'red', offset: new Vector3(0, 0, 350) },
    // 驅逐艦：前後各一對
    { cls: 'fletcher', team: 'red', offset: new Vector3(-300, 0, -900) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(300, 0, -900) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(-300, 0, 900) },
    { cls: 'fletcher', team: 'red', offset: new Vector3(300, 0, 900) },
  ],
}

/**
 * 雷伊泰灘頭搶灘的 LST，**美軍、紅隊、不會動**。位置與艏向在
 * `world/leyte.ts` 的 `LEYTE_LSTS`；中心在原點、整隊艏向 0，偏移就是世界座標。
 */
const LEYTE_LST_FLEET: MissionFleet = {
  center: new Vector3(0, 0, 0),
  heading: 0,
  speed: 0,
  ships: LEYTE_LSTS.map((l) => ({
    cls: 'lst' as const, team: 'red' as const, offset: new Vector3(l.x, 0, l.z), heading: l.heading,
  })),
}

/**
 * 雷伊泰灘頭的防空氣球，**美軍、紅隊**。位置與高度在 `world/leyte.ts` 的
 * `LEYTE_BALLOONS`；繫在船上的那幾顆，`ship` 就是 `LEYTE_LST_FLEET` 的第幾艘。
 */
const LEYTE_BALLOON_ENTRIES: readonly BalloonEntry[] = LEYTE_BALLOONS.map((b): BalloonEntry => ({
  team: 'red',
  anchor: 'ship' in b.anchor
    ? { ship: b.anchor.ship, deck: new Vector3(LST_BALLOON_DECK.x, LST_BALLOON_DECK.y, LST_BALLOON_DECK.z) }
    : { x: b.anchor.x, z: b.anchor.z },
  tether: b.tether,
  heading: b.heading,
}))

/** 日本線的三關。**這一條線的卡片只住在這裡。** */
export const JAPAN: readonly MissionCard[] = [
  {
    id: 'japan-m1', titleKey: 'mission.japan-m1.title', type: 'escort',
    summaryKey: 'mission.japan-m1.summary',
    placeKey: 'mission.japan-m1.place', period: { year: 1942, month: 8 },
    battle: {
      ...KILL,
      objectiveKey: 'mission.japan-m1.objective', bannerKey: 'mission.japan-m1.banner',
      // 【零戰與陸攻，不是 21 型】遊戲每個陣營只有一台戰鬥機模型，卡片寫戰役
      // 不寫次型號
      blueSpec: A6M5, redSpec: F4F4,
      // 【12 + 8 = 20 席，藍隊用滿】陸攻活幾架決定沉幾艘，那是這一關的骨架，
      // 所以加的是零戰。敵方維持 8 架加重生，一次只動一邊。**起始值。**
      blueCount: 12, redCount: 8,
      // 【攻擊隊是 strike】陸攻照常走雷擊航路、照常閃彈，擊沉數由它們達成。
      // 誤成 transit 的話它們會直飛到一個不存在的終點
      convoySpec: G4M, convoyCount: 8, convoyDuty: 'strike',
      convoyRows: { size: 4, depth: 140 },
      convoySpawnAltitude: 201,
      // 【F4F 先打陸攻】沒有偏置時 F4F 會去纏會還手的零戰。20 倍以上 F4F 鎖陸攻的
      // 比例就不再上升。**起始值。**
      bomberPriority: 20,
      terrain: 'archipelago',
      // 圍著艦隊；雙方開場在 z ±5 km
      arena: { x: 0, z: -1000, radius: 10000 },
      // 熱帶積雲
      clouds: { yMin: 600, yMax: 900, amount: 'some' },
      fleet: GUADALCANAL_FLEET,
      sinkCount: 3,
      /**
       * 【開場導覽】先交代護送的魚雷機與其攻擊目標，再呈現玩家的高空掩護位置：
       *
       * ```
       *   1  G4M 由 201 m 進場，每排四架、前後相隔 140 m；右後方約 30 度近拍後排最右一架
       *   2  前方巡洋艦第 2.5～5 秒由 (0, 0, −270) 航行到 (0, 0, −290)，左舷前上方近拍艦身與砲塔
       *   3  第 6 秒玩家約在 (−750, 1,311, 4,249)，魚雷機在 y 180、z 4,450 附近；
       *      由玩家後上方朝北俯拍，讓零戰在前景、魚雷機兩排在下方後景，漸變回操作視角
       * ```
       *
       * 魚雷機鏡頭沿航線移動，避免轉彎時鏡頭繞機身、甩出後方編隊；玩家跟拍以俯角
       * 涵蓋約 1,100 m 下方的被護送編隊。**鏡位與秒數是起始值。**
       */
      intro: [
        {
          kind: 'pan', seconds: 2.5, fov: 50,
          from: { x: -335, y: 226, z: 5122 }, to: { x: -331, y: 208, z: 4893 },
          lookFrom: { x: -400, y: 201, z: 5070 }, lookTo: { x: -396, y: 183, z: 4841 },
        },
        {
          kind: 'pan', seconds: 2.5, fov: 42,
          from: { x: -190, y: 90, z: -450 }, to: { x: -175, y: 85, z: -445 },
          lookFrom: { x: 0, y: 12, z: -270 }, lookTo: { x: 0, y: 12, z: -290 },
        },
        {
          kind: 'follow', seconds: 3, subject: { player: true },
          back: 0.5, up: 70, side: 0, lead: 0, lookUp: 0, fov: 52,
        },
      ],
      // 【低空】陸攻從 5 km 外進場，4,000 m 開場的話到船團上空還沒降到投雷
      // 高度，整趟帶著雷飛過去。與日 M3 同一個值。**起始值。**
      altitude: 1000,
      // 【沒有 `blueLoadout`】陸攻掛魚雷，照 G4M 的預設。覆寫會套到藍隊全體
      recycle: {
        side: 'theirs', role: 'fighter', batches: 3,
        warnKey: 'mission.japan-m1.recycle', warnLead: 5,
      },
    },
  },
  {
    id: 'japan-m2', titleKey: 'mission.japan-m2.title', type: 'strike',
    summaryKey: 'mission.japan-m2.summary',
    placeKey: 'mission.japan-m2.place', period: { year: 1944, month: 11 },
    battle: {
      objectiveKey: 'mission.japan-m2.objective', bannerKey: 'mission.japan-m2.banner',
      blueSpec: KI84, redSpec: F6F5, convoySpec: null,
      // 【疾風六架】雷伊泰期間陸航的戰力一直在耗損（誉發動機故障、燃料差、補充跟
      // 不上），對地攻擊多是幾架的小編隊
      //
      // 【開場就有兩架 F6F 在巡邏】生在紅方那一側（灘頭外的海上）朝內陸飛，玩家到
      // 車隊上空時會碰上 —— 找車與俯衝的時候就要分心。其餘 F6F 由波次給
      blueCount: 6, redCount: 2,
      // 【前後排列】四機與雙機兩個小隊前後拉開（`order.ts` 的 `stackedEntry`）
      blueStacked: true,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'leyte',
      // 灘頭、三個路口據點與開場位置（z = +5 km）
      arena: { x: 2000, z: 2000, radius: 11000 },
      // 【開場導覽】先在車隊第一輛卡車的前方路邊貼地拍，卡車由 30 m 外迎面開到 12 m
      // （它前面 30 m 是半履帶車，鏡頭在兩車之間）；再從內陸高處沿灘頭橫移，LST
      // 卸貨區旁的九輛目標卡車（x 1,900～3,700）都在畫面裡；最後由右前側特寫玩家 Ki-84。
      // **鏡位與秒數是起始值。**
      intro: [
        {
          kind: 'follow', seconds: 3.6, subject: { ground: 'usTruck' },
          back: -30, backTo: -12, up: 1.8, side: 6, lead: 0, lookUp: 1.6,
        },
        {
          kind: 'pan', seconds: 3.4,
          from: { x: 2300, y: 450, z: -2700 }, to: { x: 3300, y: 450, z: -2700 },
          lookFrom: { x: 2600, y: 0, z: -3700 }, lookTo: { x: 3000, y: 0, z: -3700 },
        },
        {
          kind: 'follow', seconds: 3, subject: { player: true },
          back: -22, backTo: -18, up: 5, side: 25, sideTo: 29, lead: 0, lookUp: 1, fov: 38,
        },
      ],
      // 暴雨的雲低又多；暗色雲與天空接近，要多才看得出來
      clouds: { yMin: 400, yMax: 900, amount: 'many' },
      altitude: 1500,
      loadouts: { ki84: KI84_BOMB_LOADOUT },
      // 【僚機先打卡車】遭到敵機直接瞄準時才自衛。掛著彈時先投彈、投完掃射
      priorityGroundUnit: 'usTruck',
      /**
       * 【三批、每批六輛】M16 防空車頭尾各一、CCKW 卡車 3、雪曼 1。戰車只有炸彈
       * 炸得掉、不計分；防空車照陸上輕型砲開火。
       *
       * 【開場就全部在走】最後一批從灘頭起步，前兩批依序在它前面，批與批之間
       * 空 600 m（車頭到車頭 750 m）。全程約 6.6 km，第一批開場已經走了約 2 km，
       * 大約 7 分半抵達前線。**全部是起始值，由試飛裁定。**
       */
      vehicleConvoy: {
        route: LEYTE_ROAD, speed: 10, turnRadius: 25, gap: 30, batchGap: 600,
        // 【雪曼車頂的 .50】戰車會還擊；卡車不還手，火力只有雪曼與 M16
        armed: ['usTank'],
        batches: [
          { units: ['usFlakTrack', 'usTruck', 'usTruck', 'usTank', 'usTruck', 'usFlakTrack'] },
          { units: ['usFlakTrack', 'usTruck', 'usTruck', 'usTank', 'usTruck', 'usFlakTrack'] },
          { units: ['usFlakTrack', 'usTruck', 'usTruck', 'usTank', 'usTruck', 'usFlakTrack'] },
        ],
      },
      ground: [
        // 【灘頭與前線的固定砲位】位置在 `world/leyte.ts`。不在截斷的池裡，打掉不算
        ...LEYTE_FLAK_SITES.map((s): GroundEntry => ({
          unit: s.unit, team: 'red', x: s.x, z: s.z, heading: 0,
        })),
        // 【灘頭卸貨區旁的卡車】九輛停著的卡車，與車隊的卡車一起算進摧毀數；不會開到前線，
        // 不算抵達。在灘頭重高砲的射界裡
        ...LEYTE_BEACH.depot.map((v): GroundEntry => ({
          unit: v.unit, team: 'red', x: v.x, z: v.z, heading: v.heading,
        })),
        // 【路口據點】停著等通行的卡車算進摧毀數；每一處兩輛 M16 守著。木箱堆是佈景
        ...LEYTE_JUNCTIONS.flatMap((j) => [...j.trucks, ...j.flak]).map((v): GroundEntry => ({
          unit: v.unit, team: 'red', x: v.x, z: v.z, heading: v.heading,
        })),
      ],
      // 【灘頭搶灘的 LST】不會動的船：撞得到、打得沉、防空砲會開火。沒有
      // `vital`、沒有 `sinkCount` —— 不是任務目標，沉幾艘都不影響勝負
      fleet: LEYTE_LST_FLEET,
      // 【防空氣球】撞到鋼索或氣囊會墜機、打得破；AI 把它們當成看不見的山避開
      balloons: LEYTE_BALLOON_ENTRIES,
      /**
       * 【90 mm 配 SCR-584 雷達射控】比德軍的 88 準：引信誤差由 ±6% 壓到 ±2%、
       * 射速 20 發/分、單朵雲重一點。在任務高度 1,500 m 真的打得到人。
       * **起始值，由試飛裁定。**
       */
      flakSpec: {
        ...GROUND_FLAK_SPEC, roundsPerMinute: 20, fuseError: 0.02, burstRadius: 60, burstDamage: 160,
      },
      // 【雷雨】雨、閃電與雷聲（`render/rain.ts`、`render/storm.ts`）。雷伊泰戰役正值雨季
      timeOfDay: 'storm',
      // 【26 輛卡車（車隊 9、灘頭 9、路口 8）：炸 20 輛過關、放走 7 輛就輸】20 + 7 > 26，
      // 兩條不會同時可能。只有車隊那 9 輛開得到前線
      interdict: { count: 20, leak: 7, unit: 'usTruck' },
      /**
       * 【每波兩架、一波一波來】一次來四架的話玩家還在找車就被咬住。
       *
       *   第一波  開始攻擊之後進場（遲遲不動手的話 90 秒也會來）。`starboard: π`
       *           把紅方的進場轉到 +Z 那一側（Ki-84 來的方向）
       *   第二、三波  150 秒、240 秒，照時鐘來、不看炸了幾輛 —— 炸得快也不會讓
       *           敵機一口氣湧上來。一波從灘頭外的海上、一波從內陸
       *
       * 紅隊席位：巡邏 2 + 2 × 3 = 8。**架數、時間、高度、位置都是起始值。**
       */
      waves: [
        {
          when: { kind: 'destroyed', atLeast: 1, unit: 'usTruck', byLatest: 90 },
          warnKey: 'mission.japan-m2.wave.carrier',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 2, starboard: Math.PI, altitude: 2500,
        },
        {
          when: { kind: 'clock', at: 150 },
          warnKey: 'mission.japan-m2.wave.carrier',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 2, altitude: 2000,
        },
        {
          when: { kind: 'clock', at: 240 },
          warnKey: 'mission.japan-m2.wave.carrier',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 2, starboard: Math.PI, altitude: 2500,
        },
      ],
    },
  },
  {
    id: 'japan-m3', titleKey: 'mission.japan-m3.title', type: 'strike',
    summaryKey: 'mission.japan-m3.summary',
    placeKey: 'mission.japan-m3.place', period: { year: 1943, month: 1 },
    battle: {
      ...KILL,
      objectiveKey: 'mission.japan-m3.objective', bannerKey: 'mission.japan-m3.banner',
      // 【F4F-4 不是 F6F-5】1943 年 1 月的攔截者是企業號 VF-10 的野貓；
      // 地獄貓 1943 年 8 月才首戰，晚了七個月。
      blueSpec: G4M, redSpec: F4F4,
      // 【11 架陸攻是史實的量級】倫內爾島 29 日黃昏兩波共約 31 架一式陸攻，
      // 30 日再來 11 架。取 30 日那一波的架數，但**保留 29 日的黃昏**
      // （卡片文案就是那一波）。
      //
      // 【野貓 3 架，一個小隊】史實 30 日先 6 架接戰、再追上 4 架，陸攻損失七、八成；
      // 一被發現就全力攔截的話陸攻整批死在進場路上。**由試飛裁定。**
      blueCount: 11, redCount: 3,
      terrain: 'sea',
      // 圍著艦隊；雙方開場在 z ±5 km
      arena: { x: 0, z: 0, radius: 10000 },
      // 黃昏的橘雲
      clouds: { yMin: 800, yMax: 1500, amount: 'some' },
      fleet: RENNELL_FLEET,
      /**
       * 【開場導覽】先辨認要雷擊的軍艦，再帶出艦隊規模與玩家的低空進場：
       *
       * ```
       *   1  左列前導巡洋艦由 (−250, 0, −300) 航行到 (−250, 0, −320)，左舷前上方近拍艦身與砲塔
       *   2  第 2.5～5.5 秒，從艦隊後方斜俯拍四艘巡洋艦與前方驅逐艦警戒幕
       *   3  第 6 秒玩家 G4M 約在 (−1,350, 242, 4,452)，左後上方近拍；右側後景帶出 4／4／3 架交錯進場的編隊
       * ```
       *
       * 船艦鏡頭的注視點跟著 8 m/s 航速前進；最後一幕跟拍玩家，收尾持續跟隨並漸變回操作視角。
       * 艦隊尚未警戒，導覽不安排開砲。**鏡位與秒數是起始值。**
       */
      intro: [
        {
          kind: 'pan', seconds: 2.5, fov: 42,
          from: { x: -440, y: 85, z: -480 }, to: { x: -425, y: 80, z: -480 },
          lookFrom: { x: -250, y: 12, z: -300 }, lookTo: { x: -250, y: 12, z: -320 },
        },
        {
          kind: 'pan', seconds: 3, fov: 52,
          from: { x: -650, y: 700, z: 1650 }, to: { x: -590, y: 670, z: 1590 },
          lookFrom: { x: 0, y: 0, z: -350 }, lookTo: { x: 0, y: 0, z: -374 },
        },
        {
          kind: 'follow', seconds: 3, subject: { player: true },
          back: 27, up: 13, side: -46, lead: 0, lookUp: 0, fov: 44,
        },
      ],
      // 【1,000 m 是紅方的開場高度】藍方由下面的 `blueSpawn` 另外排
      altitude: 1000,
      // 【低空交錯進場】高度 200–300 m，低於警戒高度 500 m；三排 4／4／3 架，同排間距 400 m、排距 220 m
      blueSpawn: { altitudeMin: 200, altitudeMax: 300, spacing: 400, rows: { size: 4, depth: 220 } },
      // 【被發現才開打】史實的黃昏雷擊沒有護航，陸攻貼海從暗的一側進場、最後才被目視發現。
      // 警戒前野貓在艦隊上空左右 5 km 之間來回巡邏不接戰，艦砲與陸攻砲塔停火；
      // 陸攻飛高、靠近敵機或敵艦、投雷或打中東西就進入警戒（門檻在 `battle/alert.ts`）。
      // 巡邏的寬度、高度與折返半徑是**起始值，由試飛裁定**
      alert: {
        messageKey: 'mission.japan-m3.alert',
        patrolHalfWidth: 5000, patrolAltitude: 800, patrolRadius: 500,
      },
      // 【擊沉任意四艘】八艘裡挑四艘，玩家自己決定打哪幾艘 —— 那本來
      // 就是雷擊機該做的決定。
      sinkCount: 4,
      // 【沒有 `blueLoadout`】掛魚雷，照 G4M 的預設。AI 的雷擊剖面在 `ai/torpedoRun.ts`
      // 【卡片文案就寫黃昏】「趁著黃昏貼海飛行」
      timeOfDay: 'dusk',
    },
  },
]
