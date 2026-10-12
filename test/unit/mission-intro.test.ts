import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  createIntroState, holdIntroInput, introCameraPose, introShotAt, skipIntro, startIntro, stepIntro,
  type IntroScene,
} from '../../src/app/missionIntro'
import type { IntroShot } from '../../src/battle/missions/types'
import { createGroundTarget, type GroundTarget } from '../../src/world/groundTargets'
import { createShip, SHIP_CLASSES, type Ship } from '../../src/world/ships'
import type { Combatant } from '../../src/world/combatant'
import { createInputState } from '../../src/input/InputState'

function scene(
  groundTargets: GroundTarget[] = [], groundAt?: (x: number, z: number) => number,
  ships: Ship[] = [], combatants: Combatant[] = [],
): IntroScene {
  return { groundTargets, ships, combatants, ...(groundAt === undefined ? {} : { groundAt }) }
}

const PAN: IntroShot = {
  kind: 'pan', seconds: 2,
  from: { x: 0, y: 100, z: 0 }, to: { x: 1000, y: 100, z: 0 },
  lookFrom: { x: 0, y: 0, z: -500 }, lookTo: { x: 1000, y: 0, z: -500 },
}
const FOLLOW: IntroShot = { kind: 'follow', seconds: 3, subject: { ground: 'usTruck' }, back: 100, up: 50, side: 20, lead: 30 }

describe('導覽的時鐘', () => {
  it('沒有鏡位就不播', () => {
    const s = createIntroState()
    startIntro(s, undefined)
    expect(s.active).toBe(false)
    startIntro(s, [])
    expect(s.active).toBe(false)
  })

  it('照鏡位依序走，走完回報一次 done、之後不再回報', () => {
    const s = createIntroState()
    startIntro(s, [PAN, FOLLOW])
    expect(s.active).toBe(true)
    expect(stepIntro(s, 1.5)).toBe(false)
    expect(introShotAt(s)).toEqual({ index: 0, local: 1.5 })
    expect(stepIntro(s, 1)).toBe(false)
    expect(introShotAt(s)).toEqual({ index: 1, local: 0.5 })
    expect(stepIntro(s, 2.6)).toBe(true)
    expect(s.active).toBe(false)
    expect(stepIntro(s, 1)).toBe(false)
  })

  it('跳過：下一步就結束', () => {
    const s = createIntroState()
    startIntro(s, [PAN, FOLLOW])
    stepIntro(s, 0.5)
    skipIntro(s)
    expect(stepIntro(s, 0)).toBe(true)
    expect(s.active).toBe(false)
  })

  it('沒在播的時候跳過什麼都不做', () => {
    const s = createIntroState()
    skipIntro(s)
    startIntro(s, [PAN])
    expect(stepIntro(s, 0.1)).toBe(false)
  })
})

describe('鏡頭姿態', () => {
  it('pan：位置與看的點都等速內插', () => {
    const pos = new Vector3()
    const look = new Vector3()
    expect(introCameraPose(PAN, 1, scene(), pos, look)).toBe(true)
    expect(pos.toArray()).toEqual([500, 100, 0])
    expect(look.toArray()).toEqual([500, 0, -500])
  })

  it('follow：在第一輛會動的卡車後上方，看向它前方', () => {
    const parked = createGroundTarget(0, 'usTruck', 'red', 0, 0, 0)
    const moving = createGroundTarget(1, 'usTruck', 'red', 500, 600, 0, {
      path: [], departAt: 0, speed: 10,
    } as never)
    const pos = new Vector3()
    const look = new Vector3()
    expect(introCameraPose(FOLLOW, 0, scene([parked, moving]), pos, look)).toBe(true)
    // 航向 0 = 朝 −Z：後方是 +Z，右側是 +X
    expect(pos.x).toBeCloseTo(500 + 20, 6)
    expect(pos.y).toBeCloseTo(moving.position.y + 50, 6)
    expect(pos.z).toBeCloseTo(600 + 100, 6)
    expect(look.x).toBeCloseTo(500, 6)
    expect(look.z).toBeCloseTo(600 - 30, 6)
  })

  it('follow：沒有可跟的（全滅、只剩停著的）回 false', () => {
    const parked = createGroundTarget(0, 'usTruck', 'red', 0, 0, 0)
    const dead = createGroundTarget(1, 'usTruck', 'red', 0, 0, 0, { path: [], departAt: 0, speed: 10 } as never)
    dead.alive = false
    expect(introCameraPose(FOLLOW, 0, scene([parked, dead]), new Vector3(), new Vector3())).toBe(false)
  })
})

describe('導覽期間玩家的輸入', () => {
  it('清掉所有操縱、瞄準點鎖回機首，油門回到開始時的值', () => {
    const input = createInputState()
    const nose = new Vector3(0, 0.1, -1).normalize()
    input.aimWorld.set(1, 0, 0)
    Object.assign(input, {
      aimDeltaX: 0.3, aimDeltaY: -0.2, firing: true, braking: true, zoom: true,
      lookActive: true, lookYaw: 0.4, lookPitch: 0.1, godView: true, playerAi: true,
      bombTaps: 2, throttle: 0.2,
    })
    holdIntroInput(input, nose, 0.8)
    expect(input.aimWorld.toArray()).toEqual(nose.toArray())
    expect(input).toMatchObject({
      aimDeltaX: 0, aimDeltaY: 0, firing: false, braking: false, zoom: false,
      lookActive: false, lookYaw: 0, lookPitch: 0, godView: false, playerAi: false,
      bombTaps: 0, throttle: 0.8,
    })
  })
})

describe('follow 的迎面低角度', () => {
  const FRONT: IntroShot = {
    kind: 'follow', seconds: 4, subject: { ground: 'usTruck' }, back: -30, backTo: -10, up: 2, side: 6, lead: 0, lookUp: 1.5,
  }
  function truck() {
    return createGroundTarget(1, 'usTruck', 'red', 0, 0, 0, { path: [], departAt: 0, speed: 10 } as never)
  }

  it('距離由 back 線性變到 backTo：卡車迎面開近', () => {
    const t = truck()
    const pos = new Vector3()
    const look = new Vector3()
    introCameraPose(FRONT, 0, scene([t]), pos, look)
    expect(pos.z).toBeCloseTo(-30, 6)
    introCameraPose(FRONT, 2, scene([t]), pos, look)
    expect(pos.z).toBeCloseTo(-20, 6)
    introCameraPose(FRONT, 4, scene([t]), pos, look)
    expect(pos.z).toBeCloseTo(-10, 6)
  })

  it('看的點抬高 lookUp', () => {
    const t = truck()
    const look = new Vector3()
    introCameraPose(FRONT, 0, scene([t]), new Vector3(), look)
    expect(look.y).toBeCloseTo(t.position.y + 1.5, 6)
  })

  it('高度貼著鏡頭正下方的地面：地比卡車高的地方不會鑽進地裡', () => {
    const t = truck()
    const pos = new Vector3()
    introCameraPose(FRONT, 0, scene([t], () => 40), pos, new Vector3())
    expect(pos.y).toBeCloseTo(42, 6)
    introCameraPose(FRONT, 0, scene([t], () => -5), pos, new Vector3())
    expect(pos.y).toBeCloseTo(t.position.y + 2, 6)
  })
})

describe('follow 的其他對象', () => {
  it('要害艦：第一艘還浮著的', () => {
    const shot: IntroShot = { kind: 'follow', seconds: 3, subject: { ship: 'vital' }, back: 0, up: 20, side: 200, lead: 0 }
    const escort = createShip(0, SHIP_CLASSES.fletcher, 'blue', 0, 0, 0, 0)
    const sunk = createShip(1, SHIP_CLASSES.essex, 'blue', 1000, 0, 0, 0, true)
    sunk.alive = false
    const carrier = createShip(2, SHIP_CLASSES.essex, 'blue', 3000, 0, 0, 0, true)
    const pos = new Vector3()
    expect(introCameraPose(shot, 0, scene([], undefined, [escort, sunk, carrier]), pos, new Vector3())).toBe(true)
    expect(pos.x).toBeCloseTo(3200, 6)
    expect(pos.y).toBeCloseTo(20, 6)
  })

  it('飛機：那一隊、那個角色裡還活著的第一架', () => {
    const shot: IntroShot = {
      kind: 'follow', seconds: 3, subject: { air: 'red', role: 'fighter' }, back: 50, up: 10, side: 0, lead: 100,
    }
    const plane = (team: 'red' | 'blue', role: string, alive: boolean, x: number) => ({
      team, alive,
      aircraft: { spec: { role }, state: { position: new Vector3(x, 2000, 0), orientation: new Quaternion() } },
    }) as unknown as Combatant
    const cs = [plane('blue', 'fighter', true, 0), plane('red', 'fighter', false, 100), plane('red', 'bomber', true, 200),
      plane('red', 'fighter', true, 300)]
    const pos = new Vector3()
    const look = new Vector3()
    expect(introCameraPose(shot, 0, scene([], () => 0, [], cs), pos, look)).toBe(true)
    expect(pos.toArray()).toEqual([300, 2010, 50])
    expect(look.toArray()).toEqual([300, 2000, -100])
  })

  it('沒有對象就回 false', () => {
    const shot: IntroShot = { kind: 'follow', seconds: 3, subject: { ship: 'vital' }, back: 0, up: 20, side: 200, lead: 0 }
    expect(introCameraPose(shot, 0, scene(), new Vector3(), new Vector3())).toBe(false)
  })
})

describe('pan 的高度量在地面上', () => {
  it('aboveGround：鏡頭與看的點各自加上自己底下的地面高度', () => {
    const shot: IntroShot = { ...PAN, aboveGround: true } as IntroShot
    const pos = new Vector3()
    const look = new Vector3()
    introCameraPose(shot, 1, scene([], (x) => x / 10), pos, look)
    expect(pos.toArray()).toEqual([500, 100 + 50, 0])
    expect(look.toArray()).toEqual([500, 0 + 50, -500])
  })

  it('沒有 aboveGround 時照絕對高度', () => {
    const pos = new Vector3()
    introCameraPose(PAN, 1, scene([], () => 40), pos, new Vector3())
    expect(pos.y).toBe(100)
  })
})
