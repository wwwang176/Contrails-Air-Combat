import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, ShaderMaterial } from 'three'
import {
  SMOKE_MASK_HEIGHT, SMOKE_MASK_WIDTH,
  type createCameraSmokeMask,
} from './cameraSmokeMask'

type SmokeMask = Pick<ReturnType<typeof createCameraSmokeMask>, 'data' | 'depths'>
const W = SMOKE_MASK_WIDTH, H = SMOKE_MASK_HEIGHT, CELLS = W * H
const MAX_QUADS = CELLS

/**
 * 每個投影格只畫一次混合煙色，不依煙的數量增加幾何或繪製層數。
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

  /** 四角採樣相鄰四格，包含空格；共用邊緣使用相同色彩，避免亮暗方格接縫。 */
  function writeCorner(
    mask: SmokeMask, cornerX: number, cornerY: number,
    near: number, far: number, vertex: number,
  ): void {
    const pos = vertex * 3, field = vertex * 4
    positions[pos] = cornerX / W * 2 - 1
    positions[pos + 1] = cornerY / H * 2 - 1
    let r = 0, g = 0, b = 0, density = 0, depth = far
    for (let oy = -1; oy <= 0; oy++) for (let ox = -1; ox <= 0; ox++) {
      // 邊界夾在畫面內，避免邊緣濃度被畫面外的空白稀釋。
      const x = Math.max(0, Math.min(W - 1, cornerX + ox))
      const y = Math.max(0, Math.min(H - 1, cornerY + oy))
      const cell = y * W + x, at = cell * 4
      const d = mask.data[at + 3]!
      if (d >= 0.00001) depth = Math.min(depth, mask.depths[cell]!)
      r += mask.data[at]!; g += mask.data[at + 1]!; b += mask.data[at + 2]!
      density += d
    }
    depth = Math.max(near, depth)
    positions[pos + 2] = (far + near) / (far - near) - 2 * far * near / ((far - near) * depth)
    fields[field] = r * 0.25; fields[field + 1] = g * 0.25
    fields[field + 2] = b * 0.25; fields[field + 3] = density * 0.25
  }

  return {
    object,
    update(mask: SmokeMask, near: number, far: number): void {
      let quads = 0
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        // 外圍多保留一格空白，讓插值平滑退到零，不在最後一格邊緣切斷。
        let occupied = false
        for (let oy = -1; oy <= 1 && !occupied; oy++) for (let ox = -1; ox <= 1; ox++) {
          const sx = x + ox, sy = y + oy
          if (sx >= 0 && sx < W && sy >= 0 && sy < H && mask.data[(sy * W + sx) * 4 + 3]! > 0.00001) {
            occupied = true; break
          }
        }
        if (!occupied) continue
        const first = quads * 4
        writeCorner(mask, x, y, near, far, first)
        writeCorner(mask, x + 1, y, near, far, first + 1)
        writeCorner(mask, x + 1, y + 1, near, far, first + 2)
        writeCorner(mask, x, y + 1, near, far, first + 3)
        quads++
      }
      geometry.setDrawRange(0, quads * 6)
      object.visible = quads > 0
      if (quads === 0) return
      // 只上傳有效格子及其淡出邊緣。
      positionAttribute.clearUpdateRanges(); fieldAttribute.clearUpdateRanges()
      positionAttribute.addUpdateRange(0, quads * 4 * 3)
      fieldAttribute.addUpdateRange(0, quads * 4 * 4)
      positionAttribute.needsUpdate = fieldAttribute.needsUpdate = true
    },
    reset(): void { object.visible = false; geometry.setDrawRange(0, 0) },
    dispose(): void { geometry.dispose(); material.dispose() },
  }
}
