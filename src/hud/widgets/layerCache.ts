import type { HudLayout } from '../types'

/**
 * 把一塊畫面快取成離屏點陣，**每幀照貼、內容隔幾幀才重畫**。
 *
 * 【為什麼不是「隔幀不畫」】`Hud.render` 每幀清空整張畫布再重畫所有 widget，
 * 所以跳過繪製的結果是那個元件**消失一幀**，畫面會閃。貼圖便宜、重畫才貴，
 * 所以省的是重畫。
 *
 * 【相位要錯開】兩個元件都在同一幀重畫的話，會變成「一幀重、一幀輕」的交替，
 * 那正是驗收標準第 2 條禁止的週期性慢幀。給不同的 `phase` 就攤平了。
 *
 * 【像素對齊照抄 `dials.ts` 的 `drawFace`】離屏原點落在向下取整的裝置像素上、
 * 變換保留小數位移，抗鋸齒因此與直接畫落在同一格。
 *
 * 【dpr 必須與 `Hud.resize` 相同】那裡用的是 `min(devicePixelRatio, 2)`。
 *
 * 【沒有 document 時直接畫】node 的測試用假 ctx 攔繪圖呼叫，那裡沒有離屏畫布，
 * 而且測試要看的是「這一幀畫了什麼」，不該被快取擋住。
 */
export interface LayerCache {
  canvas: HTMLCanvasElement | null
  /** 離屏在畫布上的貼圖位置，裝置像素 */
  x: number
  y: number
  /** 建立時的矩形與比例，任何一項變了就要重建 */
  rx: number
  ry: number
  rw: number
  rh: number
  dpr: number
  scale: number
  /** 自己的呼叫計數，決定哪一幀重畫 */
  frame: number
}

export const newLayerCache = (): LayerCache => ({
  canvas: null, x: 0, y: 0, rx: NaN, ry: NaN, rw: NaN, rh: NaN, dpr: NaN, scale: NaN, frame: -1,
})

/**
 * 正在重畫的離屏層，它的左上角在主畫布上的**裝置像素**位置；不在離屏層裡時是 0。
 *
 * 【誰要看它】任何「把變換設成 identity、再用裝置像素座標貼圖」的程式碼。
 * 那種貼法假設座標原點是主畫布的原點，而離屏層的原點在別的地方 ——
 * 不扣掉這個位移，貼上去的東西會整個偏移到畫面外（`dials.ts` 的 `drawFace`）。
 *
 * 【為什麼是可變的模組狀態而不是參數】要傳的話得穿過 widget 的每一層呼叫，
 * 而只有最底下那一層用得到。整數相減，沒有精度損失。
 */
export const LAYER_ORIGIN = { x: 0, y: 0 }

/**
 * 低頻更新的元件幾幀重畫一次。2 = 一半的更新率。
 *
 * 【不能套在準星、敵機標記、受擊方向上】那幾個是瞄準與生存要用的資訊，
 * 慢一幀就是打偏。這裡只給姿態盤與地圖。
 */
export const LOW_RATE = 2

/**
 * 各元件在哪一幀重畫。**值必須兩兩不同**，否則兩個元件會在同一幀一起重畫，
 * 變成「一重一輕」的交替 —— 那是週期性的慢幀，正是要避免的東西。
 */
export const LOW_RATE_PHASE: Readonly<Record<'dials' | 'minimap', number>> = {
  dials: 0,
  minimap: 1,
}

/** 快取的矩形，CSS 像素。`draw` 仍然用畫面座標畫，離屏的變換會補上位移 */
export interface LayerRect {
  x: number
  y: number
  w: number
  h: number
}

/**
 * @param every 幾幀重畫一次。1 等於不降頻（每幀都重畫）
 * @param phase 在哪一個餘數上重畫。同時降頻的元件要給不同的值
 */
export function drawCachedLayer(
  ctx: CanvasRenderingContext2D, L: HudLayout, cache: LayerCache, rect: LayerRect,
  every: number, phase: number, draw: (c: CanvasRenderingContext2D) => void,
): void {
  if (typeof document === 'undefined') {
    draw(ctx)
    return
  }
  cache.frame++
  const dpr = Math.min(window.devicePixelRatio, 2)
  // 【版面變了一定要重建】視窗縮放、換解析度檔位都會改 rect 或 dpr，
  // 沿用舊的離屏會把整塊貼到錯的位置
  const stale = cache.canvas === null || cache.dpr !== dpr || cache.scale !== L.scale
    || cache.rx !== rect.x || cache.ry !== rect.y || cache.rw !== rect.w || cache.rh !== rect.h
  const due = every <= 1 || cache.frame % every === ((phase % every) + every) % every
  if (stale || due) {
    const x = Math.floor(rect.x * dpr)
    const y = Math.floor(rect.y * dpr)
    const canvas = cache.canvas ?? document.createElement('canvas')
    const w = Math.ceil((rect.x + rect.w) * dpr) - x
    const h = Math.ceil((rect.y + rect.h) * dpr) - y
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w
      canvas.height = h
    }
    const c = canvas.getContext('2d')
    if (!c) {
      draw(ctx)
      return
    }
    // 【要自己清】重畫是疊在上一次的內容上，不清的話半透明的底色會越疊越深
    c.setTransform(1, 0, 0, 1, 0, 0)
    c.clearRect(0, 0, w, h)
    c.setTransform(dpr, 0, 0, dpr, -x, -y)
    // 【原點要先讓出去再收回】巢狀的離屏層（儀表層裡面還有盤面的快取）
    // 各自有自己的位移，收回舊值才不會讓外層接著用到內層的
    const prevX = LAYER_ORIGIN.x
    const prevY = LAYER_ORIGIN.y
    LAYER_ORIGIN.x = x
    LAYER_ORIGIN.y = y
    draw(c)
    LAYER_ORIGIN.x = prevX
    LAYER_ORIGIN.y = prevY
    cache.canvas = canvas
    cache.x = x
    cache.y = y
    cache.dpr = dpr
    cache.scale = L.scale
    cache.rx = rect.x
    cache.ry = rect.y
    cache.rw = rect.w
    cache.rh = rect.h
  }
  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(cache.canvas!, cache.x, cache.y)
  ctx.restore()
}
