/**
 * 掛得了彈的機種。**沒有列在這裡的按 `B` 沒有作用。**
 *
 * 【為什麼是集合而不是各自的載彈量】負責人裁定彈艙統一 10 枚
 * （見 `BOMB_BAY`），所以這裡只剩「能不能投」這一個問題。
 */
const BOMBERS: ReadonlySet<string> = new Set(['b17g', 'he111', 'g4m'])

/**
 * 彈艙容量。**負責人指定 10 枚。**
 *
 * 一次扳機把整艙依序投完，空了之後等 `BOMB_RELOAD_SECONDS` 回補滿。
 */
export const BOMB_BAY = 10

/**
 * 連投的間隔，秒。**起始值，由試飛裁定。**
 *
 * 【它決定彈著的間距】B-17G 巡航 90 m/s 之下 0.35 s 是 31.5 m，整串 10 枚
 * 撒出約 283 m。太密就是一個點（不如一次投一顆）、太疏就串不成一條 ——
 * 這個值是「一條看得出方向的彈著線」的長度旋鈕。
 */
export const BOMB_SALVO_INTERVAL = 0.35

/**
 * 空艙到補滿要多久，秒。**起始值，由試飛裁定。**
 *
 * 【為什麼要有】沒有它的話彈艙等於無限，投彈就沒有「這一趟要投在哪」的
 * 取捨。20 s 大約是一次重新對正航路的時間。
 */
export const BOMB_RELOAD_SECONDS = 20

export function canBomb(specId: string): boolean {
  return BOMBERS.has(specId)
}

/**
 * 彈艙的執行期狀態。
 *
 * 【為什麼抽成純函數】它有三個互相牽制的計時分支（連投中、空艙回補中、
 * 待命），而那三者的交界正是會壞的地方 —— 例如「回補到一半再按扳機」。
 * 繪製與 `main.ts` 的迴圈進不了單元測試，這個狀態機進得去。
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
