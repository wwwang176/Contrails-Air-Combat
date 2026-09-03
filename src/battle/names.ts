/**
 * 陣營。**定義在 `specs/types.ts`** —— `AircraftSpec` 要用它，而
 * `battle/` 大量 import `specs/`，反過來會繞成循環。這裡轉出去只是為了
 * 讓「陣營」與「名冊」在同一個檔案裡讀得到。
 *
 * 【2026-09-03 起沒有 `factionOf` 了】它以前是一份寫死的 id 白名單
 * （`id === 'bf109k4' || id === 'he111' ? 'axis' : 'allies'`）。漏一個機種的
 * 症狀是拿到錯的那一本名冊 —— 不是錯誤，是一排讀起來怪怪的名字，而
 * 2026-08-21 的 He 111 就是這樣漏的。現在陣營是 `AircraftSpec` 的必填欄位，
 * 直接讀 `spec.faction`；漏填是編譯錯誤。
 */
export type { Faction } from '../specs/types'
import type { Faction } from '../specs/types'

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
 * 日本飛行員名冊。24 個。
 *
 * 【羅馬字、名在前】與另外兩本的節奏一致 —— 記分板一列只有一個字串，而
 * 三本名冊不會同時出現在同一列裡。日文的姓名順序是姓在前，這裡採的是
 * 英文文獻的慣例。
 *
 * 【全部是虛構的】另外兩本也是。真實的王牌名字掛在一架被隨機分配的僚機上
 * 讀起來像個玩笑。
 */
export const JAPAN_NAMES: readonly string[] = [
  'Hiroshi Kaneko', 'Takeo Fujita', 'Kenji Okumura', 'Masaru Shimizu', 'Isamu Aoki',
  'Tadashi Matsuda', 'Susumu Hoshino', 'Noboru Terada', 'Yutaka Yamashiro',
  'Kiyoshi Sugimoto', 'Minoru Inoue', 'Shigeru Kawabe', 'Osamu Morita',
  'Katsumi Tachibana', 'Toshio Nomura', 'Akira Ishida', 'Mitsuo Kubota',
  'Haruo Sasaki', 'Sadao Maruyama', 'Yoshio Ueda', 'Tsutomu Hasegawa',
  'Nobuo Namba', 'Kazuo Segawa', 'Ryoichi Amano',
]

/**
 * 陣營 → 名冊。
 *
 * 【為什麼是 `Record` 而不是三元式】三元式少一個分支是**靜靜地拿到別人的
 * 名冊**。`Record<Faction, …>` 少一格是編譯錯誤 —— 與 `hud/Hud.ts` 的
 * `WIDGET_DRAW` 同一條理由。
 */
const NAMES: Record<Faction, readonly string[]> = {
  allies: ALLIED_NAMES,
  axis: AXIS_NAMES,
  japan: JAPAN_NAMES,
}

/**
 * 抽 `count` 個名字。同種子同結果，而且**彼此不重複**。
 *
 * 【為什麼是洗牌而不是逐個抽】逐個抽會撞名，而同一場裡兩個「Hans Richter」
 * 在記分板上完全讀不出來誰是誰。洗牌保證不重複，代價只是複製一份名冊。
 */
export function pilotNames(seed: number, faction: Faction, count: number): string[] {
  const pool = NAMES[faction].slice()
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
