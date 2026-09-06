import { describe, it, expect } from 'vitest'
import { InstancedMesh, Matrix4, Quaternion, Vector3 } from 'three'
import {
  createDebris,
  DEBRIS_CONE, DEBRIS_COUNT, DEBRIS_LIFE_MAX, DEBRIS_LIFE_MIN,
  DEBRIS_SIZE_MAX, DEBRIS_SIZE_MIN,
  DEBRIS_SPEED,
} from '../../src/render/debris'
import {
  DEBRIS_SMOKE_COUNT, DEBRIS_SMOKE_INTERVAL, DEBRIS_SMOKE_SECONDS_MAX,
} from '../../src/render/smoke'
import { createKills, pushKill } from '../../src/world/kills'
import { bodyColorOf } from '../../src/render/geometry/buildAircraft'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { ALL_SPECS } from '../../src/battle/skirmish'

/**
 * 「這裡處處都是水」。**既有的每一條都建立在那個前提上**
 * —— 落水才噴濺，而這些測試量的正是噴濺。
 */
const WET = (): number => 0

/** 「這裡沒有水」—— 內陸的地面 */
const DRY = (): number => -Infinity

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
    expect(bodyColorOf(BF109K4)).toBe(0x7e8a73)
  })

  /**
   * 【為什麼要掃全表】`BODY_COLORS` 與 `GLB_MODELS`／`BUILDERS` 是三張各自
   * 維護的表，鑰匙都是 `spec.id`。少一格不會在建構期爆，會在**那一架第一次
   * 出現在畫面上**時拋錯 —— 而增援是戰鬥進行中才生成的，那時世界已經被
   * 改到一半，沒有人收拾得了。
   *
   * 這一條守在登記那一層而不是 `reinforce` 裡：`src/battle/` 不得 import
   * `src/render/`，那條規矩比這個檢查更重要。
   */
  it('每一台在編的機種都登記了塗裝', () => {
    for (const spec of ALL_SPECS) {
      expect(() => bodyColorOf(spec), spec.id).not.toThrow()
    }
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
    d.step(0.01, DEEP, WET, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
    d.dispose()
  })

  it('繼承母機速度 —— 一架 150 m/s 的飛機解體，碎片的動量還在', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.1, DEEP, WET, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      // 母機朝 −Z 飛，所以零件的 z 一定變小
      expect(decompose(d.object, i).position.z).toBeLessThan(-5)
    }
    d.dispose()
  })

  it('散射是等向的 —— 扣掉繼承速度之後，四面八方都有', () => {
    // 【設計】零件是 360 度噴射，「往前」的觀感來自繼承母機
    // 速度而不是來自錐（見 DEBRIS_CONE 的註解）。所以這條要斷言的是
    // **殘量真的鋪滿整個球面**，包含往正後方噴的那幾片。
    const d = createDebris(64)
    const e = createKills(4)
    const dt = 1e-4
    const origin = new Vector3(0, 1000, 0)
    const parent = new Vector3(0, 0, -1)
    pushKill(e, origin.x, origin.y, origin.z, parent.x, parent.y, parent.z, 0)
    d.emit(e, WHITE)
    d.step(dt, DEEP, WET, 0)
    const flight = parent.clone().normalize()
    let minDot = 1
    let maxDot = -1
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const v = decompose(d.object, i).position.clone().sub(origin).divideScalar(dt)
      const residual = v.sub(parent).normalize()
      const dot = residual.dot(flight)
      minDot = Math.min(minDot, dot)
      maxDot = Math.max(maxDot, dot)
    }
    // 有往正前方的，也有往正後方的 —— 那就是等向
    expect(maxDot).toBeGreaterThan(0.8)
    expect(minDot).toBeLessThan(-0.8)
    expect(DEBRIS_CONE).toBeCloseTo(Math.PI, 9)
    d.dispose()
  })

  it('散射速度必須小於母機速度 —— 否則「看起來像散狀」就不成立', () => {
    // 【為什麼這條是真的門檻】等向散射之所以在畫面上讀成「往前噴的碎片
    // 雲」，靠的是每一片的淨速度仍然朝前。散射速度一旦超過母機速度，
    // 往後噴的那幾片會真的往後跑，整團就變成往四周炸開的球。
    const d = createDebris(64)
    const e = createKills(4)
    const speed = 140
    pushKill(e, 0, 1000, 0, 0, 0, -speed, 0)
    d.emit(e, WHITE)
    d.step(0.1, DEEP, WET, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      // 每一片都必須在母機前方（z 變小）
      expect(decompose(d.object, i).position.z).toBeLessThan(0)
    }
    expect(DEBRIS_SPEED).toBeLessThan(speed)
    d.dispose()
  })

  it('散射讓零件彼此分開，不是一條線', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    d.step(0.5, DEEP, WET, 0)
    let maxR = 0
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const p = decompose(d.object, i).position
      maxR = Math.max(maxR, Math.hypot(p.x, p.y - 1000))
    }
    expect(maxR).toBeGreaterThan(1)
    d.dispose()
  })

  it('大小落在 MIN 與 MAX 之間', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, WET, 0)
    for (let i = 0; i < DEBRIS_COUNT; i++) {
      const s = decompose(d.object, i).scale.x
      expect(s).toBeGreaterThanOrEqual(DEBRIS_SIZE_MIN - 1e-6)
      expect(s).toBeLessThanOrEqual(DEBRIS_SIZE_MAX + 1e-6)
    }
    d.dispose()
  })

  it('每一次擊墜只有 DEBRIS_SMOKE_COUNT 片冒煙', () => {
    // 【步長取一個間隔】這樣每一片冒煙的正好生一團，事件數就是冒煙的片數。
    // 寫死 0.4 s 的話，間隔一改（0.3 → 0.15）這條就會量到兩倍而紅得莫名。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(DEBRIS_SMOKE_INTERVAL, DEEP, WET, 0)
    expect(d.smokeEvents.count).toBe(DEBRIS_SMOKE_COUNT)
    d.dispose()
  })

  it('停煙的時間逐片不同 —— 不是整批同時收', () => {
    // 【為什麼一次走一個間隔】這樣每一片還在冒煙的正好生一團，
    // `smokeEvents.count` 就等於「這一刻還有幾片在冒」。那個數字必須是
    // 一級一級掉下來的；整批同時停的話它會由滿額直接掉到 0。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 100000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    const counts: number[] = []
    const steps = Math.ceil((DEBRIS_SMOKE_SECONDS_MAX + DEBRIS_SMOKE_INTERVAL)
      / DEBRIS_SMOKE_INTERVAL)
    for (let i = 0; i < steps; i++) {
      d.step(DEBRIS_SMOKE_INTERVAL, DEEP, WET, 0)
      counts.push(d.smokeEvents.count)
    }
    expect(counts[0]).toBe(DEBRIS_SMOKE_COUNT)
    // 走完上界之後一片也不剩
    expect(counts[counts.length - 1]).toBe(0)
    // 中間出現過「部分還在冒」的狀態 —— 那就是逐片隨機
    const partial = counts.filter((c) => c > 0 && c < DEBRIS_SMOKE_COUNT)
    expect(partial.length).toBeGreaterThan(0)
    d.dispose()
  })

  it('停煙不晚於零件退場 —— 沒有一片會在冒著煙的當下消失', () => {
    // 【這條守什麼】超過的話最短命的那幾片會連同煙帶的頭端一起憑空不見。
    // 兩者相等的臨界情況是允許的：停煙與退場落在同一刻。
    expect(DEBRIS_SMOKE_SECONDS_MAX).toBeLessThanOrEqual(DEBRIS_LIFE_MIN)
  })

  it('零件的壽命逐片不同 —— 不會整團同時消失', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 100000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    // 走到壽命範圍的中間：短命的已經走了，長命的還在
    d.step((DEBRIS_LIFE_MIN + DEBRIS_LIFE_MAX) / 2, DEEP, WET, 0)
    expect(d.live).toBeGreaterThan(0)
    expect(d.live).toBeLessThan(DEBRIS_COUNT)
    d.dispose()
  })

  it('翻滾中 —— 姿態隨時間改變', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    d.step(0.01, DEEP, WET, 0)
    const a = decompose(d.object, 0).quaternion.clone()
    d.step(0.3, DEEP, WET, 0)
    const b = decompose(d.object, 0).quaternion
    expect(a.angleTo(b)).toBeGreaterThan(0.1)
    d.dispose()
  })

  it('受重力 —— 會往下掉', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    // 【要停在最短的壽命之內】死掉的格子矩陣是全零、位置讀成 (0,0,0)，
    // 那也小於 1000 —— 跑過頭的話這條會空轉著通過
    d.step(DEBRIS_LIFE_MIN * 0.9, DEEP, WET, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
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
    // 【母機速度要壓過散射速度】等向散射下有幾片是往上噴的；母機只有
    // 50 m/s 的話那幾片在這一步還落不了水，事件數會少個兩三筆。
    pushKill(e, 0, 3, 0, 0, -200, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, FLAT, WET, 0)
    expect(d.sprayEvents.count).toBe(DEBRIS_COUNT)
    expect(d.live).toBe(0)
    d.dispose()
  })

  it('落在陸地上不噴濺，但照樣收得掉', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 3, 0, 0, -200, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, FLAT, DRY, 0)
    expect(d.sprayEvents.count).toBe(0)
    expect(d.live).toBe(0)
    d.dispose()
  })

  it('噴濺事件生在水面上，不是零件的位置', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 100, 3, -200, 0, -200, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, () => 1.75, WET, 0)
    expect(d.sprayEvents.count).toBeGreaterThan(0)
    expect(d.sprayEvents.data[1]).toBeCloseTo(1.75, 4)
    d.dispose()
  })

  it('事件緩衝每一次 step 開頭排空 —— 不會重複發射', () => {
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 3, 0, 0, -200, 0, 0)
    d.emit(e, WHITE)
    d.step(0.2, FLAT, WET, 0)
    expect(d.sprayEvents.count).toBeGreaterThan(0)
    d.step(0.2, FLAT, WET, 0)
    expect(d.sprayEvents.count).toBe(0)
    d.dispose()
  })

  it('碰不到水面的零件也會在 DEBRIS_LIFE_MAX 之後退場', () => {
    // 【為什麼要上限】高空擊墜的零件在壽命之內掉不到海面（阻尼終端速度
    // 24.5 m/s，2 s 只掉約 20 m），飄出海面網格的更是永遠不會入水。沒有
    // 上限的話那些零件會一直留在池子裡。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 0, 0, 0, 0)
    d.emit(e, WHITE)
    for (let i = 0; i < 100; i++) d.step(DEBRIS_LIFE_MAX / 100, DEEP, WET, 0)
    d.step(0.1, DEEP, WET, 0)
    expect(d.live).toBe(0)
    d.dispose()
  })

  it('連續數百幀不產生 NaN', () => {
    // 【為什麼不跑滿壽命】死掉的格子矩陣是全零，對它做 `decompose` 會除以
    // 零而得到 NaN 四元數 —— 那是這個測試輔助函式的性質，不是積分器的
    // 缺陷。所以停在**最短**的壽命之內，並且斷言真的還活著。
    const d = createDebris(64)
    const e = createKills(4)
    pushKill(e, 0, 1000, 0, 30, 10, -150, 0)
    d.emit(e, WHITE)
    const frames = Math.floor(DEBRIS_LIFE_MIN * 0.9 * 60)
    for (let i = 0; i < frames; i++) d.step(1 / 60, DEEP, WET, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
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
    d.step(0.01, DEEP, WET, 0)
    expect(d.live).toBe(DEBRIS_COUNT)
    d.dispose()
  })

  /**
   * 【沒有碎片就不要上傳】`needsUpdate` 一設，three 就整條 92 KB 重傳
   * （`updateRanges` 是空的，走全緩衝那個分支）。一場沒有人被打下來的仗裡
   * 這個池是空的 —— 每幀白傳 92 KB，實測那一下 3.92 ms。
   *
   * 【比 version 不是比 needsUpdate】`needsUpdate` 在 three 只有 setter。
   */
  it('池是空的時候，step 不會標 instanceMatrix 要上傳', () => {
    const d = createDebris()
    const m = d.object as InstancedMesh
    // 開場那一次是必要的（整條要先有值）
    const before = m.instanceMatrix.version
    for (let k = 0; k < 30; k++) d.step(1 / 60, DEEP, WET, k / 60)
    expect(m.instanceMatrix.version).toBe(before)
    d.dispose()
  })

  it('有碎片時照樣上傳，而且碎片收乾淨之後就停下來', () => {
    const d = createDebris()
    const m = d.object as InstancedMesh
    const e = createKills(4)
    pushKill(e, 0, 800, 0, 0, 0, -150, 0)
    d.emit(e, WHITE)
    const before = m.instanceMatrix.version
    d.step(1 / 60, DEEP, WET, 0)
    expect(m.instanceMatrix.version).toBeGreaterThan(before)
    // 【跑到全部過壽】之後就不該再有任何上傳
    for (let k = 0; k < 60 * 30; k++) d.step(1 / 60, DEEP, WET, k / 60)
    expect(d.live).toBe(0)
    const idle = m.instanceMatrix.version
    for (let k = 0; k < 30; k++) d.step(1 / 60, DEEP, WET, k / 60)
    expect(m.instanceMatrix.version).toBe(idle)
    d.dispose()
  })
})
