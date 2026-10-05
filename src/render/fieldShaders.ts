import { Color } from 'three'
import { canopyColor, FIELD_COLORS, FLORA_COLORS, PALETTE_STEPS, type Season } from './season'
import { BROAD_CROWN_R, CONE_CROWN_R } from '../specs/flora'
import { scarsGlsl, SCARS_DECL, SCARS_FN } from './battleScars'
import {
  FIELD_SPACING, FIELD_ANISO, FIELD_SPACING_VAR, EDGE_JITTER, SPLIT_CHANCE, REGION_SPACING,
  HEDGE_WIDTH, HEDGE_FAR_GROW, HEDGE_FAR_SHADE, TREE_DOT_SHADE, TRACK_WIDTH, TRACK_RIPPLE,
  TRACK_WARP, WOOD_CHANCE, FIELD_REACH, REACH_NOISE_CELL, OPEN_WOOD_CELL, OPEN_TONE_CELL,
  WOOD_GRID, OPEN_WOOD_DENSITY, OPEN_TREE_SCALE, OPEN_CONIFER_SHARE, OPEN_DOT_AA,
  OPEN_DOT_REACH, OPEN_WOOD_NEAR_MARGIN, CONIFER_SHARE, VILLAGE_CHANCE, REGION_CANDIDATE_CELL,
  REGION_CANDIDATE_SUB, STEPPE_LAYOUT, BELT_CHANCE,
} from './fields'
import {
  type SiteBelts, type SiteLayout, CONCRETE, ASPHALT, BALLAST, GRIME_CELL, SLAB_CELL, FINE_CELL,
  EDGE_CELL, COARSE_CELL, PAD_SKIRT, CORNER_CUTS, CORNER_SALT, CORNER_SLACK, type PadRect,
  edgeBite, coarseBite, fineBite, siteBounds, roadBounds, segmentsOf,
} from './siteSurface'

/**
 * 色值不在這個檔案。作物色盤、犁田、樹籬、凹路、樹林與犁田比例都由季節
 * 決定（`season.ts`）；這裡只管圖案。**作物色盤是一條漸層**，因為每塊田是
 * 在「區塊的基調 ± 1」裡挑的 —— 索引相鄰就必須顏色相近，不然又變回雜訊。
 */

/** 犁溝與作物行的間距，m */
const STRIPE_PERIOD = 7

/**
 * 條紋的明度幅度。犁田用兩倍 —— 那是溝，不是行。
 *
 * 【為什麼這麼深】離鏡頭遠一點的田是烘在 2 m 一格的 clipmap 上的，條紋在那裡
 * 只剩約三分之二（`stripe` 依取樣密度淡掉），再經 mipmap 平均又更淡；淺了的話
 * 那一圈以外就看不出條紋。7.3 m 一格的遠圖畫不出 7 m 的條紋，多深都一樣。
 */
const STRIPE_AMP = 0.08

const rgb = (hex: number): string => vec3Of(new Color().setHex(hex))

const vec3Of = (t: Color): string => `vec3(${t.r.toFixed(4)}, ${t.g.toFixed(4)}, ${t.b.toFixed(4)})`

/** 查候選表時多出來的宣告。uniform 由 `farmGround.ts` 的 `applyFields` 提供 */
const CANDIDATE_DECL_GLSL = `
const float REGION_CANDIDATE_CELL = ${REGION_CANDIDATE_CELL.toFixed(1)};
const int REGION_CANDIDATE_SUB = ${REGION_CANDIDATE_SUB};
uniform highp usampler2D uRegionCand;
// 表左下角的區塊格 (x, z) 與區塊格數 (x, z)
uniform ivec4 uRegionCandRect;`

/**
 * 區塊搜尋的查表版，接在 `r1`、`r2`、`rid` 宣告之後；候選數 15 或在表外時
 * 落進後面原封不動的完整搜尋。與 `regionAtPruned` 同一套索引。
 *
 * 【小格索引由 rgx、rgz 推】不另外由世界座標直接算，否則在區塊格邊上兩個
 * floor 可能各落一邊，查到的是另一格區塊的候選。
 */
const CANDIDATE_LOOKUP_GLSL = `  uint candN = 15u;
  uvec4 cand = uvec4(0u);
  ivec2 candBlock = ivec2(int(rgx), int(rgz)) - uRegionCandRect.xy;
  if (all(greaterThanEqual(candBlock, ivec2(0))) && all(lessThan(candBlock, uRegionCandRect.zw))) {
    vec2 local = world - vec2(rgx, rgz) * REGION_SPACING;
    ivec2 sub = clamp(ivec2(floor(local / REGION_CANDIDATE_CELL)), ivec2(0), ivec2(REGION_CANDIDATE_SUB - 1));
    cand = texelFetch(uRegionCand, candBlock * REGION_CANDIDATE_SUB + sub, 0);
    candN = cand.r & 15u;
  }
  if (candN < 15u) {
    for (uint s = 1u; s <= candN; s++) {
      uint k = (cand[int(s >> 1u)] >> ((s & 1u) * 4u)) & 15u;
      int i = int(rgx) + int(k % 3u) - 1;
      int j = int(rgz) + int(k / 3u) - 1;
      uint h = fieldHash2(i, j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 0.76;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 0.76;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
      float d = distance(world, seed);
      if (d < r1) { r2 = r1; s2 = s1; r1 = d; s1 = seed; rid = h; }
      else if (d < r2) { r2 = d; s2 = seed; }
    }
  } else {
`

/**
 * 上面那一切的 GLSL。提供 `vec3 fieldColorAt(vec2 world)`。
 *
 * 細節地形與遠景環共用它，而且因為吃的是**世界座標**，圖案釘在地上 ——
 * 與網格怎麼擺、切成幾塊完全無關。
 *
 * 【GLSL 版本】three 對內建材質一律加 `#version 300 es`
 * （`WebGLProgram` 的 `versionString`），所以 `uint`、位移、`const vec3[]`
 * 與非常數索引都合法。
 *
 * 【吃季節】色值烘進字串，所以一個季節一份字串；圖案的常數兩份相同。
 * 呼叫端換了字串就要換材質的 `customProgramCacheKey`（`farmGround.ts`）。
 *
 * `candidates` 為真時多一段查候選表（`buildRegionCandidates`）的剪枝，
 * 材質要提供 `uRegionCand` 與 `uRegionCandRect` 兩個 uniform。
 */
export function fieldGlsl(season: Season, candidates = false, open = false): string {
  const base = fieldGlslBase(season, candidates)
  // 【草原田沒有「空地」】整片都是田（大田、牧草地、田埂），沒有田圍著村那一套
  if (!open || FIELD_COLORS[season].layout === 'steppe') return base
  // 【空地疊在條紋之後】空地沒有條紋、沒有樹籬；凹路照舊壓在上面
  const at = base.indexOf('  col = mix(col, mix(HEDGE_COLOR')
  const decl = base.indexOf('vec3 fieldColorAt(')
  return base.slice(0, decl) + openDeclGlsl(season) + base.slice(decl, at) + OPEN_PARCEL_GLSL + base.slice(at)
}

/**
 * `open` 的地圖多出來的常數與函式：值雜訊、到村的距離、地塊是不是空地、空地的
 * 地色。與 CPU 那一份（`valueNoise`、`villageDistance`、`isOpenParcel`、
 * `openColor`）逐項對應
 */
function openDeclGlsl(season: Season): string {
  const c = FIELD_COLORS[season]
  return `const float FIELD_REACH = ${FIELD_REACH.toFixed(1)};
const float REACH_NOISE_CELL = ${REACH_NOISE_CELL.toFixed(1)};
const float VILLAGE_CHANCE = ${VILLAGE_CHANCE.toFixed(3)};
const vec3 OPEN_COLOR = ${rgb(c.open)};
const vec3 OPEN_ALT_COLOR = ${rgb(c.openAlt)};

float fieldNoise(vec2 p, float cell, int salt) {
  vec2 f = p / cell;
  vec2 i = floor(f);
  vec2 t = f - i;
  t = t * t * (3.0 - 2.0 * t);
  int ix = int(i.x);
  int iz = int(i.y);
  float n00 = float(fieldHash2(ix ^ salt, iz)) / 4294967296.0;
  float n10 = float(fieldHash2((ix + 1) ^ salt, iz)) / 4294967296.0;
  float n01 = float(fieldHash2(ix ^ salt, iz + 1)) / 4294967296.0;
  float n11 = float(fieldHash2((ix + 1) ^ salt, iz + 1)) / 4294967296.0;
  return mix(mix(n00, n10, t.x), mix(n01, n11, t.x), t.y);
}

vec2 regionSeedOf(int i, int j, uint h) {
  float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 0.76;
  float oz = (float(h >> 16u) / 65536.0 - 0.5) * 0.76;
  return (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
}

float villageDistance(vec2 w) {
  int gx = int(floor(w.x / REGION_SPACING));
  int gz = int(floor(w.y / REGION_SPACING));
  float best = 1e20;
  for (int j = gz - 2; j <= gz + 1; j++) {
    for (int i = gx - 2; i <= gx + 1; i++) {
      uint h = fieldHash2(i, j);
      if (float((h >> 7u) & 0xffu) / 256.0 >= VILLAGE_CHANCE) continue;
      bool alongX = ((h >> 5u) & 1u) == 0u;
      int i2 = alongX ? i + 1 : i;
      int j2 = alongX ? j : j + 1;
      vec2 site = (regionSeedOf(i, j, h) + regionSeedOf(i2, j2, fieldHash2(i2, j2))) * 0.5;
      best = min(best, distance(w, site));
    }
  }
  return best;
}

bool isOpenParcel(vec2 centre, uint fh) {
  float reach = FIELD_REACH * (0.7 + 0.6 * fieldNoise(centre, REACH_NOISE_CELL, 0x4d21));
  float fieldness = 1.0 - smoothstep(0.8 * reach, 1.2 * reach, villageDistance(centre));
  float th = 0.25 + 0.5 * (float(fieldHash1(fh ^ 0x0be5u) & 0xffu) / 255.0);
  return fieldness <= th;
}

float openWoodNoise(vec2 w) {
  return 0.65 * fieldNoise(w, ${OPEN_WOOD_CELL[0].toFixed(1)}, 0x6a11)
    + 0.35 * fieldNoise(w, ${OPEN_WOOD_CELL[1].toFixed(1)}, 0x3b57);
}

float openWoodCover(vec2 w) {
  return smoothstep(${c.woodGate[0].toFixed(3)}, ${c.woodGate[1].toFixed(3)}, openWoodNoise(w));
}

vec3 openColorAt(vec2 w) {
  vec3 c = mix(OPEN_COLOR, OPEN_ALT_COLOR, fieldNoise(w, ${OPEN_TONE_CELL.toFixed(1)}, 0x1f7e));
  return mix(c, mix(WOOD_COLOR, BROAD_FAR_COLOR, fieldFar), openWoodCover(w));
}

// 【空地的樹一棵一棵畫成點】與植被（flora.ts 的 woods／openTree）同一套：16 m 網格一格
// 一個候選點，雜湊定位置，照覆蓋率接受，雜湊定大小與樹種。格裡的點離這一點最遠一個
// 樹冠半徑，看周圍 3×3 格就夠
const float WOOD_GRID = ${WOOD_GRID.toFixed(1)};
const float OPEN_WOOD_DENSITY = ${OPEN_WOOD_DENSITY.toFixed(3)};
const float OPEN_TREE_SCALE_LO = ${OPEN_TREE_SCALE[0].toFixed(3)};
const float OPEN_TREE_SCALE_HI = ${OPEN_TREE_SCALE[1].toFixed(3)};
const float OPEN_CONIFER_SHARE = ${OPEN_CONIFER_SHARE.toFixed(3)};
const float BROAD_CROWN_R = ${BROAD_CROWN_R.toFixed(1)};
const float CONE_CROWN_R = ${CONE_CROWN_R.toFixed(1)};
const float OPEN_WOOD_GATE_LO = ${c.woodGate[0].toFixed(3)};
const float OPEN_WOOD_GATE_HI = ${c.woodGate[1].toFixed(3)};
const float OPEN_WOOD_NEAR_MARGIN = ${OPEN_WOOD_NEAR_MARGIN.toFixed(5)};
const float OPEN_DOT_AA = ${OPEN_DOT_AA.toFixed(1)};
const float OPEN_DOT_REACH = ${OPEN_DOT_REACH.toFixed(1)};

vec3 openTreesOver(vec2 w, vec3 col, float px) {
  // 【先用這一點的雜訊夾】蓋得到這一點的樹離它不到 OPEN_DOT_REACH，那段距離裡雜訊變
  // 不到 MARGIN：候選樹的接受門檻夾在 acceptLo 與 acceptHi 之間，只有落在中間的才算雜訊。
  // 整圈都長不出樹的點直接跳過
  float nw = openWoodNoise(w);
  if (nw < OPEN_WOOD_GATE_LO - OPEN_WOOD_NEAR_MARGIN) return col;
  float acceptLo = smoothstep(OPEN_WOOD_GATE_LO, OPEN_WOOD_GATE_HI, nw - OPEN_WOOD_NEAR_MARGIN) * OPEN_WOOD_DENSITY;
  float acceptHi = smoothstep(OPEN_WOOD_GATE_LO, OPEN_WOOD_GATE_HI, nw + OPEN_WOOD_NEAR_MARGIN) * OPEN_WOOD_DENSITY;
  float aa = min(px, OPEN_DOT_AA);
  ivec2 c0 = ivec2(floor(w / WOOD_GRID));
  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int gx = c0.x + di;
      int gz = c0.y + dj;
      uint h = fieldHash2(gx, gz);
      uint g = fieldHash1(h);
      vec2 p = vec2(float(gx) + 0.15 + float(h) / 4294967296.0 * 0.7,
        float(gz) + 0.15 + float(g) / 4294967296.0 * 0.7) * WOOD_GRID;
      float d = distance(w, p);
      if (d >= OPEN_DOT_REACH) continue;
      uint g2 = fieldHash1(g);
      float u = float(g2 & 0xffffu) / 65536.0;
      if (u >= acceptHi) continue;
      if (u >= acceptLo && u >= openWoodCover(p) * OPEN_WOOD_DENSITY) continue;
      uint g3 = fieldHash1(g2);
      float scale = OPEN_TREE_SCALE_LO + float(g3 & 0xffffu) / 65536.0 * (OPEN_TREE_SCALE_HI - OPEN_TREE_SCALE_LO);
      bool cone = float((g3 >> 24u) & 0xffu) / 256.0 < OPEN_CONIFER_SHARE;
      float r = (cone ? CONE_CROWN_R : BROAD_CROWN_R) * scale;
      // 邊緣照像素足跡抗鋸齒
      float cov = clamp((r - d) / (2.0 * aa) + 0.5, 0.0, 1.0);
      col = mix(col, cone ? CONE_FAR_COLOR : BROAD_FAR_COLOR, cov);
    }
  }
  return col;
}

`
}

/**
 * 插在條紋之後、樹籬之前：這一塊地的中心（對切過的取那一半）轉回世界座標，
 * 是空地就換成空地的地色、不畫樹籬
 */
const OPEN_PARCEL_GLSL = `  vec2 pq = vec2((left + right) * 0.5, (bottom + top) * 0.5);
  if (float(cellHash & 0xffu) / 256.0 < SPLIT_CHANCE) {
    float pf = 0.34 + (float((cellHash >> 8u) & 0xffu) / 255.0) * 0.32;
    if (right - left >= top - bottom) {
      float pcut = left + (right - left) * pf;
      pq.x = part == 0u ? (left + pcut) * 0.5 : (pcut + right) * 0.5;
    } else {
      float pcut = bottom + (top - bottom) * pf;
      pq.y = part == 0u ? (bottom + pcut) * 0.5 : (pcut + top) * 0.5;
    }
  }
  // 【轉差值，不轉座標】q 是上萬公尺，有的 GPU 的 cos、sin 誤差乘上去差將近一公尺，
  // 跨過門檻就與 CPU 判得不一樣（地色是田、樹卻當空地長）；中心離這個像素只有
  // 一兩百公尺
  vec2 dq = pq - q;
  vec2 parcel = world + vec2(dq.x * cos(angle) - dq.y * sin(angle), dq.x * sin(angle) + dq.y * cos(angle));
  if (isOpenParcel(parcel, fh)) {
    col = openColorAt(world);
    if (fieldTrees > 0.5) col = openTreesOver(world, col, px);
    isHedge = false;
  }
`

function fieldGlslBase(season: Season, candidates: boolean): string {
  const c = FIELD_COLORS[season]
  const steppe = c.layout === 'steppe'
  const S = STEPPE_LAYOUT
  const glslPalette = c.palette.map((h) => '  ' + rgb(h)).join(',\n')
  return `
const float FIELD_SPACING = ${(steppe ? S.spacing : FIELD_SPACING).toFixed(1)};
const float FIELD_ANISO = ${(steppe ? S.aniso : FIELD_ANISO).toFixed(3)};
const float EDGE_JITTER = ${(steppe ? S.edgeJitter : EDGE_JITTER).toFixed(3)};
const float SPLIT_CHANCE = ${(steppe ? 0 : SPLIT_CHANCE).toFixed(3)};
const float REGION_SPACING = ${REGION_SPACING.toFixed(1)};${candidates ? CANDIDATE_DECL_GLSL : ''}
const float HEDGE_WIDTH = ${(steppe ? S.ridge : HEDGE_WIDTH).toFixed(1)};
const float HEDGE_CHANCE = ${(steppe ? 1 : c.hedgeChance).toFixed(3)};
const float TRACK_WIDTH = ${TRACK_WIDTH.toFixed(1)};
const float PLOUGH_CHANCE = ${c.ploughChance.toFixed(3)};
const float WOOD_CHANCE = ${(steppe ? S.pasture : WOOD_CHANCE).toFixed(3)};
const float STRIPE_PERIOD = ${STRIPE_PERIOD.toFixed(1)};
const float STRIPE_AMP = ${STRIPE_AMP.toFixed(3)};
const float SPACING_VAR_LO = ${(steppe ? S.spacingVar[0] : FIELD_SPACING_VAR[0]).toFixed(3)};
const float SPACING_VAR_HI = ${(steppe ? S.spacingVar[1] : FIELD_SPACING_VAR[1]).toFixed(3)};
const vec3 HEDGE_COLOR = ${rgb(c.hedge)};
const vec3 HEDGE_FAR_COLOR = ${steppe ? rgb(c.hedge) : vec3Of(canopyColor(FLORA_COLORS[season].broadLeaf).multiplyScalar(HEDGE_FAR_SHADE))};
const float HEDGE_FAR_GROW = ${(steppe ? 1 : HEDGE_FAR_GROW).toFixed(3)};
// 【遠處的樣子】1 = 植被圈外（樹籬的樹不畫了），樹籬畫成放寬的林冠色。呼叫端在
// fieldColorAt 之前設；近處與內圈留 0，那裡有真的樹
float fieldFar = 0.0;
// 【樹一棵一棵畫成點】1 = 烘遠圖：植被圈外樹不畫，地上留的是每一棵樹的點。只在烘圖
// 時開 —— 每個像素要重算周圍九格的候選樹，逐幀的算式付不起
float fieldTrees = 0.0;
const vec3 TRACK_COLOR = ${rgb(c.track)};
const vec3 PLOUGHED_COLOR = ${rgb(c.ploughed)};
const vec3 WOOD_COLOR = ${rgb(c.wood)};
// 【遠處的林子是樹冠的顏色】植被圈外樹不畫，樹林田與空地的林子畫成樹冠從空中看
// 的顏色（與遠圖裡一棵一棵的點同色）；近處那裡有真的樹，照舊是林地的深色
const vec3 BROAD_FAR_COLOR = ${vec3Of(canopyColor(FLORA_COLORS[season].broadLeaf).multiplyScalar(TREE_DOT_SHADE))};
const vec3 CONE_FAR_COLOR = ${vec3Of(canopyColor(FLORA_COLORS[season].conifer).multiplyScalar(TREE_DOT_SHADE))};
const float CONIFER_SHARE = ${CONIFER_SHARE.toFixed(3)};
const vec3 FIELD_PALETTE[${PALETTE_STEPS}] = vec3[${PALETTE_STEPS}](
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
${trackGlsl()}
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
  // 最近與次近的種子：凹路是它們的交界（trackGap）
  vec2 s1 = vec2(0.0);
  vec2 s2 = vec2(0.0);
${candidates ? CANDIDATE_LOOKUP_GLSL : ''}  for (int dj = -1; dj <= 1; dj++) {
    for (int di = -1; di <= 1; di++) {
      int i = int(rgx) + di;
      int j = int(rgz) + dj;
      uint h = fieldHash2(i, j);
      float ox = (float(h & 0xffffu) / 65536.0 - 0.5) * 0.76;
      float oz = (float(h >> 16u) / 65536.0 - 0.5) * 0.76;
      vec2 seed = (vec2(float(i), float(j)) + 0.5 + vec2(ox, oz)) * REGION_SPACING;
      float d = distance(world, seed);
      if (d < r1) { r2 = r1; s2 = s1; r1 = d; s1 = seed; rid = h; }
      else if (d < r2) { r2 = d; s2 = seed; }
    }
  }
${candidates ? '  }\n' : ''}  uint rh = fieldHash1(rid);
  float angle = ${steppe
    // 【草原田的朝向各區塊只差一點】集體農場的大田是一整片規劃出來的，沒有中歐那種每個
    // 區塊轉一個任意角度。相鄰區塊差不到 ±14°，區塊交界不會切出尖角的楔形田塊
    ? '0.35 + (float(rh & 0xffffu) / 65536.0 - 0.5) * 0.5'
    : '(float(rh & 0xffffu) / 65536.0) * 3.14159265'};
  float scale = SPACING_VAR_LO
    + (float(rh >> 16u) / 65536.0) * (SPACING_VAR_HI - SPACING_VAR_LO);
  float cellW = FIELD_SPACING * scale;
  float cellH = FIELD_SPACING * scale * FIELD_ANISO;
  uint th = fieldHash1(rh);
  int tone = int(((th & 0xffffu) % ${PALETTE_STEPS}u
    + (th >> 16u) % ${PALETTE_STEPS}u) >> 1u);

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
  // 樹林田整塊一種樹（flora.ts 的 speciesOf，鍵是田的雜湊 ^ 0x77aa）
  bool woodCone = float(fieldHash1((fh ^ 0x77aau) ^ 0x5bd1u)) / 4294967296.0 < CONIFER_SHARE;
  vec3 col = ${steppe
    // 【牧草地】沒耕的草：兩個草色逐塊漸變，不分遠近
    ? `wood ? mix(${rgb(c.open)}, ${rgb(c.openAlt)}, float((fh >> 12u) & 0xffu) / 255.0) : PLOUGHED_COLOR`
    : 'wood ? mix(WOOD_COLOR, woodCone ? CONE_FAR_COLOR : BROAD_FAR_COLOR, fieldFar) : PLOUGHED_COLOR'};
  if (!wood && !ploughed) {
    int t = clamp(tone + int((fh >> 8u) % 3u) - 1, 0, ${PALETTE_STEPS - 1});
    float k = 0.94 + (float((fh >> 16u) & 0xffu) / 255.0) * 0.12;
    col = FIELD_PALETTE[t] * k;
  }
  // 【犁田加倍、樹林沒有】溝比行深；樹林是林冠不是作物。條紋沿田的長軸走，
  // 所以重複發生在 q.x 上
  float amp = wood ? 0.0 : (ploughed ? STRIPE_AMP * 2.0 : STRIPE_AMP);
  col *= stripe(q, STRIPE_PERIOD, amp);
  // 【順序就是優先權】凹路壓過樹籬，樹籬壓過田 —— 與 fieldSurfaceColor 相同。
  // 兩條帶的半寬不一樣：凹路的判準是 trackGap < trackWidthAt，樹籬的是
  // best < HEDGE_WIDTH * 0.5
  col = mix(col, mix(HEDGE_COLOR, HEDGE_FAR_COLOR, fieldFar),
    isHedge ? bandCoverage(best, HEDGE_WIDTH * 0.5 * mix(1.0, HEDGE_FAR_GROW, fieldFar), px) : 0.0);
  col = mix(col, TRACK_COLOR, bandCoverage(trackGap(world, s1, s2), trackWidthAt(world), px));
  return col;
}
`
}

const glslFloat = (v: number): string => v.toFixed(6)

/** `trackWidthAt`、`trackGap` 的 GLSL，由同一組常數產生 */
function trackGlsl(): string {
  const f = glslFloat
  const ripple = TRACK_RIPPLE.map((r) => `${f(r.amp)} * sin(${f(r.fx)} * w.x + ${f(r.fz)} * w.y + ${f(r.phase)})`)
  const wx = TRACK_WARP.map((t) => `${f(t.amp)} * sin(${f(t.fx)} * w.x + ${f(t.fz)} * w.y + ${f(t.phase)})`)
  const wz = TRACK_WARP.map((t) => `${f(t.amp)} * sin(${f(t.fz)} * w.x - ${f(t.fx)} * w.y + ${f(t.phase + 1.7)})`)
  return `
float trackWidthAt(vec2 w) {
  return TRACK_WIDTH * (1.0 + ${ripple.join(' + ')});
}

float trackGap(vec2 w, vec2 a, vec2 b) {
  vec2 p = w;
  p.x += ${wx.join(' + ')};
  p.y += ${wz.join(' + ')};
  return abs(distance(p, b) - distance(p, a));
}
`
}

/** 夏季那一份。農地與群島讀它，測試與 e2e 的著色器編譯也讀它 */
export const FIELD_GLSL = fieldGlsl('summer')

/**
 * 廠區那一層的 GLSL。接在 `fieldColorAt` 的 `return col;` 之前：先鋪墊面，
 * 再鋪道路 —— 道路壓過墊面，墊面壓過田。
 */
function siteGlsl(site: SiteLayout): string {
  const segs = segmentsOf(site.roads)
  const rail = segmentsOf(site.rails ?? [])
  const railGlsl = rail.length === 0 ? '' : `
  // 鐵路：碴石帶。與道路同一套距離場，只是另一組線段與另一個顏色
  const vec4 RAILS[${rail.length}] = vec4[${rail.length}](
${rail.map((s) => `  vec4(${s.ax.toFixed(1)}, ${s.az.toFixed(1)}, `
    + `${s.bx.toFixed(1)}, ${s.bz.toFixed(1)})`).join(',\n')}
  );
  float railD = 1.0e9;
  for (int i = 0; i < ${rail.length}; i++) {
    vec2 a = RAILS[i].xy;
    vec2 b = RAILS[i].zw;
    vec2 ab = b - a;
    float t = clamp(dot(world - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
    railD = min(railD, length(world - (a + ab * t)));
  }
  col = mix(col, ${rgb(BALLAST)},
    bandCoverage(railD, ${((site.railWidth ?? 24) / 2).toFixed(1)}, px));`
  const list = segs.map((s) =>
    `  vec4(${s.ax.toFixed(1)}, ${s.az.toFixed(1)}, ${s.bx.toFixed(1)}, ${s.bz.toFixed(1)})`).join(',\n')
  /**
   * 一個墊面矩形到邊界的有號距離，寫進名為 `name` 的變數。**與 `padDistance`
   * 逐項對應**：三層咬痕、四個斜切角、外推的裙邊。主墊面與每一塊附加的
   * 墊面（`padLobes`）各叫一次。
   */
  const padBlock = (rect: PadRect, name: string): string => {
    const B = edgeBite(rect).toFixed(1)
    const C = coarseBite(rect).toFixed(1)
    const F = fineBite(rect).toFixed(1)
    const sx0 = rect.x0 - PAD_SKIRT
    const sx1 = rect.x1 + PAD_SKIRT
    const sz0 = rect.z0 - PAD_SKIRT
    const sz1 = rect.z1 + PAD_SKIRT
    const W = sx1 - sx0
    const D = sz1 - sz0
    /** 與 `padDistance` 的 `inset()` 逐項對應 —— 三層都要，鹽也要一樣 */
    const inset = (axis: string, s1: number, s2: number): string =>
      `float(fieldHash2(int(floor(${axis} / ${FINE_CELL}.0)), ${s1 ^ 0x5bd1}) & 0xffu) / 255.0 * ${F}`
      + ` + float(fieldHash2(int(floor(${axis} / ${EDGE_CELL}.0)), ${s1}) & 0xffu) / 255.0 * ${B}`
      + ` + float(fieldHash2(int(floor(${axis} / ${COARSE_CELL}.0)), ${s2}) & 0xffu) / 255.0 * ${C}`
    const corners = CORNER_CUTS.map(([ca, ce], k) => {
      // 【與 padDistance 的夾住逐項對應】
      const a = Math.min(ca, W * 0.3)
      const e = Math.min(ce, D * 0.3)
      const u = (k & 1) === 0 ? `local.x - ${sx0.toFixed(1)}` : `${sx1.toFixed(1)} - local.x`
      const v = k < 2 ? `local.y - ${sz0.toFixed(1)}` : `${sz1.toFixed(1)} - local.y`
      const norm = Math.hypot(1 / a, 1 / e)
      const len = Math.hypot(a, e)
      return `  {\n    float cu = ${u};\n    float cv = ${v};\n`
        + `    if (cu * ${e.toFixed(4)} + cv * ${a.toFixed(4)}`
        + ` < ${(a * e + CORNER_SLACK * e).toFixed(1)}) {\n`
        + `      float ct = (cu * ${e.toFixed(4)} - cv * ${a.toFixed(4)}) / ${len.toFixed(6)};\n`
        + `      ${name} = max(${name}, (1.0 - cu / ${a.toFixed(1)} - cv / ${e.toFixed(1)})`
        + ` / ${norm.toFixed(8)}\n        + ${inset('ct', CORNER_SALT[k]!, 6473 + k)});\n    }\n  }`
    }).join('\n')
    return `  float ${name} = max(
    max(${sx0.toFixed(1)} + ${inset('local.y', 4517, 3313)} - local.x,
        local.x - (${sx1.toFixed(1)} - (${inset('local.y', 2287, 6151)}))),
    max(${sz0.toFixed(1)} + ${inset('local.x', 9911, 8543)} - local.y,
        local.y - (${sz1.toFixed(1)} - (${inset('local.x', 7331, 1697)}))));
${corners}`
  }
  // 【附加的墊面是聯集】每一塊自己算一個距離，取最小的 —— 負的在任何一塊裡面
  const lobes = (site.padLobes ?? []).map((l) =>
    `  {\n${padBlock(l, 'lobeD')}\n    padD = min(padD, lobeD);\n  }`).join('\n')
  /** 一組矩形＋色相攤成 GLSL 的兩張表加一個迴圈 */
  const rectsGlsl = (
    name: string, rs: NonNullable<SiteLayout['patches']>, assign: string,
  ): string => rs.length === 0 ? '' : `
  const vec4 ${name}[${rs.length}] = vec4[${rs.length}](
${rs.map((p) => `  vec4(${p.x0.toFixed(1)}, ${p.z0.toFixed(1)}, `
    + `${p.x1.toFixed(1)}, ${p.z1.toFixed(1)})`).join(',\n')}
  );
  const vec3 ${name}_HUE[${rs.length}] = vec3[${rs.length}](
${rs.map((p) => `  ${rgb(p.hex)}`).join(',\n')}
  );
  for (int i = 0; i < ${rs.length}; i++) {
    if (local.x >= ${name}[i].x && local.x < ${name}[i].z
        && local.y >= ${name}[i].y && local.y < ${name}[i].w) {
      ${assign.replace('$', `${name}_HUE[i]`)}
    }
  }`
  const patchGlsl = rectsGlsl('PATCHES', site.patches ?? [],
    'siteCol = $ * siteGrime * padDark;')
  const outpostGlsl = rectsGlsl('OUTPOSTS', site.outposts ?? [],
    'col = $ * siteGrime;')
  const rb = roadBounds(site)
  // 【沒有墊面就整段不產生】衛星設施與附加墊面都依附墊面
  const pad = site.pad
  const padSection = pad === undefined ? '' : (() => {
    const near = siteBounds({ ...site, pad })
    return `
  // 【先用外接矩形擋掉】底下這一段是每個像素都跑的，而投彈高度整片畫面有
  // 七成是田 —— 少了這個測試，4 km 俯視的幀時間從 0.8 ms 變成 2.2 ms。
  // 道路留在外面：連外那兩條一路畫到地圖邊緣
  if (world.x > ${near.x0.toFixed(1)} && world.x < ${near.x1.toFixed(1)}
      && world.y > ${near.z0.toFixed(1)} && world.y < ${near.z1.toFixed(1)}) {
  // 【底下這一段全部在廠區局部座標】墊面轉了 ${((site.heading ?? 0) * 180 / Math.PI).toFixed(1)} 度，
  // 而墊面／鋪面／衛星設施都是軸對齊矩形 —— 轉一次座標比把四個不等式改成
  // 一般多邊形便宜得多。髒污也吃局部座標，碎花才跟著廠區的方向走
  vec2 rel = world - vec2(${(site.pivot?.x ?? 0).toFixed(1)}, ${(site.pivot?.z ?? 0).toFixed(1)});
  vec2 local = vec2(rel.x * ${Math.cos(site.heading ?? 0).toFixed(8)}
                    + rel.y * ${Math.sin(site.heading ?? 0).toFixed(8)},
                    -rel.x * ${Math.sin(site.heading ?? 0).toFixed(8)}
                    + rel.y * ${Math.cos(site.heading ?? 0).toFixed(8)});
  // 髒污：${SLAB_CELL.toFixed(0)} m 的鋪面塊疊 ${GRIME_CELL.toFixed(0)} m 的油漬與微亮暗。
  // 墊面與鋪面共用，所以碴石與裸土也是同色系的碎花而不是一整塊平色
  //
  // 【油漬要是塊狀的】邊界不平滑是刻意的：低多邊形的髒就是一塊一塊的
  uint sgP = fieldHash2(int(floor(local.x / ${GRIME_CELL}.0)), int(floor(local.y / ${GRIME_CELL}.0)));
  uint sgS = fieldHash2(int(floor(local.x / ${SLAB_CELL}.0)) + 7919,
                        int(floor(local.y / ${SLAB_CELL}.0)) - 104729);
  uint sgO = fieldHash1(sgP);
  float siteGrime = (0.86 + 0.2 * float((sgS >> 8) & 0x7u) / 7.0)
    * ((sgO & 0xffu) < 46u ? 0.74 : 1.0)
    * (0.96 + 0.08 * float(sgP & 0xffu) / 255.0);

  // 【廠界不是直角矩形】兩層起伏：${EDGE_CELL.toFixed(0)} m 的格咬出鋸齒、
  // ${COARSE_CELL.toFixed(0)} m 的格讓整條邊蜿蜒，四個角再各斜切一塊。一條直的邊在投彈
  // 高度看下去就是一把尺，而廠區是幾十年間一塊一塊擴出來的
  //
  // 【與 padDistance() 逐項對應】負的在墊面內、正的在外面
${padBlock(pad, 'padD')}
${lobes}

  // 【靠邊處壓暗】高空最刺眼的是水泥與田的亮度階梯。越靠外越髒越舊，順便
  // 把那一階削掉一截
  float padDark = mix(0.90, 1.0, clamp(-padD / ${(PAD_SKIRT * 2).toFixed(1)}, 0.0, 1.0));
  vec3 siteCol = ${rgb(site.padHex ?? CONCRETE)} * siteGrime * padDark;
${patchGlsl}
  // 【邊界是硬的】墊面外沒有過渡帶：一圈把混凝土混回田色的帶子，從投彈高度
  // 看是「一半工廠一半田」的暈。不規則靠的是 padD 裡疊的三層咬痕，不是混色。
  //
  // 【這一像素的柔化只為了抗鋸齒】寬度就是像素在地面上的足跡 —— 拉寬就變回
  // 過渡帶了
  col = mix(siteCol, col, clamp(padD / max(px, 0.25) * 0.5 + 0.5, 0.0, 1.0));
${outpostGlsl}
  }`
  })()
  // 【戰場的痕跡畫在道路之後】先有路、後來才被炸：坑蓋在路面上
  const scarSection = site.scars === undefined ? '' : scarsGlsl(site.scars)
  // 【林帶畫在痕跡之前】遠圖上的帶子是田界的一部分，戰場的坑與壕溝壓在它上面
  const beltSection = site.belts === undefined ? '' : beltsGlsl(site.belts)
  // 【沒有道路也沒有鐵路就整段不產生】GLSL 不准零長度的陣列
  if (segs.length === 0 && rail.length === 0) return `${padSection}${beltSection}${scarSection}`
  return `${padSection}
  // 【道路與鐵路自己一個外接矩形】底下這 ${rail.length + segs.length} 段點線距離是每個像素都跑的，
  // 而連外道路一路畫到圖邊 —— 墊面那個矩形擋不住它們，得自己算一個。
  // 見 roadBounds()：留的邊界要蓋得住抗鋸齒帶，否則路的外緣會沿著矩形邊
  // 被削掉一條直線，而且只在掠角出現
  if (world.x > ${rb.x0.toFixed(1)} && world.x < ${rb.x1.toFixed(1)}
      && world.y > ${rb.z0.toFixed(1)} && world.y < ${rb.z1.toFixed(1)}) {
${railGlsl}
  // 道路：離任一條線段小於半寬。**畫在鐵路之後** —— 平交道上看得到的是柏油
  const vec4 ROADS[${segs.length}] = vec4[${segs.length}](
${list}
  );
  float roadD = 1.0e9;
  for (int i = 0; i < ${segs.length}; i++) {
    vec2 a = ROADS[i].xy;
    vec2 b = ROADS[i].zw;
    vec2 ab = b - a;
    float t = clamp(dot(world - a, ab) / max(dot(ab, ab), 1.0e-6), 0.0, 1.0);
    roadD = min(roadD, length(world - (a + ab * t)));
  }
  col = mix(col, ${rgb(site.roadHex ?? ASPHALT)}, bandCoverage(roadD, ${(site.roadWidth / 2).toFixed(1)}, px));
  }${beltSection}${scarSection}`
}

/**
 * 草原的防風林帶（遠處）：有林帶的田界畫成一條深色的帶子。
 *
 * - 哪些田界有林帶：`edgeKey ^ 0x2be1` 的雜湊小於 `BELT_CHANCE`，**與 `flora.ts` 的
 *   `steppeBeltFloraFor` 同一個判準**（`edgeKey` 是 `fieldAt` 與 `steppeNearestEdge` 也在用的
 *   田界身分）
 * - 只畫在遠層（`fieldFar`）：近處有真的樹，這一條在植被圈外才接手
 * - 戰場方框裡不畫、往外漸增：公式與 `world/rzhev.ts` 的 `shelterbeltFade` 同一條
 */
function beltsGlsl(b: SiteBelts): string {
  const f = b.frame
  const n = (v: number): string => v.toFixed(5)
  return `
  // 防風林帶（遠處）
  if (fieldFar > 0.35 && float(fieldHash1(edgeKey ^ 0x2be1u)) / 4294967296.0 < ${n(BELT_CHANCE)}) {
    vec2 bd = world - vec2(${n(f.ox)}, ${n(f.oz)});
    float blx = dot(bd, vec2(${n(f.rx)}, ${n(f.rz)}));
    float blz = -dot(bd, vec2(${n(f.fx)}, ${n(f.fz)}));
    float box = max(0.0, abs(blx) - ${n(f.half)});
    float boz = max(0.0, max(blz - ${n(f.south)}, ${n(f.north)} - blz));
    float bt = clamp(sqrt(box * box + boz * boz) / ${n(f.ramp)}, 0.0, 1.0);
    float beltFade = bt * bt * (3.0 - 2.0 * bt) * smoothstep(0.35, 0.9, fieldFar);
    // 凹路壓過林帶（與樹籬同一個優先序）：近處的樹離路緣至少 BELT_ROAD_CLEAR，帶子蓋在路上的話
    // 遠近切換時路面會變色
    float beltCover = bandCoverage(best, ${n(b.halfWidth)}, px) * beltFade
      * (1.0 - bandCoverage(trackGap(world, s1, s2), trackWidthAt(world), px));
    col = mix(col, ${rgb(b.hex)}, beltCover);
  }`
}

/** 有廠區的那一份 GLSL。`site` 省略時與 `fieldGlsl(season)` 逐字相同 */
export function fieldGlslWithSite(season: Season, site?: SiteLayout, candidates = false, open = false): string {
  const base = fieldGlsl(season, candidates, open)
  if (site === undefined) return base
  const at = base.lastIndexOf('  return col;')
  // 【戰場的痕跡要一個貼圖與一支取樣函式】放在整段最前面（頂層）
  const head = site.scars === undefined ? '' : SCARS_DECL + SCARS_FN
  return head + base.slice(0, at) + siteGlsl(site) + '\n' + base.slice(at)
}
