import { Group, type Object3D } from 'three'
import { createOcean } from './ocean'
import { createIslands } from './island'
import { bakeShore, createArchipelago, PEAK_MAX, type IslandDesc } from '../world/archipelago'
import type { LandField } from '../world/occlusion'
import type { TerrainKind } from '../world/terrainKind'

// 【聯集本身住在 world/】見 `world/terrainKind.ts`。這裡再匯出，
// 既有的 import 站點不用動
export type { TerrainKind }

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
   * 【為什麼與 `heightAt` 分家】專案負責人 2026-08-28 裁定海面碰撞體是平面，
   * 浪只是視覺高低。但水柱、殘骸、碎片入水仍然要貼著看得見的水面 —— 那一條
   * 走 `heightAt`。兩個問題，兩支函式。
   *
   * 【誰讀它】`main.ts` 的 `world.crashPolicy`（經 `flatSeaCrashPolicy`）。
   */
  collisionHeightAt(x: number, z: number): number
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
  /** 每幀更新。海浪要動；陸地是靜態的 */
  update(time: number, centerX: number, centerZ: number): void
  dispose(): void
}

export function createTerrain(kind: TerrainKind): Terrain {
  // 【陸地要先生出來，海面才接得上】浪花吃的是由高度場推出來的膨脹圖 ——
  // 見 `world/archipelago.ts` 的 `bakeShore`。純海面那一支傳 null。
  //
  // 【只烘一次】`createArchipelago` 不回傳膨脹圖：headless 的測試與 AI 那一
  // 側都用不到它，讓生成器一律烘等於每個呼叫端都付一次 1024² 的距離傳播。
  const land = kind === 'sea' ? null : createArchipelago()
  const ocean = createOcean(land ? bakeShore(land.field) : null)
  const group = new Group()
  // 【順序：遠海先進去】繪製順序其實由 `farMesh.renderOrder` 決定（見
  // `ocean.ts`），這裡的次序只影響 `children` 的索引 —— 但讀起來由遠到近，
  // 而測試也靠這個次序（並自我驗證抓對了人）。
  group.add(ocean.farMesh)
  group.add(ocean.mesh)

  if (land === null) {
    // 【第三個位置仍然佔著】索引契約由 `main.ts` 的 `__gfx` 消融表與
    // `src/tools/` 的兩支工具共用。沒有陸地就掛一個空 Group，
    // 那兩邊才不必為了「這一場有沒有島」寫分支。
    group.add(new Group())
    return {
      object: group,
      heightAt: ocean.heightAt,
      collisionHeightAt: () => 0,
      islands: [],
      land: null,
      update(time, centerX, centerZ) { ocean.update(time, centerX, centerZ) },
      dispose() { ocean.dispose() },
    }
  }

  const { field, islands } = land
  const meshes = createIslands(field, islands)
  group.add(meshes.object)

  return {
    object: group,
    heightAt(x, z, time) {
      // 【取 max，而且陸地那一份不吃 time】陸地是靜態的；海面才有波。
      // 高度場出界回 −Infinity，所以場地之外自然退回純海面。
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, time)
      return h > sea ? h : sea
    },
    // 【海面那一項是 0，不是 ocean.heightAt】見介面上的說明。出界回
    // −Infinity，所以場地之外自然退回平海面
    collisionHeightAt(x, z) {
      const h = field.sample(x, z)
      return h > 0 ? h : 0
    },
    islands,
    // 【`ceiling` 用 PEAK_MAX 而不是實測的最高點】它是一個上界就夠了 ——
    // 高於它的彈丸一定碰不到陸地。用實測值要多掃一次全圖，而且會讓
    // 「動了地形就要重算」多一條沒有人記得的規則
    land: { field, ceiling: PEAK_MAX, landAbove: 0 },
    update(time, centerX, centerZ) { ocean.update(time, centerX, centerZ) },
    dispose() {
      ocean.dispose()
      meshes.dispose()
    },
  }
}
