/**
 * B-17G 參考模型的切片量測。**不由 vitest 執行**。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                            # 終端機一
 * npx vite-node test/tools/b17-ref.measure.ts -- raw     # 終端機二
 * ```
 *
 * 【`URL` 的埠要對】vite 在 5173 被佔用時會往上找，開跑前看終端機一那一行。
 *
 * ── 這支腳本在整條產線的哪一格 ──────────────────────────────
 *
 * `.claude/skills/aircraft-from-reference` 第 1～2 步。**坑 16**：機身、機翼、
 * 四具發動機艙、尾翼、透明件必須**在同一次切片、同一個座標系**量出來，最後
 * 才整體平移一次。分批量的代價是「每個零件自己都對，彼此的關係錯 0.85 m，
 * 而且側視疊圖看不出來」。
 *
 * ── 階段 ────────────────────────────────────────────────────
 *
 *   raw     不套對齊，只讀原始包圍盒與分件 → 定 yaw 的方向
 *   parts   分件清單（找玻璃 mesh 的名字，第 5b 步要用）
 *   align   套上 ALIGN，驗「機首在 −Z、翼展在 X、幅度對得上真機」
 */
import { chromium, type Page } from 'playwright'
import type { Align, Extent, Probe, Radial } from './hangar-hooks'

/**
 * 【為什麼要自己宣告 `process`】專案的 `tsconfig` 沒有把 `node` 放進 `types`，
 * 而 `tsc --noEmit` 會掃到 `test/` 底下。宣告用到的那一個欄位就好——把
 * `@types/node` 拉進來會讓瀏覽器端的程式碼也看得到 `Buffer`／`require`，
 * 而那些在那裡出現時**應該要紅**。
 */
declare const process: { argv: readonly string[] }

const URL = 'http://localhost:5178/hangar.html'
const GLB = '/ref/1943_boeing_b-17g-60-ve_flying_fortress.glb'
const SHOTS = '.shots/'

/**
 * B-17G Flying Fortress 的史實值。**坑 21：每個量到的數字都要先問有沒有
 * 史實值可以對。**
 *
 * 有史實值而且對得上 → 採量測值；對不上 → 史實優先，量測值只拿來定位置。
 *
 * ```
 *   翼展      103 ft 9 in   31.62 m
 *   全長       74 ft 4 in   22.66 m
 *   停放高度   19 ft 1 in    5.82 m   （尾輪著地，飛行姿態量不到）
 *   翼面積    1,420 sq ft  131.92 m²
 *   水平尾翼展   43 ft      13.11 m
 *   螺旋槳     11 ft 7 in    3.53 m   （四具 Wright R-1820-97）
 * ```
 */
const REAL = {
  span: 31.62,
  length: 22.66,
  heightOnGround: 5.82,
  wingArea: 131.92,
  tailSpan: 13.11,
  propDiameter: 3.53,
}

/**
 * 對齊。**yaw 的正負由 `raw`／`align` 兩階段實證，不要憑算的。**
 *
 * 【現況：三個值都還沒定】`raw` 跑完才知道長度躺在哪一根軸、機首朝哪邊；
 * scale 要等 `raw` 量到未縮放的翼展（= 31.62 / 量到的幅度）；pitch 要等
 * 機翼中線配線（坑 2）。在那之前這組值只是佔位。
 */
const ALIGN: Align = { yaw: 180, pitch: -1.03, scale: 1.011554 }

const n = (v: number, w = 7, d = 3): string =>
  (Number.isFinite(v) ? v.toFixed(d) : '—').padStart(w)

async function main(): Promise<void> {
  const stage = process.argv[process.argv.length - 1] ?? ''
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } })
    page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
    await page.goto(URL)
    await page.waitForFunction(() => '__hangarProbe' in window, null, { timeout: 30000 })

    // `raw` 不套對齊——它要問的正是「原始座標長什麼樣」
    /**
     * 【`verify` 走機庫自己的疊圖路徑，不是 probe】`__hangarProbe` 是給
     * 「還沒有自家模型」用的旁路：它自己套一組對齊參數、不經過 `placeRef`。
     * 而驗收要問的正是**遊戲裡實際疊出來的那一份對不對** —— 用旁路量等於
     * 驗了一個玩家永遠看不到的東西（坑 28）。
     */
    if (stage === 'verify') {
      await page.evaluate(() => window.__hangarSpec('b17g'))
      for (let i = 0; i < 120; i++) {
        if (await page.evaluate(() => window.__hangarRef(true, false))) break
        await page.waitForTimeout(500)
      }
      console.log('走機庫的 placeRef 疊圖路徑（不是 __hangarProbe 旁路）')
    }
    const align = stage === 'raw' || stage === 'verify' ? undefined : ALIGN
    const probe: Probe = stage === 'verify'
      ? { tris: 0, meshes: 0, min: [], max: [], size: [], parts: [] }
      : await page.evaluate(
      ([u, a]) => window.__hangarProbe(u as string, a as typeof ALIGN | undefined),
      [GLB, align] as const,
    )
    if (stage !== 'verify') console.log(
      `載入 ${probe.tris.toLocaleString()} 三角形、${probe.meshes} 個 mesh`)
    if (stage !== 'verify') console.log(align
      ? `對齊參數  yaw ${ALIGN.yaw}°  pitch ${ALIGN.pitch}°  scale ${ALIGN.scale}\n`
      : '**未套對齊**（原始座標）\n')

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

    await (stages[stage] ?? stages['raw']!)(page, probe, slice)
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
   * 【第一件事：哪一根軸是長度、機首朝哪邊】坑 3——軸向約定不保證一致，
   * 而且**不要自動判斷**（Bf 109 那台的機尾也有寬達 ±1.31 的部件，
   * 「螺旋槳端的 X 延伸較大」這種判準直接失效）。
   *
   * 所以這一格只印事實：三軸幅度、分件包圍盒、兩張正交截圖。方向由眼睛
   * 從截圖判一次，然後寫進 `ALIGN` 當定值。
   */
  raw: async (page, probe) => {
    console.log('── 原始包圍盒（模型自己的單位）───────────────')
    for (let i = 0; i < 3; i++) {
      console.log(`   ${'XYZ'[i]}  ${n(probe.min[i]!)} .. ${n(probe.max[i]!)}`
        + `   幅度 ${n(probe.size[i]!)}`)
    }

    /**
     * 【翼展軸的判準：包圍盒對稱於 0 的那一根】飛機左右對稱，所以翼展軸的
     * 上下界必然幾乎等長；長度軸與高度軸都不會。這比「哪一根最長」可靠——
     * B-17 的翼展 31.62 比全長 22.66 長，但那不是每台飛機都成立。
     */
    console.log('\n── 對稱性（|min| 與 max 差多少）──────────────')
    for (let i = 0; i < 3; i++) {
      const asym = Math.abs(Math.abs(probe.min[i]!) - probe.max[i]!)
      console.log(`   ${'XYZ'[i]}  不對稱 ${n(asym)}`
        + `   相對幅度 ${n(asym / probe.size[i]! * 100, 6, 1)}%`)
    }

    const wide = [0, 1, 2].reduce((b, i) => (probe.size[i]! > probe.size[b]! ? i : b), 0)
    console.log(`\n  最長的一軸是 ${'XYZ'[wide]}（幅度 ${n(probe.size[wide]!)}）`)
    for (let i = 0; i < 3; i++) {
      console.log(`  若 ${'XYZ'[i]} 是翼展 → scale = ${n(REAL.span / probe.size[i]!, 9, 6)}`)
    }

    console.log('\n── 前 20 大的 mesh ───────────────────────────')
    console.log('  三角形  名稱                          X範圍            Y範圍            Z範圍')
    const sorted = [...probe.parts].sort((a, b) => b.tris - a.tris)
    for (const p of sorted.slice(0, 20)) {
      console.log(
        `  ${String(p.tris).padStart(6)}  ${p.name.slice(0, 26).padEnd(28)}`
        + `${n(p.min[0]!, 6, 2)}..${n(p.max[0]!, 6, 2)}  `
        + `${n(p.min[1]!, 6, 2)}..${n(p.max[1]!, 6, 2)}  `
        + `${n(p.min[2]!, 6, 2)}..${n(p.max[2]!, 6, 2)}`,
      )
    }

    await page.evaluate(() => window.__hangarShow(false, true))
    for (const v of ['side', 'top', 'front']) {
      await page.evaluate((x) => window.__hangarOrtho(x), v)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${SHOTS}b17-raw-${v}.png` })
      console.log(`  截圖 ${v} → ${SHOTS}b17-raw-${v}.png`)
    }
  },

  /**
   * 【分件清單】參考模型自己怎麼把飛機切成 mesh。
   *
   * 【為什麼這是量測而不是偷懶】坑 5 說的是「不要靠節點分類去隔離**機身**」
   * ——蒙皮、內裝、隔框在第三方模型裡混成一團。但**玻璃**不一樣：它是另一種
   * 材質，任何模型都會把它分成獨立的 mesh。而玻璃的範圍正是切片量不到的
   * 東西（坑 15），也正是第 5b 步要拿去分別打射線的那個 `only`。
   */
  parts: async (_page, probe) => {
    console.log(`── ${probe.parts.length} 個 mesh，依三角形數排序 ──────────`)
    console.log('  三角形  名稱          原材質                    '
      + '  X範圍            Y範圍            Z範圍')
    const sorted = [...probe.parts].sort((a, b) => b.tris - a.tris)
    for (const p of sorted) {
      if (p.tris < 20) continue
      console.log(
        `  ${String(p.tris).padStart(6)}  ${p.name.slice(0, 12).padEnd(14)}`
        + `${p.mat.slice(0, 24).padEnd(26)}`
        + `${n(p.min[0]!, 6, 2)}..${n(p.max[0]!, 6, 2)}  `
        + `${n(p.min[1]!, 6, 2)}..${n(p.max[1]!, 6, 2)}  `
        + `${n(p.min[2]!, 6, 2)}..${n(p.max[2]!, 6, 2)}`,
      )
    }
    /**
     * 【這台的 mesh 名字沒有資訊】25 個 mesh 全部叫 `Object_12`、`Object_14`
     * ……所以 skill 第 5b 步那招「按名字挑玻璃」在這台上直接失效。
     *
     * 改用**材質**：玻璃在任何 GLB 裡都是另一份材質（透明、有穿透、或名字
     * 就叫 Glass）。`__hangarProbe` 現在會把原材質的摘要一起交出來。
     */
    const glassy = sorted.filter(
      (p) => /glass|canop|window|glaz|cristal|vidr|透明|穿透/i.test(p.mat + ' ' + p.name),
    )
    console.log(`\n── 材質看起來是玻璃的 ${glassy.length} 個 ──────────────`)
    for (const p of glassy) {
      console.log(`  ${p.name.padEnd(12)} ${p.mat.padEnd(24)}`
        + ` X ${n(p.min[0]!)}..${n(p.max[0]!)}`
        + `  Y ${n(p.min[1]!)}..${n(p.max[1]!)}  Z ${n(p.min[2]!)}..${n(p.max[2]!)}`)
    }
  },

  /**
   * 【機翼：一趟切完，平面形與翼型一起出來】沿翼展方向（X）切，每一刀的
   * u = Z 幅度就是**弦長**、v = Y 幅度就是**厚度**，前後緣位置一併得到。
   *
   * 【為什麼不另外切 Y 拿平面形】那會是第二組切面、第二次取樣，而坑 16 的
   * 教訓正是「同一個零件被兩次獨立量測描述，兩者各自都對、彼此對不上」。
   *
   * 【四具發動機艙會混進來，那是好事】它們掛在機翼上，所以某幾個翼展站位的
   * 厚度與弦長會突然變大——那正好把它們的位置與跨度指出來，不必另外找。
   */
  wing: async (_page, _probe, slice) => {
    /**
     * 【uWindow 一定要給】不給的話內段量到的「弦長」會是從螺旋槳量到水平
     * 尾翼尖（B-17 的平尾半展 6.6 m，蓋住整個內段）。
     *
     * 窗口取 Z ∈ [−3.5, 4.5]：主翼前後緣落在 −1.5…2.5，留餘裕；上界 4.5
     * 遠低於平尾的 10.5，下界 −3.5 排掉螺旋槳圓盤。
     */
    const ex = await slice('extent', 'x', {
      from: 0.4, to: 16.0, count: 79, uWindow: [-3.5, 4.5],
    }) as Extent
    console.log('── 右半翼：沿翼展切（u = Z 弦向、v = Y 厚度）──────')
    console.log('  uWindow Z ∈ [−3.5, 4.5] —— 排掉螺旋槳與水平尾翼')
    console.log('      X      前緣Z     後緣Z     弦長     厚度   厚弦比   中厚Y  線段數')

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
        + `  ${n(thick)}  ${n(thick / chord * 100, 6, 1)}%`
        + `  ${n((ex.vMin[i]! + ex.vMax[i]!) / 2)}  ${String(ex.count[i]).padStart(6)}`,
      )
    }

    /**
     * 翼面積與 MAC。**坑 16 的兩個免費交叉驗證**——飛行模型的參數本來就要
     * 填這兩個數字，量測值對得上史實才代表機翼真的量對了。梯形積分，兩側
     * 對稱所以乘 2。
     */
    let area = 0
    let macNum = 0
    for (let i = 1; i < xs.length; i++) {
      const dx = xs[i]! - xs[i - 1]!
      const cA = chords[i - 1]!
      const cB = chords[i]!
      area += (cA + cB) / 2 * dx
      macNum += (cA * cA + cA * cB + cB * cB) / 3 * dx
    }
    console.log(`\n  半翼面積 ${n(area)}  ×2 = ${n(area * 2)} m²   真機 ${REAL.wingArea}`
      + `   誤差 ${((area * 2 / REAL.wingArea - 1) * 100).toFixed(1)}%`)
    console.log(`  MAC ${n(macNum / area)} m`)
  },

  /**
   * 【俯仰角】坑 2：參考模型不保證是飛行姿態，而**剪影目測不可靠**
   * （P-51D 第一次憑側視估成 −9.5°，實際 −14.0°）。
   *
   * 【量法】沿 **Z（弦向）**切，`uWindow` 只留單邊機翼的一段翼展，每一刀
   * 取 (vMin+vMax)/2 當該弦向位置的中厚線，對 Z 做最小平方。中厚線的斜率
   * 就是「翼弦線 + 安裝角 + 姿態」的合成；主翼安裝角只有 1~2°，所以這是
   * 俯仰角的一階估計。
   *
   * **四個窗口分開配**：左右各兩段。四條算出來不一致就是量錯了東西（例如
   * 窗口壓到發動機艙或翼根整流罩），而不是「模型歪得不均勻」。
   *
   * 【He 111 那次的教訓】第一次用機身背線估成 7~9°，因為後機身背線本來就
   * 往上收——那是真的外形不是姿態。機翼比機身可靠得多。
   */
  pitch: async (_page, _probe, slice) => {
    /**
     * 【窗口要避開發動機艙】`wing` 那一格量到內艙佔 X 2.40…3.80、外艙佔
     * 5.80…7.20（艙的厚度是機翼的兩倍，中厚線會被整個抬上去）。第一版的
     * 「內段 [1.6, 3.2]」壓到了內艙，殘差 RMS 0.067 是乾淨窗口的 2.4 倍
     * —— **殘差自己會告訴你窗口髒了**，不必猜。
     *
     * 另外窗口要窄：機翼有上反角，窗口一寬、有效中心隨 z 漂一點點就把
     * 上反角的高度差混進斜率裡。
     */
    const WINDOWS: readonly [string, number, number][] = [
      ['右翼 翼根段', 1.3, 2.2],
      ['右翼 兩艙間', 4.1, 5.6],
      ['右翼 外艙外', 7.5, 9.0],
      ['右翼 外段', 10.0, 12.0],
      ['左翼 翼根段', -2.2, -1.3],
      ['左翼 兩艙間', -5.6, -4.1],
      ['左翼 外艙外', -9.0, -7.5],
      ['左翼 外段', -12.0, -10.0],
    ]
    /**
     * 【平尾是第二把尺】機翼量到的角度是「姿態 + 安裝角 + 扭轉」，三者混在
     * 一起，一把尺分不開。平尾的安裝角在設計上接近 0、而且沒有扭轉——兩把
     * 尺的**差**是縱向上反角（設計定值），兩把尺的**共同偏移**才是姿態。
     */
    const TAIL: readonly [string, number, number][] = [
      ['右平尾 內', 1.6, 3.2],
      ['右平尾 外', 3.6, 5.4],
      ['左平尾 內', -3.2, -1.6],
      ['左平尾 外', -5.4, -3.6],
    ]
    console.log('── 機翼中厚線（沿 Z 切，每站取 (vMin+vMax)/2）────')
    for (const [label, x0, x1] of WINDOWS) {
      const ez = await slice('extent', 'z', {
        from: -2.2, to: 3.0, count: 27, uWindow: [x0, x1],
      }) as Extent
      const zs: number[] = []
      const ys: number[] = []
      for (let i = 0; i < ez.planes.length; i++) {
        if (ez.count[i]! === 0) continue
        zs.push(ez.planes[i]!)
        ys.push((ez.vMin[i]! + ez.vMax[i]!) / 2)
      }
      // 最小平方配 y = a·z + b
      const N = zs.length
      const mz = zs.reduce((s, v) => s + v, 0) / N
      const my = ys.reduce((s, v) => s + v, 0) / N
      let szz = 0, szy = 0
      for (let i = 0; i < N; i++) {
        szz += (zs[i]! - mz) ** 2
        szy += (zs[i]! - mz) * (ys[i]! - my)
      }
      const a = szy / szz
      // 殘差 RMS —— 配得好不好，決定這條線信不信得過
      let rss = 0
      for (let i = 0; i < N; i++) rss += (ys[i]! - (a * (zs[i]! - mz) + my)) ** 2
      const deg = Math.atan(a) * 180 / Math.PI
      console.log(`  ${label}  X ∈ [${n(x0, 6, 1)}, ${n(x1, 6, 1)}]  ${N} 站`
        + `  斜率 ${n(a, 8, 5)}  = ${n(deg, 6, 2)}°  殘差RMS ${n(Math.sqrt(rss / N))}`)
    }

    console.log('\n── 水平尾翼中厚線（同一把尺，Z 9.6…13.4）─────────')
    for (const [label, x0, x1] of TAIL) {
      const ez = await slice('extent', 'z', {
        from: 9.6, to: 13.4, count: 20, uWindow: [x0, x1],
      }) as Extent
      const zs: number[] = []
      const ys: number[] = []
      for (let i = 0; i < ez.planes.length; i++) {
        if (ez.count[i]! === 0) continue
        zs.push(ez.planes[i]!)
        ys.push((ez.vMin[i]! + ez.vMax[i]!) / 2)
      }
      const N = zs.length
      const mz = zs.reduce((s, v) => s + v, 0) / N
      const my = ys.reduce((s, v) => s + v, 0) / N
      let szz = 0, szy = 0
      for (let i = 0; i < N; i++) {
        szz += (zs[i]! - mz) ** 2
        szy += (zs[i]! - mz) * (ys[i]! - my)
      }
      const a = szy / szz
      let rss = 0
      for (let i = 0; i < N; i++) rss += (ys[i]! - (a * (zs[i]! - mz) + my)) ** 2
      console.log(`  ${label}  X ∈ [${n(x0, 6, 1)}, ${n(x1, 6, 1)}]  ${N} 站`
        + `  斜率 ${n(a, 8, 5)}  = ${n(Math.atan(a) * 180 / Math.PI, 6, 2)}°`
        + `  殘差RMS ${n(Math.sqrt(rss / N))}  中厚Y ${n(my)}`)
    }


    /**
     * 【第三把尺：機身自己的中線】前兩把量的是機翼與平尾，各自帶著自己的
     * 安裝角——而**烘出來會歪的是機身**。射線由機身軸往外打，每站取
     * (背線 + 腹線)/2 當中線，對 Z 配線。
     *
     * 【只取直筒那一段】He 111 那次第一版用**背線**估成 7~9°，因為後機身
     * 背線本來就往上收——那是真的外形不是姿態（坑 2）。中線比背線好，但
     * 尾錐一樣會抬，所以窗口只取機翼後方、尾錐之前。
     */
    console.log('\n── 機身中線（射線 (背+腹)/2，只取直筒段）─────────')
    for (const [label, z0, z1] of [
      ['前段 −5.5…−2.5', -5.5, -2.5],
      ['中段  3.5… 7.5', 3.5, 7.5],
      ['全段 −5.5… 7.5', -5.5, 7.5],
    ] as readonly [string, number, number][]) {
      const rs = await slice('radial', 'z', {
        from: z0, to: z1, count: Math.round((z1 - z0) / 0.25) + 1,
        angles: 72, axisV: 0.3, maxRadius: 1.6,
      }) as Radial
      const zs: number[] = []
      const ys: number[] = []
      for (let k = 0; k < rs.planes.length; k++) {
        const row = rs.r[k]!
        // theta 0 = +u（右）、90° = +v（上）。取正上與正下那兩條射線
        let up = 0, dn = 0
        for (let j = 0; j < rs.theta.length; j++) {
          const t = rs.theta[j]!
          if (Math.abs(Math.sin(t) - 1) < 1e-6 && row[j]! > 0) up = row[j]!
          if (Math.abs(Math.sin(t) + 1) < 1e-6 && row[j]! > 0) dn = row[j]!
        }
        if (up <= 0 || dn <= 0) continue
        zs.push(rs.planes[k]!)
        ys.push(0.3 + (up - dn) / 2)
      }
      const N = zs.length
      if (N < 4) { console.log(`  ${label}  站太少（${N}）`); continue }
      const mz = zs.reduce((s, v) => s + v, 0) / N
      const my = ys.reduce((s, v) => s + v, 0) / N
      let szz = 0, szy = 0
      for (let i = 0; i < N; i++) {
        szz += (zs[i]! - mz) ** 2
        szy += (zs[i]! - mz) * (ys[i]! - my)
      }
      const a = szy / szz
      let rss = 0
      for (let i = 0; i < N; i++) rss += (ys[i]! - (a * (zs[i]! - mz) + my)) ** 2
      console.log(`  ${label}  ${N} 站  斜率 ${n(a, 8, 5)}`
        + `  = ${n(Math.atan(a) * 180 / Math.PI, 6, 2)}°  殘差RMS ${n(Math.sqrt(rss / N))}`)
    }

    console.log('\n  中厚線往 +Z（機尾）方向上升為正 → 機首朝下 → pitch 取正值轉回來')
  },

  /**
   * 【探索用：機身的五條射線並排】烘焙之前要先知道**每一條射線分別在哪一站
   * 開始打到別的東西**——機翼、發動機艙、水平尾翼、垂尾、背鰭整流罩、下巴
   * 砲塔、球形腹部砲塔。坑 15：有些東西量不到，重點是**知道是哪些**。
   *
   * 五個角度：正上 90、右上 45、正右 0、右下 −45、正下 −90。
   */
  body: async (_page, _probe, slice) => {
    const AXIS_V = 0.20
    const rs = await slice('radial', 'z', {
      from: -7.4, to: 15.6, count: 93, angles: 144, axisV: AXIS_V, maxRadius: 1.6,
    }) as Radial

    /** 最接近該角度的那一條射線；沒打到回 NaN */
    const at = (row: readonly number[], deg: number): number => {
      const want = deg * Math.PI / 180
      let best = 0
      const norm = (j: number) => {
        let d = rs.theta[j]! - want
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        return Math.abs(d)
      }
      for (let j = 1; j < rs.theta.length; j++) if (norm(j) < norm(best)) best = j
      return row[best]! > 0 ? row[best]! : NaN
    }

    console.log(`── 機身五條射線（原點 y = ${AXIS_V}，上限 1.6）─────────`)
    console.log('   量測Z    背線Y   右上45   半寬X   右下45    腹線Y')
    for (let k = 0; k < rs.planes.length; k++) {
      const row = rs.r[k]!
      const up = at(row, 90)
      const dn = at(row, -90)
      console.log(
        `  ${n(rs.planes[k]!, 6, 2)}  ${n(AXIS_V + up)}  ${n(at(row, 45))}`
        + `  ${n(at(row, 0))}  ${n(at(row, -45))}  ${n(AXIS_V - dn)}`,
      )
    }
    console.log(`\n  背線／腹線是絕對高度（原點 ${AXIS_V} ± 射線長），中間三欄是射線長`)
  },

  /**
   * 【哪一片才是機身蒙皮】`body` 量到背線整欄破破爛爛——砲塔、無線電艙的
   * 開放槍位、背鰭整流罩都在正上方那條射線上。坑 20 說背線**必須**取正上方
   * 的射線（擬合的 bUp 會把頂點往下拉），所以不能用擬合繞過去。
   *
   * 這一格用 `only` 逐片打同一組射線，問「哪一片打出來是連續而且平滑的」。
   *
   * 【這不是坑 5 的節點分類】坑 5 禁的是「猜哪一片是機身，然後直接拿它的
   * 包圍盒當答案」。這裡不猜：每一片都打，用**連續性與平滑度**當判準，
   * 判準是量出來的。
   */
  bodymesh: async (_page, _probe, slice) => {
    const AXIS_V = 0.20
    const CAND = ['Object_10', 'Object_16', 'Object_18', 'Object_20',
      'Object_28', 'Object_30', 'Object_34']
    const OPT = {
      from: -7.0, to: 15.0, count: 45, angles: 72, axisV: AXIS_V, maxRadius: 1.8,
    }
    const at = (rs: Radial, k: number, deg: number): number => {
      const want = deg * Math.PI / 180
      const row = rs.r[k]!
      let best = 0
      const norm = (j: number) => {
        let d = rs.theta[j]! - want
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        return Math.abs(d)
      }
      for (let j = 1; j < rs.theta.length; j++) if (norm(j) < norm(best)) best = j
      return row[best]! > 0 ? row[best]! : NaN
    }
    /** 二階差分的 RMS —— 平滑度。破破爛爛的那幾片會大一個數量級 */
    const rough = (v: readonly number[]): string => {
      const good = v.map((x, i) => [i, x] as const).filter(([, x]) => Number.isFinite(x))
      if (good.length < 5) return `站太少 ${good.length}`
      let sum = 0, cnt = 0
      for (let i = 1; i < good.length - 1; i++) {
        if (good[i + 1]![0] - good[i - 1]![0] !== 2) continue
        sum += (good[i - 1]![1] - 2 * good[i]![1] + good[i + 1]![1]) ** 2
        cnt++
      }
      return cnt ? `${good.length} 站  二階差RMS ${n(Math.sqrt(sum / cnt))}` : `${good.length} 站`
    }

    console.log('── 逐片打正上方那條射線（原點 y = 0.2，上限 1.8）──────')
    for (const only of ['(全部)', ...CAND]) {
      const rs = await slice('radial', 'z', OPT, undefined,
        only === '(全部)' ? undefined : only) as Radial
      const ups = rs.planes.map((_, k) => AXIS_V + at(rs, k, 90))
      console.log(`  ${only.padEnd(11)} 背線 ${rough(ups)}`)
    }

    console.log(`\n── 逐站對照：全部 vs 各片（背線絕對高度）────────────`)
    const cols: number[][] = []
    for (const only of ['(全部)', ...CAND]) {
      const rs = await slice('radial', 'z', OPT, undefined,
        only === '(全部)' ? undefined : only) as Radial
      cols.push(rs.planes.map((_, k) => AXIS_V + at(rs, k, 90)))
    }
    const rs0 = await slice('radial', 'z', OPT, undefined, undefined) as Radial
    console.log('   量測Z   全部  ' + CAND.map((c) => c.replace('Object', 'O').padStart(7)).join(''))
    for (let k = 0; k < rs0.planes.length; k++) {
      console.log(`  ${n(rs0.planes[k]!, 6, 2)}` + cols.map((c) => n(c[k]!)).join(''))
    }
  },

  /**
   * 【尾翼】水平尾翼沿 X 切、垂尾沿 Y 切。
   *
   * 【uWindow 一定要給】平尾與垂尾的 Z 範圍重疊，不限的話兩者混成一片。
   */
  tail: async (_page, _probe, slice) => {
    const ex = await slice('extent', 'x', {
      from: 0.3, to: 7.0, count: 68, uWindow: [9.0, 14.5],
    }) as Extent
    console.log('── 右半水平尾翼（uWindow Z ∈ [9.0, 14.5]）──────────')
    console.log('      X      前緣Z     後緣Z     弦長     厚度   線段數')
    const xs: number[] = []
    for (let i = 0; i < ex.planes.length; i++) {
      if (ex.count[i]! === 0) continue
      xs.push(ex.planes[i]!)
      console.log(`  ${n(ex.planes[i]!, 6, 2)}  ${n(ex.uMin[i]!)}  ${n(ex.uMax[i]!)}`
        + `  ${n(ex.uMax[i]! - ex.uMin[i]!)}  ${n(ex.vMax[i]! - ex.vMin[i]!)}`
        + `  ${String(ex.count[i]).padStart(6)}`)
    }
    console.log(`\n  半展 ${n(xs[xs.length - 1]!)}  ×2 = ${n(xs[xs.length - 1]! * 2)}`
      + `   真機 ${REAL.tailSpan}`)

    /**
     * 【`extent` 沿 Y 切時，u 是 X、v 是 Z】不是「另外兩軸照 XYZ 順序」——
     * 第一版把 `uWindow` 當成濾 Z 用，[7.0, 17.0] 於是濾成「只留 |x| 7…17」
     * ＝**外翼**，量出來的四行是機翼不是垂尾，而且看起來完全正常。
     *
     * 對照 skill 的範例：`extent, y` 那一刀「x 幅度是翼展、每個 x 的 z 幅度
     * 是弦長」。所以垂尾要濾的是 X（只留中線附近），讀的是 v。
     */
    const ey = await slice('extent', 'y', {
      from: 0.4, to: 5.9, count: 45, uWindow: [-1.2, 1.2],
    }) as Extent
    console.log(`\n── 垂尾＋背鰭（沿 Y 切，uWindow X ∈ [−1.2, 1.2]）────`)
    console.log('      Y      前緣Z     後緣Z     弦長    X幅度   線段數')
    for (let i = 0; i < ey.planes.length; i++) {
      if (ey.count[i]! === 0) continue
      console.log(`  ${n(ey.planes[i]!, 6, 2)}  ${n(ey.vMin[i]!)}  ${n(ey.vMax[i]!)}`
        + `  ${n(ey.vMax[i]! - ey.vMin[i]!)}  ${n(ey.uMax[i]! - ey.uMin[i]!)}`
        + `  ${String(ey.count[i]).padStart(6)}`)
    }
  },

  /**
   * 【四具發動機艙】沿 **Z** 切、`uWindow` 只留該艙那一條翼展帶。每一刀的
   * v 幅度就是艙在該站的上下界，u 幅度是橫向寬度。
   *
   * 【為什麼不用射線】第一版把射線原點放進艙裡（座艙罩那一招），但艙與機翼
   * 是**連在一起**的：側向射線一出艙就沿著機翼跑，量到的「半寬」是機翼。
   * 座艙罩那招成立是因為罩子與機身之間有一圈明顯的凹陷，發動機艙沒有。
   *
   * 帶寬取 ±0.5：`wing` 量到內艙佔 X 2.40…3.80、外艙 5.80…7.20，所以
   * [2.6, 3.6] 與 [6.0, 7.0] 落在艙身之內、不吃到旁邊的機翼。
   */
  nacelle: async (_page, _probe, slice) => {
    for (const [label, x0, x1] of [
      ['內艙 X ∈ [2.6, 3.6]', 2.6, 3.6],
      ['外艙 X ∈ [6.0, 7.0]', 6.0, 7.0],
    ] as const) {
      const ez = await slice('extent', 'z', {
        from: -5.4, to: 4.2, count: 49, uWindow: [x0, x1],
      }) as Extent
      console.log(`
── ${label} ─────────────────`)
      console.log('   量測Z   機體Z    底Y     頂Y    高度    X幅度  線段數')
      for (let i = 0; i < ez.planes.length; i++) {
        if (ez.count[i]! === 0) continue
        console.log(`  ${n(ez.planes[i]!, 6, 2)}  ${n(ez.planes[i]! + 1.1212, 6, 2)}`
          + `  ${n(ez.vMin[i]!)}  ${n(ez.vMax[i]!)}  ${n(ez.vMax[i]! - ez.vMin[i]!)}`
          + `  ${n(ez.uMax[i]! - ez.uMin[i]!)}  ${String(ez.count[i]).padStart(6)}`)
      }
    }
  },

  /**
   * 【哪裡是玻璃】skill 第 5b 步。**先問「那裡到底是不是玻璃」，再問
   * 「暗色要怎麼補」**——He 111 的機腹就是敗在這一步沒做，前提從照片讀來，
   * 六次修正每一次都合理、每一次都不對（坑 22）。
   *
   * 【量法】同一組射線打兩次：不過濾（＝最外側是什麼就回什麼）與
   * `only: Object_50`（＝整台的玻璃合成的那一片，見 `parts`）。兩者在同一
   * 格相等 → 那一格最外面就是玻璃。
   */
  glass: async (_page, _probe, slice) => {
    const AXIS_V = 0.20
    const OPT = {
      from: -7.4, to: 15.6, count: process.argv.includes('--fine') ? 185 : 47,
      angles: 72, axisV: AXIS_V, maxRadius: 1.8,
    }
    const all = await slice('radial', 'z', OPT) as Radial
    const gls = await slice('radial', 'z', OPT, undefined, 'Object_50') as Radial
    const DEGS = [90, 60, 30, 0, -30, -60, -90, -120, -150, 180, 150, 120]
    const idx = (deg: number): number => {
      const want = deg * Math.PI / 180
      let best = 0
      const norm = (j: number) => {
        let d = all.theta[j]! - want
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        return Math.abs(d)
      }
      for (let j = 1; j < all.theta.length; j++) if (norm(j) < norm(best)) best = j
      return best
    }
    const cols = DEGS.map(idx)
    console.log('── 每一格最外面是蒙皮還是玻璃（玻 = Object_50 在最外）──')
    console.log('   量測Z  ' + DEGS.map((d) => String(d).padStart(5)).join(''))
    for (let k = 0; k < all.planes.length; k++) {
      let line = `  ${n(all.planes[k]!, 6, 2)}  `
      for (const j of cols) {
        const a = all.r[k]![j]!
        const g = gls.r[k]![j]!
        // 玻 = 玻璃在最外；內 = 有玻璃但在蒙皮裡面（凹進去的窗）；蒙 = 沒有玻璃
        line += (a <= 0 ? '    ·'
          : g > 0 && Math.abs(g - a) < 0.02 ? '   玻'
            : g > 0 ? '   內' : '   蒙')
      }
      console.log(line)
    }
    console.log(`\n  · = 那個方向沒打到東西（上限 1.8 之內）`)
  },

  /**
   * 【烘焙】把機身量成 `b17g.hull.ts` 的顯式頂點。輸出直接就是那一檔的內容。
   *
   * ── 座標平移 ────────────────────────────────────────────
   *
   * 機體 Z = 量測 Z − `QUARTER_CHORD`。主翼**翼根**四分之一弦線必須壓在
   * 原點，因為原點是物理模型的重心（`geometry.test.ts` 有護欄在守）。
   *
   * 翼根弦由 `wing` 那一格的**乾淨段**（X 2.2…4.0，避開翼根整流罩與內艙）
   * 各配一條直線外推到 X = 0：
   *
   * ```
   *   前緣  X 2.2 −2.358、X 4.0 −2.139  → 斜率 0.1217/m → X0 −2.6257
   *   後緣  X 2.2  3.189、X 4.0  3.023  → 斜率 0.0922/m → X0  3.3919
   *   翼根弦 6.018   四分之一弦 −2.6257 + 1.5045 = −1.1212
   * ```
   *
   * **免費的交叉驗證（坑 16）**：這條翼根弦配上量到的翼尖，梯形面積
   * 133.3 m² 對真機 131.92，+1.0%。`wing` 那一格直接梯形積分得到的 140.2
   * （+6.3%）含 X < 1.2 的**機身**站位，不是翼。
   *
   * ── 為什麼不照 He 111 那樣「十六條射線直接烘」──────────────
   *
   * 那一招要求十六條射線每一條都乾淨。這台不行：`body` 那一格量到後機身
   * 45° 的射線給出 **x = 0.904 而同一站的半寬只有 0.851** —— 一個凸截面
   * 不可能在 45° 比在 0° 還寬，所以那條射線打到的是別的東西（平尾／背鰭
   * 整流罩）。正上方那條更慘，整個後段打不到。
   *
   * 改走 P-51D 那條：**半寬、背線、腹線各自當錨點曲線，中間用超橢圓補**。
   * 坑 20 仍然滿足 —— 上下端點是量到的，不是擬合的 bUp／bDn；擬合的只有
   * 指數 n，而 n 控制的是兩端之間怎麼連。
   *
   * ══ 第二版：三條錨點曲線的量法全部換掉 ═══════════════════
   *
   * 第一版三條線各有一個**取樣幾何自己失效**的問題，三個都不會報錯、三個
   * 都產生平滑單調而且看起來完全正常的曲線。人工回報「機身沒有很平順」
   * 「機頭該是一個凸起的屋簷」之後才逐一量出來。
   *
   * ── ① 背線：`maxRadius 1.6` 把射線切掉，改回報機身**內部**的一個面 ──
   *
   * 原點在 y = 0.20、上限 1.60 → 背線最高只量得到 **1.80**。而這台的機背
   * 在 **1.99**。同一站位換上限重量：
   *
   * ```
   *   機體Z    mr1.6   mr2.0   mr2.4
   *   -2.88    1.108   1.931   1.931
   *    0.12    1.567   1.998   1.998
   *    0.62    1.576   2.001   2.001
   *    1.12    1.585   2.000   2.000
   * ```
   *
   * 上限**沒有讓它落空**——它改成回報機身裡面的一個面，而那個面逐站
   * 1.558 → 1.567 → 1.576 → 1.585 平滑單調，通過了去尖刺、通過了保邊平滑、
   * 通過了曲率變號指標。後果是**機體 z −3.2…+4.4 整段機背低了 0.20…0.44**，
   * 而真機在那一段正是「機首上緣 1.45 → 風擋 → 座艙頂 1.97」那個 0.5 m 的
   * 屋簷落差。
   *
   * 【改法：背線完全不用射線】改用 `extent` 沿 Z 切、只留中線那條 X 帶，
   * 讀 `vMax`。`extentSlices` 沒有 maxRadius 也沒有原點，**不存在這個
   * 失敗模式**。代價是它照單全收：中線上方的東西都會進來，所以要逐段挑
   * （見下面的 `TOP_OK`）。
   *
   * ── ② 半寬：水平射線量到的是「原點高度上的寬」不是最大半寬 ──────
   *
   * 原點固定在 y = 0.20，但剖面的最寬處（`cy`）一路往後升。後機身因此逐站
   * 偏窄，機體 z 8.9 實測差 **−0.12**。第一版有發現一半（`rear` 那一段換到
   * y = 0.90），但門檻訂在量測 8.60 ＝ 機體 9.72，太晚了。
   *
   * 【改法】同一組射線跑**四個原點高度** 0.0 / 0.30 / 0.60 / 0.90，半寬取
   * 四者的**最大**、腹線取四者的**最低**。這直接對應「最大半寬」的定義，
   * 不必先知道 cy 在哪。
   *
   * ── ③ 指數 n：45° 射線同樣被 1.6 切掉 ────────────────────
   *
   * a 1.14、b 1.79、n 2.5 的剖面在 45° 的半徑是 **1.606** —— 剛好越界。
   *
   * 【改法】n 也改用 `extent`：多量幾條 X 帶（0.20…1.00，帶寬 ±0.02），
   * 每一站挑最接近 0.75·a 的那一條當取樣點，由 `(x/a)^n + (y/b)^n = 1`
   * 二分法反解。全程無射線。
   *
   * ── 三條錨點曲線各自的可信區間（坑 15）────────────────────
   *
   * ```
   *   半寬  −7.15…12.60 全段可信，只有翼根接合 −2.50…−1.30 要丟
   *                     （蒙皮被翼盒打斷，量到 1.44 / 1.00 / 1.18 三種值）
   *   腹線  全段可信，丟三塊：下巴砲塔 −6.60…−5.60、球形砲塔 3.40…4.60、尾輪艙 9.10…10.60
   *   背線  中線那條 X 帶要丟四塊**長在機背上的東西**（量測座標）：
   *           −6.18…−5.28  導航員的圓頂（0.8 m 長、寬 < 0.6、高出蒙皮 0.36）
   *           −2.58…−1.98  上部砲塔
   *            3.40…99     背鰭整流罩一路到垂尾
   *         最後那一段改讀 x = 0.35 的帶再用超橢圓換算回中線 —— 整流罩的
   *         半厚只有 0.12，0.35 已經在它外面。
   * ```
   */
  bake: async (_page, _probe, slice) => {
    const AXIS_V = 0.20
    const QUARTER_CHORD = -1.1212
    /** 每站 16 點：正上方 → 右側 → 正下方，12° 一格（與 He 111 同） */
    /**
     * 【16 點就夠 —— 重點是索引**分派給誰**，不是加點】駕駛艙那一段由中線往
     * 外有四條線要落點：艙頂的簷、玻璃上緣、玻璃前／外緣、艙緣。原本 0、1、2
     * 分給「中線、上緣、前緣」，簷沒有人扛，中線到上緣之間只能拉一條弦 ——
     * 平的艙頂被切成楔子（機體 −2.72 的 x0.30 烘出 1.848，參考 1.924）。
     *
     * 試過把環加到 18 點（最寬點以內 9 個），可行但三角形 +1136（14588 →
     * 15724），而且**其他六個玻璃補丁與骨架的索引全部要重新對映角度**，側窗
     * 那一片無論落在哪一格都對不回原位。
     *
     * 不必。這一段索引的自然位置本來就很接近那三條線（機體 −2.72：索引 1 在
     * 0.31 而簷要 0.297、索引 2 在 0.54 而上緣要 0.407、索引 3 在 0.72 而前緣
     * 要 0.60）。改成「1=簷、2=上緣、3=前緣」就位移很小，代價是艙緣少一個
     * 頂點 —— 那個由 `LEDGE` 那一段補（見 ringAt ④）。
     */
    /**
     * 【在既有角度之間插入，不改分佈】駕駛艙那一段量到的環上邊長：
     *
     * ```
     *   索引    0-1        1-2        2-3        3-4        4-5
     *   邊長  0.06~0.44  0.10~0.24  0.06~0.52  0.39~0.67  0.26~0.32
     * ```
     *
     * 索引 3 扛玻璃的前緣（前段縮到 0.31），索引 4 卻釘在 0.87 —— 中間
     * 0.56 m 沒有任何頂點，那就是玻璃下方那一片扇形。
     *
     * 【為什麼是插入而不是重新分佈】試過改成均勻的 18 點，六個玻璃補丁與
     * 骨架的索引全部要重新對映角度，側窗那一片無論落在哪一格都對不回原位，
     * 而且會 z-fighting。改成在 78°/66° 與 66°/54° 之間各插一個（含鏡射）：
     * **原本的角度一個都沒動**，補丁只是換編號 —— 側窗仍是 54°→42°、頰窗
     * 仍是 42°→18°、骨架仍是 90°/42°/−6°。
     */
    const OUT_DEG = [90, 78, 72, 66, 60, 54, 42, 30, 18, 6,
      -6, -18, -30, -42, -54, -60, -66, -72, -78, -90]

    /**
     * 【兩端都是量出來的】
     *
     * 起點 −7.15：`align` 的包圍盒說幾何從 −7.501 開始，但那一端是**下巴
     *             砲塔的槍管**。`body` 每 0.25 m 一刀，機身自己的環從
     *             −7.15 起整圈才都有。
     * 終點 12.60：`body` 表上 12.60 的半寬只剩 0.085，12.85 起整圈打不到
     *             ——那之後是尾砲塔，不是機身。
     */
    const Z0 = -7.15
    const Z1 = 12.60
    const STEP = 0.175
    const COUNT = Math.round((Z1 - Z0) / STEP) + 1
    const GRID = { from: Z0, to: Z1, count: COUNT }

    /**
     * 【射線跑四個原點高度】半寬取最大、腹線取最低。maxRadius 維持 1.60
     * ——那個上限是為了擋掉「側向射線穿出機身打到內側發動機艙」（坑 6，
     * 實測半寬在 −4.40…−2.40 整段剛好等於 2.400）。背線與 n 已經不靠射線，
     * 所以這個上限只需要配側向與朝下那兩條。
     */
    const ORIGINS = [0.0, 0.30, 0.60, 0.90] as const
    const rays: Radial[] = []
    for (const v of ORIGINS) {
      rays.push(await slice('radial', 'z', {
        ...GRID, angles: 144, axisV: v, maxRadius: 1.60,
      }) as Radial)
    }
    const rs = rays[0]!

    /**
     * 指定角度 ±win° 內、非零射線的中位數，而且**左右對稱化**（取 θ 與
     * 180°−θ 的平均）。
     *
     * 【為什麼要對稱化】這一檔只存右半、左半一律鏡像。只往 +X 射再鏡像的話
     * 任何橫向偏移都會被**加倍**——He 111 的機首機槍座偏右 0.147，鏡像之後
     * 機首寬了 0.29 m。B-17G 的腰部槍窗本來就左右交錯。
     */
    const robustOf = (src: Radial, k: number, deg: number, win = 6): number => {
      const one = (want: number): number => {
        const near: number[] = []
        for (let j = 0; j < src.theta.length; j++) {
          let d = src.theta[j]! - want * Math.PI / 180
          while (d > Math.PI) d -= 2 * Math.PI
          while (d < -Math.PI) d += 2 * Math.PI
          if (Math.abs(d) <= win * Math.PI / 180 && src.r[k]![j]! > 0) near.push(src.r[k]![j]!)
        }
        if (near.length === 0) return NaN
        near.sort((a, b) => a - b)
        return near[near.length >> 1]!
      }
      const a = one(deg)
      const b = one(180 - deg)
      if (!Number.isFinite(a)) return b
      if (!Number.isFinite(b)) return a
      return (a + b) / 2
    }

    /**
     * 【`extent` 一定要排掉天線鋼索】`Object_36` 是 32 個三角形的透明 mesh，
     * 從垂尾頂一路拉到機身前段（Y −1.13…5.06、Z −5.27…11.42）。`extent`
     * 取的是極值，中線那條帶會整段量到它。`Object_6` 是同一組的另一片。
     *
     * 這條鋼索先前已經害過一次：垂尾的平面形整個是照它配的（見 `tail`）。
     */
    const NOWIRE = '^(?!Object_36$|Object_6$)'
    /**
     * 【帶只能拿來讀「正上方」與「離軸一點點」，不能拿來掃整個肩部】
     * `extentSlices` 收的是**線段端點**落在窗內的那些。參考模型的蒙皮在
     * 圓周方向是粗面片，肩部（x 0.5…0.9）常常整段沒有端點落在一條 0.1 寬的
     * 帶裡 —— 那一格於是改回報帶內剛好有的**內部結構**。實測機體 z −0.44
     * 的 x = 0.6 帶讀出 **−0.614**，而同一站的蒙皮在 1.5 以上。
     *
     * 所以帶只用兩條，兩條都在頂點附近（面片密、一定有端點）：
     *
     *   `topC`   |x| ≤ 0.06  中線背線。前段的主來源。
     *   `topOff` x ∈ [0.40, 0.50]  背鰭整流罩那一段用。整流罩的半厚 < 0.2，
     *            0.40 已經在它外面；再往外就進入粗面片區。
     *
     * 指數 n 改回 45° 射線（射線是**線段相交**，沒有端點的問題），只把
     * maxRadius 從 1.60 放到 2.00 —— a 1.175、b 1.80、n 2.4 的剖面在 45°
     * 的半徑是 1.615，1.60 剛好把它切掉。
     */
    const topC = await slice('extent', 'z',
      { ...GRID, uWindow: [-0.06, 0.06] }, undefined, NOWIRE) as Extent
    /**
     * 【腹線的帶要寬一點】機首尖端那一站的剖面只有 0.39 半寬，而且面片粗 ——
     * ±0.06 的帶只撈到罩頂那一個頂點，`vMin` 讀出 **0.799**（真值 0.039）。
     * 那一站是手工機首尖端的縮放基準，錯了整台的 `noseY` 跟著錯，疊圖會整台
     * 平移 0.33。±0.12 就撈得到底部，而且還沒碰到下巴砲塔（±0.30 會）。
     */
    const bellyC = await slice('extent', 'z',
      { ...GRID, uWindow: [-0.12, 0.12] }, undefined, NOWIRE) as Extent
    const OFF_U = 0.40
    const topOff = await slice('extent', 'z',
      { ...GRID, uWindow: [OFF_U, OFF_U + 0.10] }, undefined, NOWIRE) as Extent
    /**
     * `sideC` x ∈ [0.80, 0.90] —— **方盒之外**的那條帶，用來量底下那根圓管
     * 自己的背線。方盒的半寬只有 0.60，0.85 已經在它外面。見 `BOX_W`。
     */
    const SIDE_U = 0.85
    const sideC = await slice('extent', 'z',
      { ...GRID, uWindow: [SIDE_U - 0.05, SIDE_U + 0.05] }, undefined, NOWIRE) as Extent
    const diag = await slice('radial', 'z', {
      ...GRID, angles: 144, axisV: AXIS_V, maxRadius: 2.00,
    }) as Radial

    /** 只留落在任一可信區間內的站位，其餘設 NaN */
    const keep = (
      v: readonly number[], spans: readonly (readonly [number, number])[],
    ): number[] => v.map((x, k) => {
      const z = rs.planes[k]!
      return spans.some(([a, b]) => z >= a && z <= b) ? x : NaN
    })

    /** 沿 z 線性內插補洞；兩端外推用最近的乾淨值 */
    const fill = (v: readonly number[]): number[] => {
      const good = v.map((x, i) => [i, x] as const).filter(([, x]) => Number.isFinite(x))
      if (good.length === 0) return v.map(() => NaN)
      return v.map((x, i) => {
        if (Number.isFinite(x)) return x
        let lo = good[0]!
        let hi = good[good.length - 1]!
        for (const g of good) if (g[0] <= i) lo = g
        for (let t = good.length - 1; t >= 0; t--) if (good[t]![0] >= i) hi = good[t]!
        if (lo[0] === hi[0]) return lo[1]
        return lo[1] + (hi[1] - lo[1]) * ((i - lo[0]) / (hi[0] - lo[0]))
      })
    }

    /**
     * 【單邊修剪】skill 第 3 步：**污染一律讓半徑偏大**。所以只丟「比鄰域
     * 中位數大太多」的點，不丟小的——小的多半是真的（機身本來就在收）。
     *
     * 【為什麼保邊平滑救不了】保邊那一招（一步跳超過 0.15 就不平滑）是為了
     * 保住機身上真的 0.2 m 級轉折。但單站尖峰的跳幅也超過 0.15，於是它**保護
     * 了尖峰**。門檻對 He 111 是對的，對這台反而幫倒忙，所以修剪要在平滑
     * 之前另外做一道。
     *
     * `sign` = +1 丟偏大的（半寬、背線），−1 丟偏小的（腹線是負值，砲塔會
     * 讓它更負）。
     */
    const despike = (v: readonly number[], tol: number, sign: number): number[] => {
      const out = [...v]
      for (let k = 0; k < v.length; k++) {
        const win: number[] = []
        for (let d = -2; d <= 2; d++) {
          const t = k + d
          if (t >= 0 && t < v.length && Number.isFinite(v[t]!)) win.push(v[t]!)
        }
        if (win.length < 3) continue
        win.sort((a, b) => a - b)
        const med = win[win.length >> 1]!
        if (sign * (v[k]! - med) > tol) out[k] = NaN
      }
      return out
    }

    // ── 半寬與腹線：四個原點取極值 ──────────────────────────
    const halfW = fill(despike(keep(
      rs.planes.map((_, k) => {
        const vs = rays.map((src) => robustOf(src, k, 0)).filter(Number.isFinite)
        return vs.length ? Math.max(...vs) : NaN
      }),
      [[-99, -2.50], [-1.30, 99]],
    ), 0.10, 1))
    /**
     * 【腹線也不用射線】原本是「四個原點的朝下射線取最低」，但 `castRay` 取的
     * 是**上限以內最遠**的交點 —— 由 y = 0.90 往下射、上限 1.60 可以到 −0.70，
     * 於是後機身那一段抓到了蒙皮**之外**的東西，整段低了 0.11。取極值把它
     * 選了出來。這是坑 36 的同一條：上限不會落空，它換一個答案給你。
     *
     * 腹線與背線一樣落在中線上，直接讀 `extent` 中線帶的 `vMin`。
     */
    const belly = fill(despike(despike(keep(
      bellyC.vMin.map((v) => (Number.isFinite(v) ? v : NaN)),
      [[-99, -6.60], [-5.60, 3.40], [4.60, 9.10], [10.60, 99]],
    ), 0.08, -1), 0.08, 1))

    /**
     * ── 背線 ──────────────────────────────────────────────
     *
     * 中線那條帶（|x| ≤ 0.06）讀 `vMax`，丟掉三塊長在機背上的東西。背鰭
     * 整流罩那一段（量測 3.40 之後）改讀 x = 0.35 的帶，再用同一站的超橢圓
     * 換算回中線 —— 整流罩的半厚只有 0.12，0.35 已經在它外面。
     */
    const FILLET_Z = 3.40
    const rawTop = despike(keep(
      topC.vMax.map((v) => (Number.isFinite(v) ? v : NaN)),
      [[-99, -6.18], [-5.28, -2.70], [-1.75, FILLET_Z]],
    ), 0.10, 1)
    const topFront = fill(rawTop)

    /**
     * 【指數 n 也不用射線】每一站挑最接近 0.75·a 的那條 X 帶當取樣點，由
     * `(x/a)^n + (y/b)^n = 1` 二分法反解。只在背線本身是量到的站算。
     */
    const expoAt = (k: number, a: number, b: number): number => {
      if (!(a > 0 && b > 0)) return NaN
      const r = robustOf(diag, k, 45)
      if (!Number.isFinite(r)) return NaN
      const x = r * Math.SQRT1_2
      const y = r * Math.SQRT1_2
      if (!(x > 0 && x < a * 0.999) || !(y > 0 && y < b * 0.999)) return NaN
      let lo = 1.2, hi = 6.0
      for (let it = 0; it < 40; it++) {
        const m = (lo + hi) / 2
        if ((x / a) ** m + (y / b) ** m > 1) lo = m
        else hi = m
      }
      const fit = (lo + hi) / 2
      /** 【物理閘門：機身剖面不是長方形】n > 3.4 代表那一帶打到別的東西 */
      return fit > 3.4 ? NaN : fit
    }

    /**
     * 背鰭整流罩那一段：`topOff` 是 **x = 0.35 處的高度**，用同一站的超橢圓
     * 換算回中線 `y(x) = b·(1 − (x/a)^n)^(1/n)`。半寬在那一帶 0.8 上下，
     * 0.35/a ≈ 0.44，修正量約 +3%。
     */
    /**
     * 【兩趟迭代】後段的背線要由 x = 0.35 那條帶換算回中線，換算要用同一站
     * 的 n；n 又要拿背線當 b 才解得出來。所以先用前段外推的 n 算一版背線，
     * 再用那一版重新解 n、重新換算。第二趟的位移實測 < 0.01。
     */
    const rearTop = (nExpo: readonly number[]): number[] =>
      topFront.map((v, k) => {
        if (rs.planes[k]! <= FILLET_Z) return v
        const y = topOff.vMax[k]! - AXIS_V
        const a = halfW[k]!
        if (!Number.isFinite(y) || y <= 0 || !(a > OFF_U * 1.2)) return NaN
        const nn = Math.min(3.4, Math.max(1.4, nExpo[k]!))
        const f = (1 - Math.min(0.98, (OFF_U / a) ** nn)) ** (1 / nn)
        return AXIS_V + y / f
      })
    let expo = fill(rs.planes.map((_, k) => (
      Number.isFinite(rawTop[k]!) ? expoAt(k, halfW[k]!, topFront[k]! - AXIS_V) : NaN
    )))
    let top = fill(despike(rearTop(expo), 0.10, 1))
    /**
     * ── 圓管自己的背線 ─────────────────────────────────
     *
     * `top` 是中線的最高點，而在機體 −3.05…+4.00 那一段，**那個點是方盒的頂**
     * （見 `BOX_W`）。拿它當超橢圓的 `bUp` 會把整根機身吹成一根 1.98 高的胖管。
     *
     * 圓管自己的背線由 `sideC`（x = 0.85，方盒之外）用同一站的超橢圓換算回
     * 中線，跟 `rearTop` 同一招。上限壓在 `top` —— 圓管不可能比中線高。
     */
    /**
     * ── 風擋：先定平面，再讓 poly 遷就它 ──────────────────
     *
     * 專案負責人：「玻璃是兩個斜的正方形；是不是先決定玻璃位置，再想辦法讓
     * 機身的 poly 變形？」—— 這一段就是那個做法。
     *
     * 【平面是量出來的】參考模型的透明件全部在 `Object_50`，只切它就讀得到
     * 玻璃自己的表面（`extent`、`only: '^Object_50$'`，機體座標）：
     *
     * ```
     *   機體Z   x0.05  x0.15  x0.25  x0.35  x0.45  x0.55  x0.65
     *   -3.23   1.602
     *   -3.18   1.662  1.591
     *   -3.13   1.720  1.636  1.555
     *   -3.08   1.777  1.650  1.560
     *   -3.03   1.799         1.665  1.544
     *   -2.98          1.800  1.680         1.528
     *   -2.93          1.801  1.780         1.512  1.500
     *   -2.88                 1.803  1.710         1.496  1.466
     * ```
     *
     * 下緣（每條 X 帶上玻璃的起點）與上緣（y ≈ 1.80）各是一條直線。取三點解
     * 平面、第四點驗證 —— **偏差 0.011 m，真的共面**：
     *
     * ```
     *   y = 4.8235 − 0.8013·|x| + 0.9850·z
     *   法線 (0.496, 0.619, −0.609)，與水平面 51.7°，中線上的傾斜 44.6°
     *   上緣 x = (z + 2.95) / 0.600     下緣 x = (z + 3.24) / 0.583
     * ```
     *
     * 另一台 lowpoly 的 `B17.dae` 量到 (0.65, 0.58, −0.50)、55°，同一個量級。
     *
     * 【為什麼「只是把 y 算在平面上」不夠】試過。烘出來**每一站只有一個頂點
     * 落在平面上** —— 風擋在 z 方向只有 0.20…0.32 m，而站距 0.175、環的取樣
     * 角度又固定，平面斜著穿過網格，連不成一片。
     *
     * 【做法】兩件事一起做：
     *
     * ① **站位在這一段加密**（機體 −3.62…−2.12 改成 0.06 一站）。烘焙因此由
     *    `ringOf(k)` 改成 `ringAt(z)`，錨點曲線在任意 z 內插。
     * ② **索引 1 與 2 改坐在平面的上緣與下緣上**，其餘索引重新分佈；而且是
     *    **漸變**的（`blendAt`），不能在進出風擋那一站突然切換 —— 第一版讓
     *    索引跟著最近的自然位置走，於是索引 2 的 x 在相鄰兩站之間由 0.48
     *    跳到 0.02，loft 整個扭掉。
     *
     * 於是 `(1, 2)` 那一格每一站都是風擋，四個角都在同一個平面上 —— 沿 z 連
     * 起來是一片**真正的**平面，不是「接近平面」。
     */
    /**
     * ── 風擋 = 平面上的一個**四邊形**，四個角先訂死 ──────────
     *
     * 前面幾版都是反過來做的：訂一個平面，再讓兩條**隱含**的緣線（「平面追上
     * 艙頂」「配一條下緣」）去切出玻璃的形狀。形狀是掉出來的，所以每修一次
     * 就變成另一種怪形狀 —— 柳葉、透鏡、上框忽厚忽薄。**這一版把四個角當成
     * 輸入，網格是輸出。**
     *
     * 【量法】只切 `Object_50`，逐條窄 X 帶讀玻璃頂面 y(x, z)，再迭代
     * 「配平面 → 用平面篩點」直到收斂（容差 0.08 → 0.02，內點 528 點）：
     *
     * ```
     *   y = 4.9107 − 0.8469·|x| + 1.0124·z      殘差 RMS 0.0102 m
     * ```
     *
     * 【上緣是一條**水平線**，不是跟著艙頂跑的曲線】這是前幾版最大的錯。
     * x ≤ 0.18 那幾條帶（外側那片近水平的玻璃還沒開始，量得最乾淨）讀到的
     * 上緣 y 是：
     *
     * ```
     *   x     0.02   0.04   0.06   0.08   0.10   0.12   0.14   0.16   0.18
     *   上緣y 1.816  1.809  1.813  1.816  1.809  1.812  1.816  1.809  1.812
     * ```
     *
     * 九站同一個值 —— `PANE_TOP_Y = 1.812`。把它代回平面就得到上緣在俯視上
     * 的那條直線，斜率是 `PANE_B / PANE_C`，不必另外配。
     *
     * 【前緣也是一條直線】逐條 X 帶玻璃的最前端最小二乘：
     * `z = −3.2758 + 0.6345·x`，最大殘差 0.012（x 0.06…0.62）。
     *
     * 【外緣訂 0.60，因為那是艙頂的冠追上上緣的地方】甲板由 `BOX_FLAT` 0.45
     * 起以 `BOX_CROWN` 0.90 緩降，中線 1.955 → x0.60 是 1.820，而上緣是
     * 1.812：兩者在 x 0.609 相交。取 0.60，外上角**自然落在甲板面上**，不必
     * 另外處理交界。參考模型的艙緣量到 0.62…0.64，也對得上。
     *
     * 於是四個角是（機體座標，右半；左半鏡像成一個 V）：
     *
     * ```
     *   內下 A  (0.00, 1.594, −3.276)      內上 B  (0.00, 1.812, −3.061)
     *   外上 C  (0.60, 1.812, −2.559)      外下 D  (0.60, 1.472, −2.895)
     * ```
     *
     * 四個角**依構造**都在平面上（上緣兩點由 `paneY = PANE_TOP_Y` 解出，前緣
     * 兩點由前緣直線代進 `paneY`），所以不必再驗共面。
     */
    const PANE_A = 4.9107
    const PANE_B = 0.8469
    const PANE_C = 1.0124
    const paneY = (x: number, zb: number): number => PANE_A - PANE_B * x + PANE_C * zb
    const PANE_TOP_Y = 1.8120                  // 上緣：一條水平線
    const PANE_OUT = 0.60                      // 外緣：艙頂的冠追上上緣的 x
    const PANE_FZ0 = -3.2758                   // 前緣 z = FZ0 + FZK·x
    const PANE_FZK = 0.6345
    const PANE_UZ0 = (PANE_TOP_Y - PANE_A) / PANE_C   // 上緣 z = UZ0 + UZK·x
    const PANE_UZK = PANE_B / PANE_C
    const PANE_Z0 = PANE_FZ0                          // 內下角 A
    const PANE_Z1 = PANE_UZ0 + PANE_UZK * PANE_OUT    // 外上角 C
    /**
     * 某一站上四邊形佔的 x 區間（機體 z）。
     *
     * 站位平面 z = 定值 與四邊形的交集：點在前緣之後、在上緣之前、在 0 與外緣
     * 之間，也就是
     *
     * ```
     *   z ≥ FZ0 + FZK·x   ⟺  x ≤ (z − FZ0) / FZK
     *   z ≤ UZ0 + UZK·x   ⟺  x ≥ (z − UZ0) / UZK
     * ```
     *
     * 前段（z ≤ UZ0 = −3.061）下界是 0 —— 四邊形一路吃到中線，兩片玻璃在那裡
     * 交成一道脊。所以**索引 0 本身就在玻璃上**，不必特別處理：下面的取代迴圈
     * 涵蓋 x ∈ [lo, hi]，lo = 0 時它自然被蓋到。
     */
    const paneSpan = (zb: number): [number, number] | null => {
      if (zb <= PANE_Z0 || zb >= PANE_Z1) return null
      const lo = Math.max(0, (zb - PANE_UZ0) / PANE_UZK)
      const hi = Math.min(PANE_OUT, (zb - PANE_FZ0) / PANE_FZK)
      return hi > lo + 1e-9 ? [lo, hi] : null
    }
    /**
     * 索引重分佈的融入／融出。
     *
     * 【為什麼還是要漸變】四邊形的頭尾各是一個**角**（A 與 C），那兩站的 x
     * 區間退化成一個點。索引 1、2 如果照訂就會一起坐到同一個 x 上，相鄰站位
     * 之間跑很遠 —— 就是前面幾版看到的扇形細條。前 0.12、後 0.10 漸變之後，
     * 兩端那一小塊楔形不由網格表現（它只有幾公分寬），中段完全照四邊形走。
     */
    const smooth = (t: number): number => t * t * (3 - 2 * t)
    /**
     * 【前端的漸變由 0.20 收到 0.08 —— 2026-08-20】漸變是為了讓索引 1／2／3
     * 由「機首的自然位置」走到「四邊形的三條緣」時不要一站跳到底。但 0.20
     * 之下，機體 −3.26…−3.08 這三站的索引**還沒走到緣上**，於是四邊形的
     * 前段沒有任何一格整格落在玻璃裡 —— 補丁挖不下去，玻璃後面那一段是
     * 蒙皮而不是碗。專案負責人：「擋風的內碗應該是連接在玻璃邊框往內凹」。
     *
     * 收到 0.08 之後 −3.20 那一站的 `bw` 是 0.99，索引 1／2／3 直接坐在
     * 緣上，前段可以挖。逐項對照：
     *
     * ```
     *                      漸變 0.20   漸變 0.08
     *   凹陷（往外走 y 升）      1 處        0 處    ← 好轉
     *   環上最長的邊           0.565       0.565    ← 不變
     *   新增的長邊               —      0.498、0.398（索引 3–4，仍低於最大值）
     *   二階差分變號          3/3/6       4/4/6    ← 多 1，幅度由 −0.98 到 −0.40
     *   四邊形內部挖掉的比例   0…86%     74…100%
     * ```
     *
     * 【後端的 0.025 不動】那一頭是四邊形自己收尖，索引本來就擠在一起。
     */
    const blendAt = (zb: number): number => {
      if (zb <= PANE_Z0 || zb >= PANE_Z1) return 0
      return Math.min(
        smooth(Math.min(1, (zb - PANE_Z0) / 0.08)),
        smooth(Math.min(1, (PANE_Z1 - zb) / 0.025)))
    }
    const BOX = [-4.27, 3.78] as const         // 量測座標，機體 −3.15…+4.90
    const BOX_FULL = [-3.62, 2.98] as const    // 機體 −2.50…+4.10
    /**
     * 【方盒的半寬不是定值，駕駛艙那一段比較寬】逐條 X 帶量「y 掉出頂點
     * 0.25 的那個 x」：機體 −2.48 是 **0.668**、−1.98 是 **0.669**，而
     * 0.02 之後是 0.59…0.62。取 0.70 → 0.60，在機體 −2.60…−1.00 之間收。
     *
     * 這一條是人工回報「玻璃跟機身沒有好好銜接，有一個奇怪的斷面」的根因之
     * 一：風擋的下緣在機體 −2.54 走到 x 0.70 才結束，而甲板只到 0.60 ——
     * 索引 2 掉進「風擋已經沒了、甲板又還沒到」的空隙，一站掉 0.29 再跳
     * 回 0.50。
     */
    /**
     * ── 後段的錐度重配（2026-08-20）────────────────────────
     *
     * 舊版把「甲板一路收到零」交給 `boxWAt` 的外層錐度（機體 3.10 → 4.30
     * 一路降到 0），而 `boxWOf` 在 0.02 之後是定值 0.60。兩層一乘，機體 3.9
     * 的 w 只剩 0.20 —— 艙頂在那裡變成一道尖脊，而參考模型還有 0.40。人工
     * 回報「機背後段右舷破碎」的根因就是這個：頂窗鋪在一道脊上。
     *
     * 逐條 X 帶量參考模型「y 掉出中線 0.10 的那個 x」，反解回 w：
     *
     * ```
     *   機體Z   量到的 x*   反解的 w      舊版的 w    舊版的 x*
     *    0.00     0.568      ≥0.56        0.60        0.561
     *    1.00     0.550       0.547       0.60        0.561
     *    2.00     0.511       0.496       0.60        0.561   ← 開始偏寬
     *    3.00     0.484       0.461       0.60        0.561
     *    3.30     0.467       0.439       0.51        0.485
     *    3.70     0.409       0.376       0.30        0.333
     *    3.90     0.390       0.357       0.20        0.233   ← 差 0.16
     *    4.10     0.293       0.260       0.10        0.133
     * ```
     *
     * （`x*` 由 `boxY` 反解：x* ≤ 0.45 時只有 3.0 那一項，> 0.45 時兩項都算。）
     *
     * 現在錐度寫進 `boxWOf` 自己的折線，外層只負責機首與最尾端的收頭：
     * `BOX_FULL` 的後端由機體 3.10 推到 4.10、`BOX` 由 4.30 推到 4.90。
     * 配出來的 x* 是 0.561／0.553／0.533／0.487／0.428，逐點對得上。
     */
    const BOX_W: readonly (readonly [number, number])[] = [
      [-1.40, 0.70], [0.00, 0.60], [2.00, 0.50], [3.30, 0.44], [4.10, 0.38],
    ]
    const boxWOf = (zb: number): number => {
      if (zb <= BOX_W[0]![0]) return BOX_W[0]![1]
      for (let i = 1; i < BOX_W.length; i++) {
        const [za, wa] = BOX_W[i - 1]!, [zc, wc] = BOX_W[i]!
        if (zb <= zc) return wa + (wc - wa) * ((zb - za) / (zc - za))
      }
      return BOX_W[BOX_W.length - 1]![1]
    }
    const boxWAt = (z: number): number => boxWOf(z - QUARTER_CHORD) * (
      z < BOX[0] || z > BOX[1] ? 0
        : z < BOX_FULL[0] ? (z - BOX[0]) / (BOX_FULL[0] - BOX[0])
          : z > BOX_FULL[1] ? (BOX[1] - z) / (BOX[1] - BOX_FULL[1]) : 1)
    /**
     * 【甲板不是硬平頂，外側是一段緩降的冠】參考模型量到的：
     *
     * ```
     *   機體Z   x0.45  x0.55  x0.65  x0.75
     *   -2.48   1.914  1.891  1.783  1.405
     *    0.02   1.949  1.920  1.652  1.417
     * ```
     *
     * 由 x 0.45 起以 **0.65** 的斜率緩降，到艙緣才硬收。硬平頂配上艙緣那一
     * 刀，銜接處會是一道 0.2 的階；緩降之後風擋的後緣（1.761）接到甲板
     * （1.800）只差 0.04。
     */
    const BOX_FLAT = 0.45
    const BOX_CROWN = 0.90
    /**
     * 【艙緣不能是一刀切】方盒的外緣如果是硬邊，**任何頂點在相鄰兩站之間跨
     * 過它就是一階**：實測索引 3 由 x 0.78 走到 0.68，y 一站跳 0.473。
     * 給它一段有斜率的外緣（量到 x 0.65→0.75 是 3.8、0.75→0.85 是 1.9，
     * 取 3.0），跨過去的時候就只是換一段斜率。
     */
    const BOX_OUT = 3.0
    const boxY = (x: number, t: number, w: number): number =>
      t - BOX_CROWN * Math.max(0, x - BOX_FLAT) - BOX_OUT * Math.max(0, x - w)
    const fuseAt = (k: number, nn: number): number => {
      /**
       * 【方盒之外一律直接用中線】那裡沒有盒子，中線最高點**就是**機身的背線，
       * 沒有必要（也不該）繞一圈 x = 0.85 去反解。
       *
       * 第一版沒有這個閘門，機首那幾站的半寬只有 0.4～0.9、`sideC` 整條落在
       * 機身外面 → NaN → `fill` 往前外推成一個常數，機首上半段變成一塊
       * **平板**（頂由 0.80 升到 1.24 變成整段卡在 1.351）。驗收看到的是背線
       * 與腹線**同時**位移 0.276、垂尾前緣最大 11.857 —— 兩條線同方向同幅度
       * 就是整個疊圖被推上去了，不是形狀變差（驗收是以機首尖端對齊的）。
       */
      /**
       * 【但風擋覆蓋的站位也不行】那一段（機體 −3.276…−3.15）方盒還沒開始，
       * 而中線的最高點**就是風擋的稜**（−3.20 是 1.671）—— 拿它當圓管的背線，
       * 整個上半圈被撐到玻璃的高度：x0.25 烘出 1.607 而參考是 1.516，玻璃
       * 旁邊的機殼反而比玻璃高，135 個環裡唯一一處「往外走 y 會升」。
       *
       * 這是坑 49 的漏網之魚：閘門只擋了方盒，沒擋風擋。回 NaN 讓 `fill`
       * 由前後兩端內插（前面 −3.44 是 1.517，後面由方盒接手）。
       */
      if (paneSpan(rs.planes[k]! - QUARTER_CHORD)) return NaN
      if (boxWAt(rs.planes[k]!) <= 0) return top[k]!
      const a = halfW[k]!
      const y = sideC.vMax[k]! - AXIS_V
      if (!Number.isFinite(y) || y <= 0 || !(a > SIDE_U * 1.15)) return NaN
      const m = Math.min(3.4, Math.max(1.4, nn))
      const f = (1 - Math.min(0.98, (SIDE_U / a) ** m)) ** (1 / m)
      return Math.min(top[k]!, AXIS_V + y / f)
    }
    let fuse = fill(rs.planes.map((_, k) => fuseAt(k, expo[k]!)))
    /**
     * 【三趟迭代】n 要拿圓管的背線當 b 才解得出來，而圓管的背線要用 n 才換算
     * 得回中線。第一趟先用「中線＝背線」那一版的 n。實測第三趟的位移 < 0.005。
     */
    for (let pass = 0; pass < 3; pass++) {
      expo = fill(rs.planes.map((_, k) => expoAt(k, halfW[k]!, fuse[k]! - AXIS_V)))
      top = fill(despike(rearTop(expo), 0.10, 1))
      fuse = fill(rs.planes.map((_, k) => fuseAt(k, expo[k]!)))
    }

    /** 沿 z 的拉普拉斯，z 不等距、保邊（坑 19）。`edge` 是不平滑的門檻 */
    const smoothZ = (v: number[], edge: number, passes = 2): number[] => {
      for (let pass = 0; pass < passes; pass++) {
        const src = [...v]
        for (let k = 1; k < src.length - 1; k++) {
          if (Math.abs(src[k]! - src[k - 1]!) > edge) continue
          if (Math.abs(src[k + 1]! - src[k]!) > edge) continue
          const zA = rs.planes[k - 1]!, zB = rs.planes[k]!, zC = rs.planes[k + 1]!
          const u = (zB - zA) / (zC - zA)
          v[k] = src[k]! + 0.5 * (src[k - 1]! + (src[k + 1]! - src[k - 1]!) * u - src[k]!)
        }
      }
      return v
    }
    /**
     * 【四趟不是兩趟】半寬與腹線改成「四個原點取極值」之後多了一層雜訊 ——
     * 取極值是**偏上界**的估計，四份各自的量測噪音只會往同一邊加。實測曲率
     * 變號因此由 14/114 升到 24（半寬）、28（腹線），腹線越過 23% 的門檻。
     * 加到四趟之後回到 11 / 13，位移 18 mm，仍在擬合殘差之內。
     */
    smoothZ(halfW, 0.15, 4)
    smoothZ(belly, 0.15, 4)
    /**
     * 【背線的保邊門檻要 0.08 不是 0.15】座艙那一段的背線是一個**膝**：
     * 1.524 → 1.570 → 1.687 → 1.803 → 1.893 → 1.931 → 1.949 → 1.957，
     * 逐步 0.046 / 0.117 / 0.116 / 0.090 / 0.038 / 0.018 / 0.008。整段的
     * 跳幅都在 0.15 之下，所以保邊放行，而拉普拉斯平滑對凸的膝就是**削角**
     * ——實測三趟之後機體 z −2.98…−2.58 整段低了 0.09…0.12，那正是駕駛艙罩
     * 該冒出來的地方。門檻收到 0.08 就把這個膝保住了。
     *
     * 背線現在由 `extent` 量（無射線、無上限），本來就比射線乾淨，不需要
     * 那麼多趟。
     */
    smoothZ(top, 0.08, 2)
    smoothZ(fuse, 0.08, 2)
    // 指數本來就該是平滑變化的；門檻開大讓它整條被抹平
    smoothZ(expo, 9, 6)

    // 【診斷】三條錨點曲線與指數，每 4 站一列。看得出哪一段是內插來的
    if (process.argv.includes('--peek')) {
      console.log('   量測Z   機體Z    半寬    背線    腹線     n   原始背線')
      for (let k = 0; k < rs.planes.length; k += 4) {
        console.log(`  ${n(rs.planes[k]!, 6, 2)}  ${n(rs.planes[k]! - QUARTER_CHORD, 6, 2)}`
          + `  ${n(halfW[k]!)}  ${n(top[k]!)}  ${n(belly[k]!)}  ${n(expo[k]!, 6, 2)}`
          + `  ${n(topC.vMax[k]!)}`)
      }
      return
    }
    /**
     * ── 機身是「一根圓管 + 上面一個方盒」，不是一根胖管 ──────────
     *
     * 專案負責人：「玻璃是斜平面朝向左右兩側，所以頭部是尖銳的；有點像日本
     * 子彈列車的頭型，圓錐體上方多一個正方體延伸到機尾。」逐條 X 帶量參考
     * 模型，這個說法**完全對得上**（`extent`、NOWIRE，機體座標）：
     *
     * ```
     *   機體Z   x0.00  x0.30  x0.45  x0.55  x0.65  x0.75  x0.85  x0.95
     *   -3.48   1.515  1.473  1.433  1.387  1.332  1.265  1.185  1.011  ← 還沒有盒子
     *   -2.98   1.893  1.508  1.528  1.434  1.354  1.304  1.208  1.128  ← 盒半寬 ~0.15
     *   -2.48   1.964  1.945  1.914  1.891  1.783  1.405  1.218  1.132  ← ~0.60
     *    0.02   1.997  1.976  1.949  1.920  1.652  1.417  1.267  1.179
     *    3.02   1.951  1.934  1.893  1.788  1.587  1.427  1.330  1.234
     *    4.02   1.873  1.785  1.676  1.563  1.501  1.406  1.336  1.251  ← 收掉了
     *    4.52   1.687  1.639  1.601  1.553  1.490  1.426  1.349  1.265
     * ```
     *
     * `x0.55` 到 `x0.65` 一站掉 0.27、`x0.65` 到 `x0.75` 再掉 0.24 —— 那是
     * 一道**牆**，不是超橢圓的肩。牆的位置固定在 **0.60**，牆頂 **1.98**。
     *
     * 牆外面那幾條（0.75 / 0.85 / 0.95 → 1.41 / 1.27 / 1.15）用「頂 1.60、
     * 半寬 1.15、n 2.5」的超橢圓回推是 **1.381 / 1.288 / 1.150**。底下確實是
     * 一根乾淨的圓管。
     *
     * ── 這一條同時解掉前三輪都沒解掉的「俯視尖角」 ────────────
     *
     * 前三輪都在「超橢圓 + 往上加的裝飾」裡打轉。超橢圓在頂點的斜率恆為 0
     * （只要 n > 1），做不出脊；而 `bUp` 取的是中線最高點 —— 在那一段就是
     * **盒頂**，於是整個上半圈被撐平，裝飾只能 `max` 砍不下去，機體 −3.06
     * 與 −2.88 兩站的裝飾**一個索引都沒改到**。
     *
     * 拆成兩個體之後尖角是**自動**出來的：方盒的側牆本來就是一片朝左右的
     * 平面，牆的半寬由 0 楔形張開到 0.60，俯視就是那個向前的夾角。
     *
     * 楔形由量到的兩點定：機體 −2.98 半寬 0.15、−2.48 半寬 0.60，反推零點在
     * −3.15、滿寬在 −2.50 —— 0.60 / 0.65，與機身軸夾 **42.7°**。參考 GLB 的
     * 風擋緣線量到 50.6°、另一台 lowpoly 量到 50.1° 與 52.8°；牆比玻璃的緣線
     * 陡一點是對的 —— 玻璃是**斜**的平面，牆是垂直的。
     */
    /**
     * 錨點曲線在任意量測 z 的值。站位是等距的，所以直接線性內插。
     *
     * 【為什麼需要】風擋只有 0.2…0.3 m 長，站距 0.175 切不出它（見上面）。
     * 那一段要加密，而錨點是逐站量的 —— 加密的站位只能由曲線內插來。
     */
    const at = (v: readonly number[], zm: number): number => {
      const u = (zm - rs.planes[0]!) / STEP
      const i = Math.max(0, Math.min(v.length - 2, Math.floor(u)))
      const f = Math.max(0, Math.min(1, u - i))
      return v[i]! + (v[i + 1]! - v[i]!) * f
    }
    /** 一站的十六點半剖面（右半，左半由 `buildHull` 鏡像） */
    const ringAt = (zm: number): [number, number][] => {
      const a = at(halfW, zm)
      const bUp = at(fuse, zm) - AXIS_V     // 圓管自己的背線，不是中線最高點
      const bDn = AXIS_V - at(belly, zm)
      const nn = Math.min(6, Math.max(1.4, at(expo, zm)))
      const pts: [number, number][] = OUT_DEG.map((deg) => {
        const u = deg * Math.PI / 180
        const b = deg >= 0 ? bUp : bDn
        return [
          a * Math.abs(Math.cos(u)) ** (2 / nn),
          AXIS_V + Math.sign(Math.sin(u)) * b * Math.abs(Math.sin(u)) ** (2 / nn),
        ]
      })
      /**
       * 方盒。`fuse` 已經是圓管自己的背線，所以這裡是**疊**上去，不是修補
       * ——`x ≤ w` 一律拉到盒頂，`x > w` 一個字不動，兩者之間那一格就是側牆。
       *
       * 環的取樣點在這一段是 x ≈ 0 / 0.19 / 0.41 / 0.63 / 0.82，牆落在
       * 0.41→0.63 那一格，斜率 2.3；參考量到 0.55→0.65 是 2.7、0.65→0.75
       * 是 2.35。**牆的位置由取樣點決定**，所以 `BOX_W` 不必訂得很準 ——
       * 0.41 與 0.63 之間的任何值都生出同一面牆。
       */
      const half = pts.length / 2
      const t = at(top, zm)
      const w = boxWAt(zm)
      const zb = zm - QUARTER_CHORD
      /** 同一站的超橢圓在任意 x 的上緣 */
      const hullY = (x: number): number =>
        AXIS_V + bUp * (1 - Math.min(1, (Math.min(x, a) / a) ** nn)) ** (1 / nn)

      // ① 索引重新分佈：1 與 2 坐到四邊形的上緣與前緣上（漸變）
      const span = paneSpan(zb)
      const bw = span ? blendAt(zb) : 0
      if (span && bw > 0) {
        /**
         * 三個目標，由內往外：
         *
         * ```
         *   索引 1  艙頂的簷   上緣往機首平移 0.09（＝ x 減 0.11）
         *   索引 2  玻璃上緣   span[0]
         *   索引 3  玻璃前／外緣 span[1]
         * ```
         *
         * 【簷是**定值偏移**，不是等比例】試過 `0.7 × 上緣的 x`，那會做出一
         * 個隨 x 變寬的斜坡；而參考模型量到的是一條**等寬**的窄帶：
         *
         * ```
         *   x0.20  上緣在 z −2.894，到 −2.80 就 1.921    Δz 0.09
         *   x0.30  上緣在 z −2.810，到 −2.72 就 1.924    Δz 0.09
         *   x0.40  上緣在 z −2.726，到 −2.65 就 1.912    Δz 0.08
         *   x0.50  上緣在 z −2.642，到 −2.55 就 1.900    Δz 0.09
         * ```
         *
         * 四條帶都是 0.09，而且簷以內一路平到機尾（x0.30 由 −2.70 的 1.931
         * 到 −1.60 的 1.959，1.1 m 只升 0.028）。所以偏移量是
         * `0.09 / PANE_UZK = 0.108`，取 0.11。
         *
         * 【下界為 0 的那幾站】前段玻璃一路吃到中線，上緣不在 x ≥ 0 上，也
         * 沒有簷。三個索引這時全部坐在玻璃**內部**（仍然共面），用 `hi` 的
         * 比例分開；`lo` 長到門檻的那一站兩個分支剛好接上，沒有跳。
         */
        const COAM = 0.11
        const xHi = span[1]
        const xMid = Math.max(span[0], Math.min(0.14, xHi * 0.55))
        const xLo = Math.max(Math.min(0.06, xHi * 0.25), span[0] - COAM)
        /**
         * 【外側整段要跟著重新分佈，不能只動 1 與 2】索引 2 是玻璃的前緣，
         * 它由 x 0.31 一路掃到 0.60，而索引 3 釘在 0.65 —— (2,3) 那一條由
         * 0.36 寬被擠成 0.05 寬。四五站連起來就是算圖上那一片扇形的細條，
         * 人工看到的「越改越糟」有一半是它。
         *
         * 【但也不能讓外側整段跟著掃】試過保比例的線性映射（把
         * `[原索引2, 半寬]` 映到 `[新索引2, 半寬]`）。剖面確實一個字沒動
         * ——重新取樣的是同一條超橢圓——但索引 3…6 因此**每一站都在移動**，
         * 平面著色下每一格的法線跟著歪，機首那一段變成更多細長條。
         *
         * 【只給一個會長大的最小間距】`GAP` 0.10：只有真的被擠到的那一個
         * 索引會讓開，其餘一個字不動。實測索引 3 沿站位是 0.673 → 0.665 →
         * 0.692 → 0.700 → 0.700 → 0.700，穩得多，而 (2,3) 那一條也不再被
         * 擠到 0.05 寬。
         */
        const GAP = 0.10
        const x1 = pts[1]![0]! + (xLo - pts[1]![0]!) * bw
        const x2 = pts[2]![0]! + (Math.max(xMid, xLo + 0.03) - pts[2]![0]!) * bw
        const x3 = pts[3]![0]! + (Math.max(xHi, xMid + 0.03) - pts[3]![0]!) * bw
        pts[1] = [x1, hullY(x1)]
        pts[2] = [x2, hullY(x2)]
        pts[3] = [x3, hullY(x3)]
        let prev = x3
        for (let i = 4; i < half - 1; i++) {
          const x = Math.max(pts[i]![0]!, prev + GAP)
          pts[i] = [x, hullY(x)]
          prev = x
        }
      }

      // ② 方盒。外緣有斜率，掉到機殼之下自然收手，不必再用 `w` 截斷
      if (w > 0) {
        for (let i = 0; i < half; i++) {
          pts[i]![1] = Math.max(pts[i]![1]!, boxY(pts[i]![0]!, t, w))
        }
      }

      /**
       * ③ 風擋平面。範圍就是上下兩條緣線之間，不必另外訂 z 範圍。
       *
       * 【要**取代**不能 `Math.max`】風擋的上緣（y ≈ 1.80）比甲板（1.92…1.96）
       * 低 0.12～0.16 —— 參考模型量到的就是這樣，那是風擋的上框。用 `max` 的
       * 話方盒會把上緣那個頂點提到甲板高度，那一格就**不共面**了，整片又不是
       * 平面。取代之後 (0,1) 那一格自然變成上框的那個面。
       *
       * 【範圍之內要無條件取代】原本加了「平面高於機殼才用」，結果機體
       * −3.02 那一站的索引 2 被擋掉了 —— 那裡我的圓管給 1.671 而參考的玻璃
       * 是 1.544，**圓管自己偏高 0.13**（`fuse` 在機首那幾站的反解偏高，見
       * 檔頭）。玻璃是量到的外表面，範圍之內它**就是**蒙皮，該以它為準。
       */
      if (span) {
        for (let i = 0; i < half; i++) {
          const x = pts[i]![0]!
          if (x >= span[0] - 1e-9 && x <= span[1] + 1e-9) {
            pts[i]![1] = paneY(x, zb)
            continue
          }
          /**
           * 【緊鄰玻璃**外側**的頂點不得高過平面】它雖然在四邊形之外，但
           * `buildHull` 是在**索引之間**內插的 —— 它一高，四邊形**內部**的
           * 面就被撐起來。實測機體 −3.20 的索引 1 落在 x 0.185（四邊形只到
           * 0.119），踩在圓管上的 1.575 比平面高 0.061，於是玻璃內部 x0.10
           * 那裡的蒙皮高出玻璃 36 mm，從外面看就是一塊凸起壓在玻璃上。
           * 逐點掃四邊形內部，最嚴重處 44 mm。
           *
           * 只夾**外側**。內側是艙頂的簷，它本來就該高過平面。
           */
          /**
           * 【夾的力道要**由 1 漸退到 0**，不能是一個硬窗】第一版寫的是
           * 「x 落在 (span[1], span[1] + 0.12) 就夾到平面」。窗的外緣是硬的，
           * 而 `span[1]` 隨 z 一直在長 —— 同一個索引在某一站還在窗外、下一站
           * 就進了窗，y **一步掉 0.05**：
           *
           * ```
           *   機體Z   索引 4 的 (x, y)        span[1]
           *   −3.02   0.585, 1.455           0.450
           *   −2.99   0.586, 1.459           0.450   ← 還在窗外
           *   −2.96   0.598, 1.408           0.498   ← 進了窗，掉 0.051
           * ```
           *
           * 而那一段的側面很陡，0.05 的落差配上前後兩站的正常值就是一根尖刺。
           * 人工回報「駕駛座右舷上方有凹陷」指的就是這一片。
           *
           * 改成在窗內線性退場（t=0 全夾、t=1 不夾），y 對 z 就連續了。
           */
          const t = (x - span[1]) / 0.12
          if (t > 0 && t < 1) {
            const flat = paneY(x, zb)
            pts[i]![1] = Math.min(pts[i]![1]!, flat + (pts[i]![1]! - flat) * smooth(t))
          }
        }
        /**
         * ④ 玻璃走到外緣之後，外面接一道**與玻璃外緣同高的窄簷**。
         *
         * 【症狀】索引 3（x 0.65 上下）本來直接掉回圓管：機體 −2.72 是
         * 1.473，而玻璃的外緣（x 0.60）是 1.649，參考模型在 x0.65 量到
         * 1.639。玻璃與機身側面之間因此夾出一條 0.05 寬、落差 0.18 的細長
         * 條，四五站連起來就是算圖上那一片扇形碎面。
         *
         * 【不能用方盒補】`boxY` 是從中線的 `t`（1.95）算下來的，比玻璃的
         * 外緣高 0.30 —— 補下去玻璃外側會**高過玻璃**，變成倒反的階。
         *
         * 【只在 `span[1] === PANE_OUT` 的站位生效】那正是四邊形已經頂到外
         * 緣、駕駛艙的側壁真的存在的那一段（機體 −2.895…−2.559）。再往前
         * 機首還在收，圓管自己說了算。
         *
         * 實測：−2.72 的 x0.65 由 1.473 變 1.645（參考 1.639）、−2.66 由
         * 1.473 變 1.710（參考 1.679）、−2.84 由 1.469 變 1.505（參考 1.472）。
         */
        const LEDGE = PANE_OUT + 0.05
        if (span[1] >= PANE_OUT - 1e-9) {
          const yEdge = paneY(PANE_OUT, zb)
          for (let i = 0; i < half; i++) {
            const x = pts[i]![0]!
            if (x <= PANE_OUT + 1e-9) continue
            pts[i]![1] = Math.max(pts[i]![1]!, yEdge - BOX_OUT * Math.max(0, x - LEDGE))
          }
        }
      }
      return pts
    }
    /**
     * 站位。整條機身照量測的等距站位，**駕駛艙那一段換成 0.06 一站**
     * （見上面：風擋在 z 方向只有 0.2…0.3 m，0.175 切不出它）。
     */
    const DENSE = { from: -3.44, to: -2.24, step: 0.06 } as const   // 機體座標
    /**
     * 【四邊形的前後兩個「進出口」再加密一倍】索引 1／2／3 在這兩處**橫向
     * 遷移**：由機首的自然位置搬到四邊形的三條緣上（前端），以及搬回去
     * （後端）。逐站量同一索引的橫向位移：
     *
     * ```
     *   站位對              i1     i2     i3     i4     i5
     *   −3.26 → −3.20     0.204  0.277  0.324  0.002  0.002
     *   −2.60 → −2.54     0.226  0.222  0.158  0.149  0.145
     *   （其餘各站）        ≤0.10  ≤0.10  ≤0.10  ≤0.10  ≤0.10
     * ```
     *
     * 0.2～0.3 的橫向位移配 0.06 的站距，做出來是一片又長又斜的四邊形 ——
     * 平面著色下它的法線與左右鄰居差很多，算圖上就是一根尖刺。人工回報
     * 「駕駛座右舷上方有凹陷」指的就是這兩處。
     *
     * **形狀不動，只把同一段遷移攤成更多站**，每一片的斜度因此變小。前端
     * 切 4 份、後端切 2 份（後端的位移只有前端的三分之二），最大位移由
     * 0.324／0.226 降到 0.105／0.115。代價是 12 個環（約 480 個三角形）。
     */
    const EXTRA: readonly (readonly [number, number, number])[] = [
      [-3.32, -3.14, 4], [-3.02, -2.82, 2], [-2.66, -2.48, 2],
    ]
    const stations: number[] = []
    for (const zm of rs.planes) {
      const zb = zm - QUARTER_CHORD
      if (zb < DENSE.from || zb > DENSE.to) stations.push(zm)
    }
    for (let zb = DENSE.from; zb <= DENSE.to + 1e-9; zb += DENSE.step) {
      stations.push(zb + QUARTER_CHORD)
      const mid = zb + DENSE.step / 2
      const hit = EXTRA.find(([a, b]) => mid > a - 1e-9 && mid < b + 1e-9)
      if (hit) {
        for (let k = 1; k < hit[2]; k++) {
          stations.push(zb + (DENSE.step * k) / hit[2] + QUARTER_CHORD)
        }
      }
    }
    stations.sort((p, q) => p - q)
    /**
     * 【機首尖端與尾錐是手工的，但尺度錨在量到的環上】（坑 15）
     *
     * 機首：`align` 的包圍盒說幾何從機體 −6.380 開始，但 −6.03 之前只有上半
     *       打得到。前兩環是第一個乾淨環按 0.22 / 0.62 收出來的，**中心不動**
     *       ——只縮橫向與上下半高。不補的話全長少 0.35，側視看起來只是機首鈍。
     * 尾錐：**由憑空收尖改成量測值 —— 2026-08-20。**
     *
     *       第一版說「量到機體 13.97 之後整圈打不到」，於是五環憑一條曲線收
     *       到 15.30 的 0.10 倍，中心再以 0.16/m 抬。做出來是一根 1.4 m 就
     *       收成一點的尖錐；真機那裡是**幾乎不收的尾樑 + 一顆圓鈍的尾砲塔**。
     *       專案負責人：「機尾是不是沒這麼厚? …更正，機尾是厚的沒錯，但是
     *       好像長度不夠?」
     *
     *       打不到是因為原本那組射線的原點在機身軸心、`maxRadius` 又大，尾段
     *       一出來就先打到垂尾。**把原點挪進尾樑裡（y 0.90）、`maxRadius`
     *       收到 0.95**，垂尾與尾槍全部被排掉，量到 16.25 完全連續：
     *
     * ```
     *   機體Z   13.70  14.50  15.30  15.70  15.90  16.00  16.10  16.20
     *   半寬    0.713  0.642  0.566  0.526  0.476  0.397  0.341  0.233
     *   背線    1.614  1.538  1.458  1.416  1.368  1.315  1.233  1.126
     *   腹線    0.187  0.258  0.334  0.374  0.424  0.503  0.559  0.667
     *   舊版半寬 0.712  0.527  0.071    —      —      —      —      —
     * ```
     *
     *       13.70…15.70 的半寬是一條 −0.0985/m 的直線，背線／腹線也各是
     *       ∓0.0983/m —— 錐度只有 5.6°。15.80 之後才快速收頭，16.25 結束
     *       （半寬 0.16）。中心線量到的是 0.896…0.909，**幾乎是定值**，
     *       所以 `dCy` 一路取 0（舊版的 0.16/m 讓腹線在 15.30 跑到 1.044，
     *       而真值是 0.334）。
     *
     *       全長因此由 21.68 回到 **22.65**（真機 22.66）。
     */
    const shrink = (
      ring: readonly (readonly [number, number])[], f: number, dCy: number,
    ): string => {
      const cy = (ring[0]![1]! + ring[ring.length - 1]![1]!) / 2
      return ring.map(([x, y]) =>
        `[${(x * f).toFixed(4)}, ${(cy + dCy + (y - cy) * f).toFixed(4)}]`).join(', ')
    }
    const line = (z: number, pts: string): string =>
      `  { z: ${z.toFixed(4)}, half: [${pts}] },`

    console.log('// ── 貼進 src/render/geometry/b17g.hull.ts 的 B17G_HULL ──')
    console.log(`// QUARTER_CHORD ${QUARTER_CHORD}  站距 ${STEP}`
      + `（駕駛艙 ${DENSE.step}）  ${stations.length} 站`)
    const first = ringAt(stations[0]!)
    for (const [z, f] of [[-6.3798, 0.22], [-6.2200, 0.62]] as const) {
      console.log(line(z, shrink(first, f, 0)))
    }
    for (const zm of stations) {
      const pts = ringAt(zm).map(([x, y]) => `[${x.toFixed(4)}, ${y.toFixed(4)}]`)
      console.log(line(zm - QUARTER_CHORD, pts.join(', ')))
    }
    const last = ringAt(stations[stations.length - 1]!)
    const lastZ = stations[stations.length - 1]! - QUARTER_CHORD
    // f = 參考模型該站的半寬 ÷ 13.70 那一站的 0.713
    for (const [z, f] of [
      [13.9000, 0.975], [14.3000, 0.924], [14.7000, 0.875], [15.1000, 0.821],
      [15.5000, 0.766], [15.8000, 0.713], [15.9000, 0.668], [16.0000, 0.557],
      [16.1000, 0.478], [16.2000, 0.327], [16.2700, 0.150],
    ] as const) {
      console.log(line(z, shrink(last, f, 0)))
    }
    void lastZ

    /** 最寬線的曲率變號次數——平順度的唯一有效指標（坑 19），門檻 8/34 */
    const flipsOf = (v: readonly number[]): number => {
      let f = 0
      for (let k = 2; k < v.length - 1; k++) {
        const a = v[k - 1]! - 2 * v[k]! + v[k + 1]!
        const b = v[k - 2]! - 2 * v[k - 1]! + v[k]!
        if (a * b < 0) f++
      }
      return f
    }
    console.log(`\n// 曲率變號：半寬 ${flipsOf(halfW)}、背線 ${flipsOf(top)}`
      + `、腹線 ${flipsOf(belly)} / ${halfW.length} 站（門檻 23%）`)
    const nn = expo.filter(Number.isFinite)
    console.log(`// 超橢圓指數 n ${n(Math.min(...nn), 5, 2)} … ${n(Math.max(...nn), 5, 2)}`)
    console.log(`// 機身全長 ${n(rs.planes[rs.planes.length - 1]! - rs.planes[0]!)} m`
      + `（尾錐與尾砲塔另外接）`)
  },


  /**
   * 【後機身的背線：把射線原點往旁邊挪】正上方那條射線與垂尾**共面**，
   * 打到與打不到全看浮點運算，Z 8.85 之後整段回 0。
   *
   * 座艙罩那一招的另一面：**換一個射線原點，就能把被擋住的東西量出來**。
   * 原點挪到 x = 0.25（後機身半寬 0.42…0.85，還在裡面），射線就離開垂尾的
   * 平面了；量到的是該 x 的高度，不是正中線，但兩者在剖面頂附近差得很少。
   */
  rearback: async (_page, _probe, slice) => {
    for (const ax of [0, 0.15, 0.25, 0.35]) {
      const rs = await slice('radial', 'z', {
        from: 7.0, to: 13.0, count: 25, angles: 72,
        axisU: ax, axisV: 0.20, maxRadius: 1.8,
      }) as Radial
      const up = rs.planes.map((_, k) => {
        const row = rs.r[k]!
        let best = 0
        for (let j = 1; j < rs.theta.length; j++) {
          if (Math.abs(rs.theta[j]! - Math.PI / 2) < Math.abs(rs.theta[best]! - Math.PI / 2)) best = j
        }
        return row[best]! > 0 ? 0.20 + row[best]! : NaN
      })
      console.log(`\n── 射線原點 x = ${ax} ──`)
      console.log('   量測Z ' + rs.planes.map((z) => n(z, 6, 1)).join(''))
      console.log('   背線Y ' + up.map((v) => n(v, 6, 2)).join(''))
    }
  },

  /**
   * 【驗收】自家模型與參考模型**用同一支切片器對切**，逐站比對。
   *
   * 【不要在疊圖上量像素】He 111 那次疊圖上背鰭看起來浮出 0.23 m，對切之後
   * 逐站差只有 0.008~0.020 —— 那 0.23 是水平尾翼擋在前面造成的錯覺。疊圖裡
   * 離鏡頭近的零件會遮住參考模型，遮出來的邊界看起來就像自家模型的輪廓。
   *
   * ══ 第二版：對切只證明兩邊一致，證明不了兩邊都對 ═══════════
   *
   * 第一版的四行結果（半寬 0.006、腹線 0.001、主翼前緣 0.045、垂尾前緣
   * 0.004）全部漂亮，而人工一眼就看出垂尾大得離譜、機身不平順。兩個原因：
   *
   * **（甲）垂尾那 0.004 是假的。** 參考那邊量到的是天線鋼索（`Object_36`），
   * 自家那邊量到的是照鋼索造的垂尾 —— 兩者當然吻合。所有對參考模型的切片
   * **一律要排掉 `Object_36`／`Object_6`**。
   *
   * **（乙）機身根本沒有比對背線。** 第一版只比半寬與腹線，而錯的正是背線
   * （整段低 0.44）。射線量背線會被 `maxRadius` 切掉，所以這裡改用 `extent`
   * 讀中線那條 X 帶 —— 與 `bake` 同一個量法，沒有上限也沒有原點。
   *
   * 背線的比對會在三個地方**必然**有差，那是對的不是錯的：
   * 砲塔（自家是球、參考是砲塔本體）、背鰭整流罩（自家 `DORSAL` 是一片
   * 梯形）、導航員圓頂（自家沒有）。表上照印，由人判讀。
   */
  verify: async (page, _probe, slice) => {
    const NOWIRE = '^(?!Object_36$|Object_6$)'
    const stat = (xs: readonly number[], label: string): void => {
      const v = xs.filter(Number.isFinite).map(Math.abs).sort((a, b) => a - b)
      if (v.length === 0) { console.log(`  ${label}  沒有可比的站位`); return }
      console.log(`  ${label}  ${String(v.length).padStart(3)} 站`
        + `  中位 ${n(v[v.length >> 1]!)}  90% ${n(v[Math.floor(v.length * 0.9)]!)}`
        + `  最大 ${n(v[v.length - 1]!)}`)
    }

    // ── 機身：中線背線與腹線（`extent`，與 bake 同一個量法）──────
    const cOpt = { from: -6.4, to: 15.4, count: 110, uWindow: [-0.06, 0.06] }
    const rc = await slice('extent', 'z', cOpt, undefined, NOWIRE) as Extent
    const mc = await slice('extent', 'z', cOpt, 'mine') as Extent
    console.log('\n── 機身中線逐站對切（自家 − 參考，公尺）─────────────')
    console.log('   機體Z   參考背  自家背   背差   參考腹  自家腹   腹差')
    const dU: number[] = []
    const dD: number[] = []
    for (let k = 0; k < rc.planes.length; k++) {
      const u = mc.vMax[k]! - rc.vMax[k]!
      const b = mc.vMin[k]! - rc.vMin[k]!
      if (Number.isFinite(u)) dU.push(u)
      if (Number.isFinite(b)) dD.push(b)
      if (k % 3 === 0) {
        console.log(`  ${n(rc.planes[k]!, 6, 2)}  ${n(rc.vMax[k]!, 7)} ${n(mc.vMax[k]!, 7)}`
          + ` ${n(u, 7)}  ${n(rc.vMin[k]!, 7)} ${n(mc.vMin[k]!, 7)} ${n(b, 7)}`)
      }
    }
    console.log('')
    stat(dU, '背線')
    stat(dD, '腹線')

    // ── 機身：最大半寬（射線，四個原點取最大，與 bake 同）──────
    const wOpt = { from: -5.6, to: 13.6, count: 78, angles: 72, maxRadius: 1.6 }
    const dW: number[] = []
    const wr: number[][] = []
    const wm: number[][] = []
    for (const v of [0.0, 0.30, 0.60, 0.90]) {
      const a = await slice('radial', 'z', { ...wOpt, axisV: v }, undefined, NOWIRE) as Radial
      const b = await slice('radial', 'z', { ...wOpt, axisV: v }, 'mine') as Radial
      wr.push(a.r.map((row) => row[0]!))
      wm.push(b.r.map((row) => row[0]!))
    }
    console.log('\n── 機身最大半寬（自家 − 參考）─────────────')
    for (let k = 0; k < wr[0]!.length; k++) {
      const a = Math.max(...wr.map((s) => s[k]!))
      const b = Math.max(...wm.map((s) => s[k]!))
      if (a > 0 && b > 0) dW.push(b - a)
    }
    stat(dW, '半寬')

    // ── 機翼：沿翼展的前後緣與厚度 ──────────────────────────
    const gOpt = { from: 1.4, to: 15.4, count: 36, uWindow: [-3.0, 5.0] }
    const rw = await slice('extent', 'x', gOpt, undefined, NOWIRE) as Extent
    const mw = await slice('extent', 'x', gOpt, 'mine') as Extent
    console.log('\n── 右半翼逐站對切（自家 − 參考）───────────────')
    console.log('      X    前緣差   後緣差   弦長差   厚度差')
    const dL: number[] = []
    const dT: number[] = []
    const dC: number[] = []
    for (let i = 0; i < rw.planes.length; i++) {
      if (rw.count[i]! === 0 || mw.count[i]! === 0) continue
      const le = mw.uMin[i]! - rw.uMin[i]!
      const te = mw.uMax[i]! - rw.uMax[i]!
      const ch = (mw.uMax[i]! - mw.uMin[i]!) - (rw.uMax[i]! - rw.uMin[i]!)
      const th = (mw.vMax[i]! - mw.vMin[i]!) - (rw.vMax[i]! - rw.vMin[i]!)
      dL.push(le)
      dT.push(te)
      dC.push(ch)
      if (i % 3 === 0) {
        console.log(`  ${n(rw.planes[i]!, 6, 2)}  ${n(le)}  ${n(te)}  ${n(ch)}  ${n(th)}`)
      }
    }
    console.log('')
    stat(dL, '前緣')
    stat(dT, '後緣')
    stat(dC, '弦長')

    // ── 垂尾：沿 Y 切的側視平面形。**一定要排掉天線鋼索** ──────
    const fOpt = { from: 2.5, to: 5.6, count: 32, uWindow: [-1.0, 1.0] }
    const rf = await slice('extent', 'y', fOpt, undefined, NOWIRE) as Extent
    const mf = await slice('extent', 'y', fOpt, 'mine') as Extent
    console.log('\n── 垂尾逐層對切（自家 − 參考；u 是 X、v 是 Z）────')
    console.log('      Y   參考前  自家前   前差   參考後  自家後   後差   厚度差')
    const fL: number[] = []
    const fT: number[] = []
    for (let i = 0; i < rf.planes.length; i++) {
      if (rf.count[i]! === 0 || mf.count[i]! === 0) continue
      const le = mf.vMin[i]! - rf.vMin[i]!
      const te = mf.vMax[i]! - rf.vMax[i]!
      fL.push(le)
      fT.push(te)
      console.log(`  ${n(rf.planes[i]!, 6, 2)} ${n(rf.vMin[i]!, 7)} ${n(mf.vMin[i]!, 7)}`
        + ` ${n(le, 7)} ${n(rf.vMax[i]!, 7)} ${n(mf.vMax[i]!, 7)} ${n(te, 7)}`
        + ` ${n((mf.uMax[i]! - mf.uMin[i]!) - (rf.uMax[i]! - rf.uMin[i]!), 7)}`)
    }
    console.log('')
    stat(fL, '垂尾前緣')
    stat(fT, '垂尾後緣')

    // ── 疊圖：側視與俯視兩個都要看（坑 4）──────────────────
    for (const v of ['side', 'top']) {
      await page.evaluate((x) => window.__hangarOrtho(x), v)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${SHOTS}b17-verify-${v}.png` })
      console.log(`  截圖 ${v} → ${SHOTS}b17-verify-${v}.png`)
    }
  },

  /**
   * 【對齊驗收】轉正之後三條都要對（He 111 那台就是靠這三條抓出 yaw 的正負
   * 憑推理寫反了）：
   *
   *   1 機首在 −Z
   *   2 翼展落在 X，且幅度等於真機翼展
   *   3 水平尾翼落在機身尾端那一段 Z
   */
  align: async (page, probe, slice) => {
    console.log('── 對齊後的整體包圍盒（公尺）─────────────────')
    for (let i = 0; i < 3; i++) {
      console.log(`   ${'XYZ'[i]}  ${n(probe.min[i]!)} .. ${n(probe.max[i]!)}`
        + `   幅度 ${n(probe.size[i]!)}`)
    }
    console.log(`\n  翼展（X）${n(probe.size[0]!)} m   真機 ${REAL.span}`
      + `   誤差 ${((probe.size[0]! / REAL.span - 1) * 100).toFixed(2)}%`)

    /**
     * 沿 Z 切，看幾何沿機身軸的分佈：u = X（翼展）、v = Y（高）。
     *
     * 【窗口要蓋滿】He 111 第一版只開到 Z=9 而機身到 16.8——後半段整個沒
     * 量到，輸出卻看起來完全正常（只是「全長 9.5 m」）。**窗口不足不會報錯。**
     */
    const ez = await slice('extent', 'z', { from: -8.0, to: 17.0, count: 51 }) as Extent
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

    await page.evaluate(() => window.__hangarShow(false, true))
    for (const v of ['side', 'top']) {
      await page.evaluate((x) => window.__hangarOrtho(x), v)
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${SHOTS}b17-align-${v}.png` })
      console.log(`  截圖 ${v} → ${SHOTS}b17-align-${v}.png`)
    }
  },
}

await main()
