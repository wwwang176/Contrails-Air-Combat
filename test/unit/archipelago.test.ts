import { describe, it, expect } from 'vitest'
import {
  createArchipelago, CHANNEL_MIN, ISLAND_MIN_DIAMETER, PEAK_MAX, WOBBLE_MAX,
} from '../../src/world/archipelago'

/** 錨島要落在離原點這麼近的地方，m */
const ANCHOR_MAX_DISTANCE = 3500
/** 而且要這麼高，m */
const ANCHOR_MIN_PEAK = 800

/**
 * 群島生成器。
 *
 * 【這裡守的四件事，每一件都有一個具體的失效樣子】
 *
 * ```
 *   逐位元決定性    模擬是全決定性的。地形若每次不同，replayDigest 這整套
 *                   校驗和就失去意義
 *   小島下限        40 m 格子下，直徑 300 m 以下的島長不出形狀，會變成
 *                   一團三角錐
 *   峰高上限        AI 的爬升率是物理、改不動；地形是設計、想怎麼擺都行。
 *                   所以上限訂在地形這一側
 *   島間距          左右有島、中間通得過 —— 這是專案負責人指定要能成立的
 *                   情境。兩座島的膨脹圓若貼在一起，通道就沒了
 * ```
 *
 * 【刻意不測的】「不同 seed 產生不同地形」（產品只有一種群島，公開 seed
 * 是沒有需求的擴充點）、「島心恰好等於 peak」（島心不落在格點上，雙線性
 * 之後不保證精確）、「距離 2r 為零」（那只是重述解析公式）。
 */

describe('createArchipelago', () => {
  const a = createArchipelago()

  it('逐位元決定性 —— 模擬是全決定性的，地形不得破壞它', () => {
    const b = createArchipelago()
    expect(a.field.data.length).toBe(b.field.data.length)
    // 逐格比對，但只在找到差異時才 expect —— 一百萬次 expect 會跑到天荒地老
    let diff = -1
    for (let i = 0; i < a.field.data.length; i++) {
      if (!Object.is(a.field.data[i], b.field.data[i])) { diff = i; break }
    }
    expect(diff).toBe(-1)
    expect(b.islands.length).toBe(a.islands.length)
  })

  /**
   * 【為什麼地圖上要有寫死的山】戰場在原點附近，而隨機擺出來的地圖中心
   * 4.7 km 內最高只有 362 m —— 那對 600 m 的飛機不構成障礙，AI 正確地
   * 直接飛過去。實測結果是地形感知在真實的仗裡**一次都沒跑到**（spec §1）。
   * 錨島是「地形進得了場」的那個前提。
   *
   * 【為什麼要兩座】一座山對一團會漂的纏鬥是開關式的結果 —— 五種規模只有
   * 兩種會用到。兩座之後四種會用到，而且每一次繞的都是錨島。
   */
  it('交會區兩側各有一座真正的山', () => {
    const tall = a.islands.filter(
      (i) => Math.hypot(i.cx, i.cz) <= ANCHOR_MAX_DISTANCE && i.peak >= ANCHOR_MIN_PEAK)
    console.log(JSON.stringify(
      tall.map((i) => ({ d: Math.hypot(i.cx, i.cz).toFixed(0), peak: i.peak.toFixed(0) }))))
    expect(tall.length).toBe(2)
    // 【要真的分在兩側】兩座疊在同一邊的話，仗往另一邊漂就完全碰不到
    const [p, q] = tall as [typeof tall[0], typeof tall[0]]
    expect(p!.cx * q!.cx + p!.cz * q!.cz).toBeLessThan(0)
  })

  /**
   * 【為什麼要留得下一條通道】兩隊由 z = ±5,000 對頭進場，從兩座山中間
   * 穿過去。通道小於 `CHANNEL_MIN` 的話 AI 的圓盤判斷會認為沒有出路，
   * 開局變成全體繞遠路 —— 而玩家看到的是一條明明飛得過去的水道。
   */
  it('兩座錨島之間留得下一條通道', () => {
    const tall = a.islands.filter(
      (i) => Math.hypot(i.cx, i.cz) <= ANCHOR_MAX_DISTANCE && i.peak >= ANCHOR_MIN_PEAK)
    const [p, q] = tall as [typeof tall[0], typeof tall[0]]
    const gap = Math.hypot(p!.cx - q!.cx, p!.cz - q!.cz) - p!.outerRadius - q!.outerRadius
    console.log(JSON.stringify({ anchorGap: gap.toFixed(0) }))
    expect(gap).toBeGreaterThanOrEqual(CHANNEL_MIN)
  })

  it('島數是 48 —— 錨島取代兩座大島，不是追加', () => {
    expect(a.islands.length).toBe(48)
  })

  it('島清單非空，而且大小混合 —— 少數大島加多數小島', () => {
    expect(a.islands.length).toBeGreaterThan(10)
    const big = a.islands.filter((i) => i.peak > PEAK_MAX / 2).length
    expect(big).toBeGreaterThan(0)
    expect(big).toBeLessThan(a.islands.length / 2)
  })

  it('沒有島小於直徑下限', () => {
    for (const i of a.islands) {
      expect(i.radius * 2).toBeGreaterThanOrEqual(ISLAND_MIN_DIAMETER)
    }
  })

  it('峰高不超過上限 —— AI 的爬升是物理，地形是設計', () => {
    for (const i of a.islands) expect(i.peak).toBeLessThanOrEqual(PEAK_MAX)
  })

  /**
   * `wobble` 讓地形延伸到 `1.29 × radius`。mesh、視錐包圍球與 AI 的圓盤
   * **共用這一個數字** —— 有人切得比別人小，就是「撞到看不見的島」。
   */
  it('outerRadius 是 radius × WOBBLE_MAX', () => {
    for (const i of a.islands) expect(i.outerRadius).toBeCloseTo(i.radius * WOBBLE_MAX, 6)
  })

  it('任兩座島之間留得下一條通道', () => {
    let worst = Infinity
    let pair = ''
    for (let p = 0; p < a.islands.length; p++) {
      for (let q = p + 1; q < a.islands.length; q++) {
        const u = a.islands[p]!, v = a.islands[q]!
        const gap = Math.hypot(u.cx - v.cx, u.cz - v.cz) - u.outerRadius - v.outerRadius
        if (gap < worst) { worst = gap; pair = `${p}-${q}` }
      }
    }
    console.log(JSON.stringify({ islands: a.islands.length, worstGap: worst.toFixed(0), pair }))
    expect(worst).toBeGreaterThanOrEqual(CHANNEL_MIN)
  })

  it('島的膨脹圓之外是海平面以下 —— 圓盤法的保守性靠這一條', () => {
    for (const i of a.islands) {
      // 沿四個方向各走出膨脹圓一格
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const d = i.outerRadius + a.field.cell
        expect(a.field.sample(i.cx + dx * d, i.cz + dz * d)).toBeLessThanOrEqual(0)
      }
    }
  })

  it('島心附近確實有陸地', () => {
    for (const i of a.islands) expect(a.field.sample(i.cx, i.cz)).toBeGreaterThan(0)
  })
})
