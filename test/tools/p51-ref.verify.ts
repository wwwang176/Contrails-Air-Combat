/**
 * P-51D 對 `ref/p51d.glb` 的逐站對切。**不由 vitest 執行，不斷言任何事。**
 *
 * 跑法：機庫 dev server 開著（預設 5191），`npx vite-node test/tools/p51-ref.verify.ts [port]`
 *
 * 【它在回答什麼】GLB 版 P-51D（`public/models/p51d.glb`）與參考模型差在哪、
 * 差多少。對齊參數用 `hangar.ts` `REFS` 表裡量好的定值（yaw 180、pitch −14、
 * 依翼展縮放）。量法與 `b17-ref.measure.ts` 的 `verify` 段相同：
 *
 *   機身中線背線／腹線   `extent` 沿 Z，uWindow ±0.06
 *   機身最大半寬         `radial` 沿 Z，四個射線原點高度取最大
 *   右半翼前後緣／厚度   `extent` 沿 X，uWindow 限在主翼的 Z 範圍
 *   右半平尾前後緣       `extent` 沿 X，uWindow 限在尾段
 *
 * 數字抓 0.02–0.05 m 這一級的偏差；大方向要看疊圖（skill 第 6 步）。
 */
import { chromium } from 'playwright'
import type { Extent, Radial } from './hangar-hooks'

declare const process: { argv: readonly string[] }
const PORT = process.argv[2] ?? '5191'
const URL = `http://localhost:${PORT}/tools/hangar.html`

const n = (x: number, w = 7, d = 3): string =>
  (Number.isFinite(x) ? x.toFixed(d) : '—').padStart(w)

function stat(xs: readonly number[], label: string): void {
  const v = xs.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b)
  if (v.length === 0) { console.log(`  ${label}  沒有可比的站位`); return }
  console.log(`  ${label}  ${String(v.length).padStart(3)} 站`
    + `  中位 ${n(v[v.length >> 1]!)}  90% ${n(v[Math.floor(v.length * 0.9)]!)}`
    + `  最大 ${n(v[v.length - 1]!)}`)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
    await page.goto(URL)
    await page.waitForFunction(() => '__hangarSpec' in window, null, { timeout: 60000 })
    await page.evaluate(() => window.__hangarSpec('p51d'))
    for (let i = 0; i < 120; i++) {
      if (await page.evaluate(() => window.__hangarRef(true, false))) break
      await page.waitForTimeout(500)
    }
    const slice = (
      kind: 'radial' | 'extent', axis: string, o: Record<string, unknown>, target?: 'mine',
    ) => page.evaluate(
      ([k, a, opt, t]) => window.__hangarSlice(k as string, a as string, opt as never, t as 'mine' | undefined),
      [kind, axis, o, target] as const,
    )

    // ── 機身中線背線與腹線 ──────────────────────────────────
    const cOpt = { from: -3.4, to: 6.4, count: 99, uWindow: [-0.06, 0.06] }
    const rc = await slice('extent', 'z', cOpt) as Extent
    const mc = await slice('extent', 'z', cOpt, 'mine') as Extent
    console.log('\n── 機身中線逐站對切（自家 − 參考，公尺）─────────────')
    console.log('   機體Z   參考背  自家背   背差   參考腹  自家腹   腹差')
    const dU: number[] = [], dD: number[] = []
    for (let k = 0; k < rc.planes.length; k++) {
      const u = mc.vMax[k]! - rc.vMax[k]!
      const b = mc.vMin[k]! - rc.vMin[k]!
      if (Number.isFinite(u)) dU.push(u)
      if (Number.isFinite(b)) dD.push(b)
      if (k % 3 === 0) {
        console.log(`  ${n(rc.planes[k]!, 6, 2)}  ${n(rc.vMax[k]!)} ${n(mc.vMax[k]!)} ${n(u)}`
          + `  ${n(rc.vMin[k]!)} ${n(mc.vMin[k]!)} ${n(b)}`)
      }
    }
    stat(dU, '背線'); stat(dD, '腹線')

    // ── 機身最大半寬 ─────────────────────────────────────────
    const wOpt = { from: -3.3, to: 6.3, count: 49, angles: 72, maxRadius: 1.2 }
    const wr: number[][] = [], wm: number[][] = []
    for (const v of [-0.3, 0.0, 0.3, 0.6]) {
      const a = await slice('radial', 'z', { ...wOpt, axisV: v }) as Radial
      const b = await slice('radial', 'z', { ...wOpt, axisV: v }, 'mine') as Radial
      wr.push(a.r.map((row) => row[0]!)); wm.push(b.r.map((row) => row[0]!))
    }
    console.log('\n── 機身最大半寬（自家 − 參考）─────────────')
    console.log('   機體Z   參考   自家    差')
    const dW: number[] = []
    const planesW = (await slice('radial', 'z', { ...wOpt, axisV: 0 }, 'mine') as Radial).planes
    for (let k = 0; k < wr[0]!.length; k++) {
      const a = Math.max(...wr.map((s) => s[k]!))
      const b = Math.max(...wm.map((s) => s[k]!))
      if (a > 0 && b > 0) {
        dW.push(b - a)
        if (k % 2 === 0) console.log(`  ${n(planesW[k]!, 6, 2)}  ${n(a)} ${n(b)} ${n(b - a)}`)
      }
    }
    stat(dW, '半寬')

    // ── 右半翼 ───────────────────────────────────────────────
    const wing = async (label: string, o: Record<string, unknown>): Promise<void> => {
      const r = await slice('extent', 'x', o) as Extent
      const m = await slice('extent', 'x', o, 'mine') as Extent
      console.log(`\n── ${label}逐站對切（自家 − 參考）───────────────`)
      console.log('      X    參考前  自家前  前緣差   參考後  自家後  後緣差   厚度差')
      const dL: number[] = [], dR: number[] = [], dT: number[] = []
      for (let k = 0; k < r.planes.length; k++) {
        const l = m.uMin[k]! - r.uMin[k]!
        const t = m.uMax[k]! - r.uMax[k]!
        const th = (m.vMax[k]! - m.vMin[k]!) - (r.vMax[k]! - r.vMin[k]!)
        if (Number.isFinite(l)) dL.push(l)
        if (Number.isFinite(t)) dR.push(t)
        if (Number.isFinite(th)) dT.push(th)
        console.log(`  ${n(r.planes[k]!, 6, 2)}  ${n(r.uMin[k]!)} ${n(m.uMin[k]!)} ${n(l)}`
          + `  ${n(r.uMax[k]!)} ${n(m.uMax[k]!)} ${n(t)}  ${n(th)}`)
      }
      stat(dL, '前緣'); stat(dR, '後緣'); stat(dT, '厚度')
    }
    await wing('右半主翼', { from: 0.7, to: 5.6, count: 15, uWindow: [-2.0, 3.0] })
    await wing('右半平尾', { from: 0.3, to: 2.0, count: 8, uWindow: [4.0, 6.5] })
  } finally {
    await browser.close()
  }
}

await main()
