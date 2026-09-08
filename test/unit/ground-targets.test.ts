import { describe, it, expect } from 'vitest'
import { World } from '../../src/world/World'
import {
  GROUND_HP, createGroundTarget, resetGroundTarget, settleGroundTargets, type GroundTarget,
} from '../../src/world/groundTargets'
import { GROUND_UNITS } from '../../src/render/geometry/ground'
import { boundingRadius } from '../../src/world/hit'
import { BOMB_BLAST_DAMAGE } from '../../src/weapons/bomb'

/**
 * 地面目標接進 World 的護欄。
 *
 * 【為什麼不載 GLB】這裡測的是 `World` 的判定與事件，只用登記表的命中盒
 * （純資料）。幾何對不對是 `ground-units.test.ts` 的事。
 */

const DT = 1 / 240

/** 平地、沒有水的世界，一台紅隊 T-34 停在原點。 */
function fieldWith(id: 'tank' | 'truck' = 'tank', heading = 0): { world: World; target: GroundTarget } {
  const world = new World()
  world.groundAt = () => 0
  world.waterAt = () => -Infinity
  const target = createGroundTarget(0, id, 'red', 0, 0, heading)
  world.groundTargets.push(target)
  return { world, target }
}

/**
 * 從 (x, 1, −40) 朝 +Z 打一發，跑到它消失或飛過為止。
 *
 * 【team 0 是藍隊】與 `Projectiles.team` 的編碼相同（船那一段
 * `(sh.team === 'blue' ? 0 : 1) === ownerTeam`）。
 *
 * 【`owner` 不能是 −1】那是彈池的「空槽」標記，給 −1 等於沒發射。這裡沒有
 * 飛機，隨便一個反查不到人的索引就好；兇手於是記成 −1。
 */
const NOBODY = 7
function shoot(world: World, x: number, team = 0, damage = 100): void {
  world.projectiles.spawn(x, 1, -40, 0, 0, 800, damage, NOBODY, team, 0.5)
  for (let i = 0; i < 60; i++) world.step(DT)
}

function dropOn(world: World, x: number, z: number): void {
  world.dropBomb(x, 400, z, 0, 0, 0, BOMB_BLAST_DAMAGE, 0)
  for (let i = 0; i < 240 * 30 && world.bombs.live > 0; i++) world.step(DT)
}

describe('地面目標的資料', () => {
  it('每一種單位都有血量', () => {
    for (const u of GROUND_UNITS) expect(GROUND_HP[u.id]).toBeGreaterThan(0)
  })

  it('包圍球半徑蓋得住命中盒 —— 算小了子彈只在特定角度穿過去', () => {
    for (const u of GROUND_UNITS) {
      const t = createGroundTarget(0, u.id, 'red', 0, 0, 0)
      expect(t.radius).toBeGreaterThanOrEqual(boundingRadius(u.hull))
    }
  })

  it('落地把 y 填成地面高度，開局位置一起填', () => {
    const t = createGroundTarget(0, 'tank', 'red', 10, 20, 0)
    settleGroundTargets([t], (x, z) => x + z)
    expect(t.position.y).toBe(30)
    expect(t.spawn.y).toBe(30)
  })
})

describe('子彈打地面目標', () => {
  it('打中扣血、彈丸回收、有火花', () => {
    const { world, target } = fieldWith()
    const hp = target.hp
    shoot(world, 0)
    expect(target.hp).toBe(hp - 100)
    expect(world.hitEvents.count).toBeGreaterThan(0)
  })

  it('同隊的子彈穿過去', () => {
    const { world, target } = fieldWith()
    shoot(world, 0, 1)
    expect(target.hp).toBe(GROUND_HP.tank)
  })

  it('盒子跟著航向轉 —— 轉了 90° 之後車長變成橫向', () => {
    // T-34 寬 3.0、長 6.2：x = 2.5 在未轉時打不到，轉 90° 後車身橫過來就打得到
    const straight = fieldWith('tank', 0)
    shoot(straight.world, 2.5)
    expect(straight.target.hp).toBe(GROUND_HP.tank)

    const turned = fieldWith('tank', Math.PI / 2)
    shoot(turned.world, 2.5)
    expect(turned.target.hp).toBe(GROUND_HP.tank - 100)
  })

  it('血量歸零就退場：不再擋子彈，而且推一筆擊毀事件', () => {
    const { world, target } = fieldWith('truck')
    target.hp = 50
    shoot(world, 0)
    expect(target.alive).toBe(false)
    expect(world.groundKillEvents.count).toBe(1)
    expect(world.groundKillEvents.data[3]).toBe(target.index)
    expect(world.groundKillEvents.data[4]).toBe(-1)

    const hits = world.hitEvents.count
    shoot(world, 0)
    expect(world.hitEvents.count).toBe(hits)
    expect(world.groundKillEvents.count).toBe(1)
  })
})

describe('炸彈打地面目標', () => {
  it('直接命中吃爆心傷害', () => {
    const { world, target } = fieldWith()
    dropOn(world, 0, 0)
    expect(target.hp).toBe(GROUND_HP.tank - BOMB_BLAST_DAMAGE)
  })

  it('落在殺傷半徑外不扣血', () => {
    const { world, target } = fieldWith()
    dropOn(world, 200, 0)
    expect(target.hp).toBe(GROUND_HP.tank)
  })

  it('炸掉的那一筆擊毀事件沒有兇手', () => {
    const { world, target } = fieldWith('truck')
    dropOn(world, 0, 0)
    expect(target.alive).toBe(false)
    expect(world.groundKillEvents.data[4]).toBe(-1)
  })
})

describe('重開一場', () => {
  it('回到開局的血量、旗標與位置', () => {
    const t = createGroundTarget(0, 'truck', 'red', 5, 6, 0.3)
    settleGroundTargets([t], () => 12)
    t.hp = 0
    t.alive = false
    t.position.set(1, 2, 3)
    resetGroundTarget(t)
    expect(t.hp).toBe(GROUND_HP.truck)
    expect(t.alive).toBe(true)
    expect([t.position.x, t.position.y, t.position.z]).toEqual([5, 12, 6])
  })
})
