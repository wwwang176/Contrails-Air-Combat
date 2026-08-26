import { describe, it, expect } from 'vitest'
import {
  createOcean, FAR_SEA_SIZE, FAR_SEA_Y, gerstnerHeight, OCEAN_BASE_CELL, OCEAN_LEVELS,
  OCEAN_RING_SEGMENTS, OCEAN_SIZE, WAVES,
} from '../../src/render/ocean'

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
 * 【遠海在守什麼】細浪面只有以鏡頭為中心的 10 km 見方，邊緣之外是天空球的
 * 下半部 —— 上帝視角爬到 12,000 m 就會看到海是一塊浮在天上的板子。遠海是
 * 一片跟著鏡頭走的巨大平面，把海接到地平線。
 */
describe('遠海', () => {
  it('遠大於細浪面', () => {
    expect(FAR_SEA_SIZE).toBeGreaterThan(OCEAN_SIZE * 20)
  })

  /**
   * 【這一條是「不會 z-fighting」的充要條件】遠海只要有任何一點高於細浪面的
   * 波谷，兩個面就會在 ±5 km 之內穿插。而它會跟著 `WAVES` 一起變 —— 有人加
   * 一道大浪、振幅和超過 3 m，這條就紅。那正是它存在的理由。
   */
  it('恆在所有波谷之下', () => {
    const maxAmp = WAVES.reduce((s, w) => s + w.amplitude, 0)
    expect(FAR_SEA_Y).toBeLessThan(-maxAmp)
  })

  it('update 讓遠海精確落在中心（不做格點對齊）', () => {
    const o = createOcean()
    // 刻意選一個**不是**格點倍數的中心：細浪面會被對齊到格點，遠海不該被
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
   * 【遠海必須先畫】它與細浪面只相距 3 m，而深度量化 `Δz ≈ z²/2²⁴`（近平面
   * 1 m）在 7,000 m 是 2.92 m、12,000 m 是 8.58 m —— 上帝視角 7,000 m 以上，
   * 整片細浪面（永遠是 ±5 km）的深度都與遠海分不出前後。
   *
   * 平手時誰贏由繪製順序決定，而 three 的不透明排序是
   * `renderOrder → material.id → z`（`painterSortStable`）——`material.id`
   * 排在 `z` 前面。沒有 `renderOrder` 的話順序只是「誰先 new 材質」的巧合，
   * 而預設的 `LessEqualDepth` 讓**後畫的贏**：遠海會把浪蓋掉。
   *
   * 負值讓遠海先畫，平手時細浪面與參照物勝出。仍須遠大於天空球的 −1000。
   */
  it('遠海排在細浪面之前畫，但仍在天空球之後', () => {
    const o = createOcean()
    expect(o.farMesh.renderOrder).toBeLessThan(o.mesh.renderOrder)
    expect(o.farMesh.renderOrder).toBeGreaterThan(-1000)
    o.dispose()
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
