import type { FloraBuffer } from '../core/floraBuffer'
import { FLORA_STRIDE, SHAPE_ONE } from '../core/floraBuffer'
import { POINT_SIZE, POINT_Y, type PointPool, type PoolName } from './floraShapes'
import type { createVegetationPools } from './vegetationPools'
import { BUILDING_POOLS, IS_POINT, POOL_LUT, POOL_NAMES, SLOT_SPAN, TINT_RANGE } from './vegetationPolicy'

type Pools = Pick<ReturnType<typeof createVegetationPools>,
  'altPt' | 'pointBase' | 'altMat' | 'altCol' | 'side' | 'pointRuns' |
  'poolCount' | 'entStart' | 'entEnd' | 'entBox' | 'entN' | 'geoRx' | 'geoRz' |
  'geoLo' | 'geoHi' | 'counts' | 'showAll'>

interface Tiles {
  readonly slotBuf: readonly (FloraBuffer | null)[]
  readonly slotUsed: Uint8Array
  readonly slotLod: Int8Array
  readonly slotBush: Uint8Array
  readonly slotKey: Float64Array
}

interface VegetationRebuild {
  readonly active: boolean
  /** 只在沒有進行中時開始；吃掉髒旗標，並定下這一輪的打包順序 */
  start(poolDirty: Record<PoolName, boolean>): void
  /** 在工作預算內處理整格的 tile；緩衝換上去的那一次回 true */
  step(budget: number): boolean
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
export function createVegetationRebuild(
  cap: Readonly<Record<PoolName, number>>,
  tiles: Tiles,
  pools: Pools,
  stats: { overflow: number; rebuilds: number },
): VegetationRebuild {
  const { slotBuf, slotUsed, slotLod, slotBush, slotKey } = tiles
  const tileCache = slotUsed.length
  const {
    altPt, pointBase, altMat, altCol, side, pointRuns,
    poolCount, entStart, entEnd, entBox, entN, geoRx, geoRz,
    geoLo, geoHi, counts, showAll,
  } = pools

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
  function startRebuild(poolDirty: Record<PoolName, boolean>): void {
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
    state.active = true
  }

  /** 往下寫，走過至少 `budget` 筆就停；寫完最後一格就換上去 */
  function stepRebuild(budget: number): boolean {
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
    return !state.active
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
    state.active = false
    stats.rebuilds++
  }

  const state = { active: false, start: startRebuild, step: stepRebuild }
  return state
}
