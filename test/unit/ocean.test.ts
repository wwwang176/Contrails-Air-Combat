import { describe, it, expect } from 'vitest'
import {
  createOcean, FAR_SEA_SIZE, FAR_SEA_Y, gerstnerHeight, OCEAN_BASE_CELL, OCEAN_LEVELS,
  OCEAN_RING_SEGMENTS, OCEAN_SIZE, OCEAN_VERT_FADE_HI, RIPPLE_RESOLVED, RIPPLE_STATIC_VAR,
  RIPPLE_WAVES, SHADE_SCALE_FLOOR, SHADE_SLOPE_RMS, SPARKLE_CELL, SPARKLE_CELL_REF,
  WAVE_FADE_HI, WAVE_FADE_LO, WAVES,
} from '../../src/render/ocean'

/** 一道波的坡度變異數。與 `SPARKLE_FRAGMENT` 的 `ak` 同一條式子 */
const slopeVar = (w: typeof WAVES[number]): number => {
  const ak = w.amplitude * ((Math.PI * 2) / w.wavelength) * Math.hypot(w.dirX, w.dirZ)
  return (ak * ak) / 2
}

/** 波峰走向的方位角（度，0 為北、順時針為正）。北 = −Z，見 hud/attitude-math */
const crestBearing = (w: typeof WAVES[number]): number => {
  const bear = (Math.atan2(w.dirX, -w.dirZ) * 180) / Math.PI
  return (((bear - 90) % 180) + 180) % 180
}

/** GLSL `smoothstep`（會夾住兩端） */
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

describe('gerstnerHeight', () => {
  it('波高落在所有波幅總和的範圍內', () => {
    const maxAmp = WAVES.reduce((s, w) => s + w.amplitude, 0)
    for (let i = 0; i < 200; i++) {
      const h = gerstnerHeight((i * 37) % 1000, (i * 53) % 1000, i * 0.1)
      expect(h).toBeLessThanOrEqual(maxAmp + 1e-6)
      expect(h).toBeGreaterThanOrEqual(-maxAmp - 1e-6)
    }
  })

  it('相同輸入回傳相同結果（純函數）', () => {
    expect(gerstnerHeight(123, 456, 7.5)).toBe(gerstnerHeight(123, 456, 7.5))
  })

  it('會隨時間變化', () => {
    expect(gerstnerHeight(100, 100, 0)).not.toBeCloseTo(gerstnerHeight(100, 100, 3.7), 6)
  })

  it('波參數非空且振幅為正', () => {
    expect(WAVES.length).toBeGreaterThan(0)
    for (const w of WAVES) expect(w.amplitude).toBeGreaterThan(0)
  })
})

/**
 * 【微波只進著色法線】它們不在 `gerstnerHeight` 裡，所以碰撞、水柱、殘骸
 * 入水都碰不到。這一組守的是兩件事：坡度預算沒有被切壞，以及**畫面上最細
 * 的那層結構不是單一方向的**。
 */
describe('微波（RIPPLE_WAVES）', () => {
  it('總坡度 RMS 等於 SHADE_SLOPE_RMS —— 階內怎麼切都不該改變它', () => {
    const total = [...WAVES, ...RIPPLE_WAVES].reduce((s, w) => s + slopeVar(w), 0)
    expect(Math.sqrt(total)).toBeCloseTo(SHADE_SLOPE_RMS, 9)
  })

  /**
   * 【GLSL 不接受長度 0 的陣列】把 `SPARKLE_CELL` 調大、或把每一階的波長都
   * 縮短，`RIPPLE_RESOLVED` 就會空掉 —— 著色器直接編不過，而那個錯訊息離
   * 成因非常遠。
   */
  it('至少還有一道進得了著色器迴圈', () => {
    expect(RIPPLE_RESOLVED.length).toBeGreaterThan(0)
  })

  /**
   * 【折疊的前提】`RIPPLE_STATIC_VAR` 把「在任何距離都淡光」的那幾道折成
   * 一個常數，而「任何距離」靠的是 `shadeScale` 有地板。這一條把
   * `SPARKLE_FRAGMENT` 的 `cellNominal` 抄過來驗它。式子被改掉的話，被折掉
   * 的波就會在某個距離活過來 —— 而它已經不在迴圈裡了，畫面會缺一塊坡度。
   */
  it('shadeScale 的地板真的是 SHADE_SCALE_FLOOR', () => {
    const cellNominal = (dist: number): number =>
      SPARKLE_CELL * 2 ** Math.max(0, Math.log2(Math.max(1, dist / SPARKLE_CELL_REF)))
    expect(cellNominal(0)).toBe(SHADE_SCALE_FLOOR)
    for (const d of [0, 1, 100, 570, 571, 1000, 10_000, 100_000])
      expect(cellNominal(d)).toBeGreaterThanOrEqual(SHADE_SCALE_FLOOR)
  })

  /**
   * 【折疊必須是等價的，不是近似的】被折掉的那幾道在地板上的淡出權重要
   * **嚴格為 0**（GLSL 的 `smoothstep` 會夾住），而且折出來的常數要正好等於
   * 它們自己的坡度變異數總和。任一條不成立，σ 就會偏 —— 症狀是遠處的碎光
   * 密度不對，而那離成因很遠。
   */
  it('折進常數的那幾道在地板上就已經完全淡出，而且變異數對得起來', () => {
    const folded = RIPPLE_WAVES.filter((w) => !RIPPLE_RESOLVED.includes(w))
    expect(folded.length).toBe(RIPPLE_WAVES.length - RIPPLE_RESOLVED.length)
    for (const w of folded) {
      const fade = smoothstep(w.wavelength * WAVE_FADE_LO, w.wavelength * WAVE_FADE_HI,
        SHADE_SCALE_FLOOR)
      expect(fade).toBe(1)      // w = 1 − fade = 0，嚴格
    }
    expect(RIPPLE_STATIC_VAR).toBeCloseTo(folded.reduce((s, w) => s + slopeVar(w), 0), 12)
  })

  /**
   * 【這一條守的就是「細紋」】畫面上最細的那層質地由**坡度的空間梯度**
   * （`ak·k`）決定 —— 它最大的那道波說了算。那道波要是獨佔，它就是一道
   * 長峰正弦，整片海會布滿同一個走向、間距等於它波長的細紋。
   *
   * 2026-08-26 的實測：11.3 m 那道獨佔 87% 時，200 m 正俯視量到走向 20.3°、
   * 方向性 0.41 的連續斜紋；把它拆成三道方向散開的波之後獨佔降到 32%，
   * 同一塊的方向性掉到 0.07。
   *
   * 有人把某一階併回單一道、或把某道的振幅拉高，這條就紅。
   */
  it('最細那層結構不由單一方向獨佔 —— 細紋就是這樣來的', () => {
    // 在地板上（近處）每道波實際寫進 g 的坡度梯度
    const energy = [...WAVES, ...RIPPLE_RESOLVED].map((w) => {
      const k = (Math.PI * 2) / w.wavelength
      const ak = w.amplitude * k * Math.hypot(w.dirX, w.dirZ)
      const weight = 1 - smoothstep(w.wavelength * WAVE_FADE_LO, w.wavelength * WAVE_FADE_HI,
        SHADE_SCALE_FLOOR)
      return (weight * ak * k) ** 2
    })
    const total = energy.reduce((a, b) => a + b, 0)
    expect(Math.max(...energy) / total).toBeLessThan(0.5)
  })

  /**
   * 【散佈要真的散得開】上一條只管能量不集中；方向可以三道都幾乎同向而
   * 照樣過。這一條要求進得了畫面的那幾道波峰**至少橫跨 30°**。
   */
  it('進得了畫面的微波波峰橫跨夠寬的角度', () => {
    const bearings = RIPPLE_RESOLVED.map(crestBearing).sort((a, b) => a - b)
    // 波峰是**軸向**的（20° 與 200° 是同一條線），所以最大間隙的補角才是跨幅
    const gaps = bearings.map((b, i) =>
      i === 0 ? b + 180 - bearings[bearings.length - 1]! : b - bearings[i - 1]!)
    expect(180 - Math.max(...gaps)).toBeGreaterThanOrEqual(30)
  })
})

/**
 * 【遠海在守什麼】細浪面（clipmap）只鋪到以鏡頭為中心的 ±82 km，邊緣之外
 * 是天空球的下半部 —— 上帝視角爬高就會看到海是一塊浮在天上的板子。遠海是
 * 一片跟著鏡頭走的巨大平面，把海接到地平線。
 */
describe('遠海', () => {
  it('遠大於細浪面', () => {
    expect(FAR_SEA_SIZE).toBeGreaterThan(OCEAN_SIZE * 20)
  })

  /**
   * 【這一條是「不會穿插」的充要條件】遠海只要有任何一點高於細浪面的波谷，
   * 兩個面就會在浪存在的那一區交錯。而它會跟著 `WAVES` 一起變 —— 有人加一道
   * 大浪、把振幅和推過 `−FAR_SEA_Y`，這條就紅。那正是它存在的理由。
   */
  it('恆在所有波谷之下', () => {
    const maxAmp = WAVES.reduce((s, w) => s + w.amplitude, 0)
    expect(FAR_SEA_Y).toBeLessThan(-maxAmp)
  })

  it('update 讓遠海精確落在中心', () => {
    const o = createOcean()
    // 【刻意選一個小數的中心】兩者都該精確落在它上面。這一條在 clipmap 上線
    // 之前守的是「遠海不像細浪面那樣被對齊到格點」；對齊拿掉之後它守的是
    // 「跟隨沒有被誰加回某種量化」
    const cx = 1234.5
    const cz = -6789.25
    o.update(3, cx, cz)
    expect(o.farMesh.position.x).toBe(cx)
    expect(o.farMesh.position.z).toBe(cz)
    expect(o.farMesh.position.y).toBe(FAR_SEA_Y)
    o.dispose()
  })

  /**
   * 【2026-08-26：改成 clipmap 之後不再對齊格點】對齊本來是為了避免頂點在
   * 格點之間滑動造成波形抖動 —— 那是沒有頻帶限制時才會有的混疊。現在每個
   * 頂點按離相機的距離把解析不出來的波淡掉（`OCEAN_VERT_FADE_LO`），取樣
   * 永遠在 Nyquist 之內，滑動只剩內插誤差。
   *
   * 不對齊還換來一件必要的事：**十層必須共用同一個中心**。各自對到自己的
   * 格子的話中心就會分家，環與環的交界跟著錯開，那是裂縫。
   */
  it('十層共用同一個中心，而且精確落在中心', () => {
    const o = createOcean()
    const cx = 1234.5
    const cz = -6789.25
    o.update(3, cx, cz)
    expect(o.mesh.children.length).toBe(OCEAN_LEVELS)
    // 【中心設在群組上】共用同一個中心是它們不裂開的前提，設在群組上讓那件
    // 事是結構保證的。各層自己不該再有偏移
    expect(o.mesh.position.x).toBe(cx)
    expect(o.mesh.position.y).toBe(0)
    expect(o.mesh.position.z).toBe(cz)
    for (const level of o.mesh.children) {
      expect(level.position.lengthSq()).toBe(0)
    }
    o.dispose()
  })

  /**
   * 【空洞必須正好等於內一層的外緣】第 L 層挖掉中央 (段數/2)² 格，而那要
   * 剛好是第 L−1 層覆蓋的範圍：`(段數/2)×格子(L−1) = (段數/4)×格子(L)`。
   * 這條恆等式成立的前提是**格子逐層加倍**與**段數是 4 的倍數** —— 兩者
   * 任一被改掉，環與環之間就會出現空隙或重疊，而重疊是雙倍的填充成本。
   */
  it('層與層的尺寸恆等式成立', () => {
    expect(OCEAN_RING_SEGMENTS % 4).toBe(0)
    for (let i = 1; i < OCEAN_LEVELS; i++) {
      const cellIn = OCEAN_BASE_CELL * 2 ** (i - 1)
      const cellOut = OCEAN_BASE_CELL * 2 ** i
      const innerReach = (OCEAN_RING_SEGMENTS / 2) * cellIn
      const holeReach = (OCEAN_RING_SEGMENTS / 4) * cellOut
      expect(holeReach).toBeCloseTo(innerReach, 9)
    }
    // 最外層的覆蓋半徑就是 OCEAN_SIZE 的一半
    const outer = (OCEAN_RING_SEGMENTS / 2) * OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1)
    expect(outer * 2).toBeCloseTo(OCEAN_SIZE, 9)
  })

  /**
   * 【遠海必須最後畫】先畫的話，被細浪面蓋掉的區域無法靠 early-Z 省掉，而
   * 遠海是全螢幕的、著色器又昂貴 —— 等於整片海跑了兩次。實測（逐層消融，
   * 同一輪內背對背）：先畫時關掉遠海省 16.6% 的 p50，最後畫時省 0.6%。
   *
   * 【為什麼沒有 `renderOrder` 不行】three 的不透明排序是
   * `renderOrder → material.id → z`（`painterSortStable`）——`material.id`
   * 排在 `z` 前面，所以順序會變成「誰先 new 材質」的巧合。
   *
   * 【最後畫的代價由下一條守著】`LessEqualDepth` 讓後畫的在**平手時勝出**，
   * 所以深度必須分得開 —— 見下。
   */
  it('遠海排在細浪面之後畫 —— early-Z 才省得掉', () => {
    const o = createOcean()
    expect(o.farMesh.renderOrder).toBeGreaterThan(o.mesh.renderOrder)
    o.dispose()
  })

  /**
   * 【這一條是「遠海不會蓋掉浪」的充要條件】遠海與細浪面相距
   * `−FAR_SEA_Y` 公尺，而深度量化是 `Δz ≈ z²/2²⁴`（近平面 1 m）。遠海既然
   * 排在後面畫，`LessEqualDepth` 會讓它在**平手時勝出** —— 所以浪存在的那
   * 個距離上，深度必須分得開。
   *
   * 浪只存在於頂點頻帶限制還沒把最長那道波淡光的地方：
   * `vCell = 距離/64`，而 `vCell > OCEAN_VERT_FADE_HI × 最長波長` 時全部淡出。
   *
   * 有人把 `FAR_SEA_Y` 拉近、把 `OCEAN_VERT_FADE_HI` 調大、或加一道更長的
   * 波，這一條就會紅 —— 那正是它存在的理由。
   */
  it('浪存在的距離上，遠海與細浪面的深度分得開', () => {
    const longest = WAVES.reduce((a, b) => (b.wavelength > a.wavelength ? b : a)).wavelength
    // 波完全淡出的 vCell，換算回距離（vCell = 距離 ÷ (段數/2)）
    const waveReach = OCEAN_VERT_FADE_HI * longest * (OCEAN_RING_SEGMENTS / 2)
    // 24-bit 深度、近平面 1 m 時那個距離上的量化階
    const quantum = (waveReach * waveReach) / 2 ** 24
    // 至少要有三倍的餘裕，才不會在別的機器上剛好卡住
    expect(quantum * 3).toBeLessThan(-FAR_SEA_Y)
  })

  it('dispose 釋放遠海的幾何與材質', () => {
    const o = createOcean()
    let disposed = 0
    o.farMesh.geometry.addEventListener('dispose', () => { disposed++ })
    // 【`as unknown as`】`Mesh.material` 的型別是 `Material | Material[]`，
    // 直接斷言成一個帶 addEventListener 的物件兩個方向都不可賦值（TS2352）。
    // 專案既有的正確寫法在 test/unit/terrain.test.ts。
    ;(o.farMesh.material as unknown as {
      addEventListener(t: string, f: () => void): void
    }).addEventListener('dispose', () => { disposed++ })
    o.dispose()
    expect(disposed).toBe(2)
  })
})
