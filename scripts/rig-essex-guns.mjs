/**
 * Author Essex's physical AA mounts. Default source: models-src/essex.glb.
 * To rebuild from measurements after editing the rig data, pass an original, unrigged GLB:
 *   node scripts/rig-essex-guns.mjs path/to/original-essex.glb
 * An already-rigged default input is left unchanged. The measured source is retained in Git.
 * Matching whole connected components avoids stealing faces from overlapping legacy mounts.
 */
import { NodeIO } from '@gltf-transform/core'
import { BoxGeometry, BufferGeometry, Float32BufferAttribute, CylinderGeometry, Quaternion, Vector3 } from 'three'
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js'
import fs from 'node:fs/promises'

const data = JSON.parse(await fs.readFile('scripts/data/essex-gun-rig.json', 'utf8'))
const io = new NodeIO(), doc = await io.read(process.argv[2] ?? 'models-src/essex.glb')
const root = doc.getRoot(), scene = root.listScenes()[0], buffer = root.listBuffers()[0]
if (root.listNodes().some(n => n.getName().startsWith('ESSEX_mount_'))) {
  console.log('Essex is already rigged; pass an unrigged source to rebuild.'); process.exit(0)
}
const sourceNode = root.listNodes().find(n => n.getName() === 'ESSEX_Guns')
const sourceMesh = sourceNode.getMesh(), source = sourceMesh.listPrimitives()[0], material = source.getMaterial()
const positions = source.getAttribute('POSITION'), normals = source.getAttribute('NORMAL'), indices = source.getIndices().getArray()
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
  const p = [], n = []
  for (const i of c.ids) { p.push(...positions.getElement(i, [])); n.push(...normals.getElement(i, [])) }
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute(p, 3)).setAttribute('normal', new Float32BufferAttribute(n, 3))
}
function mesh(name, geometry) {
  const primitive = doc.createPrimitive().setMaterial(material)
  for (const [key, attribute] of Object.entries(geometry.attributes)) {
    primitive.setAttribute(key === 'position' ? 'POSITION' : 'NORMAL',
      doc.createAccessor().setType('VEC3').setArray(attribute.array).setBuffer(buffer))
  }
  return doc.createMesh(name).addPrimitive(primitive)
}
function capTop(geometry) {
  geometry.computeBoundingBox()
  const y = geometry.boundingBox.max.y, vertices = geometry.getAttribute('position'), corners = new Map()
  for (let i = 0; i < vertices.count; i++) {
    if (Math.abs(vertices.getY(i) - y) > 1e-5) continue
    const point = new Vector3().fromBufferAttribute(vertices, i)
    corners.set(point.toArray().map(v => Math.round(v * 1e5)).join(','), point)
  }
  if (corners.size !== 4) throw new Error('Expected four corners around an open gun roof')
  const ring = [...corners.values()], center = ring.reduce((sum, v) => sum.add(v), new Vector3()).divideScalar(4)
  ring.sort((a, b) => Math.atan2(b.z - center.z, b.x - center.x) - Math.atan2(a.z - center.z, a.x - center.x))
  const positions = [], normals = []
  for (const i of [0, 1, 2, 0, 2, 3]) { positions.push(...ring[i].toArray()); normals.push(0, 1, 0) }
  const roof = new BufferGeometry().setAttribute('position', new Float32BufferAttribute(positions, 3))
    .setAttribute('normal', new Float32BufferAttribute(normals, 3))
  return mergeGeometries([geometry, roof])
}
const yAxis = new Vector3(0, 1, 0), xAxis = new Vector3(1, 0, 0)
const specs = []
const platforms = []
// Exposed barrel proportions for this low-poly model; muzzle coordinates use the same lengths.
const barrelProfiles = {
  flak: { length: 3.2, radius: 0.14, segments: 8 },
  autocannon: { length: 2, radius: 0.1, segments: 6 },
}
const housingFootprint = 2 / 3
for (const d of data) {
  if (d.omitReason) {
    // Account for removed source components, without leaving a render node or firing candidate.
    extract(d.bodyBounds).dispose()
    d.barrelBounds.map(extract).forEach(geometry => geometry.dispose())
    continue
  }
  const oldYaw = new Quaternion().setFromAxisAngle(yAxis, d.sourceYaw)
  const oldPitch = new Quaternion().setFromAxisAngle(xAxis, d.restPitch)
  const pivot = new Vector3(...d.sourcePivot), oldRoot = new Vector3(...d.sourceRoot)
  const profile = barrelProfiles[d.tier]
  const length = profile?.length ?? oldRoot.distanceTo(new Vector3(...d.sourceTip))
  let bodyGeo = extract(d.bodyBounds).translate(-pivot.x, -pivot.y, -pivot.z)
  // Legacy 20 mm barrels point diagonally across axis-aligned housings. Author the housing
  // square to the barrel's canonical -Z axis instead of preserving that skew.
  if (d.tier !== 'mg') bodyGeo.applyQuaternion(oldYaw.clone().invert())
  const footprint = profile ? housingFootprint : 1
  // Match the two rectangular stern 40 mm housings to the other square footprints.
  const depthScale = d.tier === 'autocannon'
    ? footprint * (d.bodyBounds[3] - d.bodyBounds[0]) / (d.bodyBounds[5] - d.bodyBounds[2]) : footprint
  const spacing = d.spacing * footprint
  bodyGeo.scale(footprint, 1, depthScale)
  if (d.capTop) {
    bodyGeo = capTop(bodyGeo)
  }
  const barrels = d.barrelBounds.map(extract)
  let barrelGeo = mergeGeometries(barrels)
    .translate(-oldRoot.x, -oldRoot.y, -oldRoot.z).applyQuaternion(oldYaw.clone().multiply(oldPitch).invert())
  const elevation = oldRoot.clone().sub(pivot).applyQuaternion(oldYaw.clone().invert())
  if (d.tier === 'mg') {
    // Keep the small barrel above the housing cap throughout its upward elevation range.
    bodyGeo.computeBoundingBox()
    elevation.set(0, bodyGeo.boundingBox.max.y + 0.08, bodyGeo.boundingBox.min.z + 0.07)
  }
  if (profile) {
    // Put the shared elevation axis in front of the housing, including at 85 degrees.
    elevation.set(0, 0, -(d.bodyBounds[5] - d.bodyBounds[2]) * depthScale / 2 - (d.tier === 'flak' ? 0.35 : 0.12))
    const tubes = (spacing ? [-spacing, spacing] : [0]).map(x => {
      const tube = new CylinderGeometry(profile.radius, profile.radius, length, profile.segments).toNonIndexed()
        .rotateX(Math.PI / 2).translate(x, 0, -length / 2)
      tube.deleteAttribute('uv'); return tube
    })
    if (d.tier === 'flak') {
      const drum = new CylinderGeometry(0.48, 0.48, (spacing ? 2.1 : 1.1) * footprint, 8).toNonIndexed().rotateZ(Math.PI / 2)
      drum.deleteAttribute('uv'); tubes.push(drum)
    }
    barrelGeo = mergeGeometries(tubes)
  }
  const name = `ESSEX_mount_${d.id}`
  const body = doc.createNode(name).setMesh(mesh(name, bodyGeo)).setTranslation(d.pivot)
    .setRotation(new Quaternion().setFromAxisAngle(yAxis, d.restYaw).toArray())
  const barrel = doc.createNode(name + '_barrel').setMesh(mesh(name + '_barrel', barrelGeo))
    .setTranslation(elevation.toArray()).setRotation(oldPitch.toArray())
  body.addChild(barrel); scene.addChild(body)
  if (d.pivot[0] !== d.sourcePivot[0]) {
    // Extend the existing gallery under relocated mounts; do not leave them floating.
    const half = d.tier === 'mg' ? 0.65 : 1.65
    const platform = new BoxGeometry(Math.abs(d.pivot[0] - d.sourcePivot[0]) + 2 * half, 0.25, 2 * half)
      .toNonIndexed().translate((d.pivot[0] + d.sourcePivot[0]) / 2, d.bodyBounds[1] - 0.075, d.pivot[2])
    platform.deleteAttribute('uv'); platforms.push(platform)
  }
  specs.push({ ...d, spacing, modelNode: name, elevation: elevation.toArray(), length })
}
if (components.some(c => !c.used)) throw new Error('Unassigned original gun geometry')
if (platforms.length) scene.addChild(doc.createNode('ESSEX_GunPlatforms').setMesh(mesh('ESSEX_GunPlatforms', mergeGeometries(platforms))))
for (const a of source.listAttributes()) a.dispose()
source.getIndices().dispose(); source.dispose(); sourceMesh.dispose(); sourceNode.dispose()

const raw = Buffer.from(await io.writeBinary(doc)), jsonLength = raw.readUInt32LE(12)
const json = JSON.parse(raw.subarray(20, 20 + jsonLength).toString('utf8')); delete json.asset.generator
const encoded = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20); encoded.copy(padded)
const tail = raw.subarray(20 + jsonLength), header = Buffer.alloc(20)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(20 + padded.length + tail.length, 8)
header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
await fs.writeFile('models-src/essex.glb', Buffer.concat([header, padded, tail]))

const num = n => Number(n.toFixed(8)), vec = a => `new Vector3(${a.map(num).join(', ')})`
const radians = degrees => degrees * Math.PI / 180
let ts = `// Generated by scripts/rig-essex-guns.mjs from measured model components.\nimport { Vector3 } from 'three'\nimport type { ShipGunMount } from './shipGunMounts'\n\n/** All ${specs.length} physical mounts share the existing eight batteries; crowded mounts are omitted. */\nexport const ESSEX_GUN_MOUNTS: Readonly<Record<string, ShipGunMount>> = {\n`
for (const d of specs) {
  const muzzles = d.spacing ? [vec([-d.spacing, 0, -d.length]), vec([d.spacing, 0, -d.length])] : [vec([0, 0, -d.length])]
  ts += `  ${d.id}: { id: '${d.id}', tier: '${d.tier}', modelNode: '${d.modelNode}',\n    pivot: ${vec(d.pivot)}, elevationPivot: ${vec(d.elevation)}, muzzles: [${muzzles.join(', ')}],\n    restYaw: ${d.restYaw}, restPitch: ${d.restPitch}, yawSectors: [[${d.yawSector.map(radians).join(', ')}]], pitchRange: [${d.pitchRange.map(radians).join(', ')}] },\n`
}
ts += `}\n\nexport const ESSEX_GUN_GROUPS: Readonly<Record<string, readonly ShipGunMount[]>> = {\n`
for (const group of [...new Set(specs.map(d => d.group))].sort()) ts += `  ${group}: [${specs.filter(d => d.group === group).map(d => `'${d.id}'`).join(', ')}].map(id => ESSEX_GUN_MOUNTS[id]!),\n`
ts += `}\n`
await fs.writeFile('src/specs/essexGunMounts.ts', ts)
console.log(`Authored ${specs.length} Essex AA mounts and regenerated their physical rig definitions.`)
