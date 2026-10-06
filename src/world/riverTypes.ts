export interface RiverFile {
  readonly rivers: readonly {
    readonly name: string
    readonly points: readonly (readonly [number, number])[]
  }[]
}

/** 地形高度。**場外要回 0 不是 −Infinity** —— 延伸段整段都在場外 */
export type HeightSampler = (x: number, z: number) => number

/** 一條河重新取樣之後的中心線，含每一點的水面高度 */
export interface WaterLine {
  readonly name: string
  readonly points: readonly (readonly [number, number])[]
  /** 水面高度，與 `points` 等長 */
  readonly level: readonly number[]
  /** 地圖外的延伸段：外環是平的，河岸的草甸不必橫向切段 */
  readonly coarse: boolean
}

/** 水面的半寬，m */
export const CHANNEL_HALF = 45
/**
 * 水面高出當地地形多少，m。
 *
 * 【它不是防閃爍的主力】遠平面 5,000 km，2 km 高度的深度解析度是 0.25 m、
 * 4 km 是 1 m —— 靠抬高度抬到不閃，就看得出河浮在田上。閃爍由材質的
 * `polygonOffset` 治，這個值只是餘裕。**上限兩公尺**，再高低空看得出來。
 */
export const CLEARANCE = 1.2
