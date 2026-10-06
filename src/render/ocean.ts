import { Group, Mesh, PlaneGeometry, type Camera, type Color, type Vector2, type Vector3, type WebGLRenderer } from 'three'
import { CULL, frustumPlanesOf, shareGeometry, visibleRuns } from './cullRuns'
import type { DayPalette } from './timeOfDay'
import type { ShoreFieldData } from '../world/archipelago'
import { gerstnerHeight } from '../core/oceanWaves'
import {
  OCEAN_BASE_CELL, OCEAN_RING_SEGMENTS, OCEAN_LEVELS, OCEAN_BLOCK_GRID, BLOCK_BI, BLOCK_BJ,
  OCEAN_CULL, OCEAN_RUN_CAP, OCEAN_CULL_Y, OCEAN_SNAP,
  FAR_SEA_SIZE, FAR_SEA_RENDER_ORDER, FAR_SEA_Y, clipmapLevelGeometry,
} from './oceanGeometry'
import { createOceanMaterials } from './oceanMaterials'

/**
 * 算逐面量的那個 renderer。**`createScene` 建好 renderer 就登記**，而
 * `createOcean` 在那之後才跑（每個會建地形的頁面都是這個次序）。
 *
 * 【沒有登記時走逐片段那條】headless 的測試與任何沒有 renderer 的呼叫端
 * 因此完全不受影響 —— 畫面相同，只是每個片段自己算。
 */
let oceanRenderer: WebGLRenderer | null = null

export function setOceanRenderer(r: WebGLRenderer): void {
  oceanRenderer = r
}

/** `Ocean.paletteUniforms` 的形狀。 */
export interface OceanPaletteUniforms {
  readonly uSkyHorizon: { value: Color }
  readonly uSkyZenith: { value: Color }
  readonly uSkyPower: { value: number }
  readonly uHorizonColor: { value: Color }
  readonly uSunDirection: { value: Vector3 }
  readonly uSparkleStrength: { value: number }
}

export interface Ocean {
  /**
   * 細浪面。**一組以相機為中心的巢狀方環**（clipmap），不是單一網格。
   * 設計與各層的尺寸見 `OCEAN_BASE_CELL`。
   *
   * 【為什麼回 Group 而不是回陣列】呼叫端（`render/terrain.ts`）只要把它
   * 加進場景；層數是這個模組的內部決定，不該漏出去。`__gfx` 的消融也
   * 靠 traverse 走到葉子，不需要知道有幾層。
   */
  mesh: Group
  /**
   * 遠海。**不做頂點位移的平面網格**，墊在細浪面底下把海接到地平線。
   *
   * 見 `FAR_SEA_SIZE` / `FAR_SEA_Y` 與下方 `renderOrder` 的註解。
   */
  farMesh: Mesh
  /**
   * 波相位的原點（著色器的 `uOrigin`），已經吸附到格點。**與
   * `mesh.position.xz` 恆相等** —— 只吸附其中一份的話浪會相對網格滑動，
   * 症狀與完全不吸附一樣。
   *
   * 【為什麼要出現在介面上】`onBeforeCompile` 在 headless 測試裡不會被呼叫，
   * 從材質上讀不到 uniform。公開它是為了讓那一條守得住，沒有別的用途。
   */
  readonly origin: Vector2
  /**
   * `OCEAN_HEIGHT_GLSL` 要的 uniform，**與海面材質是同一組物件**（同一個 uTime、同一個
   * 吸附原點）。貼著海面的東西在自己的著色器裡用它算浪高，與海面逐頂點一致。
   */
  readonly heightUniforms: Readonly<Record<string, { value: unknown }>>
  /**
   * `setPalette` 會寫的那六個著色器 uniform。
   *
   * 【為什麼要出現在介面上】與 `origin` 同一個理由 —— `onBeforeCompile` 在
   * headless 測試裡不會被呼叫，從材質上讀不到 uniform。少了這一格，
   * 「海面反射的天空色跟著時段換」就沒有任何反證：漏掉其中一個的症狀是
   * **黃昏的海反射著中午的天**，畫面上看得出來但不會有東西報錯。
   */
  readonly paletteUniforms: OceanPaletteUniforms
  /**
   * 換時段。**細浪面與遠海一起換** —— 漏掉其中一個就是 5 km 處的一條色帶。
   *
   * 【為什麼是可變的而不是建構參數】展示頁要能即時切換，而「建立時設一次」
   * 與「事後改」若走兩條路徑，展示頁看到的就不是遊戲裡的東西。
   */
  setPalette(p: DayPalette): void
  update(time: number, centerX: number, centerZ: number): void
  /**
   * 依這一台相機畫近海每一層看得到的塊。**每次 render 之前呼叫**；`CULL.enabled`
   * 關掉時每一層整條畫一次，與切塊之前相同
   */
  cull(camera: Camera): void
  heightAt(x: number, z: number, time: number): number
  dispose(): void
}

/**
 * @param shore 離岸的膨脹圖，浪花吃它。**`null` = 這一場沒有陸地**
 *   （`'sea'`）—— 掛一張 1×1 的零貼圖，取樣恆為 0。
 */
export function createOcean(shore: ShoreFieldData | null): Ocean {
  // clipmap 的四層。L0 實心，其餘挖掉中央 —— 那一塊由內一層負責
  const levels = Array.from({ length: OCEAN_LEVELS }, (_, i) =>
    clipmapLevelGeometry(OCEAN_BASE_CELL * 2 ** i, OCEAN_RING_SEGMENTS, i > 0))
  const levelGeometries = levels.map((l) => l.geometry)

  /**
   * 逐面量的表。沒有登記 renderer（headless、單元測試）時是 `null`，近海就
   * 走逐片段那條。
   */
  // 【浮點 render target 不是每張卡都有】沒有 EXT_color_buffer_float 就建不出
  // 這張表，而建失敗的症狀是整片近海壞掉。偵測不到就走逐片段那條 —— 那是
  // 原本的算法，每個片段自己算，只是比較慢
  const useTable = oceanRenderer !== null
    && oceanRenderer.extensions.has('EXT_color_buffer_float')
  const surface = createOceanMaterials(shore, useTable)
  const { material, farMaterial, uTime, uOrigin, sparkle, tableTarget, tableScene, tableCamera } = surface

  const mesh = new Group()
  /**
   * 每一層的 `OCEAN_RUN_CAP` 段：`[0]` 是那一層的 Mesh 本身（整條索引、`drawRange`
   * 決定畫哪段），其餘掛在它底下，各自一顆共用屬性的幾何。見 `OCEAN_BLOCK_GRID`
   */
  const levelRuns: Mesh[][] = []
  for (const g of levelGeometries) {
    const runs: Mesh[] = []
    for (let r = 0; r < OCEAN_RUN_CAP; r++) {
      const m = new Mesh(r === 0 ? g : shareGeometry(g), material)
      // 【three 的剔除一律關掉】包圍球看不到頂點位移，而且以相機為中心的那幾塊碰得到
      // 相機 —— 球一定與視錐相交。塊自己剔，見 `cull`
      m.frustumCulled = false
      if (r > 0) {
        m.visible = false
        runs[0]!.add(m)
      }
      runs.push(m)
    }
    levelRuns.push(runs)
    mesh.add(runs[0]!)
  }
  /** 一層的塊的索引區段與包圍盒；`cull` 逐層重填 */
  const MAX_BLOCKS = OCEAN_BLOCK_GRID * OCEAN_BLOCK_GRID
  const blockFrom = new Int32Array(MAX_BLOCKS)
  const blockTo = new Int32Array(MAX_BLOCKS)
  const blockBox = new Float32Array(MAX_BLOCKS * 6)
  const runStart = new Int32Array(MAX_BLOCKS)
  const runEnd = new Int32Array(MAX_BLOCKS)
  const planes = new Float64Array(24)

  // 遠海。用 MeshPhysicalMaterial 而不是 Basic：要跟細浪面接得上就得受同一
  // 組燈光。roughness / metalness 全部沿用細浪面的值。
  //
  // 【為什麼要細分成 128×128，不是一個大四邊形】碎光的取樣座標是片段的
  // vOceanWorld.xz，由頂點透視插值而來。整片 6000 km 若只有兩個三角形，
  // 頂點相距數千公里，插值出的世界座標在 float32 下量化誤差約 0.36 m，
  // 相機一移動就跳動 → 遠海白點 1 px 抖，且對角線兩側各自插值、各自抖
  //（實測）。細分到 128 段後單格約 47 km，插值誤差降到約 2.8 mm，
  // 遠小於碎光 14 m 的格子，抖動消失。128² = 16,384 個頂點，farMesh 不做
  // 頂點位移（displace=false），建立一次、之後只平移，成本可忽略。
  const FAR_SEGMENTS = 128
  const farGeometry = new PlaneGeometry(FAR_SEA_SIZE, FAR_SEA_SIZE, FAR_SEGMENTS, FAR_SEGMENTS)
  farGeometry.rotateX(-Math.PI / 2)

  const farMesh = new Mesh(farGeometry, farMaterial)
  farMesh.frustumCulled = false // 隨鏡頭捲動，永遠可見
  // 建立時就擺好，讓「還沒 update 過」的狀態也是一致的（與 sky.ts 同一招）
  farMesh.position.y = FAR_SEA_Y
  /**
   * 遠海**最後畫**（renderOrder 1）。
   *
   * ── 【為什麼不必怕深度平手】────────────────────────────────
   *
   * 遠海與細浪面只相距 5 m，而深度量化
   * `Δz ≈ z²/2²⁴`（近平面 1 m）在 7,000 m 是 2.92 m、12,000 m 是 8.58 m。
   * 上帝視角爬高之後，整片細浪面（那時永遠是 ±5 km）與遠海分不出前後，
   * 而 `LessEqualDepth` 讓**後畫的贏** —— 遠海會把浪蓋掉。
   *
   * clipmap 上線之後，**浪只存在於相機周圍 3.6 km 之內**：頂點的頻帶限制
   * 讓最長的 140 m 波在 `vCell > 0.4 × 140 = 56 m` 時完全淡出，而 vCell 是
   * 距離的 1/64，所以 56 m 對應 3,584 m。那個距離上 `Δz = 0.77 m`，只有
   * 5 m 間隔的六分之一 —— **深度分得很開，平手不可能發生。**
   *
   * 3.6 km 之外兩者都是平的、用同一支著色器、同一組參數，誰贏都一樣：實測
   * 八個凍結姿態，反轉前後沒有任何帶狀接縫（差異只是碎光的顆粒換了位置，
   * 因為遠海在 y = −5 而 clipmap 在 y = 0，視線向量差了一點）。
   *
   * ── 【換來的：遠海變成免費】────────────────────────────────
   *
   * 先畫的話，被細浪面蓋掉的區域**無法**靠 early-Z 省掉，而遠海是全螢幕的。
   * 而 clipmap 鋪到 82 km，畫面上的海幾乎整片都被它蓋住 —— 等於昂貴的海面
   * 著色器跑了兩次全螢幕。
   *
   * 逐層消融（同一輪內背對背）：
   *
   *     關掉遠海省下的 p50      改前 −16.6%      改後 −0.6%
   *
   * **這一項的收益比 clipmap 本身還大。**
   */
  farMesh.renderOrder = FAR_SEA_RENDER_ORDER

  return {
    mesh,
    farMesh,
    origin: uOrigin.value,
    heightUniforms: surface.heightUniforms,
    paletteUniforms: surface.paletteUniforms,
    setPalette: surface.setPalette,
    update(time, centerX, centerZ) {
      uTime.value = time

      // 【中心必須吸附到格點】頂點在波場裡連續滑動的話，每一幀每個面的三個
      // 角都落在波的不同相位上 —— 面的形狀逐幀改變，畫面上是整片海在蠕動、
      // 稜線在爬。格子 2.5 m 時那個誤差遠小於一個像素，看不出來；60 m 時
      // 它**就是**外觀。
      //
      // 【為什麼吸附到最外層的格距】OCEAN_SNAP 被四層的格距整除，所以一次
      // 吸附讓四層同時落在各自的格點上 —— `uOrigin` 因此仍然只有一個，
      // 各層不必分家。代價是中心最多偏離相機半格（L0 的半寬是 3,840 m）。
      //
      // 【設在群組上，不是每一層】四層共用同一個中心，那正是它們不裂開的
      // 前提。設在群組上讓那件事是**結構保證**的，不是每幀記得同步的。
      //
      // 【uOrigin 必須吃同一個吸附後的值】它算的是波的相位，而 mesh.position
      // 決定頂點在哪 —— 只吸附其中一份的話浪會相對網格滑動，症狀與完全不
      // 吸附一樣，但只看 mesh.position 的測試抓不到。
      const snapX = Math.round(centerX / OCEAN_SNAP) * OCEAN_SNAP
      const snapZ = Math.round(centerZ / OCEAN_SNAP) * OCEAN_SNAP
      mesh.position.set(snapX, 0, snapZ)
      uOrigin.value.set(snapX, snapZ)
      // 【過渡帶吃不吸附的位置】見 oceanMorph
      sparkle.uCenter.value.set(centerX, centerZ)
      // 【遠海不吸附】吸附是為了避免頂點在格點之間滑動造成面的形狀逐幀改變，
      // 而遠海是平的、沒有面可言。精確跟著相機走，才不會在極端座標下累積偏差。
      farMesh.position.set(centerX, FAR_SEA_Y, centerZ)

      // 【表在這裡重畫，不在算繪迴圈裡】它只吃 uTime 與 uOrigin，而這兩個
      // 就是上面剛寫的 —— 換句話說「輸入變了」與「表重畫」是同一件事。
      // 沒有呼叫 update 的那些幀（暫停）輸入沒變，舊表仍然是對的
      if (tableTarget !== null && oceanRenderer !== null) {
        const prev = oceanRenderer.getRenderTarget()
        oceanRenderer.setRenderTarget(tableTarget)
        oceanRenderer.render(tableScene, tableCamera)
        oceanRenderer.setRenderTarget(prev)
      }
    },
    cull(camera) {
      if (CULL.enabled) frustumPlanesOf(camera, planes)
      // 剔除的塊由幾個細塊組成（每邊 `per` 個）；對齊的那幾個在索引上是連續的一段
      const grid = OCEAN_CULL.grid
      const per = OCEAN_BLOCK_GRID / grid
      for (let l = 0; l < levelRuns.length; l++) {
        const runs = levelRuns[l]!
        const starts = levels[l]!.blockStart
        const total = levelGeometries[l]!.index!.count
        let n = 1
        runStart[0] = 0
        runEnd[0] = total
        if (CULL.enabled) {
          // 塊的盒子：以群組（吸附後的中心）為準，水平是塊的範圍，垂直是浪高餘裕
          const half = (OCEAN_RING_SEGMENTS / 2) * OCEAN_BASE_CELL * 2 ** l
          const size = (2 * half) / grid
          let m = 0
          for (let k = 0; k < MAX_BLOCKS; k += per * per) {
            const from = starts[k]!
            const to = starts[k + per * per]!
            // 【洞裡的塊是空的】不進表 —— 看得到的空塊會佔掉一段
            if (to === from) continue
            const gi = Math.floor(BLOCK_BI[k]! / per)
            const gj = Math.floor(BLOCK_BJ[k]! / per)
            const x0 = mesh.position.x - half + gi * size
            const z0 = mesh.position.z - half + gj * size
            blockFrom[m] = from
            blockTo[m] = to
            blockBox[m * 6] = x0
            blockBox[m * 6 + 1] = -OCEAN_CULL_Y
            blockBox[m * 6 + 2] = z0
            blockBox[m * 6 + 3] = x0 + size
            blockBox[m * 6 + 4] = OCEAN_CULL_Y
            blockBox[m * 6 + 5] = z0 + size
            m++
          }
          n = visibleRuns(m, blockFrom, blockTo, blockBox, planes, OCEAN_RUN_CAP, runStart, runEnd)
        }
        for (let r = 0; r < runs.length; r++) {
          const m = runs[r]!
          if (r < n) {
            m.visible = true
            m.geometry.setDrawRange(runStart[r]!, runEnd[r]! - runStart[r]!)
          } else {
            // 【第 0 段只清空不藏】其餘三段是它的孩子
            if (r > 0) m.visible = false
            m.geometry.setDrawRange(0, 0)
          }
        }
      }
    },
    heightAt: gerstnerHeight,
    dispose() {
      for (const runs of levelRuns) for (const m of runs.slice(1)) m.geometry.dispose()
      for (const g of levelGeometries) g.dispose()
      farGeometry.dispose()
      surface.dispose()
    },
  }
}
