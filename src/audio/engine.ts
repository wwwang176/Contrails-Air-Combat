import { AudioListener, Vector3, type Camera } from 'three'
import { PannedAudio } from './spatial'
import { azimuthDeg, equalPowerMatrix, inverseDistanceGain, type ListenerPose } from './pan'
import { createAudioOutput } from './output'
import { CATEGORY, POOLS, type Category, type Pool } from './catalog'
import { createAudioAssets } from './assets'
import { createUiAudio } from './uiAudio'
import { createSelfAudio, type SelfSlot } from './selfAudio'
import { absorptionDb, dbToGain, distanceCutoffHz, soundArrived, voiceLoudnessDb } from './curves'
import {
  HDR_ABS_FLOOR_DB, HDR_EXEMPT, envelopeAt, hdrDuckDb, hdrFloorDb, stepLoudest,
} from './dynamics'
import { audioLag, type MeterSample } from './meter'
import { MIX_HEADROOM_DB } from './volume'
import {
  DECORRELATE_WINDOW, LAYER_DB, decorrelateDelay, layerDelay, pickNoRepeat, randomRate,
} from './pick'

/**
 * # 音訊播放引擎
 *
 * - **單次音效**：一個聲道池，全部是 `PannedAudio`（左右自己算，見 `spatial.ts`）。
 *   要定位的放在世界座標；不定位的（自己身上的聲音）永遠在正中間。池滿丟最不響的。
 * - **定位循環**：引擎 8、開火 6、砲塔 6、警笛 4 個聲道。每一幀 `beginFrame` → 逐一 `assign`
 *   → `endFrame`；這一幀沒被指派的淡出後放掉。
 * - **自己的循環**：引擎、風切、警告、警笛各一個 `Audio`，不定位。
 * - **距離**：定位的聲音接兩級低通（遠處只剩低頻）並依距離再減一點音量
 *   （空氣吸收，見 `curves.ts` 的 `absorptionDb`）；單次音效要等音波傳到才開始播。
 *   等待中與播放中都是每一幀用當下的距離重算 —— 遠方的爆炸要好幾秒才傳到、
 *   聲音本身又有好幾秒，這期間聽者會飛掉好幾百公尺。
 * - **聽者**：位置是 `ear`（戰鬥中是自機），朝向是鏡頭。第三人稱轉頭只改左右聲道，
 *   距離、音波延遲、都卜勒都不跟著鏡頭繞機身晃。
 *
 * 【暫停與音量關閉是兩個旗標】任一個成立就 suspend；兩個都不成立、而且使用者
 * 已經有過手勢，才 resume。只看一個的話，暫停中切音量會把聲音叫醒。
 */

export type { SelfSlot } from './selfAudio'
export type LoopPool = 'engine' | 'fire' | 'turret' | 'siren'

export interface AudioEngine {
  /**
   * 下載並解碼全部音效。重複呼叫共用同一批載入工作；失敗的檔案略過。
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
   * 走自己的 AudioContext（見 `uiAudio.ts`），所以不受主 context 的 suspend 影響。
   */
  playUi(file: string, extraDb?: number): void
  /** 自己身上的循環。file 為 null 表示停。每一幀都呼叫 */
  selfLoop(slot: SelfSlot, file: string | null, rate: number, gainDb: number, cutoffHz?: number): void
  beginFrame(): void
  /**
   * key 是 combatant 的 index；同一個 key 會拿回同一個聲道。
   * `gainDb` 是這一架自己的增益，疊在類別音量之上（預設 0）—— 音量隨狀態變的循環用（警笛隨空速）。
   * 它同時進 HDR 的響度估計；只改實際增益的話，一架很小聲的循環會被當成全音量，把別的聲音壓下去。
   */
  assign(pool: LoopPool, key: number, file: string, x: number, y: number, z: number, rate: number,
    gainDb?: number): void
  endFrame(): void
  /** 離開戰鬥：停掉所有聲音 */
  stopAll(): void
  /**
   * 現在的輸出峰值、限幅器壓了多少、HDR 的窗口與同時發聲數。**給錶用。**
   * 限幅器沒接上時壓縮量恆為 0。
   */
  meter(out: MeterSample): void
}

/**
 * 【要撐得住一波投彈】一組 B-17 齊投有幾十顆炸彈，每一顆有呼嘯與落地爆炸，
 * 爆炸又疊兩層，而爆炸聲長達兩三秒 —— 聲道不夠時後面的炸彈整個沒聲音。
 *
 * 【40 不夠】艦隊防空的關卡實測：120 秒裡艦砲要求 1,573 次、被擋掉 365 次，
 * 空聲道長時間掛在 0，連軍火爆炸也被擋掉 21/54。一個聲道是兩級低通加四個
 * 增益；沒在響的會拔掉出口（`PannedAudio.sleep`），不佔音訊執行緒。
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
 * 【爆炸也要有上限】它是天花板沒錯，但一波齊投幾十顆同時落地時，十幾份
 * 「+6 類別 ＋最多 +6 當量 ＋第二層」疊起來遠超過喇叭的上限，限幅器只好一次
 * 壓掉 8～10 dB —— 那個擠壓感就是玩家聽到的「爆音」。**多出來的那幾份本來
 * 也分不出來**：同一刻十顆與十五顆爆炸，人耳聽起來一樣。
 */
const VOICE_QUOTA: Partial<Record<Category, number>> = {
  cannon: 22, impact: 12, flyby: 8, whistle: 6, hitDealt: 6, splash: 8, flakBurst: 14,
  explosion: 8, blast: 8,
}
const LOOP_VOICES: Record<LoopPool, number> = { engine: 8, fire: 6, turret: 6, siren: 4 }
const LOOP_CATEGORY: Record<LoopPool, Category> = { engine: 'engine', fire: 'fire', turret: 'turret', siren: 'siren' }
const LOOP_FADE = 0.3
const FULL_BAND = 22000
/** 左右矩陣逐幀平滑的時間常數，s。約一幀：快速掠過的飛機不會一格一格跳 */
const PAN_SMOOTH = 0.02
/** 聽者朝向的暫存 */
const _axis = new Vector3()
/** 截止頻率變動小於這個比例就不重排（約半個全音，聽不出來） */
const CUTOFF_STEP = 0.03
/** 暫停、切分頁、關音量之後恢復的淡入，s */
const RESUME_FADE_IN = 0.8
/** 讀錶間隔超過這個秒數就重新對齊兩個時鐘 —— 分頁在背景時畫面不跑 */
const LAG_REANCHOR = 0.5

interface Voice {
  audio: PannedAudio
  /** 這一聲屬於哪一類。配額與 HDR 用 */
  cat: Category | null
  /** 這一份的素材包絡（`manifest.json` 的 `envelopeDb`）與開始播的時刻 */
  envelope: readonly number[] | undefined
  startedAt: number
  filters: BiquadFilterNode[]
  /** 離聽者多遠；不定位的是 0 */
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
  /** 上一次排下去的截止頻率，Hz。見 `setCutoff` */
  cutoff: number
}

interface LoopVoice {
  audio: PannedAudio
  filters: BiquadFilterNode[]
  key: number
  file: string
  assigned: boolean
  /** 淡出中：到這個時間（context 秒）就停掉放掉。−1 = 沒在淡出 */
  releaseAt: number
  /** 上一次排下去的截止頻率，Hz。見 `setCutoff` */
  cutoff: number
  /** 這一架自己的增益，dB（`assign` 的 `gainDb`）。HDR 的峰值估計要用 */
  extraDb: number
}

/**
 * @param ear 聽者的**位置**（距離、衰減、音波延遲都量到這裡）。朝向一律讀鏡頭 ——
 *   左右聲道看的是玩家面對哪裡。戰鬥中由 `battleAudioController` 每幀寫成自機的位置，
 *   第三人稱鏡頭轉頭時只換耳朵的方向、不搬耳朵。省略時就是鏡頭的位置
 */
export function createAudioEngine(camera: Camera, ear: Vector3 = camera.position): AudioEngine {
  // 只用 listener 的 context 與主音量，不掛進場景；方位由 readPose 直接讀相機與 `ear`。
  // 避免相機更新時觸發 AudioListener 的九條位置漸變，聲道並沒有 PannerNode 需要它們。
  const listener = new AudioListener()
  const ctx = listener.context
  const output = createAudioOutput(ctx, listener.gain)
  const { fadeIn, resetLimiter } = output
  /**
   * 試聽用的開關：在主控台打 `__audioMix({ limiter: false })` 可以當場拆掉
   * 限幅器、`{ hdr: false }` 關掉動態窗口，比對某個怪聲是哪一層造成的。
   *
   * 【為什麼留在正式程式裡】這兩層都是聽感的東西，而聽感只能靠人耳裁定。
   * 沒有開關的話，每次懷疑都要改程式重載一次。與 `__gfx`、`__bombs` 同一類。
   */
  ;(globalThis as unknown as Record<string, unknown>)['__audioMix'] = (
    opt?: { limiter?: boolean; hdr?: boolean },
  ) => {
    if (opt?.limiter === false) output.bypassLimiter()
    if (opt?.hdr !== undefined) hdrOn = opt.hdr
    return { limiter: output.limiterEnabled, hdr: hdrOn }
  }

  /** 這一刻的聽者：耳朵（`ear`）的位置與鏡頭的朝向。定位聲道的左右由它算 */
  const pose: ListenerPose = { px: 0, py: 0, pz: 0, fx: 0, fy: 0, fz: -1, ux: 0, uy: 1, uz: 0 }
  /** 左右矩陣的暫存，逐幀重用 */
  const panOut = new Float32Array(4)

  const { buffers, makeup, envelopes, load } = createAudioAssets(ctx)
  const uiAudio = createUiAudio(buffers, makeup)
  /**
   * 每個檔上一次發聲的時刻。**同檔去相關用** —— 同時播兩份是完全同相、
   * 直接 +6 dB，所以窗內的第二份錯開幾毫秒再出來（`decorrelateDelay`）。
   */
  const lastPlayed = new Map<string, number>()
  /**
   * HDR 的當下最響值，dB。**立即跟上新的峰值、慢慢釋放** —— 見 `dynamics.ts`。
   * 暫停與切分頁保留（場面沒變），`stopAll` 歸零（上一場的窗口不帶進新的一場）。
   */
  let loudest = HDR_ABS_FLOOR_DB
  /** 動態窗口開著沒有。試聽用，見 `__audioMix` */
  let hdrOn = true
  /** 累計把還在響的聲音直接切掉幾次。給錶用 */
  let cuts = 0
  /** 音訊時鐘落後量的起算點（牆上時鐘、音訊時鐘，秒）與上一次讀錶的牆上時間 */
  let lagWall = 0
  let lagCtx = 0
  let lagReadAt = -Infinity
  const lastPick: Partial<Record<Pool, number>> = {}
  let unlocked = false
  const playback = { muted: false, timeScale: 1 }
  let paused = false
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
  function positional(): { audio: PannedAudio; filters: BiquadFilterNode[] } {
    const audio = new PannedAudio(listener)
    const filters = [lowpass(), lowpass()]
    audio.setFilters(filters)
    return { audio, filters }
  }

  /** 耳朵的位置與鏡頭的朝向寫進 `pose`。鏡頭在場景最上層，區域座標就是世界座標 */
  function readPose(): void {
    const p = ear
    pose.px = p.x
    pose.py = p.y
    pose.pz = p.z
    _axis.set(0, 0, -1).applyQuaternion(camera.quaternion)
    pose.fx = _axis.x
    pose.fy = _axis.y
    pose.fz = _axis.z
    _axis.set(0, 1, 0).applyQuaternion(camera.quaternion)
    pose.ux = _axis.x
    pose.uy = _axis.y
    pose.uz = _axis.z
  }

  /**
   * 算左右矩陣並套上。不定位的在正中間、不衰減。聲源座標就是 `audio.position`。
   * `smooth` 0 = 立刻到位 —— **每次開始播之前都要這樣叫一次**，否則起音那一下
   * 還是上一個聲音的方向與距離。
   */
  function pan(a: PannedAudio, positioned: boolean, distance: number, ref: number, rolloff: number,
    now: number, smooth: number): void {
    const p = a.position
    const az = positioned ? azimuthDeg(p.x, p.y, p.z, pose) : 0
    const g = positioned ? inverseDistanceGain(distance, ref, rolloff) : 1
    equalPowerMatrix(az, a.stereo, g, panOut)
    a.setPan(panOut, now, smooth)
  }

  function panVoice(v: Voice, now: number, smooth: number): void {
    pan(v.audio, v.positioned, v.distance, v.ref, v.rolloff, now, smooth)
  }

  /**
   * 排截止頻率。`ramp` 為 0 是立刻設（起播），否則只在變動超過 `CUTOFF_STEP`
   * 才重排 —— 距離每幀都在變，照排的話兩級低通一直有排程，Chrome 就一直走
   * 逐取樣重算係數的路徑。
   */
  function setCutoff(v: { filters: BiquadFilterNode[]; cutoff: number }, hz: number, now: number, ramp: number): void {
    if (ramp > 0 && Math.abs(hz - v.cutoff) <= v.cutoff * CUTOFF_STEP) return
    v.cutoff = hz
    for (const f of v.filters) {
      if (ramp > 0) f.frequency.setTargetAtTime(hz, now, ramp)
      else f.frequency.setValueAtTime(hz, now)
    }
  }

  const voices: Voice[] = []
  for (let i = 0; i < ONE_SHOT_VOICES; i++) {
    const v = positional()
    voices.push({
      ...v, cat: null, envelope: undefined, startedAt: 0,
      distance: 0, baseDb: 0, positioned: false, ref: 0, rolloff: 1, loudness: -Infinity,
      waitingSince: -1, waitDelay: 0, waitRate: 1, waitMax: 0, maxCutoff: FULL_BAND, cutoff: FULL_BAND,
    })
  }

  const loops: Record<LoopPool, LoopVoice[]> = { engine: [], fire: [], turret: [], siren: [] }
  for (const pool of Object.keys(LOOP_VOICES) as LoopPool[]) {
    for (let i = 0; i < LOOP_VOICES[pool]; i++) {
      const v = positional()
      v.audio.setLoop(true)
      loops[pool].push({ ...v, key: -1, file: '', assigned: false, releaseAt: -1, cutoff: FULL_BAND, extraDb: 0 })
    }
  }

  const selfAudio = createSelfAudio(listener, buffers, makeup, playback, lowpass)

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
    const run = unlocked && !playback.muted && !paused
    // 【恢復前先清限幅器】它的預看緩衝在 `fade` 下游，裡面那幾毫秒是乘過舊
    // 淡入增益的樣本；不清的話恢復的一瞬間會先漏出去，聽起來是一個爆點
    if (run && !running) {
      resetLimiter()
      fadeIn(RESUME_FADE_IN)
    }
    running = run
    runChain = runChain.then(() => {
      const run = unlocked && !playback.muted && !paused
      return run ? ctx.resume() : ctx.suspend()
    }).catch(() => {})
  }

  function gainOf(file: string, cat: Category, extraDb: number): number {
    return dbToGain(CATEGORY[cat].gainDb + (makeup.get(file) ?? 0) + extraDb)
  }

  function camDistance(x: number, y: number, z: number): number {
    return Math.hypot(x - ear.x, y - ear.y, z - ear.z)
  }

  function playFile(file: string, cat: Category, x: number, y: number, z: number, positioned: boolean,
    extraDb = 0, extraDelay = 0, rateScale = 1, cutoffHz = FULL_BAND): void {
    const buffer = buffers.get(file)
    if (buffer === undefined || playback.muted || ctx.state !== 'running') return
    const spec = CATEGORY[cat]
    const loc = positioned && spec.ref > 0
    const d = loc ? camDistance(x, y, z) : 0
    if (loc && d > spec.max) return

    // 空的聲道優先；沒有就搶最不響的那一個 —— 新的比它還小聲就不播。
    // 【比響度不比距離】一波投彈同時有幾十聲，只比距離的話遠處一聲呼嘯會卡住近處的爆炸
    const baseDb = CATEGORY[cat].gainDb + (makeup.get(file) ?? 0) + extraDb
    const loud = voiceLoudnessDb(baseDb, loc ? spec.ref : 0, d, spec.rolloff ?? 1)
    // 【HDR：太小聲的根本不發】保底類別不吃窗口（警告、無線電、自己的聲音）
    const exempt = !hdrOn || HDR_EXEMPT.has(cat)
    if (!exempt && loud < hdrFloorDb(loudest)) return
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
    if (pick.audio.isPlaying) {
      pick.audio.stop()
      cuts++
    }
    pick.waitingSince = -1

    const a = pick.audio
    pick.cat = cat
    pick.envelope = envelopes.get(file)
    pick.startedAt = ctx.currentTime
    pick.distance = d
    pick.baseDb = baseDb
    pick.positioned = loc
    pick.ref = loc ? spec.ref : 0
    pick.rolloff = spec.rolloff ?? 1
    pick.loudness = loud
    pick.maxCutoff = cutoffHz
    lastFreeVoices = free
    // 【不定位的永遠在正中間】它跟著聽者走，不看座標
    if (loc) a.position.set(x, y, z)
    setCutoff(pick, loc ? Math.min(distanceCutoffHz(d), cutoffHz) : cutoffHz, ctx.currentTime, 0)
    a.setBuffer(buffer)
    // 【直接設，不漸變】setVolume 會從上一個聲音的音量爬 10 ms，爆炸、命中的起音會被削掉
    a.gain.gain.cancelScheduledValues(ctx.currentTime)
    a.gain.gain.setValueAtTime(
      dbToGain(baseDb + (loc ? absorptionDb(d) : 0) + (exempt ? 0 : hdrDuckDb(loud, loudest))),
      ctx.currentTime)
    // 【同檔錯開】窗內再播同一個檔就延後幾毫秒。**不動起始位置** ——
    // 跳掉開頭會裁掉起音（`hit-1` 的峰值就在前 15 ms 裡）
    const since = ctx.currentTime - (lastPlayed.get(file) ?? -Infinity)
    const delay = extraDelay + (since < DECORRELATE_WINDOW ? decorrelateDelay(Math.random) : 0)
    lastPlayed.set(file, ctx.currentTime)
    const rate = randomRate(Math.random) * rateScale
    a.setPlaybackRate(rate * playback.timeScale)
    // 【定位的先等音波】`start()` 排下去就改不了了，等待期間要能依聽者移動提前或延後
    if (loc && d > 0) {
      pick.waitingSince = ctx.currentTime
      pick.waitDelay = delay
      pick.waitRate = rate
      pick.waitMax = spec.max
    } else {
      panVoice(pick, ctx.currentTime, 0)
      a.play(delay)
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

  /**
   * 播放中的定位單次音效：依現在的距離重算低通與空氣吸收。
   *
   * 【為什麼不能只在起播時算一次】爆炸、呼嘯都有兩三秒，那段時間玩家可能已經
   * 俯衝進去了 —— 凍住的話會聽到近在眼前卻悶悶的爆炸，而且怎麼靠近都不會變清晰。
   */
  /**
   * 這一幀的即時峰值：每個還在響的聲音，響度加上素材包絡的那一格。
   *
   * 【一定要含包絡】只看類別增益與距離的話，一顆七秒的爆炸從頭到尾都被當成
   * 一樣響，窗口會被它頂住七秒 —— 背景要等檔案播完才回得來。
   */
  function framePeak(now: number): number {
    let peak = HDR_ABS_FLOOR_DB
    for (const v of voices) {
      if (!v.audio.isPlaying || v.cat === null || HDR_EXEMPT.has(v.cat)) continue
      const live = v.loudness + envelopeAt(v.envelope, now - v.startedAt)
      if (live > peak) peak = live
    }
    for (const pool of Object.keys(loops) as LoopPool[]) {
      const cat = LOOP_CATEGORY[pool]
      if (HDR_EXEMPT.has(cat)) continue
      for (const v of loops[pool]) {
        if (v.key === -1 || !v.audio.isPlaying) continue
        const p = v.audio.position
        const d = camDistance(p.x, p.y, p.z)
        const spec = CATEGORY[cat]
        const live = voiceLoudnessDb(
          spec.gainDb + (makeup.get(v.file) ?? 0) + v.extraDb, spec.ref, d, spec.rolloff ?? 1)
        if (live > peak) peak = live
      }
    }
    return peak
  }

  function updateVoices(dt: number): void {
    const now = ctx.currentTime
    loudest = stepLoudest(loudest, framePeak(now), dt)
    for (const v of voices) {
      // 【播完的拔掉出口】見 `PannedAudio.wake`
      if (!v.audio.isPlaying && v.waitingSince < 0) {
        v.audio.sleep()
        continue
      }
      if (!v.positioned) continue
      const p = v.audio.position
      const d = camDistance(p.x, p.y, p.z)
      v.distance = d
      v.loudness = voiceLoudnessDb(v.baseDb, v.ref, d, v.rolloff)
      setCutoff(v, Math.min(distanceCutoffHz(d), v.maxCutoff), now, 0.05)
      // 【HDR 的衰減逐幀重算】聽者移動與素材衰減都會讓它變
      const live = v.loudness + envelopeAt(v.envelope, now - v.startedAt)
      const duck = !hdrOn || (v.cat !== null && HDR_EXEMPT.has(v.cat)) ? 0 : hdrDuckDb(live, loudest)
      v.audio.gain.gain.setTargetAtTime(dbToGain(v.baseDb + absorptionDb(d) + duck), now, 0.05)
      if (v.waitingSince < 0) {
        panVoice(v, now, PAN_SMOOTH)
        continue
      }
      // 【飛出可聽範圍就放棄】切上帝視角會讓距離瞬間跳掉，不放棄的話那個聲道會一直卡著
      if (d > v.waitMax) { v.waitingSince = -1; continue }
      if (!soundArrived(now - v.waitingSince, d)) continue
      v.waitingSince = -1
      v.audio.setPlaybackRate(v.waitRate * playback.timeScale)
      panVoice(v, now, 0)
      v.audio.play(v.waitDelay)
    }
  }

  /** 上一次 `beginFrame` 的 context 時間，算 HDR 的釋放用。−1 = 還沒跑過 */
  let lastFrameAt = -1

  function beginFrame(): void {
    const now = ctx.currentTime
    const dt = lastFrameAt < 0 ? 0 : Math.max(0, now - lastFrameAt)
    lastFrameAt = now
    readPose()
    updateVoices(dt)
    for (const pool of Object.keys(loops) as LoopPool[]) for (const v of loops[pool]) v.assigned = false
  }

  function assign(pool: LoopPool, key: number, file: string, x: number, y: number, z: number, rate: number,
    gainDb = 0): void {
    const buffer = buffers.get(file)
    if (buffer === undefined || playback.muted) return
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
    v.extraDb = gainDb
    v.audio.position.set(x, y, z)
    setCutoff(v, distanceCutoffHz(d), now, 0.1)
    const fresh = v.file !== file
    if (fresh) {
      if (v.audio.isPlaying) {
        v.audio.stop()
        cuts++
      }
      v.file = file
      v.audio.setBuffer(buffer)
      v.audio.gain.gain.setValueAtTime(0, now)
      // 【從隨機位置開始】同一種飛機好幾架一起飛時，引擎聲才不會完全同步
      v.audio.offset = Math.random() * buffer.duration * 0.9
      v.audio.play()
    }
    // 【循環音也吃 HDR】引擎在爆炸期間該退到背景，回來時照釋放速率浮上來
    const live = voiceLoudnessDb(
      CATEGORY[cat].gainDb + (makeup.get(file) ?? 0) + gainDb, CATEGORY[cat].ref, d, CATEGORY[cat].rolloff ?? 1)
    const duck = !hdrOn || HDR_EXEMPT.has(cat) ? 0 : hdrDuckDb(live, loudest)
    v.audio.gain.gain.setTargetAtTime(gainOf(file, cat, absorptionDb(d) + duck + gainDb), now, 0.1)
    v.audio.setPlaybackRate(rate * playback.timeScale)
    pan(v.audio, true, d, CATEGORY[cat].ref, CATEGORY[cat].rolloff ?? 1, now, fresh ? 0 : PAN_SMOOTH)
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
          v.audio.sleep()
          v.key = -1
          v.file = ''
          v.releaseAt = -1
        }
      }
    }
  }

  /**
   * 錶要的四個數字。輸出峰值用限幅器回報的輸入峰值乘上它當下的增益 ——
   * 那就是真的送到喇叭的東西。
   */
  function meter(out: MeterSample): void {
    output.readMeter(out)
    out.loudestDb = loudest
    let n = 0
    for (const v of voices) if (v.audio.isPlaying) n++
    out.voices = n
    out.cuts = cuts
    // 【兩個時鐘從同一刻起算】停過（暫停、切分頁）或太久沒讀就重新對齊 ——
    // 停著的時候音訊時鐘本來就不走，那不是算不完
    const wall = performance.now() / 1000
    if (ctx.state !== 'running' || wall - lagReadAt > LAG_REANCHOR) {
      lagWall = wall
      lagCtx = ctx.currentTime
    }
    lagReadAt = wall
    out.lagMs = audioLag(wall, ctx.currentTime, lagWall, lagCtx) * 1000
  }

  function stopAll(): void {
    for (const v of voices) {
      if (v.audio.isPlaying) v.audio.stop()
      v.audio.sleep()
      v.waitingSince = -1
    }
    for (const pool of Object.keys(loops) as LoopPool[]) {
      for (const v of loops[pool]) {
        if (v.audio.isPlaying) v.audio.stop()
        v.audio.sleep()
        v.key = -1
        v.file = ''
        v.releaseAt = -1
      }
    }
    selfAudio.stopAll()
    // 【換場也要清】停掉來源不等於清掉限幅器裡那幾毫秒
    resetLimiter()
    // 【HDR 的窗口不帶進下一場】上一場最後那顆炸彈的窗口會讓新場的開頭被壓掉
    loudest = HDR_ABS_FLOOR_DB
    lastFrameAt = -1
  }

  return {
    load,
    unlock() {
      unlocked = true
      applyRunState()
    },
    setVolume(db) {
      // 【關閉就停掉所有聲音】只 suspend 的話，延遲中的遠方爆炸會凍在那裡，
      // 一分鐘後再打開音量才冒出來。循環聲下一幀由呼叫端依當下狀態重建
      if (db === null && !playback.muted) stopAll()
      playback.muted = db === null
      // 【加上混音餘裕】設定頁的「高」是 0，但那是**使用者看到的滿音量**，
      // 不是 0 dBFS。見 `MIX_HEADROOM_DB`
      if (db !== null) listener.setMasterVolume(dbToGain(db + MIX_HEADROOM_DB))
      uiAudio.setVolume(db)
      applyRunState()
    },
    setPaused(p) {
      paused = p
      applyRunState()
    },
    setTimeScale(s) {
      playback.timeScale = s
    },
    fadeIn,
    playPool,
    playFile,
    playUi: uiAudio.play,
    selfLoop: selfAudio.selfLoop,
    beginFrame,
    assign,
    endFrame,
    stopAll,
    meter,
  }
}
