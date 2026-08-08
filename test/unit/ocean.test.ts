import { describe, it, expect } from 'vitest'
import {
  createOcean, FAR_SEA_SIZE, FAR_SEA_Y, gerstnerHeight, OCEAN_SEGMENTS, OCEAN_SIZE, WAVES,
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

  it('細浪面仍然對齊到格點', () => {
    const o = createOcean()
    o.update(3, 1234.5, -6789.25)
    const cell = OCEAN_SIZE / OCEAN_SEGMENTS
    // 【不能用 `pos % cell`】cell = 52.083333333333336，而 24 × cell 的實數
    // 值是 1250.000000000000006…，浮點乘積回捨成剛好 1250 —— 於是
    // `1250 % cell` 得到的是 52.0833…（近乎一整格）而不是 0。實測 x 那一條
    // 必紅、z 那一條碰巧綠。改成看「除以 cell 之後離最近整數多遠」。
    const qx = o.mesh.position.x / cell
    const qz = o.mesh.position.z / cell
    expect(qx - Math.round(qx)).toBeCloseTo(0, 6)
    expect(qz - Math.round(qz)).toBeCloseTo(0, 6)
    o.dispose()
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
