import { BufferAttribute, BufferGeometry } from 'three'
import type { FuselageSection } from './fuselage'

/**
 * 座艙玻璃的一個縱向站位——就是側視圖上那個 z 位置的上下兩條線。
 *
 * 【為什麼是絕對高度而不是「比機背高多少」】第一版用相對量，結果風擋做不
 * 出來：風擋底框比機背**低**，相對量變成負的，整個截面環跟著縮小，玻璃在
 * 該站位反而比機身窄、整片埋進機身裡不見了。改成絕對高度後，roof 低於機背
 * 時是把輪廓**切平**，這才是「機背上開了一個洞、玻璃只蓋住洞的上緣」的
 * 正確描述。兩個值都直接量自側視圖，不必先知道機背在哪。
 */
export interface GlazingStation {
  z: number
  /** 窗框下緣（艙緣）高度 */
  sill: number
  /** 玻璃頂緣高度。高於機背則玻璃凸出機背，低於機背則水平切平。 */
  roof: number
}

export interface GlazingPart {
  stations: readonly GlazingStation[]
  /**
   * 罩頂平板的**半**寬。正視圖看到的那條窄平頂就是它。
   *
   *      /‾\      ← topWidth（罩頂平板）
   *     /   \     ← 直的側玻璃
   *    /_____\    ← 艙緣，寬度由機身外形決定
   */
  topWidth: number
  /** 艙緣到機背之間沿機身弧線取樣的分段數 */
  sideSegments: number
  /** 相對機身向外撐開的比例，見 buildGlazing 的「為什麼要撐開」 */
  bulge: number
}

interface Ring {
  centerY: number
  halfWidth: number
  halfHeight: number
  roundness: number
}

/** 線性內插機身在 z 處的截面（超出兩端就取端點）。 */
function sectionAt(
  sections: readonly FuselageSection[], z: number, fallbackRoundness: number,
): Ring {
  const pick = (s: FuselageSection): Ring => ({
    centerY: s.centerY, halfWidth: s.halfWidth, halfHeight: s.halfHeight,
    roundness: s.roundness ?? fallbackRoundness,
  })
  if (z <= sections[0]!.z) return pick(sections[0]!)
  const last = sections[sections.length - 1]!
  if (z >= last.z) return pick(last)
  let i = 0
  while (sections[i + 1]!.z < z) i++
  const a = pick(sections[i]!)
  const b = pick(sections[i + 1]!)
  const t = (z - sections[i]!.z) / (sections[i + 1]!.z - sections[i]!.z)
  const mix = (u: number, v: number) => u + (v - u) * t
  return {
    centerY: mix(a.centerY, b.centerY),
    halfWidth: mix(a.halfWidth, b.halfWidth),
    halfHeight: mix(a.halfHeight, b.halfHeight),
    roundness: mix(a.roundness, b.roundness),
  }
}

/**
 * 座艙玻璃 —— 貼在機身背部的一片**殼**，不是獨立的管子。
 *
 * 【為什麼不能沿用 buildFuselage】Bf 109 的座艙是**嵌進**機身裡的：玻璃與
 * 機身側面齊平，側視圖上看到的玻璃下緣（艙緣）是一條線，不是另一個管子的
 * 輪廓。原本把座艙罩做成一根獨立的超橢圓管，兩個後果都出現了：
 *
 *   一、管子的下半截埋在機身裡。玻璃是半透明的，**埋起來的部分照樣畫出來**，
 *       側面看是一團浮在機身上的淡色楔形，形狀完全不是座艙罩。
 *   二、管子的寬度必須手動配到跟機身差不多（實測 0.33 對 0.345，只差
 *       0.015），配得太窄整片消失、太寬就變成鼓包。而機身外形一改，這個
 *       手配值立刻失效——過去幾輪就是這樣反覆歪掉的。
 *
 * 截面分成兩段，各有各的道理：
 *
 *   艙緣 → 機背   **沿機身弧線**，因為這一段的玻璃就是機身蒙皮的一部分，
 *                 跟著機身走才會齊平；機身外形改了也自動跟上。
 *   機背 → 罩頂   **直線**收到 topWidth 的平頂。109 的座艙罩是平板玻璃拼
 *                 起來的，正視圖是個梯形而不是圓拱；用弧線做出來的圓頂
 *                 一眼就不像。
 *
 * 【為什麼要向外撐 bulge】玻璃與機身同一個曲面時會 z-fighting；而且兩者的
 * 徑向分段數不同，多邊形的弦都內縮於真實曲線，光靠「同一條曲線」不保證
 * 玻璃贏。撐開幾個百分點（約 1 cm）在遊戲距離看不出來，卻能穩定壓過機身。
 */
export function buildGlazing(
  fuselage: readonly FuselageSection[], part: GlazingPart, fallbackRoundness: number,
): BufferGeometry {
  const { sideSegments: seg, bulge, topWidth } = part

  /**
   * 一個站位的截面輪廓，由 +X 側艙緣起，經罩頂，到 −X 側艙緣。
   * 點數固定 2·seg+4，站位之間才能直接串成四邊形帶。
   */
  const outlineOf = (st: GlazingStation): number[][] => {
    if (st.sill >= st.roof) {
      // 艙緣高過罩頂 → 整個截面收成一點。尾端那道 45° 斜切就是這樣收掉的。
      return Array.from({ length: 2 * seg + 4 }, () => [0, st.roof, st.z])
    }
    const f = sectionAt(fuselage, st.z, fallbackRoundness)
    const deck = f.centerY + f.halfHeight
    /** 機身外殼在高度 y 的半寬（超橢圓解 x），再往外撐 bulge。 */
    const flank = (y: number): number => {
      const r = Math.min(1, Math.abs(y - f.centerY) / f.halfHeight)
      return f.halfWidth * (1 - r ** f.roundness) ** (1 / f.roundness) * (1 + bulge)
    }

    // 沿機身弧線由艙緣爬到 min(roof, 機背)
    const yTop = Math.min(st.roof, deck)
    const side: number[][] = Array.from({ length: seg + 1 }, (_, i) => {
      const y = st.sill + ((yTop - st.sill) * i) / seg
      return [flank(y), y, st.z]
    })
    // 罩頂平板。roof 沒超過機背時退化成弧線頂點，平板寬度歸零。
    const xt = st.roof > deck ? topWidth : side[seg]![0]!
    const corner = [xt, st.roof, st.z]

    const mirror = (p: number[]) => [-p[0]!, p[1]!, p[2]!]
    return [...side, corner, mirror(corner), ...side.slice().reverse().map(mirror)]
  }

  const outlines = part.stations.map(outlineOf)
  const positions: number[] = []
  const tri = (p: number[], q: number[], r: number[]) => {
    positions.push(p[0]!, p[1]!, p[2]!, q[0]!, q[1]!, q[2]!, r[0]!, r[1]!, r[2]!)
  }

  // 站位之間的四邊形帶。輪廓的方向是 +X→−X、站位的方向是 +Z，
  // (−X)×(+Z) = +Y，因此下面這個順序的法線朝外。
  const n = 2 * seg + 4
  for (let s = 0; s < outlines.length - 1; s++) {
    const A = outlines[s]!
    const B = outlines[s + 1]!
    for (let i = 0; i < n - 1; i++) {
      tri(A[i]!, A[i + 1]!, B[i]!)
      tri(A[i + 1]!, B[i + 1]!, B[i]!)
    }
  }

  // 首站封口：輪廓與艙緣連線圍出的面，由艙緣中點放射狀封起來。
  const front = outlines[0]!
  const c0 = [0, part.stations[0]!.sill, part.stations[0]!.z]
  for (let i = 0; i < n - 1; i++) tri(c0, front[i + 1]!, front[i]!)

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
