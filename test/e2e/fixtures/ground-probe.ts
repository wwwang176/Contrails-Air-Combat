import { Color, Mesh, MeshStandardMaterial, PerspectiveCamera, PlaneGeometry, Scene, Vector3, WebGLRenderer } from 'three'
import { createLights } from '../../../src/render/lighting'
import { GROUND_ROUGH, GROUND_SPECULAR, matteGround } from '../../../src/render/matteGround'

/**
 * **地面光照的量測台**。由 `test/e2e/ground-matte.e2e.ts` 在瀏覽器裡載入。
 *
 * 一片水平的大地面（地面同一個顏色、同一個粗糙度），正午的三盞燈，由 `azimuthDeg`
 * 方位、`pitchDeg` 俯角看過去，回報畫面中央一塊的平均線性亮度。`matte` 為假時用沒改過的
 * 標準材質 —— 對照組。
 */

const SIZE = 256
const lin = (c: number): number => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
let renderer: WebGLRenderer | null = null

export function groundShot(
  azimuthDeg: number, pitchDeg: number, matte: boolean, rough: number, specular: number,
): number {
  if (renderer === null) {
    const canvas = document.createElement('canvas')
    canvas.width = SIZE
    canvas.height = SIZE
    renderer = new WebGLRenderer({ canvas, antialias: false })
    renderer.setPixelRatio(1)
    renderer.setSize(SIZE, SIZE, false)
  }
  const scene = new Scene()
  scene.background = new Color(0x000000)
  for (const l of createLights().all) scene.add(l)
  const material = new MeshStandardMaterial({ color: 0x55703f, flatShading: true, roughness: 0.95 })
  if (matte) matteGround(material)
  GROUND_ROUGH.value = rough
  GROUND_SPECULAR.value = specular
  const geo = new PlaneGeometry(200000, 200000).rotateX(-Math.PI / 2)
  scene.add(new Mesh(geo, material))
  const a = (azimuthDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  const dist = 3000
  const eye = new Vector3(Math.sin(a) * Math.cos(p) * dist, Math.sin(-p) * dist, Math.cos(a) * Math.cos(p) * dist)
  const camera = new PerspectiveCamera(10, 1, 1, 50000)
  camera.position.copy(eye)
  camera.lookAt(0, 0, 0)
  renderer.render(scene, camera)
  const gl = renderer.getContext()
  const buf = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf)
  let s = 0
  let n = 0
  // 中央 1/4：整塊都是地面
  for (let y = SIZE * 3 / 8; y < SIZE * 5 / 8; y++) {
    for (let x = SIZE * 3 / 8; x < SIZE * 5 / 8; x++) {
      const o = (y * SIZE + x) * 4
      s += 0.2126 * lin(buf[o]!) + 0.7152 * lin(buf[o + 1]!) + 0.0722 * lin(buf[o + 2]!)
      n++
    }
  }
  geo.dispose()
  material.dispose()
  return s / n
}

;(window as unknown as Record<string, unknown>)['__groundShot'] = groundShot
