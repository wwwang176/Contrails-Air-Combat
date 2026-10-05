import { REPORT_LINE_SECONDS, REPORT_SLIDE, type ReportKind, type ReportLine } from '../battle/report'
import { t, type MessageKey } from '../i18n'

/** 雷擊命中與擊沉使用不同動詞。 */
const VERB_KEY: Readonly<Record<ReportKind, MessageKey>> = {
  air: 'report.air',
  ship: 'report.ship',
  ground: 'report.ground',
  torpedo: 'report.torpedo',
}

/** 壽命的最後這幾秒淡出，s。 */
export const REPORT_FADE = 0.5

/** 通報是即時回饋，打字速度須配合佇列每 0.3 秒放行一則的節奏。 */
export const REPORT_SECONDS_PER_CHAR = 0.02

/** 繪製時才翻譯，讓已出場的通報也能切換語言。 */
export function reportText(line: ReportLine): string {
  return t('report.line', { verb: t(VERB_KEY[line.kind]), name: t(line.nameKey) })
}

/** 尚未滑完的距離，單位為行；由 widget 乘上行距。 */
export function reportSlide(line: ReportLine, now: number): number {
  const t = (now - line.shiftedAt) / REPORT_SLIDE
  if (t >= 1) return 0
  return t <= 0 ? 1 : 1 - t
}

/** 淘汰與繪製可能差一幀，夾住不透明度以免負值傳入 canvas。 */
export function reportAlpha(line: ReportLine, now: number): number {
  const age = now - line.bornAt
  if (age >= REPORT_LINE_SECONDS) return 0
  if (age <= REPORT_LINE_SECONDS - REPORT_FADE) return 1
  return (REPORT_LINE_SECONDS - age) / REPORT_FADE
}
