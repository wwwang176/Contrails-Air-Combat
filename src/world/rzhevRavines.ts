import { at, shelterbeltFade } from './rzhev'

/**
 * # 勒熱夫的沖溝（balka）
 *
 * 俄國的草原上，雨水與融雪把土切成一條條窄溝，溝坡長草與灌木、溝底長樹。高度場一格 80 m，
 * 做不出 30～100 m 寬的窄溝，所以這裡只給**平面上的走向**：地面上畫一條不透明的溝帶（蓋掉底下的田，田在溝緣停住）、沿線種樹與
 * 灌木（`render/steppeRavines.ts`），沒有起伏。
 *
 * 【只在戰場方框之外】方框裡的單位、壕溝與路線都有佈局，溝不能蓋上去。`shelterbeltFade`
 * （戰場方框往外漸增）低於 `MIN_FADE` 的點整段丟掉，所以每一條溝都在方框外斷成幾截。
 *
 * 【局部座標生成、換成世界座標】溝大致朝西北流（河谷在那個方向），走向由一條有阻尼的隨機
 * 遊走給：每步轉一個小角度，同時被拉回這條溝的平均走向，所以蜿蜒但不會打圈。主溝帶兩條支溝。
 * 全部由固定的種子決定，每次載入一樣。
 */

export interface Ravine {
  /** 折線，世界座標，相鄰兩點約 `RAVINE_STEP` m */
  readonly points: readonly { readonly x: number; readonly z: number }[]
  /**
   * 每一點的寬度倍率（`MIN_SCALE`～1，與 `points` 等長）：溝頭、溝尾與靠近戰場方框的地方收窄，
   * 溝帶的半寬、樹帶的半寬與樹的疏密都乘它
   */
  readonly scale: readonly number[]
  /** 地面溝帶（草坡到溝底）的半寬，m */
  readonly half: number
  /** 樹與灌木帶的半寬，m：溝底的寬度（約 `half` 的 0.4 倍）再多一點，灌木往溝坡上爬 */
  readonly band: number
}

const SEED = 0x6a1ca
/** 主溝的條數 */
export const RAVINE_COUNT = 16
/** 折線相鄰兩點的距離，m */
export const RAVINE_STEP = 60
/** 濃度低於這個的點不畫：戰場方框外一兩百公尺才開始 */
export const RAVINE_MIN_FADE = 0.15
/** 濃度從 `RAVINE_MIN_FADE` 再升這麼多，溝才長到全寬：靠近方框的溝是漸漸收尖的 */
export const RAVINE_TAPER_FADE = 0.35
/** 最窄的寬度倍率 */
export const RAVINE_MIN_SCALE = 0.12
/** 溝頭收尖的長度（點數）與溝尾（匯進平原）收尖的長度 */
const HEAD_POINTS = 8
const MOUTH_POINTS = 14
/** 一截不到這個點數就丟掉（約 360 m） */
const MIN_POINTS = 6
/** 平均走向（局部座標，`atan2(lz, lx)`）：朝西北 */
const HEADING = (215 * Math.PI) / 180
/** 起點散佈的半邊長，m */
const SPREAD = 10_000

function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface P { lx: number; lz: number }

/** 一條有阻尼的隨機遊走：回傳折線與每一點的走向 */
function walk(
  rand: () => number, start: P, heading: number, mean: number, steps: number,
): { pts: P[]; head: number[] } {
  const pts: P[] = [{ ...start }]
  const head: number[] = [heading]
  let h = heading
  let p = start
  for (let i = 0; i < steps; i++) {
    h += (mean - h) * 0.05 + (rand() - 0.5) * 0.38
    p = { lx: p.lx + Math.cos(h) * RAVINE_STEP, lz: p.lz + Math.sin(h) * RAVINE_STEP }
    pts.push(p)
    head.push(h)
  }
  return { pts, head }
}

function smooth(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c * c * (3 - 2 * c)
}

/** 離端點 `n` 個點的寬度倍率：端點是 `RAVINE_MIN_SCALE`，走滿 `len` 個點長到 1 */
function endScale(n: number, len: number): number {
  return RAVINE_MIN_SCALE + (1 - RAVINE_MIN_SCALE) * smooth(n / len)
}

/**
 * 世界座標、並在戰場方框裡把折線截斷。寬度倍率取三者的小值：溝頭（`headAtStart` 決定是起點還是
 * 終點）、溝尾（另一端，主溝才有）、靠近方框的濃度。支溝的另一端接在主溝上，不收窄
 */
function toPieces(
  pts: readonly P[], half: number, band: number, headAtStart: boolean, mouth: boolean,
): Ravine[] {
  const out: Ravine[] = []
  let run: { x: number; z: number }[] = []
  let scale: number[] = []
  const flush = (): void => {
    if (run.length >= MIN_POINTS) out.push({ points: run, scale, half, band })
    run = []
    scale = []
  }
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const p = pts[i]!
    const w = at(p.lx, p.lz)
    const fade = shelterbeltFade(w.x, w.z)
    if (fade < RAVINE_MIN_FADE) { flush(); continue }
    const head = endScale(headAtStart ? i : n - 1 - i, HEAD_POINTS)
    const tail = mouth ? endScale(headAtStart ? n - 1 - i : i, MOUTH_POINTS) : 1
    const box = RAVINE_MIN_SCALE + (1 - RAVINE_MIN_SCALE) * smooth((fade - RAVINE_MIN_FADE) / RAVINE_TAPER_FADE)
    run.push(w)
    scale.push(Math.min(head, tail, box))
  }
  flush()
  return out
}

function generate(): Ravine[] {
  const rand = rng(SEED)
  const out: Ravine[] = []
  for (let i = 0; i < RAVINE_COUNT; i++) {
    const start: P = { lx: (rand() - 0.5) * 2 * SPREAD, lz: (rand() - 0.5) * 2 * SPREAD }
    const mean = HEADING + (rand() - 0.5) * 0.9
    const steps = 50 + Math.floor(rand() * 60)
    const { pts, head } = walk(rand, start, mean + (rand() - 0.5) * 0.4, mean, steps)
    out.push(...toPieces(pts, 32, 13, true, true))
    // 兩條支溝：從主溝中段岔出去，一側各一條
    for (const side of [1, -1]) {
      const j = 15 + Math.floor(rand() * (steps - 30))
      const h0 = head[j]! + side * (0.8 + rand() * 0.4)
      const tri = walk(rand, pts[j]!, h0, h0, 15 + Math.floor(rand() * 20))
      out.push(...toPieces(tri.pts, 22, 9, false, false))
    }
  }
  return out
}

export const RAVINES: readonly Ravine[] = generate()

/** 一點離最近一條溝的中線多遠，m（測試與避讓用，熱路徑之外） */
export function ravineGap(x: number, z: number): number {
  let best = Infinity
  for (const r of RAVINES) {
    const pts = r.points
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i]!
      const b = pts[i + 1]!
      const abx = b.x - a.x
      const abz = b.z - a.z
      const len2 = abx * abx + abz * abz
      const t = len2 === 0 ? 0 : Math.min(1, Math.max(0, ((x - a.x) * abx + (z - a.z) * abz) / len2))
      const d = Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t))
      if (d < best) best = d
    }
  }
  return best
}
