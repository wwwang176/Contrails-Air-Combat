import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createSparks, sparkDirection,
  SPARKS_PER_HIT, SPARK_CONE, SPARK_CULL, SPARK_LENGTH, SPARK_LIFE,
} from '../../src/render/sparks'
import { createImpacts, pushImpact } from '../../src/world/events'

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

describe('sparkDirection —— 決定性的錐內取樣（M7 spec §6.1）', () => {
  const out = new Vector3()

  it('恆為單位向量', () => {
    for (let i = 0; i < 200; i++) {
      sparkDirection(0, 1, 0, i, out)
      expect(out.length()).toBeCloseTo(1, 9)
    }
  })

  it('與法線的夾角恆在錐內', () => {
    const n = new Vector3(0.3, 0.5, -0.81).normalize()
    const cosMax = Math.cos(SPARK_CONE)
    for (let i = 0; i < 200; i++) {
      sparkDirection(n.x, n.y, n.z, i, out)
      expect(out.dot(n)).toBeGreaterThanOrEqual(cosMax - 1e-9)
    }
  })

  it('同索引恆給同方向 —— 沒有用 Math.random()', () => {
    // 【為什麼這一條重要】亂數要嘛需要一顆種子與一個 PRNG，要嘛就毀掉
    // 可測試性。用索引的雜湊之後，這個函數是純的，上面兩條才測得成立。
    const a = new Vector3()
    const b = new Vector3()
    sparkDirection(0, 1, 0, 42, a)
    sparkDirection(0, 1, 0, 42, b)
    expect(b.x).toBe(a.x)
    expect(b.y).toBe(a.y)
    expect(b.z).toBe(a.z)
  })

  it('不同索引給不同方向 —— 不是八顆疊在一起', () => {
    const seen = new Set<string>()
    for (let i = 0; i < SPARKS_PER_HIT; i++) {
      sparkDirection(0, 1, 0, i, out)
      seen.add(`${out.x.toFixed(6)},${out.y.toFixed(6)},${out.z.toFixed(6)}`)
    }
    expect(seen.size).toBe(SPARKS_PER_HIT)
  })

  it('法線指向各座標軸時都不產生 NaN', () => {
    for (const n of [[1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1]]) {
      sparkDirection(n[0]!, n[1]!, n[2]!, 7, out)
      expect(Number.isFinite(out.length())).toBe(true)
      expect(out.length()).toBeCloseTo(1, 9)
    }
  })

  it('法線為零向量時仍回傳單位向量', () => {
    // 【為什麼會發生】命中事件的法線來自 hitAircraft 的備援路徑，理論上
    // 不會是零 —— 但 NaN 一旦進入實例矩陣，整批火花會靜靜地消失而且完全
    // 不報錯（與 assess.ts 的防護同一個理由）。
    sparkDirection(0, 0, 0, 3, out)
    expect(out.length()).toBeCloseTo(1, 9)
  })
})

describe('createSparks', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const s = createSparks(64)
    expect(s.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    s.object.traverse(() => objects++)
    expect(objects).toBe(1)
    expect(s.object.count).toBe(64)
    s.dispose()
  })

  it('建立時全部是死的、縮放為 0', () => {
    const s = createSparks(16)
    expect(s.live).toBe(0)
    for (let i = 0; i < 16; i++) expect(instance(s.object, i).scale.z).toBe(0)
    s.dispose()
  })

  it('實例矩陣緩衝建立時就配足，之後只寫入不重配', () => {
    const s = createSparks(16)
    const buffer = s.object.instanceMatrix
    s.step(1 / 60)
    expect(s.object.instanceMatrix).toBe(buffer)
    s.dispose()
  })
})

describe('發射（M7 spec §6.1、§6.4）', () => {
  it('一個命中事件噴 SPARKS_PER_HIT 顆', () => {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, 0, 100, 0, 0, 1, 0)
    s.emit(e, 0, 100, 0)
    expect(s.live).toBe(SPARKS_PER_HIT)
    s.dispose()
  })

  it('火星從命中點出發', () => {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, 10, 20, 30, 0, 1, 0)
    s.emit(e, 10, 20, 30)
    s.step(1 / 1000)   // 推一小步讓矩陣寫出來
    const p = instance(s.object, 0).position
    expect(p.distanceTo(new Vector3(10, 20, 30))).toBeLessThan(1)
    s.dispose()
  })

  it('超過 SPARK_CULL 的事件不發射', () => {
    // 【為什麼剔除】0.3 m 的火星在 800 m 上是 0.64 px —— 次像素，看不見。
    // 模擬看不見的粒子是純浪費（M7 spec §6.4）。
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, SPARK_CULL + 100, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    expect(s.live).toBe(0)
    s.dispose()
  })

  it('剛好在剔除距離之內就發射', () => {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, SPARK_CULL - 50, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    expect(s.live).toBe(SPARKS_PER_HIT)
    s.dispose()
  })

  it('池子滿了覆蓋最舊的，不會丟掉新的', () => {
    // 【為什麼是覆蓋最舊】最舊的正好是最淡的那一顆，覆蓋看不出來；
    // 丟棄新的則會在密集命中時整批不見，而那正是最該看到火花的時候。
    const s = createSparks(SPARKS_PER_HIT * 2)
    const e = createImpacts(8)
    for (let k = 0; k < 5; k++) pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    expect(s.live).toBe(SPARKS_PER_HIT * 2)
    s.dispose()
  })
})

describe('步進（M7 spec §6.2）', () => {
  function oneHit() {
    const s = createSparks(64)
    const e = createImpacts(4)
    pushImpact(e, 0, 0, 0, 0, 1, 0)
    s.emit(e, 0, 0, 0)
    return s
  }

  it('壽命走完之後全部死掉並縮成 0', () => {
    const s = oneHit()
    const dt = 1 / 60
    const steps = Math.ceil(SPARK_LIFE / dt) + 2
    for (let i = 0; i < steps; i++) s.step(dt)
    expect(s.live).toBe(0)
    for (let i = 0; i < SPARKS_PER_HIT; i++) {
      expect(instance(s.object, i).scale.z).toBe(0)
    }
    s.dispose()
  })

  it('活著的火星長度等於 SPARK_LENGTH', () => {
    const s = oneHit()
    s.step(1 / 60)
    expect(instance(s.object, 0).scale.z).toBeCloseTo(SPARK_LENGTH, 6)
    s.dispose()
  })

  it('會往上飛（法線朝上）然後被重力拉回來', () => {
    const s = oneHit()
    const dt = 1 / 240
    let peak = -Infinity
    for (let i = 0; i < 48; i++) {
      s.step(dt)
      peak = Math.max(peak, instance(s.object, 0).position.y)
    }
    expect(peak).toBeGreaterThan(0)
    s.dispose()
  })

  it('速度被阻尼掉 —— 不是等速飛走', () => {
    // 時間常數 1/6 = 0.17 s 與壽命 0.2 s 同量級，所以死掉之前速度掉到約 1/e
    const s = oneHit()
    const dt = 1 / 240
    s.step(dt)
    const a = instance(s.object, 0).position.clone()
    s.step(dt)
    const b = instance(s.object, 0).position.clone()
    const first = a.distanceTo(b)
    for (let i = 0; i < 40; i++) s.step(dt)
    const c = instance(s.object, 0).position.clone()
    s.step(dt)
    const d = instance(s.object, 0).position.clone()
    expect(c.distanceTo(d)).toBeLessThan(first)
    s.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const s = oneHit()
    for (let i = 0; i < 300; i++) s.step(1 / 60)
    for (let i = 0; i < SPARKS_PER_HIT; i++) {
      const inst = instance(s.object, i)
      expect(Number.isFinite(inst.position.length())).toBe(true)
      expect(Number.isFinite(inst.scale.length())).toBe(true)
    }
    s.dispose()
  })

  it('dt 為 0 時不動也不壞', () => {
    const s = oneHit()
    s.step(0)
    expect(s.live).toBe(SPARKS_PER_HIT)
    s.dispose()
  })
})
