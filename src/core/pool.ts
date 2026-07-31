import { Vector3, Quaternion } from 'three'

export interface Scratch {
  readonly v: readonly Vector3[]
  readonly q: readonly Quaternion[]
}

/**
 * 建立模組私有的預配置暫存物件。
 *
 * 使用約定：各模組在載入時呼叫一次並私有持有，禁止跨模組共用。
 * 跨模組共用會在巢狀呼叫時造成別名衝突（例如 aero 借用中的向量被 dynamics 覆寫）。
 */
export function makeScratch(vecCount: number, quatCount = 0): Scratch {
  return {
    v: Array.from({ length: vecCount }, () => new Vector3()),
    q: Array.from({ length: quatCount }, () => new Quaternion()),
  }
}
