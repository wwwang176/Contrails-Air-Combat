import { describe, it, expect } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { Aircraft } from '../../src/aircraft/Aircraft'
import { createCommand } from '../../src/control/Controller'
import { applySafety, flightPathRate, recoveryAltitude, DEFAULT_SAFETY } from '../../src/ai/safety'
import { DEFAULT_STEER } from '../../src/ai/steer'
import { P51D } from '../../src/specs/p51d'
import { A6M5 } from '../../src/specs/a6m5'
import { atmosphere } from '../../src/physics/atmosphere'
import { DEG, G0 } from '../../src/core/math'
import type { TerrainSense } from '../../src/ai/terrainSense'
import type { AircraftSpec } from '../../src/specs/types'

/**
 * 讓 P-51 以 tas 沿 dir 飛，位於 altitude。
 *
 * 【要驗「不介入」的案例 TAS 用 200】250 m/s 在 4000 m 的 IAS 已是 P-51 紅線的
 * 0.91、在 200 m 是 1.1 —— 會先被超速守線接管，量到的不是撞地那條規則。
 */
function diving(altitude: number, tas: number, gammaDeg: number): Aircraft {
  return divingSpec(P51D, altitude, tas, gammaDeg)
}

function divingSpec(spec: AircraftSpec, altitude: number, tas: number, gammaDeg: number): Aircraft {
  const a = new Aircraft(spec, altitude, tas)
  const g = gammaDeg * DEG
  const dir = new Vector3(0, Math.sin(g), -Math.cos(g))
  a.state.position.set(0, altitude, 0)
  a.state.velocity.copy(dir).multiplyScalar(tas)
  a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
  a.prevPosition.copy(a.state.position)
  a.prevOrientation.copy(a.state.orientation)
  a.update(dir, 0.7, 1 / 240)
  return a
}

describe('recoveryAltitude', () => {
  it('水平飛行不需要任何高度', () => {
    expect(recoveryAltitude(200, 0, 6)).toBeCloseTo(0, 9)
  })

  it('俯衝角越大需要越多高度', () => {
    const shallow = recoveryAltitude(200, -20 * DEG, 6)
    const steep = recoveryAltitude(200, -60 * DEG, 6)
    expect(steep).toBeGreaterThan(shallow)
  })

  /**
   * 【這是安全層的核心物理，也是它為什麼要收油門】拉起半徑正比於 V²，
   * 所以速度加倍、所需高度變成四倍。高速俯衝時「拉起來」不夠，還得
   * **減速**才拉得起來——這直接決定了硬接管時的油門政策。
   */
  it('所需高度正比於速度平方', () => {
    const slow = recoveryAltitude(150, -45 * DEG, 6)
    const fast = recoveryAltitude(300, -45 * DEG, 6)
    expect(fast / slow).toBeCloseTo(4, 1)
  })

  it('過載上限越大需要越少高度', () => {
    const weak = recoveryAltitude(200, -45 * DEG, 2)
    const strong = recoveryAltitude(200, -45 * DEG, 6)
    expect(strong).toBeLessThan(weak)
  })

  /**
   * 【`nMax > 1` 只是說「用現在這個速度」拉不平，不是說救不回來】俯衝會把
   * 高度換成速度，而 `nMax ∝ V²`。真正的改出是兩段：先換速度、再拉平，
   * 兩段的高度代價都是有限的。回 Infinity 會讓撞地分支在任何高度接管，
   * 而那台飛機其實只是失速（spec 2026-08-09 §2）。
   */
  it('拉不動（nMax < 1）時回傳有限值，不是 Infinity', () => {
    const h = recoveryAltitude(200, -45 * DEG, 0.5)
    expect(Number.isFinite(h)).toBe(true)
    expect(h).toBeGreaterThan(0)
  })

  it('拉不動時，俯衝角越陡仍然需要越多高度', () => {
    const shallow = recoveryAltitude(200, -20 * DEG, 0.5)
    const steep = recoveryAltitude(200, -60 * DEG, 0.5)
    expect(steep).toBeGreaterThan(shallow)
  })

  /** 越拉不動，要換的速度越多，第一段就越長。 */
  it('拉不動時，nMax 越小需要越多高度', () => {
    const weak = recoveryAltitude(200, -45 * DEG, 0.3)
    const strong = recoveryAltitude(200, -45 * DEG, 0.9)
    expect(weak).toBeGreaterThan(strong)
  })

  /**
   * 【真正的「救不回來」與無效輸入】完全沒有升力時 `n(v) = nMax·(v/tas)²`
   * 恆為 0，換多少速度都拉不動。負值與 `NaN` 也走這條 —— 少了這道守衛，
   * `nMax` 為 `NaN` 會讓回傳值變成 `NaN`，一路流到 `margin <= needed`，
   * 那個比較永遠為假，安全層就**永遠不介入**，比誤觸發更糟。
   */
  it('nMax 為 0、負值或 NaN 時回傳 Infinity', () => {
    expect(recoveryAltitude(200, -45 * DEG, 0)).toBe(Infinity)
    expect(recoveryAltitude(200, -45 * DEG, -1)).toBe(Infinity)
    expect(recoveryAltitude(200, -45 * DEG, NaN)).toBe(Infinity)
  })

  /**
   * 【極淺的負俯衝不能算出 NaN】`c = 1 − cos|γ|` 在 `|γ| < 2×10⁻⁸` rad 時會
   * 被捨入成 0，於是 `√(n*²−1)` 也是 0。拉起項若照字面寫成 `v²·c / (g·root)`
   * 就是 `Infinity × 0 = NaN` —— 而 NaN 流進 `margin <= needed` 會讓那個比較
   * 永遠為假，安全層永遠不介入。
   *
   * 實作改用恆等式 `c / root ≡ root² / 2` 把它寫成純乘法。這一條是那個改寫
   * 的守門人。
   */
  it('極淺的負俯衝角不會算出 NaN', () => {
    for (const g of [-1e-4, -1e-6, -1e-8, -1e-12]) {
      const h = recoveryAltitude(200, g, 0.5)
      expect(Number.isFinite(h)).toBe(true)
      expect(h).toBeGreaterThan(0)
    }
  })

  /**
   * 【同一個角落的另一半：單段支的 nMax 恰為 1】`c` 捨入成 0 時 `n*` 也捨入
   * 成 1，於是 `nMax = 1` 會落進單段支並除以 `√(1−1) = 0`。
   *
   * 那裡的正確答案是 **0**，不是 `Infinity` —— 兩段模型只要加速無限小就能
   * 拿到正的剩餘過載，再穿過一個無限小的角度。回 `Infinity` 是**單段**模型
   * 的極限，套在這裡等於在一個窄角落裡重建這次要修掉的缺陷（撞地分支在
   * 任何高度成立）。所以 `q <= 0` 要落到兩段公式。
   *
   * 【也要連續】`−1.5×10⁻⁸`（`c` 還沒塌成 0）與 `−10⁻⁸`（已經塌成 0）之間
   * 不能有跳變。
   */
  it('nMax 恰為 1 且俯衝角極淺時回傳 0，而且沒有跳變', () => {
    expect(recoveryAltitude(200, -1e-12, 1)).toBe(0)
    const justAbove = recoveryAltitude(200, -1.5e-8, 1)
    const justBelow = recoveryAltitude(200, -1e-8, 1)
    expect(Number.isFinite(justAbove)).toBe(true)
    expect(Number.isFinite(justBelow)).toBe(true)
    expect(Math.abs(justAbove - justBelow)).toBeLessThan(1e-3)
  })

  /**
   * 【這一條是兩段模型的定義，也是唯一守得住 `n*` 的斷言】兩段模型是
   * 「先俯衝到某個速度 `v`，再在 `v` 上拉平」，而 `v` 只能比現在快
   * （俯衝只會加速）。`recoveryAltitude` 宣稱回傳的是**所有可行 `v` 之中
   * 最便宜的那一個**，`n*` 只是那個最小值點的閉式解。
   *
   * 所以直接數值掃描一遍，比對兩件事：回傳值不高於掃描到的最小值（`n*`
   * 沒有解錯），也不顯著低於它（沒有少算某一段）。
   *
   * 【為什麼要涵蓋 1 < nMax < n*】那一段是「現在拉得動，但加速一點更划算」。
   * 若分界誤寫成 `nMax > 1`，這幾格會走單段公式而偏高，只有這條會抓到。
   */
  it('回傳的是兩段模型在所有可行拉起速度上的最小值', () => {
    const g = -45 * DEG
    const c = 1 - Math.cos(Math.abs(g))
    const tas = 200
    for (const nMax of [0.4, 0.9, 1.1, 1.3, 3]) {
      let best = Infinity
      // v 從 tas 掃到 5 × tas，步長 0.2 m/s
      for (let i = 0; i <= 4000; i++) {
        const v = tas * (1 + i * 0.001)
        const r = v / tas
        const n = nMax * r * r
        if (n <= 1) continue
        const dive = (v * v - tas * tas) / (2 * G0)
        const pull = ((v * v) / (G0 * Math.sqrt(n * n - 1))) * c
        best = Math.min(best, dive + pull)
      }
      const h = recoveryAltitude(tas, g, nMax)
      expect(h).toBeLessThanOrEqual(best)
      expect(h).toBeGreaterThan(best * 0.999)
    }
  })

  /**
   * 【拉得動的那一側一個字都沒變】這一條釘住「不是換模型，是把定義域補完」。
   * 用 `toBe` 逐位元比 —— 式子與運算順序都與修改前的單段閉式解相同，浮點
   * 結果必須完全一致。實測整張安全矩陣 288 格 `changed = 0`，就是靠這件事。
   */
  it('拉得動時與單段閉式解逐位元相同', () => {
    const radius = (200 * 200) / (G0 * Math.sqrt(6 * 6 - 1))
    expect(recoveryAltitude(200, -45 * DEG, 6))
      .toBe(radius * (1 - Math.cos(45 * DEG)))
  })

  /**
   * 【`tas` 會抵消掉】第一段要換到的速度是 `v² = tas²·n* / nMax`，而
   * `nMax ∝ tas²`，所以 `tas²` 上下相消 —— `v` 有極限，不是奇點。
   * 這裡用固定的 `nMax/tas²` 比值把速度一路壓小來驗。
   */
  it('速度趨近 0 時回傳有限值', () => {
    const a = 0.5 / (200 * 200) // nMax / tas²，固定
    for (const tas of [200, 20, 2, 0.2]) {
      const h = recoveryAltitude(tas, -45 * DEG, a * tas * tas)
      expect(Number.isFinite(h)).toBe(true)
    }
  })

  it('爬升時（gamma > 0）不需要高度', () => {
    expect(recoveryAltitude(200, 30 * DEG, 6)).toBeCloseTo(0, 9)
  })
})

describe('flightPathRate', () => {
  /**
   * 把飛機擺成「以 tas 沿 γ 飛、坡度 φ、過載 n」，然後只讀 `flightPathRate`。
   *
   * 【為什麼不跑 `update`】要驗的是「給定姿態與過載，γ̇ 是多少」這條代數，
   * 跑一步物理會讓過載變成飛機自己算出來的值，就驗不到指定的 n。
   */
  function posed(tas: number, gammaDeg: number, bankDeg: number, n: number): Aircraft {
    const a = new Aircraft(P51D, 4000, tas)
    const g = gammaDeg * DEG
    const dir = new Vector3(0, Math.sin(g), -Math.cos(g))
    a.state.velocity.copy(dir).multiplyScalar(tas)
    a.state.orientation.setFromUnitVectors(new Vector3(0, 0, -1), dir)
    // 繞速度向量滾 φ
    a.state.orientation.multiply(
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, -1), bankDeg * DEG),
    )
    a.diag.loadFactor = n
    return a
  }

  it('平飛 1 G 時航跡角不變', () => {
    expect(flightPathRate(posed(200, 0, 0, 1))).toBeCloseTo(0, 6)
  })

  it('平飛 0 G 是自由落體：γ̇ = −g/V', () => {
    expect(flightPathRate(posed(200, 0, 0, 0))).toBeCloseTo(-9.80665 / 200, 6)
  })

  it('平飛拉 4 G 時航跡角以 g(n−1)/V 上揚', () => {
    expect(flightPathRate(posed(200, 0, 0, 4))).toBeCloseTo(9.80665 * 3 / 200, 6)
  })

  it('90° 坡度時升力完全不進垂直平面，只剩重力', () => {
    // n·cos φ = 0，所以 γ̇ = −g·cos γ / V
    expect(flightPathRate(posed(200, 0, 90, 4))).toBeCloseTo(-9.80665 / 200, 5)
  })

  it('倒飛拉桿會把航跡往下扯', () => {
    // 180° 坡度：升力朝下，n·cos φ = −4
    expect(flightPathRate(posed(200, 0, 180, 4))).toBeCloseTo(9.80665 * -5 / 200, 5)
  })

  it('俯衝時重力項按 cos γ 縮小', () => {
    // γ = −60°，1 G 正拉：γ̇ = g(1 − cos60)/V
    expect(flightPathRate(posed(200, -60, 0, 1))).toBeCloseTo(9.80665 * 0.5 / 200, 5)
  })

  it('速度越快同樣的過載扭轉航跡越慢', () => {
    const slow = flightPathRate(posed(120, 0, 0, 4))
    const fast = flightPathRate(posed(300, 0, 0, 4))
    expect(slow).toBeGreaterThan(fast)
    expect(slow / fast).toBeCloseTo(300 / 120, 5)
  })

  it('速度為零時回 0 而不是 NaN', () => {
    const a = posed(200, 0, 0, 1)
    a.state.velocity.set(0, 0, 0)
    expect(flightPathRate(a)).toBe(0)
  })

  it('垂直俯衝時垂直平面退化，回 0 而不是 NaN', () => {
    // γ = −90°：速度沿 −ŷ，「垂直平面內垂直於速度且朝上」沒有唯一解
    expect(Number.isFinite(flightPathRate(posed(200, -90, 0, 4)))).toBe(true)
  })
})

describe('applySafety', () => {
  const cmd = createCommand()

  const clean = () => {
    cmd.aimWorld.set(0, -0.7, -0.7).normalize()
    cmd.throttle = 1.1
    cmd.brake = 0
    cmd.firing = true
  }

  /**
   * 【「不誤觸發」與「不漏」同等重要】一個永遠開著的安全層會讓 AI 飛得
   * 很怪，而且沒人會發現原因——它看起來只是「這台 AI 好像不太敢俯衝」。
   */
  it('巡航高度平飛 → 不介入，指令原封不動', () => {
    const a = diving(4000, 180, 0)
    clean()
    const aim = cmd.aimWorld.clone()
    expect(applySafety(a, 0, cmd)).toBe('none')
    expect(cmd.aimWorld.equals(aim)).toBe(true)
    expect(cmd.throttle).toBe(1.1)
    expect(cmd.firing).toBe(true)
  })

  it('巡航高度陡俯衝 → 不介入（高度夠，拉得起來）', () => {
    const a = diving(4000, 200, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe('none')
  })

  it('低空陡俯衝 → 介入', () => {
    const a = diving(200, 250, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe('ground')
  })

  it('介入時瞄準點指向地平線上方', () => {
    const a = diving(200, 250, -60)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.aimWorld.y).toBeGreaterThan(0)
  })

  it('介入時停火 —— 快撞海了不該還在開火', () => {
    const a = diving(200, 250, -60)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.firing).toBe(false)
  })

  /**
   * 【脫離向量必須滾轉友善】指揮儀是 bank-to-turn：大坡度時命令「世界
   * 正上方」會要求飛機先滾平再拉，而滾平的過程中高度還在掉。脫離向量
   * 保持當前航向、只把仰角抬起來，指揮儀就能同時滾平與拉起。
   */
  it('脫離向量保持當前航向（水平分量與速度同向）', () => {
    const a = diving(200, 250, -50)
    clean()
    applySafety(a, 0, cmd)
    const velHoriz = new Vector3(a.state.velocity.x, 0, a.state.velocity.z).normalize()
    const aimHoriz = new Vector3(cmd.aimWorld.x, 0, cmd.aimWorld.z).normalize()
    expect(aimHoriz.angleTo(velHoriz)).toBeCloseTo(0, 4)
  })

  it('高速時減速（拉起半徑 ∝ V²，減速才拉得起來）', () => {
    const a = diving(200, 300, -60)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.brake).toBeGreaterThan(0)
  })

  it('低速時滿油門（防失速），不減速', () => {
    const a = diving(150, 90, -30)
    clean()
    applySafety(a, 0, cmd)
    expect(cmd.brake).toBe(0)
    expect(cmd.throttle).toBeGreaterThan(1)
  })

  it('海面高度不是 0 時一併考慮', () => {
    // 未來加入地形時，seaHeight 會換成該點的地表高度
    const a = diving(200, 200, -60)
    clean()
    expect(applySafety(a, 0, cmd)).toBe('ground')
    clean()
    // 同樣的飛機，但「海面」在 −3000 → 其實還很高
    expect(applySafety(a, -3000, cmd)).toBe('none')
  })

  /**
   * 【缺陷複現，spec 2026-08-09 §1】實測 `ai-command-channel` 的
   * `groundUnderOrder` 護欄紅掉時，六次事件全部長這樣：五公里以上、
   * TAS 48–58、下沉率約 0.5 m/s。那個高度不可能有撞地風險，飛機只是
   * 失速了 —— 而撞地分支會命令它爬升，正好是最不該做的事。
   *
   * 修改前這裡回 `'ground'`：`nMax = 0.71 ≤ 1` → `recoveryAltitude`
   * 回 Infinity → `margin <= Infinity` 在任何高度都成立。
   */
  it('五公里高空、失速速度、微幅下沉 → 走失速分支而不是撞地分支', () => {
    const a = new Aircraft(P51D, 5038, 50)
    a.state.position.set(0, 5038, 0)
    a.state.velocity.set(0, -0.5, -50)
    a.prevPosition.copy(a.state.position)
    clean()
    expect(applySafety(a, 0, cmd)).toBe('stall')
  })

  /**
   * 【光是換分支不夠，補救方向要真的反過來】所以這裡**不用** `clean()` ——
   * 它設的命令本來就是壓頭、滿油門、不減速，`applySafety` 就算完全不介入
   * 也會通過。改成先擺一個抬頭、收油門、放減速板、開火的命令，再看它有沒有
   * 被整個覆寫掉。
   */
  it('那一格的補救是壓頭加油門，而且真的覆寫了原本的命令', () => {
    const a = new Aircraft(P51D, 5038, 50)
    a.state.position.set(0, 5038, 0)
    a.state.velocity.set(0, -0.5, -50)
    a.prevPosition.copy(a.state.position)
    cmd.aimWorld.set(0, 1, 0)
    cmd.throttle = 0.2
    cmd.brake = 1
    cmd.firing = true
    expect(applySafety(a, 0, cmd)).toBe('stall')
    expect(cmd.aimWorld.y).toBeLessThan(0)
    expect(cmd.throttle).toBeGreaterThan(1)
    expect(cmd.brake).toBe(0)
    expect(cmd.firing).toBe(false)
  })

  it('連續呼叫不配置：一萬次結果一致', () => {
    const a = diving(200, 250, -60)
    clean()
    applySafety(a, 0, cmd)
    const first = cmd.aimWorld.clone()
    for (let i = 0; i < 10000; i++) {
      clean()
      applySafety(a, 0, cmd)
    }
    expect(cmd.aimWorld.equals(first)).toBe(true)
  })
})

/**
 * 失速硬介入 —— 瞄準點層（`steer.ts` 的 `speedRecover`）失職時的最後一道。
 *
 * 【為什麼上下兩層都要】瞄準點層是技巧：它把命令改成壓機頭，但指揮儀能不能
 * 兌現要看舵面權限。這一層是硬限制，門檻更低（1.1 對 1.4），只在技巧失效
 * 之後才動 —— 它每觸發一次，就代表上面那一層失職一次（spec §4.4）。
 */
describe('失速硬介入', () => {
  it('高空低速時介入，並壓機頭', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    // 極低速平飛：speedMargin 遠低於門檻
    a.state.velocity.set(0, 0, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    out.aimWorld.set(0, 1, 0)
    out.firing = true
    expect(applySafety(a, 0, out)).toBe('stall')
    expect(out.aimWorld.y).toBeLessThan(0)
    expect(out.firing).toBe(false)
  })

  /**
   * 【撞地優先於失速】兩個安全關切在低空低速時相反：失速要壓頭、撞地要
   * 拉起。撞地優先，因為失速還有機會改出，撞地沒有（spec §4.5）。
   */
  it('同時有撞地風險與失速時，走撞地分支（拉起）', () => {
    const a = new Aircraft(P51D, 150, 200)
    a.state.position.set(0, 150, 0)
    a.state.velocity.set(0, -10, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    expect(applySafety(a, 0, out)).toBe('ground')
    expect(out.aimWorld.y).toBeGreaterThan(0)
  })

  /**
   * 【低空低速的分界就落在垂直速度的正負號上 —— 這是既有行為，不是本次裁定】
   *
   * 150 m、TAS 30（`nMax ≈ 0.42`，遠低於 1）：
   *
   * | vy | 分支 | 補救 |
   * |---|---|---|
   * | 0 | `stall` | 壓頭 |
   * | −0.001 | `ground` | 抬頭 |
   *
   * 為什麼：`gamma >= 0` 時 `recoveryAltitude` 回 0，`needed` 就只剩
   * `clearance` = 120 < 150；一旦 γ 轉負，兩段模型要求「先換到能拉得動的速度」
   * 的那段高度（實測約 52 m），`needed` 跳到約 198 > 150。
   *
   * 【這個不連續是兩段模型本身帶的】γ < 0 且 `nMax ≤ 1` 時若回 `Infinity`，
   * 跳變會是「120 → ∞」，同一條掃描的八個 `vy` 分支與瞄準點仍然逐字相同
   * —— 邊界的位置不變，只有跳得多遠不同。
   *
   * 【這條測試在守什麼】它是變更偵測器：這個邊界要不要改（例如把第一段的
   * 推力做功算進去讓它連續）是另一份 spec 的事，但在那之前，任何人不小心
   * 移動了它都會在這裡看到。
   */
  it('低空低速的分界落在垂直速度的正負號上（既有行為）', () => {
    const at = (vy: number) => {
      const a = new Aircraft(P51D, 150, 30)
      a.state.position.set(0, 150, 0)
      a.state.velocity.set(0, vy, -30)
      a.prevPosition.copy(a.state.position)
      const out = createCommand()
      return { action: applySafety(a, 0, out), aimY: out.aimWorld.y }
    }
    const level = at(0)
    expect(level.action).toBe('stall')
    expect(level.aimY).toBeLessThan(0)
    for (const vy of [-0.001, -0.5, -3]) {
      const sinking = at(vy)
      expect(sinking.action).toBe('ground')
      expect(sinking.aimY).toBeGreaterThan(0)
    }
  })

  it('速度充足且高度充足時不介入', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -200)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    expect(applySafety(a, 0, out)).toBe('none')
  })

  /** 【低速不能收油門】換速度要推力，而且低速時沒有減速的道理。 */
  it('失速介入時滿油門、不減速', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(0, 0, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    applySafety(a, 0, out)
    expect(out.brake).toBe(0)
    expect(out.throttle).toBeGreaterThan(1)
  })

  /** 脫離向量與撞地分支同樣要滾轉友善：保持航向，只改仰角。 */
  it('失速介入時保持當前航向', () => {
    const a = new Aircraft(P51D, 4000, 200)
    a.state.position.set(0, 4000, 0)
    a.state.velocity.set(30, 0, -30)
    a.prevPosition.copy(a.state.position)
    const out = createCommand()
    applySafety(a, 0, out)
    const velHoriz = new Vector3(a.state.velocity.x, 0, a.state.velocity.z).normalize()
    const aimHoriz = new Vector3(out.aimWorld.x, 0, out.aimWorld.z).normalize()
    expect(aimHoriz.angleTo(velHoriz)).toBeCloseTo(0, 6)
  })

  /**
   * 【門檻必須低於瞄準點層】瞄準點層是技巧、這一層是硬限制，硬限制只在
   * 技巧失效時才動。兩者相等會讓兩層同時觸發，硬限制就永遠蓋掉技巧層。
   */
  it('門檻低於瞄準點層的 speedRecoverMargin', () => {
    expect(DEFAULT_SAFETY.stallMargin).toBeLessThan(DEFAULT_STEER.speedRecoverMargin)
  })
})

describe('applySafety —— 地形的橫向規避', () => {
  const cmd = createCommand()
  const sense = (turn: number): TerrainSense =>
    ({ floor: 0, turn, side: turn >= 0 ? 1 : -1, island: 0, clearSamples: 0 })

  /**
   * 【terrain 是 ground 的升級，不是它的替代】新分支寫在 ground 的
   * if 裡面，所以「不會在 ground 不觸發時觸發」是結構保證的。
   * 這一條把那個結構釘住 —— 有人把它搬出去就會紅。
   */
  it('高度夠、根本不需要拉起時，給了 turn 也不介入', () => {
    const a = diving(4000, 200, -10)
    cmd.aimWorld.set(0, -0.2, -0.98).normalize()
    expect(applySafety(a, 0, cmd, undefined, sense(0.5))).toBe('none')
  })

  it('要拉起但 turn 為 0 → 仍然是 ground，航向不變', () => {
    const a = diving(120, 250, -40)
    cmd.aimWorld.set(0, -0.7, -0.7).normalize()
    const act = applySafety(a, 0, cmd, undefined, sense(0))
    expect(act).toBe('ground')
    // 正前方拉起：水平分量仍朝 −Z，沒有側向
    expect(Math.abs(cmd.aimWorld.x)).toBeLessThan(1e-6)
  })

  it('要拉起而且 turn 不為 0 → terrain，航向轉開而且仍在爬', () => {
    const a = diving(120, 250, -40)
    cmd.aimWorld.set(0, -0.7, -0.7).normalize()
    const act = applySafety(a, 0, cmd, undefined, sense(0.5))
    expect(act).toBe('terrain')
    // 轉向 +x 側（turn > 0），而且爬升角與 ground 分支相同
    expect(cmd.aimWorld.x).toBeGreaterThan(0)
    expect(cmd.aimWorld.y).toBeCloseTo(Math.sin(DEFAULT_SAFETY.recoveryPitch), 6)
  })

  it('turn 反號 → 轉向另一側', () => {
    const a = diving(120, 250, -40)
    cmd.aimWorld.set(0, -0.7, -0.7).normalize()
    applySafety(a, 0, cmd, undefined, sense(-0.5))
    expect(cmd.aimWorld.x).toBeLessThan(0)
  })

  /**
   * 【不傳 sense 就是修改前的行為】既有的對戰矩陣、AI 護欄與 replayDigest
   * 全部走這一條路徑。這一條比對「傳 undefined」與「傳 turn 為 0 的 sense」
   * 逐位元相同 —— 兩者都不該動到航向。
   */
  it('不傳 sense 與傳 turn 為 0 的 sense，輸出逐位元相同', () => {
    const a = diving(120, 250, -40)
    cmd.aimWorld.set(0, -0.7, -0.7).normalize()
    const act1 = applySafety(a, 0, cmd)
    const x1 = cmd.aimWorld.x, y1 = cmd.aimWorld.y, z1 = cmd.aimWorld.z
    const t1 = cmd.throttle, b1 = cmd.brake
    cmd.aimWorld.set(0, -0.7, -0.7).normalize()
    const act2 = applySafety(a, 0, cmd, undefined, sense(0))
    expect(act2).toBe(act1)
    expect(Object.is(cmd.aimWorld.x, x1)).toBe(true)
    expect(Object.is(cmd.aimWorld.y, y1)).toBe(true)
    expect(Object.is(cmd.aimWorld.z, z1)).toBe(true)
    expect(Object.is(cmd.throttle, t1)).toBe(true)
    expect(Object.is(cmd.brake, b1)).toBe(true)
  })
})

/**
 * 超速守線：俯衝到 0.9 vne 就收油門抬平。
 *
 * 【它擋的是「追進紅線、拉不起來、撞海」】拉起的閉式解假設 `gPositive` 全部
 * 可用；紅線因子在 r = 1 只剩 10% 操縱權限，那個假設整個失效。
 */
describe('超速守線', () => {
  /** 讓一台 A6M5 在 3000 m 以給定的 IAS / vne 比值飛 */
  function overspeeding(ratio: number, gammaDeg: number): Aircraft {
    const air = atmosphere(3000, { density: 0, pressure: 0, temperature: 0, soundSpeed: 0, sigma: 0 })
    const ias = ratio * A6M5.limits.vne
    return divingSpec(A6M5, 3000, ias / Math.sqrt(air.sigma), gammaDeg)
  }

  it('r = 0.91 且俯衝中 → overspeed：收油門、抬到平飛', () => {
    const a = overspeeding(0.91, -20)
    const cmd = createCommand()
    expect(applySafety(a, 0, cmd)).toBe('overspeed')
    expect(cmd.throttle).toBe(0)
    // 不煞車：停在 0.90 會留在目標上方等它爬回來；衝到 0.98 只剩 15% 權限，
    // 跟不上目標的轉彎才是設計要的
    expect(cmd.brake).toBe(0)
    expect(cmd.aimWorld.y).toBeGreaterThanOrEqual(-1e-9)
  })

  it('r = 0.91 但正在爬升 → none（只擋往下）', () => {
    const a = overspeeding(0.91, 10)
    expect(applySafety(a, 0, createCommand())).toBe('none')
  })

  it('r = 0.88 俯衝中 → none（門檻是 0.90）', () => {
    const a = overspeeding(0.88, -20)
    expect(applySafety(a, 0, createCommand())).toBe('none')
  })

  it('撞地與超速同時成立時撞地贏', () => {
    const a = overspeeding(0.95, -60)
    a.state.position.y = 150
    expect(applySafety(a, 0, createCommand())).toBe('ground')
  })

  it('起始設定：規則 3 的俯衝目標不得高於守線', () => {
    // 俯衝目標比守線高的話，脫離的一方會自己撞進安全層，兩層打架
    expect(DEFAULT_STEER.diveSelfRatio).toBeLessThanOrEqual(DEFAULT_SAFETY.overspeedRatio)
  })
})
