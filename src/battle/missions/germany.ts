import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import { B17G } from '../../specs/b17g'
import { HE111 } from '../../specs/he111'
import { FLARE_DROPS } from '../../world/poltava'
import { GROUND_FLAK_SPEC } from '../../world/shipGuns'
import { CONVOY, CONVOY_RADIUS, POLTAVA_GROUND, RETREAT_DISTANCE } from './shared'
import type { MissionCard } from './types'

/** 德軍線的三關。**這一條線的卡片只住在這裡。** */
export const GERMANY: readonly MissionCard[] = [
  {
    id: 'germany-m1', title: '梅澤堡上空', type: '攔截',
    summary: '駕駛 Bf 109 K-4 撕開 P-51 的護航網，攔下飛往梅澤堡洛伊納油廠的 B-17G。',
    place: '德國中部　梅澤堡—洛伊納', period: '1944 年 11 月',
    battle: {
      ...CONVOY, objective: '在轟炸機抵達前擊落', banner: '攔下 B-17，守住油廠',
      blueSpec: BF109K4, redSpec: P51D, convoySpec: B17G,
      blueCount: 10, redCount: 4,
      terrain: 'archipelago',
      // 【用時鐘不用存活數】這一關的 `convoyPriority` 是 5，我方一心衝
      // 轟炸機 —— 實測一整場 145 s 護航機一架都沒掉，而勝負 145.5 s 就
      // 定了。「敵方戰鬥機剩不多」那個條件的節奏在這裡不可靠
      waves: [{
        when: { kind: 'clock', at: 60 },
        warn: '警告：敵方護航機接近中',
        warnLead: 4,
        side: 'theirs', spec: P51D, count: 4,
      }],
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
    id: 'germany-m4', title: '帝國最後防線', type: '殲滅',
    summary: '駕駛 Bf 109 K-4 從巴伐利亞的野戰機場升空，迎擊掃蕩德國本土的第八航空軍 P-51D。',
    place: '德國南部　巴伐利亞上空', period: '1945 年春',
    battle: {
      objective: '擊落全部敵機', banner: '野馬掃蕩本土，升空迎擊',
      blueSpec: BF109K4, redSpec: P51D, convoySpec: null,
      blueCount: 8, redCount: 10,
      convoyCount: 0, convoyPriority: 1,
      targetDistance: 0, targetRadius: 0, seconds: Infinity,
      entry: 'headOn',
      terrain: 'farmland',
      // 【拂曉】野戰機場的攔截隊天亮就升空 —— 停在地面上等於被掃射
      timeOfDay: 'dawn',
      /**
       * 【`byLatest` 必須早於「打得完敵軍」的那一刻】開場規則是
       * `annihilate`，紅隊歸零就**直接判勝**，之後返航節拍再也沒有機會
       * 接管規則 —— 那一關設計好的下半場就整段跳過了。
       *
       * 【40 秒是怎麼來的】它要滿足兩件事：
       *
       * ```
       *   早於第二批進場（49 s）  →  第二批因此變成「擋在逃生路上」，
       *                              而不是「還在纏鬥時多來四架」
       *   早到打不完 14 架        →  開場 10 架＋第一批 4 架。離線探針裡
       *                              AI 400 秒才掉 2 架；人快得多，但
       *                              40 秒清 14 架不是一個能穩定做到的事
       * ```
       *
       * 【`atMost: 4` 仍然有用】玩家撐不住時它會**更早**觸發，那才是這一關
       * 的敘述：友軍逐漸減少 → 任務更新。兩個是「誰先到算誰」。
       *
       * ⚑ 兩個數字都是起始值，待試飛。
       */
      withdraw: {
        when: { kind: 'alive', side: 'mine', atMost: 4, byLatest: 40 },
        message: '返航',
        distance: RETREAT_DISTANCE, radius: CONVOY_RADIUS,
        /**
         * **無時限** —— 撤離不倒數。
         *
         * 【為什麼倒數是多的】這一關的壓力來源是**擋在路上的兩批攔截機**，
         * 不是碼表。再壓一個倒數上去，玩家要同時應付「打穿出去」與「來不
         * 來得及」兩件事，而後者他無從估計 —— 他不知道還有幾批。
         *
         * 【`Infinity` 不是特例】`stepMission` 的撤離分支本來就走得到它：
         * `Infinity − dt` 仍是 `Infinity`、`Infinity <= 0` 是 false，
         * HUD 的 `formatCountdown` 對非有限值回空字串。
         */
        seconds: Infinity,
      },
      /**
       * 【敵人從斜前方分批來，不是在後面追】撤離點在 −Z，紅方的進場點
       * 也在 −Z —— 波次生在玩家**前方**，玩家必須打穿出去。從後面追的
       * 擺法會遇到「追不到」，這一種沒有人在追。
       *
       * 【第二批要往前挪】玩家從 z≈0 跑到紅方開局點只要 28 秒。第二批不
       * 覆寫縱深的話會生在他背後 —— 見 `MissionWave.along`。
       */
      waves: [
        {
          when: { kind: 'clock', at: 0 },
          // 【這一則說得出方位】它在開場那一刻顯示，那時玩家一定還朝著
          // 機首方向 —— 而波次就生在那裡
          warn: '前方有攔截機',
          warnLead: 4,
          side: 'theirs', spec: P51D, count: 4,
        },
        {
          when: { kind: 'clock', at: 45 },
          warn: '警告：敵方援軍加入戰鬥',
          warnLead: 4,
          side: 'theirs', spec: P51D, count: 4, along: -1.0,
        },
      ],
    },
  },
]
