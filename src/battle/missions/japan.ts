import { Vector3 } from 'three'
import { F4F4 } from '../../specs/f4f4'
import { F6F5 } from '../../specs/f6f5'
import { KI84_BOMB_LOADOUT } from '../../weapons/stores'
import { GROUND_FLAK_SPEC } from '../../world/shipGuns'
import { EVACUATE_Z, LEYTE_FLAK_SITES, LEYTE_ROAD } from '../../world/leyte'
import { KI84 } from '../../specs/ki84'
import { A6M5 } from '../../specs/a6m5'
import { G4M } from '../../specs/g4m'
import { KILL, RENNELL_FLEET } from './shared'
import type { GroundEntry, MissionCard, MissionFleet } from './types'

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

/** 日本線的三關。**這一條線的卡片只住在這裡。** */
export const JAPAN: readonly MissionCard[] = [
  {
    id: 'japan-m1', title: '瓜達康納爾上空', type: '護航',
    summary: '駕駛零戰護送一式陸攻，擋下美軍戰鬥機，讓陸攻用魚雷擊沉敵艦。',
    place: '所羅門　瓜達康納爾外海', period: '1942 年 8 月',
    battle: {
      ...KILL,
      objective: '讓陸攻擊沉敵艦', banner: '野貓來了，保護好陸攻',
      // 【零戰與陸攻，不是 21 型】遊戲每個陣營只有一台戰鬥機模型，卡片寫戰役
      // 不寫次型號
      blueSpec: A6M5, redSpec: F4F4,
      // 【12 + 8 = 20 席，藍隊用滿】陸攻活幾架決定沉幾艘，那是這一關的骨架，
      // 所以加的是零戰。敵方維持 8 架加重生，一次只動一邊。**起始值。**
      blueCount: 12, redCount: 8,
      // 【攻擊隊是 strike】陸攻照常走雷擊航路、照常閃彈，擊沉數由它們達成。
      // 誤成 transit 的話它們會直飛到一個不存在的終點
      convoySpec: G4M, convoyCount: 8, convoyDuty: 'strike',
      terrain: 'archipelago',
      fleet: GUADALCANAL_FLEET,
      sinkCount: 3,
      // 【低空】陸攻從 5 km 外進場，4,000 m 開場的話到船團上空還沒降到投雷
      // 高度，整趟帶著雷飛過去。與日 M3 同一個值。**起始值。**
      altitude: 1000,
      // 【沒有 `blueLoadout`】陸攻掛魚雷，照 G4M 的預設。覆寫會套到藍隊全體
      recycle: {
        side: 'theirs', role: 'fighter', batches: 3,
        warn: '警告：敵方戰鬥機再度升空', warnLead: 5,
      },
    },
  },
  {
    id: 'japan-m2', title: '雷伊泰前線', type: '打擊',
    summary: '駕駛疾風掛彈攻擊美軍補給車隊，趕在它們抵達前線之前，然後撤離。',
    place: '菲律賓　雷伊泰島', period: '1944 年 11 月',
    battle: {
      objective: '炸毀補給卡車', banner: '找到車隊，別讓它們抵達前線',
      blueSpec: KI84, redSpec: F6F5, convoySpec: null,
      // 【疾風只有一個小隊】雷伊泰期間陸航的戰力一直在耗損（誉發動機故障、燃料差、
      // 補充跟不上），對地攻擊多是幾架的小編隊。對地的工作因此大部分落在玩家身上
      //
      // 【開場就有兩架 F6F 在巡邏】生在紅方那一側（灘頭外的海上）朝內陸飛，玩家到
      // 車隊上空時會碰上 —— 找車與俯衝的時候就要分心。其餘 F6F 由波次給
      blueCount: 4, redCount: 2,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'leyte',
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
      // 【灘頭與前線的固定砲位】位置在 `world/leyte.ts`。不在截斷的池裡，打掉不算
      ground: LEYTE_FLAK_SITES.map((s): GroundEntry => ({
        unit: s.unit, team: 'red', x: s.x, z: s.z, heading: 0,
      })),
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
      // 【9 輛卡車：炸 6 輛、放走 4 輛就輸】6 + 4 > 9，兩條不會同時可能
      interdict: { count: 6, leak: 4, unit: 'usTruck' },
      /**
       * 【每波兩架、一波一波來】一次來四架的話玩家還在找車就被咬住。
       *
       * 攻擊階段：
       *   第一波  開始攻擊之後進場（遲遲不動手的話 90 秒也會來）。`starboard: π`
       *           把紅方的進場轉到 +Z 那一側（Ki-84 來的方向）
       *   第二、三波  150 秒、240 秒，照時鐘來、不看炸了幾輛 —— 炸得快也不會讓
       *           敵機一口氣湧上來。一波從灘頭外的海上、一波從內陸
       *
       * 【撤離時兩面夾，錯開進場】轉入撤離的那一刻預警，進場由 `warnLead` 錯開：
       *   追兵  0 秒  紅方原本那一側（灘頭外的海上），從玩家背後追上來
       *   堵截  20 秒  +Z 那一側、撤退路線的半途（z ≈ +5,000），比任務高度高
       *         1,500 m，從上方撲向撤退的玩家
       *   追兵  40 秒  再一組從背後追上來
       * 三組與返航同一步觸發。`stepBeats` 依陣列順序寫訊息、返航排在最後，
       * 所以畫面上是「撤離戰區」，預警文字就寫同一句。
       *
       * 紅隊席位：巡邏 2 + 2 × 6 = 14。**架數、時間、高度、位置都是起始值。**
       */
      waves: [
        {
          when: { kind: 'destroyed', atLeast: 1, unit: 'usTruck', byLatest: 90 },
          warn: '敵艦載機接近中',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 2, starboard: Math.PI, altitude: 2500,
        },
        {
          when: { kind: 'clock', at: 150 },
          warn: '敵艦載機接近中',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 2, altitude: 2000,
        },
        {
          when: { kind: 'clock', at: 240 },
          warn: '敵艦載機接近中',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 2, starboard: Math.PI, altitude: 2500,
        },
        {
          when: { kind: 'destroyed', atLeast: 6, unit: 'usTruck' },
          warn: '撤離戰區',
          warnLead: 0,
          side: 'theirs', spec: F6F5, count: 2, altitude: 2500,
        },
        {
          when: { kind: 'destroyed', atLeast: 6, unit: 'usTruck' },
          warn: '撤離戰區',
          warnLead: 20,
          side: 'theirs', spec: F6F5, count: 2, starboard: Math.PI, along: 0.5, altitude: 3000,
        },
        {
          when: { kind: 'destroyed', atLeast: 6, unit: 'usTruck' },
          warn: '撤離戰區',
          warnLead: 40,
          side: 'theirs', spec: F6F5, count: 2, altitude: 2500,
        },
      ],
      withdraw: {
        when: { kind: 'destroyed', atLeast: 6, unit: 'usTruck' },
        message: '撤離戰區',
        // 【負值 = 在開局位置的後方】撤離點在 Ki-84 來的方向
        distance: -EVACUATE_Z,
        // 【圈小】要對準了才飛得進去，不是往那個方向飛就結束
        radius: 600,
        seconds: Infinity,
      },
    },
  },
  {
    id: 'japan-m3', title: '倫內爾島', type: '打擊',
    summary: '駕駛一式陸攻趁著黃昏貼海飛行，用魚雷擊沉美軍艦隊。',
    place: '所羅門　倫內爾島外海', period: '1943 年 1 月',
    battle: {
      ...KILL,
      objective: '擊沉敵艦', banner: '壓低高度，衝向艦隊',
      // 【F4F-4 不是 F6F-5】1943 年 1 月的攔截者是企業號 VF-10 的野貓；
      // 地獄貓 1943 年 8 月才首戰，晚了七個月。
      blueSpec: G4M, redSpec: F4F4,
      // 【11 架陸攻是史實的量級】倫內爾島 29 日黃昏兩波共約 31 架一式陸攻，
      // 30 日再來 11 架。取 30 日那一波的架數，但**保留 29 日的黃昏**
      // （卡片文案就是那一波）。
      //
      // 【野貓 6 架】史實那天的攔截者更多，但 11 架陸攻要突進到投雷距離，
      // 攔截機一多就整批死在進場路上。**起始值，由試飛裁定。**
      blueCount: 11, redCount: 6,
      terrain: 'sea',
      fleet: RENNELL_FLEET,
      // 【低空】卡片寫的是「貼海飛行」。用預設的 4,000 m 的話，開場時
      // 艦隊在 6.3 km 外、3.85 km 正下方 —— 不低頭看不到船。**起始值。**
      altitude: 1000,
      // 【擊沉任意四艘】八艘裡挑四艘，玩家自己決定打哪幾艘 —— 那本來
      // 就是雷擊機該做的決定。
      sinkCount: 4,
      // 【沒有 `blueLoadout`】掛魚雷，照 G4M 的預設。AI 的雷擊剖面在 `ai/torpedoRun.ts`
      // 【卡片文案就寫黃昏】「趁著黃昏貼海飛行」
      timeOfDay: 'dusk',
    },
  },
]
