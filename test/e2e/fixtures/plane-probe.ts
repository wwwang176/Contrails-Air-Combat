import { Color, PerspectiveCamera, Scene, Vector3, WebGLRenderer } from 'three'
import { createLights } from '../../../src/render/lighting'
import { buildAircraft, preloadAircraftModels } from '../../../src/render/geometry/buildAircraft'
import type { AircraftSpec } from '../../../src/specs/types'

/**
 * **單獨一架飛機的量測台**。由 `test/e2e/plane-identical.e2e.ts` 在瀏覽器裡載入。
 *
 * 【它在回答什麼】靜態零件合併之後畫面有沒有動。頂點資料的部分由
 * `test/unit/aircraft-merge.test.ts` 的指紋釘住了（合併前量的世界座標雜湊），
 * 這裡守的是**畫出來的像素** —— 併起來之後同材質的三角形提交次序改變，
 * 共面的地方深度平手誰贏可能翻轉，而那是頂點指紋看不見的。
 *
 * 【為什麼不用 `pixel-identical.e2e.ts`】那一支把飛機關掉了，而且開著也不行：
 * 飛機的出生位置每一場都不同。這裡是固定姿態、固定燈光、單獨一架，兩次
 * 執行本來就該逐 byte 相同。
 */

/** 畫布邊長。飛機在畫面上要夠大，邊緣的差才看得出來 */
const SIZE = 512
/** 背景。飛機是灰綠棕，純藍不會撞色 */
const BG = 0x0000ff

export interface PlaneShot {
  /** 非背景像素的數量 */
  pixels: number
  /**
   * `readPixels` 讀回來的整張 RGBA 的 FNV-1a。**逐 byte 的判準用這個，
   * 不要用截圖。**
   *
   * 【為什麼截圖不算數】`locator.screenshot()` 走的是瀏覽器的合成路徑，
   * 實測同一份程式跑兩次有 0.087% 的像素在跳（最大差 230/255）。
   * `readPixels` 直接讀 GL 的後備緩衝，跳過合成，才是渲染本身的輸出。
   */
  hash: number
}

/**
 * 上一次 `planeShot` 畫出來的畫布，掛在 DOM 上讓 playwright 截圖。
 *
 * 【為什麼要截圖而不是回一個雜湊】雜湊只答得出「一樣還是不一樣」。真正要
 * 知道的是**差多少**：差一個色階的邊緣像素與整片翻掉是兩件事，而合併的
 * 判準是後者不可以發生。
 */
const CANVAS_ID = 'plane-probe'

/**
 * 由 `azimuthDeg` 方位、`pitchDeg` 俯角看一架 `id` 機種，回報像素數與雜湊。
 *
 * `blurred` 切螺旋槳的兩種狀態（模糊圓盤／三片槳葉）—— 合併若誤把槳葉併進
 * 靜態塊，切換就會失效，而那在單一狀態的截圖上看不出來。
 */
export function planeShot(
  id: string, azimuthDeg: number, pitchDeg: number, blurred: boolean,
): PlaneShot {
  document.getElementById(CANVAS_ID)?.remove()
  const canvas = document.createElement('canvas')
  canvas.id = CANVAS_ID
  canvas.width = SIZE
  canvas.height = SIZE
  canvas.style.position = 'fixed'
  canvas.style.left = '0'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  // 【`preserveDrawingBuffer` 非有不可】不設的話瀏覽器在合成之後就丟掉後備
  // 緩衝，playwright 截到的是一片空白
  const renderer = new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(SIZE, SIZE, false)

  const scene = new Scene()
  scene.background = new Color(BG)
  // 【一定要用正式場景那組燈】合併會改變法線所屬的 mesh 分組，若燈光與遊戲
  // 不同，量到的差異就不是玩家會看到的差異
  for (const l of createLights().all) scene.add(l)

  const model = buildAircraft({ id } as unknown as AircraftSpec)
  model.setPropSpin(0.7, blurred)
  scene.add(model.group)

  // 【距離由機身長度導出】不同機種差三倍（P-51D 9.8 m、B-17G 22.7 m），
  // 固定距離會讓小的只有幾十個像素、大的滿出畫面
  const dist = model.metrics.realLength * 2.2
  const a = (azimuthDeg * Math.PI) / 180
  const p = (pitchDeg * Math.PI) / 180
  const target = new Vector3(0, 0, 0)
  const eye = new Vector3(
    Math.sin(a) * Math.cos(p) * dist,
    Math.sin(-p) * dist,
    Math.cos(a) * Math.cos(p) * dist,
  )
  const camera = new PerspectiveCamera(35, 1, 0.1, dist * 4)
  camera.position.copy(eye)
  camera.lookAt(target)
  camera.updateMatrixWorld(true)

  renderer.render(scene, camera)

  const gl = renderer.getContext()
  const buf = new Uint8Array(SIZE * SIZE * 4)
  gl.readPixels(0, 0, SIZE, SIZE, gl.RGBA, gl.UNSIGNED_BYTE, buf)

  let pixels = 0
  let hash = 2166136261 >>> 0
  for (let i = 0; i < buf.length; i++) {
    hash ^= buf[i]!
    hash = Math.imul(hash, 16777619) >>> 0
  }
  for (let o = 0; o < buf.length; o += 4) {
    // 【判準是「藍得不像背景」】背景是純藍
    if (buf[o + 2]! > 200 && buf[o + 1]! < 60 && buf[o]! < 60) continue
    pixels++
  }

  // 【把緩衝留在 window 上】差異出現時要看的是「差在哪」，而截圖走的是
  // 合成路徑、有自己的雜訊。追查用的工具直接讀這一份。
  ;(window as unknown as Record<string, unknown>)['__planeBuf'] = buf

  scene.remove(model.group)
  model.dispose()
  // 【不 dispose renderer】它一 dispose 就釋放 context，畫布跟著變空白，
  // 而 playwright 要在這之後才來截圖
  return { pixels, hash: hash >>> 0 }
}

// GLB 機種的樣板先載好，`__planeShot` 掛上去之後 `buildAircraft` 才是同步的
await preloadAircraftModels()
;(window as unknown as Record<string, unknown>)['__planeShot'] = planeShot
