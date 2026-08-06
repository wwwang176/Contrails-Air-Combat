import type { Command } from '../control/Controller'

/**
 * 支援的最大反應延遲，s。超過的值被夾住。
 *
 * 1 秒遠大於任何有意義的飛行員反應時間（受過訓練的視覺反應約 0.2~0.4 s），
 * 取這個值只是為了讓「夾住」這件事永遠不會在正常設定下發生。
 */
export const MAX_REACTION_DELAY = 1

/**
 * 槽數。240 Hz 下 256 槽 = 1.07 s，剛好包住 `MAX_REACTION_DELAY`。
 *
 * 取 2 的冪次沒有效能理由（索引用的是取餘數而不是位元遮罩，因為步長可變時
 * 有效槽數也跟著變）；取 256 純粹是一個好記的、夠用的整數。
 */
const SLOTS = 256

/**
 * 把一個 `Command` 延後 n 個物理步再吐出來。
 *
 * 【延遲的是輸出指令，不是態勢】一個 `Command` 只有一個 Vector3 加三個純量，
 * 語義乾淨：「這個飛行員現在做的，是他 n 毫秒前看到的畫面所導出的決定」。
 * 延遲 `Situation` 則要複製十幾個欄位、還要處理 10 Hz 與 240 Hz 兩種節拍，
 * 而且 `basis`、`knobs`、`rules` 的閂鎖會跟著錯拍（spec §4.1）。
 *
 * 【為什麼不是降低決策頻率】把 10 Hz 調成 3 Hz 只會讓**意圖切換**變遲鈍，
 * 240 Hz 的轉向仍然是即時追蹤 —— 而追瞄能力正是要降的那一項。
 *
 * 【零延遲必須是位元等價的無作用】`ACE` 是全部 AI 測試與 `bench/ai-load.ts`
 * 的設定，也是 M4 交付的天花板。任何數值漂移都會讓既有的對戰矩陣變成「不
 * 知道是誰改的」。所以 `steps <= 0` 直接複製，**完全不碰緩衝區** —— 順帶
 * 保證預設設定下 240 Hz 熱路徑一步額外的運算都不多。
 *
 * 熱路徑（240 Hz），不配置記憶體。
 */
export class CommandDelay {
  /**
   * 四個欄位各自一條 typed array。
   *
   * 【為什麼不是 `Vector3[]`】256 個 Vector3 物件 × 40 架 AI 是 40 萬個堆積
   * 物件；三條 typed array 每架只要約 4 KB。單位向量用 float32 的 7 位有效
   * 位數綽綽有餘。
   */
  private readonly aim = new Float32Array(3 * SLOTS)
  private readonly throttle = new Float32Array(SLOTS)
  private readonly brake = new Float32Array(SLOTS)
  private readonly firing = new Uint8Array(SLOTS)
  private write = 0
  /**
   * 緩衝區裡有沒有可信的內容。
   *
   * 【為什麼需要】沒填過就讀，開場前 n 步會拿到零向量，飛機會抽一下。
   * 首次啟用時把**全部**槽位填成當前指令，讀到哪一格都是合理的。
   * 走零延遲捷徑時清掉它，所以中途開關延遲也不會吐出陳舊指令。
   */
  private primed = false

  /**
   * @param input        這一步 AI 算出來的指令
   * @param delaySeconds `DifficultyProfile.reactionDelay`
   * @param dt           物理步長。步長固定（`FixedStepAccumulator`，240 Hz），
   *                     所以用它換算步數比存時戳簡單，而且改步長時下一步就
   *                     會換算出新的步數，不需要額外狀態
   * @param out          寫入目標。可以與 `input` 是不同的物件
   */
  push(input: Command, delaySeconds: number, dt: number, out: Command): void {
    const raw = delaySeconds > 0 && dt > 0 ? Math.round(delaySeconds / dt) : 0
    const steps = Math.min(raw, Math.min(SLOTS - 1, Math.round(MAX_REACTION_DELAY / dt)))
    if (steps <= 0) {
      out.aimWorld.copy(input.aimWorld)
      out.throttle = input.throttle
      out.brake = input.brake
      out.firing = input.firing
      this.primed = false
      return
    }

    if (!this.primed) {
      this.primed = true
      this.write = 0
      for (let i = 0; i < SLOTS; i++) {
        this.aim[3 * i] = input.aimWorld.x
        this.aim[3 * i + 1] = input.aimWorld.y
        this.aim[3 * i + 2] = input.aimWorld.z
        this.throttle[i] = input.throttle
        this.brake[i] = input.brake
        this.firing[i] = input.firing ? 1 : 0
      }
    }

    const w = this.write
    this.aim[3 * w] = input.aimWorld.x
    this.aim[3 * w + 1] = input.aimWorld.y
    this.aim[3 * w + 2] = input.aimWorld.z
    this.throttle[w] = input.throttle
    this.brake[w] = input.brake
    this.firing[w] = input.firing ? 1 : 0

    // 先寫再讀：`steps === 0` 時 r === w，也就是讀回剛寫進去的那一格。
    // （那條路徑走上面的捷徑，這裡只是讓索引式子在邊界上仍然自洽。）
    const r = (w - steps + SLOTS) % SLOTS
    out.aimWorld.set(this.aim[3 * r]!, this.aim[3 * r + 1]!, this.aim[3 * r + 2]!)
    out.throttle = this.throttle[r]!
    out.brake = this.brake[r]!
    out.firing = this.firing[r] === 1

    this.write = (w + 1) % SLOTS
  }
}
