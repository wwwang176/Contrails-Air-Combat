import { Group, type Object3D } from 'three'
import { createOcean } from './ocean'
import { createProps } from './props'

/**
 * 地形的種類。
 *
 * 【為什麼 M10 只有一個值還要有這個型別】`prompt.md` 已經預告山丘。加一種
 * 地形要動的地方就是這個聯集與 `createTerrain` 的分支 —— 而拆除與重建的
 * 路徑 M10 每一場都在走，不是一條等著被第一次使用的死碼（M10 spec §5.3）。
 */
export type TerrainKind = 'sea'

export interface Terrain {
  /** 加進場景的那個節點。換地形時整個移除 */
  readonly object: Object3D
  /**
   * 地形高度場，m。撞地判定、水柱、殘骸與零件入水都讀它。
   *
   * 【必須與畫面上那一份是同一份】海面的頂點位移在 shader 裡算，這裡是
   * CPU 的那一份。兩者分家的話，飛機會撞到一片看不見的海。
   */
  heightAt(x: number, z: number, time: number): number
  /** 每幀更新。海浪要動；靜態地形是空操作 */
  update(time: number, centerX: number, centerZ: number): void
  dispose(): void
}

/** 參照物的數量。600 是 M1 以來的既有值 */
const PROP_COUNT = 600

export function createTerrain(kind: TerrainKind): Terrain {
  // 【M10 只有一種】`kind` 現在恆為 'sea'，但簽章與分支先開著 —— 見
  // `TerrainKind` 的註解
  void kind
  const ocean = createOcean()
  const props = createProps(PROP_COUNT)
  const group = new Group()
  group.add(ocean.mesh)
  group.add(props.mesh)

  return {
    object: group,
    heightAt: ocean.heightAt,
    update(time, centerX, centerZ) {
      ocean.update(time, centerX, centerZ)
    },
    dispose() {
      ocean.dispose()
      props.dispose()
    },
  }
}
