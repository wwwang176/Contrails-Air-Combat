import { DEG } from '../../core/math'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import { F6F5 } from '../../specs/f6f5'
import { B17G } from '../../specs/b17g'
import { A6M5 } from '../../specs/a6m5'
import { G4M } from '../../specs/g4m'
import { GROUND_FLAK_SPEC } from '../../world/shipGuns'
import { CONVOY, KILL, LEUNA_GROUND, TF58_GROUP } from './shared'
import type { MissionCard } from './types'

/** 盟軍線的三關。**這一條線的卡片只住在這裡。** */
export const ALLIES: readonly MissionCard[] = [
  {
    id: 'allies-m1', title: '護送堡壘', type: '護航',
    summary: '護送第八航空軍的 B-17 深入德國本土，轟炸施韋因富特的滾珠軸承廠。',
    place: '德國　施韋因富特上空', period: '1944 年夏',
    battle: {
      ...CONVOY, objective: '護送轟炸機抵達投彈點', banner: '護送 B-17 飛到投彈點',
      blueSpec: P51D, redSpec: BF109K4, convoySpec: B17G,
      blueCount: 4, redCount: 10,
      terrain: 'archipelago',
    },
  },
  {
    id: 'allies-m2', title: '梅澤堡的油廠', type: '打擊',
    summary: '駕駛第八航空軍的 B-17G 轟炸洛伊納合成油廠，穿過德國空軍那年秋天最大的一次攔截。',
    // 【與德 M1 是同一場的兩個座位】空域字串要不同 —— 簡報的護欄要求
    // 十二關各不相同；這一關的視角在廠區上空，德 M1 在梅澤堡外圍攔截
    place: '德國中部　洛伊納油廠上空', period: '1944 年 11 月',
    battle: {
      objective: '炸毀洛伊納油廠', banner: '轟炸洛伊納油廠',
      blueSpec: B17G, redSpec: BF109K4, convoySpec: null,
      /**
       * 【十二架分三個小隊擺開】玩家在中間那一隊當長機，前後各一隊
       * （`order.ts` 的 `stackedEntry`：前後 500 m、左右錯半個身位、高度分層）。
       * **只是開場站位，不編隊** —— 十一架 AI 照自己的攻擊航路投
       * （`ai/strikeRun.ts`）。
       *
       * 【為什麼不是四架】史實這一場第八航空軍出動六百多架；四架在畫面上
       * 是一支巡邏隊，不是一次轟炸。**起始值，由試飛裁定。**
       *
       * 開場四架 Bf 109 由 `headOn` 放在正前方，接近約 40 秒 —— 1944 年
       * 標準的十二點鐘正面攻擊
       */
      blueCount: 12, redCount: 4,
      blueStacked: true,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'leuna',
      // 十一月的正午：太陽低、天色灰（`render/timeOfDay.ts`）
      timeOfDay: 'novemberNoon',
      /**
       * 【1,500 m 而不是預設的 4,000】史實的投彈高度在 7,000 m 以上，但
       * 那個高度上廠區只剩一片灰色的紋理，而投下的彈要飛四十秒才落地。
       * **起始值，由試飛裁定。**
       */
      altitude: 1500,
      ground: LEUNA_GROUND,
      /**
       * 【這一關的高砲射速是通用值的兩倍】洛伊納是德國本土最密的火網之一，
       * 而 `GROUND_FLAK_SPEC` 的 15 發/分是路邊一座砲位的值。
       *
       * 30 發/分超出 88 的持續射速（史實約 20），與 5 吋砲初速訂 450（真砲
       * 790）同一個性質：那一層的存在條件是手感。**起始值，由試飛裁定。**
       */
      flakSpec: { ...GROUND_FLAK_SPEC, roundsPerMinute: 30 },
      // 【炸毀任意六座】計數的池是廠區十二座構件與四十八座砲位 —— 全部都是
      // 敵方的地面目標。**起始值**
      destroyCount: 6,
      waves: [{
        when: { kind: 'clock', at: 90 },
        warn: '警告：敵機從後方接近',
        warnLead: 5,
        side: 'theirs', spec: BF109K4, count: 4,
        // 【從後方】對應突擊大隊從尾部衝進轟炸箱。省略的話沿用紅方的正面
        // 進場，會生在前方反向飛來
        starboard: Math.PI,
      }],
    },
  },
  {
    id: 'allies-m4', title: '沖繩外海', type: '殲滅',
    summary: '駕駛 F6F-5 守住沖繩外海的第 58 特遣艦隊，攔下零戰與低空進場的一式陸攻。',
    place: '沖繩外海　慶良間列島以西', period: '1945 年 4 月',
    battle: {
      ...KILL,
      objective: '守住艦隊', banner: '敵機來襲，守住航母',
      blueSpec: F6F5, redSpec: A6M5,
      /**
       * 【開場十六架分兩路，被殲滅的小隊整隊重生】掛彈的零戰走的是掃射航路
       * （`ai/bombRun.ts` 的落彈點瞄準）：機首指著艦隊一路壓下去、投彈、
       * 再拉起。那條航路把自己送進近迫火網。
       *
       * 【十六架是門檻，不是喜好】投彈點在離目標約 600 m 的斜距上，而它們
       * 在 900 m 附近就開始掉。實測開場八架時**一枚都投不出來**：每一架都
       * 死在 900 到 600 那一段。十六架同時到，防空火力分不完，才有幾架
       * 突得進去（十枚）。
       *
       * 分兩路的用意也是分散火力：艦隊的防空要同時顧兩個方位，四架 F6F
       * 也只攔得住其中一路。重生讓畫面上一直有東西在進場，而席位維持
       * 16 + 4 —— 同時在場的架數不比開場多。
       */
      blueCount: 4, redCount: 16,
      redStarboard: 45 * DEG,
      terrain: 'sea',
      fleet: TF58_GROUP,
      /**
       * 【2,000 m 而不是預設的 4,000】G4M 進場之後要降到
       * `ai/torpedoRun.ts` 的 `RUN_ALTITUDE`（150 m）才投得出雷，從
       * 4,000 m 掉下來那一段是空白時間。**起始值，由試飛裁定。**
       */
      altitude: 2000,
      /**
       * 【哪一支小隊被殲滅，那一支就整隊重生】掛彈的零戰是被**防空砲**打掉
       * 的，不是被 F6F 攔掉的：一架活到離航母 936 m、剛切進落彈點瞄準，
       * 零點三秒後陣亡。四支小隊各自在防空網前面死光、各自重生，場上於是
       * 一直有零戰在進場，而同時在場的不超過十六架。
       *
       * 【六批】開場 16 加重生 24，共 40 架次零戰。
       *
       * 【`warnLead` 那幾秒不會被判成勝利】`MissionInputs.redInbound`
       * 擋著（`defend` 的勝利條件讀它），等重生的小隊也算在路上。少了那
       * 一格，紅方在預警期間歸零會先判勝、下一批永遠不來。
       *
       * 全部的數字都是**起始值，由試飛裁定**。
       */
      recycle: {
        side: 'theirs', role: 'fighter', batches: 6,
        // 【不宣稱方位】重生的橫向槽位把它推到開場那兩路之外，實際方位
        // 因此不等於這裡設的 45°。寫「發生了什麼」，不要寫「在哪裡」
        //
        // 【寫成無線電通報，不寫批數】玩家不知道也不該知道自己在打第幾批
        // —— 那是設定檔的內部結構。1945 年的第 58 特遣艦隊有戰鬥機管制台，
        // 雷達通報就是這一則訊息的來源
        warn: '雷達發現更多零戰',
        warnLead: 5,
        starboard: 45 * DEG,
      },
      /**
       * 【陸攻跟著第五批重生進場】它與零戰的節奏綁在一起：玩家打得越快，
       * 雷擊來得越早。批數只增不減，所以不必兜底。
       */
      waves: [
        {
          when: { kind: 'batch', at: 5 },
          warn: '低空發現雷擊機',
          warnLead: 6,
          side: 'theirs', spec: G4M, count: 4,
          /**
           * 【1,000 而不是任務高度的 2,000】投雷高度是 150 m，而進場點到
           * 艦隊只有 5.5 km —— 以 130 m/s 飛只有四十二秒。從 2,000 掉下來
           * 的話飛到航母正上方時還在 250 m，姿態進不了投放包絡就不准鎖
           * 航向，整個第一趟帶著雷飛過去，繞回來才投得出，而那時水中航程
           * 只剩一百多公尺 —— 雷幾乎是貼著船身入水的。
           *
           * **起始值，由試飛裁定。**
           */
          altitude: 1000,
        },
      ],
    },
  },
]
