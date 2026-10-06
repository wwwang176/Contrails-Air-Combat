import type { Camera, Object3D } from 'three'
import { hilbertKey } from './cullRuns'
import { createFloraBuffer, type FloraBuffer, type FloraSource } from '../core/floraBuffer'
import type { PoolName } from './floraShapes'
import { createVegetationPools } from './vegetationPools'
import { createVegetationRebuild } from './vegetationRebuild'
import {
  TILE_SIZE, FLORA_RADIUS, TILES_PER_FRAME, REBUILD_BUDGET, MAX_PER_TILE, CAPACITY,
  SLOT_SPAN, POOL_NAMES, BUILDING_POOLS, outerFor, lodFor, BUSH_RANGE,
  LOD_HYSTERESIS, REBUILD_EVERY, REBUILD_MOVE, REBUILD_IDLE,
} from './vegetationPolicy'
import type { Season } from './season'

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
 * `RUN_CAP` 段，一段一次 draw call，全部畫在同一條緩衝上。見 `vegetationPools.ts` 的 `cull`。
 */

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
  const pools = createVegetationPools(cap, season, tileCache)
  const { group, counts, cull, setPointLight, dispose } = pools

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

  const rebuild = createVegetationRebuild(
    cap, { slotBuf, slotUsed, slotLod, slotBush, slotKey }, pools, stats,
  )

  function startRebuild(): void {
    rebuild.start(poolDirty)
    dirty = false
    lastBuildX = centerX
    lastBuildZ = centerZ
  }

  function update(cx: number, cz: number): void {
    // 【傳送】移動超過半徑的話舊的一圈完全用不上了。`evict` 本來就會放掉
    // 它們，這裡只是把它寫明：範圍一換，`fill` 挑的就是新的格
    centerX = cx
    centerZ = cz
    started = true
    // 【重建進行中只往下寫】tile 與級數凍住到寫完，見 `vegetationRebuild.ts`
    if (rebuild.active) {
      if (rebuild.step(rebuildBudget)) sinceRebuild = 0
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
      if (rebuild.step(rebuildBudget)) sinceRebuild = 0
    }
  }

  function settle(force?: boolean): void {
    if (!started) update(centerX, centerZ)
    // 【進行中的重建先寫完】它寫的是開始那一幀的狀態；之後照常補格、換級
    if (rebuild.active && rebuild.step(Infinity)) sinceRebuild = 0
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
      if (rebuild.step(Infinity)) sinceRebuild = 0
    }
  }

  return {
    object: group,
    // 【`PointsMaterial.color` 逐通道乘上頂點色】所以 1 是恆等
    setPointLight,
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
    dispose,
  }
}
