import { Group, type Object3D } from 'three'
import { createOcean } from './ocean'
import { createIslands } from './island'
import { createArchipelago, type IslandDesc } from '../world/archipelago'
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
   * AI 的地形來源。**圓盤法只需要這個，不需要高度場。**
   *
   * 【為什麼不給 AI 高度場】沿航跡取樣高度會漏 —— 步長比格距大的話，
   * 射線跨得過一整座窄峰。島本來就是圓，用圓去判斷是解析的、沒有取樣、
   * 而且知道自己在繞哪一座。`'sea'` 時是空陣列。
   */
  readonly islands: readonly IslandDesc[]
  /** 每幀更新。海浪要動；陸地是靜態的 */
  update(time: number, centerX: number, centerZ: number): void
  dispose(): void
}

export function createTerrain(kind: TerrainKind): Terrain {
  const ocean = createOcean()
  const group = new Group()
  // 【順序：遠海先進去】繪製順序其實由 `farMesh.renderOrder` 決定（見
  // `ocean.ts`），這裡的次序只影響 `children` 的索引 —— 但讀起來由遠到近，
  // 而測試也靠這個次序（並自我驗證抓對了人）。
  group.add(ocean.farMesh)
  group.add(ocean.mesh)

  if (kind === 'sea') {
    // 【第三個位置仍然佔著】索引契約由 `main.ts` 的 `__gfx` 消融表與
    // `src/tools/` 的兩支工具共用。沒有陸地就掛一個空 Group，
    // 那兩邊才不必為了「這一場有沒有島」寫分支。
    group.add(new Group())
    return {
      object: group,
      heightAt: ocean.heightAt,
      islands: [],
      update(time, centerX, centerZ) { ocean.update(time, centerX, centerZ) },
      dispose() { ocean.dispose() },
    }
  }

  const { field, islands } = createArchipelago()
  const land = createIslands(field, islands)
  group.add(land.object)

  return {
    object: group,
    heightAt(x, z, time) {
      // 【取 max，而且陸地那一份不吃 time】陸地是靜態的；海面才有波。
      // 高度場出界回 −Infinity，所以場地之外自然退回純海面。
      const h = field.sample(x, z)
      const sea = ocean.heightAt(x, z, time)
      return h > sea ? h : sea
    },
    islands,
    update(time, centerX, centerZ) { ocean.update(time, centerX, centerZ) },
    dispose() {
      ocean.dispose()
      land.dispose()
    },
  }
}
