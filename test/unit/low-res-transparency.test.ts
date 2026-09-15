import { describe, expect, it } from 'vitest'
import { scaledTransparencySize } from '../../src/render/lowResTransparency'

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
})
