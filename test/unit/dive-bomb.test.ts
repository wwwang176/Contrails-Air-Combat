import { describe, expect, it } from 'vitest'
import { Euler, Vector3 } from 'three'
import {
  createDiveBombState, DIVE_ABORT_MARGIN, DIVE_ANGLE, DIVE_ANGLE_MAX, DIVE_CLIMB_FULL_SPEED,
  DIVE_CLIMB_MIN_SPEED, DIVE_EGRESS_CLIMB, DIVE_EGRESS_RANGE, DIVE_ENTRY_BANK, DIVE_ENTRY_SPEED,
  DIVE_IAS_BAND, DIVE_IAS_RATIO, DIVE_LEAD_SECONDS, DIVE_MIN_HEIGHT, DIVE_PULLOUT_DONE,
  DIVE_PULLOUT_PITCH, DIVE_REARM_RANGE, DIVE_RELEASE_HEIGHT, diveEntryRange, pickDiveTarget, resetDiveBomb,
  stepDiveBomb, type DiveBombState, type DivePhase,
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
 * # 俯衝投彈：進場距離、挑目標、相位機
 *
 * 平飛到目標上方的某個水平距離才壓機鼻；四架各挑不同的目標，免得同時衝向同一點。
 * 相位：平飛 → 俯衝 → 拉起 → 爬離 → 回頭再平飛，每個轉換守住它的條件，缺一個都不轉。
 */

const DEG = Math.PI / 180

describe('進場距離', () => {
  it('高 1,000 m、速度 100 m/s：直線俯衝 75° 的水平距離加上機鼻壓下去飛掉的距離', () => {
    // 1000 / tan(75°) = 267.95；機鼻壓下去那段 100 × 3.4 = 340
    expect(DIVE_ANGLE).toBeCloseTo(75 * DEG, 9)
    expect(DIVE_LEAD_SECONDS).toBeCloseTo(3.4, 9)
    expect(diveEntryRange(1000, 100)).toBeCloseTo(267.95 + 340, 1)
  })

  it('越高、越快，進場距離越長；高度為零或負時只剩機鼻壓下去那一項', () => {
    expect(diveEntryRange(2000, 100)).toBeGreaterThan(diveEntryRange(1000, 100))
    expect(diveEntryRange(1000, 120)).toBeGreaterThan(diveEntryRange(1000, 100))
    expect(diveEntryRange(0, 100)).toBeCloseTo(100 * DIVE_LEAD_SECONDS, 9)
    expect(diveEntryRange(-500, 100)).toBeCloseTo(100 * DIVE_LEAD_SECONDS, 9)
  })
})

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
    expect(out.bombing).toBe(false)
    expect(out.firing).toBe(false)
    expect(out.trackTurn).toBe(false)
    expect(out.throttle).toBeGreaterThan(1)
  })

  it('高度夠、進了距離、對正、有彈：轉俯衝，並把瞄準點鎖在目標那一點', () => {
    // 高 1,700 m、離目標 780 m、對正：剛好進了壓機鼻的距離
    expect(diveEntryRange(1700, 100)).toBeGreaterThan(780)
    const s = createDiveBombState()
    stepDiveBomb(s, fly(0, 1700, 780), TARGET_AT(0, 0), true, createCommand())
    expect(s.phase).toBe('dive')
    expect(s.aim.toArray()).toEqual([0, 0, 0])
  })

  it('還沒進距離：留在平飛', () => {
    const s = createDiveBombState()
    stepDiveBomb(s, fly(0, 1700, diveEntryRange(1700, 100) + 50), TARGET_AT(0, 0), true, createCommand())
    expect(s.phase).toBe('level')
  })

  it('機首與目標方位差太多：留在平飛', () => {
    const s = createDiveBombState()
    // 目標在右前 31°，水平距離 583 m、高 1,700 m：在壓機鼻的距離內，視線角 71°
    stepDiveBomb(s, fly(0, 1700, 500), TARGET_AT(300, 0), true, createCommand())
    expect(s.phase).toBe('level')
  })

  it('坡度太大：留在平飛（目標在側面、還在轉彎的途中不壓機鼻）', () => {
    const banked = createDiveBombState()
    stepDiveBomb(banked, fly(0, 1700, 780, 0, 100, 0, DIVE_ENTRY_BANK / DEG + 5), TARGET_AT(0, 0), true, createCommand())
    expect(banked.phase).toBe('level')
    const level = createDiveBombState()
    stepDiveBomb(level, fly(0, 1700, 780, 0, 100, 0, DIVE_ENTRY_BANK / DEG - 5), TARGET_AT(0, 0), true, createCommand())
    expect(level.phase).toBe('dive')
    // 左右一樣
    const left = createDiveBombState()
    stepDiveBomb(left, fly(0, 1700, 780, 0, 100, 0, -(DIVE_ENTRY_BANK / DEG + 5)), TARGET_AT(0, 0), true, createCommand())
    expect(left.phase).toBe('level')
  })

  /** 低速時推頭沒力、滾轉亂跑：後面幾趟壓機鼻時只有 70 m/s，滾轉飄到 40～68°；90 m/s 時滾轉恆為 0 */
  it('速度不夠：留在平飛（先加速）', () => {
    // 離目標 700 m：兩種速度都在壓機鼻的距離之內，只差速度
    const slow = createDiveBombState()
    stepDiveBomb(slow, fly(0, 1700, 700, 0, DIVE_ENTRY_SPEED - 5), TARGET_AT(0, 0), true, createCommand())
    expect(slow.phase).toBe('level')
    const ok = createDiveBombState()
    stepDiveBomb(ok, fly(0, 1700, 700, 0, DIVE_ENTRY_SPEED + 5), TARGET_AT(0, 0), true, createCommand())
    expect(ok.phase).toBe('dive')
  })

  it('彈艙是空的：不俯衝，改走脫離（爬離、等補滿）', () => {
    const s = createDiveBombState()
    stepDiveBomb(s, fly(0, 1700, 780), TARGET_AT(0, 0), false, createCommand())
    expect(s.phase).toBe('egress')
  })

  it('離目標不夠高：不俯衝，改走脫離（先爬高）', () => {
    const s = createDiveBombState()
    stepDiveBomb(s, fly(0, DIVE_MIN_HEIGHT - 50, 500), TARGET_AT(0, 0), true, createCommand())
    expect(s.phase).toBe('egress')
  })

  it('視線角超過 80°（飛到目標上方附近）：不壓機鼻，改走脫離', () => {
    const s = createDiveBombState()
    // 高 1,700 m、水平 200 m：視線角 83°
    stepDiveBomb(s, fly(0, 1700, 200), TARGET_AT(0, 0), true, createCommand())
    expect(s.phase).toBe('egress')
    // 水平 400 m：視線角 76.8°，不算太近
    const s2 = createDiveBombState()
    stepDiveBomb(s2, fly(0, 1700, 400), TARGET_AT(0, 0), true, createCommand())
    expect(s2.phase).toBe('dive')
  })
})

describe('俯衝', () => {
  const diving = (self: Aircraft): { s: DiveBombState; out: ReturnType<typeof createCommand>; self: Aircraft } => {
    const s = stateIn('dive')
    s.aim.set(0, 0, 0)
    return { s, out: createCommand(), self }
  }

  it('瞄準方向是到鎖定點的視線；機翼放平（upright）、油門怠速', () => {
    const { s, out, self } = diving(fly(0, 1500, 450, -75, 110))
    stepDiveBomb(s, self, null, true, out)
    const los = new Vector3(0, -1500, -450).normalize()
    expect(out.aimWorld.distanceTo(los)).toBeLessThan(1e-6)
    expect(out.upright).toBe(true)
    expect(out.throttle).toBe(THROTTLE_FLOOR)
    expect(out.firing).toBe(false)
    expect(out.trackTurn).toBe(false)
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
    out.brake = 1
    stepDiveBomb(stateIn('pullout'), self, null, true, out)
    expect(out.aimWorld.y).toBeCloseTo(Math.sin(DIVE_PULLOUT_PITCH), 6)
    expect(out.aimWorld.z).toBeLessThan(0)
    expect(out.aimWorld.x).toBeCloseTo(0, 6)
    expect(out.upright).toBe(false)
    expect(out.brake).toBe(0)
    expect(out.throttle).toBeGreaterThan(1)
    expect(out.bombing).toBe(false)
  })

  it('航跡角回到 5° 以上才轉脫離', () => {
    const s = stateIn('pullout')
    stepDiveBomb(s, fly(0, 400, 100, -30, 120), null, true, createCommand())
    expect(s.phase).toBe('pullout')
    stepDiveBomb(s, fly(0, 400, 100, DIVE_PULLOUT_DONE / DEG + 1, 120), null, true, createCommand())
    expect(s.phase).toBe('egress')
  })

  it('脫離：離目標不到拉開距離就保持航向爬升；到了就掉頭朝目標爬升', () => {
    const near = createCommand()
    stepDiveBomb(stateIn('egress'), fly(0, 700, 1500, 10, 90, 180), TARGET_AT(0, 0), true, near)
    // 航向 180°：朝 +Z，離目標 1,500 m
    expect(near.aimWorld.y).toBeCloseTo(Math.sin(DIVE_EGRESS_CLIMB), 6)
    expect(near.aimWorld.z).toBeGreaterThan(0)

    const far = createCommand()
    stepDiveBomb(stateIn('egress'), fly(0, 700, DIVE_EGRESS_RANGE + 500, 10, 90, 180), TARGET_AT(0, 0), true, far)
    expect(far.aimWorld.y).toBeCloseTo(Math.sin(DIVE_EGRESS_CLIMB), 6)
    expect(far.aimWorld.z).toBeLessThan(0)
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

  it('高度、距離、彈艙三個條件都成立才回平飛，缺一個都留在脫離', () => {
    const run = (y: number, z: number, loaded: boolean): DivePhase => {
      const s = stateIn('egress')
      stepDiveBomb(s, fly(0, y, z, 10, 90, 180), TARGET_AT(0, 0), loaded, createCommand())
      return s.phase
    }
    expect(run(DIVE_MIN_HEIGHT + 10, DIVE_REARM_RANGE + 10, true)).toBe('level')
    expect(run(DIVE_MIN_HEIGHT - 10, DIVE_REARM_RANGE + 10, true)).toBe('egress')
    expect(run(DIVE_MIN_HEIGHT + 10, DIVE_REARM_RANGE - 10, true)).toBe('egress')
    expect(run(DIVE_MIN_HEIGHT + 10, DIVE_REARM_RANGE + 10, false)).toBe('egress')
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

  /** 高 1,700 m、離目標 780 m、對正：Ju 87 一進來就具備壓機鼻的條件 */
  const stuka = (x = 0): Aircraft => fly(x, 1700, 780)

  it('Ju 87 有地面目標：新相位會動（沒有優先單位的入口）', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('dive')
    expect(ai.groundTarget).toBe(target)
    // 水平轟炸那一套沒有被問到
    expect(ai.strikeRef.index).toBe(-1)
  })

  it('任務指定了優先地面單位：Ju 87 照樣俯衝（另一個入口）', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.priorityGroundUnit = 'atGun'
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('dive')
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
    expect(ai.diveBombPhase).toBe('dive')
  })

  it('指定的優先單位場上沒有：和戰鬥機一樣退回打別的地面目標', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.priorityGroundUnit = 'tank'
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('dive')
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

  it('俯衝到一半目標被炸掉，這一趟照樣飛完：新相位不退回', () => {
    const self = stuka()
    const target = TARGET_AT(0, 0)
    const ai = wire(self, 0, [{ index: 0, aircraft: self }], [target], 'ju87')
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('dive')
    target.alive = false
    ai.update(self, DT, createCommand())
    expect(ai.diveBombPhase).toBe('dive')
  })

  it('G4M 有彈艙有地面目標：走水平轟炸，新狀態一個位元都沒碰', () => {
    const self = fly(0, 1700, 780, 0, 100, 0, 0, G4M)
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
    expect(ai.diveBombPhase).toBe('dive')
    ai.clearTerrainState()
    expect(ai.diveBombPhase).toBe('level')
    expect(ai.diveBomb.holdAlt).toBe(0)
  })
})
