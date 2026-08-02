import type { AircraftModel } from './assembly'
import { buildBf109E } from './bf109e'
import { buildP51D } from './p51d'
import type { AircraftSpec } from '../../specs/types'

export type { AircraftModel, HullMetrics } from './assembly'

/**
 * 機種 id → 造型建構函式。
 *
 * 【為什麼一機一函式】外形逼近真機之後，兩台的構造差異大到共用一份資料
 * 結構只剩壞處：座艙罩一個是架在機背上的氣泡罩、一個是嵌進機身的方框罩，
 * 連建構方式都不同；機腹導管、背鰭、圓翼尖、尾翼支柱各自只有一台有。
 * 共用結構於是長滿 optional 欄位與 kind 標籤，改一台就得同時想另一台。
 * 專案負責人裁決分開——共用的只剩 assembly.ts 裡的材質、零件與螺旋槳。
 *
 * 【為什麼沒有可動舵面】原本副翼／升降舵／方向舵是三組可旋轉的 Group，由
 * setSurfaces 依控制指令偏轉。專案負責人實測後裁決移除：遊戲中的觀看距離
 * （追尾相機 26 m、空戰對手更遠）下，22° 的舵面偏轉在畫面上不到一個像素，
 * 看不出來。省下的三角形改投入看得見的地方——機身剖面、座艙罩形狀、
 * 機首整流罩與各機種的識別特徵。
 */
const BUILDERS: Record<string, () => AircraftModel> = {
  p51d: buildP51D,
  bf109g6: buildBf109E,
}

export function buildAircraft(spec: AircraftSpec): AircraftModel {
  const build = BUILDERS[spec.id]
  if (!build) throw new Error(`未定義機種外型：${spec.id}`)
  return build()
}
