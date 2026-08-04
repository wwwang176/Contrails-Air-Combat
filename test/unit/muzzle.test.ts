import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import { createMuzzles, MUZZLE_HALF_WIDTH, MUZZLE_LENGTH } from '../../src/render/muzzle'
import { World, FLASH_SECONDS, type Combatant } from '../../src/world/World'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { P51D } from '../../src/specs/p51d'
import type { Command, Controller } from '../../src/control/Controller'

class Idle implements Controller {
  update(_a: Aircraft, _dt: number, out: Command): void {
    out.aimWorld.set(0, 0, -1)
    out.throttle = 0.7
    out.firing = false
  }
}

/** 造一架在原點、機首朝 −Z 的 P-51D。 */
function oneAircraft(): { w: World; c: Combatant } {
  const w = new World()
  const a = new Aircraft(P51D, 4000, 200)
  a.state.position.set(0, 4000, 0)
  a.prevPosition.copy(a.state.position)
  const c = w.add(a, new Idle(), 'blue', a.state.position.clone(), 4000, 200)
  return { w, c }
}

/** 讀出第 i 個實例的位置／旋轉／縮放。 */
function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

describe('createMuzzles', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const m = createMuzzles(4)
    expect(m.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    m.object.traverse(() => objects++)
    expect(objects).toBe(1)
    m.dispose()
  })

  it('容量是「架數 × MAX_MOUNTS」，建立時就配足', () => {
    const m = createMuzzles(4)
    expect(m.object.count).toBe(4 * 8)
    expect(m.object.instanceMatrix.count).toBe(4 * 8)
    m.dispose()
  })

  it('建立時全部收成 0，第一幀不會在原點出現一叢', () => {
    const m = createMuzzles(2)
    for (let i = 0; i < m.object.count; i++) {
      expect(instance(m.object, i).scale.x).toBe(0)
    }
    m.dispose()
  })
})

describe('槍焰的位置與朝向', () => {
  it('計時器為 0 時縮成 0 —— 畫不出東西，不必另外剔除', () => {
    const { w, c } = oneAircraft()
    const m = createMuzzles(1)
    const pos = [new Vector3(0, 4000, 0)]
    const quat = [new Quaternion()]
    m.update(w.combatants, pos, quat)
    for (let i = 0; i < c.muzzleFlash.length; i++) {
      expect(instance(m.object, i).scale.x).toBe(0)
    }
    m.dispose()
  })

  it('擊發後亮起，位置落在槍口而不是機體原點', () => {
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    const m = createMuzzles(1)
    const pos = [new Vector3(0, 4000, 0)]
    const quat = [new Quaternion()]
    m.update(w.combatants, pos, quat)

    const mount = P51D.battery.mounts[0]!.position
    const inst = instance(m.object, 0)
    expect(inst.scale.x).toBeGreaterThan(0)
    expect(inst.position.x).toBeCloseTo(mount.x, 4)
    expect(inst.position.y).toBeCloseTo(4000 + mount.y, 4)
    expect(inst.position.z).toBeCloseTo(mount.z, 4)
    m.dispose()
  })

  it('位置用的是傳進來的內插姿態，不是 Aircraft 的物理姿態', () => {
    // 【這是槍焰走計時器的全部理由】渲染層畫的是內插後的位置；用物理
    // 位置的話槍焰會相對機身抖動一個子步的位移（200 m/s 下 0.83 m）。
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    const m = createMuzzles(1)
    const pos = [new Vector3(1000, 500, -2000)]
    const quat = [new Quaternion()]
    m.update(w.combatants, pos, quat)

    const mount = P51D.battery.mounts[0]!.position
    const inst = instance(m.object, 0)
    expect(inst.position.x).toBeCloseTo(1000 + mount.x, 4)
    expect(inst.position.y).toBeCloseTo(500 + mount.y, 4)
    expect(inst.position.z).toBeCloseTo(-2000 + mount.z, 4)
    m.dispose()
  })

  it('姿態旋轉時槍口跟著轉', () => {
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    const m = createMuzzles(1)
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI)
    m.update(w.combatants, [new Vector3()], [q])

    const mount = P51D.battery.mounts[0]!.position
    const inst = instance(m.object, 0)
    // 繞 Y 轉 180°：x 與 z 都反號
    expect(inst.position.x).toBeCloseTo(-mount.x, 4)
    expect(inst.position.z).toBeCloseTo(-mount.z, 4)
    m.dispose()
  })

  it('亮度隨計時器遞減 —— 不是開關', () => {
    const { w, c } = oneAircraft()
    const m = createMuzzles(1)
    const pos = [new Vector3()]
    const quat = [new Quaternion()]

    c.muzzleFlash[0] = FLASH_SECONDS
    m.update(w.combatants, pos, quat)
    const full = instance(m.object, 0).scale.x

    c.muzzleFlash[0] = FLASH_SECONDS * 0.25
    m.update(w.combatants, pos, quat)
    const dim = instance(m.object, 0).scale.x

    expect(dim).toBeGreaterThan(0)
    expect(dim).toBeLessThan(full)
    m.dispose()
  })

  it('退場的飛機不畫槍焰', () => {
    const { w, c } = oneAircraft()
    c.muzzleFlash[0] = FLASH_SECONDS
    c.alive = false
    const m = createMuzzles(1)
    m.update(w.combatants, [new Vector3()], [new Quaternion()])
    expect(instance(m.object, 0).scale.x).toBe(0)
    m.dispose()
  })

  it('架數少於容量時，多出來的實例維持 0', () => {
    const { w } = oneAircraft()
    const m = createMuzzles(4)
    m.update(w.combatants, [new Vector3()], [new Quaternion()])
    for (let i = 8; i < m.object.count; i++) {
      expect(instance(m.object, i).scale.x).toBe(0)
    }
    m.dispose()
  })

  it('幾何是十字：兩片互相垂直、都包含槍管軸', () => {
    // 【為什麼十字而不是廣告板或錐】廣告板從正側面看會是一個圓片；
    // 錐的寬度受限於半徑（0.12 m 在第三人稱距離只有 8 px，人工驗收的
    // 回饋是「太小」）。十字正面看是十字閃、側面看是火舌，**沒有任何
    // 角度會退化成一個圓片或一條線**。
    const m = createMuzzles(1)
    const pos = m.object.geometry.getAttribute('position')

    // 每個頂點都落在 x = 0 或 y = 0 的平面上 —— 那就是「兩片互相垂直」
    for (let i = 0; i < pos.count; i++) {
      const onXZ = Math.abs(pos.getY(i)) < 1e-9
      const onYZ = Math.abs(pos.getX(i)) < 1e-9
      expect(onXZ || onYZ).toBe(true)
    }

    // 根部貼在槍口（z = 0），沿 +Z 伸出 MUZZLE_LENGTH
    let zMin = Infinity
    let zMax = -Infinity
    let rootHalf = 0
    let tipHalf = Infinity
    for (let i = 0; i < pos.count; i++) {
      const z = pos.getZ(i)
      const half = Math.max(Math.abs(pos.getX(i)), Math.abs(pos.getY(i)))
      zMin = Math.min(zMin, z)
      zMax = Math.max(zMax, z)
      if (z < 1e-9) rootHalf = Math.max(rootHalf, half)
      else tipHalf = Math.min(tipHalf, half)
    }
    expect(zMin).toBeCloseTo(0, 9)
    expect(zMax).toBeCloseTo(MUZZLE_LENGTH, 5)
    // 【向外張開】人工驗收：原本是根部寬、外端收尖，讀起來像從空中往槍口
    // 收回去。火焰是從槍管噴出來的氣體，愈遠愈開才是對的方向感。
    expect(tipHalf).toBeCloseTo(MUZZLE_HALF_WIDTH, 5)
    expect(rootHalf).toBeGreaterThan(0)
    expect(rootHalf).toBeLessThan(tipHalf)
    m.dispose()
  })

  it('十字的跨度明顯大於長度的十分之一 —— 「太小」的成因是寬度', () => {
    // 人工驗收的回饋：0.12 m 半徑的錐讀起來像一根細針。跨度 2 × 半寬
    expect(2 * MUZZLE_HALF_WIDTH).toBeGreaterThan(MUZZLE_LENGTH * 0.5)
  })
})
