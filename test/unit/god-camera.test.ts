import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import {
  createGodCameraState, enterGodCamera, stepGodCamera, godCameraTarget,
  DEFAULT_GOD_CAMERA, type GodCameraInput,
} from '../../src/camera/godCamera'

const cfg = DEFAULT_GOD_CAMERA
const DT = 1 / 60

/** 全部放開的輸入。每一條測試自己打開要用的那幾個 */
function idle(over: Partial<GodCameraInput> = {}): GodCameraInput {
  return {
    forward: false, back: false, left: false, right: false,
    up: false, down: false, boost: false,
    lookX: 0, lookY: 0,
    ...over,
  }
}

describe('stepGodCamera：移動', () => {
  /**
   * 【這一條是這個模式的定義】專案負責人裁定「保持高度的平面式」：
   * W/S/A/D 只在水平面上走，鏡頭的俯仰完全不參與。少了這一條，俯視著
   * 按 W 就會一頭栽進海裡 —— 而 45° 進場俯視正是預設姿態。
   */
  it('水平移動完全不受 pitch 影響', () => {
    const flat = createGodCameraState()
    const down = createGodCameraState()
    down.pitch = -80 * (Math.PI / 180)
    stepGodCamera(flat, idle({ forward: true }), 1, cfg)
    stepGodCamera(down, idle({ forward: true }), 1, cfg)
    expect(down.position.x).toBe(flat.position.x)
    expect(down.position.y).toBe(flat.position.y)
    expect(down.position.z).toBe(flat.position.z)
  })

  it('yaw = 0 時 W 往 −Z 走', () => {
    const s = createGodCameraState()
    stepGodCamera(s, idle({ forward: true }), 1, cfg)
    expect(s.position.z).toBeCloseTo(-cfg.moveSpeed, 6)
    expect(s.position.x).toBeCloseTo(0, 6)
  })

  it('yaw = 90° 時 W 往 +X 走', () => {
    const s = createGodCameraState()
    s.yaw = Math.PI / 2
    stepGodCamera(s, idle({ forward: true }), 1, cfg)
    expect(s.position.x).toBeCloseTo(cfg.moveSpeed, 6)
    expect(s.position.z).toBeCloseTo(0, 6)
  })

  it('yaw = 0 時 D 往 +X 走', () => {
    const s = createGodCameraState()
    stepGodCamera(s, idle({ right: true }), 1, cfg)
    expect(s.position.x).toBeCloseTo(cfg.moveSpeed, 6)
    expect(s.position.z).toBeCloseTo(0, 6)
  })

  /**
   * 【對角線要正規化】不正規化的話斜著走比直著走快 41%。那是一個會被
   * 當成「手感很怪」而查不出原因的 bug。
   */
  it('W + D 的水平速率等於單獨按 W', () => {
    const one = createGodCameraState()
    const two = createGodCameraState()
    stepGodCamera(one, idle({ forward: true }), 1, cfg)
    stepGodCamera(two, idle({ forward: true, right: true }), 1, cfg)
    const a = Math.hypot(one.position.x, one.position.z)
    const b = Math.hypot(two.position.x, two.position.z)
    expect(b).toBeCloseTo(a, 6)
  })

  /** 【相反的兩個鍵互相抵銷】W+S 同時按住不該往任何一邊漂 */
  it('W + S 互相抵銷', () => {
    const s = createGodCameraState()
    stepGodCamera(s, idle({ forward: true, back: true }), 1, cfg)
    expect(s.position.x).toBe(0)
    expect(s.position.z).toBe(0)
  })

  /**
   * 【垂直是獨立的一軸，刻意不與水平一起正規化】Q/E 像直升機的總距，
   * 與「往哪裡飛」是兩個不同的意圖。所以 W+E 的合速率是 √2 倍，那是
   * 設計而不是漏掉正規化 —— 上面那一條守著水平那一半。
   */
  it('E 只改 y，不動 x/z', () => {
    const s = createGodCameraState()
    s.position.set(100, 1000, 200)
    stepGodCamera(s, idle({ up: true }), 1, cfg)
    expect(s.position.x).toBe(100)
    expect(s.position.z).toBe(200)
    expect(s.position.y).toBeCloseTo(1000 + cfg.moveSpeed, 6)
  })

  it('Q 讓 y 下降', () => {
    const s = createGodCameraState()
    s.position.set(0, 5000, 0)
    stepGodCamera(s, idle({ down: true }), 1, cfg)
    expect(s.position.y).toBeCloseTo(5000 - cfg.moveSpeed, 6)
  })

  /** 【Shift 兩軸一起加速】只加速水平的話，加速中想爬升會變成幾乎水平的長弧 */
  it('Shift 讓水平與垂直速度都乘上 boostFactor', () => {
    const h = createGodCameraState()
    const v = createGodCameraState()
    v.position.set(0, 1000, 0)
    stepGodCamera(h, idle({ forward: true, boost: true }), 1, cfg)
    stepGodCamera(v, idle({ up: true, boost: true }), 1, cfg)
    expect(-h.position.z).toBeCloseTo(cfg.moveSpeed * cfg.boostFactor, 6)
    expect(v.position.y - 1000).toBeCloseTo(cfg.moveSpeed * cfg.boostFactor, 6)
  })

  it('沒有輸入時完全不動', () => {
    const s = createGodCameraState()
    s.position.set(11, 2222, -33)
    s.yaw = 0.4
    s.pitch = -0.3
    stepGodCamera(s, idle(), 1, cfg)
    expect(s.position.x).toBe(11)
    expect(s.position.y).toBe(2222)
    expect(s.position.z).toBe(-33)
    expect(s.yaw).toBe(0.4)
    expect(s.pitch).toBe(-0.3)
  })

  /** 【速度是每秒】兩個半步與一個整步走一樣遠，否則幀率會改變手感 */
  it('位移正比於 dt', () => {
    const one = createGodCameraState()
    const two = createGodCameraState()
    stepGodCamera(one, idle({ forward: true }), 1, cfg)
    stepGodCamera(two, idle({ forward: true }), 0.5, cfg)
    stepGodCamera(two, idle({ forward: true }), 0.5, cfg)
    expect(two.position.z).toBeCloseTo(one.position.z, 6)
  })
})

describe('stepGodCamera：夾擠', () => {
  it('y 不會低於 minAltitude', () => {
    const s = createGodCameraState()
    s.position.set(0, cfg.minAltitude + 1, 0)
    for (let i = 0; i < 240; i++) stepGodCamera(s, idle({ down: true }), DT, cfg)
    expect(s.position.y).toBe(cfg.minAltitude)
  })

  it('y 不會高於 maxAltitude', () => {
    const s = createGodCameraState()
    s.position.set(0, cfg.maxAltitude - 1, 0)
    for (let i = 0; i < 240; i++) stepGodCamera(s, idle({ up: true }), DT, cfg)
    expect(s.position.y).toBe(cfg.maxAltitude)
  })

  /**
   * 【pitch 一定要夾】不夾的話鏡頭會翻過天頂，而「上」的定義在那一瞬
   * 反過來 —— 之後每一個滑鼠位移都是反的。
   */
  it('pitch 夾在 ±pitchLimit', () => {
    const up = createGodCameraState()
    const down = createGodCameraState()
    for (let i = 0; i < 100; i++) {
      stepGodCamera(up, idle({ lookY: 1 }), DT, cfg)
      stepGodCamera(down, idle({ lookY: -1 }), DT, cfg)
    }
    expect(up.pitch).toBe(cfg.pitchLimit)
    expect(down.pitch).toBe(-cfg.pitchLimit)
  })

  /** 【yaw 不夾也不取模】取模會在 ±π 的邊界上製造一個沒有必要的不連續 */
  it('yaw 可以無限累積', () => {
    const s = createGodCameraState()
    for (let i = 0; i < 100; i++) stepGodCamera(s, idle({ lookX: 1 }), DT, cfg)
    expect(s.yaw).toBeGreaterThan(Math.PI)
  })

  it('滑鼠右移讓 yaw 增加、上移讓 pitch 增加', () => {
    const s = createGodCameraState()
    stepGodCamera(s, idle({ lookX: 0.1, lookY: 0.1 }), DT, cfg)
    expect(s.yaw).toBeGreaterThan(0)
    expect(s.pitch).toBeGreaterThan(0)
  })

  /**
   * 【視角轉動不吃 dt】滑鼠位移本身已經是「這一幀移了多少」，再乘一次
   * dt 會讓靈敏度隨幀率變化 —— 既有的 `input/aim.ts` 也是這樣處理的。
   */
  it('同樣的滑鼠位移，dt 不影響轉了多少', () => {
    const a = createGodCameraState()
    const b = createGodCameraState()
    stepGodCamera(a, idle({ lookX: 0.1 }), 1, cfg)
    stepGodCamera(b, idle({ lookX: 0.1 }), 0.001, cfg)
    expect(a.yaw).toBe(b.yaw)
  })
})

describe('enterGodCamera', () => {
  it('放在自機正上方 entryHeight、朝自機航向、俯角 entryPitch', () => {
    const s = createGodCameraState()
    enterGodCamera(s, new Vector3(500, 4000, -700), 1.2, cfg)
    expect(s.position.x).toBe(500)
    expect(s.position.z).toBe(-700)
    expect(s.position.y).toBeCloseTo(4000 + cfg.entryHeight, 6)
    expect(s.yaw).toBe(1.2)
    expect(s.pitch).toBeCloseTo(-cfg.entryPitch, 6)
  })

  /** 【進場也要夾】自機在升限附近時 +800 會超過 maxAltitude */
  it('進場高度也受 maxAltitude 夾擠', () => {
    const s = createGodCameraState()
    enterGodCamera(s, new Vector3(0, cfg.maxAltitude, 0), 0, cfg)
    expect(s.position.y).toBe(cfg.maxAltitude)
  })

  /** 【每次進場都重新定位】上一次離開時的姿態不得殘留 */
  it('進場會覆蓋掉上一次的姿態', () => {
    const s = createGodCameraState()
    s.position.set(9999, 9999, 9999)
    s.yaw = 3
    s.pitch = 1
    enterGodCamera(s, new Vector3(0, 4000, 0), 0, cfg)
    expect(s.position.x).toBe(0)
    expect(s.yaw).toBe(0)
    expect(s.pitch).toBeCloseTo(-cfg.entryPitch, 6)
  })
})

describe('godCameraTarget', () => {
  it('yaw = 0、pitch = 0 時注視點在 −Z', () => {
    const s = createGodCameraState()
    s.position.set(10, 20, 30)
    const out = godCameraTarget(s, new Vector3())
    expect(out.x).toBeCloseTo(10, 6)
    expect(out.y).toBeCloseTo(20, 6)
    expect(out.z).toBeLessThan(30)
  })

  it('俯角為負時注視點低於鏡頭', () => {
    const s = createGodCameraState()
    s.position.set(0, 1000, 0)
    s.pitch = -Math.PI / 4
    const out = godCameraTarget(s, new Vector3())
    expect(out.y).toBeLessThan(1000)
  })

  /**
   * 【與 `headingFromOrientation` 同一個約定】yaw = π/2 時看的是 +X。
   * 兩邊不一致的話，進場的朝向會與自機航向差 90°，而那是一個「看起來
   * 只是方向怪怪的」、很難歸因的 bug。
   */
  it('yaw = π/2 時注視點在 +X', () => {
    const s = createGodCameraState()
    s.yaw = Math.PI / 2
    const out = godCameraTarget(s, new Vector3())
    expect(out.x).toBeGreaterThan(0)
    expect(Math.abs(out.z)).toBeLessThan(1e-6)
  })

  /** 【寫進呼叫端的向量】熱路徑不配置 */
  it('回傳的就是傳進去的那個物件', () => {
    const s = createGodCameraState()
    const out = new Vector3()
    expect(godCameraTarget(s, out)).toBe(out)
  })
})

describe('決定性', () => {
  it('同一串輸入跑兩次，逐位元相同', () => {
    const a = createGodCameraState()
    const b = createGodCameraState()
    const seq = idle({ forward: true, right: true, up: true, lookX: 0.03, lookY: -0.02 })
    for (let i = 0; i < 500; i++) {
      stepGodCamera(a, seq, DT, cfg)
      stepGodCamera(b, seq, DT, cfg)
    }
    expect(a.position.x).toBe(b.position.x)
    expect(a.position.y).toBe(b.position.y)
    expect(a.position.z).toBe(b.position.z)
    expect(a.yaw).toBe(b.yaw)
    expect(a.pitch).toBe(b.pitch)
  })

  /** 【輸入物件不得被改到】呼叫端會重用同一個物件 */
  it('不改動傳進去的輸入物件', () => {
    const s = createGodCameraState()
    const input = idle({ forward: true, lookX: 0.1 })
    const before = JSON.stringify(input)
    stepGodCamera(s, input, DT, cfg)
    expect(JSON.stringify(input)).toBe(before)
  })
})
