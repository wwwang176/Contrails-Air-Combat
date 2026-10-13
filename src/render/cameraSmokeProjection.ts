import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, ShaderMaterial } from 'three'
import {
  SMOKE_MASK_HEIGHT, SMOKE_MASK_LAYERS, SMOKE_MASK_WIDTH,
  type createCameraSmokeMask,
} from './cameraSmokeMask'

type SmokeMask = Pick<ReturnType<typeof createCameraSmokeMask>, 'data' | 'depths' | 'layers' | 'layerDensities'>
const W = SMOKE_MASK_WIDTH, H = SMOKE_MASK_HEIGHT, CELLS = W * H
const MAX_QUADS = CELLS * SMOKE_MASK_LAYERS

/**
 * 把投影煙格改成帶深度的小平面，一次繪製四層。
 * 深度由頂點輸出，片段不再讀取遮罩貼圖或寫 gl_FragDepth，保留硬體的提前深度剔除。
 */
export function createCameraSmokeProjection() {
  const positions = new Float32Array(MAX_QUADS * 4 * 3)
  const fields = new Float32Array(MAX_QUADS * 4 * 4)
  const indices = new Uint16Array(MAX_QUADS * 6)
  for (let quad = 0; quad < MAX_QUADS; quad++) {
    const vertex = quad * 4, at = quad * 6
    indices[at] = vertex; indices[at + 1] = vertex + 1; indices[at + 2] = vertex + 2
    indices[at + 3] = vertex; indices[at + 4] = vertex + 2; indices[at + 5] = vertex + 3
  }
  const positionAttribute = new BufferAttribute(positions, 3).setUsage(DynamicDrawUsage)
  const fieldAttribute = new BufferAttribute(fields, 4).setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', positionAttribute)
  geometry.setAttribute('aSmokeField', fieldAttribute)
  geometry.setIndex(new BufferAttribute(indices, 1))
  geometry.setDrawRange(0, 0)
  const material = new ShaderMaterial({
    transparent: true, depthWrite: false, depthTest: true,
    vertexShader: `
      attribute vec4 aSmokeField;
      varying vec4 vSmokeField;
      void main() {
        vSmokeField = aSmokeField;
        gl_Position = vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec4 vSmokeField;
      void main() {
        float density = max(vSmokeField.a, 0.0);
        float alpha = 1.0 - exp(-density);
        gl_FragColor = vec4(vSmokeField.rgb / max(density, 0.00001), alpha);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  })
  const object = new Mesh(geometry, material)
  object.name = 'cameraSmoke.projected'
  object.frustumCulled = false
  object.visible = false

  /** 四角採樣同層相鄰四格；空格參與淡出，其他深度的非空格排除後重新正規化。 */
  function writeCorner(
    mask: SmokeMask, layerStart: number, cornerX: number, cornerY: number,
    depth: number, ndcDepth: number, vertex: number,
  ): void {
    const pos = vertex * 3, field = vertex * 4
    positions[pos] = cornerX / W * 2 - 1
    positions[pos + 1] = cornerY / H * 2 - 1
    positions[pos + 2] = ndcDepth
    let r = 0, g = 0, b = 0, density = 0, accepted = 0
    const tolerance = Math.max(0.0001, depth * 0.000001)
    for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) {
      // 在單層內夾住邊界，不會取到上一層或下一層的格子。
      const x = Math.max(0, Math.min(W - 1, cornerX + ox))
      const y = Math.max(0, Math.min(H - 1, cornerY + oy))
      const cell = layerStart + y * W + x, at = cell * 4
      const d = mask.data[at + 3]!
      if (d >= 0.00001 && Math.abs(mask.depths[cell]! - depth) > tolerance) continue
      r += mask.data[at]!; g += mask.data[at + 1]!; b += mask.data[at + 2]!
      density += d; accepted++
    }
    const inverse = accepted > 0 ? 1 / accepted : 0
    fields[field] = r * inverse; fields[field + 1] = g * inverse
    fields[field + 2] = b * inverse; fields[field + 3] = density * inverse
  }

  return {
    object,
    update(mask: SmokeMask, near: number, far: number): void {
      let quads = 0
      // 同一次繪製中的三角形順序由遠到近，保留半透明混色順序。
      for (let layer = mask.layers - 1; layer >= 0; layer--) {
        if (mask.layerDensities[layer]! <= 0.00001) continue
        const layerStart = layer * CELLS
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const cell = layerStart + y * W + x
          if (mask.data[cell * 4 + 3]! <= 0.00001) continue
          const depth = Math.max(near, mask.depths[cell]!)
          const ndcDepth = (far + near) / (far - near) - 2 * far * near / ((far - near) * depth)
          const first = quads * 4
          writeCorner(mask, layerStart, x, y, depth, ndcDepth, first)
          writeCorner(mask, layerStart, x + 1, y, depth, ndcDepth, first + 1)
          writeCorner(mask, layerStart, x + 1, y + 1, depth, ndcDepth, first + 2)
          writeCorner(mask, layerStart, x, y + 1, depth, ndcDepth, first + 3)
          quads++
        }
      }
      geometry.setDrawRange(0, quads * 6)
      object.visible = quads > 0
      if (quads === 0) return
      // 只上傳有效格子的連續前段；不用每幀傳送整個四層容量。
      positionAttribute.clearUpdateRanges(); fieldAttribute.clearUpdateRanges()
      positionAttribute.addUpdateRange(0, quads * 4 * 3)
      fieldAttribute.addUpdateRange(0, quads * 4 * 4)
      positionAttribute.needsUpdate = fieldAttribute.needsUpdate = true
    },
    reset(): void { object.visible = false; geometry.setDrawRange(0, 0) },
    dispose(): void { geometry.dispose(); material.dispose() },
  }
}
