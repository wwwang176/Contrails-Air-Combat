import { BufferAttribute, BufferGeometry } from 'three'

export interface WingParams {
  /** 翼根弦長，m */
  rootChord: number
  tipChord: number
  /** 半翼展，m */
  halfSpan: number
  /** 前緣後掠角，rad */
  sweep: number
  /** 上反角，rad */
  dihedral: number
  /**
   * **翼根**厚度，m。翼尖厚度按弦長比例收縮，也就是保持固定的厚弦比。
   *
   * 【原本是整片等厚】那讓翼尖厚了兩倍以上：P-51D 真機翼尖 0.148 m
   * （弦長 11.4%），等厚版本是 0.34 m；Bf 109 真機 0.119 m，等厚 0.28 m。
   * 翼根反而偏薄。結果就是機翼看起來像一塊板子而不是機翼。
   */
  thickness: number
  /** 翼根前緣在機體 Z 軸的位置 */
  rootZ: number
  rootY: number
  /**
   * 圓翼尖：最外側站位保留的弦長比例（0.30 = 縮到三成）。省略即方翼尖。
   *
   * 【為什麼需要】P-51D 與 Bf 109 F 型以後的翼尖都是明顯的圓弧，方翼尖在
   * 俯視圖與座艙視角都一眼看得出不對。弦長沿橢圓收縮，收縮的錨點見
   * TIP_ANCHOR。
   */
  tipRound?: number
}

/** 圓翼尖起始的展向位置（之內維持線性梯形）。 */
const ROUND_START = 0.86

/**
 * 圓翼尖收縮時的錨點（弦長比例，0 = 前緣、0.5 = 中弦線）。
 *
 * 【為什麼不是中弦線】對中弦線收縮，前緣與後緣往內縮的量相同，做出來是
 * 對稱的橢圓翼尖。真機（Bf 109 F 以後、P-51D）的翼尖**前緣幾乎是直的**，
 * 弧線主要由後緣往前收形成。錨在 30% 弦線讓前緣只後退三成、後緣前移七成。
 */
const TIP_ANCHOR = 0.3

/** 展向位置 u 處的弦長縮放：u ≤ ROUND_START 為 1，之後沿橢圓收到 tipRound。 */
function tipFactor(u: number, tipRound: number): number {
  if (u <= ROUND_START) return 1
  const t = (u - ROUND_START) / (1 - ROUND_START)
  return Math.sqrt(1 - (1 - tipRound * tipRound) * t * t)
}

interface Station {
  x: number
  y: number
  /** 前緣 Z */
  lead: number
  chord: number
  /** 半厚 */
  h: number
}

/**
 * 梯形翼面板（含上反角、後掠角與可選的圓翼尖）。
 * mirrored = true 產生左翼（−X 方向）。
 */
export function buildWingPanel(p: WingParams, mirrored: boolean): BufferGeometry {
  const sx = mirrored ? -1 : 1
  const round = p.tipRound ?? 1
  const fractions = p.tipRound === undefined ? [0, 1] : [0, ROUND_START, 0.95, 1]

  const stations: Station[] = fractions.map((u) => {
    const span = u * p.halfSpan
    const baseChord = p.rootChord + (p.tipChord - p.rootChord) * u
    // 【符號】機首是 −Z，所以「後掠」＝翼尖前緣往 +Z（機尾方向）移動。
    const baseLead = p.rootZ + Math.tan(p.sweep) * span
    const chord = baseChord * tipFactor(u, round)
    return {
      x: sx * span,
      y: p.rootY + Math.tan(p.dihedral) * span,
      // 對 30% 弦線收縮：前緣小幅後退、後緣大幅前移（見 TIP_ANCHOR）
      lead: baseLead + (baseChord - chord) * TIP_ANCHOR,
      chord,
      h: (p.thickness / 2) * (chord / p.rootChord),
    }
  })

  const positions: number[] = []
  /** 逆時針（法線朝外）順序寫入；鏡像會翻手性，因此整體反序。 */
  const tri = (a: number[], b: number[], c: number[]) => {
    const [p0, p1, p2] = mirrored ? [a, c, b] : [a, b, c]
    positions.push(...p0!, ...p1!, ...p2!)
  }
  const uLE = (s: Station) => [s.x, s.y + s.h, s.lead]
  const uTE = (s: Station) => [s.x, s.y + s.h, s.lead + s.chord]
  const lLE = (s: Station) => [s.x, s.y - s.h, s.lead]
  const lTE = (s: Station) => [s.x, s.y - s.h, s.lead + s.chord]

  for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i]!
    const b = stations[i + 1]!
    tri(uLE(a), uTE(b), uLE(b)); tri(uLE(a), uTE(a), uTE(b))   // 上表面 +Y
    tri(lLE(a), lLE(b), lTE(b)); tri(lLE(a), lTE(b), lTE(a))   // 下表面 −Y
    tri(uLE(a), uLE(b), lLE(b)); tri(uLE(a), lLE(b), lLE(a))   // 前緣 −Z
    tri(uTE(a), lTE(a), lTE(b)); tri(uTE(a), lTE(b), uTE(b))   // 後緣 +Z
  }
  const root = stations[0]!
  const tip = stations[stations.length - 1]!
  tri(uLE(root), lLE(root), lTE(root)); tri(uLE(root), lTE(root), uTE(root))  // 翼根 −X
  tri(uLE(tip), lTE(tip), lLE(tip)); tri(uLE(tip), uTE(tip), lTE(tip))        // 翼尖 +X

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
