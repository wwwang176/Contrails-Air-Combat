import { describe, it, expect } from 'vitest'
import { InstancedMesh, MeshStandardMaterial } from 'three'
import {
  createVegetation, lodFor, poolOf, BUSH_RANGE, FLORA_RADIUS, LOD_HYSTERESIS,
  LOD_NEAR, REBUILD_EVERY, REBUILD_MOVE, TILES_PER_FRAME, TILE_SIZE,
  type PoolName,
} from '../../src/render/vegetation'
import {
  createFloraBuffer, farmHedgeFlora, farmVillageFlora, farmWoodFlora,
  pushFlora, FloraKind, type FloraSource,
} from '../../src/render/flora'

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

function meshes(v: { object: { children: unknown[] } }): InstancedMesh[] {
  return v.object.children as InstancedMesh[]
}

describe('lodFor', () => {
  it('沒有前一級時，級數隨距離單調不減', () => {
    let prev = -1
    for (let d = 0; d < 4000; d += 5) {
      const lod = lodFor(d, -1)
      expect(lod).toBeGreaterThanOrEqual(prev)
      prev = lod
    }
    expect(lodFor(0, -1)).toBe(0)
    expect(lodFor(LOD_NEAR + 1, -1)).toBe(1)
    expect(lodFor(FLORA_RADIUS + 1, -1)).toBe(2)
  })

  /** 【遲滯】沒有它的話，鏡頭停在門檻上時整格 tile 每幀換級 */
  it('遲滯：在門檻上來回不會每次換級', () => {
    expect(lodFor(LOD_NEAR + 10, 0)).toBe(0)
    expect(lodFor(LOD_NEAR + 10, 1)).toBe(1)
    expect(lodFor(LOD_NEAR + LOD_HYSTERESIS + 1, 0)).toBe(1)
    expect(lodFor(LOD_NEAR - LOD_HYSTERESIS - 1, 1)).toBe(0)
  })

  it('跨好幾級的跳躍一次到位', () => {
    expect(lodFor(FLORA_RADIUS * 2, 0)).toBe(2)
    expect(lodFor(10, 2)).toBe(0)
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
  it('換級不換樹種，而且近遠沒有對調', () => {
    expect(poolOf(FloraKind.BroadTree, 0, false)).toBe('broadNear')
    expect(poolOf(FloraKind.BroadTree, 1, false)).toBe('broadFar')
    expect(poolOf(FloraKind.ConeTree, 0, false)).toBe('coneNear')
    expect(poolOf(FloraKind.ConeTree, 1, false)).toBe('coneFar')
  })

  it('圈外那一級什麼都不畫', () => {
    for (const k of [FloraKind.BroadTree, FloraKind.ConeTree, FloraKind.Bush]) {
      expect(poolOf(k, 2, true)).toBeNull()
    }
  })

  it('灌木只由 bush 旗標決定，建築三種各自成池', () => {
    expect(poolOf(FloraKind.Bush, 0, true)).toBe('bush')
    expect(poolOf(FloraKind.Bush, 0, false)).toBeNull()
    expect(poolOf(FloraKind.House, 1, false)).toBe('house')
    expect(poolOf(FloraKind.Barn, 1, false)).toBe('barn')
    expect(poolOf(FloraKind.Church, 1, false)).toBe('church')
  })
})

/** 大到不可能截斷的容量。掃描與變異驗證用 */
const SENTINEL: Record<PoolName, number> = {
  broadNear: 100000, coneNear: 100000, broadFar: 100000, coneFar: 100000,
  bush: 100000, house: 100000, barn: 100000, church: 100000,
}

/** 上面那條掃描量到的最大值，給變異驗證那一條用 */
let SCANNED: Record<string, number> = {}

describe('植被引擎', () => {
  it('八個池，八個 draw call', () => {
    const v = createVegetation([EMPTY], FLAT)
    expect(v.object.children.length).toBe(8)
    for (const m of meshes(v)) expect(m).toBeInstanceOf(InstancedMesh)
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
    expect(calls - after).toBeLessThan(40)
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
    expect(near.bush).toBeGreaterThan(0)
    expect(near.broadFar).toBeGreaterThan(near.broadNear)
    // 每一格都生六筆，所以兩級的總數守恆
    const sum = (c: Record<PoolName, number>): number =>
      c.broadNear + c.coneNear + c.broadFar + c.coneFar
    expect(sum(far)).toBeGreaterThan(sum(near) * 0.95)
    expect(sum(far)).toBeLessThan(sum(near) * 1.05)
    v.dispose()
  })

  it('灌木只出現在 BUSH_RANGE 之內', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    // 每格一叢，圈內半徑 BUSH_RANGE 的格數約 π r² / T²
    const want = (Math.PI * BUSH_RANGE * BUSH_RANGE) / (TILE_SIZE * TILE_SIZE)
    expect(v.counts.bush).toBeGreaterThan(want * 0.6)
    expect(v.counts.bush).toBeLessThan(want * 1.6)
    v.dispose()
  })

  /**
   * 【建築不分級】一座 18 tri、圈內實測最多 18 座，分級沒有意義。
   * 樹則會隨距離換級 —— 這一條同時證明兩件事。
   */
  it('建築不分級，而樹會；出了圈兩者都不畫', () => {
    const v = createVegetation([ONE], FLAT)
    for (const [dist, house, broad] of [
      [100, 1, 1], [800, 1, 1], [1500, 1, 0], [3500, 0, 0],
    ] as const) {
      v.update(dist, 0)
      v.settle()
      expect([dist, v.counts.house]).toEqual([dist, house])
      expect([dist, v.counts.broadNear]).toEqual([dist, broad])
    }
    // 1,500 m 的那棵樹沒有消失，只是換了級
    v.update(1500, 0)
    v.settle()
    expect(v.counts.broadFar).toBe(1)
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
    expect([v.counts.broadNear, v.counts.broadFar]).toEqual([1, 0])
    // 【級數看的是格心不是那棵樹】樹在 (5, 5)，它那一格的格心在 (125, 125)。
    // 鏡頭放 1,200 時格心距離 1,082 m，過了 LOD_NEAR + 遲滯。
    // 每幀四格，補完新的一圈再重建要一百幀有餘
    for (let k = 0; k < 160; k++) v.update(1200, 0)
    expect([v.counts.broadNear, v.counts.broadFar]).toEqual([0, 1])
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
    // 舊的一圈全部放掉了 —— 圈的大小仍然只有一圈
    expect(v.stats.tiles).toBeLessThan(600)
    v.dispose()
  })

  it('重建之後兩個屬性都標了 needsUpdate', () => {
    const v = createVegetation([SIX], FLAT)
    v.settle()
    for (const m of meshes(v)) {
      if (m.count === 0) continue
      // 【比 version 不是比 needsUpdate】`needsUpdate` 在 three 只有 setter
      // 沒有 getter，讀出來恆是 undefined。它做的事是把 version 加一
      expect(m.instanceMatrix.version).toBeGreaterThan(0)
      expect(m.instanceColor).not.toBeNull()
      expect(m.instanceColor!.version).toBeGreaterThan(0)
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
    const before = meshes(v).map((m) => [m.instanceMatrix.array, m.instanceColor?.array])
    const bufs = v.stats.buffers.slice()
    for (let i = 0; i < 600; i++) v.update(i * 3, i * 2)
    const after = meshes(v).map((m) => [m.instanceMatrix.array, m.instanceColor?.array])
    for (let i = 0; i < before.length; i++) {
      expect(after[i]![0]).toBe(before[i]![0])
      expect(after[i]![1]).toBe(before[i]![1])
    }
    // tile 的資料緩衝也是同一批
    expect(v.stats.buffers).toEqual(bufs)
    // 【tile 的鍵必須是數值】字串鍵每幀都在配置
    expect(v.stats.keyType).toBe('number')
    v.dispose()
  })

  it('空的來源不會產生任何實例，也不會崩', () => {
    const v = createVegetation([EMPTY], FLAT)
    v.settle()
    for (const m of meshes(v)) expect(m.count).toBe(0)
    expect(v.stats.dropped).toBe(0)
    v.dispose()
  })

  it('dispose 之後幾何與材質都被釋放，材質只釋放一次', () => {
    const v = createVegetation([SIX], FLAT)
    let geos = 0
    let mats = 0
    for (const m of meshes(v)) m.geometry.addEventListener('dispose', () => geos++)
    // 【材質只掛一次監聽】八個池共用同一顆，掛八次的話一次 dispose 會數到八
    ;(meshes(v)[0]!.material as MeshStandardMaterial)
      .addEventListener('dispose', () => mats++)
    v.dispose()
    expect(geos).toBe(8)
    expect(mats).toBe(1)
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
      [farmHedgeFlora, farmWoodFlora, farmVillageFlora], FLAT, SENTINEL,
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
    expect(max['broadFar']!).toBeGreaterThan(2000)
    expect(max['bush']!).toBeGreaterThan(500)
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
  it('每一池的容量都真的頂著需求：壓到實測最大之下必定溢位', () => {
    expect(Object.keys(SCANNED).length).toBe(8)
    for (const [name, peak] of Object.entries(SCANNED)) {
      // 【只壓這一池】其他池維持哨兵，才知道溢位是誰造成的
      const v = createVegetation(
        [farmHedgeFlora, farmWoodFlora, farmVillageFlora], FLAT,
        { ...SENTINEL, [name]: Math.max(0, peak - 1) },
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
