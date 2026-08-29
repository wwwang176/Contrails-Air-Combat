/**
 * **量「不烘變換也能併的零件有多少」**。
 *
 * ```
 * node node_modules/vite-node/vite-node.mjs test/tools/merge-groups.probe.ts
 * ```
 *
 * 【它在回答什麼】把靜態零件按材質合併可以省下大量 draw call，但
 * `geometry.clone().applyMatrix4(mesh.matrixWorld)` 那一步會改像素 —— CPU 用
 * float64 算完存成 float32，GPU 是 float32 矩陣乘 float32 頂點，最低位不同，
 * 三角形邊緣的像素必然翻動。
 *
 * 不烘變換也能併的條件是三條：掛在 `hull` 底下、局部矩陣是單位矩陣、材質
 * 不透明。這支數的就是滿足這三條的零件有幾株、分成幾組、合併後剩幾個 mesh。
 */
import { Group, Material, Mesh, Object3D } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'

const IDS = ['p51d', 'bf109k4', 'he111', 'b17g']

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]

function isIdentity(o: Object3D): boolean {
  const e = o.matrix.elements
  for (let i = 0; i < 16; i++) if (e[i] !== IDENTITY[i]) return false
  return true
}

console.log('   機種      總 mesh   可併    組數   會動   非單位矩陣   半透明   合併後')
for (const id of IDS) {
  const model = buildAircraft({ id } as never)
  model.group.updateMatrixWorld(true)
  const hull = model.group.children[0] as Group

  // 會動的：呼叫 setPropSpin 前後比對，變了的節點連同它的整個子樹
  const before = new Map<Object3D, string>()
  model.group.traverse((o) => { before.set(o, `${o.rotation.z}|${o.visible}`) })
  model.setPropSpin(1.234, true)
  const moving = new Set<Object3D>()
  model.group.traverse((o) => {
    if (before.get(o) !== `${o.rotation.z}|${o.visible}`) o.traverse((c) => moving.add(c))
  })
  for (const o of [...moving]) o.traverse((c) => moving.add(c))
  model.setPropSpin(0, false)

  let total = 0, movingMeshes = 0, xform = 0, translucent = 0
  const groups = new Map<string, number>()
  hull.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    total++
    if (moving.has(m)) { movingMeshes++; return }
    if ((m.material as Material).transparent) { translucent++; return }
    if (m.parent !== hull || !isIdentity(m)) { xform++; return }
    const attrs = Object.keys(m.geometry.attributes).sort().join(',')
    const key = `${(m.material as Material).uuid}|${attrs}|${m.geometry.index ? 'i' : 'n'}`
    groups.set(key, (groups.get(key) ?? 0) + 1)
  })
  const mergeable = [...groups.values()].reduce((a, b) => a + b, 0)
  const after = groups.size + movingMeshes + xform + translucent
  console.log(
    `   ${id.padEnd(10)}${String(total).padStart(5)}${String(mergeable).padStart(8)}` +
    `${String(groups.size).padStart(7)}${String(movingMeshes).padStart(7)}` +
    `${String(xform).padStart(11)}${String(translucent).padStart(9)}${String(after).padStart(9)}`,
  )
  model.dispose()
}
