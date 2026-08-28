import { Color } from 'three'

/**
 * 田區與防風林。**同一個機制、兩個視覺** —— 抖動網格的 Voronoi，最近的種子
 * 決定田的顏色，最近與次近之差夠小就是兩塊田的交界，也就是防風林。
 *
 * 【為什麼不烘貼圖】要讓 26 m 的防風林不鋸齒，30 km 見方需要 4096² 的貼圖
 * （7.3 m/texel），RGB 是 50 MB。在著色器裡算是解析的、與解析度無關，
 * **而且延伸到無限遠** —— 遠景環用同一支函式，圖案自動接得上。
 *
 * 【為什麼這不違背「不用 noise 函式庫」】`archipelago.ts` 的檔頭要的是
 * 「決定性天然成立、沒有第三方相依」。整數雜湊的閉式函數兩條都成立。
 * 它不是 fBm。
 *
 * 【GLSL 由這裡的常數產生，不是另抄一份】`fogFactor` 那種「CPU 一份、
 * GLSL 一份」靠測試釘住，這裡數字只有一個來源。演算法那幾行則由
 * `fields.test.ts` 的金本位釘住，語法由 e2e 在真的 WebGL2 裡編譯來守。
 */

/** 種子網格的間距，m。一塊田的直徑就是這個量級 */
export const FIELD_SPACING = 340

/**
 * 種子在自己那一格內的抖動，格的比例。
 *
 * **必須 < 0.5** —— 3×3 的鄰域搜尋要找得到最近與次近的種子，前提是任何
 * 種子都不會跑出自己那一格。`fields.test.ts` 拿 7×7 的暴力解對答案。
 */
export const FIELD_JITTER = 0.38

/**
 * 防風林的帶寬，m。
 *
 * 【它是 `f2 − f1` 的門檻，不是幾何寬度】在垂直平分線附近
 * `f2 − f1 ≈ 2 × 到平分線的距離`，所以帶的總寬約等於這個數字。斜著穿過去
 * 會更寬，那是對的 —— 樹籬本來就不是等寬的。
 */
export const HEDGE_WIDTH = 26

/** 作物色。犁過的褐、幾種綠、麥黃、牧草 */
const PALETTE = [
  0x6b7f4a, 0x54683c, 0x7d8b52, 0x8f7a3e,
  0xa39152, 0x5f7444, 0x6e5c3a, 0x87954f,
] as const

/** 防風林的顏色。比任何一塊田都暗 —— 從空中看就是一條深線 */
const HEDGE = 0x2c3a24

export interface FieldSample {
  /** 到最近那顆種子的距離，m */
  f1: number
  /** 到次近那顆種子的距離，m */
  f2: number
  /** 最近那一格的雜湊。田的身分 */
  id: number
}

/**
 * 32 位元的兩維整數雜湊。**不得 `Math.random`** —— 見檔頭。
 *
 * 【與 `scatter.ts` 的 `hash01` 為什麼不共用】那一支吃一個索引，這裡要
 * 兩個座標而且要拿到 32 位元全部（低 16 位與高 16 位各給一個方向的抖動）。
 */
function hash2(i: number, j: number): number {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul(j | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  return (h ^ (h >>> 13)) >>> 0
}

/**
 * 世界座標 (x, z) 落在哪一塊田、離交界多遠。就地寫進 `out`。
 *
 * 熱路徑之外（測試與工具用；畫面上跑的是 GLSL 那一份），但仍然不配置。
 */
export function fieldAt(x: number, z: number, out: FieldSample): void {
  const gx = Math.floor(x / FIELD_SPACING)
  const gz = Math.floor(z / FIELD_SPACING)
  let f1 = Infinity
  let f2 = Infinity
  let id = 0
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = gx + di
      const j = gz + dj
      const h = hash2(i, j)
      const ox = ((h & 0xffff) / 65536 - 0.5) * 2 * FIELD_JITTER
      const oz = ((h >>> 16) / 65536 - 0.5) * 2 * FIELD_JITTER
      const sx = (i + 0.5 + ox) * FIELD_SPACING
      const sz = (j + 0.5 + oz) * FIELD_SPACING
      const d = Math.hypot(x - sx, z - sz)
      if (d < f1) { f2 = f1; f1 = d; id = h } else if (d < f2) f2 = d
    }
  }
  out.f1 = f1
  out.f2 = f2
  out.id = id
}

/** 田的顏色。`id` 是 `fieldAt` 給的雜湊 */
export function fieldColor(id: number, out: Color): Color {
  return out.setHex(PALETTE[(id >>> 8) % PALETTE.length]!)
}

const glslPalette = PALETTE
  .map((c) => {
    const t = new Color().setHex(c)
    return `  vec3(${t.r.toFixed(4)}, ${t.g.toFixed(4)}, ${t.b.toFixed(4)})`
  })
  .join(',\n')

const hedge = new Color().setHex(HEDGE)

/**
 * 上面那一切的 GLSL。提供 `vec3 fieldColorAt(vec2 world)`。
 *
 * 細節地形與遠景環共用它，而且因為吃的是**世界座標**，圖案釘在地上 ——
 * 與網格怎麼擺、切成幾塊完全無關。
 *
 * 【GLSL 版本】three 對內建材質一律加 `#version 300 es`
 * （`WebGLProgram` 的 `versionString`），所以 `uint`、位移、`const vec3[]`
 * 與非常數索引都合法。
 */
export const FIELD_GLSL = `
const float FIELD_SPACING = ${FIELD_SPACING.toFixed(1)};
const float FIELD_JITTER = ${FIELD_JITTER.toFixed(3)};
const float HEDGE_WIDTH = ${HEDGE_WIDTH.toFixed(1)};
const vec3 HEDGE_COLOR = vec3(${hedge.r.toFixed(4)}, ${hedge.g.toFixed(4)}, ${hedge.b.toFixed(4)});
const vec3 FIELD_PALETTE[${PALETTE.length}] = vec3[${PALETTE.length}](
${glslPalette}
);

// 與 fields.ts 的 hash2 逐位元相同。GLSL 沒有 imul，但 uint 乘法本來就是
// 模 2³²，所以直接乘就是同一件事
uint fieldHash2(int i, int j) {
  uint h = uint(i) * 0x27d4eb2du ^ uint(j) * 0x85ebca6bu;
  h = (h ^ (h >> 15u)) * 0x2545f491u;
  return h ^ (h >> 13u);
}

vec3 fieldColorAt(vec2 world) {
  float gx = floor(world.x / FIELD_SPACING);
  float gz = floor(world.y / FIELD_SPACING);
  float f1 = 1e20;
  float f2 = 1e20;
  uint id = 0u;
  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int i = int(gx) + di;
      int j = int(gz) + dj;
      uint h = fieldHash2(i, j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * FIELD_SPACING;
      float d = distance(world, seed);
      if (d < f1) { f2 = f1; f1 = d; id = h; }
      else if (d < f2) { f2 = d; }
    }
  }
  if (f2 - f1 < HEDGE_WIDTH) return HEDGE_COLOR;
  return FIELD_PALETTE[int((id >> 8u) % uint(${PALETTE.length}))];
}
`
