import {
  BufferAttribute, BufferGeometry, DoubleSide, DynamicDrawUsage, Mesh, MeshBasicMaterial,
  type Texture,
} from 'three'
import { injectVertexAlpha } from './vortex'
import { OCEAN_HEIGHT_GLSL } from './ocean'
import { TORPEDOES_CAPACITY } from '../world/torpedo'

/**
 * 魚雷的航跡 —— **貼著海面的一條白帶**。
 *
 * 【為什麼不是粒子】粒子連不起來，看起來是一點一點的圈圈（凝結尾解過同一
 * 個問題，見 `vortex.ts`）。粒子池是畫**團狀**東西的（煙、爆炸、水花）；
 * 航跡是一條**線**。水花仍然留著 —— 它負責線上的閃爍，帶子負責那條線。
 *
 * 【為什麼是平帶不是管】泡沫是浮在水面上的一層，管子有厚度、會有一半沉在
 * 水裡，而露出來的那半在遠處讀起來像一根白棍。
 *
 * 【高度每幀重算】`terrain.waterAt` 給的是**時間 0** 的浪高（那一支刻意
 * 不吃 time），拿它當節點高度的話，帶子會被真正在動的浪蓋掉一段一段的
 * ——那正是試飛看到的。所以節點只存 x/z，y 每幀照當下的時間重算：接了海面
 * （`bindOcean`）時在著色器裡算，沒接時 `step` 問浪高場。
 *
 * 【頭端】正式節點每 6 m 才落一個，所以最新的節點永遠落後魚雷最多 6 m。
 * 少了頭端，帶子看起來是「一段一段長出來」的 —— `vortex.ts` 為同一個回報
 * 加過同一個東西。
 */

/** 節點的取樣間隔，m。直線航行只需要抓得住起點與終點，取樣可以很疏 */
export const WAKE_NODE_SPACING = 6

/**
 * 每一格的節點上限（含頭端佔的那一格）。
 *
 * 【要蓋得住看得見的那一段】22 m/s × 25 s = 550 m ÷ 6 m = 92 個。不夠的話
 * 尾端會在還沒淡完之前就被覆蓋，症狀是航跡被硬切一刀。
 */
export const WAKE_NODES = 96

/** 正式節點的容量。**比總數少一 —— 那一格留給頭端** */
export const WAKE_REAL_NODES = WAKE_NODES - 1

/**
 * 一個節點活多久，秒。**起始值，由試飛裁定。**
 *
 * 【它是一個戰術訊號】航跡指回投放的方向，所以它活多久就等於「被雷擊的
 * 那一方有多少時間反應」。
 */
export const WAKE_LIFE = 25

/** 剛翻起來的泡沫**半**寬，m */
export const WAKE_HALF_FROM = 1.1
/** 散開之後的半寬，m */
export const WAKE_HALF_TO = 3.6

/** 出生時的不透明度。半透明才看得出下面的海 */
export const WAKE_ALPHA = 0.55

/** 泡沫的顏色。比水花白一點 —— 它是被打散的空氣 */
export const WAKE_COLOR = 0xf4fbff

/**
 * 帶子浮在浪面之上多少，m。
 *
 * 【非有不可】與浪面同高的話兩者共面，深度精度會讓帶子一段一段閃爍。
 *
 * 【為什麼要 0.8 而不是勉強夠】浪面的網格是有限細分的，而 GPU 在頂點之間
 * 是線性內插 —— 浪谷處那條弦**高於**解析的正弦曲線。帶子照解析高度擺的話
 * 會在每一個浪谷沉到網格底下，症狀是一條**虛線**。0.8 m 蓋得過那個弦高差，
 * 而在最近的觀察距離上仍然看不出它浮著。
 */
export const WAKE_LIFT = 0.8

/** 一幀最多補幾個節點。分頁切回時 `dt` 會很大，不夾的話一幀補上千個 */
export const WAKE_MAX_PER_FRAME = 8

/**
 * 池子大小。**必須等於 `TORPEDOES_CAPACITY`** —— 航跡的格子就是魚雷的索引，
 * 少了的話索引超出的那幾枚沒有航跡，寫進別的陣列位置也不報錯。
 */
export const WAKE_SLOTS = TORPEDOES_CAPACITY

/**
 * 一種航跡的樣子。魚雷用 `TORPEDO_WAKE`；船的艦尾與艦首各一種（`shipWakes.ts`）。
 */
export interface WakeStyle {
  /** 每一格的節點數（含頭端那一格）。要蓋得住「航速 × 壽命 ÷ 間隔」 */
  readonly nodes: number
  /** 節點間隔，m */
  readonly spacing: number
  /** 一個節點活多久，秒 */
  readonly life: number
  /** 剛翻起來與散開之後的半寬，m（再乘上每格的寬度倍率） */
  readonly halfFrom: number
  readonly halfTo: number
  /**
   * 散開的快慢：寬度照「年齡比例的這個次方」內插。**省略 = 1，均勻變寬。** 小於 1 的
   * 話前段就張開、後段趨緩 —— 船後面一出來就是扇形
   */
  readonly spread?: number
  /** 出生時的不透明度 */
  readonly alpha: number
  /**
   * 泡沫紋理幾公尺重複一次（橫向與縱向同一個比例）。**省略 = 沒有紋理**（魚雷）。
   * 有的話帶子多一組 UV：u 是離中線幾公尺、v 是節點落下時的里程，都除以它 ——
   * 紋理釘在水面上、不跟著船滑。
   *
   * 【u 用公尺不用 0…1】照帶寬算的話，帶子散開幾倍、泡沫就被橫向拉長幾倍，變成扁的
   * 橫條。照公尺算，帶子變寬時是多鋪幾格。兩邊的軟邊另外由 `aAcross` 算
   */
  readonly foamTile?: number
  /**
   * 橫向切幾段。**省略 = 1**（只有左右兩緣，魚雷）。
   *
   * 【寬的帶子要切】浪高只在頂點上取樣，頂點之間是直線。帶子寬過幾十公尺時，兩緣
   * 之間那條直線在浪峰處低於海面，中段被浪蓋掉。每段要比最短的浪（165 m）的六分之一短
   */
  readonly columns?: number
}

export const TORPEDO_WAKE: WakeStyle = {
  nodes: WAKE_NODES, spacing: WAKE_NODE_SPACING, life: WAKE_LIFE,
  halfFrom: WAKE_HALF_FROM, halfTo: WAKE_HALF_TO, alpha: WAKE_ALPHA,
}

/**
 * 節點的不透明度。出生最濃、到壽命歸零。
 *
 * 【為什麼不是線性】線性之下尾端在 12 秒時還有 0.29 對頭端的 0.55 ——
 * 在深色的海面上那兩個讀起來一樣白，整條看起來像一根沒有方向的白棍。
 * 平方讓前三分之一就掉掉一半以上，於是「哪一端是新的」一眼就分得出來。
 */
export function wakeAlpha(age: number, style: WakeStyle = TORPEDO_WAKE): number {
  if (!(age >= 0) || age >= style.life) return 0
  const k = 1 - age / style.life
  return style.alpha * k * k
}

/** 節點的半寬，m。泡沫會散開 */
export function wakeHalfWidth(age: number, style: WakeStyle = TORPEDO_WAKE): number {
  const k = age <= 0 ? 0 : age >= style.life ? 1 : age / style.life
  const s = style.spread === undefined ? k : Math.pow(k, style.spread)
  return style.halfFrom + (style.halfTo - style.halfFrom) * s
}

/** 走了 `travelled` 公尺該落幾個節點 */
export function wakeEmitCount(travelled: number, style: WakeStyle = TORPEDO_WAKE): number {
  return Math.floor(travelled / style.spacing)
}

/**
 * 一條帶子的索引緩衝。**建一次就不動。**
 *
 * 每一格擁有 `nodes × cols` 個**連續**頂點（每個節點一排，從左緣到右緣）；相鄰兩個
 * 節點之間每一段兩個三角形。
 *
 * 【三角形一律落在同一格之內】跨過去的話會出現一條橫跨兩枚魚雷的白帶。
 */
export function ribbonIndices(slots: number, nodes: number, cols = 2): Uint32Array {
  const quads = slots * (nodes - 1) * (cols - 1)
  const idx = new Uint32Array(quads * 6)
  let k = 0
  for (let t = 0; t < slots; t++) {
    const base = t * nodes * cols
    for (let i = 0; i < nodes - 1; i++) {
      for (let c = 0; c < cols - 1; c++) {
        const a = base + i * cols + c
        const b = a + cols
        idx[k++] = a
        idx[k++] = b
        idx[k++] = b + 1
        idx[k++] = a
        idx[k++] = b + 1
        idx[k++] = a + 1
      }
    }
  }
  return idx
}

/** 海面浪高的 uniform（`Ocean.heightUniforms`） */
export type OceanHeightUniforms = Readonly<Record<string, { value: unknown }>>

/**
 * 要把帶子壓在水線的俯視矩形（船身）。呼叫端每幀填，`count` 之後的不讀。
 * 艏向 cos/sin 是繞 +Y 的角度；半長沿艦體 z、半寬沿艦體 x。
 */
export interface SinkBoxes {
  count: number
  readonly x: Float64Array
  readonly z: Float64Array
  readonly cos: Float64Array
  readonly sin: Float64Array
  readonly halfLength: Float64Array
  readonly halfBeam: Float64Array
}

export function createSinkBoxes(capacity: number): SinkBoxes {
  return {
    count: 0,
    x: new Float64Array(capacity), z: new Float64Array(capacity),
    cos: new Float64Array(capacity), sin: new Float64Array(capacity),
    halfLength: new Float64Array(capacity), halfBeam: new Float64Array(capacity),
  }
}

/** (x, z) 落在第 k 個矩形裡 */
export function insideSinkBox(b: SinkBoxes, k: number, x: number, z: number): boolean {
  const dx = x - b.x[k]!
  const dz = z - b.z[k]!
  // 轉回艦體座標：繞 +Y 轉 −艏向
  const lx = dx * b.cos[k]! - dz * b.sin[k]!
  const lz = dx * b.sin[k]! + dz * b.cos[k]!
  return Math.abs(lx) <= b.halfBeam[k]! && Math.abs(lz) <= b.halfLength[k]!
}

export interface Wakes {
  object: Mesh
  /** 目前有幾個**正式**節點（不含頭端）。測試與 telemetry 用 */
  readonly live: number
  /**
   * 一枚魚雷的一幀。位置是**水面上**的點，不是雷體。
   *
   * @param id 這一枚的識別碼（`Torpedoes.serial`）。**一換就整條重來** ——
   *           池子的格子會重用，上一枚的航跡接到新的一枚身上會畫出一條橫跨
   *           半張海圖的線。格子超出範圍直接 return（不丟例外）。
   */
  emit(slot: number, x: number, z: number, id: number): void
  /** 這一格的寬度倍率（半寬乘上它）。預設 1。船照艦寬給 */
  widen(slot: number, k: number): void
  /**
   * 老化一幀並重寫頂點。**在渲染幀率呼叫，不在物理步。**
   *
   * @param heightAt 浪高場。沒接海面（`bindOcean`）時**每個頂點每幀問一次** ——
   *                 帶子要跟著浪起伏，否則會被浪蓋掉。接了海面就不問它
   */
  step(dt: number, time: number, heightAt: (x: number, z: number, t: number) => number): void
  /**
   * 接上海面的浪高 uniform：之後浪高在著色器裡算，與海面同一支公式、同一組 uniform、
   * 逐頂點一致，CPU 不再問浪高。null = 回到 CPU 問 `heightAt`。
   *
   * **換地形就要重接** —— 接著舊的那一組的話，帶子跟著一片已經不在畫面上的海起伏
   */
  bindOcean(ocean: OceanHeightUniforms | null): void
  /** 全部歸零，**含餘數與上一個位置**。換一場戰鬥時呼叫 */
  reset(): void
  dispose(): void
}

export interface WakeOptions {
  /** 泡沫紋理（白、alpha 是泡沫的濃淡）。`style.foamTile` 有值才用得到；node 測試不給 */
  readonly foam?: Texture | null
  /**
   * 落在這些矩形裡的頂點，浪高不高過水線。船身底下的那一段用 —— 浪峰高的時候照浪
   * 抬起來會比艦尾甲板（Fletcher 只有 2.7 m）還高，泡沫從甲板上冒出來
   */
  readonly sink?: SinkBoxes
}

export function createWakes(
  slots: number = WAKE_SLOTS, style: WakeStyle = TORPEDO_WAKE, options: WakeOptions = {},
): Wakes {
  const foam = options.foam ?? null
  const sink = options.sink ?? null
  /** 橫向幾個頂點（段數 + 1） */
  const COLS = (style.columns ?? 1) + 1
  const NODES = style.nodes
  const REAL_NODES = NODES - 1
  const total = slots * NODES
  /** 每一格的寬度倍率 */
  const widthK = new Float32Array(slots).fill(1)
  /** 每個節點落下時的里程，m；頭端用 `odo` 那一格當下的值 */
  const nOdo = new Float32Array(total)
  /** 每一格累計走了多遠，m */
  const odo = new Float32Array(slots)
  const nx = new Float32Array(total)
  const nz = new Float32Array(total)
  const nAge = new Float32Array(total)
  /** 這一格目前有幾個正式節點 */
  const count = new Uint16Array(slots)
  /** 環形緩衝的寫入位置 */
  const head = new Uint16Array(slots)
  /** 上次落點之後剩下的距離，m */
  const carry = new Float32Array(slots)
  /** 上一幀的位置 */
  const px = new Float32Array(slots)
  const pz = new Float32Array(slots)
  /** 這一格有沒有上一幀 */
  const seen = new Uint8Array(slots)
  /**
   * 上一幀是哪一枚。**Float64 而不是 Float32** —— 識別碼要逐位元比對，
   * 存進 Float32 會被捨入，比對的是捨入後的值
   */
  const lastId = new Float64Array(slots)
  /** 活動頭端：魚雷這一幀在哪裡。不進環形緩衝、不老化、不計入 `live` */
  const hx = new Float32Array(slots)
  const hz = new Float32Array(slots)
  const hasHead = new Uint8Array(slots)

  let liveNodes = 0

  const vertexCount = total * COLS
  const position = new BufferAttribute(new Float32Array(vertexCount * 3), 3)
  const alpha = new BufferAttribute(new Float32Array(vertexCount), 1)
  position.setUsage(DynamicDrawUsage)
  alpha.setUsage(DynamicDrawUsage)
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', position)
  geometry.setAttribute('aAlpha', alpha)
  geometry.setIndex(new BufferAttribute(ribbonIndices(slots, NODES, COLS), 1))
  const foamed = style.foamTile !== undefined
  const uvAttr = foamed ? new BufferAttribute(new Float32Array(vertexCount * 2), 2) : null
  /** 第 c 個頂點的橫向位置：左緣 −1、右緣 +1 */
  const acrossOf = (c: number) => -1 + (2 * c) / (COLS - 1)
  // 建一次就不動 —— 每個節點都是同一排橫向頂點
  if (foamed) {
    const across = new Float32Array(vertexCount)
    for (let v = 0; v < vertexCount; v++) across[v] = acrossOf(v % COLS)
    geometry.setAttribute('aAcross', new BufferAttribute(across, 1))
  }
  // 船身底下要壓在水線的頂點（1 = 壓）。著色器算浪高時讀它
  const sinkAttr = sink !== null ? new BufferAttribute(new Float32Array(vertexCount), 1) : null
  if (sinkAttr !== null) {
    sinkAttr.setUsage(DynamicDrawUsage)
    geometry.setAttribute('aSink', sinkAttr)
  }
  if (uvAttr !== null) {
    uvAttr.setUsage(DynamicDrawUsage)
    geometry.setAttribute('uv', uvAttr)
  }
  // 節點的年齡比例（0 新、1 到壽命），給泡沫的橫向分布用
  const ageAttr = foamed ? new BufferAttribute(new Float32Array(vertexCount), 1) : null
  if (ageAttr !== null) {
    ageAttr.setUsage(DynamicDrawUsage)
    geometry.setAttribute('aAge', ageAttr)
  }

  const material = new MeshBasicMaterial({
    map: foamed ? foam : null,
    color: WAKE_COLOR,
    transparent: true,
    // 【不寫深度】帶子是貼在水面上的一層，會被自己的後半段擋住
    depthWrite: false,
    side: DoubleSide,
  })
  /** 泡沫翻動的時鐘，秒。`step` 每幀寫 */
  const foamTime = { value: 0 }
  /** 接上的海面浪高 uniform；null = CPU 問浪高 */
  let ocean: OceanHeightUniforms | null = null
  /**
   * 著色器拿到的浪高 uniform：每一個都轉讀目前接上的那一組，所以換一片海只換參考、
   * 不必重編譯
   */
  const oceanProxy: Record<string, { readonly value: unknown }> = {}
  const proxyOf = (key: string) => ({ get value() { return ocean?.[key]?.value } })

  material.onBeforeCompile = (shader) => {
    injectVertexAlpha(shader)
    if (ocean !== null) {
      for (const key of Object.keys(ocean)) shader.uniforms[key] = oceanProxy[key] ??= proxyOf(key)
      // 【與海面同一支浪高】海面頂點算的是 oceanWaveHeight(未位移座標, 離海面中心的
      // 距離推得的格距)；這裡用同一個值，淡掉的短波也一起淡掉。帶子的 x/z 是世界座標
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>',
          `#include <common>\n${OCEAN_HEIGHT_GLSL}\n${sink !== null ? 'attribute float aSink;' : ''}`)
        .replace('#include <begin_vertex>', /* glsl */`#include <begin_vertex>
          {
            float waveH = oceanWaveHeight( transformed.xz, oceanVCell( transformed.xz - uOrigin ) );
            ${sink !== null ? 'if ( aSink > 0.5 ) waveH = min( waveH, 0.0 );' : ''}
            transformed.y += waveH;
          }`)
    }
    if (!foamed) return
    // 【泡沫會翻動】同一張泡沫圖用兩個尺寸、兩個方向的偏移各讀一次再合起來，偏移隨
    // 時間走 —— 兩層交疊的地方一直變，看起來是在翻滾，不是靜止的條紋。兩層是同一個
    // 等比縮放，泡沫團不會被拉扁。
    // 【橫向分布像射流】剛翻出來的一段（年齡小）整片濃；往後中間淡下去、只剩兩條外緣
    // 亮 —— 船尾的湍流先是一團，散開之後泡沫堆在兩側的浪脊上。`aAcross` 是離中線多遠
    // （−1…1），`aAge` 是年齡比例；兩者都與帶寬無關
    shader.uniforms['uFoamTime'] = foamTime
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>',
        '#include <common>\nattribute float aAcross;\nattribute float aAge;\nvarying float vAcross;\nvarying float vAge;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvAcross = aAcross;\nvAge = aAge;')
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>',
        '#include <common>\nuniform float uFoamTime;\nvarying float vAcross;\nvarying float vAge;')
      .replace('#include <map_fragment>', /* glsl */`
        vec4 foamA = texture2D( map, vMapUv + vec2( 0.0, uFoamTime * 0.05 ) );
        vec4 foamB = texture2D( map, vMapUv * 1.7 + vec2( 0.53, 0.37 - uFoamTime * 0.08 ) );
        float across = abs( vAcross );
        float soft = 1.0 - smoothstep( 0.8, 1.0, across );
        float ridge = smoothstep( 0.35, 0.8, across ) * soft;
        float k = smoothstep( 0.02, 0.3, vAge );
        float profile = mix( soft, max( ridge, 0.2 * soft ), k );
        diffuseColor.a *= clamp( ( foamA.a + foamB.a ) * 0.8 - 0.1, 0.0, 1.0 ) * profile;`)
  }
  // 【鍵要涵蓋每一種變體】魚雷與船共用這支 onBeforeCompile；鍵相同的兩個材質共用同一個
  // 程式，缺了哪一項就有一邊拿到錯的著色器
  material.customProgramCacheKey = () =>
    `wake-${foamed ? 'foam' : 'plain'}-${ocean !== null ? 'gpu' : 'cpu'}-${sink !== null ? 'sink' : ''}`

  const object = new Mesh(geometry, material)
  // 包圍球是建立時算的（全部在原點）—— 開著視錐剔除，相機一離開原點附近
  // 整條帶子會消失。與曳光彈、火花、粒子同一個坑
  object.frustumCulled = false

  const pos = position.array as Float32Array
  const alp = alpha.array as Float32Array
  const uvs = uvAttr === null ? null : uvAttr.array as Float32Array
  const ages = ageAttr === null ? null : ageAttr.array as Float32Array
  const sinkArr = sinkAttr === null ? null : sinkAttr.array as Float32Array

  /** 第 `j` 舊的正式節點在資料陣列裡的索引 */
  const slotOf = (slot: number, j: number): number =>
    slot * NODES
    + (((head[slot]! - count[slot]! + j) % NODES) + NODES) % NODES

  const pushNode = (slot: number, x: number, z: number, at: number): void => {
    const i = slot * NODES + head[slot]!
    nx[i] = x
    nz[i] = z
    nAge[i] = 0
    nOdo[i] = at
    head[slot] = (head[slot]! + 1) % NODES
    // 【容量比總數少一】留最後一格給頭端，否則高速時頭端會被擠掉
    if (count[slot]! < REAL_NODES) {
      count[slot] = count[slot]! + 1
      liveNodes++
    }
  }

  const cut = (slot: number): void => {
    liveNodes -= count[slot]!
    count[slot] = 0
    head[slot] = 0
    carry[slot] = 0
    seen[slot] = 0
    hasHead[slot] = 0
    odo[slot] = 0
  }

  /** 有效節點的座標。`j < count` 是正式節點，`j === count` 是頭端 */
  const ringX = (slot: number, j: number): number =>
    j < count[slot]! ? nx[slotOf(slot, j)]! : hx[slot]!
  const ringZ = (slot: number, j: number): number =>
    j < count[slot]! ? nz[slotOf(slot, j)]! : hz[slot]!

  /**
   * 把一格寫成頂點。**節點不足兩個時整格塌到原點且 alpha 為 0** ——
   * 索引緩衝是固定的，不寫的話會留著上一次的頂點。
   */
  const write = (
    slot: number, time: number,
    heightAt: (x: number, z: number, t: number) => number,
  ): void => {
    const base = slot * NODES * COLS
    const n = count[slot]! + (hasHead[slot] === 1 ? 1 : 0)
    if (n < 2) {
      for (let v = 0; v < NODES * COLS; v++) {
        const o = (base + v) * 3
        pos[o] = 0
        pos[o + 1] = 0
        pos[o + 2] = 0
        alp[base + v] = 0
      }
      return
    }
    const gpuHeight = ocean !== null
    for (let j = 0; j < NODES; j++) {
      // 【超出節點數的那幾格塌到最後一個上】它們之間的四邊形因此是零面積
      const jj = j < n ? j : n - 1
      const x = ringX(slot, jj)
      const z = ringZ(slot, jj)
      // 【橫向是水平的】帶子是平的，所以垂直於航向、且留在水平面上
      const a = jj === 0 ? 0 : jj - 1
      const b = jj === n - 1 ? n - 1 : jj + 1
      const dx = ringX(slot, b) - ringX(slot, a)
      const dz = ringZ(slot, b) - ringZ(slot, a)
      const len = Math.sqrt(dx * dx + dz * dz)
      // 退化（兩個節點同位置）時任取一個方向 —— 帶子在那裡寬度為零，看不到
      const sx = len > 1e-9 ? -dz / len : 1
      const sz = len > 1e-9 ? dx / len : 0
      // 【頭端的年齡是 0】它就是這一幀的位置
      const age = jj < count[slot]! ? nAge[slotOf(slot, jj)]! : 0
      const w = wakeHalfWidth(age, style) * widthK[slot]!
      const al = j < n ? wakeAlpha(age, style) : 0
      const f = Math.min(1, age / style.life)
      const tile = style.foamTile ?? 1
      const v = (jj < count[slot]! ? nOdo[slotOf(slot, jj)]! : odo[slot]!) / tile
      // 【先用外接圓篩】整條帶子只有船身附近那幾個節點會碰到矩形，逐頂點逐艘測的話
      // 一幀是幾十萬次
      let near = false
      if (sink !== null) {
        for (let k = 0; k < sink.count; k++) {
          const r = Math.hypot(sink.halfLength[k]!, sink.halfBeam[k]!) + w
          const ex = x - sink.x[k]!
          const ez = z - sink.z[k]!
          if (ex * ex + ez * ez <= r * r) { near = true; break }
        }
      }
      for (let c = 0; c < COLS; c++) {
        const vi = base + j * COLS + c
        // 左緣（across = −1）在 +s 那一側
        const across = acrossOf(c)
        const vx = x - sx * w * across
        const vz = z - sz * w * across
        let sunk = false
        if (near) {
          for (let k = 0; k < sink!.count && !sunk; k++) sunk = insideSinkBox(sink!, k, vx, vz)
        }
        let y = WAKE_LIFT
        if (!gpuHeight) {
          const h = heightAt(vx, vz, time)
          y += sunk && h > 0 ? 0 : h
        }
        const o = vi * 3
        pos[o] = vx
        pos[o + 1] = y
        pos[o + 2] = vz
        alp[vi] = al
        if (sinkArr !== null) sinkArr[vi] = sunk ? 1 : 0
        if (ages !== null) ages[vi] = f
        if (uvs !== null) {
          // u 照公尺：離中線幾公尺，帶子變寬時多鋪幾格而不是把同一格拉寬
          uvs[vi * 2] = (across * w) / tile
          uvs[vi * 2 + 1] = v
        }
      }
    }
  }

  return {
    object,
    get live() { return liveNodes },

    emit(slot, x, z, id) {
      if (!(slot >= 0) || slot >= slots) return
      // 【識別碼一換就是換了一枚】不能拿航程當身分：它每一枚都從 0 開始，
      // 只認得出「變小」。上一枚在近距離命中、只被畫到航程 0 就收掉時，
      // 下一枚的第一幀也是 0，兩條就接起來了
      if (id !== lastId[slot]!) cut(slot)
      lastId[slot] = id

      // 【頭端每幀都貼上去】不然帶子的前端永遠落後魚雷最多一個間隔，
      // 看起來像一段一段長出來的
      hx[slot] = x
      hz[slot] = z
      hasHead[slot] = 1

      if (seen[slot] === 0) {
        px[slot] = x
        pz[slot] = z
        seen[slot] = 1
        return
      }
      const dx = x - px[slot]!
      const dz = z - pz[slot]!
      const ox = px[slot]!
      const oz = pz[slot]!
      px[slot] = x
      pz[slot] = z
      const dist = Math.sqrt(dx * dx + dz * dz)
      if (dist <= 0) return
      const start = carry[slot]!
      const travelled = start + dist
      const odo0 = odo[slot]!
      odo[slot] = odo0 + dist
      let n = wakeEmitCount(travelled, style)
      if (n >= WAKE_MAX_PER_FRAME) {
        // 【被夾住就把餘數丟掉】不丟的話 carry 逐幀累積、沒有上界
        n = WAKE_MAX_PER_FRAME
        carry[slot] = 0
      } else {
        carry[slot] = travelled - n * style.spacing
      }
      for (let k = 1; k <= n; k++) {
        const d = k * style.spacing - start
        const t = d <= 0 ? 0 : d >= dist ? 1 : d / dist
        pushNode(slot, ox + dx * t, oz + dz * t, odo0 + dist * t)
      }
    },

    widen(slot, k) {
      if (slot >= 0 && slot < slots) widthK[slot] = k
    },

    step(dt, time, heightAt) {
      liveNodes = 0
      for (let slot = 0; slot < slots; slot++) {
        const n = count[slot]!
        if (n > 0) {
          // 【最舊的先過期】節點是依序落下的，所以年齡沿著 j 遞減
          let alive = 0
          for (let j = 0; j < n; j++) {
            const i = slotOf(slot, j)
            nAge[i] = nAge[i]! + dt
            if (nAge[i]! < style.life) alive++
          }
          if (alive < n) count[slot] = alive
          liveNodes += alive
        }
        write(slot, time, heightAt)
      }
      position.needsUpdate = true
      alpha.needsUpdate = true
      if (uvAttr !== null) uvAttr.needsUpdate = true
      if (ageAttr !== null) ageAttr.needsUpdate = true
      if (sinkAttr !== null) sinkAttr.needsUpdate = true
      foamTime.value = time
    },

    bindOcean(next) {
      // 有海與沒海是兩支不同的著色器；只換一片海的話代理 uniform 自己轉讀新的那一組
      if ((next === null) !== (ocean === null)) material.needsUpdate = true
      ocean = next
    },

    reset() {
      odo.fill(0)
      nAge.fill(0)
      count.fill(0)
      head.fill(0)
      carry.fill(0)
      seen.fill(0)
      lastId.fill(0)
      hasHead.fill(0)
      liveNodes = 0
      pos.fill(0)
      alp.fill(0)
      position.needsUpdate = true
      alpha.needsUpdate = true
    },

    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}
