import { assetUrl } from '../core/asset'
import './completionStamp.css'

/** 待完成章沿用簡報完成章的尺寸與文字排版。 */
export function pendingStamp(): string {
  return '<span class="completion-stamp completion-stamp--brief completion-stamp--pending" role="img" aria-label="PENDING">'
    + `<img src="${assetUrl('/ui/pending-stamp.svg')}" alt="" aria-hidden="true">`
    + '<span aria-hidden="true">PENDING</span></span>'
}

/** 同一張向量印章共用於關卡、簡報與結算；英文文字保留為可讀 DOM。 */
export function completionStamp(size: 'compact' | 'brief' | 'result', fresh = false): string {
  return `<span class="completion-stamp completion-stamp--${size}${fresh ? ' completion-stamp--fresh' : ''}" role="img" aria-label="COMPLETED">`
    + `<img src="${assetUrl('/ui/completed-stamp.svg')}" alt="" aria-hidden="true">`
    + '<span aria-hidden="true">COMPLETED</span></span>'
}
