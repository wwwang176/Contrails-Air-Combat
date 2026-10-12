/** Split LST's existing gun components into yaw/elevation nodes without changing their shape.
 * Rebuild: node scripts/rig-lst-guns.mjs path/to/original-unrigged-lst.glb
 * An already-rigged default input is left unchanged. Original source remains in Git.
 */
import { NodeIO } from '@gltf-transform/core'
import { BufferGeometry, Float32BufferAttribute, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import fs from 'node:fs/promises'

const data = JSON.parse(await fs.readFile('scripts/data/lst-gun-rig.json', 'utf8'))
const io = new NodeIO(), doc = await io.read(process.argv[2] ?? 'models-src/lst.glb')
const root = doc.getRoot(), scene = root.listScenes()[0], buffer = root.listBuffers()[0]
if (root.listNodes().some(n => n.getName().startsWith('LST_mount_'))) {
  console.log('LST is already rigged; pass an unrigged source to rebuild.'); process.exit(0)
}
const sourceNode = root.listNodes().find(n => n.getName() === 'LST_Steel_merged')
const sourceMesh = sourceNode.getMesh(), source = sourceMesh.listPrimitives()[0], material = source.getMaterial()
const positions = source.getAttribute('POSITION'), indices = source.getIndices().getArray()
// Keep POSITION-only primitives: GLTFLoader preserves their original flat shading.
const parent = Array.from({ length: positions.getCount() }, (_, i) => i), keys = new Map(), point = []
const find = n => { while (parent[n] !== n) { parent[n] = parent[parent[n]]; n = parent[n] } return n }
for (let i = 0; i < positions.getCount(); i++) {
  const key = positions.getElement(i, point).map(n => Math.round(n * 1e4)).join(',')
  if (keys.has(key)) parent[find(i)] = find(keys.get(key)); else keys.set(key, i)
}
for (let i = 0; i < indices.length; i += 3) {
  parent[find(indices[i + 1])] = find(indices[i]); parent[find(indices[i + 2])] = find(indices[i])
}
const parts = new Map()
for (let i = 0; i < indices.length; i++) {
  const group = find(indices[i]); if (!parts.has(group)) parts.set(group, [])
  parts.get(group).push(indices[i])
}
const components = [...parts.values()].map(ids => {
  const bounds = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]
  for (const i of ids) for (const [k, v] of positions.getElement(i, point).entries()) {
    bounds[k] = Math.min(bounds[k], v); bounds[k + 3] = Math.max(bounds[k + 3], v)
  }
  return { ids, bounds, used: false }
})
function extract(bounds) {
  const matches = components.filter(c => c.bounds.every((v, i) => Math.abs(v - bounds[i]) < 0.0002))
  if (matches.length !== 1 || matches[0].used) throw new Error(`Ambiguous/reused gun component ${bounds}`)
  const c = matches[0]; c.used = true
  const p = []
  for (const i of c.ids) p.push(...positions.getElement(i, []))
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(p, 3))
}
function mesh(name, geometry) {
  const primitive = doc.createPrimitive().setMaterial(material)
  for (const [key, attribute] of Object.entries(geometry.attributes)) {
    primitive.setAttribute(key === 'position' ? 'POSITION' : 'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(attribute.array).setBuffer(buffer))
  }
  return doc.createMesh(name).addPrimitive(primitive)
}
const yAxis = new Vector3(0, 1, 0), xAxis = new Vector3(1, 0, 0), specs = []
for (const d of data) {
  const pivot = new Vector3(...d.pivot), origin = new Vector3(...d.root), tip = new Vector3(...d.tip)
  const direction = tip.clone().sub(origin), length = direction.length()
  const restYaw = Math.atan2(-direction.x, -direction.z)
  const restPitch = Math.atan2(direction.y, Math.hypot(direction.x, direction.z))
  const yaw = new Quaternion().setFromAxisAngle(yAxis, restYaw)
  const pitch = new Quaternion().setFromAxisAngle(xAxis, restPitch)
  const elevation = origin.clone().sub(pivot).applyQuaternion(yaw.clone().invert())
  const bodyGeo = mergeGeometries(d.bodies.map(extract)).translate(-pivot.x, -pivot.y, -pivot.z).applyQuaternion(yaw.clone().invert())
  const barrelGeo = mergeGeometries(d.barrels.map(extract)).translate(-origin.x, -origin.y, -origin.z)
    .applyQuaternion(yaw.clone().multiply(pitch).invert())
  const name = `LST_mount_${d.id}`
  const body = doc.createNode(name).setMesh(mesh(name, bodyGeo)).setTranslation(d.pivot).setRotation(yaw.toArray())
  const barrel = doc.createNode(name + '_barrel').setMesh(mesh(name + '_barrel', barrelGeo))
    .setTranslation(elevation.toArray()).setRotation(pitch.toArray())
  body.addChild(barrel); scene.addChild(body)
  specs.push({ ...d, name, restYaw, restPitch, elevation: elevation.toArray(), length })
}
if (components.some(c => !c.used)) throw new Error('Unassigned original LST gun geometry')
for (const a of source.listAttributes()) a.dispose()
source.getIndices().dispose(); source.dispose(); sourceMesh.dispose(); sourceNode.dispose()
const raw = Buffer.from(await io.writeBinary(doc)), jsonLength = raw.readUInt32LE(12)
const json = JSON.parse(raw.subarray(20, 20 + jsonLength).toString('utf8')); delete json.asset.generator
const encoded = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded)
const tail = raw.subarray(20 + jsonLength), header = Buffer.alloc(20)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + tail.length, 8)
header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
await fs.writeFile('models-src/lst.glb', Buffer.concat([header, padded, tail]))

const num = n => Number(n.toFixed(8)), vec = a => `new Vector3(${a.map(num).join(', ')})`
const radians = degrees => degrees * Math.PI / 180
let ts = `// Generated by scripts/rig-lst-guns.mjs from the original 24 connected gun parts.\nimport { Vector3 } from 'three'\nimport type { ShipGunMount } from './shipGunMounts'\n\n/** Eight physical mounts share five existing batteries; hull tubs stay fixed. */\nexport const LST_GUN_MOUNTS: Readonly<Record<string, ShipGunMount>> = {\n`
for (const d of specs) {
  const muzzles = d.spacing ? [vec([-d.spacing, 0, -d.length]), vec([d.spacing, 0, -d.length])] : [vec([0, 0, -d.length])]
  ts += `  ${d.id}: { id: '${d.id}', tier: '${d.tier}', modelNode: '${d.name}',\n    pivot: ${vec(d.pivot)}, elevationPivot: ${vec(d.elevation)}, muzzles: [${muzzles.join(', ')}],\n    restYaw: ${d.restYaw}, restPitch: ${d.restPitch}, yawSectors: [${d.yawSectors.map(s => '[' + s.map(radians).join(', ') + ']').join(', ')}], pitchRange: [${d.pitchRange.map(radians).join(', ')}] },\n`
}
ts += `}\n\nexport const LST_GUN_GROUPS: Readonly<Record<string, readonly ShipGunMount[]>> = {\n`
for (const group of [...new Set(specs.map(d => d.group))].sort()) ts += `  ${group}: [${specs.filter(d => d.group === group).map(d => `'${d.id}'`).join(', ')}].map(id => LST_GUN_MOUNTS[id]!),\n`
ts += `}\n`
await fs.writeFile('src/specs/lstGunMounts.ts', ts)
console.log(`Authored ${specs.length} LST mounts, preserving all 24 original components.`)
