import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'

/**
 * 文字狀態的護欄 —— **讀 widget 的原始碼**。
 *
 * 整個 HUD 共用一個 `CanvasRenderingContext2D`，而 `textAlign` / `textBaseline`
 * 是黏著的：`clearRect` 不重置它們，跨幀也不重置。沒有自己設的 widget 畫出來
 * 的字，位置取決於**這一幀之前哪一個 widget 剛好畫了字** —— 畫面上的症狀是
 * 文字偶爾偏移一個字高，而且會隨著別的儀表出現或消失而跳動。
 *
 * canvas 進不了 node，所以這條性質只能從原始碼上守。
 */
const DIR = 'src/hud/widgets'
const read = (f: string): string =>
  new TextDecoder().decode(readFileSync(`${DIR}/${f}`))

const FILES = readdirSync(DIR).filter((f) => f.endsWith('.ts'))
const DRAWS_TEXT = FILES.filter((f) => /fillText|strokeText/.test(read(f)))

describe('HUD widget 的文字狀態', () => {
  it('掃得到 widget —— 目錄或副檔名改了要在這裡就紅', () => {
    expect(FILES.length).toBeGreaterThan(10)
    expect(DRAWS_TEXT.length).toBeGreaterThan(5)
  })

  it('凡是畫文字的 widget 都自己設 textBaseline', () => {
    const bad = DRAWS_TEXT.filter((f) => !read(f).includes('textBaseline'))
    expect(bad).toEqual([])
  })

  it('凡是畫文字的 widget 都自己設 textAlign', () => {
    const bad = DRAWS_TEXT.filter((f) => !read(f).includes('textAlign'))
    expect(bad).toEqual([])
  })
})
