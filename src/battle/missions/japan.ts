import { F6F5 } from '../../specs/f6f5'
import { F4F4 } from '../../specs/f4f4'
import { KI84 } from '../../specs/ki84'
import { A6M5 } from '../../specs/a6m5'
import { G4M } from '../../specs/g4m'
import { CONVOY, KILL, RENNELL_FLEET } from './shared'
import type { MissionCard } from './types'

/** 日本線的三關。**這一條線的卡片只住在這裡。** */
export const JAPAN: readonly MissionCard[] = [
  {
    id: 'japan-m1', title: '臺灣沖航空戰', type: '殲滅',
    summary: '駕駛 A6M5 從新竹起飛，迎戰空襲臺灣的第 38 特遣艦隊艦載機。',
    place: '臺灣　新竹外海', period: '1944 年 10 月',
    battle: {
      ...KILL,
      banner: '艦載機空襲，擊落全部敵機',
      blueSpec: A6M5, redSpec: F6F5,
      blueCount: 8, redCount: 6,
      terrain: 'archipelago',
      // 【清晨】1944 年 10 月 12 日第 38 特遣艦隊的首波在天亮時到新竹上空
      timeOfDay: 'dawn',
    },
  },
  {
    id: 'japan-m3', title: '雷伊泰的投雷點', type: '護航',
    summary: '駕駛 Ki-84 參加捷一號作戰，護送一式陸攻穿過 F6F 的攔截抵達投雷點。',
    place: '菲律賓　雷伊泰灣', period: '1944 年 10 月',
    battle: {
      ...CONVOY, objective: '護送轟炸機抵達投雷點', banner: '護送陸攻飛到投雷點',
      blueSpec: KI84, redSpec: F6F5, convoySpec: G4M,
      blueCount: 4, redCount: 10,
      terrain: 'sea',
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
