import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createDebris,
  DEBRIS_CONE, DEBRIS_COUNT, DEBRIS_MAX_LIFE, DEBRIS_SIZE_MAX, DEBRIS_SIZE_MIN,
} from '../../src/render/debris'
import { DEBRIS_SMOKE_COUNT } from '../../src/render/smoke'
import { createKills, pushKill } from '../../src/world/kills'
import { bodyColorOf } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109G6 } from '../../src/specs/bf109g6'

const FLAT = (): number => 0
const DEEP = (): number => -100000
const WHITE = () => 0xffffff

function decompose(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

describe('bodyColorOf', () => {
  it('兩個機種各有自己的塗裝，而且不相同', () => {
    expect(bodyColorOf(P51D)).toBe(0x9aa7b4)
    expect(bodyColorOf(BF109G6)).toBe(0x7e8a73)
  })
})

describe('createDebris', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const d = createDebris(16)
    expect(d.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    d.object.traverse(() => objects++)
    expect(objects).toBe(1)
    d.dispose()
  })

  it('建立時全部縮成 0', () => {
    const d = createDebris(16)
    expect(d.live).toBe(0)
    for (let i = 0; i < 16; i++) expect(decompose(d.object, i).scale.x).toBe(0)
    d.dispose()
  })
})

describe('零件的發射（M8 spec §7）', () => {
  it('一筆擊墜事件生 DEBRIS_COUNT 片', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
    d.dispose()
  })

  it('繼承母機速度 —— 一架 150 m/s 的飛機解體，碎片的動量還在', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.1, DEEP, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      // 母機朝 −Z 飛，所以零件的 z 一定變小
      expect(decompose(d.object, i).position.z).toBeLessThan(-5)
    }
    d.dispose()
  })

  it('散射是沿飛行方向的錐 —— 扣掉繼承速度之後的殘量落在 DEBRIS_CONE 內', () => {
    // 【為什麼要扣掉繼承速度】只看「零件在不在母機前方」是**測不到錐的**：
    // 母機 150 m/s 遠大於散射的 20 m/s，就算把錐改成等向，繼承的速度照樣
    // 把每一片都帶往前方。把散射錐改成 Math.PI 驗證過那樣的測試不會紅。
    //
    // 這裡母機速度只給 1 m/s，讓散射主導，並直接斷言真正的契約：
    // 零件速度減掉母機速度之後的方向，必須落在飛行方向的半角之內。
    const d = createDebris(64)
    const e = createKills(4)
    const dt = 1e-4
    const origin = new Vector3(0, 1000, 0)
    const parent = new Vector3(0, 0, -1)
    pushKill(e, origin.x, origin.y, origin.z, parent.x, parent.y, parent.z, 0)
    d.emit(e, WHITE)
    d.step(dt, DEEP, 0)
    const flight = parent.clone().normalize()
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const v = decompose(d.object, i).position.clone().sub(origin).divideScalar(dt)
      const residual = v.sub(parent).normalize()
      const angle = Math.acos(Math.min(1, Math.max(-1, residual.dot(flight))))
      // 容差 1e-3 rad：速度是從位移回推的，重力在 dt 內貢獻 9.8e-4 m/s
      expect(angle).toBeLessThanOrEqual(DEBRIS_CONE + 1e-3)
    }
    d.dispose()
  })

  it('散射錐讓零件彼此分開，不是一條線', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.5, DEEP, 0)
    let maxR = 0
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const p = decompose(d.object, i).position
      maxR = Math.max(maxR, Math.hypot(p.x, p.y - 1000))
    }
    expect(maxR).toBeGreaterThan(1)
    expect(DEBRIS_CONE).toBeGreaterThan(0.3)
    d.dispose()
  })

  it('大小落在 MIN 與 MAX 之間', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const s = decompose(d.object, i).scale.x
      expect(s).toBeGreaterThanOrEqual(DEBRIS_SIZE_MIN - 1e-6)
      expect(s).toBeLessThanOrEqual(DEBRIS_SIZE_MAX + 1e-6)
    }
    d.dispose()
  })

  it('每一次擊墜只有 DEBRIS_SMOKE_COUNT 片冒煙', () => {
    // 一幀 0.4 s、間隔 0.3 s → 每一片冒煙的正好生一團，所以事件數就是
    // 冒煙的片數。全部十二片都冒的話這裡會是 12。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(0.4, DEEP, 0)
    expect(d.smokeEvents.count).toBe(DEBRIS_SMOKE_COUNT)
    d.dispose()
  })

  it('翻滾中 —— 姿態隨時間改變', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    const a = decompose(d.object, 0).quaternion.clone()
    d.step(0.3, DEEP, 0)
    const b = decompose(d.object, 0).quaternion
    expect(a.angleTo(b)).toBeGreaterThan(0.1)
    d.dispose()
  })

  it('受重力 —— 會往下掉', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(2, DEEP, 0)
    let below = 0
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      if (decompose(d.object, i).position.y < 1000) below++
    }
    expect(below).toBeGreaterThan(DEBRIS_COUNT / 2)
    d.dispose()
  })
})

describe('零件入水（M8 spec §7）', () => {
  it('碰到水面就推一筆噴濺事件並退場', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 3, 0, 0, -50, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, FLAT, 0)
    expect(d.sprayEvents.count).toBe(DEBRIS_COUNT)
    expect(d.live).toBe(0)
    d.dispose()
  })

  it('噴濺事件生在水面上，不是零件的位置', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 100, 3, -200, 0, -50, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, () => 1.75, 0)
    expect(d.sprayEvents.count).toBeGreaterThan(0)
    expect(d.sprayEvents.data[1]).toBeCloseTo(1.75, 4)
    d.dispose()
  })

  it('事件緩衝每一次 step 開頭排空 —— 不會重複發射', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 3, 0, 0, -50, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, FLAT, 0)
    expect(d.sprayEvents.count).toBeGreaterThan(0)
    d.step(0.2, FLAT, 0)
    expect(d.sprayEvents.count).toBe(0)
    d.dispose()
  })

  it('永遠碰不到水面的零件也會在 DEBRIS_MAX_LIFE 之後退場', () => {
    // 【為什麼要上限】海面網格只有 10 km 見方；飄出去的零件永遠不會入水。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    for (let i = 0; i < 100; i++) d.step(DEBRIS_MAX_LIFE / 100, DEEP, 0)
    d.step(0.1, DEEP, 0)
    expect(d.live).toBe(0)
    d.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 30, 10, -150, 0)
    d.emit(e, WHITE)
    for (let i = 0; i < 300; i++) d.step(1 / 60, DEEP, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const inst = decompose(d.object, i)
      expect(Number.isFinite(inst.position.length())).toBe(true)
      expect(Number.isFinite(inst.scale.length())).toBe(true)
      expect(Number.isFinite(inst.quaternion.length())).toBe(true)
    }
    d.dispose()
  })

  it('池子滿了覆蓋最舊的', () => {
    const d = createDebris(DEBRIS_COUNT)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    pushKill(e, 500, 1000, 0, 0, 0, 0, 1)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
    d.dispose()
  })
})
