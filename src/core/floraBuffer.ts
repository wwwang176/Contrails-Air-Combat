/** 植被放置器與顯示引擎共用的緊密緩衝區；來源只追加資料，不擁有 GPU 資源。 */

/** 一筆的欄位數：x, y, z, rotY, scale, tint */
export const FLORA_STRIDE = 6

/**
 * 植被的種類。**建築只有一種形狀**（`floraShapes.ts`），四種建築種類差的只是
 * 屋頂的料與牆色 —— 房子、穀倉、倉庫都用它，靠大小、樓高、顏色區分。
 */
export const enum FloraKind {
  BroadTree = 0,
  ConeTree = 1,
  Bush = 2,
  /** 新一點的黏土瓦、灰泥牆 */
  House = 3,
  /** 老黏土瓦（更暗）、磚木牆 */
  Barn = 4,
  Church = 5,
  /** 石板瓦、灰泥牆 */
  SlateHouse = 6,
  /** 油毛氈、磚木牆 */
  TarBarn = 7,
}

/**
 * 面寬與樓高的倍率怎麼存：一個位元組，`值 / SHAPE_ONE` 就是倍率（0～3.98）。
 * 樹一律是 1。
 *
 * 【為什麼是位元組不是浮點】tile 快取是 `MAX_PER_TILE × TILE_CACHE` 格，兩個
 * 浮點要多 6.4 MB，兩個位元組只多 1.6 MB；倍率只要 1/64 的精度。
 */
export const SHAPE_ONE = 64

/**
 * 一格 tile 的產出。**呼叫端預配、呼叫端歸零** —— 放置函數只 append，
 * 所以同一個 buffer 可以餵給好幾個來源。
 */
export interface FloraBuffer {
  readonly data: Float32Array
  readonly kind: Uint8Array
  /** 每一筆兩個位元組：面寬、樓高的倍率（見 `SHAPE_ONE`） */
  readonly shape: Uint8Array
  readonly capacity: number
  count: number
  /** 容量不足丟掉幾筆。**不得靜默截斷** —— 引擎會把它回報出去 */
  dropped: number
}

export function createFloraBuffer(capacity: number): FloraBuffer {
  return {
    data: new Float32Array(capacity * FLORA_STRIDE),
    kind: new Uint8Array(capacity),
    shape: new Uint8Array(capacity * 2),
    capacity,
    count: 0,
    dropped: 0,
  }
}

/** 倍率 → 位元組，夾在 1/64～3.98 */
function shapeByte(v: number): number {
  const q = Math.round(v * SHAPE_ONE)
  return q < 1 ? 1 : q > 255 ? 255 : q
}

/**
 * `wide` 是模型 x 軸（面寬）的額外倍率、`tall` 是 y 軸（樓高）的額外倍率，
 * 乘在 `scale` 之上；z 軸（進深）就是 `scale`。樹不給，兩者都是 1。
 */
export function pushFlora(
  out: FloraBuffer,
  x: number, y: number, z: number,
  rot: number, scale: number, tint: number, kind: FloraKind,
  wide = 1, tall = 1,
): void {
  if (out.count >= out.capacity) { out.dropped++; return }
  const o = out.count * FLORA_STRIDE
  out.data[o] = x
  out.data[o + 1] = y
  out.data[o + 2] = z
  out.data[o + 3] = rot
  out.data[o + 4] = scale
  out.data[o + 5] = tint
  out.kind[out.count] = kind
  out.shape[out.count * 2] = shapeByte(wide)
  out.shape[out.count * 2 + 1] = shapeByte(tall)
  out.count++
}

/**
 * 一個放置來源。把 `[x0, x1) × [z0, z1)` 這一格裡的植被 append 進 `out`。
 *
 * `heightAt` 是地面高度 —— 每一株的 `y` 直接放它，樹才不會浮空或陷地。
 */
export type FloraSource = (
  x0: number, z0: number, x1: number, z1: number,
  heightAt: (x: number, z: number) => number,
  out: FloraBuffer,
) => void
