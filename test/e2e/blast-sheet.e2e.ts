/**
 * **爆炸的逐格對照表**。每 0.1 s 一格，拼成一張 PNG。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5175                             # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/blast-sheet.e2e.ts      # 終端機二
 * ```
 *
 * 【為什麼不是逐張截圖】爆炸整個只有 2.5 s，而 rAF 的間隔由瀏覽器決定 ——
 * 兩種畫法各截十六張的話，兩排的時間點對不起來，比對就沒有意義。展示區的
 * `__blastProbe.sheet` 改用**固定 dt** 手動推進，每一格恰好差 0.1 s。
 *
 * 【一定要有頭】無頭 chromium 走 SwiftShader 軟體算圖，那不是玩家機器上的
 * 編譯器（與 `farmland-shot` 同一條理由）。
 */
import { chromium, type Page } from 'playwright'
import { writeFileSync } from 'node:fs'

const URL = 'http://localhost:5175/tools/blast.html'
const ROOT = 'C:/Users/weiwe/AppData/Local/Temp/claude/C--projects-grok-aircraft2/'
  + '48a01b5a-7c87-4eb0-b508-ce8741c327da/scratchpad'

/** 16 格 × 0.1 s = 1.6 s。火球 0.5–0.85 s、煙 2.5 s —— 看得完火球的整個生滅 */
const FRAMES = 16
const DT = 0.1
const COLS = 4
const CELL_W = 400
const CELL_H = 225

interface Shot {
  readonly kind: 'land' | 'water'
  readonly style: 'billboard' | 'chunks'
  /** 地形按鈕的序號：0 海面、1 群島、2 內陸 */
  readonly terrain: number
  /** 當量倍率。1 = 500 lb */
  readonly yield: number
  /** 煙用不用貼圖 */
  readonly tex: boolean
  /** 火球要不要光暈 */
  readonly glow: boolean
  readonly file: string
}

// 【墜地拍在內陸、落水拍在海面】墜地爆炸拍在海上，揚塵與水柱的分野就沒有
// 任何畫面上的意義
const SHOTS: readonly Shot[] = [
  {
    kind: 'water', style: 'chunks', terrain: 0, yield: 1, tex: true, glow: true,
    file: 'blast-water.png',
  },
  {
    kind: 'water', style: 'chunks', terrain: 0, yield: 4, tex: true, glow: true,
    file: 'blast-water-4x.png',
  },
  {
    kind: 'land', style: 'chunks', terrain: 2, yield: 1, tex: true, glow: true,
    file: 'blast-glow.png',
  },
]

function writePng(path: string, dataUrl: string): void {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  writeFileSync(path, bytes)
}

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    // 地形與粒子池要建完。展示區沒有 loading 事件，等一段固定時間
    await page.waitForTimeout(4000)

    let lastTerrain = -1
    for (const s of SHOTS) {
      if (s.terrain !== lastTerrain) {
        await page.click(`#terrain button >> nth=${s.terrain}`)
        // 內陸要生植被，而且相機要重擺
        await page.waitForTimeout(3500)
        lastTerrain = s.terrain
      }
      await page.evaluate((q: readonly [number, boolean, boolean]) => {
        const p = (window as unknown as Record<string, {
          setYield(y: number): void
          setTextured(v: boolean): void
          setGlow(v: boolean): void
        }>)['__blastProbe']!
        p.setTextured(q[1])
        p.setGlow(q[2])
        p.setYield(q[0])
      }, [s.yield, s.tex, s.glow] as [number, boolean, boolean])
      const url = await page.evaluate((q: readonly unknown[]) => {
        const p = (window as unknown as Record<string, {
          sheet(k: string, style: string, frames: number, dt: number,
            cols: number, w: number, h: number): string
        }>)['__blastProbe']!
        return p.sheet(
          q[0] as string, q[1] as string, q[2] as number, q[3] as number,
          q[4] as number, q[5] as number, q[6] as number,
        )
      }, [s.kind, s.style, FRAMES, DT, COLS, CELL_W, CELL_H])
      writePng(`${ROOT}/${s.file}`, url)
      console.log(`  ${s.kind.padEnd(6)} ${s.style.padEnd(10)} 當量 ${s.yield}× → ${s.file}`)
      // 【每一張之間讓 rAF 跑幾幀】`sheet` 是同步的，連續呼叫時上一張的
      // 尾巴還在池子裡；重播前的 reset 在 `fire()` 裡，但相機阻尼要幀
      await page.waitForTimeout(400)
    }

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
