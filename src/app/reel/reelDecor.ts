import { type BufferAttribute, type BufferGeometry, Color, Group, Matrix4, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import { buildDecor, DECOR_DEFAULT } from '../../render/geometry/ground/plantDecor'
import type { ReelDecor } from './reelTypes'

/** 一件佈景建築：在合併幾何裡的頂點範圍、世界位置、炸彈多近算炸到 */
interface DecorItem {
  readonly x: number
  readonly y: number
  readonly z: number
  readonly reach: number
  readonly start: number
  readonly count: number
  burnt: boolean
}
/** 燒黑的佈景建築。與地面目標殘骸同一個焦黑（`render/groundTargets.ts`） */
const DECOR_BURNT = new Color(0x2a2421)

/** 管理各個短片鏡次合併後的佈景幾何；材質跨鏡次重用 */
export function createReelDecor(
  group: Group,
  fx: { groundKill(x: number, y: number, z: number, fires: number): void },
  blastReach: number,
) {
  const PROP_BLAST_REACH = blastReach
  const DECOR_M = new Matrix4()
  const V1 = new Vector3()
  let decorMesh: Mesh | null = null
  const decor: DecorItem[] = []
  const decorMaterial = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.06,
  })

  function clear(): void {
    if (decorMesh !== null) {
      group.remove(decorMesh)
      decorMesh.geometry.dispose()
      decorMesh = null
    }
    decor.length = 0
  }

  /** 佈景建築合併成一顆網格，落在地形上。換段的暗場裡建一次 */
  function build(
    list: readonly ReelDecor[], terrain: { collisionHeightAt(x: number, z: number): number },
    toWorld: (point: Vector3) => Vector3, yaw: number,
  ): void {
    clear()
    if (list.length === 0) return
    const parts: BufferGeometry[] = []
    let start = 0
    for (const d of list) {
      const g = buildDecor(d.kind, d.w, d.d, d.h)
      V1.set(d.x, 0, d.z)
      toWorld(V1)
      const y = terrain.collisionHeightAt(V1.x, V1.z)
      DECOR_M.makeRotationY(d.heading + yaw).setPosition(V1.x, y, V1.z)
      g.applyMatrix4(DECOR_M)
      const count = g.getAttribute('position').count
      const def = DECOR_DEFAULT[d.kind]
      decor.push({
        x: V1.x, y, z: V1.z, reach: Math.hypot(d.w ?? def.w, d.d ?? def.d) / 2,
        start, count, burnt: false,
      })
      start += count
      parts.push(g)
    }
    const merged = mergeGeometries(parts)
    for (const p of parts) p.dispose()
    if (merged === null) throw new Error('佈景建築合併失敗 —— 屬性不一致')
    merged.computeBoundingSphere()
    decorMesh = new Mesh(merged, decorMaterial)
    group.add(decorMesh)
  }

  /**
   * 炸彈落在 (x, z)：附近的佈景建築燒黑、起火。頂點色就地改寫 —— 一件一次，
   * 只在炸彈落地那一幀跑
   */
  function burn(x: number, z: number): void {
    if (decorMesh === null) return
    const color = decorMesh.geometry.getAttribute('color') as BufferAttribute
    for (const d of decor) {
      if (d.burnt) continue
      const reach = d.reach + PROP_BLAST_REACH
      if ((d.x - x) ** 2 + (d.z - z) ** 2 >= reach * reach) continue
      d.burnt = true
      for (let i = d.start; i < d.start + d.count; i++) {
        color.setXYZ(i, DECOR_BURNT.r, DECOR_BURNT.g, DECOR_BURNT.b)
      }
      color.needsUpdate = true
      fx.groundKill(d.x, d.y, d.z, 2)
    }
  }

  return { build, burn, clear }
}
