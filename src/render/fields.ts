import { Color } from 'three'

/**
 * 諾曼第式的 Bocage 地景：**每一塊田都被樹籬完整圍起來。**
 *
 * ```
 *   粗的一層（區塊）   這一帶田的走向、尺寸、以及配色的基調
 *                     兩區的交界是一條凹路（sunken lane）
 *   細的一層（田）     區塊座標系裡的抖動矩形格。縱橫界線各自被推移，
 *                     所以田是不規則的四邊形，不是等大的方格
 * ```
 *
 * 【為什麼不是 Voronoi】Voronoi 長出來的是凸多邊形 —— 從空中看是碎石地坪
 * 或迷彩，不是農地。Bocage 的田是**接近矩形**的，而抖動的矩形格直接就是
 * 那個形狀。順帶它便宜得多：不必 3×3 鄰域搜尋，而且格線在區塊座標系裡
 * 軸對齊，所以「離田界多遠」本來就是世界公尺，不必修正方位。
 *
 * 【樹籬是主角，不是點綴】Bocage 的定義就是每塊田被土堤＋灌木＋喬木圍住。
 * 初稿把樹籬砍到只長一半、佔地 6.6%，那是開放田制（open-field）的樣子 ——
 * 帶狀田、樹籬稀疏。Bocage 的樹籬該佔到一成七，讀起來像一張綠色的網。
 *
 * 【為什麼不烘貼圖】要讓 18 m 的樹籬不鋸齒，30 km 見方需要 4096² 的貼圖
 * （7.3 m/texel），RGB 是 50 MB。在著色器裡算是解析的、與解析度無關，
 * **而且延伸到無限遠** —— 遠景環用同一支函式，圖案自動接得上。
 *
 * 【為什麼這不違背「不用 noise 函式庫」】`archipelago.ts` 的檔頭要的是
 * 「決定性天然成立、沒有第三方相依」。整數雜湊的閉式函數兩條都成立。
 *
 * 【GLSL 由這裡的常數產生，不是另抄一份】數字只有一個來源。演算法那幾行
 * 由 `fields.test.ts` 的金本位釘住，語法由 e2e 在真的 WebGL2 裡編譯來守。
 *
 * 【兩份唯一容許分家的地方：犁溝與作物條紋】它只在 GLSL 裡，因為抗鋸齒需要
 * 片段的導數（`fwidth`），CPU 沒有對應物。少了抗鋸齒，1 km 外整片田會出現
 * 摩爾紋 —— 比沒有條紋更糟。這個例外由 `fields.test.ts` 的「犁溝與作物條紋」
 * 那一組守著：條紋確實被呼叫，而 CPU 那一份確實沒有。
 */

/**
 * 田的短邊，m。
 *
 * 【比史實大，這是刻意的】實測 170 那一版的田是 p50 2.36 ha（等效邊長
 * 154 m）、p90 8.07 ha —— 中位數正好落在真實 Bocage 的 0.5～3 ha 中間，
 * 而 p90 已經比真實的大。但玩家是用 200 m/s 在 600 m 高度看它，那個尺度下
 * 150 m 的田是細節不是地貌。專案負責人 2026-08-29 裁定放大。
 */
export const FIELD_SPACING = 230

/** 田的長寬比。Bocage 的田是不規則四邊形，不是長條，所以不大 */
export const FIELD_ANISO = 1.55

/**
 * 每一區把田的尺寸乘上這個區間裡的一個數。大小因此成片地變。
 *
 * 【區間收窄過】原本是 [0.8, 1.6]，兩倍的跨距讓最小的那一撮太碎。
 */
export const FIELD_SPACING_VAR = [0.85, 1.35] as const

/**
 * 格線推移的幅度，格的比例。
 *
 * **必須 < 0.5** —— 大於一半的話相鄰兩條界線會交換次序，田會翻面。
 * 這一條由 `fields.test.ts` 的「格線恆遞增」守著。
 */
export const EDGE_JITTER = 0.26

/** 一塊田再對切一次的機率。田的大小因此有兩倍的變化 */
export const SPLIT_CHANCE = 0.35

/** 區塊的間距，m。一帶田共用走向與色調的範圍 */
export const REGION_SPACING = 3200

/** 樹籬的總寬度，m。土堤加灌木加喬木，由空中看到的那一條帶 */
export const HEDGE_WIDTH = 18

/**
 * 有多少比例的田界長樹籬。
 *
 * 【為什麼接近 1】**Bocage 的定義就是每塊田被完整圍起來。** 留一點缺口是
 * 給農路的出入口 —— 全滿反而假。
 */
export const HEDGE_CHANCE = 0.92

/** 凹路的寬度，m。兩區交界的那一條 */
export const TRACK_WIDTH = 20

/** 犁過的田的比例。與色調無關，散落在各處 */
const PLOUGH_CHANCE = 0.12

/**
 * 一塊田整片變成樹林（copse）的機率。
 *
 * 【放置與地色共用 `isWoodField`】`render/flora.ts` 用它決定要不要在這塊田裡
 * 填樹，`fieldSurfaceColor` 用它決定地色。兩邊分家的話，會出現「深綠的地上
 * 沒有樹」或「樹長在麥田裡」。
 */
export const WOOD_CHANCE = 0.05

/**
 * 作物色。**順序是一條漸層**（深綠 → 淺綠 → 麥金），因為每塊田是在
 * 「區塊的基調 ± 1」裡挑的 —— 索引相鄰就必須顏色相近，不然又變回雜訊。
 *
 * 【飽和度是原稿的 0.6】專案負責人 2026-08-29 試飛裁定。原稿的色相與明度
 * 都沒動，只把 HSL 的 S 乘 0.6 —— 樹籬、犁田、凹路一起。
 */
const PALETTE = [
  0x414d37, 0x4d5a40, 0x59664a, 0x677253,
  0x767e5c, 0x858863, 0x928f6a, 0xa09872,
] as const

/** 犁過的田。不在漸層上 —— 它是另一種地，不是另一個色調 */
const PLOUGHED = 0x615242

/** 樹籬。比任何一塊田都暗 —— 灌木加喬木的樹冠，而且自己有陰影 */
const HEDGE = 0x293123

/** 凹路。乾土色 */
const TRACK = 0x938b77

/** 樹林。比色盤最深的一階再暗，而且不在漸層上 —— 它是另一種地 */
const WOOD = 0x2f3a28

/** 犁溝與作物行的間距，m */
const STRIPE_PERIOD = 7

/** 條紋的明度幅度。犁田用兩倍 —— 那是溝，不是行 */
const STRIPE_AMP = 0.04

/** 世界座標的一個點。`regionSeed` 就地寫進它 */
export interface Vec2 {
  x: number
  z: number
}

/**
 * 一塊田被對切出來的那一刀。**它也是一條樹籬** —— 佔全部樹籬帶的 11.8%
 * （2026-08-29 實測），而它不在任何一條格線上。
 */
export interface SplitCut {
  /** 0 = 線上的 qx 固定（沿 qz 走）；1 = qz 固定（沿 qx 走） */
  axis: number
  /** 固定的那個座標 */
  at: number
  /** 線的兩端，在它延伸的那個軸上 */
  lo: number
  hi: number
}

export interface RegionSample {
  /** 到最近與次近的區塊種子的距離，m */
  r1: number
  r2: number
  /** 這一區的雜湊 */
  id: number
  /** 這一帶田的走向，rad */
  angle: number
  /** 這一帶田的短邊與長邊，m */
  cellW: number
  cellH: number
  /** 這一帶的基調在 `PALETTE` 上的位置 */
  tone: number
}

export interface FieldSample {
  /** 這一塊田的雜湊。田的身分 */
  id: number
  /** 到最近的一條田界有多遠，m */
  edge: number
  /** 最近那條田界長不長樹籬 */
  hedged: boolean
}

/**
 * 32 位元的兩維整數雜湊。**不得 `Math.random`** —— 見檔頭。
 *
 * 【與 `scatter.ts` 的 `hash01` 為什麼不共用】那一支吃一個索引，這裡要
 * 兩個座標而且要拿到 32 位元全部。
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
 * 第 `k` 條格線的位置，m。`salt` 分開縱線與橫線。
 *
 * **推移量必須小於半格**，否則相鄰兩條線會交換次序 —— 見 `EDGE_JITTER`。
 *
 * 【`export` 是給測試的】「格線恆遞增」是整個矩形格成立的前提，而由成品
 * 反推很難證明它。直接驗這一支便宜得多。
 */
export function edgeAt(k: number, cell: number, salt: number): number {
  return (k + (hash2(k, salt) / 4294967296 - 0.5) * 2 * EDGE_JITTER) * cell
}

/**
 * 第 `(i, j)` 格區塊的種子座標，寫進 `out`；回傳那一格的雜湊。
 *
 * 【為什麼要匯出】村落的站址是兩顆種子的中點（`render/flora.ts`）。在那邊
 * 重抄一次公式就是兩個真相 —— 一邊改了，村子會離開路面而且不會有人發現。
 */
export function regionSeed(i: number, j: number, out: Vec2): number {
  const h = hash2(i, j)
  out.x = (i + 0.5 + ((h & 0xffff) / 65536 - 0.5) * 0.76) * REGION_SPACING
  out.z = (j + 0.5 + ((h >>> 16) / 65536 - 0.5) * 0.76) * REGION_SPACING
  return h
}

/**
 * 由區塊的雜湊算出這一帶田的走向、格距與色調。**不碰 `r1` / `r2`。**
 *
 * 【為什麼要匯出】一格 tile 可能同時屬於好幾個區塊，走第二個區塊的格線時
 * 手上只有它的 `id`，沒有一個落在它裡面的座標可以拿去問 `regionAt`。
 */
export function regionParams(id: number, out: RegionSample): void {
  const rh = hash1(id)
  out.id = id
  out.angle = ((rh & 0xffff) / 65536) * Math.PI
  const scale = FIELD_SPACING_VAR[0]
    + ((rh >>> 16) / 65536) * (FIELD_SPACING_VAR[1] - FIELD_SPACING_VAR[0])
  out.cellW = FIELD_SPACING * scale
  out.cellH = FIELD_SPACING * scale * FIELD_ANISO
  // 【三角分佈，不是均勻】均勻抽的話四分之一的地是最深的綠、四分之一是
  // 最淡的金 —— 30 km 看下去區塊那一層自己會變成新的迷彩
  const th = hash1(rh)
  out.tone = (((th & 0xffff) % PALETTE.length) + ((th >>> 16) % PALETTE.length)) >> 1
}

/** `regionAt` 找種子用的暫存。熱路徑之外，但仍然不配置 */
const SEED: Vec2 = { x: 0, z: 0 }

/**
 * 世界座標落在哪一區，以及那一區的參數。就地寫進 `out`。
 *
 * 區塊本身是各向同性的 Voronoi —— 走向是它**給出來**的東西，不是它自己吃的。
 */
export function regionAt(x: number, z: number, out: RegionSample): void {
  const gx = Math.floor(x / REGION_SPACING)
  const gz = Math.floor(z / REGION_SPACING)
  let r1 = Infinity
  let r2 = Infinity
  let id = 0
  for (let dj = -1; dj <= 1; dj++) {
    for (let di = -1; di <= 1; di++) {
      const h = regionSeed(gx + di, gz + dj, SEED)
      const d = Math.hypot(x - SEED.x, z - SEED.z)
      if (d < r1) { r2 = r1; r1 = d; id = h } else if (d < r2) r2 = d
    }
  }
  regionParams(id, out)
  out.r1 = r1
  out.r2 = r2
}

/**
 * 第 `(c, r)` 格有沒有被對切；有的話把那條線寫進 `out`。
 *
 * **`fieldAt` 自己也呼叫它** —— 對切的公式只有這一份。走線的那一側
 * （`render/flora.ts`）要沿著這條線種樹，兩份公式一漂，樹就會離開樹籬。
 */
export function splitCut(
  c: number, r: number, reg: RegionSample, out: SplitCut,
): boolean {
  const cellHash = hash2(c ^ reg.id, r)
  if ((cellHash & 0xff) / 256 >= SPLIT_CHANCE) return false
  const colSalt = (r * 2 + 1) | 0
  const left = edgeAt(c, reg.cellW, colSalt)
  const right = edgeAt(c + 1, reg.cellW, colSalt)
  const bottom = edgeAt(r, reg.cellH, 1)
  const top = edgeAt(r + 1, reg.cellH, 1)
  const f = 0.34 + (((cellHash >>> 8) & 0xff) / 255) * 0.32
  // 【沿長邊切】切出來的兩半仍然接近方形，不是兩條長帶
  if (right - left >= top - bottom) {
    out.axis = 0
    out.at = left + (right - left) * f
    out.lo = bottom
    out.hi = top
  } else {
    out.axis = 1
    out.at = bottom + (top - bottom) * f
    out.lo = left
    out.hi = right
  }
  return true
}

/**
 * 這塊田是不是樹林。**放置與地色共用這一支** —— 見 `WOOD_CHANCE`。
 *
 * 【位元的挑選】`id` 的低 8 位被犁田用掉、8–15 位被色調用掉、16–23 位被
 * 明度抖動用掉。樹林用 24–31 位，四者互不相關。
 */
export function isWoodField(id: number): boolean {
  return ((id >>> 24) & 0xff) / 256 < WOOD_CHANCE
}

/**
 * 世界座標落在哪一塊田、離田界多遠、那條界有沒有樹籬。就地寫進 `out`。
 *
 * 【抖動的矩形格】區塊座標系裡，第 k 條縱線在
 * `(k ± EDGE_JITTER) × cellW`，橫線同理。推移量小於半格，所以由
 * `floor(q / cell)` 起算、左右各看一格就一定找得到自己那一格。
 *
 * 【再對切一次】`SPLIT_CHANCE` 的格子沿長邊再切一刀，田的大小因此有兩倍
 * 的變化。切線也是一條田界，一樣長樹籬。
 *
 * 熱路徑之外（測試與工具用；畫面上跑的是 GLSL 那一份），但仍然不配置。
 */
export function fieldAt(
  x: number, z: number, reg: RegionSample, out: FieldSample,
): void {
  const cos = Math.cos(-reg.angle)
  const sin = Math.sin(-reg.angle)
  // 【旋轉不改變距離】所以在這個座標系裡量到的就是世界的公尺
  const qx = x * cos - z * sin
  const qz = x * sin + z * cos

  // 【先定列】縱界的推移量帶著列號 —— 每一列各自錯開，縱線因此在每一條
  // 橫線上斷掉。不錯開的話縱橫線都貫穿整片，讀起來是方格土地測量，
  // 不是諾曼第的 bocage
  let r = Math.floor(qz / reg.cellH)
  if (qz < edgeAt(r, reg.cellH, 1)) r--
  else if (qz >= edgeAt(r + 1, reg.cellH, 1)) r++
  const colSalt = (r * 2 + 1) | 0

  // 自己那一欄。推移量 < 0.5 格，所以最多差一格
  let c = Math.floor(qx / reg.cellW)
  if (qx < edgeAt(c, reg.cellW, colSalt)) c--
  else if (qx >= edgeAt(c + 1, reg.cellW, colSalt)) c++

  const left = edgeAt(c, reg.cellW, colSalt)
  const right = edgeAt(c + 1, reg.cellW, colSalt)
  const bottom = edgeAt(r, reg.cellH, 1)
  const top = edgeAt(r + 1, reg.cellH, 1)

  // 四條邊各自的距離。`edgeKey` 記住最近的是哪一條 —— 樹籬長不長是
  // **那條邊**的性質，不是這塊田的
  let best = qx - left
  let edgeKey = hash2(c ^ colSalt, 0x51ed)
  const dr = right - qx
  if (dr < best) { best = dr; edgeKey = hash2((c + 1) ^ colSalt, 0x51ed) }
  const db = qz - bottom
  if (db < best) { best = db; edgeKey = hash2(r, 0x9e37) }
  const dt = top - qz
  if (dt < best) { best = dt; edgeKey = hash2(r + 1, 0x9e37) }

  // 【對切】沿長邊切一刀，切出來的兩半是兩塊田。公式在 `splitCut`
  const cellHash = hash2(c ^ reg.id, r)
  // 【不能叫 half】`half` 是 GLSL 的保留字，GLSL 那一份編不過。兩邊維持
  // 同一個名字，金本位測試才比得下去
  let part = 0
  if (splitCut(c, r, reg, CUT)) {
    const along = CUT.axis === 0 ? qx : qz
    const d = Math.abs(along - CUT.at)
    if (d < best) { best = d; edgeKey = cellHash ^ 0x1234 }
    part = along < CUT.at ? 0 : 1
  }

  out.id = hash1(cellHash ^ (part * 0x7f4a))
  out.edge = best
  out.hedged = hash1(edgeKey) / 4294967296 < HEDGE_CHANCE
}

/** `fieldAt` 問對切線用的暫存。呼叫端自己帶 `out`，所以不會互相踩 */
const CUT: SplitCut = { axis: 0, at: 0, lo: 0, hi: 0 }

const REG: RegionSample = {
  r1: 0, r2: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0,
}
const FLD: FieldSample = { id: 0, edge: 0, hedged: false }

/**
 * 地面在世界座標 (x, z) 的顏色。**這是 GLSL 那支 `fieldColorAt` 的 CPU 版。**
 *
 * 順序就是優先權：凹路壓過樹籬，樹籬壓過作物。
 */
export function fieldSurfaceColor(x: number, z: number, out: Color): Color {
  regionAt(x, z, REG)
  if (REG.r2 - REG.r1 < TRACK_WIDTH) return out.setHex(TRACK)

  fieldAt(x, z, REG, FLD)
  if (FLD.hedged && FLD.edge < HEDGE_WIDTH / 2) return out.setHex(HEDGE)

  const fh = FLD.id
  if (isWoodField(fh)) return out.setHex(WOOD)
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
const float EDGE_JITTER = ${EDGE_JITTER.toFixed(3)};
const float SPLIT_CHANCE = ${SPLIT_CHANCE.toFixed(3)};
const float REGION_SPACING = ${REGION_SPACING.toFixed(1)};
const float HEDGE_WIDTH = ${HEDGE_WIDTH.toFixed(1)};
const float HEDGE_CHANCE = ${HEDGE_CHANCE.toFixed(3)};
const float TRACK_WIDTH = ${TRACK_WIDTH.toFixed(1)};
const float PLOUGH_CHANCE = ${PLOUGH_CHANCE.toFixed(3)};
const float WOOD_CHANCE = ${WOOD_CHANCE.toFixed(3)};
const float STRIPE_PERIOD = ${STRIPE_PERIOD.toFixed(1)};
const float STRIPE_AMP = ${STRIPE_AMP.toFixed(3)};
const float SPACING_VAR_LO = ${FIELD_SPACING_VAR[0].toFixed(3)};
const float SPACING_VAR_HI = ${FIELD_SPACING_VAR[1].toFixed(3)};
const vec3 HEDGE_COLOR = ${rgb(HEDGE)};
const vec3 TRACK_COLOR = ${rgb(TRACK)};
const vec3 PLOUGHED_COLOR = ${rgb(PLOUGHED)};
const vec3 WOOD_COLOR = ${rgb(WOOD)};
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

bool isWoodField(uint id) {
  return float((id >> 24u) & 0xffu) / 256.0 < WOOD_CHANCE;
}

// 【條紋只在 GPU 上做】見檔頭。取樣不足時自動淡掉 —— 判準是片段的導數
// 而不是相機距離，因為遠景環與細節地形是兩個不同的物件，用距離兩邊會不一致
float stripe(vec2 q, float period, float amp) {
  float u = q.x / period;
  float fade = 1.0 - smoothstep(0.15, 0.5, fwidth(u));
  return 1.0 + amp * fade * (fract(u) < 0.5 ? 1.0 : -1.0);
}

// 【帶的邊緣走解析盒濾波】一個像素蓋到的地一超過帶寬，「在不在帶上」的
// 二選一就隨鏡頭微動翻面 —— 那是遠方線條爬行的原因。MSAA 幫不上忙：
// 它只解析幾何邊緣，而片段著色器一個像素只跑一次。
//
// d 是到帶中心線的距離（非負），halfW 是半寬，w 是像素在地面上的半足跡。
// 回傳的是那條帶在 [d - w, d + w] 這一段裡佔的比例。
//
// 【極限行為】w → 無限大時趨近 halfW / w，也就是那條帶在像素裡的真實面積
// 比：細線變淡，不是變寬。smoothstep 沒有這個
// 性質，它會把影響範圍撐到 halfW + w，遠處是一片過暗的灰霧。
//
// 【參數不能叫 half】那是 GLSL 的保留字。
float bandCoverage(float d, float halfW, float w) {
  return clamp((min(d + w, halfW) - max(d - w, 0.0)) / (2.0 * w), 0.0, 1.0);
}

float fieldEdgeAt(int k, float cell, int salt) {
  return (float(k) + (float(fieldHash2(k, salt)) / 4294967296.0 - 0.5)
    * 2.0 * EDGE_JITTER) * cell;
}

vec3 fieldColorAt(vec2 world) {
  // 【像素足跡，無條件、吃世界座標】導數指令在 fragment quad 內分歧時結果
  // 不可靠，所以不能放進任何分支；而 world 是內插的 varying，處處平滑。
  // **不得改用 best 自己的導數** —— best 是四條外框加一條切線取 min，在最近
  // 邊換手的角平分線上不可微，田角會長出楔形接縫
  float px = 0.5 * length(vec2(fwidth(world.x), fwidth(world.y)));

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
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 0.76;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 0.76;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
      float d = distance(world, seed);
      if (d < r1) { r2 = r1; r1 = d; rid = h; }
      else if (d < r2) { r2 = d; }
    }
  }
  uint rh = fieldHash1(rid);
  float angle = (float(rh & 0xffffu) / 65536.0) * 3.14159265;
  float scale = SPACING_VAR_LO
    + (float(rh >> 16u) / 65536.0) * (SPACING_VAR_HI - SPACING_VAR_LO);
  float cellW = FIELD_SPACING * scale;
  float cellH = FIELD_SPACING * scale * FIELD_ANISO;
  uint th = fieldHash1(rh);
  int tone = int(((th & 0xffffu) % ${PALETTE.length}u
    + (th >> 16u) % ${PALETTE.length}u) >> 1u);

  // ── 細的一層：抖動的矩形格 ──────────────────────
  float cs = cos(-angle);
  float sn = sin(-angle);
  vec2 q = vec2(world.x * cs - world.y * sn, world.x * sn + world.y * cs);

  int r = int(floor(q.y / cellH));
  if (q.y < fieldEdgeAt(r, cellH, 1)) r -= 1;
  else if (q.y >= fieldEdgeAt(r + 1, cellH, 1)) r += 1;
  int colSalt = r * 2 + 1;

  int c = int(floor(q.x / cellW));
  if (q.x < fieldEdgeAt(c, cellW, colSalt)) c -= 1;
  else if (q.x >= fieldEdgeAt(c + 1, cellW, colSalt)) c += 1;

  float left = fieldEdgeAt(c, cellW, colSalt);
  float right = fieldEdgeAt(c + 1, cellW, colSalt);
  float bottom = fieldEdgeAt(r, cellH, 1);
  float top = fieldEdgeAt(r + 1, cellH, 1);

  float best = q.x - left;
  uint edgeKey = fieldHash2(c ^ colSalt, 0x51ed);
  if (right - q.x < best) { best = right - q.x; edgeKey = fieldHash2((c + 1) ^ colSalt, 0x51ed); }
  if (q.y - bottom < best) { best = q.y - bottom; edgeKey = fieldHash2(r, 0x9e37); }
  if (top - q.y < best) { best = top - q.y; edgeKey = fieldHash2(r + 1, 0x9e37); }

  uint cellHash = fieldHash2(c ^ int(rid), r);
  uint part = 0u;
  if (float(cellHash & 0xffu) / 256.0 < SPLIT_CHANCE) {
    float f = 0.34 + (float((cellHash >> 8u) & 0xffu) / 255.0) * 0.32;
    if (right - left >= top - bottom) {
      float cut = left + (right - left) * f;
      if (abs(q.x - cut) < best) { best = abs(q.x - cut); edgeKey = cellHash ^ 0x1234u; }
      part = q.x < cut ? 0u : 1u;
    } else {
      float cut = bottom + (top - bottom) * f;
      if (abs(q.y - cut) < best) { best = abs(q.y - cut); edgeKey = cellHash ^ 0x1234u; }
      part = q.y < cut ? 0u : 1u;
    }
  }

  bool isHedge = float(fieldHash1(edgeKey)) / 4294967296.0 < HEDGE_CHANCE;

  uint fh = fieldHash1(cellHash ^ (part * 0x7f4au));
  bool wood = isWoodField(fh);

  bool ploughed = float(fh & 0xffu) / 256.0 < PLOUGH_CHANCE;
  vec3 col = wood ? WOOD_COLOR : PLOUGHED_COLOR;
  if (!wood && !ploughed) {
    int t = clamp(tone + int((fh >> 8u) % 3u) - 1, 0, ${PALETTE.length - 1});
    float k = 0.94 + (float((fh >> 16u) & 0xffu) / 255.0) * 0.12;
    col = FIELD_PALETTE[t] * k;
  }
  // 【犁田加倍、樹林沒有】溝比行深；樹林是林冠不是作物。條紋沿田的長軸走，
  // 所以重複發生在 q.x 上
  float amp = wood ? 0.0 : (ploughed ? STRIPE_AMP * 2.0 : STRIPE_AMP);
  col *= stripe(q, STRIPE_PERIOD, amp);
  // 【順序就是優先權】凹路壓過樹籬，樹籬壓過田 —— 與 fieldSurfaceColor 相同。
  // 兩條帶的半寬不一樣：凹路的判準是 r2 - r1 < TRACK_WIDTH，樹籬的是
  // best < HEDGE_WIDTH * 0.5
  col = mix(col, HEDGE_COLOR, isHedge ? bandCoverage(best, HEDGE_WIDTH * 0.5, px) : 0.0);
  col = mix(col, TRACK_COLOR, bandCoverage(r2 - r1, TRACK_WIDTH, px));
  return col;
}
`
