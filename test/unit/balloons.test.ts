import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  BALLOON_ENVELOPE, BALLOON_ENVELOPE_HIT, BALLOON_MISS, BALLOON_TETHER, BALLOON_TOP,
  BALLOON_HP, balloonCollision, balloonHills, createBalloon, envelopeCenter, syncBalloonHills,
} from '../../src/world/balloons'
import { boundingRadius, createHitResult } from '../../src/world/hit'
import { KI84 } from '../../src/specs/ki84'
import { terrainCeiling } from '../../src/ai/terrainSense'
import { HILL_GAP } from '../../src/world/farmland'
import {
  LEYTE_BALLOONS, LEYTE_LSTS, LEYTE_MASSIFS, LST_BALLOON_DECK, baseHeight, coastZ, createLeyte, distanceToRoad,
} from '../../src/world/leyte'
import { SHIP_CLASSES } from '../../src/world/ships'
import { World } from '../../src/world/World'

/**
 * # 防空氣球
 *
 * 守四件會靜靜壞掉的事：鋼索與氣囊真的擋得住飛機、破了之後不再擋、AI 的山
 * 蓋得住整顆氣球、灘頭的擺位（山不互相遮擋、地面絞車在陸上、甲板上的絞車
 * 真的在甲板上）。
 */

const BOXES = KI84.hitBoxes
const R = boundingRadius(BOXES)
const LEVEL = new Quaternion()
const scratch = createHitResult()

function balloon(): ReturnType<typeof createBalloon> {
  return createBalloon(0, 'red', 100, 5, 200, 400, 0, true)
}

describe('鋼索與氣囊擋飛機', () => {
  it('平飛穿過鋼索那一步撞上', () => {
    const b = balloon()
    expect(balloonCollision(b, BOXES, new Vector3(100, 200, 200), LEVEL, R, scratch)).toBe(BALLOON_TETHER)
  })

  it('離鋼索一個翼展以外、低於錨點、高於匯集點都沒事', () => {
    const b = balloon()
    expect(balloonCollision(b, BOXES, new Vector3(100 + 15, 200, 200), LEVEL, R, scratch)).toBe(BALLOON_MISS)
    expect(balloonCollision(b, BOXES, new Vector3(100, 5 - 10, 200), LEVEL, R, scratch)).toBe(BALLOON_MISS)
    expect(balloonCollision(b, BOXES, new Vector3(100, 400 + BALLOON_TOP + 20, 200), LEVEL, R, scratch))
      .toBe(BALLOON_MISS)
  })

  it('撞進氣囊', () => {
    const b = balloon()
    const c = envelopeCenter(b, new Vector3())
    expect(balloonCollision(b, BOXES, c, LEVEL, R, scratch)).toBe(BALLOON_ENVELOPE_HIT)
  })

  it('破了之後什麼都不擋', () => {
    const b = balloon()
    b.alive = false
    expect(balloonCollision(b, BOXES, new Vector3(100, 200, 200), LEVEL, R, scratch)).toBe(BALLOON_MISS)
    expect(balloonCollision(b, BOXES, envelopeCenter(b, new Vector3()), LEVEL, R, scratch)).toBe(BALLOON_MISS)
  })

  it('氣囊盒的中心在匯集點上方', () => {
    expect(BALLOON_ENVELOPE.center.y).toBeGreaterThan(0)
  })
})

describe('AI 看到的山', () => {
  it('離鋼索 20 m 以內，山高過整顆氣球', () => {
    const b = balloon()
    const { islands } = balloonHills([b])
    for (const r of [0, 10, 20]) {
      for (let a = 0; a < 8; a++) {
        const x = b.top.x + r * Math.cos(a)
        const z = b.top.z + r * Math.sin(a)
        expect(terrainCeiling(islands[0]!, x, z)).toBeGreaterThan(b.top.y + BALLOON_TOP)
      }
    }
  })

  it('靠得近的氣球併成同一座多瓣的山，遠的各自一座', () => {
    const near = [
      createBalloon(0, 'red', 0, 0, 0, 350, 0, true),
      createBalloon(1, 'red', 120, 0, 0, 420, 0, true),
      createBalloon(2, 'red', 5000, 0, 0, 380, 0, true),
    ]
    const { islands } = balloonHills(near)
    expect(islands.length).toBe(2)
    const merged = islands.find((i) => i.lobes.length === 2)!
    // 主瓣排第一、是最高的那一顆
    expect(merged.lobes[0]!.peak).toBe(merged.peak)
    expect(merged.cx).toBe(120)
  })

  it('破掉的那一瓣壓平，重開長回來', () => {
    const list = [createBalloon(0, 'red', 0, 0, 0, 350, 0, true), createBalloon(1, 'red', 100, 0, 0, 420, 0, true)]
    const hills = balloonHills(list)
    const before = hills.islands[0]!.peak
    list[1]!.alive = false
    syncBalloonHills(list, hills)
    expect(hills.lobeOf[1]!.peak).toBe(0)
    expect(hills.islands[0]!.peak).toBeLessThan(before)
    list[1]!.alive = true
    syncBalloonHills(list, hills)
    expect(hills.islands[0]!.peak).toBe(before)
  })
})

describe('雷伊泰灘頭的氣球', () => {
  /** 照任務的擺法建：繫在船上的轉到世界，地面的照地形落地 */
  const placed = LEYTE_BALLOONS.map((b, i) => {
    const a = b.anchor
    if ('ship' in a) {
      const l = LEYTE_LSTS[a.ship]!
      const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), l.heading)
      const p = new Vector3(LST_BALLOON_DECK.x, LST_BALLOON_DECK.y, LST_BALLOON_DECK.z)
        .applyQuaternion(q).add(new Vector3(l.x, 0, l.z))
      return createBalloon(i, 'red', p.x, p.y, p.z, b.altitude, b.heading, false)
    }
    return createBalloon(i, 'red', a.x, baseHeight(a.x, a.z), a.z, b.altitude, b.heading, true)
  })

  it('每艘 LST 一顆、地面絞車在陸上而且離公路夠遠', () => {
    expect(LEYTE_BALLOONS.filter((b) => 'ship' in b.anchor).length).toBe(LEYTE_LSTS.length)
    for (const b of LEYTE_BALLOONS) {
      if ('ship' in b.anchor) continue
      expect(b.anchor.z).toBeGreaterThan(coastZ(b.anchor.x) + 100)
      expect(distanceToRoad(b.anchor.x, b.anchor.z)).toBeGreaterThan(200)
    }
  })

  it('甲板上的絞車落在 LST 的艦體盒頂面上 —— 座標寫錯的話鋼索從海裡長出來', () => {
    const hull = SHIP_CLASSES.lst.hull[0]!
    expect(Math.abs(LST_BALLOON_DECK.x)).toBeLessThan(hull.center.x + hull.half.x)
    expect(LST_BALLOON_DECK.z).toBeLessThan(hull.center.z + hull.half.z)
    expect(LST_BALLOON_DECK.z).toBeGreaterThan(hull.center.z - hull.half.z)
    expect(LST_BALLOON_DECK.y).toBeCloseTo(hull.center.y + hull.half.y, 2)
  })

  it('高度照史實：300 到 450 m', () => {
    for (const b of LEYTE_BALLOONS) {
      expect(b.altitude).toBeGreaterThanOrEqual(300)
      expect(b.altitude).toBeLessThanOrEqual(450)
    }
  })

  const { hills } = createLeyte()
  const set = balloonHills(placed, hills)

  it('有氣球的那幾座與任何一座之間至少留 HILL_GAP —— 重疊的話前面那一座會把後面的遮掉', () => {
    for (const a of set.touched) {
      for (const b of set.islands) {
        if (a === b) continue
        const gap = Math.hypot(a.cx - b.cx, a.cz - b.cz) - a.outerRadius - b.outerRadius
        expect(gap, `${a.cx.toFixed(0)},${a.cz.toFixed(0)} ↔ ${b.cx.toFixed(0)},${b.cz.toFixed(0)}`)
          .toBeGreaterThanOrEqual(HILL_GAP)
      }
    }
  })

  it('地形原有的山保持原來的次序與數量在前面 —— AI 的鎖存記的是索引', () => {
    expect(set.islands.length).toBeGreaterThanOrEqual(hills.length)
    for (let k = 0; k < hills.length; k++) {
      expect(set.islands[k]!.cx).toBe(hills[k]!.cx)
      expect(set.islands[k]!.cz).toBe(hills[k]!.cz)
    }
    // 地形那一份沒有被改到
    expect(hills.every((h) => h.lobes.every((lo) => LEYTE_MASSIFS.some((m) => m.lobes.some((ml) => ml.cx === lo.cx)))))
      .toBe(true)
  })

  it('每一顆的鋼索上，AI 看到的山都高過整顆氣球', () => {
    for (const b of placed) {
      let ceiling = 0
      for (const isl of set.islands) ceiling = Math.max(ceiling, terrainCeiling(isl, b.top.x, b.top.z))
      expect(ceiling).toBeGreaterThan(b.top.y + BALLOON_TOP)
    }
  })
})

describe('World 裡的氣球', () => {
  const DT = 1 / 240
  /** 反查不到飛機的射手索引（−1 是彈池的空槽標記，不能用） */
  const NOBODY = 7
  function worldWith(): { world: World; b: ReturnType<typeof createBalloon> } {
    const world = new World()
    world.groundAt = () => 0
    world.waterAt = () => -Infinity
    const b = createBalloon(0, 'red', 0, 0, 0, 100, 0, true)
    world.balloons.push(b)
    return { world, b }
  }
  /** 從氣囊中心的高度、z −40 朝 +Z 打一發 */
  function shoot(world: World, team: number, damage: number): void {
    const c = envelopeCenter(world.balloons[0]!, new Vector3())
    world.projectiles.spawn(c.x, c.y, -40, 0, 0, 800, damage, NOBODY, team, 0.5, 20)
    for (let i = 0; i < 60; i++) world.step(DT)
  }

  it('打中氣囊扣血，血量歸零就破、推一筆事件', () => {
    const { world, b } = worldWith()
    shoot(world, 0, 10)
    expect(b.hp).toBe(BALLOON_HP - 10)
    expect(b.alive).toBe(true)
    shoot(world, 0, BALLOON_HP)
    expect(b.alive).toBe(false)
    expect(world.balloonKillEvents.count).toBe(1)
  })

  it('同隊的子彈穿過去', () => {
    const { world, b } = worldWith()
    shoot(world, 1, 100)
    expect(b.hp).toBe(BALLOON_HP)
  })
})
