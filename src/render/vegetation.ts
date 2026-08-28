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
 *   L0   0 – 450 m      樹幹 ＋ 樹冠
 *   L1   450 – 1,100    只有樹冠 —— 800 m 外樹幹不足 1 px
 *   L2   1,100 – 2,000  四邊錐
 *   外   > 2,000 m      不畫。著色器那條 18 m 的暗帶自己接手
 *   灌木 0 – 500 m
 *   建築 圈內都畫       一座 18 tri、圈內約 50 座，分級沒有意義
 * ```
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
export const FLORA_RADIUS = 2000
export const LOD_NEAR = 450
export const LOD_MID = 1100
export const LOD_FAR = 2000

/** 換級的緩衝，m。只擋來回抖動 */
export const LOD_HYSTERESIS = 40

/** 灌木畫到多遠，m */
export const BUSH_RANGE = 500

/** 每幀最多生幾格。200 m/s 越過一格是 1.25 s，補一欄約 16 格 */
export const TILES_PER_FRAME = 4

/**
 * 單一 tile 最多幾株。
 *
 * 實測（`vegetation.test.ts` 的掃描）最密的一格是 318 株 —— 整格都是樹林
 * 的那種。512 留了六成的餘裕。
 */
export const MAX_PER_TILE = 512

/**
 * 快取幾格。圈內約 201 格，多留的是移動時的暫時重疊。
 */
export const TILE_CACHE = 288

const LOD_STEP = [LOD_NEAR, LOD_MID, LOD_FAR] as const

/**
 * 這個距離該用哪一級。`prev` 是目前的級數，`-1` 表示沒有前一級。
 *
 * 【遲滯】往外要多走 `LOD_HYSTERESIS`，往內要少走同樣多。沒有它的話，
 * 鏡頭停在門檻上時整格 tile 每幀換級。
 */
export function lodFor(dist: number, prev: number): number {
  if (prev < 0) {
    let lod = 0
    while (lod < 3 && dist > LOD_STEP[lod]!) lod++
    return lod
  }
  let lod = prev
  while (lod < 3 && dist > LOD_STEP[lod]! + LOD_HYSTERESIS) lod++
  while (lod > 0 && dist < LOD_STEP[lod - 1]! - LOD_HYSTERESIS) lod--
  return lod
}

/**
 * 各池的容量。**由 `vegetation.test.ts` 的掃描定值** —— 沿一條穿過全圖的
 * 航線取 40 個位置，各池的最大同時實例數乘 1.35 進位。註解裡的是實測最大值。
 *
 * 【建築那三個為什麼放得寬】圈內通常只有一到兩個村，實測最大只有 18 棟房子，
 * 但那個數字對「村剛好在圈心」很敏感。三個池加起來也才 180 個實例。
 *
 * 溢位時丟掉並記一次告警，不靜默截斷。
 */
const CAPACITY: Record<PoolName, number> = {
  broadL0: 800,     // 掃描最大 548
  coneL0: 500,      // 322
  treeMid: 4300,    // 3,084
  treeFar: 10400,   // 7,560
  bush: 2000,       // 1,399
  house: 100,       // 18
  barn: 60,         // 4
  church: 20,       // 1
}

const POOL_NAMES: readonly PoolName[] = [
  'broadL0', 'coneL0', 'treeMid', 'treeFar', 'bush', 'house', 'barn', 'church',
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
    /** 預配的緩衝身分，給「不配置」那條測試比對 */
    buffers: readonly Float32Array[]
    keyType: string
  }
}

const M = new Matrix4()
const TINT = new Color()

/**
 * 這一株該進哪一個池。`null` = 這一級不畫它。
 */
function poolOf(kind: number, lod: number, bush: boolean): PoolName | null {
  if (lod >= 3) return null
  switch (kind) {
    case FloraKind.BroadTree:
      return lod === 0 ? 'broadL0' : lod === 1 ? 'treeMid' : 'treeFar'
    case FloraKind.ConeTree:
      return lod === 0 ? 'coneL0' : lod === 1 ? 'treeMid' : 'treeFar'
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
): Vegetation {
  const geometries = createFloraGeometries()
  const material = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.9,
  })
  const group = new Group()
  const pools: Record<PoolName, InstancedMesh> = {} as Record<PoolName, InstancedMesh>
  for (const name of POOL_NAMES) {
    const mesh = new InstancedMesh(
      geometries[name] as BufferGeometry, material, CAPACITY[name],
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
    { broadL0: 0, coneL0: 0, treeMid: 0, treeFar: 0, bush: 0, house: 0, barn: 0, church: 0 }
  const stats = {
    tiles: 0, dropped: 0, overflow: 0,
    buffers: bufIdentity as readonly Float32Array[], keyType: 'number',
  }

  let centerX = 0
  let centerZ = 0
  let started = false
  let dirty = true
  let warned = false

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
    dirty = true
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
      if (lod !== slotLod[s] || bush !== slotBush[s]) dirty = true
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
        if (at >= CAPACITY[name]) {
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
      mesh.count = counts[name]
      mesh.instanceMatrix.needsUpdate = true
      if (mesh.instanceColor !== null) mesh.instanceColor.needsUpdate = true
    }
    dirty = false
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
    // 【只在排乾的那一幀重建】還在補格的期間不重建，省下每幀的緩衝上傳
    if (dirty && made === 0) rebuild()
  }

  function settle(): void {
    if (!started) update(centerX, centerZ)
    // 【上界是快取大小】圈內約 201 格，這個上界只是防呆
    for (let n = 0; n < TILE_CACHE * 2; n++) if (fill(1) === 0) break
    evict()
    relevel()
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
