import { describe, it, expect } from 'vitest'
import { LessDepth, type DataTexture, type Mesh, type MeshStandardMaterial } from 'three'
import {
  createOcean, FACE_FRAGMENT, FAR_SEA_SIZE, FAR_SEA_Y, gerstnerHeight,
  OCEAN_BASE_CELL, OCEAN_LEVELS, OCEAN_RING_SEGMENTS, OCEAN_SIZE,
  OCEAN_SNAP, OCEAN_VERT_FADE_HI, OCEAN_VERT_FADE_LO,
  SHORE_DENSITY, SPARKLE_CREST_BIAS, SPARKLE_CREST_REF, SPARKLE_DENSITY,
  SPARKLE_FADE_END, SPARKLE_FADE_START, SPARKLE_P_MAX,
  sparkleFragment,
  WAVES, type Ocean,
} from '../../src/render/ocean'
import {
  bakeShore, createArchipelago, FIELD_CELL, SHORE_BAND,
} from '../../src/world/archipelago'
import { DRAW_FLOOR } from '../../src/render/island'

/** GLSL `smoothstep`（會夾住兩端） */
const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/**
 * 頂點著色器的 `vCell`：**這裡的格子多大，由離中心的距離推得**。
 * 與 `oceanVCell` 逐字相同 —— 兩層交界上同一點兩層算出同一個值，那是
 * 交界沒有高低差的原因。
 */
const vCellAt = (r: number): number =>
  Math.max(OCEAN_BASE_CELL, r * (2 / OCEAN_RING_SEGMENTS))

/** 第 i 道波在 `vCell` 這麼粗的格子上還剩多少振幅 */
const lodAt = (wavelength: number, vCell: number): number =>
  1 - smoothstep(wavelength * OCEAN_VERT_FADE_LO, wavelength * OCEAN_VERT_FADE_HI, vCell)

/**
 * `FACE_FRAGMENT` 選層的那一條在 TS 裡的對應：方環的 Chebyshev 半徑 → 格距。
 * **這不是抄一份**，下面那一條會拿它與 `clipmapLevelGeometry` 實際用的格距比。
 */
const levelCellAt = (r: number): number =>
  OCEAN_BASE_CELL
  * 2 ** Math.min(OCEAN_LEVELS - 1,
    Math.ceil(Math.log2(Math.max(1, r / (OCEAN_BASE_CELL * (OCEAN_RING_SEGMENTS / 2))))))

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

describe('碎光的浪峰偏置', () => {
  /** 著色器裡那一行：`p *= 1 + bias × clamp(h / ref, −1, 1)` */
  const factor = (h: number): number =>
    1 + SPARKLE_CREST_BIAS * Math.max(-1, Math.min(1, h / SPARKLE_CREST_REF))

  /**
   * 【機率不得為負】`bias > 1` 時浪谷的因子會變負數。著色器裡有 `max(…, 0)`
   * 擋著，但那是保險不是設計 —— 真的踩到的話浪谷會變成一片死區，而 `roll < p`
   * 在 p = 0 時**恆為 false**（見 `sparkleLight` 的註解），症狀是整條浪谷完全
   * 沒有白點，離「偏置調過頭」這個成因很遠。
   */
  it('偏置在 [0, 1]，浪谷的機率不會歸零或變負', () => {
    expect(SPARKLE_CREST_BIAS).toBeGreaterThanOrEqual(0)
    expect(SPARKLE_CREST_BIAS).toBeLessThan(1)
    expect(factor(-Infinity)).toBeGreaterThan(0)
  })

  /**
   * 【總量必須守恆】高度的均值是 0，而偏置對高度是**奇函數**，所以整片海的
   * 白點總數不變 —— 只是從浪谷搬到浪峰。這一條防的是有人把 `clamp` 換成
   * 非對稱的整形函數（例如 `smoothstep(0, ref, h)`），那會連帶平移
   * `SPARKLE_DENSITY` 的觀感，而那個副作用很難歸因。
   */
  it('對高度是奇函數 —— 白點總數不變，只是搬家', () => {
    for (const h of [0.1, 0.5, 1.2, 2.0, 5.0, 50]) {
      expect(factor(h) + factor(-h)).toBeCloseTo(2, 12)
    }
    expect(factor(0)).toBe(1)
  })

  /**
   * 【過渡半寬要跟著浪走】`SPARKLE_CREST_REF` 由 `WAVES` 的波幅推導（高度
   * RMS 的一半），浪一改大半寬跟著改大，偏置的**相對強度**才不會漂。寫死的
   * 話加大浪會讓 clamp 整片飽和到只剩全峰／全谷兩個值。
   *
   * 【它該落在 (0, RMS) 之間】太大偏置只是個很淺的漸層（實測白點平均高度只
   * 搬 0.09 m）；太小就退化成純粹的正負號，浪身上會出現一條硬邊。RMS 的一半
   * 讓典型高度剛好跨過飽和點，量到搬 0.24 m —— 接近這個機制的上限 0.30 m。
   */
  it('過渡半寬是 WAVES 高度 RMS 的一半', () => {
    const rms = Math.sqrt(WAVES.reduce((s, w) => s + (w.amplitude * w.amplitude) / 2, 0))
    expect(SPARKLE_CREST_REF).toBeCloseTo(rms / 2, 12)
    expect(SPARKLE_CREST_REF).toBeGreaterThan(0)
    expect(SPARKLE_CREST_REF).toBeLessThan(rms)
  })

  /**
   * 【機率必須用面的**重心**算】`vOceanWorld.y` 在面內是內插的，所以機率
   * `p` 會在面內變動 —— `roll < p` 就把一個三角形切成半白半不白，那不是
   * 「整面變白」。重心在格內的局部座標是固定的（`1/3` 與 `2/3`）。
   *
   * 【為什麼要用字串比對著色器】改回內插高度不會壞任何數字、不會拋錯，
   * 只會讓白面的邊緣悄悄長出鋸齒 —— 沒有別的東西守得住。
   */
  it('浪峰偏置吃的是面的重心高度，不是內插的片段高度', () => {
    expect(FACE_FRAGMENT).toMatch(/faceH = oceanWaveHeight\(faceCen/)
    expect(FACE_FRAGMENT).toMatch(/crest = clamp\(faceH \/ uCrestRef/)
    // 重心：兩個三角形分別是 (1/3, 1/3) 與 (2/3, 2/3)
    expect(FACE_FRAGMENT).toContain('mix(vec2(0.3333333), vec2(0.6666667), faceTri)')
    // 機率那一條不得吃內插的高度。**只看賦值，不看註解** —— 註解裡就寫著
    // vOceanWorld.y 為什麼不能用，比對整段會被自己的說明騙過去
    const crest = FACE_FRAGMENT.split(/\r?\n/).filter((l) => l.includes('crest ='))
    expect(crest).toHaveLength(1)
    expect(crest[0]).not.toContain('vOceanWorld')
  })
})

describe('低多邊形的格子', () => {
  /**
   * 【比的是關係不是數字】海的邊長是山的 1.5 倍。山變了海要
   * 跟著變 —— 寫死 60 的話，改 `FIELD_CELL` 之後這條關係會靜靜地失效。
   */
  it('格子邊長是山的 1.5 倍', () => {
    expect(OCEAN_BASE_CELL).toBeCloseTo(FIELD_CELL * 1.5, 9)
  })

  /**
   * 【Nyquist】格子畫得出來的最短波長是格距的兩倍。低於它的波在幾何上只會
   * 變成混疊 —— 而且 `OCEAN_VERT_FADE_HI = 0.5` 正好會把它整個淡掉，於是
   * 那道波**完全不存在**卻還在 uniform 裡佔一個位置、在片段裡照跑一次 sin。
   */
  it('每一道波都在 Nyquist 之上', () => {
    for (const w of WAVES) {
      expect(w.wavelength).toBeGreaterThan(2 * OCEAN_BASE_CELL)
    }
  })

  /**
   * 【浪必須在近海的覆蓋範圍內就淡光】淡出是徑向連續的（`vCell = 距離/64`），
   * 所以每一道波有一個消失半徑 `OCEAN_VERT_FADE_HI × λ × 64`。若那個半徑
   * 超出近海的外緣，浪就會被**遠海硬切掉** —— 畫面上是一條環形的斷崖。
   *
   * 變異證明：`OCEAN_VERT_FADE_HI` 調到 0.9 時最長那道的消失半徑是 21,888 m，
   * 仍在 30,720 之內、這條還是綠的；調到 1.3 才紅。所以它守的是「有人加一道
   * 很長的波」而不是淡出窗本身 —— 加一道 λ = 1000 m 的波（消失半徑 32,000 m）
   * 就會紅。
   */
  it('每一道波都在近海的外緣之前淡光', () => {
    const outer = (OCEAN_RING_SEGMENTS / 2) * OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1)
    for (const w of WAVES) {
      const reach = OCEAN_VERT_FADE_HI * w.wavelength * (OCEAN_RING_SEGMENTS / 2)
      expect(reach).toBeLessThan(outer)
    }
  })

  /**
   * 【最近那一層的浪不得被自己的格子淡掉】`vCell` 在 L0 的內圈就是
   * `OCEAN_BASE_CELL`，所以每一道波在相機腳下至少要留得住一半的振幅。
   * 留不住的話那道波只在遠處存在 —— 而遠處的格子更粗，等於它哪裡都不存在。
   */
  it('每一道波在相機腳下至少留得住一半振幅', () => {
    for (const w of WAVES) {
      expect(lodAt(w.wavelength, vCellAt(0))).toBeGreaterThan(0.5)
    }
  })

  /**
   * 【選層必須與幾何用的格距一致】`FACE_FRAGMENT` 從 Chebyshev 半徑反推
   * 「這裡的三角形多大」。反推錯的話 L1/L2/L3 的每一個真實三角形會被切成
   * 4/16/64 個**假的**色塊 —— 而那不會讓任何數字出錯、不會拋錯。
   *
   * 這裡拿的是 `clipmapLevelGeometry` 實際餵給每一層的 `cell`，不是抄一份
   * 常數。變異證明：把 `levelCellAt` 的 `ceil` 換成 `floor`，這一條紅。
   */
  it('逐面選層算出來的格距，就是那一層幾何實際用的格距', () => {
    for (let i = 0; i < OCEAN_LEVELS; i++) {
      const cell = OCEAN_BASE_CELL * 2 ** i
      // 第 i 層是半寬 32c 到 64c 的方環（L0 是實心，內緣為 0）
      const inner = i === 0 ? 0 : (OCEAN_RING_SEGMENTS / 4) * cell
      const outer = (OCEAN_RING_SEGMENTS / 2) * cell
      // 內緣往外一點、正中間、外緣往內一點 —— 三個點都該落在同一層
      for (const r of [inner + 1, (inner + outer) / 2, outer - 1]) {
        expect(levelCellAt(r)).toBe(cell)
      }
    }
  })

  /**
   * 【島的裁切界綁著浪幅】`island.ts` 低於 `DRAW_FLOOR` 的格子整格不畫 ——
   * 那是為了避免海床與海面 z-fighting。浪谷比它更深的話，波谷會**露出沒有
   * 畫的海床**，島的四周破洞。
   *
   * 調高振幅是這一輪最可能的下一步（截圖看起來太平的話），所以這一條要在。
   */
  it('浪谷不會深過島的裁切界', () => {
    const maxAmp = WAVES.reduce((s, w) => s + w.amplitude, 0)
    expect(-maxAmp).toBeGreaterThan(DRAW_FLOOR)
  })
})

describe('逐面色', () => {
  /**
   * 【兩個材質都要有】遠海那裡看不出高低起伏，所以畫一片**虛擬的**面上去 ——
   * 少了它遠海會是一塊死板的平面，而近海與遠海
   * 的接縫會變成「有面」與「沒有面」的硬界線。
   */
  it('近海與遠海的著色器都有逐面那一段', () => {
    expect(sparkleFragment(FACE_FRAGMENT)).toContain('faceCell')
  })

  /**
   * 【接縫必須連續】`faceCell` 由離中心的距離推得，所以在近海的外緣它要算出
   * **正好等於 L3 的格距**，虛擬的面才接得上真實的面。往外每個 octave 加倍。
   *
   * 這一條與「逐面選層算出來的格距」是同一支 `levelCellAt`，差別是它問的是
   * clipmap **之外**還對不對。
   */
  it('遠海的虛擬格距接得上近海的最外層，而且不再加倍', () => {
    const outerCell = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1)
    const outer = (OCEAN_RING_SEGMENTS / 2) * outerCell
    // 近海外緣：正好是最外層的格距，虛擬的面接得上真實的面
    expect(levelCellAt(outer)).toBe(outerCell)
    // 【再往外不得變大】加倍的話遠處的面會維持固定的角張角 —— 看起來比近處
    // 的面還大。封頂之後它是固定的世界尺寸，離得越遠在畫面上越小
    for (const k of [2, 4, 16, 100]) {
      expect(levelCellAt(outer * k)).toBe(outerCell)
    }
  })

  /**
   * 【固定世界尺寸不會在還看得見的地方縮成次像素】那正是 LOD 存在的理由：
   * 隨機開關的格子小於一個像素就會變成閃爍的雜訊。
   *
   * 【判準取在淡出的中點，不是終點】終點（`SPARKLE_FADE_END`）那裡 `fade`
   * 已經是 0，格子多小都不會亮 —— 在那裡設門檻是在守一個不存在的問題。
   * 中點是白點還有一半亮度、最需要它不閃的地方。實測那裡是 6.4 px。
   *
   * 有人把最外層的格距調小、或把淡出的起點推遠，這一條就紅。
   */
  it('碎光還有一半亮度的距離上，格子仍大於兩個像素', () => {
    const outerCell = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1)
    const half = (SPARKLE_FADE_START + SPARKLE_FADE_END) / 2
    // 65° 垂直視野 / 1080 列
    const pixelAngle = ((65 * Math.PI) / 180) / 1080
    expect(outerCell / half / pixelAngle).toBeGreaterThan(2)
  })

  /**
   * 【天空反射兩邊都要有】「近深遠淺」是它給的，不是大氣透視
   * （`SEA_AERIAL_STRENGTH` 是 0）。遠海少了它就會變成一片死藍的板子，
   * 與天空硬碰硬 —— 而那是 5 km 之外整個畫面。
   */
  it('天空反射與大氣透視都保留', () => {
    const src = sparkleFragment(FACE_FRAGMENT)
    expect(src).toContain('uReflectF0')
    expect(src).toContain('uHorizonColor')
    expect(src).toContain('uShadeGain')
  })
})

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
    const o = createOcean(null)
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
   * 【中心吸附到格點，而且四層共用它】頂點在波場裡連續滑動的話，每一幀每個
   * 面的三個角都落在波的不同相位上 —— 面的形狀逐幀改變，整片海會蠕動。
   * 格子 2.5 m 時那個誤差遠小於一個像素；60 m 時它就是外觀。
   *
   * 【四層必須共用同一個中心】各自對到自己的格子的話中心就會分家，環與環的
   * 交界跟著錯開，那是裂縫。`OCEAN_SNAP` 被每一層的格距整除，所以一次吸附
   * 就夠。
   */
  it('四層共用同一個中心，而且中心吸附到格點', () => {
    const o = createOcean(null)
    const cx = 1234.5
    const cz = -6789.25
    o.update(3, cx, cz)
    expect(o.mesh.children.length).toBe(OCEAN_LEVELS)
    // 【用 Math.abs 包起來】-0 % n 是 -0，而 Object.is(-0, 0) 是 false
    expect(Math.abs(o.mesh.position.x % OCEAN_SNAP)).toBe(0)
    expect(Math.abs(o.mesh.position.z % OCEAN_SNAP)).toBe(0)
    expect(o.mesh.position.y).toBe(0)
    // 【偏離不得超過半格】超過就代表吸附取的是 floor 而不是 round
    expect(Math.abs(o.mesh.position.x - cx)).toBeLessThanOrEqual(OCEAN_SNAP / 2)
    expect(Math.abs(o.mesh.position.z - cz)).toBeLessThanOrEqual(OCEAN_SNAP / 2)
    // 【中心設在群組上】各層自己不該再有偏移
    for (const level of o.mesh.children) {
      expect(level.position.lengthSq()).toBe(0)
    }
    o.dispose()
  })

  /**
   * 【每一層都要落在自己的格點上】`OCEAN_SNAP` 被每一層的格距整除是這件事
   * 成立的前提。整除關係一旦被改掉（例如有人動了 `OCEAN_LEVELS` 卻沒動吸附
   * 間距），外圈的頂點會在自己的格子之間滑 —— 而那只在遠處看得出來。
   */
  it('吸附間距被每一層的格距整除', () => {
    for (let i = 0; i < OCEAN_LEVELS; i++) {
      expect(OCEAN_SNAP % (OCEAN_BASE_CELL * 2 ** i)).toBe(0)
    }
  })

  /**
   * 【相位與網格必須是同一個吸附後的值】`origin` 是波相位用的原點（著色器的
   * `uOrigin`），`mesh.position` 決定頂點在哪。**只吸附其中一份**的話浪會
   * 相對網格滑動 —— 症狀與完全不吸附一樣（整片海蠕動），而只看
   * `mesh.position` 的測試抓不到。
   *
   * 【為什麼 `origin` 要出現在介面上】它本來是模組私有的閉包變數，而
   * `onBeforeCompile` 在 headless 測試裡不會被呼叫，從材質上讀不到 uniform。
   * 把它公開是為了讓這一條守得住 —— 這是它唯一的用途。
   */
  it('波的相位與網格吃同一個吸附後的中心', () => {
    const o = createOcean(null)
    for (const [cx, cz] of [[0, 0], [1234.5, -6789.25], [-70000.1, 33333.3]]) {
      o.update(1.5, cx!, cz!)
      expect(o.origin.x).toBe(o.mesh.position.x)
      expect(o.origin.y).toBe(o.mesh.position.z)
    }
    o.dispose()
  })

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
    const o = createOcean(null)
    expect(o.farMesh.renderOrder).toBeGreaterThan(o.mesh.renderOrder)
    o.dispose()
  })

  /**
   * 【這一條是「遠海不會蓋掉浪」的充要條件】遠海排在細浪面之後畫，所以
   * `LessEqualDepth`（three 的預設）會讓它在**平手時勝出**。而深度量化
   * `Δz ≈ z²/2²⁴`（近平面 1 m）在浪還存在的距離上已經是公尺級 —— 最長那道
   * 波撐到 `0.5 × λ × 64`，本檔的波是 12,160 m，那裡的量化階是 8.8 m，
   * 遠比兩者相距的 5 m 大。平手因此**一定會發生**。
   *
   * 【為什麼不是把遠海壓深】要壓到量化階的三倍之下得下到 −26 m 以下，而近海
   * 外緣（30.7 km）的量化階是 56 m —— 壓到那裡的話落差自己會變成一條看得見
   * 的線。
   *
   * 【`LessDepth` 是完備的】遠海恆在近海之下，而且在 clipmap 的覆蓋範圍內
   * 恆在近海之後（同一條視線上更遠），所以真實深度恆為 `far >= near`；
   * 量化是單調的，量化後仍然 `far >= near`。**平手是唯一的失效模式**，
   * 拒絕相等就補完了 —— 與距離、波長、振幅全都無關。
   *
   * 有人把它改回 `LessEqualDepth`（或不小心用了預設），這一條就紅。
   */
  it('遠海用 LessDepth —— 深度平手時近海勝出', () => {
    const o = createOcean(null)
    const m = o.farMesh.material as unknown as { depthFunc: number }
    expect(m.depthFunc).toBe(LessDepth)
    o.dispose()
  })

  it('dispose 釋放遠海的幾何與材質', () => {
    const o = createOcean(null)
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

/**
 * 靠岸的浪花。
 *
 * ── 【為什麼這一組要真的呼叫 `onBeforeCompile`】──────────────────
 *
 * 其餘的海面測試比對的是匯出的 GLSL 常數字串。那擋不住這一輪最像的失效：
 * 著色器裡宣告了 `uniform sampler2D uShoreMap` 卻**沒有人把貼圖綁上去** ——
 * 那樣照樣編譯得過、照樣取樣（取到 0 號紋理單元的預設值），而每一條字串
 * 斷言都是綠的。
 *
 * 所以這裡把 `onBeforeCompile` 自己叫一次，看的是「真的會送上 GPU 的那一份」。
 */
describe('靠岸的浪花', () => {
  interface FakeShader {
    uniforms: Record<string, { value: unknown }>
    vertexShader: string
    fragmentShader: string
  }
  /** three 在 headless 下不會編譯著色器，所以手動走一次注入 */
  const compile = (m: MeshStandardMaterial): FakeShader => {
    const shader: FakeShader = {
      uniforms: {},
      vertexShader: '#include <common>\n#include <begin_vertex>\n',
      fragmentShader:
        '#include <common>\n#include <color_fragment>\n#include <opaque_fragment>\n',
    }
    ;(m.onBeforeCompile as (s: FakeShader, r: unknown) => void)(shader, null)
    return shader
  }
  const near = (o: Ocean): MeshStandardMaterial =>
    (o.mesh.children[0] as Mesh).material as MeshStandardMaterial
  const far = (o: Ocean): MeshStandardMaterial => o.farMesh.material as MeshStandardMaterial

  const arch = createArchipelago()
  const shore = bakeShore(arch.field)

  it('近海與遠海都取樣同一張膨脹圖', () => {
    const o = createOcean(shore)
    for (const m of [near(o), far(o)]) {
      const sh = compile(m)
      expect(sh.fragmentShader).toContain('uShoreMap')
      const tex = sh.uniforms['uShoreMap']!.value as DataTexture
      // 【非驗不可】少了這一步，宣告了 sampler 卻沒綁貼圖也會全綠
      expect(tex.image.width).toBe(shore.size)
      expect(tex.image.data).toBe(shore.data)
    }
    // 兩個材質共用同一個 uniform 物件 —— 兩份會漂，症狀是接縫兩側的浪花不同
    expect(compile(near(o)).uniforms['uShoreMap']).toBe(
      compile(far(o)).uniforms['uShoreMap'])
    o.dispose()
  })

  /**
   * 【尺是 size × cell】GL 第 col 個 texel 的中心在 (col + 0.5) / size，而
   * 高度場的 col = x / cell + (size − 1) / 2 —— 代進去化簡成
   * x / (size × cell) + 0.5。用 (size − 1) × cell 會整張差半個 texel（20 m），
   * 而那不會讓任何畫面明顯不對，只會讓浪花整體偏一格。
   */
  it('uv 的尺是 size × cell', () => {
    const o = createOcean(shore)
    expect(compile(near(o)).uniforms['uShoreExtent']!.value)
      .toBe(shore.size * shore.cell)
    expect(compile(near(o)).fragmentShader).toContain('/ uShoreExtent + 0.5')
    o.dispose()
  })

  /**
   * 【機率吃的是面的重心】與 `faceH` 完全同一個理由：`vOceanWorld.xz` 在面內
   * 是內插的，逐片段取樣會把一個三角形切成半白半不白 —— 那不是「整面變白」。
   */
  it('在面的重心取樣，不是在片段', () => {
    const o = createOcean(shore)
    const src = compile(near(o)).fragmentShader
    o.dispose()
    const line = src.split(/\r?\n/).filter((l) => l.includes('uShoreMap,')).join('')
    expect(line).toContain('faceCen')
    expect(line).not.toContain('vOceanWorld')
  })

  /**
   * 【遠海一個面比浪花帶還寬】所以逐點取樣時整條帶可能落在相鄰兩個重心之間 ——
   * 遠處的海岸會**完全沒有浪花**，而且是隨方位與相位開關的。取 mip 讓那個面
   * 拿到的是「我涵蓋的範圍裡有多少比例是浪花帶」。
   */
  it('遠海的面比浪花帶寬，所以取樣要帶 LOD 而且貼圖要有 mip', () => {
    const outerCell = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1)
    expect(outerCell).toBeGreaterThan(SHORE_BAND)
    const o = createOcean(shore)
    const sh = compile(far(o))
    expect(sh.fragmentShader).toContain('textureLod(')
    expect((sh.uniforms['uShoreMap']!.value as DataTexture).generateMipmaps).toBe(true)
    o.dispose()
  })

  /**
   * 【純海面那條路一個字都不變】沒有陸地就沒有浪花。密度歸零之外還掛一張
   * 1×1 的零貼圖 —— 兩道保險，因為 `uShoreExtent` 在那裡是 1，取樣座標會
   * 跑到很遠的地方去。
   */
  it('純海面：密度是 0，貼圖是 1×1', () => {
    const o = createOcean(null)
    const sh = compile(near(o))
    expect(sh.uniforms['uShoreDensity']!.value).toBe(0)
    expect((sh.uniforms['uShoreMap']!.value as DataTexture).image.width).toBe(1)
    o.dispose()
  })

  /**
   * 【碎光那一式一個字都不動】浪花是**加上去的一項**。改寫成
   * `(align × uDensity + shore × uShoreDensity) × …` 讀起來更漂亮，但那樣
   * `shore = 0` 時就不再逐位元等於沒有浪花的那一式 —— 運算圖變了，而 GLSL
   * 不保證不同的算式在數值上完全一致。
   */
  it('shore = 0 時碎光的機率式逐字未動', () => {
    const o = createOcean(shore)
    expect(compile(near(o)).fragmentShader).toContain(
      'float p = max(align * uDensity * fade * (1.0 + uCrestBias * crest), 0.0);')
    o.dispose()
  })

  /**
   * 【封頂對既有行為不作用，對浪花非有不可】碎光單獨的最大值是
   * `1 × uDensity × 1 × (1 + uCrestBias)`；加上浪花之後超過 1，而
   * ${BT}roll < p${BT} 恆真就是整條海岸線一片死白 —— 閃爍與稀疏感全部消失。
   *
   * 動 `SPARKLE_DENSITY` 或 `SPARKLE_CREST_BIAS` 到讓封頂咬到既有行為的話，
   * 這一條會紅，而那時要回來重算。
   */
  it('機率的封頂夾得到浪花，夾不到碎光', () => {
    const crestMax = 1 + SPARKLE_CREST_BIAS
    expect(SPARKLE_DENSITY * crestMax).toBeLessThan(SPARKLE_P_MAX)
    expect((SPARKLE_DENSITY + SHORE_DENSITY) * crestMax).toBeGreaterThan(1)
    const o = createOcean(shore)
    expect(compile(near(o)).fragmentShader).toContain('min(p, uPMax)')
    o.dispose()
  })
})
