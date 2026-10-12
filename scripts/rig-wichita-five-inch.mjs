/**
 * Rebuild Wichita's eight 5-inch mounts as yaw bodies and elevated barrel/mantlet assemblies.
 * Run manually: node scripts/rig-wichita-five-inch.mjs
 * Unrelated primitives and surviving WICHITA_Guns vertex attributes are retained verbatim.
 * Re-running replaces the named mounts; it does not accumulate duplicate geometry.
 */
import { NodeIO } from '@gltf-transform/core'
import { Quaternion, Vector3 } from 'three'
import fs from 'node:fs/promises'

const path = 'models-src/wichita.glb'
const io = new NodeIO(), doc = await io.read(path)
const root = doc.getRoot(), buffer = root.listBuffers()[0], scene = root.listScenes()[0]
const source = root.listNodes().find(n => n.getName() === 'WICHITA_Guns').getMesh().listPrimitives()[0]
const material = source.getMaterial()
const yaw = Math.atan2(2.45, 2.05), pitch = Math.atan2(0.7, Math.hypot(2.45, 2.05))
const length = Math.hypot(2.45, 0.7, 2.05)
const rows = [[-6.1, 7.3, -31.3, 4.8], [-7, 9.73, -19.2, 7.23], [-5.3, 9.72, 31.2, 7.22], [-5.25, 7.9, 87.6, 5.4]]
const legacyBoxes = [
  [-7.6, 4.8, -32.95, -4.6, 8.35, -29.65], [-9.1616, 7.173, -33.7274, -6.5671, 8.0635, -31.5047],
  [-8.5, 7.23, -20.85, -5.5, 10.78, -17.55], [-10.0616, 9.603, -21.6274, -7.4671, 10.4935, -19.4047],
  [-6.8, 7.22, 29.55, -3.8, 10.77, 32.85], [-8.3616, 9.593, 28.7726, -5.7671, 10.4835, 30.9953],
  [-6.75, 5.4, 85.95, -3.75, 8.95, 89.25], [-8.3116, 7.773, 85.1726, -5.7171, 8.6635, 87.3953],
]
const boxes = legacyBoxes.flatMap(b => [b, [-b[3], b[1], b[2], -b[0], b[4], b[5]]])
const existing = root.listNodes().filter(n => /^WICHITA_5in_[ps][1-4](?:_barrel)?$/.test(n.getName()))
if (existing.length !== 0 && existing.length !== 16) throw new Error('Incomplete Wichita gun rig')
if (existing.length === 0) {
  const positions = source.getAttribute('POSITION'), indices = source.getIndices().getArray(), kept = []
  const p = [0, 0, 0]
  for (let i = 0; i < indices.length; i += 3) {
    const inside = boxes.some(b => {
      for (let j = 0; j < 3; j++) {
        positions.getElement(indices[i + j], p)
        if (p.some((v, k) => v < b[k] - 0.0002 || v > b[k + 3] + 0.0002)) return false
      }
      return true
    })
    if (!inside) kept.push(indices[i], indices[i + 1], indices[i + 2])
  }
  // The forward pair omits its bottom faces; the other six bodies are closed.
  if (indices.length - kept.length !== (2 * (10 + 8) + 6 * (12 + 8)) * 3) throw new Error(`Unexpected legacy mount triangle count: ${(indices.length - kept.length) / 3}`)
  source.getIndices().setArray(new Uint16Array(kept))
} else {
  // These meshes/accessors are owned by individual authored nodes; original shared material stays.
  for (const node of existing) {
    const mesh = node.getMesh()
    for (const primitive of mesh.listPrimitives()) {
      for (const accessor of primitive.listAttributes()) accessor.dispose()
      primitive.getIndices()?.dispose()
      primitive.dispose()
    }
    mesh.dispose(); node.dispose()
  }
}

function geometry() {
  const positions = [], normals = []
  function triangle(a, b, c) {
    const normal = new Vector3().subVectors(new Vector3(...b), new Vector3(...a))
      .cross(new Vector3().subVectors(new Vector3(...c), new Vector3(...a))).normalize().toArray()
    positions.push(...a, ...b, ...c); normals.push(...normal, ...normal, ...normal)
  }
  function quad(a, b, c, d) { triangle(a, b, c); triangle(a, c, d) }
  function cylinder(axis, radius, start, end, segments = 8) {
    const point = (a, t) => axis === 'x' ? [t, radius * Math.cos(a), radius * Math.sin(a)]
      : [radius * Math.cos(a), radius * Math.sin(a), t]
    const center = t => axis === 'x' ? [t, 0, 0] : [0, 0, t]
    for (let i = 0; i < segments; i++) {
      const a = i * Math.PI * 2 / segments, b = (i + 1) * Math.PI * 2 / segments
      quad(point(a, start), point(b, start), point(b, end), point(a, end))
      triangle(center(start), point(b, start), point(a, start))
      triangle(center(end), point(a, end), point(b, end))
    }
  }
  function mesh(name) {
    const primitive = doc.createPrimitive().setMaterial(material)
    primitive.setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(positions)).setBuffer(buffer))
    primitive.setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(normals)).setBuffer(buffer))
    return doc.createMesh(name).addPrimitive(primitive)
  }
  return { quad, cylinder, mesh }
}
for (const [index, [x, y, z, bottom]] of rows.entries()) for (const [side, sign] of [['p', 1], ['s', -1]]) {
  const id = `WICHITA_5in_${side}${index + 1}`
  const g = geometry(), low = bottom - y, high = 1.05
  // Vertical front face; tapered sides/rear retain the existing simple silhouette.
  const a = [-1.5, low, -1.45], b = [1.5, low, -1.45], c = [1.35, high, -1.45], d = [-1.35, high, -1.45]
  const e = [-1.5, low, 1.65], f = [1.5, low, 1.65], h = [1.35, high, 1.45], j = [-1.35, high, 1.45]
  g.quad(b, a, d, c); g.quad(e, f, h, j); g.quad(a, e, j, d)
  g.quad(f, b, c, h); g.quad(d, j, h, c); g.quad(a, b, f, e)
  const body = doc.createNode(id).setMesh(g.mesh(id)).setTranslation([x * sign, y, z])
    .setRotation(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), yaw * sign).toArray())
  const gun = geometry()
  gun.cylinder('x', 0.48, -0.55, 0.55) // shared elevation axis, round mantlet closes the front seam
  gun.cylinder('z', 0.14, -length, 0)
  const barrel = doc.createNode(id + '_barrel').setMesh(gun.mesh(id + '_barrel'))
    .setTranslation([0, 0, -1.75]).setRotation(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), pitch).toArray())
  body.addChild(barrel); scene.addChild(body)
}

// Match the repository's source-GLB normalization (no generated metadata).
const raw = Buffer.from(await io.writeBinary(doc)), jsonLength = raw.readUInt32LE(12)
const json = JSON.parse(raw.subarray(20, 20 + jsonLength).toString('utf8'))
delete json.asset.generator
const encoded = Buffer.from(JSON.stringify(json)), padded = Buffer.alloc(Math.ceil(encoded.length / 4) * 4, 0x20)
encoded.copy(padded)
const tail = raw.subarray(20 + jsonLength), header = Buffer.alloc(20)
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4)
header.writeUInt32LE(20 + padded.length + tail.length, 8); header.writeUInt32LE(padded.length, 12); header.writeUInt32LE(0x4e4f534a, 16)
await fs.writeFile(path, Buffer.concat([header, padded, tail]))
console.log('Updated eight Wichita 5-inch gun bodies, elevation pivots, barrels and mantlets.')
