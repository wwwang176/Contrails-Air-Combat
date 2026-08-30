import type { AircraftModel } from './assembly'
import { buildBf109E, BF109_BODY_COLOR } from './bf109e'
import { buildHe111, HE111_BODY_COLOR } from './he111'
import { buildB17G, B17G_BODY_COLOR } from './b17g'
import { F6F5_MODEL } from './f6f5.model'
import { P51D_MODEL } from './p51d.model'
import { buildFromTemplate, glbTemplate, loadGlbTemplate, type GlbAircraft } from './glb'
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
  bf109k4: buildBf109E,
  he111: buildHe111,
  b17g: buildB17G,
}

/**
 * 由 GLB 載入的機種。**與 `BUILDERS` 並存，不是取代**。
 *
 * 【來源都在 Blender】F6F-5 是在 Blender 裡畫的；P-51D 的底稿是程式版用
 * `GLTFExporter` 吐出來、再在 Blender 裡對著參考模型修過的（見
 * `p51d.model.ts`），來源是 `tools/blender/p51d.blend`。剩下三台要搬也走
 * 同一條路：匯出 → Blender 修 → 程式版退休。
 *
 * 【為什麼並存】GLB 那條路任何一步走錯都只會弄壞走它的機種；程式化那三台
 * 一行都沒動。
 */
export const GLB_MODELS: Record<string, GlbAircraft> = {
  p51d: P51D_MODEL,
  f6f5: F6F5_MODEL,
}

/**
 * 預載所有 GLB 機種。**開場 await 一次**，之後 `buildAircraft` 仍然是同步的。
 *
 * 【為什麼不讓 buildAircraft 變非同步】它被 `main.ts`、四個工具頁、以及跑在
 * node 環境的單元測試同步呼叫。把非同步關在這個函式裡，下游一行都不用改。
 */
export async function preloadAircraftModels(): Promise<void> {
  await Promise.all(
    Object.entries(GLB_MODELS).map(([id, def]) => loadGlbTemplate(id, def)),
  )
}

export function buildAircraft(spec: AircraftSpec): AircraftModel {
  if (GLB_MODELS[spec.id]) {
    const t = glbTemplate(spec.id)
    if (!t) throw new Error(`機種 ${spec.id} 的 GLB 還沒載入 —— 少了 preloadAircraftModels()`)
    return buildFromTemplate(t)
  }
  const build = BUILDERS[spec.id]
  if (!build) throw new Error(`未定義機種外型：${spec.id}`)
  return build()
}

/**
 * 機種 id → 機身色。與 `BUILDERS` 同一把鑰匙。
 *
 * 【為什麼在這裡而不是 `AircraftSpec` 裡】`specs/` 放的是飛行與武裝的物理
 * 參數，塗裝是渲染層的事。這個檔案本來就是「機種 id → 外型」的查表處。
 */
const BODY_COLORS: Record<string, number> = {
  p51d: P51D_MODEL.bodyColor,
  bf109k4: BF109_BODY_COLOR,
  he111: HE111_BODY_COLOR,
  b17g: B17G_BODY_COLOR,
  f6f5: F6F5_MODEL.bodyColor,
}

/** 零件用它上色 —— 打爆的飛機掉下來的碎片必須跟機身同色。 */
export function bodyColorOf(spec: AircraftSpec): number {
  const c = BODY_COLORS[spec.id]
  if (c === undefined) throw new Error(`未定義機種塗裝：${spec.id}`)
  return c
}
