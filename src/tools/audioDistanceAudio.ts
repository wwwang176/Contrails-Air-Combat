import { createAirAbsorption } from '../audio/airAbsorption'
import { absorptionDb, dbToGain, distanceCutoffHz } from '../audio/curves'
import { assetUrl } from '../core/asset'

export type DistanceAudioMode = 'physical' | 'legacy' | 'dry'

/** 展示區的 A/B 播放器；新版直接使用遊戲的共用大氣濾波。 */
export function createDistanceAudio() {
  const ctx = new AudioContext()
  const master = ctx.createGain(), spread = ctx.createGain(), analyser = ctx.createAnalyser()
  master.gain.value = dbToGain(-12)
  spread.connect(master); master.connect(analyser); analyser.connect(ctx.destination)
  const dry = ctx.createGain(), legacy = ctx.createGain(), physical = ctx.createGain()
  for (const node of [dry, legacy, physical]) node.connect(spread)
  dry.gain.value = legacy.gain.value = 0; physical.gain.value = 1
  const air = createAirAbsorption(ctx, physical), route = air.createRoute()
  const filters = [ctx.createBiquadFilter(), ctx.createBiquadFilter()]
  for (const f of filters) { f.type = 'lowpass'; f.Q.value = 0.7 }
  filters[0]!.connect(filters[1]!); filters[1]!.connect(legacy)
  const cache = new Map<string, AudioBuffer>()
  let source: AudioBufferSourceNode | OscillatorNode | null = null
  let sourceGain: GainNode | null = null
  let generation = 0, mode: DistanceAudioMode = 'physical', distance = 500, attenuate = false
  let frequency = 1000, playing = false
  const samples = new Float32Array(analyser.fftSize)

  function update(): void {
    const now = ctx.currentTime
    air.update(now)
    route.setDistance(distance, now)
    for (const f of filters) f.frequency.setTargetAtTime(Math.min(ctx.sampleRate / 2, distanceCutoffHz(distance)), now, 0.03)
    dry.gain.setTargetAtTime(mode === 'dry' ? 1 : 0, now, 0.015)
    legacy.gain.setTargetAtTime(mode === 'legacy' ? dbToGain(absorptionDb(distance)) : 0, now, 0.015)
    physical.gain.setTargetAtTime(mode === 'physical' ? 1 : 0, now, 0.015)
    // 統一 80 m 參考距離，避免不同素材的混音設定混入這個實驗。
    spread.gain.setTargetAtTime(attenuate ? Math.min(1, 80 / Math.max(80, distance)) : 1, now, 0.03)
  }

  function stop(): void {
    generation++
    const old = source, gain = sourceGain
    source = null; sourceGain = null; playing = false
    if (old && gain) {
      const now = ctx.currentTime
      gain.gain.cancelAndHoldAtTime(now); gain.gain.linearRampToValueAtTime(0, now + 0.02)
      old.stop(now + 0.025)
      old.onended = () => { old.disconnect(); gain.disconnect(); if (!source) route.sleep() }
    }
    // 下一次播放會立即設定距離；停住時也不留下共用卷積負載。
    if (!old) route.sleep()
  }

  async function play(file: string | null, loop: boolean, delay: boolean): Promise<boolean> {
    stop()
    const token = generation
    await ctx.resume()
    let buffer: AudioBuffer | undefined
    if (file) {
      buffer = cache.get(file)
      if (!buffer) {
        const response = await fetch(assetUrl(`/audio/${file}.mp3`))
        if (!response.ok) throw new Error('音效載入失敗')
        buffer = await ctx.decodeAudioData(await response.arrayBuffer())
        cache.set(file, buffer)
      }
    }
    if (token !== generation) return false
    if (buffer) {
      const node = ctx.createBufferSource(); node.buffer = buffer; node.loop = loop; source = node
    } else {
      const node = ctx.createOscillator(); node.type = 'sine'; node.frequency.value = frequency; source = node
    }
    sourceGain = ctx.createGain()
    const now = ctx.currentTime, start = now + (delay ? distance / 343 : 0)
    sourceGain.gain.setValueAtTime(0, now)
    sourceGain.gain.setValueAtTime(0, start)
    sourceGain.gain.linearRampToValueAtTime(buffer ? 1 : 0.12, start + 0.01)
    source.connect(sourceGain)
    sourceGain.connect(dry); sourceGain.connect(filters[0]!); sourceGain.connect(route.input)
    route.setDistance(distance, now, true); route.wake(); update()
    const node = source, gain = sourceGain
    node.onended = () => {
      node.disconnect(); gain.disconnect()
      if (source === node) { source = null; sourceGain = null; playing = false; route.sleep() }
    }
    node.start(start); playing = true
    return true
  }

  return {
    prepare: () => air.prepare(), play, stop, tick: () => air.update(ctx.currentTime),
    setMode(value: DistanceAudioMode) { mode = value; update() },
    setDistance(value: number) { distance = value; update() },
    setAttenuation(value: boolean) { attenuate = value; update() },
    setVolume(db: number) { master.gain.setTargetAtTime(dbToGain(db), ctx.currentTime, 0.02) },
    setFrequency(value: number) {
      frequency = value
      if (source instanceof OscillatorNode) source.frequency.setTargetAtTime(value, ctx.currentTime, 0.02)
    },
    get playing() { return playing },
    get sampleRate() { return ctx.sampleRate },
    measure() {
      analyser.getFloatTimeDomainData(samples)
      let energy = 0
      for (const value of samples) energy += value * value
      return { rms: Math.sqrt(energy / samples.length), activeFilters: air.activeFilters, state: ctx.state }
    },
  }
}
