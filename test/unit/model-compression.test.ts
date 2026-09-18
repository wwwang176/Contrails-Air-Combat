import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseGroundGlb } from '../../src/render/geometry/ground/glb'

/**
 * `public/models/` 是 `scripts/compress-models.mjs` 從 `models-src/` 壓出來的
 * （測試開跑前由 `test/setup/models.mjs` 產出）。
 *
 * 【它在防什麼】壓縮若不是無損，模型會在線上悄悄變形；解碼器沒掛上，那幾關
 * 會進不去。這裡走遊戲實際的載入路徑（`parseGroundGlb` → `createGltfLoader`），
 * 兩份檔案解出來的每一個三角形都要相同 —— 只容許頂點起點輪轉，那是 meshopt
 * 索引編碼的行為，繞向不變。
 */
const buf = (path: string): ArrayBuffer => {
  const b = readFileSync(path)
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer
}

/** 第 t 個三角形的三個頂點（各 3 個 float）在 b 裡是 a 的某個輪轉 */
function sameTriangle(a: ArrayLike<number>, b: ArrayLike<number>, t: number): boolean {
  const o = t * 9
  for (let r = 0; r < 3; r++) {
    let ok = true
    for (let v = 0; v < 3 && ok; v++) {
      for (let c = 0; c < 3; c++) {
        if (a[o + v * 3 + c] !== b[o + ((v + r) % 3) * 3 + c]) { ok = false; break }
      }
    }
    if (ok) return true
  }
  return false
}

describe('壓縮過的模型與原檔解出同一個幾何', () => {
  for (const name of ['leuna_plant', 'poltava_airfield']) {
    it(`${name}：public 那一份是 meshopt 壓縮檔，而且三角形逐一相同`, async () => {
      const shipped = buf(`public/models/${name}.glb`)
      // 【確認真的壓過】沒壓的話這一條就沒有測到解碼路徑
      // GLB：12 bytes 檔頭，接著 JSON 區塊（4 bytes 長度 + 4 bytes 類型 + 內容）
      const jsonLength = new DataView(shipped).getUint32(12, true)
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(shipped, 20, jsonLength)))
      expect(json.extensionsRequired).toContain('EXT_meshopt_compression')
      const a = (await parseGroundGlb(buf(`models-src/${name}.glb`))).getAttribute('position').array
      const b = (await parseGroundGlb(shipped)).getAttribute('position').array
      expect(b.length).toBe(a.length)
      let bad = 0
      for (let t = 0; t < a.length / 9; t++) if (!sameTriangle(a, b, t)) bad++
      expect(bad).toBe(0)
    })
  }
})
