/** 共用的去背金屬外框；中央與外側保持透明，不蓋住戰場。 */
const bezel = typeof Image === 'undefined' ? null : new Image()
if (bezel) bezel.src = '/ui/instruments/wwii-bezel-thin.png'

export function drawInstrumentBezel(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number,
): void {
  if (bezel?.complete && bezel.naturalWidth > 0) {
    // 薄框素材外緣約有 0.6% 留白。
    const inset = bezel.naturalWidth * .006
    const side = bezel.naturalWidth - inset * 2
    ctx.drawImage(bezel, inset, inset, side, side, cx - r, cy - r, r * 2, r * 2)
  } else {
    // 素材尚未載入或失敗時仍保留儀表輪廓。
    ctx.strokeStyle = '#b7aa8a'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.stroke()
  }
}
