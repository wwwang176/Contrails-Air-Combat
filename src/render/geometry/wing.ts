import { BufferAttribute, BufferGeometry } from 'three'

export interface WingParams {
  /** 翼根弦長，m */
  rootChord: number
  tipChord: number
  /** 半翼展，m */
  halfSpan: number
  /** 前緣後掠角，rad */
  sweep: number
  /** 上反角，rad */
  dihedral: number
  thickness: number
  /** 翼根前緣在機體 Z 軸的位置 */
  rootZ: number
  rootY: number
}

/**
 * 梯形翼面板（含上反角與後掠角）。
 * mirrored = true 產生左翼（−X 方向）。
 */
export function buildWingPanel(p: WingParams, mirrored: boolean): BufferGeometry {
  const sx = mirrored ? -1 : 1
  const tipX = sx * p.halfSpan
  const tipY = p.rootY + Math.tan(p.dihedral) * p.halfSpan
  const tipLead = p.rootZ - Math.tan(p.sweep) * p.halfSpan
  const h = p.thickness / 2

  // 翼根前緣/後緣、翼尖前緣/後緣，上下各一層
  const corners: [number, number, number][] = [
    [0, p.rootY + h, p.rootZ], [0, p.rootY + h, p.rootZ + p.rootChord],
    [tipX, tipY + h, tipLead], [tipX, tipY + h, tipLead + p.tipChord],
    [0, p.rootY - h, p.rootZ], [0, p.rootY - h, p.rootZ + p.rootChord],
    [tipX, tipY - h, tipLead], [tipX, tipY - h, tipLead + p.tipChord],
  ]

  const faces = [
    [0, 2, 3], [0, 3, 1], // 上表面
    [4, 7, 6], [4, 5, 7], // 下表面
    [0, 4, 6], [0, 6, 2], // 前緣
    [1, 3, 7], [1, 7, 5], // 後緣
    [2, 6, 7], [2, 7, 3], // 翼尖
    [0, 1, 5], [0, 5, 4], // 翼根
  ]

  const positions: number[] = []
  for (const f of faces) {
    const tri = mirrored ? [f[0]!, f[2]!, f[1]!] : f
    for (const idx of tri) {
      const c = corners[idx as number]!
      positions.push(c[0], c[1], c[2])
    }
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
