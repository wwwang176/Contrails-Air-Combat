/**
 * 空投魚雷的彈道。**兩段：空中與水中。**
 *
 * 【空中段跑的是炸彈的 `stepBomb`】所以「瞄具解出來的落點 ≡ 魚雷的入水點」
 * 是逐位元成立的，不是近似。落地內插那八行也照抄 —— `world/bomb.ts` 已經
 * 寫過「差一個字就是準星與水柱分家」。
 *
 * 【為什麼不寄生在 `Bombs` 上】魚雷多了相位、航程與航向三組狀態，而
 * `Bombs` 的每一個欄位都在那條逐位元護欄的路徑上。塞進去等於讓一條已經
 * 成立的不變式多背三個不相干的欄位。
 *
 * 【為什麼這個檔案不 import three】與 `world/bomb.ts` 同一個理由 ——
 * headless 的單元測試不該為了兩個向量載入整個 three。
 */
import { BOMB_MAX_SECONDS, stepBomb, type BombState } from './bomb'

/**
 * 水中的航速，m/s。九一式改三是 42 節 = 21.6 m/s。
 *
 * **起始值，由試飛裁定。**
 */
export const TORPEDO_SPEED = 22

/**
 * 射程，m。跑滿就自沉。九一式是 2,000 m。
 *
 * 【它比炸彈的秒數上限久】2,000 ÷ 22 = 90.9 s > `BOMB_MAX_SECONDS` 的 90。
 * 所以水中段**只由航程回收**，不另設整體的秒數上限 —— 加了的話射程會變成
 * 一個講不通的 1,980 m。
 *
 * **起始值，由試飛裁定。**
 */
export const TORPEDO_RANGE = 2000

/**
 * 定深，m（水面**之下**，所以雷體的 y 是 `−TORPEDO_DEPTH`）。
 *
 * 【以平海為基準，不是浪面】海面的碰撞體是平面，浪只是視覺高低。跟著浪走
 * 的話雷體會在 240 Hz 下上下抖，而且每一步要付 12 次 `Math.sin`。
 */
export const TORPEDO_DEPTH = 1

/**
 * 航跡線的刻度間距，m。HUD 每這麼遠畫一個短橫。
 *
 * **起始值，由試飛裁定。**
 */
export const TORPEDO_RUN_STEP = 500

/**
 * 航跡線畫幾個取樣點（含入水點那一個）。
 *
 * 【算出來的】射程一改點數要跟著變，否則線的末端就不再是射程 —— 而畫面上
 * 看不出來，玩家只會覺得「投在射程內卻沒中」。
 */
export const TORPEDO_RUN_SAMPLES = Math.round(TORPEDO_RANGE / TORPEDO_RUN_STEP) + 1

/** 第 `k` 個取樣點離入水點多遠，m。最後一個恰好是 `TORPEDO_RANGE`。 */
export function runSampleDistance(k: number): number {
  return k * TORPEDO_RUN_STEP
}

/**
 * 落點是水嗎 —— **有沒有水中段就看它。**
 *
 * 【為什麼要轉出來】`solveImpact` 撞到**任何**地面都回成功，所以「解得出
 * 落點」不代表有水中段。HUD 的航跡線得用與 `stepAir` **同一條**判準，否則
 * 飛過島嶼或內陸農地時會畫出一條不存在的 2 km 水中航跡 —— 而海上的截圖
 * 驗收抓不到它。
 *
 * 【判準寫成 `> 0` 而不是 `<= 0`】海的碰撞面恰好是 0。`groundY` 是 NaN 時
 * `NaN > 0` 為 false，所以照樣入水 —— 那是 `stepAir` 的現行行為，這一支
 * 只是把它抽出來，不是改它。
 *
 * @param groundY 該點的**碰撞**高度（`terrain.collisionHeightAt`）。海是 0
 * @param waterY  該點**含浪**的水面高度，沒有水的地方是 `-Infinity`
 */
export function torpedoEntersWater(groundY: number, waterY: number): boolean {
  return !(groundY > 0) && Number.isFinite(waterY)
}

/**
 * 水中航向。**寫進 `out[0]`（x）與 `out[1]`（z），不配置。**
 *
 * 雷入水之後定深等速直行，航向就是**入水速度的水平單位向量**；水平分量退化
 * 時沿用投放瞬間的機首水平方向。
 *
 * 【門檻是 `> 1e-9` 才正規化】恰好等於門檻時**走機首**。這一支同時給
 * `stepAir`（模擬）與 HUD（畫線）用 —— 把比較寫成 `>=` 就是改到模擬。
 *
 * 【為什麼 HUD 也能用它】`stepBomb` 的阻力與速度反向、重力只動垂直分量，
 * 所以水平兩軸恆等比例縮放 —— **方向在整個空中段守恆**，拿投放當下的速度
 * 算與拿入水速度算是同一個答案（推導見 `ai/torpedoRun.ts`）。
 *
 * 【HUD 畫的是散佈之前的中心】`World.dropTorpedo` 另外套一層散佈，所以真雷
 * 的航向與這一支算出來的有一小段差 —— 與落點圈同一條：把散佈也套進瞄具的話，
 * 散佈就變成免費的情報。
 */
export function torpedoHeading(
  vx: number, vz: number, noseX: number, noseZ: number, out: Float64Array,
): void {
  const hl = Math.hypot(vx, vz)
  if (hl > 1e-9) {
    out[0] = vx / hl
    out[1] = vz / hl
  } else {
    out[0] = noseX
    out[1] = noseZ
  }
}

/**
 * 航跡每幾公尺留一叢水花，m。
 *
 * 22 m/s 之下是每 0.36 s 一叢；`SPRAY_LIFE` 是 0.6 s，所以同時活著約 5 叢。
 */
export const WAKE_INTERVAL = 8

/**
 * 池子大小。
 *
 * 【8 怎麼來】掛雷的機種一趟只帶一枚（`weapons/stores.ts`），8 是留給日後
 * AI 雷擊編隊的餘裕。
 */
export const TORPEDOES_CAPACITY = 8

/**
 * 結束回呼。**不得配置。**
 *
 * @param kind 0 = 撞岸，1 = 撞船。射程用盡是無聲回收，不會走到這裡
 */
export type TorpedoEndFn = (
  x: number, y: number, z: number, kind: 0 | 1, damage: number,
) => void

/**
 * 這一步的線段有沒有被擋住。命中回 `[0,1]` 的參數 `t`，沒撞回區間外的值
 * （`world/hit.ts` 的 `NO_HIT` 是 −1，所以呼叫端兩頭都要夾）。
 */
export type TorpedoBlockFn = (
  x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number,
) => number

/** 入水點與航跡點的回呼。**不得配置** */
export type TorpedoPointFn = (x: number, y: number, z: number) => void

/**
 * 一枚魚雷的四個設計值。**省略等於上面那四個常數。**
 *
 * 【為什麼可以覆寫】展示區要拉著滑桿看不同的雷速與定深長什麼樣，而
 * `World` 本來就不持有設計值 —— `groundAt`、`bombDrag` 都是注入的，這裡
 * 是同一條規則。遊戲路徑不傳，所以行為逐位元不變。
 */
export interface TorpedoTuning {
  readonly speed: number
  readonly range: number
  readonly depth: number
  readonly wakeInterval: number
}

const DEFAULT_TUNING: TorpedoTuning = {
  speed: TORPEDO_SPEED,
  range: TORPEDO_RANGE,
  depth: TORPEDO_DEPTH,
  wakeInterval: WAKE_INTERVAL,
}

/** 空中／水中 */
const AIR = 0
const WATER = 1

export class Torpedoes {
  readonly capacity: number
  readonly x: Float64Array
  readonly y: Float64Array
  readonly z: Float64Array
  readonly vx: Float64Array
  readonly vy: Float64Array
  readonly vz: Float64Array
  readonly age: Float64Array
  /** 水中已經跑了多遠，m。射程與航跡都看它 */
  readonly run: Float64Array
  readonly damage: Float64Array
  /**
   * 這一枚的識別碼，**逐枚遞增，1 起跳**（0 = 這一格從來沒裝過東西）。
   *
   * 【為什麼航程不能當身分】航程每一枚都從 0 開始，所以它只認得出「變小」。
   * 上一枚在近距離命中、只被畫到航程 0 就收掉時，下一枚的第一幀也是 0
   * ——「沒有變小」，航跡就從上一枚的位置接過去，畫出一條橫跨海圖的線。
   */
  readonly serial: Float64Array
  /**
   * 水平航向，單位向量。入水時由入水速度的水平分量決定（`torpedoHeading`）；
   * **垂直入水那種退化情況沿用投放瞬間的機首方向**，所以 `spawn` 就要收它。
   */
  readonly headX: Float64Array
  readonly headZ: Float64Array
  /**
   * 投放者的隊別。**0 = 藍、1 = 紅**，與 `Bombs.team` 同一個編碼。
   * HUD 的標記靠它決定紅還是藍；模擬完全不讀它。
   */
  readonly team: Int8Array
  /** 0 = 空中，1 = 水中 */
  readonly phase: Uint8Array
  readonly active: Uint8Array

  private cursor = 0
  private liveCount = 0
  /** 這一場累計投了幾枚。**投放偏移的序號就是它** */
  dropped = 0
  private readonly sim: BombState = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 }
  /** `torpedoHeading` 的輸出。**熱路徑不配置**，所以建一次留著 */
  private readonly head = new Float64Array(2)

  /**
   * 這一批魚雷的四個設計值。**可以就地換掉** —— 展示區靠它拉滑桿，而
   * `World` 從不動它（同 `bombDrag` 是一個公開欄位）。
   */
  tuning: TorpedoTuning

  constructor(
    capacity: number = TORPEDOES_CAPACITY,
    tuning: TorpedoTuning = DEFAULT_TUNING,
  ) {
    this.capacity = capacity
    this.tuning = tuning
    // 【Float64Array 而不是 Float32Array】逐位元護欄靠它 —— float32 每一步
    // 都會捨入一次，入水點就與 `solveImpact` 的落點分家了
    const f = (): Float64Array => new Float64Array(capacity)
    this.x = f(); this.y = f(); this.z = f()
    this.vx = f(); this.vy = f(); this.vz = f()
    this.age = f(); this.run = f(); this.damage = f()
    this.headX = f(); this.headZ = f()
    this.serial = f()
    this.team = new Int8Array(capacity)
    this.phase = new Uint8Array(capacity)
    this.active = new Uint8Array(capacity)
  }

  get live(): number { return this.liveCount }

  /**
   * @param damage      這一枚的**接觸**傷害。沒有距離衰減
   * @param headX/headZ 投放瞬間的機首水平方向，單位向量。只有垂直入水那種
   *                    退化情況用得到
   * @param team        投放者的隊別，0 = 藍、1 = 紅。只有 HUD 標記讀它。
   *                    **這一層有預設值，`World.dropTorpedo` 那一層沒有** ——
   *                    理由同 `Bombs.spawn`
   */
  spawn(
    x: number, y: number, z: number,
    vx: number, vy: number, vz: number, damage: number,
    headX: number, headZ: number, team = 0,
  ): number {
    const i = this.cursor
    this.cursor = (i + 1) % this.capacity
    if (this.active[i] === 0) this.liveCount++
    this.x[i] = x; this.y[i] = y; this.z[i] = z
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz
    this.headX[i] = headX; this.headZ[i] = headZ
    this.damage[i] = damage
    // 【一定要寫，不能靠 clear】`clear` 只清 `active` 與 `serial`；環狀指標
    // 繞回來時這一格會沿用前一枚的隊別
    this.team[i] = team
    this.age[i] = 0
    this.run[i] = 0
    this.phase[i] = AIR
    this.active[i] = 1
    this.dropped++
    // 【1 起跳】0 留給「這一格從來沒裝過東西」
    this.serial[i] = this.dropped
    return i
  }

  clear(): void {
    this.active.fill(0)
    this.serial.fill(0)
    this.liveCount = 0
    this.cursor = 0
    // 【序號也要歸零】不歸零的話第二場的偏移接在第一場後面，逐位元重播就
    // 不成立（同 `Bombs.clear`）
    this.dropped = 0
  }

  /**
   * 推進一步。
   *
   * @param groundAt  該點的**碰撞**高度（`terrain.collisionHeightAt`）。
   *                  海是平的、回 0；陸地回高度。**水陸判準是它 > 0**
   * @param waterAt   該點**含浪**的水面高度，沒有水的地方回 `-Infinity`。
   *                  入水前用它確認這裡真的有水（一整趟只問一次），之後
   *                  是航跡的高度
   * @param onEntry   入水的那一刻，帶**內插後的落點**。逐位元護欄看它 ——
   *                  比的是**彈道**：同一組初始狀態下，它與 `solveImpact`
   *                  的落點逐位元相同（`World.dropTorpedo` 另外套的散佈在
   *                  這一層之外）
   * @param onWake    每 `WAKE_INTERVAL` 公尺一次，`y` 是水面
   */
  step(
    dt: number,
    k: number,
    groundAt: (x: number, z: number) => number,
    waterAt: (x: number, z: number) => number,
    onEnd: TorpedoEndFn,
    onEntry: TorpedoPointFn,
    onWake: TorpedoPointFn,
    blockedBy?: TorpedoBlockFn,
  ): void {
    const s = this.sim
    for (let i = 0; i < this.capacity; i++) {
      if (this.active[i] === 0) continue
      if (this.phase[i] === AIR) this.stepAir(i, s, dt, k, groundAt, waterAt, onEnd, onEntry)
      else this.stepWater(i, dt, groundAt, waterAt, onEnd, onWake, blockedBy)
    }
  }

  /**
   * 空中段。**每一行都與 `Bombs.step` 對應** —— 欄位順序、`groundAt` 的
   * 取樣點、否定式的落地判定、內插的算式全部逐字相同。
   */
  private stepAir(
    i: number,
    s: BombState,
    dt: number,
    k: number,
    groundAt: (x: number, z: number) => number,
    waterAt: (x: number, z: number) => number,
    onEnd: TorpedoEndFn,
    onEntry: TorpedoPointFn,
  ): void {
    const age = this.age[i]! + dt
    if (age > BOMB_MAX_SECONDS) {
      this.active[i] = 0
      this.liveCount--
      return
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

    const g = groundAt(s.x, s.z)
    if (!(s.y <= g)) return

    const drop = py - s.y
    const t = drop > 1e-9 ? (py - g) / drop : 0
    const ix = px + (s.x - px) * t
    const iz = pz + (s.z - pz) * t

    // 【問的是內插後的落點，不是步末的位置】跨越岸線的那一步，兩者會給出
    // 相反的答案
    //
    // 【碰撞高度 0 不等於有水】內陸地圖的平原就是 0，與海面一模一樣
    // （`farmland` ±10 km 有 73.5% 的取樣點是「碰撞高度 0 且無水」）。少了
    // 水面那一問，魚雷會把整片農田當成海：鑽進地裡跑到射程用盡、不引爆，
    // 而且航跡事件帶著 `-Infinity` 餵進水花粒子池。
    //
    // 【肯定式】`waterAt` 給 NaN 時 `Number.isFinite` 回 false，判成陸地
    // ——壞值向安全側倒。
    // 【與 HUD 的航跡線共用同一條判準】兩邊各寫一份的話，畫得出線的地方
    // 不一定投得下雷
    if (!torpedoEntersWater(groundAt(ix, iz), waterAt(ix, iz))) {
      this.active[i] = 0
      this.liveCount--
      onEnd(ix, g, iz, 0, this.damage[i]!)
      return
    }

    onEntry(ix, g, iz)

    // 【航向由入水速度的水平分量決定】退化時沿用 `spawn` 帶進來的機首方向。
    // **與 HUD 的航跡線共用同一支** —— 兩邊各寫一份會在退化那一點分家，而
    // 那只在垂直下墜時出現，看不到也測不到
    torpedoHeading(s.vx, s.vz, this.headX[i]!, this.headZ[i]!, this.head)
    this.headX[i] = this.head[0]!
    this.headZ[i] = this.head[1]!
    this.x[i] = ix
    this.y[i] = -this.tuning.depth
    this.z[i] = iz
    this.vx[i] = this.headX[i]! * this.tuning.speed
    this.vy[i] = 0
    this.vz[i] = this.headZ[i]! * this.tuning.speed
    this.run[i] = 0
    this.phase[i] = WATER
  }

  /** 水中段：定深、等速、直線。無重力、無阻力 */
  private stepWater(
    i: number,
    dt: number,
    groundAt: (x: number, z: number) => number,
    waterAt: (x: number, z: number) => number,
    onEnd: TorpedoEndFn,
    onWake: TorpedoPointFn,
    blockedBy?: TorpedoBlockFn,
  ): void {
    this.age[i] = this.age[i]! + dt

    const px = this.x[i]!
    const py = this.y[i]!
    const pz = this.z[i]!
    const advance = this.tuning.speed * dt
    const nx = px + this.headX[i]! * advance
    const nz = pz + this.headZ[i]! * advance

    // 【擋路的先判】船的水下部分在定深這一層，而射程用盡的那一步也可能
    // 剛好命中 —— 打中了就是打中了
    if (blockedBy !== undefined) {
      const bt = blockedBy(px, py, pz, nx, py, nz)
      if (bt >= 0 && bt <= 1) {
        this.active[i] = 0
        this.liveCount--
        onEnd(px + (nx - px) * bt, py, pz + (nz - pz) * bt, 1, this.damage[i]!)
        return
      }
    }

    this.x[i] = nx
    this.z[i] = nz

    // 【> 0 才是陸地】海的碰撞高度是 0、雷體在 −1，寫成「碰撞高度 > 雷體
    // 高度」的話 `0 > −1` 恆真，魚雷會在海中央自爆
    if (groundAt(nx, nz) > 0) {
      this.active[i] = 0
      this.liveCount--
      onEnd(nx, py, nz, 0, this.damage[i]!)
      return
    }

    const before = this.run[i]!
    const after = before + advance
    this.run[i] = after

    if (after > this.tuning.range) {
      // 【跑完自沉，不引爆】爆了的話玩家會以為打中了什麼
      this.active[i] = 0
      this.liveCount--
      return
    }

    // 【由航程的整數段推，不另外存一個計時器】兩個欄位手動同步是一個不必要
    // 的坑
    const seg = this.tuning.wakeInterval
    if (Math.floor(after / seg) > Math.floor(before / seg)) {
      onWake(nx, waterAt(nx, nz), nz)
    }
  }
}
