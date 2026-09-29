import { t, type MessageKey } from './index'

/**
 * 把 `index.html` 的固定文字換成目前的語言。開場跑一次、換語言時再跑。
 *
 * ```
 *   data-i18n="鍵"                          換 textContent
 *   data-i18n-attr="title:鍵,aria-label:鍵"  換屬性
 * ```
 *
 * 【只放在沒有子元素的節點上】換 `textContent` 會把子元素整個清掉 —— 齒輪按鈕
 * 裡的 SVG 就是這樣不見的，所以那一顆只換屬性。
 *
 * 鍵對不對由 `test/unit/i18n-guard.test.ts` 對著文字表檢查。
 */
export function applyStaticText(root: ParentNode): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset['i18n'] as MessageKey)
  })
  root.querySelectorAll<HTMLElement>('[data-i18n-attr]').forEach((el) => {
    for (const pair of (el.dataset['i18nAttr'] ?? '').split(',')) {
      const [attr, key] = pair.split(':')
      if (attr && key) el.setAttribute(attr.trim(), t(key.trim() as MessageKey))
    }
  })
}
