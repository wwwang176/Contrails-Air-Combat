import { chromium } from 'playwright'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import ts from 'typescript'

// 僅攔截這個 Playwright 頁面的回應，不修改 src、展示頁或正在試玩的瀏覽器。
const fixture = fs.readFileSync(new URL('./bench-explosion-shaders.browser.js', import.meta.url), 'utf8')
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const output = path.join(root, '.tmpshot', 'explosion-shader-bench', new Date().toISOString().replaceAll(':', '-'))
fs.mkdirSync(output, { recursive: true })
// --pair-only 只補測 ①＋③ 與相鄰原版，不把兩項百分比直接相加。
const pairOnly = process.argv.includes('--pair-only')
// 正式版驗收只載入工作目錄的 shader，不注入候選優化。
const productionCheck = process.argv.includes('--production-check')
const baselineCheck = process.argv.includes('--baseline-check')
const shaderBaselineRef = '4d04bb1a'
const cases = [
  { id: 'fire-near', age: .12, distance: 8 },
  { id: 'handoff-near', age: .42, distance: 8 },
  { id: 'smoke-near', age: .8, distance: 8 },
  { id: 'handoff-far', age: .42, distance: 120 },
  { id: 'handoff-lit', age: .42, distance: 8, lit: true },
  { id: 'fire-night', age: .12, distance: 8, time: 'night' },
].filter((_, index) => !pairOnly || index < 3)
const orders = pairOnly ? Array.from({ length: 3 }, () => ['baseline', 'lightHash', 'baseline']) : [
  ['baseline', 'light', 'zero', 'hash', 'combined', 'baseline'],
  ['baseline', 'combined', 'hash', 'zero', 'light', 'baseline'],
  ['baseline', 'zero', 'combined', 'light', 'hash', 'baseline'],
]
const browser = await chromium.launch({ channel: 'chrome', headless: true })
const results = [], errors = []
let info
function save() {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ info, cases, results, errors }, null, 2))
}
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 })
  page.on('pageerror', e => errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) })
  if (!productionCheck) {
    // 固定已量測過的 shader 基準；正式版更新後仍能重現原來的候選比較。
    for (const file of ['smokeLighting', 'chunks']) {
      const source = execFileSync('git', ['show', `${shaderBaselineRef}:src/render/${file}.ts`], { cwd: root, encoding: 'utf8' })
      const javascript = ts.transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, removeComments: true },
      }).outputText
      await page.route(`**/src/render/${file}.ts*`, async route => {
        const response = await route.fetch()
        const current = await response.text()
        const imports = [...current.matchAll(/\bfrom\s*["']([^"']+)["']/g)].map(match => match[1])
        // 沿用 Vite 已解析的 URL（包含 HMR 版本），避免載入第二份共用狀態模組。
        const body = javascript.replace(/\bfrom\s*["']([^"']+)["']/g, (_, specifier) => {
          const pathname = new URL(specifier, route.request().url()).pathname + '.ts'
          const resolved = imports.find(url => specifier === 'three'
            ? url.split('?')[0].endsWith('/three.js')
            : url.split('?')[0] === pathname)
          if (!resolved) throw new Error('無法解析基準 shader 的 import：' + specifier)
          return 'from ' + JSON.stringify(resolved)
        })
        await route.fulfill({ response, body })
      })
    }
  }
  await page.route('**/src/tools/smoke.ts*', async route => {
    const response = await route.fetch()
    const original = await response.text()
    if (!original.includes('requestAnimationFrame(frame);')) throw new Error('找不到展示頁動畫入口')
    const body = original.replaceAll('requestAnimationFrame(frame);', '') + '\n' + fixture
    await route.fulfill({ response, body })
  })
  await page.goto(process.env.BENCH_URL ?? 'http://localhost:5173/tools/smoke.html')
  await page.waitForFunction(() => window.__explosionBench, null, { timeout: 60000 })
  info = await page.evaluate(() => window.__explosionBench.info)
  info.shaderSource = productionCheck ? 'working-directory' : shaderBaselineRef
  console.log(JSON.stringify({ output, info }))
  // 第一階段先重新量原版，之後每輪的頭尾也量原版，辨識溫度與其他負載造成的漂移。
  for (const spec of cases) {
    const setup = await page.evaluate(spec => window.__explosionBench.setup(spec), spec)
    const result = await page.evaluate(() => window.__explosionBench.measure('baseline', 60, true))
    results.push({ phase: 'fresh-baseline', setup, ...result })
    await page.locator('#scene').screenshot({ path: path.join(output, spec.id + '-baseline.png') })
    save()
    console.log(JSON.stringify({ phase: 'fresh-baseline', case: spec.id, gpu: result.gpu.median }))
    if (errors.length) throw new Error(errors.join('\n'))
  }
  for (const spec of productionCheck || baselineCheck ? [] : cases) {
    const setup = await page.evaluate(spec => window.__explosionBench.setup(spec), spec)
    for (let round = 0; round < orders.length; round++) {
      for (const variant of orders[round]) {
        const result = await page.evaluate(variant => window.__explosionBench.measure(variant), variant)
        results.push({ phase: 'comparison', setup, round, ...result })
        if (round === 0 && variant !== 'baseline') {
          await page.locator('#scene').screenshot({ path: path.join(output, spec.id + '-' + variant + '.png') })
        }
        save()
        console.log(JSON.stringify({ case: spec.id, round, variant, gpu: result.gpu.median, image: result.image }))
        if (errors.length) throw new Error(errors.join('\n'))
      }
    }
  }
} finally {
  save()
  await browser.close()
}
