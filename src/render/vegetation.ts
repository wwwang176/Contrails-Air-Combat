import {
  Color, DynamicDrawUsage, Group, InstancedBufferAttribute, InstancedMesh, Matrix4,
  MeshStandardMaterial, type BufferGeometry, type Object3D,
} from 'three'
import {
  createFloraBuffer, hash2, FloraKind, FLORA_STRIDE, type FloraBuffer, type FloraSource,
} from './flora'
import {
  createFloraGeometries, disposeFloraGeometries, CARD_POOLS, type PoolName,
} from './floraShapes'

export type { PoolName }

/**
 * 植被的引擎：**跟著鏡頭的 tile 快取 ＋ 分級的 InstancedMesh 池。**
 *
 * ```
 *   近   0 – 900 m        樹幹 ＋ 樹冠
 *   中   900 – 3,000      只有樹冠 —— 900 m 外樹幹不足 1 px
 *   卡片 3,000 – 6,000    公告板，1～2 tri
 *   外   > 6,000 m        不畫。著色器那條 18 m 的暗帶自己接手
 *   灌木 0 – 1,200 八面體、1,200 – 6,000 公告板
 *   建築 圈內都畫         一座 18 tri、圈內約 50 座，分級沒有意義
 * ```
 *
 * 【每一級都分樹種】闊葉三級都是圓的，針葉三級都是尖的 —— 換級只讓樹變
 * 簡單，不換剪影也不換顏色。公告板的形狀也對得上：菱形對八面體、
 * 三角形對錐。
 *
 * 【公告板是為了灌木】灌木密度是喬木的 2.4 倍，6 km 圈內有十五萬叢。
 * 八面體是 125 萬個三角形，公告板是 30 萬。
 *
 * 【LOD 是逐 tile 決定的，不是逐棵】逐棵切要每幀重建整個池。代價是 250 m
 * 的一格同時換級，在門檻上可能看得出來跳一下 —— 遲滯只擋來回抖動，擋不了
 * 這個。
 *
 * 【池只在生成佇列排乾的那一幀重建】一次約七千筆 `compose` 加一次緩衝上傳，
 * 200 m/s 下大約每 1.25 s 一次。每幀重建的話那個成本會變成常態。
 *
 * 【視錐剔除一律關掉】`Frustum.intersectsObject` 對 `InstancedMesh` 走
 * `object.boundingSphere`，而那顆球只在是 `null` 時算一次就快取；池每次重建
 * 實例全換，球就過期了，症狀是某些朝向下整批樹消失。而池是跟著鏡頭的 4 km
 * 圓環 —— 那顆球恆與視錐相交，剔除本來就一次也不會生效。
 */

export const TILE_SIZE = 250
export const FLORA_RADIUS = 6000

/**
 * 喬木由樹冠換到公告板的距離，m。
 *
 * 15 m 的樹在 3 km 是 4.6 px —— 還看得出剪影，所以公告板的形狀必須對得上
 * 它取代的那一級（菱形對八面體、三角形對錐），否則門檻上會跳。
 */
export const CARD_NEAR = 3000

/**
 * 樹幹畫到多遠，m。**唯一的換級門檻。**
 *
 * 樹幹直徑在縮放 1.0 時是 2 m，最小的那一株（縮放 0.5）是 1 m。960 px 高、
 * 60° 垂直視角下，1 m 在 d 公尺外約占 917 / d 個像素 —— 900 m 對最小的那一株
 * 正好是 1 px。
 *
 * 【放遠的代價很小】一棵樹由中級升到近級只多 12 個三角形（20 對 8、19 對 6）。
 * 換到的是「看得到樹幹」的時間 6 秒（甲板速度 150 m/s）。
 */
export const LOD_NEAR = 900

/** 換級的緩衝，m。只擋來回抖動 */
export const LOD_HYSTERESIS = 40

/**
 * 灌木畫到多遠，m。
 *
 * 【放遠過】500 m 時，再遠的樹籬只剩 12 m 一棵的喬木 —— 巡航高度看下去
 * 整片地的樹籬因此是稀疏的點列。灌木是 8 個三角形，比喬木便宜，放遠是
 * 划算的那一邊。1,200 m 是 8,314 叢，比 900 m 多 3,260 叢、26k 三角形。
 */
export const BUSH_RANGE = 1200

/**
 * 每幀最多生幾格。
 *
 * 【為什麼要 16】6 km 圈有 1,812 格。每幀四格的話冷啟動要 453 幀 ——
 * 60 fps 下是 7.6 秒的空白。生成實測 0.205 ms/格，所以滿載是 3.3 ms/幀，
 * 而且只發生在補格期間。
 */
export const TILES_PER_FRAME = 16

/**
 * 兩次重建之間至少隔幾幀。
 *
 * 【為什麼一定要節流】級數是逐 tile 決定的，而 900 m 與 3,000 m 兩條環上
 * 大約有 90 格；鏡頭每移動 250 m 那些格就各換級一次 —— 換算下來**幾乎
 * 每一幀都有一格換級**，於是「有變就重建」等於每幀重建三萬筆實例再上傳
 * 2.3 MB。
 *
 * 2026-08-29 實測（農地・甲板・代飛・1707×960 @ DPR 1.5・解鎖 vsync）：
 *
 * ```
 *            p50        1% low     頓挫
 *   有植被   29.7 ms    94.8 ms    2.72 /s
 *   關植被   26.3 ms    55.4 ms    0.36 /s
 * ```
 *
 * 中位數只差 3.4 ms 而尾巴翻倍 —— 那個形狀就是「每幀都在重傳一大塊還在用的
 * 緩衝」。
 *
 * 【成本確定在上傳，不在重建本身】三次對照量測：
 *
 * ```
 *                          p50（有／關）    1% low（有／關）  頓挫/s（有／關）
 *   每 6 幀重建            7.9 / 20.5       166 / 57         12.7 / 0.8
 *   重建凍住              18.3 / 19.6        50 / 45          1.4 / 0.4
 *   照樣重建但不上傳       19.8 / 19.9        50 / 40          0.5 / 0.1
 * ```
 *
 * 第三列是決定性的：重建的 CPU 迴圈照跑（實測 0.16 ms）而成本消失 ——
 * 貴的是每秒二十四次、每次一點一 MB 打在正在被 GPU 讀的緩衝上。
 */
export const REBUILD_EVERY = 6

/**
 * 兩次重建之間鏡頭至少要移動多少，m。**這是整個植被最敏感的一個數字。**
 *
 * 【為什麼用距離不是幀數】級數的顆粒是 250 m 的一格，所以移動兩百公尺才
 * 重算一次綽綽有餘。甲板速度 150 m/s 下這是每秒 0.75 次。
 *
 * 【停頓不隨上傳量走，隨次數走】把維持半徑砍掉一半（最大的那條緩衝整個
 * 消失）**一點改善都沒有**；而把重建的次數壓下來立刻有效。貴的是「對正在
 * 被 GPU 讀的緩衝呼叫 bufferSubData」這個動作本身。**維持半徑由 2,000 放到
 * 3,000 不增加上傳次數，只增加每次的量** —— 這一條就是它安全的理由。
 *
 * 2026-08-29 實測（農地・甲板・代飛・1707×960 @ DPR 1.5・飛機粒子全關）：
 *
 * ```
 *                        頓挫/s（有植被／關植被）   1% low（有／關）
 *   每幀可重建就重建            12.7 / 0.8          166 / 57 ms
 *   幀數節流（6 幀）            12.7 / 0.8          沒有改善
 *   距離閘 50 m                 2.34 / 0.10         162 / 41 ms
 *   距離閘 200 m                0.90 / 0.40         130 / 41 ms
 *   （對照）完全不上傳          0.50 / 0.10          50 / 40 ms
 * ```
 *
 * 最後一列是地板。200 m 已經吃到八成的可得改善，再往上拉會讓 LOD 換級
 * 明顯遲到。
 */
export const REBUILD_MOVE = 200

/**
 * 鏡頭不動時，隔這麼多幀仍然重建一次。
 *
 * 【為什麼要有】剛補完最後幾格、而鏡頭正好停著的那一刻，沒有這一條的話
 * 那幾格永遠不會被畫出來。
 */
const REBUILD_IDLE = 120

/**
 * 單一 tile 最多幾株。**預設值，逐圖可以覆寫。**
 *
 * 農地實測最密的一格是 351 株（整格都是樹林的那種），384 留了一成的餘裕。
 * **這個數字乘上 `TILE_CACHE` 就是 20 MB**，所以餘裕不能隨手放大。
 *
 * 【為什麼要逐圖】群島的島上是高密度的針葉林，一格最多 899 株 —— 而農地
 * 永遠用不到那個空間。兩張圖不會同時存在，所以各給各的最省。
 */
export const MAX_PER_TILE = 384

/**
 * 群島用的。島上的密度見 `render/flora.ts` 的 `ISLAND_GRID`。
 *
 * 實測最密的一格是 378 株（樹加灌木）。512 留了三成五的餘裕。
 *
 * 【這一個不跟著池的容量加倍】每一格都預配一份緩衝，`TILE_CACHE` 是 2,100
 * 格 —— 512 是 26.9 MB，加倍就是 53.7 MB 的 CPU 記憶體。池那一側整組加倍
 * 只要 7 MB，兩者的單價差一個量級。
 */
export const ISLAND_MAX_PER_TILE = 512

/**
 * 快取幾格。圈內約 1,812 格，多留的是移動時的暫時重疊。
 *
 * 每槽 `MAX_PER_TILE × FLORA_STRIDE × 4` bytes 的資料加 `MAX_PER_TILE` bytes
 * 的種類，2,100 槽約 20.2 MB。全部開場配掉，之後不再配置。
 */
export const TILE_CACHE = 2100

const LOD_STEP = [LOD_NEAR, CARD_NEAR, FLORA_RADIUS] as const

/**
 * 這個距離該用哪一級。`prev` 是目前的級數，`-1` 表示沒有前一級。
 *
 * 【遲滯】往外要多走 `LOD_HYSTERESIS`，往內要少走同樣多。沒有它的話，
 * 鏡頭停在門檻上時整格 tile 每幀換級。
 */
export function lodFor(dist: number, prev: number, outer: number = FLORA_RADIUS): number {
  const step = (k: number): number => (k === 2 ? outer : LOD_STEP[k]!)
  if (prev < 0) {
    let lod = 0
    while (lod < 3 && dist > step(lod)) lod++
    return lod
  }
  let lod = prev
  while (lod < 3 && dist > step(lod) + LOD_HYSTERESIS) lod++
  while (lod > 0 && dist < step(lod - 1) - LOD_HYSTERESIS) lod--
  return lod
}

/**
 * 外圈的抖動幅度。逐格把有效半徑乘 `1 − JITTER × hash`。
 *
 * 【為什麼要抖】`FLORA_RADIUS` 是一個精確的圓，掃過地面時整排樹一起出現。
 * 抖開之後那一環變成一條毛毛的帶，樹是零星冒出來的。
 *
 * 【只往內不往外】往外會越過 tile 快取的維持半徑（`inRange` 用的仍是精確
 * 的 `FLORA_RADIUS`）—— 那一格根本沒生成，症狀是圈緣閃爍。往內只是少畫，
 * 恆安全。
 */
export const OUTER_JITTER = 0.2

/** 這一格的有效外圈半徑，m */
export function outerFor(i: number, j: number, radius: number = FLORA_RADIUS): number {
  return radius * (1 - OUTER_JITTER * (hash2(i, j ^ 0x6b1f) / 4294967296))
}

/**
 * 各池的容量。**由 `vegetation.test.ts` 的掃描定值** —— 沿一條穿過全圖的
 * 航線取 40 個位置，各池的最大同時實例數乘 1.35 進位。註解裡的是實測最大值。
 *
 * 【掃描要帶哨兵容量】`rebuild()` 會先用這裡的數字截斷 `counts`，所以拿正式
 * 容量去掃是循環量測：容量偏小時，印出來的「最大值」就是截斷值。掃描那一條
 * 傳一個大得離譜的 `capacity` 進去，量到的才是真的需求。
 *
 * 【建築那三個為什麼放得寬】圈內通常只有一到兩個村，實測最大只有 18 棟房子，
 * 但那個數字對「村剛好在圈心」很敏感。三個池加起來也才 180 個實例。
 *
 * 溢位時丟掉並記一次告警，不靜默截斷。
 */
const CAPACITY: Record<PoolName, number> = {
  broadNear: 2800,     // 掃描最大 2,056
  coneNear: 1300,      // 913
  broadMid: 24100,     // 17,786
  coneMid: 9700,       // 7,158
  broadCard: 69000,    // 51,020
  coneCard: 22700,     // 16,805
  bushNear: 11900,     // 8,750
  bushCard: 207500,    // 153,558   ← 全部實例的六成
  house: 80,           // 58
  barn: 40,            // 21
  church: 20,          // 3
}

/**
 * 群島的容量。**島上只有針葉樹與灌木** —— 沒有闊葉、沒有建築，那六個池
 * 各留一格防呆就好。
 *
 * 【為什麼要逐圖】兩張圖不會同時存在，而它們的需求差一個量級：農地的
 * `coneCard` 峰值是 16,805，群島是 16,633。取聯集的話兩張圖都要付對方的帳。
 *
 * 【餘裕是兩倍不是 1.35 倍】專案負責人裁定。上一版近級寫 1,300 而實際要
 * 4,843 —— 超出的部分是 `stats.overflow` 靜靜丟掉的，症狀是飛過島心時近處
 * 的針葉林整片消失。一格實例是 152 byte（兩份矩陣加兩份顏色），這一組總共
 * 14.4 MB。
 */
export const ISLAND_CAPACITY: Record<PoolName, number> = {
  broadNear: 16, broadMid: 16, broadCard: 16,
  coneNear: 9700,      // 掃描最大 4,843
  coneMid: 17300,      // 8,619
  coneCard: 33300,     // 16,633
  bushNear: 10300,     // 5,149
  bushCard: 24300,     // 12,136
  house: 16, barn: 16, church: 16,
}

const POOL_NAMES: readonly PoolName[] = [
  'broadNear', 'coneNear', 'broadMid', 'coneMid',
  'broadCard', 'coneCard', 'bushNear', 'bushCard',
  'house', 'barn', 'church',
]

/** 哪些池走公告板材質。查表比字串比對便宜，而 `rebuild` 每筆都要問一次 */
const IS_CARD: Record<PoolName, boolean> =
  Object.fromEntries(POOL_NAMES.map((n) => [n, CARD_POOLS.includes(n)])) as Record<PoolName, boolean>

export interface Vegetation {
  readonly object: Object3D
  update(centerX: number, centerZ: number): void
  /**
   * 一次把生成佇列排乾。定格截圖與容量掃描要它。
   *
   * `force` 會把每一個池標髒再重建。**它是逐池標髒那套機制的正確性閘**：
   * 標漏了的池，`force` 前後的內容會不一樣。
   */
  settle(force?: boolean): void
  dispose(): void
  readonly counts: Record<PoolName, number>
  readonly stats: {
    /** 圈內活著的 tile 數 */
    tiles: number
    /** tile 的緩衝被截掉幾筆 */
    dropped: number
    /** 池溢位幾筆 */
    overflow: number
    /** 重建過幾次。節流有沒有生效看它 */
    rebuilds: number
    /**
     * 呼叫過幾次 source。**空格有沒有被重複生成看它。**
     *
     * 空格不留緩衝但要留槽位；漏了槽位的話這個數字會每幀往上跳。
     */
    generated: number
    /**
     * `fill` 看過幾個候選格。**挑格的成本看它。**
     *
     * 每生一格就重掃一次包圍方陣的話，這個數字會是圈內格數的
     * `TILES_PER_FRAME` 倍。
     */
    scanned: number
    /** 預配的緩衝身分，給「不配置」那條測試比對 */
    buffers: readonly Float32Array[]
    keyType: string
  }
  /**
   * 快取裡每一格的索引與級數。**只給測試用。**
   *
   * 【回的是複本】內部是幾條平行的 TypedArray，直接交出去等於讓測試改得到
   * 引擎的狀態。
   */
  debugTiles(): { i: number, j: number, lod: number }[]
}

const M = new Matrix4()
const TINT = new Color()

/**
 * 公告板的頂點位移。**取代 `begin_vertex`。**
 *
 * 【`transformed` 必須留在物件空間】`project_vertex` 在這之後還會做
 * `instanceMatrix * mvPosition` 再 `modelViewMatrix * mvPosition` ——
 * 這裡若組出世界座標，會被實例矩陣再乘一次。
 *
 * 【卡片的實例矩陣不帶旋轉】`rebuild` 對公告板那三個池不寫 Y 旋轉，所以
 * 「世界方向」與「物件方向」只差一個等比縮放，basis 可以直接用。
 *
 * 【只繞 Y 轉，不是完全面向鏡頭】樹是站著的。完全面向鏡頭的話，俯衝時
 * 整片樹林會躺平成一地色塊。
 *
 * 【繞序】幾何在 xy 平面上逆時針繞，而 x 映到 `right`、y 維持向上，於是
 * `right × up` 指向鏡頭 —— 螢幕上永遠是正面，不會被背面剔除掉。
 */
const CARD_VERTEX = `
vec3 cardOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
vec3 cardToEye = cameraPosition - cardOrigin;
vec2 cardH = vec2(cardToEye.z, -cardToEye.x);
float cardL = length(cardH);
// 【零向量要有退路】鏡頭正上方俯視時水平分量是零，normalize 會是 NaN
vec3 cardRight = cardL > 1e-4 ? vec3(cardH.x, 0.0, cardH.y) / cardL : vec3(1.0, 0.0, 0.0);
vec3 transformed = cardRight * position.x + vec3(0.0, position.y, 0.0);
`

/**
 * 公告板的材質。**與其他八池那顆分開，而且不能開 `flatShading`。**
 *
 * 【為什麼不能 flatShading】那會定義 `FLAT_SHADED`，而 fragment shader 在
 * 那個分支直接由 `dFdx/dFdy(vViewPosition)` 算面法線 —— 幾何裡設的
 * `(0, 1, 0)` 完全被忽略。卡片的面永遠朝著鏡頭，於是亮度隨鏡頭方位變，
 * 整片遠方樹林轉個向就明暗跳動，門檻上還會出現光照環。
 *
 * 【為什麼不能掛在共用材質上】那會讓近樹、樹冠、灌木、建築全部變成公告板，
 * 而幾何、池對應、容量、GLSL 編譯測試仍然可以全綠。
 */
function createCardMaterial(): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <begin_vertex>', CARD_VERTEX)
  }
  // 【換了著色器就要換 key】three 用它決定程式能不能重用
  m.customProgramCacheKey = () => 'flora-card'
  return m
}

/**
 * 這一株該進哪一個池。`null` = 這一級不畫它。
 *
 * 【樹種不隨級數變】兩級各有自己的闊葉與針葉。上一版把兩種樹在遠級併成
 * 同一個池，於是針葉樹過門檻時形狀與顏色一起換 —— 看起來像那棵樹換了種。
 */
export function poolOf(kind: number, lod: number, bushNear: boolean): PoolName | null {
  if (lod >= 3) return null
  switch (kind) {
    case FloraKind.BroadTree:
      return lod === 0 ? 'broadNear' : lod === 1 ? 'broadMid' : 'broadCard'
    case FloraKind.ConeTree:
      return lod === 0 ? 'coneNear' : lod === 1 ? 'coneMid' : 'coneCard'
    case FloraKind.Bush:
      return bushNear ? 'bushNear' : 'bushCard'
    case FloraKind.House:
      return 'house'
    case FloraKind.Barn:
      return 'barn'
    default:
      return 'church'
  }
}

export function createVegetation(
  sources: readonly FloraSource[],
  heightAt: (x: number, z: number) => number,
  /**
   * 覆寫池的容量。群島傳 `ISLAND_CAPACITY`；掃描與變異驗證傳哨兵值。
   * 不傳就是農地那一組 —— 見 `CAPACITY`
   */
  capacity?: Partial<Record<PoolName, number>>,
  /** 單格的上限。預設 `MAX_PER_TILE` —— 見那裡的說明 */
  maxPerTile: number = MAX_PER_TILE,
): Vegetation {
  const cap: Record<PoolName, number> = { ...CAPACITY, ...capacity }
  const geometries = createFloraGeometries()
  const material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9,
  })
  const cardMaterial = createCardMaterial()
  const group = new Group()
  const pools: Record<PoolName, InstancedMesh> = {} as Record<PoolName, InstancedMesh>
  /**
   * 每個池兩份實例屬性，重建時輪流換。**這是 1% low 的關鍵。**
   *
   * 【為什麼】上一版每次重建都對**正在被 GPU 讀的**那條緩衝呼叫
   * `bufferSubData`，驅動只能等 GPU 讀完或整條重配 —— 實測那一下是
   * 190 ms。輪流換之後寫的永遠是上一幀沒在畫的那一份，寫完才掛上去。
   *
   * 【代價是記憶體加倍】兩份加起來 7.6 MB。全部開場配掉。
   *
   * 2026-08-29 對照（農地・甲板・代飛・飛機粒子全關）：把重建整個凍住時
   * 1% low 是 37 ms、頓挫 0.70/s，而 p50 只比關植被多 1.8 ms —— 也就是說
   * 253k 個三角形的**繪製**幾乎免費，代價全在那一下上傳。
   */
  const altMat: Record<PoolName, InstancedBufferAttribute[]> =
    {} as Record<PoolName, InstancedBufferAttribute[]>
  const altCol: Record<PoolName, InstancedBufferAttribute[]> =
    {} as Record<PoolName, InstancedBufferAttribute[]>
  const side: Record<PoolName, number> = {} as Record<PoolName, number>
  for (const name of POOL_NAMES) {
    const mesh = new InstancedMesh(
      geometries[name] as BufferGeometry,
      IS_CARD[name] ? cardMaterial : material,
      cap[name],
    )
    // 【先摸一次 instanceColor】`setColorAt` 會在第一次呼叫時建出屬性，
    // 而那是一次配置 —— 開場配掉，之後重建就不再配
    mesh.setColorAt(0, TINT.setRGB(1, 1, 1))
    const mats = [mesh.instanceMatrix, new InstancedBufferAttribute(
      new Float32Array(cap[name] * 16), 16)]
    const cols = [mesh.instanceColor!, new InstancedBufferAttribute(
      new Float32Array(cap[name] * 3), 3)]
    // 【兩份都要標 DynamicDraw】`setColorAt` 建出來的那一份走預設的
    // `StaticDrawUsage`，而驅動會把 STATIC_DRAW 當成不會再變的資料
    for (const a of [...mats, ...cols]) a.setUsage(DynamicDrawUsage)
    altMat[name] = mats
    altCol[name] = cols
    side[name] = 0
    mesh.count = 0
    mesh.frustumCulled = false
    pools[name] = mesh
    group.add(mesh)
  }

  // ── tile 快取 ────────────────────────────────────────
  /**
   * 每一格的資料緩衝。**有東西才配。**
   *
   * 【為什麼不預配】群島 6 km 圈有 1,815 格，而只有 485 格真的長東西 ——
   * 其餘全是海。每格一份 512 株的緩衝是 26.9 MB，其中八成是空水格佔的位子；
   * 而半徑推遠時那個浪費是平方成長的。
   *
   * 【生 0 株就還回去】`makeTile` 先借一份、生完再看 —— 這樣不必為了「先知道
   * 有沒有東西」多抄一次。
   *
   * 【空格仍然佔槽位】`slotUsed` 是 1、`bySlot` 也照設，只有緩衝是 null。
   * 不佔的話每一幀都會重生一次那一格。
   */
  const slotBuf: (FloraBuffer | null)[] = new Array<FloraBuffer | null>(TILE_CACHE).fill(null)
  /** 還回來的緩衝。池的大小會長到「同時非空的格數」的高水位 */
  const freeBufs: FloraBuffer[] = []
  /** 配過的緩衝身分，給「只重用不增長」那條測試比對 */
  const bufIdentity: Float32Array[] = []

  function takeBuf(): FloraBuffer {
    const b = freeBufs.pop()
    if (b !== undefined) return b
    const fresh = createFloraBuffer(maxPerTile)
    bufIdentity.push(fresh.data)
    return fresh
  }

  function giveBuf(slot: number): void {
    const b = slotBuf[slot] ?? null
    if (b === null) return
    freeBufs.push(b)
    slotBuf[slot] = null
  }

  const slotI = new Int32Array(TILE_CACHE)
  const slotJ = new Int32Array(TILE_CACHE)
  const slotUsed = new Uint8Array(TILE_CACHE)
  const slotLod = new Int8Array(TILE_CACHE)
  const slotBush = new Uint8Array(TILE_CACHE)
  /** tile 的鍵 → 槽位。**鍵是數值** —— 字串鍵每幀都在配置 */
  const bySlot = new Map<number, number>()

  const counts: Record<PoolName, number> =
    Object.fromEntries(POOL_NAMES.map((n) => [n, 0])) as Record<PoolName, number>
  const stats = {
    tiles: 0, dropped: 0, overflow: 0, rebuilds: 0, generated: 0, scanned: 0,
    buffers: bufIdentity as readonly Float32Array[], keyType: 'number',
  }

  let centerX = 0
  let centerZ = 0
  let started = false
  let dirty = true
  let warned = false
  let sinceRebuild = 0
  let lastBuildX = Infinity
  let lastBuildZ = Infinity

  /**
   * 哪些池的內容真的變了。
   *
   * 【為什麼要逐池記】池是打包的陣列：某一格的貢獻變了，**只有那一個池**
   * 後面的項目會位移，別的池一個位元組都沒動。一格換級只動到近遠那四個池
   * 裡的兩個 —— 灌木那條（8,500 筆、544 KB）完全沒變，卻照樣被重傳。
   */
  const poolDirty: Record<PoolName, boolean> =
    Object.fromEntries(POOL_NAMES.map((n) => [n, true])) as Record<PoolName, boolean>
  /** 某一格由 `a` 級換到 `b` 級，會動到哪些池 */
  function markLevel(lod: number): void {
    if (lod === 0) { poolDirty.broadNear = true; poolDirty.coneNear = true }
    else if (lod === 1) { poolDirty.broadMid = true; poolDirty.coneMid = true }
    else if (lod === 2) { poolDirty.broadCard = true; poolDirty.coneCard = true }
  }
  /**
   * 建築那三個池。**每一格都可能有建築**，所以加減格一定要標它們。
   * 三個池加起來 180 筆、14 KB —— 標了也不痛。
   */
  function markBuildings(): void {
    poolDirty.house = true
    poolDirty.barn = true
    poolDirty.church = true
  }

  const keyOf = (i: number, j: number): number => i * 65536 + j

  /**
   * 放掉一格。**只標它真的有貢獻的那些池。**
   *
   * 【為什麼不是全部標髒】圈緣加減一格只動到遠級那兩個池與建築 —— 灌木
   * （665 KB）與近級（226 KB）一個位元組都沒變。連續飛行時圈緣一直在換，
   * 全部標髒等於每次重建都全量重傳 2.8 MB。
   *
   * 【這裡的兩個標記在目前可達的狀態下是冗餘的】放格與補格成對發生而且
   * 級數相同，所以 `relevel` 會標到同一批池。留著是因為那個「成對」是巧合
   * 不是不變量 —— 變異驗證確認得到的只有 `relevel` 那條灌木標記。
   */
  function freeSlot(slot: number): void {
    bySlot.delete(keyOf(slotI[slot]!, slotJ[slot]!))
    giveBuf(slot)
    slotUsed[slot] = 0
    freeSlots.push(slot)
    markLevel(slotLod[slot]!)
    poolDirty.bushNear = true
    poolDirty.bushCard = true
    markBuildings()
  }

  /**
   * 空著的槽位。**堆疊，不是線性掃描。**
   *
   * 【為什麼】12 km 的圈要 7,600 槽，而每幀補 61 格 —— 線性掃描是每幀
   * 四十六萬次迴圈。
   */
  const freeSlots: number[] = []
  for (let s = TILE_CACHE - 1; s >= 0; s--) freeSlots.push(s)

  function takeSlot(): number {
    const s = freeSlots.pop()
    if (s !== undefined) return s
    // 【滿了就丟最舊的】圈內的格數恆小於快取，正常不會走到這裡
    freeSlot(0)
    return freeSlots.pop()!
  }

  /** 生一格。回 false 表示這一格已經在快取裡 */
  function makeTile(i: number, j: number): boolean {
    if (bySlot.has(keyOf(i, j))) return false
    const slot = takeSlot()
    const buf = takeBuf()
    buf.count = 0
    buf.dropped = 0
    const x0 = i * TILE_SIZE
    const z0 = j * TILE_SIZE
    stats.generated++
    for (const src of sources) src(x0, z0, x0 + TILE_SIZE, z0 + TILE_SIZE, heightAt, buf)
    // 【空格把緩衝還回去】槽位照佔 —— 不佔的話每一幀都會重生一次
    if (buf.count === 0) freeBufs.push(buf)
    else slotBuf[slot] = buf
    if (buf.dropped > 0) {
      stats.dropped += buf.dropped
      if (!warned) {
        warned = true
        console.warn(`植被：單格超過上限 ${maxPerTile}，丟了 ${buf.dropped} 株`)
      }
    }
    slotI[slot] = i
    slotJ[slot] = j
    slotUsed[slot] = 1
    // 【級數與灌木旗標歸零】新的一格由 `relevel` 定級，而它是「有變才標」——
    // 沿用上一位住戶的值會讓「其實變了」被當成沒變
    slotLod[slot] = -1
    slotBush[slot] = 0
    bySlot.set(keyOf(i, j), slot)
    // 【樹與灌木交給 relevel 標】它一定會看到 -1 → 新級數的變化。
    // 這裡只要補上它不管的建築
    dirty = true
    markBuildings()
    return true
  }

  /**
   * 格心在圈內嗎。
   *
   * 【界線就是 `FLORA_RADIUS`，不多放】LOD 是**按格心**決定的，所以格心在
   * 2 km 之外的那一格整格是第 3 級 —— 生了也不畫。多放一圈等於白生。
   * 這樣一來「活著的格數」與「建築的實例數」是同一個數字。
   */
  function inRange(i: number, j: number): boolean {
    const cx = i * TILE_SIZE + TILE_SIZE / 2
    const cz = j * TILE_SIZE + TILE_SIZE / 2
    return Math.hypot(cx - centerX, cz - centerZ) <= FLORA_RADIUS
  }

  /** 放掉圈外的格 */
  function evict(): void {
    for (let s = 0; s < TILE_CACHE; s++) {
      if (slotUsed[s] === 0) continue
      if (inRange(slotI[s]!, slotJ[s]!)) continue
      freeSlot(s)
      dirty = true
    }
  }

  /**
   * 生最多 `budget` 格，**由近而遠**。
   *
   * 【為什麼不是佇列】掃一次格範圍是 256 次迴圈，比維護一條佇列還便宜，
   * 而且傳送時不必特別去清 —— 範圍一換，該生的自然就換了。
   */
  /**
   * 由近到遠的格偏移。**建構時算一次。**
   *
   * 【為什麼要有它】上一版的 `fill` 每生一格就重掃整個包圍方陣挑最近的空格
   * —— 6 km、每幀 16 格是 38,416 次；12 km、每幀 61 格會變成 57 萬次。照這
   * 張表由近往外走，每幀只掃一趟。
   *
   * 【半徑多留一格】表只決定順序，真正的圈仍然由 `inRange` 決定。多留一格
   * 讓鏡頭落在格內任何位置時都不會漏掉邊緣那一環。
   *
   * 【順序差半格沒關係】表是相對於格中心排的，而鏡頭可以落在格內任何位置。
   * 那只影響「先生哪一格」，不影響最後生了哪些格。
   */
  const ring = ((): { di: Int16Array, dj: Int16Array } => {
    const reach = Math.ceil(FLORA_RADIUS / TILE_SIZE) + 1
    const items: { di: number, dj: number, d2: number }[] = []
    for (let dj = -reach; dj <= reach; dj++) {
      for (let di = -reach; di <= reach; di++) {
        const d2 = di * di + dj * dj
        if (d2 > reach * reach) continue
        items.push({ di, dj, d2 })
      }
    }
    items.sort((a, b) => a.d2 - b.d2)
    const di = new Int16Array(items.length)
    const dj = new Int16Array(items.length)
    for (let k = 0; k < items.length; k++) {
      di[k] = items[k]!.di
      dj[k] = items[k]!.dj
    }
    return { di, dj }
  })()

  function fill(budget: number): number {
    const ci = Math.floor(centerX / TILE_SIZE)
    const cj = Math.floor(centerZ / TILE_SIZE)
    let made = 0
    for (let k = 0; k < ring.di.length && made < budget; k++) {
      stats.scanned++
      const i = ci + ring.di[k]!
      const j = cj + ring.dj[k]!
      if (!inRange(i, j)) continue
      if (bySlot.has(keyOf(i, j))) continue
      makeTile(i, j)
      made++
    }
    return made
  }

  /** 重新決定每一格的級數。有任何一格改變就標髒 */
  function relevel(): void {
    let live = 0
    for (let s = 0; s < TILE_CACHE; s++) {
      if (slotUsed[s] === 0) continue
      live++
      const cx = slotI[s]! * TILE_SIZE + TILE_SIZE / 2
      const cz = slotJ[s]! * TILE_SIZE + TILE_SIZE / 2
      const d = Math.hypot(cx - centerX, cz - centerZ)
      const lod = lodFor(d, slotLod[s]!, outerFor(slotI[s]!, slotJ[s]!))
      const bush = d <= BUSH_RANGE + (slotBush[s] === 1 ? LOD_HYSTERESIS : 0) ? 1 : 0
      if (lod !== slotLod[s]) {
        dirty = true
        markLevel(slotLod[s]!)
        markLevel(lod)
      }
      if (bush !== slotBush[s]) {
        dirty = true
        poolDirty.bushNear = true
        poolDirty.bushCard = true
      }
      slotLod[s] = lod
      slotBush[s] = bush
    }
    stats.tiles = live
  }

  /**
   * 把所有活著的 tile 寫進池。
   *
   * 【只碰髒的池】沒變的池連寫都不寫 —— 它掛著的那份屬性已經是對的，而
   * 重寫一遍再上傳只是把 GPU 逼去等。`counts` 也因此只對髒的池歸零。
   */
  function rebuild(): void {
    for (const name of POOL_NAMES) {
      if (!poolDirty[name]) continue
      counts[name] = 0
      // 【換到另一份再寫】寫的永遠是上一幀沒在畫的那一份
      side[name] ^= 1
      const mesh = pools[name]
      mesh.instanceMatrix = altMat[name]![side[name]!]!
      mesh.instanceColor = altCol[name]![side[name]!]!
    }
    stats.overflow = 0
    for (let s = 0; s < TILE_CACHE; s++) {
      if (slotUsed[s] === 0) continue
      const buf = slotBuf[s] ?? null
      if (buf === null) continue
      const lod = slotLod[s]!
      const bush = slotBush[s] === 1
      for (let k = 0; k < buf.count; k++) {
        const name = poolOf(buf.kind[k]!, lod, bush)
        if (name === null || !poolDirty[name]) continue
        const at = counts[name]
        if (at >= cap[name]) {
          stats.overflow++
          continue
        }
        const o = k * FLORA_STRIDE
        const scale = buf.data[o + 4]!
        const rot = buf.data[o + 3]!
        // 【就地寫矩陣，不用 compose】只有繞 Y 的旋轉與等比縮放，
        // 四元數那一趟省下來。
        //
        // 【公告板不帶旋轉】朝向是頂點著色器算的，而它假設實例矩陣只有
        // 平移與等比縮放 —— 見 `CARD_VERTEX`
        const card = IS_CARD[name]
        const c = card ? scale : Math.cos(rot) * scale
        const sn = card ? 0 : Math.sin(rot) * scale
        M.set(
          c, 0, sn, buf.data[o]!,
          0, scale, 0, buf.data[o + 1]!,
          -sn, 0, c, buf.data[o + 2]!,
          0, 0, 0, 1,
        )
        const mesh = pools[name]
        mesh.setMatrixAt(at, M)
        // 【逐實例的明度抖動】同一種樹因此不會像複製貼上
        const t = 0.86 + buf.data[o + 5]! * 0.28
        mesh.setColorAt(at, TINT.setRGB(t, t, t))
        counts[name] = at + 1
      }
    }
    for (const name of POOL_NAMES) {
      if (!poolDirty[name]) continue
      poolDirty[name] = false
      const mesh = pools[name]
      const used = counts[name]
      mesh.count = used
      // 【只上傳用到的那一段】容量是實測最大值的 1.35 倍，整條傳等於白傳
      // 三成五。bushCard 一條就是 12 MB
      mesh.instanceMatrix.addUpdateRange(0, used * 16)
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor!.addUpdateRange(0, used * 3)
      mesh.instanceColor!.needsUpdate = true
    }
    dirty = false
    sinceRebuild = 0
    lastBuildX = centerX
    lastBuildZ = centerZ
    stats.rebuilds++
  }

  function update(cx: number, cz: number): void {
    // 【傳送】移動超過半徑的話舊的一圈完全用不上了。`evict` 本來就會放掉
    // 它們，這裡只是把它寫明：範圍一換，`fill` 挑的就是新的格
    centerX = cx
    centerZ = cz
    started = true
    evict()
    fill(TILES_PER_FRAME)
    relevel()
    sinceRebuild++
    // 【三道閘】還在補格的期間不重建；兩次重建至少隔 REBUILD_EVERY 幀；
    // 而且鏡頭要移動 REBUILD_MOVE 公尺（或停著超過 REBUILD_IDLE 幀）。
    // 第三道才是關鍵 —— 見那兩個常數的說明
    const moved = Math.hypot(centerX - lastBuildX, centerZ - lastBuildZ)
    // 【補格期間照樣重建】舊版在 `made !== 0` 時禁止重建 —— 6 km 圈有 1,812
    // 格，冷啟動與傳送之後那是好幾秒的空白。當初加那條的理由（上傳很貴）
    // 已經不成立：真正的同步點是別處每幀的空傳，見 `render/debris.ts`
    if (dirty && sinceRebuild >= REBUILD_EVERY
      && (moved >= REBUILD_MOVE || sinceRebuild >= REBUILD_IDLE)) rebuild()
  }

  function settle(force?: boolean): void {
    if (!started) update(centerX, centerZ)
    if (force === true) {
      for (const name of POOL_NAMES) poolDirty[name] = true
      dirty = true
    }
    // 【上界是快取大小】圈內約 201 格，這個上界只是防呆
    for (let n = 0; n < TILE_CACHE * 2; n++) if (fill(1) === 0) break
    evict()
    relevel()
    // 【settle 不受節流】定格截圖要的是「現在就對」
    if (dirty) rebuild()
  }

  return {
    object: group,
    update,
    settle,
    counts,
    stats,
    debugTiles() {
      const out: { i: number, j: number, lod: number }[] = []
      for (let s = 0; s < TILE_CACHE; s++) {
        if (slotUsed[s] === 0) continue
        out.push({ i: slotI[s]!, j: slotJ[s]!, lod: slotLod[s]! })
      }
      return out
    },
    dispose() {
      disposeFloraGeometries(geometries)
      material.dispose()
      cardMaterial.dispose()
      for (const name of POOL_NAMES) pools[name].dispose()
    },
  }
}
