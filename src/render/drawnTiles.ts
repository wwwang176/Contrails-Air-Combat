import { ClampToEdgeWrapping, DataTexture, LinearFilter, RedFormat, UnsignedByteType, Vector2 } from 'three'

/**
 * # 哪些植被格有畫樹
 *
 * 一張 `DRAWN_TILES_N`² 的 R8 貼圖，一格是一個植被格（`TILE_SIZE`），255 = 這一格的樹有畫
 * （高模、中級、點任一級），0 = 沒畫（出了外圈或還沒生成）。地面（`fieldClipmap.ts`）
 * 拿它決定一點用近處的樣子（樹底下的地）還是烘好的遠圖（樹冠色）。
 *
 * 【與畫面上的樹同一幀換】植被重建是分幀寫完才一起換上新緩衝。重建開始時記下各格的
 * 級數（`stage`），換上的那一次才上傳（`publish`）—— 在開始時就上傳的話，寫完之前舊的樹
 * 還在畫，地面卻已經換了。
 *
 * 【以重建開始時的格為中心】貼圖的第 k 格是植被格 `origin + k`；`origin` 跟著上傳一起換。
 * 植被圈半徑 24 格，64 格的窗兩側各留 8 格，邊上恆為 0（夾邊取樣讀到 0）
 *
 * 【淡化】植被換級時淡入淡出（`vegetation.ts`），這張表跟著由舊的值漸變到新的值：
 * `publish(true)` 先把畫面上那一份搬到新的原點、不改值，之後每幀 `setFade(t)` 寫
 * `舊 + (新 − 舊) × t`
 */

/** 每邊幾格 */
export const DRAWN_TILES_N = 64

export interface DrawnTiles {
  readonly uniforms: {
    readonly uTreesDrawn: { value: DataTexture }
    /** 貼圖第 0 格是哪一個植被格（i, j） */
    readonly uTreesOrigin: { value: Vector2 }
  }
  /**
   * 重建開始時呼叫：以植被格 `(ci, cj)` 為中心清空，之後逐格 `mark`。不動貼圖
   */
  stage(ci: number, cj: number): void
  /** 這一格有畫樹（`stage` 之後、`publish` 之前） */
  mark(i: number, j: number): void
  /**
   * 新的樹換上時呼叫。`fade` 為假：上傳記下來的那一份。為真：畫面上那一份搬到新的原點、
   * 值不變，之後由 `setFade` 漸變到記下來的那一份
   */
  publish(fade?: boolean): void
  /** 淡化進度 0..1，寫 `舊 + (新 − 舊) × t` 並上傳。不配置 */
  setFade(t: number): void
  /** 已發布的那一份（淡化的終點）裡，植被格 `(i, j)` 有沒有畫樹（測距工具用） */
  drawnAt(i: number, j: number): boolean
  dispose(): void
}

export function createDrawnTiles(): DrawnTiles {
  const n = DRAWN_TILES_N
  const data = new Uint8Array(n * n)
  const pending = new Uint8Array(n * n)
  /** 淡化的起點與終點，都在目前的原點上 */
  const from = new Uint8Array(n * n)
  const to = new Uint8Array(n * n)
  const tex = new DataTexture(data, n, n, RedFormat, UnsignedByteType)
  tex.magFilter = LinearFilter
  tex.minFilter = LinearFilter
  tex.generateMipmaps = false
  tex.wrapS = ClampToEdgeWrapping
  tex.wrapT = ClampToEdgeWrapping
  tex.needsUpdate = true
  const origin = new Vector2()
  let pi = 0
  let pj = 0
  return {
    uniforms: { uTreesDrawn: { value: tex }, uTreesOrigin: { value: origin } },
    stage(ci, cj) {
      pending.fill(0)
      pi = ci - n / 2
      pj = cj - n / 2
    },
    mark(i, j) {
      const x = i - pi
      const y = j - pj
      if (x < 0 || y < 0 || x >= n || y >= n) return
      pending[y * n + x] = 255
    },
    publish(fade = false) {
      if (fade) {
        // 畫面上那一份搬到新的原點：新窗的第 (x, y) 格是舊窗的第 (x + dx, y + dy) 格
        const dx = pi - origin.x
        const dy = pj - origin.y
        for (let y = 0; y < n; y++) {
          for (let x = 0; x < n; x++) {
            const ox = x + dx
            const oy = y + dy
            from[y * n + x] = ox >= 0 && oy >= 0 && ox < n && oy < n ? data[oy * n + ox]! : 0
          }
        }
        data.set(from)
      } else {
        data.set(pending)
        from.set(pending)
      }
      to.set(pending)
      origin.set(pi, pj)
      tex.needsUpdate = true
    },
    setFade(t) {
      const k = Math.min(1, Math.max(0, t))
      for (let i = 0; i < n * n; i++) data[i] = Math.round(from[i]! + (to[i]! - from[i]!) * k)
      tex.needsUpdate = true
    },
    drawnAt(i, j) {
      const x = i - origin.x
      const y = j - origin.y
      return x >= 0 && y >= 0 && x < n && y < n && to[y * n + x]! > 0
    },
    dispose() { tex.dispose() },
  }
}
