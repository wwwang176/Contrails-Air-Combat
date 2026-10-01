import { LinearMipmapLinearFilter, SRGBColorSpace, TextureLoader, type Texture } from 'three'
import { assetUrl } from '../core/asset'

/**
 * # 戰場的痕跡
 *
 * 疊在麥田上的彈坑、燒焦的田、坦克的履帶痕、壕溝。**畫在田的著色器裡**（`fields.ts`
 * 的 `siteGlsl` 接在道路之前），所以跟著田色一起烘進近遠四層貼圖，不加任何幾何。
 *
 * 貼圖是一張 4 × 4 的圖集（`public/textures/battlefield.png`，由
 * `tools/battlefield/craters.py` 產生），格子依列優先、左上為 0：
 *
 * ```
 *   0～7    彈坑（白堊色的濺痕）
 *   8～11   燒焦的田
 *   12～13  履帶痕（沿格子的垂直方向，上下能接）
 *   14～15  壕溝（同上）
 * ```
 *
 * 【彈坑是程序散佈的】`CRATER_GRID` 一格一個候選點，雜湊定位置、大小、方向、變體，
 * 照「離交戰帶多遠」的密度決定有沒有 —— 與空地的樹（`openTreesOver`）同一套。每個
 * 像素只看周圍 3 × 3 格，幾百個坑不必逐一跑。
 *
 * 【只有畫面】植被、碰撞、小地圖都不讀這一層，所以沒有 CPU 版。
 */

export interface ScarLine {
  readonly points: readonly { readonly x: number; readonly z: number }[]
  /** 寬，m —— 圖集一格的橫向就是這個寬；沿線每走一個寬重複一次 */
  readonly width: number
}

export interface BattleScars {
  /**
   * 交戰帶，世界座標的矩形。彈坑在裡面最密，往外 `fade` 公尺內降到 `sparse`
   * 的密度，再往外沒有
   */
  readonly zone: { readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number }
  readonly fade: number
  /** 交戰帶裡一格（`CRATER_GRID`）有坑的機率 */
  readonly dense: number
  /** 漸弱帶外緣的機率 */
  readonly sparse: number
  /** 燒焦的田：世界座標、半徑，m */
  readonly scorch: readonly { readonly x: number; readonly z: number; readonly r: number }[]
  readonly trenches: readonly ScarLine[]
  readonly tracks: readonly ScarLine[]
}

/** 彈坑候選點的格距，m。坑的半徑上限要小於它，3 × 3 格才看得到所有蓋到這一點的坑 */
export const CRATER_GRID = 24
/** 彈坑貼圖那一格的半寬，m（坑本身約佔格子的四到八成） */
export const CRATER_R = [6, 16] as const

/** 圖集一格的像素邊長。算取樣的 mip 用 */
const CELL_PX = 256

/**
 * 圖集的 uniform。**三份材質共用同一個物件**（`farmGround.ts` 的 `applyFields`、
 * `fieldClipmap.ts` 的烘圖與地面）—— 貼圖載入之後填進來，三邊一起看到。
 */
export const SCAR_ATLAS: { value: Texture | null } = { value: null }

let loading: Promise<void> | null = null

/** 進場前載入圖集。只有庫斯克用，開場不預載 */
export function preloadScarAtlas(): Promise<void> {
  if (loading !== null) return loading
  loading = new TextureLoader().loadAsync(assetUrl('/textures/battlefield.png')).then((t) => {
    t.colorSpace = SRGBColorSpace
    t.minFilter = LinearMipmapLinearFilter
    t.anisotropy = 4
    SCAR_ATLAS.value = t
  }, (e: unknown) => {
    // 【失敗了要能再試】留著被拒絕的那一份的話，網路恢復之後再進庫斯克仍然失敗
    loading = null
    throw e
  })
  return loading
}

/** 宣告：接在整段田的 GLSL 最前面（頂層） */
export const SCARS_DECL = 'uniform sampler2D uScarAtlas;\n'

const f = (v: number): string => v.toFixed(1)

/** 一組折線攤成 GLSL 的線段表：端點、這一段起點沿線走了多遠、寬、圖集格 */
function linesGlsl(name: string, lines: readonly ScarLine[], cells: readonly [number, number]): string {
  const segs: string[] = []
  const meta: string[] = []
  lines.forEach((line, li) => {
    let s = 0
    for (let i = 0; i + 1 < line.points.length; i++) {
      const a = line.points[i]!
      const b = line.points[i + 1]!
      segs.push(`vec4(${f(a.x)}, ${f(a.z)}, ${f(b.x)}, ${f(b.z)})`)
      meta.push(`vec3(${f(s)}, ${f(line.width)}, ${cells[li % 2]!.toFixed(1)})`)
      s += Math.hypot(b.x - a.x, b.z - a.z)
    }
  })
  if (segs.length === 0) return ''
  let x0 = Infinity
  let z0 = Infinity
  let x1 = -Infinity
  let z1 = -Infinity
  let wMax = 0
  for (const line of lines) {
    wMax = Math.max(wMax, line.width)
    for (const p of line.points) {
      x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x)
      z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z)
    }
  }
  return `
  // ${name}：離線段小於半寬就取圖集那一格，橫向是離中線的有號距離、縱向是沿線距離
  if (world.x > ${f(x0 - wMax)} && world.x < ${f(x1 + wMax)}
      && world.y > ${f(z0 - wMax)} && world.y < ${f(z1 + wMax)}) {
    const vec4 ${name}_SEG[${segs.length}] = vec4[${segs.length}](${segs.join(', ')});
    const vec3 ${name}_META[${segs.length}] = vec3[${segs.length}](${meta.join(', ')});
    for (int i = 0; i < ${segs.length}; i++) {
      vec2 a = ${name}_SEG[i].xy;
      vec2 ab = ${name}_SEG[i].zw - a;
      float len = max(length(ab), 1.0e-3);
      vec2 dir = ab / len;
      vec2 rel = world - a;
      float along = dot(rel, dir);
      float w = ${name}_META[i].y;
      if (along < -0.5 * w || along > len + 0.5 * w) continue;
      float across = dir.x * rel.y - dir.y * rel.x;
      if (abs(across) >= 0.5 * w) continue;
      vec2 q = vec2(across / w + 0.5, fract((${name}_META[i].x + along) / w));
      vec4 t = scarTexel(int(${name}_META[i].z), q, w, px);
      col = mix(col, t.rgb, t.a);
    }
  }`
}

/**
 * 接在 `fieldColorAt` 的道路之前（`siteGlsl`）。用的變數：`world`、`px`、`col`。
 * 輔助函式 `scarTexel` 由 `SCARS_FN` 提供，要放在 `fieldColorAt` 之前。
 */
export function scarsGlsl(s: BattleScars): string {
  const z = s.zone
  const scorch = s.scorch.length === 0 ? '' : `
  // 燒焦的田：逐塊看半徑
  {
    const vec3 SCORCH[${s.scorch.length}] = vec3[${s.scorch.length}](${
  s.scorch.map((p) => `vec3(${f(p.x)}, ${f(p.z)}, ${f(p.r)})`).join(', ')});
    for (int i = 0; i < ${s.scorch.length}; i++) {
      vec2 d = world - SCORCH[i].xy;
      float r = SCORCH[i].z;
      if (dot(d, d) >= r * r) continue;
      uint h = fieldHash1(uint(i) * 0x9e3779b9u + 0x51c7u);
      float ang = float(h) * (6.2831853 / 4294967296.0);
      vec2 q = vec2(cos(ang) * d.x - sin(ang) * d.y, sin(ang) * d.x + cos(ang) * d.y) / (2.0 * r) + 0.5;
      vec4 t = scarTexel(8 + int(h >> 30u), q, 2.0 * r, px);
      col = mix(col, t.rgb, t.a);
    }
  }`
  return `
  // 【戰場的痕跡】燒田最底、再來履帶痕、壕溝、彈坑最上 —— 坑炸在溝與車轍上
  if (world.x > ${f(z.x0 - s.fade - 2000)} && world.x < ${f(z.x1 + s.fade + 2000)}
      && world.y > ${f(z.z0 - s.fade - 2000)} && world.y < ${f(z.z1 + s.fade + 2000)}) {
${scorch}
${linesGlsl('TRACKS', s.tracks, [12, 13])}
${linesGlsl('TRENCHES', s.trenches, [14, 15])}
  // 彈坑：周圍 3 × 3 格的候選點。密度看候選點離交戰帶多遠
  if (world.x > ${f(z.x0 - s.fade - CRATER_GRID)} && world.x < ${f(z.x1 + s.fade + CRATER_GRID)}
      && world.y > ${f(z.z0 - s.fade - CRATER_GRID)} && world.y < ${f(z.z1 + s.fade + CRATER_GRID)}) {
    ivec2 cc = ivec2(floor(world / ${f(CRATER_GRID)}));
    for (int dj = -1; dj <= 1; dj++) {
      for (int di = -1; di <= 1; di++) {
        int gx = cc.x + di;
        int gz = cc.y + dj;
        uint h = fieldHash2(gx ^ 0x5ca7, gz ^ 0x0b0b);
        uint g = fieldHash1(h);
        vec2 p = (vec2(float(gx), float(gz)) + 0.15
          + 0.7 * vec2(float(h & 0xffffu), float(h >> 16u)) / 65536.0) * ${f(CRATER_GRID)};
        vec2 out2 = max(vec2(${f(z.x0)}, ${f(z.z0)}) - p, p - vec2(${f(z.x1)}, ${f(z.z1)}));
        float outside = length(max(out2, 0.0));
        if (outside >= ${f(s.fade)}) continue;
        float dens = mix(${s.dense.toFixed(4)}, ${s.sparse.toFixed(4)}, smoothstep(0.0, ${f(s.fade)}, outside));
        if (float(g & 0xffffu) / 65536.0 >= dens) continue;
        float r = ${f(CRATER_R[0])} + ${f(CRATER_R[1] - CRATER_R[0])} * float((g >> 16u) & 0xffu) / 255.0;
        vec2 d = world - p;
        if (dot(d, d) >= r * r) continue;
        uint k = fieldHash1(g);
        float ang = float(k) * (6.2831853 / 4294967296.0);
        vec2 q = vec2(cos(ang) * d.x - sin(ang) * d.y, sin(ang) * d.x + cos(ang) * d.y) / (2.0 * r) + 0.5;
        vec4 t = scarTexel(int(k >> 29u), q, 2.0 * r, px);
        col = mix(col, t.rgb, t.a);
      }
    }
  }
  }`
}

/**
 * 從圖集第 `cell` 格取樣。`q` 是格子內的座標（0～1，y 朝圖的下方），`span` 是這一格
 * 在地上蓋多寬（m），`px` 是像素在地上的足跡（m）—— mip 由兩者算，不用導數：這一段
 * 在分支與迴圈裡，導數在那裡不可靠。
 *
 * 【mip 夾在 4】一格 256 px，第 4 層只剩 16 px；再往上相鄰兩格的內容會混在一起。
 *
 * 【取樣點往格子裡縮半個 texel】雙線性取樣在格子的邊上會混進隔壁格。壕溝與履帶痕
 * 沿線重複時縱向座標會走到 0 與 1，混進去的是隔壁那一列 —— 每重複一次就有一道淡掉的
 * 接縫。縮的量跟著 mip 走（那一層的半個 texel）
 */
export const SCARS_FN = `
vec4 scarTexel(int cell, vec2 q, float span, float px) {
  float lod = clamp(log2(max(px, 1.0e-3) * ${CELL_PX.toFixed(1)} / span), 0.0, 4.0);
  float inset = 0.5 * exp2(lod) / ${CELL_PX.toFixed(1)};
  vec2 uv = (vec2(float(cell % 4), float(cell / 4)) + mix(vec2(inset), vec2(1.0 - inset), clamp(q, 0.0, 1.0))) / 4.0;
  return textureLod(uScarAtlas, vec2(uv.x, 1.0 - uv.y), lod);
}
`
