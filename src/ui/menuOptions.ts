import { t, type MessageKey } from '../i18n'

/**
 * 一排選項按鈕的一顆。`labelKey`／`hintKey` 是文字表的鍵；不必翻的字（語言名稱、
 * 數字副標）放 `label`／`hint`。沒有副標的兩個都不給
 */
export interface OptItem<T> {
  readonly labelKey?: MessageKey
  readonly label?: string
  readonly hintKey?: MessageKey
  readonly hint?: string
  readonly value: T
  readonly sil: string
  /** 按不下去（畫質在這台螢幕上沒作用的檔位） */
  readonly disabled?: boolean
}

export function optRow<T>(
  host: HTMLElement, items: readonly OptItem<T>[], current: T, onPick: (v: T) => void,
): void {
  host.innerHTML = ''
  for (const it of items) {
    const b = document.createElement('button')
    b.className = it.value === current ? 'on' : ''
    // 【沒有說明就不要那一行】畫質與抗鋸齒沒有副標，留一個空的 `<small>`
    // 會在字底下撐出一條空隙，那一列看起來就像少印了字
    const hint = it.hintKey !== undefined ? t(it.hintKey) : it.hint ?? ''
    const small = hint === '' ? '' : `<small>${escapeHtml(hint)}</small>`
    const label = it.labelKey !== undefined ? t(it.labelKey) : it.label ?? ''
    b.innerHTML = `${it.sil}<span>${escapeHtml(label)}</span>${small}`
    b.disabled = it.disabled === true
    b.addEventListener('click', () => onPick(it.value))
    host.appendChild(b)
  }
}

/** 名字與文案都是資料，不是標記。與 `ui/scoreboard.ts` 同一個理由 */
export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => (
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;'
      : c === '"' ? '&quot;' : '&#39;'
  ))
}
