import { describe, expect, it } from 'vitest'
import { Group, Object3D } from 'three'
import {
  LOW_RES_TRANSPARENCY_LAYER,
  scaledTransparencySize,
  useLowResTransparency,
} from '../../src/render/lowResTransparency'

describe('scaledTransparencySize', () => {
  it('半邊長只保留四分之一像素', () => {
    expect(scaledTransparencySize(1920, 1080, 0.5)).toEqual({
      width: 960,
      height: 540,
    })
  })

  it('四分之一邊長至少保留一個像素', () => {
    expect(scaledTransparencySize(3, 2, 0.25)).toEqual({
      width: 1,
      height: 1,
    })
  })

  it('奇數尺寸取最近整數', () => {
    expect(scaledTransparencySize(1279, 719, 0.5)).toEqual({
      width: 640,
      height: 360,
    })
  })

  it('透明效果的整棵物件樹都移到低解析度圖層', () => {
    const root = new Group()
    const child = new Object3D()
    const grandchild = new Object3D()
    root.add(child)
    child.add(grandchild)

    useLowResTransparency(root)

    expect(root.layers.isEnabled(LOW_RES_TRANSPARENCY_LAYER)).toBe(true)
    expect(child.layers.isEnabled(LOW_RES_TRANSPARENCY_LAYER)).toBe(true)
    expect(grandchild.layers.isEnabled(LOW_RES_TRANSPARENCY_LAYER)).toBe(true)
    expect(root.layers.isEnabled(0)).toBe(false)
  })
})
