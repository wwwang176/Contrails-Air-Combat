import {
  Color, DynamicDrawUsage, Group, InstancedMesh, Matrix4, MeshStandardMaterial,
  type BufferGeometry, type Object3D,
} from 'three'
import {
  createFloraBuffer, FloraKind, FLORA_STRIDE, type FloraBuffer, type FloraSource,
} from './flora'
import {
  createFloraGeometries, disposeFloraGeometries, type PoolName,
} from './floraShapes'

export type { PoolName }

/**
 * 植被的引擎：**跟著鏡頭的 tile 快取 ＋ 分級的 InstancedMesh 池。**
 *
 * ```
 *   近   0 – 900 m      樹幹 ＋ 樹冠
 *   遠   900 – 3,000    只有樹冠 —— 900 m 外樹幹不足 1 px
 *   外   > 3,000 m      不畫。著色器那條 18 m 的暗帶自己接手
 *   灌木 0 – 1,200 m
 *   建築 圈內都畫       一座 18 tri、圈內約 50 座，分級沒有意義
 * ```
 *
 * 【兩級，而且分樹種】闊葉近遠都是圓的八面體，針葉近遠都是尖錐 ——
 * 換級只掉樹幹，不換剪影也不換顏色。**第三級買不到效能**：一個從各角度都
 * 讀得出「圓」的形狀最少就是 8 個三角形，實測三級與兩級的三角形總數是
 * 184k 對 187k，多的只是一個會跳的門檻。
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
export const FLORA_RADIUS = 3000

/**
 * 樹幹畫到多遠，m。**唯一的換級門檻。**
 *
 * 樹幹直徑 1 m。960 px 高、60° 垂直視角下，1 m 在 d 公尺外約占 917 / d 個
 * 像素 —— 900 m 正好是 1 px，再往外就是在畫看不見的東西。
 *
 * 【放遠的代價很小】一棵樹由遠級升到近級只多 12 個三角形（20 對 8、19 對 6），
 * 所以 450 → 900 整段只漲 25k。換到的是「看得到樹幹」的時間由 3 秒變 6 秒
 * （甲板速度 150 m/s）。
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

/** 每幀最多生幾格。200 m/s 越過一格是 1.25 s，補一欄約 16 格 */
export const TILES_PER_FRAME = 4

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
 * 單一 tile 最多幾株。
 *
 * 實測（`vegetation.test.ts` 的掃描）最密的一格是 351 株 —— 整格都是樹林
 * 的那種。512 留了四成六的餘裕。
 */
export const MAX_PER_TILE = 512

/**
 * 快取幾格。圈內約 455 格，多留的是移動時的暫時重疊。
 *
 * 每槽 `MAX_PER_TILE × FLORA_STRIDE × 4` bytes 的資料加 `MAX_PER_TILE` bytes
 * 的種類，560 槽約 7.2 MB。全部開場配掉，之後不再配置。
 */
export const TILE_CACHE = 560

const LOD_STEP = [LOD_NEAR, FLORA_RADIUS] as const

/**
 * 這個距離該用哪一級。`prev` 是目前的級數，`-1` 表示沒有前一級。
 *
 * 【遲滯】往外要多走 `LOD_HYSTERESIS`，往內要少走同樣多。沒有它的話，
 * 鏡頭停在門檻上時整格 tile 每幀換級。
 */
export function lodFor(dist: number, prev: number): number {
  if (prev < 0) {
    let lod = 0
    while (lod < 2 && dist > LOD_STEP[lod]!) lod++
    return lod
  }
  let lod = prev
  while (lod < 2 && dist > LOD_STEP[lod]! + LOD_HYSTERESIS) lod++
  while (lod > 0 && dist < LOD_STEP[lod - 1]! - LOD_HYSTERESIS) lod--
  return lod
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
  broadNear: 2800,   // 掃描最大 2,056
  coneNear: 1300,    // 913
  broadFar: 24000,   // 17,728
  coneFar: 9700,     // 7,146
  bush: 12000,       // 8,750
  house: 100,        // 25
  barn: 60,          // 11
  church: 20,        // 2
}

const POOL_NAMES: readonly PoolName[] = [
  'broadNear', 'coneNear', 'broadFar', 'coneFar', 'bush', 'house', 'barn', 'church',
]

export interface Vegetation {
  readonly object: Object3D
  update(centerX: number, centerZ: number): void
  /** 一次把生成佇列排乾。定格截圖與容量掃描要它 */
  settle(): void
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
    /** 預配的緩衝身分，給「不配置」那條測試比對 */
    buffers: readonly Float32Array[]
    keyType: string
  }
}

const M = new Matrix4()
const TINT = new Color()

/**
 * 這一株該進哪一個池。`null` = 這一級不畫它。
 *
 * 【樹種不隨級數變】兩級各有自己的闊葉與針葉。上一版把兩種樹在遠級併成
 * 同一個池，於是針葉樹過門檻時形狀與顏色一起換 —— 看起來像那棵樹換了種。
 */
export function poolOf(kind: number, lod: number, bush: boolean): PoolName | null {
  if (lod >= 2) return null
  switch (kind) {
    case FloraKind.BroadTree:
      return lod === 0 ? 'broadNear' : 'broadFar'
    case FloraKind.ConeTree:
      return lod === 0 ? 'coneNear' : 'coneFar'
    case FloraKind.Bush:
      return bush ? 'bush' : null
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
  /** 覆寫池的容量。**只給掃描與變異驗證用** —— 見 `CAPACITY` */
  capacity?: Partial<Record<PoolName, number>>,
): Vegetation {
  const cap: Record<PoolName, number> = { ...CAPACITY, ...capacity }
  const geometries = createFloraGeometries()
  const material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9,
  })
  const group = new Group()
  const pools: Record<PoolName, InstancedMesh> = {} as Record<PoolName, InstancedMesh>
  for (const name of POOL_NAMES) {
    const mesh = new InstancedMesh(
      geometries[name] as BufferGeometry, material, cap[name],
    )
    mesh.instanceMatrix.setUsage(DynamicDrawUsage)
    // 【先摸一次 instanceColor】`setColorAt` 會在第一次呼叫時建出屬性，
    // 而那是一次配置 —— 開場配掉，之後重建就不再配
    mesh.setColorAt(0, TINT.setRGB(1, 1, 1))
    mesh.count = 0
    mesh.frustumCulled = false
    pools[name] = mesh
    group.add(mesh)
  }

  // ── tile 快取。全部預配，之後不再配置 ──────────────────
  const slotBuf: FloraBuffer[] = []
  const bufIdentity: Float32Array[] = []
  for (let i = 0; i < TILE_CACHE; i++) {
    const b = createFloraBuffer(MAX_PER_TILE)
    slotBuf.push(b)
    bufIdentity.push(b.data)
  }
  const slotI = new Int32Array(TILE_CACHE)
  const slotJ = new Int32Array(TILE_CACHE)
  const slotUsed = new Uint8Array(TILE_CACHE)
  const slotLod = new Int8Array(TILE_CACHE)
  const slotBush = new Uint8Array(TILE_CACHE)
  /** tile 的鍵 → 槽位。**鍵是數值** —— 字串鍵每幀都在配置 */
  const bySlot = new Map<number, number>()

  const counts: Record<PoolName, number> =
    { broadNear: 0, coneNear: 0, broadFar: 0, coneFar: 0, bush: 0, house: 0, barn: 0, church: 0 }
  const stats = {
    tiles: 0, dropped: 0, overflow: 0, rebuilds: 0,
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
  const poolDirty: Record<PoolName, boolean> = {
    broadNear: true, coneNear: true, broadFar: true, coneFar: true,
    bush: true, house: true, barn: true, church: true,
  }
  function markAll(): void {
    for (const name of POOL_NAMES) poolDirty[name] = true
  }
  /** 某一格由 `a` 級換到 `b` 級，會動到哪些池 */
  function markLevel(lod: number): void {
    if (lod === 0) { poolDirty.broadNear = true; poolDirty.coneNear = true }
    else if (lod === 1) { poolDirty.broadFar = true; poolDirty.coneFar = true }
  }

  const keyOf = (i: number, j: number): number => i * 65536 + j

  function freeSlot(slot: number): void {
    bySlot.delete(keyOf(slotI[slot]!, slotJ[slot]!))
    slotUsed[slot] = 0
  }

  function takeSlot(): number {
    for (let s = 0; s < TILE_CACHE; s++) if (slotUsed[s] === 0) return s
    // 【滿了就丟最舊的】圈內約 201 格而快取 288，正常不會走到這裡
    freeSlot(0)
    return 0
  }

  /** 生一格。回 false 表示這一格已經在快取裡 */
  function makeTile(i: number, j: number): boolean {
    if (bySlot.has(keyOf(i, j))) return false
    const slot = takeSlot()
    const buf = slotBuf[slot]!
    buf.count = 0
    buf.dropped = 0
    const x0 = i * TILE_SIZE
    const z0 = j * TILE_SIZE
    for (const src of sources) src(x0, z0, x0 + TILE_SIZE, z0 + TILE_SIZE, heightAt, buf)
    if (buf.dropped > 0) {
      stats.dropped += buf.dropped
      if (!warned) {
        warned = true
        console.warn(`植被：單格超過 MAX_PER_TILE=${MAX_PER_TILE}，丟了 ${buf.dropped} 株`)
      }
    }
    slotI[slot] = i
    slotJ[slot] = j
    slotUsed[slot] = 1
    slotLod[slot] = -1
    bySlot.set(keyOf(i, j), slot)
    // 【加一格會讓每個池的打包位移】所以全部要重傳
    dirty = true
    markAll()
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
      markAll()
    }
  }

  /**
   * 生最多 `budget` 格，**由近而遠**。
   *
   * 【為什麼不是佇列】掃一次格範圍是 256 次迴圈，比維護一條佇列還便宜，
   * 而且傳送時不必特別去清 —— 範圍一換，該生的自然就換了。
   */
  function fill(budget: number): number {
    const i0 = Math.floor((centerX - FLORA_RADIUS) / TILE_SIZE)
    const i1 = Math.floor((centerX + FLORA_RADIUS) / TILE_SIZE)
    const j0 = Math.floor((centerZ - FLORA_RADIUS) / TILE_SIZE)
    const j1 = Math.floor((centerZ + FLORA_RADIUS) / TILE_SIZE)
    let made = 0
    for (let n = 0; n < budget; n++) {
      let bi = 0
      let bj = 0
      let bd = Infinity
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          if (!inRange(i, j)) continue
          if (bySlot.has(keyOf(i, j))) continue
          const cx = i * TILE_SIZE + TILE_SIZE / 2
          const cz = j * TILE_SIZE + TILE_SIZE / 2
          const d = (cx - centerX) * (cx - centerX) + (cz - centerZ) * (cz - centerZ)
          if (d < bd) { bd = d; bi = i; bj = j }
        }
      }
      if (bd === Infinity) break
      makeTile(bi, bj)
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
      const lod = lodFor(d, slotLod[s]!)
      const bush = d <= BUSH_RANGE + (slotBush[s] === 1 ? LOD_HYSTERESIS : 0) ? 1 : 0
      if (lod !== slotLod[s]) {
        dirty = true
        markLevel(slotLod[s]!)
        markLevel(lod)
      }
      if (bush !== slotBush[s]) { dirty = true; poolDirty.bush = true }
      slotLod[s] = lod
      slotBush[s] = bush
    }
    stats.tiles = live
  }

  /** 把所有活著的 tile 寫進池 */
  function rebuild(): void {
    for (const name of POOL_NAMES) counts[name] = 0
    stats.overflow = 0
    for (let s = 0; s < TILE_CACHE; s++) {
      if (slotUsed[s] === 0) continue
      const buf = slotBuf[s]!
      const lod = slotLod[s]!
      const bush = slotBush[s] === 1
      for (let k = 0; k < buf.count; k++) {
        const name = poolOf(buf.kind[k]!, lod, bush)
        if (name === null) continue
        const at = counts[name]
        if (at >= cap[name]) {
          stats.overflow++
          continue
        }
        const o = k * FLORA_STRIDE
        const scale = buf.data[o + 4]!
        const rot = buf.data[o + 3]!
        // 【就地寫矩陣，不用 compose】只有繞 Y 的旋轉與等比縮放，
        // 四元數那一趟省下來
        const c = Math.cos(rot) * scale
        const sn = Math.sin(rot) * scale
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
      const mesh = pools[name]
      const used = counts[name]
      mesh.count = used
      // 【只上傳真的變了的池】沒變的池，重寫進去的位元組與 GPU 上那一份
      // 逐位元相同 —— 傳它是純粹的浪費，而那個浪費會撞到驅動的緩衝重配置
      if (!poolDirty[name]) continue
      poolDirty[name] = false
      // 【只上傳用到的那一段】容量是實測最大值的 1.35 倍，整條傳等於白傳
      // 三成五。broadFar 一條就是 1.3 MB
      mesh.instanceMatrix.addUpdateRange(0, used * 16)
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) {
        mesh.instanceColor.addUpdateRange(0, used * 3)
        mesh.instanceColor.needsUpdate = true
      }
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
    const made = fill(TILES_PER_FRAME)
    relevel()
    sinceRebuild++
    // 【三道閘】還在補格的期間不重建；兩次重建至少隔 REBUILD_EVERY 幀；
    // 而且鏡頭要移動 REBUILD_MOVE 公尺（或停著超過 REBUILD_IDLE 幀）。
    // 第三道才是關鍵 —— 見那兩個常數的說明
    const moved = Math.hypot(centerX - lastBuildX, centerZ - lastBuildZ)
    if (dirty && made === 0 && sinceRebuild >= REBUILD_EVERY
      && (moved >= REBUILD_MOVE || sinceRebuild >= REBUILD_IDLE)) rebuild()
  }

  function settle(): void {
    if (!started) update(centerX, centerZ)
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
    dispose() {
      disposeFloraGeometries(geometries)
      material.dispose()
      for (const name of POOL_NAMES) pools[name].dispose()
    },
  }
}
