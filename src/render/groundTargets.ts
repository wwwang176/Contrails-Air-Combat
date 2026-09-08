import { BufferGeometry, Group, Mesh, MeshStandardMaterial } from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { groundGeometry } from './geometry/ground'

/**
 * 地面目標的模型。**一台一顆 Mesh**，幾何來自 `geometry/ground`（GLB 那幾台
 * 全場共用同一份，火車那幾節各自建一份）。
 *
 * 【死了換材質；有殘骸版的連形狀一起換】燒掉的戰車還是那台戰車的形狀，
 * 只是黑的 —— 關掉頂點色、整台塗成焦黑。廠區的構件另有矮一截的殘骸幾何
 * （登記表的 `ruin`）：它們炸毀後不再擋炸彈，畫面要跟著矮下去。
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
  /**
   * 炸毀之後換的幾何，一台一格；沒有殘骸版的是 null。**建模時就建好**，
   * 炸毀那一幀不配置。與活著的那一份一起放。
   */
  const ruins: (BufferGeometry | null)[] = []
  /** 活著的那一份幾何，一台一格 —— 重開一場之後要換回來 */
  const intact: BufferGeometry[] = []

  for (const t of targets) {
    const geo = groundGeometry(t.unit)
    if ('build' in t.unit.model) owned.push(geo)
    const m = new Mesh(geo, live)
    object.add(m)
    meshes.push(m)
    intact.push(geo)
    const ruin = 'build' in t.unit.model && t.unit.model.ruin !== undefined
      ? t.unit.model.ruin() : null
    if (ruin !== null) owned.push(ruin)
    ruins.push(ruin)
  }

  return {
    object,
    update(list) {
      for (let k = 0; k < list.length && k < meshes.length; k++) {
        const t = list[k]!
        const m = meshes[k]!
        m.position.copy(t.position)
        m.quaternion.copy(t.orientation)
        // 【死了換材質；有殘骸版的連形狀一起換，雙向】重開一場實體會復活，
        // 只換過去不換回來的話畫面留著殘骸。三個判斷都是參考比較，每幀跑
        // 也不配置
        const want = t.alive ? live : wreck
        if (m.material !== want) m.material = want
        const ruin = ruins[k]!
        if (ruin === null) continue
        const shape = t.alive ? intact[k]! : ruin
        if (m.geometry !== shape) m.geometry = shape
      }
    },
    dispose() {
      for (const g of owned) g.dispose()
      live.dispose()
      wreck.dispose()
    },
  }
}
