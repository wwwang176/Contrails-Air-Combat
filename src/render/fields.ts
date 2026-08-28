import { Color } from 'three'

/**
 * 田區、防風林與農路。**兩層抖動網格的 Voronoi。**
 *
 * ```
 *   粗的一層（區塊）   決定這一帶的走向、田的尺寸、以及配色的基調
 *                     兩區的交界畫成一條農路
 *   細的一層（田）     在區塊的座標系裡切，所以整片田有共同的走向
 *                     兩塊田的交界有一半機率長樹籬
 * ```
 *
 * 【為什麼要兩層】只有一層的話每塊田大小一樣、都是凸的、而且相鄰兩塊的
 * 顏色完全不相關 —— 畫出來是迷彩，不是農地。真實的歐洲農地是**成片**的：
 * 同一帶的田有共同的走向與相近的色調，換一帶才換調子。
 *
 * 【各向異性做在度量上，網格維持正方形】田要長條，做法是把長軸方向的座標
 * 除以 `FIELD_ANISO` 之後再切 Voronoi。
 *
 * **不能改成「網格拉長、距離照舊」** —— 那樣 3×3 的鄰域搜尋會不夠。格子
 * 260 × 624 時，同一欄裡最近的種子可能遠到 595 m，而隔三欄的種子最近只有
 * 551 m；要保證正確得搜到 ±4 欄，也就是每個片段 27 顆種子而不是 9 顆。
 * 實測那個版本與 7×7 的暴力解差 **190 m**。
 *
 * 【代價：樹籬的門檻要隨方位修正】壓扁過的空間裡，`f2 − f1` 不是世界公尺。
 * 一條法線沿短軸的界，門檻就是 `HEDGE_WIDTH`；沿長軸的那些要除以
 * `FIELD_ANISO`。修正項是 `|(e.x, e.y / ANISO)|`，其中 `e` 是兩顆種子連線的
 * 單位向量 —— 見 `hedgeThreshold`。
 *
 * 【為什麼不烘貼圖】要讓 16 m 的樹籬不鋸齒，30 km 見方需要 4096² 的貼圖
 * （7.3 m/texel），RGB 是 50 MB。在著色器裡算是解析的、與解析度無關，
 * **而且延伸到無限遠** —— 遠景環用同一支函式，圖案自動接得上。
 *
 * 【為什麼這不違背「不用 noise 函式庫」】`archipelago.ts` 的檔頭要的是
 * 「決定性天然成立、沒有第三方相依」。整數雜湊的閉式函數兩條都成立。
 *
 * 【GLSL 由這裡的常數產生，不是另抄一份】數字只有一個來源。演算法那幾行
 * 由 `fields.test.ts` 的金本位釘住，語法由 e2e 在真的 WebGL2 裡編譯來守。
 */

/** 田的短軸間距，m。長軸是它乘上 `FIELD_ANISO` */
export const FIELD_SPACING = 260

/**
 * 田的長寬比。
 *
 * 【為什麼一定要有】各向同性的 Voronoi 長出來的是圓潤的六邊形，讀起來是
 * 碎石地坪。真實的耕地是長條的 —— 那是犁溝的方向決定的。
 */
export const FIELD_ANISO = 2.4

/** 每一區把 `FIELD_SPACING` 乘上這個區間裡的一個數。田的大小因此成片地變 */
export const FIELD_SPACING_VAR = [0.75, 1.5] as const

/**
 * 種子在自己那一格內的抖動，格的比例。
 *
 * **必須 < 0.5** —— 3×3 的鄰域搜尋要找得到最近與次近的種子，前提是任何
 * 種子都不會跑出自己那一格。`fields.test.ts` 拿 7×7 的暴力解對答案。
 */
export const FIELD_JITTER = 0.38

/** 區塊的間距，m。一帶田共用走向與色調的範圍 */
export const REGION_SPACING = 3800

/**
 * 樹籬的帶寬，m。
 *
 * 【它是 `f2 − f1` 的門檻，不是幾何寬度】在垂直平分線附近
 * `f2 − f1 ≈ 2 ×（到平分線的帶號距離）`，所以帶的總寬約等於這個數字。
 */
export const HEDGE_WIDTH = 16

/**
 * 有多少比例的田界長樹籬。
 *
 * 【為什麼不是全部】每一條邊都畫的話，17% 的地面是深綠線 —— 太多。真實的
 * 農地大概一半的邊界是樹籬，其餘只是作物換了，地上看不出線。
 */
export const HEDGE_CHANCE = 0.55

/** 農路的寬度，m。兩區交界的那一條 */
export const TRACK_WIDTH = 22

/** 犁過的田的比例。與色調無關，散落在各處 */
const PLOUGH_CHANCE = 0.12

/**
 * 作物色。**順序是一條漸層**（深綠 → 淺綠 → 麥金），因為每塊田是在
 * 「區塊的基調 ± 1」裡挑的 —— 索引相鄰就必須顏色相近，不然又變回雜訊。
 */
const PALETTE = [
  0x415430, 0x4d6238, 0x5a7040, 0x6a7d48,
  0x7c8a50, 0x8f9457, 0xa09b5c, 0xb0a262,
] as const

/** 犁過的田。不在漸層上 —— 它是另一種地，不是另一個色調 */
const PLOUGHED = 0x6b5238

/** 樹籬。比任何一塊田都暗 —— 從空中看就是一條深線 */
const HEDGE = 0x2c3a24

/** 農路。乾土色 */
const TRACK = 0x9c8f6e

export interface RegionSample {
  /** 到最近與次近的區塊種子的距離，m */
  r1: number
  r2: number
  /** 這一區的雜湊 */
  id: number
  /** 這一帶田的走向，rad。長軸就是這個方向 */
  angle: number
  /** 這一帶田的短軸，m。長軸是它乘上 `FIELD_ANISO` */
  cellW: number
  /** 這一帶的基調在 `PALETTE` 上的位置 */
  tone: number
}

export interface FieldSample {
  /** 到最近那顆種子的距離。**壓扁過的空間，不是世界公尺** */
  f1: number
  /** 到次近那顆種子的距離。同上 */
  f2: number
  /** 最近那一格的雜湊。田的身分 */
  id: number
  /** 次近那一格的雜湊。樹籬長不長要靠這一對決定 */
  id2: number
  /** `f2 − f1` 要與這個比，才等於世界座標的 `HEDGE_WIDTH`。見檔頭 */
  hedgeThreshold: number
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

/** 32 位元的整數再攪一次。要由同一顆雜湊取好幾個不相關的數時用它 */
function hash1(h: number): number {
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d)
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b)
  return (h ^ (h >>> 16)) >>> 0
}

/**
 * 世界座標落在哪一區，以及那一區的參數。就地寫進 `out`。
 *
 * 區塊本身是各向同性的 —— 走向是它**給出來**的東西，不是它自己吃的。
 */
export function regionAt(x: number, z: number, out: RegionSample): void {
  const gx = Math.floor(x / REGION_SPACING)
  const gz = Math.floor(z / REGION_SPACING)
  let r1 = Infinity
  let r2 = Infinity
  let id = 0
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = gx + di
      const j = gz + dj
      const h = hash2(i, j)
      const ox = ((h & 0xffff) / 65536 - 0.5) * 2 * FIELD_JITTER
      const oz = ((h >>> 16) / 65536 - 0.5) * 2 * FIELD_JITTER
      const sx = (i + 0.5 + ox) * REGION_SPACING
      const sz = (j + 0.5 + oz) * REGION_SPACING
      const d = Math.hypot(x - sx, z - sz)
      if (d < r1) { r2 = r1; r1 = d; id = h } else if (d < r2) r2 = d
    }
  }
  const rh = hash1(id)
  out.r1 = r1
  out.r2 = r2
  out.id = id
  out.angle = ((rh & 0xffff) / 65536) * Math.PI
  const scale = FIELD_SPACING_VAR[0]
    + ((rh >>> 16) / 65536) * (FIELD_SPACING_VAR[1] - FIELD_SPACING_VAR[0])
  out.cellW = FIELD_SPACING * scale
  // 【三角分佈，不是均勻】均勻抽的話四分之一的地是最深的綠、四分之一是
  // 最淡的金 —— 30 km 看下去是斑塊，區塊那一層自己變成新的迷彩。
  // 兩個均勻取平均之後極端值罕見，而中段的綠佔多數
  const th = hash1(rh)
  out.tone = (((th & 0xffff) % PALETTE.length) + ((th >>> 16) % PALETTE.length)) >> 1
}

/**
 * 世界座標落在哪一塊田、離田界多遠。就地寫進 `out`。
 *
 * 【壓扁之後再切】區塊的座標系裡把長軸除以 `FIELD_ANISO`，網格因此是
 * **正方形**的，3×3 的鄰域搜尋保證成立。映射回世界之後，田在長軸上被拉開
 * `FIELD_ANISO` 倍 —— 那正是要的長條。
 *
 * 【`f1`／`f2` 不是世界公尺】它們在壓扁過的空間裡。樹籬要用
 * `out.hedgeThreshold` 比，那一項把方位修正回來了。
 *
 * 熱路徑之外（測試與工具用；畫面上跑的是 GLSL 那一份），但仍然不配置。
 */
export function fieldAt(
  x: number, z: number, reg: RegionSample, out: FieldSample,
): void {
  const cos = Math.cos(-reg.angle)
  const sin = Math.sin(-reg.angle)
  // 區塊的座標系，長軸壓扁 FIELD_ANISO 倍
  const qx = x * cos - z * sin
  const qz = (x * sin + z * cos) / FIELD_ANISO
  const gx = Math.floor(qx / reg.cellW)
  const gz = Math.floor(qz / reg.cellW)
  let f1 = Infinity
  let f2 = Infinity
  let id = 0
  let id2 = 0
  let s1x = 0
  let s1z = 0
  let s2x = 0
  let s2z = 0
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const i = gx + di
      const j = gz + dj
      // 【摻進區塊的雜湊】不然相鄰兩區在同一個格線上會抽到同一批種子，
      // 交界兩側的田會對齊得很不自然
      const h = hash2(i ^ reg.id, j)
      const ox = ((h & 0xffff) / 65536 - 0.5) * 2 * FIELD_JITTER
      const oz = ((h >>> 16) / 65536 - 0.5) * 2 * FIELD_JITTER
      const sx = (i + 0.5 + ox) * reg.cellW
      const sz = (j + 0.5 + oz) * reg.cellW
      const d = Math.hypot(qx - sx, qz - sz)
      if (d < f1) {
        f2 = f1; id2 = id; s2x = s1x; s2z = s1z
        f1 = d; id = h; s1x = sx; s1z = sz
      } else if (d < f2) {
        f2 = d; id2 = h; s2x = sx; s2z = sz
      }
    }
  }
  out.f1 = f1
  out.f2 = f2
  out.id = id
  out.id2 = id2

  // 【把門檻換算回世界公尺】兩顆種子連線的單位向量 e（壓扁空間），世界位移
  // w 造成 f2 − f1 變化 2⟨w, (e.x, e.y / ANISO)⟩ —— 所以帶的世界寬度是
  // 門檻除以那個向量的長度。要讓它恆等於 HEDGE_WIDTH，門檻就乘上它
  const ex = s2x - s1x
  const ez = s2z - s1z
  const el = Math.hypot(ex, ez) || 1
  out.hedgeThreshold = HEDGE_WIDTH
    * Math.hypot(ex / el, ez / el / FIELD_ANISO)
}

const REG: RegionSample = { r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, tone: 0 }
const FLD: FieldSample = { f1: 0, f2: 0, id: 0, id2: 0, hedgeThreshold: 0 }

/**
 * 地面在世界座標 (x, z) 的顏色。**這是 GLSL 那支 `fieldColorAt` 的 CPU 版。**
 *
 * 順序就是優先權：農路壓過樹籬，樹籬壓過作物。
 */
export function fieldSurfaceColor(x: number, z: number, out: Color): Color {
  regionAt(x, z, REG)
  if (REG.r2 - REG.r1 < TRACK_WIDTH) return out.setHex(TRACK)

  fieldAt(x, z, REG, FLD)
  const fh = hash1(FLD.id)
  // 【樹籬的機率吃「這一對」的雜湊】用 XOR 是因為它對稱 —— 從田的兩側
  // 問同一條邊，必須得到同一個答案
  if (FLD.f2 - FLD.f1 < FLD.hedgeThreshold
    && hash1(FLD.id ^ FLD.id2) / 4294967296 < HEDGE_CHANCE) {
    return out.setHex(HEDGE)
  }

  if ((fh & 0xff) / 256 < PLOUGH_CHANCE) return out.setHex(PLOUGHED)

  // 【在區塊的基調 ±1 裡挑】色盤是一條漸層，所以相鄰的索引顏色相近
  let t = REG.tone + ((fh >>> 8) % 3) - 1
  if (t < 0) t = 0
  if (t >= PALETTE.length) t = PALETTE.length - 1
  out.setHex(PALETTE[t]!)
  // 【每塊田再抖一點亮度】同色調的兩塊田仍然分得出來，而且不會跳色
  const k = 0.94 + (((fh >>> 16) & 0xff) / 255) * 0.12
  return out.multiplyScalar(k)
}

const rgb = (hex: number): string => {
  const t = new Color().setHex(hex)
  return `vec3(${t.r.toFixed(4)}, ${t.g.toFixed(4)}, ${t.b.toFixed(4)})`
}

const glslPalette = PALETTE.map((c) => '  ' + rgb(c)).join(',\n')

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
const float FIELD_ANISO = ${FIELD_ANISO.toFixed(3)};
const float FIELD_JITTER = ${FIELD_JITTER.toFixed(3)};
const float REGION_SPACING = ${REGION_SPACING.toFixed(1)};
const float HEDGE_WIDTH = ${HEDGE_WIDTH.toFixed(1)};
const float HEDGE_CHANCE = ${HEDGE_CHANCE.toFixed(3)};
const float TRACK_WIDTH = ${TRACK_WIDTH.toFixed(1)};
const float PLOUGH_CHANCE = ${PLOUGH_CHANCE.toFixed(3)};
const float SPACING_VAR_LO = ${FIELD_SPACING_VAR[0].toFixed(3)};
const float SPACING_VAR_HI = ${FIELD_SPACING_VAR[1].toFixed(3)};
const vec3 HEDGE_COLOR = ${rgb(HEDGE)};
const vec3 TRACK_COLOR = ${rgb(TRACK)};
const vec3 PLOUGHED_COLOR = ${rgb(PLOUGHED)};
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

uint fieldHash1(uint h) {
  h = (h ^ (h >> 16u)) * 0x7feb352du;
  h = (h ^ (h >> 15u)) * 0x846ca68bu;
  return h ^ (h >> 16u);
}

vec3 fieldColorAt(vec2 world) {
  // ── 粗的一層：區塊 ──────────────────────────────
  float rgx = floor(world.x / REGION_SPACING);
  float rgz = floor(world.y / REGION_SPACING);
  float r1 = 1e20;
  float r2 = 1e20;
  uint rid = 0u;
  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int i = int(rgx) + di;
      int j = int(rgz) + dj;
      uint h = fieldHash2(i, j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
      float d = distance(world, seed);
      if (d < r1) { r2 = r1; r1 = d; rid = h; }
      else if (d < r2) { r2 = d; }
    }
  }
  if (r2 - r1 < TRACK_WIDTH) return TRACK_COLOR;

  uint rh = fieldHash1(rid);
  float angle = (float(rh & 0xffffu) / 65536.0) * 3.14159265;
  float scale = SPACING_VAR_LO
    + (float(rh >> 16u) / 65536.0) * (SPACING_VAR_HI - SPACING_VAR_LO);
  float cellW = FIELD_SPACING * scale;
  float cellH = FIELD_SPACING * scale * FIELD_ANISO;
  uint th = fieldHash1(rh);
  int tone = int(((th & 0xffffu) % ${PALETTE.length}u + (th >> 16u) % ${PALETTE.length}u) >> 1u);

  // ── 細的一層：田。長軸壓扁，網格因此是正方形 ──────
  float cs = cos(-angle);
  float sn = sin(-angle);
  vec2 q = vec2(
    world.x * cs - world.y * sn,
    (world.x * sn + world.y * cs) / FIELD_ANISO);
  float gx = floor(q.x / cellW);
  float gz = floor(q.y / cellW);
  float f1 = 1e20;
  float f2 = 1e20;
  uint id = 0u;
  uint id2 = 0u;
  vec2 s1 = vec2(0.0);
  vec2 s2 = vec2(0.0);
  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int i = int(gx) + di;
      int j = int(gz) + dj;
      uint h = fieldHash2(i ^ int(rid), j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 2.0 * FIELD_JITTER;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * cellW;
      float d = distance(q, seed);
      if (d < f1) { f2 = f1; id2 = id; s2 = s1; f1 = d; id = h; s1 = seed; }
      else if (d < f2) { f2 = d; id2 = h; s2 = seed; }
    }
  }

  // 【把門檻換算回世界公尺】見 fields.ts 檔頭的推導
  vec2 e = normalize(s2 - s1 + vec2(1e-9, 0.0));
  float hedge = HEDGE_WIDTH * length(vec2(e.x, e.y / FIELD_ANISO));

  uint fh = fieldHash1(id);
  if (f2 - f1 < hedge
    && float(fieldHash1(id ^ id2)) / 4294967296.0 < HEDGE_CHANCE) {
    return HEDGE_COLOR;
  }
  if (float(fh & 0xffu) / 256.0 < PLOUGH_CHANCE) return PLOUGHED_COLOR;

  int t = clamp(tone + int((fh >> 8u) % 3u) - 1, 0, ${PALETTE.length - 1});
  float k = 0.94 + (float((fh >> 16u) & 0xffu) / 255.0) * 0.12;
  return FIELD_PALETTE[t] * k;
}
`
