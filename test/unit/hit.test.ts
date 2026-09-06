import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import {
  boundingRadius, createHitResult, hitAircraft, makeHitBox, segmentBox,
  segmentPointDistanceSq, pointBoxDistance, HIT_PARTS, NO_HIT, PART_MULTIPLIER,
  type FaceNormal, type HitBox,
} from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { DEG } from '../../src/core/math'

/** 給 boundingRadius 用的巢狀盒（與 hitAircraft 那一組同形，但需在外層可見）。 */
const NESTED_FOR_RADIUS: HitBox[] = [
  makeHitBox('fuselage', [-1, -1, -4], [1, 1, 4]),
  makeHitBox('cockpit', [-0.5, 0, -0.5], [0.5, 1, 0.5]),
  makeHitBox('wingRight', [1, -0.3, -1], [5, 0.3, 1]),
]

const UNIT = makeHitBox('fuselage', [-1, -1, -1], [1, 1, 1])

describe('PART_MULTIPLIER', () => {
  it('六個部位齊全，數值對得上 spec §6.2', () => {
    expect(HIT_PARTS).toHaveLength(6)
    expect(PART_MULTIPLIER.cockpit).toBe(2.5)
    expect(PART_MULTIPLIER.engine).toBe(2.0)
    expect(PART_MULTIPLIER.tail).toBe(1.2)
    expect(PART_MULTIPLIER.fuselage).toBe(1.0)
    expect(PART_MULTIPLIER.wingLeft).toBe(0.7)
    expect(PART_MULTIPLIER.wingRight).toBe(0.7)
  })

  it('座艙是最高倍率，機翼是最低', () => {
    const vals = HIT_PARTS.map((p) => PART_MULTIPLIER[p])
    expect(Math.max(...vals)).toBe(PART_MULTIPLIER.cockpit)
    expect(Math.min(...vals)).toBe(PART_MULTIPLIER.wingLeft)
  })
})

describe('makeHitBox', () => {
  it('以 min/max 描述，內部存中心與半尺寸', () => {
    const b = makeHitBox('tail', [-2, 0, 4], [2, 1, 6])
    expect(b.center.toArray()).toEqual([0, 0.5, 5])
    expect(b.half.toArray()).toEqual([2, 0.5, 1])
  })
})

describe('segmentBox（slab 法）', () => {
  it('正面穿過盒心：t 等於進入面的參數', () => {
    // 由 z = −5 走到 z = +5，盒面在 z = −1 → t = 4/10
    expect(segmentBox(0, 0, -5, 0, 0, 5, UNIT)).toBeCloseTo(0.4, 9)
  })

  it('起點在盒內回傳 0', () => {
    expect(segmentBox(0, 0, 0, 0, 0, 5, UNIT)).toBe(0)
  })

  it('線段完全在盒內回傳 0', () => {
    expect(segmentBox(-0.5, 0, 0, 0.5, 0, 0, UNIT)).toBe(0)
  })

  it('線段太短、還沒走到盒子 → 未命中', () => {
    // 這是彈丸判定最常見的情形：一步只走 3.7 m，目標還在 500 m 外。
    expect(segmentBox(0, 0, -5, 0, 0, -2, UNIT)).toBe(NO_HIT)
  })

  it('線段從盒子另一側之外開始且方向背離 → 未命中', () => {
    expect(segmentBox(0, 0, 5, 0, 0, 2, UNIT)).toBe(NO_HIT)
  })

  it('正好擦過角落算命中', () => {
    // 沿 z 穿過 (x, y) = (1, 1) 這條稜線
    expect(segmentBox(1, 1, -5, 1, 1, 5, UNIT)).toBeCloseTo(0.4, 9)
  })

  it('擦過角落外側一絲即未命中', () => {
    expect(segmentBox(1.0001, 1, -5, 1.0001, 1, 5, UNIT)).toBe(NO_HIT)
  })

  it('平行於某軸且該軸在盒外 → 未命中（不可退化成除以 0）', () => {
    // dx = dy = 0，y = 2 永遠在 [−1, 1] 之外。缺陷版本會得到 NaN 比較，
    // 而 NaN 的比較恆為 false，於是靜靜地回報命中。
    const t = segmentBox(0, 2, -5, 0, 2, 5, UNIT)
    expect(t).toBe(NO_HIT)
  })

  it('平行於某軸且該軸在盒內 → 照常判定其餘兩軸', () => {
    expect(segmentBox(0, 0.5, -5, 0, 0.5, 5, UNIT)).toBeCloseTo(0.4, 9)
  })

  it('零長度線段：在盒內命中、在盒外未命中', () => {
    expect(segmentBox(0, 0, 0, 0, 0, 0, UNIT)).toBe(0)
    expect(segmentBox(0, 0, 5, 0, 0, 5, UNIT)).toBe(NO_HIT)
  })
})

describe('hitAircraft', () => {
  /** 一組刻意巢狀的盒子：座艙整個包在機身裡面。 */
  const NESTED: HitBox[] = [
    makeHitBox('fuselage', [-1, -1, -4], [1, 1, 4]),
    makeHitBox('cockpit', [-0.5, 0, -0.5], [0.5, 1, 0.5]),
    makeHitBox('wingRight', [1, -0.3, -1], [5, 0.3, 1]),
  ]
  const ORIGIN = new Vector3()
  const IDENTITY = new Quaternion()
  const out = createHitResult()

  it('打不到就回傳 false，且不動 out', () => {
    out.t = 123
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, 10, -5), new Vector3(0, 10, 5), out))
      .toBe(false)
    expect(out.t).toBe(123)
  })

  it('t 取最近的進入點', () => {
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, 0.5, -10), new Vector3(0, 0.5, 10), out)
    // 機身盒面在 z = −4 → t = 6/20 = 0.3
    expect(out.t).toBeCloseTo(0.3, 9)
  })

  it('巢狀盒取**最高倍率**，否則座艙的 ×2.5 是死碼', () => {
    // 【這是本專案偏離 spec §6.1「取最近命中」的地方】座艙盒整個包在機身
    // 盒裡面，從正面來的彈丸一定先進機身盒。取最近的話座艙倍率永遠選不到
    // ——與 M1 那次「黑視起點等於過載限制器上限」是同一類死碼缺陷。
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, 0.5, -10), new Vector3(0, 0.5, 10), out)
    expect(out.part).toBe('cockpit')
    expect(out.multiplier).toBe(2.5)
  })

  it('只穿過機身下半（座艙盒之外）時倍率是機身的', () => {
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(0, -0.5, -10), new Vector3(0, -0.5, 10), out)
    expect(out.part).toBe('fuselage')
    expect(out.multiplier).toBe(1.0)
  })

  it('打在機翼上就是機翼', () => {
    hitAircraft(NESTED, ORIGIN, IDENTITY, new Vector3(3, 0, -10), new Vector3(3, 0, 10), out)
    expect(out.part).toBe('wingRight')
  })

  it('平移：判定跟著飛機走', () => {
    const pos = new Vector3(1000, 200, -3000)
    const s0 = new Vector3(1000, 0.5, -3010)
    const s1 = new Vector3(1000, 0.5, -2990)
    expect(hitAircraft(NESTED, pos, IDENTITY, s0, s1, out)).toBe(false)
    s0.y += 200
    s1.y += 200
    expect(hitAircraft(NESTED, pos, IDENTITY, s0, s1, out)).toBe(true)
  })

  /**
   * 【這一條是「AABB 定義在機體座標」的核心行為】盒子是機體固定的，
   * 判定前要把線段轉進機體座標——等價於世界座標的 OBB。若忘了轉，
   * 飛機一滾轉，機翼的判定就會失真（薄板轉成斜的，AABB 會漲大）。
   */
  it('滾轉 90° 之後，原本打中右翼的世界線段改為打不到', () => {
    const rolled = new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), 90 * DEG)
    const s0 = new Vector3(3, 0, -10)
    const s1 = new Vector3(3, 0, 10)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    expect(hitAircraft(NESTED, ORIGIN, rolled, s0, s1, out)).toBe(false)
    // 右翼轉到了正下方（機體 +X → 世界 −Y）
    expect(hitAircraft(NESTED, ORIGIN, rolled, new Vector3(0, -3, -10), new Vector3(0, -3, 10), out))
      .toBe(true)
    expect(out.part).toBe('wingRight')
  })

  it('連續呼叫不配置：重複一萬次不拋錯且結果一致', () => {
    const s0 = new Vector3(0, 0.5, -10)
    const s1 = new Vector3(0, 0.5, 10)
    let last = -1
    for (let i = 0; i < 10000; i++) {
      hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)
      if (i > 0) expect(out.t).toBe(last)
      last = out.t
    }
  })
})

describe('boundingRadius（命中判定的粗篩）', () => {
  it('包得住盒子的每一個角 —— 算小了會靜靜漏掉命中', () => {
    // 這是最佳化的正確性條件，不是效能指標。半徑若小於某個角落，
    // 那個方向來的彈丸會被粗篩直接跳過：玩家看到曳光彈穿過機翼卻不扣血，
    // 而且只在特定角度發生。
    for (const boxes of [NESTED_FOR_RADIUS, P51D.hitBoxes, BF109K4.hitBoxes]) {
      const r = boundingRadius(boxes)
      for (const b of boxes) {
        for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
          const corner = new Vector3(
            b.center.x + sx * b.half.x,
            b.center.y + sy * b.half.y,
            b.center.z + sz * b.half.z,
          )
          expect(corner.length()).toBeLessThanOrEqual(r + 1e-9)
        }
      }
    }
  })

  it('不是隨便放大的上界：至少有一個角剛好碰到球面', () => {
    // 上界放得太寬的話粗篩就沒作用了。
    const r = boundingRadius(P51D.hitBoxes)
    let best = 0
    for (const b of P51D.hitBoxes) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
        best = Math.max(best, new Vector3(
          b.center.x + sx * b.half.x, b.center.y + sy * b.half.y, b.center.z + sz * b.half.z,
        ).length())
      }
    }
    expect(r).toBeCloseTo(best, 9)
  })
})

describe('segmentPointDistanceSq', () => {
  it('垂足落在線段內時取垂直距離', () => {
    expect(segmentPointDistanceSq(-5, 0, 0, 5, 0, 0, 0, 3, 0)).toBeCloseTo(9, 9)
  })

  it('垂足在線段外時取端點距離（不可外推）', () => {
    // 外推的話遠方的彈丸會被誤判成很近，粗篩失效但不會出錯；
    // 反過來若端點沒夾好，近處的命中會被跳過——那才是致命的。
    expect(segmentPointDistanceSq(0, 0, 0, 1, 0, 0, 5, 0, 0)).toBeCloseTo(16, 9)
    expect(segmentPointDistanceSq(0, 0, 0, 1, 0, 0, -3, 0, 0)).toBeCloseTo(9, 9)
  })

  it('點就在線段上時為 0', () => {
    expect(segmentPointDistanceSq(0, 0, 0, 10, 0, 0, 4, 0, 0)).toBeCloseTo(0, 12)
  })

  it('零長度線段退化成點到點', () => {
    expect(segmentPointDistanceSq(1, 2, 3, 1, 2, 3, 1, 2, 6)).toBeCloseTo(9, 9)
  })

  it('與 hitAircraft 一致：粗篩通過是命中的必要條件', () => {
    // 粗篩若比實際命中還嚴，就會漏掉；隨機掃一批線段確認沒有
    // 「hitAircraft 說中、粗篩卻說跳過」的組合。
    const out = createHitResult()
    const origin = new Vector3()
    const q = new Quaternion()
    const r2 = boundingRadius(P51D.hitBoxes) ** 2
    let hits = 0
    for (let i = 0; i < 4000; i++) {
      const a = (i / 4000) * Math.PI * 2
      const s0 = new Vector3(Math.cos(a) * 30, ((i % 61) - 30) * 0.2, Math.sin(a) * 30)
      const s1 = new Vector3(-s0.x * 0.2, s0.y, -s0.z * 0.2)
      if (!hitAircraft(P51D.hitBoxes, origin, q, s0, s1, out)) continue
      hits++
      expect(segmentPointDistanceSq(
        s0.x, s0.y, s0.z, s1.x, s1.y, s1.z, 0, 0, 0,
      )).toBeLessThanOrEqual(r2)
    }
    expect(hits).toBeGreaterThan(100)   // 這批線段真的打中了不少，斷言才有意義
  })
})

describe('segmentBox 的入射面法線（M7 spec §3.1）', () => {
  const face: FaceNormal = { axis: -1, sign: 0 }

  it('沿 +Z 穿過時從低 Z 面進入 → 法線 −Z', () => {
    // UNIT 是 [-1,-1,-1]..[1,1,1]。從 z = −5 射向 z = +5，在 z = −1 進入
    expect(segmentBox(0, 0, -5, 0, 0, 5, UNIT, face)).toBeCloseTo(0.4, 9)
    expect(face.axis).toBe(2)
    expect(face.sign).toBe(-1)
  })

  it('沿 −Z 穿過時從高 Z 面進入 → 法線 +Z', () => {
    expect(segmentBox(0, 0, 5, 0, 0, -5, UNIT, face)).toBeCloseTo(0.4, 9)
    expect(face.axis).toBe(2)
    expect(face.sign).toBe(1)
  })

  it('沿 +X 與 +Y 各自給對的軸', () => {
    segmentBox(-5, 0, 0, 5, 0, 0, UNIT, face)
    expect(face.axis).toBe(0)
    expect(face.sign).toBe(-1)

    segmentBox(0, 5, 0, 0, -5, 0, UNIT, face)
    expect(face.axis).toBe(1)
    expect(face.sign).toBe(1)
  })

  it('起點就在盒內時沒有入射面', () => {
    // 【為什麼要有這個狀態】tMin 保持 0，三個軸都沒有抬高過它 ——
    // 「從哪一面進來」這個問題在這個情形下沒有答案。硬給一個會讓火花
    // 往任意方向噴，而那個錯誤看起來像是法線算錯。
    expect(segmentBox(0, 0, 0, 0, 0, 5, UNIT, face)).toBe(0)
    expect(face.axis).toBe(-1)
  })

  it('未命中時不動 outFace', () => {
    face.axis = 7
    expect(segmentBox(0, 5, -5, 0, 5, 5, UNIT, face)).toBe(NO_HIT)
    expect(face.axis).toBe(7)
  })

  it('不傳 outFace 也能用 —— 既有呼叫端一個字都不用改', () => {
    expect(segmentBox(0, 0, -5, 0, 0, 5, UNIT)).toBeCloseTo(0.4, 9)
  })
})

describe('hitAircraft 的法線（M7 spec §3.2）', () => {
  /** 巢狀盒：座艙整個包在機身裡，與 hitAircraft 既有測試同形。 */
  const NESTED: HitBox[] = [
    makeHitBox('fuselage', [-1, -1, -4], [1, 1, 4]),
    makeHitBox('cockpit', [-0.5, 0, -0.5], [0.5, 1, 0.5]),
  ]
  const ORIGIN = new Vector3()
  const IDENTITY = new Quaternion()

  it('法線取自最近的 t 那個盒，不是倍率最高的那個', () => {
    // 【這是本任務最重要的一條】從 +X 側射進去：先進機身的高 X 面
    // （法線 +X），再進座艙。倍率取的是座艙（×2.5），但法線必須是機身的 ——
    // 那才是彈丸真正先碰到的表面。跟著倍率走的話火花會從機體內部噴出來。
    const out = createHitResult()
    const s0 = new Vector3(5, 0.5, 0)
    const s1 = new Vector3(-5, 0.5, 0)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    expect(out.part).toBe('cockpit')          // 倍率仍取最高
    expect(out.nx).toBe(1)                    // 法線來自機身的高 X 面
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })

  it('法線是機體座標 —— 呼叫端負責轉世界', () => {
    // 把飛機繞 Y 轉 90°，法線輸出不變（仍是機體座標的 +X）
    const out = createHitResult()
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2)
    // 機體 +X 在轉了 90° 之後指向世界 −Z，所以線段要從世界 −Z 射進來
    const s0 = new Vector3(0, 0.5, -5)
    const s1 = new Vector3(0, 0.5, 5)
    expect(hitAircraft(NESTED, ORIGIN, q, s0, s1, out)).toBe(true)
    expect(out.nx).toBe(1)
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })

  it('法線恆為單位向量或全零', () => {
    const out = createHitResult()
    const s0 = new Vector3(0, 5, 0)
    const s1 = new Vector3(0, -5, 0)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    const len = Math.hypot(out.nx, out.ny, out.nz)
    expect(len).toBeCloseTo(1, 9)
  })

  it('起點在盒內時三分量皆為 0，呼叫端據此走備援', () => {
    const out = createHitResult()
    const s0 = new Vector3(0, 0, 0)
    const s1 = new Vector3(0, 0, 10)
    expect(hitAircraft(NESTED, ORIGIN, IDENTITY, s0, s1, out)).toBe(true)
    expect(out.nx).toBe(0)
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })

  it('createHitResult 的法線起始為 0', () => {
    const out = createHitResult()
    expect(out.nx).toBe(0)
    expect(out.ny).toBe(0)
    expect(out.nz).toBe(0)
  })
})

describe('pointBoxDistance', () => {
  const box = { center: new Vector3(0, 0, 0), half: new Vector3(2, 1, 10) }

  it('盒內是 0', () => {
    expect(pointBoxDistance(0, 0, 0, box)).toBe(0)
    expect(pointBoxDistance(2, 1, 10, box)).toBe(0)
  })

  it('單軸外側就是那一軸的超出量', () => {
    expect(pointBoxDistance(5, 0, 0, box)).toBeCloseTo(3, 9)
    expect(pointBoxDistance(0, 0, -14, box)).toBeCloseTo(4, 9)
  })

  it('角落是三軸超出量的歐氏距離', () => {
    expect(pointBoxDistance(5, 5, 10, box)).toBeCloseTo(5, 9)
  })

  /**
   * 【它為什麼存在】長條的盒子上，「到面的距離」與「到中心的距離」差很多
   * ——那正是艦首爆炸的情況。
   */
  it('長盒的一端：到面 4、到中心 14', () => {
    const near = pointBoxDistance(0, 0, -14, box)
    const toCentre = 14
    expect(near).toBeCloseTo(4, 9)
    expect(toCentre / near).toBeGreaterThan(3)
  })
})
