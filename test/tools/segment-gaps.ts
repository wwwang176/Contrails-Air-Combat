/** 將下一次進場的間隔寫回同一單位的上一段紀錄。僅供離線探針使用。 */
export class SegmentGaps {
  private readonly pending = new Map<number, { at: number; segment: { gap: number } }>()

  close(index: number, at: number, segment: { gap: number }): void {
    this.pending.set(index, { at, segment })
  }

  enter(index: number, at: number): void {
    const previous = this.pending.get(index)
    if (previous === undefined) return
    previous.segment.gap = at - previous.at
    this.pending.delete(index)
  }
}
