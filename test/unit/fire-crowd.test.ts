import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  FIRE_CROWD_RADIUS, FIRE_CROWD_RECALC, FIRE_CROWD_SMOOTH,
  createFireCrowd, updateFireCrowd,
} from '../../src/render/fireCrowd'
import { createGroundFires, lightGroundFire, stepGroundFires } from '../../src/render/groundFires'
import { FIRE_PUFF, createShipFires } from '../../src/render/shipFires'
import type { Ship } from '../../src/world/ships'

/**
 * # 擠在一起的火少冒一點煙
 *
 * 【這一支守的是什麼】密集轟炸時上百根煙柱完全重疊，半透明疊加是逐像素的
 * 成本。抑制算錯不會報錯：煙多一點少一點，畫面上看起來都「像那麼回事」，
 * 只有幀數會悄悄掉回去。所以鄰居數、曲線、平滑與復原都要有斷言。
 */

const DT = 1 / 60

/** 只用得到位置與姿態；其餘欄位這一層不碰 */
function ship(x: number, z: number): Ship {
  return {
    index: 0,
    position: new Vector3(x, 0, z),
    orientation: new Quaternion(),
  } as unknown as Ship
}

/** 推進到至少跑過一次重算 */
function settle(crowd: ReturnType<typeof createFireCrowd>, args: {
  ground: ReturnType<typeof createGroundFires>
  ships: readonly Ship[]
  shipFires: ReturnType<typeof createShipFires>
  seconds: number
}): void {
  for (let t = 0; t < args.seconds; t += DT) {
    updateFireCrowd(crowd, args.ground, args.shipFires, args.ships, DT)
  }
}

describe('鄰居數與曲線', () => {
  it('孤零零的一處火不受抑制', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    lightGroundFire(ground, 0, 0, 0)
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(crowd.groundTarget[0]).toBeCloseTo(1, 6)
  })

  /** 【√(1+N) 而不是 ÷(1+N)】除以 N 會讓整團的總煙量等於一處孤火 */
  it('兩處貼在一起 → 目標是 √2；四處 → √4', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    for (let i = 0; i < 2; i++) lightGroundFire(ground, i * 5, 0, 0)
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(crowd.groundTarget[0]).toBeCloseTo(Math.SQRT2, 5)

    const b = createGroundFires()
    const bc = createFireCrowd(b, shipFires)
    for (let i = 0; i < 4; i++) lightGroundFire(b, i * 5, 0, 0)
    settle(bc, { ground: b, ships: [], shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(bc.groundTarget[0]).toBeCloseTo(2, 5)
  })

  it('超出半徑就互不影響', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    lightGroundFire(ground, 0, 0, 0)
    lightGroundFire(ground, FIRE_CROWD_RADIUS + 1, 0, 0)
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(crowd.groundTarget[0]).toBeCloseTo(1, 6)
    expect(crowd.groundTarget[1]).toBeCloseTo(1, 6)
  })

  /**
   * 【只看水平距離】煙柱一律往上長，重不重疊只由水平距離決定。改成三維
   * 距離的話，同一艘船上高低差二十公尺的兩處火會被判成互不相鄰。
   */
  it('高度差不影響判定', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    lightGroundFire(ground, 0, 0, 0)
    lightGroundFire(ground, 0, 200, 0)
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(crowd.groundTarget[0]).toBeCloseTo(Math.SQRT2, 5)
  })
})

describe('船火', () => {
  /**
   * 【兩組合在一起算】同一艘船上的兩處火、岸邊的火與剛中彈的船，彼此都該
   * 互相抑制。分開算的話這些情形全部漏掉。
   */
  it('船火與地面火互相計入', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    const ships = [ship(1000, 0)]
    // 船火存的是艦體座標，換算後應該落在 (1000, 0)
    ;(shipFires.ship as Int32Array)[0] = 0
    ;(shipFires.x as Float32Array)[0] = 0
    ;(shipFires.y as Float32Array)[0] = 0
    ;(shipFires.z as Float32Array)[0] = 0
    lightGroundFire(ground, 1005, 0, 0)
    settle(crowd, { ground, ships, shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(crowd.shipTarget[0]).toBeCloseTo(Math.SQRT2, 5)
    expect(crowd.groundTarget[0]).toBeCloseTo(Math.SQRT2, 5)
  })

  /** 【艦體 → 世界】不換算的話，兩艘相距很遠的船上的火會被當成同一點 */
  it('用的是換算後的世界座標', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    const ships = [ship(0, 0)]
    ;(shipFires.ship as Int32Array)[0] = 0
    ;(shipFires.x as Float32Array)[0] = 0
    ;(shipFires.z as Float32Array)[0] = 0
    // 地面火在世界原點附近；船在 (0,0) 所以兩者相鄰
    lightGroundFire(ground, 5, 0, 0)
    settle(crowd, { ground, ships, shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(crowd.shipTarget[0]).toBeCloseTo(Math.SQRT2, 5)

    // 船開走之後就不再相鄰
    ships[0]!.position.set(5000, 0, 0)
    settle(crowd, { ground, ships, shipFires, seconds: FIRE_CROWD_RECALC + DT })
    expect(crowd.shipTarget[0]).toBeCloseTo(1, 6)
  })
})

describe('平滑與復原', () => {
  /** 【不能直接跳】鄰居燒完那一瞬間出煙量變回兩倍，畫面上是「噗」的一團 */
  it('現值不會在一步之內跳到目標', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    for (let i = 0; i < 4; i++) lightGroundFire(ground, i * 5, 0, 0)
    updateFireCrowd(crowd, ground, shipFires, [], DT)
    expect(crowd.groundTarget[0]).toBeCloseTo(2, 5)
    expect(crowd.ground[0]!).toBeLessThan(1.1)
    expect(crowd.ground[0]!).toBeGreaterThan(1)
  })

  it('經過時間常數之後才接近目標', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    for (let i = 0; i < 4; i++) lightGroundFire(ground, i * 5, 0, 0)
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_SMOOTH * 5 })
    expect(crowd.ground[0]!).toBeCloseTo(2, 1)
  })

  /** 【周圍的火消失，出煙量要回來】這是負責人點名的行為 */
  it('鄰居熄滅後因子回到 1', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    for (let i = 0; i < 4; i++) lightGroundFire(ground, i * 5, 0, 0)
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_SMOOTH * 5 })
    expect(crowd.ground[0]!).toBeGreaterThan(1.5)

    // 【為什麼等 8 個時間常數】收斂是指數的：5τ 只到剩 e⁻⁵ ≈ 0.7% 的差距，
    // 比這裡的容差還大。8τ 剩 0.03%，而復原真的壞掉時因子會停在 2
    for (let i = 1; i < 4; i++) ground.live[i] = 0
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_SMOOTH * 8 })
    expect(crowd.ground[0]!).toBeCloseTo(1, 2)
  })

  /** 【熄掉的格子立刻歸 1】格子會被下一處火重用，不該繼承別人的因子 */
  it('熄掉的格子不把抑制留給重用它的新火', () => {
    const ground = createGroundFires()
    const shipFires = createShipFires()
    const crowd = createFireCrowd(ground, shipFires)
    for (let i = 0; i < 4; i++) lightGroundFire(ground, i * 5, 0, 0)
    settle(crowd, { ground, ships: [], shipFires, seconds: FIRE_CROWD_SMOOTH * 5 })
    ground.live[0] = 0
    updateFireCrowd(crowd, ground, shipFires, [], FIRE_CROWD_RECALC + DT)
    expect(crowd.ground[0]).toBe(1)
  })
})

describe('倍率餵進 stepGroundFires', () => {
  function puffsOver(seconds: number, factor: number | undefined): number {
    const fires = createGroundFires()
    lightGroundFire(fires, 0, 0, 0)
    const crowd = factor === undefined ? undefined : new Float32Array(fires.capacity).fill(factor)
    let n = 0
    for (let t = 0; t < seconds; t += DT) {
      stepGroundFires(fires, DT, () => { n++ }, crowd)
    }
    return n
  }

  it('倍率 1 與不給倍率的朵數相同', () => {
    expect(puffsOver(10, 1)).toBe(puffsOver(10, undefined))
  })

  it('倍率 2 的朵數大約是一半', () => {
    const full = puffsOver(20, 1)
    const half = puffsOver(20, 2)
    expect(half).toBeLessThan(full * 0.6)
    expect(half).toBeGreaterThan(full * 0.4)
  })

  /**
   * 【壞掉的倍率必須退回原間隔】0 或 NaN 會讓補放迴圈 `do { t += gap }
   * while (t <= 0)` 永遠跳不出去 —— 那是整個分頁卡死，不是畫面瑕疵。
   */
  it('倍率是 0、負數或 NaN 時退回原速率，而且不會卡死', () => {
    const base = puffsOver(5, 1)
    for (const bad of [0, -1, Number.NaN]) {
      expect(puffsOver(5, bad)).toBe(base)
    }
  })

  it('間隔就是 FIRE_PUFF 乘上倍率', () => {
    // 十秒、倍率 2：每 0.6 秒一朵，扣掉第一朵立刻放
    expect(puffsOver(10, 2)).toBe(Math.floor(10 / (FIRE_PUFF * 2)) + 1)
  })
})
