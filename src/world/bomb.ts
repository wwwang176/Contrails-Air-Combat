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
 * 一顆炸彈落海噴幾根水柱。**起始值，由試飛裁定。**
 *
 * 【為什麼是數量而不是倍率】現有的水柱是子彈打出來的 12 m，而炸彈不是子彈。
 * **用數量換規模，`splash.ts` 不用改** —— `main.ts` 為殘骸入水寫過同一句。
 * 高低粗細本來就由 `splashSize` 依格子隨機，所以三根不會疊成一根粗的。
 */
export const BOMB_SPLASH_JETS = 3

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
