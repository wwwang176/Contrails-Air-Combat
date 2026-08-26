import { describe, it, expect } from 'vitest'
import {
  createOcean, FAR_SEA_SIZE, FAR_SEA_Y, gerstnerHeight, OCEAN_BASE_CELL, OCEAN_LEVELS,
  OCEAN_RING_SEGMENTS, OCEAN_SIZE, OCEAN_VERT_FADE_HI, RIPPLE_RESOLVED, RIPPLE_STATIC_VAR,
  RIPPLE_WARP2_AMP, RIPPLE_WARP2_LEN_A, RIPPLE_WARP2_LEN_B, RIPPLE_WARP_AMP,
  RIPPLE_WARP_LEN_A, RIPPLE_WARP_LEN_B, RIPPLE_WAVES, SHADE_SCALE_FLOOR, SHADE_SLOPE_RMS,
  SPARKLE_CELL, SPARKLE_CELL_REF, SPARKLE_FRAGMENT, WAVE_FADE_HI, WAVE_FADE_LO,
  WAVE_WARP2_AMP, WAVE_WARP_AMP, WAVES,
} from '../../src/render/ocean'

/**
 * 微波裡「11 m 那一階」—— 與最長那道差不到一個 octave 的幾道。它們共分一份
 * 坡度預算（見 `RIPPLE_SHAPE` 的 `share`），比它短的幾階各自是獨立的一階。
 */
const rippleLevel = (): typeof RIPPLE_WAVES[number][] => {
  const longest = Math.max(...RIPPLE_WAVES.map((w) => w.wavelength))
  return RIPPLE_WAVES.filter((w) => w.wavelength > longest / 2)
}

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

/** 在 `shadeScale` 的地板上（＝近處）還寫得進 `g` 的波 */
const drawnAtFloor = (): typeof WAVES[number][] =>
  [...WAVES, ...RIPPLE_RESOLVED].filter((w) =>
    1 - smoothstep(w.wavelength * WAVE_FADE_LO, w.wavelength * WAVE_FADE_HI,
      SHADE_SCALE_FLOOR) > 0.05)

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
   * 【GLSL 不接受長度 0 的陣列】`uniform vec2 uRipDir[0]` 直接編不過，而那個
   * 錯訊息離成因非常遠。所以空的時候整段**不產生** —— 見 `RIPPLE_GLSL`。
   * 這一條守的是那個開關真的接對了：空⇒沒有，非空⇒有。
   */
  it('空的時候著色器不產生微波那一段，非空的時候一定產生', () => {
    const has = RIPPLE_RESOLVED.length > 0
    expect(SPARKLE_FRAGMENT.includes('uRipDir')).toBe(has)
    expect(SPARKLE_FRAGMENT.includes('oceanRippleWarp(')).toBe(has)
  })

  /**
   * 【折疊的前提】`RIPPLE_STATIC_VAR` 把「在任何距離都淡光」的那幾道折成
   * 一個常數，而「任何距離」靠的是 `shadeScale` 有地板。著色器取的是
   * `max(oceanFoot, cellNominal, uShadeFloor)`，三者都非負且只隨距離變大，
   * 所以地板成立的充要條件就是 `uShadeFloor` 本身。
   *
   * 【下界仍是一個 Voronoi 塊】塊是單色的，比一塊還小的波在塊內看不到形狀
   * —— 那個理由沒有消失，只是不再是**唯一**的下限。見 `SHADE_SCALE_FLOOR`。
   */
  it('地板至少有一個 Voronoi 塊那麼大', () => {
    expect(SHADE_SCALE_FLOOR).toBeGreaterThanOrEqual(SPARKLE_CELL)
    // cellNominal 是另一個下限，它自己不得掉到一塊以下
    const cellNominal = (dist: number): number =>
      SPARKLE_CELL * 2 ** Math.max(0, Math.log2(Math.max(1, dist / SPARKLE_CELL_REF)))
    for (const d of [0, 1, 100, 570, 571, 1000, 10_000, 100_000])
      expect(cellNominal(d)).toBeGreaterThanOrEqual(SPARKLE_CELL)
  })

  /**
   * 【這一條是「一個浪身上有幾組明暗」】Lambert 吃的是坡度，所以每一道還畫
   * 得出來的波都會在畫面上鋪一組明暗，而**最細的那道說了算**。
   *
   * 規則：**著色不得有比承載它的幾何更細的結構**。畫面上的浪形由 `WAVES`
   * 決定（31～140 m），著色若混進 8.9 m 的東西，一個 55 m 的浪身上就會出現
   * 六組明暗 —— 像瓦楞紙，不像浪。2026-08-27 的實測：地板 2 m 時 6.2 組，
   * 地板 6 m 時 1.8 組。
   *
   * 有人把 `SHADE_SCALE_FLOOR` 調低讓微波回到迴圈裡，這一條就紅。
   */
  it('著色沒有比幾何更細的結構 —— 一個浪一組明暗', () => {
    const finestGeometry = Math.min(...WAVES.map((w) => w.wavelength))
    const drawn = drawnAtFloor()
    expect(drawn.length).toBeGreaterThan(0)
    expect(Math.min(...drawn.map((w) => w.wavelength))).toBeGreaterThanOrEqual(finestGeometry)
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
   * 【最細的那道波峰必須會斷】一道無限長的正弦就是一片平行細紋，不管它是
   * 微波還是幾何波。判準是相位擾動大於 π —— 小於 π 波峰只是被推歪，還是
   * 連續的（2026-08-26 實測：「一道、扭曲」那組條紋原封不動地回來，只是
   * 變彎了）。
   *
   * 【兩種配置都要成立】現在最細的是 31 m 的幾何波，它吃 `WAVE_WARP_*`；
   * 微波要是回到迴圈裡，最細的變成 8.9 m，那它還會多吃一層 `RIPPLE_WARP_*`。
   */
  it('最細那道畫得出來的波，波峰會斷', () => {
    const finest = drawnAtFloor().reduce((a, b) => (b.wavelength < a.wavelength ? b : a))
    const warpAmp = WAVE_WARP_AMP + WAVE_WARP2_AMP
      + (RIPPLE_RESOLVED.includes(finest) ? RIPPLE_WARP_AMP + RIPPLE_WARP2_AMP : 0)
    expect(warpAmp * ((Math.PI * 2) / finest.wavelength)).toBeGreaterThan(Math.PI)
  })

  /**
   * 【下面兩條守的是設計，不是現況】微波現在整組退回 σ（見
   * `SHADE_SCALE_FLOOR`），所以 `RIPPLE_RESOLVED` 是空的。但 `RIPPLE_SHAPE`
   * 還在，地板一調低它們就回到畫面上 —— 那時這兩條的前提才會再度生效。
   * 對 `RIPPLE_WAVES`（設計的全集）驗，而不是對 `RIPPLE_RESOLVED`（現在畫
   * 得出來的），才不會在空的時候變成空轉的綠燈。
   */
  it('微波階內的坡度能量不由單一方向獨佔', () => {
    const energy = rippleLevel().map((w) => {
      const k = (Math.PI * 2) / w.wavelength
      return (w.amplitude * k * Math.hypot(w.dirX, w.dirZ) * k) ** 2
    })
    expect(Math.max(...energy) / energy.reduce((a, b) => a + b, 0)).toBeLessThan(0.5)
  })

  /**
   * 【散佈要真的散得開】上一條只管能量不集中；方向可以三道都幾乎同向而
   * 照樣過。這一條要求那一階的波峰**至少橫跨 30°**。
   */
  it('微波階內的波峰橫跨夠寬的角度', () => {
    const bearings = rippleLevel().map(crestBearing).sort((a, b) => a - b)
    expect(bearings.length).toBeGreaterThan(1)
    // 波峰是**軸向**的（20° 與 200° 是同一條線），所以最大間隙的補角才是跨幅
    const gaps = bearings.map((b, i) =>
      i === 0 ? b + 180 - bearings[bearings.length - 1]! : b - bearings[i - 1]!)
    expect(180 - Math.max(...gaps)).toBeGreaterThanOrEqual(30)
  })
})

/**
 * 【只有碎光吃帶塊傾斜的法線】塊傾斜（`SPARKLE_TILT_SHARE`）代表未解析的
 * 坡度，用途是**選塊**。把它餵給漫射或天空反射的話，每一塊會拿到自己的
 * 亮度 —— 一整片、每塊不同、每塊一樣大，而塊的螢幕張角被 LOD 鎖成常數
 * （見 `SPARKLE_CELL`），於是遠近都一樣大。那就是高爾夫球的凹坑。
 *
 * 2026-08-27 是逐一把每個參數放大十倍找出來的：`SEA_SHADE_GAIN ×10` 把坑
 * 變成黑白多邊形（顯示路徑）、`SPARKLE_CELL ×10` 把坑放大十倍（格子）、
 * `WAVES_AMP ×10` 讓坑完全消失（浪吃光 `SHADE_SLOPE_RMS` 的預算 → 微波
 * 振幅歸零 → `slopeVar` 0 → `tiltVar` 0）。
 *
 * 【為什麼要用字串比對著色器】這一行改回 `N` 不會壞任何數字、不會拋錯，
 * 只會讓畫面悄悄長回凹坑 —— 沒有別的東西守得住。
 */
describe('塊傾斜只餵給碎光', () => {
  /** 取出含某個 uniform 的那一行 */
  const lineWith = (src: string, needle: string): string => {
    const line = src.split('\n').find((l) => l.includes(needle) && !l.trimStart().startsWith('//'))
    expect(line, `找不到含 ${needle} 的程式行`).toBeDefined()
    return line!
  }

  it('漫射（uShadeGain）吃不帶傾斜的 oceanNormal', () => {
    const line = lineWith(SPARKLE_FRAGMENT, 'uShadeGain')
    expect(line).toContain('dot(oceanNormal, uSunDirection)')
    expect(line).not.toMatch(/dot\(\s*N\s*,/)
  })

  it('碎光的選塊（cosNH）仍吃帶傾斜的 N —— 一顆一顆閃靠它', () => {
    const line = lineWith(SPARKLE_FRAGMENT, 'float cosNH')
    expect(line).toMatch(/dot\(\s*N\s*,\s*oceanH\s*\)/)
  })

  it('N 只被算一次、而且確實帶著 tilt', () => {
    const line = lineWith(SPARKLE_FRAGMENT, 'vec3 N =')
    expect(line).toContain('tilt.x')
    expect(line).toContain('tilt.y')
  })
})

/**
 * 【方向散開還不夠 —— 波峰還得會斷】四道散開只解決「只有一個方向」；四道
 * 都還是無限長的正弦，疊出來是個**規則的斑點晶格**。把波峰切斷是
 * `RIPPLE_WARP_*` 的職責。這一組守它的三個設計條件 —— 三個都是純算術，
 * 不需要跑著色器。
 */
describe('微波的細座標扭曲（RIPPLE_WARP_*）', () => {
  const A = RIPPLE_WARP_AMP + RIPPLE_WARP2_AMP
  /**
   * `oceanRippleWarp` 的 Jacobian 四項的絕對值上界。位移場是
   * `Wx = A₁sin(y·kₐ) + A₂sin(x·k₂ₐ)`、`Wz = A₁sin(x·k_b) + A₂sin(y·k₂b)`
   * —— **對角與非對角都有**，所以摺疊不能只看單一分量。
   */
  const J = {
    xx: RIPPLE_WARP2_AMP * ((Math.PI * 2) / RIPPLE_WARP2_LEN_A),
    xy: RIPPLE_WARP_AMP * ((Math.PI * 2) / RIPPLE_WARP_LEN_A),
    zx: RIPPLE_WARP_AMP * ((Math.PI * 2) / RIPPLE_WARP_LEN_B),
    zy: RIPPLE_WARP2_AMP * ((Math.PI * 2) / RIPPLE_WARP2_LEN_B),
  }

  /**
   * 【相位擾動要大於 π，波峰才會斷】小於 π 的話波峰只是被推歪，還是連續的
   * —— 實測「一道、扭曲」那組正是如此：條紋原封不動地回來，只是變彎了。
   * 綁的是**最長**那道微波（波數最小、最難擾動），所以其餘幾道自動滿足。
   */
  it('相位擾動大於 π —— 波峰要斷，不是只被推歪', () => {
    // 【對設計的全集驗】微波現在整組退回 σ，`RIPPLE_RESOLVED` 是空的；地板
    // 一調低它們就回到畫面上，那時這一條的前提才生效。見上一個 describe。
    const longest = rippleLevel().reduce((a, b) => (b.wavelength > a.wavelength ? b : a))
    expect(A * ((Math.PI * 2) / longest.wavelength)).toBeGreaterThan(Math.PI)
  })

  /**
   * 【`det(I + J)` 到 0 就會摺疊】座標映射不再是單射，同一塊水面被取樣兩次，
   * 症狀是焦散般的硬亮線。四項各自取到極值時的最壞情況仍要有明顯餘裕。
   *
   * 【不能只看單一分量】各分量的梯度最大到 0.37，看起來離 1 很遠；但真正
   * 會歸零的是行列式，而它同時吃四項。反過來也成立：單一分量到 0.7 也不
   * 一定摺疊。所以守的是行列式。
   */
  it('座標映射不會摺疊 —— det(I + J) 的下界有餘裕', () => {
    const detMin = (1 - J.xx) * (1 - J.zy) - J.xy * J.zx
    expect(detMin).toBeGreaterThan(0.25)
  })

  /**
   * 【四個波長必須互質】扭曲自己是週期的：單層的話相關性會在一個扭曲波長
   * 之後**整個復活**，等於把重複推到 60 m —— 比原本的條紋還糟。兩層互質
   * 之後復活點被推到最小公倍數。取質數是最省事的保證。
   */
  it('四個扭曲波長兩兩互質，復活點推到畫面之外', () => {
    const lens = [RIPPLE_WARP_LEN_A, RIPPLE_WARP_LEN_B, RIPPLE_WARP2_LEN_A, RIPPLE_WARP2_LEN_B]
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
    for (const a of lens) for (const b of lens) if (a !== b) expect(gcd(a, b)).toBe(1)
    // 同一個輸出分量疊的那兩層，最小公倍數要遠大於任何一個畫面看得到的範圍
    expect(RIPPLE_WARP_LEN_A * RIPPLE_WARP2_LEN_A).toBeGreaterThan(5000)
    expect(RIPPLE_WARP_LEN_B * RIPPLE_WARP2_LEN_B).toBeGreaterThan(3000)
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
