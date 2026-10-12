import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createIntroState, holdIntroInput, introCameraPose, introShotAt, skipIntro, startIntro, stepIntro,
} from '../../src/app/missionIntro'
import type { IntroShot } from '../../src/battle/missions/types'
import { createGroundTarget } from '../../src/world/groundTargets'
import { createInputState } from '../../src/input/InputState'

const PAN: IntroShot = {
  kind: 'pan', seconds: 2,
  from: { x: 0, y: 100, z: 0 }, to: { x: 1000, y: 100, z: 0 },
  lookFrom: { x: 0, y: 0, z: -500 }, lookTo: { x: 1000, y: 0, z: -500 },
}
const FOLLOW: IntroShot = { kind: 'follow', seconds: 3, unit: 'usTruck', back: 100, up: 50, side: 20, lead: 30 }

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
    expect(introCameraPose(PAN, 1, [], pos, look)).toBe(true)
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
    expect(introCameraPose(FOLLOW, 0, [parked, moving], pos, look)).toBe(true)
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
    expect(introCameraPose(FOLLOW, 0, [parked, dead], new Vector3(), new Vector3())).toBe(false)
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
    kind: 'follow', seconds: 4, unit: 'usTruck', back: -30, backTo: -10, up: 2, side: 6, lead: 0, lookUp: 1.5,
  }
  function truck() {
    return createGroundTarget(1, 'usTruck', 'red', 0, 0, 0, { path: [], departAt: 0, speed: 10 } as never)
  }

  it('距離由 back 線性變到 backTo：卡車迎面開近', () => {
    const t = truck()
    const pos = new Vector3()
    const look = new Vector3()
    introCameraPose(FRONT, 0, [t], pos, look)
    expect(pos.z).toBeCloseTo(-30, 6)
    introCameraPose(FRONT, 2, [t], pos, look)
    expect(pos.z).toBeCloseTo(-20, 6)
    introCameraPose(FRONT, 4, [t], pos, look)
    expect(pos.z).toBeCloseTo(-10, 6)
  })

  it('看的點抬高 lookUp', () => {
    const t = truck()
    const look = new Vector3()
    introCameraPose(FRONT, 0, [t], new Vector3(), look)
    expect(look.y).toBeCloseTo(t.position.y + 1.5, 6)
  })

  it('高度貼著鏡頭正下方的地面：地比卡車高的地方不會鑽進地裡', () => {
    const t = truck()
    const pos = new Vector3()
    introCameraPose(FRONT, 0, [t], pos, new Vector3(), () => 40)
    expect(pos.y).toBeCloseTo(42, 6)
    introCameraPose(FRONT, 0, [t], pos, new Vector3(), () => -5)
    expect(pos.y).toBeCloseTo(t.position.y + 2, 6)
  })
})
