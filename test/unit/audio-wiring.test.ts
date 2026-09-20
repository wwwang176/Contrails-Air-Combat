import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 音效的接線護欄 —— **讀 `main.ts` 的原始碼**，照 `bomb-bay-wiring.test.ts` 的寫法。
 * 小部件各自有單元測試；這裡守的是「有沒有接上、接的順序對不對」，
 * 那種壞法不會報錯，只是某個聲音不見或停不下來。
 */
const SRC = new TextDecoder().decode(readFileSync('src/main.ts')).replace(/\r\n/g, '\n').split('\n')
const ALL = SRC.join('\n')

function lines(needle: string): number[] {
  const hits: number[] = []
  for (let i = 0; i < SRC.length; i++) if (SRC[i]!.includes(needle)) hits.push(i)
  return hits
}

/** 從 `head` 那一行起、到下一個頂層 `}` 為止的函式本體 */
function body(head: string): string {
  const at = lines(head)[0]
  expect(at, head).toBeDefined()
  let end = at! + 1
  while (end < SRC.length && SRC[end] !== '}') end++
  return SRC.slice(at, end + 1).join('\n')
}

describe('音效的生命週期接線', () => {
  /** 【手勢裡解鎖】瀏覽器要使用者手勢才肯出聲；出擊那一下就是 grabPointer */
  it('grabPointer 裡解鎖音訊', () => {
    expect(body('function grabPointer(')).toContain('audio.unlock()')
  })

  /**
   * 【暫停只有一個入口】`paused` 的寫入點散在好幾處（Esc、教學卡、重新開始、
   * 換畫面）。漏掉任何一處，那條路徑上的聲音就不會停。
   */
  it('paused 只在 setPausedState 裡寫，而它同時通知音訊', () => {
    const fn = body('function setPausedState(')
    expect(fn).toContain('audio.setPaused(')
    const outside = ALL.replace(fn, '').replace('let paused = false', '')
    expect(outside).not.toMatch(/\bpaused = (true|false)/)
  })

  it('離開戰鬥停掉所有聲音', () => {
    expect(body('function leaveBattle(')).toContain('audio.stopAll()')
  })

  /** 【背景下載】音效不擋開場；進戰鬥時才等它 */
  it('進戰鬥前等音效載完', () => {
    expect(body('async function loadBattle(')).toContain('await audio.load()')
  })

  it('離開戰鬥清空佇列、重設邊緣偵測的狀態', () => {
    const fn = body('function leaveBattle(')
    expect(fn).toContain('clearCues(cues)')
    expect(fn).toContain('resetAudioState()')
  })

  /** 【接手僚機也要重設】上一架正在裝填、新的這架沒有，會誤播「裝填完成」 */
  it('接手僚機時重設邊緣偵測的狀態', () => {
    const at = lines('if (battle.player !== player) {')[0]!
    expect(SRC.slice(at, at + 30).join('\n')).toContain('resetAudioState()')
  })

  it('設定頁改音量會套用到音訊', () => {
    const at = lines('onVolume(db) {')[0]!
    expect(SRC.slice(at, at + 5).join('\n')).toContain('audio.setVolume(db)')
  })
})

describe('音效的戰鬥事件接線', () => {
  const advance = lines('loop.advance(frameSeconds, (dt) => {')[0]!
  const endPhysics = lines('perf.endPhysics()')[0]!
  const inStep = (i: number): boolean => i > advance && i < endPhysics

  /**
   * 【讀在清之前】世界的事件在物理子步裡就被清掉。記錄的那一行排在清除之後，
   * 讀到的永遠是空的 —— 一個聲音都沒有，而且不報錯。
   */
  it('子步裡記事件，排在每一種事件的清除之前', () => {
    const q = lines('queueAudioCues()').filter(inStep)
    expect(q).toHaveLength(1)
    for (const clear of ['clearDamage(dmg)', 'emitGroundKills(world.groundKillEvents)', 'clearKills(world.killEvents)',
      'clearImpacts(world.bombEvents)', 'clearImpacts(world.torpedoEvents)', 'clearBursts(world.burstEvents)']) {
      const c = lines(clear).filter(inStep)
      expect(c, clear).toHaveLength(1)
      expect(q[0]!, clear).toBeLessThan(c[0]!)
    }
  })

  it('記錄擊落、空爆、自己被打', () => {
    const fn = body('function queueAudioCues(')
    for (const cue of ['CUE.Explosion', 'CUE.FlakBurst', 'CUE.HitSelf']) expect(fn).toContain(`pushCue(cues, ${cue}`)
  })

  /** 【子步不碰 Web Audio】240 Hz 裡建音源會每步配置 */
  it('子步裡沒有直接播放', () => {
    for (const call of ['audio.playPool(', 'audio.playFile(', 'audio.selfLoop(', 'audio.assign(']) {
      expect(lines(call).filter(inStep), call).toHaveLength(0)
    }
  })

  /** 【鏡頭更新完才播】距離、延遲、低通都量到鏡頭；用上一幀的鏡頭會差一幀 */
  it('每一幀在鏡頭定位之後播放並清空佇列', () => {
    const cam = lines('applyCameraShake(cameraShake, ctx.camera)')[0]!
    const call = lines('updateAudio(').filter((i) => !SRC[i]!.includes('function'))
    expect(call).toHaveLength(1)
    expect(call[0]!).toBeGreaterThan(cam)
    const fn = body('function updateAudio(')
    expect(fn).toContain('playCues()')
    expect(fn).toContain('clearCues(cues)')
  })

  /**
   * 【哪幾類疊兩層】爆炸、水花、自己被打一次挑兩個不同的疊；受創疊一下命中。
   * 打中敵機、砲擊、空爆、擦過不疊 —— 太密集，聲道會被吃光。
   */
  it('爆炸、水花、自己被打疊兩層；受創疊命中', () => {
    const fn = body('function playCues(')
    expect(fn).toContain("audio.playPool('explosion', 'explosion', x, y, z, true, 0, true)")
    expect(fn).toContain("audio.playPool('splash', 'splash', x, y, z, true, 0, true)")
    expect(fn).toContain("audio.playPool('hit', 'hitSelf', 0, 0, 0, false, 0, true)")
    expect(fn).toContain("audio.playPool('flakBurst', 'flakBurst', x, y, z, true, 0, true)")
    expect(fn).toContain('playHeavyHit()')
    const heavy = body('function playHeavyHit(')
    expect(heavy).toContain("audio.playPool('damage'")
    expect(heavy).toContain("audio.playPool('hit', 'hitSelf', 0, 0, 0, false, LAYER_DB)")
  })

  /**
   * 【打中敵機要限頻率】掃到敵機時幾乎每一幀都有命中，而命中聲平均長 0.65 s；
   * 不限的話 60 fps 會疊將近 40 層，比單獨一次大 16 dB，還會把 24 個聲道佔滿。
   */
  it('打中敵機不疊、限制頻率、依距離衰減與變悶', () => {
    const fn = body('function playHitDealt(')
    expect(fn).toContain('HIT_DEALT_GAP')
    expect(fn).toContain('hitFeedback(')
    expect(fn).toContain("audio.playPool('hit', 'hitDealt', 0, 0, 0, false, HIT_FB.gainDb, false, HIT_FB.cutoffHz)")
  })

  /** 【投彈時飛機本身不出聲】每一顆炸彈自己的呼嘯就是回饋，包括自己投的 */
  it('投彈投雷不另外出聲，自己投的炸彈也會呼嘯', () => {
    expect(ALL).not.toContain("audio.playPool('release'")
    const fn = body('function updateAudio(')
    expect(fn).toContain('audio.playFile(SINGLE_FILES.whistle')
    expect(fn).not.toContain('bombs.owner[i] === me.index')
  })

  /** 【被高射砲炸到也要有感覺】爆風的傷害不走子彈那條事件，只能自己判 */
  it('高射砲的爆風打到自己時記一筆機身受創', () => {
    const fn = body('function queueAudioCues(')
    expect(fn).toContain('pushCue(cues, CUE.Damage')
    expect(fn).toContain('f.radius[i]')
  })

  it('按 B 切換投彈視角時響一下彈艙', () => {
    const fn = body('function updateAudio(')
    expect(fn).toContain('prevViewMode')
    expect(fn).toContain("audio.playFile(SINGLE_FILES.reload")
  })

  it('增援預警換新時播無線電', () => {
    const at = lines('messageText = battle.message')[0]!
    expect(SRC.slice(at - 3, at + 6).join('\n')).toContain("audio.playPool('radio'")
  })
})
