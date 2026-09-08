import { createFloraBuffer, FLORA_STRIDE, type FloraBuffer, type FloraSource } from './flora'

/**
 * 把一個散佈器包成「矩形內不長」。
 *
 * 先讓原本的散佈器跑進暫存緩衝，再只把落在矩形外的株搬進輸出 —— 散佈器
 * 本身一行不動，農地的樹籬、樹林、村落三支照舊。廠區的墊面用它：一塊
 * 化工廠的地上不會有樹籬與農舍。
 *
 * 【暫存與輸出同容量】搬運不會比原本多出任何一株，所以暫存滿了輸出也
 * 一定滿；`dropped` 照原樣傳回去，不靜默截斷。
 */
export interface ExcludeRect {
  readonly x0: number
  readonly z0: number
  readonly x1: number
  readonly z1: number
}

export function excluding(source: FloraSource, rect: ExcludeRect): FloraSource {
  let scratch: FloraBuffer | null = null
  return (x0, z0, x1, z1, heightAt, out) => {
    // 格子整個在矩形外就不必過濾 —— 絕大多數的格子走這一條
    if (x1 <= rect.x0 || x0 >= rect.x1 || z1 <= rect.z0 || z0 >= rect.z1) {
      source(x0, z0, x1, z1, heightAt, out)
      return
    }
    if (scratch === null || scratch.capacity < out.capacity) scratch = createFloraBuffer(out.capacity)
    scratch.count = 0
    scratch.dropped = 0
    source(x0, z0, x1, z1, heightAt, scratch)
    for (let i = 0; i < scratch.count; i++) {
      const o = i * FLORA_STRIDE
      const x = scratch.data[o]!
      const z = scratch.data[o + 2]!
      if (x >= rect.x0 && x < rect.x1 && z >= rect.z0 && z < rect.z1) continue
      if (out.count >= out.capacity) { out.dropped++; continue }
      const d = out.count * FLORA_STRIDE
      for (let k = 0; k < FLORA_STRIDE; k++) out.data[d + k] = scratch.data[o + k]!
      out.kind[out.count] = scratch.kind[i]!
      out.count++
    }
    out.dropped += scratch.dropped
  }
}
