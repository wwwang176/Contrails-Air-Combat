import { dbToGain } from './curves'

/** 選單音樂淡入、淡出的時間，s */
export const MUSIC_FADE_SECONDS = 0.5

/**
 * 選單音樂的音量。檔案整首正規化到 −16 LUFS，壓峰值少掉的 `makeupDb` 在這裡補回；
 * `gainDb` 由試聽裁定
 */
export const MENU_MUSIC = (() => {
  const gainDb = -9
  const makeupDb = 1.8
  return { gainDb, makeupDb, level: dbToGain(gainDb + makeupDb) }
})()

/**
 * 一首循環的背景音樂：串流播放（`HTMLAudioElement`），經自己的增益接到 `output`。
 *
 * 「要不要播」（`start`／`stop`）與「音訊在不在跑」（`setRunning`）分開記：兩者都成立才真的播。
 *
 * @param output 引擎的音樂匯流排（`output.ts` 的 `musicInput`）
 */
export function createMusic(
  ctx: Pick<AudioContext, 'currentTime' | 'createGain' | 'createMediaElementSource'>,
  output: AudioNode, element: HTMLMediaElement,
) {
  element.loop = true
  const gain = ctx.createGain()
  gain.gain.value = 0
  ctx.createMediaElementSource(element).connect(gain)
  gain.connect(output)

  let wanted = false
  let running = false
  /** 每次 `start`／`stop`／`setRunning` 加一：`play()` 兌現時對不上就是過時的，不淡入 */
  let generation = 0
  let pauseTimer: ReturnType<typeof setTimeout> | null = null

  /** 從目前的值線性走到 `to` */
  function rampTo(to: number): void {
    const now = ctx.currentTime
    const g = gain.gain
    const from = g.value
    g.cancelScheduledValues(now)
    g.setValueAtTime(from, now)
    g.linearRampToValueAtTime(to, now + MUSIC_FADE_SECONDS)
  }

  function cancelPause(): void {
    if (pauseTimer === null) return
    clearTimeout(pauseTimer)
    pauseTimer = null
  }

  /**
   * 播放，**等它真的開始才淡入** —— 串流還沒開始就排的話，淡入在無聲中走完，第一個樣本就是全音量。
   * 等待期間又停止或音訊暫停了就不淡入；被拒絕就算了
   */
  function play(): void {
    const mine = ++generation
    void Promise.resolve(element.play()).then(() => {
      if (mine === generation && wanted && running) rampTo(MENU_MUSIC.level)
    }).catch(() => {})
  }

  function start(): void {
    if (wanted) return
    wanted = true
    cancelPause()
    if (running) play()
  }

  function stop(): void {
    if (!wanted) return
    wanted = false
    generation++
    rampTo(0)
    cancelPause()
    pauseTimer = setTimeout(() => {
      pauseTimer = null
      element.pause()
    }, MUSIC_FADE_SECONDS * 1000)
  }

  /**
   * 引擎的 context 開始跑或暫停（切分頁、關音量、暫停）。**暫停時元素也要停** —— context 暫停只是
   * 不輸出，元素照樣往前走，回來時位置已經跳掉。恢復時要播就重新播放並淡入
   */
  function setRunning(run: boolean): void {
    if (run === running) return
    running = run
    if (!run) {
      generation++
      cancelPause()
      const g = gain.gain
      g.cancelScheduledValues(ctx.currentTime)
      g.setValueAtTime(0, ctx.currentTime)
      element.pause()
      return
    }
    if (wanted) play()
  }

  return { start, stop, setRunning }
}
