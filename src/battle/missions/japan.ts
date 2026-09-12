import { Vector3 } from 'three'
import { P51D } from '../../specs/p51d'
import { F4F4 } from '../../specs/f4f4'
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
    summary: '駕駛 A6M5 從拉包爾飛 1,040 公里，掩護一式陸攻雷擊瓜島外海的登陸船團護衛艦隊。',
    place: '所羅門　瓜達康納爾外海', period: '1942 年 8 月',
    battle: {
      ...KILL,
      objective: '掩護陸攻擊沉三艘敵艦', banner: '掩護雷擊隊，擊沉三艘',
      // 【零戰與陸攻，不是 21 型】遊戲每個陣營只有一台戰鬥機模型，卡片寫戰役
      // 不寫次型號
      blueSpec: A6M5, redSpec: F4F4,
      blueCount: 8, redCount: 8,
      // 【攻擊隊是 strike】陸攻照常走雷擊航路、照常閃彈，擊沉數由它們達成。
      // 誤成 transit 的話它們會直飛到一個不存在的終點
      convoySpec: G4M, convoyCount: 8, convoyDuty: 'strike',
      terrain: 'archipelago',
      fleet: GUADALCANAL_FLEET,
      sinkCount: 3,
      // 【低空】陸攻從 5 km 外進場，4,000 m 開場的話到船團上空還沒降到投雷
      // 高度，整趟帶著雷飛過去。與日 M4 同一個值。**起始值。**
      altitude: 1000,
      // 【沒有 `blueLoadout`】陸攻掛魚雷，照 G4M 的預設。覆寫會套到藍隊全體
      recycle: {
        side: 'theirs', role: 'fighter', batches: 3,
        warn: '警告：敵方戰鬥機再度升空', warnLead: 5,
      },
    },
  },
  {
    id: 'japan-m3', title: '漢口上空', type: '殲滅',
    summary: '駕駛飛行第 22 戰隊剛到手的四式戰疾風，把從高空俯衝下來的 P-51 拖進中低空纏鬥。',
    place: '中國　漢口上空', period: '1944 年 8 月',
    battle: {
      ...KILL,
      banner: '野馬在頭上，全部擊落',
      blueSpec: KI84, redSpec: P51D,
      // 【8 對 10、紅方高 1,000 m】壓力只來自這兩件事。**刻意不加波次** ——
      // 這是九關裡唯一一場沒有第二階段的戰鬥機對決
      blueCount: 8, redCount: 10,
      entry: 'bounce',
      terrain: 'farmland',
    },
  },
  {
    id: 'japan-m4', title: '倫內爾島', type: '打擊',
    summary: '駕駛第 705 海軍航空隊的一式陸攻，在黃昏低空雷擊倫內爾島外的第 18 特遣艦隊。',
    place: '所羅門　倫內爾島外海', period: '1943 年 1 月',
    battle: {
      ...KILL,
      objective: '擊沉任意四艘敵艦', banner: '低空雷擊，擊沉四艘敵艦',
      // 【F4F-4 不是 F6F-5】1943 年 1 月的攔截者是企業號 VF-10 的野貓；
      // 地獄貓 1943 年 8 月才首戰，晚了七個月。
      blueSpec: G4M, redSpec: F4F4,
      // 【11 對 8 是史實的量級】倫內爾島 29 日黃昏兩波共約 31 架一式陸攻，
      // 30 日再來 11 架、被 VF-10 的野貓打下 8 架。取 30 日那一波的架數，
      // 但**保留 29 日的黃昏**（卡片文案就是那一波）。
      blueCount: 11, redCount: 8,
      terrain: 'sea',
      fleet: RENNELL_FLEET,
      // 【低空】卡片寫的是「低空雷擊」。用預設的 4,000 m 的話，開場時
      // 艦隊在 6.3 km 外、3.85 km 正下方 —— 不低頭看不到船。**起始值。**
      altitude: 1000,
      // 【擊沉任意四艘】八艘裡挑四艘，玩家自己決定打哪幾艘 —— 那本來
      // 就是雷擊機該做的決定。
      sinkCount: 4,
      // 【沒有 `blueLoadout`】掛魚雷，照 G4M 的預設。卡片文案是「低空
      // 雷擊」，而 AI 的雷擊剖面在 `ai/torpedoRun.ts`
      // 【卡片文案就寫黃昏】「在黃昏低空雷擊」
      timeOfDay: 'dusk',
    },
  },
]
