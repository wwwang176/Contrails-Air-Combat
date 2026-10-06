/** `a` 起 `d` 秒內 0 → 1（smoothstep） */
export function ramp(t: number, a: number, d: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / d))
  return u * u * (3 - 2 * u)
}

/**
 * `a` 起 `d` 秒內 0 → 1，起步與收尾都比 smoothstep 更緩（smootherstep：速度與加速度在
 * 兩端都是 0）。鏡頭的抬頭與 zoom 用它 —— smoothstep 的加速度在起點跳一下，讀起來像
 * 機器在動
 */
export function easeInOut(t: number, a: number, d: number): number {
  const u = Math.min(1, Math.max(0, (t - a) / d))
  return u * u * u * (u * (u * 6 - 15) + 10)
}

/** `a` 起 `d` 秒內 0 → 1 → 0（sin²） */
export function bump(t: number, a: number, d: number): number {
  const u = (t - a) / d
  if (u <= 0 || u >= 1) return 0
  const s = Math.sin(Math.PI * u)
  return s * s
}
