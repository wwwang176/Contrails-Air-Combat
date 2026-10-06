import { Box3, Mesh, type Object3D, Vector3 } from 'three'

/** 真實三角形數：有索引的幾何要看 index，position.count/3 算的是頂點數。 */
export function countModelTriangles(root: Object3D): { tris: number; meshes: number } {
  let tris = 0
  let meshes = 0
  root.traverse((o) => {
    const g = (o as Mesh).geometry
    if (!g?.getAttribute) return
    const p = g.getAttribute('position')
    if (!p) return
    meshes++
    tris += g.index ? g.index.count / 3 : p.count / 3
  })
  return { tris, meshes }
}

/** 更新世界矩陣後逐頂點量測，保留空名稱，三角形數取整數。 */
export function measureReferenceNodes(root: Object3D) {
  root.updateMatrixWorld(true)
  const out: { name: string; tris: number; box: number[] }[] = []
  const v = new Vector3()
  root.traverse((o) => {
    const mesh = o as Mesh
    const pos = mesh.geometry?.getAttribute?.('position')
    if (!pos) return
    let x0 = Infinity, y0 = Infinity, z0 = Infinity
    let x1 = -Infinity, y1 = -Infinity, z1 = -Infinity
    for (let i = 0; i < pos.count; i++) {
      v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(mesh.matrixWorld)
      if (v.x < x0) x0 = v.x
      if (v.y < y0) y0 = v.y
      if (v.z < z0) z0 = v.z
      if (v.x > x1) x1 = v.x
      if (v.y > y1) y1 = v.y
      if (v.z > z1) z1 = v.z
    }
    const idx = mesh.geometry.index
    out.push({
      name: mesh.name,
      tris: Math.round((idx ? idx.count : pos.count) / 3),
      box: [x0, y0, z0, x1, y1, z1],
    })
  })
  return out
}

/**
 * 使用呼叫端已更新的世界矩陣轉換局部包圍盒，並附上原材質摘要。
 * 旋轉後的外框可能比逐頂點量測寬；這是原始模型探針既有的量測定義。
 */
export function measureProbeParts(root: Object3D) {
  /**
   * 逐 mesh 的世界包圍盒。
   *
   * 【為什麼要逐 mesh 而不只是整體】整體包圍盒被**任何一片**離群幾何
   * 撐大之後就不能拿來推比例了 —— 而那一片在算圖上可能完全看不見
   * （無材質、在鏡頭外、或整片透明）。實測 He 111 H-6：整體算出來的
   * 「高」是真機的三倍。逐 mesh 一列就指得出是誰。
   *
   * 【這不是坑 5 的節點分類】那條說的是「不要靠猜測挑出機身再去量」。
   * 這裡不挑、不猜、不排除任何東西，只是把每一片各報一行給人看。
   */
  const parts: {
    name: string; mat: string; tris: number
    min: number[]; max: number[]; size: number[]
  }[] = []
  // 【從 root 走而不是從 gltf.scene】兩者涵蓋的 mesh 相同，但只有
  // 從 root 走才保證讀到的 `matrixWorld` 已經含 align 那兩層
  const pb = new Box3()
  root.traverse((o) => {
    const mesh = o as Mesh
    const g = mesh.geometry
    if (!g?.getAttribute) return
    const p = g.getAttribute('position')
    if (!p) return
    g.computeBoundingBox()
    pb.copy(g.boundingBox!).applyMatrix4(mesh.matrixWorld)
    const s = new Vector3()
    pb.getSize(s)
    parts.push({
      name: o.name === '' ? '(無名)' : o.name,
      // 原材質的摘要——名字沒資訊時，靠它認出哪一片是玻璃
      mat: String(mesh.userData['refMat'] ?? ''),
      tris: (g.index ? g.index.count : p.count) / 3,
      min: pb.min.toArray(), max: pb.max.toArray(), size: s.toArray(),
    })
  })
  return parts
}
