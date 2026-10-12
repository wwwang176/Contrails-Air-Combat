import { BoxGeometry, CylinderGeometry, MeshStandardMaterial } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

/** M4 GLB 的車長塔頂面約 (0.45, 2.58, 0.15)，加上 0.24 m 槍架。模型座標。 */
export const SHERMAN_ROOF_GUN = { x: 0.45, y: 2.82, z: 0.15 } as const

/** 車頂 .50 的輕量模型：槍管朝 −Z，原點在獨立俯仰轉軸；同場的雪曼共用。 */
export function createRoofGunParts() {
  const barrel = new CylinderGeometry(0.035, 0.035, 0.7, 6).rotateX(Math.PI / 2).translate(0, 0, -0.5)
  const receiver = new BoxGeometry(0.13, 0.14, 0.35).translate(0, 0, 0.025)
  const gun = mergeGeometries([barrel, receiver])!
  barrel.dispose(); receiver.dispose()
  const post = new CylinderGeometry(0.045, 0.045, 0.24, 6).translate(0, -0.12, 0)
  const material = new MeshStandardMaterial({ color: 0x292c29, roughness: 0.8, metalness: 0.2, flatShading: true })
  return {
    gun, post, material,
    dispose(): void { gun.dispose(); post.dispose(); material.dispose() },
  }
}
