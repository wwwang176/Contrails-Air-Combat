import {
  Color, Vector3,
  type MeshBasicMaterial, type PerspectiveCamera, type Scene, type Texture,
} from 'three'
import {
  cameraSmokeWeight, tintCameraSmoke, visitCameraSmokeSources, type CameraSmokeSource,
} from './cameraSmokeField'

/** 固定解析度的煙量格；CPU 依附近煙量累積，不依遊戲解析度增加成本。 */
export const SMOKE_MASK_WIDTH = 32
export const SMOKE_MASK_HEIGHT = 18
export const SMOKE_COVERAGE_START = 0.55
export const SMOKE_COVERAGE_END = 0.7
const W = SMOKE_MASK_WIDTH, H = SMOKE_MASK_HEIGHT, CELLS = W * H

function smooth(a: number, b: number, value: number): number {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

export interface SmokeProjection {
  x: number; y: number; rx: number; ry: number; coverage: number
}

/** billboard 在螢幕內的裁切面積；不把螢幕外的部分算成覆蓋率。 */
export function projectSmoke(
  x: number, y: number, depth: number, diameter: number,
  camera: PerspectiveCamera, out: SmokeProjection,
): void {
  const p = camera.projectionMatrix.elements
  const z = Math.max(depth, camera.near)
  out.x = (p[0]! * x / z - p[8]! + 1) * 0.5
  out.y = (p[5]! * y / z - p[9]! + 1) * 0.5
  out.rx = diameter * p[0]! / z * 0.25
  out.ry = diameter * p[5]! / z * 0.25
  out.coverage = depth <= camera.near ? 0
    : Math.max(0, Math.min(1, out.x + out.rx) - Math.max(0, out.x - out.rx))
    * Math.max(0, Math.min(1, out.y + out.ry) - Math.max(0, out.y - out.ry))
}

/** 大片煙提早交接；靠近到煙團內側時，不論視野角度都能完成交接。 */
export function smokeHandoffTarget(distance: number, diameter: number, coverage: number, active = false): number {
  if (diameter <= 0) return 0
  const relative = distance / diameter
  // 進出門檻分開避免邊界反覆切換；時間平滑在 collect 完成。
  // 目標必須能抵達 1，不能停在部分透明卻永遠同時繪製原片與替代網格。
  return relative <= (active ? 0.45 : 0.35)
    || (coverage >= (active ? SMOKE_COVERAGE_START : SMOKE_COVERAGE_END)
      && relative < (active ? 1.4 : 1.1)) ? 1 : 0
}

/** 補回原煙片淡掉的光學厚度，避免原煙片與遮罩在過渡時重複加濃。 */
export function smokeReplacementDensity(alpha: number, handoff: number): number {
  const a = Math.max(0, Math.min(0.99, alpha))
  return Math.log1p(-a * (1 - handoff)) - Math.log1p(-a)
}

/** 貼圖只讀取一次；沿用原煙霧素材的濃淡形狀，不以方框直接遮畫面。 */
function readSmokeAlpha(texture: Texture): Float32Array | null {
  if (typeof document === 'undefined' || !texture.image?.width) return null
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const context = canvas.getContext('2d', { willReadFrequently: true })!
  context.drawImage(texture.image as CanvasImageSource, 0, 0, 64, 64)
  const rgba = context.getImageData(0, 0, 64, 64).data
  const alpha = new Float32Array(64 * 64)
  for (let i = 0; i < alpha.length; i++) alpha[i] = rgba[i * 4 + 1]! / 255
  return alpha
}

interface SmokeCandidate extends SmokeProjection {
  source: CameraSmokeSource | null
  slot: number; weight: number; alpha: number; volume: number; depth: number
  worldX: number; worldY: number; worldZ: number; cos: number; sin: number; mapped: boolean
}

export function createCameraSmokeMask(smokeTexture: Texture) {
  // 同格直接加總光學厚度與加權色彩，不保留各團煙的前後排序。
  // 深度取最近的有效煙，仍讓位於整團煙前方的不透明物體遮住遮罩。
  const data = new Float32Array(CELLS * 4)
  const depths = new Float32Array(CELLS)
  const pendingCells = new Uint16Array(CELLS)
  const pendingDensity = new Float32Array(CELLS)
  // 混合不依賴順序，同一個暫存物件即可逐顆處理，不累積候選清單。
  const candidate: SmokeCandidate = {
    source: null, slot: 0, weight: 0, alpha: 0, volume: 0, depth: 0,
    worldX: 0, worldY: 0, worldZ: 0, cos: 1, sin: 0, mapped: false,
    x: 0, y: 0, rx: 0, ry: 0, coverage: 0,
  }
  let alphaMap = readSmokeAlpha(smokeTexture)
  const centre = new Vector3(), viewCentre = new Vector3(), backward = new Vector3()
  const eye = new Vector3(), tint = new Color()
  const projection: SmokeProjection = { x: 0, y: 0, rx: 0, ry: 0, coverage: 0 }
  const stats = { candidates: 0, culled: 0, maxCoverage: 0, maxDensity: 0 }
  // 包住鏡頭的體積霧另行合成，不能把前方煙片的深度直接搬到近裁切面。
  const volumeColor = new Color(0, 0, 0)
  let volumeDensity = 0
  let view: PerspectiveCamera
  let response = 1

  function alphaAt(u: number, v: number, mapped: boolean): number {
    if (!mapped || !alphaMap) return 1 - smooth(0.25, 0.5, Math.hypot(u - 0.5, v - 0.5))
    // 與 WebGL 的 flipY 及 ClampToEdge 一致，包含每顆粒子的 UV 旋轉。
    const x = Math.max(0, Math.min(63, u * 64 - 0.5))
    const y = Math.max(0, Math.min(63, (1 - v) * 64 - 0.5))
    const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
    const a = alphaMap[iy * 64 + ix]!, b = alphaMap[iy * 64 + Math.min(63, ix + 1)]!
    const c = alphaMap[Math.min(63, iy + 1) * 64 + ix]!
    const d = alphaMap[Math.min(63, iy + 1) * 64 + Math.min(63, ix + 1)]!
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy
  }

  function writeHandoff(source: CameraSmokeSource, slot: number, weight: number): void {
    if (source.handoff.getX(slot) === weight) return
    source.handoff.setX(slot, weight)
    source.handoff.needsUpdate = true
  }

  function collect(source: CameraSmokeSource): void {
    const mesh = source.object, material = mesh.material as MeshBasicMaterial
    const m = mesh.instanceMatrix.array, transform = mesh.matrixWorld.elements
    const scale = Math.hypot(transform[0]!, transform[1]!, transform[2]!)
    const spin = mesh.geometry.getAttribute('aSpin')
    for (let j = 0; j < source.count; j++) {
      const slot = source.slots[j]!, offset = slot * 16
      // 粒子池矩陣只含平移與正向等比縮放，貼圖旋轉另存 aSpin。
      const diameter = m[offset]! * scale
      const previous = source.handoff.getX(slot)
      const alpha = Math.max(0, Math.min(0.99, source.alpha.getX(slot) * material.opacity))
      if (diameter <= 0 || alpha <= 0) { writeHandoff(source, slot, 0); continue }
      centre.set(m[offset + 12]!, m[offset + 13]!, m[offset + 14]!).applyMatrix4(mesh.matrixWorld)
      const distanceSquared = centre.distanceToSquared(eye)
      // 遠煙不需要投影、開根號或採樣遮罩；仍在淡出的舊候選例外。
      if (previous === 0 && distanceSquared >= (diameter * 1.4) ** 2) continue
      viewCentre.copy(centre).applyMatrix4(view.matrixWorldInverse)
      const distance = Math.sqrt(distanceSquared), depth = -viewCentre.z
      projectSmoke(viewCentre.x, viewCentre.y, depth, diameter, view, projection)
      const inside = cameraSmokeWeight(distance, diameter)
      const target = projection.coverage > 0 || inside > 0
        ? smokeHandoffTarget(distance, diameter, projection.coverage, previous > 0) : 0
      let weight = previous + (target - previous) * response
      if (Math.abs(weight - target) < 0.002) weight = target
      if (weight <= 0 || diameter <= 0 || alpha <= 0) {
        writeHandoff(source, slot, 0)
        continue
      }
      candidate.source = source; candidate.slot = slot
      candidate.weight = Math.fround(weight); candidate.alpha = alpha
      candidate.volume = inside; candidate.depth = depth
      candidate.worldX = centre.x; candidate.worldY = centre.y; candidate.worldZ = centre.z
      const angle = spin?.getX(slot) ?? 0
      candidate.cos = Math.cos(angle); candidate.sin = Math.sin(angle)
      candidate.mapped = !!material.alphaMap
      candidate.x = projection.x; candidate.y = projection.y
      candidate.rx = projection.rx; candidate.ry = projection.ry; candidate.coverage = projection.coverage
      accumulate(candidate)
      candidate.source = null
    }
  }

  function accumulate(candidate: SmokeCandidate): void {
    const source = candidate.source!, mesh = source.object
    const { slot, weight, alpha, volume, depth, cos: c, sin: s } = candidate
    const surrounding = smokeReplacementDensity(alpha * volume * 0.75, weight)
    let pending = 0
    // 先採樣整顆煙；確定有可見替代內容才淡出原煙片。
    if (volume < 1 && depth > view.near) {
      const x0 = Math.max(0, Math.floor((candidate.x - candidate.rx) * W))
      const x1 = Math.min(W, Math.ceil((candidate.x + candidate.rx) * W))
      const y0 = Math.max(0, Math.floor((candidate.y - candidate.ry) * H))
      const y1 = Math.min(H, Math.ceil((candidate.y + candidate.ry) * H))
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const u = ((x + 0.5) / W - candidate.x) / (2 * candidate.rx)
        const v = ((y + 0.5) / H - candidate.y) / (2 * candidate.ry)
        const projected = Math.abs(u) <= 0.5 && Math.abs(v) <= 0.5
          ? alphaAt(c * u - s * v + 0.5, s * u + c * v + 0.5, candidate.mapped) : 0
        const shape = projected * (1 - volume) + volume * 0.75
        const density = smokeReplacementDensity(alpha * shape, weight) - surrounding
        if (density <= 0.00001) continue
        const cell = y * W + x
        pendingCells[pending] = cell
        pendingDensity[pending++] = density
      }
    }
    // 太淡或太小而無法寫入任何格子的煙，仍保留原片，避免剔除後沒有替代畫面。
    if (pending === 0 && surrounding <= 0.00001) {
      writeHandoff(source, slot, 0)
      return
    }
    writeHandoff(source, slot, weight)
    stats.candidates++
    if (weight === 1) stats.culled++
    stats.maxCoverage = Math.max(stats.maxCoverage, candidate.coverage)
    mesh.getColorAt(slot, tint)
    tint.multiply((mesh.material as MeshBasicMaterial).color)
    centre.set(candidate.worldX, candidate.worldY, candidate.worldZ)
    tintCameraSmoke(mesh, tint, centre, backward)
    volumeDensity += surrounding
    volumeColor.r += tint.r * surrounding
    volumeColor.g += tint.g * surrounding
    volumeColor.b += tint.b * surrounding
    for (let i = 0; i < pending; i++) {
      const cell = pendingCells[i]!, density = pendingDensity[i]!
      const index = cell * 4
      depths[cell] = Math.min(depths[cell]!, depth)
      data[index] = data[index]! + tint.r * density
      data[index + 1] = data[index + 1]! + tint.g * density
      data[index + 2] = data[index + 2]! + tint.b * density
      data[index + 3] = data[index + 3]! + density
    }
  }

  return {
    data, depths, stats, volumeColor,
    get volumeDensity() { return volumeDensity },
    update(scene: Scene, camera: PerspectiveCamera, blend: number): void {
      view = camera; response = blend
      // 遊戲先建立 Texture 再非同步載入圖片；首次可用時再讀取，不能永久退成圓形。
      if (!alphaMap && smokeTexture.image?.width) alphaMap = readSmokeAlpha(smokeTexture)
      camera.getWorldPosition(eye)
      backward.setFromMatrixColumn(camera.matrixWorld, 2).normalize()
      data.fill(0); depths.fill(camera.far)
      volumeColor.setRGB(0, 0, 0); volumeDensity = 0
      stats.candidates = stats.culled = stats.maxCoverage = stats.maxDensity = 0
      visitCameraSmokeSources(scene, collect)
      for (let cell = 0; cell < CELLS; cell++) {
        stats.maxDensity = Math.max(stats.maxDensity, volumeDensity + data[cell * 4 + 3]!)
      }
    },
    reset(): void { stats.maxDensity = 0; volumeDensity = 0 },
    dispose(): void { candidate.source = null },
  }
}
