import type { Mesh, Object3D } from 'three'

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
