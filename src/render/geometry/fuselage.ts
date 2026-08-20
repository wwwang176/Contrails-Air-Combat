import { BufferAttribute, BufferGeometry } from 'three'

export interface FuselageSection {
  /** 沿機體 Z 軸的位置，負值為機首方向 */
  z: number
  halfWidth: number
  halfHeight: number
  /** 截面中心的垂直偏移 */
  centerY: number
  /**
   * 覆寫該站位的超橢圓指數。真機的剖面形狀沿機身是變的——Bf 109 的發動機
   * 罩接近圓形，尾段卻是明顯的平板側身；用單一指數只能二選一。
   */
  roundness?: number
}

/**
 * 以**超橢圓**截面沿軸線 lofting 產生機身（或任何管狀部件：座艙罩、散熱器
 * 導管）。
 *
 * 【為什麼是超橢圓而不是橢圓】真實機身的剖面不是橢圓。P-51D 的機身接近
 * 橢圓但側面略平；Bf 109 是出了名的窄而**平板側身**——照片裡從正面看幾乎
 * 是個帶圓角的長方形；座艙罩則是圓角矩形。用一個指數 n 就能涵蓋整個範圍：
 *
 *     |x/a|^n + |y/b|^n = 1
 *
 * n=2 是橢圓，n 越大越接近矩形。低多邊形下這個差異很明顯：同樣 10 個徑向
 * 分段，n=2 的機身像根管子，n=2.8 才看得出 109 的稜線。
 */
export function buildFuselage(
  sections: readonly FuselageSection[],
  radialSegments = 8,
  roundness = 2,
  /**
   * 首尾要不要封口。省略即兩端都封（原本的行為）。
   *
   * 【誰需要不封】**碗**。進氣口裡的暗色凹槽是一個朝前開口的管子 —— 封了
   * 前端就變成一片平板塞子，看到的是塞子的正面而不是凹槽的內壁。與
   * `buildHull` 的 `caps` 是同一個參數、同一個理由。
   */
  caps?: { front?: boolean; back?: boolean },
  /**
   * 只吐截面上這一段角度的面（度，0 = 右側水平、90 = 正上方、逆時針）。
   * 省略即整圈。**給了角度就不封口** —— 開口的殼沒有「端面」可言。
   *
   * 【誰需要】**往上凹的碗**。任何閉合凸截面的下半面，從底下看都是往下凸的
   * ——「中間高、兩邊低」的面只可能是上半面的**內側**，而那需要一個沒有
   * 下半面的殼。機腹吊艙的暗色拱頂就是這樣做的（`he111.ts` 的 `BOLA_VAULT`）。
   *
   * 材質要用雙面的：從凹面那一側看到的是它的背面。
   */
  arc?: { fromDeg: number; toDeg: number },
): BufferGeometry {
  const rings: number[][] = sections.map((s) => {
    // 超橢圓的參數式：x = a·sgn(cos t)·|cos t|^(2/n)，y 同理。
    const e = 2 / (s.roundness ?? roundness)
    const shape = (v: number) => Math.sign(v) * Math.abs(v) ** e
    const ring: number[] = []
    for (let i = 0; i < radialSegments; i++) {
      const t = (i / radialSegments) * Math.PI * 2
      ring.push(
        shape(Math.cos(t)) * s.halfWidth,
        s.centerY + shape(Math.sin(t)) * s.halfHeight,
        s.z,
      )
    }
    return ring
  })

  const positions: number[] = []
  const pushTri = (a: number[], b: number[], c: number[]) => {
    positions.push(a[0]!, a[1]!, a[2]!, b[0]!, b[1]!, b[2]!, c[0]!, c[1]!, c[2]!)
  }
  const vertexOf = (ring: number[], i: number) => {
    const k = (i % radialSegments) * 3
    return [ring[k]!, ring[k + 1]!, ring[k + 2]!]
  }

  /** 角度範圍換成頂點索引；沒給就是整圈（0 … radialSegments−1，會繞回去） */
  const first = arc ? Math.ceil((arc.fromDeg / 360) * radialSegments) : 0
  const last = arc ? Math.floor((arc.toDeg / 360) * radialSegments) : radialSegments

  for (let s = 0; s < rings.length - 1; s++) {
    const a = rings[s]!
    const b = rings[s + 1]!
    for (let i = first; i < last; i++) {
      const a0 = vertexOf(a, i)
      const a1 = vertexOf(a, i + 1)
      const b0 = vertexOf(b, i)
      const b1 = vertexOf(b, i + 1)
      // 【纏繞方向修正】原順序讓法線指向機身內部（實測帶符號體積
      // P-51D −8.01、Bf 109 −5.66）。截面環沿 +角度方向前進、剖面沿 +Z
      // 推進，兩者的外積指向內側，必須交換後兩個頂點。
      pushTri(a0, b1, b0)
      pushTri(a0, a1, b1)
    }
  }

  // 首尾封口
  const cap = (ring: number[], sec: FuselageSection, reverse: boolean) => {
    const centre = [0, sec.centerY, sec.z]
    for (let i = 0; i < radialSegments; i++) {
      const v0 = vertexOf(ring, i)
      const v1 = vertexOf(ring, i + 1)
      /**
       * 【兩個分支原本是反的 —— 2026-08-20】環是由 +Z 看**逆時針**繞的，
       * 所以 (中心, v0, v1) 的法線朝 +Z。機首端要朝 −Z、機尾端要朝 +Z，
       * 因此機首端該用 (中心, v1, v0) 才對，原本剛好寫顛倒。
       *
       * 【為什麼一直沒被看到】封口幾乎都埋在別的零件裡（發動機艙的尾端在
       * 機翼裡、進氣罩的首端在整流罩裡）。這次尾砲塔的罩子把封口露了出來，
       * 而且它坐在 z ≈ 15 ——  的帶符號體積是對原點取的，
       * 封口的貢獻與 z 成正比，在那裡放大了 15 倍才紅。近原點的零件即使
       * 反了也只差一點點，護欄看不出來。
       */
      if (reverse) pushTri(centre, v1, v0)
      else pushTri(centre, v0, v1)
    }
  }
  if (!arc && caps?.front !== false) cap(rings[0]!, sections[0]!, true)
  if (!arc && caps?.back !== false) {
    cap(rings[rings.length - 1]!, sections[sections.length - 1]!, false)
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
