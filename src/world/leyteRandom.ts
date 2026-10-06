/** 種子進、序列出。**不得 `Math.random`** —— 同一張地圖每次都要長一樣 */
export function makeLeyteRand(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}
