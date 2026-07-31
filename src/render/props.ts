import { BoxGeometry, Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'

/**
 * 浮動參照物。純視覺、無碰撞，提供速度與高度的視覺錨點——
 * 無特徵海面在 700 km/h 下幾乎沒有速度感。
 */
export function createProps(count: number, spread = 9000): InstancedMesh {
  const mesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
    count,
  )
  mesh.frustumCulled = false

  const dummy = new Object3D()
  const foam = new Color(0xd8e6ef)
  const island = new Color(0x4a5f42)

  // 固定亂數種子，確保每次啟動場景一致（除錯可重現）
  let seed = 1337
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  for (let i = 0; i < count; i++) {
    const isIsland = rand() < 0.08
    const x = (rand() - 0.5) * spread * 2
    const z = (rand() - 0.5) * spread * 2
    if (isIsland) {
      const s = 60 + rand() * 220
      dummy.position.set(x, s * 0.12, z)
      dummy.scale.set(s, s * 0.3, s * (0.6 + rand() * 0.8))
      mesh.setColorAt(i, island)
    } else {
      const s = 4 + rand() * 10
      dummy.position.set(x, 0.4, z)
      dummy.scale.set(s, 0.8, s * 0.5)
      mesh.setColorAt(i, foam)
    }
    dummy.rotation.y = rand() * Math.PI * 2
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
  }
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  return mesh
}
