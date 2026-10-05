import { Vector3, type Mesh, type Object3D } from 'three'
import { FAR_LAND_NAME } from '../render/leyteGround'
import { PROP_DISC_RENDER_ORDER } from '../render/geometry/assembly'
import { SKY_RENDER_ORDER } from '../render/sky'
import { CULL } from '../render/cullRuns'
import { OCEAN_CULL } from '../render/ocean'
import type { Terrain } from '../render/terrain'

type TargetPicker = () => readonly Object3D[]

export interface GraphicsDiagnosticsSource {
  readonly scene: Pick<Object3D, 'traverse' | 'traverseVisible'>
  readonly renderer: {
    readonly info: {
      readonly render: { readonly calls: number; readonly triangles: number }
      readonly programs?: readonly unknown[] | null
    }
  }
  /** 地形會換場，必須在探針呼叫時才取目前的那一份。 */
  readonly terrain: () => {
    readonly object: Object3D
    readonly fieldClip: Pick<NonNullable<Terrain['fieldClip']>, 'stats' | 'setInnerRadius' | 'benchFarBake'> | null
  }
  /** 戰鬥與特效的分組由組裝端提供，探針不依賴各系統的生命週期。 */
  readonly groups: Readonly<Record<string, TargetPicker>>
}

export const GFX_HIDDEN_LAYER = 31

/**
 * 圖形量測只在外部探針呼叫時工作，不接入遊戲的逐幀迴圈。
 * 回傳的函式沿用瀏覽器量測介面；由組裝端決定掛在哪個物件上。
 */
export function createGraphicsDiagnostics(source: GraphicsDiagnosticsSource) {
  const byRenderOrder = (order: number): Object3D[] => {
    const out: Object3D[] = []
    source.scene.traverse((o) => { if (o.renderOrder === order) out.push(o) })
    return out
  }
  const targets: Record<string, TargetPicker> = {
    // 地形前三個孩子依序是遠海、近海與陸地，與 terrain 的建構契約相同。
    farSea: () => [source.terrain().object.children[0]!],
    nearSea: () => [source.terrain().object.children[1]!],
    islands: () => [source.terrain().object.children[2]!],
    farLand: () => {
      const out: Object3D[] = []
      source.terrain().object.traverse((o) => { if (o.name === FAR_LAND_NAME) out.push(o) })
      return out
    },
    // 純海面沒有第四個孩子，取 slice 可讓這一組安全地為空。
    flora: () => source.terrain().object.children.slice(3),
    sky: () => byRenderOrder(SKY_RENDER_ORDER),
    propDisc: () => byRenderOrder(PROP_DISC_RENDER_ORDER),
    ...source.groups,
  }

  return {
    /** 此刻可繪製的網格清單，按三角形數排序，供消融後的成本歸因。 */
    __sceneList() {
      const out: {
        name: string; type: string; tris: number; material: string; parent: string
        geometry: string; renderOrder: number; transparent: boolean; radius: number; y: number
      }[] = []
      source.scene.traverseVisible((o) => {
        const m = o as Mesh
        if (!o.layers.isEnabled(0) || m.geometry === undefined) return
        const g = m.geometry
        const idx = g.index
        const pos = g.getAttribute('position')
        const n = idx !== null ? idx.count : pos !== undefined ? pos.count : 0
        const inst = (o as unknown as { count?: number }).count
        const mat = Array.isArray(m.material) ? m.material[0] : m.material
        if (g.boundingSphere === null) g.computeBoundingSphere()
        out.push({
          name: o.name, type: o.type,
          tris: Math.round((n / 3) * (typeof inst === 'number' ? inst : 1)),
          material: mat?.type ?? '', parent: o.parent?.name ?? '',
          geometry: g.type, renderOrder: o.renderOrder, transparent: mat?.transparent ?? false,
          radius: Math.round((g.boundingSphere?.radius ?? 0) * o.getWorldScale(new Vector3()).x),
          y: Math.round(o.getWorldPosition(new Vector3()).y),
        })
      })
      return out.sort((a, b) => b.tris - a.tris)
    },

    __oceanGrid(n?: number): number {
      if (n !== undefined) OCEAN_CULL.grid = n
      return OCEAN_CULL.grid
    },

    __cull(on?: boolean): boolean {
      if (on !== undefined) CULL.enabled = on
      return CULL.enabled
    },

    __renderInfo() {
      const r = source.renderer.info.render
      return { calls: r.calls, triangles: r.triangles, programs: source.renderer.info.programs?.length ?? 0 }
    },

    __fieldClip(inner?: number) {
      const c = source.terrain().fieldClip
      if (c === null) return null
      if (inner !== undefined) c.setInnerRadius(inner)
      return { ...c.stats }
    },

    __fieldBake(trees = true) {
      return source.terrain().fieldClip?.benchFarBake(trees) ?? null
    },

    /**
     * 用圖層開關整組繪製；visible 會被特效每幀重寫，不能當作持續消融開關。
     * 圖層不會從父節點繼承，必須走訪所有子節點。
     */
    __gfx(patch: Record<string, boolean>) {
      const applied: string[] = []
      for (const [name, on] of Object.entries(patch)) {
        const pick = targets[name]
        if (pick === undefined) continue
        for (const root of pick()) root.traverse((o) => { o.layers.set(on ? 0 : GFX_HIDDEN_LAYER) })
        applied.push(`${name}=${on ? 'on' : 'off'}`)
      }
      return { applied, known: Object.keys(targets) }
    },
  }
}
