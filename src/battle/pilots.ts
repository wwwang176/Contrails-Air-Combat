/**
 * 一位飛行員的戰績。
 *
 * 【為什麼不掛在 `Combatant` 上】玩家會換座位（接手僚機）。掛在座位上的話，
 * 玩家接手之後自己的擊墜數會留在那具殘骸上，畫面上看起來像戰果被清掉了
 * （M9 spec §3）。
 */
export interface Pilot {
  /** 顯示名。一場內不變，**跟著人走** */
  name: string
  kills: number
  deaths: number
  assists: number
  /** 還在天上 */
  alive: boolean
  /** 玩家本人。接手時跟著人走 */
  isPlayer: boolean
}

export interface Roster {
  /**
   * 依**座位**索引：`pilots[i]` 是目前坐在 `world.combatants[i]` 裡的人。
   *
   * 【為什麼仍然依座位排】所有既有的歸屬資訊（彈丸的 `owner`、擊墜事件的
   * 受害者與兇手欄）都是座位索引。名冊跟著座位排，那些一行都不用改；
   * 而「換人」就只是交換陣列裡的兩個元素。
   */
  readonly pilots: Pilot[]
}

export function createRoster(names: readonly string[], playerSeat: number): Roster {
  return {
    pilots: names.map((name, i) => ({
      name,
      kills: 0,
      deaths: 0,
      assists: 0,
      alive: true,
      isPlayer: i === playerSeat,
    })),
  }
}

/**
 * 兩位飛行員交換座位。**接手僚機就是這個動作。**
 *
 * 交換的是整個 `Pilot` 物件 —— 名字、擊墜、陣亡、助攻、玩家標記全部一起搬。
 */
export function swapPilots(r: Roster, a: number, b: number): void {
  if (a === b) return
  const t = r.pilots[a]!
  r.pilots[a] = r.pilots[b]!
  r.pilots[b] = t
}

/**
 * 記一次擊墜。
 *
 * @param killerSeat −1 表示無兇手（撞海、自摔）
 *
 * 【已經陣亡的直接略過】擊墜事件在呼叫端沒有排空時會累積，重複處理不該讓
 * 陣亡數與擊墜數失衡 —— 那會直接打破整合測試的守恆律。
 */
export function recordKill(
  r: Roster, victimSeat: number, killerSeat: number, assistSeats: readonly number[],
): void {
  const victim = r.pilots[victimSeat]
  if (victim === undefined || !victim.alive) return
  victim.alive = false
  victim.deaths++
  if (killerSeat >= 0) {
    const killer = r.pilots[killerSeat]
    if (killer !== undefined) killer.kills++
  }
  for (const s of assistSeats) {
    const p = r.pilots[s]
    if (p !== undefined) p.assists++
  }
}
