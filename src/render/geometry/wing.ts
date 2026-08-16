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
   * **翼根**厚度，m。
   *
   * 【原本是整片等厚】那讓翼尖厚了兩倍以上：P-51D 真機翼尖 0.148 m
   * （弦長 11.4%），等厚版本是 0.34 m；Bf 109 真機 0.115 m，等厚 0.28 m。
   * 翼根反而偏薄。結果就是機翼看起來像一塊板子而不是機翼。
   */
  thickness: number
  /**
   * **翼尖**厚度，m。省略即按弦長等比例收縮（＝厚弦比固定）。
   *
   * 【為什麼不能只按弦長縮】真機的厚弦比本身沿翼展就在變薄：P-51D 由翼根
   * 15.1% 收到翼尖 11.4%、Bf 109 由 14.2% 收到 11.35%。只按弦長縮等於把
   * 根部的厚弦比一路帶到翼尖，翼尖因此厚了約 27%（P-51D 0.189 對真機
   * 0.148、Bf 109 0.146 對 0.115）——外翼段看起來鈍鈍的，翼尖尤其明顯。
   */
  tipThickness?: number
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
  /**
   * 內外段的轉折。省略即單一梯形（兩台戰機都是）。
   *
   * 【為什麼需要，以及它抓到了什麼】2026-08-17 量 He 111 的俯視剪影：
   *
   * ```
   *   X      前緣Z    後緣Z    弦長
   *   1.40   2.074    6.513    4.439   ← 內段
   *   1.80   2.074    6.629    4.555
   *   3.40   2.106    6.959    4.853   ← 外段起點
   *   3.60   2.155    6.944    4.789
   * ```
   *
   * 內段的前緣幾乎不後掠（0.9°），外段才是 14°。原本的做法是「拿外段配一條
   * 直線，外推到 X = 0 當翼根」—— 那讓翼根前緣偏前 0.47 m、後緣偏後 0.60 m，
   * **俯視就是把靠機身那塊凹陷整個填平**。
   *
   * 而且它有一個免費的證據：填平之後的梯形面積 93.2 m²，史實 86.5；改成
   * 兩段折線之後是 87.1 m²，**+0.7%**。先前那個「翼面積莫名其妙大 7.8%」
   * 的帳，根因就在這裡。
   *
   * 【`sweep` 的意思跟著改成「外段」】轉折存在時，前緣是
   * `rootZ` → `kink.lead` →（後掠 `sweep`）→ 翼尖。這樣三個欄位各自對應一
   * 段量測值，不必先解一個聯立方程式才填得出來。
   */
  kink?: {
    /** 轉折的展向位置，半翼展的比例 */
    at: number
    /** 轉折處的弦長 */
    chord: number
    /** 轉折處的前緣 Z */
    lead: number
  }
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
 * 弦向的厚度分佈：[弦長比例, 該處佔最大厚度的比例]。對稱翼型的低多邊形近似。
 *
 * 【原本整片是等厚的平板】那是機翼看起來太厚的真正原因，而不是最大厚度訂
 * 錯了——實測 Bf 109 的最大厚度 0.315 與真機 14.2% 弦長完全一致，但平板讓
 * 這個厚度從前緣一路撐到後緣。真翼型只在三成弦長處有最大厚度，前後緣幾乎
 * 收成一條線；同樣的最大厚度，平板看起來厚得多。
 */
const PROFILE: readonly (readonly [number, number])[] = [
  [0.00, 0.04], [0.10, 0.78], [0.30, 1.00], [0.60, 0.72], [1.00, 0.03],
]

/**
 * 梯形翼面板（含上反角、後掠角、翼型厚度分佈與可選的圓翼尖）。
 * mirrored = true 產生左翼（−X 方向）。
 */
export function buildWingPanel(p: WingParams, mirrored: boolean): BufferGeometry {
  const sx = mirrored ? -1 : 1
  const round = p.tipRound ?? 1
  const base = p.tipRound === undefined ? [0, 1] : [0, ROUND_START, 0.95, 1]
  // 轉折自己必須是一個站位，否則它會被兩側的內插抹平
  const fractions = p.kink
    ? [...new Set([...base, p.kink.at])].sort((a, b) => a - b)
    : base

  // 厚度沿翼展線性收；省略 tipThickness 時退回「厚弦比固定」的舊行為
  const tipT = p.tipThickness ?? (p.thickness * p.tipChord) / p.rootChord

  /**
   * 弦長與前緣的展向分佈。沒有轉折時是 root → tip 的一條直線（與 2026-08-17
   * 之前**逐字相同**）；有轉折時是 root → kink → tip 的兩段折線。
   */
  const k = p.kink
  const tipLead = k
    ? k.lead + Math.tan(p.sweep) * (1 - k.at) * p.halfSpan
    : p.rootZ + Math.tan(p.sweep) * p.halfSpan
  const piecewise = (u: number, root: number, mid: number | undefined, tip: number): number => {
    if (!k || mid === undefined) return root + (tip - root) * u
    return u <= k.at
      ? root + (mid - root) * (u / k.at)
      : mid + (tip - mid) * ((u - k.at) / (1 - k.at))
  }

  const stations: Station[] = fractions.map((u) => {
    const span = u * p.halfSpan
    const baseChord = piecewise(u, p.rootChord, k?.chord, p.tipChord)
    // 【符號】機首是 −Z，所以「後掠」＝翼尖前緣往 +Z（機尾方向）移動。
    const baseLead = piecewise(u, p.rootZ, k?.lead, tipLead)
    const chord = baseChord * tipFactor(u, round)
    return {
      x: sx * span,
      y: p.rootY + Math.tan(p.dihedral) * span,
      // 對 30% 弦線收縮：前緣小幅後退、後緣大幅前移（見 TIP_ANCHOR）
      lead: baseLead + (baseChord - chord) * TIP_ANCHOR,
      chord,
      // 圓翼尖那一小段弦長是急收的，厚度不能跟著急收否則翼尖成刀口；
      // 厚度只依展向位置 u 走。
      h: (p.thickness + (tipT - p.thickness) * u) / 2,
    }
  })

  const positions: number[] = []
  /** 逆時針（法線朝外）順序寫入；鏡像會翻手性，因此整體反序。 */
  const tri = (a: number[], b: number[], c: number[]) => {
    const [p0, p1, p2] = mirrored ? [a, c, b] : [a, b, c]
    positions.push(...p0!, ...p1!, ...p2!)
  }
  /** 站位 s 的第 i 個弦向點，上表面或下表面。 */
  const up = (s: Station, i: number) => {
    const [u, t] = PROFILE[i]!
    return [s.x, s.y + s.h * t, s.lead + s.chord * u]
  }
  const lo = (s: Station, i: number) => {
    const [u, t] = PROFILE[i]!
    return [s.x, s.y - s.h * t, s.lead + s.chord * u]
  }
  const last = PROFILE.length - 1

  for (let k = 0; k < stations.length - 1; k++) {
    const a = stations[k]!
    const b = stations[k + 1]!
    for (let i = 0; i < last; i++) {
      tri(up(a, i), up(b, i + 1), up(b, i)); tri(up(a, i), up(a, i + 1), up(b, i + 1))
      tri(lo(a, i), lo(b, i), lo(b, i + 1)); tri(lo(a, i), lo(b, i + 1), lo(a, i + 1))
    }
    // 前緣（−Z）與後緣（+Z）：翼型在這兩端沒有完全收合，要各補一條窄面
    tri(up(a, 0), up(b, 0), lo(b, 0)); tri(up(a, 0), lo(b, 0), lo(a, 0))
    tri(up(a, last), lo(a, last), lo(b, last)); tri(up(a, last), lo(b, last), up(b, last))
  }

  const root = stations[0]!
  const tip = stations[stations.length - 1]!
  for (let i = 0; i < last; i++) {
    tri(up(root, i), lo(root, i), lo(root, i + 1))       // 翼根 −X
    tri(up(root, i), lo(root, i + 1), up(root, i + 1))
    tri(up(tip, i), lo(tip, i + 1), lo(tip, i))          // 翼尖 +X
    tri(up(tip, i), up(tip, i + 1), lo(tip, i + 1))
  }

  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.computeVertexNormals()
  return geometry
}
