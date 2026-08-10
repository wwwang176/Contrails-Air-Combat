import { BoxGeometry, Color, InstancedMesh, MeshStandardMaterial, Object3D } from 'three'

export interface Props {
  mesh: InstancedMesh
  dispose(): void
}

/**
 * 浮動參照物。純視覺、無碰撞，提供速度與高度的視覺錨點——
 * 無特徵海面在 700 km/h 下幾乎沒有速度感。
 *
 * 【M10 起回傳物件而不是 mesh】地形要能整組換掉（見 `render/terrain.ts`），
 * 而換掉的前提是釋放得了。
 */
export function createProps(count: number, spread = 9000): Props {
  const mesh = new InstancedMesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({ flatShading: true, roughness: 0.9 }),
    count,
  )
  mesh.frustumCulled = false

  const dummy = new Object3D()
  const island = new Color(0x4a5f42)

  // 固定亂數種子，確保每次啟動場景一致（除錯可重現）
  let seed = 1337
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296
    return seed / 4294967296
  }

  /**
   * 【2026-08-11 拿掉白色浪花，只留小島】專案負責人：海面的白色物體移除。
   *
   * 原本 92% 的實例是 4～14 m 的白方塊（0xd8e6ef），散在整片海上當速度錨點。
   * 海面長出太陽碎光之後那些方塊變成雜訊 —— 碎光本身就是密度隨幾何變化的
   * 紋理，而白方塊是靜止的、與光照無關的假物件。
   *
   * 【亂數序列刻意不動】仍然照原本的順序抽 isIsland / x / z / 尺寸 / 旋轉，
   * 只是不再寫入非小島的那些 —— 所以**小島的位置與外觀與之前完全一樣**，
   * 這次改動在畫面上的差異只有「白方塊不見了」。
   *
   * 【InstancedMesh 的容量與繪製數是兩件事】容量仍是 count（配置好的緩衝），
   * 但只有前 n 個寫了矩陣，其餘是未初始化的單位矩陣 —— 那會在原點畫出一個
   * 1×1×1 的方塊。所以**必須**把 mesh.count 收到 n。
   */
  let n = 0
  for (let i = 0; i < count; i++) {
    const isIsland = rand() < 0.08
    const x = (rand() - 0.5) * spread * 2
    const z = (rand() - 0.5) * spread * 2
    if (isIsland) {
      const s = 60 + rand() * 220
      dummy.position.set(x, s * 0.12, z)
      dummy.scale.set(s, s * 0.3, s * (0.6 + rand() * 0.8))
      dummy.rotation.y = rand() * Math.PI * 2
      dummy.updateMatrix()
      mesh.setColorAt(n, island)
      mesh.setMatrixAt(n, dummy.matrix)
      n++
    } else {
      // 抽掉這一筆的尺寸與旋轉，讓後面的小島拿到與改動前相同的亂數
      rand()
      rand()
    }
  }
  mesh.count = n
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true

  return {
    mesh,
    dispose() {
      mesh.geometry.dispose()
      const m = mesh.material
      if (Array.isArray(m)) for (const x of m) x.dispose()
      else m.dispose()
    },
  }
}
