import { Vector3 } from 'three'
import { F4F4 } from '../../specs/f4f4'
import { F6F5 } from '../../specs/f6f5'
import { KI84_BOMB_LOADOUT } from '../../weapons/stores'
import { EVACUATE_Z, LEYTE_ROAD } from '../../world/leyte'
import { KI84 } from '../../specs/ki84'
import { A6M5 } from '../../specs/a6m5'
import { G4M } from '../../specs/g4m'
import { KILL, RENNELL_FLEET } from './shared'
import type { MissionCard, MissionFleet } from './types'

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
      // 【F6F 全部由波次給】開場天上沒有敵機 —— 那一段是找車、俯衝
      blueCount: 8, redCount: 0,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'leyte',
      altitude: 1500,
      loadouts: { ki84: KI84_BOMB_LOADOUT },
      // 【僚機先打卡車】遭到敵機直接瞄準時才自衛。戰鬥機的 AI 只掃射、不投彈
      priorityGroundUnit: 'truck',
      /**
       * 【三批、每批五輛】卡車 3、戰車 1、防空車 1。戰車只有炸彈炸得掉、不計分；
       * 防空車照陸上輕型砲開火。0／75／150 秒從灘頭出發，全程約 6.6 km、
       * 約 11 分鐘。**全部是起始值，由試飛裁定。**
       */
      vehicleConvoy: {
        route: LEYTE_ROAD, speed: 10, turnRadius: 25, gap: 30,
        batches: [
          { departAt: 0, units: ['flakLight', 'truck', 'truck', 'tank', 'truck'] },
          { departAt: 75, units: ['flakLight', 'truck', 'truck', 'tank', 'truck'] },
          { departAt: 150, units: ['flakLight', 'truck', 'truck', 'tank', 'truck'] },
        ],
      },
      // 【9 輛卡車：炸 6 輛、放走 4 輛就輸】6 + 4 > 9，兩條不會同時可能
      interdict: { count: 6, leak: 4, unit: 'truck' },
      /**
       * 【F6F 兩批都從撤退的方向來】`starboard: π` 把紅方的進場轉到 +Z 那一側
       * （Ki-84 來的方向）。第一批在開始攻擊之後進場（遲遲不動手的話 90 秒也會來）；
       * 第二批在轉入撤離的那一刻，從撤離點附近正面迎上。
       */
      waves: [
        {
          when: { kind: 'destroyed', atLeast: 1, unit: 'truck', byLatest: 90 },
          warn: '敵艦載機接近中',
          warnLead: 6,
          side: 'theirs', spec: F6F5, count: 4, starboard: Math.PI, altitude: 2500,
        },
        // 【預警會被撤離訊息蓋掉】與返航同一步觸發，`stepBeats` 依陣列順序寫
        // 訊息，返航排在最後 —— 畫面上是「撤離戰區」
        {
          when: { kind: 'destroyed', atLeast: 6, unit: 'truck' },
          warn: '撤離戰區',
          warnLead: 0,
          side: 'theirs', spec: F6F5, count: 4, starboard: Math.PI, along: 0.8,
        },
      ],
      withdraw: {
        when: { kind: 'destroyed', atLeast: 6, unit: 'truck' },
        message: '撤離戰區',
        // 【負值 = 在開局位置的後方】撤離點在 Ki-84 來的方向
        distance: -EVACUATE_Z,
        radius: 1000,
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
