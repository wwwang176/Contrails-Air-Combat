import { describe, expect, it, vi } from 'vitest'
import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three'
import { disposeHangarShip, prepareHangarShip } from '../../src/tools/hangarShipLoading'

function fixture() {
  const root = new Group()
  const nested = new Group()
  const geometry = new BufferGeometry()
  const texture = new Texture()
  const material = new MeshStandardMaterial({ map: texture })
  const other = new MeshStandardMaterial()
  nested.add(new Mesh(geometry, [material, other]), new Mesh(geometry, material))
  root.add(nested)
  return {
    root,
    geometry: vi.spyOn(geometry, 'dispose'),
    material: vi.spyOn(material, 'dispose'),
    other: vi.spyOn(other, 'dispose'),
    texture: vi.spyOn(texture, 'dispose'),
  }
}

describe('機庫船艦載入生命週期', () => {
  it('釋放巢狀幾何與材質各一次，保留共用貼圖', () => {
    const f = fixture()
    disposeHangarShip(f.root)
    expect(f.geometry).toHaveBeenCalledOnce()
    expect(f.material).toHaveBeenCalledOnce()
    expect(f.other).toHaveBeenCalledOnce()
    expect(f.texture).not.toHaveBeenCalled()
  })

  it('仍被選取的模型完成塗裝後保留資源供顯示', async () => {
    const f = fixture()
    const dress = vi.fn(async () => {})
    expect(await prepareHangarShip(f.root, () => true, dress)).toBe(true)
    expect(dress).toHaveBeenCalledWith(f.root)
    expect(f.geometry).not.toHaveBeenCalled()
  })

  it('同艦級切走再切回，舊容器的載入仍會被丟棄', async () => {
    const f = fixture()
    const firstA = new Group()
    let current = firstA
    current = new Group() // B
    current = new Group() // 新的 A
    const dress = vi.fn(async () => {})
    expect(await prepareHangarShip(f.root, () => current === firstA, dress)).toBe(false)
    expect(dress).not.toHaveBeenCalled()
    expect(f.geometry).toHaveBeenCalledOnce()
    expect(f.material).toHaveBeenCalledOnce()
  })

  it('等待塗裝時切回飛機，完成後釋放尚未掛到場景的模型', async () => {
    const f = fixture()
    const selected = new Group()
    let current: Group | null = selected
    let finish!: () => void
    const pending = prepareHangarShip(f.root, () => current === selected,
      () => new Promise<void>((resolve) => { finish = resolve }))
    current = null
    expect(f.geometry).not.toHaveBeenCalled()
    finish()
    expect(await pending).toBe(false)
    expect(f.geometry).toHaveBeenCalledOnce()
    expect(f.material).toHaveBeenCalledOnce()
    expect(f.texture).not.toHaveBeenCalled()
  })

  it('塗裝失敗時釋放資源並保留原始錯誤', async () => {
    const f = fixture()
    const error = new Error('塗裝失敗')
    await expect(prepareHangarShip(f.root, () => true, async () => { throw error })).rejects.toBe(error)
    expect(f.geometry).toHaveBeenCalledOnce()
    expect(f.material).toHaveBeenCalledOnce()
  })
})
