import type { AircraftModel } from './assembly'
import { buildBf109E, BF109_BODY_COLOR } from './bf109e'
import { buildHe111 } from './he111'
import { F6F5_MODEL } from './f6f5.model'
import { P51D_MODEL } from './p51d.model'
import { BF109K4_MODEL } from './bf109k4.model'
import { HE111_MODEL } from './he111.model'
import { B17G_MODEL } from './b17g.model'
import { KI84_MODEL } from './ki84.model'
import { A6M5_MODEL } from './a6m5.model'
import { G4M_MODEL } from './g4m.model'
import { F4F4_MODEL } from './f4f4.model'
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
 * 所以造型各自成檔 —— 共用的只剩 assembly.ts 裡的材質、零件與螺旋槳。
 *
 * 【為什麼沒有可動舵面】把副翼／升降舵／方向舵做成三組可旋轉的 Group、
 * 依控制指令偏轉的話：遊戲中的觀看距離
 * （追尾相機 26 m、空戰對手更遠）下，22° 的舵面偏轉在畫面上不到一個像素，
 * 看不出來。省下的三角形改投入看得見的地方——機身剖面、座艙罩形狀、
 * 機首整流罩與各機種的識別特徵。
 */
const BUILDERS: Record<string, () => AircraftModel> = {
  bf109k4: buildBf109E,
  he111: buildHe111,
}

/**
 * 由 GLB 載入的機種。**九台全部走這條**；`BUILDERS` 只剩兩台，留著是重匯的來源。
 *
 * 【來源都在 Blender】F6F-5 是在 Blender 裡畫的；P-51D 與 Bf 109 的底稿是程式版
 * 用 `GLTFExporter` 吐出來、再在 Blender 裡對著參考模型修過的（見各自的
 * `*.model.ts`）。He 111 是同一支腳本吐出來、在 Blender 裡焊過重複頂點（畫面逐
 * byte 不變）。Ki-84／A6M5／G4M／F4F-4／B-17G 是**對著參考模型量、直接 loft**
 * 建的，沒有程式版血緣（`tools/blender/build_*.py`）。
 *
 * 要修外型就在 `tools/blender/*.blend` 或對應的 `build_*.py` 裡修，再匯出。
 *
 * 【`GLB_MODELS` 先於 `BUILDERS`】同一個 id 兩邊都有時走 GLB。那兩台的程式版
 * 留著只是為了 `test/tools/procedural-export.ts` 能重匯。
 */
export const GLB_MODELS: Record<string, GlbAircraft> = {
  p51d: P51D_MODEL,
  f6f5: F6F5_MODEL,
  bf109k4: BF109K4_MODEL,
  he111: HE111_MODEL,
  b17g: B17G_MODEL,
  ki84: KI84_MODEL,
  a6m5: A6M5_MODEL,
  g4m: G4M_MODEL,
  f4f4: F4F4_MODEL,
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
  he111: HE111_MODEL.bodyColor,
  b17g: B17G_MODEL.bodyColor,
  f6f5: F6F5_MODEL.bodyColor,
  ki84: KI84_MODEL.bodyColor,
  a6m5: A6M5_MODEL.bodyColor,
  g4m: G4M_MODEL.bodyColor,
  f4f4: F4F4_MODEL.bodyColor,
}

/** 零件用它上色 —— 打爆的飛機掉下來的碎片必須跟機身同色。 */
export function bodyColorOf(spec: AircraftSpec): number {
  const c = BODY_COLORS[spec.id]
  if (c === undefined) throw new Error(`未定義機種塗裝：${spec.id}`)
  return c
}
