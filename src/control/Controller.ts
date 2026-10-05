import { Vector3 } from 'three'
import type { Aircraft } from '../aircraft/Aircraft'

/**
 * 一架飛機這個物理步的操作指令。
 *
 * 【為什麼玩家與靶機共用同一組欄位】`Aircraft.update(aimWorld, throttle, dt)`
 * 的介面不動（spec §4.1），靶機只是 aimWorld 的來源不同。共用之後 M4 的
 * AI 只要再寫一個 Controller，World 那一層一個字都不用改。
 */
export interface Command {
  /** 世界座標的瞄準方向，單位向量 */
  aimWorld: Vector3
  /** 0 ~ 1.1，1.1 為 WEP */
  throttle: number
  /** 減速，0 ~ 1。玩家的按鍵給 0 或 1；AI 可以只踩一部分（M4 spec §2.1） */
  brake: number
  firing: boolean
  /**
   * 投彈。**與 `firing` 分開。**
   *
   * 【為什麼不合成一格】陸攻要能一邊由砲塔自衛、一邊投彈 —— 那是同一台
   * 飛機上的兩套武器，合成一格會讓它們互斥。
   *
   * 玩家與 AI 都寫它（`PlayerController` 按下投彈的那一步為 true）；彈艙的推進與
   * 投放全在物理步（`World.releaseBombs`）。
   */
  bombing: boolean
  /**
   * 投放準備：這一步要保持正飛，坡度留在 ±90° 內。
   *
   * 【為什麼需要它】指揮儀把機首壓向下方目標時會在「翻轉後拉」與「推頭」
   * 之間挑快的；挑到翻轉的話飛機倒著俯衝，而投放包絡擋滾轉 90° —— 炸彈
   * 倒著丟會撞到自己。掛彈的戰鬥機在對艦攻擊的整段下它。
   *
   * 【玩家恆為 false】玩家自己決定姿態。
   */
  upright: boolean
  /**
   * 強制「滾轉後拉」：瞄準點在機翼平面之下時，指揮儀一律把瞄準點翻到機體上方再用正過載拉，不推頭。
   * `upright` 的對稱相反。
   *
   * 【為什麼需要它】瞄準點在下方時，指揮儀在「推頭」與「翻轉後拉」之間挑時間短的；這台飛機這個速度下
   * 挑的是推頭（負過載，俯仰率不到正過載的一半，但翻轉那一圈更貴），推頭拉不過垂直。斯圖卡的過頂
   * 俯衝要翻到顛倒、用正過載拉過垂直，機鼻指向後下方、回頭對著目標。
   *
   * 【與 `upright` 同時給時 `upright` 優先】機翼放平是投放的硬條件。
   *
   * 【玩家恆為 false】玩家自己決定姿態。
   */
  pull: boolean
  /**
   * 跟瞄：瞄準方向正跟著一個在轉的目標。指揮儀的機翼改平改到那個轉彎要的
   * 坡度，而不是拉向水平（`FlightDirector.update`）。
   *
   * 【為什麼需要它】改平把坡度拉向 0 的前提是「機首對準之後坡度是自由的」。
   * 瞄準方向在轉的時候不成立 —— 拉向 0 的話機首落後、誤差長回來、瞄準又把
   * 坡度拉回去，約 1 Hz 的極限環，AI 的射擊解每秒開關一次。
   *
   * 【玩家恆為 true】滑鼠準星是世界固定的，瞄準方向在轉就是在跟一個轉彎。
   * AI 只在瞄準方向貼著預瞄點時開（`AiController` 的 `TRACK_TURN_CONE`）——
   * 它有幾個分支的瞄準方向是由自己的速度導出的。
   */
  trackTurn: boolean
  /**
   * 投彈的離地高度下限，m。投放包絡（`BOMB_ENVELOPE`）沒有高度下限，這一格是控制器
   * 自己加的：連投排進彈艙之後，離地低於它就暫停（`World.releaseBombs`）。
   *
   * 【玩家 0】任何高度都投得出去，被自己的爆風波及是玩家的代價。
   * 【AI `AI_RELEASE_FLOOR`】安全層只清 `bombing`、擋不住排好的佇列；少了它，AI 掉到
   * 低空時剩下的彈會照投，把自己炸下來。
   */
  releaseFloor: number
}

export function createCommand(): Command {
  return {
    aimWorld: new Vector3(0, 0, -1), throttle: 0, brake: 0, firing: false, bombing: false,
    upright: false, pull: false, trackTurn: false, releaseFloor: 0,
  }
}

export interface Controller {
  /**
   * 每個物理步更新一次指令。
   *
   * `out` 由呼叫端持有並重複使用——熱路徑禁止配置，所以這裡只能寫入，
   * 不能回傳新物件。
   */
  update(self: Aircraft, dt: number, out: Command): void
}
