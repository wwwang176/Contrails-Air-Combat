import { CanvasTexture, RepeatWrapping } from 'three'

/**
 * 泡沫紋理：白色，alpha 是泡沫的濃淡。正方形、**四邊都接得起來**，橫向與縱向同一個
 * 比例（`WakeStyle.foamTile` 公尺一張）。兩邊的軟邊不在圖上，由著色器照離中線多遠
 * 算。**只在瀏覽器裡跑。**
 *
 * 【為什麼要紋理】沒有紋理的帶子是一條濃淡均勻、邊緣很硬的平帶，看起來像一條路。
 */
export function shipFoamTexture(): CanvasTexture {
  // 【一張蓋 40 m、不是 20 m】近看時一眼認得出每 20 m 重複一次；泡沫團的公尺大小不變，
  // 圖放大、泡沫團數量照面積加倍
  const W = 256, H = 256
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  // 一團團軟邊的泡沫：大小、濃淡隨機，沿航向略拉長；上下左右各畫一份，四邊接得起來
  const blob = (x: number, y: number, r: number, a: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `rgba(255,255,255,${a.toFixed(3)})`)
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.beginPath()
    g.ellipse(x, y, r * 0.8, r * 1.4, 0, 0, Math.PI * 2)
    g.fill()
  }
  for (let i = 0; i < 2080; i++) {
    const x = Math.random() * W
    const y = Math.random() * H
    const r = 2 + Math.random() * Math.random() * 10
    const a = 0.2 + Math.random() * 0.55
    // 只有碰到邊的才補畫另一邊那一份（橢圓長軸 1.4 r）
    const e = r * 1.4
    const oxs = x < e ? [0, W] : x > W - e ? [0, -W] : [0]
    const oys = y < e ? [0, H] : y > H - e ? [0, -H] : [0]
    for (const ox of oxs) for (const oy of oys) blob(x + ox, y + oy, r, a)
  }
  const t = new CanvasTexture(c)
  t.wrapS = RepeatWrapping
  t.wrapT = RepeatWrapping
  return t
}
