import { describe, it, expect } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import { createMissionIntroDirector, INTRO_BAR_SECONDS } from '../../src/app/missionIntroDirector'
import type { IntroShot } from '../../src/battle/missions/types'
import { createInputState } from '../../src/input/InputState'

const NO_SCENE = { groundTargets: [], ships: [], combatants: [] }

const PAN: IntroShot = {
  kind: 'pan', seconds: 2,
  from: { x: 0, y: 500, z: 0 }, to: { x: 1000, y: 500, z: 0 },
  lookFrom: { x: 0, y: 0, z: -500 }, lookTo: { x: 1000, y: 0, z: -500 },
}

function fixture() {
  const classes = new Set<string>()
  const vars = new Map<string, string>()
  const overlay = {
    classList: { toggle: (c: string, on?: boolean) => { if (on) classes.add(c); else classes.delete(c); return !!on } },
    style: { setProperty: (k: string, v: string) => { vars.set(k, v) } },
  }
  const cues: string[] = []
  const director = createMissionIntroDirector(overlay, 60, {
    aim: (c) => { cues.push(`aim ${c.from.x}`) },
    fire: (c) => { cues.push(`fire ${c.from.x}`) },
  })
  const camera = new PerspectiveCamera(70, 2, 1, 1e5)
  const input = createInputState()
  const bars = () => Number(vars.get('--k') ?? 'NaN')
  return { classes, director, camera, input, bars, cues }
}

describe('黑邊吃遊戲時間', () => {
  it('開始時收著，照遊戲時間滑入；不推進（暫停）就不動', () => {
    const f = fixture()
    f.director.begin([PAN], f.input, new Quaternion())
    expect(f.bars()).toBe(0)
    f.director.frameStart(f.input, f.camera, INTRO_BAR_SECONDS / 2)
    expect(f.bars()).toBeCloseTo(0.5, 9)
    f.director.frameStart(f.input, f.camera, 0)
    expect(f.bars()).toBeCloseTo(0.5, 9)
    f.director.frameStart(f.input, f.camera, INTRO_BAR_SECONDS)
    expect(f.bars()).toBe(1)
  })

  it('結束後照遊戲時間滑出', () => {
    const f = fixture()
    f.director.begin([PAN], f.input, new Quaternion())
    f.director.frameStart(f.input, f.camera, 1)
    f.input.skipRequested = true
    f.director.frameStart(f.input, f.camera, INTRO_BAR_SECONDS / 4)
    expect(f.bars()).toBeCloseTo(0.75, 9)
    f.director.frameStart(f.input, f.camera, INTRO_BAR_SECONDS)
    expect(f.bars()).toBe(0)
  })

  it('離開戰鬥時立刻收掉，不滑', () => {
    const f = fixture()
    f.director.begin([PAN], f.input, new Quaternion())
    f.director.frameStart(f.input, f.camera, 1)
    f.director.stop()
    expect(f.bars()).toBe(0)
  })
})

describe('開場導覽的每幀接線', () => {
  it('開始時黑邊進場；鏡頭覆寫成鏡位、FOV 回基準', () => {
    const f = fixture()
    f.director.begin([PAN], f.input, new Quaternion())
    expect(f.director.active).toBe(true)
    expect(f.classes.has('on')).toBe(true)
    expect(f.director.frameStart(f.input, f.camera, 1)).toBe(false)
    f.director.applyCamera(f.camera, NO_SCENE, 1)
    expect(f.camera.position.toArray()).toEqual([500, 500, 0])
    expect(f.camera.fov).toBe(60)
  })

  it('導覽中玩家的輸入被蓋掉：瞄準點鎖在開始時的機首', () => {
    const f = fixture()
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    f.director.begin([PAN], f.input, q)
    f.input.firing = true
    f.input.aimWorld.set(0, 1, 0)
    f.director.frameStart(f.input, f.camera, 0.1)
    expect(f.input.firing).toBe(false)
    const nose = new Vector3(0, 0, -1).applyQuaternion(q)
    expect(f.input.aimWorld.distanceTo(nose)).toBeLessThan(1e-12)
  })

  it('跳過：這一幀結束、黑邊退場，鏡頭從最後的鏡位開始滑回', () => {
    const f = fixture()
    f.director.begin([PAN], f.input, new Quaternion())
    f.director.frameStart(f.input, f.camera, 1)
    f.director.applyCamera(f.camera, NO_SCENE, 1)
    const last = f.camera.position.clone()
    f.input.skipRequested = true
    expect(f.director.frameStart(f.input, f.camera, 0)).toBe(true)
    expect(f.input.skipRequested).toBe(false)
    expect(f.director.active).toBe(false)
    expect(f.classes.has('on')).toBe(false)
    // 玩家的鏡頭在原點；滑回的第一刻還幾乎停在鏡位上
    f.camera.position.set(0, 0, 0)
    f.director.applyCamera(f.camera, NO_SCENE, 0.01)
    expect(f.camera.position.distanceTo(last)).toBeLessThan(1)
  })

  it('沒在播時按的空白鍵清掉，不留到下一場', () => {
    const f = fixture()
    f.input.skipRequested = true
    expect(f.director.frameStart(f.input, f.camera, 0.1)).toBe(false)
    expect(f.input.skipRequested).toBe(false)
    f.director.begin([PAN], f.input, new Quaternion())
    expect(f.director.frameStart(f.input, f.camera, 0.1)).toBe(false)
  })

  it('離開戰鬥：導覽收掉、黑邊退場', () => {
    const f = fixture()
    f.director.begin([PAN], f.input, new Quaternion())
    f.director.stop()
    expect(f.director.active).toBe(false)
    expect(f.classes.has('on')).toBe(false)
  })
})

describe('導覽與滑回', () => {
  it('滑回途中 busy 仍為真，滑完才變假', () => {
    const f = fixture()
    f.director.begin([PAN], f.input, new Quaternion())
    expect(f.director.busy).toBe(true)
    f.input.skipRequested = true
    f.director.frameStart(f.input, f.camera, 0)
    expect(f.director.active).toBe(false)
    expect(f.director.busy).toBe(true)
    f.director.applyCamera(f.camera, NO_SCENE, 1)
    expect(f.director.busy).toBe(true)
    f.director.applyCamera(f.camera, NO_SCENE, 1)
    expect(f.director.busy).toBe(false)
  })
})

describe('鏡位的視角', () => {
  it('鏡位指定 fov 就用它（長焦）；沒指定用基準', () => {
    const f = fixture()
    f.director.begin([{ ...PAN, fov: 12 }, PAN], f.input, new Quaternion())
    f.director.frameStart(f.input, f.camera, 0.5)
    f.director.applyCamera(f.camera, NO_SCENE, 0.5)
    expect(f.camera.fov).toBe(12)
    f.director.frameStart(f.input, f.camera, 2)
    f.director.applyCamera(f.camera, NO_SCENE, 2)
    expect(f.camera.fov).toBe(60)
  })
})

describe('鏡位上的開火', () => {
  const FIRE = { at: 1, from: { x: 7, z: 0 }, to: { x: 0, z: -500 }, miss: { x: 10, z: 0 } }

  it('播到那一刻開一發、只開一次；之前每幀先把砲塔轉過去', () => {
    const f = fixture()
    f.director.begin([{ ...PAN, fires: [FIRE] }, PAN], f.input, new Quaternion())
    f.director.frameStart(f.input, f.camera, 0.5)
    f.director.applyCamera(f.camera, NO_SCENE, 0.5)
    expect(f.cues).toEqual(['aim 7'])
    f.director.frameStart(f.input, f.camera, 0.6)
    f.director.applyCamera(f.camera, NO_SCENE, 0.6)
    expect(f.cues).toEqual(['aim 7', 'aim 7', 'fire 7'])
    f.director.frameStart(f.input, f.camera, 0.6)
    f.director.applyCamera(f.camera, NO_SCENE, 0.6)
    expect(f.cues.filter((c) => c.startsWith('fire'))).toHaveLength(1)
  })

  it('跳過的話不開', () => {
    const f = fixture()
    f.director.begin([{ ...PAN, fires: [FIRE] }], f.input, new Quaternion())
    f.input.skipRequested = true
    f.director.frameStart(f.input, f.camera, 0.5)
    f.director.applyCamera(f.camera, NO_SCENE, 0.5)
    expect(f.cues.filter((c) => c.startsWith('fire'))).toHaveLength(0)
  })
})

describe('一段裡排好幾發', () => {
  it('各自照自己的秒數開、各開一次', () => {
    const f = fixture()
    const a = { at: 0.2, from: { x: 1, z: 0 }, to: { x: 0, z: 0 }, miss: { x: 0, z: 0 } }
    const b = { at: 1.0, from: { x: 2, z: 0 }, to: { x: 0, z: 0 }, miss: { x: 0, z: 0 } }
    f.director.begin([{ ...PAN, fires: [a, b] }], f.input, new Quaternion())
    for (let i = 0; i < 15; i++) f.director.frameStart(f.input, f.camera, 0.1)
    expect(f.cues.filter((c) => c.startsWith('fire'))).toEqual(['fire 1', 'fire 2'])
  })
})
