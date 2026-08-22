/**
 * 量兩台轟炸機的砲塔位置 —— **能量的就不要用眼睛判斷**。
 *
 *   npx tsx test/tools/turret-sites.probe.ts     # 需要 npm run dev 開在 5178
 *
 * 【射線原點要放進零件裡】從機身軸心往外打會先打到蒙皮，量到的是外殼不是
 * 砲塔。把原點放進砲塔自己的剖面中心，砲塔的輪廓才會單獨浮出來 —— 這與
 * 座艙罩那一招同源（`.claude/skills/aircraft-from-reference` 第 2 步）。
 *
 * 【每一組都用兩個 maxRadius】`castRay` 對 `t > maxRadius` 的交點是
 * **直接忽略**（`src/tools/sliceRef.ts:111`），不是夾成上界。所以「量到的
 * 值等於 maxRadius」永遠不會發生，不能當驗收判準；真正的風險是**外表面被
 * 截掉之後回報了內部的面或 0**，而那看起來完全正常。唯一可靠的檢查是換一
 * 個更大的半徑重跑，看輪廓有沒有變 —— 下面的「一致」欄就是這件事。
 *
 * 【輸出是彙總不是原始射線】每一刀 72 條射線 × 幾十個站位，原始 JSON 有
 * 兩百多 KB，讀不了。這裡逐站印「上／下／左／右四個方位的半徑 + 最大值」，
 * 砲塔的位置就是最大值明顯鼓起來的那幾站。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/hangar.html'

interface RadialResult {
  axis: string
  planes: number[]
  theta: number[]
  r: number[][]
}

interface ExtentResult {
  axis: string
  planes: number[]
  uMin: number[]
  uMax: number[]
  vMin: number[]
  vMax: number[]
}

interface Cut {
  label: string
  kind: 'radial' | 'extent'
  axis: 'x' | 'y' | 'z'
  opt: Record<string, number | number[]>
  radii?: readonly [number, number]
}

const B17: readonly Cut[] = [
  { label: '上部 Sperry（原點 y=1.15，座艙後）', kind: 'radial', axis: 'z', radii: [0.9, 1.4],
    opt: { from: -2.4, to: 0.6, count: 31, angles: 72, axisV: 1.15 } },
  { label: '球形腹部（原點 y=−1.05，機腹中段）', kind: 'radial', axis: 'z', radii: [0.9, 1.4],
    opt: { from: 0.4, to: 2.8, count: 25, angles: 72, axisV: -1.05 } },
  { label: '尾砲塔（原點 y=1.0）', kind: 'radial', axis: 'z', radii: [0.8, 1.3],
    opt: { from: 15.6, to: 17.4, count: 19, angles: 72, axisV: 1.0 } },
  { label: '腰部（沿 x 切，z 窗 4.0…7.0）', kind: 'extent', axis: 'x',
    opt: { from: 0.3, to: 1.4, count: 12, uWindow: [4.0, 7.0] } },
  { label: '頰槍（沿 x 切，z 窗 −5.4…−3.6）', kind: 'extent', axis: 'x',
    opt: { from: 0.2, to: 1.2, count: 11, uWindow: [-5.4, -3.6] } },
]

const HE111: readonly Cut[] = [
  { label: '機背 B-Stand（原點 y=0.95）', kind: 'radial', axis: 'z', radii: [0.8, 1.3],
    opt: { from: -1.0, to: 1.8, count: 29, angles: 72, axisV: 0.95 } },
  { label: '機腹後 C-Stand（原點 y=−0.75，吊艙）', kind: 'radial', axis: 'z', radii: [0.9, 1.4],
    opt: { from: 4.0, to: 6.0, count: 21, angles: 72, axisV: -0.75 } },
  { label: '側窗（沿 x 切，z 窗 0.8…3.4）', kind: 'extent', axis: 'x',
    opt: { from: 0.2, to: 1.2, count: 11, uWindow: [0.8, 3.4] } },
]

const n = (v: number, w: number, d = 3): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

/** θ 最接近 target 的那一條射線的索引。θ 是弧度（坑 63）。 */
function nearest(theta: readonly number[], target: number): number {
  let best = 0
  let bestD = Infinity
  for (let i = 0; i < theta.length; i++) {
    const d = Math.abs(theta[i]! - target)
    if (d < bestD) { bestD = d; best = i }
  }
  return best
}

function printRadial(a: RadialResult, b: RadialResult | undefined): void {
  const T = Math.PI
  const up = nearest(a.theta, T / 2)
  const down = nearest(a.theta, (3 * T) / 2)
  const right = nearest(a.theta, 0)
  const left = nearest(a.theta, T)
  console.log('       z       上      下      右      左     最大    一致')
  for (let i = 0; i < a.planes.length; i++) {
    const row = a.r[i]!
    const max = Math.max(...row)
    let same = '—'
    if (b !== undefined) {
      const bmax = Math.max(...b.r[i]!)
      same = Math.abs(bmax - max) < 1e-6 ? '是' : `否(${bmax.toFixed(3)})`
    }
    console.log(`  ${n(a.planes[i]!, 7, 2)}${n(row[up]!, 8)}${n(row[down]!, 8)}`
      + `${n(row[right]!, 8)}${n(row[left]!, 8)}${n(max, 8)}   ${same}`)
  }
}

function printExtent(e: ExtentResult): void {
  console.log('       x      z 從      z 到      y 從      y 到')
  for (let i = 0; i < e.planes.length; i++) {
    console.log(`  ${n(e.planes[i]!, 7, 2)}${n(e.uMin[i]!, 9)}${n(e.uMax[i]!, 9)}`
      + `${n(e.vMin[i]!, 9)}${n(e.vMax[i]!, 9)}`)
  }
}

async function slice(
  page: Page, kind: string, axis: string, opt: Record<string, unknown>,
): Promise<unknown> {
  return page.evaluate(([k, a, o]) => (window as unknown as {
    __hangarSlice: (k: string, a: string, o: unknown) => unknown
  }).__hangarSlice(k as string, a as string, o), [kind, axis, opt] as const)
}

async function measure(page: Page, id: string, cuts: readonly Cut[]): Promise<void> {
  const ok = await page.evaluate((x) => (window as unknown as {
    __hangarSpec: (s: string) => boolean }).__hangarSpec(x), id)
  if (!ok) { console.log(`  ${id}：__hangarSpec 回 false`); return }
  await page.evaluate(() => (window as unknown as {
    __hangarRef: (on: boolean, solid: boolean) => Promise<boolean> }).__hangarRef(true, true))
  await page.waitForFunction(() => (window as unknown as {
    __hangarSlice: (k: string, a: string, o: unknown) => unknown
  }).__hangarSlice('radial', 'z',
    { from: 0, to: 0.1, count: 2, angles: 8, axisV: 0, maxRadius: 3 }) !== null,
  undefined, { timeout: 240_000 })

  console.log(`\n══ ${id} ═══════════════════════════════════════════════`)
  for (const cut of cuts) {
    console.log(`\n  ── ${cut.label} ──`)
    if (cut.kind === 'extent') {
      printExtent(await slice(page, cut.kind, cut.axis, cut.opt) as ExtentResult)
      continue
    }
    const [r0, r1] = cut.radii!
    const a = await slice(page, cut.kind, cut.axis,
      { ...cut.opt, maxRadius: r0 }) as RadialResult
    const b = await slice(page, cut.kind, cut.axis,
      { ...cut.opt, maxRadius: r1 }) as RadialResult
    console.log(`  maxRadius ${r0} 對 ${r1}：`)
    printRadial(a, b)
  }
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
  await page.goto(URL)
  await measure(page, 'b17g', B17)
  await measure(page, 'he111', HE111)
  await browser.close()
}
void main()
