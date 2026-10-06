import { Audio, type AudioListener } from 'three'
import { CATEGORY, type Category } from './catalog'
import { dbToGain } from './curves'

export type SelfSlot = 'engine' | 'wind' | 'warn' | 'siren'

const SELF_CATEGORY: Record<SelfSlot, Category> = { engine: 'engineSelf', wind: 'wind', warn: 'warn', siren: 'sirenSelf' }
/** 換檔、停止時的淡出，s */
const SELF_FADE = 0.1
const FULL_BAND = 22000

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

/** Owns the four player loops and their file transitions; channels are created once. */
export function createSelfAudio(
  listener: AudioListener,
  buffers: ReadonlyMap<string, AudioBuffer>,
  makeup: ReadonlyMap<string, number>,
  playback: { readonly muted: boolean; readonly timeScale: number },
  lowpass: () => BiquadFilterNode,
) {
  const ctx = listener.context
  const selves = {} as Record<SelfSlot, SelfVoice>
  for (const slot of ['engine', 'wind', 'warn', 'siren'] as const) {
    const audio = new Audio(listener)
    audio.setLoop(true)
    const filter = slot === 'wind' ? lowpass() : null
    if (filter !== null) audio.setFilter(filter)
    selves[slot] = { audio, filter, file: null, next: undefined, switchAt: 0, gain: 0 }
  }

  function selfLoop(slot: SelfSlot, file: string | null, rate: number, gainDb: number, cutoffHz?: number): void {
    const s = selves[slot]
    const now = ctx.currentTime
    const target = file !== null && buffers.has(file) && !playback.muted ? file : null
    s.gain = target === null ? 0 : dbToGain(CATEGORY[SELF_CATEGORY[slot]].gainDb + (makeup.get(target) ?? 0) + gainDb)

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
      s.audio.setPlaybackRate(rate * playback.timeScale)
      s.filter?.frequency.setTargetAtTime(cutoffHz ?? FULL_BAND, now, 0.05)
    }
  }

  function stopAll(): void {
    for (const slot of Object.keys(selves) as SelfSlot[]) {
      const s = selves[slot]
      if (s.audio.isPlaying) s.audio.stop()
      s.file = null
      s.next = undefined
    }
  }

  return { selfLoop, stopAll }
}
