/**
 * 投放包絡：這一幀的姿態、高度與速度投不投得出去。
 *
 * 【檔名為什麼不是 `envelope.ts`】`analysis/envelope.ts` 已經佔了那個字 ——
 * 那一支是**飛行包絡**（失速、極速、升限、轉彎率）。兩者都叫 envelope，
 * 而且各自有一支測試；同名的話 `test/unit/envelope.test.ts` 到底測哪一個
 * 沒有人分得出來。
 *
 * 【為什麼是純函數】`main.ts` 的每幀迴圈進不了單元測試，而「什麼時候投得
 * 下去」是一條有實際後果的規則 —— 與 `bombsightStyle`、`contactColor`、
 * `minimapSymbol` 同一個做法。
 *
 * 【為什麼這個檔案不 import three】它只收五個純量。角度由呼叫端從
 * `attitudeFromOrientation` 取，高度由呼叫端減地形。
 */
import type { OrdnanceKind } from './stores'

const DEG = Math.PI / 180

export interface ReleaseEnvelope {
  /** 坡度的上界，rad。**比的是絕對值** —— 倒飛一定超出 */
  readonly maxRoll: number
  /** 俯仰的下界與上界，rad */
  readonly minPitch: number
  readonly maxPitch: number
  /** 離地高度的下界與上界，m。沒有上界時填 `Infinity` */
  readonly minAgl: number
  readonly maxAgl: number
  /** 真空速的下界與上界，m/s。不限速時填 0 與 `Infinity` */
  readonly minTas: number
  readonly maxTas: number
}

/**
 * 炸彈的包絡。**只擋退化狀態。**
 *
 * 【90° 是「翻過去就不能投」】負責人：「例如顛倒飛不能投彈」。
 *
 * 【60 m 是自己的爆炸半徑的兩倍】基準彈的 `BOMB_BLAST_RADIUS` 是 30 m。
 *
 * 平飛投彈時這一張永遠不作用 —— 與瞄具的 70° 圓錐是同一種東西：安全網，
 * 不是常態限制。**起始值，由試飛裁定。**
 */
export const BOMB_ENVELOPE: ReleaseEnvelope = {
  maxRoll: 90 * DEG,
  minPitch: -70 * DEG,
  maxPitch: 70 * DEG,
  minAgl: 60,
  maxAgl: Infinity,
  minTas: 0,
  maxTas: Infinity,
}

/**
 * 魚雷的包絡。**姿態與高度兩個維度，不限速度。**
 *
 * 【不限速度】限了很難投。`minTas` / `maxTas` 兩格保留 —— 重開限制時改的
 * 是一個數字，不是一支函式的簽章與它的每一個呼叫端。
 *
 * 【姿態幾乎要平】九一式入水後靠尾舵定深，投放時帶坡度或俯仰會讓它入水
 * 角錯誤。12° 與 ±6° 讓玩家還做得到修正，但做不到「一邊轉彎一邊投」。
 *
 * 【高度有上界】太高投下去雷體會折斷 —— 這是炸彈沒有的一條。
 *
 * 【200 而不是史實的 100】**上界跟著 AI 飛得住的高度走。** 命令 AI 帶一台
 * 轟炸機飛 50 m 或 100 m，兩次都在兩分鐘之內飛進海裡；它自然穩得住的是
 * 150 m 附近（`ai/torpedoRun.ts` 的 `RUN_ALTITUDE`）。
 *
 * 【為什麼不是只放寬給 AI】玩家與 AI 共用同一條包絡，準星的紅綠與 AI 的
 * 投放門檻是同一個判準。分家的話會出現「AI 投得出玩家投不出的雷」。
 *
 * **起始值，由試飛裁定。**
 */
export const TORPEDO_ENVELOPE: ReleaseEnvelope = {
  maxRoll: 12 * DEG,
  minPitch: -6 * DEG,
  maxPitch: 6 * DEG,
  minAgl: 20,
  maxAgl: 200,
  minTas: 0,
  maxTas: Infinity,
}

export function envelopeFor(kind: OrdnanceKind): ReleaseEnvelope {
  return kind === 'torpedo' ? TORPEDO_ENVELOPE : BOMB_ENVELOPE
}

/**
 * 這一幀投得出去嗎。
 *
 * 【全部寫成正向的區間比較】NaN 在每一個比較裡都是 false，所以讀不到姿態
 * 時整支回 false —— 寫成 `!(x > max)` 那種否定式的話 NaN 會被放行。
 *
 * @param roll  坡度，rad。**取絕對值**，左右一樣
 * @param pitch 俯仰，rad
 * @param agl   離地高度，m
 * @param tas   真空速，m/s
 */
export function canRelease(
  env: ReleaseEnvelope,
  roll: number, pitch: number, agl: number, tas: number,
): boolean {
  return Math.abs(roll) <= env.maxRoll
    && pitch >= env.minPitch && pitch <= env.maxPitch
    && agl >= env.minAgl && agl <= env.maxAgl
    && tas >= env.minTas && tas <= env.maxTas
}
