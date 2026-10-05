/** 植被的 LOD、串流預算與池配置；與 GPU 資源的建立及釋放分開。 */
import { FloraKind } from '../core/floraBuffer'
import { hash2 } from '../core/hash'
import { POINT_POOLS, type PoolName } from './floraShapes'

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
export const REBUILD_IDLE = 120

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
 * 群島用的。島上的密度見 `render/islandFlora.ts` 的 `ISLAND_GRID`。
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
export const SLOT_SPAN = 16384

export const LOD_STEP = [LOD_NEAR, POINT_NEAR, FLORA_RADIUS] as const

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
export const BUILDING_POOLS: readonly PoolName[] = ['house', 'barn', 'church', 'houseSlate', 'barnTar']

/**
 * 逐實例的明度倍率範圍（乘在頂點色上，整株一起乘）。
 *
 * 【建築放得比樹寬】老房子的瓦與牆一棟跟一棟新舊不一、有的剛翻修、有的被煤煙
 * 燻黑 —— 窄的話一整個鎮的屋頂是同一個紅。
 */
export const TINT_RANGE = { plant: [0.86, 1.14], building: [0.74, 1.22] } as const

export const POOL_NAMES: readonly PoolName[] = [
  'broadNear', 'coneNear', 'broadMid', 'coneMid',
  'broadPoint', 'conePoint', 'bushNear', 'bushPoint',
  'house', 'barn', 'church', 'houseSlate', 'barnTar',
]

/** 哪些池走點材質。查表比字串比對便宜，而 `rebuild` 每筆都要問一次 */
export const IS_POINT: Record<PoolName, boolean> =
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
export const POOL_LUT: Int8Array = (() => {
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
