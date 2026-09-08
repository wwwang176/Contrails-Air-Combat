import { BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { groundGeometry } from './geometry/ground'

/**
 * 地面目標的模型。**一台一顆 Mesh**，幾何來自 `geometry/ground`（GLB 那幾台
 * 全場共用同一份，火車那幾節各自建一份）。
 *
 * 【死了換材質，不換模型】燒掉的戰車還是那台戰車的形狀，只是黑的。關掉
 * 頂點色、整台塗成焦黑，一行就做完；殘骸模型與傾倒動畫這一期不做。
 *
 * 【與船同一個更新節奏】位置與旗標都是狀態不是事件，在渲染幀讀就好。
 */
export interface GroundModels {
  readonly object: Group
  update(targets: readonly GroundTarget[]): void
  dispose(): void
}

export function createGroundModels(targets: readonly GroundTarget[]): GroundModels {
  const live = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.06,
  })
  const wreck = new MeshStandardMaterial({
    color: 0x2a2421, flatShading: true, roughness: 1.0,
  })
  const object = new Group()
  const meshes: Mesh[] = []
  /** 程序化那幾節的幾何是這裡建的，這裡放；GLB 的是快取共用的，不碰。 */
  const owned: BufferGeometry[] = []

  for (const t of targets) {
    const geo = groundGeometry(t.unit)
    if ('build' in t.unit.model) owned.push(geo)
    const m = new Mesh(geo, live)
    object.add(m)
    meshes.push(m)
  }

  return {
    object,
    update(list) {
      for (let k = 0; k < list.length && k < meshes.length; k++) {
        const t = list[k]!
        const m = meshes[k]!
        m.position.copy(t.position)
        m.quaternion.copy(t.orientation)
        const want = t.alive ? live : wreck
        if (m.material !== want) m.material = want
      }
    },
    dispose() {
      for (const g of owned) g.dispose()
      live.dispose()
      wreck.dispose()
    },
  }
}
