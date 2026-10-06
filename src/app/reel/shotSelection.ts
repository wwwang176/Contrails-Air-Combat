/**
 * 這一段被挑中的權重。`ago` = 它是幾段之前播的（1 = 上一段），沒播過給 `ids.length`。
 * 權重 (ago − 1)²：上一段是 0、一定不挑；越久沒播越高，平方讓剛播過的幾段機率壓得很低
 * —— 六段時，兩段前播的是 1、三段前是 4、沒播過是 25
 */
export function shotWeight(ago: number, count: number): number {
  const k = Math.min(ago, count) - 1
  return k * k
}

/**
 * 下一段播哪一段：照 `shotWeight` 加權隨機。`seen` 是播過的段落由舊到新（`markShotSeen`），
 * `r` ∈ [0, 1) 是亂數。開場與一段播完換段都用它。全部權重都是 0（只有一段）就挑第 0 段
 */
export function pickNextShot(ids: readonly string[], seen: readonly string[], r: number): number {
  let total = 0
  for (const id of ids) total += shotWeight(agoOf(seen, id, ids.length), ids.length)
  if (total === 0) return 0
  let x = r * total
  for (let i = 0; i < ids.length; i++) {
    x -= shotWeight(agoOf(seen, ids[i]!, ids.length), ids.length)
    if (x < 0) return i
  }
  return ids.length - 1
}

/** `id` 是幾段之前播的（1 = 最後播的那一段）；沒播過回 `never` */
function agoOf(seen: readonly string[], id: string, never: number): number {
  const k = seen.lastIndexOf(id)
  return k < 0 ? never : seen.length - k
}

/**
 * 這一段開播了：移到 `seen` 的最後（`seen` 由舊到新、不重複）。清單裡已經沒有的段落
 * 順手丟掉，所以長度不會超過段數
 */
export function markShotSeen(ids: readonly string[], seen: readonly string[], id: string): string[] {
  const next = seen.filter((s) => s !== id && ids.includes(s))
  next.push(id)
  return next
}
