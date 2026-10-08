import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  updateBattleHudMarkers, type BattleHudMarkersDependencies,
} from '../../src/app/battleHudMarkers'
import { DAMAGE_MARK_SECONDS } from '../../src/hud/damageMarks'
import {
  fillMarkers, type MarkerObjectives, type MarkerPool, type MarkerProject,
} from '../../src/hud/markerFeed'
import { createHudFrame, HIT_FLASH_SECONDS, HUD_MAX_MARKERS } from '../../src/hud/types'
import { SHIP_CLASSES, createShip, type Ship } from '../../src/world/ships'
import { createGroundTarget } from '../../src/world/groundTargets'

/**
 * # 標記進池的規則
 *
 * 【為什麼要有這一支】填標記的迴圈本來寫在 `main.ts` 裡，而那個檔案沒有
 * 任何測試（見 `test/e2e/` 幾支的檔頭）。這裡有兩條會**靜靜壞掉**的性質：
 * 漏掉某一種物體（症狀只是「炸彈沒有標記」），與敵我判反（症狀只是
 * 「顏色不對」）。兩者都不會有任何錯誤訊息。
 */

/** 每一個座標原樣回傳的假投影 —— 這一支測的不是透視。 */
const FLAT: MarkerProject = (x, y, _z, out) => {
  out.x = x
  out.y = y
  return false
}

/** 全部都在相機背後。 */
const BEHIND: MarkerProject = (x, y, _z, out) => {
  out.x = x
  out.y = y
  return true
}

/**
 * 一個假的彈藥池。**只有 `fillMarkers` 讀得到的那五個欄位** —— 造一整顆
 * `Bombs` 會把「標記有沒有長出來」與「炸彈積分對不對」綁在一起。
 */
function pool(items: readonly { x: number; y: number; z: number; team: number }[]): MarkerPool {
  const capacity = 8
  const p = {
    capacity,
    x: new Float64Array(capacity),
    y: new Float64Array(capacity),
    z: new Float64Array(capacity),
    team: new Int8Array(capacity),
    active: new Uint8Array(capacity),
  }
  items.forEach((it, i) => {
    p.x[i] = it.x; p.y[i] = it.y; p.z[i] = it.z
    p.team[i] = it.team
    p.active[i] = 1
  })
  return p
}

function ship(index: number, team: 'blue' | 'red', x = 0, z = 0): Ship {
  return createShip(index, SHIP_CLASSES.fletcher, team, x, z, 0, 0)
}

/**
 * 假的模型高度。真的那一支住在算繪層（`render/ships.ts` 的 `shipModelTop`，
 * 量 GLB 的包圍盒），node 環境載不了 GLB。
 */
const TOP = 27
const topOf = (): number => TOP

/** 沒有主要目標 */
const NONE: MarkerObjectives = { ship: () => false, ground: () => false, ref: { x: 0, y: 0, z: 0 } }

describe('戰鬥幀的 HUD 標記', () => {
  function dependencies(): BattleHudMarkersDependencies {
    return {
      markerPools: [],
      markerObjectives: { ...NONE, ref: new Vector3() },
      projectMarker: FLAT,
      shipMarkerTop: topOf,
    }
  }

  it('換場時換成新一場的彈藥池，呈現用的緩衝照樣重用', () => {
    const deps = dependencies()
    const f = createHudFrame()
    const pools = deps.markerPools
    const markers = f.markers
    const firstMarker = f.markers[0]
    const ref = deps.markerObjectives.ref
    const world = {
      ships: [], groundTargets: [],
      bombs: pool([{ x: 1, y: 2, z: 3, team: 0 }]),
      torpedoes: pool([{ x: 4, y: 5, z: 6, team: 1 }]),
    }
    updateBattleHudMarkers(deps, f, world, { team: 'blue' }, new Vector3(), 0, 0)
    expect(f.markerCount).toBe(2)
    expect(f.markers[0]!.hostile).toBe(false)
    expect(f.markers[1]!.hostile).toBe(true)

    const nextWorld = {
      ships: [], groundTargets: [],
      bombs: pool([{ x: 10, y: 20, z: 30, team: 0 }]),
      torpedoes: pool([{ x: 40, y: 50, z: 60, team: 1 }]),
    }
    const position = new Vector3(7, 8, 9)
    updateBattleHudMarkers(deps, f, nextWorld, { team: 'red' }, position, 0, 0)
    expect(f.markerCount).toBe(2)
    expect(f.markers[0]!.x).toBe(10)
    expect(f.markers[1]!.x).toBe(40)
    expect(f.markers[0]!.hostile).toBe(true)
    expect(f.markers[1]!.hostile).toBe(false)
    expect(deps.markerPools).toBe(pools)
    expect(pools[0]).toBe(nextWorld.bombs)
    expect(pools[1]).toBe(nextWorld.torpedoes)
    expect(f.markers).toBe(markers)
    expect(f.markers[0]).toBe(firstMarker)
    expect(deps.markerObjectives.ref).toBe(ref)
    expect(ref).toEqual(position)
    expect(ref).not.toBe(position)
  })

  it('船與地面目標也列進來，距離從當下的參考位置算', () => {
    const deps = dependencies()
    deps.markerObjectives.ship = () => true
    deps.markerObjectives.ground = () => true
    const f = createHudFrame()
    const world = {
      ships: [ship(0, 'red', 0, 1000)],
      groundTargets: [createGroundTarget(0, 'oilTank', 'red', 0, 0, 0)],
      bombs: pool([]), torpedoes: pool([]),
    }
    updateBattleHudMarkers(deps, f, world, { team: 'blue' }, new Vector3(0, TOP, 900), 0, 0)
    expect(f.markerCount).toBe(2)
    expect(f.markers[0]!.objective).toBe(true)
    expect(f.markers[0]!.range).toBeCloseTo(100)
    expect(f.markers[1]!.objective).toBe(true)
  })

  it('命中回饋每幀依幀時間推進一次，幀時間為 0 也一樣', () => {
    const deps = dependencies()
    const f = createHudFrame()
    const damageMarks = f.damageMarks
    const world = { ships: [], groundTargets: [], bombs: pool([]), torpedoes: pool([]) }
    const position = new Vector3()
    f.damageMarks[0]!.intensity = 1
    updateBattleHudMarkers(deps, f, world, { team: 'blue' }, position, 1, 0)
    expect(f.hitFlash).toBe(HIT_FLASH_SECONDS)
    expect(f.damageMarks[0]!.intensity).toBe(1)
    updateBattleHudMarkers(deps, f, world, { team: 'blue' }, position, 0, 0.05)
    expect(f.hitFlash).toBeCloseTo(HIT_FLASH_SECONDS - 0.05)
    expect(f.damageMarks[0]!.intensity).toBeCloseTo(1 - 0.05 / DAMAGE_MARK_SECONDS)
    updateBattleHudMarkers(deps, f, world, { team: 'blue' }, position, 0, 1)
    expect(f.hitFlash).toBe(0)
    expect(f.damageMarks[0]!.intensity).toBe(0)
    expect(f.damageMarks).toBe(damageMarks)
  })
})

describe('fillMarkers', () => {
  /**
   * 【三種物體都要進池】只驗其中一種的話，把炸彈那個迴圈整段刪掉仍然全綠
   * —— 而那正是這一層存在的理由：炸彈、魚雷必須有標記。
   */
  it('船、炸彈、魚雷三種都進池', () => {
    const f = createHudFrame()
    fillMarkers(
      f,
      [ship(0, 'red')],
      [],
      [pool([{ x: 1, y: 2, z: 3, team: 0 }]), pool([{ x: 4, y: 5, z: 6, team: 0 }])],
      0, FLAT, topOf, NONE,
    )
    expect(f.markerCount).toBe(3)
  })

  /**
   * 【沉了的船不畫】它已經完全退場（`Ship.alive` 的說明），留著標記等於
   * 指著一個不存在的目標。
   */
  it('沉了的船不進池，而且不會連累排在它後面的', () => {
    const f = createHudFrame()
    const dead = ship(0, 'red')
    dead.alive = false
    fillMarkers(f, [dead, ship(1, 'red'), ship(2, 'red')], [], [], 0, FLAT, topOf, NONE)
    expect(f.markerCount).toBe(2)
  })

  /**
   * 【敵我看的是隊別，不是誰投的】同隊藍、敵對紅。
   * 兩個方向都要驗 —— 只驗一邊的話，`hostile` 寫死成 `true` 仍然半綠。
   */
  it('同隊 hostile=false、敵隊 hostile=true', () => {
    const f = createHudFrame()
    fillMarkers(
      f,
      [ship(0, 'blue', 0, 0), ship(1, 'red', 100, 0)],
      [],
      [pool([{ x: 0, y: 0, z: 0, team: 0 }, { x: 0, y: 0, z: 0, team: 1 }])],
      0, FLAT, topOf, NONE,
    )
    expect(f.markers[0]!.hostile).toBe(false)
    expect(f.markers[1]!.hostile).toBe(true)
    expect(f.markers[2]!.hostile).toBe(false)
    expect(f.markers[3]!.hostile).toBe(true)
  })

  /** 【紅方玩家的視角是反過來的】`own` 換一邊，兩種顏色跟著對調。 */
  it('玩家是紅隊時敵我對調', () => {
    const f = createHudFrame()
    fillMarkers(f, [ship(0, 'blue'), ship(1, 'red', 100, 0)], [], [], 1, FLAT, topOf, NONE)
    expect(f.markers[0]!.hostile).toBe(true)
    expect(f.markers[1]!.hostile).toBe(false)
  })

  /**
   * 【船的高度來自 `shipTop`，不是 `position.y`】`Ship.position.y` 恆為 0，
   * 照抄的話尖端指的是水面。碰撞盒推出來的高度也不夠：桅杆與測距儀不在任何
   * 盒裡，威奇塔的盒頂 13.7 m 對上模型的 38.2 m —— 標記會插在艦橋中間。
   */
  it('船用 shipTop 給的高度，不是 position.y', () => {
    const f = createHudFrame()
    const s = ship(0, 'red')
    expect(s.position.y).toBe(0)
    // FLAT 把 y 原樣傳回 out.y，所以標記的 y 就是餵進投影的那個高度
    fillMarkers(f, [s], [], [], 0, FLAT, topOf, NONE)
    expect(f.markers[0]!.y).toBe(TOP)
  })

  /** 【小地圖讀世界座標】螢幕座標畫不了小地圖；相機背後的目標在小地圖上照樣要有 */
  it('每一格帶著物體的世界 x／z，相機背後的也一樣', () => {
    const f = createHudFrame()
    fillMarkers(f, [ship(0, 'red', 1200, -3400)], [], [], 0, BEHIND, topOf, NONE)
    expect(f.markers[0]!.worldX).toBe(1200)
    expect(f.markers[0]!.worldZ).toBe(-3400)
  })

  it('相機背後的那一格 behind 是 true', () => {
    const f = createHudFrame()
    fillMarkers(f, [ship(0, 'red')], [], [], 0, BEHIND, topOf, NONE)
    expect(f.markers[0]!.behind).toBe(true)
  })

  /**
   * 【縮小時要把用過的格子關掉】上一幀留在後面那幾格的 `active` 還是 true。
   * widget 只讀前 `markerCount` 格，但留著一批「還活著」的死資料是下一個
   * 讀它的人的陷阱 —— 與 `contacts` 的池不同：那一支從來不縮。
   */
  it('這一幀比上一幀少時，多出來的格子關掉', () => {
    const f = createHudFrame()
    fillMarkers(f, [ship(0, 'red'), ship(1, 'red', 100, 0), ship(2, 'red', 200, 0)], [], [], 0, FLAT, topOf, NONE)
    expect(f.markerCount).toBe(3)
    fillMarkers(f, [ship(0, 'red')], [], [], 0, FLAT, topOf, NONE)
    expect(f.markerCount).toBe(1)
    expect(f.markers[1]!.active).toBe(false)
    expect(f.markers[2]!.active).toBe(false)
  })

  /**
   * 【滿了就丟掉多的，不要寫出界】池是固定長度的。少了守衛就是
   * `f.markers[96]!` 在 `noUncheckedIndexedAccess` 下變成 undefined，
   * 然後 `m.behind = …` 直接爆掉。
   */
  it('超過池的容量就丟掉多的', () => {
    const f = createHudFrame()
    const many: Ship[] = []
    for (let i = 0; i < HUD_MAX_MARKERS + 10; i++) many.push(ship(i, 'red', i * 100, 0))
    expect(() => fillMarkers(f, many, [], [], 0, FLAT, topOf, NONE)).not.toThrow()
    expect(f.markerCount).toBe(HUD_MAX_MARKERS)
  })

  /** 【沒裝東西的格子不畫】`active === 0` 是「這一格是空的」。 */
  it('池裡沒 active 的格子不進池', () => {
    const f = createHudFrame()
    const p = pool([{ x: 1, y: 1, z: 1, team: 0 }])
    p.active[0] = 0
    fillMarkers(f, [], [], [p], 0, FLAT, topOf, NONE)
    expect(f.markerCount).toBe(0)
  })
})

describe('fillMarkers：地面目標', () => {
  /** 敵方的煙囪標在盒頂、紅；炸毀的不畫，也不連累後面的 */
  it('地面目標進池、高度用盒頂、敵對紅', () => {
    const f = createHudFrame()
    const t = createGroundTarget(0, 'chimney', 'red', 10, 20, 0)
    fillMarkers(f, [], [t], [], 0, FLAT, topOf, NONE)
    expect(f.markerCount).toBe(1)
    expect(f.markers[0]!.hostile).toBe(true)
    expect(f.markers[0]!.y).toBe(t.impactY)
  })

  it('炸毀的不進池，而且不會連累排在它後面的', () => {
    const f = createHudFrame()
    const dead = createGroundTarget(0, 'chimney', 'red', 0, 0, 0)
    dead.alive = false
    const list = [dead, createGroundTarget(1, 'oilTank', 'red', 50, 0, 0), createGroundTarget(2, 'oilTank', 'red', 100, 0, 0)]
    fillMarkers(f, [], list, [], 0, FLAT, topOf, NONE)
    expect(f.markerCount).toBe(2)
  })

  it('主要目標帶 objective 與到基準點的距離，其他的不帶', () => {
    const f = createHudFrame()
    const plant = createGroundTarget(0, 'chimney', 'red', 3000, 4000, 0)
    const flak = createGroundTarget(1, 'flakHeavy', 'red', 100, 0, 0)
    const s = ship(0, 'red', 0, 1000)
    const objectives: MarkerObjectives = {
      ship: (x) => x === s,
      ground: (t) => t === plant,
      ref: { x: 0, y: plant.impactY, z: 0 },
    }
    fillMarkers(f, [s], [plant, flak], [pool([{ x: 0, y: 0, z: 0, team: 1 }])], 0, FLAT, topOf, objectives)
    expect(f.markers[0]!.objective).toBe(true)
    expect(f.markers[0]!.range).toBeCloseTo(Math.hypot(1000, TOP - plant.impactY), 6)
    expect(f.markers[1]!.objective).toBe(true)
    expect(f.markers[1]!.range).toBeCloseTo(5000, 6)
    expect(f.markers[2]!.objective).toBe(false)
    expect(f.markers[3]!.objective).toBe(false)
  })

  it('船與地面目標都在時兩種都進池，船的標記不受影響', () => {
    const f = createHudFrame()
    fillMarkers(f, [ship(0, 'red')], [createGroundTarget(0, 'oilTank', 'red', 0, 0, 0)], [], 0, FLAT, topOf, NONE)
    expect(f.markerCount).toBe(2)
    expect(f.markers[0]!.y).toBe(TOP)
  })
})
