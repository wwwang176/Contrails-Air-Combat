import { Audio, AudioListener, Object3D, PositionalAudio, type Camera, type Scene } from 'three'
import { assetUrl } from '../core/asset'
import { CATEGORY, FIRST_FILES, POOLS, type Category, type Pool } from './catalog'
import { absorptionDb, dbToGain, distanceCutoffHz, fadeInCurve, soundArrived, voiceLoudnessDb } from './curves'
import { LAYER_DB, layerDelay, pickNoRepeat, randomRate } from './pick'

/**
 * # 音訊引擎 —— 遊戲裡唯一碰 Web Audio 的地方
 *
 * - **單次音效**：一個聲道池，全部是 `PositionalAudio`。要定位的放在世界座標；
 *   不定位的（自己身上的聲音）掛在鏡頭上，跟著鏡頭走、永遠在正中間。池滿丟最不響的。
 * - **定位循環**：引擎 8、開火 6、砲塔 6 個聲道。每一幀 `beginFrame` → 逐一 `assign`
 *   → `endFrame`；這一幀沒被指派的淡出後放掉。
 * - **自己的循環**：引擎、開火、風切、警告各一個 `Audio`，不定位。
 * - **距離**：定位的聲音接兩級低通（遠處只剩低頻）並依距離再減一點音量
 *   （空氣吸收，見 `curves.ts` 的 `absorptionDb`）；單次音效要等音波傳到才開始播。
 *   等待中與播放中都是每一幀用當下的距離重算 —— 遠方的爆炸要好幾秒才傳到、
 *   聲音本身又有好幾秒，這期間鏡頭會飛掉好幾百公尺。
 *
 * 【暫停與音量關閉是兩個旗標】任一個成立就 suspend；兩個都不成立、而且使用者
 * 已經有過手勢，才 resume。只看一個的話，暫停中切音量會把聲音叫醒。
 */

export type SelfSlot = 'engine' | 'wind' | 'warn'
export type LoopPool = 'engine' | 'fire' | 'turret'

export interface AudioEngine {
  /**
   * 下載並解碼全部音效。重複呼叫回同一個 Promise；失敗的檔案略過。
   *
   * `onProgress` 每載完一支回報一次。**中途接上也會先收到當下的進度** ——
   * 開場就在背景下載了，進戰鬥時才掛上載入畫面。清單還沒到（總數未知）
   * 之前不回報，免得進度條先跳到底再彈回來。
   */
  load(onProgress?: (done: number, total: number) => void): Promise<void>
  /** 在使用者手勢裡呼叫 —— 瀏覽器要手勢才肯出聲 */
  unlock(): void
  /** null 是關閉 */
  setVolume(db: number | null): void
  setPaused(paused: boolean): void
  /** 結算後的慢動作：所有播放速度乘上這個比例。呼叫端一律傳未縮放的速度 */
  setTimeScale(scale: number): void
  /**
   * 世界的聲音從靜音淡入，秒。後叫的蓋掉前面還沒走完的那一段。
   *
   * 暫停、切分頁、關音量之後恢復時，引擎自己會淡入（`RESUME_FADE_IN`）；
   * 這一支給進戰鬥用 —— 那時 context 本來就開著，沒有「停 → 播」可以觸發。
   */
  fadeIn(seconds: number): void
  /**
   * 從音效庫挑一個播。`layered` 為真時再挑一個不同的疊上去（小 `LAYER_DB`、
   * 晚 0–30 ms），同一庫幾個檔就疊得出好幾倍的組合
   */
  playPool(pool: Pool, cat: Category, x: number, y: number, z: number, positioned: boolean,
    extraDb?: number, layered?: boolean, rate?: number, cutoffHz?: number): void
  /**
   * `extraDelay` 加在音速延遲之上，s；`cutoffHz` 是這個聲音自己的音色上限，
   * 定位的取它與距離算出來的較低者。
   * `rate` 是播放速度的倍率，疊在每次播放的 ±8% 隨機之上 —— 慢的同時變低沉、變長。
   */
  playFile(file: string, cat: Category, x: number, y: number, z: number, positioned: boolean,
    extraDb?: number, extraDelay?: number, rate?: number, cutoffHz?: number): void
  /**
   * 選單按鈕。**不吃暫停，也不吃結算的慢動作** —— 暫停選單上那幾顆按鈕
   * 本來就是暫停時唯一還能按的東西，跟著一起靜音等於它們沒有聲音。
   *
   * 走自己的 AudioContext（見 `uiCtx`），所以不受主 context 的 suspend 影響。
   */
  playUi(file: string, extraDb?: number): void
  /** 自己身上的循環。file 為 null 表示停。每一幀都呼叫 */
  selfLoop(slot: SelfSlot, file: string | null, rate: number, gainDb: number, cutoffHz?: number): void
  beginFrame(): void
  /** key 是 combatant 的 index；同一個 key 會拿回同一個聲道 */
  assign(pool: LoopPool, key: number, file: string, x: number, y: number, z: number, rate: number): void
  endFrame(): void
  /** 離開戰鬥：停掉所有聲音 */
  stopAll(): void
}

/**
 * 【要撐得住一波投彈】一組 B-17 齊投有幾十顆炸彈，每一顆有呼嘯與落地爆炸，
 * 爆炸又疊兩層，而爆炸聲長達兩三秒 —— 聲道不夠時後面的炸彈整個沒聲音。
 *
 * 【40 不夠】艦隊防空的關卡實測：120 秒裡艦砲要求 1,573 次、被擋掉 365 次，
 * 空聲道長時間掛在 0，連軍火爆炸也被擋掉 21/54。一個聲道是一個 PannerNode
 * 加兩級低通，加到 64 的成本可以忽略。
 */
const ONE_SHOT_VOICES = 64
/** 空聲道少於這個數就不疊第二層 —— 先保證每一件事都發得出聲 */
const LAYER_MIN_FREE = 16
/**
 * 每一類最多同時佔幾個聲道。**沒列的不限。**
 *
 * 【為什麼光加聲道不夠】艦隊防空的關卡裡艦砲一秒要求十幾次，而每一聲長達
 * 一兩秒 —— 它一類就能把池子吃光，於是同一刻的軍火爆炸整個沒聲音。配額滿了
 * 的那一類只能搶自己人，搶不到別人的份。
 *
 * 【爆炸不設限】它是天花板，該蓋過其他東西。
 */
const VOICE_QUOTA: Partial<Record<Category, number>> = {
  cannon: 22, impact: 12, flyby: 8, whistle: 6, hitDealt: 6, splash: 8, flakBurst: 14,
}
const LOOP_VOICES: Record<LoopPool, number> = { engine: 8, fire: 6, turret: 6 }
const LOOP_CATEGORY: Record<LoopPool, Category> = { engine: 'engine', fire: 'fire', turret: 'turret' }
const SELF_CATEGORY: Record<SelfSlot, Category> = { engine: 'engineSelf', wind: 'wind', warn: 'warn' }
/** 換檔、停止時的淡出，s */
const SELF_FADE = 0.1
const LOOP_FADE = 0.3
const FULL_BAND = 22000
/** 暫停、切分頁、關音量之後恢復的淡入，s */
const RESUME_FADE_IN = 0.8
/** 淡入曲線的點數。曲線點之間是線性內插，32 點已經聽不出折角 */
const FADE_POINTS = 32

interface Voice {
  audio: PositionalAudio
  /** 這一聲屬於哪一類。配額用 */
  cat: Category | null
  filters: BiquadFilterNode[]
  /** 離鏡頭多遠；不定位的是 0 */
  distance: number
  /** 類別音量＋補償＋額外，不含距離的那幾項。播放中每幀重算用 */
  baseDb: number
  positioned: boolean
  ref: number
  rolloff: number
  /** 估計到耳朵有多響，dB。搶聲道比這個 */
  loudness: number
  /** 在等音波傳到：發聲的 context 時間。−1 = 沒在等 */
  waitingSince: number
  /** 等到了才套上去的那幾項 */
  waitDelay: number
  waitRate: number
  /** 等的過程中飛出這個距離就放棄 —— 鏡頭切換會讓距離瞬間跳掉 */
  waitMax: number
  /**
   * 這個聲音自己的截止頻率上限，Hz。**定位的聲音取它與距離算出來的較低者。**
   *
   * 【為什麼定位的也要吃】材質決定音色：打在厚鋼板上就該是悶響，不管離多遠。
   * 只看距離的話，貼著船打會是清脆的金屬聲 —— 像打鋁罐。
   */
  maxCutoff: number
}

interface LoopVoice {
  audio: PositionalAudio
  filters: BiquadFilterNode[]
  key: number
  file: string
  assigned: boolean
  /** 淡出中：到這個時間（context 秒）就停掉放掉。−1 = 沒在淡出 */
  releaseAt: number
}

interface SelfVoice {
  audio: Audio
  /** 只有風切有：截止頻率隨空速變 */
  filter: BiquadFilterNode | null
  file: string | null
  /** 換檔或停止的淡出期間，要換成的檔（null = 停）。undefined = 沒在切換 */
  next: string | null | undefined
  switchAt: number
  gain: number
}

export function createAudioEngine(camera: Camera, scene: Scene): AudioEngine {
  const listener = new AudioListener()
  camera.add(listener)
  const ctx = listener.context
  /**
   * 世界聲音的最後一段：`listener.gain`（主音量）→ `fade` → 喇叭。
   * 每一個世界聲道都經過 `listener.gain`，所以淡入插在這裡就管得到全部。
   */
  const fade = ctx.createGain()
  listener.gain.disconnect()
  listener.gain.connect(fade)
  fade.connect(ctx.destination)
  /**
   * 限幅器。**接上之前先直通** —— `addModule` 是非同步的，而且可能失敗。
   *
   * 【兩種失敗都要旁路】載入失敗不插節點；載好之後 `process()` 拋例外會觸發
   * `processorerror`，那個節點從此永遠輸出靜音，而它在最後一道 —— 症狀是
   * 整場突然全部沒聲音。
   */
  let limiter: AudioWorkletNode | null = null
  void ctx.audioWorklet?.addModule(assetUrl('/audio/limiter.js')).then(() => {
    const node = new AudioWorkletNode(ctx, 'limiter')
    node.onprocessorerror = () => {
      limiter = null
      fade.disconnect()
      node.disconnect()
      fade.connect(ctx.destination)
    }
    fade.disconnect()
    fade.connect(node)
    node.connect(ctx.destination)
    limiter = node
  }).catch(() => { limiter = null })
  /** 清掉預看緩衝裡那幾毫秒 —— 它們是乘過舊淡入增益的樣本 */
  function resetLimiter(): void {
    limiter?.port.postMessage('reset')
  }
  const fadeCurve = fadeInCurve(FADE_POINTS)
  const root = new Object3D()
  root.name = 'audio'
  scene.add(root)

  const buffers = new Map<string, AudioBuffer>()
  const makeup = new Map<string, number>()
  const lastPick: Partial<Record<Pool, number>> = {}
  let loading: Promise<void> | null = null
  /** 載入進度：已載完的檔數與總數。總數在清單到手之前是 0 */
  let filesDone = 0
  let fileTotal = 0
  let onProgress: ((done: number, total: number) => void) | null = null
  let unlocked = false
  let muted = false
  let paused = false
  let timeScale = 1
  /**
   * 選單按鈕專用的 context。**不能與世界共用** —— 暫停時主 context 整個
   * suspend（連排程中的聲音一起凍住，那是刻意的），而暫停選單上那幾顆按鈕
   * 是當下唯一按得到的東西。
   *
   * 【第一次要用才建】一載入就建的話，瀏覽器會記一個沒有手勢就開的 context
   * 並在主控台留警告。解碼好的 AudioBuffer 不綁 context，可以直接拿來用。
   */
  let uiCtx: AudioContext | null = null
  let uiGain: GainNode | null = null
  /** 主音量，dB；null = 關閉。UI 那一條自己乘，它不走 `AudioListener` */
  let masterDb: number | null = 0
  /** 上一次挑聲道時有幾個是空的。疊第二層之前看它 */
  let lastFreeVoices = ONE_SHOT_VOICES

  function lowpass(): BiquadFilterNode {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = 0.7
    f.frequency.value = FULL_BAND
    return f
  }

  /**
   * 定位的聲道。**兩級低通串接**（24 dB/八度）—— 真實的空氣吸收在高頻掉得很陡
   * （1 km 外的 8 kHz 掉 78 dB），一級只有 12 dB/八度，遠處的爆炸還會留著脆度。
   */
  function positional(): { audio: PositionalAudio; filters: BiquadFilterNode[] } {
    const audio = new PositionalAudio(listener)
    audio.panner.panningModel = 'equalpower'
    audio.setDistanceModel('inverse')
    audio.setRolloffFactor(1)
    const filters = [lowpass(), lowpass()]
    audio.setFilters(filters)
    return { audio, filters }
  }

  /**
   * 把聲源座標直接寫進 panner。**每次開始播之前都要做。**
   *
   * 【three 只在播放中同步位置】`PositionalAudio.updateMatrixWorld` 在
   * `isPlaying === false` 時直接返回，所以等音波的期間 panner 停在上一個聲音那裡；
   * 而它同步時是用一幀長度的漸變，起音那一下會從舊位置滑過來 —— 方向與距離都錯。
   */
  function placePanner(v: Voice): void {
    // 定位的掛在 root（原點、無旋轉），區域座標就是世界座標；不定位的掛在鏡頭上
    const p = v.positioned ? v.audio.position : camera.position
    const q = v.audio.panner
    const now = ctx.currentTime
    if (q.positionX !== undefined) {
      q.positionX.cancelScheduledValues(now)
      q.positionY.cancelScheduledValues(now)
      q.positionZ.cancelScheduledValues(now)
      q.positionX.setValueAtTime(p.x, now)
      q.positionY.setValueAtTime(p.y, now)
      q.positionZ.setValueAtTime(p.z, now)
    } else {
      q.setPosition(p.x, p.y, p.z)
    }
  }

  function setCutoff(filters: BiquadFilterNode[], hz: number, now: number, ramp: number): void {
    for (const f of filters) {
      if (ramp > 0) f.frequency.setTargetAtTime(hz, now, ramp)
      else f.frequency.setValueAtTime(hz, now)
    }
  }

  const voices: Voice[] = []
  for (let i = 0; i < ONE_SHOT_VOICES; i++) {
    const v = positional()
    root.add(v.audio)
    voices.push({
      ...v, cat: null, distance: 0, baseDb: 0, positioned: false, ref: 0, rolloff: 1, loudness: -Infinity,
      waitingSince: -1, waitDelay: 0, waitRate: 1, waitMax: 0, maxCutoff: FULL_BAND,
    })
  }

  const loops: Record<LoopPool, LoopVoice[]> = { engine: [], fire: [], turret: [] }
  for (const pool of Object.keys(LOOP_VOICES) as LoopPool[]) {
    for (let i = 0; i < LOOP_VOICES[pool]; i++) {
      const v = positional()
      v.audio.setLoop(true)
      root.add(v.audio)
      loops[pool].push({ ...v, key: -1, file: '', assigned: false, releaseAt: -1 })
    }
  }

  const selves = {} as Record<SelfSlot, SelfVoice>
  for (const slot of ['engine', 'wind', 'warn'] as SelfSlot[]) {
    const audio = new Audio(listener)
    audio.setLoop(true)
    const filter = slot === 'wind' ? lowpass() : null
    if (filter !== null) audio.setFilter(filter)
    selves[slot] = { audio, filter, file: null, next: undefined, switchAt: 0, gain: 0 }
  }

  /**
   * 【排隊依序做】`resume()` 回來之前 `ctx.state` 還是 suspended —— 那時切走分頁，
   * 只看當下狀態的話會跳過 `suspend()`，等 `resume()` 完成聲音又出來。
   * 每一步都在前一步完成之後，重新看一次現在該停還是該播。
   */
  let runChain: Promise<void> = Promise.resolve()
  /** 上一次 `applyRunState` 決定的是播還是停 */
  let running = false
  function applyRunState(): void {
    // 【從停到播才淡入】已經在播時再叫一次 setPaused(false)，聲音不能被拉回 0。
    // suspend 中 `currentTime` 不走，排下去的曲線等 resume 之後才開始
    const run = unlocked && !muted && !paused
    // 【恢復前先清限幅器】它的預看緩衝在 `fade` 下游，裡面那幾毫秒是乘過舊
    // 淡入增益的樣本；不清的話恢復的一瞬間會先漏出去，聽起來是一個爆點
    if (run && !running) {
      resetLimiter()
      fadeIn(RESUME_FADE_IN)
    }
    running = run
    runChain = runChain.then(() => {
      const run = unlocked && !muted && !paused
      return run ? ctx.resume() : ctx.suspend()
    }).catch(() => {})
  }

  function fadeIn(seconds: number): void {
    const g = fade.gain
    const now = ctx.currentTime
    // 【先清掉還沒走完的那一段】曲線與曲線重疊時 setValueCurveAtTime 會丟例外
    g.cancelScheduledValues(now)
    try {
      g.setValueCurveAtTime(fadeCurve, now, seconds)
    } catch {
      // 排不進去就直接全開 —— 停在 0 的話整場都沒有聲音，而且不會報錯
      g.value = 1
    }
  }

  function gainOf(file: string, cat: Category, extraDb: number): number {
    return dbToGain(CATEGORY[cat].gainDb + (makeup.get(file) ?? 0) + extraDb)
  }

  /**
   * 選單按鈕：自己的 context、一條固定的增益、播完就丟。
   *
   * 【為什麼不共用聲道池】那個池的挑選會搶佔、會依距離算響度，而這一條既不
   * 定位也不該被戰場的聲音擠掉。按鈕一次只響一下，直接開一個來源最簡單。
   */
  function playUi(file: string, extraDb = 0): void {
    const buf = buffers.get(file)
    if (buf === undefined) return
    if (uiCtx === null) {
      uiCtx = new AudioContext()
      uiGain = uiCtx.createGain()
      uiGain.gain.value = masterDb === null ? 0 : dbToGain(masterDb)
      uiGain.connect(uiCtx.destination)
    }
    // 【每次都叫 resume】分頁切回來時瀏覽器會把它擱在 suspended
    void uiCtx.resume().catch(() => {})
    const src = uiCtx.createBufferSource()
    src.buffer = buf
    const g = uiCtx.createGain()
    g.gain.value = gainOf(file, 'ui', extraDb)
    src.connect(g).connect(uiGain!)
    src.start()
  }

  function camDistance(x: number, y: number, z: number): number {
    const p = camera.position
    return Math.hypot(x - p.x, y - p.y, z - p.z)
  }

  function playFile(file: string, cat: Category, x: number, y: number, z: number, positioned: boolean,
    extraDb = 0, extraDelay = 0, rateScale = 1, cutoffHz = FULL_BAND): void {
    const buffer = buffers.get(file)
    if (buffer === undefined || muted || ctx.state !== 'running') return
    const spec = CATEGORY[cat]
    const loc = positioned && spec.ref > 0
    const d = loc ? camDistance(x, y, z) : 0
    if (loc && d > spec.max) return

    // 空的聲道優先；沒有就搶最不響的那一個 —— 新的比它還小聲就不播。
    // 【比響度不比距離】一波投彈同時有幾十聲，只比距離的話遠處一聲呼嘯會卡住近處的爆炸
    const baseDb = CATEGORY[cat].gainDb + (makeup.get(file) ?? 0) + extraDb
    const loud = voiceLoudnessDb(baseDb, loc ? spec.ref : 0, d, spec.rolloff ?? 1)
    // 【配額滿了只能搶自己人】否則一類就能把整池吃光，見 `VOICE_QUOTA`
    const quota = VOICE_QUOTA[cat] ?? ONE_SHOT_VOICES
    let mine = 0
    for (const v of voices) {
      if (v.cat === cat && (v.audio.isPlaying || v.waitingSince >= 0)) mine++
    }
    const ownOnly = mine >= quota
    let pick: Voice | null = null
    let pickBusy = true
    let free = 0
    for (const v of voices) {
      // 【在等音波的也算佔著】它已經排好要響，被搶走就整個沒聲音
      if (!v.audio.isPlaying && v.waitingSince < 0) {
        free++
        if (!ownOnly && pickBusy) { pick = v; pickBusy = false }
        continue
      }
      if (ownOnly && v.cat !== cat) continue
      if (pick === null || !pickBusy) { if (pickBusy) pick = v; continue }
      if (v.loudness < pick.loudness) pick = v
    }
    if (pick === null || (pickBusy && pick.loudness >= loud)) return
    if (pick.audio.isPlaying) pick.audio.stop()
    pick.waitingSince = -1

    const a = pick.audio
    pick.cat = cat
    pick.distance = d
    pick.baseDb = baseDb
    pick.positioned = loc
    pick.ref = loc ? spec.ref : 0
    pick.rolloff = spec.rolloff ?? 1
    pick.loudness = loud
    pick.maxCutoff = cutoffHz
    lastFreeVoices = free
    if (loc) {
      if (a.parent !== root) root.add(a)
      a.position.set(x, y, z)
      a.setRefDistance(spec.ref)
      a.setRolloffFactor(spec.rolloff ?? 1)
      setCutoff(pick.filters, Math.min(distanceCutoffHz(d), cutoffHz), ctx.currentTime, 0)
    } else {
      // 【不定位的掛在鏡頭上】放在世界座標的話，鏡頭一秒飛走一兩百公尺，聲音就被丟在後面
      if (a.parent !== camera) camera.add(a)
      a.position.set(0, 0, 0)
      a.setRefDistance(1)
      a.setRolloffFactor(0)
      setCutoff(pick.filters, cutoffHz, ctx.currentTime, 0)
    }
    a.setBuffer(buffer)
    // 【直接設，不漸變】setVolume 會從上一個聲音的音量爬 10 ms，爆炸、命中的起音會被削掉
    a.gain.gain.cancelScheduledValues(ctx.currentTime)
    a.gain.gain.setValueAtTime(dbToGain(baseDb + (loc ? absorptionDb(d) : 0)), ctx.currentTime)
    const rate = randomRate(Math.random) * rateScale
    a.setPlaybackRate(rate * timeScale)
    // 【定位的先等音波】`start()` 排下去就改不了了，等待期間要能依鏡頭移動提前或延後
    if (loc && d > 0) {
      pick.waitingSince = ctx.currentTime
      pick.waitDelay = extraDelay
      pick.waitRate = rate
      pick.waitMax = spec.max
    } else {
      placePanner(pick)
      a.play(extraDelay)
    }
  }

  function playPool(pool: Pool, cat: Category, x: number, y: number, z: number, positioned: boolean,
    extraDb = 0, layered = false, rate = 1, cutoffHz = FULL_BAND): void {
    const members = POOLS[pool]
    const k = pickNoRepeat(members.length, lastPick[pool] ?? -1, Math.random)
    lastPick[pool] = k
    playFile(members[k]!, cat, x, y, z, positioned, extraDb, 0, rate, cutoffHz)
    if (!layered || members.length < 2 || lastFreeVoices < LAYER_MIN_FREE) return
    const k2 = pickNoRepeat(members.length, k, Math.random)
    playFile(members[k2]!, cat, x, y, z, positioned, extraDb + LAYER_DB, layerDelay(Math.random), rate, cutoffHz)
  }

  function selfLoop(slot: SelfSlot, file: string | null, rate: number, gainDb: number, cutoffHz?: number): void {
    const s = selves[slot]
    const now = ctx.currentTime
    const target = file !== null && buffers.has(file) && !muted ? file : null
    s.gain = target === null ? 0 : gainOf(target, SELF_CATEGORY[slot], gainDb)

    // 【換檔中目標又變了】回到原本那個就取消換檔；換成別的就改目標 ——
    // 不改的話會先播一下已經過時的那一個，再淡出換一次
    if (s.next !== undefined && target !== s.next) {
      if (target === s.file) s.next = undefined
      else s.next = target
    }
    // 【換檔：淡出 → 換 buffer → 淡入】一個 Audio 同時只能播一個來源，做不了交叉淡化
    if (target !== s.file && s.next === undefined) {
      if (s.audio.isPlaying) {
        s.next = target
        s.switchAt = now + SELF_FADE
        s.audio.gain.gain.setTargetAtTime(0, now, SELF_FADE / 3)
      } else {
        s.file = target
        if (target !== null) {
          s.audio.setBuffer(buffers.get(target)!)
          s.audio.gain.gain.setValueAtTime(0, now)
          s.audio.play()
        }
      }
    }
    if (s.next !== undefined && now >= s.switchAt) {
      s.audio.stop()
      s.file = s.next
      s.next = undefined
      if (s.file !== null) {
        s.audio.setBuffer(buffers.get(s.file)!)
        s.audio.play()
      }
    }
    if (s.audio.isPlaying) {
      if (s.next === undefined) s.audio.gain.gain.setTargetAtTime(s.gain, now, 0.05)
      s.audio.setPlaybackRate(rate * timeScale)
      s.filter?.frequency.setTargetAtTime(cutoffHz ?? FULL_BAND, now, 0.05)
    }
  }

  /**
   * 播放中的定位單次音效：依現在的距離重算低通與空氣吸收。
   *
   * 【為什麼不能只在起播時算一次】爆炸、呼嘯都有兩三秒，那段時間玩家可能已經
   * 俯衝進去了 —— 凍住的話會聽到近在眼前卻悶悶的爆炸，而且怎麼靠近都不會變清晰。
   */
  function updateVoices(): void {
    const now = ctx.currentTime
    for (const v of voices) {
      if (!v.positioned || (!v.audio.isPlaying && v.waitingSince < 0)) continue
      const p = v.audio.position
      const d = camDistance(p.x, p.y, p.z)
      v.distance = d
      v.loudness = voiceLoudnessDb(v.baseDb, v.ref, d, v.rolloff)
      setCutoff(v.filters, Math.min(distanceCutoffHz(d), v.maxCutoff), now, 0.05)
      v.audio.gain.gain.setTargetAtTime(dbToGain(v.baseDb + absorptionDb(d)), now, 0.05)
      if (v.waitingSince < 0) continue
      // 【飛出可聽範圍就放棄】鏡頭切換會讓距離瞬間跳掉，不放棄的話那個聲道會一直卡著
      if (d > v.waitMax) { v.waitingSince = -1; continue }
      if (!soundArrived(now - v.waitingSince, d)) continue
      v.waitingSince = -1
      v.audio.setPlaybackRate(v.waitRate * timeScale)
      placePanner(v)
      v.audio.play(v.waitDelay)
    }
  }

  function beginFrame(): void {
    updateVoices()
    for (const pool of Object.keys(loops) as LoopPool[]) for (const v of loops[pool]) v.assigned = false
  }

  function assign(pool: LoopPool, key: number, file: string, x: number, y: number, z: number, rate: number): void {
    const buffer = buffers.get(file)
    if (buffer === undefined || muted) return
    const cat = LOOP_CATEGORY[pool]
    const d = camDistance(x, y, z)
    // 【超過上限就不指派】這一幀沒被指派的，`endFrame` 會淡出放掉
    if (d > CATEGORY[cat].max) return
    const list = loops[pool]
    let v = list.find((l) => l.key === key)
    if (v === undefined) {
      v = list.find((l) => l.key === -1)
      if (v === undefined) return
      v.key = key
      v.file = ''
    }
    const now = ctx.currentTime
    v.assigned = true
    v.releaseAt = -1
    v.audio.position.set(x, y, z)
    v.audio.setRefDistance(CATEGORY[cat].ref)
    setCutoff(v.filters, distanceCutoffHz(d), now, 0.1)
    if (v.file !== file) {
      if (v.audio.isPlaying) v.audio.stop()
      v.file = file
      v.audio.setBuffer(buffer)
      v.audio.gain.gain.setValueAtTime(0, now)
      // 【從隨機位置開始】同一種飛機好幾架一起飛時，引擎聲才不會完全同步
      v.audio.offset = Math.random() * buffer.duration * 0.9
      v.audio.play()
    }
    v.audio.gain.gain.setTargetAtTime(gainOf(file, cat, absorptionDb(d)), now, 0.1)
    v.audio.setPlaybackRate(rate * timeScale)
  }

  function endFrame(): void {
    const now = ctx.currentTime
    for (const pool of Object.keys(loops) as LoopPool[]) {
      for (const v of loops[pool]) {
        if (v.key === -1 || v.assigned) continue
        if (v.releaseAt < 0) {
          v.releaseAt = now + LOOP_FADE
          v.audio.gain.gain.setTargetAtTime(0, now, LOOP_FADE / 3)
        } else if (now >= v.releaseAt) {
          if (v.audio.isPlaying) v.audio.stop()
          v.key = -1
          v.file = ''
          v.releaseAt = -1
        }
      }
    }
  }

  function stopAll(): void {
    for (const v of voices) {
      if (v.audio.isPlaying) v.audio.stop()
      v.waitingSince = -1
    }
    for (const pool of Object.keys(loops) as LoopPool[]) {
      for (const v of loops[pool]) {
        if (v.audio.isPlaying) v.audio.stop()
        v.key = -1
        v.file = ''
        v.releaseAt = -1
      }
    }
    for (const slot of Object.keys(selves) as SelfSlot[]) {
      const s = selves[slot]
      if (s.audio.isPlaying) s.audio.stop()
      s.file = null
      s.next = undefined
    }
    // 【換場也要清】停掉來源不等於清掉限幅器裡那幾毫秒
    resetLimiter()
  }

  async function loadAll(): Promise<void> {
    const res = await fetch(assetUrl('/audio/manifest.json'))
    const manifest = await res.json() as Record<string, { loop: boolean; makeupDb: number }>
    // 【選單的按鈕音插隊】見 `FIRST_FILES`。sort 是穩定的，其餘的順序不變
    const first = new Set<string>(FIRST_FILES)
    const ids = Object.keys(manifest)
      .sort((a, b) => Number(first.has(b)) - Number(first.has(a)))
    for (const id of ids) makeup.set(id, manifest[id]!.makeupDb)
    fileTotal = ids.length
    onProgress?.(filesDone, fileTotal)
    let next = 0
    // 【最多 6 個並行】全部同時開會把瀏覽器的連線數吃滿，模型那邊的下載就卡住
    async function worker(): Promise<void> {
      while (next < ids.length) {
        const id = ids[next++]!
        try {
          const r = await fetch(assetUrl(`/audio/${id}.mp3`))
          buffers.set(id, await ctx.decodeAudioData(await r.arrayBuffer()))
        } catch (e) {
          console.warn(`音效載入失敗：${id}`, e)
        }
        // 【失敗的也要推一格】否則少一支檔，進度條就永遠停在 99%
        filesDone++
        onProgress?.(filesDone, fileTotal)
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
  }

  return {
    async load(cb) {
      // 【中途接上也要先報一次】開場已經在背景下載，進戰鬥才掛上載入畫面 ——
      // 不先報的話，進度條要等下一支檔載完才動，已經載完時則永遠不動
      if (cb !== undefined) {
        onProgress = cb
        if (fileTotal > 0) cb(filesDone, fileTotal)
      }
      loading ??= loadAll().catch((e) => { console.warn('音效清單載入失敗', e) })
      try {
        await loading
      } finally {
        if (onProgress === cb) onProgress = null
      }
    },
    unlock() {
      unlocked = true
      applyRunState()
    },
    setVolume(db) {
      // 【關閉就停掉所有聲音】只 suspend 的話，延遲中的遠方爆炸會凍在那裡，
      // 一分鐘後再打開音量才冒出來。循環聲下一幀由呼叫端依當下狀態重建
      if (db === null && !muted) stopAll()
      muted = db === null
      masterDb = db
      if (db !== null) listener.setMasterVolume(dbToGain(db))
      if (uiGain !== null) uiGain.gain.value = db === null ? 0 : dbToGain(db)
      applyRunState()
    },
    setPaused(p) {
      paused = p
      applyRunState()
    },
    setTimeScale(s) {
      timeScale = s
    },
    fadeIn,
    playPool,
    playFile,
    playUi,
    selfLoop,
    beginFrame,
    assign,
    endFrame,
    stopAll,
  }
}
