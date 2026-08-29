import {
  AmbientLight, Color, DirectionalLight, PerspectiveCamera, Scene, Vector3,
  WebGLRenderer,
} from 'three'
import { createVegetation, CARD_NEAR } from '../../../src/render/vegetation'
import { pushFlora, FloraKind, type FloraSource } from '../../../src/render/flora'

/**
 * **公告板朝向的量測台**。由 `test/e2e/flora-card.e2e.ts` 在瀏覽器裡載入。
 *
 * 【為什麼要走真的引擎】朝向是頂點著色器算的，headless 的單元測試碰不到
 * GPU；而 `glsl-compile.e2e.ts` 只編譯不執行 —— world/local 座標空間混用、
 * 朝向寫死、hook 掛錯材質，三種都編得過。
 *
 * 判準是**畫出來的像素**：同一株樹由三個等距方位看，寬度必須一樣；
 * 俯角 −60° 時它必須仍然站著（高比寬大）。
 */

/** 原點那一格放一棵闊葉樹，其餘什麼都不生 */
const ONE_TREE: FloraSource = (x0, z0, x1, z1, _heightAt, out) => {
  if (x0 > 0 || x1 <= 0 || z0 > 0 || z1 <= 0) return
  pushFlora(out, 0, 0, 0, 0, 1, 0.5, FloraKind.BroadTree)
}

export interface Shot {
  /** 非背景像素的數量 */
  pixels: number
  /** 非背景像素的包圍盒，像素 */
  width: number
  height: number
}

const SIZE = 512
const BG = 0x0000ff

/**
 * 由 `azimuthDeg` 方位、`pitchDeg` 俯角、`dist` 距離看那一棵樹，回報它在
 * 畫面上佔的像素。
 *
 * 【距離一定要在公告板的區間】否則量到的是樹冠，測試會變成空操作。
 */
export function cardShot(azimuthDeg: number, pitchDeg: number, dist: number): Shot {
  if (dist <= CARD_NEAR) throw new Error(`dist ${dist} 不在公告板的區間`)
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const renderer = new WebGLRenderer({ canvas, antialias: false })
  renderer.setPixelRatio(1)
  renderer.setSize(SIZE, SIZE, false)

  const scene = new Scene()
  scene.background = new Color(BG)
  // 【光要夠平均】亮度不是這一條在測的東西，量的是輪廓
  scene.add(new AmbientLight(0xffffff, 1.2))
  const sun = new DirectionalLight(0xffffff, 1.0)
  sun.position.set(0.4, 1, 0.3)
  scene.add(sun)

  const flora = createVegetation([ONE_TREE], () => 0)
  scene.add(flora.object)

  const a = (azimuthDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  // 樹高 15 m，瞄準它的腰
  const target = new Vector3(0, 7.5, 0)
  const eye = new Vector3(
    Math.sin(a) * Math.cos(p) * dist,
    target.y + Math.sin(-p) * dist,
    Math.cos(a) * Math.cos(p) * dist,
  )
  const camera = new PerspectiveCamera(1.2, 1, 1, dist * 4)
  camera.position.copy(eye)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)

  flora.update(eye.x, eye.z)
  flora.settle()
  renderer.render(scene, camera)

  const gl = renderer.getContext()
  const buf = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf)

  let pixels = 0
  let minX = SIZE
  let maxX = -1
  let minY = SIZE
  let maxY = -1
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 4
      // 【判準是「藍得不像背景」】背景是純藍，樹是綠的
      if (buf[o + 2]! > 200 && buf[o + 1]! < 60) continue
      pixels++
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  flora.dispose()
  renderer.dispose()
  return {
    pixels,
    width: maxX < 0 ? 0 : maxX - minX + 1,
    height: maxY < 0 ? 0 : maxY - minY + 1,
  }
}

;(window as unknown as Record<string, unknown>)['__cardShot'] = cardShot
