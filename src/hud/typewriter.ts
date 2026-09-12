/**
 * 打字機：文字依序一個字一個字出現。目標橫幅與畫面中央的訊息共用。
 *
 * 【年齡由 `main.ts` 給】widget 沒有自己的時鐘；文字改變的那一刻記下來，
 * 之後每幀把「已經過了幾秒」放進 `HudFrame`。−1 = 不打字，整句直接印。
 */

/** 每一個字出現的間隔，秒。十個字半秒打完 */
export const TYPE_SECONDS_PER_CHAR = 0.05

/**
 * 到這個年齡為止該印出的前綴。第 0 秒就有第一個字，不然開頭會閃一下空白。
 *
 * @param secondsPerChar 每個字的間隔。**戰果通報用自己的速度** ——
 *                       它是回饋不是預警，見 `REPORT_SECONDS_PER_CHAR`
 */
export function typedPrefix(
  text: string, age: number, secondsPerChar: number = TYPE_SECONDS_PER_CHAR,
): string {
  if (age < 0) return text
  const n = Math.floor(age / secondsPerChar) + 1
  return n >= text.length ? text : text.slice(0, n)
}
