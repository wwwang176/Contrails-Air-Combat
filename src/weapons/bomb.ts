/**
 * 掛得了彈的機種。**沒有列在這裡的按 `B` 沒有作用。**
 *
 * 【是集合而不是各自的載彈量】彈艙統一 10 枚（見 `BOMB_BAY`），這裡只剩
 * 「能不能投」這一個問題。
 */
const BOMBERS: ReadonlySet<string> = new Set(['b17g', 'he111', 'g4m'])

/**
 * 彈艙容量。
 *
 * 一次扳機把整艙依序投完，空了之後等 `BOMB_RELOAD_SECONDS` 回補滿。
 */
export const BOMB_BAY = 10

/**
 * 連投的間隔，秒。**起始值，由試飛裁定。**
 *
 * 它是彈著間距的旋鈕：B-17G 巡航 90 m/s 之下 0.35 s 是 31.5 m，整串 10 枚
 * 撒出約 283 m。
 */
export const BOMB_SALVO_INTERVAL = 0.35

/**
 * 空艙到補滿要多久，秒。**起始值，由試飛裁定。**
 *
 * 少了它彈艙等於無限，投彈就沒有「這一趟要投在哪」的取捨。20 s 約是一次
 * 重新對正航路的時間。
 */
export const BOMB_RELOAD_SECONDS = 20

export function canBomb(specId: string): boolean {
  return BOMBERS.has(specId)
}

/**
 * 彈艙的執行期狀態。
 *
 * 【抽成純函數】三個計時分支互相牽制（連投中、空艙回補中、待命），交界
 * 是會壞的地方 —— 例如「回補到一半再按扳機」。`main.ts` 的迴圈進不了單元
 * 測試，這個狀態機進得去。
 */
export interface BombBay {
  /** 艙裡還有幾枚 */
  load: number
  /** 這一輪還要投幾枚 */
  queue: number
  /** 距下一個動作還有幾秒（投下一枚，或回補完成） */
  timer: number
  /** 正在回補。`timer` 歸零時補滿 */
  reloading: boolean
}

export function createBombBay(): BombBay {
  return { load: BOMB_BAY, queue: 0, timer: 0, reloading: false }
}

/** 換飛機／重生：立刻滿艙、取消一切計時 */
export function resetBombBay(b: BombBay): void {
  b.load = BOMB_BAY
  b.queue = 0
  b.timer = 0
  b.reloading = false
}

/**
 * 推進一幀。
 *
 * @param trigger 這一幀**剛按下**扳機（邊緣，不是按著）
 * @param drop    投一枚。一幀最多呼叫一次
 */
export function stepBombBay(
  b: BombBay, dt: number, trigger: boolean, drop: () => void,
): void {
  if (b.timer > 0) b.timer -= dt

  if (b.reloading) {
    // 【回補期間吃掉扳機】按了沒反應會被當成 bug，但「正在補彈」是一個玩家
    // 看得到的狀態（HUD 有讀數），所以它是規則而不是失靈
    if (b.timer <= 0) {
      b.load = BOMB_BAY
      b.reloading = false
      b.timer = 0
    }
    return
  }

  // 【連投中不接受新的扳機】一次按下就是一整艙，中途再按沒有第二個意思
  if (trigger && b.queue === 0 && b.load > 0) b.queue = b.load

  if (b.queue > 0 && b.timer <= 0) {
    drop()
    b.load--
    b.queue--
    b.timer = BOMB_SALVO_INTERVAL
  }

  // 【空了才開始回補，而且要等最後一枚的間隔走完】否則整串的節拍會在最後
  // 一枚上少一拍
  if (b.load === 0 && b.queue === 0 && b.timer <= 0) {
    b.reloading = true
    b.timer = BOMB_RELOAD_SECONDS
  }
}

/**
 * **基準**炸彈的爆心傷害。AN-M64 500 lb（227 kg）—— B-17G 掛的那一種。
 *
 * 【它同時是尺度的分母】每一顆炸彈自己帶著爆心傷害，而
 * `blastScaleOf(damage)` 就是 `damage / 這個值`。整顆彈的規模由那個尺度
 * 推導：殺傷半徑、爆炸的視覺大小、動畫的長短。
 *
 * 【起始值，由試飛裁定】
 *
 * 【量級的推導】三級船的血量是 Fletcher 20,000／Wichita 40,000／
 * Essex 60,000，彈艙一次十顆。9,000 之下：
 *
 * ```
 *   驅逐艦     3 發沉
 *   巡洋艦     5 發沉
 *   航空母艦   7 發沉
 * ```
 *
 * 一趟投彈打不中全部十顆——投彈是有散佈的，而船在動。三到七發等於「一趟
 * 打得沉驅逐艦、航母要兩趟」。
 *
 * 【不套機砲那一套的部位倍率】那是飛機的六個部位。船的裝甲差異由砲位與
 * 船體各自的血量表達（`World` 的子彈路徑寫過同一句）。飛機那一邊照走
 * `applyDamage`，所以機身的防護力仍然有效。
 */
export const BOMB_BLAST_DAMAGE = 9_000

/**
 * 各機種掛的炸彈，**爆心傷害**。
 *
 * 【為什麼是傷害而不是公斤】設計上要調的是「這一台炸起來多痛」，而傷害是
 * 那件事的直接表達。裝藥量則要再過一次換算才看得出後果。
 *
 * 【換算】爆炸的衝量與裝藥的立方根成正比（Hopkinson–Cranz），所以
 * **傷害的比值就是尺度的比值**，裝藥的比值是它的三次方：
 *
 * ```
 *              掛載                裝藥比   尺度   爆心傷害
 *   B-17G      AN-M64 500 lb       1.00    1.00    9,000    ← 基準
 *   He 111     SC 250              1.10    1.03    9,300
 *   G4M        八十番 800 kg       3.52    1.52   13,700
 * ```
 *
 * 【B-17G 與 He 111 幾乎一樣是對的】兩者的單顆彈確實都是 250 kg 級。重
 * 轟炸機的優勢在**帶得多**，不在單顆更狠 —— 要拉開差距該動的是彈艙容量。
 */
export const BOMB_DAMAGE_BY_AIRCRAFT: Readonly<Record<string, number>> = {
  b17g: 9_000,
  he111: 9_300,
  g4m: 13_700,
}

/**
 * 這一台掛的炸彈有多痛。不是轟炸機就回 0。
 */
export function bombDamageOf(aircraftId: string): number {
  return BOMB_DAMAGE_BY_AIRCRAFT[aircraftId] ?? 0
}

/**
 * 爆心傷害 → **線性尺度**。基準彈是 1。
 *
 * 【為什麼是線性而不是立方根】立方根律吃的是**裝藥量**，而這裡的輸入已經
 * 是傷害了 —— 傷害本身就正比於尺度（見 `BOMB_DAMAGE_BY_AIRCRAFT` 的換算
 * 表）。再開一次三次方就等於開了兩次。
 */
export function blastScaleOf(damage: number): number {
  if (!(damage > 0)) return 0
  return damage / BOMB_BLAST_DAMAGE
}

/**
 * **基準**彈的殺傷半徑，m。實際半徑是它乘上 `blastScaleOf(damage)`。
 *
 * 【它是「近失彈」的尺度】30 m 之下：貼著艦首爆的那一顆仍然扣到接近全額，
 * 落在 15 m 外的扣一半，30 m 外完全不扣。對 115 m 長的驅逐艦來說，這讓
 * 「差一點」仍然有意義而不是全有全無。真實 500 lb 的「摧毀」半徑是
 * 10–15 m —— 這裡刻意放寬，那是玩起來的手感不是物理。
 *
 * 【比五寸砲的 50 m 小】那一朵是空爆的破片雲，設計上要罩得住一個機動中的
 * 編隊；炸彈是落在一個定點上的。
 */
export const BOMB_BLAST_RADIUS = 30

/** 這一顆彈的殺傷半徑，m。半徑與傷害同尺度 */
export function blastRadiusOf(damage: number): number {
  return BOMB_BLAST_RADIUS * blastScaleOf(damage)
}

/**
 * 離爆心 `distance` 公尺處扣多少血。線性衰減，半徑外為 0。
 *
 * @param damage 這一顆的爆心傷害。半徑跟著它走 —— 痛的彈也炸得遠
 *
 * 【半徑外一定要夾成 0】不夾的話公式會給出負數 —— 遠方的東西會被「治療」，
 * 而且那個錯誤在畫面上完全看不出來（`flakDamage` 為同一件事留過同一句）。
 */
export function bombBlastDamage(distance: number, damage: number): number {
  const r = blastRadiusOf(damage)
  if (!(r > 0) || distance >= r) return 0
  return damage * (1 - distance / r)
}
