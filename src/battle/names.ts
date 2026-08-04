/**
 * 陣營。**不是隊伍顏色** —— 隊伍顏色是敵我（藍＝友方），陣營是史實的那一邊。
 *
 * 【為什麼名冊綁陣營】M10 讓玩家選陣營之後，藍隊有可能飛 Bf109。名字要
 * 跟著機種所屬的那一邊走，不是跟著 HUD 的顏色（M9 spec §6.1）。
 */
export type Faction = 'allies' | 'axis'

/** 機種代號 → 陣營。 */
export function factionOf(specId: string): Faction {
  return specId === 'bf109g6' ? 'axis' : 'allies'
}

/**
 * mulberry32 —— 32 位種子的小型 PRNG。
 *
 * 【為什麼自己帶一個而不是用 `Math.random`】名字要「一場內不變、重打重抽」。
 * `Math.random` 只能做到後者。這裡只用它抽一顆種子（見 `battle/setup.ts`），
 * 之後全部走這個確定性序列 —— 種子記下來就能重現同一場的名單。
 *
 * 名字不進入任何物理路徑，所以 M5 spec §3.1 的「同一組設定跑兩次要逐幀
 * 一致」不受影響。
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 同盟國飛行員名冊。24 個 —— 每隊上限 20，留一點餘裕讓每場的前 20 個不一樣。 */
export const ALLIED_NAMES: readonly string[] = [
  'Ray Bishop', 'Hal Carter', 'Ned Foster', 'Gus Hartley', 'Cal Weaver',
  'Vic Sanders', 'Dale Munroe', 'Roy Whitcomb', 'Chuck Danvers', 'Milt Rearden',
  'Sam Ellery', 'Buzz Kendall', 'Art Delaney', 'Wes Trumbull', 'Curt Rawlings',
  'Lou Prentice', 'Jack Ashford', 'Ted Marlowe', 'Dutch Halloran', 'Pete Sallinger',
  'Nash Coburn', 'Rudy Vance', 'Guy Lockhart', 'Frank Mercer',
]

/** 軸心國飛行員名冊。24 個。 */
export const AXIS_NAMES: readonly string[] = [
  'Hans Richter', 'Kurt Vogel', 'Otto Brandt', 'Erich Sauer', 'Franz Keller',
  'Walter Nolte', 'Heinz Kruger', 'Rudolf Mainz', 'Karl Deitrich', 'Ernst Wieland',
  'Georg Halder', 'Josef Lindner', 'Willi Osterman', 'Gunther Reiss', 'Fritz Bergmann',
  'Klaus Ehrhardt', 'Anton Sieber', 'Dieter Falk', 'Helmut Rossler', 'Martin Zeller',
  'Ulrich Baumann', 'Wolfgang Strauss', 'Emil Hartmann', 'Bruno Steiner',
]

/**
 * 抽 `count` 個名字。同種子同結果，而且**彼此不重複**。
 *
 * 【為什麼是洗牌而不是逐個抽】逐個抽會撞名，而同一場裡兩個「Hans Richter」
 * 在記分板上完全讀不出來誰是誰。洗牌保證不重複，代價只是複製一份名冊。
 */
export function pilotNames(seed: number, faction: Faction, count: number): string[] {
  const pool = (faction === 'axis' ? AXIS_NAMES : ALLIED_NAMES).slice()
  const rand = mulberry32(seed)
  // Fisher–Yates
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    const t = pool[i]!
    pool[i] = pool[j]!
    pool[j] = t
  }
  const out: string[] = []
  for (let i = 0; i < count; i++) {
    const base = pool[i % pool.length]!
    const round = Math.floor(i / pool.length)
    // 【超出名冊就加羅馬數字】名冊 24、每隊上限 20，走不到這裡。留著是為了
    // 「名字重複」永遠不會無聲發生 —— 有一天有人把上限調到 30 的時候。
    out.push(round === 0 ? base : `${base} ${'I'.repeat(round + 1)}`)
  }
  return out
}
