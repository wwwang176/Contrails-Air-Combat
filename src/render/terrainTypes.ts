import type { Camera, Object3D, WebGLRenderer } from 'three'
import type { IslandDesc } from '../world/archipelago'
import type { LandField } from '../world/occlusion'
import type { DayPalette } from './timeOfDay'
import type { FieldClipmap } from './fieldClipmap'

/**
 * 有 GPU 可用時給 `createTerrain` 的東西。**省略就是純算式的地面**，headless
 * 的測試與不畫圖的工具走那一條。
 */
export interface TerrainGfx {
  readonly renderer: WebGLRenderer
  /** 鏡頭周圍多少公尺內的田色仍逐像素算，m。見 `render/quality.ts` 的 `fieldInner` */
  readonly fieldInner: number
}

export interface Terrain {
  /** 加進場景的那個節點。換地形時整個移除 */
  readonly object: Object3D
  /**
   * 地形高度場，m。撞地判定、水柱、殘骸與零件入水都讀它。
   *
   * 【必須與畫面上那一份是同一份】海面的頂點位移在 shader 裡算，這裡是
   * CPU 的那一份。陸地則是**同一個 `Float32Array`** 同時餵給 mesh 與這裡。
   * 兩者分家的話，飛機會撞到一片看不見的海。
   */
  heightAt(x: number, z: number, time: number): number
  /**
   * **判定用**的高度，m。海面是平的（回 0），陸地讀高度場。**不吃時間。**
   *
   * 【為什麼與 `heightAt` 分家】海面碰撞體是平面，浪只是視覺高低。但水柱、
   * 殘骸、碎片入水仍然要貼著看得見的水面 —— 那一條走 `heightAt`。
   * 兩個問題，兩支函式。
   *
   * 【誰讀它】`main.ts` 的 `world.crashPolicy`（經 `flatSeaCrashPolicy`）。
   */
  collisionHeightAt(x: number, z: number): number
  /**
   * **水面**的高度，m。**沒有水的地方回 `-Infinity`。**
   *
   * 【為什麼與 `heightAt` 分家】`heightAt` 回的是「陸地與海面取 max」，
   * 而水柱、殘骸與碎片問的是另一件事：**這裡碰到的是水嗎**。用 `heightAt`
   * 的話，摔在島上會噴水柱 —— 群島早就有這個缺陷，純內陸則是每一次墜毀
   * 都會發生。
   *
   * 【誰讀它】`main.ts` 交給 `render/wrecks.ts`、`render/debris.ts` 與
   * 水柱那一支。撞地判定不讀它（那一條走 `collisionHeightAt`）。
   *
   * 【不吃 `time`】呼叫端拿到的是這一格的平均水位。波的相位由
   * `ocean.heightAt` 內部的時間決定，這裡傳 0 —— 水柱因此貼在平均水位上。
   * 試飛看得出來的話再把 `time` 一路帶下去。
   */
  waterAt(x: number, z: number): number
  /**
   * AI 的地形來源。**圓盤法只需要這個，不需要高度場。**
   *
   * 【為什麼不給 AI 高度場】沿航跡取樣高度會漏 —— 步長比格距大的話，
   * 射線跨得過一整座窄峰。島本來就是圓，用圓去判斷是解析的、沒有取樣、
   * 而且知道自己在繞哪一座。`'sea'` 時是空陣列。
   */
  readonly islands: readonly IslandDesc[]
  /**
   * 這一場的陸地。**`null` = 沒有陸地**（`'sea'`）。
   *
   * 【誰讀它】`World.land`（彈丸撞到山就爆火花並回收）與 AI 的遮蔽判斷
   * （不對山後面的敵人開火、不對山後面的瞄準閃躲）。
   *
   * 【它與 `islands` 是兩件事】避障讀 `islands` 的解析圓盤，遮蔽讀這一份
   * 高度場 —— 因為遮蔽要的正是「畫面上那個面」。見 `world/occlusion.ts`。
   *
   * 【為什麼 `'sea'` 不給一個假的平原】造一個 `ceiling = SEA_FLOOR` 的物件
   * 會讓每一發入海的彈丸都去查高度場，而且「陸地要高於海平面」會變成唯一
   * 擋住海面回歸的東西。`null` 加上那道判準是兩道保險。
   */
  readonly land: LandField | null
  /**
   * 田色 clipmap。**只有內陸而且建地形時給了 `TerrainGfx` 才有**，否則 `null`。
   * 畫質換檔位時經它調內圈半徑；量測出口經它讀挪窗統計。
   */
  readonly fieldClip: FieldClipmap | null
  /**
   * 海面的浪高 uniform（`Ocean.heightUniforms`）。**沒有海的地形是 null。** 貼著海面的
   * 東西（航跡）在自己的著色器裡配 `OCEAN_HEIGHT_GLSL` 用它
   */
  readonly oceanHeight: Readonly<Record<string, { value: unknown }>> | null
  /**
   * 換時段。**海的那一半**（陸地與植被的顏色這一期不跟著換，見
   * `timeOfDay.ts`）。
   */
  setPalette(p: DayPalette): void
  /** 每幀更新。海浪要動；陸地是靜態的；植被跟著鏡頭補格 */
  update(time: number, centerX: number, centerZ: number): void
  /**
   * 把植被的生成佇列一次排乾。**沒有植被的地形不提供這一支。**
   *
   * 【誰要它】`main.ts` 的 `__still`：定格截圖與逐像素比對前必須讓植被長齊，
   * 否則拍到的是一片還沒補完的地。引擎每幀只生四格，光靠 `update` 要五十幀。
   */
  settle?(): void
  /**
   * 依這一台相機剔掉看不到的植被、近海的塊與佈景塊。**每次 render 之前呼叫** ——
   * `main.ts` 掛在 `scene.onBeforeRender`，戰鬥、機庫、選單三個畫面都走得到。
   */
  cull(camera: Camera): void
  /**
   * 這一點落在哪一圈：樹、灌木、房子的級數與地面由哪一層畫。測距工具
   * （`hud/rangeProbe.ts`）用，距離從上一次 `update` 的中心量。**只有內陸有**
   */
  describeAt?(x: number, z: number): readonly string[]
  dispose(): void
}
