import { describe, it, expect } from 'vitest'
import {
  InstancedMesh, Matrix4, NormalBlending, Quaternion, ShaderLib, Vector3,
} from 'three'
import {
  createParticles, injectBillboard, particleAlpha, particleSize,
  type ParticleConfig,
} from '../../src/render/particles'

function instance(mesh: InstancedMesh, i: number) {
  const m = new Matrix4()
  mesh.getMatrixAt(i, m)
  const position = new Vector3()
  const quaternion = new Quaternion()
  const scale = new Vector3()
  m.decompose(position, quaternion, scale)
  return { position, quaternion, scale }
}

const CFG: ParticleConfig = {
  capacity: 8,
  blending: NormalBlending,
  life: 1,
  sizeFrom: 2,
  sizeTo: 6,
  gravity: 0,
  drag: 0,
  alphaFrom: 0.5,
  color: (_t, out) => { out.setRGB(0.1, 0.1, 0.1) },
}

describe('particleSize / particleAlpha', () => {
  it('壽命之外都是 0', () => {
    expect(particleSize(-0.1, 1, 2, 6)).toBe(0)
    expect(particleSize(1, 1, 2, 6)).toBe(0)
    expect(particleAlpha(-0.1, 1, 0.5)).toBe(0)
    expect(particleAlpha(1, 1, 0.5)).toBe(0)
  })

  it('尺寸由 from 線性長到 to', () => {
    expect(particleSize(0, 1, 2, 6)).toBeCloseTo(2, 9)
    expect(particleSize(0.5, 1, 2, 6)).toBeCloseTo(4, 9)
  })

  it('alpha 由 alphaFrom 線性淡到 0', () => {
    expect(particleAlpha(0, 1, 0.5)).toBeCloseTo(0.5, 9)
    expect(particleAlpha(0.5, 1, 0.5)).toBeCloseTo(0.25, 9)
  })
})

describe('injectBillboard —— 著色器注入（M8 spec §4.3）', () => {
  it('對 three 真正的 basic 著色器有作用', () => {
    // 【為什麼要對照 ShaderLib 而不是自己編一段假的】String.replace 找不到
    // 目標時**不報錯，只是什麼都不做** —— three 改版重新命名 chunk 的話，
    // 廣告板會靜靜地退化成一面固定朝向的方片，而且沒有任何東西會失敗。
    // 這條測試是唯一擋得住那件事的東西。
    const shader = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    }
    const beforeV = shader.vertexShader
    const beforeF = shader.fragmentShader
    injectBillboard(shader)
    expect(shader.vertexShader).not.toBe(beforeV)
    expect(shader.fragmentShader).not.toBe(beforeF)
    expect(shader.vertexShader).toContain('attribute float aAlpha')
    expect(shader.vertexShader).toContain('instanceMatrix')
    expect(shader.fragmentShader).toContain('vAlpha')
  })

  it('注入之後不再留下原本的 project_vertex include', () => {
    const shader = {
      vertexShader: ShaderLib.basic.vertexShader,
      fragmentShader: ShaderLib.basic.fragmentShader,
    }
    injectBillboard(shader)
    expect(shader.vertexShader).not.toContain('#include <project_vertex>')
  })
})

describe('createParticles', () => {
  it('整池只有一個 InstancedMesh —— 1 個 draw call', () => {
    const p = createParticles(CFG)
    expect(p.object).toBeInstanceOf(InstancedMesh)
    let objects = 0
    p.object.traverse(() => objects++)
    expect(objects).toBe(1)
    expect(p.object.count).toBe(8)
    p.dispose()
  })

  it('建立時全部是死的、縮放為 0', () => {
    const p = createParticles(CFG)
    expect(p.live).toBe(0)
    for (let i = 0; i < 8; i++) expect(instance(p.object, i).scale.x).toBe(0)
    p.dispose()
  })

  it('幾何有 aAlpha 這個逐實例屬性', () => {
    const p = createParticles(CFG)
    const a = p.object.geometry.getAttribute('aAlpha')
    expect(a).toBeDefined()
    expect(a.count).toBe(8)
    p.dispose()
  })

  it('發射一顆就活一顆，位置與初速照傳入值', () => {
    const p = createParticles(CFG)
    p.emit(10, 20, 30, 1, 0, 0)
    p.step(0.5)
    expect(p.live).toBe(1)
    const inst = instance(p.object, 0)
    expect(inst.position.x).toBeCloseTo(10.5, 5)
    expect(inst.position.y).toBeCloseTo(20, 5)
    expect(inst.scale.x).toBeCloseTo(4, 5)
    p.dispose()
  })

  it('恆為單位旋轉、XYZ 同縮放 —— 著色器靠第 0 欄的長度取尺寸', () => {
    // 【為什麼】廣告板是在視圖空間攤平的，實例矩陣只帶位置與尺寸。寫旋轉
    // 或非等向縮放進去，著色器取到的 length(instanceMatrix[0].xyz) 就不再
    // 是直徑。
    const p = createParticles(CFG)
    p.emit(0, 0, 0, 0, 0, 0)
    p.step(0.3)
    const inst = instance(p.object, 0)
    expect(inst.quaternion.angleTo(new Quaternion())).toBeCloseTo(0, 9)
    expect(inst.scale.x).toBeCloseTo(inst.scale.y, 9)
    expect(inst.scale.y).toBeCloseTo(inst.scale.z, 9)
    p.dispose()
  })

  it('重力與阻尼：終端速度收斂到離散不動點', () => {
    // 【為什麼不是 gravity / drag】那是**連續**解。積分器實際跑的是
    //     v ← v·e^(−k·dt) + g·dt
    // 其不動點是 g·dt / (1 − e^(−k·dt))。dt = 0.01、k = 4 時是 5.1006 m/s，
    // 比連續解 5 高 2%。這不是誤差而是離散化本身，所以斷言要對著它。
    const dt = 0.01
    const g = -20
    const k = 4
    const p = createParticles({ ...CFG, life: 100, capacity: 1, gravity: g, drag: k })
    p.emit(0, 0, 0, 0, 0, 0)
    for (let i = 0; i < 2000; i++) p.step(dt)
    const before = instance(p.object, 0).position.y
    p.step(dt)
    const after = instance(p.object, 0).position.y
    const discrete = (g * dt) / (1 - Math.exp(-k * dt))
    // 精度 5 而不是 6：位置存在 Float32Array 裡，2000 步之後的殘差約 3.5e−6
    expect(before - after).toBeCloseTo(-discrete * dt, 5)
    p.dispose()
  })

  it('60 fps 下離散不動點與連續解幾乎一致 —— 所以由終端速度反推阻尼是對的', () => {
    // 【為什麼這條重要】`WRECK_DRAG` 與 `SMOKE_GRAVITY` 都是用連續公式
    // （v_term = g / k）反推出來的。上一條說明離散不動點會偏高，這條說明
    // 在真正會用到的 dt 上那個偏差小到不必理會。
    //
    // 【門檻為什麼是 0.5% 而不是實測值】實測是 0.102%（80 m/s 的設計值
    // 實際跑出 80.08 m/s）。門檻貼著實測值就等於「這個數字不准變」，那不是
    // 這條測試要守的東西；它要守的是「反推公式夠準」。80 與 80.4 m/s 在
    // 畫面上分辨不出來，所以 0.5% 是一個與測量無關、由視覺意義決定的界線。
    const dt = 1 / 60
    const g = -9.80665
    const k = 9.80665 / 80
    const discrete = (g * dt) / (1 - Math.exp(-k * dt))
    const continuous = g / k
    expect(Math.abs(discrete / continuous - 1)).toBeLessThan(0.005)
  })

  it('壽命結束縮成 0，而且格子可以重用', () => {
    const p = createParticles(CFG)
    p.emit(0, 0, 0, 0, 0, 0)
    p.step(CFG.life + 0.01)
    expect(instance(p.object, 0).scale.x).toBe(0)
    expect(p.live).toBe(0)
    p.emit(5, 5, 5, 0, 0, 0)
    p.step(0.1)
    expect(p.live).toBe(1)
    p.dispose()
  })

  it('池子滿了覆蓋最舊的', () => {
    const p = createParticles({ ...CFG, capacity: 2 })
    for (let k = 0; k < 5; k++) p.emit(k, 0, 0, 0, 0, 0)
    p.step(0.1)
    expect(p.live).toBe(2)
    p.dispose()
  })

  it('連續五秒不產生 NaN', () => {
    const p = createParticles({ ...CFG, gravity: -9.81, drag: 1.5 })
    p.emit(0, 0, 0, 3, 4, 5)
    for (let i = 0; i < 300; i++) p.step(1 / 60)
    const inst = instance(p.object, 0)
    expect(Number.isFinite(inst.position.length())).toBe(true)
    expect(Number.isFinite(inst.scale.length())).toBe(true)
    p.dispose()
  })

  it('顏色曲線每幀被呼叫，t 是年齡佔壽命的比例', () => {
    const seen: number[] = []
    const p = createParticles({
      ...CFG, capacity: 1,
      color: (t, out) => { seen.push(t); out.setRGB(1, 1, 1) },
    })
    p.emit(0, 0, 0, 0, 0, 0)
    p.step(0.25)
    p.step(0.25)
    expect(seen[0]).toBeCloseTo(0.25, 6)
    expect(seen[1]).toBeCloseTo(0.5, 6)
    p.dispose()
  })
})
