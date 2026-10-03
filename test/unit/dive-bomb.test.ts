import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import {
  createDiveBombState, DIVE_ABORT_MARGIN, DIVE_ANGLE_MAX, DIVE_CLIMB_FULL_SPEED, DIVE_CLIMB_MIN_SPEED,
  DIVE_EGRESS_CLIMB, DIVE_EGRESS_RANGE, DIVE_ENTRY_BANK, DIVE_ENTRY_SPEED, DIVE_FLIP_DONE, DIVE_FLIP_FLOOR,
  DIVE_FLIP_LATERAL, DIVE_FLIP_MISS, DIVE_FLIP_PAST, DIVE_HOLD_RANGE, DIVE_IAS_BAND, DIVE_IAS_RATIO,
  DIVE_LEVEL_SLACK, DIVE_MIN_HEIGHT, DIVE_ORBIT_BAND, DIVE_ORBIT_BIAS, DIVE_PULLOUT_DONE, DIVE_PULLOUT_PITCH,
  DIVE_REARM_ALONG, DIVE_REARM_RANGE, DIVE_RELEASE_HEIGHT, DIVE_ZOOM_CLIMB, DIVE_ZOOM_END_SPEED, DIVE_ZOOM_FULL_SPEED,
  pickDiveTarget, resetDiveBomb, stepDiveBomb, type DiveBombState, type DivePhase,
} from '../../src/ai/diveBomb'
import { AiController } from '../../src/ai/AiController'
import { createTargetBoard } from '../../src/ai/target'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { THROTTLE_FLOOR } from '../../src/input/throttle'
import { createBombBay } from '../../src/weapons/bomb'
import { loadoutOf } from '../../src/weapons/stores'
import { RHO0 } from '../../src/physics/atmosphere'
import { G4M } from '../../src/specs/g4m'
import { JU87 } from '../../src/specs/ju87'
import { P51D } from '../../src/specs/p51d'
import type { AircraftSpec } from '../../src/specs/types'
import { createGroundTarget, type GroundTarget } from '../../src/world/groundTargets'
import type { GroundUnitId } from '../../src/render/geometry/ground'

/**
 * # 俯衝投彈：挑目標、相位機
 *
 * 平飛 → 飛過目標一小段 → 翻到顛倒、用正過載拉過垂直（機鼻指向後下方、回頭對著目標）→ 機翼是正的、
 * 俯衝 → 拉起 → 爬離 → 回頭再平飛。每個轉換守住它的條件，缺一個都不轉。四架各挑不同的目標，
 * 免得同時衝向同一點。
 *
 * 座標約定：目標在原點，飛機沿 −Z 前進，所以 z < 0 就是已經飛過目標。
 */

const DEG = Math.PI / 180

describe('挑目標', () => {
  const at = (i: number, id: GroundUnitId, team: 'red' | 'blue', x: number, z: number): GroundTarget =>
    createGroundTarget(i, id, team, x, z, 0)
  const self = new Vector3(0, 1500, 0)

  /** 兩門價值高的砲（近、遠）、一輛價值較低的坦克（最近）、一輛友軍坦克、一個死掉的砲 */
  const targets = (): GroundTarget[] => {
    const t = [
      at(0, 'tank', 'red', 100, 0),
      at(1, 'atGun', 'red', 400, 0),
      at(2, 'atGun', 'red', 900, 0),
      at(3, 'panzer4', 'blue', 50, 0),
      at(4, 'atGun', 'red', 200, 0),
    ]
    t[4]!.alive = false
    return t
  }

  it('名次 0 是價值最高的裡最近的；價值優先於距離', () => {
    expect(pickDiveTarget(self, 'blue', targets(), 5000, 0)).toBe(1)
  })

  it('名次往後：同價值比距離，價值用完才輪到價值低的', () => {
    const t = targets()
    expect([0, 1, 2].map((r) => pickDiveTarget(self, 'blue', t, 5000, r))).toEqual([1, 2, 0])
  })

  it('名次比候選多就取最後一名', () => {
    expect(pickDiveTarget(self, 'blue', targets(), 5000, 7)).toBe(0)
  })

  it('跳過死的、同隊的、超出範圍的；沒有就 −1', () => {
    const t = targets()
    expect(pickDiveTarget(self, 'blue', t, 5000, 0)).not.toBe(4)
    expect(pickDiveTarget(self, 'blue', t, 5000, 3)).not.toBe(3)
    // 距離是三維的（自己在 1,500 m 高）。範圍 1,600 m：坦克 1,503 與砲 1,552 在內、遠的砲 1,749 在外
    expect([0, 1, 2].map((r) => pickDiveTarget(self, 'blue', t, 1600, r))).toEqual([1, 0, 0])
    expect(pickDiveTarget(self, 'blue', t, 50, 0)).toBe(-1)
    expect(pickDiveTarget(self, 'red', [], 5000, 0)).toBe(-1)
  })

  it('同價值同距離時依索引，結果穩定', () => {
    const t = [at(0, 'atGun', 'red', 300, 0), at(1, 'atGun', 'red', 0, 300)]
    expect(pickDiveTarget(self, 'blue', t, 5000, 0)).toBe(0)
    expect(pickDiveTarget(self, 'blue', t, 5000, 1)).toBe(1)
  })

  it('同一組輸入永遠同一個答案；不同名次挑不同的目標', () => {
    const t = targets()
    expect(pickDiveTarget(self, 'blue', t, 5000, 1)).toBe(pickDiveTarget(self, 'blue', t, 5000, 1))
    const a = pickDiveTarget(self, 'blue', t, 5000, 0)
    const b = pickDiveTarget(self, 'blue', t, 5000, 1)
    expect(a).not.toBe(b)
  })

  it('onlyUnit：只收指定的單位', () => {
    const t = targets()
    expect(pickDiveTarget(self, 'blue', t, 5000, 0, 'tank')).toBe(0)
    expect(pickDiveTarget(self, 'blue', t, 5000, 3, 'tank')).toBe(0)
    expect(pickDiveTarget(self, 'blue', t, 5000, 0, 'infantry')).toBe(-1)
  })

  /**
   * 排序量的是呼叫端給的基準點。各架各用自己的位置，不同名次不保證挑到不同的目標：四個同價值目標在
   * x = 0、100、1,000、2,000，位於 −100 與 100 的兩架，名次 0 與 1 都會挑到 x = 0 那一個。
   * 所以呼叫端要給共用的基準點；同一個基準點下名次 0～3 一定是四個不同的目標。
   */
  it('同一個基準點下，名次 0～3 挑到四個不同的目標', () => {
    const t = [0, 100, 1000, 2000].map((x, i) => at(i, 'atGun', 'red', x, 0))
    const ref = new Vector3(-100, 1500, 0)
    const picks = [0, 1, 2, 3].map((r) => pickDiveTarget(ref, 'blue', t, 8000, r))
    expect(new Set(picks).size).toBe(4)
    // 基準點不同的兩架（−100 與 100），名次 0 與 1 會撞在同一個目標：這就是不能各用各的位置的原因
    const a = pickDiveTarget(new Vector3(-100, 1500, 0), 'blue', t, 8000, 0)
    const b = pickDiveTarget(new Vector3(100, 1500, 0), 'blue', t, 8000, 1)
    expect(a).toBe(b)
  })
})

const TARGET_AT = (x: number, z: number): GroundTarget => createGroundTarget(0, 'atGun', 'red', x, z, 0)

/**
 * 擺在 (x, y, z)、俯仰 `pitch` 度（負 = 機鼻朝下）、航向 `yaw` 度（0 = 朝 −Z）、滾轉 `roll` 度、
 * 以 `speed` m/s 沿機首飛
 */
function fly(
  x: number, y: number, z: number, pitch = 0, speed = 100, yaw = 0, roll = 0, spec: AircraftSpec = JU87,
): Aircraft {
  const a = new Aircraft(spec, y, speed)
  a.state.position.set(x, y, z)
  a.state.orientation.setFromEuler(new Euler(pitch * DEG, yaw * DEG, roll * DEG, 'YXZ'))
  const nose = new Vector3(0, 0, -1).applyQuaternion(a.state.orientation)
  a.state.velocity.copy(nose).multiplyScalar(speed)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  return a
}

/** 讓 `self` 的指示空速是 vne 的 `ratio` 倍 */
function ias(self: Aircraft, ratio: number): void {
  const v = ratio * self.spec.limits.vne
  self.diag.aero.qbar = 0.5 * RHO0 * v * v
}

function stateIn(phase: DivePhase): DiveBombState {
  const s = createDiveBombState()
  s.phase = phase
  return s
}

/** 飛過目標 60 m（比 `DIVE_FLIP_PAST` 多一點）、高 1,700 m、對正、平飛、速度夠：具備翻轉的全部條件 */
const PAST = DIVE_FLIP_PAST + 10
const ready = (): Aircraft => fly(0, 1700, -PAST)

describe('平飛', () => {
  it('朝目標水平飛、維持高度：低於維持高度就把機首抬一點', () => {
    const s = createDiveBombState()
    const out = createCommand()
    const far = fly(0, 1700, 5000)
    stepDiveBomb(s, far, TARGET_AT(0, 0), true, out)
    expect(s.phase).toBe('level')
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
    expect(out.aimWorld.z).toBeLessThan(0)
    expect(Math.abs(out.aimWorld.y)).toBeLessThan(1e-3)
    far.state.position.y = 1650
    stepDiveBomb(s, far, TARGET_AT(0, 0), true, out)
    expect(out.aimWorld.y).toBeGreaterThan(0.05)
    expect(out.upright).toBe(false)
    expect(out.pull).toBe(false)
    expect(out.bombing).toBe(false)
    expect(out.firing).toBe(false)
    expect(out.trackTurn).toBe(false)
    expect(out.throttle).toBeGreaterThan(1)
  })

  /**
   * 離目標近了就保持航向，不再朝目標轉：過頂的那一刻目標方位會翻轉 180°，朝它轉的話一飛過目標
   * 就掉頭。
   */
  it('離目標近了保持航向，飛過目標之後也不掉頭', () => {
    const horizontal = (x: number, z: number): Vector3 => {
      const out = createCommand()
      // 速度不夠，不會進翻轉：只看平飛的瞄準
      stepDiveBomb(createDiveBombState(), fly(x, 1700, z, 0, DIVE_ENTRY_SPEED - 20), TARGET_AT(0, 0), true, out)
      return new Vector3(out.aimWorld.x, 0, out.aimWorld.z).normalize()
    }
    // 離目標遠：朝目標轉（飛機在 +x 40 m，目標在 −x 方向）
    expect(horizontal(40, 600).x).toBeLessThan(-0.03)
    // 近到 `DIVE_HOLD_RANGE` 之內：保持航向 −Z
    expect(Math.hypot(40, 200)).toBeLessThan(DIVE_HOLD_RANGE)
    expect(Math.abs(horizontal(40, 200).x)).toBeLessThan(1e-6)
    expect(horizontal(40, 200).z).toBeLessThan(0)
    // 已經飛過：照樣保持航向，不朝回轉
    expect(horizontal(0, -100).z).toBeLessThan(0)
  })

  it('飛過目標一小段、橫向對正、高度速度夠、坡度小、有彈：轉翻轉，並把瞄準點鎖在目標那一點', () => {
    const s = createDiveBombState()
    stepDiveBomb(s, ready(), TARGET_AT(0, 0), true, createCommand())
    expect(s.phase).toBe('flip')
    expect(s.aim.toArray()).toEqual([0, 0, 0])
  })

  it('還沒飛過 DIVE_FLIP_PAST：留在平飛', () => {
    const s = createDiveBombState()
    stepDiveBomb(s, fly(0, 1700, -(DIVE_FLIP_PAST - 10)), TARGET_AT(0, 0), true, createCommand())
    expect(s.phase).toBe('level')
    // 還沒到目標上空
    const before = createDiveBombState()
    stepDiveBomb(before, fly(0, 1700, 300), TARGET_AT(0, 0), true, createCommand())
    expect(before.phase).toBe('level')
  })

  it('橫向偏離太大：留在平飛；飛過頭太多就放棄這一趟，改走脫離', () => {
    const off = createDiveBombState()
    stepDiveBomb(off, fly(DIVE_FLIP_LATERAL + 40, 1700, -PAST), TARGET_AT(0, 0), true, createCommand())
    expect(off.phase).toBe('level')
    const gone = createDiveBombState()
    stepDiveBomb(gone, fly(DIVE_FLIP_LATERAL + 40, 1700, -(DIVE_FLIP_MISS + 10)), TARGET_AT(0, 0), true, createCommand())
    expect(gone.phase).toBe('egress')
    // 對正的也一樣：飛過頭太多還沒翻就放棄（例如一直沒有達到速度）
    const slow = createDiveBombState()
    stepDiveBomb(slow, fly(0, 1700, -(DIVE_FLIP_MISS + 10), 0, DIVE_ENTRY_SPEED - 20), TARGET_AT(0, 0), true, createCommand())
    expect(slow.phase).toBe('egress')
  })

  it('坡度太大：留在平飛（還在轉彎的途中不翻轉）', () => {
    const banked = createDiveBombState()
    stepDiveBomb(banked, fly(0, 1700, -PAST, 0, 100, 0, DIVE_ENTRY_BANK / DEG + 5), TARGET_AT(0, 0), true, createCommand())
    expect(banked.phase).toBe('level')
    const level = createDiveBombState()
    stepDiveBomb(level, fly(0, 1700, -PAST, 0, 100, 0, DIVE_ENTRY_BANK / DEG - 5), TARGET_AT(0, 0), true, createCommand())
    expect(level.phase).toBe('flip')
    // 左右一樣
    const left = createDiveBombState()
    stepDiveBomb(left, fly(0, 1700, -PAST, 0, 100, 0, -(DIVE_ENTRY_BANK / DEG + 5)), TARGET_AT(0, 0), true, createCommand())
    expect(left.phase).toBe('level')
  })

  /** 低速時沒力：後面幾趟脫離爬升把速度耗到 70 m/s 上下，直接翻轉的話滾轉亂跑；90 m/s 以上才乾淨 */
  it('速度不夠：留在平飛（先加速）', () => {
    const slow = createDiveBombState()
    stepDiveBomb(slow, fly(0, 1700, -PAST, 0, DIVE_ENTRY_SPEED - 5), TARGET_AT(0, 0), true, createCommand())
    expect(slow.phase).toBe('level')
    const ok = createDiveBombState()
    stepDiveBomb(ok, fly(0, 1700, -PAST, 0, DIVE_ENTRY_SPEED + 5), TARGET_AT(0, 0), true, createCommand())
    expect(ok.phase).toBe('flip')
  })

  it('彈艙是空的：不翻轉，改走脫離（爬離、等補滿）', () => {
    const s = createDiveBombState()
    stepDiveBomb(s, ready(), TARGET_AT(0, 0), false, createCommand())
    expect(s.phase).toBe('egress')
  })

  it('離目標不夠高：不翻轉；掉到遲滯帶以下才改走脫離（先爬高）', () => {
    // 在下限與遲滯帶之間：不翻轉（高度不夠），但也不退回脫離，平飛維持高度
    const between = createDiveBombState()
    stepDiveBomb(between, fly(0, DIVE_MIN_HEIGHT - DIVE_LEVEL_SLACK / 2, -PAST), TARGET_AT(0, 0), true, createCommand())
    expect(between.phase).toBe('level')
    const low = createDiveBombState()
    stepDiveBomb(low, fly(0, DIVE_MIN_HEIGHT - DIVE_LEVEL_SLACK - 50, -PAST), TARGET_AT(0, 0), true, createCommand())
    expect(low.phase).toBe('egress')
  })
})

describe('翻轉', () => {
  /** 翻轉中：瞄準點鎖在目標（原點），飛機在目標後方 120 m、高 1,000 m、機頭朝前平飛 */
  const flipping = (self: Aircraft): { s: DiveBombState; out: ReturnType<typeof createCommand>; self: Aircraft } => {
    const s = stateIn('flip')
    s.aim.set(0, 0, 0)
    return { s, out: createCommand(), self }
  }

  it('瞄準方向是到鎖定點的視線；強制翻轉後拉、不要求放平；油門怠速、不投彈', () => {
    const { s, out, self } = flipping(fly(0, 1000, -120))
    stepDiveBomb(s, self, null, true, out)
    // 飛機在目標後方（z = −120），視線朝後下方
    const los = new Vector3(0, -1000, 120).normalize()
    expect(out.aimWorld.distanceTo(los)).toBeLessThan(1e-6)
    expect(out.pull).toBe(true)
    expect(out.upright).toBe(false)
    expect(out.throttle).toBe(THROTTLE_FLOOR)
    expect(out.bombing).toBe(false)
    expect(out.firing).toBe(false)
    expect(out.trackTurn).toBe(false)
  })

  it('瞄準點是鎖定的：目標被炸掉、換成別的目標，瞄準點不動', () => {
    const { s, out, self } = flipping(fly(0, 1000, -120))
    stepDiveBomb(s, self, TARGET_AT(900, -900), true, out)
    expect(s.aim.toArray()).toEqual([0, 0, 0])
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
  })

  it('減速板隨指示空速升降，與俯衝同一條', () => {
    const brakeAt = (ratio: number): number => {
      const { s, out, self } = flipping(fly(0, 1000, -120))
      ias(self, ratio)
      stepDiveBomb(s, self, null, true, out)
      return out.brake
    }
    expect(brakeAt(0.5)).toBe(0)
    expect(brakeAt(DIVE_IAS_RATIO + DIVE_IAS_BAND / 2)).toBeCloseTo(0.5, 6)
    expect(brakeAt(1)).toBe(1)
  })

  /**
   * 拉過垂直之後機鼻指向後下方，機翼自然是正的（翻轉後拉的終點），所以接下來的俯衝不需要再滾。
   * 機鼻對上視線而且機翼是正的才算翻完。
   */
  it('機鼻對上視線、機翼是正的：轉俯衝', () => {
    // 飛機在目標後方 180 m、高 1,000 m，機鼻朝後下方 79°（航向 180°）、機翼正
    const { s, out, self } = flipping(fly(0, 1000, -180, -79, 100, 180))
    stepDiveBomb(s, self, null, true, out)
    expect(s.phase).toBe('dive')
    expect(out.pull).toBe(true)
  })

  it('機鼻還沒對上視線：留在翻轉', () => {
    const { s, out, self } = flipping(fly(0, 1000, -180))
    stepDiveBomb(s, self, null, true, out)
    expect(s.phase).toBe('flip')
    // 剛好在容許的夾角之外
    const edge = flipping(fly(0, 1000, -180, -(79 - DIVE_FLIP_DONE / DEG - 2), 100, 180))
    stepDiveBomb(edge.s, edge.self, null, true, edge.out)
    expect(edge.s.phase).toBe('flip')
  })

  it('機鼻對上了但機翼是顛倒的：留在翻轉（投放包絡擋顛倒）', () => {
    const { s, out, self } = flipping(fly(0, 1000, -180, -79, 100, 180, 180))
    stepDiveBomb(s, self, null, true, out)
    expect(s.phase).toBe('flip')
  })

  it('翻轉中掉到投彈高度加地板以下：放棄這一趟，轉拉起、不投、不再強制翻轉', () => {
    const { s, out, self } = flipping(fly(0, DIVE_RELEASE_HEIGHT + DIVE_FLIP_FLOOR - 10, -180, 0, 100, 0))
    stepDiveBomb(s, self, null, true, out)
    expect(s.phase).toBe('pullout')
    expect(out.bombing).toBe(false)
    expect(out.pull).toBe(false)
  })

  it('彈艙空了也放棄（炸彈不會憑空出現）', () => {
    const { s, out, self } = flipping(fly(0, 1000, -120))
    stepDiveBomb(s, self, null, false, out)
    expect(s.phase).toBe('pullout')
  })
})

describe('俯衝', () => {
  const diving = (self: Aircraft): { s: DiveBombState; out: ReturnType<typeof createCommand>; self: Aircraft } => {
    const s = stateIn('dive')
    s.aim.set(0, 0, 0)
    return { s, out: createCommand(), self }
  }

  it('瞄準方向是到鎖定點的視線；機翼放平（upright）、油門怠速、不強制翻轉', () => {
    const { s, out, self } = diving(fly(0, 1500, 450, -75, 110))
    stepDiveBomb(s, self, null, true, out)
    const los = new Vector3(0, -1500, -450).normalize()
    expect(out.aimWorld.distanceTo(los)).toBeLessThan(1e-6)
    expect(out.upright).toBe(true)
    expect(out.pull).toBe(false)
    expect(out.throttle).toBe(THROTTLE_FLOOR)
    expect(out.firing).toBe(false)
    expect(out.trackTurn).toBe(false)
  })

  /** 翻轉之後飛機在目標後方、航向朝後：視線朝後下方，水平方向是回頭對著目標 */
  it('飛過目標、回頭對著目標俯衝：瞄準方向朝後下方', () => {
    const { s, out, self } = diving(fly(0, 1500, -300, -79, 110, 180))
    stepDiveBomb(s, self, null, true, out)
    const los = new Vector3(0, -1500, 300).normalize()
    expect(out.aimWorld.distanceTo(los)).toBeLessThan(1e-6)
  })

  it('瞄準俯仰夾在 −85° 以內，方位不變', () => {
    // 目標幾乎在正下方：視線角 88.5°
    const { s, out, self } = diving(fly(0, 1500, 40, -80, 110))
    stepDiveBomb(s, self, null, true, out)
    expect(out.aimWorld.y).toBeCloseTo(-Math.sin(DIVE_ANGLE_MAX), 6)
    expect(out.aimWorld.z).toBeCloseTo(-Math.cos(DIVE_ANGLE_MAX), 6)
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
    expect(out.aimWorld.length()).toBeCloseTo(1, 9)
  })

  it('瞄準點是鎖定的：目標中途被炸掉、換成別的目標，瞄準點不動', () => {
    const { s, out, self } = diving(fly(0, 1500, 450, -75, 110))
    const other = TARGET_AT(900, -900)
    stepDiveBomb(s, self, other, true, out)
    expect(s.aim.toArray()).toEqual([0, 0, 0])
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
  })

  it('減速板隨指示空速升降：vne 的 0.65 倍以下全收、之後漸開、到 0.85 倍全開', () => {
    const brakeAt = (ratio: number): number => {
      const { s, out, self } = diving(fly(0, 1500, 450, -75, 110))
      ias(self, ratio)
      stepDiveBomb(s, self, null, true, out)
      return out.brake
    }
    expect(brakeAt(0.5)).toBe(0)
    expect(brakeAt(DIVE_IAS_RATIO)).toBeCloseTo(0, 6)
    expect(brakeAt(DIVE_IAS_RATIO + DIVE_IAS_BAND / 2)).toBeCloseTo(0.5, 6)
    expect(brakeAt(DIVE_IAS_RATIO + DIVE_IAS_BAND)).toBeCloseTo(1, 6)
    expect(brakeAt(1)).toBe(1)
  })

  it('高於投彈高度不投；到了每一步都要求投彈，而且留在俯衝（等炸彈真的出去）', () => {
    const above = diving(fly(0, DIVE_RELEASE_HEIGHT + 1, 150, -75, 110))
    stepDiveBomb(above.s, above.self, null, true, above.out)
    expect(above.out.bombing).toBe(false)
    expect(above.s.phase).toBe('dive')

    const at = diving(fly(0, DIVE_RELEASE_HEIGHT, 150, -75, 110))
    for (let i = 0; i < 5; i++) {
      stepDiveBomb(at.s, at.self, null, true, at.out)
      expect(at.out.bombing).toBe(true)
      expect(at.s.phase).toBe('dive')
    }
  })

  it('彈艙空了（炸彈出去了）才轉拉起，同一步不再要求投彈', () => {
    const { s, out, self } = diving(fly(0, DIVE_RELEASE_HEIGHT - 5, 150, -75, 110))
    stepDiveBomb(s, self, null, false, out)
    expect(out.bombing).toBe(false)
    expect(s.phase).toBe('pullout')
  })

  /** 安全層接管時會清掉投彈指令：這一趟沒投成，不能一直俯衝下去，也不能拉起來又再俯衝 */
  it('低於投彈高度一截還沒投出去：放棄這一趟，轉拉起、不投', () => {
    const { s, out, self } = diving(fly(0, DIVE_RELEASE_HEIGHT - DIVE_ABORT_MARGIN - 1, 100, -75, 110))
    stepDiveBomb(s, self, null, true, out)
    expect(s.phase).toBe('pullout')
    expect(out.bombing).toBe(false)
  })

  it('到了投彈高度、彈艙還有彈、但機體已經在上升（被安全層拉起了）：轉拉起、不投', () => {
    const { s, out, self } = diving(fly(0, DIVE_RELEASE_HEIGHT - 10, 100, 20, 110))
    stepDiveBomb(s, self, null, true, out)
    expect(s.phase).toBe('pullout')
    expect(out.bombing).toBe(false)
  })
})

describe('拉起與脫離', () => {
  it('拉起：機首抬到 20°、保持水平航向；油門全開、減速板收、不再要求機翼放平', () => {
    const self = fly(0, 480, 100, -70, 120)
    const out = createCommand()
    out.upright = true
    out.pull = true
    out.brake = 1
    stepDiveBomb(stateIn('pullout'), self, null, true, out)
    expect(out.aimWorld.y).toBeCloseTo(Math.sin(DIVE_PULLOUT_PITCH), 6)
    expect(out.aimWorld.z).toBeLessThan(0)
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
    expect(out.upright).toBe(false)
    expect(out.pull).toBe(false)
    expect(out.brake).toBe(0)
    expect(out.throttle).toBeGreaterThan(1)
    expect(out.bombing).toBe(false)
  })

  /** 過頂翻轉之後飛機朝後（航向 180°）：拉起保持的是現在的水平航向，不是原來進場的方向 */
  it('拉起：保持現在的水平航向（過頂翻轉之後朝後）', () => {
    const out = createCommand()
    stepDiveBomb(stateIn('pullout'), fly(0, 480, -100, -70, 120, 180), null, true, out)
    expect(out.aimWorld.y).toBeCloseTo(Math.sin(DIVE_PULLOUT_PITCH), 6)
    expect(out.aimWorld.z).toBeGreaterThan(0)
  })

  it('航跡角回到 5° 以上才轉脫離', () => {
    const s = stateIn('pullout')
    stepDiveBomb(s, fly(0, 400, 100, -30, 120), null, true, createCommand())
    expect(s.phase).toBe('pullout')
    stepDiveBomb(s, fly(0, 400, 100, DIVE_PULLOUT_DONE / DEG + 1, 120), null, true, createCommand())
    expect(s.phase).toBe('egress')
  })

  /** 轉彎（含側滑）會耗掉持續爬升約 1.5 m/s：直線飛 8.3 m/s、繞圈 6～7.5 m/s */
  /** 離目標在轉彎起點（半徑減偏滿的距離）之內 */
  const NEAR = (DIVE_EGRESS_RANGE - DIVE_ORBIT_BAND) / 2

  it('脫離：離目標還近而且正在飛離，就直線爬（不轉彎，爬得最快）', () => {
    const near = createCommand()
    stepDiveBomb(stateIn('egress'), fly(0, 700, NEAR, 10, 75, 180), TARGET_AT(0, 0), true, near)
    // 航向 180°：朝 +Z，離目標 NEAR m（轉彎起點之內），速度方向在遠離目標
    expect(near.aimWorld.y).toBeCloseTo(Math.sin(DIVE_EGRESS_CLIMB), 6)
    expect(near.aimWorld.x).toBeCloseTo(0, 6)
    expect(near.aimWorld.z).toBeGreaterThan(0)
  })

  it('脫離：正朝目標飛來的會轉開（朝外偏的盤旋），不會飛過目標上空', () => {
    const out = createCommand()
    // 離目標 NEAR m、航向朝目標（0° = 朝 −Z）
    stepDiveBomb(stateIn('egress'), fly(0, 700, NEAR, 10, 90, 0), TARGET_AT(0, 0), true, out)
    const h = new Vector3(out.aimWorld.x, 0, out.aimWorld.z).normalize()
    // 朝目標的分量是負的（朝外偏），而且不是直接朝目標
    expect(h.z).toBeGreaterThan(0)
    expect(h.z).toBeCloseTo(Math.sin(DIVE_ORBIT_BIAS), 6)
  })

  /**
   * 飛到盤旋半徑附近就繞著目標轉、邊轉邊爬。直飛出去再掉頭飛回的話，爬得夠高時常常已經飛進回平飛的
   * 距離以內，要飛過目標、再飛出去才能回平飛，白繞一大圈。
   */
  describe('脫離盤旋', () => {
    /** 脫離時的水平瞄準方向（單位向量）與到目標的視線（單位向量，飛機看目標）的內積 */
    const aimAt = (z: number, yaw: number): { aim: Vector3; los: Vector3 } => {
      const out = createCommand()
      const self = fly(0, 700, z, 10, 90, yaw)
      stepDiveBomb(stateIn('egress'), self, TARGET_AT(0, 0), true, out)
      const aim = new Vector3(out.aimWorld.x, 0, out.aimWorld.z).normalize()
      const los = new Vector3(0 - self.state.position.x, 0, 0 - self.state.position.z).normalize()
      return { aim, los }
    }

    it('盤旋半徑上：沿切線飛，與視線垂直', () => {
      const { aim, los } = aimAt(DIVE_EGRESS_RANGE, 90)
      expect(Math.abs(aim.dot(los))).toBeLessThan(0.02)
    })

    it('在半徑之外朝內偏、在半徑之內朝外偏，偏的量由 DIVE_ORBIT_BIAS 決定', () => {
      const outside = aimAt(DIVE_EGRESS_RANGE + DIVE_ORBIT_BAND, 90)
      expect(outside.aim.dot(outside.los)).toBeCloseTo(Math.sin(DIVE_ORBIT_BIAS), 6)
      const inside = aimAt(DIVE_EGRESS_RANGE - DIVE_ORBIT_BAND, 90)
      expect(inside.aim.dot(inside.los)).toBeCloseTo(-Math.sin(DIVE_ORBIT_BIAS), 6)
      // 更遠也只偏到上限
      const far = aimAt(DIVE_EGRESS_RANGE + 5 * DIVE_ORBIT_BAND, 90)
      expect(far.aim.dot(far.los)).toBeCloseTo(Math.sin(DIVE_ORBIT_BIAS), 6)
    })

    it('往哪一邊轉由現在的航向決定：機頭偏哪邊就繞哪邊，不來回切換', () => {
      const left = aimAt(DIVE_EGRESS_RANGE, 90)
      const right = aimAt(DIVE_EGRESS_RANGE, -90)
      // 航向 ±90°：朝 −X／+X；切線取與現在航向同向的那一個
      expect(left.aim.x).toBeLessThan(-0.9)
      expect(right.aim.x).toBeGreaterThan(0.9)
    })
  })

  /** 爬升掉速掉到接近失速，安全層會用失速接管把機首壓下去；速度不夠就少爬一點、把速度留住 */
  it('脫離的爬升角隨速度收斂：速度夠全爬、不夠就放平', () => {
    const climbAt = (speed: number): number => {
      const out = createCommand()
      stepDiveBomb(stateIn('egress'), fly(0, 700, 1500, 10, speed, 180), TARGET_AT(0, 0), true, out)
      return out.aimWorld.y
    }
    expect(climbAt(DIVE_CLIMB_FULL_SPEED + 5)).toBeCloseTo(Math.sin(DIVE_EGRESS_CLIMB), 6)
    expect(climbAt(DIVE_CLIMB_MIN_SPEED - 5)).toBeCloseTo(0, 6)
    const mid = climbAt((DIVE_CLIMB_MIN_SPEED + DIVE_CLIMB_FULL_SPEED) / 2)
    expect(mid).toBeGreaterThan(0.01)
    expect(mid).toBeLessThan(Math.sin(DIVE_EGRESS_CLIMB) - 0.01)
  })

  /**
   * 拉起時速度還有 129 m/s，動能折合約 620 m 的高度。高速時用大角度爬升把它換成高度，速度掉下來
   * 再收斂到持續爬升的角度；用持續爬升的角度慢慢爬，同一份動能要花兩倍的時間，阻力吃掉更多。
   */
  it('高速時拉高衝：速度越高爬升角越大，速度掉到收斂速度以下回到持續爬升的角度', () => {
    const climbAt = (speed: number): number => {
      const out = createCommand()
      stepDiveBomb(stateIn('egress'), fly(0, 700, 1500, 10, speed, 180), TARGET_AT(0, 0), true, out)
      return out.aimWorld.y
    }
    expect(climbAt(DIVE_ZOOM_FULL_SPEED + 10)).toBeCloseTo(Math.sin(DIVE_ZOOM_CLIMB), 6)
    expect(climbAt(DIVE_ZOOM_END_SPEED)).toBeCloseTo(Math.sin(DIVE_EGRESS_CLIMB), 6)
    const mid = climbAt((DIVE_ZOOM_END_SPEED + DIVE_ZOOM_FULL_SPEED) / 2)
    expect(mid).toBeGreaterThan(Math.sin(DIVE_EGRESS_CLIMB) + 0.01)
    expect(mid).toBeLessThan(Math.sin(DIVE_ZOOM_CLIMB) - 0.01)
  })

  it('高度、距離、彈艙三個條件都成立才回平飛，缺一個都留在脫離', () => {
    // 朝 −Z 飛、目標在原點：z > 0 時目標在機鼻前方
    const run = (y: number, z: number, loaded: boolean): DivePhase => {
      const s = stateIn('egress')
      stepDiveBomb(s, fly(0, y, z, 10, 90, 0), TARGET_AT(0, 0), loaded, createCommand())
      return s.phase
    }
    // 回平飛的高度要多給一點（遲滯）：剛好在下限回去，平飛維持高度掉個幾公尺就又被打回脫離
    const enough = DIVE_MIN_HEIGHT + DIVE_LEVEL_SLACK + 10
    expect(run(enough, DIVE_REARM_RANGE + 10, true)).toBe('level')
    expect(run(DIVE_MIN_HEIGHT + 10, DIVE_REARM_RANGE + 10, true)).toBe('egress')
    expect(run(enough, DIVE_REARM_RANGE - 10, true)).toBe('egress')
    expect(run(enough, DIVE_REARM_RANGE + 10, false)).toBe('egress')
  })

  /**
   * 【盤旋時目標在正側面也要能回平飛】盤旋把範圍維持在一個半徑上，速度幾乎垂直於目標方向，「飛過」量
   * 在 0 附近由雜訊決定。門檻若是 0，緩慢往外漂幾公尺就一直回不去（高度早就夠了還白爬）。
   * 門檻要有餘裕，但必須小於平飛的放棄線 `DIVE_FLIP_MISS`，兩個條件才不重疊
   */
  describe('回平飛的航向門檻', () => {
    const enough = DIVE_MIN_HEIGHT + DIVE_LEVEL_SLACK + 10
    const R = DIVE_EGRESS_RANGE + 60
    /** 在目標正側面（距離 R）朝 −X 飛，航向再往 +Z（遠離目標）偏到「飛過」量剛好是 `along` */
    const phaseWithAlong = (along: number): DivePhase => {
      const self = fly(0, enough, R, 0, 66, 90)
      const phi = Math.asin(along / R)
      self.state.velocity.set(-66 * Math.cos(phi), 0, 66 * Math.sin(phi))
      const s = stateIn('egress')
      stepDiveBomb(s, self, TARGET_AT(0, 0), true, createCommand())
      return s.phase
    }

    it('正側面、緩慢往外漂（2 m/s）：回平飛', () => {
      expect(phaseWithAlong(R * (2 / 66))).toBe('level')
    })

    it('飛過量在 DIVE_REARM_ALONG 上下：以內回平飛、超過留在脫離', () => {
      expect(phaseWithAlong(DIVE_REARM_ALONG - 20)).toBe('level')
      expect(phaseWithAlong(DIVE_REARM_ALONG + 20)).toBe('egress')
    })

    it('門檻小於平飛的放棄線：脫離回平飛的那一步，平飛不會立刻把它打回去', () => {
      expect(DIVE_REARM_ALONG).toBeGreaterThan(0)
      expect(DIVE_REARM_ALONG).toBeLessThan(DIVE_FLIP_MISS)
    })
  })

  /**
   * 【目標在身後時不回平飛】平飛看到目標在身後（飛過 `DIVE_FLIP_MISS` 以上）就走脫離；脫離若只看
   * 高度、距離、彈艙，距離夠遠的那一步就立刻回平飛、下一步又被打回脫離，兩個相位每步來回切，
   * 瞄準點與維持高度也每步重設。回平飛要目標沒有落在身後太遠
   */
  it('目標在身後、離得夠遠：脫離不回平飛', () => {
    const s = stateIn('egress')
    stepDiveBomb(s, fly(0, 1700, -3000, 0, 90, 0), TARGET_AT(0, 0), true, createCommand())
    expect(s.phase).toBe('egress')
  })

  it('目標遠遠落在身後時，相位不會每步來回切換', () => {
    const self = fly(0, 1700, -3000, 0, 90, 0)
    const target = TARGET_AT(0, 0)
    const s = stateIn('level')
    const out = createCommand()
    let switches = 0
    let prev = s.phase
    for (let i = 0; i < 240; i++) {
      stepDiveBomb(s, self, target, true, out)
      if (s.phase !== prev) switches++
      prev = s.phase
    }
    expect(switches).toBeLessThanOrEqual(1)
  })

  it('重設之後回到平飛、瞄準點與維持高度歸零', () => {
    const s = stateIn('pullout')
    s.aim.set(1, 2, 3)
    s.holdAlt = 1700
    resetDiveBomb(s)
    expect(s.phase).toBe('level')
    expect(s.aim.toArray()).toEqual([0, 0, 0])
    expect(s.holdAlt).toBe(0)
  })
})

/**
 * # 接進 `AiController`
 *
 * 只有 Ju 87 走新行為；兩個入口（沒有優先單位、任務指定了優先單位）都要收得到；其他機種的路徑一個
 * 位元都不動 —— 這裡守「新狀態沒被碰」，整體輸出的逐位元比對在 `test/tools/dive-bomb-baseline.probe.ts`。
 */
describe('接線', () => {
  const DT = 1 / 240

  const wire = (
    _self: Aircraft, index: number, candidates: { index: number; aircraft: Aircraft }[], targets: GroundTarget[],
    aircraftId: string | null,
  ): AiController => {
    const ai = new AiController()
    ai.board = createTargetBoard(candidates.map((c) => ({ ...c, team: 'blue' as const, alive: true })))
    ai.selfIndex = index
    ai.groundTargets = targets
    ai.bombBay = aircraftId === null ? null : createBombBay(loadoutOf(aircraftId))
    return ai
  }

  /** 飛過目標 60 m、高 1,700 m、對正：Ju 87 一進來就具備翻轉的條件 */
  const stuka = (x = 0): Aircraft => fly(x, 1700, -PAST)

  it('Ju 87 有地面目標：新相位會動（沒有優先單位的入口）', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('flip')
    expect(ai.groundTarget).toBe(target)
    // 水平轟炸那一套沒有被問到
    expect(ai.strikeRef.index).toBe(-1)
  })

  it('翻轉的指令穿過延遲與安全層送到飛機：pull 為真', () => {
    const self = stuka()
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [TARGET_AT(0, 0)], 'ju87')
    ai.update(self, DT, createCommand())
    const out = createCommand()
    ai.update(self, DT, out)
    expect(ai.diveBombPhase).toBe('flip')
    expect(out.pull).toBe(true)
    expect(out.upright).toBe(false)
  })

  it('airFirst 開著、場上有敵機：Ju 87 照樣俯衝（airFirst 只管戰鬥機）', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.board = createTargetBoard([
      { index: 0, aircraft: self, team: 'blue', alive: true },
      { index: 1, aircraft: fly(0, 1700, 9000, 0, 150, 180), team: 'red', alive: true },
    ])
    ai.airFirst = true
    // 優先單位的入口直接呼叫 `strafeGround`：擋戰鬥機的那一關要排在俯衝轟炸機的分支之後
    ai.priorityGroundUnit = 'atGun'
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('flip')
    expect(ai.groundTarget).toBe(target)
  })

  it('任務指定了優先地面單位：Ju 87 照樣俯衝（另一個入口）', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.priorityGroundUnit = 'atGun'
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('flip')
    expect(ai.strikeRef.index).toBe(-1)
  })

  it('有長機的僚機、任務指定了優先單位：不回站位，照樣俯衝', () => {
    const lead = fly(0, 1700, 3000)
    const wing = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(wing, 1, [{ index: 0, aircraft: lead }, { index: 1, aircraft: wing }], [target], 'ju87')
    ai.stationReference = lead
    ai.stationReferenceIndex = 0
    ai.priorityGroundUnit = 'atGun'
    ai.update(wing, DT, createCommand())
    expect(ai.diveBombPhase).toBe('flip')
  })

  it('指定的優先單位場上沒有：和戰鬥機一樣退回打別的地面目標', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.priorityGroundUnit = 'tank'
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('flip')
    expect(ai.groundTarget).toBe(target)
  })

  it('場上沒有敵方地面目標：新相位不動', () => {
    const self = stuka()
    const friendly = createGroundTarget(0, 'panzer4', 'blue', 0, 0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [friendly], 'ju87')
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('level')
    expect(ai.diveBomb.aim.toArray()).toEqual([0, 0, 0])
    expect(ai.groundTarget).toBeNull()
  })

  /**
   * 兩架在不同位置、同一個長機：各用自己的位置排序的話，名次 0 與 1 會挑到同一個目標
   * （四個目標在 x = 0、100、1,000、2,000，長機在 −100、僚機在 +100）。
   */
  it('長機與僚機挑到不同的目標：排序從長機的位置量', () => {
    const targets = [0, 100, 1000, 2000].map((x, i) => createGroundTarget(i, 'atGun', 'red', x, 0, 0))
    const lead = fly(-100, 1700, 5000)
    const wing = fly(100, 1700, 5000)
    const cands = [{ index: 0, aircraft: lead }, { index: 1, aircraft: wing }]
    const leadAi = wire(lead, 0, cands, targets, 'ju87')
    const wingAi = wire(wing, 1, cands, targets, 'ju87')
    wingAi.stationReference = lead
    wingAi.stationReferenceIndex = 0
    leadAi.update(lead, DT, createCommand())
    wingAi.update(wing, DT, createCommand())
    expect(leadAi.groundTarget).not.toBeNull()
    expect(wingAi.groundTarget).not.toBeNull()
    expect(wingAi.groundTarget).not.toBe(leadAi.groundTarget)
  })

  /**
   * 排序從會移動的長機位置量，名次靠後的目標每個決策拍都可能換：實測第四架的目標在六個之間跳，
   * 一直轉向、掉速、對不準，整場沒俯衝過。一趟之內不換，只在脫離時挑下一趟的。
   */
  it('平飛途中不換目標；脫離時才重挑下一趟的', () => {
    const near = TARGET_AT(0, -3000)
    const far = createGroundTarget(1, 'atGun', 'red', 4000, -3000, 0)
    const self = fly(0, 1700, 3000)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [near, far], 'ju87')
    const run = (n: number): void => { for (let i = 0; i < n; i++) ai.update(self, DT, createCommand()) }
    run(30)
    expect(ai.groundTarget).toBe(near)
    // 遠的那個變得比較近：平飛途中仍然是原來那個
    near.position.set(0, 0, -9000)
    far.position.set(4000, 0, 2000)
    run(60)
    expect(ai.diveBombPhase).toBe('level')
    expect(ai.groundTarget).toBe(near)
    // 脫離時重挑（飛機放低，脫離不會在第一步就結束）
    self.state.position.y = 800
    ai.diveBomb.phase = 'egress'
    run(30)
    expect(ai.diveBombPhase).toBe('egress')
    expect(ai.groundTarget).toBe(far)
  })

  it('翻轉到一半目標被炸掉，這一趟照樣飛完：新相位不退回', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('flip')
    target.alive = false
    const out = createCommand()
    ai.update(self, DT, out)
    expect(ai.diveBombPhase).toBe('flip')
    // 指令真的還在寫：強制翻轉後拉沒有被別的行為蓋掉
    expect(out.pull).toBe(true)
  })

  it('G4M 有彈艙有地面目標：走水平轟炸，新狀態一個位元都沒碰', () => {
    const self = fly(0, 1700, -PAST, 0, 100, 0, 0, G4M)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [TARGET_AT(0, 0)], 'g4m')
    ai.update(self, DT, createCommand())
    expect(ai.strikeRef.index).toBe(0)
    expect(ai.diveBombPhase).toBe('level')
    expect(ai.diveBomb.aim.toArray()).toEqual([0, 0, 0])
    expect(ai.diveBomb.holdAlt).toBe(0)
  })

  it('P-51D 沒彈艙有地面目標：走戰鬥機的掃射，新狀態一個位元都沒碰', () => {
    const self = fly(0, 1700, 780, 0, 100, 0, 0, P51D)
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], null)
    ai.update(self, DT, createCommand())
    expect(ai.groundTarget).toBe(target)
    expect(ai.diveBombPhase).toBe('level')
    expect(ai.diveBomb.aim.toArray()).toEqual([0, 0, 0])
    expect(ai.diveBomb.holdAlt).toBe(0)
  })

  it('換場重設：新相位回到平飛、鎖定的瞄準點歸零', () => {
    const self = stuka()
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [TARGET_AT(0, 0)], 'ju87')
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('flip')
    ai.clearTerrainState()
    expect(ai.diveBombPhase).toBe('level')
    expect(ai.diveBomb.holdAlt).toBe(0)
  })
})
