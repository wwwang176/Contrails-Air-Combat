import { BufferGeometry, LatheGeometry, Vector2 } from 'three'


/**
 * 水柱的滿高，m。
 *
 * 【推導】1920 px、65° 視野下每像素 5.9e-4 rad（見 `tracers.ts`）。
 * 彈丸壽命 1.2 s × 最快初速 887 m/s = 最多飛 1,064 m，所以射手離水柱恆在
 * 1 km 之內；12 m 的柱子在 1 km 上是 20 px —— 一定讀得到。**因此不需要
 * 距離剔除**（M7 spec §7.2）。
 */
export const SPLASH_HEIGHT = 12

/**
 * 水柱底部的半徑，m。
 *
 * 【為什麼這麼粗】4 m 高配 0.25 m 半徑是 8:1 的細針，讀起來「太小」——
 * 與槍焰同一個成因：**細長的東西在畫面上讀起來是一條線，不是一個東西**。
 * 12 m × 0.8 m 是 7.5:1，而且上方收緊，讀起來是一柱噴起來的水而不是一根
 * 白棍。
 */
export const SPLASH_RADIUS = 0.8

/**
 * 肩部（圓頭開始的地方）相對底部的半徑比。
 *
 * 【它是肩部半徑不是頂端半徑】上方收到 0.2 倍的截頭錐讀起來是一根收尖的
 * 柱子。水柱是**子彈型 —— 上方圓潤**：柱身微收到肩部，再由肩部圓弧收到
 * 頂點。見 `bulletProfile`。
 */
export const SPLASH_TOP_RATIO = 0.8

/**
 * 圓頭從幾成高度開始。以下是柱身，以上是圓弧。
 *
 * 0.72：圓頭佔上面 28%，讀得出「圓」又不會變成一顆球。
 */
export const SPLASH_SHOULDER = 0.72

/** 圓頭的分段數。7 段在 12 m 的柱子上已經看不出稜角。 */
const NOSE_SEGMENTS = 7

const RADIAL_SEGMENTS = 8

/**
 * 子彈型的旋轉剖面：柱身微收到肩部，再由肩部以四分之一橢圓收到頂點。
 *
 * 【為什麼是 `LatheGeometry` 而不是圓柱】圓柱只能做出「收尖」或「平頂」，
 * 兩者都不是水柱的樣子。**上方圓潤的子彈型**需要一段曲線，而旋轉剖面是
 * 描述它最直接的方式。
 *
 * **以底面為原點**：以中心為原點的話，縮放 Y 會讓柱子從中間往兩邊長，
 * 下半截埋進水裡。
 *
 * 【為什麼剖面點另外抽成 `bulletPoints`】`LatheGeometry` **只在剖面點上
 * 產生頂點** —— 柱身那一整段中間一個頂點也沒有。想從網格頂點反推形狀就會
 * 踩到空箱子（實作時真的踩到了）。剖面才是這個形狀的定義，測它才對。
 */
export function bulletPoints(): Vector2[] {
  const shoulderY = SPLASH_HEIGHT * SPLASH_SHOULDER
  const shoulderR = SPLASH_RADIUS * SPLASH_TOP_RATIO
  const noseH = SPLASH_HEIGHT - shoulderY

  const points: Vector2[] = [
    new Vector2(SPLASH_RADIUS, 0),
    new Vector2(shoulderR, shoulderY),
  ]
  // 四分之一橢圓：t 從 0（肩部）到 1（頂點）
  for (let i = 1; i <= NOSE_SEGMENTS; i++) {
    const t = (i / NOSE_SEGMENTS) * (Math.PI / 2)
    points.push(new Vector2(shoulderR * Math.cos(t), shoulderY + noseH * Math.sin(t)))
  }
  return points
}

export function bulletProfile(): BufferGeometry {
  return new LatheGeometry(bulletPoints(), RADIAL_SEGMENTS)
}
