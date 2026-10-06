import { Mesh, type BufferGeometry, type Material, type Object3D } from 'three'

/** 僅釋放這次載入擁有的幾何與材質；塗裝貼圖由 shipAssets 共用。 */
export function disposeHangarShip(root: Object3D): void {
  const geometries = new Set<BufferGeometry>()
  const materials = new Set<Material>()
  root.traverse((child) => {
    if (!(child instanceof Mesh)) return
    geometries.add(child.geometry)
    if (Array.isArray(child.material)) {
      for (const material of child.material) materials.add(material)
    } else materials.add(child.material)
  })
  for (const geometry of geometries) geometry.dispose()
  for (const material of materials) material.dispose()
}

/** 載入與塗裝都可能晚於下一次選取；只有原本的場景容器仍有效時才交還模型。 */
export async function prepareHangarShip(
  root: Object3D,
  isCurrent: () => boolean,
  dress: (root: Object3D) => Promise<void>,
): Promise<boolean> {
  try {
    if (isCurrent()) {
      await dress(root)
      if (isCurrent()) return true
    }
  } catch (error) {
    disposeHangarShip(root)
    throw error
  }
  disposeHangarShip(root)
  return false
}
