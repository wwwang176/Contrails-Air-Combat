import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'

/**
 * 音效清單與檔案的對應。清單缺檔的話那個聲音在遊戲裡靜悄悄地不出現；
 * 多出清單外的檔案則是白白下載。
 */
const manifest = JSON.parse(readFileSync('public/audio/manifest.json', 'utf8')) as
  Record<string, { loop: boolean; makeupDb: number }>

describe('音效清單', () => {
  it('每一筆都有檔案，每個檔案都在清單裡', () => {
    for (const id of Object.keys(manifest)) expect(existsSync(`public/audio/${id}.mp3`), id).toBe(true)
    const files = readdirSync('public/audio').filter((f) => f.endsWith('.mp3')).map((f) => f.slice(0, -4))
    expect(files.sort()).toEqual(Object.keys(manifest).sort())
  })

  it('補償值落在 0–12 dB', () => {
    for (const [id, m] of Object.entries(manifest)) {
      expect(m.makeupDb, id).toBeGreaterThanOrEqual(0)
      expect(m.makeupDb, id).toBeLessThanOrEqual(12)
    }
  })

  /** 【檔名只用泛用名稱】只准小寫字母、數字與連字號 */
  it('檔名只有泛用的小寫名稱', () => {
    for (const id of Object.keys(manifest)) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
  })
})
