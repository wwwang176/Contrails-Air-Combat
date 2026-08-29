import { Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { createLights } from '../../../src/render/lighting'
import { createVegetation } from '../../../src/render/vegetation'
import { pushFlora, FloraKind, type FloraSource } from '../../../src/render/flora'

/**
 * **遠處那三個點池的量測台**。由 `test/e2e/flora-card.e2e.ts` 在瀏覽器裡載入。
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
  /** 非背景像素的平均 RGB，0～255。跨門檻的亮度比對用 */
  r: number
  g: number
  b: number
}

const SIZE = 512
const BG = 0x0000ff
/**
 * 量測用的視角，度。
 *
 * 【為什麼不是遊戲的 60°】3 km 外一株樹在 60° 下只有 2 px，量不出東西。
 * 10° 把它放大到十幾像素 —— 而點的大小是**跟著 `projectionMatrix[1][1]`
 * 走的**，所以換視角不會讓公式失準，正好是這一條要驗的事。
 */
export const PROBE_FOV_DEG = 10

/**
 * 由 `azimuthDeg` 方位、`pitchDeg` 俯角、`dist` 距離看那一棵樹，回報它在
 * 畫面上佔的像素與平均顏色。
 *
 * 【距離可以跨門檻】`POINT_NEAR` 之內量到的是中級樹冠（被照亮的網格），
 * 之外量到的是點。兩者的平均亮度必須接得上 —— 那是 `POINT_LIGHT` 的來源。
 */
export function cardShot(
  azimuthDeg: number, pitchDeg: number, dist: number, dpr: number = 1,
): Shot {
  const canvas = document.createElement('canvas')
  canvas.width = SIZE
  canvas.height = SIZE
  const renderer = new WebGLRenderer({ canvas, antialias: false })
  // 【DPR 要能調】點的大小裡有一個 `size` uniform，而 three 把 DPR 乘在
  // 它上面。固定 DPR = 1 的話那個因子恆為 1，拿掉它的變異驗不出來
  renderer.setPixelRatio(dpr)
  renderer.setSize(SIZE, SIZE, false)
  // three 的 setSize 會把 canvas 的像素數設成 CSS 尺寸 × DPR
  const W = canvas.width

  const scene = new Scene()
  scene.background = new Color(BG)
  // 【一定要用正式場景那組燈】點吃不到光照，亮度是烘進頂點色的，而
  // `POINT_LIGHT` 是拿「被照亮的中級樹冠」校出來的 —— fixture 自己另配一組
  // 燈的話，校出來的係數在遊戲裡就是錯的
  for (const l of createLights()) scene.add(l)

  // 【半徑寫死成 20 km】預設是 6 km，而外圈還會逐格往內抖 —— 量測用的距離
  // 不該撞到那條邊界，否則量到的是「這一格剛好被抖掉了」
  const flora = createVegetation([ONE_TREE], () => 0, { radius: 20000 })
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
  const camera = new PerspectiveCamera(PROBE_FOV_DEG, 1, 1, dist * 4)
  camera.position.copy(eye)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)

  flora.update(eye.x, eye.z)
  flora.settle()
  renderer.render(scene, camera)

  const gl = renderer.getContext()
  const buf = new Uint8Array(W * W * 4)
  gl.readPixels(0, 0, W, W, gl.RGBA, gl.UNSIGNED_BYTE, buf)

  let pixels = 0
  let minX = W
  let maxX = -1
  let minY = W
  let maxY = -1
  let sr = 0
  let sg = 0
  let sb = 0
  for (let y = 0; y < W; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4
      // 【判準是「藍得不像背景」】背景是純藍，樹是綠的
      if (buf[o + 2]! > 200 && buf[o + 1]! < 60) continue
      pixels++
      sr += buf[o]!
      sg += buf[o + 1]!
      sb += buf[o + 2]!
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
  }

  flora.dispose()
  renderer.dispose()
  const n = Math.max(1, pixels)
  return {
    pixels,
    width: maxX < 0 ? 0 : maxX - minX + 1,
    height: maxY < 0 ? 0 : maxY - minY + 1,
    r: sr / n,
    g: sg / n,
    b: sb / n,
  }
}

;(window as unknown as Record<string, unknown>)['__cardShot'] = cardShot
