import { airAbsorptionKernel } from './airAbsorptionKernel'

/** 覆蓋遊戲最遠的 8 km；額外留至 16 km 給展示區。相鄰距離逐漸放寬至約 8%。 */
export const AIR_DISTANCES: readonly number[] = (() => {
  const values = [0]
  while (values[values.length - 1]! < 16000) values.push(Math.min(16000, (values[values.length - 1]! + 10) * 1.08 - 10))
  return values
})()

/** 將距離夾在兩個濾波核之間；線性振幅交接，不使用會增加音量的等功率交接。 */
export function airDistanceMix(distance: number): { lower: number; upper: number; weight: number } {
  const d = Number.isFinite(distance) ? Math.max(0, Math.min(16000, distance)) : 0
  let lower = Math.min(AIR_DISTANCES.length - 2, Math.floor(Math.log1p(d / 10) / Math.log(1.08)))
  lower = Math.max(0, lower)
  const upper = lower + 1
  return { lower, upper, weight: Math.max(0, Math.min(1,
    (d - AIR_DISTANCES[lower]!) / (AIR_DISTANCES[upper]! - AIR_DISTANCES[lower]!))) }
}

export interface SpatialOutput {
  readonly input: AudioNode
  wake(): void
  sleep(): void
}

export interface AirRoute extends SpatialOutput {
  setDistance(distance: number, now: number, immediate?: boolean): void
}

/**
 * 先定位、再依距離共用濾波。卷積是線性的：同一距離先混音再濾波與各自濾波後混音等價。
 * 單聲道濾波核會分別作用在左右聲道，不改變原本的立體聲定位。
 * 節點只在有聲道使用時接到輸出；空桶釋放卷積狀態，避免下一次播到上一聲的尾音。
 */
export function createAirAbsorption(ctx: BaseAudioContext, output: AudioNode) {
  const buffers = new Map<number, AudioBuffer>()
  const bins = new Map<number, { node: ConvolverNode; users: number }>()
  const routes: { sweep(now: number): void }[] = []
  let preparing: Promise<void> | undefined

  function buffer(index: number): AudioBuffer {
    const cached = buffers.get(index)
    if (cached) return cached
    const kernel = airAbsorptionKernel(AIR_DISTANCES[index]!, ctx.sampleRate)
    const result = ctx.createBuffer(1, kernel.length, ctx.sampleRate)
    result.getChannelData(0).set(kernel)
    buffers.set(index, result)
    return result
  }

  function acquire(index: number): ConvolverNode {
    let bin = bins.get(index)
    if (!bin) {
      const node = ctx.createConvolver()
      node.normalize = false
      node.buffer = buffer(index)
      node.connect(output)
      bin = { node, users: 0 }; bins.set(index, bin)
    }
    bin.users++
    return bin.node
  }

  function release(index: number): void {
    const bin = bins.get(index)!
    if (--bin.users === 0) { bin.node.disconnect(); bins.delete(index) }
  }

  function createRoute(): AirRoute {
    const input = ctx.createGain()
    const branches = new Map<number, { node: GainNode; target: number; retireAt: number }>()
    let awake = false, distance = 0
    function remove(index: number): void {
      const branch = branches.get(index)!
      input.disconnect(branch.node); branch.node.disconnect(); branches.delete(index); release(index)
    }
    function sweep(now: number): void {
      for (const [index, branch] of branches) if (now >= branch.retireAt) remove(index)
    }
    function apply(now: number, immediate: boolean): void {
      sweep(now)
      const mix = airDistanceMix(distance)
      const targets = new Map([[mix.lower, 1 - mix.weight], [mix.upper, mix.weight]])
      for (const [index, target] of targets) {
        if (target < 1e-6 || branches.has(index)) continue
        const node = ctx.createGain(); node.gain.value = 0
        input.connect(node); node.connect(acquire(index))
        branches.set(index, { node, target: -1, retireAt: Infinity })
      }
      for (const [index, branch] of branches) {
        const weight = targets.get(index) ?? 0
        const target = weight < 1e-6 ? 0 : weight
        if (immediate && target < 1e-6) { remove(index); continue }
        // 接近零也必須安排回收；不能因差異小於門檻而永遠留住一條極小聲的路徑。
        if (!immediate && (target === branch.target
          || (target > 0 && branch.target > 0 && Math.abs(target - branch.target) < 0.001))) continue
        const param = branch.node.gain
        if (immediate) { param.cancelScheduledValues(now); param.setValueAtTime(target, now) }
        else param.setTargetAtTime(target, now, 0.015)
        branch.target = target
        branch.retireAt = target < 1e-6 ? now + 0.15 : Infinity
      }
    }
    routes.push({ sweep })
    return {
      input,
      setDistance(value, now, immediate = false) {
        distance = value
        if (awake) apply(now, immediate)
      },
      wake() { if (!awake) { awake = true; apply(ctx.currentTime, true) } },
      sleep() {
        awake = false
        for (const index of branches.keys()) remove(index)
      },
    }
  }

  return {
    createRoute,
    /** 配合音效預載分段建立濾波核；戰鬥內不必反覆 FFT。 */
    prepare(): Promise<void> {
      return preparing ??= (async () => {
        for (let i = 0; i < AIR_DISTANCES.length; i++) {
          buffer(i)
          if (i % 4 === 3) await new Promise<void>((resolve) => setTimeout(resolve, 0))
        }
      })()
    },
    update(now: number): void { for (const route of routes) route.sweep(now) },
    get activeFilters(): number { return bins.size },
  }
}
