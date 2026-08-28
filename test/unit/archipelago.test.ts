import { describe, it, expect } from 'vitest'
import {
  bakeShore, createArchipelago, makeLobes, CHANNEL_MIN, FIELD_CELL,
  ISLAND_MIN_DIAMETER, PEAK_MAX, SEA_FLOOR, SHORE_BAND, WOBBLE_MAX,
  type LobeDraw,
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

  /**
   * 【為什麼掃 64 個方位而不是四個】島不再是圓對稱的：次峰是偏心的，而
   * 「每一瓣都放得下」是靠 `makeLobes` 那條恆等式撐住的。四個方位量不到一顆
   * 剛好落在對角線上的瓣。
   *
   * 【為什麼是「恰好等於海床」而不是「≤ 0」】溢出一點點的話高度仍然是負的
   * —— 那條斷言看不出來。而恰好等於 `SEA_FLOOR` 意味著**沒有任何一瓣碰到
   * 這裡**，那才是圓盤法要的。
   *
   * 【為什麼取樣點退到兩格外】`sample` 在格內是內插的，膨脹圓正上方那一格的
   * 內側頂點可能還在島上。兩格保證內插用的四個頂點都在圓外。島間距 1,500 m
   * 遠大於兩格，所以不會取到別座島。
   */
  it('膨脹圓之外恰好是海床 —— 圓盤法的保守性靠這一條', () => {
    const d = FIELD_CELL * 2
    for (const i of a.islands) {
      for (let k = 0; k < 64; k++) {
        const th = (k / 64) * Math.PI * 2
        const r = i.outerRadius + d
        expect(a.field.sample(i.cx + Math.cos(th) * r, i.cz + Math.sin(th) * r))
          .toBe(SEA_FLOOR)
      }
    }
  })

  it('島心附近確實有陸地', () => {
    for (const i of a.islands) expect(a.field.sample(i.cx, i.cz)).toBeGreaterThan(0)
  })
})

/**
 * 多瓣的島。**一座島 = 主瓣加四顆偏心的次峰取 max**，兩瓣相交處的摺線就是
 * 稜線。這一組守的是「換了形狀，三個既有契約仍然成立」，以及「起伏真的存在
 * 而不是換了個寫法的同一顆圓錐」。
 */
describe('多瓣的島', () => {
  const a = createArchipelago()

  /**
   * 【這是 outerRadius 不必重新定值的全部理由】`off + r × WOBBLE_MAX ≤
   * outerRadius` 成立的話，三角不等式就保證整座島仍在膨脹圓之內。
   * 上面那條掃高度場的是同一件事的另一端 —— 這一條直接驗參數，紅起來會指向
   * `makeLobes`，那一條會指向 `bake`。
   */
  it('每一瓣都放得下', () => {
    let worst = -Infinity
    for (const i of a.islands) {
      for (const lo of i.lobes) {
        worst = Math.max(worst, lo.offset + lo.radius * WOBBLE_MAX - i.outerRadius)
      }
    }
    console.log(JSON.stringify({ 最大溢出: worst.toExponential(2) }))
    // 【容差是 float 的 ulp，不是設計餘裕】`off + r × WOBBLE_MAX ≤ outerRadius`
    // 在代數上是恆等式；浮點下差一兩個 ulp（實測 2e-13，而 outerRadius 是
    // 10³ 量級）
    expect(worst).toBeLessThanOrEqual(1e-6)
  })

  /**
   * 【上一條只驗了這一顆種子抽出來的那 48 座島】而不變式要成立的是**整個
   * 參數空間**：`rf` 的兩端、`LOBE_MIN_RADIUS` 夾住半徑的那條路徑（只有
   * 最小的島會走到）、`uPeak` 與 `uOff` 的兩端。這一條直接掃那個角落集合。
   *
   * 【順便驗兩件同樣是算式的事】瓣高恆低於島峰（`PEAK_MAX` 因此仍然是實際
   * 的上限），以及每一瓣都露得出主瓣（不然它在畫面上不存在）。
   */
  it('參數空間的四個角落，三條不變式都成立', () => {
    // TIERS 的兩端加上錨島的尺寸
    const SIZES = [[150, 60], [150, 160], [260, 160], [500, 300], [800, 500],
      [1400, 900], [1500, 850]] as const
    const ENDS = [0, 0.5, 1]
    let worstFit = -Infinity
    let worstPeak = -Infinity
    let worstLift = Infinity
    const smoothstep = (e0: number, e1: number, x: number): number => {
      const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
      return t * t * (3 - 2 * t)
    }
    for (const [radius, peak] of SIZES) {
      const outerRadius = radius * WOBBLE_MAX
      for (const rf of [0.28, 0.35, 0.45]) {
        for (const uPeak of ENDS) {
          for (const uOff of ENDS) {
            const draw: LobeDraw = { dir: 0.7, rf, uPeak, uOff, pa: 1.1, pb: 2.3 }
            const lobes = makeLobes(0, 0, radius, outerRadius, peak, 0, 0, [draw])
            const lo = lobes[1]!
            worstFit = Math.max(worstFit, lo.offset + lo.radius * WOBBLE_MAX - outerRadius)
            worstPeak = Math.max(worstPeak, lo.peak - peak)
            // 露出量：這一瓣的峰高減掉主瓣在同一個半徑上的高度
            const cone = peak * smoothstep(1, 0, lo.offset / outerRadius)
            worstLift = Math.min(worstLift, lo.peak - cone)
          }
        }
      }
    }
    console.log(JSON.stringify({
      最大溢出: worstFit.toExponential(2),
      最高的瓣超出島峰: worstPeak.toFixed(1),
      最小露出量: worstLift.toFixed(2) + ' m',
    }))
    expect(worstFit).toBeLessThanOrEqual(1e-6)   // 放得下
    expect(worstPeak).toBeLessThan(0)            // peak 仍是實際最高點
    expect(worstLift).toBeGreaterThan(0)         // 每一瓣都露得出來
  })

  /**
   * 【`peak` 必須仍然是實際的最高點】不然 `PEAK_MAX` 這個護欄就失效了 ——
   * 而它是「AI 閃得掉」的第一道防線。
   *
   * 【驗的是高度場的格點，不是解析值】格點是烘出來的、沒有內插，所以這一條
   * 是精確的。島心不落在格點上，所以**不能**反過來要求島心恰好等於 `peak`。
   */
  it('膨脹圓之內沒有一格高過那座島的 peak', () => {
    const { size, cell, data } = a.field
    const half = (size - 1) / 2
    let worst = -Infinity
    for (const i of a.islands) {
      const c0 = Math.max(0, Math.floor((i.cx - i.outerRadius) / cell + half))
      const c1 = Math.min(size - 1, Math.ceil((i.cx + i.outerRadius) / cell + half))
      const r0 = Math.max(0, Math.floor((i.cz - i.outerRadius) / cell + half))
      const r1 = Math.min(size - 1, Math.ceil((i.cz + i.outerRadius) / cell + half))
      for (let row = r0; row <= r1; row++) {
        for (let col = c0; col <= c1; col++) {
          const x = (col - half) * cell
          const z = (row - half) * cell
          if (Math.hypot(x - i.cx, z - i.cz) > i.outerRadius) continue
          worst = Math.max(worst, data[row * size + col]! - i.peak)
        }
      }
    }
    console.log(JSON.stringify({ 最高的一格超出peak: worst.toFixed(6) }))
    expect(worst).toBeLessThanOrEqual(0)
    expect(worst).toBeGreaterThan(-30)   // 而且真的接近 —— 主瓣沒有被誰壓掉
  })

  /**
   * 【起伏真的存在】改動前，沿任何一條半徑走出去高度是**嚴格遞減**的 ——
   * 那正是「48 座島是同一顆饅頭」的數學說法。有了偏心的次峰，穿過次峰的那條
   * 半徑一定會先降再升。
   *
   * 這一條是這一輪唯一直接量到「外型變了」的斷言。把 `makeLobes` 改回單瓣、
   * 或把 `LOBE_SLOPE` 調到讓次峰埋進主瓣底下，它就紅。
   */
  it('每一座島都有一條半徑不是單調遞減的', () => {
    const flat: string[] = []
    for (const i of a.islands) {
      let bumpy = false
      for (const lo of i.lobes) {
        if (lo.offset === 0) continue
        const dir = Math.atan2(lo.cz - i.cz, lo.cx - i.cx)
        // 【比的是走過的最低點，不是上一步】次峰的隆起攤在幾十公尺上，
        // 逐步的差可以小於 0.5 m 而總抬升有好幾公尺 —— 用 prev 的話會漏掉
        let low = Infinity
        for (let d = 0; d <= i.outerRadius; d += 5) {
          const h = a.field.sample(i.cx + Math.cos(dir) * d, i.cz + Math.sin(dir) * d)
          if (h < low) low = h
          // 0.5 m 的門檻：內插的數值抖動不算「升起來」
          if (h > low + 0.5) { bumpy = true; break }
        }
        if (bumpy) break
      }
      if (!bumpy) flat.push(`(${i.cx.toFixed(0)}, ${i.cz.toFixed(0)})`)
    }
    console.log(JSON.stringify({ 沒有起伏的島: flat }))
    expect(flat).toEqual([])
  })

  /**
   * 【錨島的形狀是常數】它們的瓣由**自己的**亂數序列抽，不碰主序列 ——
   * 所以後面加減幾次 `rand()` 都動不到它們。
   *
   * 【為什麼不能靠既有的決定性測試守】那一條只是同一個生成器跑兩次比對，
   * 錨島改成消耗主序列之後它照樣全綠。只有寫死的期望值抓得到。
   *
   * 【動了 ANCHORS 或抽瓣的順序，這一條會紅】那時要回來重錄，而且**要順便
   * 重量 `terrain-in-play`** —— 交會區的兩座山是那一組測試的主角。
   */
  it('錨島的瓣是常數', () => {
    const shape = (k: number): string => JSON.stringify(
      a.islands[k]!.lobes.map((l) => [
        +l.offset.toFixed(2), +l.radius.toFixed(2), +l.peak.toFixed(2)]))
    expect(shape(0)).toBe(JSON.stringify([
      [0, 1400, 900], [1169.9, 457.76, 299.84], [1017.95, 562.82, 397.39],
      [1151.07, 476.52, 331.79], [1103.37, 487.03, 343.49]]))
    expect(shape(1)).toBe(JSON.stringify([
      [0, 1500, 850], [1064.73, 651.79, 433.72], [1263.52, 473.16, 276.3],
      [1206.14, 544.4, 323.62], [1230.89, 512.14, 325.23]]))
  })
})

/**
 * 離岸的膨脹圖 —— 海面的浪花吃它。
 *
 * 【它為什麼由高度場推】海岸線是好幾瓣聯集出來的，沒有閉式解；而且島形以後
 * 怎麼改，這張圖自動跟著走。由島的參數另外算一份就會漂。
 */
describe('離岸的膨脹圖', () => {
  const a = createArchipelago()
  const shore = bakeShore(a.field)
  const at = (x: number, z: number): number => {
    const half = (shore.size - 1) / 2
    const col = Math.round(x / shore.cell + half)
    const row = Math.round(z / shore.cell + half)
    return shore.data[row * shore.size + col]!
  }

  it('索引與高度場完全相同', () => {
    expect(shore.size).toBe(a.field.size)
    expect(shore.cell).toBe(a.field.cell)
    expect(shore.data.length).toBe(a.field.data.length)
  })

  it('陸地上是滿值', () => {
    for (const i of a.islands) expect(at(i.cx, i.cz)).toBe(255)
  })

  /**
   * 【帶外必須歸零】不然整片海都會有浪花 —— 而那不是「靠岸比較容易」，
   * 是「到處都白」。取樣點退兩格是為了避開 chamfer 的 4% 近似誤差。
   */
  it('離岸超過帶寬之後是 0', () => {
    const d = SHORE_BAND + FIELD_CELL * 2
    for (const i of a.islands) {
      for (let k = 0; k < 32; k++) {
        const th = (k / 32) * Math.PI * 2
        const r = i.outerRadius + d
        expect(at(i.cx + Math.cos(th) * r, i.cz + Math.sin(th) * r)).toBe(0)
      }
    }
  })

  /**
   * 【每一個方位都要有一段漸層，而且一路遞減】
   *
   * 只驗遞減是不夠的 —— **實測過**：把反向那一趟拿掉之後（距離只從左上方
   * 傳播），島的左上側是「陸地 255 直接掉到 0」，中間一階都沒有，而遞減這條
   * 斷言照樣全綠。少了的那半張圖就這樣溜過去。
   *
   * 所以這一條要求每個方位都看得到一個嚴格落在 (0, 255) 之間的值 —— 那正是
   * 「這裡有一條浪花帶」的定義。
   */
  it('每個方位都有一段漸層', () => {
    const bad: string[] = []
    for (const i of a.islands) {
      for (let k = 0; k < 8; k++) {
        const th = (k / 8) * Math.PI * 2
        const seq: number[] = []
        for (let d = 0; d <= i.outerRadius + SHORE_BAND + FIELD_CELL * 2; d += 20) {
          seq.push(at(i.cx + Math.cos(th) * d, i.cz + Math.sin(th) * d))
        }
        // 【由**最外側**那一塊陸地起算】從島心走出去會穿過灣（兩瓣之間的
        // 水道），那裡是 255 → 掉下去 → 又回到 255。那是對的，不是缺陷。
        //
        // 【刻意不驗「之後一路遞減」】海岸線是扇貝狀的，射線掠過一個岬角
        // 時值會回升一段 —— 那同樣是對的。反向那一趟漏掉的失效由「每個方位
        // 都要有漸層」抓（實測會讓 74 個方位變紅）
        let last = -1
        for (let n = 0; n < seq.length; n++) if (seq[n] === 255) last = n
        const where = `(${i.cx.toFixed(0)}, ${i.cz.toFixed(0)}) ${k * 45}°`
        let graded = false
        for (let n = last + 1; n < seq.length; n++) {
          if (seq[n]! > 0 && seq[n]! < 255) graded = true
        }
        if (!graded) bad.push(where)
      }
    }
    console.log(JSON.stringify({ 沒有漸層: bad.slice(0, 6), 共: bad.length }))
    expect(bad).toEqual([])
  })
})
