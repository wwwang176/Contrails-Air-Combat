import { Audio, AudioListener, Object3D, PositionalAudio, type Camera, type Scene } from 'three'
import { assetUrl } from '../core/asset'
import { CATEGORY, POOLS, type Category, type Pool } from './catalog'
import { dbToGain, distanceCutoffHz, soundDelay } from './curves'
import { pickNoRepeat, randomRate } from './pick'

/**
 * # 音訊引擎 —— 遊戲裡唯一碰 Web Audio 的地方
 *
 * - **單次音效**：一個 24 聲道的池，全部是 `PositionalAudio`。要定位的放在世界座標；
 *   不定位的（自己身上的聲音）掛在鏡頭上，跟著鏡頭走、永遠在正中間。池滿丟最遠的。
 * - **定位循環**：引擎 8、開火 6、砲塔 6 個聲道。每一幀 `beginFrame` → 逐一 `assign`
 *   → `endFrame`；這一幀沒被指派的淡出後放掉。
 * - **自己的循環**：引擎、開火、風切、警告各一個 `Audio`，不定位。
 * - **距離**：定位的聲音接一個低通濾波（遠處只剩低頻），單次音效再延後
 *   `距離 ÷ 音速` 才開始播。
 *
 * 【暫停與音量關閉是兩個旗標】任一個成立就 suspend；兩個都不成立、而且使用者
 * 已經有過手勢，才 resume。只看一個的話，暫停中切音量會把聲音叫醒。
 */

export type SelfSlot = 'engine' | 'fire' | 'wind' | 'warn'
export type LoopPool = 'engine' | 'fire' | 'turret'

export interface AudioEngine {
  /** 下載並解碼全部音效。重複呼叫回同一個 Promise；失敗的檔案略過 */
  load(): Promise<void>
  /** 在使用者手勢裡呼叫 —— 瀏覽器要手勢才肯出聲 */
  unlock(): void
  /** null 是關閉 */
  setVolume(db: number | null): void
  setPaused(paused: boolean): void
  /** 結算後的慢動作：所有播放速度乘上這個比例。呼叫端一律傳未縮放的速度 */
  setTimeScale(scale: number): void
  playPool(pool: Pool, cat: Category, x: number, y: number, z: number, positioned: boolean, extraDb?: number): void
  playFile(file: string, cat: Category, x: number, y: number, z: number, positioned: boolean, extraDb?: number): void
  /** 自己身上的循環。file 為 null 表示停。每一幀都呼叫 */
  selfLoop(slot: SelfSlot, file: string | null, rate: number, gainDb: number, cutoffHz?: number): void
  beginFrame(): void
  /** key 是 combatant 的 index；同一個 key 會拿回同一個聲道 */
  assign(pool: LoopPool, key: number, file: string, x: number, y: number, z: number, rate: number): void
  endFrame(): void
  /** 離開戰鬥：停掉所有聲音 */
  stopAll(): void
}

const ONE_SHOT_VOICES = 24
const LOOP_VOICES: Record<LoopPool, number> = { engine: 8, fire: 6, turret: 6 }
const LOOP_CATEGORY: Record<LoopPool, Category> = { engine: 'engine', fire: 'fire', turret: 'turret' }
const SELF_CATEGORY: Record<SelfSlot, Category> = { engine: 'engineSelf', fire: 'fireSelf', wind: 'wind', warn: 'warn' }
/** 換檔、停止時的淡出，s */
const SELF_FADE = 0.1
const LOOP_FADE = 0.3
const FULL_BAND = 22000

interface Voice {
  audio: PositionalAudio
  filter: BiquadFilterNode
  /** 開始播時離鏡頭多遠；不定位的是 0。池滿時丟最遠的 */
  distance: number
}

interface LoopVoice {
  audio: PositionalAudio
  filter: BiquadFilterNode
  key: number
  file: string
  assigned: boolean
  /** 淡出中：到這個時間（context 秒）就停掉放掉。−1 = 沒在淡出 */
  releaseAt: number
}

interface SelfVoice {
  audio: Audio
  filter: BiquadFilterNode
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
  const root = new Object3D()
  root.name = 'audio'
  scene.add(root)

  const buffers = new Map<string, AudioBuffer>()
  const makeup = new Map<string, number>()
  const lastPick: Partial<Record<Pool, number>> = {}
  let loading: Promise<void> | null = null
  let unlocked = false
  let muted = false
  let paused = false
  let timeScale = 1

  function lowpass(): BiquadFilterNode {
    const f = ctx.createBiquadFilter()
    f.type = 'lowpass'
    f.Q.value = 0.7
    f.frequency.value = FULL_BAND
    return f
  }

  function positional(): { audio: PositionalAudio; filter: BiquadFilterNode } {
    const audio = new PositionalAudio(listener)
    audio.panner.panningModel = 'equalpower'
    audio.setDistanceModel('inverse')
    audio.setRolloffFactor(1)
    const filter = lowpass()
    audio.setFilter(filter)
    return { audio, filter }
  }

  const voices: Voice[] = []
  for (let i = 0; i < ONE_SHOT_VOICES; i++) {
    const v = positional()
    root.add(v.audio)
    voices.push({ ...v, distance: 0 })
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
  for (const slot of ['engine', 'fire', 'wind', 'warn'] as SelfSlot[]) {
    const audio = new Audio(listener)
    audio.setLoop(true)
    const filter = lowpass()
    audio.setFilter(filter)
    selves[slot] = { audio, filter, file: null, next: undefined, switchAt: 0, gain: 0 }
  }

  function applyRunState(): void {
    const run = unlocked && !muted && !paused
    if (run && ctx.state !== 'running') void ctx.resume().catch(() => {})
    else if (!run && ctx.state === 'running') void ctx.suspend().catch(() => {})
  }

  function gainOf(file: string, cat: Category, extraDb: number): number {
    return dbToGain(CATEGORY[cat].gainDb + (makeup.get(file) ?? 0) + extraDb)
  }

  function camDistance(x: number, y: number, z: number): number {
    const p = camera.position
    return Math.hypot(x - p.x, y - p.y, z - p.z)
  }

  function playFile(file: string, cat: Category, x: number, y: number, z: number, positioned: boolean, extraDb = 0): void {
    const buffer = buffers.get(file)
    if (buffer === undefined || ctx.state !== 'running') return
    const spec = CATEGORY[cat]
    const loc = positioned && spec.ref > 0
    const d = loc ? camDistance(x, y, z) : 0
    if (loc && d > spec.max) return

    // 空的聲道優先；沒有就丟最遠的 —— 比新的這一個還近的話，新的不播
    let pick: Voice | null = null
    for (const v of voices) {
      if (!v.audio.isPlaying) { pick = v; break }
      if (pick === null || v.distance > pick.distance) pick = v
    }
    if (pick === null || (pick.audio.isPlaying && pick.distance <= d)) return
    if (pick.audio.isPlaying) pick.audio.stop()

    const a = pick.audio
    pick.distance = d
    if (loc) {
      if (a.parent !== root) root.add(a)
      a.position.set(x, y, z)
      a.setRefDistance(spec.ref)
      a.setRolloffFactor(1)
      pick.filter.frequency.setValueAtTime(distanceCutoffHz(d), ctx.currentTime)
    } else {
      // 【不定位的掛在鏡頭上】放在世界座標的話，鏡頭一秒飛走一兩百公尺，聲音就被丟在後面
      if (a.parent !== camera) camera.add(a)
      a.position.set(0, 0, 0)
      a.setRefDistance(1)
      a.setRolloffFactor(0)
      pick.filter.frequency.setValueAtTime(FULL_BAND, ctx.currentTime)
    }
    a.setBuffer(buffer)
    // 【直接設，不漸變】setVolume 會從上一個聲音的音量爬 10 ms，爆炸、命中的起音會被削掉
    a.gain.gain.cancelScheduledValues(ctx.currentTime)
    a.gain.gain.setValueAtTime(gainOf(file, cat, extraDb), ctx.currentTime)
    a.setPlaybackRate(randomRate(Math.random) * timeScale)
    a.play(loc ? soundDelay(d) : 0)
  }

  function playPool(pool: Pool, cat: Category, x: number, y: number, z: number, positioned: boolean, extraDb = 0): void {
    const members = POOLS[pool]
    const k = pickNoRepeat(members.length, lastPick[pool] ?? -1, Math.random)
    lastPick[pool] = k
    playFile(members[k]!, cat, x, y, z, positioned, extraDb)
  }

  function selfLoop(slot: SelfSlot, file: string | null, rate: number, gainDb: number, cutoffHz?: number): void {
    const s = selves[slot]
    const now = ctx.currentTime
    const target = file !== null && buffers.has(file) ? file : null
    s.gain = target === null ? 0 : gainOf(target, SELF_CATEGORY[slot], gainDb)

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
      s.filter.frequency.setTargetAtTime(cutoffHz ?? FULL_BAND, now, 0.05)
    }
  }

  function beginFrame(): void {
    for (const pool of Object.keys(loops) as LoopPool[]) for (const v of loops[pool]) v.assigned = false
  }

  function assign(pool: LoopPool, key: number, file: string, x: number, y: number, z: number, rate: number): void {
    const buffer = buffers.get(file)
    if (buffer === undefined) return
    const list = loops[pool]
    let v = list.find((l) => l.key === key)
    if (v === undefined) {
      v = list.find((l) => l.key === -1)
      if (v === undefined) return
      v.key = key
      v.file = ''
    }
    const now = ctx.currentTime
    const cat = LOOP_CATEGORY[pool]
    const d = camDistance(x, y, z)
    v.assigned = true
    v.releaseAt = -1
    v.audio.position.set(x, y, z)
    v.audio.setRefDistance(CATEGORY[cat].ref)
    v.filter.frequency.setTargetAtTime(distanceCutoffHz(d), now, 0.1)
    if (v.file !== file) {
      if (v.audio.isPlaying) v.audio.stop()
      v.file = file
      v.audio.setBuffer(buffer)
      v.audio.gain.gain.setValueAtTime(0, now)
      // 【從隨機位置開始】同一種飛機好幾架一起飛時，引擎聲才不會完全同步
      v.audio.offset = Math.random() * buffer.duration * 0.9
      v.audio.play()
    }
    v.audio.gain.gain.setTargetAtTime(gainOf(file, cat, 0), now, 0.1)
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
    for (const v of voices) if (v.audio.isPlaying) v.audio.stop()
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
  }

  async function loadAll(): Promise<void> {
    const res = await fetch(assetUrl('/audio/manifest.json'))
    const manifest = await res.json() as Record<string, { loop: boolean; makeupDb: number }>
    const ids = Object.keys(manifest)
    for (const id of ids) makeup.set(id, manifest[id]!.makeupDb)
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
      }
    }
    await Promise.all(Array.from({ length: 6 }, worker))
  }

  return {
    load() {
      loading ??= loadAll().catch((e) => { console.warn('音效清單載入失敗', e) })
      return loading
    },
    unlock() {
      unlocked = true
      applyRunState()
    },
    setVolume(db) {
      muted = db === null
      if (db !== null) listener.setMasterVolume(dbToGain(db))
      applyRunState()
    },
    setPaused(p) {
      paused = p
      applyRunState()
    },
    setTimeScale(s) {
      timeScale = s
    },
    playPool,
    playFile,
    selfLoop,
    beginFrame,
    assign,
    endFrame,
    stopAll,
  }
}
