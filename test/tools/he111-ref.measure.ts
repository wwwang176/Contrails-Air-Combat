/**
 * He 111 H-6 參考模型的切片量測。**不由 vitest 執行**。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                              # 終端機一
 * npx vite-node test/tools/he111-ref.measure.ts -- align   # 終端機二
 * ```
 *
 * 【`URL` 的埠要對】vite 在 5173 被佔用時會往上找，開跑前看終端機一那一行。
 *
 * ── 這支腳本在整條產線的哪一格 ──────────────────────────────
 *
 * `.claude/skills/aircraft-from-reference` 第 2 步。**坑 16 是這裡最貴的一條**：
 * 機身、機翼、尾翼、座艙、進氣口必須**在同一次切片、同一個座標系**量出來，
 * 最後才整體平移一次。分批量的代價是「每個零件自己都對，彼此的關係錯
 * 0.85 m，而且側視疊圖看不出來」。
 *
 * 所以這支腳本一次跑完全部的量測階段，共用同一組對齊參數。
 *
 * ── 對齊參數 ────────────────────────────────────────────────
 *
 * 與 `src/tools/hangar.ts` 的 `REFS.he111` **同一組**，量法見那裡的註解。
 * 寫在這裡而不是 import：機庫是瀏覽器端的模組，這支是 node 端的驅動腳本，
 * 為了三個數字把 three 整包拉進 node 不划算。**兩邊不一致會被 `align`
 * 階段抓到** —— 它會驗「機首在 −Z、翼展在 X、機翼是平的」。
 */
import { chromium, type Page } from 'playwright'
import type { Align, Extent, Probe } from './hangar-hooks'

/**
 * 【為什麼要自己宣告 `process`】專案的 `tsconfig` 沒有把 `node` 放進 `types`，
 * 所以 `process` 沒有型別 —— 而 `tsc --noEmit` 會掃到 `test/` 底下。
 *
 * 為了一支開發腳本的一個欄位把 `@types/node` 拉進整個專案，代價是全專案的
 * 型別環境多一整組 node 的全域名稱（`Buffer`、`__dirname`、`require`…），
 * 而那些在瀏覽器端的程式裡出現時**應該要紅**。宣告用到的那一個欄位就好。
 */
declare const process: { argv: readonly string[] }

const URL = 'http://localhost:5177/tools/hangar.html'
const GLB = '/ref/he_111-h6.glb'
const SHOTS = '.shots/'

/**
 * He 111 H-6 的史實值。**坑 21：每個量到的數字都要先問有沒有史實值可以對。**
 *
 * 有史實值而且對得上 → 採量測值；對不上 → 史實優先，量測值只拿來定位置。
 */
const REAL = {
  span: 22.60,
  length: 16.40,
  /** 停放高度（尾輪著地），飛行姿態量不到這個數字 */
  heightOnGround: 4.00,
  wingArea: 86.5,
  /** 水平尾翼翼展 */
  tailSpan: 7.60,
}

/**
 * 對齊。**yaw 的正負由 `align` 階段實證，不要憑算的。**
 *
 * yaw −90：這台模型機首朝 −X、翼展在 Z。繞 Y 轉 −90° 之後機首朝 −Z、
 *          翼展落到 X —— 與專案的機體座標一致（機首 −Z、右翼 +X）。
 * pitch 2.4：機首朝下 2.4°，往上轉回來。
 * scale：22.60 / 3.7646（切片量到的翼展）。
 */
const ALIGN: Align = { yaw: -90, pitch: 2.4, scale: 6.003285 }

const n = (v: number, w = 7, d = 3): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

async function main(): Promise<void> {
  // 【跑法】`npx vite-node test/tools/he111-ref.measure.ts -- <階段>`
  // 【`?? ''`】`noUncheckedIndexedAccess` 下索引出來是 `string | undefined`
  const stage = process.argv[process.argv.length - 1] ?? ''
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
    await page.goto(URL)
    await page.waitForFunction(() => '__hangarProbe' in window, null, { timeout: 30000 })

    /**
     * 【`verify` 走的是機庫自己的疊圖路徑，不是 probe】
     *
     * `__hangarProbe` 是給「還沒有自家模型」用的旁路：它自己套一組對齊參數，
     * 不經過 `placeRef`。而驗收要問的正是**遊戲裡實際疊出來的那一份對不對**
     * —— 用旁路量等於驗了一個玩家永遠看不到的東西。
     *
     * 所以 `verify` 先切機種、再開參考模型，讓 `syncRef → placeRef` 照常跑。
     */
    let probe: Probe = {
      tris: 0, meshes: 0, min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], parts: [],
    }
    const overlay = ['verify', 'belly', 'nacverify', 'rootfillet']
    if (overlay.includes(stage)) {
      await page.evaluate(() => window.__hangarSpec('he111'))
      for (let i = 0; i < 120; i++) {
        if (await page.evaluate(() => window.__hangarRef(true, false))) break
        await page.waitForTimeout(500)
      }
      console.log('走機庫的 placeRef 疊圖路徑（不是 __hangarProbe 旁路）\n')
    } else {
      probe = await page.evaluate(
        ([u, a]) => window.__hangarProbe(u as string, a as typeof ALIGN),
        [GLB, ALIGN] as const,
      )
      console.log(`載入 ${probe.tris.toLocaleString()} 三角形、${probe.meshes} 個 mesh，已套對齊`)
      console.log(`對齊參數  yaw ${ALIGN.yaw}°  pitch ${ALIGN.pitch}°  scale ${ALIGN.scale}\n`)
    }

    const slice = (
      kind: 'radial' | 'extent', axis: string, o: Record<string, unknown>,
      target?: 'mine', only?: string,
    ) =>
      page.evaluate(
        ([k, a, opt, t, m]) => window.__hangarSlice(
          k as string, a as string, opt as never, t as 'mine' | undefined, m as string | undefined,
        ),
        [kind, axis, o, target, only] as const,
      )

    // 【不認識的名字退回 align】它最便宜，也是後面每一格的前提
    await (stages[stage] ?? stages['align']!)(page, probe, slice)
  } finally {
    await browser.close()
  }
}

type Slicer = (
  k: 'radial' | 'extent', a: string, o: Record<string, unknown>, t?: 'mine', only?: string,
) => Promise<unknown>
type Stage = (page: Page, probe: Probe, slice: Slicer) => Promise<void>

const stages: Record<string, Stage> = {
  /**
   * 【分件清單】參考模型自己怎麼把飛機切成 mesh。
   *
   * 【為什麼這是量測而不是偷懶】坑 5 說的是「**不要靠節點分類去隔離機身**」
   * —— 那是因為機身的蒙皮、內裝、隔框在第三方模型裡混成一團，猜不準。但
   * **玻璃**不一樣：它是另一種材質，任何模型都會把它分成獨立的 mesh。
   *
   * 而玻璃的範圍正是我用切片量不到的東西（坑 15）—— 射線只會回報「最外側
   * 打到什麼」，不會說那是蒙皮還是玻璃。所以這一格拿的是**包圍盒**（一個
   * 保守、不需要分類正確就成立的量），不是形狀。
   */
  parts: async (_page, probe) => {
    console.log(`── ${probe.parts.length} 個 mesh，依三角形數排序 ──────────`)
    console.log('  三角形  名稱                          X範圍            Y範圍            Z範圍')
    const sorted = [...probe.parts].sort((a, b) => b.tris - a.tris)
    for (const p of sorted) {
      if (p.tris < 20) continue
      console.log(
        `  ${String(p.tris).padStart(6)}  ${p.name.slice(0, 26).padEnd(28)}`
        + `${n(p.min[0]!, 6, 2)}..${n(p.max[0]!, 6, 2)}  `
        + `${n(p.min[1]!, 6, 2)}..${n(p.max[1]!, 6, 2)}  `
        + `${n(p.min[2]!, 6, 2)}..${n(p.max[2]!, 6, 2)}`,
      )
    }
    const glassy = sorted.filter((p) => /glass|canop|window|glaz|cockpit|cristal|vidr/i.test(p.name))
    console.log(`\n── 名字看起來像玻璃的 ${glassy.length} 個 ──────────────`)
    for (const p of glassy) {
      console.log(`  ${p.name}  Z ${n(p.min[2]!)}..${n(p.max[2]!)}  X ±${n(p.max[0]!)}`
        + `  Y ${n(p.min[1]!)}..${n(p.max[1]!)}`)
    }
  },

  /**
   * 【機首尖端到底在哪】`bake` 的第一站取 `align` 量到的幾何 Z 下界 −0.5，
   * 但 `align` 的那一刀是 0.5 m 一格、而且**整台一起量** —— 螺旋槳圓盤在
   * X ±2.6，它比機身還前面。用它當機身首站等於把機首拉長。
   *
   * 這一格沿 Z 每 0.05 m 切一刀，`uWindow` 壓在 X ±1.2（排掉螺旋槳與
   * 發動機艙），看機身自己的線段從哪一刀開始出現。
   */
  nose: async (_page, _probe, slice) => {
    const ez = await slice('extent', 'z', {
      from: -1.2, to: 1.4, count: 53, uWindow: [-1.2, 1.2],
    }) as Extent
    console.log('── 機首（uWindow X ±1.2，排掉螺旋槳與發動機艙）──────')
    console.log('   量測Z   機體Z    X幅度     Y下      Y上   線段數')
    for (let i = 0; i < ez.planes.length; i++) {
      if (ez.count[i]! === 0) continue
      console.log(
        `  ${n(ez.planes[i]!, 6, 2)}  ${n(ez.planes[i]! - 2.7465, 6, 2)}`
        + `  ${n(ez.uMax[i]! - ez.uMin[i]!)}  ${n(ez.vMin[i]!)}  ${n(ez.vMax[i]!)}`
        + `  ${String(ez.count[i]).padStart(6)}`,
      )
    }
    const live = ez.planes.filter((_, i) => ez.count[i]! > 0)
    console.log(`\n  機身自己的 Z 下界 ${n(live[0]!)}（機體 ${n(live[0]! - 3.0889)}）`)

    /**
     * 【兩把尺對不上就先查尺】上面那張表（`extentSlices`，量三角形頂點）說
     * 量測 −0.10 的 X 幅度是 0.355，也就是半寬 0.18；而 `bake` 用的
     * `radialSlices`（射線取最外側）在同一站給 0.32。**兩者不可能同時對**，
     * 而烘進機身的是後者 —— 機首因此在 0.04 m 內張開成一片圓盤。
     *
     * 這一格把兩把尺並排。射線多出來的那一截打到什麼，看得出來。
     */
    const rs = await slice('radial', 'z', {
      from: -0.15, to: 0.45, count: 13, angles: 144, axisV: 0.25, maxRadius: 1.45,
    }) as { planes: number[]; theta: number[]; r: number[][] }
    console.log('\n── 兩把尺並排：射線的最大半寬 vs 線段的 X 幅度 ──')
    console.log('   量測Z   射線半寬  線段半寬    差   射線最遠(任意角)')
    for (let k = 0; k < rs.planes.length; k++) {
      const z = rs.planes[k]!
      const row = rs.r[k]!
      // 射線量到的最大 |x|
      let rx = 0, far = 0
      for (let j = 0; j < rs.theta.length; j++) {
        if (row[j]! <= 0) continue
        rx = Math.max(rx, Math.abs(row[j]! * Math.cos(rs.theta[j]!)))
        far = Math.max(far, row[j]!)
      }
      // 同一站的線段幅度：在上面那張表裡找最接近的一刀
      let best = 0
      for (let i = 0; i < ez.planes.length; i++) {
        if (Math.abs(ez.planes[i]! - z) < Math.abs(ez.planes[best]! - z)) best = i
      }
      const seg = ez.count[best]! > 0 ? (ez.uMax[best]! - ez.uMin[best]!) / 2 : NaN
      console.log(`  ${n(z, 6, 2)}  ${n(rx)}  ${n(seg)}  ${n(rx - seg)}  ${n(far)}`)
    }
  },

  /**
   * 【玻璃機首】只切 `windows_windows_0` 這一個 mesh，量玻璃自己的剖面。
   *
   * 回答兩個問題：
   *   縱向到哪  哪些站位有玻璃 → 座艙開口的前後界
   *   環向多寬  每站的玻璃上下界與半寬 → 罩頂與艙緣
   *
   * 【只取機首那一段】玻璃 mesh 的包圍盒橫跨全翼展（X ±11.26）—— 裡面
   * 混了側窗、機腹吊艙、機背機槍座。所以射線只從機身軸射，`maxRadius`
   * 壓在 1.6（機首最寬 0.88，留餘裕），翼上的燈罩自然落選。
   */
  glass: async (_page, _probe, slice) => {
    const AXIS_V = 0.25
    const QC = 3.0889
    const ONLY = 'windows'
    /**
     * 【`he111.hull.ts` 的十六個輸出角】玻璃要貼在**外殼的哪幾片**上，所以
     * 要問的不是「玻璃佔剖面幾成」，而是「第幾號到第幾號那幾片是玻璃」。
     */
    const OUT_DEG = Array.from({ length: 16 }, (_, i) => 90 - i * 12)
    const opt = {
      from: -0.4, to: 11.6, count: 61, angles: 144, axisV: AXIS_V, maxRadius: 1.6,
    }
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    const g = await slice('radial', 'z', opt, undefined, ONLY) as Rad
    const all = await slice('radial', 'z', opt) as Rad

    /** 某個角度附近 ±6° 有沒有射線打到 */
    const hitAt = (row: readonly number[], T: readonly number[], deg: number): boolean => {
      const want = deg * Math.PI / 180
      for (let j = 0; j < T.length; j++) {
        let d = T[j]! - want
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        if (Math.abs(d) <= 6 * Math.PI / 180 && row[j]! > 0) return true
      }
      return false
    }

    console.log(`── 只切 mesh /${ONLY}/：玻璃落在哪幾號輸出角 ────`)
    console.log('  索引 0 = 正上方、15 = 正下方（與 he111.hull.ts 同一組角）')
    console.log('   量測Z   機體Z   0123456789012345   說明')
    for (let k = 0; k < g.planes.length; k++) {
      const row = g.r[k]!
      const mark = OUT_DEG.map((deg) => (hitAt(row, g.theta, deg) ? '#' : '.')).join('')
      // 同站位整台的剖面，讓「玻璃就是蒙皮」看得出來
      const top = AXIS_V + (all.r[k]![0] ?? 0)
      console.log(
        `  ${n(g.planes[k]!, 6, 2)}  ${n(g.planes[k]! - QC, 6, 2)}   ${mark}`
        + `   蒙皮背頂 ${n(top, 6, 2)}`,
      )
    }

    // 玻璃自己的上下界，量出機背座艙與腹艙吊艙的高度
    console.log('\n── 玻璃自己的背頂與腹底（沒打到就是 —）──────')
    console.log('   量測Z   機體Z   玻璃背頂  玻璃腹底  玻璃半寬')
    const T = g.theta
    const iAt = (deg: number) =>
      T.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[b]! - deg * Math.PI / 180) ? j : b
      ), 0)
    const [up, ri, dn] = [iAt(90), iAt(0), iAt(270)]
    for (let k = 0; k < g.planes.length; k++) {
      const row = g.r[k]!
      console.log(
        `  ${n(g.planes[k]!, 6, 2)}  ${n(g.planes[k]! - QC, 6, 2)}`
        + `  ${n(row[up]! > 0 ? AXIS_V + row[up]! : NaN)}`
        + `  ${n(row[dn]! > 0 ? AXIS_V - row[dn]! : NaN)}`
        + `  ${n(row[ri]! > 0 ? row[ri]! : NaN)}`,
      )
    }
  },

  /**
   * 【機背機槍座】兩個問題一起問：
   *
   *   一、開口有多寬  `bake` 只把**正上方**那一條標成量不到，但開口顯然更寬
   *       —— 烘出來的第 1、2 點各塌下去 0.43／0.21 m，而第 0 點是內插的平滑
   *       線，於是機背變成「中間一條脊、兩旁兩條溝」。標多寬要用量的。
   *
   *   二、玻璃在蒙皮之上還是之下  真機的 B-Stand 是**凸起的玻璃罩**還是嵌進
   *       機背的窗，決定造型該做凸還是做凹。把 `windows` mesh 的背頂與整台的
   *       背頂並排就看得出來。
   */
  dorsal: async (_page, _probe, slice) => {
    const AXIS_V = 0.25
    const QC = 3.0889
    const opt = {
      from: 3.2, to: 7.4, count: 22, angles: 144, axisV: AXIS_V, maxRadius: 1.6,
    }
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    const all = await slice('radial', 'z', opt) as Rad
    const gl = await slice('radial', 'z', opt, undefined, 'windows') as Rad
    const at = (T: readonly number[], deg: number) =>
      T.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[b]! - deg * Math.PI / 180) ? j : b
      ), 0)

    console.log('── 一、整台的 r(θ)：開口把哪幾條射線吞掉了 ────')
    console.log('  每一欄是離正上方幾度（負＝右側）。單條射線，不取中位數')
    const DEGS = [90, 84, 78, 72, 66, 60, 54, 48, 42]
    console.log('   量測Z   機體Z ' + DEGS.map((d) => `${String(d).padStart(7)}°`).join(''))
    for (let k = 0; k < all.planes.length; k++) {
      const row = all.r[k]!
      console.log(
        `  ${n(all.planes[k]!, 6, 2)}  ${n(all.planes[k]! - QC, 6, 2)} `
        + DEGS.map((d) => n(row[at(all.theta, d)]!, 8)).join(''),
      )
    }

    console.log('\n── 二、玻璃的背頂 vs 蒙皮的背頂（正上方單條射線）──')
    console.log('   量測Z   機體Z   蒙皮背頂  玻璃背頂    差')
    const up = at(all.theta, 90)
    for (let k = 0; k < all.planes.length; k++) {
      const skin = all.r[k]![up]!
      const g = gl.r[k]![up]!
      console.log(
        `  ${n(all.planes[k]!, 6, 2)}  ${n(all.planes[k]! - QC, 6, 2)}`
        + `  ${n(skin > 0 ? AXIS_V + skin : NaN)}  ${n(g > 0 ? AXIS_V + g : NaN)}`
        + `  ${n(g > 0 && skin > 0 ? g - skin : NaN)}`,
      )
    }
  },

  /**
   * 【烘焙腹艙（Bola）】吐成 `LoftPart` 的截面串，貼進 `he111.ts`。
   *
   * 【為什麼它不能烘進機身外殼】外殼一圈只有 16 點，相鄰兩點差 12°。吊艙的
   * 半寬只有 0.3 而它掛在 1.5 m 遠的地方 —— 偏 12° 的那一點橫向已經是 0.31，
   * **早就在吊艙外面了**。所以外殼在那裡做出來的是一根沿中線的尖刺，不是
   * 一顆圓凸起。這與發動機艙是同一個判斷：**尺度夠大又不在剖面取樣解析度
   * 之內的東西，要另外做成零件。**
   *
   * 【射線原點放在吊艙裡】(0, −1.05) 在吊艙內部、機身腹線之下。往下與往兩側
   * 的射線因此直接打到吊艙的壁。**往上的射線沒有意義** —— 吊艙與機身在參考
   * 模型裡是同一個實體，中間沒有面；上界改用機身自己的腹線（由 `bake` 在
   * 那一段內插出來的那條）。
   */
  bolabake: async (_page, _probe, slice) => {
    const QC = 3.0889
    /** 射線原點的高度：機身**裡面**，遠高於腹線 —— 起點在實體內，最遠命中
     *  就是該站的最低外表面（見 `bolafloor` 的檔頭） */
    const AXIS_V = 0.30
    /** 【x 從 0.10 起】0 那一欄會打到中線上的兩根桿子 */
    const XS = Array.from({ length: 11 }, (_, i) => 0.10 + i * 0.05)
    const FROM = 4.8, TO = 9.2, N = 45
    const cols: number[][] = []
    let planes: number[] = []
    for (const x of XS) {
      const rs = await slice('radial', 'z', {
        from: FROM, to: TO, count: N, angles: 144,
        axisU: x, axisV: AXIS_V, maxRadius: 2.0,
      }) as { planes: number[]; theta: number[]; r: number[][] }
      const dn = rs.theta.reduce((b, th, j) => (
        Math.abs(th - 270 * Math.PI / 180) < Math.abs(rs.theta[b]! - 270 * Math.PI / 180)
          ? j : b
      ), 0)
      planes = rs.planes
      cols.push(rs.planes.map((_, k) => (rs.r[k]![dn]! > 0 ? AXIS_V - rs.r[k]![dn]! : NaN)))
    }

    /**
     * 【沒有吊艙時的蒙皮】每一個 x 各自沿 z 補洞：吊艙佔 5.6…8.4，兩側各取
     * 一段乾淨的站位配一條直線。與機身外殼補洞同一招 —— 機身在這一段是
     * 平滑的，兩端接得上就對。
     */
    const A0 = planes.findIndex((m) => m >= 4.8), A1 = planes.findIndex((m) => m > 5.5)
    const B0 = planes.findIndex((m) => m >= 8.5), B1 = planes.findIndex((m) => m > 9.2)
    const skins = cols.map((c) => {
      const mean = (i0: number, i1: number) => {
        let s = 0, n = 0
        for (let i = i0; i < i1; i++) if (Number.isFinite(c[i]!)) { s += c[i]!; n++ }
        return { z: (planes[i0]! + planes[i1 - 1]!) / 2, y: s / n }
      }
      const a = mean(A0, A1), b = mean(B0, B1 < 0 ? planes.length : B1)
      return (m: number) => a.y + (b.y - a.y) * ((m - a.z) / (b.z - a.z))
    })

    /** 吊艙算「有」的門檻：比同一個 x 的蒙皮低 0.03 */
    const DEEP = 0.03
    console.log('── 腹艙（朝下射線橫掃 X、蒙皮逐欄補洞）──────────')
    console.log('   量測Z   機體Z   艙底    半寬   蒙皮@半寬   halfHeight  centerY')
    const secs: { z: number; hw: number; hh: number; cy: number }[] = []
    const shape: { u: number; d: number }[] = []
    for (let k = 0; k < planes.length; k++) {
      const m = planes[k]!
      const depth = cols.map((c, j) => (Number.isFinite(c[k]!) ? skins[j]!(m) - c[k]! : 0))
      if (!(depth[0]! > DEEP)) continue
      /** 半寬＝深度掉到門檻的那個 x（兩欄之間線性內插） */
      let hw = XS[0]!
      for (let j = 1; j < XS.length; j++) {
        if (depth[j]! > DEEP) { hw = XS[j]!; continue }
        const t = (depth[j - 1]! - DEEP) / (depth[j - 1]! - depth[j]!)
        hw = XS[j - 1]! + (XS[j]! - XS[j - 1]!) * t
        break
      }
      /**
       * 【centerY 取「半寬處的蒙皮高度」，不是腹線】`loft` 產生的是一根管子，
       * 它在 |x| = halfWidth 的地方剛好是 centerY。centerY 若低於該處的蒙皮，
       * 管子的**肩膀**就會露在機身外面 —— 側視看到的是一道從頭到尾的稜線，
       * 一個掛在機腹下的托盤。把上緣釘在中線的腹線上（再多埋 0.05）的話，
       * 肩膀會整條露出來，看起來像「外推太多」。
       */
      // 兩欄之間線性內插，不要取最近的一欄 —— 半寬只要跨過欄界，centerY
      // 就會跳一格（實測 4.71→4.81 跳 0.04），烘出來是一道橫向的摺
      let jj = XS.findIndex((x) => x >= hw)
      if (jj <= 0) jj = 1
      const t2 = (hw - XS[jj - 1]!) / (XS[jj]! - XS[jj - 1]!)
      const centerY = skins[jj - 1]!(m) + (skins[jj]!(m) - skins[jj - 1]!(m)) * t2
      const bottom = cols[0]![k]!
      secs.push({ z: m - QC, hw, hh: centerY - bottom, cy: centerY })
      // 剖面指數：量半寬一半的位置有多深，跟超橢圓對照
      const half = XS.findIndex((x) => x >= hw / 2)
      if (half > 0 && Number.isFinite(cols[half]![k]!)) {
        shape.push({ u: XS[half]! / hw, d: (centerY - cols[half]![k]!) / (centerY - bottom) })
      }
      console.log(
        `  ${n(m, 6, 2)}  ${n(m - QC, 6, 2)}  ${n(bottom)}  ${n(hw)}  ${n(centerY)}`
        + `   ${n(centerY - bottom)}  ${n(centerY)}`,
      )
    }

    /**
     * 【roundness 用量到的剖面反解，不要用猜的】超橢圓 (x/a)^n + (y/b)^n = 1，
     * 代入半寬一半處的深度比 d：n = ln(1 − dⁿ)… 沒有封閉解，直接掃。
     */
    let best = 2, bestErr = Infinity
    for (let nn = 1.6; nn <= 4.01; nn += 0.05) {
      let e = 0
      for (const s of shape) e += ((1 - s.u ** nn) ** (1 / nn) - s.d) ** 2
      if (e < bestErr) { bestErr = e; best = nn }
    }
    console.log(`\n  剖面指數（roundness）最小平方 ${best.toFixed(2)}`
      + `  樣本 ${shape.length}  RMS ${Math.sqrt(bestErr / Math.max(shape.length, 1)).toFixed(3)}`)

    /**
     * 前後各接收尖的截面。**尾端要分兩站，而且寬度與高度一起收** —— 量到的
     * 最後一站高度只剩 0.16 但寬度還有 0.40，只收高度會在尾端做出一片寬扁的
     * 楔子 —— 玻璃尾段要平整。
     */
    const head = secs[0]!, rear = secs[secs.length - 1]!
    secs.unshift({ z: head.z - 0.10, hw: 0.04, hh: 0.04, cy: head.cy })
    secs.push({ z: rear.z + 0.10, hw: rear.hw * 0.55, hh: rear.hh * 0.5, cy: rear.cy })
    secs.push({ z: rear.z + 0.20, hw: 0.04, hh: 0.03, cy: rear.cy })

    console.log('\n  sections: [')
    for (const s of secs) {
      console.log(
        `    { z: ${s.z.toFixed(3)}, halfWidth: ${s.hw.toFixed(3)},`
        + ` halfHeight: ${s.hh.toFixed(3)}, centerY: ${s.cy.toFixed(3)} },`,
      )
    }
    console.log('  ],')
  },

  /**
   * 【腹艙的底線，從機身**裡面**往下打，而且橫移出中線】
   *
   * ── 為什麼 `bolabake` 量到的深度是假的 ────────────────────
   *
   * `bolabake` 把射線原點放在 (0, −1.05)，理由是「從艙裡面往外打」。但
   * `castRay` 取的是 maxRadius 之內**最遠**的一次命中 —— 朝下的射線穿過
   * 艙底之後還會繼續走 0.9 m，而**中線上掛著兩根細桿**（參考模型的實體
   * 截圖看得到，一根長的在前、一根短的在後）。量到的「艙底」從頭到尾
   * 是桿子的下端，不是艙。
   *
   * 那張表自己就露了餡：半寬 0 的那幾站（量測 5.5～5.8、8.1～8.4）艙底仍然
   * 讀得出 −1.09…−1.29，而且與艙身那一段接成一條**連續的 V**。真正的艙在
   * 那裡根本不存在，能連成一條線的只有一路貫穿的東西。
   *
   * 這是同一個坑的第三次：**「最遠命中」＋「中線上有細長的東西」**。前兩次
   * 是機背開口被天線鋼索騙、垂尾被量成懸空。
   *
   * ── 這一格的量法 ──────────────────────────────────────
   *
   * 原點放在機身**裡面**（y = +0.30，遠高於腹線），朝下打，maxRadius 2.0
   * —— 起點一定在實體內，最遠命中就是該站的**最低外表面**，沒有「在不在
   * 裡面」的模糊。再把原點沿 X 橫移：桿子在 x = 0，橫移 0.1 就打不到了。
   *
   * x = 0 那一欄與其他欄的差，就是桿子有多長。
   */
  bolafloor: async (_page, _probe, slice) => {
    const QC = 3.0889
    const XS = [0.0, 0.10, 0.20, 0.30, 0.45, 0.60]
    const cols: number[][] = []
    let planes: number[] = []
    for (const x of XS) {
      const rs = await slice('radial', 'z', {
        from: 4.6, to: 9.6, count: 51, angles: 144,
        axisU: x, axisV: 0.30, maxRadius: 2.0,
      }) as { planes: number[]; theta: number[]; r: number[][] }
      const dn = rs.theta.reduce((b, th, j) => (
        Math.abs(th - 270 * Math.PI / 180) < Math.abs(rs.theta[b]! - 270 * Math.PI / 180)
          ? j : b
      ), 0)
      planes = rs.planes
      cols.push(rs.planes.map((_, k) => (rs.r[k]![dn]! > 0 ? 0.30 - rs.r[k]![dn]! : NaN)))
    }
    console.log('── 腹部最低面：原點 (x, +0.30) 朝下、maxRadius 2.0（量測系）──')
    console.log('   量測Z   機體Z ' + XS.map((x) => `  x=${x.toFixed(2)}`).join('') + '   桿長')
    for (let k = 0; k < planes.length; k++) {
      const v = cols.map((c) => c[k]!)
      const rod = v[1]! - v[0]!
      console.log(
        `  ${n(planes[k]!, 6, 2)}  ${n(planes[k]! - QC, 6, 2)}`
        + v.map((d) => n(d)).join('') + `  ${n(rod)}`,
      )
    }
  },

  /**
   * 【翼根整流罩：參考模型有、我沒有】沿 **X** 切，只看 |x| ≥ 0.95 ——
   * 機身最寬只有 0.90，所以那些切面裡**只剩機翼**（與長在它上面的整流罩）。
   * `uWindow` 在 x 切面上擋的是 z，用它把尾翼排掉。
   *
   * 每一刀的 z 下界＝前緣、上界＝後緣。參考模型的前緣在 x 0.95 附近若明顯
   * 比我的更前面，那一段就是整流罩。
   */
  rootfillet: async (_page, _probe, slice) => {
    /**
     * 【`uWindow` 一定要把螺旋槳擋掉】第一次跑窗開到 −3.5，前緣整欄讀出
     * −2.66 —— 那是槳葉（`propZ` −2.64、槳盤半徑 1.75，橫向掃過 x 0.85…4.35），
     * 不是機翼。窗改成 −2.0：翼根前緣在 −1.04，離窗還有 1 m。
     */
    const opt = { from: 0.95, to: 4.0, count: 32, uWindow: [-2.0, 6.0] as [number, number] }
    const mine = await slice('extent', 'x', opt, 'mine') as Extent
    const ref = await slice('extent', 'x', opt) as Extent
    console.log('── 翼根（沿 X 切，只留 |x| ≥ 0.95 的機翼段）────────')
    console.log('      X   ── 前緣 ──   ── 後緣 ──   ── 弦長 ──')
    console.log('          自家   參考   自家   參考   自家   參考')
    for (let k = 0; k < mine.planes.length; k++) {
      if (mine.count[k]! === 0 && ref.count[k]! === 0) continue
      const [a0, a1] = [mine.uMin[k]!, mine.uMax[k]!]
      const [b0, b1] = [ref.uMin[k]!, ref.uMax[k]!]
      console.log(
        `  ${n(mine.planes[k]!, 6, 2)}${n(a0, 7, 2)}${n(b0, 7, 2)}`
        + `${n(a1, 7, 2)}${n(b1, 7, 2)}${n(a1 - a0, 7, 2)}${n(b1 - b0, 7, 2)}`,
      )
    }
  },

  /**
   * 【腹艙有多寬】朝下的射線，原點沿 X 橫移 —— 與 `nactail` 同一招。
   *
   * 【要分辨什麼】機腹那一段深下去的東西可能是**一條窄吊艙（Bola）**，也可能
   * 是**整個機腹都那麼深**。前者只在 |x| < 0.4 深，後者一路深到機身的半寬
   * 0.88。側視圖上兩者長得一模一樣。
   *
   * 這決定造型要做成「掛在機腹下的一顆凸起」還是「機身腹線本來就低」。
   */
  bolawidth: async (_page, _probe, slice) => {
    const QC = 3.0889
    const XS = [0.0, 0.2, 0.4, 0.6, 0.8]
    const cols: number[][] = []
    let planes: number[] = []
    for (const x of XS) {
      const rs = await slice('radial', 'z', {
        from: 4.5, to: 9.5, count: 51, angles: 144,
        axisU: x, axisV: 0.25, maxRadius: 2.1,
      }) as { planes: number[]; theta: number[]; r: number[][] }
      planes = rs.planes
      const dn = rs.theta.reduce((b, th, j) => (
        Math.abs(th - 270 * Math.PI / 180) < Math.abs(rs.theta[b]! - 270 * Math.PI / 180)
          ? j : b
      ), 0)
      cols.push(rs.r.map((row) => (row[dn]! > 0 ? 0.25 - row[dn]! : NaN)))
    }
    console.log('── 腹線，射線原點沿 X 橫移（量測系）──────────')
    console.log('   量測Z   機體Z ' + XS.map((x) => `   x=${x.toFixed(1)}`).join(''))
    for (let k = 0; k < planes.length; k++) {
      console.log(
        `  ${n(planes[k]!, 6, 2)}  ${n(planes[k]! - QC, 6, 2)} `
        + cols.map((c) => n(c[k]!, 8)).join(''),
      )
    }
  },

  /**
   * 【烘焙發動機艙】把截面串吐成 `FuselageSection[]` 的字面值，貼進 `he111.ts`。
   *
   * 【為什麼要烘而不是手抄】從 0.4 m 的表格**手抄**成 16 個截面，會抄出
   * 曲率反轉（halfHeight 0.668→0.675、centerY −0.041→−0.033）—— 那是純粹的
   * 抄寫雜訊，沒有任何東西會提醒你。機身是烘的，這裡沒有理由不是。
   *
   * 【四個方向各有各的問題】
   *   上緣  乾淨（艙上面只有螺旋槳，而它在更前面）
   *   下緣  乾淨，但**有一道真的垂直面**（散熱器進氣口，一步 0.33）
   *   外側  y = 0 的射線會穿出艙、打到**機翼的表面** —— 實測 m=2.20 那一站
   *         回 1.087，而鄰站是 0.66／0.69。外側比內側大 0.20 以上就是它。
   *   內側  同樣的問題，但艙在內側比較深，被穿透的機會少
   *
   * 【坑 15：艙的寬度在機翼覆蓋的那一段量不到】艙與機翼在參考模型裡是**同一
   * 個實體**，中間沒有面可以打。寬度只在機翼前後量得準，中段是由兩端內插的
   * —— 這一條沒有辦法用更好的量法解決，只能標出來。
   */
  nacbake: async (_page, _probe, slice) => {
    const AXIS_U = 2.6
    const QC = 3.0889
    /** 【1.4】舊的 1.0 把艙底切掉了：最深處量到 0.994，貼著上限（坑 6） */
    /** 【0.05 m 一刀】理由見檔頭 —— 0.2 m 分不出「一道階」與「一段起伏」 */
    const rs = await slice('radial', 'z', {
      from: 0.20, to: 5.40, count: 105, angles: 144,
      axisU: AXIS_U, axisV: 0.0, maxRadius: 1.4,
    }) as { planes: number[]; theta: number[]; r: number[][] }
    const at = (deg: number) =>
      rs.theta.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(rs.theta[b]! - deg * Math.PI / 180)
          ? j : b
      ), 0)
    const [ri, up, le, dn] = [at(0), at(90), at(180), at(270)]

    type Sec = { z: number; hw: number; hh: number; cy: number }
    /**
     * 【任一側射線回 0 的站位整站丟掉】那代表射線在該高度找不到艙壁 —— 艙
     * 已經併進機翼裡了，寬度在那裡不存在。留著會把機身的半寬（實測某一站
     * 內側回 0.735）當成艙寬用。
     */
    const fine: Sec[] = rs.planes.flatMap((m, k) => {
      const row = rs.r[k]!
      const [o, u, i, d] = [row[ri]!, row[up]!, row[le]!, row[dn]!]
      if (o <= 0 || i <= 0 || u <= 0 || d <= 0) return []
      // 外側穿進機翼時只採內側（見檔頭）
      const hw = o > i + 0.20 ? i : (o + i) / 2
      return [{ z: m - QC, hw, hh: (u + d) / 2, cy: (u - d) / 2 }]
    })

    const keys = ['hw', 'hh', 'cy'] as const
    /**
     * 【中位數三點濾波，在平滑之前】0.05 m 一刀之後**單站的漏接**才會現形：
     * 實測機體 −0.44 那一站的艙底回 0.660，前後是 0.947／0.850 —— 射線從
     * 兩個面的接縫穿出去了。均值平滑會把這 0.29 攤成三站各 0.1；中位數
     * 直接把它換成鄰居。
     */
    const med = fine.map((s) => ({ ...s }))
    for (let k = 1; k < fine.length - 1; k++) {
      for (const key of keys) {
        const t = [fine[k - 1]![key], fine[k]![key], fine[k + 1]![key]].sort((a, b) => a - b)
        med[k]![key] = t[1]!
      }
    }

    /**
     * ── 兩道垂直面，都是量出來的（坑 10）────────────────────────
     *
     * 底線（`cy − hh`）在 0.05 m 的取樣下有兩處一步跳超過 0.09：
     *
     * ```
     *   機體 −1.29 → −1.24   0.674 → 0.985   ＋0.311   散熱器進氣口的前壁
     *   機體 −0.49 → −0.39   0.947 → 0.850   −0.097   散熱器艙的後壁
     * ```
     *
     * **第二道是這一輪才問出來的。** 0.2 m 的舊取樣把它攤進鄰近三站，烘出來
     * 的底線變成 −1.005 →（−0.900）→ −0.979 的一段起伏 —— 沒有理由的起伏在
     * 打光下就是「不平整」，而一道乾淨的階讀起來是「那裡有個進氣口」。
     *
     * `loft` 在截面之間線性內插，所以一道垂直面要在同一個位置前後各放一個
     * 截面，相距 0.01 m。
     */
    const STEP = 0.09
    const bottom = (s: Sec): number => s.cy - s.hh
    const edges: number[] = []
    for (let k = 1; k < med.length; k++) {
      if (Math.abs(bottom(med[k]!) - bottom(med[k - 1]!)) > STEP) edges.push(k)
    }
    console.log(`// 底線上一步跳超過 ${STEP} 的地方 ${edges.length} 處：`
      + edges.map((k) => `${med[k - 1]!.z.toFixed(2)}→${med[k]!.z.toFixed(2)}`
        + ` ${(bottom(med[k]!) - bottom(med[k - 1]!)).toFixed(3)}`).join('、'))

    /**
     * 【0.05 m 全烘進去太多截面】105 站 × 20 段 × 2 具＝四千個三角形，只為了
     * 一段 5 m 的艙。取樣改回 0.2 m，但**階的前後兩站照原值保留** —— 這樣
     * 平滑碰不到階，階也不會被取樣跳過。
     */
    const keep = new Set<number>()
    for (let k = 0; k < med.length; k++) {
      if (k % 4 !== 0) continue
      // 離階兩站以內的常規取樣要丟掉 —— 留著會跟階的前一站擠在 0.05 之內，
      // 壓成 0.01 之後變成**第二道假的垂直面**，而且會把 −2.64 那道階挪到
      // −2.68 去
      if (edges.some((e) => Math.abs(k - e) <= 1)) continue
      keep.add(k)
    }
    for (const k of edges) { keep.add(k - 1); keep.add(k) }
    const secs = [...keep].sort((a, b) => a - b).map((k) => ({ ...med[k]!, k }))

    /**
     * 保邊的 z 平滑，一輪 λ = 0.5 —— 與機身同一招（坑 19 + 保邊）。門檻 0.09
     * 與上面偵測階的門檻同一個值：**被認定成階的地方一定不會被平滑**。
     */
    const src = secs.map((s) => ({ ...s }))
    for (let k = 1; k < secs.length - 1; k++) {
      for (const key of keys) {
        const a = src[k]![key] - src[k - 1]![key]
        const b = src[k + 1]![key] - src[k]![key]
        if (Math.abs(a) > STEP || Math.abs(b) > STEP) continue
        const mid = (src[k - 1]![key] + src[k + 1]![key]) / 2
        secs[k]![key] = src[k]![key] + (mid - src[k]![key]) * 0.5
      }
    }

    // 曲率變號＝沒有理由的起伏（坑 19）
    for (const key of keys) {
      let flips = 0
      for (let k = 2; k < secs.length; k++) {
        const a = secs[k]![key] - secs[k - 1]![key]
        const b = secs[k - 1]![key] - secs[k - 2]![key]
        if (a * b < 0) flips++
      }
      console.log(`// ${key} 曲率變號 ${flips}/${secs.length} 站`)
    }

    /**
     * ── 兩個量不到、要手工接的地方（坑 15）────────────────────
     *
     * 【艙首】射線在量測 0.00 回 0.030、0.20 回 0.254 —— 尖端在 0.0 附近，
     *         但那一站量不到形狀。接一個收成一點的截面，z 取 0.0（機體
     *         −3.089），整流罩就接在上面。
     *
     * 【艙尾在 2.11 收乾淨】`nactail` 那一格用三個射線原點分辨過：x = 2.6
     *         明顯比 2.0／3.2 深的那一段只到機體 1.75，再往後三欄收斂 ——
     *         那是**機翼下表面**不是發動機艙。
     */
    const edgeSet = new Set(edges)
    const out: Sec[] = []
    out.push({ z: 0.0 - QC, hw: 0.05, hh: 0.05, cy: secs[0]!.cy })
    for (const s of secs) {
      if (s.z > 1.75) break
      // 階的後一站緊貼前一站 0.01 —— `loft` 線性內插，這樣才是垂直面（坑 10）
      const z = edgeSet.has(s.k) ? out[out.length - 1]!.z + 0.01 : s.z
      out.push({ z, hw: s.hw, hh: s.hh, cy: s.cy })
    }
    const last = out[out.length - 1]!
    out.push({ z: 2.11, hw: 0.06, hh: last.hh * 0.45, cy: last.cy })

    console.log('  sections: [')
    for (const s of out) {
      console.log(
        `    { z: ${s.z.toFixed(3)}, halfWidth: ${s.hw.toFixed(3)},`
        + ` halfHeight: ${s.hh.toFixed(3)}, centerY: ${s.cy.toFixed(3)} },`,
      )
    }
    console.log('  ],')
  },

  /**
   * 【發動機艙的尾錐到哪裡結束】走 probe 旁路，量測系。
   *
   * 【為什麼要三個原點】朝下的射線在艙尾量到的東西可能是**發動機艙的尾整流
   * 罩**，也可能是**機翼的下表面** —— 兩者在同一個 z 範圍內都在。分辨的方法
   * 是把射線原點橫移：艙只在 x ≈ 2.6 附近深，機翼是一整片。
   *
   * x = 2.6 明顯比 2.0／3.2 深 → 那是艙；三者差不多 → 那是機翼。
   */
  nactail: async (_page, _probe, slice) => {
    const QC = 3.0889
    const rows: { z: number; d: number[] }[] = []
    const XS = [2.0, 2.6, 3.2]
    for (const [i, x] of XS.entries()) {
      const rs = await slice('radial', 'z', {
        from: 4.0, to: 8.0, count: 41, angles: 144,
        axisU: x, axisV: 0.0, maxRadius: 1.3,
      }) as { planes: number[]; theta: number[]; r: number[][] }
      const dn = rs.theta.reduce((b, th, j) => (
        Math.abs(th - 270 * Math.PI / 180) < Math.abs(rs.theta[b]! - 270 * Math.PI / 180)
          ? j : b
      ), 0)
      for (let k = 0; k < rs.planes.length; k++) {
        if (i === 0) rows.push({ z: rs.planes[k]!, d: [] })
        rows[k]!.d.push(rs.r[k]![dn]!)
      }
    }
    console.log('── 艙尾：朝下的射線，三個原點（量測系）────────')
    console.log('   量測Z   機體Z   x=2.0   x=2.6   x=3.2   判讀')
    for (const r of rows) {
      const [a, b, c] = r.d as [number, number, number]
      const deep = b - Math.max(a, c)
      const tag = b <= 0 ? '' : deep > 0.12 ? '  ← 發動機艙' : '  機翼下表面'
      console.log(
        `  ${n(r.z, 6, 2)}  ${n(r.z - QC, 6, 2)}  ${n(a)}  ${n(b)}  ${n(c)}${tag}`,
      )
    }
  },

  /**
   * 【發動機艙的**底線**，整段、0.05 m 一刀、三個原點】
   *
   * 【為什麼專門為底線再開一格】側視看得到的發動機艙輪廓幾乎只有底線 ——
   * 艙頂只比機翼上表面高 0.07 m，兩側在機翼覆蓋的那一段量不到（造型檔的
   * 檔頭記過）。而烘出來的底線有兩處曲率反轉（−1.005 → −0.900 → −0.979），
   * 那就是「引擎的平整度不對」的來源。
   *
   * 【0.2 m 一刀看不出這件事】那個起伏的波長只有 0.6 m，三個取樣點 —— 分不出
   * 「真的有一道凸起」與「射線在兩個面之間跳」。切細 4 倍才問得出來。
   *
   * 【三個原點】艙只在 x ≈ 2.6 附近深，機翼是一整片（`nactail` 的老招）。
   * 三欄一起起伏 → 那是機翼；只有中間那欄起伏 → 那是艙上真的有東西。
   */
  nacfloor: async (_page, _probe, slice) => {
    const QC = 3.0889
    const XS = [2.2, 2.6, 3.0]
    const rows: { z: number; d: number[] }[] = []
    for (const [i, x] of XS.entries()) {
      const rs = await slice('radial', 'z', {
        from: 0.0, to: 5.4, count: 109, angles: 144,
        axisU: x, axisV: 0.0, maxRadius: 1.4,
      }) as { planes: number[]; theta: number[]; r: number[][] }
      const dn = rs.theta.reduce((b, th, j) => (
        Math.abs(th - 270 * Math.PI / 180) < Math.abs(rs.theta[b]! - 270 * Math.PI / 180)
          ? j : b
      ), 0)
      for (let k = 0; k < rs.planes.length; k++) {
        if (i === 0) rows.push({ z: rs.planes[k]!, d: [] })
        rows[k]!.d.push(rs.r[k]![dn]!)
      }
    }
    console.log('── 發動機艙底線：朝下的射線、0.05 m 一刀（量測系）────')
    console.log('   量測Z   機體Z   x=2.2   x=2.6   x=3.0    逐步差(2.6)')
    let prev = NaN
    for (const r of rows) {
      const [a, b, c] = r.d as [number, number, number]
      const step = Number.isFinite(prev) && b > 0 && prev > 0 ? b - prev : NaN
      prev = b
      console.log(
        `  ${n(r.z, 6, 2)}  ${n(r.z - QC, 6, 2)}  ${n(a)}  ${n(b)}  ${n(c)}   ${n(step)}`,
      )
    }
  },

  /**
   * 【發動機艙拆件】參考模型是一個圓錐體的引擎，加上
   * 下方進氣罩與上方進氣罩。這一格就是去證實這個拆法。
   *
   * 【為什麼一定要拆】現在的 `NACELLE` 是**一個** loft，等於逼一個橢圓截面
   * 同時交代圓錐與兩個罩子。烘出來的表格自己就露餡了：半寬是乾淨的圓錐
   * （0.61 → 0.65 峰 → 收），**半高卻在 −1.289 → −1.279 一步跳 0.573 →
   * 0.730、centerY 同步跳 −0.140 → −0.252**。截面是整圈一起放大的，所以
   * 那一步把**頂線**也一起抬了 +0.045（0.433 → 0.478）—— 而艙頂那個位置
   * 實際上什麼都沒有。這是「憑空多出來的一圈」，打光之下就是不平整。
   *
   * 【量法】頂線與底線各自用五個 X 原點（艙心 2.6 起，往外每 0.15 一欄）。
   * 判讀規則與 `nactail`／`nacfloor` 同一條：
   *
   *   五欄一起起伏 → 那是機翼（機翼在 X 上是一整片）
   *   只有內側幾欄凸出去 → 那是掛在艙上的罩子，而**凸出去的欄數就是罩寬**
   *
   * 【頂線在機翼弦內量不到艙】艙頂只比機翼上表面高 0.07（造型檔檔頭記過），
   * 而兩者在參考模型裡是同一個實體。所以頂線的表格只有機翼前緣**之前**那
   * 一段能拿來判上方進氣罩；之後那一段本來就該讀到機翼。
   */
  nacparts: async (_page, _probe, slice) => {
    const QC = 3.0889
    const DX = [0, 0.15, 0.30, 0.45, 0.60]
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    const iAt = (T: readonly number[], deg: number): number =>
      T.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[b]! - deg * Math.PI / 180) ? j : b
      ), 0)

    const zs: number[] = []
    const roof: number[][] = []
    const floor: number[][] = []
    for (const [i, dx] of DX.entries()) {
      const rs = await slice('radial', 'z', {
        from: 0.0, to: 5.4, count: 109, angles: 144,
        axisU: 2.6 + dx, axisV: 0.0, maxRadius: 1.4,
      }) as Rad
      const up = iAt(rs.theta, 90), dn = iAt(rs.theta, 270)
      for (let k = 0; k < rs.planes.length; k++) {
        if (i === 0) { zs.push(rs.planes[k]!); roof.push([]); floor.push([]) }
        // 半徑 → 機體 Y。量不到（r = 0）印成 NaN，不要與 y = 0 混為一談
        roof[k]!.push(rs.r[k]![up]! > 0 ? rs.r[k]![up]! : NaN)
        floor[k]!.push(rs.r[k]![dn]! > 0 ? -rs.r[k]![dn]! : NaN)
      }
    }
    const head = '  量測Z   機體Z' + DX.map((d) => n(2.6 + d, 8, 2)).join('')
    console.log('── 發動機艙 頂線（機體 Y，射線朝上）──────────────')
    console.log(head)
    for (let k = 0; k < zs.length; k++) {
      console.log(`  ${n(zs[k]!, 6, 2)}  ${n(zs[k]! - QC, 6, 2)}`
        + roof[k]!.map((v) => n(v, 8)).join(''))
    }
    console.log('')
    console.log('── 發動機艙 底線（機體 Y，射線朝下）──────────────')
    console.log(head)
    for (let k = 0; k < zs.length; k++) {
      console.log(`  ${n(zs[k]!, 6, 2)}  ${n(zs[k]! - QC, 6, 2)}`
        + floor[k]!.map((v) => n(v, 8)).join(''))
    }
  },

  /**
   * 【機腹吊艙：參考模型的**蒙皮**與**玻璃**各佔哪裡】
   *
   * 要問的是：參考模型的洞是矩形還是弧形？
   *
   * 【量法】同一組射線切兩次：`only: 'hull'`（蒙皮）與 `only: 'windows'`
   * （玻璃）。逐站、逐角度看誰在那裡：
   *
   *   兩者都有、半徑相同 → 玻璃貼在蒙皮上（或蒙皮就是那一段外殼）
   *   只有玻璃           → 蒙皮在那裡是**破的**，那就是艙口
   *   只有蒙皮           → 那一段是金屬
   *
   * 角度由正下方（270°）往兩側各取幾格，看艙口沿 z 與沿角度各到哪裡 ——
   * 邊界沿 z 是直的還是跟著剖面收放，答案就在這張表上。
   */
  bolahole: async (_page, _probe, slice) => {
    const QC = 3.0889
    // 射線原點放在**吊艙自己的剖面中心**（BOLA 的 centerY ≈ −0.75），
    // 量到的角度才能直接當成 `LoftPart.arc` 用
    const AXIS_V = -0.75
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    const opt = {
      from: 5.2, to: 8.6, count: 35, angles: 360,
      axisV: AXIS_V, maxRadius: 1.0,
    }
    const skin = await slice('radial', 'z', opt, undefined, 'hull') as Rad
    const glassOnly = await slice('radial', 'z', opt, undefined, 'windows') as Rad
    const idxAt = (d: number) => skin.theta.reduce((b, th, j) => (
      Math.abs(th - d * Math.PI / 180) < Math.abs(skin.theta[b]! - d * Math.PI / 180) ? j : b
    ), 0)
    const DEGS = [190, 200, 215, 230, 245, 260, 270, 280, 295, 310, 325, 340, 350]
    console.log('── 機腹：蒙皮 vs 玻璃（Ｓ=只有蒙皮 Ｇ=只有玻璃 ＝兩者同高 ・=都沒有）──')
    console.log('   量測Z   機體Z   ' + DEGS.map((d) => String(d).padStart(4)).join(''))
    for (let k = 0; k < skin.planes.length; k++) {
      const cells = DEGS.map((d) => {
        const j = idxAt(d)
        const a = skin.r[k]![j]!, b = glassOnly.r[k]![j]!
        if (a <= 0 && b <= 0) return '   ・'
        if (b <= 0) return '   Ｓ'
        if (a <= 0) return '   Ｇ'
        return Math.abs(a - b) < 0.02 ? '   ＝' : (b > a ? '   ｇ' : '   ｓ')
      })
      console.log(`  ${n(skin.planes[k]!, 6, 2)}  ${n(skin.planes[k]! - QC, 6, 2)}   `
        + cells.join(''))
    }
    console.log('\n── 同一組站位的深度（正下方 270°，機體 Y）──────────')
    console.log('   機體Z    蒙皮     玻璃')
    for (let k = 0; k < skin.planes.length; k++) {
      const j = idxAt(270)
      const a = skin.r[k]![j]!, b = glassOnly.r[k]![j]!
      console.log(`  ${n(skin.planes[k]! - QC, 6, 2)}  ${n(a > 0 ? AXIS_V - a : NaN)}`
        + `  ${n(b > 0 ? AXIS_V - b : NaN)}`)
    }
  },

  /**
   * 【發動機艙的**截面輪廓**，幾站，逐點印 (u, v)】
   *
   * `nacparts` 只取 θ=90／270 兩個角度，回答得了「有沒有罩子」，回答不了
   * 「罩子多寬、中心在哪」——後者要看整條輪廓。一次 radial 切片本來就把 144
   * 個角度都算好了，只是之前只挑了兩個出來印。
   *
   * 【為什麼一定要問「中心在哪」】上方進氣罩只在 x = 2.60／2.75 兩欄出現，
   * 2.90 那欄讀到的是錐面。只掃外側等於預設它對稱於艙心 —— 而 Jumo 211 的
   * 增壓器進氣口在真機上是偏一側的。做錯邊會比做小還醜。
   */
  nacsection: async (_page, _probe, slice) => {
    const QC = 3.0889
    const AXIS_V = -0.10
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    // 機體 Z → 量測 Z。取樣落在 0.05 的格線上，from/to/count 要對得起來
    const WANT = [-2.19, -1.89, -1.64, -1.44, -1.24, -0.89, -0.54]
    const rs = await slice('radial', 'z', {
      from: 0.0, to: 5.4, count: 109, angles: 144,
      axisU: 2.6, axisV: AXIS_V, maxRadius: 1.4,
    }) as Rad
    console.log(`── 發動機艙截面輪廓（原點 x=2.6, y=${AXIS_V}；u 是離艙心的橫距）──`)
    for (const zb of WANT) {
      const k = rs.planes.reduce((b, p, j) =>
        Math.abs(p - (zb + QC)) < Math.abs(rs.planes[b]! - (zb + QC)) ? j : b, 0)
      console.log(`\n  機體 Z = ${n(rs.planes[k]! - QC, 6, 2)}`)
      for (const [tag, lo, hi] of [['上緣', 40, 140], ['下緣', 220, 320]] as const) {
        const cells: string[] = []
        for (let j = 0; j < rs.theta.length; j++) {
          const deg = rs.theta[j]! * 180 / Math.PI
          if (deg < lo || deg > hi) continue
          const r = rs.r[k]![j]!
          if (r <= 0) continue
          const u = r * Math.cos(rs.theta[j]!)
          const v = AXIS_V + r * Math.sin(rs.theta[j]!)
          cells.push(`${u.toFixed(2)}/${v.toFixed(3)}`)
        }
        console.log(`   ${tag} ` + cells.join(' '))
      }
    }
  },

  /**
   * 【發動機艙逐站對切】自家模型 vs 參考模型，射線原點都橫移到 x = 2.6。
   *
   * 【為什麼要單獨一格】`verify` 的射線原點在機身軸心，量不到掛在機翼上的
   * 發動機艙 —— 它從頭到尾沒有被驗收過（造型檔自己標了這一條）。艙的截面是
   * 我從 0.4 m 的表格**手抄**成 16 個 `FuselageSection` 的，抄錯或抄漏
   * 不會有任何東西提醒。
   *
   * 【0.1 m 一刀】艙上有真的是垂直面的東西（散熱器進氣口）。0.4 m 一刀
   * 只會看到一個斜坡。
   *
   * ── 這一格的「差」帶著一個剛體偏移，不要直接讀 ──────────────
   *
   * 這一格在 `overlay` 名單裡，所以參考模型走 `placeRef`；而 `nacparts` 與
   * `nacsection` 走 `__hangarProbe` 旁路。兩條路徑擺的**不是同一個位置**：
   *
   * ```
   *   特徵                 probe      placeRef    差
   *   整流罩尖端          −3.09       −2.95      +0.14
   *   下方罩前壁          −1.265      −1.15      +0.115
   *   艙底最深（Z −0.9）  −1.012      −0.91      +0.102
   *   艙頂（Z −1.8）      +0.522      +0.62      +0.098
   * ```
   *
   * 也就是 placeRef 把參考模型往**後 0.12、往上 0.105** 擺。整個機身都是
   * 同一個偏移（`belly` 那一格早就在扣 −0.105 了）。造型檔的截面是在 probe
   * 座標烘的，所以這一格印出來的「自家比參考深 0.10」是**擺放差**不是形狀差。
   *
   * 【而且那還不是單純的平移 —— 試過了】把參考那一趟的刀往前挪 0.12、射線
   * 原點抬 0.105（對純平移這是正確的補償），殘差反而由中位數 0.095 惡化到
   * **0.269**，而且參考的頂緣不減反增（−1.80 那一站 0.62 → 0.77）。所以兩條
   * 路徑的差**不是剛體位移**，很可能連縮放或對齊基準都不同（`placeRef` 是拿
   * 「最前端的頂點」對 Z 與 Y 的，見 `verify` 的註解）。補償已經收回。
   *
   * 【所以形狀不要在這一格判】造型檔的截面是在 probe 座標烘的，要比形狀就看
   * `nacparts`／`nacsection`（同一個座標）。這一格回答的是另一個問題：
   * **玩家在機庫裡疊出來看到的那一份**差多少 —— 那個差裡混著擺放，數字不能
   * 直接當成形狀誤差讀。這條與 §「三條紅護欄」是同一件懸案，等負責人定值。
   *
   * 【`target: 'mine'` 只能在這條路徑上用】probe 旁路下 `mine` 量到的不是
   * 這台飛機（試過：切了機種、關了自動旋轉、重載 probe 都一樣）。
   */
  nacverify: async (_page, _probe, slice) => {
    const AXIS_U = 2.6
    const opt = {
      from: -3.2, to: 2.2, count: 55, angles: 144,
      axisU: AXIS_U, axisV: 0.0, maxRadius: 1.1,
    }
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    const mine = await slice('radial', 'z', opt, 'mine') as Rad
    const ref = await slice('radial', 'z', opt) as Rad
    const at = (T: readonly number[], deg: number) =>
      T.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[b]! - deg * Math.PI / 180) ? j : b
      ), 0)
    const [ri, up, le, dn] = [at(mine.theta, 0), at(mine.theta, 90),
      at(mine.theta, 180), at(mine.theta, 270)]
    console.log('── 發動機艙（射線原點 X=2.6、Y=0；差裡混著擺放，見檔頭）──')
    console.log('      Z   ── 外側 ──  ── 上緣 ──  ── 內側 ──  ── 下緣 ──')
    console.log('          自家   參考  自家   參考  自家   參考  自家   參考')
    const diffs: number[] = []
    for (let k = 0; k < mine.planes.length; k++) {
      const cell = (j: number) => {
        const a = mine.r[k]![j]!, b = ref.r[k]![j]!
        if (a > 0 && b > 0) diffs.push(Math.abs(a - b))
        return `${n(a, 7, 2)}${n(b, 7, 2)}`
      }
      console.log(`  ${n(mine.planes[k]!, 6, 2)}${cell(ri)}${cell(up)}${cell(le)}${cell(dn)}`)
    }
    diffs.sort((a, b) => a - b)
    const rms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / Math.max(diffs.length, 1))
    console.log(`\n  ${diffs.length} 筆：中位數 ${n(diffs[diffs.length >> 1] ?? NaN)}`
      + `  RMS ${n(rms)}  最大 ${n(diffs[diffs.length - 1] ?? NaN)}`)
  },

  /**
   * 【腹艙的兩道端面站在哪一刀上】走 `__hangarProbe` 旁路 —— **不經過
   * `placeRef`**，所以這一格量到的是量測系的原始位置，與 `bake` 同一個座標。
   *
   * 【為什麼需要它】`belly` 那一格量的是**擺放過**的參考模型，帶著 0.13 m
   * 的剛體位移；拿它跟烘出來的機身逐站比，端面的位置差看起來像形狀錯，其實
   * 混了平移。要問「端面在哪一刀」只能在原始座標裡問。
   */
  keel: async (_page, _probe, slice) => {
    const AXIS_V = 0.25
    const QC = 3.0889
    const rs = await slice('radial', 'z', {
      from: 5.0, to: 9.4, count: 89, angles: 144, axisV: AXIS_V, maxRadius: 2.1,
    }) as { planes: number[]; theta: number[]; r: number[][] }
    const dn = rs.theta.reduce((b, th, j) => (
      Math.abs(th - 270 * Math.PI / 180) < Math.abs(rs.theta[b]! - 270 * Math.PI / 180) ? j : b
    ), 0)
    console.log('── 腹艙：0.05 m 一刀，正下方單條射線（量測系）──')
    console.log('   量測Z   機體Z    腹線    逐刀落差')
    let prev = NaN
    for (let k = 0; k < rs.planes.length; k++) {
      const r = rs.r[k]![dn]!
      const y = r > 0 ? AXIS_V - r : NaN
      const d = y - prev
      const flag = Number.isFinite(d) && Math.abs(d) > 0.06 ? '  ← 端面' : ''
      console.log(
        `  ${n(rs.planes[k]!, 6, 2)}  ${n(rs.planes[k]! - QC, 6, 2)}  ${n(y)}  ${n(d)}${flag}`,
      )
      prev = y
    }
  },

  /**
   * 【機腹線】腹艙（Bola）那一段的曲線對不對。
   *
   * 【一定要單條射線】腹艙是一條**窄龍骨**，偏 12° 的射線就離開它、打在旁邊
   * 的機腹上 —— 中位數會把整條吊艙抹掉，量出來是「我的機腹淺了 0.3 m」，
   * 而那是尺的問題不是模型的。
   *
   * 【兩邊都切、同一組站位】自家模型走 `placeRef` 的疊圖路徑，所以還帶著
   * 那個剛體位移；但**曲線的形狀**不受平移影響，逐站的一階差分（相鄰兩站
   * 的高低差）可以直接比。
   */
  belly: async (_page, _probe, slice) => {
    /**
     * 【射線原點橫移 0.20 —— 讓開中線上的兩根桿子】參考模型在機體 2.4…2.7
     * 與 5.0…5.3 的中線上各掛著一根細桿。`castRay` 取最遠命中，正下方那一條
     * 會穿過腹艙／蒙皮之後打到桿子的下端，量到的腹線深 0.34（見 `bolafloor`）。
     *
     * 橫移 0.20 打不到桿子，而腹線本身在 x = 0 與 x = 0.20 只差 0.008。
     */
    const opt = {
      from: -1.0, to: 7.0, count: 41, angles: 144,
      axisU: 0.20, axisV: 0.25, maxRadius: 1.6,
    }
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    const mine = await slice('radial', 'z', opt, 'mine') as Rad
    const ref = await slice('radial', 'z', opt) as Rad
    const dn = mine.theta.reduce((b, th, j) => (
      Math.abs(th - 270 * Math.PI / 180) < Math.abs(mine.theta[b]! - 270 * Math.PI / 180) ? j : b
    ), 0)
    const y = (m: Rad, k: number) => (m.r[k]![dn]! > 0 ? 0.25 - m.r[k]![dn]! : NaN)
    console.log('── 機腹線（正下方單條射線）──────────────────')
    console.log('      Z     自家     參考      差    ── 逐站落差 ──')
    console.log('                                     自家     參考     差')
    let pm = NaN, pr = NaN
    const slopeDiff: number[] = []
    for (let k = 0; k < mine.planes.length; k++) {
      const a = y(mine, k), b = y(ref, k)
      const da = a - pm, db = b - pr
      if (Number.isFinite(da) && Number.isFinite(db)) slopeDiff.push(Math.abs(da - db))
      console.log(
        `  ${n(mine.planes[k]!, 6, 2)}  ${n(a)}  ${n(b)}  ${n(a - b)}`
        + `   ${n(da)}  ${n(db)}  ${n(da - db)}`,
      )
      pm = a; pr = b
    }
    slopeDiff.sort((p, q) => p - q)
    console.log(`\n  逐站落差的差 ${slopeDiff.length} 筆：`
      + `中位數 ${n(slopeDiff[slopeDiff.length >> 1] ?? NaN)}`
      + `  最大 ${n(slopeDiff[slopeDiff.length - 1] ?? NaN)}`)
    console.log('  （這一欄不受剛體位移影響 —— 它比的是曲線的形狀，不是位置）')
  },

  /**
   * 【主翼內段的平面形】`wing` 那一趟從 X = 1.0 起切，而且是用「Z 幅度＝弦長」
   * 讀的 —— X < 3.4 被發動機艙與機身整流罩污染，所以造型檔的翼根其實是由
   * **外段外推**來的。外推假設前後緣各是一條直線，翼根附近如果另有轉折就
   * 完全看不到。
   *
   * 這一格改成沿 Y 水平切、用**徑向射線**掃平面形輪廓：射線原點放在機翼所在
   * 高度的機身軸上，往 (X, Z) 平面各方向射，取最外側 —— 得到的就是**俯視
   * 剪影**本身，前緣的每一段轉折都在上面。
   */
  root: async (_page, _probe, slice) => {
    /** 射線原點：機身軸上、主翼四分之一弦線處 */
    const AXIS_U = 0, AXIS_V = 2.7465
    for (const y of [-0.35, -0.15, 0.05]) {
      // 【count 一定要 ≥ 2】`radialSlices` 的平面位置是
      // `from + (to−from)·k/(count−1)` —— count = 1 時分母為 0，from = to
      // 讓分子也是 0，於是每一刀都切在 NaN，輸出是一張空表而不是錯誤。
      const rs = await slice('radial', 'y', {
        from: y, to: y, count: 2, angles: 360,
        axisU: AXIS_U, axisV: AXIS_V, maxRadius: 12.5,
      }) as { theta: number[]; r: number[][] }
      const row = rs.r[0]!
      // 射線 (u, v) = (X, Z)。取右半（X ≥ 0）且落在主翼 X 範圍內的點，
      // 依 X 分桶，每桶記前緣（Z 最小）與後緣（Z 最大）
      const BUCKET = 0.25
      const le = new Map<number, number>()
      const te = new Map<number, number>()
      for (let j = 0; j < rs.theta.length; j++) {
        if (row[j]! <= 0) continue
        const x = AXIS_U + row[j]! * Math.cos(rs.theta[j]!)
        const z = AXIS_V + row[j]! * Math.sin(rs.theta[j]!)
        // Z 也要限住：朝正後方的射線會打到尾錐與水平尾翼，而它們在 x 很小
        // 的那幾桶裡看起來就像「後緣在 Z 16」
        if (x < 0.1 || x > 11.6 || z < 0.5 || z > 9.5) continue
        const b = Math.round(x / BUCKET)
        if (!le.has(b) || z < le.get(b)!) le.set(b, z)
        if (!te.has(b) || z > te.get(b)!) te.set(b, z)
      }
      console.log(`\n── 俯視剪影 y = ${y}（量測系；射線原點 X0 Z${AXIS_V}）──`)
      console.log('      X      前緣Z    後緣Z     弦長   直線外推的前緣   差')
      for (const b of [...le.keys()].sort((a, c) => a - c)) {
        const x = b * BUCKET
        // 造型檔目前那條直線：機體 −1.4884 + tan(14°)·x，換回量測系 +2.7465
        const model = 2.7465 - 1.4884 + Math.tan(14 * Math.PI / 180) * x
        console.log(
          `  ${n(x, 6, 2)}  ${n(le.get(b)!)}  ${n(te.get(b)!)}`
          + `  ${n(te.get(b)! - le.get(b)!)}  ${n(model, 12)}  ${n(le.get(b)! - model)}`,
        )
      }
    }
  },

  /**
   * 【第一關：對齊對了沒】後面每一格都建立在這上面，所以它自己要可證偽。
   *
   * 三條判準：
   *   機首在 −Z    幾何的 Z 下界要遠離 0，而且細（機首尖端）
   *   翼展在 X     X 幅度要等於 22.60 ± 小量
   *   機翼是平的   沿弦向的中厚線斜率要接近 0（那正是 pitch 的定義）
   */
  align: async (page, probe, slice) => {
    console.log('── 對齊後的整體包圍盒（公尺）─────────────────')
    for (let i = 0; i < 3; i++) {
      console.log(`   ${'XYZ'[i]}  ${n(probe.min[i]!)} .. ${n(probe.max[i]!)}`
        + `   幅度 ${n(probe.size[i]!)}`)
    }
    console.log(`\n  翼展（X）${n(probe.size[0]!)} m   真機 ${REAL.span}`
      + `   誤差 ${((probe.size[0]! / REAL.span - 1) * 100).toFixed(2)}%`)

    // 沿 Z 切，看幾何沿機身軸的分佈：u = X（翼展）、v = Y（高）
    //
    // 【窗口要蓋滿】只開到 Z=9 而機身到 16.8 的話，後半段整個沒量到，
    // 而且輸出看起來完全正常（只是「全長 9.5 m」）。窗口不足不會報錯。
    const ez = await slice('extent', 'z', { from: -1.5, to: 17.5, count: 39 }) as Extent
    console.log('\n── 沿 Z（機身軸）的分佈 ──────────────────────')
    console.log('      Z      X幅度     Y下      Y上   線段數')
    for (let i = 0; i < ez.planes.length; i++) {
      const xw = ez.uMax[i]! - ez.uMin[i]!
      console.log(`  ${n(ez.planes[i]!, 6, 2)}  ${n(xw)}  ${n(ez.vMin[i]!)}`
        + `  ${n(ez.vMax[i]!)}  ${String(ez.count[i]).padStart(6)}`)
    }
    const live = ez.planes.filter((_, i) => ez.count[i]! > 0)
    console.log(`\n  有幾何的 Z 範圍 ${n(live[0]!)} .. ${n(live[live.length - 1]!)}`
      + `   全長 ${n(live[live.length - 1]! - live[0]!)} m   真機 ${REAL.length}`)

    // 【用正交而不是自己擺相機】`frameOrtho` 會把參考模型的包圍盒也框進去；
    // 自己擺的話要先知道模型在哪，而它現在不以原點為中心（平移是最後一步）
    await page.evaluate(() => window.__hangarShow(false, true))
    for (const v of ['side', 'top']) {
      await page.evaluate((x) => window.__hangarOrtho(x), v)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${SHOTS}he111-align-${v}.png` })
      console.log(`  截圖 ${v} → ${SHOTS}he111-align-${v}.png`)
    }
  },

  /**
   * 【機翼：一趟切完，平面形與翼型一起出來】沿翼展方向（X）切，每一刀的
   * u = Z 幅度就是**弦長**、v = Y 幅度就是**厚度**，前後緣位置一併得到。
   *
   * 【為什麼不另外切 Y 拿平面形】那會是第二組切面、第二次取樣，而坑 16 的
   * 教訓正是「同一個零件被兩次獨立量測描述，兩者各自都對、彼此對不上」。
   * 一刀同時給弦長與厚度，兩者就不可能互相矛盾。
   *
   * 【發動機艙會混進來，那是好事】它掛在機翼上，所以某幾個翼展站位的
   * 厚度與弦長會突然變大 —— 那正好把它的位置與跨度指出來，不必另外找。
   */
  wing: async (_page, _probe, slice) => {
    /**
     * 【uWindow 一定要給】不給的話 X < 4 的那些站位量到的「弦長」是 15.9 m
     * —— 那是**從螺旋槳量到水平尾翼尖**（尾翼半翼展 3.95 m，正好蓋住內段
     * 的每一個站位）。而輸出看起來完全正常，只是弦長大得離譜。
     *
     * 窗口取 [1.0, 9.5]：主翼的前後緣落在 Z 2.3~6.9，留餘裕；上界 9.5 遠低
     * 於水平尾翼的 13.5，下界 1.0 排掉螺旋槳圓盤。
     */
    const ex = await slice('extent', 'x', {
      from: 1.0, to: 11.4, count: 53, uWindow: [1.0, 9.5],
    }) as Extent
    console.log('── 右半翼：沿翼展切（u = Z 弦向、v = Y 厚度）──────')
    console.log('  uWindow Z ∈ [1.0, 9.5] —— 排掉螺旋槳與水平尾翼')
    console.log('      X      前緣Z     後緣Z     弦長     厚度   厚弦比  線段數')

    const xs: number[] = []
    const chords: number[] = []
    for (let i = 0; i < ex.planes.length; i++) {
      if (ex.count[i]! === 0) continue
      const le = ex.uMin[i]!
      const te = ex.uMax[i]!
      const chord = te - le
      const thick = ex.vMax[i]! - ex.vMin[i]!
      xs.push(ex.planes[i]!)
      chords.push(chord)
      console.log(
        `  ${n(ex.planes[i]!, 6, 2)}  ${n(le)}  ${n(te)}  ${n(chord)}`
        + `  ${n(thick)}  ${n(thick / chord * 100, 6, 1)}%  ${String(ex.count[i]).padStart(6)}`,
      )
    }

    /**
     * 翼面積與 MAC。**坑 16 的兩個免費交叉驗證** —— 飛行模型的參數本來就
     * 要填這兩個數字，量測值對得上史實才代表機翼真的量對了。
     *
     * 梯形積分，兩側對稱所以乘 2。
     */
    let area = 0
    let macNum = 0
    for (let i = 1; i < xs.length; i++) {
      const dx = xs[i]! - xs[i - 1]!
      const cA = chords[i - 1]!
      const cB = chords[i]!
      area += (cA + cB) / 2 * dx
      macNum += (cA * cA + cB * cB) / 2 * dx
    }
    console.log('\n── 交叉驗證（坑 16）──────────────────────────')
    console.log(`  半翼積分面積 ${n(area)} m²  →  全機 ${n(area * 2)} m²`)
    console.log(`  （不含機身穿越段；真機 ${REAL.wingArea} m² 含機身）`)
    console.log(`  MAC = ∫c²dx / ∫c dx = ${n(macNum / area)} m`)
    console.log(`  平均弦 = 面積/翼展 = ${n(area * 2 / REAL.span)} m`)
  },

  /**
   * 【平面形：從上往下切】`wing` 那一趟的內段被發動機艙蓋住，量不到主翼
   * 自己的前後緣。水平切面在機翼高度上，每個 X 的 Z 幅度就是該站位弦長
   * —— 而發動機艙只在機翼**上下**凸出，同一個高度切下去它與機翼是連在
   * 一起的一塊，前後緣仍然讀得到。
   *
   * 【切好幾個高度】機翼有上反角，單一高度只會在某個翼展範圍內切到翼型的
   * 中段。多切幾層才看得出「哪一層是乾淨的」。
   */
  /**
   * 【這一趟只拿得到上反角】水平切面的 u = X、v = Z，而 `extentSlices`
   * 只有 `uWindow`（擋 X）沒有 vWindow（擋 Z）—— 所以每一刀的 Z 幅度必然
   * 從機首橫跨到機尾，前後緣讀不出來。
   *
   * 但**X 外緣隨切面高度的移動就是上反角**：機翼往外走同時往上抬，所以
   * 切在越高的地方，翼面能延伸到的 X 越遠。這個量不受尾翼干擾（尾翼在
   * 別的 X 範圍，取的是 uMax）。
   */
  planform: async (_page, _probe, slice) => {
    console.log('── 上反角：沿 Y 水平切，看 X 外緣怎麼隨高度外移 ────')
    const ey = await slice('extent', 'y', {
      from: -0.5, to: 0.9, count: 15, uWindow: [0.0, 11.6],
    }) as Extent
    console.log('      Y      X外緣   線段數')
    const ys: number[] = []
    const xs: number[] = []
    for (let i = 0; i < ey.planes.length; i++) {
      if (ey.count[i]! === 0) continue
      ys.push(ey.planes[i]!)
      xs.push(ey.uMax[i]!)
      console.log(`  ${n(ey.planes[i]!, 6, 2)}  ${n(ey.uMax[i]!)}  ${String(ey.count[i]).padStart(6)}`)
    }
    // 最小平方：dX/dY，上反角 = atan(dY/dX)
    const my = ys.reduce((a, b) => a + b, 0) / ys.length
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length
    let num = 0, den = 0
    for (let i = 0; i < ys.length; i++) { num += (ys[i]! - my) * (xs[i]! - mx); den += (ys[i]! - my) ** 2 }
    const dXdY = num / den
    console.log(`\n  dX/dY = ${n(dXdY)}  →  上反角 ${n(Math.atan(1 / dXdY) * 180 / Math.PI, 6, 2)}°`)
  },

  /**
   * 【尾翼】水平尾翼與垂尾一起量。
   *
   * 水平尾翼：沿 X 切、`uWindow` 限住 Z 在尾段 —— 與主翼同一個手法。
   * 垂尾：**極大的 maxRadius，只讀正上方那一條射線** → 掃出整條側視上緣線。
   *       背鰭起點、前緣轉折、頂端高度、方向舵後緣一次到位（第 2 步的第二招）。
   *
   * 【但天線鋼索在這裡會贏】它從機背拉到垂尾頂，永遠比機背高。所以正上方
   * 那條射線在垂尾出現之前量到的是鋼索。判別方法：垂尾是連續的實體，鋼索
   * 是一條線 —— 看**同一站位上「接近正上方」的幾條射線散不散**。
   */
  tail: async (_page, _probe, slice) => {
    console.log('── 水平尾翼：沿 X 切（u = Z 弦向、v = Y 厚度）──────')
    const ht = await slice('extent', 'x', {
      from: 0.2, to: 4.4, count: 22, uWindow: [12.5, 16.5],
    }) as Extent
    console.log('      X      前緣Z    後緣Z     弦長     厚度   線段數')
    for (let i = 0; i < ht.planes.length; i++) {
      if (ht.count[i]! === 0) continue
      console.log(
        `  ${n(ht.planes[i]!, 6, 2)}  ${n(ht.uMin[i]!)}  ${n(ht.uMax[i]!)}`
        + `  ${n(ht.uMax[i]! - ht.uMin[i]!)}  ${n(ht.vMax[i]! - ht.vMin[i]!)}`
        + `  ${String(ht.count[i]).padStart(6)}`,
      )
    }

    console.log('\n── 垂尾／側視上緣線：正上方那一條射線 ──────────')
    const rs = await slice('radial', 'z', {
      from: 6.0, to: 16.2, count: 35, angles: 72, axisV: 0.0, maxRadius: 4.0,
    }) as { planes: number[]; theta: number[]; r: number[][] }
    const T = rs.theta
    const iAt = (deg: number) =>
      T.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[b]! - deg * Math.PI / 180) ? j : b
      ), 0)
    // 正上方，以及左右各偏 10°、20°：實體的話三者接近，鋼索的話只有正上方有
    const [up, l10, r10, l20, r20] = [iAt(90), iAt(80), iAt(100), iAt(70), iAt(110)]
    console.log('      Z     正上方    −10°     +10°     −20°     +20°   判讀')
    for (let k = 0; k < rs.planes.length; k++) {
      const row = rs.r[k]!
      const u = row[up]!
      const near = [row[l10]!, row[r10]!, row[l20]!, row[r20]!]
      // 實體：偏 10° 的射線也量到接近的高度；鋼索：偏 10° 就掉回機背
      const solid = near.filter((v) => v > u * 0.75).length >= 2
      console.log(
        `  ${n(rs.planes[k]!, 6, 2)}  ${n(u)}  ${n(near[0]!)}  ${n(near[1]!)}`
        + `  ${n(near[2]!)}  ${n(near[3]!)}   ${solid ? '實體' : '← 鋼索'}`,
      )
    }
  },

  /**
   * 【驗收】自家模型 vs 參考模型，**同一支切片器逐站對切**。
   *
   * 【為什麼不在疊圖上量】產線第 6 步明講過一個實例：疊圖上背鰭看起來浮出
   * 參考模型 0.23 m，用同一支切片器對切之後逐站差只有 0.008~0.020 —— 那
   * 0.23 是**水平尾翼擋在前面**造成的錯覺。疊圖裡離鏡頭近的零件會遮住參考
   * 模型，遮出來的邊界看起來就像自家模型的輪廓。
   *
   * 【第一件要驗的是對齊本身】`placeRef` 用 `scaled.min.z` 與 `noseY()` 對齊，
   * 而那兩個都取自**包圍盒的極值**。這台參考模型的包圍盒被離群幾何污染過
   * （整體高度量到 12.6 m，真機 4 m）—— 若機首前方也有一顆散落頂點，整台
   * 就會被平移對錯，而疊圖上看起來只是「形狀差很多」。
   */
  verify: async (page, _probe, slice) => {
    const info = await page.evaluate(() => window.__hangarInfo())
    console.log('── 一、對齊本身 ──────────────────────────────')
    console.log(`  自家模型的機首 noseZ ${n(info!.metrics.noseZ)}  noseY ${n(info!.metrics.noseY)}`)

    // 沿 Z 掃兩邊的「有沒有幾何」，看機首與機尾對不對得上
    const span = { from: -4.0, to: 14.0, count: 37 }
    const em = await slice('extent', 'z', span, 'mine') as Extent
    const er = await slice('extent', 'z', span) as Extent
    console.log('\n      Z    ── 自家 ──   ── 參考 ──   X幅度差   Y下差   Y上差')
    for (let i = 0; i < em.planes.length; i++) {
      const a = em.count[i]! > 0
      const b = er.count[i]! > 0
      if (!a && !b) continue
      const xw = (m: Extent) => m.uMax[i]! - m.uMin[i]!
      console.log(
        `  ${n(em.planes[i]!, 6, 2)}   ${a ? n(xw(em), 8) : '     ——'}`
        + `  ${b ? n(xw(er), 9) : '      ——'}`
        + `  ${a && b ? n(xw(em) - xw(er)) : '      ——'}`
        + `  ${a && b ? n(em.vMin[i]! - er.vMin[i]!) : '      ——'}`
        + `  ${a && b ? n(em.vMax[i]! - er.vMax[i]!) : '      ——'}`,
      )
    }

    /**
     * ── 二、機身剖面逐站 ────────────────────────────
     *
     * 【機體 −0.22／0.27／0.77 三站的半寬差 +0.45 是量測假象，不是形狀】
     * 那三站落在翼根整流罩（`he111.ts` 的 `WING_FILLET`）的翼展範圍內。
     *
     * 整流罩是一片**獨立的封閉翼面**，翼尖收在 x = 1.32 —— 而它的翼尖截面
     * 整片縮在主翼裡面（弦長幾乎相同、厚度少 3%），眼睛看不到。但 `castRay`
     * 取的是 maxRadius 之內最遠的一次命中，射線在 y = 0.25 打出去會**穿過
     * 機身、穿過整流罩，在整流罩的翼尖端面上停下來**（1.33），而不是停在
     * 機身蒙皮上（0.88）。
     *
     * 參考模型沒有這個現象，因為它的整流罩與主翼是同一個實體 —— 射線一路
     * 走到翼尖、超出 maxRadius、回 0，於是採到的是機身自己那一段。
     *
     * **要看機身在那三站對不對，看的是 `belly` 與 `keel`，不是這一欄。**
     */
    const opt = {
      from: -3.2, to: 9.2, count: 26, angles: 144, axisV: 0.25, maxRadius: 1.45,
    }
    type Rad = { planes: number[]; theta: number[]; r: number[][] }
    const rm = await slice('radial', 'z', opt, 'mine') as Rad
    const rr = await slice('radial', 'z', opt) as Rad
    const at = (T: readonly number[], deg: number) =>
      T.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[b]! - deg * Math.PI / 180) ? j : b
      ), 0)
    /**
     * 某個角度的半徑。
     *
     * `window` 是取樣的半角：預設 12° 取那一撮的**中位數**（擋單點漏失，
     * 機身剖面用這個）；傳 0 則只讀**那一條**射線。
     *
     * 【薄板一定要用單條】垂尾是一片薄板，偏 12° 的射線立刻離開它 —— 中位數
     * 因此會塌回機背。用中位數量垂尾的話兩邊都被低估，而且**低估的幅度
     * 不一樣**（參考模型的垂尾根部有結構、我的沒有），差值看起來像形狀誤差。
     */
    const pick = (
      row: readonly number[], T: readonly number[], deg: number, windowDeg = 12,
    ) => {
      const want = deg * Math.PI / 180
      if (windowDeg === 0) return row[at(T, deg)]! || NaN
      const near: number[] = []
      for (let j = 0; j < T.length; j++) {
        let d = T[j]! - want
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        if (Math.abs(d) <= windowDeg * Math.PI / 180 && row[j]! > 0) near.push(row[j]!)
      }
      if (near.length === 0) return NaN
      near.sort((a, b) => a - b)
      return near[near.length >> 1]!
    }
    console.log('\n── 二、機身剖面（自家 − 參考）────────────────')
    console.log('      Z     半寬差   背線差   腹線差')
    const raw: { w: number; t: number; b: number }[] = []
    for (let k = 0; k < rm.planes.length; k++) {
      const w = pick(rm.r[k]!, rm.theta, 0) - pick(rr.r[k]!, rr.theta, 0)
      const t = pick(rm.r[k]!, rm.theta, 90) - pick(rr.r[k]!, rr.theta, 90)
      /**
       * 【腹線用單條射線】腹艙（Bola）是一條**窄龍骨**，偏 12° 的射線就離開
       * 它、打在旁邊的機腹上 —— 中位數因此把它整個抹掉。這與垂尾那一條是
       * 同一個教訓（見 `pick` 的註解）：**細長的東西不能用中位數量**。
       *
       * 【背線仍然用中位數】它面對的是相反的問題 —— 機背機槍座是個**開口**，
       * 單條射線會直接穿進去。同一張表的兩欄用不同的視窗，因為它們要擋的
       * 是不同的東西。
       */
      const b = pick(rm.r[k]!, rm.theta, -90, 0) - pick(rr.r[k]!, rr.theta, -90, 0)
      raw.push({ w, t, b })
      console.log(`  ${n(rm.planes[k]!, 6, 2)}  ${n(w)}  ${n(t)}  ${n(b)}`)
    }
    const stat = (xs: readonly number[], label: string) => {
      const a = xs.filter(Number.isFinite).map(Math.abs).sort((p, q) => p - q)
      const rms = Math.sqrt(a.reduce((s, d) => s + d * d, 0) / Math.max(a.length, 1))
      console.log(`  ${label} ${a.length} 筆：中位數 ${n(a[a.length >> 1] ?? NaN)}`
        + `  RMS ${n(rms)}  最大 ${n(a[a.length - 1] ?? NaN)}`)
    }
    console.log('')
    stat(raw.flatMap((d) => [d.w, d.t, d.b]), '原始  ')

    /**
     * ── 剛體位移：**疊圖的對齊基準在兩邊指的不是同一個東西** ──────
     *
     * `placeRef` 拿「最前端的頂點」對齊 Z 與 Y（見那裡的註解）。單發機兩邊
     * 的最前端都是**整流罩尖端**，而且都在中線上 —— 同一個東西，基準成立。
     *
     * He 111 不是：我這邊最前端是 **x = ±2.6 的兩個槳轂**，參考模型那邊是
     * 機首那根**天線**（`nose` 那一格量到它的 X 幅度只有 0.039）。兩個毫不
     * 相干的點被對在一起，於是整台差一個剛體位移。
     *
     * 【症狀長得跟形狀誤差一模一樣】背線差、腹線差、主翼前緣差全部是同一個
     * 常數 —— 而「每一站都差 0.12」讀起來就像「機身整段做錯了」。分辨的方法
     * 是看**差值散不散**：真的形狀錯會隨站位變化，剛體位移不會。
     *
     * 【怎麼估】ΔZ 取主翼前緣差的中位數（弦長對到 0.01，所以前後緣的差就是
     * 純平移）；ΔY 取背線差的中位數。ΔZ 透過背線的斜率（−0.148/m）洩漏
     * 0.018 進 ΔY，比雜訊小，不修正。
     *
     * 【為什麼不改 placeRef 去用別的基準】試算過：把基準限制在中線附近，
     * 參考模型的最前端就變成天線尖端本身，離它的機首 0.46 m —— 比現在的
     * 0.13 更糟。真正乾淨的基準是四分之一弦線，但那在參考模型上量不到。
     */

    /**
     * ── 三、主翼 ────────────────────────────────────
     *
     * 【為什麼不用第一段的 Z 掃描判機翼】那一段是 `extentSlices`（取全部線段的
     * 極值，沒有射線），所以參考模型的**離群幾何**會混進去 —— 實測它在
     * z = −0.50 報出 11.18 m 寬，而同一台的機翼在該處只到 7.9 m。
     *
     * 沿翼展切、`uWindow` 限住 Z，量到的就是該站位的前後緣本身；線段數
     * 一千出頭代表那一刀只切到機翼一片。
     */
    console.log('\n── 三、主翼逐站（uWindow Z ∈ [−2.2, 6.5]）──────')
    const wOpt = { from: 3.4, to: 11.2, count: 27, uWindow: [-2.2, 6.5] }
    const wm = await slice('extent', 'x', wOpt, 'mine') as Extent
    const wr = await slice('extent', 'x', wOpt) as Extent
    console.log('      X   ── 前緣 ──  ── 後緣 ──  ── 弦長 ──  ── 厚度 ──')
    console.log('          自家   參考  自家   參考  自家   參考  自家   參考')
    const leadDiff: number[] = []
    for (let i = 0; i < wm.planes.length; i++) {
      if (wm.count[i]! === 0 || wr.count[i]! === 0) continue
      const c = (m: Extent) => m.uMax[i]! - m.uMin[i]!
      const t = (m: Extent) => m.vMax[i]! - m.vMin[i]!
      // 翼尖那幾站的弦長本來就對不上（圓翼尖是取捨），不拿來估平移
      if (wm.planes[i]! <= 9.7) leadDiff.push(wm.uMin[i]! - wr.uMin[i]!)
      console.log(
        `  ${n(wm.planes[i]!, 6, 2)}${n(wm.uMin[i]!, 7, 2)}${n(wr.uMin[i]!, 7, 2)}`
        + `${n(wm.uMax[i]!, 7, 2)}${n(wr.uMax[i]!, 7, 2)}`
        + `${n(c(wm), 7, 2)}${n(c(wr), 7, 2)}${n(t(wm), 7, 2)}${n(t(wr), 7, 2)}`,
      )
    }

    // ── 二之二、扣掉剛體位移之後的機身形狀誤差 ────────────
    const med = (xs: readonly number[]): number => {
      const a = xs.filter(Number.isFinite).slice().sort((p, q) => p - q)
      return a.length ? a[a.length >> 1]! : NaN
    }
    const dz = med(leadDiff)
    const dy = med(raw.map((d) => d.t))
    console.log(`\n── 二之二、剛體位移 ΔZ ${n(dz)}  ΔY ${n(dy)} ──────────`)
    console.log('  （基準點在兩邊指的不是同一個東西 —— 見上方註解）')
    /**
     * 【ΔY 是擺放不是形狀，有第三方證人】拿 `bake` 那一趟的**原始**參考模型
     * 讀數來對 —— 那一趟走 `__hangarProbe`，只套對齊參數、**不經過
     * `placeRef`**，所以它是這場爭議裡唯一沒有被擺放污染的證據。
     *
     * ```
     *   我的機背    機體 z 7.70                     0.823
     *   參考原始    量測 10.79（＝機體 7.70）        0.825
     * ```
     *
     * 差 0.002。而同一站在下表裡差 −0.119 —— 那 0.117 全部是擺放。
     *
     * 【腹線不套這個修正】實測它不吃位移（差 −0.003～−0.05，本來就對得上），
     * 代表參考模型朝下的那條射線在該段另有東西擋著、剛好抵銷。硬套會把一欄
     * 對得很好的數字推成 0.12。所以三欄各自報，不合成一個總分。
     */
    /**
     * 【背線與腹線的修正**反號**】這兩欄量的是**半徑**不是 y。整台往下移
     * ΔY（負）會讓背線的半徑變小、腹線的半徑變大 —— 實測正好是 −0.12 與
     * ＋0.10，一對相反數。
     *
     * 【兩欄都減 ΔY 是錯的】那會把腹線的 ＋0.10 推成 ＋0.22，統計反而變差
     * （最大 0.266 → 0.341）—— 而「扣掉剛體位移之後誤差變大」本身就是符號
     * 錯了的證據，不是模型不好。
     */
    stat(raw.map((d) => d.w), '半寬        ')
    stat(raw.map((d) => d.t - dy), '背線（扣位移）')
    stat(raw.map((d) => d.b), '腹線        ')

    // ── 三之二、水平尾翼：與主翼同一個手法，uWindow 限住 Z 才不會混到主翼
    console.log('\n── 三之二、水平尾翼（uWindow Z ∈ [9.2, 13.3]）──')
    const tOpt = { from: 0.6, to: 3.9, count: 12, uWindow: [9.2, 13.3] }
    const tm = await slice('extent', 'x', tOpt, 'mine') as Extent
    const tr = await slice('extent', 'x', tOpt) as Extent
    console.log('      X   ── 前緣 ──  ── 後緣 ──  ── 弦長 ──')
    console.log('          自家   參考  自家   參考  自家   參考')
    for (let i = 0; i < tm.planes.length; i++) {
      if (tm.count[i]! === 0 || tr.count[i]! === 0) continue
      const c = (m: Extent) => m.uMax[i]! - m.uMin[i]!
      console.log(
        `  ${n(tm.planes[i]!, 6, 2)}${n(tm.uMin[i]!, 7, 2)}${n(tr.uMin[i]!, 7, 2)}`
        + `${n(tm.uMax[i]!, 7, 2)}${n(tr.uMax[i]!, 7, 2)}`
        + `${n(c(tm), 7, 2)}${n(c(tr), 7, 2)}`,
      )
    }

    /**
     * ── 四、側視上緣線（垂尾與背線）────────────────
     *
     * **正上方那一條射線**，`maxRadius` 開大。射線不吃離群幾何，也不吃天線
     * 鋼索（實測：`extent` 那一段量到的 Y 上界差 0.8~2.1 m 全是鋼索，
     * 射線量到的同一段只差 0.04）。
     */
    console.log('\n── 四、側視上緣線（正上方射線）────────────────')
    const fOpt = { from: 7.7, to: 13.1, count: 28, angles: 144, axisV: 0.0, maxRadius: 4.0 }
    const fm = await slice('radial', 'z', fOpt, 'mine') as Rad
    const fr = await slice('radial', 'z', fOpt) as Rad
    console.log('      Z     自家    參考     差')
    for (let k = 0; k < fm.planes.length; k++) {
      // 【windowDeg 0】垂尾是薄板，只讀正上方那一條
      const a = pick(fm.r[k]!, fm.theta, 90, 0)
      const b = pick(fr.r[k]!, fr.theta, 90, 0)
      console.log(`  ${n(fm.planes[k]!, 6, 2)}  ${n(a)}  ${n(b)}  ${n(a - b)}`)
    }
  },

  /**
   * 【烘焙】把機身橫剖吐成 `HullRing[]` 的字面值，貼進 `he111.hull.ts`。
   *
   * ── 三個決定 ────────────────────────────────────────────────
   *
   * 【每站取 16 個角度】第一點在正上方（背線）、最後一點在正下方（腹線），
   * 中間十四點等角分佈（12° 一點）。P-51D／Bf 109 是 8 點 —— 這台的機身
   * 周長是它們的一倍多，同樣八點的相鄰間距由 0.25 m 變成 0.55 m。
   *
   * 【每個角度取鄰近射線的中位數，不是單一射線】144 條射線每 2.5° 一條，取
   * ±6° 內的中位數。**這是為了擋單點漏失** —— 實測某一站的正上方那一條
   * 射線回 0（機身在那裡有個縫），若直接採用，背線會掉下去再跳回來，烘出來
   * 是一個凹坑。中位數對這種孤立漏失免疫，而剖面本身是平滑的，鄰近角度的
   * 半徑本來就接近。
   *
   * 【背線與腹線同樣走中位數】坑 20 說的是「不要用**擬合的** bUp/bDn，要用
   * 正上方那一條射線」—— 理由是單一指數的超橢圓配不上「上圓下平」的剖面。
   * 這裡沒有擬合，量到的就是射線本身，所以那條坑不適用；中位數只是把
   * 「那一條」換成「那一小撮的中位數」，仍然是直接量測。
   *
   * ── 平移 ────────────────────────────────────────────────────
   *
   * 機體座標 = 量測 Z − 3.0889。那個數字是**主翼翼根四分之一弦線**：**內段**
   * 前後緣各配一條直線外推到 X=0，得前緣 2.0516、弦長 4.1492，四分之一弦
   * 2.0516 + 4.1492/4 = 3.0889。原點是重心，四分之一弦線壓在原點才是正常
   * 的飛機配置（`HullSpec.offsetZ` 的推導）。
   */
  bake: async (_page, _probe, slice) => {
    const AXIS_V = 0.25
    const MAXR = 1.45
    /**
     * 【主翼四分之一弦線在量測系的 Z】機體座標 = 量測 Z − 這個數。
     *
     * 【2.7465 → 3.0889】原本的值是由「拿外段的前後緣各配一條
     * 直線，外推到 X = 0」得到的翼根弦 5.9535 算的。而 `root`／`wing` 那一趟
     * 量到主翼在 X = 3.4 有**轉折**，內段幾乎不後掠 —— 真正的翼根弦是 4.1492、
     * 前緣在量測 2.0516，四分之一弦 2.0516 + 1.0373 = 3.0889。
     *
     * 原點就是重心，而重心必須壓在四分之一弦線上（`geometry.test.ts` 有護欄）。
     * 翼根弦改了，原點就得跟著改 —— 整台往前挪 0.3424 m。
     */
    const QUARTER_CHORD = 3.0889
    /**
     * 每站的輸出角度：正上方 → 右側 → 正下方。
     *
     * 【為什麼是 16 點不是 8 點】
     * 八點在 P-51D 那種細機身上夠用（相鄰兩點
     * 相距約 0.25 m），但 He 111 的機身周長是它的一倍多，同樣八點的相鄰間距
     * 到了 0.55 m —— 剖面因此讀成一個八邊形而不是一個水滴。
     */
    const OUT_DEG = Array.from({ length: 16 }, (_, i) => 90 - i * 12)

    /**
     * 【量測段的兩端都是量出來的，不是挑的】
     *
     * 起點 −0.10：**不是** `align` 給的 −0.5。那一刀是 0.5 m 一格、而且整台
     *            一起量 —— −0.5 那一站的 X 幅度只有 0.039，是機首那根細桿
     *            （天線或機槍管），不是機身。`nose` 那一格把 X 限在 ±1.2 再
     *            每 0.05 m 切一刀，機身自己的線段從 −0.10 才開始（X 幅度由
     *            0.052 跳到 0.355）。用 −0.5 當首站等於**把機首憑空拉長
     *            0.4 m**，而且側視看起來只是「機首比較尖」。
     *
     * 終點 12.3：尾翼從這之後開始污染。實測 —— 水平尾翼從量測 Z ≈ 12.4 起
     *            被「略低於水平」那條射線打到（半寬由 0.35 跳到 0.68、
     *            1.10），垂尾從 Z ≈ 13.2 起被正上方那條打到（背線由 0.48
     *            跳到 0.74、1.07）。**兩者都不是機身。**
     *            12.3 之後的尾錐手工收，錨在最後一個乾淨站位（坑 15）。
     *
     * 【站距 0.2 m】63 站。與點數加倍同一個理由；順帶讓拉普拉斯平滑
     * （坑 19）作用在更細的尺度上，機身因此更接近一個單純的水滴體。
     */
    const rs = await slice('radial', 'z', {
      from: -0.10, to: 12.3, count: 63, angles: 144, axisV: AXIS_V, maxRadius: MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }

    /**
     * ── 朝下那幾條射線要另外一趟，上限開大 ────────────────────
     *
     * 【maxRadius 把腹艙整個吃掉了】1.45 配上原點 y = 0.25，射線只夠到
     * y = −1.20。而腹艙（Bola）的底在 −1.27 左右 —— **超出上限的射線直接
     * 回 0**，`robust` 把 0 當成「沒量到」濾掉，那幾站於是變成洞、被沿 z
     * 內插填掉。烘出來的機腹因此淺了 0.2～0.3 m，而且是一條平滑的波浪，
     * 看不出曾經有東西被拿掉。
     *
     * 這是坑 6 的變體：**上限不會報錯，它只是把樣本悄悄拿掉。**
     *
     * 【為什麼不是整趟都開大】`maxRadius` 本來就是用來擋機翼與起落架的
     * （見 `sliceRef` 的檔頭）。水平方向的射線一開大就會穿出機身打到機翼。
     * 但**朝下**的那幾條不會：機翼在 |x| > 0.9 之外，而 −66° 的射線走到
     * r = 1.5 也才 x = 0.61，仍然在機身正下方。
     */
    const KEEL_MAXR = 2.1
    const keel = await slice('radial', 'z', {
      from: -0.10, to: 12.3, count: 63, angles: 144, axisV: AXIS_V, maxRadius: KEEL_MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }
    /** 用大上限那一趟的角度（正下方那三點） */
    const KEEL_DEG = -66

    /**
     * 指定視窗內、非零的半徑中位數；全空回 NaN。**`win = 0` 改成只讀最接近
     * 的那一條射線**（細長的零件要用它，見下方腹艙）。
     *
     * 【視窗 ±12° → ±6°】輸出點的間距是 12°，視窗還開 ±12° 的話相鄰輸出點
     * 的取樣範圍會互相重疊一半，剖面被抹平。射線加倍到 144 條之後，±6° 內
     * 仍有五條可取中位數。
     */
    const robust = (
      row: readonly number[], theta: readonly number[], deg: number, win = 6,
    ): number => {
      const want = deg * Math.PI / 180
      const norm = (j: number) => {
        let d = theta[j]! - want
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        return d
      }
      if (win === 0) {
        let best = 0
        for (let j = 1; j < theta.length; j++) {
          if (Math.abs(norm(j)) < Math.abs(norm(best))) best = j
        }
        return row[best]! > 0 ? row[best]! : NaN
      }
      const near: number[] = []
      for (let j = 0; j < theta.length; j++) {
        if (Math.abs(norm(j)) <= win * Math.PI / 180 && row[j]! > 0) near.push(row[j]!)
      }
      if (near.length === 0) return NaN
      near.sort((a, b) => a - b)
      return near[near.length >> 1]!
    }

    /**
     * ── 機背機槍座：開放式的，正上方那條射線會穿進去 ──────────
     *
     * 【原本這是人工改在 `he111.hull.ts` 裡的六個數字】那撐不過一次重烘 ——
     * 這一版就是。所以搬進腳本，用一條**可重跑**的規則取代人工。
     *
     * 規則：背線（第 0 點）在這一段整條標成 NaN，交給下面的補洞沿 z 內插
     * ——「由前後兩個乾淨站位拉一條線」，與尾錐背線用的是同一招（坑 15）。
     *
     * 【為什麼不是把中位數視窗放寬】試過 ±20°，救不回來。下面那張並排表
     * 是證據：量測 5.7／5.9 兩站，±6° 給 1.209／1.208、±20° 給 1.020／0.973
     * ——**兩個視窗互相矛盾**，代表射線在那裡打到的根本不是同一個面。開口的
     * 角寬比 20° 還大，放寬只是換一個錯的答案。
     *
     * 【範圍每一點都不一樣】只標**正上方**那一條、或是 z 範圍抓錯邊的話，
     * 烘出來是機背「中間一條平滑的脊、兩旁各一條塌下去 0.43／0.21 m 的溝」
     * —— 第 0 點是內插的乾淨線，第 1、2 點卻還是穿過開口量到的值。
     *
     * `dorsal` 那一格逐條射線印出來（機體座標、單條射線的半徑）：
     *
     * ```
     *   機體Z    90°    78°    72°    66°    54°
     *    2.31   0.610  0.625  1.033  1.069  1.058   ← 90／78 穿進去
     *    2.51   1.206  0.000  0.000  1.055  1.047   ← 78／72 完全打不到
     *    2.91   1.190  0.972  1.035  1.060  1.034   ← 78 比 66 還低 → 不可能
     *    3.11   1.176  1.063  1.060  1.049  1.023   ← 恢復正常
     * ```
     *
     * 判準有兩個，都不必猜：**射線回 0**（打不到任何東西），以及**外側的
     * 點比內側的點還低**（凸剖面不可能）。
     *
     * 正上方那一條在 2.51 就乾淨了（1.206 → 絕對高度 1.456，與後方的 1.426、
     * 1.418 連得上）；78° 那一條一路壞到 3.05。所以逐點各自一個範圍。
     *
     * 【66° 以外都是真的】第 2、3 點在 1.91→2.11 之間同步下降 0.16／0.10
     * —— 兩條一起降代表那是**剖面本身**在圓頂之後收窄，不是開口。
     */
    const GUN_HOLES: { deg: number; from: number; to: number }[] = [
      // 量測系 = 機體 + 3.0889
      /**
       * 【90° 與 78° 同一個範圍 —— 先前把 90° 收窄是被天線騙的】曾經只標到
       * 機體 2.45，理由是「正上方那一條在 2.51 就乾淨了」。但那個判讀用的是
       * **單條射線**，而單條射線在那一段打到的是**天線鋼索**（從機背拉到
       * 垂尾頂，永遠比機背高）。改用中位數之後 5.90 給 1.458、6.10 給 1.247
       * —— 一步掉 0.21，而前後都是每站 0.017 的平順下降。那不是形狀。
       */
      { deg: 90, from: 1.85 + QUARTER_CHORD, to: 3.05 + QUARTER_CHORD },
      { deg: 78, from: 1.85 + QUARTER_CHORD, to: 3.05 + QUARTER_CHORD },
      /**
       * ── 主翼翼根整流罩（機體 2.6～3.6，接近水平的那四點）──────
       *
       * 機身最寬處是 0.88，而這一段量到 **1.033**（機體 3.21 的 −30° 那一點）
       * —— 寬了 18%，而且同一圈的鄰點是 0.924／0.863，是一根**單點的凸起**。
       * 那是翼根整流罩：它只出現在主翼翼根後緣附近（翼根弦 −1.04…3.11），
       * 前後都沒有。
       *
       * 【在水平線**下方**】機翼裝在機身中線之下（`WING.rootY` −0.30），所以
       * 整流罩長在 −18°／−30° 那兩點上，不是正側面。標成 ±18°／±6° 的話全部
       * 標在錯的一邊，鼓包會原封不動留著。
       *
       * 【為什麼要讓出來】主翼在這個模型裡是**獨立的翼面板**，整流罩烘進機身
       * 等於在機腰上長一顆與機翼無關的鼓包 —— 側視是一坨、俯視是一圈。
       * 讓出來之後機身是乾淨的水滴，整流罩本身沒有做（坑 15：量得到但故意
       * 不用的東西也要交代）。
       */
      { deg: -18, from: 2.60 + QUARTER_CHORD, to: 3.60 + QUARTER_CHORD },
      { deg: -30, from: 2.60 + QUARTER_CHORD, to: 3.60 + QUARTER_CHORD },
      /**
       * ── 整流罩的**前端**（機體 −1.15～−0.65）────────────────
       *
       * 上面那一段標的是後緣附近。整流罩在**前緣**也有一段，而且它烘進機身
       * 之後長出來的東西比後緣那一坨還醒目：
       *
       * ```
       *   機體z    −18°    −30°
       *   −1.19    0.87    0.82
       *   −0.99    1.11 ←  0.97 ←
       *   −0.79    0.91    1.00 ←
       *   −0.59    0.88    0.84
       * ```
       *
       * −18° 那一站是**單站 +0.24**，機身最寬處只有 0.90。烘出來是一片從
       * 機腰斜插出去的尖楔，正好落在主翼前緣與機身的交會處 —— 那就是
       * 「主機翼前方靠近機身的位置沒有很平順」的來源。
       *
       * 【為什麼前緣這一段一直沒被抓到】站位 0.2 m 一刀，整流罩前端只跨
       * 兩站；沿 z 的保邊平滑（門檻 0.15）看到 0.24 的落差直接判定成「真的
       * 轉折」而不動它 —— **保邊會保護雜訊，只要雜訊夠大。**
       */
      { deg: -18, from: -1.15 + QUARTER_CHORD, to: -0.65 + QUARTER_CHORD },
      { deg: -30, from: -1.15 + QUARTER_CHORD, to: -0.65 + QUARTER_CHORD },
      /**
       * ── 腹艙（Bola）整段也標成洞 ──────────────────────────
       *
       * 【它不屬於機身外殼】外殼一圈 16 點、相鄰差 12°。吊艙的半寬只有 0.32
       * 而它掛在 r ≈ 1.5 的地方 —— 偏 12° 那一點橫向已經 0.31，**早就在吊艙
       * 外面**。硬烘進來做出的是一根沿中線的尖刺，不是一顆圓凸起。
       *
       * 所以吊艙改成獨立零件（`he111.ts` 的 `BOLA`，與發動機艙同一個判斷），
       * 這裡把它讓出來、由前後的乾淨站位內插出機身自己的腹線。
       *
       * 【範圍 5.45～8.55 比吊艙本身寬】從吊艙內部 (0, −1.05) 射線量到的
       * 半寬顯示：5.50～5.80 與 8.10～8.40 這兩段的**半寬是 0** —— 那是中線
       * 上兩根細長的東西（天線桿之類），不是吊艙。它們一樣不該進外殼。
       *
       * 【−78° 也要標，−66° 不用】r ≈ 1.1 時 −78° 橫向是 0.23（在吊艙上），
       * −66° 是 0.45（已經在外面）。
       */
      { deg: -90, from: 5.45, to: 8.55 },
      { deg: -78, from: 5.45, to: 8.55 },
    ]

    /**
     * ── 站位 × 16 點，**存極座標的半徑** ─────────────────────
     *
     * 【為什麼改存 r(θ) 而不是 (x, y)】平滑要作用在兩個方向上：沿 z（坑 19
     * 原本就有）與**繞剖面一圈**（這一版新加的）。繞一圈平滑必須在極座標裡
     * 做 —— 在 (x, y) 上平均會把剖面往中心縮，愈平滑愈瘦。
     *
     * 環向平滑是這一版才需要的：八點時相鄰輸出點差 25.7°，一根 0.1 m 的
     * 凸起落在兩點之間就自然被略過；十六點差 12°，同一根凸起會被**一個點**
     * 打到而鄰點沒有 —— 剖面上因此長出單點毛刺。實測機首腹部：−78° 那一點
     * 量到 y −0.646，而正下方只有 −0.523，一根往斜下戳出去的刺。
     *
     * ── 左右對稱化：`(r(θ) + r(180°−θ)) / 2` ────────────────────
     *
     * 【為什麼非做不可】`HullRing` 只存右半、左半一律鏡像 —— 它的檔頭寫著
     * 「不對稱的特徵應該是另外貼上去的零件」。但**只往 +X 射線再鏡像**做的
     * 不是那件事：它把偏心的那一側當成半寬，**左右各放一份**，於是任何橫向
     * 偏移都被加倍。
     *
     * 實測機首（`nose` 那一格的兩把尺並排）：
     *
     * ```
     *   量測Z   射線最大|x|  線段幅度/2    差
     *   -0.10      0.324       0.177     0.147
     *    0.00      0.467       0.320     0.147
     *    0.20      0.585       0.438     0.147
     *    0.45      0.673       0.560     0.114
     * ```
     *
     * 固定的 0.147 —— 那不是形狀，是**剖面整體往 +X 偏了 0.14**（真機
     * He 111 的機首機槍座就是偏右的，參考模型有做）。鏡像之後機首寬了
     * 0.29 m，看起來就是一顆球接在機身前面。
     *
     * 對稱化把偏心平均掉，而機身其餘各段本來就左右對稱（`r(θ) ≈ r(180°−θ)`），
     * 那裡等於一次額外的雜訊平均，不改形狀。正上方與正下方那兩點的鏡像角
     * 就是自己，逐字不動。
     */
    const planes = rs.planes
    const rad: number[][] = []
    const topPair: [number, number, number][] = []
    for (let k = 0; k < planes.length; k++) {
      const row = rs.r[k]!
      const z = planes[k]!
      topPair.push([z, robust(row, rs.theta, 90), robust(row, rs.theta, 90, 20)])
      rad.push(OUT_DEG.map((deg) => {
        if (GUN_HOLES.some((h) => h.deg === deg && z >= h.from && z <= h.to)) return NaN
        /**
         * 左右對稱化，見下方。朝下那三點只換上限、不換視窗：
         *
         *   上限  改用開大的那一趟（見 KEEL_MAXR）—— 1.45 只夠到 y = −1.20，
         *         而機腹最深處在 −1.28，**超出上限的射線直接回 0**（坑 6）
         *   視窗  仍然是 ±6°
         *
         * 【曾經改成單條射線，後來改回來】為了做出腹艙的「前後兩道垂直面」
         * 試過 `win = 0`。後來從吊艙內部射線量到那兩處的**半寬是 0** —— 那是
         * 中線上兩根細桿，不是吊艙的端面。單條射線因此只是把兩根桿子畫了
         * 出來，代價是腹艙以外的整段機腹失去中位數保護，尾段的腹線抖動
         * ±0.03、五次變號。吊艙改成獨立零件之後，這裡回到中位數。
         */
        const src = deg <= KEEL_DEG ? keel : rs
        const row2 = src.r[k]!
        const right = robust(row2, src.theta, deg)
        const left = robust(row2, src.theta, 180 - deg)
        /**
         * 【只有一側量到 → 當成洞，不要拿另一側頂替】
         *
         * 一側完全沒有射線打到，代表**該站的剖面沒有跨過射線原點** —— 從
         * 軸心射出去的量法在那裡根本不成立。拿有量到的那一側當半寬，就是
         * 上面說的「把偏心加倍」，而且是最嚴重的版本。
         *
         * 實測機首量測 −0.10：右側量到 0.318、左側全空，線段量到的真實半寬
         * 只有 0.177。頂替會做出一個 0.64 m 寬的圓盤黏在機首尖端上。
         *
         * 標成 NaN 交給補洞沿 z 內插，那一站因此由前後兩站決定（尖端的 0
         * 與 0.10 的 0.400，內插得 0.19，對真實值 0.177）。
         */
        if (!Number.isFinite(right) || !Number.isFinite(left)) return NaN
        return (right + left) / 2
      }))
    }
    // 腹艙那一段的腹線：單條射線 vs ±3° 中位數（端面是不是被抹掉了）
    console.log('// ── 腹線：單條射線 對 ±3° 中位數（腹艙那一段）──')
    {
      const dnJ = keel.theta.reduce((b, th, j) => (
        Math.abs(th - 270 * Math.PI / 180) < Math.abs(keel.theta[b]! - 270 * Math.PI / 180)
          ? j : b
      ), 0)
      for (let k = 0; k < planes.length; k++) {
        const z = planes[k]!
        if (z < 4.8 || z > 9.0) continue
        const one = keel.r[k]![dnJ]!
        const med = robust(keel.r[k]!, keel.theta, -90, 3)
        console.log(`//   量測 ${n(z, 6, 2)}  單條 ${n(one)}  ±3° ${n(med)}  差 ${n(med - one)}`)
      }
    }
    console.log('// ── 背線：±6° 對 ±20°（機背機槍座那一段兩者互相矛盾）──')
    for (const [z, a, b] of topPair) {
      const holes = GUN_HOLES.filter((h) => z >= h.from && z <= h.to).map((h) => h.deg)
      const flag = holes.length ? `  ←丟掉 ${holes.join('/')}°，沿 z 內插` : ''
      console.log(`//   量測 ${n(z, 6, 2)}  ±6° ${n(a)}  ±20° ${n(b)}  差 ${n(b - a)}${flag}`)
    }

    // ── 補洞：任何 NaN 由前後最近的有效站位沿 z 線性內插 ────
    let holes = 0
    for (let p = 0; p < OUT_DEG.length; p++) {
      for (let k = 0; k < planes.length; k++) {
        if (Number.isFinite(rad[k]![p]!)) continue
        holes++
        let a = k - 1
        while (a >= 0 && !Number.isFinite(rad[a]![p]!)) a--
        let b = k + 1
        while (b < planes.length && !Number.isFinite(rad[b]![p]!)) b++
        if (a >= 0 && b < planes.length) {
          const t = (planes[k]! - planes[a]!) / (planes[b]! - planes[a]!)
          rad[k]![p] = rad[a]![p]! + (rad[b]![p]! - rad[a]![p]!) * t
        } else if (a >= 0) rad[k]![p] = rad[a]![p]!
        else if (b < planes.length) rad[k]![p] = rad[b]![p]!
        else rad[k]![p] = 0
      }
    }

    /**
     * 環向平滑一輪，λ = 0.35。單點毛刺會被鄰點拉回來，而跨三點以上的真實
     * 特徵（腹艙、座艙罩肩線）幾乎不動 —— 這正是要的分界。
     *
     * 【兩端不動】第 0 點是背線、最後一點是腹線，兩者各只有一個鄰點，
     * 硬平滑等於把它們往側面拉。
     */
    for (let k = 0; k < planes.length; k++) {
      const src = [...rad[k]!]
      for (let p = 1; p < OUT_DEG.length - 1; p++) {
        rad[k]![p] = src[p]! + ((src[p - 1]! + src[p + 1]!) / 2 - src[p]!) * 0.35
      }
    }

    /**
     * z 不等距的拉普拉斯平滑，兩輪（坑 19）。
     *
     * 【為什麼不是等權的 [.25,.5,.25]】站距不等距時等權濾波會把密集區壓扁。
     * 這裡把每一站往「前後兩站在該 z 的連線」拉 λ = 0.5。
     */
    /**
     * 【保邊：一步跳超過 EDGE 的地方不平滑】
     *
     * 平滑是為了除漣漪（坑 19）。但機身上有**真的是垂直面**的東西 —— 腹艙
     * 的前後兩道端面在參考模型上是一步 0.30／0.41 m。兩輪 λ=0.5 會把那一步
     * 攤成 0.8 m 的斜坡，吊艙於是變成一坨圓潤的鼓包。
     *
     * 判準用**跳的幅度**：漣漪的振幅是公分級，端面是 0.3 m 級，兩者差一個
     * 數量級，門檻取 0.15 落在正中間。
     */
    const EDGE = 0.15
    for (let pass = 0; pass < 2; pass++) {
      const src = rad.map((r) => [...r])
      for (let k = 1; k < planes.length - 1; k++) {
        const t = (planes[k]! - planes[k - 1]!) / (planes[k + 1]! - planes[k - 1]!)
        for (let p = 0; p < OUT_DEG.length; p++) {
          const a = src[k]![p]! - src[k - 1]![p]!
          const b = src[k + 1]![p]! - src[k]![p]!
          if (Math.abs(a) > EDGE || Math.abs(b) > EDGE) continue
          const line = src[k - 1]![p]! + (src[k + 1]![p]! - src[k - 1]![p]!) * t
          rad[k]![p] = src[k]![p]! + (line - src[k]![p]!) * 0.5
        }
      }
    }

    // ── 極座標 → (x, y) ────────────────────────────────────
    type Ring = { z: number; pts: [number, number][] }
    const rings: Ring[] = planes.map((z, k) => ({
      z: z - QUARTER_CHORD,
      pts: OUT_DEG.map((deg, p) => {
        const th = deg * Math.PI / 180
        return [
          Math.abs(rad[k]![p]! * Math.cos(th)), AXIS_V + rad[k]![p]! * Math.sin(th),
        ] as [number, number]
      }),
    }))

    /**
     * ── 機首第一站：射線在那裡量不到，改用線段幅度重建（坑 15）──────
     *
     * 【為什麼量不到】那一站的剖面**整個在 +X 側**（x −0.04…+0.32），沒有
     * 跨過射線原點 —— 往 −X 射的線一條都打不到。從軸心射的量法在那裡不成立，
     * 而它不會回報失敗，只會給出偏心那一側的距離。
     *
     * 【改用什麼】`extentSlices` 量的是三角形頂點的 X 幅度，不吃偏心。用它
     * 與下一站的比值，把下一站的十六邊形整個縮過來 —— 與尾錐那一段「形狀
     * 沿用最後一個量測站位、依半寬等比縮放」是同一招。
     */
    {
      const ne = await slice('extent', 'z', {
        from: -0.10, to: 0.10, count: 2, uWindow: [-1.2, 1.2],
      }) as Extent
      const halfAt = (i: number) => (ne.uMax[i]! - ne.uMin[i]!) / 2
      const ratio = halfAt(0) / halfAt(1)
      const a = rings[0]!, b = rings[1]!
      const cy = (b.pts[0]![1] + b.pts[OUT_DEG.length - 1]![1]) / 2
      a.pts = b.pts.map(([x, y]) => [x * ratio, cy + (y - cy) * ratio] as [number, number])
      console.log(`// 機首第一站重建：線段半寬 ${halfAt(0).toFixed(3)} / `
        + `${halfAt(1).toFixed(3)} = ${ratio.toFixed(3)}（射線在那裡量不到）`)
    }

    /**
     * 【機首尖端是**另外接**一站，不是把首站塌掉】
     *
     * 塌掉會丟掉一整站的量測。`nose` 那一格量到機身自己的線段在量測 −0.10
     * 就有 0.355 m 寬、−0.15 只剩 0.052 —— 所以尖端在 −0.14 附近，而 −0.10
     * 那一站是**真的有寬度的**，塌掉它等於把 0.36 m 寬的機首硬收成一點。
     */
    {
      const f = rings[0]!
      const mid = (f.pts[0]![1] + f.pts[OUT_DEG.length - 1]![1]) / 2
      rings.unshift({
        z: -0.14 - QUARTER_CHORD,
        pts: f.pts.map(() => [0, mid] as [number, number]),
      })
    }

    // ── 品質指標（坑 19：分得出漣漪的只有曲率變號）──────────
    const widest = rings.map((r) => Math.max(...r.pts.map((p) => p[0])))
    let signChanges = 0
    for (let k = 2; k < widest.length; k++) {
      const a = widest[k]! - widest[k - 1]!
      const b = widest[k - 1]! - widest[k - 2]!
      if (a * b < 0) signChanges++
    }
    console.log(`// 補洞 ${holes} 點；最寬線曲率變號 ${signChanges}/${widest.length} 站`)

    /**
     * ── 尾錐（量測 12.3 → 15.9）────────────────────────────
     *
     * 【為什麼要分開做】這一段的**正上方**射線打到垂尾（背線由 0.48 跳到
     * 1.07），但**水平**與**正下方**的射線是乾淨的 —— 垂尾在正上方、水平
     * 尾翼在略低於水平的位置，兩者都不擋這兩條。所以：
     *
     *   半寬、腹線  照量
     *   背線        由最後一個乾淨站位（量測 12.96、0.477）線性收到尾錐尖端
     *   剖面形狀    沿用最後一個量測站位的八邊形，依半寬等比縮放
     *
     * 這比「整段手打」誠實：形狀與寬度仍然是量出來的，只有一條線是內插的，
     * 而那一條在文件裡標出來了（坑 15 要求逐段交代）。
     */
    const tail = await slice('radial', 'z', {
      from: 12.3, to: 15.9, count: 19, angles: 144, axisV: AXIS_V, maxRadius: KEEL_MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }

    const last = rings[rings.length - 1]!
    const lastTop = last.pts[0]![1]
    const lastBot = last.pts[OUT_DEG.length - 1]![1]
    /** 背線的內插起點：最後一個乾淨站位量到的值 */
    const TOP_FROM = lastTop
    /** 尾錐尖端的背線。真機尾錐收在方向舵之前，這裡取腹線之上一點點 */
    const TOP_TO = 0.06

    /**
     * 【量不到的站位要內插，不能跳過】跳過會在尾錐上留一個 0.8 m 的空檔，
     * 而 lofting 會把那一段拉成一條長斜坡（坑 10 的同一個病）。
     */
    const wRaw: number[] = []
    const bRaw: number[] = []
    for (let k = 0; k < tail.planes.length; k++) {
      wRaw.push(robust(tail.r[k]!, tail.theta, 0))
      bRaw.push(AXIS_V - robust(tail.r[k]!, tail.theta, -90))
    }
    const fill = (a: number[]): number => {
      let n = 0
      for (let k = 0; k < a.length; k++) {
        if (Number.isFinite(a[k]!)) continue
        n++
        let i = k - 1
        while (i >= 0 && !Number.isFinite(a[i]!)) i--
        let j = k + 1
        while (j < a.length && !Number.isFinite(a[j]!)) j++
        if (i >= 0 && j < a.length) a[k] = a[i]! + (a[j]! - a[i]!) * ((k - i) / (j - i))
        else if (i >= 0) a[k] = a[i]!
        else if (j < a.length) a[k] = a[j]!
        else a[k] = 0
      }
      return n
    }
    const filled = fill(wRaw) + fill(bRaw)

    /**
     * 【尾錐那兩條線也要平滑】它們是單獨一趟切片、沒有經過主段的平滑，
     * 實測腹線在機體 11.21 有一根 −0.089／＋0.110 的尖刺。等距三點加權
     * ［0.25, 0.5, 0.25］一輪。
     */
    for (const a of [wRaw, bRaw]) {
      const src2 = [...a]
      for (let k = 1; k < a.length - 1; k++) {
        a[k] = src2[k - 1]! * 0.25 + src2[k]! * 0.5 + src2[k + 1]! * 0.25
      }
    }

    /**
     * 【縮放的基準必須與 wRaw 量的是同一件事】原本用「最後一個機身環的
     * **最大半寬**」當分母，而 `wRaw` 是**0° 那一條射線**的半徑 —— 剖面最寬處
     * 不在正水平時兩者不相等，實測差 19%，於是尾錐第一站一步縮掉 0.101
     * （0.520 → 0.419），側視看起來是機尾突然被掐了一下。
     *
     * `tail` 的第一站與機身的最後一站切在同一個平面（量測 12.3），所以拿
     * `wRaw[0]` 當分母，接縫處的比例恆為 1。
     */
    const lastW = wRaw[0]!

    let tailCount = 0
    for (let k = 1; k < tail.planes.length; k++) {
      const z = tail.planes[k]! - QUARTER_CHORD
      const t = k / (tail.planes.length - 1)
      const top = TOP_FROM + (TOP_TO - TOP_FROM) * t
      const bot = bRaw[k]!
      const sx = lastW > 1e-6 ? wRaw[k]! / lastW : 0
      // y 依「上下界」重映射：模板的 top→bot 映到這一站的 top→bot
      const pts = last.pts.map(([x, y]) => {
        const u = (y - lastBot) / (lastTop - lastBot)
        return [x * sx, bot + (top - bot) * u] as [number, number]
      })
      rings.push({ z, pts })
      tailCount++
    }

    /**
     * 【尖端是**另外接**一站，不是把最後一個真實站位塌掉】塌掉的話會丟掉
     * 一整站的量測，而且尾錐會在那裡斷得很突兀（實測：腹線一步由 −0.51
     * 跳到 −0.15）。
     *
     * 尖端的 z 取 `align` 量到的幾何上界 16.0（量測系）。
     */
    {
      const e = rings[rings.length - 1]!
      rings.push({
        z: 16.0 - QUARTER_CHORD,
        pts: e.pts.map(
          () => [0, (e.pts[0]![1] + e.pts[OUT_DEG.length - 1]![1]) / 2] as [number, number],
        ),
      })
    }
    console.log(`// 尾錐 ${tailCount} 站 + 尖端（半寬與腹線照量、補洞 ${filled} 點、`
      + `背線由 ${TOP_FROM.toFixed(3)} 內插到 ${TOP_TO}）`)

    // ── 吐出字面值 ────────────────────────────────────────
    console.log(`// 共 ${rings.length} 站`)
    console.log('export const HE111_HULL: readonly HullRing[] = [')
    for (const r of rings) {
      const half = r.pts
        .map(([x, y]) => `[${x.toFixed(4)}, ${y.toFixed(4)}]`)
        .join(', ')
      console.log(`  { z: ${r.z.toFixed(4)}, half: [${half}] },`)
    }
    console.log(']')
  },

  /**
   * 【發動機艙】把射線原點橫移到發動機艙的中心（`axisU`），機身與機翼就
   * 干擾不到 —— 與座艙罩那一招同構，只是移的是 u 不是 v。
   *
   * 中心 X ≈ 2.6：`wing` 那一趟量到 X 2.2~3.2 的翼厚由 0.9 暴增到 1.54，
   * 峰值在 2.6。
   */
  nacelle: async (_page, _probe, slice) => {
    const AXIS_U = 2.6
    const AXIS_V = 0.0
    /**
     * 【上限要 1.3】1.0 會把艙底切掉：實測下緣量到 **0.994**，貼著上限
     * ——「等於邊界值的參數就是垃圾資料」（坑 6）。而超出的射線回 0、被
     * 當成量不到，看不出來。
     */
    const MAXR = 1.3
    const rs = await slice('radial', 'z', {
      from: -0.4, to: 8.0, count: 43, angles: 72,
      axisU: AXIS_U, axisV: AXIS_V, maxRadius: MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }
    console.log(`── 發動機艙（射線原點 X=${AXIS_U}、Y=${AXIS_V}、maxRadius=${MAXR}）──`)
    const T = rs.theta
    const iAt = (deg: number) =>
      T.reduce((b, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[b]! - deg * Math.PI / 180) ? j : b
      ), 0)
    const [ri, up, le, dn] = [iAt(0), iAt(90), iAt(180), iAt(270)]
    console.log('      Z      外側     上緣     內側     下緣    卡邊界')
    for (let k = 0; k < rs.planes.length; k++) {
      const row = rs.r[k]!
      const cap = row.filter((v) => v >= MAXR - 1e-6).length
      console.log(
        `  ${n(rs.planes[k]!, 6, 2)}  ${n(row[ri]!)}  ${n(row[up]!)}`
        + `  ${n(row[le]!)}  ${n(row[dn]!)}  ${String(cap).padStart(6)}`,
      )
    }

    /**
     * 【散熱器進氣口的那道垂直面】0.2 m 一格看到的是「下緣在 1.80→2.00 之間
     * 由 0.674 跳到 0.959」。跳 0.285 m 而縱向只走 0.2 m —— 那不是斜坡，是
     * 一道**面**。切細 8 倍才問得出它到底站在哪一刀上。
     *
     * 這件事對造型是決定性的：`loft` 在兩個截面之間是線性內插，所以
     * 0.2 m 的間距會把這道面攤成 16° 的斜坡。要做成垂直面，必須在同一個位置
     * 前後各放一個截面（坑 10 —— 座艙開口的前後壁用的是同一招）。
     */
    const fine = await slice('radial', 'z', {
      from: 1.70, to: 2.10, count: 17, angles: 72,
      axisU: AXIS_U, axisV: AXIS_V, maxRadius: MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }
    console.log('\n── 下緣的那一道跳階，切細 8 倍（0.025 m 一格）──')
    console.log('      Z      下緣     外側     上緣    與前一刀的差')
    let prev = NaN
    for (let k = 0; k < fine.planes.length; k++) {
      const row = fine.r[k]!
      const d = row[dn]!
      console.log(
        `  ${n(fine.planes[k]!, 6, 3)}  ${n(d)}  ${n(row[ri]!)}  ${n(row[up]!)}`
        + `  ${n(Number.isFinite(prev) ? d - prev : NaN, 12)}`,
      )
      prev = d
    }
  },

  /**
   * 【機身橫剖】射線由機身軸心往外，取最外側交點。
   *
   * 【maxRadius 一定要收】對齊那一趟發現 `Y上` 從 Z=7 一路線性升到 Z=15
   * —— 那是**天線鋼索**不是機背線（線段數只有一千出頭）。鋼索在機背之上
   * 好幾十公分，maxRadius 放寬就會整段被它取代，而數字看起來完全正常。
   *
   * 【坑 6：任何參數卡在邊界就是垃圾資料】所以下面同時印出「有幾個角度的
   * r 剛好等於 maxRadius」——不是 0 就代表窗口訂太小。
   */
  fuselage: async (_page, _probe, slice) => {
    const MAXR = 1.45
    const AXIS_V = 0.25
    const rs = await slice('radial', 'z', {
      from: 0.0, to: 15.8, count: 40, angles: 72, axisV: AXIS_V, maxRadius: MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }

    console.log(`── 機身橫剖（射線原點 Y=${AXIS_V}、maxRadius=${MAXR}）──`)
    console.log('      Z     半寬     背線     腹線    卡邊界  量不到')
    const T = rs.theta
    const iAt = (deg: number) =>
      T.reduce((best, th, j) => (
        Math.abs(th - deg * Math.PI / 180) < Math.abs(T[best]! - deg * Math.PI / 180) ? j : best
      ), 0)
    const iRight = iAt(0), iUp = iAt(90), iDown = iAt(270)

    for (let k = 0; k < rs.planes.length; k++) {
      const row = rs.r[k]!
      const atCap = row.filter((v) => v >= MAXR - 1e-6).length
      const zero = row.filter((v) => v === 0).length
      console.log(
        `  ${n(rs.planes[k]!, 6, 2)}  ${n(row[iRight]!)}`
        + `  ${n(AXIS_V + row[iUp]!)}  ${n(AXIS_V - row[iDown]!)}`
        + `  ${String(atCap).padStart(6)}  ${String(zero).padStart(6)}`,
      )
    }
  },
}

void main()
