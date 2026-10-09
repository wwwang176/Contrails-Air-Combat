/**
 * 播停的每一步最多等多久，ms。**Safari 對一個從沒被手勢啟動過的 context 呼叫 `suspend()`，
 * promise 永遠不回來** —— 不設時限的話，排在它後面的每一步都跟著卡住
 */
export const RUN_STEP_TIMEOUT_MS = 1000

/**
 * 音訊 context 的播停。`want()` 回答「現在該不該播」，每次狀態變動呼叫 `apply()`。
 *
 * 【排隊依序做】`resume()` 回來之前 `ctx.state` 還是 suspended —— 那時切走分頁，只看當下狀態的話
 * 會跳過 `suspend()`，等 `resume()` 完成聲音又出來。每一步都在前一步完成之後，重新看一次該停還是該播。
 *
 * 【喚醒要在手勢的當下】Safari 只認點擊處理裡直接呼叫的 `resume()`；排進 promise 之後才叫的會被拒絕。
 * 所以要播時當下就呼叫，排隊的那一步只等它完成。
 *
 * 【已經停了就不再停】見 `RUN_STEP_TIMEOUT_MS`：頁面一載入、還沒有點擊時就會要停一次。
 */
export function createRunControl(
  ctx: Pick<AudioContext, 'state' | 'resume' | 'suspend'>, want: () => boolean,
  timeoutMs = RUN_STEP_TIMEOUT_MS,
) {
  let chain: Promise<void> = Promise.resolve()

  /** 等它完成或拒絕，最多 `timeoutMs` */
  function settle(p: Promise<void>): Promise<void> {
    return Promise.race([p, new Promise<void>((r) => { setTimeout(r, timeoutMs) })]).catch(() => {})
  }

  function apply(): void {
    const kick = want() ? settle(ctx.resume()) : null
    chain = chain.then(async () => {
      // 【先等自己那次的喚醒】它還沒回來時 state 是 suspended，直接看狀態會跳過該做的停止
      if (kick !== null) await kick
      if (want()) {
        if (ctx.state !== 'running') await settle(ctx.resume())
        return
      }
      if (ctx.state === 'suspended') return
      await settle(ctx.suspend())
    })
  }

  return { apply }
}
