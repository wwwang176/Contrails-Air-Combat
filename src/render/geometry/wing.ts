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
  // 【符號修正】機首是 −Z，所以「後掠」＝翼尖前緣往 +Z（機尾方向）移動。
  // 原式用減號，產生的是**前掠**翼：實測翼根前緣 Z=−1.5 時翼尖前緣跑到
  // −3.54。垂直安定面用同一個函式立起來，於是整片往機首傾——那正是
  // 「垂尾看起來顛倒」的來源（它其實朝上，只是前掠）。
  const tipLead = p.rootZ + Math.tan(p.sweep) * p.halfSpan
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

  // 【纏繞方向修正】上面的 faces 表本身是內外翻轉的：實測未鏡像版本的
  // 帶符號體積為 −3.36（正確值 +3.36），法線全部指向內部，正面被背面
  // 剔除掉，看起來就像「機翼沒畫完」。因此未鏡像時要交換後兩個索引；
  // 鏡像會再翻一次手性，所以鏡像版本反而用原順序。
  const positions: number[] = []
  for (const f of faces) {
    const tri = mirrored ? f : [f[0]!, f[2]!, f[1]!]
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
