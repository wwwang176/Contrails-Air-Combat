import {
  ConeGeometry, InstancedMesh, MeshLambertMaterial, Object3D, Quaternion, Vector3,
} from 'three'
import { BOMBS_CAPACITY, type Bombs } from '../world/bomb'

const DUMMY = new Object3D()
const DIR = new Vector3()
const TAIL = new Vector3(0, 1, 0)
const Q = new Quaternion()

/** 收起來時擺去哪裡。遠低於任何地形，而且 `frustumCulled` 關著所以不會被誤剔 */
const PARKED_Y = -1e6

export interface BombVisuals {
  object: InstancedMesh
  update(bombs: Bombs): void
  dispose(): void
}

/**
 * 空中的炸彈。
 *
 * 【為什麼是圓錐而不是一顆真的炸彈】這一輪的交付物是**瞄具**：要看得見
 * 「東西真的掉下去了」，不需要看得清它長什麼樣。八個側面 16 個三角形，
 * 而且尖端朝速度方向 —— 落下時會自己轉正，那是免費的可讀性。
 */
export function createBombs(): BombVisuals {
  // `ConeGeometry` 的尖端原本朝 +Y；轉 180° 之後朝 −Y，於是模型的**尾端**
  // 是 +Y，`setFromUnitVectors(TAIL, DIR)` 才會把尖端轉去速度方向
  const geo = new ConeGeometry(0.22, 1.6, 8)
  geo.rotateX(Math.PI)
  const mat = new MeshLambertMaterial({ color: 0x4a4a48 })
  const mesh = new InstancedMesh(geo, mat, BOMBS_CAPACITY)
  // 【關掉視錐剔除】包圍盒是建構時算的，而實例每幀在動 —— 開著的話整批會在
  // 相機轉開時消失。與其他實例池同一個處置
  mesh.frustumCulled = false
  mesh.count = BOMBS_CAPACITY

  return {
    object: mesh,
    update(bombs) {
      for (let i = 0; i < BOMBS_CAPACITY; i++) {
        if (bombs.active[i] === 0) {
          DUMMY.position.set(0, PARKED_Y, 0)
          DUMMY.quaternion.identity()
        } else {
          DUMMY.position.set(bombs.x[i]!, bombs.y[i]!, bombs.z[i]!)
          DIR.set(bombs.vx[i]!, bombs.vy[i]!, bombs.vz[i]!)
          // 【尖端朝速度】炸彈順著氣流轉正。投下的第一瞬間速度是水平的，
          // 落地前幾乎垂直 —— 那個轉正本身就讀得出彈道
          if (DIR.lengthSq() > 1e-6) {
            DIR.normalize()
            DUMMY.quaternion.copy(Q.setFromUnitVectors(TAIL, DIR))
          }
        }
        DUMMY.updateMatrix()
        mesh.setMatrixAt(i, DUMMY.matrix)
      }
      mesh.instanceMatrix.needsUpdate = true
    },
    dispose() {
      geo.dispose()
      mat.dispose()
      mesh.dispose()
    },
  }
}
