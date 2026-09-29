import {
  BufferAttribute, BufferGeometry, Color, DynamicDrawUsage, Group,
  InstancedBufferAttribute, InstancedInterleavedBuffer, InstancedMesh, InterleavedBufferAttribute,
  MeshStandardMaterial, Points, PointsMaterial, Sphere, Vector3, type Camera, type Object3D,
} from 'three'
import { CULL, frustumPlanesOf, hilbertKey, shareGeometry, visibleRuns } from './cullRuns'
import {
  createFloraBuffer, hash2, FloraKind, FLORA_STRIDE, SHAPE_ONE, type FloraBuffer, type FloraSource,
} from './flora'
import {
  createFloraGeometries, disposeFloraGeometries, POINT_POOLS, pointColorOf,
  POINT_SIZE, POINT_Y, type MeshPool, type PointPool, type PoolName,
} from './floraShapes'
import type { Season } from './season'

export type { PoolName }

/**
 * 植被的引擎：**跟著鏡頭的 tile 快取 ＋ 分級的 InstancedMesh 池。**
 *
 * ```
 *   近   0 – 900 m        樹幹 ＋ 樹冠
 *   中   900 – 3,000      只有樹冠 —— 900 m 外樹幹不足 1 px
 *   點   3,000 – 半徑     `gl.POINTS`，一株一個頂點
 *   外   > 半徑            不畫。農地那邊由著色器的 18 m 暗帶接手
 *   灌木 0 – 1,200 八面體、1,200 – 半徑 點
 *   建築 圈內都畫         一座 18 tri、圈內約 50 座，分級沒有意義
 * ```
 *
 * 【每一級都分樹種】闊葉兩級都是圓的，針葉兩級都是尖的 —— 換級只讓樹變
 * 簡單，不換剪影也不換顏色。點的邊長解的是「與它取代的那一級側影**同面積**」，
 * 所以過門檻時被遮住的地是連續的。
 *
 * 【遠處為什麼是點】6 km 的樹只有 2.1 px 寬 —— 那個尺度上形狀是看不出來的，
 * 而點一株只要一個頂點與 56 byte，一片轉向鏡頭的網格要三到六個頂點與 152。
 *
 * 【LOD 是逐 tile 決定的，不是逐棵】逐棵切要每幀重建整個池。代價是 250 m
 * 的一格同時換級，在門檻上可能看得出來跳一下 —— 遲滯只擋來回抖動，擋不了
 * 這個。
 *
 * 【池只在生成佇列排乾的那一幀重建】一次約七千筆 `compose` 加一次緩衝上傳，
 * 200 m/s 下大約每 1.25 s 一次。每幀重建的話那個成本會變成常態。
 *
 * 【three 的視錐剔除一律關掉，剔除自己做】`Frustum.intersectsObject` 對
 * `InstancedMesh` 走 `object.boundingSphere`，而池是跟著鏡頭的圓環 —— 那顆球恆與
 * 視錐相交，一次也不會生效。改成逐格剔：池依希爾伯特曲線打包（`hilbertKey`），
 * 每一格在每一池裡是一段連續的實例並記下包圍盒；每一幀看得到的格接成最多
 * `RUN_CAP` 段，一段一次 draw call，全部畫在同一條緩衝上。見 `cull`。
 */

export const TILE_SIZE = 250
export const FLORA_RADIUS = 6000

/**
 * 喬木由樹冠換到點的距離，m。
 *
 * 30 m 的樹在 3 km 是 9.2 px —— 還看得出一點形狀，所以點的**面積**必須對得上
 * 它取代的那一級的側影，否則門檻上林相會突然變厚或變薄。
 */
export const POINT_NEAR = 3000

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
 * 實測（農地・甲板・代飛・1707×960 @ DPR 1.5・解鎖 vsync）：
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
 * 實測（農地・甲板・代飛・1707×960 @ DPR 1.5・飛機粒子全關）：
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
 * 重建一幀最多走過幾筆 tile 資料。**重建因此分好幾幀做完。**
 *
 * 農地圈內約二十六萬筆，一次寫完是 20–50 ms 的 JS 尖峰（德 M3 底板行動
 * 實測，每 1.3 s 一次）。Iris Xe 上實測一片四萬筆最長 6.2 ms、約 0.15 µs 一筆，
 * 所以一萬筆約 1.5 ms、二十六片左右做完 —— 期間補格與換級暫停，換級最多晚
 * 半秒上下，而換級的顆粒是 250 m 的一格。
 *
 * 分幀期間畫面上掛的是上一份完整的內容，見 `job`。
 */
export const REBUILD_BUDGET = 10000

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
 * 一格 250 m 的 tile 是 370 個 13 m 的網格；山頂的樹叢裡樹的接受率接近 1、
 * 灌木 0.7，滿格是 600 株上下。768 留了兩成八的餘裕。
 *
 * 【不隨手加倍】每一格都預配一份緩衝，`TILE_CACHE` 是 2,100 格 —— 768 是
 * 40 MB 的 CPU 記憶體，1,024 就是 54 MB。池那一側整組加倍只要 7 MB，兩者
 * 的單價差一個量級。
 */
export const ISLAND_MAX_PER_TILE = 768

/**
 * 群島的植被半徑，m。**農地不跟。**
 *
 * 【為什麼群島推得動】推遠的成本九成是空水格佔的快取緩衝，而那一項已經改成
 * 懶配 —— 12 km 的圈有 7,232 格，只有 289 格真的長東西。農地每一格都有東西，
 * 推遠是實打實的四倍。
 *
 * 【為什麼要推】6 km 是「島還看得清楚」的距離，那一刀切在畫面正中間。12 km
 * 外的島只剩幾十個像素高，那個距離上有沒有樹已經看不出來了。
 */
export const ISLAND_RADIUS = 12000

/**
 * 群島每幀最多生幾格。
 *
 * 【由冷啟動反推】12 km 的圈有 7,232 格，每幀 61 格是 120 幀 ≈ 2.0 秒，
 * 補格期間 3.6 ms/幀、穩態 0.86 ms/幀。每幀 16 格要 7.5 秒 —— 那是七秒半
 * 的空白植被。`test/tools/island-coldstart.probe.ts` 有整張表。
 */
export const ISLAND_TILES_PER_FRAME = 61

/**
 * 快取幾格。圈內約 1,812 格，多留的是移動時的暫時重疊。
 *
 * 每槽 `MAX_PER_TILE × FLORA_STRIDE × 4` bytes 的資料加 `MAX_PER_TILE` bytes
 * 的種類，2,100 槽約 20.2 MB。全部開場配掉，之後不再配置。
 */
export const TILE_CACHE = 2100

/**
 * 一池最多分幾段畫（幾次 draw call）。
 *
 * 【取四】6 km 圈、97° 視野、希爾伯特順序下，看得到的格佔 28.7%；上限四段時實際畫
 * 33%，六段 31%，兩段 45%。四段以上多出來的 draw call 換不到多少。
 */
export const RUN_CAP = 4

/**
 * 實例少於這個數的池只畫一段 —— 第一個看得到的格到最後一個。
 *
 * 【為什麼】建築一池幾十到幾百棟，多拆幾次 draw call 省下的頂點比 draw call 本身還少。
 */
export const RUN_SPLIT_MIN = 2000

/** 槽位號合進排序鍵的倍率：鍵 = 希爾伯特位置 × 這個數 + 槽位。快取不得超過它 */
const SLOT_SPAN = 16384

const LOD_STEP = [LOD_NEAR, POINT_NEAR, FLORA_RADIUS] as const

/**
 * 這個距離該用哪一級。`prev` 是目前的級數，`-1` 表示沒有前一級。
 *
 * 【遲滯】往外要多走 `LOD_HYSTERESIS`，往內要少走同樣多。沒有它的話，
 * 鏡頭停在門檻上時整格 tile 每幀換級。
 */
export function lodFor(dist: number, prev: number, outer: number = FLORA_RADIUS): number {
  // 【門檻直接內聯，不建閉包】`relevel` 每幀每格呼叫一次，閉包每次都是一次配置
  if (prev < 0) {
    let lod = 0
    while (lod < 3 && dist > (lod === 2 ? outer : LOD_STEP[lod]!)) lod++
    return lod
  }
  let lod = prev
  while (lod < 3 && dist > (lod === 2 ? outer : LOD_STEP[lod]!) + LOD_HYSTERESIS) lod++
  while (lod > 0 && dist < (lod === 3 ? outer : LOD_STEP[lod - 1]!) - LOD_HYSTERESIS) lod--
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
 * 【兩組散佈器都掃】田一路到底（洛伊納）與田圍著村（程序生成的內陸地圖，空地
 * 上成團的樹林）各掃一次取大的。樹的那六池的峰值出自田圍著村，灌木與建築出自
 * 田一路到底。
 *
 * 【建築的峰值出自田圍著村】那幾張圖的村是洛伊納那一套生成器蓋的（三合院農莊、
 * 小聚落，`farmSettlements.ts`），圈內兩三個村就上百棟。洛伊納的真實村鎮另有
 * 覆寫（`leunaFeatures.ts`）。
 *
 * 溢位時丟掉並記一次告警，不靜默截斷。
 *
 * 匯出是給測試的哨兵容量用的：哨兵取兩張圖容量的最大值再乘 2，跟著這裡走，
 * 測試裡不另外寫死一份數字。
 */
export const CAPACITY: Record<PoolName, number> = {
  broadNear: 3500,     // 掃描最大 2,543
  coneNear: 1500,      // 1,049
  broadMid: 26700,     // 19,718
  coneMid: 11800,      // 8,708
  broadPoint: 60100,    // 44,459
  conePoint: 21800,     // 16,136
  bushNear: 11900,     // 8,750
  bushPoint: 207500,    // 123,563   ← 全部實例的一半上下
  house: 320,          // 229
  barn: 190,           // 138
  church: 20,          // 4
  houseSlate: 60,      // 41
  barnTar: 80,         // 56
}

/**
 * 群島的容量。**島上只有針葉樹與灌木** —— 沒有闊葉、沒有建築，那六個池
 * 各留一格防呆就好。
 *
 * 【為什麼要逐圖】兩張圖不會同時存在，而它們的需求差一個量級：農地的
 * `conePoint` 峰值是 16,805，群島是 22,252。取聯集的話兩張圖都要付對方的帳。
 *
 * 【餘裕是兩倍不是 1.35 倍】配太小的話超出的部分由 `stats.overflow` 靜靜
 * 丟掉，症狀是飛過島心時近處的針葉林整片消失（近級配 1,300 而實際要
 * 4,694）。一格實例是 152 byte（兩份矩陣加兩份顏色），這一組總共 17.2 MB。
 */
export const ISLAND_CAPACITY: Record<PoolName, number> = {
  broadNear: 16, broadMid: 16, broadPoint: 16,
  coneNear: 9700,      // 掃描最大 4,694
  coneMid: 17300,      // 8,619
  conePoint: 44500,     // 22,252
  bushNear: 10300,     // 5,149
  bushPoint: 32100,     // 16,035
  house: 16, barn: 16, church: 16, houseSlate: 16, barnTar: 16,
}

/**
 * 雷伊泰的容量。**只有闊葉樹與灌木**，沒有針葉、沒有建築。
 *
 * 【闊葉比內陸大】山脈又大又多、山坡是林子。哨兵容量掃過場地網格、每一座山脈
 * 的圓心與高瓣的峰值：broadNear 5,384、broadMid 49,452、broadPoint 102,100、
 * bushNear 6,777、bushPoint 101,621。
 *
 * 【餘裕取 1.5 倍上下，不是群島的兩倍】兩倍的話實例數與記憶體多三成而換不到
 * 東西。掃描已經包含每一座山脈的高處，峰值不會在別處高出五成。灌木的遠級照
 * 峰值配，不沿用內陸那 20 萬。**動山脈就要重掃**，溢位是靜靜丟掉的。
 */
export const LEYTE_CAPACITY: Record<PoolName, number> = {
  ...CAPACITY,
  broadNear: 8100,
  broadMid: 74200,
  broadPoint: 153200,
  bushNear: 10200,
  bushPoint: 152400,
}

/** 建築的池。明度抖動用 `TINT_RANGE.building` */
const BUILDING_POOLS: readonly PoolName[] = ['house', 'barn', 'church', 'houseSlate', 'barnTar']

/**
 * 逐實例的明度倍率範圍（乘在頂點色上，整株一起乘）。
 *
 * 【建築放得比樹寬】老房子的瓦與牆一棟跟一棟新舊不一、有的剛翻修、有的被煤煙
 * 燻黑 —— 窄的話一整個鎮的屋頂是同一個紅。
 */
export const TINT_RANGE = { plant: [0.86, 1.14], building: [0.74, 1.22] } as const

const POOL_NAMES: readonly PoolName[] = [
  'broadNear', 'coneNear', 'broadMid', 'coneMid',
  'broadPoint', 'conePoint', 'bushNear', 'bushPoint',
  'house', 'barn', 'church', 'houseSlate', 'barnTar',
]

/** 哪些池走點材質。查表比字串比對便宜，而 `rebuild` 每筆都要問一次 */
const IS_POINT: Record<PoolName, boolean> =
  Object.fromEntries(POOL_NAMES.map((n) => [n, POINT_POOLS.includes(n)])) as Record<PoolName, boolean>

/**
 * 「種類 × 級數 × 灌木旗標」→ 池在 `POOL_NAMES` 裡的索引，`-1` = 這一級不畫。
 *
 * **每一格都由 `poolOf` 算出**，兩者不可能分家。重建每一筆查一次表，不經過
 * 字串與物件屬性 —— 每筆好幾次以池名查屬性，是重建一片跑到 10 ms 以上的原因。
 *
 * 索引是 `kind × 10 + (lod + 1) × 2 + bush`：`kind` 是 Uint8Array 的值，
 * `lod` 涵蓋 `slotLod` 可能的 −1 到 3。
 */
const POOL_LUT: Int8Array = (() => {
  const lut = new Int8Array(256 * 10)
  for (let kind = 0; kind < 256; kind++) {
    for (let lod = -1; lod <= 3; lod++) {
      for (let bush = 0; bush < 2; bush++) {
        const name = poolOf(kind, lod, bush === 1)
        lut[kind * 10 + (lod + 1) * 2 + bush] = name === null ? -1 : POOL_NAMES.indexOf(name)
      }
    }
  }
  return lut
})()

export interface Vegetation {
  readonly object: Object3D
  /**
   * 點池的亮度倍率，1 = 不變。**只作用在點池上** —— 近、中兩級走標準材質，
   * 換了燈就自己變暗。
   *
   * 【為什麼乘在材質上而不是重烘逐株的顏色】格是串流進來的，重烘只會影響
   * 之後才生出來的格 —— 畫面上會是新舊兩種亮度並存的補丁。
   */
  setPointLight(scale: number): void
  update(centerX: number, centerZ: number): void
  /**
   * 依這一台相機決定每一池畫哪幾段。**每次 render 之前呼叫**（`scene.onBeforeRender`），
   * 不呼叫的話每一池畫整條。`CULL.enabled` 關掉時也是畫整條。
   */
  cull(camera: Camera): void
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

/**
 * 遠處那三個池的材質。**`gl.POINTS`。**
 *
 * 【為什麼是點】6 km 的樹只有 2.1 px 寬 —— 圓的方的三角的在那個尺度上是
 * 同一團色塊。點一株只要一個頂點與 56 byte（位置 3 ＋ 顏色 3 ＋ 大小 1，
 * 雙緩衝），而一片轉向鏡頭的網格要三到六個頂點與 152 byte（矩陣 16 ＋
 * 顏色 3，雙緩衝）。
 * 而幀時間的大頭是 `bufferSubData`。
 *
 * 【側面的好處】一片只繞 Y 轉的網格由正上方俯視時是側面朝上、幾乎看不見 ——
 * 而那是空戰最常見的視角。點是螢幕對齊的，俯視時照樣是方塊。
 *
 * 【`size` 一定要留著且設成 1】DPR 藏在它裡面：`WebGLMaterials` 寫的是
 * `uniforms.size.value = material.size * pixelRatio`，而
 * `uniforms.scale.value = height * 0.5` 用的是 **CSS 高**。把 `size` 整個
 * 換掉的話，DPR = 2 的螢幕上點只有一半大 —— 而在 DPR = 1 的機器上完全正常。
 *
 * 四個因子相乘就是「世界長度 `aSize` 的緩衝區像素數」：
 *
 * ```
 *   aSize                     世界長度，m（逐株屬性）
 *   projectionMatrix[1][1]    1 / tan(fovY/2)
 *   size                      1 × devicePixelRatio      ← three 乘上去的
 *   scale / -mvPosition.z     (CSS 高 / 2) / 距離        ← sizeAttenuation
 * ```
 *
 * 【點吃不到光照】`PointsMaterial` 是 basic 的。開局後光照固定，所以亮度
 * 由 `POINT_LIGHT` 烘進逐株的顏色 —— 見那個常數。
 */
function createPointMaterial(): PointsMaterial {
  const m = new PointsMaterial({ vertexColors: true, sizeAttenuation: true, size: 1 })
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aSize;\n' + shader.vertexShader
      .replace('gl_PointSize = size;', 'gl_PointSize = aSize * projectionMatrix[1][1] * size;')
      // 往下看亮一點（`POINT_TOPDOWN_GAIN`）：俯角由鏡頭到這一點的方向算
      .replace('#include <color_vertex>', `#include <color_vertex>
{
  vec3 toCam = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
  vColor.rgb *= 1.0 + ${(POINT_TOPDOWN_GAIN - 1).toFixed(3)} * smoothstep(0.0, ${POINT_TOPDOWN_RAMP.toFixed(3)}, toCam.y);
}`)
  }
  // 【換了著色器就要換 key】three 用它決定程式能不能重用
  m.customProgramCacheKey = () => 'flora-point'
  return m
}

/**
 * 點池的亮度補償。**逐通道乘在樹冠色上。**
 *
 * 【為什麼要有它】點走 `PointsMaterial`，吃不到場上那三盞燈；而它取代的
 * 中級樹冠走 `MeshStandardMaterial`，是被照亮的。不補的話過 3 km 門檻時
 * 整片林相會暗一階。
 *
 * 【值是量出來的】`flora-card.e2e.ts` 在 `POINT_NEAR` 兩側各量一次平均 RGB
 * （2,500 m 的中級樹冠對 3,600 m 的點），要求亮度差在 8% 以內。實測 −2.5%。
 *
 * 【小於 1 是對的】輸出是 sRGB 編碼的，而樹冠色本身就是那個亮度 —— 補的是
 * 「標準材質在這組燈下比純色暗一點」那一段，不是「把暗的補亮」。
 *
 * 【烘一次成立是因為開局後光照固定】燈的定義在 `render/lighting.ts`，量測
 * 用的 fixture 與正式場景共用同一份 —— 各配一組的話係數會是錯的。
 */
export const POINT_LIGHT = new Color(0.36, 0.36, 0.36)

/**
 * 往下看時點要再亮多少：平視乘 1，sin(俯角) 到 `POINT_TOPDOWN_RAMP` 之間平滑升到
 * 這個數，再往下都是它。
 *
 * 【為什麼要跟著角度】`POINT_LIGHT` 是平視校的（樹冠多半露側面、偏暗）；往下看露出
 * 被太陽照亮的樹冠頂，同一片林子亮得多，而點是平的色塊，哪個角度看都一樣。實測
 * 1.5 km 與 3 km 高度看 3.5～5.5 km 的林子（sin 俯角 0.26～0.65），點都要乘約 1.45
 * 才與樹冠、遠處的烘圖接得上；不跟著角度的話，那一圈比兩側暗一截
 */
export const POINT_TOPDOWN_GAIN = 1.45
/** 俯角的正弦到這裡就用滿 `POINT_TOPDOWN_GAIN`（約 11.5°） */
export const POINT_TOPDOWN_RAMP = 0.2

/**
 * 這一株該進哪一個池。`null` = 這一級不畫它。
 *
 * 【樹種不隨級數變】兩級各有自己的闊葉與針葉。把兩種樹在遠級併成同一個
 * 池的話，針葉樹過門檻時形狀與顏色一起換 —— 看起來像那棵樹換了種。
 */
export function poolOf(kind: number, lod: number, bushNear: boolean): PoolName | null {
  if (lod >= 3) return null
  switch (kind) {
    case FloraKind.BroadTree:
      return lod === 0 ? 'broadNear' : lod === 1 ? 'broadMid' : 'broadPoint'
    case FloraKind.ConeTree:
      return lod === 0 ? 'coneNear' : lod === 1 ? 'coneMid' : 'conePoint'
    case FloraKind.Bush:
      return bushNear ? 'bushNear' : 'bushPoint'
    case FloraKind.House:
      return 'house'
    case FloraKind.Barn:
      return 'barn'
    case FloraKind.SlateHouse:
      return 'houseSlate'
    case FloraKind.TarBarn:
      return 'barnTar'
    default:
      return 'church'
  }
}

/**
 * 逐圖覆寫的參數。**兩張圖不會同時存在，所以各給各的最省。**
 *
 * 不傳就是農地那一組 —— 農地每一格都有東西，推遠與加大都很貴。
 */
export interface VegetationOptions {
  /** 覆寫池的容量。群島傳 `ISLAND_CAPACITY`；掃描與變異驗證傳哨兵值 */
  capacity?: Partial<Record<PoolName, number>>
  /** 單格的上限，株 —— 見 `MAX_PER_TILE` */
  maxPerTile?: number
  /** 植被畫到多遠，m —— 見 `FLORA_RADIUS` */
  radius?: number
  /** 快取幾格。不傳就由 `radius` 算 */
  tileCache?: number
  /** 每幀最多生幾格 —— 見 `TILES_PER_FRAME` */
  tilesPerFrame?: number
  /** 重建一幀最多走過幾筆 —— 見 `REBUILD_BUDGET`。測試傳小值讓分幀看得見 */
  rebuildBudget?: number
  /** 樹冠色的季節。省略 = 夏季。每一份植被自己建幾何與池，兩個季節互不污染 */
  season?: Season
}

/**
 * 實例池的一段：一顆 `InstancedMesh`，實例矩陣與顏色是指向池緩衝某個位移的
 * interleaved 屬性。
 *
 * 【每條屬性兩個物件，只改沒在 VAO 裡的那一個】three 的 VAO 快取（以幾何與程式為鍵）
 * 用屬性**物件的身分**決定要不要重設指標 —— 只改 `offset` 不換物件，畫出來的是舊
 * 位移。而快取裡記的是**上一次真的畫的時候**綁的那一個，所以 `onBeforeRender` 記下它，
 * `aimRun` 只改另一個再換上去。隱藏期間改來改去也不會碰到快取裡那一個。
 */
interface MeshRun {
  mesh: InstancedMesh
  mat: [InterleavedBufferAttribute, InterleavedBufferAttribute]
  col: [InterleavedBufferAttribute, InterleavedBufferAttribute]
  /** 上一次真的畫出去時掛著的那兩個 */
  drawnMat: InterleavedBufferAttribute | null
  drawnCol: InterleavedBufferAttribute | null
}

function createMeshRun(
  geometry: BufferGeometry, material: MeshStandardMaterial,
  mat: InstancedInterleavedBuffer, col: InstancedInterleavedBuffer,
): MeshRun {
  // 【容量給 1】建構子配的那條矩陣立刻被換掉；實例數由 `count` 決定，不受它限制
  const mesh = new InstancedMesh(geometry, material, 1)
  const run: MeshRun = {
    mesh,
    mat: [new InterleavedBufferAttribute(mat, 16, 0), new InterleavedBufferAttribute(mat, 16, 0)],
    col: [new InterleavedBufferAttribute(col, 3, 0), new InterleavedBufferAttribute(col, 3, 0)],
    drawnMat: null,
    drawnCol: null,
  }
  // 【型別】three 的宣告只收 InstancedBufferAttribute；算繪那一側兩種都認
  mesh.instanceMatrix = run.mat[0] as unknown as InstancedBufferAttribute
  mesh.instanceColor = run.col[0] as unknown as InstancedBufferAttribute
  mesh.count = 0
  mesh.frustumCulled = false
  // 【包圍球先給】three 排序時會替沒有球的 InstancedMesh 自己算，而它讀矩陣不看位移 ——
  // 算出來的是別段的實例
  mesh.boundingSphere = new Sphere(new Vector3(), Infinity)
  mesh.onBeforeRender = () => {
    run.drawnMat = mesh.instanceMatrix as unknown as InterleavedBufferAttribute
    run.drawnCol = mesh.instanceColor as unknown as InterleavedBufferAttribute
  }
  return run
}

/** 讓這一段從池緩衝的第 `start` 筆開始畫。已經指在那裡就不動 —— 見 `MeshRun` */
function aimRun(
  run: MeshRun, mat: InstancedInterleavedBuffer, col: InstancedInterleavedBuffer, start: number,
): void {
  const m = run.mesh.instanceMatrix as unknown as InterleavedBufferAttribute
  if (m.data !== mat || m.offset !== start * 16) {
    const pick = run.mat[0] === run.drawnMat ? run.mat[1] : run.mat[0]
    pick.data = mat
    pick.offset = start * 16
    run.mesh.instanceMatrix = pick as unknown as InstancedBufferAttribute
  }
  const c = run.mesh.instanceColor as unknown as InterleavedBufferAttribute
  if (c.data !== col || c.offset !== start * 3) {
    const pick = run.col[0] === run.drawnCol ? run.col[1] : run.col[0]
    pick.data = col
    pick.offset = start * 3
    run.mesh.instanceColor = pick as unknown as InstancedBufferAttribute
  }
}

export function createVegetation(
  sources: readonly FloraSource[],
  heightAt: (x: number, z: number) => number,
  opts: VegetationOptions = {},
): Vegetation {
  const cap: Record<PoolName, number> = { ...CAPACITY, ...opts.capacity }
  const maxPerTile = opts.maxPerTile ?? MAX_PER_TILE
  const radius = opts.radius ?? FLORA_RADIUS
  /**
   * 【快取要比圈大】移動時新舊圈會暫時重疊。圈內格數是
   * `π r² / TILE_SIZE²`，多留一成六 —— 6 km 是 1,815 對 2,106。
   */
  const tileCache = opts.tileCache ?? Math.ceil(
    ((Math.PI * radius * radius) / (TILE_SIZE * TILE_SIZE)) * 1.16,
  )
  const tilesPerFrame = opts.tilesPerFrame ?? TILES_PER_FRAME
  const rebuildBudget = opts.rebuildBudget ?? REBUILD_BUDGET
  const season = opts.season ?? 'summer'
  const geometries = createFloraGeometries(season)
  const material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9,
  })
  const pointMaterial = createPointMaterial()
  const group = new Group()
  /**
   * 十一個池。**遠處那三個是 `Points`，其餘八個是 `InstancedMesh`。**
   * 寫入路徑因此要分岔 —— 見 `rebuild`。
   *
   * 池物件本身是第 0 段；第 1 段以後掛在它底下（`object.children` 因此仍是一池一個）。
   */
  const pools: Record<PoolName, InstancedMesh | Points> =
    {} as Record<PoolName, InstancedMesh | Points>
  /** 點池的三條屬性，各兩份輪流換。索引順序：位置、顏色、大小 */
  const altPt: Partial<Record<PoolName, BufferAttribute[][]>> = {}
  /** 點池的樹冠色 × `POINT_LIGHT`，開場算一次 */
  const pointBase: Partial<Record<PoolName, Color>> = {}
  /**
   * 每個池兩份實例緩衝，重建時輪流換。**這是 1% low 的關鍵。**
   *
   * 【為什麼】對**正在被 GPU 讀的**那條緩衝呼叫 `bufferSubData` 時，驅動
   * 只能等 GPU 讀完或整條重配 —— 實測那一下是 190 ms。輪流換之後寫的永遠
   * 是上一幀沒在畫的那一份，寫完才掛上去。
   *
   * 【代價是記憶體加倍】兩份加起來 7.6 MB。全部開場配掉。
   *
   * 【interleaved 是為了逐段畫】WebGL2 沒有「從第 N 個實例開始畫」，所以每一段
   * 用一個 `offset` 指到段起點的 `InterleavedBufferAttribute`，全部指向同一條緩衝 ——
   * 上傳仍然是一池一條、一次。
   */
  const altMat: Record<PoolName, InstancedInterleavedBuffer[]> =
    {} as Record<PoolName, InstancedInterleavedBuffer[]>
  const altCol: Record<PoolName, InstancedInterleavedBuffer[]> =
    {} as Record<PoolName, InstancedInterleavedBuffer[]>
  const side: Record<PoolName, number> = {} as Record<PoolName, number>
  /** 實例池的每一段。`[0]` 是池物件本身 */
  const meshRuns: Partial<Record<PoolName, MeshRun[]>> = {}
  /** 點池的每一段。`[0]` 是池物件本身；各段的幾何共用同一批屬性 */
  const pointRuns: Partial<Record<PoolName, Points[]>> = {}
  for (const name of POOL_NAMES) {
    if (IS_POINT[name]) {
      const n = cap[name]
      const mk = (): BufferAttribute[] => {
        const a = [
          new BufferAttribute(new Float32Array(n * 3), 3),
          new BufferAttribute(new Float32Array(n * 3), 3),
          new BufferAttribute(new Float32Array(n), 1),
        ]
        for (const at of a) at.setUsage(DynamicDrawUsage)
        return a
      }
      const two = [mk(), mk()]
      altPt[name] = two
      side[name] = 0
      const runs: Points[] = []
      for (let r = 0; r < RUN_CAP; r++) {
        const geo = new BufferGeometry()
        geo.setAttribute('position', two[0]![0]!)
        geo.setAttribute('color', two[0]![1]!)
        geo.setAttribute('aSize', two[0]![2]!)
        geo.setDrawRange(0, 0)
        // 【包圍球自己給無限大】內容每次重建都換，three 算出來的球會過期；
        // 而 three 的剔除本來就關掉了 —— 見檔頭
        geo.boundingSphere = new Sphere(new Vector3(), Infinity)
        const pts = new Points(geo, pointMaterial)
        pts.frustumCulled = false
        if (r > 0) {
          pts.visible = false
          runs[0]!.add(pts)
        }
        runs.push(pts)
      }
      pointRuns[name] = runs
      pools[name] = runs[0]!
      group.add(runs[0]!)
      pointBase[name] = new Color(pointColorOf(name as PointPool, season)).multiply(POINT_LIGHT)
      continue
    }
    const mats = [0, 1].map(() => new InstancedInterleavedBuffer(
      new Float32Array(cap[name] * 16), 16, 1).setUsage(DynamicDrawUsage))
    const cols = [0, 1].map(() => new InstancedInterleavedBuffer(
      new Float32Array(cap[name] * 3), 3, 1).setUsage(DynamicDrawUsage))
    altMat[name] = mats
    altCol[name] = cols
    side[name] = 0
    // 【型別】上面那個 `continue` 已經把點池濾掉了，但 TS 收窄不到
    const base = geometries[name as MeshPool]
    const runs: MeshRun[] = []
    for (let r = 0; r < RUN_CAP; r++) {
      runs.push(createMeshRun(r === 0 ? base : shareGeometry(base), material, mats[0]!, cols[0]!))
      if (r > 0) {
        runs[r]!.mesh.visible = false
        runs[0]!.mesh.add(runs[r]!.mesh)
      }
    }
    meshRuns[name] = runs
    pools[name] = runs[0]!.mesh
    group.add(runs[0]!.mesh)
  }

  // ── 剔除用的區段表 ────────────────────────────────────
  /**
   * 每一池、每一份緩衝一張表：第 e 筆是「某一格在這一池的實例 `[start, end)`」與那些
   * 實例的包圍盒（minX, minY, minZ, maxX, maxY, maxZ）。
   *
   * 【盒子由實例本身算，不讀即時的槽位】槽位會被放掉、給新的格重用，而舊的那一份
   * 緩衝在下一次重建之前仍然掛著、仍然要剔。表跟著它的緩衝一起寫、一起換上去。
   *
   * 筆數不超過「有這一池實例的格數」，所以取快取格數與容量的較小者。以池在
   * `POOL_NAMES` 的索引存取。
   */
  const poolCount = POOL_NAMES.length
  const entStart: Int32Array[][] = []
  const entEnd: Int32Array[][] = []
  const entBox: Float32Array[][] = []
  /** 各池各份的筆數 */
  const entN: Int32Array[] = []
  for (let p = 0; p < poolCount; p++) {
    const m = Math.min(tileCache, cap[POOL_NAMES[p]!])
    entStart.push([new Int32Array(m), new Int32Array(m)])
    entEnd.push([new Int32Array(m), new Int32Array(m)])
    entBox.push([new Float32Array(m * 6), new Float32Array(m * 6)])
    entN.push(new Int32Array(2))
  }
  /**
   * 實例幾何的範圍，盒子由它推：水平半徑兩軸各一（實例繞 Y 轉，x 吃面寬倍率、
   * z 吃縮放）、垂直的上下緣（吃樓高倍率）。點池不用，點的範圍是邊長
   */
  const geoRx = new Float64Array(poolCount)
  const geoRz = new Float64Array(poolCount)
  const geoLo = new Float64Array(poolCount)
  const geoHi = new Float64Array(poolCount)
  for (let p = 0; p < poolCount; p++) {
    const name = POOL_NAMES[p]!
    if (IS_POINT[name]) continue
    const g = geometries[name as MeshPool]
    if (g.boundingBox === null) g.computeBoundingBox()
    const b = g.boundingBox!
    geoRx[p] = Math.max(Math.abs(b.min.x), Math.abs(b.max.x))
    geoRz[p] = Math.max(Math.abs(b.min.z), Math.abs(b.max.z))
    geoLo[p] = b.min.y
    geoHi[p] = b.max.y
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
  const slotBuf: (FloraBuffer | null)[] = new Array<FloraBuffer | null>(tileCache).fill(null)
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

  const slotI = new Int32Array(tileCache)
  const slotJ = new Int32Array(tileCache)
  const slotUsed = new Uint8Array(tileCache)
  const slotLod = new Int8Array(tileCache)
  const slotBush = new Uint8Array(tileCache)
  /**
   * 逐格的外圈半徑，m。**建格時算一次。**
   *
   * 【為什麼不每幀算】`relevel` 每幀走過每一個活槽，而 `outerFor` 要做一次
   * 雜湊 —— 12 km 是每幀七千次。它只跟格的索引有關，不會變。
   */
  const slotOuter = new Float32Array(tileCache)
  /** 逐格在希爾伯特曲線上的位置。**建格時算一次**，重建依它排打包順序 */
  const slotKey = new Float64Array(tileCache)
  if (tileCache > SLOT_SPAN) throw new Error(`植被：快取 ${tileCache} 格超過排序鍵的上限 ${SLOT_SPAN}`)
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
    else if (lod === 2) { poolDirty.broadPoint = true; poolDirty.conePoint = true }
  }
  /**
   * 建築的池（`BUILDING_POOLS`）。**每一格都可能有建築**，所以加減格一定要標它們。
   *
   * 【一定要全部標】漏掉一個的話那一種建築開場畫過一次之後就再也不更新 ——
   * 鏡頭一動，那些房子留在原地或整批消失，而且不報錯。
   */
  function markBuildings(): void {
    for (const name of BUILDING_POOLS) poolDirty[name] = true
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
    poolDirty.bushPoint = true
    markBuildings()
  }

  /**
   * 空著的槽位。**堆疊，不是線性掃描。**
   *
   * 【為什麼】12 km 的圈要 7,600 槽，而每幀補 61 格 —— 線性掃描是每幀
   * 四十六萬次迴圈。
   */
  const freeSlots: number[] = []
  for (let s = tileCache - 1; s >= 0; s--) freeSlots.push(s)

  function takeSlot(): number {
    const s = freeSlots.pop()
    if (s !== undefined) return s
    // 【滿了就丟最舊的】圈內的格數恆小於快取，正常不會走到這裡。丟掉的可能是
    // 內圈的格，`fill` 的內圈捷徑因此要作廢
    fillDone = false
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
    slotOuter[slot] = outerFor(i, j, radius)
    slotKey[slot] = hilbertKey(i, j)
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
   * 【界線就是 `radius`，不多放】LOD 是**按格心**決定的，所以格心在
   * 2 km 之外的那一格整格是第 3 級 —— 生了也不畫。多放一圈等於白生。
   * 這樣一來「活著的格數」與「建築的實例數」是同一個數字。
   */
  const radius2 = radius * radius

  function inRange(i: number, j: number): boolean {
    const cx = i * TILE_SIZE + TILE_SIZE / 2 - centerX
    const cz = j * TILE_SIZE + TILE_SIZE / 2 - centerZ
    // 【比平方，不開根號】`evict` 與 `fill` 每幀各走一次全部的格
    return cx * cx + cz * cz <= radius2
  }

  /** 放掉圈外的格 */
  function evict(): void {
    for (let s = 0; s < tileCache; s++) {
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
   * 【為什麼要有它】`fill` 每生一格就重掃整個包圍方陣挑最近的空格的話 ——
   * 6 km、每幀 16 格是 38,416 次；12 km、每幀 61 格會變成 57 萬次。照這
   * 張表由近往外走，每幀只掃一趟。
   *
   * 【半徑多留一格】表只決定順序，真正的圈仍然由 `inRange` 決定。多留一格
   * 讓鏡頭落在格內任何位置時都不會漏掉邊緣那一環。
   *
   * 【順序差半格沒關係】表是相對於格中心排的，而鏡頭可以落在格內任何位置。
   * 那只影響「先生哪一格」，不影響最後生了哪些格。
   */
  const ring = ((): { di: Int16Array, dj: Int16Array } => {
    const reach = Math.ceil(radius / TILE_SIZE) + 1
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

  /**
   * 內圈的終點：`ring` 裡由這個索引起，格才可能落在圈外。
   *
   * 鏡頭在中心格內任何位置時，偏移 `r` 格的那一格格心離鏡頭至多
   * `r × TILE_SIZE + TILE_SIZE × √½`。這個值不超過半徑的格恆在圈內 ——
   * 中心格沒換的期間 `evict` 不會放掉它，補齊過一次之後就不必再看。
   */
  const innerEnd = ((): number => {
    let k = 0
    while (k < ring.di.length) {
      const r = Math.sqrt(ring.di[k]! * ring.di[k]! + ring.dj[k]! * ring.dj[k]!)
      if (r * TILE_SIZE + TILE_SIZE * Math.SQRT1_2 > radius) break
      k++
    }
    return k
  })()
  /** 上一趟 `fill` 在這個中心格上已經補齊了 —— 內圈可以跳過 */
  let fillDone = false
  let fillDoneI = 0
  let fillDoneJ = 0

  /**
   * 【中心格沒換而且補齊過就從內圈邊界開始掃】6 km 圈的格環有兩千項，選單
   * 在 120 fps 下每幀整條掃一次是實測 CPU 的 6%。
   */
  function fill(budget: number): number {
    const ci = Math.floor(centerX / TILE_SIZE)
    const cj = Math.floor(centerZ / TILE_SIZE)
    let made = 0
    const start = fillDone && ci === fillDoneI && cj === fillDoneJ ? innerEnd : 0
    for (let k = start; k < ring.di.length && made < budget; k++) {
      stats.scanned++
      const i = ci + ring.di[k]!
      const j = cj + ring.dj[k]!
      if (!inRange(i, j)) continue
      if (bySlot.has(keyOf(i, j))) continue
      makeTile(i, j)
      made++
    }
    // 【沒用完預算就是補齊了】圈內每一個候選都已經在快取裡
    fillDone = made < budget
    fillDoneI = ci
    fillDoneJ = cj
    return made
  }

  /** 重新決定每一格的級數。有任何一格改變就標髒 */
  function relevel(): void {
    let live = 0
    for (let s = 0; s < tileCache; s++) {
      if (slotUsed[s] === 0) continue
      live++
      const cx = slotI[s]! * TILE_SIZE + TILE_SIZE / 2
      const cz = slotJ[s]! * TILE_SIZE + TILE_SIZE / 2
      // 【手寫開根號，不用 Math.hypot】V8 的 hypot 每次呼叫都會配置，而這裡
      // 每幀每格一次
      const dx = cx - centerX
      const dz = cz - centerZ
      const d = Math.sqrt(dx * dx + dz * dz)
      const lod = lodFor(d, slotLod[s]!, slotOuter[s]!)
      const bush = d <= BUSH_RANGE + (slotBush[s] === 1 ? LOD_HYSTERESIS : 0) ? 1 : 0
      if (lod !== slotLod[s]) {
        dirty = true
        markLevel(slotLod[s]!)
        markLevel(lod)
      }
      if (bush !== slotBush[s]) {
        dirty = true
        poolDirty.bushNear = true
        poolDirty.bushPoint = true
      }
      slotLod[s] = lod
      slotBush[s] = bush
    }
    stats.tiles = live
  }

  /**
   * 進行中的重建。**寫的是沒掛上的那一份，全部寫完才一起換上去。**
   *
   * 【進行中不補格、不放格、不換級】放掉的 tile 緩衝會被新的格借走，寫到
   * 一半的重建就會讀到另一格的資料；級數中途變了則前後半段用的是兩套級數。
   * 暫停到完成為止，寫出來的就等於「開始那一幀一次寫完」的內容。
   *
   * 狀態全部開場配好，重建不配置。
   */
  let job = false
  /**
   * 這一次的打包順序：有東西的槽位依希爾伯特位置排好（見 `hilbertKey`）。
   * 排序鍵是「位置 × `SLOT_SPAN` + 槽位」，沒用到的格填無限大、排到最後 ——
   * 整條排序，不切子陣列
   */
  const orderKey = new Float64Array(tileCache)
  const order = new Int32Array(tileCache)
  let orderLen = 0
  /** 下一個要寫的是 `order` 的第幾格 */
  let jobPos = 0
  let jobOverflow = 0
  // 【以下都以池在 `POOL_NAMES` 的索引存取】重建的迴圈每筆都要讀，不經過池名
  /** 這一格開始時各池寫到第幾筆 —— 一格寫完，多出來的那一段就是區段表的一筆 */
  const tileFrom = new Int32Array(poolCount)
  /** 這一格在各池的實例包圍盒（minX, minY, minZ, maxX, maxY, maxZ） */
  const acc = new Float64Array(poolCount * 6)
  /** 這一次寫的是哪一份（沒掛上的那一側）；區段表寫進同一側 */
  const jobSide = new Uint8Array(poolCount)
  /** 這一次要寫的池（1 = 要寫）—— 開始時由 `poolDirty` 搬過來 */
  const jobDirty = new Uint8Array(poolCount)
  /** 各池已經寫了幾筆。完成時才發布到 `counts` */
  const jobCounts = new Int32Array(poolCount)
  const capOf = new Int32Array(poolCount)
  const isPointOf = new Uint8Array(poolCount)
  /** 逐實例明度抖動的下限與範圍，見 `TINT_RANGE` */
  const tintBaseOf = new Float64Array(poolCount)
  const tintSpanOf = new Float64Array(poolCount)
  for (let p = 0; p < poolCount; p++) {
    const r = TINT_RANGE[BUILDING_POOLS.includes(POOL_NAMES[p]!) ? 'building' : 'plant']
    tintBaseOf[p] = r[0]
    tintSpanOf[p] = r[1] - r[0]
  }
  /** 點池：樹冠垂直中心、點的邊長、`pointBase` 的三個分量，都是逐株乘上縮放前的常數 */
  const pointYOf = new Float64Array(poolCount)
  const pointSizeOf = new Float64Array(poolCount)
  const pointR = new Float64Array(poolCount)
  const pointG = new Float64Array(poolCount)
  const pointB = new Float64Array(poolCount)
  for (let p = 0; p < poolCount; p++) {
    const name = POOL_NAMES[p]!
    capOf[p] = cap[name]
    if (!IS_POINT[name]) continue
    isPointOf[p] = 1
    pointYOf[p] = POINT_Y[name as PointPool]
    pointSizeOf[p] = POINT_SIZE[name as PointPool]
    pointR[p] = pointBase[name]!.r
    pointG[p] = pointBase[name]!.g
    pointB[p] = pointBase[name]!.b
  }
  /** 這一次寫進去的那一份（沒掛上的那一側）的陣列。開始時解析好 */
  const jobMatrix: (Float32Array | null)[] = new Array<Float32Array | null>(poolCount).fill(null)
  const jobTint: (Float32Array | null)[] = new Array<Float32Array | null>(poolCount).fill(null)
  const jobPosition: (Float32Array | null)[] = new Array<Float32Array | null>(poolCount).fill(null)
  const jobColor: (Float32Array | null)[] = new Array<Float32Array | null>(poolCount).fill(null)
  const jobSize: (Float32Array | null)[] = new Array<Float32Array | null>(poolCount).fill(null)

  /**
   * 開始一次重建。
   *
   * 【只碰髒的池】沒變的池連寫都不寫 —— 它掛著的那份屬性已經是對的，而
   * 重寫一遍再上傳只是把 GPU 逼去等。
   */
  function startRebuild(): void {
    for (let p = 0; p < poolCount; p++) {
      const name = POOL_NAMES[p]!
      jobDirty[p] = poolDirty[name] ? 1 : 0
      poolDirty[name] = false
      jobCounts[p] = 0
      // 【寫另一份】掛著的那一份在完成前都還在畫
      const next = side[name]! ^ 1
      jobSide[p] = next
      entN[p]![next] = 0
      if (isPointOf[p] === 1) {
        const a = altPt[name]![next]!
        jobPosition[p] = a[0]!.array as Float32Array
        jobColor[p] = a[1]!.array as Float32Array
        jobSize[p] = a[2]!.array as Float32Array
      } else {
        jobMatrix[p] = altMat[name]![next]!.array as Float32Array
        jobTint[p] = altCol[name]![next]!.array as Float32Array
      }
    }
    // 【打包順序與重建中心無關】同一格在每一池、每一次重建都排在同一個位置 ——
    // 沒重建的池與剛重建的池是同一套順序
    orderKey.fill(Infinity)
    orderLen = 0
    for (let s = 0; s < tileCache; s++) {
      if (slotUsed[s] === 0 || slotBuf[s] === null) continue
      orderKey[orderLen++] = slotKey[s]! * SLOT_SPAN + s
    }
    orderKey.sort()
    for (let k = 0; k < orderLen; k++) order[k] = orderKey[k]! % SLOT_SPAN
    jobPos = 0
    jobOverflow = 0
    job = true
    dirty = false
    lastBuildX = centerX
    lastBuildZ = centerZ
  }

  /** 往下寫，走過至少 `budget` 筆就停；寫完最後一格就換上去 */
  function stepRebuild(budget: number): void {
    let work = 0
    while (jobPos < orderLen && work < budget) {
      const s = order[jobPos++]!
      if (slotUsed[s] === 0) continue
      const buf = slotBuf[s] ?? null
      if (buf === null) continue
      const n = buf.count
      work += n
      const data = buf.data
      const kinds = buf.kind
      const shapes = buf.shape
      const row = (slotLod[s]! + 1) * 2 + slotBush[s]!
      for (let p = 0; p < poolCount; p++) {
        tileFrom[p] = jobCounts[p]!
        const b = p * 6
        acc[b] = Infinity; acc[b + 1] = Infinity; acc[b + 2] = Infinity
        acc[b + 3] = -Infinity; acc[b + 4] = -Infinity; acc[b + 5] = -Infinity
      }
      for (let k = 0; k < n; k++) {
        const p = POOL_LUT[kinds[k]! * 10 + row]!
        if (p < 0 || jobDirty[p] === 0) continue
        const at = jobCounts[p]!
        if (at >= capOf[p]!) {
          jobOverflow++
          continue
        }
        const o = k * FLORA_STRIDE
        const scale = data[o + 4]!
        // 【逐實例的明度抖動】同一種樹因此不會像複製貼上
        const t = tintBaseOf[p]! + data[o + 5]! * tintSpanOf[p]!
        const x = data[o]!
        const y = data[o + 1]!
        const z = data[o + 2]!
        const b = p * 6
        if (isPointOf[p] === 1) {
          const pos = jobPosition[p]!
          const col = jobColor[p]!
          const a3 = at * 3
          // 【點的中心放樹冠的垂直中心】見 `POINT_Y`
          const cy = y + pointYOf[p]! * scale
          pos[a3] = x
          pos[a3 + 1] = cy
          pos[a3 + 2] = z
          col[a3] = pointR[p]! * t
          col[a3 + 1] = pointG[p]! * t
          col[a3 + 2] = pointB[p]! * t
          const size = pointSizeOf[p]! * scale
          jobSize[p]![at] = size
          jobCounts[p] = at + 1
          // 【盒子取邊長】點是螢幕對齊的方塊，世界邊長 `size`，一個邊長的半徑綽綽有餘
          if (x - size < acc[b]!) acc[b] = x - size
          if (cy - size < acc[b + 1]!) acc[b + 1] = cy - size
          if (z - size < acc[b + 2]!) acc[b + 2] = z - size
          if (x + size > acc[b + 3]!) acc[b + 3] = x + size
          if (cy + size > acc[b + 4]!) acc[b + 4] = cy + size
          if (z + size > acc[b + 5]!) acc[b + 5] = z + size
          continue
        }
        const rot = data[o + 3]!
        // 【就地寫矩陣】繞 Y 的旋轉，x（面寬）、y（樓高）、z（進深）各自縮放。
        // 欄主序：第 0 欄是 x 軸轉到 (cos, 0, −sin)、第 2 欄是 z 軸轉到 (sin, 0, cos)
        // —— 樹的面寬、樓高倍率都是 1，寫出來與等比縮放逐一相同
        const sx = scale * (shapes[k * 2]! / SHAPE_ONE)
        const sy = scale * (shapes[k * 2 + 1]! / SHAPE_ONE)
        const cs = Math.cos(rot)
        const sn = Math.sin(rot)
        const m = jobMatrix[p]!
        const a16 = at * 16
        m[a16] = cs * sx; m[a16 + 1] = 0; m[a16 + 2] = -sn * sx; m[a16 + 3] = 0
        m[a16 + 4] = 0; m[a16 + 5] = sy; m[a16 + 6] = 0; m[a16 + 7] = 0
        m[a16 + 8] = sn * scale; m[a16 + 9] = 0; m[a16 + 10] = cs * scale; m[a16 + 11] = 0
        m[a16 + 12] = x; m[a16 + 13] = y; m[a16 + 14] = z; m[a16 + 15] = 1
        // 【明度三通道相同】與 `Color.setRGB(t, t, t)` 在工作色彩空間下寫出的值相同
        const tint = jobTint[p]!
        const a3 = at * 3
        tint[a3] = t; tint[a3 + 1] = t; tint[a3 + 2] = t
        jobCounts[p] = at + 1
        // 【盒子】繞 Y 轉，所以水平取兩軸半徑的和（不開根號、只會偏大）；垂直吃樓高倍率
        const h = geoRx[p]! * sx + geoRz[p]! * scale
        const lo = y + geoLo[p]! * sy
        const hi = y + geoHi[p]! * sy
        if (x - h < acc[b]!) acc[b] = x - h
        if (lo < acc[b + 1]!) acc[b + 1] = lo
        if (z - h < acc[b + 2]!) acc[b + 2] = z - h
        if (x + h > acc[b + 3]!) acc[b + 3] = x + h
        if (hi > acc[b + 4]!) acc[b + 4] = hi
        if (z + h > acc[b + 5]!) acc[b + 5] = z + h
      }
      // 【一格寫完：多出來的那一段記成區段表的一筆】
      for (let p = 0; p < poolCount; p++) {
        if (jobDirty[p] === 0 || jobCounts[p]! === tileFrom[p]!) continue
        const sd = jobSide[p]!
        const e = entN[p]![sd]!
        entN[p]![sd] = e + 1
        entStart[p]![sd]![e] = tileFrom[p]!
        entEnd[p]![sd]![e] = jobCounts[p]!
        const box = entBox[p]![sd]!
        for (let c = 0; c < 6; c++) box[e * 6 + c] = acc[p * 6 + c]!
      }
    }
    if (jobPos >= orderLen) finishRebuild()
  }

  /** 換上寫好的那一份、發布實例數、標上傳 */
  function finishRebuild(): void {
    for (let p = 0; p < poolCount; p++) {
      if (jobDirty[p] === 0) continue
      const name = POOL_NAMES[p]!
      side[name] ^= 1
      const used = jobCounts[p]!
      counts[name] = used
      if (IS_POINT[name]) {
        // 【三條要一起換到同一側】換一半的話位置與顏色會對不上株
        const a = altPt[name]![side[name]!]!
        for (const pts of pointRuns[name]!) {
          const geo = pts.geometry
          geo.setAttribute('position', a[0]!)
          geo.setAttribute('color', a[1]!)
          geo.setAttribute('aSize', a[2]!)
        }
        // 【逐條寫，不走 `[[attr, size], …]` 的迴圈】那種寫法每次重建都配一組臨時陣列
        a[0]!.addUpdateRange(0, used * 3)
        a[0]!.needsUpdate = true
        a[1]!.addUpdateRange(0, used * 3)
        a[1]!.needsUpdate = true
        a[2]!.addUpdateRange(0, used)
        a[2]!.needsUpdate = true
      } else {
        // 【只上傳用到的那一段】容量是實測最大值的兩倍，整條傳等於白傳一倍
        const mat = altMat[name]![side[name]!]!
        const col = altCol[name]![side[name]!]!
        mat.addUpdateRange(0, used * 16)
        mat.needsUpdate = true
        col.addUpdateRange(0, used * 3)
        col.needsUpdate = true
      }
      // 【換上時整條畫】下一次 `cull` 才分段；沒有人呼叫 `cull` 的話就一直是整條
      showAll(p)
    }
    stats.overflow = jobOverflow
    job = false
    sinceRebuild = 0
    stats.rebuilds++
  }

  // ── 逐段畫 ──────────────────────────────────────────
  /** `visibleRuns` 的輸出。一池一池輪流用，長度取區段表最長的那一張 */
  let maxEnt = 1
  for (let p = 0; p < poolCount; p++) maxEnt = Math.max(maxEnt, entStart[p]![0]!.length)
  const runStart = new Int32Array(maxEnt)
  const runEnd = new Int32Array(maxEnt)
  const planes = new Float64Array(24)

  /** 第 p 池畫 `runStart/runEnd` 的前 `n` 段；其餘的段藏起來 */
  function setRuns(p: number, n: number): void {
    const name = POOL_NAMES[p]!
    const sd = side[name]!
    if (IS_POINT[name]) {
      const runs = pointRuns[name]!
      for (let r = 0; r < RUN_CAP; r++) {
        const pts = runs[r]!
        if (r < n) {
          pts.visible = true
          pts.geometry.setDrawRange(runStart[r]!, runEnd[r]! - runStart[r]!)
        } else {
          // 【第 0 段只清空不藏】它是其餘段的父物件，藏了連孩子一起不畫
          if (r > 0) pts.visible = false
          pts.geometry.setDrawRange(0, 0)
        }
      }
      return
    }
    const runs = meshRuns[name]!
    const mat = altMat[name]![sd]!
    const col = altCol[name]![sd]!
    for (let r = 0; r < RUN_CAP; r++) {
      const run = runs[r]!
      if (r < n) {
        run.mesh.visible = true
        aimRun(run, mat, col, runStart[r]!)
        run.mesh.count = runEnd[r]! - runStart[r]!
      } else {
        if (r > 0) run.mesh.visible = false
        run.mesh.count = 0
      }
    }
  }

  /** 整條畫成一段 —— 剛換上、`CULL` 關掉、沒有相機時 */
  function showAll(p: number): void {
    const used = counts[POOL_NAMES[p]!]
    runStart[0] = 0
    runEnd[0] = used
    setRuns(p, used > 0 ? 1 : 0)
  }

  function cull(camera: Camera): void {
    if (!CULL.enabled) {
      for (let p = 0; p < poolCount; p++) showAll(p)
      return
    }
    frustumPlanesOf(camera, planes)
    for (let p = 0; p < poolCount; p++) {
      const used = counts[POOL_NAMES[p]!]
      const sd = side[POOL_NAMES[p]!]!
      const limit = used >= RUN_SPLIT_MIN ? RUN_CAP : 1
      const n = used === 0 ? 0 : visibleRuns(
        entN[p]![sd]!, entStart[p]![sd]!, entEnd[p]![sd]!, entBox[p]![sd]!,
        planes, limit, runStart, runEnd)
      setRuns(p, n)
    }
  }

  function update(cx: number, cz: number): void {
    // 【傳送】移動超過半徑的話舊的一圈完全用不上了。`evict` 本來就會放掉
    // 它們，這裡只是把它寫明：範圍一換，`fill` 挑的就是新的格
    centerX = cx
    centerZ = cz
    started = true
    // 【重建進行中只往下寫】tile 與級數凍住到寫完，見 `job`
    if (job) {
      stepRebuild(rebuildBudget)
      return
    }
    evict()
    fill(tilesPerFrame)
    relevel()
    sinceRebuild++
    // 【三道閘】還在補格的期間不重建；兩次重建至少隔 REBUILD_EVERY 幀；
    // 而且鏡頭要移動 REBUILD_MOVE 公尺（或停著超過 REBUILD_IDLE 幀）。
    // 第三道才是關鍵 —— 見那兩個常數的說明
    const mx = centerX - lastBuildX
    const mz = centerZ - lastBuildZ
    const moved = Math.sqrt(mx * mx + mz * mz)
    // 【補格期間照樣重建】在 `made !== 0` 時禁止重建的話 —— 6 km 圈有 1,812
    // 格，冷啟動與傳送之後那是好幾秒的空白。上傳本身不是同步點，真正的
    // 同步點是別處每幀的空傳，見 `render/debris.ts`
    if (dirty && sinceRebuild >= REBUILD_EVERY
      && (moved >= REBUILD_MOVE || sinceRebuild >= REBUILD_IDLE)) {
      startRebuild()
      stepRebuild(rebuildBudget)
    }
  }

  function settle(force?: boolean): void {
    if (!started) update(centerX, centerZ)
    // 【進行中的重建先寫完】它寫的是開始那一幀的狀態；之後照常補格、換級
    if (job) stepRebuild(Infinity)
    if (force === true) {
      for (const name of POOL_NAMES) poolDirty[name] = true
      dirty = true
    }
    // 【一次補一整批，不是一格一格】`fill` 是走整條格環的，`fill(1)` 迴圈
    // 會變成 O(格數 × 環長) —— 12 km 是兩千六百萬次
    for (let n = 0; n < 4; n++) if (fill(tileCache) === 0) break
    evict()
    relevel()
    // 【settle 不受節流也不分幀】定格截圖要的是「現在就對」
    if (dirty) {
      startRebuild()
      stepRebuild(Infinity)
    }
  }

  return {
    object: group,
    // 【`PointsMaterial.color` 逐通道乘上頂點色】所以 1 是恆等
    setPointLight(scale) { pointMaterial.color.setScalar(scale) },
    update,
    cull,
    settle,
    counts,
    stats,
    debugTiles() {
      const out: { i: number, j: number, lod: number }[] = []
      for (let s = 0; s < tileCache; s++) {
        if (slotUsed[s] === 0) continue
        out.push({ i: slotI[s]!, j: slotJ[s]!, lod: slotLod[s]! })
      }
      return out
    },
    dispose() {
      disposeFloraGeometries(geometries)
      material.dispose()
      pointMaterial.dispose()
      for (const name of POOL_NAMES) {
        for (const run of meshRuns[name] ?? []) {
          run.mesh.dispose()
          if (run.mesh.geometry !== geometries[name as MeshPool]) run.mesh.geometry.dispose()
        }
        for (const pts of pointRuns[name] ?? []) pts.geometry.dispose()
      }
    },
  }
}
