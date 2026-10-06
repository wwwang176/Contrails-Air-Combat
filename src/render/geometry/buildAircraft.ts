import type { AircraftModel } from './assembly'
import { F6F5_MODEL } from './f6f5.model'
import { P51D_MODEL } from './p51d.model'
import { BF109K4_MODEL } from './bf109k4.model'
import { HE111_MODEL } from './he111.model'
import { B17G_MODEL } from './b17g.model'
import { KI84_MODEL } from './ki84.model'
import { A6M5_MODEL } from './a6m5.model'
import { G4M_MODEL } from './g4m.model'
import { F4F4_MODEL } from './f4f4.model'
import { JU87_MODEL } from './ju87.model'
import { YAK1B_MODEL } from './yak1b.model'
import type { Texture } from 'three'
import { buildFromTemplate, glbTemplate, liveryTexture, loadGlbTemplate, type GlbAircraft } from './glb'
import type { AircraftSpec } from '../../specs/types'

export type { AircraftModel, HullMetrics } from './assembly'

/**
 * 機種 id → GLB 模型的 manifest。**每一個機種都要在這裡**，沒登記的 id 由
 * `buildAircraft` 直接拋錯。
 *
 * 【沒有可動舵面】遊戲中的觀看距離（追尾相機 26 m、空戰對手更遠）下，22° 的
 * 舵面偏轉在畫面上不到一個像素，看不出來。
 */
export const GLB_MODELS: Record<string, GlbAircraft> = {
  p51d: P51D_MODEL,
  f6f5: F6F5_MODEL,
  bf109k4: BF109K4_MODEL,
  he111: HE111_MODEL,
  b17g: B17G_MODEL,
  /**
   * 停放的 B-17 用的低模。**只有地面單位在用**（`geometry/ground/index.ts`），
   * 飛行中的那批仍然是 `b17g`。
   *
   * 【共用 `B17G_MODEL` 的 eyePoint／wingTip／bombPoint】三個都是寫死的機體座標，
   * 不是從節點推的；低模的翼尖、機首、彈艙與正式模型在同一個位置。
   */
  b17g_lod2: {
    ...B17G_MODEL,
    url: '/models/b17g_lod2.glb',
    /**
     * 【材質表要跟著縮】`parseGlbTemplate` 對表上的每一個材質都要求 GLB 裡
     * 真的有，找不到就丟「manifest 過期了」。低模沒有座艙、窗框與內裝，
     * 那三個材質也就跟著不見 —— 照抄整份表會讓整個 `main.ts` 在預載那一步
     * 就死掉，症狀是 `__gfx` 之類的出口全部 undefined。
     */
    materials: {
      B17_Body: 'body',
      B17_Accent: 'accent',
      B17_Glass: 'glass',
    },
  },
  /**
   * He 111 的低模，與 `b17g_lod2` 同一種用法；12,658 → 1,438 個三角形。
   *
   * 【材質表要跟著縮】低模沒有座艙內裝、機首窗框與進氣口內壁 —— 那三種光是
   * 三角形就佔 2,272 個，而它們由外面一個都看不到。
   */
  he111_lod2: {
    ...HE111_MODEL,
    url: '/models/he111_lod2.glb',
    materials: {
      HE111_Body: 'body',
      HE111_Accent: 'accent',
      HE111_Glass: 'glass',
    },
  },
  ki84: KI84_MODEL,
  a6m5: A6M5_MODEL,
  g4m: G4M_MODEL,
  f4f4: F4F4_MODEL,
  /** 還沒有 spec（飛不了），先登記在這裡：塗裝版面的倒出工具只認這張表。 */
  ju87: JU87_MODEL,
  /** 德 M4 的蘇軍對手，低模 */
  yak1b: YAK1B_MODEL,
}

/**
 * 預載所有 GLB 機種。**開場 await 一次**，之後 `buildAircraft` 仍然是同步的。
 *
 * 【為什麼不讓 buildAircraft 變非同步】它被 `main.ts`、四個工具頁、以及跑在
 * node 環境的單元測試同步呼叫。把非同步關在這個函式裡，下游一行都不用改。
 *
 * @param onLoaded 每載完一支 GLB 呼叫一次，共 `AIRCRAFT_MODEL_COUNT` 次（載入進度用）
 */
export async function preloadAircraftModels(onLoaded: () => void = () => {}): Promise<void> {
  await Promise.all(
    Object.entries(GLB_MODELS).map(([id, def]) => loadGlbTemplate(id, def).then(onLoaded)),
  )
}

/**
 * 這幾個機種的塗裝貼圖，去重。
 *
 * 【只給這一場用得到的】貼圖要傳上 GPU 才佔顯存（九張約 200 MB，內顯是直接吃
 * 系統記憶體），而一場通常只有兩三型。沒被畫到的就不會上傳。
 */
export function liveryTexturesFor(
  ids: Iterable<string>, liveries?: Readonly<Record<string, string>>,
): Promise<Texture[]> {
  const urls = new Set<string>()
  for (const id of ids) {
    if (GLB_MODELS[id]?.livery === undefined) continue
    urls.add(liveryUrlFor(id, liveries?.[id]))
  }
  return Promise.all([...urls].map(liveryTexture))
}

/**
 * 這個機種某個塗裝變體的貼圖路徑；`variant` 省略 = 預設塗裝。機種或變體沒登記就拋錯。
 *
 * 【拋錯而不是落回預設】任務卡寫錯變體名的症狀是雪地上一架綠飛機，而且沒有任何錯誤。
 */
export function liveryUrlFor(id: string, variant?: string): string {
  const def = GLB_MODELS[id]
  if (variant === undefined) {
    if (def?.livery === undefined) throw new Error(`機種 ${id} 沒有塗裝`)
    return def.livery.url
  }
  const url = def?.liveryVariants?.[variant]
  if (url === undefined) throw new Error(`機種 ${id} 沒有塗裝變體「${variant}」`)
  return url
}

/**
 * 載入任務卡指定的塗裝變體的樣板（已經載過的略過）。**開戰前 await 一次**，之後 `buildAircraft(spec, variant)`
 * 仍然是同步的。沒指定變體的任務是 no-op。
 */
export async function preloadLiveryVariants(liveries: Readonly<Record<string, string>> | undefined): Promise<void> {
  if (liveries === undefined) return
  await Promise.all(Object.entries(liveries).map(([id, variant]) => {
    const def = GLB_MODELS[id]
    if (def === undefined) throw new Error(`塗裝複寫指名了沒有 GLB 的機種 ${id}`)
    if (glbTemplate(id, variant) !== undefined) return Promise.resolve()
    return loadGlbTemplate(id, def, variant).then(() => undefined)
  }))
}

/** `preloadAircraftModels` 要載的 GLB 支數 */
export const AIRCRAFT_MODEL_COUNT = Object.keys(GLB_MODELS).length

/**
 * @param variant 塗裝變體（任務卡的 `liveries`）。省略 = 預設塗裝。**變體的樣板要先
 * `preloadLiveryVariants`**，沒載入就拋錯
 */
export function buildAircraft(spec: AircraftSpec, variant?: string): AircraftModel {
  if (!GLB_MODELS[spec.id]) throw new Error(`未定義機種外型：${spec.id}`)
  const t = glbTemplate(spec.id, variant)
  if (!t) {
    throw new Error(variant === undefined
      ? `機種 ${spec.id} 的 GLB 還沒載入 —— 少了 preloadAircraftModels()`
      : `機種 ${spec.id} 的塗裝變體「${variant}」還沒載入 —— 少了 preloadLiveryVariants()`)
  }
  return buildFromTemplate(t)
}

/**
 * 機種 id → 遠處用的低模 id。**沒列在這裡的機種就沒有 LOD**，`buildAircraftLod`
 * 回 `null`，呼叫端一路走正式模型。
 */
const AIRCRAFT_LOD: Record<string, string> = {
  b17g: 'b17g_lod2',
  he111: 'he111_lod2',
}

/**
 * 切到低模的距離，m。
 *
 * 【為什麼是 200】那個距離下 B-17 只有 89 px 寬、He 111 77 px，**兩台都在
 * `/tools/lod.html` 上實地比對過，到這裡就分不出低模與正式模型**。50 m（360 px）的
 * 並排算圖也還看不出差別，26 m 的追尾相機（687 px）才看得出機身的多邊形。
 * 而戰鬥機開火的距離（100～200 m）剛好讓被打的那一架跳回正式模型。
 *
 * 【全機種共用一個數字】`useAircraftLod` 不分機種，地面單位（`groundTargets.ts`）
 * 也讀同一個 —— 兩邊用不同距離會出現「地上那架先變、天上那架還沒變」。
 * 之後某一台驗出來需要更近才換，那是**那一台的低模不夠好**，不是門檻要分家。
 *
 * 【遲滯只往外】切過去要走到 `+HYSTERESIS`，切回來走到 `DIST` 就換 ——
 * **低模因此永遠不會出現在 `DIST` 以內**。對稱的遲滯會讓一架正在接近的
 * 飛機一路低模到 175 m，比驗過的距離還近。
 *
 * 【那為什麼還要留 25 m】完全不留的話，停在門檻上的目標（編隊裡保持隊形的
 * 僚機、機場上空盤旋的鏡頭）會因為距離的抖動逐幀換模型。切換本身在 200 m
 * 看不出來，逐幀反覆換看得出來。
 */
export const AIRCRAFT_LOD_DIST = 200
export const AIRCRAFT_LOD_HYSTERESIS = 25

/** 這一架該用低模嗎。`prev` 是上一幀的答案。吃距離平方，熱路徑上不開根號。 */
export function useAircraftLod(dist2: number, prev: boolean): boolean {
  const t = prev ? AIRCRAFT_LOD_DIST : AIRCRAFT_LOD_DIST + AIRCRAFT_LOD_HYSTERESIS
  return dist2 > t * t
}

/**
 * 這個機種遠處用的模型。沒有低模就回 `null`。
 *
 * 【量測值與正式模型相同】低模的 manifest 是 `...B17G_MODEL` 展開來的，
 * `eyePoint`／`wingTip`／`bombPoint` 逐項相同，所以呼叫端讀哪一具都一樣。
 */
export function buildAircraftLod(id: string): AircraftModel | null {
  // `__FLYING_LOD = false` 讓整場一路走正式模型，進場前在主控台設，拿來做 A/B
  if ((globalThis as Record<string, unknown>)['__FLYING_LOD'] === false) return null
  const lodId = AIRCRAFT_LOD[id]
  if (lodId === undefined) return null
  const t = glbTemplate(lodId)
  if (!t) throw new Error(`低模 ${lodId} 還沒載入 —— 少了 preloadAircraftModels()`)
  return buildFromTemplate(t)
}

/**
 * 機種 id → 機身色。與 `GLB_MODELS` 同一把鑰匙。
 *
 * 【為什麼在這裡而不是 `AircraftSpec` 裡】`specs/` 放的是飛行與武裝的物理
 * 參數，塗裝是渲染層的事。這個檔案本來就是「機種 id → 外型」的查表處。
 */
const BODY_COLORS: Record<string, number> = {
  p51d: P51D_MODEL.bodyColor,
  bf109k4: BF109K4_MODEL.bodyColor,
  he111: HE111_MODEL.bodyColor,
  b17g: B17G_MODEL.bodyColor,
  f6f5: F6F5_MODEL.bodyColor,
  ki84: KI84_MODEL.bodyColor,
  a6m5: A6M5_MODEL.bodyColor,
  g4m: G4M_MODEL.bodyColor,
  f4f4: F4F4_MODEL.bodyColor,
  ju87: JU87_MODEL.bodyColor,
  yak1b: YAK1B_MODEL.bodyColor,
}

/** 零件用它上色 —— 打爆的飛機掉下來的碎片必須跟機身同色。 */
export function bodyColorOf(spec: AircraftSpec): number {
  const c = BODY_COLORS[spec.id]
  if (c === undefined) throw new Error(`未定義機種塗裝：${spec.id}`)
  return c
}
