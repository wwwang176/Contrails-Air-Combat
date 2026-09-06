import { describe, it, expect } from 'vitest'
import { Group, Quaternion, Vector3 } from 'three'
import {
  createWrecks,
  WRECK_DRAG, WRECK_MAX_LIFE, WRECK_SINK_DEPTH, WRECK_SPLASH_COLUMNS,
  WRECK_SPLASH_RADIUS, WRECK_TERMINAL,
} from '../../src/render/wrecks'
import type { AircraftModel } from '../../src/render/geometry/buildAircraft'
import { WRECK_SMOKE_SECONDS } from '../../src/render/smoke'
import { P51D } from '../../src/specs/p51d'

/**
 * 「這裡處處都是水」。**既有的每一條都建立在那個前提上**
 * —— 落水才噴濺，而這些測試量的正是噴濺。
 */
const WET = (): number => 0

/** 「這裡沒有水」—— 內陸的地面 */
const DRY = (): number => -Infinity

const FLAT = (): number => 0
const DEEP = (): number => -100000

interface Fake { model: AircraftModel; spins: { rotation: number; blurred: boolean }[] }

function fakeModel(): Fake {
  const spins: { rotation: number; blurred: boolean }[] = []
  const model: AircraftModel = {
    group: new Group(),
    metrics: { realLength: 9.83, noseZ: -3.4, noseY: 0.3, tipY: 0 },
    eyePoint: new Vector3(),
    wingTip: new Vector3(5.64, 0, 0),
    // 【殘骸不投彈】這個假模型只餵 `render/wrecks.ts`，那一層不讀 bombPoint
    bombPoint: null,
    setPropSpin: (rotation: number, blurred: boolean) => { spins.push({ rotation, blurred }) },
    dispose: () => {},
  }
  return { model, spins }
}

describe('殘骸的接管（M8 spec §8.1）', () => {
  it('初始位置與旋轉取自模型當前的內插姿態，不是傳入的參數', () => {
    // 【為什麼】事件帶的是物理子步的位置，而模型畫在內插後的位置 ——
    // 用事件位置設殘骸，它在誕生的那一幀會跳最多 0.83 m（M8 spec §3.1）。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(123, 4000, -456)
    f.model.group.quaternion.setFromAxisAngle(new Vector3(0, 1, 0), 1.1)
    const before = f.model.group.quaternion.clone()
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    w.step(0.0001, DEEP, WET, 0)
    expect(f.model.group.position.distanceTo(new Vector3(123, 4000, -456))).toBeLessThan(0.01)
    expect(f.model.group.quaternion.angleTo(before)).toBeLessThan(0.01)
  })

  it('接管時螺旋槳停轉並切回葉片', () => {
    // 【為什麼】失去動力的飛機槳是停的。模型 API 本來就支援
    // （assembly.ts 的 setPropSpin），main.ts 的全域 propRotation 不再餵它。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    expect(f.spins.length).toBe(1)
    expect(f.spins[0]!.blurred).toBe(false)
    w.step(0.1, DEEP, WET, 0)
    w.step(0.1, DEEP, WET, 0)
    // step 不再動它 —— 停了就是停了
    expect(f.spins.length).toBe(1)
  })

  it('模型變成可見的 —— 陣亡那一幀 main.ts 可能已經把它藏起來', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.visible = false
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    expect(f.model.group.visible).toBe(true)
  })
})

describe('殘骸的運動（M8 spec §8.2）', () => {
  it('阻尼由終端速度反推', () => {
    expect(WRECK_DRAG).toBeCloseTo(9.80665 / WRECK_TERMINAL, 9)
    expect(WRECK_TERMINAL).toBe(80)
  })

  it('自由落下時速度收斂到終端速度', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 100000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    for (let i = 0; i < 4000; i++) w.step(0.02, DEEP, WET, 0)
    const before = f.model.group.position.y
    w.step(0.02, DEEP, WET, 0)
    const after = f.model.group.position.y
    expect((before - after) / 0.02).toBeCloseTo(WRECK_TERMINAL, 0)
  })

  it('繼承陣亡瞬間的速度', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, -150, 0)
    w.step(0.1, DEEP, WET, 0)
    expect(f.model.group.position.z).toBeLessThan(-10)
  })

  it('翻滾 —— 姿態隨時間改變，而且每一具不一樣', () => {
    const w = createWrecks(4, () => {})
    const a = fakeModel()
    const b = fakeModel()
    a.model.group.position.set(0, 4000, 0)
    b.model.group.position.set(0, 4000, 0)
    w.adopt(a.model, P51D.hitBoxes, 0, 0, 0, 0)
    w.adopt(b.model, P51D.hitBoxes, 0, 0, 0, 1)
    w.step(0.5, DEEP, WET, 0)
    expect(a.model.group.quaternion.angleTo(new Quaternion())).toBeGreaterThan(0.1)
    expect(a.model.group.quaternion.angleTo(b.model.group.quaternion)).toBeGreaterThan(0.1)
  })

  it('持續冒煙', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    w.step(0.5, DEEP, WET, 0)
    expect(w.smokeEvents.count).toBeGreaterThan(3)
  })
})

describe('殘骸入水（M8 spec §9）', () => {
  it('翼尖先碰到水 —— 判定用 hitBox 的角點而不是重心', () => {
    // 繞 Z 轉 −90°，右翼（機體 +X）被轉到正下方。重心還在水面上方 4 m，
    // 但翼尖（機體 x = 5.65）已經碰到水了 —— 用重心判定的話水花會晚一整個
    // 翼展才出現（M8 spec §9.1）。
    //
    // 【姿態必須在 adopt 之前擺好】adopt 會把當時的 quaternion 存成翻滾的
    // 基準；step 每次都用 tumble(基準, age) 覆寫 group.quaternion。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4, 0)
    f.model.group.quaternion.setFromAxisAngle(new Vector3(0, 0, 1), -Math.PI / 2)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    // 極小的 dt 讓角速度還來不及把姿態轉走
    w.step(0.0001, FLAT, WET, 0)
    expect(w.sprayEvents.count).toBe(1)
  })

  it('同樣的高度、機體水平時還碰不到水 —— 對照組', () => {
    // 上一條若改用重心判定也會通過（重心 4 m 也不算低），所以要有這一條
    // 對照：姿態水平時 4 m 高確實碰不到水，可見上一條測到的是翼尖。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    w.step(0.0001, FLAT, WET, 0)
    expect(w.sprayEvents.count).toBe(0)
  })

  it('接觸時同時噴濺與生一圈水柱', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.05, FLAT, WET, 0)
    expect(w.sprayEvents.count).toBe(1)
    expect(w.splashEvents.count).toBe(WRECK_SPLASH_COLUMNS)
  })

  /**
   * 【落地與落水收得一樣快，但只有落水噴水】`heightAt` 決定「碰到地面了
   * 沒」，`waterAt` 決定「那是水嗎」。共用一支的話摔在島上會噴水柱 ——
   * 群島早就有這個缺陷，純內陸則是每一次墜毀都會發生。
   */
  it('落在陸地上不噴濺、不生水柱，但照樣收得掉', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.05, FLAT, DRY, 0)
    expect(w.sprayEvents.count).toBe(0)
    expect(w.splashEvents.count).toBe(0)
    // 【沉得淺，所以幾步之內就收掉】陸地上沒有殘骸的視覺
    for (let i = 0; i < 40; i++) w.step(0.05, FLAT, DRY, 0)
    expect(w.live).toBe(0)
  })

  it('水柱散佈在接觸點周圍，不是疊在同一點', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(100, 0.5, -200)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.05, FLAT, WET, 0)
    const d = w.splashEvents.data
    let maxR = 0
    const seen = new Set<string>()
    for (let k = 0; k < w.splashEvents.count; k++) {
      const x = d[k * 6]!
      const z = d[k * 6 + 2]!
      seen.add(`${x.toFixed(3)},${z.toFixed(3)}`)
      maxR = Math.max(maxR, Math.hypot(x - 100, z + 200))
    }
    expect(seen.size).toBe(WRECK_SPLASH_COLUMNS)
    expect(maxR).toBeGreaterThan(0.5)
    // 散佈半徑是相對接觸點量的，而接觸點可能離重心一個翼展
    expect(maxR).toBeLessThanOrEqual(WRECK_SPLASH_RADIUS + 12)
  })

  it('入水之後只噴一次 —— 不會每幀都噴', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.05, FLAT, WET, 0)
    expect(w.sprayEvents.count).toBe(1)
    w.step(0.05, FLAT, WET, 0)
    expect(w.sprayEvents.count).toBe(0)
  })

  it('入水之後停止冒煙', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    w.step(0.5, FLAT, WET, 0)
    // 接觸的那一幀仍然冒了煙（冒煙排在接觸判定之前），下一幀起就停
    expect(w.smokeEvents.count).toBeGreaterThan(0)
    w.step(0.5, FLAT, WET, 0)
    expect(w.smokeEvents.count).toBe(0)
  })

  it('沉到夠深就釋放模型', () => {
    // 【為什麼看不見還要沉】海面是不透明的（ocean.ts:52），沉下去就被水
    // 擋住 —— 這個深度門檻純粹是回收用的（M8 spec §9.3）。
    const released: AircraftModel[] = []
    const w = createWrecks(4, (m) => released.push(m))
    const f = fakeModel()
    f.model.group.position.set(0, 0.5, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, -50, 0, 0)
    for (let i = 0; i < 200; i++) w.step(0.05, FLAT, WET, 0)
    expect(f.model.group.position.y).toBeLessThan(-WRECK_SINK_DEPTH + 1)
    expect(released.length).toBe(1)
    expect(released[0]).toBe(f.model)
    expect(w.live).toBe(0)
  })

  it('永遠碰不到水面的殘骸在 WRECK_MAX_LIFE 之後也會被釋放', () => {
    const released: AircraftModel[] = []
    const w = createWrecks(4, (m) => released.push(m))
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)
    for (let i = 0; i < 200; i++) w.step(WRECK_MAX_LIFE / 100, DEEP, WET, 0)
    expect(released.length).toBe(1)
    expect(w.live).toBe(0)
  })

  it('釋放之後格子可以重用', () => {
    const w = createWrecks(1, () => {})
    const a = fakeModel()
    const b = fakeModel()
    a.model.group.position.set(0, 0.5, 0)
    w.adopt(a.model, P51D.hitBoxes, 0, -50, 0, 0)
    for (let i = 0; i < 200; i++) w.step(0.05, FLAT, WET, 0)
    expect(w.live).toBe(0)
    b.model.group.position.set(0, 4000, 0)
    w.adopt(b.model, P51D.hitBoxes, 0, 0, 0, 1)
    w.step(0.05, DEEP, WET, 0)
    expect(w.live).toBe(1)
  })

  it('連續兩分鐘不產生 NaN', () => {
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 30, 5, -150, 0)
    for (let i = 0; i < 7200; i++) w.step(1 / 60, DEEP, WET, 0)
    expect(Number.isFinite(f.model.group.position.length())).toBe(true)
    expect(Number.isFinite(f.model.group.quaternion.length())).toBe(true)
  })
})

describe('冒煙的時間上限（人工驗收裁決）', () => {
  it('超過 WRECK_SMOKE_SECONDS 之後就不再冒煙，即使還在空中', () => {
    // 【為什麼要有上限】殘骸的壽命是 120 s（WRECK_MAX_LIFE），從 4,000 m
    // 掉到海面要三十秒以上。整段都冒煙的話，一場 20v20 的天空最後會被
    // 一堆長得看不到頭的煙柱塞滿，而那不是「剛被打下來」的訊號 ——
    // 專案負責人裁決：最多 4 秒。
    const w = createWrecks(4, () => {})
    const f = fakeModel()
    f.model.group.position.set(0, 4000, 0)
    w.adopt(f.model, P51D.hitBoxes, 0, 0, 0, 0)

    // DEEP 讓它永遠碰不到水 —— 這一條要驗的是時間上限，不是入水
    let emitted = 0
    for (let t = 0; t < WRECK_SMOKE_SECONDS - 0.5; t += 0.5) {
      w.step(0.5, DEEP, WET, 0)
      emitted += w.smokeEvents.count
    }
    expect(emitted).toBeGreaterThan(0)

    // 跨過上限之後
    w.step(1, DEEP, WET, 0)
    w.step(0.5, DEEP, WET, 0)
    expect(w.smokeEvents.count).toBe(0)
    w.step(5, DEEP, WET, 0)
    expect(w.smokeEvents.count).toBe(0)
  })

  it('上限是 4 秒', () => {
    expect(WRECK_SMOKE_SECONDS).toBe(4)
  })
})
