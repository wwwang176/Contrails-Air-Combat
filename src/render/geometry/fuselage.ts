import { BufferAttribute, BufferGeometry } from 'three'

export interface FuselageSection {
  /** 沿機體 Z 軸的位置，負值為機首方向 */
  z: number
  halfWidth: number
  halfHeight: number
  /** 截面中心的垂直偏移 */
  centerY: number
}

/**
 * 以橢圓截面沿軸線 lofting 產生機身。
 * 首尾截面若半徑為 0 則自動收成尖端。
 */
export function buildFuselage(
  sections: readonly FuselageSection[],
  radialSegments = 8,
): BufferGeometry {
  const rings: number[][] = sections.map((s) => {
    const ring: number[] = []
    for (let i = 0; i < radialSegments; i++) {
      const t = (i / radialSegments) * Math.PI * 2
      ring.push(Math.cos(t) * s.halfWidth, s.centerY + Math.sin(t) * s.halfHeight, s.z)
    }
    return ring
  })

  const positions: number[] = []
  const pushTri = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  const vertexOf = (ring: number[], i: number) => {
    const k = (i % radialSegments) * 3
    return [ring[k]!, ring[k + 1]!, ring[k + 2]!]
  }

  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s]!
    const b = rings[s + 1]!
    for (let i = 0; i < radialSegments; i++) {
      const a0 = vertexOf(a, i)
      const a1 = vertexOf(a, i + 1)
      const b0 = vertexOf(b, i)
      const b1 = vertexOf(b, i + 1)
      pushTri(a0, b0, b1)
      pushTri(a0, b1, a1)
    }
  }

  // 首尾封口
  const cap = (ring: number[], sec: FuselageSection, reverse: boolean) => {
    const centre = [0, sec.centerY, sec.z]
    for (let i = 0; i < radialSegments; i++) {
      const v0 = vertexOf(ring, i)
      const v1 = vertexOf(ring, i + 1)
      if (reverse) pushTri(centre, v1, v0)
      else pushTri(centre, v0, v1)
    }
  }
  cap(rings[0]!, sections[0]!, true)
  cap(rings[rings.length - 1]!, sections[sections.length - 1]!, false)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
