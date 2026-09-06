import { describe, it, expect } from 'vitest'
import { BufferAttribute, InstancedMesh, MeshStandardMaterial, Points } from 'three'
import { POINT_POOLS } from '../../src/render/floraShapes'
import {
  createVegetation, lodFor, poolOf, BUSH_RANGE, POINT_NEAR, FLORA_RADIUS,
  ISLAND_CAPACITY, ISLAND_MAX_PER_TILE, ISLAND_RADIUS, ISLAND_TILES_PER_FRAME,
  LOD_HYSTERESIS, LOD_NEAR, REBUILD_EVERY, REBUILD_MOVE,
  TILES_PER_FRAME, TILE_SIZE, type PoolName,
} from '../../src/render/vegetation'
import {
  createFloraBuffer, createIslandFlora, farmHedgeFlora, farmVillageFlora,
  farmWoodFlora, pushFlora, FloraKind, type FloraSource,
} from '../../src/render/flora'
import { createArchipelago } from '../../src/world/archipelago'

const FLAT = (): number => 0

/** 每一格生固定的六筆 —— 每一種各一，數量因此完全可預測 */
const SIX: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  const cx = (x0 + x1) / 2
  const cz = (z0 + z1) / 2
  for (let k = 0; k < 6; k++) {
    pushFlora(out, cx + k, heightAt(cx, cz), cz, 0, 1, 0.5, k as FloraKind)
  }
}

const EMPTY: FloraSource = () => {}

/** 只在原點那一格放一棟房子與一棵闊葉樹 */
const ONE: FloraSource = (x0, z0, x1, z1, heightAt, out) => {
  if (x0 > 5 || x1 <= 5 || z0 > 5 || z1 <= 5) return
  pushFlora(out, 5, heightAt(5, 5), 5, 0, 1, 0.5, FloraKind.House)
  pushFlora(out, 6, heightAt(6, 5), 5, 0, 1, 0.5, FloraKind.BroadTree)
}

type Pool = InstancedMesh | Points

function meshes(v: { object: { children: unknown[] } }): Pool[] {
  return v.object.children as Pool[]
}

/**
 * 池的檢查一律走這三支。**遠處那三個池是 `Points`，其餘八個是
 * `InstancedMesh`** —— 兩者的實例數、容量、屬性都放在不同的地方。
 */
function poolCount(p: Pool): number {
  return p instanceof InstancedMesh ? p.count : p.geometry.drawRange.count
}

/** 配置時給的容量 */
function poolCapacity(p: Pool): number {
  return p instanceof InstancedMesh
    ? p.instanceMatrix.count
    : p.geometry.getAttribute('position').count
}

/** 這一池的兩條逐實例屬性：實例池是矩陣與顏色，點池是位置與顏色 */
function poolAttrs(p: Pool): BufferAttribute[] {
  if (p instanceof InstancedMesh) {
    return [p.instanceMatrix as BufferAttribute, p.instanceColor as BufferAttribute]
  }
  return [
    p.geometry.getAttribute('position') as BufferAttribute,
    p.geometry.getAttribute('color') as BufferAttribute,
  ]
}

/** 一筆實例佔第一條屬性的幾個 float */
function poolStride(p: Pool): number {
  return p instanceof InstancedMesh ? 16 : 3
}

describe('lodFor', () => {
  it('沒有前一級時，級數隨距離單調不減', () => {
    let prev = -1
    for (let d = 0; d < 8000; d += 5) {
      const lod = lodFor(d, -1)
      expect(lod).toBeGreaterThanOrEqual(prev)
      prev = lod
    }
    expect(lodFor(0, -1)).toBe(0)
    expect(lodFor(LOD_NEAR + 1, -1)).toBe(1)
    expect(lodFor(POINT_NEAR + 1, -1)).toBe(2)
    expect(lodFor(FLORA_RADIUS + 1, -1)).toBe(3)
  })

  /** 【遲滯】沒有它的話，鏡頭停在門檻上時整格 tile 每幀換級 */
  it('遲滯：在門檻上來回不會每次換級', () => {
    expect(lodFor(LOD_NEAR + 10, 0)).toBe(0)
    expect(lodFor(LOD_NEAR + 10, 1)).toBe(1)
    expect(lodFor(LOD_NEAR + LOD_HYSTERESIS + 1, 0)).toBe(1)
    expect(lodFor(LOD_NEAR - LOD_HYSTERESIS - 1, 1)).toBe(0)
  })

  it('跨好幾級的跳躍一次到位', () => {
    expect(lodFor(FLORA_RADIUS * 2, 0)).toBe(3)
    expect(lodFor(10, 3)).toBe(0)
  })
})

describe('poolOf', () => {
  /**
   * 【逐一比對四個映射，不是只驗前綴】只驗 name.startsWith('broad') 的話，
   * 「兩級都回 broadNear」與「近遠對調」都會綠 —— 而那兩個正是最可能
   * 寫出來的錯。
   *
   * 這一條是「換級不換樹種」在引擎這一側的守門員；幾何那一側由
   * flora-shapes.test.ts 的同名兩條守。
   */
  it('換級不換樹種，六個映射逐一對得上', () => {
    expect(poolOf(FloraKind.BroadTree, 0, false)).toBe('broadNear')
    expect(poolOf(FloraKind.BroadTree, 1, false)).toBe('broadMid')
    expect(poolOf(FloraKind.BroadTree, 2, false)).toBe('broadPoint')
    expect(poolOf(FloraKind.ConeTree, 0, false)).toBe('coneNear')
    expect(poolOf(FloraKind.ConeTree, 1, false)).toBe('coneMid')
    expect(poolOf(FloraKind.ConeTree, 2, false)).toBe('conePoint')
  })

  it('圈外那一級什麼都不畫', () => {
    for (const k of [FloraKind.BroadTree, FloraKind.ConeTree, FloraKind.Bush]) {
      expect(poolOf(k, 3, true)).toBeNull()
    }
  })

  /** 【灌木的旗標現在選的是「哪一級」，不是「畫不畫」】圈內每一格都有灌木 */
  it('灌木由旗標選級，建築三種各自成池', () => {
    expect(poolOf(FloraKind.Bush, 0, true)).toBe('bushNear')
    expect(poolOf(FloraKind.Bush, 0, false)).toBe('bushPoint')
    expect(poolOf(FloraKind.Bush, 2, false)).toBe('bushPoint')
    expect(poolOf(FloraKind.House, 1, false)).toBe('house')
    expect(poolOf(FloraKind.Barn, 1, false)).toBe('barn')
    expect(poolOf(FloraKind.Church, 1, false)).toBe('church')
  })
})

/** 池的名字，與 `object.children` 同序。標髒那一條用它報名字 */
const POOLS: readonly PoolName[] = [
  'broadNear', 'coneNear', 'broadMid', 'coneMid',
  'broadPoint', 'conePoint', 'bushNear', 'bushPoint',
  'house', 'barn', 'church',
]

/** 大到不可能截斷的容量。掃描與變異驗證用 */
const SENTINEL = Object.fromEntries(
  POOLS.map((n) => [n, 400000]),
) as Record<PoolName, number>

/** 兩張圖各自掃到的最大值，給容量那兩條用 */
let SCANNED: Record<string, number> = {}
let ISLAND_SCANNED: Record<string, number> = {}

describe('植被引擎', () => {
  it('十一個池，十一個 draw call；遠處那三個是點', () => {
    const v = createVegetation([EMPTY], FLAT)
    expect(v.object.children.length).toBe(POOLS.length)
    const kinds = meshes(v).map((m, i) => [POOLS[i], m instanceof Points])
    expect(kinds).toEqual(POOLS.map((n) => [n, POINT_POOLS.includes(n)]))
    v.dispose()
  })

  /**
   * 【點必須是另一顆材質】把 `onBeforeCompile` 掛在共用材質上，近樹、樹冠、
   * 灌木、建築會**全部**變成點 —— 而幾何、池對應、
   * 容量、GLSL 編譯測試仍然可以全綠。
   *
   * 【而且不能開 flatShading】那會讓 fragment shader 由螢幕導數自己算面法線，
   * 幾何裡設的 (0, 1, 0) 完全被忽略，亮度就會隨鏡頭方位變。
   */
  it('點池走另一顆材質，而且三個池共用它', () => {
    const v = createVegetation([EMPTY], FLAT)
    const ms = meshes(v)
    const mats = new Map<PoolName, MeshStandardMaterial>()
    for (let i = 0; i < ms.length; i++) {
      mats.set(POOLS[i]!, ms[i]!.material as MeshStandardMaterial)
    }
    const point = mats.get('broadPoint')!
    expect(mats.get('conePoint')).toBe(point)
    expect(mats.get('bushPoint')).toBe(point)
    for (const n of POOLS) {
      if (POINT_POOLS.includes(n)) continue
      // 【掛錯材質會讓近樹全部變成點】而幾何、池對應、容量、GLSL 編譯
      // 那幾條測試仍然可以全綠
      expect([n, mats.get(n) === point]).toEqual([n, false])
      expect([n, mats.get(n)!.flatShading]).toEqual([n, true])
    }
    v.dispose()
  })

  /**
   * 【為什麼關剔除】`Frustum.intersectsObject` 對 `InstancedMesh` 走
   * `object.boundingSphere`，而那顆球**只在是 null 時算一次就快取**。池每次
   * 重建實例全換，球就過期了 —— 症狀是某些朝向下整批樹消失。而池是跟著
   * 鏡頭的 4 km 圓環，那顆球恆與視錐相交，剔除本來就一次也不會生效。
   */
  it('每個池都關了視錐剔除', () => {
    const v = createVegetation([EMPTY], FLAT)
    for (const m of meshes(v)) expect(m.frustumCulled).toBe(false)
    v.dispose()
  })

  /** 【沒開 vertexColors 的話 USE_COLOR 不定義】樹幹會跟樹冠同色 */
  it('材質開了 vertexColors', () => {
    const v = createVegetation([EMPTY], FLAT)
    for (const m of meshes(v)) {
      expect((m.material as MeshStandardMaterial).vertexColors).toBe(true)
    }
    v.dispose()
  })

  it('每幀最多生 TILES_PER_FRAME 格', () => {
    let calls = 0
    const counted: FloraSource = (...a) => { calls++; SIX(...a) }
    const v = createVegetation([counted], FLAT)
    v.update(0, 0)
    expect(calls).toBe(TILES_PER_FRAME)
    v.update(0, 0)
    expect(calls).toBe(TILES_PER_FRAME * 2)
    v.dispose()
  })

  it('settle 一次排乾，之後 update 不再生任何 tile', () => {
    let calls = 0
    const counted: FloraSource = (...a) => { calls++; SIX(...a) }
    const v = createVegetation([counted], FLAT)
    v.settle()
    const after = calls
    // 圈內的格數約 π R² / T²
    expect(after).toBeGreaterThan(150)
    v.update(0, 0)
    expect(calls).toBe(after)
    v.dispose()
  })

  /**
   * 【快取要真的命中】圈心一動，圈的邊緣本來就會換進換出幾格；重點是**已經
   * 在圈內的那兩百格不重生**。整批重生的話這裡會是 200 以上。
   */
  it('鏡頭移動小於一格時，只有圈緣的幾格要補', () => {
    let calls = 0
    const counted: FloraSource = (...a) => { calls++; SIX(...a) }
    const v = createVegetation([counted], FLAT)
    v.settle()
    const after = calls
    v.update(TILE_SIZE * 0.4, 0)
    v.settle()
    v.update(0, TILE_SIZE * 0.4)
    v.settle()
    console.log(JSON.stringify({ 一開始: after, 兩次小移動之後多生: calls - after }))
    // 【判準跟著圈的周長走】6 km 圈的周長是 3 km 圈的兩倍
    expect(calls - after).toBeLessThan(v.stats.tiles * 0.05)
    v.dispose()
  })

  it('移動一整格會補上新的一欄，而且舊的被釋放', () => {
    let calls = 0
    const counted: FloraSource = (...a) => { calls++; SIX(...a) }
    const v = createVegetation([counted], FLAT)
    v.settle()
    const before = calls
    const live = v.stats.tiles
    v.update(TILE_SIZE * 3, 0)
    v.settle()
    expect(calls).toBeGreaterThan(before)
    // 圈的大小不變 —— 補進來幾格就要放掉幾格
    expect(Math.abs(v.stats.tiles - live)).toBeLessThan(20)
    v.dispose()
  })

  /**
   * 【只測純函式不夠】`lodFor` 對而引擎永遠塞 L0 的話，上面那兩條照樣綠。
   * 這一條看的是池裡的數量真的隨鏡頭搬家。
   */
  it('引擎真的用了 LOD：池的數量隨鏡頭遷移', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    const near = { ...v.counts }
    // 把鏡頭推遠：原本近處那一圈變成中距離、再變成遠距離
    v.update(FLORA_RADIUS * 0.8, 0)
    v.settle()
    const far = { ...v.counts }
    console.log(JSON.stringify({ near, far }))
    expect(near.broadNear).toBeGreaterThan(0)
    expect(near.bushNear).toBeGreaterThan(0)
    expect(near.broadPoint).toBeGreaterThan(near.broadNear)
    // 每一格都生六筆，所以三級的總數守恆
    const sum = (c: Record<PoolName, number>): number =>
      c.broadNear + c.coneNear + c.broadMid + c.coneMid + c.broadPoint + c.conePoint
    expect(sum(far)).toBeGreaterThan(sum(near) * 0.95)
    expect(sum(far)).toBeLessThan(sum(near) * 1.05)
    v.dispose()
  })

  /**
   * 【`BUSH_RANGE` 現在是「近級」的門檻，不是視距】圈內每一格都有灌木，
   * 只是 1.2 km 之外換成點。
   */
  it('灌木在 BUSH_RANGE 之內是八面體，之外是點', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    const near = (Math.PI * BUSH_RANGE * BUSH_RANGE) / (TILE_SIZE * TILE_SIZE)
    expect(v.counts.bushNear).toBeGreaterThan(near * 0.6)
    expect(v.counts.bushNear).toBeLessThan(near * 1.6)
    // 【畫得到的格一叢都不能漏】每格一叢，所以兩級加起來就是 lod < 3 的格數。
    // 分母不是 `stats.tiles`：外圈是抖開的，`outer` 到 `FLORA_RADIUS` 之間的
    // 格子仍然在快取裡但整格不畫 —— 見 `OUTER_JITTER`
    const drawn = v.debugTiles().filter((t) => t.lod < 3).length
    expect(v.counts.bushNear + v.counts.bushPoint).toBe(drawn)
    expect(drawn).toBeLessThan(v.stats.tiles)
    v.dispose()
  })

  /**
   * 【建築不分級】一座 18 tri、圈內實測最多 18 座，分級沒有意義。
   * 樹則會隨距離換級 —— 這一條同時證明兩件事。
   */
  it('建築不分級，而樹會；出了圈兩者都不畫', () => {
    const v = createVegetation([ONE], FLAT)
    for (const [dist, house, broad] of [
      [100, 1, 1], [800, 1, 1], [1500, 1, 0], [7000, 0, 0],
    ] as const) {
      v.update(dist, 0)
      v.settle()
      expect([dist, v.counts.house]).toEqual([dist, house])
      expect([dist, v.counts.broadNear]).toEqual([dist, broad])
    }
    // 【三級各換一次】1,500 m 是樹冠，4,000 m 是點
    v.update(1500, 0)
    v.settle()
    expect([v.counts.broadMid, v.counts.broadPoint]).toEqual([1, 0])
    v.update(4000, 0)
    v.settle()
    expect([v.counts.broadMid, v.counts.broadPoint]).toEqual([0, 1])
    v.dispose()
  })

  /**
   * 【冷啟動不得空白】6 km 圈有 1,812 格。在「這一幀有生新格」時禁止重建
   * 的話，開場與傳送之後植被要等整圈補完才會出現，60 fps 下是好幾秒的
   * 空白。
   *
   * 【一定要不呼叫 settle】`settle` 會一次排乾再強制重建，把這個缺陷整個
   * 藏起來 —— 而其他測試幾乎都呼叫它。
   */
  it('冷啟動：整圈還沒補完就已經在畫', () => {
    const v = createVegetation([SIX], FLAT)
    let first = -1
    for (let k = 0; k < 40; k++) {
      v.update(0, 0)
      if (first < 0 && v.counts.bushNear > 0) first = k + 1
    }
    console.log(JSON.stringify({ 第幾幀開始有東西: first, 那時的格數: v.stats.tiles }))
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThan(REBUILD_EVERY * 3)
    // 【而且那時整圈還沒補完】不然這一條只是在測 settle
    const full = (Math.PI * FLORA_RADIUS * FLORA_RADIUS) / (TILE_SIZE * TILE_SIZE)
    expect(v.stats.tiles).toBeLessThan(full * 0.6)
    v.dispose()
  })

  /** 【不得靜默截斷】池滿了要回報，不是安靜地少畫一半 */
  it('池滿了會回報溢位', () => {
    // SIX 每一格都生一棟房子，遠超過實戰的容量（實測圈內最多 18 棟）
    const v = createVegetation([SIX], FLAT)
    v.settle()
    expect(v.stats.tiles).toBeGreaterThan(150)
    expect(v.stats.overflow).toBeGreaterThan(0)
    expect(v.counts.house).toBeLessThan(v.stats.tiles)
    v.dispose()
  })

  /** 【tile 集合沒變但鏡頭跨過門檻】池一樣要重建，不然級數是舊的 */
  /**
   * 【走 update 而不是 settle】池只在「這一幀沒有新格要生」時重建，所以
   * 級數變了但格沒變的那一幀也必須重建 —— 不然級數會停在舊的。
   */
  it('只靠 update（不 settle）也會把級數的變化畫出來', () => {
    const v = createVegetation([ONE], FLAT)
    v.settle()
    expect([v.counts.broadNear, v.counts.broadMid]).toEqual([1, 0])
    // 【級數看的是格心不是那棵樹】樹在 (5, 5)，它那一格的格心在 (125, 125)。
    // 鏡頭放 1,200 時格心距離 1,082 m，過了 LOD_NEAR + 遲滯。
    // 每幀四格，補完新的一圈再重建要一百幀有餘
    for (let k = 0; k < 400; k++) v.update(1200, 0)
    expect([v.counts.broadNear, v.counts.broadMid]).toEqual([0, 1])
    v.dispose()
  })

  /**
   * 【重建要節流】級數是逐 tile 決定的，而兩條 LOD 環上約有 90 格 —— 鏡頭
   * 每移動 250 m 那些格就各換級一次，換算下來幾乎每一幀都有一格換級。
   * 「有變就重建」等於每幀重寫一萬八千筆實例再上傳 1.4 MB，而實測那正是
   * 1% low 由 55 ms 掉到 95 ms 的原因。
   */
  it('連續移動時重建有節流，不是每幀一次', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    const before = v.stats.rebuilds
    const N = 120
    for (let k = 0; k < N; k++) v.update(k * 3, 0)
    const times = v.stats.rebuilds - before
    console.log(JSON.stringify({ 幀數: N, 移動: N * 3 + ' m', 重建次數: times }))
    expect(times).toBeGreaterThan(0)
    // 【閘是距離不是幀數】移動 360 m、每 REBUILD_MOVE 公尺一次
    expect(times).toBeLessThanOrEqual(Math.ceil((N * 3) / REBUILD_MOVE) + 1)
    expect(times).toBeLessThanOrEqual(Math.ceil(N / REBUILD_EVERY))
    v.dispose()
  })

  it('傳送：移動超過半徑會把還沒生的丟掉重排', () => {
    let calls = 0
    const counted: FloraSource = (...a) => { calls++; SIX(...a) }
    const v = createVegetation([counted], FLAT)
    v.update(0, 0)
    const before = calls
    v.update(FLORA_RADIUS * 4, FLORA_RADIUS * 4)
    v.settle()
    expect(calls).toBeGreaterThan(before)
    // 【圈的大小必須對得上 FLORA_RADIUS】π R² / T² = 1,810。
    // `TILE_CACHE` 忘了跟著放大的話會卡在快取大小，這一條就紅
    const want = (Math.PI * FLORA_RADIUS * FLORA_RADIUS) / (TILE_SIZE * TILE_SIZE)
    expect(v.stats.tiles).toBeGreaterThan(want * 0.98)
    expect(v.stats.tiles).toBeLessThan(want * 1.02)
    v.dispose()
  })

  it('重建之後兩個屬性都標了 needsUpdate', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    for (const m of meshes(v)) {
      if (poolCount(m) === 0) continue
      // 【比 version 不是比 needsUpdate】`needsUpdate` 在 three 只有 setter
      // 沒有 getter，讀出來恆是 undefined。它做的事是把 version 加一
      for (const a of poolAttrs(m)) expect(a.version).toBeGreaterThan(0)
    }
    v.dispose()
  })

  /**
   * 【只比 instanceMatrix.array 不夠】每幀新建 Array、Set、字串 tile key、
   * 暫存 Matrix4 都會讓那一條綠。這裡逐一比對所有預配結構的身分。
   */
  it('暖機後 update 不再配置', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    // 【先把緩衝池的峰值跑出來】懶配的池會長到「同時非空的格數」的高水位，
    // 而那個數字在移動時會上下 —— 沒跑過峰值就 snapshot 的話，量到的是
    // 「還在爬」而不是「在漏」
    for (let i = 0; i < 60; i++) { v.update(i * 3, i * 2); v.settle() }
    const ms = meshes(v)
    const bufs = v.stats.buffers.slice()
    // 【實例屬性是輪流換的，所以比的是「只有那兩份」】比身分相等會在偶數次
    // 交換之後偶然通過 —— 每一幀新配一份的話這裡會長到幾百
    const seenMat = ms.map(() => new Set<object>())
    const seenCol = ms.map(() => new Set<object>())
    for (let i = 0; i < 600; i++) {
      v.update(i * 3, i * 2)
      for (let k = 0; k < ms.length; k++) {
        const a = poolAttrs(ms[k]!)
        seenMat[k]!.add(a[0]!.array)
        seenCol[k]!.add(a[1]!.array)
      }
    }
    for (let k = 0; k < ms.length; k++) {
      expect([POOLS[k], seenMat[k]!.size]).toEqual([POOLS[k], 2])
      expect([POOLS[k], seenCol[k]!.size]).toEqual([POOLS[k], 2])
    }
    // 【tile 的緩衝只重用不增長】它是懶配的：一格生出 0 株就把緩衝還回池裡。
    // 圈是圓的，移動時同時非空的格數會小幅上下 —— 所以先跑過峰值再比，
    // 而且身分也要比：長度一樣但整批換掉的話，代表配了新的又丟了舊的
    expect(v.stats.buffers.length).toBe(bufs.length)
    expect(v.stats.buffers.slice(0, bufs.length)).toEqual(bufs)
    // 【tile 的鍵必須是數值】字串鍵每幀都在配置
    expect(v.stats.keyType).toBe('number')
    v.dispose()
  })

  /**
   * 【逐池標髒的正確性】重建只碰標了髒的池 —— 沒標到的池連寫都不寫，
   * 掛著的還是上一份屬性。所以標漏了的症狀是**畫面上留著舊的那一份**。
   *
   * 【標準答案是「同一份引擎強制全部重建」，不是「就地重生一份」】級數有
   * 遲滯，所以逐格的級數是路徑相依的 —— 在終點直接長出來的那一份與飛過去的
   * 那一份本來就不一樣（實測 broadNear 44 對 36），拿它當標準答案會冤枉人。
   *
   * 這一條對「relevel 不標灌木」會紅。
   */
  it('飛過一段之後，每一個池的內容都已經是最新的', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    for (let k = 1; k <= 600; k++) v.update((k / 600) * 3000, 0)
    v.settle()
    const ms = meshes(v)
    const snap = ms.map((m) => ({
      count: poolCount(m),
      buf: (poolAttrs(m)[0]!.array as Float32Array)
        .slice(0, poolCount(m) * poolStride(m)),
    }))
    // 【強制全部重建】標漏了的池，這一下之後內容會變
    v.settle(true)
    for (let i = 0; i < ms.length; i++) {
      const m = ms[i]!
      const s0 = snap[i]!
      const now = (poolAttrs(m)[0]!.array as Float32Array)
        .slice(0, poolCount(m) * poolStride(m))
      expect([POOLS[i], poolCount(m)]).toEqual([POOLS[i], s0.count])
      expect([POOLS[i], [...now]]).toEqual([POOLS[i], [...s0.buf]])
    }
    v.dispose()
  }, 120000)

  it('空的來源不會產生任何實例，也不會崩', () => {
    const v = createVegetation([EMPTY], FLAT)
    v.settle()
    for (const m of meshes(v)) expect(poolCount(m)).toBe(0)
    expect(v.stats.dropped).toBe(0)
    v.dispose()
  })


  /**
   * 【為什麼要抖】`FLORA_RADIUS` 是一個精確的圓，掃過地面時整排樹一起出現
   * —— 試飛回報的「突然長出來」有一半是它。逐格把有效半徑往內抖，那一環就
   * 變成一條毛毛的帶。
   *
   * 【只往內不往外】往外會越過 tile 快取的維持半徑，那一格根本沒生成，
   * 症狀是圈緣閃爍。
   */
  it('外圈是一條帶不是一個圓', () => {
    const v = createVegetation([SIX], FLAT)
    v.update(0, 0)
    v.settle(true)
    let drawnMax = 0
    let blankMin = Infinity
    for (const t of v.debugTiles()) {
      const cx = t.i * TILE_SIZE + TILE_SIZE / 2
      const cz = t.j * TILE_SIZE + TILE_SIZE / 2
      const d = Math.hypot(cx, cz)
      if (t.lod < 3) drawnMax = Math.max(drawnMax, d)
      else blankMin = Math.min(blankMin, d)
    }
    console.log(JSON.stringify({
      最遠還在畫: drawnMax.toFixed(0), 最近已經不畫: blankMin.toFixed(0),
      帶寬: (drawnMax - blankMin).toFixed(0),
    }))
    // 沒有抖動的話這兩個數字會相鄰（差不到一格），帶寬是負的或接近 0
    expect(drawnMax - blankMin).toBeGreaterThan(FLORA_RADIUS * 0.1)
    // 而且不得抖到圈外
    expect(drawnMax).toBeLessThanOrEqual(FLORA_RADIUS)
  })


  /**
   * 【為什麼要懶配】群島 6 km 圈有 1,815 格，而只有 485 格真的長東西 ——
   * 其餘全是海。全部預配的話八成的記憶體是空水格佔的位子，而半徑推遠時
   * 那個浪費是平方成長的。
   */
  it('空格不佔緩衝', () => {
    const { field, islands } = createArchipelago()
    const v = createVegetation(
      [createIslandFlora(field, islands)], (x, z) => field.sample(x, z),
      {
        capacity: SENTINEL, maxPerTile: ISLAND_MAX_PER_TILE,
        radius: ISLAND_RADIUS, tilesPerFrame: ISLAND_TILES_PER_FRAME,
      },
    )
    v.update(0, 0)
    v.settle(true)
    console.log(JSON.stringify({
      格數: v.stats.tiles, 配出去的緩衝: v.stats.buffers.length,
    }))
    expect(v.stats.tiles).toBeGreaterThan(1000)
    expect(v.stats.buffers.length).toBeGreaterThan(0)
    expect(v.stats.buffers.length).toBeLessThan(v.stats.tiles * 0.5)
    v.dispose()
  })

  /**
   * 【空格一定要繼續佔槽位】不佔的話每一幀都會重生一次那一格 —— 而群島的
   * 圈裡九成是空格。
   */
  it('空格不會每幀重生', () => {
    const v = createVegetation([ONE], FLAT)
    v.update(0, 0)
    v.settle(true)
    const first = v.stats.generated
    expect(first).toBeGreaterThan(1000)
    for (let k = 0; k < 10; k++) v.update(0, 0)
    expect(v.stats.generated).toBe(first)
    v.dispose()
  })


  /**
   * 【為什麼量掃描次數而不是時間】時間在 CI 上不穩，而「看了幾個候選格」是
   * 決定性的 —— 直接數。
   *
   * `fill` 每生一格就重掃一次整個包圍方陣挑最近的空格的話：6 km 是
   * 49² × 16 = 3.8 萬次，12 km、每幀 61 格會變成 57 萬次。
   */
  it('補格的候選掃描是每幀一趟，不是每格一趟', () => {
    const v = createVegetation([SIX], FLAT)
    v.update(0, 0)
    const cold = v.stats.scanned
    // 【穩態才是成本所在】冷啟動第一幀圈是空的，前幾個候選就都能用；
    // 補滿之後要走過整條環才找得到缺口
    v.settle(true)
    const before = v.stats.scanned
    v.update(TILE_SIZE * 2, 0)
    const warm = v.stats.scanned - before
    console.log(JSON.stringify({ 格數: v.stats.tiles, 冷啟動一幀: cold, 穩態一幀: warm }))
    expect(v.stats.tiles).toBeGreaterThan(1000)
    // 一趟的上限是環的長度；每格一趟的話是它的 TILES_PER_FRAME 倍
    expect(cold).toBeLessThan(3000)
    expect(warm).toBeLessThan(3000)
    v.dispose()
  })

  /** 【換掉挑格的順序不得換掉挑出來的集合】圈仍然由 `inRange` 決定 */
  it('補出來的格子全部在半徑之內', () => {
    const v = createVegetation([SIX], FLAT)
    v.update(0, 0)
    v.settle(true)
    let worst = 0
    for (const t of v.debugTiles()) {
      const cx = t.i * TILE_SIZE + TILE_SIZE / 2
      const cz = t.j * TILE_SIZE + TILE_SIZE / 2
      worst = Math.max(worst, Math.hypot(cx, cz))
    }
    expect(worst).toBeLessThanOrEqual(FLORA_RADIUS)
    // 【不得漏格】圈內的格數與面積對得起來
    const expected = (Math.PI * FLORA_RADIUS * FLORA_RADIUS) / (TILE_SIZE * TILE_SIZE)
    expect(v.stats.tiles).toBeGreaterThan(expected * 0.95)
    v.dispose()
  })

  it('dispose 之後幾何與兩顆材質都被釋放，各只釋放一次', () => {
    const v = createVegetation([SIX], FLAT)
    let geos = 0
    const mats = new Map<MeshStandardMaterial, number>()
    for (const m of meshes(v)) {
      m.geometry.addEventListener('dispose', () => geos++)
      const mat = m.material as MeshStandardMaterial
      // 【每顆材質只掛一次監聽】共用的那顆掛八次的話一次 dispose 會數到八
      if (!mats.has(mat)) {
        mats.set(mat, 0)
        mat.addEventListener('dispose', () => mats.set(mat, mats.get(mat)! + 1))
      }
    }
    expect(mats.size).toBe(2)
    v.dispose()
    expect(geos).toBe(POOLS.length)
    expect([...mats.values()]).toEqual([1, 1])
  })

  /**
   * 【容量掃描】每個位置都要先 `settle()` —— 不 settle 的話量到的是殘缺的
   * 池，最大值被嚴重低估，而定出來的容量在實飛時會截掉整片植被。
   *
   * 路線刻意穿過整張圖，涵蓋樹林最密的地方。
   */
  it('沿一條穿過全圖的航線掃描，池與 tile 都不溢位', () => {
    // 【哨兵容量】正式容量會截斷 counts，拿它去掃是循環量測
    const v = createVegetation(
      [farmHedgeFlora, farmWoodFlora, farmVillageFlora], FLAT, { capacity: SENTINEL },
    )
    const max: Record<string, number> = {}
    const N = 40
    for (let k = 0; k < N; k++) {
      const t = k / (N - 1)
      v.update(-13000 + t * 26000, -11000 + t * 22000)
      v.settle()
      for (const [name, n] of Object.entries(v.counts)) {
        max[name] = Math.max(max[name] ?? 0, n)
      }
      expect(v.stats.dropped).toBe(0)
      expect(v.stats.overflow).toBe(0)
    }
    console.log(JSON.stringify({ 各池的最大同時實例數: max }))
    SCANNED = max
    // 【掃描本身不得是空操作】
    expect(max['broadPoint']!).toBeGreaterThan(2000)
    expect(max['bushPoint']!).toBeGreaterThan(2000)
    expect(max['bushNear']!).toBeGreaterThan(500)
    expect(max['house']!).toBeGreaterThan(5)
    v.dispose()
  }, 120000)

  /**
   * 【×1.35 那條規則要有東西守著】掃描印出最大值、人再乘 1.35 寫進
   * `CAPACITY` —— 中間沒有斷言的話，寫錯一位數也不會有人知道。
   *
   * 這一條把每一池的容量壓到實測最大之下，跑同一條航線，要求它**必須**溢位。
   * 溢位不了就表示那一池的容量與實際需求根本沒有關係。
   */
  /**
   * 【群島也要掃】池是兩張圖共用的，而島上的針葉林比農地密一個量級。
   * 只掃農地的話，容量對群島是不夠的 —— 而那個症狀是實飛時整片島禿掉。
   *
   * 【鏡頭放在島心，不走直線】群島大部分是水。一條穿越全圖的直線量到的近級
   * 峰值是 220，而逐島島心量到的是 7,574 —— 三十四倍。近級的最壞情況只在
   * 島上發生，抽樣抽不到島就等於沒掃。
   */
  it('每一座島的島心都掃一次，池與 tile 都不溢位', () => {
    const { field, islands } = createArchipelago()
    const v = createVegetation(
      [createIslandFlora(field, islands)], (x, z) => field.sample(x, z),
      {
        capacity: SENTINEL, maxPerTile: ISLAND_MAX_PER_TILE,
        radius: ISLAND_RADIUS, tilesPerFrame: ISLAND_TILES_PER_FRAME,
      },
    )
    const max: Record<string, number> = {}
    for (const isl of islands) {
      v.update(isl.cx, isl.cz)
      v.settle()
      for (const [name, n] of Object.entries(v.counts)) {
        max[name] = Math.max(max[name] ?? 0, n)
      }
      expect(v.stats.dropped).toBe(0)
      expect(v.stats.overflow).toBe(0)
    }
    console.log(JSON.stringify({ 群島各池的最大同時實例數: max }))
    ISLAND_SCANNED = max
    expect(max['conePoint']!).toBeGreaterThan(10000)
    // 【近級不得是零星幾棵】島心正下方是最密的地方
    expect(max['coneNear']!).toBeGreaterThan(3000)
    v.dispose()
  }, 300000)

  /**
   * 【正面斷言容量夠】只有「哨兵掃峰值」加「壓到峰值以下必溢位」的話，
   * 把正式容量寫成 1 仍然全綠 —— 前者不看正式容量，後者要的正是溢位。
   */
  it('正式容量逐池都在實測峰值的 1.35 倍以上（兩張圖各自比）', () => {
    expect(Object.keys(SCANNED).length).toBe(POOLS.length)
    expect(Object.keys(ISLAND_SCANNED).length).toBe(POOLS.length)
    for (const [label, peaks, opts] of [
      ['農地', SCANNED, {}],
      ['群島', ISLAND_SCANNED, { capacity: ISLAND_CAPACITY }],
    ] as const) {
      const v = createVegetation([EMPTY], FLAT, opts)
      const ms = meshes(v)
      for (let i = 0; i < ms.length; i++) {
        const name = POOLS[i]!
        const want = Math.ceil(peaks[name]! * 1.35)
        expect([label, name, poolCapacity(ms[i]!) >= want]).toEqual([label, name, true])
      }
      v.dispose()
    }
  })

  it('每一池的容量都真的頂著需求：壓到實測最大之下必定溢位', () => {
    expect(Object.keys(SCANNED).length).toBe(POOLS.length)
    for (const [name, peak] of Object.entries(SCANNED)) {
      // 【只壓這一池】其他池維持哨兵，才知道溢位是誰造成的
      const v = createVegetation(
        [farmHedgeFlora, farmWoodFlora, farmVillageFlora], FLAT,
        { capacity: { ...SENTINEL, [name]: Math.max(0, peak - 1) } },
      )
      let over = 0
      const N = 40
      for (let k = 0; k < N; k++) {
        const t = k / (N - 1)
        v.update(-13000 + t * 26000, -11000 + t * 22000)
        v.settle()
        over += v.stats.overflow
      }
      expect([name, over > 0]).toEqual([name, true])
      v.dispose()
    }
  }, 600000)

  it('單一 tile 的容量夠裝最密的樹林', () => {
    const buf = createFloraBuffer(4096)
    let worst = 0
    for (let z = -6000; z < 6000; z += TILE_SIZE) {
      for (let x = -6000; x < 6000; x += TILE_SIZE) {
        buf.count = 0
        buf.dropped = 0
        farmHedgeFlora(x, z, x + TILE_SIZE, z + TILE_SIZE, FLAT, buf)
        farmWoodFlora(x, z, x + TILE_SIZE, z + TILE_SIZE, FLAT, buf)
        farmVillageFlora(x, z, x + TILE_SIZE, z + TILE_SIZE, FLAT, buf)
        expect(buf.dropped).toBe(0)
        worst = Math.max(worst, buf.count)
      }
    }
    console.log(JSON.stringify({ 單格最多: worst }))
    expect(worst).toBeGreaterThan(100)
  }, 120000)
})
