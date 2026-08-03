import { describe, it, expect } from 'vitest'
import { Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createSituation, evaluateGeometry } from '../../src/ai/assess'
import {
  aimFromKnobs, buildEngageBasis, createEngageBasis, engageKnobs, geometryGate,
  steerCommand, DEFAULT_STEER, type Knobs,
} from '../../src/ai/steer'
import { createCommand } from '../../src/control/Controller'
import { WEP_THROTTLE } from '../../src/physics/propulsion'
import { P51D } from '../../src/specs/p51d'

function place(a: Aircraft, pos: [number, number, number], vel: [number, number, number]) {
  a.state.position.set(...pos)
  a.state.velocity.set(...vel)
  a.prevPosition.copy(a.state.position)
}

/** 平飛、機首朝 −Z 的自機。 */
function flyer(): Aircraft {
  const a = new Aircraft(P51D, 4000, 180)
  a.update(new Vector3(0, 0, -1), 0.7, 1 / 240)
  return a
}

describe('buildEngageBasis', () => {
  const basis = createEngageBasis()

  it('losAxis 由我指向目標且為單位向量', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.losAxis.length()).toBeCloseTo(1, 12)
    expect(basis.losAxis.z).toBeCloseTo(-1, 6)
  })

  it('verticalAxis 與 losAxis 正交', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [200, 4200, -400], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.verticalAxis.dot(basis.losAxis)).toBeCloseTo(0, 9)
    expect(basis.verticalAxis.length()).toBeCloseTo(1, 12)
  })

  /**
   * 【verticalAxis 為什麼取自身升力方向而不是世界上方】yo-yo 的「拉高」
   * 在物理上就是「多拉一點桿」，那個方向永遠是自己的升力方向。指揮儀是
   * bank-to-turn，大坡度時命令「世界正上方」會要求飛機先滾平再拉——那是
   * 一個做不到的指令，而且滾平的過程中什麼都沒發生。
   */
  it('滾轉時 verticalAxis 跟著機體轉，不是恆指世界上方', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])

    buildEngageBasis(self, target, basis)
    const upright = basis.verticalAxis.clone()

    // 繞機首軸滾 90°
    self.state.orientation.setFromAxisAngle(new Vector3(0, 0, -1), Math.PI / 2)
    buildEngageBasis(self, target, basis)
    expect(basis.verticalAxis.angleTo(upright)).toBeGreaterThan(1.0)
  })

  it('目標與我同速時 leadScale 趨近 0（純尾追沒有提前量）', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.leadScale).toBeLessThan(1)
  })

  it('目標橫向移動時 leadScale 顯著、leadAxis 指向運動方向', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, 0])
    place(target, [0, 4000, -400], [200, 0, 0])
    buildEngageBasis(self, target, basis)
    expect(basis.leadScale).toBeGreaterThan(20)
    expect(basis.leadAxis.x).toBeGreaterThan(0.9)
  })

  it('升力方向平行視線時標記 verticalDegenerate', () => {
    // 目標正在我的升力方向上（正上方），而我平飛 → 升力 ∥ 視線
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4600, 0], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    expect(basis.verticalDegenerate).toBe(true)
  })

  it('兩機重疊時不產生 NaN', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, 0], [0, 0, -180])
    buildEngageBasis(self, target, basis)
    for (const v of [...basis.losAxis.toArray(), ...basis.verticalAxis.toArray(),
      ...basis.leadAxis.toArray(), basis.leadScale]) {
      expect(Number.isFinite(v)).toBe(true)
    }
  })
})

describe('geometryGate', () => {
  const basis = createEngageBasis()
  const sit = createSituation()

  const setup = (
    selfPos: [number, number, number], selfVel: [number, number, number],
    targetPos: [number, number, number], targetVel: [number, number, number],
  ) => {
    const self = flyer()
    const target = flyer()
    place(self, selfPos, selfVel)
    place(target, targetPos, targetVel)
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    // 兩個能量判準都給健康值：這一組測的是其他閘門，不該被吊機首閘門搶走
    sit.stallMargin = 2
    sit.speedMargin = 5
    return { self, target }
  }

  it('一般幾何 → normal', () => {
    setup([0, 4000, 0], [0, 0, -180], [0, 4000, -500], [0, 0, -180])
    expect(geometryGate(sit, basis)).toBe('normal')
  })

  /**
   * 【超前閘門】極近距離時預瞄點會產生指揮儀兌現不了的角速度需求：
   * 100 m 外、橫向 200 m/s 的目標，視線角速度是 2 rad/s = 115°/s，
   * 而 P-51 的最大滾轉率只有約 100°/s——瞄準點會每格劇烈跳動而飛機跟不上。
   */
  it('極近距離且正在接近 → overshoot', () => {
    setup([0, 4000, 0], [0, 0, -250], [0, 4000, -60], [0, 0, -150])
    expect(geometryGate(sit, basis)).toBe('overshoot')
  })

  it('極近但正在拉開 → 不算超前', () => {
    setup([0, 4000, 0], [0, 0, -150], [0, 4000, -60], [0, 0, -250])
    expect(geometryGate(sit, basis)).not.toBe('overshoot')
  })

  /**
   * 【吊機首閘門】目標在高仰角、而我速度不夠時追上去會失速掛在那裡。
   * 這與平面奇異是**兩件事**：平飛時目標在正上方，速度與視線垂直，
   * 平面定義得很好——壞的是能量不是幾何。
   */
  it('目標在高仰角且失速裕度低 → stallGuard', () => {
    setup([0, 4000, 0], [0, 0, -120], [0, 4800, -200], [0, 0, -120])
    sit.stallMargin = DEFAULT_STEER.stallGuardMargin * 0.8
    expect(geometryGate(sit, basis)).toBe('stallGuard')
  })

  it('目標在高仰角但速度充足 → 不觸發 stallGuard', () => {
    setup([0, 4000, 0], [0, 0, -250], [0, 4800, -200], [0, 0, -250])
    sit.stallMargin = 3
    expect(geometryGate(sit, basis)).not.toBe('stallGuard')
  })

  it('升力方向平行視線 → planeDegenerate', () => {
    setup([0, 4000, 0], [0, 0, -180], [0, 4600, 0], [0, 0, -180])
    sit.stallMargin = 3
    expect(geometryGate(sit, basis)).toBe('planeDegenerate')
  })

  it('超前的優先序高於吊機首（撞上去比失速嚴重）', () => {
    setup([0, 4000, 0], [0, 0, -250], [0, 4050, -50], [0, 0, -150])
    sit.stallMargin = DEFAULT_STEER.stallGuardMargin * 0.5
    expect(geometryGate(sit, basis)).toBe('overshoot')
  })
})

describe('engageKnobs', () => {
  const k: Knobs = { leadLag: 0, vertical: 0 }
  const sit = createSituation()

  const base = () => {
    const s = createSituation()
    s.range = 500
    s.closureRate = 20
    s.timeToMerge = 25
    s.losRate = 0.05
    s.cornerRatio = 1
    s.stallMargin = 2
    s.energyAdvantage = 0
    Object.assign(sit, s)
  }

  it('接近率過高 → leadLag 為負（後置追擊殺接近率）', () => {
    base()
    sit.closureRate = 250
    sit.timeToMerge = 2
    engageKnobs(sit, k)
    expect(k.leadLag).toBeLessThan(0)
  })

  it('穩定跟蹤、接近率溫和 → leadLag 趨近 +1（進入射擊解）', () => {
    base()
    sit.closureRate = 10
    sit.timeToMerge = 50
    engageKnobs(sit, k)
    expect(k.leadLag).toBeGreaterThan(0.5)
  })

  it('接近率過高時 vertical 為正 —— 高 yo-yo 用高度吃掉多餘速度', () => {
    // 【為什麼是拉高不是卸載】卸載＝最小過載＝最小誘導阻力＝**保住速度**，
    // 會讓超前更嚴重。超前要的是相反方向：拉高（用速度換高度並增加航跡
    // 長度）。卸載屬於 extend，那裡要的正是加速脫離。
    base()
    sit.closureRate = 250
    sit.timeToMerge = 2
    engageKnobs(sit, k)
    expect(k.vertical).toBeGreaterThan(0)
  })

  it('目標正在拉開 → vertical 為負（低 yo-yo 換速度切內線）', () => {
    base()
    sit.closureRate = -80
    sit.timeToMerge = Infinity
    engageKnobs(sit, k)
    expect(k.vertical).toBeLessThan(0)
  })

  it('兩個旋鈕都夾在 [−1, 1]', () => {
    for (const closure of [-500, -100, 0, 100, 500]) {
      for (const ratio of [0.5, 1, 2]) {
        base()
        sit.closureRate = closure
        sit.cornerRatio = ratio
        sit.timeToMerge = closure > 0 ? sit.range / closure : Infinity
        engageKnobs(sit, k)
        expect(k.leadLag).toBeGreaterThanOrEqual(-1)
        expect(k.leadLag).toBeLessThanOrEqual(1)
        expect(k.vertical).toBeGreaterThanOrEqual(-1)
        expect(k.vertical).toBeLessThanOrEqual(1)
      }
    }
  })

  it('連續變化不跳躍 —— 相鄰的接近率給出相近的旋鈕值', () => {
    // 【這是選連續參數而非具名分支的理由】具名機動之間需要遲滯，
    // 連續量不需要——它會自己從一邊滑到另一邊。
    base()
    sit.closureRate = 100
    engageKnobs(sit, k)
    const a = k.leadLag
    sit.closureRate = 101
    engageKnobs(sit, k)
    expect(Math.abs(k.leadLag - a)).toBeLessThan(0.05)
  })
})

describe('aimFromKnobs', () => {
  const basis = createEngageBasis()
  const sit = createSituation()
  const out = new Vector3()
  const k: Knobs = { leadLag: 1, vertical: 0 }

  const scene = () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [150, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
  }

  it('輸出恆為單位向量', () => {
    scene()
    for (const lead of [-1, 0, 1]) {
      for (const vert of [-1, 0, 1]) {
        k.leadLag = lead
        k.vertical = vert
        aimFromKnobs(basis, sit, k, out)
        expect(out.length()).toBeCloseTo(1, 12)
      }
    }
  })

  it('leadLag = +1、vertical = 0 時就是彈道預瞄方向', () => {
    scene()
    k.leadLag = 1
    k.vertical = 0
    aimFromKnobs(basis, sit, k, out)
    const expected = basis.leadPoint.clone().normalize()
    expect(out.angleTo(expected)).toBeCloseTo(0, 9)
  })

  it('leadLag 由 +1 降到 −1，瞄準點沿目標運動方向往後移', () => {
    scene()
    k.vertical = 0
    k.leadLag = 1
    aimFromKnobs(basis, sit, k, out)
    const ahead = out.clone()
    k.leadLag = -1
    aimFromKnobs(basis, sit, k, out)
    // 往後移代表在 leadAxis 上的投影變小
    expect(out.dot(basis.leadAxis)).toBeLessThan(ahead.dot(basis.leadAxis))
  })

  it('vertical = +1 時瞄準點往升力方向偏', () => {
    scene()
    k.leadLag = 0
    k.vertical = 0
    aimFromKnobs(basis, sit, k, out)
    const level = out.clone()
    k.vertical = 1
    aimFromKnobs(basis, sit, k, out)
    expect(out.dot(basis.verticalAxis)).toBeGreaterThan(level.dot(basis.verticalAxis))
  })

  it('角位移不超過設定的上限', () => {
    scene()
    k.leadLag = -1
    k.vertical = 1
    aimFromKnobs(basis, sit, k, out)
    const toTarget = basis.losAxis
    // 兩軸各最多 maxOffsetAngle，合起來不超過 √2 倍
    expect(out.angleTo(toTarget)).toBeLessThan(DEFAULT_STEER.maxOffsetAngle * 1.5)
  })

  it('leadAxis 退化時 leadLag 不造成影響（不會亂指）', () => {
    // 純尾追、雙方同速：目標運動方向 ∥ 視線
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -400], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    expect(basis.leadDegenerate).toBe(true)

    k.vertical = 0
    k.leadLag = 1
    aimFromKnobs(basis, sit, k, out)
    const a = out.clone()
    k.leadLag = -1
    aimFromKnobs(basis, sit, k, out)
    expect(out.angleTo(a)).toBeCloseTo(0, 9)
  })
})

describe('steerCommand', () => {
  const basis = createEngageBasis()
  const sit = createSituation()
  const cmd = createCommand()
  const k: Knobs = { leadLag: 1, vertical: 0 }
  let self: Aircraft

  const scene = (targetPos: [number, number, number], targetVel: [number, number, number]) => {
    self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, targetPos, targetVel)
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.stallMargin = 2
    sit.cornerRatio = 1
    engageKnobs(sit, k)
  }

  it('任何意圖與模式的組合，aimWorld 都是單位向量', () => {
    scene([0, 4000, -400], [150, 0, -180])
    for (const intent of ['defend', 'merge', 'extend', 'engage', 'approach'] as const) {
      for (const mode of ['normal', 'overshoot', 'stallGuard', 'planeDegenerate'] as const) {
        steerCommand(intent, mode, sit, basis, self, k, cmd)
        expect(cmd.aimWorld.length(), `${intent}/${mode}`).toBeCloseTo(1, 9)
      }
    }
  })

  it('預設是 WEP、不減速', () => {
    scene([0, 4000, -600], [0, 0, -180])
    steerCommand('approach', 'normal', sit, basis, self, k, cmd)
    expect(cmd.throttle).toBe(WEP_THROTTLE)
    expect(cmd.brake).toBe(0)
  })

  it('超前閘門 → 減速全開且油門收掉', () => {
    scene([0, 4000, -80], [0, 0, -120])
    steerCommand('engage', 'overshoot', sit, basis, self, k, cmd)
    expect(cmd.brake).toBe(1)
    expect(cmd.throttle).toBeLessThan(0.5)
  })

  it('速度遠高於角落速度 → 減速（不是靠 VNE 判斷）', () => {
    scene([0, 4000, -600], [0, 0, -180])
    sit.cornerRatio = 2.5
    steerCommand('engage', 'normal', sit, basis, self, k, cmd)
    expect(cmd.brake).toBeGreaterThan(0)
  })

  it('角落速度附近不減速', () => {
    scene([0, 4000, -600], [0, 0, -180])
    sit.cornerRatio = 1.1
    steerCommand('engage', 'normal', sit, basis, self, k, cmd)
    expect(cmd.brake).toBe(0)
  })

  /**
   * 【extend 用卸載，而且它與超前修正是相反方向】卸載＝把瞄準點放到自身
   * 速度向量上＝指揮儀沒有轉向需求＝過載趨近 1 G＝誘導阻力最小＝**保住
   * 並累積速度**。這正是脫離重整要的。
   *
   * 超前修正要的則是相反：拉高 yo-yo 用速度換高度、增加航跡長度。把卸載
   * 寫進超前修正是本設計初稿犯過的錯（見 spec §7.4）。
   */
  it('extend 的瞄準點貼著自身速度向量（卸載）', () => {
    scene([0, 4000, -600], [0, 0, -180])
    sit.energyAdvantage = 0
    steerCommand('extend', 'normal', sit, basis, self, k, cmd)
    const velDir = self.state.velocity.clone().normalize()
    expect(cmd.aimWorld.angleTo(velDir)).toBeLessThan(20 * Math.PI / 180)
  })

  it('extend 在能量劣勢時帶爬升分量', () => {
    scene([0, 4000, -600], [0, 0, -180])
    sit.energyAdvantage = -1200
    steerCommand('extend', 'normal', sit, basis, self, k, cmd)
    const velDir = self.state.velocity.clone().normalize()
    expect(cmd.aimWorld.y).toBeGreaterThan(velDir.y)
  })

  it('defend 的瞄準點明顯偏離目標方向（破壞他的預瞄解）', () => {
    scene([0, 4000, 300], [0, 0, -180])
    steerCommand('defend', 'normal', sit, basis, self, k, cmd)
    expect(cmd.aimWorld.angleTo(basis.losAxis)).toBeGreaterThan(45 * Math.PI / 180)
  })

  it('planeDegenerate → 退化為純追擊（指著目標，不亂偏）', () => {
    scene([0, 4600, 0], [0, 0, -180])
    steerCommand('engage', 'planeDegenerate', sit, basis, self, k, cmd)
    expect(cmd.aimWorld.angleTo(basis.losAxis)).toBeCloseTo(0, 6)
  })

  it('stallGuard → 不追上去，瞄準點回到速度向量附近恢復能量', () => {
    scene([0, 4800, -200], [0, 0, -120])
    sit.stallMargin = 1.1
    steerCommand('engage', 'stallGuard', sit, basis, self, k, cmd)
    const velDir = self.state.velocity.clone().normalize()
    expect(cmd.aimWorld.angleTo(velDir)).toBeLessThan(basis.losAxis.angleTo(velDir))
  })

  it('approach 指向彈道預瞄點', () => {
    scene([0, 4000, -900], [150, 0, -180])
    steerCommand('approach', 'normal', sit, basis, self, k, cmd)
    expect(cmd.aimWorld.angleTo(basis.leadPoint.clone().normalize())).toBeCloseTo(0, 6)
  })

  it('不修改 firing —— 開火由 fire.ts 決定', () => {
    scene([0, 4000, -400], [0, 0, -180])
    cmd.firing = true
    steerCommand('engage', 'normal', sit, basis, self, k, cmd)
    expect(cmd.firing).toBe(true)
  })

  it('連續呼叫不配置：一萬次結果一致', () => {
    scene([0, 4000, -400], [150, 0, -180])
    steerCommand('engage', 'normal', sit, basis, self, k, cmd)
    const first = cmd.aimWorld.clone()
    for (let i = 0; i < 10000; i++) {
      steerCommand('engage', 'normal', sit, basis, self, k, cmd)
    }
    expect(cmd.aimWorld.equals(first)).toBe(true)
  })
})

describe('stallGuard 的第二道判準 —— 絕對速度', () => {
  const basis = createEngageBasis()
  const sit = createSituation()

  /** 目標吊在正上方偏前：仰角遠高於 stallGuardElevation。 */
  const targetAbove = () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 3000, 0], [0, 60, -20])
    place(target, [0, 3800, -200], [0, 0, -120])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
  }

  /**
   * 【M4 出貨後抓到的缺陷】垂直爬升時過載趨近 0，而 `Vs ∝ √n` 也跟著縮小，
   * `stallMargin` 於是被撐大——P-51D 實測在 132 km/h 時它讀 4.63，遠高於
   * 1.25 的門檻。閘門在它最該觸發的場景幾乎不觸發。
   */
  it('過載趨近 0 讓 stallMargin 失效時，速度判準仍然攔得住', () => {
    targetAbove()
    sit.stallMargin = 40                                    // 瞎掉的舊判準
    sit.speedMargin = DEFAULT_STEER.stallGuardSpeed * 0.8    // 但速度真的不夠
    expect(geometryGate(sit, basis)).toBe('stallGuard')
  })

  it('兩個判準是「或」的關係：拉太猛也照樣觸發', () => {
    targetAbove()
    sit.stallMargin = DEFAULT_STEER.stallGuardMargin * 0.8   // 拉太猛
    sit.speedMargin = 5                                      // 速度很夠
    expect(geometryGate(sit, basis)).toBe('stallGuard')
  })

  it('兩個判準都健康時不觸發', () => {
    targetAbove()
    sit.stallMargin = 3
    sit.speedMargin = 5
    expect(geometryGate(sit, basis)).not.toBe('stallGuard')
  })

  it('目標不在高仰角、自己也沒在爬升時，速度再低也不觸發', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 3000, 0], [0, 0, -60])
    place(target, [0, 3000, -600], [0, 0, -120])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.stallMargin = 3
    sit.speedMargin = 0.5
    expect(geometryGate(sit, basis)).not.toBe('stallGuard')
  })
})

describe('stallGuard 的第三道判準 —— 自己的航跡角', () => {
  const basis = createEngageBasis()
  const sit = createSituation()

  /**
   * 目標在同一空層的正前方（仰角約 0），但**我自己**正陡爬。
   *
   * 【這是人工驗收抓到的缺陷】閘門原本只看目標仰角，等於只問「目標是不是
   * 吊在我上面」。實測 `extend` 的俯仰偏置滾雪球，會讓 AI 把自己吊到 85°
   * 而目標仍在同一空層——目標仰角接近 0，閘門一次都不觸發，AI 就這樣把
   * 自己吊到失速。「我正在把自己吊上去」與「目標吊在上面」是兩件事。
   */
  const selfClimbing = () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 3000, 0], [0, 170, -30])      // 航跡角約 80°
    place(target, [0, 3000, -800], [0, 0, -120])  // 同一空層，正前方
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    // 前提：目標仰角確實低於門檻，否則這條測試量到的是舊判準
    expect(Math.asin(basis.losAxis.y)).toBeLessThan(DEFAULT_STEER.stallGuardElevation)
    expect(sit.climbAngle).toBeGreaterThan(DEFAULT_STEER.stallGuardElevation)
  }

  it('自己陡爬且速度不夠時觸發', () => {
    selfClimbing()
    sit.stallMargin = 40                                   // 舊判準瞎掉
    sit.speedMargin = DEFAULT_STEER.stallGuardSpeed * 0.8   // 但速度真的不夠
    expect(geometryGate(sit, basis)).toBe('stallGuard')
  })

  it('自己陡爬但速度充足時不觸發（爬升本身不是問題）', () => {
    selfClimbing()
    sit.stallMargin = 3
    sit.speedMargin = 5
    expect(geometryGate(sit, basis)).not.toBe('stallGuard')
  })
})

describe('extend 的俯仰偏置不會滾雪球', () => {
  const basis = createEngageBasis()
  const sit = createSituation()
  const cmd = createCommand()
  const knobs: Knobs = { leadLag: 0, vertical: 0 }

  /**
   * 【這是人工驗收抓到的主缺陷】`unloadAim` 原本寫成 `v.y += tan(pitch)`，
   * 把偏置加在**當前**速度向量上。飛機會追上去，下一格再從轉過的新方向
   * 加一次——指令角度於是每格滾雪球。實測：`extend` 一啟動，瞄準仰角 4 秒
   * 由 −27° 跑到 −56°（垂直俯衝）；能量差翻負後改成爬升偏置，7 秒由 +16°
   * 跑到 +85°、TAS 由 688 掉到 498 km/h。那正是「AI 自己吊到失速」的來源。
   *
   * 這條測試模擬**完美跟隨**：每一輪把速度向量設成上一輪的指令方向，再問
   * 一次指令。航跡角相對地平線定義的話，答案每一輪都該是同一個角度。
   */
  const followLoop = (energyAdvantage: number): number[] => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -1000], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.energyAdvantage = energyAdvantage

    const out: number[] = []
    for (let i = 0; i < 20; i++) {
      steerCommand('extend', 'normal', sit, basis, self, knobs, cmd)
      out.push(Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y))))
      // 完美跟隨：速度轉到剛剛的指令方向，保持速率
      self.state.velocity.copy(cmd.aimWorld).multiplyScalar(180)
    }
    return out
  }

  it('能量優勢時：每一輪都是 −extendPitch，不會愈俯愈陡', () => {
    for (const a of followLoop(500)) {
      expect(a).toBeCloseTo(-DEFAULT_STEER.extendPitch, 9)
    }
  })

  it('能量劣勢時：每一輪都是 +extendPitch，不會愈爬愈陡', () => {
    for (const a of followLoop(-500)) {
      expect(a).toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
    }
  })

  it('維持航向：只改變航跡角，不會把飛機轉往別的方位', () => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 4000, 0], [0, 0, -180])
    place(target, [0, 4000, -1000], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.energyAdvantage = -500

    steerCommand('extend', 'normal', sit, basis, self, knobs, cmd)
    // 原航向是 −Z；指令的水平分量必須仍指向 −Z
    expect(cmd.aimWorld.x).toBeCloseTo(0, 9)
    expect(cmd.aimWorld.z).toBeLessThan(0)
    expect(cmd.aimWorld.length()).toBeCloseTo(1, 9)
  })
})

describe('超前的判斷要用幾何門住', () => {
  const sit = createSituation()
  const k: Knobs = { leadLag: 0, vertical: 0 }

  /**
   * 【人工驗收抓到的缺陷】對頭時接近率是**雙方速度相加**。兩台各 150 m/s
   * 就是 282 m/s，`excess` 算出 0.88，兩個旋鈕直接推到底——全後置追擊 +
   * 滿舵高 yo-yo。實測機首因此離預瞄點 24–40°，而威脅錐 15°、開火錐 3°，
   * 於是兩邊都不開火、兩邊的 `threatInstant` 都恆為 0，連 `defend` 在對頭時
   * 都結構上不可能觸發。看起來就是「AI 撇頭拒絕交戰」。
   *
   * 而那個反應本來就沒有意義：對頭的接近率是幾何給定的，任何機動都減不掉。
   */
  it('對頭時的高接近率不算超前：維持乾淨的預瞄追擊', () => {
    sit.closureRate = 282
    sit.angleOffTail = 173 * (Math.PI / 180)   // 他正朝我來
    engageKnobs(sit, k)
    expect(k.leadLag).toBeGreaterThan(0.9)     // 前置，不是後置
    expect(Math.abs(k.vertical)).toBeLessThan(0.1)  // 幾乎不做 yo-yo
  })

  it('尾追時這道門是恆等變換：後置與高 yo-yo 完全照舊', () => {
    sit.closureRate = 282
    sit.angleOffTail = 0                       // 我咬在他正後方
    engageKnobs(sit, k)
    // 未加門時的原式：excess = (282 − 150) / 150
    const excess = (282 - 150) / 150
    expect(k.leadLag).toBeCloseTo(1 - 2 * excess, 12)
    expect(k.vertical).toBeCloseTo(excess, 12)
    expect(k.leadLag).toBeLessThan(0)          // 確實是後置
  })

  it('正側方是中間值', () => {
    sit.closureRate = 282
    sit.angleOffTail = Math.PI / 2
    engageKnobs(sit, k)
    expect(k.leadLag).toBeGreaterThan(-1)
    expect(k.leadLag).toBeLessThan(0.9)
    expect(k.vertical).toBeGreaterThan(0)
    expect(k.vertical).toBeLessThan(1)
  })

  /** 「追不上」與方位無關——他跑掉了就是要切內線，不該被門住。 */
  it('追不上時不受幾何門影響：對頭與尾追給同一個低 yo-yo', () => {
    sit.closureRate = -150
    sit.angleOffTail = 173 * (Math.PI / 180)
    engageKnobs(sit, k)
    const headOn = k.vertical
    sit.angleOffTail = 0
    engageKnobs(sit, k)
    expect(k.vertical).toBeCloseTo(headOn, 12)
    expect(headOn).toBeLessThan(0)
  })
})

describe('extend 在絕對能量見底時一律爬升', () => {
  const basis = createEngageBasis()
  const sit = createSituation()
  const cmd = createCommand()
  const knobs: Knobs = { leadLag: 0, vertical: 0 }

  /**
   * 【為什麼見底時不能照相對能量差決定俯仰】`Es = 高度 + 動能高度 ≥ 高度`，
   * 所以 `energyReserve < 0`（比能量低於「還打得動」的底線）**必然**蘊含
   * 高度也很低。此時若因為「我比他強」而俯衝，等於把僅剩的高度也丟掉
   * ——實測共速共高開局因此掉到離海 109 m。
   */
  const aimPitch = (energyAdvantage: number, energyReserve: number): number => {
    const self = flyer()
    const target = flyer()
    place(self, [0, 900, 0], [0, 0, -180])
    place(target, [0, 900, -1000], [0, 0, -180])
    evaluateGeometry(self, target, sit)
    buildEngageBasis(self, target, basis)
    sit.energyAdvantage = energyAdvantage
    sit.energyReserve = energyReserve
    steerCommand('extend', 'normal', sit, basis, self, knobs, cmd)
    return Math.asin(Math.max(-1, Math.min(1, cmd.aimWorld.y)))
  }

  it('底線之上：能量優勢時俯衝、劣勢時爬升（既有行為）', () => {
    expect(aimPitch(500, 1000)).toBeCloseTo(-DEFAULT_STEER.extendPitch, 9)
    expect(aimPitch(-500, 1000)).toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
  })

  it('底線之下：即使有能量優勢也爬升', () => {
    expect(aimPitch(500, -200)).toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
  })

  it('底線之下且能量劣勢：同樣爬升', () => {
    expect(aimPitch(-500, -200)).toBeCloseTo(DEFAULT_STEER.extendPitch, 9)
  })
})
