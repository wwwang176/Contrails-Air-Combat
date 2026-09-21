/**
 * 音效目錄：哪一類用哪些檔、多大聲、多遠聽得到。
 *
 * 【檔案一律標準音量】誰比誰大聲只看這裡的 gainDb；檔案本身都是 −16 LUFS，
 * 因峰值限制少掉的分貝在 public/audio/manifest.json 的 makeupDb，播放時加回去。
 * 【ref 為 0 表示不定位】自己身上的聲音放在鏡頭位置，不做距離衰減。
 * 數值是起始值，由試玩決定。
 */
export type Category = 'engine' | 'engineSelf' | 'fire' | 'fireSelf' | 'turret' | 'explosion' | 'splash'
  | 'cannon' | 'flakBurst' | 'hitSelf' | 'hitDealt' | 'flyby' | 'damage' | 'rattle'
  | 'reload' | 'whistle' | 'radio' | 'warn' | 'wind'

export interface CategorySpec {
  gainDb: number
  /** 這個距離內是原音量，m。0 = 不定位 */
  ref: number
  /** 超過就不播（單次）或靜音（循環），m */
  max: number
}

/**
 * 【爆炸是天花板】檔案的峰值壓在 −1 dBFS，音量設「高」時總音量是 0 dB ——
 * 爆炸的 +6 已經接近破音。要讓爆炸更突出就把別的往下壓，不是把爆炸往上加。
 */
export const CATEGORY: Record<Category, CategorySpec> = {
  /** 【自己的與別人的一樣大聲】差別交給距離衰減，`ref` 之外每遠一倍就小 6 dB */
  engineSelf: { gainDb: -5, ref: 0, max: 0 },
  engine: { gainDb: -5, ref: 60, max: 3000 },
  /**
   * 自己的槍。**一次擊發一個 one-shot，不是循環。**
   *
   * 【比循環要小聲】350 ms 的尾音配上 13.3 發/秒，全速連射時同時有將近五層
   * 在響 —— 同一個數字底下比循環大 5.7 dB。
   */
  fireSelf: { gainDb: -2, ref: 0, max: 0 },
  fire: { gainDb: 3, ref: 80, max: 2500 },
  turret: { gainDb: -2, ref: 80, max: 2500 },
  explosion: { gainDb: 6, ref: 150, max: 8000 },
  splash: { gainDb: 2, ref: 80, max: 3000 },
  cannon: { gainDb: 1, ref: 150, max: 6000 },
  // 5 吋艦砲、88 砲在空中炸開：就在你附近，要聽得出壓力
  flakBurst: { gainDb: 2, ref: 120, max: 5000 },
  hitSelf: { gainDb: -6, ref: 0, max: 0 },
  // 【比自己被打小得多】連續掃射時它一直在響；音量與頻率上限見 `playHitDealt`
  hitDealt: { gainDb: -14, ref: 0, max: 0 },
  // 【定位但不衰減】判定半徑 20 m，`ref` 也是 20 —— 範圍內都是原音量，
  // 要的只是左右方向：聽得出子彈從哪一邊掠過
  flyby: { gainDb: -4, ref: 20, max: 200 },
  damage: { gainDb: 0, ref: 0, max: 0 },
  rattle: { gainDb: 0, ref: 0, max: 0 },
  reload: { gainDb: -8, ref: 0, max: 0 },
  // 【壓低】投一艙就是八顆，八次呼嘯同時響；它是氛圍，不是回饋
  whistle: { gainDb: -16, ref: 60, max: 1500 },
  radio: { gainDb: -10, ref: 0, max: 0 },
  warn: { gainDb: -10, ref: 0, max: 0 },
  wind: { gainDb: -6, ref: 0, max: 0 },
}

const range = (prefix: string, n: number): string[] => Array.from({ length: n }, (_, i) => `${prefix}-${i + 1}`)

/** 同一種事件從庫裡隨機挑（`pick.ts` 的 pickNoRepeat） */
export const POOLS = {
  explosion: range('explosion', 5),
  /**
   * 空爆：爆炸庫的三個各剪成 2.2 s。
   * 【要短】高射砲一秒炸四次；用 4–7 s 的原版會同時有三十幾個聲音在播
   */
  flakBurst: ['flak-burst-1', 'flak-burst-2', 'flak-burst-3'],
  splash: range('splash', 4),
  cannon: range('cannon', 3),
  hit: range('hit', 16),
  flyby: range('flyby', 20),
  damage: range('damage', 10),
  rattle: range('rattle', 15),
  radio: range('radio', 4),
  // 自己的槍：一次擊發一個 one-shot。命名與砲塔同一套（武器 id ×挺數）
  'volley-m2-50calx6': range('volley-m2-50calx6', 3),
  'volley-mk108x1': range('volley-mk108x1', 3),
  'volley-mg131x2': range('volley-mg131x2', 3),
  'volley-type97x2': range('volley-type97x2', 3),
  'volley-type99-2x2': range('volley-type99-2x2', 3),
  'volley-ho103x2': range('volley-ho103x2', 3),
  'volley-ho5x2': range('volley-ho5x2', 3),
} as const satisfies Record<string, readonly string[]>
export type Pool = keyof typeof POOLS

/** 開火循環依射速合成。翼槍六挺 M2 的三個機種共用一個 */
const FIRE_OF: Record<string, string> = {
  p51d: 'fire-m2x6', f4f4: 'fire-m2x6', f6f5: 'fire-m2x6',
  bf109k4: 'fire-bf109k4', a6m5: 'fire-a6m5', ki84: 'fire-ki84',
}

export function engineFile(specId: string): string {
  return `engine-${specId}`
}

/** 沒有前射武器（轟炸機）回 null */
export function fireFile(specId: string): string | null {
  return FIRE_OF[specId] ?? null
}

/** 砲塔：武器 id（與 src/weapons/ 相同）與管數 → 檔。雙聯以上一律用雙聯 */
export function turretFile(weaponId: string, guns: number): string {
  return `turret-${weaponId}x${guns >= 2 ? 2 : 1}`
}

/**
 * 自己的槍：武器 id 與挺數 → 齊射庫。沒有對應的庫回 null（轟炸機、還沒做的武器）。
 *
 * 【為什麼自己的槍不用循環】循環是一段連續掃射，播多久就聽到幾發 —— 點放一次
 * 扳機會被聽成好幾發，而且停的時候一定切在某一發中間。一次擊發播一個 one-shot
 * 的話，長度由素材自己的衰減決定，射速由 `roundsPerMinute` 決定，每台飛機都對。
 */
export function volleyPool(weaponId: string, guns: number): Pool | null {
  const id = `volley-${weaponId}x${guns}`
  return id in POOLS ? id as Pool : null
}

export const SINGLE_FILES = {
  /** 進出投彈瞄準視角：彈艙的機械聲 */
  bayToggle: 'reload-1',
  /** 彈艙補滿：掛鉤扣上的「喀」加一下悶響 */
  reloadDone: 'reload-2',
  whistle: 'whistle-1',
  warn: 'warn-1',
  wind: 'wind-1',
} as const

export const ALL_FILES: readonly string[] = [
  ...['p51d', 'bf109k4', 'f4f4', 'f6f5', 'a6m5', 'ki84', 'he111', 'g4m', 'b17g'].map(engineFile),
  ...new Set(Object.values(FIRE_OF)),
  ...Object.values(POOLS).flat(),
  ...Object.values(SINGLE_FILES),
]
