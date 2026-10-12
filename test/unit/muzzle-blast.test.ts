import { describe, expect, it, vi } from 'vitest'
import { InstancedMesh, Matrix4, Vector3 } from 'three'
import { createMuzzleBlast, MUZZLE_FIRE_SECONDS } from '../../src/render/muzzleBlast'

function frames(mesh: InstancedMesh) {
  return Array.from({ length: 5 }, (_, k) => {
    const matrix = new Matrix4()
    mesh.getMatrixAt(k, matrix)
    return { position: new Vector3().setFromMatrixPosition(matrix), size: new Vector3().setFromMatrixScale(matrix) }
  })
}

describe('90 mm 短促砲口火焰', () => {
  it.each([[0, 0, -1], [1, 0, 0], [0, 1, 0]])('火舌沿砲管方向 %j 展開，保持寬度並逐漸收尖', (dx, dy, dz) => {
    const smoke = { emit: vi.fn() }
    const blast = createMuzzleBlast(smoke)
    blast.emit(10, 20, 30, dx, dy, dz)
    blast.step(0.02)
    const fire = frames(blast.object.children[0] as InstancedMesh)
    const axis = new Vector3(dx, dy, dz)
    const origin = new Vector3(10, 20, 30)
    const distances = fire.map(f => f.position.clone().sub(origin).dot(axis))
    expect(distances.every((d, k) => d > 0 && (k === 0 || d > distances[k - 1]!))).toBe(true)
    expect(distances[4]! - distances[0]!).toBeGreaterThan(5)
    for (const f of fire) {
      const offset = f.position.clone().sub(origin)
      const lateral = offset.addScaledVector(axis, -offset.dot(axis)).length()
      expect(lateral).toBeLessThan(1)
    }
    expect(fire[2]!.size.x).toBeGreaterThan(4.4)
    expect(fire[2]!.size.x).toBeLessThan(5.2)
    expect(fire[4]!.size.x).toBeLessThan(fire[2]!.size.x * 0.4)
    expect(smoke.emit).not.toHaveBeenCalled()
    blast.step(0.075)
    const fading = frames(blast.object.children[0] as InstancedMesh)
    expect(smoke.emit).toHaveBeenCalledTimes(20)
    for (let k = 0; k < fading.length; k++) {
      const core = smoke.emit.mock.calls[k * 4]!
      expect(new Vector3(core[0], core[1], core[2]).distanceTo(fading[k]!.position)).toBeLessThan(1e-4)
      expect(core[6]).toBeGreaterThan(fading[k]!.size.x)
    }
    blast.step(0.05)
    expect(smoke.emit).toHaveBeenCalledTimes(20)
    blast.dispose()
  })

  it('暫停不推進、短暫閃光結束就消失；跨過壽命的幀仍有餘煙，重置可重現', () => {
    const smoke = { emit: vi.fn() }
    const blast = createMuzzleBlast(smoke)
    const fire = blast.object.children[0] as InstancedMesh
    const glow = blast.object.children[1] as InstancedMesh
    blast.emit(0, 0, 0, 0, 0, -1)
    blast.step(0.02)
    const first = Array.from(fire.instanceMatrix.array)
    blast.step(0)
    // 池內年齡以 Float32 儲存；重算矩陣允許浮點量化誤差。
    fire.instanceMatrix.array.forEach((value, k) => expect(value).toBeCloseTo(first[k]!, 6))
    blast.step(MUZZLE_FIRE_SECONDS)
    expect(frames(fire).every(f => f.size.lengthSq() === 0)).toBe(true)
    expect(frames(glow).every(f => f.size.lengthSq() === 0)).toBe(true)
    expect(smoke.emit).toHaveBeenCalledTimes(20)
    blast.reset()
    blast.emit(0, 0, 0, 0, 0, -1)
    blast.step(0.02)
    expect(Array.from(fire.instanceMatrix.array)).toEqual(first)
    blast.reset()
    expect(frames(fire).every(f => f.size.lengthSq() === 0)).toBe(true)
    expect(frames(glow).every(f => f.size.lengthSq() === 0)).toBe(true)
    blast.dispose()
  })
})
