/**
 * 炸彈的彈道。**準星的預測與空中的炸彈跑的是這裡的同一支 `stepBomb`。**
 *
 * 【為什麼這個檔案不 import three】它同時被三種呼叫端讀：`World.step` 推進
 * 空中的炸彈、`main.ts` 每幀解一次落點、以及 headless 的單元測試。與
 * `world/heightfield.ts` 同一個理由 —— 第三種不該為了兩個向量載入整個 three。
 */
import { G0 } from '../core/math'

/**
 * 炸彈的終端速度，m/s。**起始值，由試飛裁定**（性質同 `WOBBLE_AMPLITUDE`）。
 *
 * 【為什麼可調的是終端速度而不是 Cd·A/m】那三個量只以 `g/vt²` 的組合出現，
 * 拆開來寫是三個互相抵銷的旋鈕。終端速度是查得到、也能直接在試飛裡讀出來的
 * 量（落地速度），280 m/s 是 500 lb 通用炸彈的量級。
 */
export const BOMB_TERMINAL_SPEED = 280

/**
 * 解算與飛行的時間上限，秒。
 *
 * 【90 怎麼來】8,000 m 投下落地 47.9 s（量測），留近一倍餘裕。超過它
 * `solveImpact` 回 false、空中的炸彈直接回收。
 */
export const BOMB_MAX_SECONDS = 90

/**
 * 投彈方向的隨機偏移，**弧度**（±0.1°）。
 *
 * 【它不是瞄具的誤差，是彈的離散】同一串投下去的彈不會落在一條數學直線上
 * —— 掛架的釋放、氣流、彈體本身的差異都有。0.1° 在 4,000 m 的落點上是
 * 約 ±7 m，看得出「一串」而不是「一條線」，又不足以讓瞄具失去意義。
 *
 * **起始值，由試飛裁定。**
 */
export const BOMB_SPREAD_RAD = (0.1 * Math.PI) / 180

/** 二次阻力係數：`a = −k·|v|·v`。由終端速度反推 —— 終端時阻力恰好抵銷重力 */
export function bombDragK(terminalSpeed: number): number {
  return G0 / (terminalSpeed * terminalSpeed)
}

export interface BombState {
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
}

/** 落點。就地寫入 —— 熱路徑不得配置 */
export interface Impact {
  x: number
  y: number
  z: number
  /** 飛行時間，秒 */
  seconds: number
  /** 落地速度，m/s */
  speed: number
}

/**
 * 推進一步。半隱式歐拉（先速度後位置），與 `Projectiles.step` 同一個形狀。
 *
 * 【為什麼不是 RK4】1/240 之下歐拉與 RK4 在這條軌跡上的差距，遠小於把步長
 * 放寬到 1/4 造成的差（量過：4,000 m 的前拋差 < 3 m）。而 RK4 會讓「準星的
 * 預測與空中的炸彈逐位元相同」這條護欄變成四次求值都要對齊 —— 用不上的精度
 * 換來更難守的不變式。
 */
export function stepBomb(s: BombState, k: number, dt: number): void {
  const sp = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz)
  s.vx += -k * sp * s.vx * dt
  s.vy += (-G0 - k * sp * s.vy) * dt
  s.vz += -k * sp * s.vz * dt
  s.x += s.vx * dt
  s.y += s.vy * dt
  s.z += s.vz * dt
}

/**
 * 把速度向量繞兩個與它垂直的軸各轉一個小角度。就地寫進 `out`。
 *
 * 【為什麼角度由呼叫端給】**測試要能關掉偏移**。傳 0 就是恆等，落點的數學
 * 驗證因此仍然精確；隨機留在呼叫端，這一支保持純函數。
 *
 * 【小角度近似】±0.1° 之下 `sin θ ≈ θ`、`cos θ ≈ 1`，誤差是 θ²/2 ≈ 1.5e-6
 * —— 比偏移本身小五個數量級。用它換掉四次三角函數。
 *
 * @param ax 繞「水平橫向」轉的角度，rad（正 = 往右偏）
 * @param ay 繞「垂直」轉的角度，rad（正 = 往上偏）
 */
export function spreadDirection(
  vx: number, vy: number, vz: number,
  ax: number, ay: number,
  out: BombState,
): void {
  const speed = Math.sqrt(vx * vx + vy * vy + vz * vz)
  if (speed < 1e-9 || (ax === 0 && ay === 0)) {
    out.vx = vx; out.vy = vy; out.vz = vz
    return
  }
  // 速度方向的兩個正交伴隨軸。水平橫向 = v × 世界上方 = (−vz, 0, vx)，
  // 對朝 −Z 飛的飛機而言那是 +X，也就是**右**
  const hx = -vz
  const hz = vx
  const hl = Math.sqrt(hx * hx + hz * hz)
  if (hl < 1e-9) {
    // 【垂直投彈】水平分量為 0，橫向未定義。任取一組正交軸即可
    out.vx = vx + ax * speed
    out.vy = vy
    out.vz = vz + ay * speed
    return
  }
  const rx = hx / hl
  const rz = hz / hl
  // u = r × v̂，與 r 及 v 都正交
  const ivs = 1 / speed
  const nx = vx * ivs
  const ny = vy * ivs
  const nz = vz * ivs
  const ux = rz * ny * -1
  const uy = rz * nx - rx * nz
  const uz = rx * ny
  out.vx = vx + (rx * ax + ux * ay) * speed
  out.vy = vy + (uy * ay) * speed
  out.vz = vz + (rz * ax + uz * ay) * speed
}

/**
 * 從一個整數序號產生兩個 `[-1, 1)` 的偏移量。**確定性** —— 同一場重播結果
 * 相同，而 `Math.random()` 做不到那件事（`resetBattle` 的「逐位元重播」）。
 *
 * splitmix32 的一輪混合，夠散也夠便宜。
 */
export function spreadPair(n: number, out: { u: number; v: number }): void {
  let h = (n + 0x9e3779b9) | 0
  h = Math.imul(h ^ (h >>> 16), 0x21f0aaad)
  h = Math.imul(h ^ (h >>> 15), 0x735a2d97)
  h ^= h >>> 15
  out.u = ((h >>> 0) / 0x80000000) - 1
  let g = Math.imul(h ^ 0x85ebca6b, 0xc2b2ae35)
  g ^= g >>> 13
  out.v = ((g >>> 0) / 0x80000000) - 1
}

/** `solveImpact` 內部重用的狀態 —— 模組層級的單例，避免每幀配置 */
const SIM: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }

/**
 * 「現在投會落在哪」。**跑的是與空中的炸彈完全相同的 `stepBomb` 與 `dt`。**
 *
 * 【為什麼不省步數】最壞情況（8,000 m）是 11,498 步，60 fps 下約 69 萬步/秒，
 * 相對於 40 架 × 240 Hz 的飛行物理可以忽略。粗步長也量過（`dt` 放寬到 1/4
 * 只差 3 m）—— 便宜到不必省，所以不省：省下來換到的是準星與水柱分家，而且
 * 分家的程度會**隨畫面更新率變動**。
 *
 * 【為什麼每一步都問 `groundAt`，不在高空早退】早退要在這裡與 `Bombs.step`
 * 各放一個必須保持一致的分支，而它省下的是可以忽略的取樣。一致性比較值錢。
 *
 * @param s        起始狀態。**不會被修改**
 * @param groundAt 該點的地面高度。出界請回 `-Infinity`（呼叫端的既有慣例）
 * @returns 落地為 true；`BOMB_MAX_SECONDS` 內落不下來為 false
 */
export function solveImpact(
  s: BombState,
  k: number,
  groundAt: (x: number, z: number) => number,
  dt: number,
  out: Impact,
): boolean {
  SIM.x = s.x; SIM.y = s.y; SIM.z = s.z
  SIM.vx = s.vx; SIM.vy = s.vy; SIM.vz = s.vz

  const steps = Math.ceil(BOMB_MAX_SECONDS / dt)
  for (let i = 0; i < steps; i++) {
    const px = SIM.x
    const py = SIM.y
    const pz = SIM.z
    stepBomb(SIM, k, dt)
    const g = groundAt(SIM.x, SIM.z)
    // 【寫成否定式】`groundAt` 出界回 −Infinity，兩者在那裡等價；但這樣寫
    // 時 NaN 也會走 continue 而不是被誤判成落地
    if (!(SIM.y <= g)) continue

    // 【落地那一步要內插】一步走 1 m 以上，不內插的話落點系統性偏過頭。
    // **這一段與 `Bombs.step` 逐字相同** —— 差一個字就是準星與水柱分家
    const drop = py - SIM.y
    const t = drop > 1e-9 ? (py - g) / drop : 0
    out.x = px + (SIM.x - px) * t
    out.y = g
    out.z = pz + (SIM.z - pz) * t
    out.seconds = (i + t) * dt
    out.speed = Math.sqrt(SIM.vx * SIM.vx + SIM.vy * SIM.vy + SIM.vz * SIM.vz)
    return true
  }
  return false
}

/**
 * 池子大小。
 *
 * 【64 怎麼來】玩家單次最多 8 顆同時在空中（4,000 m 落地要 31 秒，全投完
 * 第一顆還沒落地）。64 是留給日後 AI 投彈的餘裕，而且相對
 * `PROJECTILE_CAPACITY = 4000` 可以忽略。
 */
export const BOMBS_CAPACITY = 64

/** 落地回呼。**不得配置** —— 一步之內可能呼叫好幾次 */
/**
 * @param blocked 撞上的是**擋路的東西**（船）而不是地面。落點的 `y` 因此
 *                是撞擊高度，不是地形高度。
 */
/**
 * @param owner   投放者的 combatant 索引；−1 = 沒有主人。戰果歸屬讀它 ——
 *                少了這一格，炸彈炸掉的東西不屬於任何人
 */
export type BombImpactFn = (
  x: number, y: number, z: number, speed: number, blocked: boolean,
  damage: number, owner: number,
) => void

/**
 * 這一步的線段有沒有被擋住。命中回 `[0,1]` 的參數 `t`，**沒撞回任何落在
 * 那個區間外的值** —— `world/hit.ts` 的 `NO_HIT` 是 −1，這裡因此兩頭都夾。
 *
 * 【為什麼是回呼而不是把船傳進來】`world/bomb.ts` 不認識 `Ship`，也不該認識
 * ——它只有彈道。誰擋路是 `World` 的知識。
 */
export type BombBlockFn = (
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
) => number

/**
 * 空中的炸彈。SoA，形狀照 `Projectiles` —— 型別化陣列、環狀寫入指標、
 * 池滿時覆寫最舊的而不是拒絕投彈。
 *
 * 【**但精度用 Float64Array，與 `Projectiles` 不同**】「準星的預測與空中的
 * 炸彈逐位元相同」這條護欄靠的是兩邊跑同一支 `stepBomb`，而 `solveImpact`
 * 的狀態全程在一般 `number`（float64）裡。這裡若存 float32，每一步都會捨入
 * 一次 —— 4,000 m 那個案例實算差 0.00378 m，護欄測試直接紅。
 * 64 格 × 6 欄 × 8 bytes = 3 KB，換一條真的成立的不變式。
 */
export class Bombs {
  readonly capacity: number
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly vz: Float64Array
  readonly age: Float64Array
  /**
   * 這一顆的爆心傷害。**每一顆各自帶著** —— 不同的轟炸機掛不同的彈，而
   * 整顆彈的規模（殺傷半徑、爆炸的視覺尺寸）都由它推導。
   */
  readonly damage: Float64Array
  /**
   * 投放者的隊別。**0 = 藍、1 = 紅**，與 `projectiles.ts` 的 `team` 同一個
   * 編碼。HUD 的標記靠它決定紅還是藍。
   *
   * 【模擬完全不讀它】炸彈對誰都有傷害 —— 這一格純粹是給畫面用的。
   */
  readonly team: Int8Array
  /**
   * 投放者的 combatant 索引；−1 = 沒有主人。
   *
   * 【為什麼隊別不夠】戰果通報要回答「這是誰炸掉的」，而一隊有二十架。
   * 少了它，炸彈打掉的地面目標與炸沉的船在戰績上不屬於任何人 ——
   * 而洛伊納那一關玩家主要就是投彈。
   */
  readonly owner: Int32Array
  readonly active: Uint8Array

  /** 環狀寫入指標。池滿時它自然會走到最舊的那一顆身上 */
  private cursor = 0
  private liveCount = 0
  /**
   * 這一場累計投了幾顆。**投彈偏移的序號就是它**（見 `spreadPair`）。
   *
   * 【為什麼不是 `cursor`】那一個會繞回去，於是第 65 顆與第 1 顆的偏移完全
   * 相同 —— 一串投下去看起來會有週期。
   */
  dropped = 0
  /** 推進一步時的暫存。熱路徑不得配置 */
  private readonly sim: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }

  constructor(capacity: number = BOMBS_CAPACITY) {
    this.capacity = capacity
    const f = (): Float64Array => new Float64Array(capacity)
    this.x = f(); this.y = f(); this.z = f()
    this.vx = f(); this.vy = f(); this.vz = f()
    this.age = f()
    this.damage = f()
    this.team = new Int8Array(capacity)
    this.owner = new Int32Array(capacity)
    this.active = new Uint8Array(capacity)
  }

  get live(): number { return this.liveCount }

  /**
   * @param damage 這一顆的**爆心傷害**。整顆彈的規模都由它推導 —— 殺傷
   *               半徑與爆炸的視覺尺寸都是它的函數，見 `weapons/bomb.ts`
   *               的 `blastScaleOf`。
   * @param team   投放者的隊別，0 = 藍、1 = 紅。只有 HUD 標記讀它。
   *               **這一層有預設值，`World.dropBomb` 那一層沒有** —— 進得了
   *               遊戲的路徑只有後者，強制在那裡；這一層是資料結構，彈道
   *               測試不該為了一個顏色欄位每一行都多帶一個 0
   * @param owner  投放者的 combatant 索引。預設 −1（沒有主人）的理由同上
   */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, damage: number, team = 0, owner = -1,
  ): number {
    const i = this.cursor
    this.cursor = (i + 1) % this.capacity
    if (this.active[i] === 0) this.liveCount++
    this.x[i] = x; this.y[i] = y; this.z[i] = z
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz
    this.damage[i] = damage
    // 【一定要寫，不能靠 clear】`clear` 只清 `active`，資料陣列留著上一場的
    // 值；環狀指標繞回來時這一格會沿用前一顆的隊別
    this.team[i] = team
    this.owner[i] = owner
    this.age[i] = 0
    this.active[i] = 1
    this.dropped++
    return i
  }

  clear(): void {
    this.active.fill(0)
    this.liveCount = 0
    this.cursor = 0
    // 【序號也要歸零】不歸零的話第二場的偏移接在第一場後面 —— 與 `world.time`
    // 在 `resetBattle` 歸零是同一條理由：逐位元重播
    this.dropped = 0
  }

  /**
   * 推進一步。**用的是與 `solveImpact` 相同的 `stepBomb`。**
   *
   * @param groundAt 該點的地面高度，出界回 `-Infinity`
   * @param onImpact 落地回呼。那一顆在回呼之前就已經回收
   */
  step(
    dt: number,
    k: number,
    groundAt: (x: number, z: number) => number,
    onImpact: BombImpactFn,
    blockedBy?: BombBlockFn,
  ): void {
    const s = this.sim
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) continue

      const age = this.age[i]! + dt
      if (age > BOMB_MAX_SECONDS) {
        this.active[i] = 0
        this.liveCount--
        continue
      }
      this.age[i] = age

      const px = this.x[i]!
      const py = this.y[i]!
      const pz = this.z[i]!
      s.x = px; s.y = py; s.z = pz
      s.vx = this.vx[i]!; s.vy = this.vy[i]!; s.vz = this.vz[i]!
      stepBomb(s, k, dt)
      this.x[i] = s.x; this.y[i] = s.y; this.z[i] = s.z
      this.vx[i] = s.vx; this.vy[i] = s.vy; this.vz[i] = s.vz

      const speed = Math.sqrt(s.vx * s.vx + s.vy * s.vy + s.vz * s.vz)

      // 【擋路的先判】船的甲板在地面之上，照地面判的話炸彈會穿過艦體再
      // 在水面上爆
      if (blockedBy !== undefined) {
        const bt = blockedBy(px, py, pz, s.x, s.y, s.z)
        if (bt >= 0 && bt <= 1) {
          this.active[i] = 0
          this.liveCount--
          onImpact(
            px + (s.x - px) * bt, py + (s.y - py) * bt, pz + (s.z - pz) * bt,
            speed, true, this.damage[i]!, this.owner[i]!,
          )
          continue
        }
      }

      const g = groundAt(s.x, s.z)
      if (!(s.y <= g)) continue

      // 【內插與 `solveImpact` 逐字相同】差一個字就是準星與水柱分家
      const drop = py - s.y
      const t = drop > 1e-9 ? (py - g) / drop : 0
      this.active[i] = 0
      this.liveCount--
      onImpact(
        px + (s.x - px) * t, g, pz + (s.z - pz) * t,
        speed, false, this.damage[i]!, this.owner[i]!,
      )
    }
  }
}
