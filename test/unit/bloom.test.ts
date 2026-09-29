import { describe, expect, it } from 'vitest'
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three'
import { OCCLUDER_LAYER, useBloomOccluder } from '../../src/render/bloom'

describe('useBloomOccluder', () => {
  /**
   * 【不寫深度的不擋光】槳盤、座艙玻璃在主畫面裡不擋後面的東西；標成遮擋物的話，
   * 遮擋那一趟把它們變成實心，透過槳盤看得到的火，光暈卻被整個截掉
   */
  it('寫深度的網格標上，不寫深度的（槳盤、玻璃）跳過', () => {
    const geo = new BoxGeometry()
    const body = new Mesh(geo, new MeshBasicMaterial())
    const disc = new Mesh(geo, new MeshBasicMaterial({ transparent: true, opacity: 0.22, depthWrite: false }))
    const mixed = new Mesh(geo, [new MeshBasicMaterial(), new MeshBasicMaterial({ depthWrite: false })])
    const root = new Group()
    root.add(body, disc, mixed)
    useBloomOccluder(root)
    expect(body.layers.isEnabled(OCCLUDER_LAYER)).toBe(true)
    expect(disc.layers.isEnabled(OCCLUDER_LAYER)).toBe(false)
    expect(mixed.layers.isEnabled(OCCLUDER_LAYER)).toBe(false)
    // 主畫面照常畫它們
    expect(disc.layers.isEnabled(0)).toBe(true)
  })
})
