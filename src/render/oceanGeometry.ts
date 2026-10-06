import { BufferAttribute, BufferGeometry, Sphere, Vector3 } from 'three'
import { hilbertKey } from './cullRuns'

/**
 * clipmap 最內層的格子邊長，m —— **也就是低多邊形那個「面」有多大**。
 *
 * 【30 怎麼來的】海的邊長是山的 0.75 倍，而山是 `archipelago.ts` 的
 * `FIELD_CELL = 40`。`ocean.test.ts` 守的是那個**關係**不是數字：山變了
 * 海要跟著變。
 *
 * 【它同時是波長的下限】Nyquist 讓 30 m 的格子畫不出短於 60 m 的波，
 * 見 `WAVES`。
 */
export const OCEAN_BASE_CELL = 30

/**
 * 見 OCEAN_BASE_CELL。每一層的邊各切幾格。**必須是 4 的倍數**（空洞是中央
 * 的 (段數/2)²，而那要能整除）。
 *
 * 【256 怎麼來的】它同時決定兩件事：每層的四邊形數（256² − 128² = 49,152）
 * 與每層覆蓋的半徑（128 × 格子）。256 配上 30 m 的基礎格，讓 L0 的半寬是
 * 3,840 m —— 浪最有起伏的那一圈。任何距離上的面都是 128 格一個半寬，
 * 所以面在畫面上的大小處處相同。
 */
export const OCEAN_RING_SEGMENTS = 256

/**
 * 見 `OCEAN_BASE_CELL`。層數。每多一層，覆蓋半徑加倍、四邊形加 49,152。
 *
 * 【為什麼是 4】四層接到 ±30.7 km。再往外由平的遠海接手，而那個接縫的 5 m
 * 落差在 30.7 km 處是 0.21 px —— 仍在一個像素以內。
 *
 * 【為什麼不是均勻鋪滿】30 m 均勻鋪到 30.7 km 是 8,388,608 個三角形；
 * clipmap 是 425,984。均勻格的成本是半徑的平方，clipmap 是對數。
 */
export const OCEAN_LEVELS = 4

/**
 * 每一層的索引依 `OCEAN_BLOCK_GRID` × `OCEAN_BLOCK_GRID` 的塊排，塊的順序沿希爾伯特
 * 曲線（`oceanBlockRank`）。
 *
 * 【為什麼要切】四層都以相機為中心、包住鏡頭四周，整層的包圍盒恆與視錐相交 ——
 * 抬頭看天時近海照樣付頂點成本（實測 0.5 ms）。切成塊之後，畫面外的塊不畫。
 *
 * 【為什麼沿希爾伯特曲線】對齊的 2×2、4×4 塊在曲線上各自是連續的一段，所以同一份
 * 索引可以用任何一種粗細剔除（`OCEAN_CULL.grid`）；看得到的相鄰塊在索引上也相鄰，
 * 併成一次 draw call（`visibleRuns`）。
 */
export const OCEAN_BLOCK_GRID = 8

/** 塊 (bi, bj) 在索引裡的次序，0 … `OCEAN_BLOCK_GRID`² − 1 */
export function oceanBlockRank(bi: number, bj: number): number {
  return OCEAN_BLOCK_RANK[bj * OCEAN_BLOCK_GRID + bi]!
}

/** 依次序排好的塊：第 k 個是 (`BLOCK_BI[k]`, `BLOCK_BJ[k]`) */
export const BLOCK_BI = new Int8Array(OCEAN_BLOCK_GRID * OCEAN_BLOCK_GRID)

export const BLOCK_BJ = new Int8Array(OCEAN_BLOCK_GRID * OCEAN_BLOCK_GRID)

const OCEAN_BLOCK_RANK = ((): Int8Array => {
  const n = OCEAN_BLOCK_GRID
  const items: { bi: number, bj: number, key: number }[] = []
  for (let bj = 0; bj < n; bj++) for (let bi = 0; bi < n; bi++) items.push({ bi, bj, key: hilbertKey(bi, bj) })
  items.sort((a, b) => a.key - b.key)
  const rank = new Int8Array(n * n)
  items.forEach((it, k) => {
    rank[it.bj * n + it.bi] = k
    BLOCK_BI[k] = it.bi
    BLOCK_BJ[k] = it.bj
  })
  return rank
})()

/**
 * 剔除用的塊有多細：每層切成 `grid` × `grid`，必須整除 `OCEAN_BLOCK_GRID`。
 * **量測出口**：`main.ts` 的 `__oceanGrid` 換它，同頁比較用。
 */
export const OCEAN_CULL = { grid: 4 }

/** 每層最多分幾段畫（幾次 draw call）。段數超過就把間隔最小的併起來 */
export const OCEAN_RUN_CAP = 4

/**
 * 塊的包圍盒的上下緣，m。頂點只做垂直位移，最大是三道波的振幅和（4.5 m）；
 * 留一倍多的餘裕
 */
export const OCEAN_CULL_Y = 10

/**
 * 細浪面**整體**的邊長，m。由 clipmap 推導，不是可調參數。
 *
 * 【它現在只有一個用途】`ocean.test.ts` 拿它與 FAR_SEA_SIZE 比，確認遠海
 * 真的遠大於細浪面。
 */
export const OCEAN_SIZE
  = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1) * OCEAN_RING_SEGMENTS

/**
 * 網格中心吸附的間距，m。**由 clipmap 推導，不是可調參數。**
 *
 * 【為什麼是最外層的格距】它被每一層的格距整除（各層逐層加倍），所以一次
 * 吸附就讓四層同時落在自己的格點上 —— 見 `update`。
 */
export const OCEAN_SNAP = OCEAN_BASE_CELL * 2 ** (OCEAN_LEVELS - 1)

/**
 * 每一層外緣的過渡帶從哪裡開始，以那一層的半寬為 1。帶內細層逐漸變成外一層
 * 的樣子：幾何上把粗層沒有的頂點拉到粗層的高度，底色與白點也逐漸換成粗層的
 * 面（`FACE_FRAGMENT`）。
 *
 * 【為什麼非有不可】每一層是獨立的一塊網格，交界沒有縫合：細層邊上多出來的
 * 頂點跟著浪起伏，粗層在那裡只是一條直線 —— 沿整條交界有 1～2 m 的高低差，
 * 畫面上是一條斷面。過渡帶讓細層走到外緣時已經與粗層完全重合。
 *
 * 帶的終點是半寬再往內半個 OCEAN_SNAP，見 SPARKLE_COMMON 的 `oceanMorph`。
 */
export const OCEAN_MORPH_START = 0.7

/**
 * 頂點位移的頻帶限制窗，單位是波長的倍數。**格子小於 `LO × λ` 完全保留，
 * 大於 `HI × λ` 完全拿掉。**
 *
 * 【上界 0.5 是 Nyquist，不是美學選擇】格子等於半波長就是取樣的硬上限，
 * 再粗只會得到混疊。
 *
 * 【為什麼下界是 0.35 而不是 0.2 —— 這裡要的正是折角】0.2 的立意是「正弦波
 * 用直線接起來，要五個點以上才看不出折角」。低多邊形的海要的就是那個折角，
 * 所以窗往上推，讓 60 m 的格子留得住 165 m 的波（0.36λ）。
 *
 * 【它是徑向連續的，不是逐層常數】頂點著色器算的是
 * `vCell = max(baseCell, 離中心的距離 / 64)` —— 兩層交界上同一點兩層算出
 * 同一個值，淡出量因此逐位元一致，交界不會有高低差。
 *
 * 於是每一道波有一個「消失半徑」`HI × λ × 64`：380 m 那道撐到 12,160 m，
 * 165 m 那道到 5,280 m。**格子變粗與浪變平是同一件事的兩面** —— 遠處是大
 * 而平的面，近處是小而有起伏的面。接到平的遠海不必新增邊界處理。
 *
 * 【與 `gerstnerHeight` 的差異】CPU 那一份**不做**這個淡出，它永遠是完整的
 * 三道波。相機附近淡出量是 0，兩者逐位元相同；遠處才分家。而讀它的是水柱、
 * 殘骸、碎片入水 —— 那些都發生在相機附近。**碰撞不讀它**（海面是平的，
 * 見 `world/seaCrash.ts`）。
 */
export const OCEAN_VERT_FADE_LO = 0.35

/** 見 OCEAN_VERT_FADE_LO。 */
export const OCEAN_VERT_FADE_HI = 0.5

/**
 * 遠海的邊長，m。**這是一片平的四邊形，不是網格。**
 *
 * 【為什麼是 3,000 km 的半邊】這個世界的海是平的，幾何地平線永遠是與海面
 * 平行的那條視線（世界仰角 0°），與高度無關。但這片四邊形是有限的，它的邊
 * 落在 `atan(離海高度 / 半邊)` —— **那才是畫面上實際看到的那條地平線**。
 * （那是上界：朝正方形的**角**看時距離是 `半邊 × √2`，俯角更淺。）
 *
 * 像素數用 `(H/2)·tanθ / tan(FOV_v/2)`，1080p / 65°：
 *
 * ```
 * 相機高度    半邊 250 km        半邊 3,000 km
 *  1,000 m   0.230°（3.4 px）   0.019°（0.28 px）
 *  6,000 m   1.376°（20.4 px）  0.115°（1.7 px）
 * 12,000 m   2.751°（40.7 px）  0.229°（3.4 px）
 * ```
 *
 * 250 km 時那條線在上帝視角的極端高度下低了 40.7 px，而且隨高度移動。
 * 那條線是海色對天空色的一階，遠處再被霧化軟（海面吃霧，見下面兩個材質）。
 *
 * 【這是近似，不是精確】有限平面永遠做不到精確落在幾何地平線。要精確就得換
 * 成相機相對的程序化海面或 clip-space 的解法 —— 那是另一個量級的改動。現況
 * 與目標之間差了一個數量級，先把數量級拿掉。
 *
 * 【遠平面要跟著動】`CAMERA_FAR` 必須大於半對角線 4,243 km，見 `scene.ts`。
 *
 * 【為什麼不必分段】它是平的，分段沒有任何意義。
 */
export const FAR_SEA_SIZE = 6_000_000

/**
 * 遠海的繪製次序。**比細浪面晚畫。**
 *
 * 理由與量測見 `farMesh.renderOrder` 那一行上方的長註解。匯出是因為
 * `sky.ts` 的 `SKY_RENDER_ORDER` 必須比它大，而測試要對得上來源。
 */
export const FAR_SEA_RENDER_ORDER = 1

/**
 * 遠海的高度，m。
 *
 * 【為什麼是負的】五道波的振幅和是 4.673 m，細浪面的最低點因此是 −4.673。
 * 遠海放在 0 會在波谷之間穿插、產生 z-fighting。放在 −5.0 保證它在 ±5 km
 * 的範圍內**永遠被細浪面蓋住**，餘裕 0.33 m。
 *
 * **這一行與 WAVES 的振幅是綁死的** —— 動振幅就要回來重算，深度不夠時
 * 遠海會從波谷穿出來。
 *
 * 【接縫的可見度】5.0 m 的落差在 5 km 外張角 1.0 mrad（0.057°）。
 * 1440p / 65° FOV 的一個像素是 0.045°，所以是 1.27 px —— **不在一個像素
 * 以內**，貼海低飛時可能看得出一條細線。八張凍結姿態都還沒看到，因為那條
 * 線落在碎光與反射最亮的區帶裡。真要根治得讓遠海也跟著浪起伏，而那是相機
 * 為中心的 LOD 那一輪的事。
 */
export const FAR_SEA_Y = -5.0

/**
 * 建一層 clipmap 的幾何：`segments × segments` 格、每格 `cell` 公尺、以原點
 * 為中心、躺在 XZ 平面上。`hollow` 為真時挖掉中央的 `(segments/2)²` 格 ——
 * 那正好是內一層的覆蓋範圍（見 OCEAN_BASE_CELL 的推導）。
 *
 * 【為什麼自己建而不用 PlaneGeometry + 挖洞】挖洞要重寫索引，而 PlaneGeometry
 * 的頂點順序與繞向是它的實作細節。自己建三十行，而且**洞裡的頂點刻意留在
 * 緩衝區裡**：索引沒有引用它們，GPU 就不會取，等於免費 —— 換來的是所有層
 * 共用同一套「i, j → 頂點編號」的算式，讀起來直接。
 *
 * 【繞向】由上往下看要是逆時針（three 的預設 FrontSide 是 CCW），法線才朝
 * 上。x 往右、z 往前（螢幕的下方），所以 (i,j) → (i+1,j) → (i,j+1) 這個順序
 * 在 XZ 上是順時針，要反過來寫。
 */
export function clipmapLevelGeometry(
  cell: number, segments: number, hollow: boolean,
): { geometry: BufferGeometry, blockStart: Int32Array } {
  const n = segments + 1
  const half = (segments / 2) * cell
  const pos = new Float32Array(n * n * 3)
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const o = (j * n + i) * 3
      pos[o] = i * cell - half
      pos[o + 1] = 0
      pos[o + 2] = j * cell - half
    }
  }
  // 洞的範圍：中央 segments/2 格，也就是索引 [segments/4, 3·segments/4)
  const holeLo = segments / 4
  const holeHi = segments - segments / 4
  // 【索引依塊排】塊的次序沿希爾伯特曲線，見 `OCEAN_BLOCK_GRID`。
  // `blockStart[k]` 是第 k 塊在索引裡的起點；洞裡的塊是空的一段
  const idx: number[] = []
  const side = segments / OCEAN_BLOCK_GRID
  const blockStart = new Int32Array(OCEAN_BLOCK_GRID * OCEAN_BLOCK_GRID + 1)
  for (let k = 0; k < OCEAN_BLOCK_GRID * OCEAN_BLOCK_GRID; k++) {
    blockStart[k] = idx.length
    const bi = BLOCK_BI[k]!
    const bj = BLOCK_BJ[k]!
    for (let j = bj * side; j < (bj + 1) * side; j++) {
      for (let i = bi * side; i < (bi + 1) * side; i++) {
        if (hollow && i >= holeLo && i < holeHi && j >= holeLo && j < holeHi) continue
        const a = j * n + i
        const b = a + 1
        const c = a + n
        const d = c + 1
        idx.push(a, c, b, b, c, d)
      }
    }
  }
  blockStart[OCEAN_BLOCK_GRID * OCEAN_BLOCK_GRID] = idx.length
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(pos, 3))
  // 【法線一律 +Y】材質是 flatShading，three 會用導數自己算面法線，這個
  // attribute 只是為了讓 built-in 的 shader chunk 有東西可以綁
  const nrm = new Float32Array(n * n * 3)
  for (let k = 0; k < n * n; k++) nrm[k * 3 + 1] = 1
  g.setAttribute('normal', new BufferAttribute(nrm, 3))
  // 【這一層的格距】四層共用一顆材質，頂點著色器靠它知道自己在哪一層 ——
  // 幾何過渡要知道哪些頂點是粗層沒有的、兩旁的粗頂點在哪
  g.setAttribute('oceanCell', new BufferAttribute(new Float32Array(n * n).fill(cell), 1))
  g.setIndex(idx)
  // 【自己設包圍球】頂點會被波位移，而 computeBoundingSphere 只看原始座標。
  // 反正這些網格 frustumCulled = false，這裡只是不讓 three 事後去算它。
  g.boundingSphere = new Sphere(new Vector3(0, 0, 0), half * Math.SQRT2 + 8)
  return { geometry: g, blockStart }
}
