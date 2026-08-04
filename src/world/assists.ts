/**
 * 助攻的時間窗口，s。
 *
 * 【20 秒怎麼來】專案負責人裁決。一次對頭通場到脫離大約就是這個尺度 ——
 * 「我把他打傷了，他拉起來逃，我僚機補上」這種最典型的助攻拿得到；
 * 三分鐘前擦到的那一發拿不到（M9 spec §12）。
 */
export const ASSIST_WINDOW = 20

/**
 * 掃出這一次擊墜該記助攻的座位。
 *
 * 規則：除了兇手與受害者本人之外，任何在最近 `ASSIST_WINDOW` 秒內對受害者
 * 造成過傷害的人各記一次。
 *
 * @param damageTime `damageTime[攻擊者 * n + 受害者]` = 最後一次命中的世界時間
 * @param n          表格邊長（`World.damageStride`）
 * @param killer     兇手的座位。**恆是一個真實座位** —— 自摔在戰績上完全
 *                   不存在，所以呼叫端（`drainKills`）根本不會為它掃助攻
 * @param out        **就地清空後填入**。熱路徑之外，但沿用專案的不配置慣例
 *
 * 【為什麼是純函數而不是 World 的方法】它只是一次查表，沒有任何狀態。
 * 抽出來之後窗口邊界可以直接測，不必組一個世界出來（M9 spec §11）。
 */
export function assistCredits(
  damageTime: Float32Array,
  n: number,
  victim: number,
  killer: number,
  now: number,
  out: number[],
): number[] {
  out.length = 0
  for (let a = 0; a < n; a++) {
    if (a === killer || a === victim) continue
    // 【初值 −Infinity 讓「沒打過」自動落在窗口外】不必額外判斷
    if (now - damageTime[a * n + victim]! > ASSIST_WINDOW) continue
    out.push(a)
  }
  return out
}
