import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RUN_STEP_TIMEOUT_MS, createRunControl } from '../../src/audio/runControl'

/** 假的 context：`resume`／`suspend` 回傳由測試控制的 promise，完成時才改狀態 */
function fakeCtx(state: AudioContextState = 'suspended') {
  const pending: { op: 'resume' | 'suspend'; done: () => void }[] = []
  const ctx = {
    state,
    resume: vi.fn(() => new Promise<void>((r) => { pending.push({ op: 'resume', done: () => { ctx.state = 'running'; r() } }) })),
    suspend: vi.fn(() => new Promise<void>((r) => { pending.push({ op: 'suspend', done: () => { ctx.state = 'suspended'; r() } }) })),
  }
  return { ctx, pending }
}

const flush = async (): Promise<void> => { for (let i = 0; i < 6; i++) await Promise.resolve() }

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('音訊 context 的播停', () => {
  /** 【喚醒要在手勢的當下】Safari 只認點擊處理裡直接呼叫的 resume()；排進 promise 之後才叫會被拒絕 */
  it('要播時當下就呼叫 resume()，不等前面排著的', () => {
    const { ctx } = fakeCtx()
    let want = true
    const run = createRunControl(ctx as never, () => want)
    run.apply()
    expect(ctx.resume).toHaveBeenCalledTimes(1)
    want = false
    run.apply()
    want = true
    run.apply()
    expect(ctx.resume).toHaveBeenCalledTimes(2)
  })

  /**
   * 【已經停了就不再停】Safari 對一個從沒被手勢啟動過的 context 呼叫 suspend()，promise 永遠不回來；
   * 頁面載入時那一次要是送出去，之後排著的 resume() 全部卡在它後面，整場無聲
   */
  it('本來就是暫停的：不呼叫 suspend()，之後要播照樣喚醒', async () => {
    const { ctx } = fakeCtx('suspended')
    let want = false
    const run = createRunControl(ctx as never, () => want)
    run.apply()
    await flush()
    expect(ctx.suspend).not.toHaveBeenCalled()
    want = true
    run.apply()
    expect(ctx.resume).toHaveBeenCalledTimes(1)
  })

  /** 【每一步最多等一陣子】瀏覽器不回的那一步不能把之後的播停全部卡死 */
  it(`某一步的 promise 不回來：${RUN_STEP_TIMEOUT_MS} ms 之後照樣做下一步`, async () => {
    const { ctx } = fakeCtx('running')
    let want = false
    const run = createRunControl(ctx as never, () => want)
    run.apply()
    await flush()
    expect(ctx.suspend).toHaveBeenCalledTimes(1)
    run.apply()
    await flush()
    expect(ctx.suspend).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(RUN_STEP_TIMEOUT_MS)
    await flush()
    expect(ctx.suspend).toHaveBeenCalledTimes(2)
    expect(RUN_STEP_TIMEOUT_MS).toBe(1000)
  })

  /**
   * 【排隊依序做】resume() 還沒回來時 state 還是 suspended —— 那時要停的話不能只看當下狀態就跳過，
   * 要等它回來再停，否則喚醒完成之後聲音又出來
   */
  it('喚醒還沒完成就要停：等喚醒完成之後再停', async () => {
    const { ctx, pending } = fakeCtx('suspended')
    let want = true
    const run = createRunControl(ctx as never, () => want)
    run.apply()
    want = false
    run.apply()
    await flush()
    expect(ctx.suspend).not.toHaveBeenCalled()
    pending.find((p) => p.op === 'resume')!.done()
    await flush()
    expect(ctx.suspend).toHaveBeenCalledTimes(1)
  })

  it('resume() 被拒絕也不拋錯，之後照樣能停', async () => {
    const ctx = {
      state: 'running' as AudioContextState,
      resume: vi.fn(() => Promise.reject(new Error('NotAllowedError'))),
      suspend: vi.fn(() => { ctx.state = 'suspended'; return Promise.resolve() }),
    }
    let want = true
    const run = createRunControl(ctx as never, () => want)
    run.apply()
    want = false
    run.apply()
    await flush()
    expect(ctx.suspend).toHaveBeenCalledTimes(1)
  })
})
