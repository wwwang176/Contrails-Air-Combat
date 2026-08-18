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
    const align = stage === 'raw' ? undefined : ALIGN
    const probe: Probe = await page.evaluate(
      ([u, a]) => window.__hangarProbe(u as string, a as typeof ALIGN | undefined),
      [GLB, align] as const,
    )
    console.log(`載入 ${probe.tris.toLocaleString()} 三角形、${probe.meshes} 個 mesh`)
    console.log(align
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
   * 坑 20 仍然滿足 —— 上下端點是射線量到的，不是擬合的 bUp／bDn；擬合的
   * 只有指數 n，而 n 控制的是兩端之間怎麼連。
   *
   * ── 三條錨點曲線各自的可信區間（坑 15）────────────────────
   *
   * ```
   *   半寬  −7.15…12.60 全段可信，只有翼根接合 −2.50…−1.30 要丟
   *                     （蒙皮被翼盒打斷，量到 1.44 / 1.00 / 1.18 三種值）
   *   腹線  全段可信，丟兩塊砲塔：下巴 −6.60…−5.60、球形 3.40…4.60
   *   背線  只有四段可信：−7.40…−5.90（機首）、−5.15…−4.15、
   *                       −1.40…1.10、3.35…8.60
   *         丟座艙罩、上部砲塔、無線電艙頂窗；**後段 8.85 之後整段打不到**
   * ```
   *
   * 後段的背線用**斷面比例**補：Z 8.60 那一站量到高/寬 = 2.044/1.702 = 1.201，
   * 尾錐一路收下去比例不變，所以 `背線 = 腹線 + 1.201 × 2 × 半寬`。這比
   * 「線性內插到一個猜的尾錐頂」好，因為它跟著另外兩條**量到的**線走。
   */
  bake: async (_page, _probe, slice) => {
    const AXIS_V = 0.20
    const QUARTER_CHORD = -1.1212
    /** 每站 16 點：正上方 → 右側 → 正下方，12° 一格（與 He 111 同） */
    const OUT_DEG = Array.from({ length: 16 }, (_, i) => 90 - i * 12)

    /**
     * 【兩端都是量出來的】
     *
     * 起點 −7.35：`align` 的包圍盒說幾何從 −7.501 開始，但那一端是**下巴
     *             砲塔的槍管**。`body` 每 0.25 m 一刀，機身自己的環從
     *             −7.15 起整圈才都有。
     * 終點 12.60：`body` 表上 12.60 的半寬只剩 0.085，12.85 起整圈打不到
     *             ——那之後是尾砲塔，不是機身。
     */
    const Z0 = -7.15
    const Z1 = 12.60
    const STEP = 0.175
    const COUNT = Math.round((Z1 - Z0) / STEP) + 1
    const rs = await slice('radial', 'z', {
      from: Z0, to: Z1, count: COUNT, angles: 144, axisV: AXIS_V, maxRadius: 1.60,
    }) as Radial

    /**
     * 指定角度 ±win° 內、非零射線的中位數，而且**左右對稱化**（取 θ 與
     * 180°−θ 的平均）。
     *
     * 【為什麼要對稱化】這一檔只存右半、左半一律鏡像。只往 +X 射再鏡像的話
     * 任何橫向偏移都會被**加倍**——He 111 的機首機槍座偏右 0.147，鏡像之後
     * 機首寬了 0.29 m。B-17G 的腰部槍窗本來就左右交錯。
     */
    const robust = (row: readonly number[], deg: number, win = 6): number => {
      const one = (want: number): number => {
        const near: number[] = []
        for (let j = 0; j < rs.theta.length; j++) {
          let d = rs.theta[j]! - want * Math.PI / 180
          while (d > Math.PI) d -= 2 * Math.PI
          while (d < -Math.PI) d += 2 * Math.PI
          if (Math.abs(d) <= win * Math.PI / 180 && row[j]! > 0) near.push(row[j]!)
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
     * 了尖峰**。實測背線在量測 −6.10 有一個 1.55 的單站值，左右鄰站都是
     * 1.19～1.23 —— 那是機首上方的天線桿。門檻對 He 111 是對的，對這台反而
     * 幫倒忙，所以修剪要在平滑之前另外做一道。
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


    /**
     * ── 後段要換一組射線原點，兩個理由都是「原點跑到剖面外面了」──────
     *
     * **半寬**：尾錐的腹線一路升到 +0.19，而原點在 y = 0.20 —— 水平射線是
     * 貼著機身**底線**擦過去的，量到的是那條線上的寬度不是最大半寬。實測
     * 半寬因此一路收到 0.085，看起來像一個平滑漂亮的尾錐，其實是假的。
     * 這是坑 6 的近親：**取樣幾何自己讓一整段悄悄失效，而且不會報錯。**
     *
     * **背線**：正上方那條射線與垂尾**共面**，Z 8.85 之後整段回 0。把原點往
     * X 挪就離開那個平面 —— 實測掃了四個位置：
     *
     * ```
     *   x = 0     Z 9.0 起整段回 0（與垂尾共面）
     *   x = 0.15  Z 8.8 起壞掉
     *   x = 0.25  Z 10.0 起被背鰭整流罩汙染，衝到 1.96
     *   x = 0.35  Z 7.0…13.0 完全連續而且單調 1.65 → 1.49  ← 採這個
     * ```
     *
     * 所以後段跑兩趟：`rearW`（原點 (0, 0.90)）給半寬與腹線、`rearT`
     * （原點 (0.35, 0.90)）給背線。0.90 是後機身剖面中心的量測值。
     */
    const REAR_Z = 8.60
    const REAR_V = 0.90
    const REAR_U = 0.35
    const rearOpt = {
      from: Z0, to: Z1, count: COUNT, angles: 144, axisV: REAR_V, maxRadius: 1.60,
    }
    const rearW = await slice('radial', 'z', rearOpt) as Radial
    const rearT = await slice('radial', 'z', { ...rearOpt, axisU: REAR_U }) as Radial
    /** 換原點之後同一組取樣規則（中位數 + 左右對稱化） */
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
    const rear = (k: number): boolean => rs.planes[k]! > REAR_Z

    const halfW = fill(despike(keep(
      rs.planes.map((_, k) => rear(k) ? robustOf(rearW, k, 0) : robust(rs.r[k]!, 0)),
      [[-99, -2.50], [-1.30, 99]],
    ), 0.10, 1))
    const belly = fill(despike(despike(keep(
      rs.planes.map((_, k) => rear(k)
        ? REAR_V - robustOf(rearW, k, -90) : AXIS_V - robust(rs.r[k]!, -90)),
      [[-99, -6.60], [-5.60, 3.40], [4.60, 99]],
    ), 0.08, -1), 0.08, 1))

    /**
     * 前段的背線只有四段可信（見檔頭），其餘丟掉沿 z 內插。
     * 後段整段由 `rearT` 量到，不必內插。
     */
    const rawTop = despike(keep(
      rs.planes.map((_, k) => AXIS_V + robust(rs.r[k]!, 90)),
      [[-99, -5.90], [-5.15, -4.15], [-1.40, 1.10], [3.35, REAR_Z]],
    ), 0.10, 1)
    const topFront = fill(rawTop)

    /**
     * 【指數 n 由 45° 那條射線反解】只在**背線本身是量到的**那些站算 ——
     * 那保證 45° 也落在乾淨區。第一版沒有這道閘門，後段的 45° 射線打到平尾／
     * 背鰭，二分法一路把 n 推到上界 6.00 整整二十站（坑 6）。
     *
     * 這是整個剖面裡唯一「擬合出來」的量，而它控制的只是上下端點之間怎麼連
     * ——坑 20 禁的是用擬合值當**端點**，不是禁止擬合本身。
     */
    const expo = fill(rs.planes.map((_, k) => {
      if (!Number.isFinite(rawTop[k]!)) return NaN
      const r = robust(rs.r[k]!, 45)
      if (!Number.isFinite(r)) return NaN
      const x = r * Math.SQRT1_2
      const y = r * Math.SQRT1_2
      const a = halfW[k]!
      const b = topFront[k]! - AXIS_V
      if (!(x > 0 && x < a * 0.999) || !(y > 0 && y < b * 0.999)) return NaN
      let lo = 1.2, hi = 6.0
      for (let it = 0; it < 40; it++) {
        const m = (lo + hi) / 2
        if ((x / a) ** m + (y / b) ** m > 1) lo = m
        else hi = m
      }
      const fit = (lo + hi) / 2
      /**
       * 【物理閘門：機身剖面不是長方形】n > 3.4 代表 45° 那一點落在橢圓外面
       * 很遠 —— 打到的是平尾或背鰭整流罩。坑 6 的同一條。
       */
      return fit > 3.4 ? NaN : fit
    }))

    /**
     * 後段的背線是 **x = 0.35 處的高度**不是正中線。用同一站的超橢圓換算回
     * 中線：`y(x) = b·(1 − (x/a)^n)^(1/n)` → `b = y(0.35) / (…)`。
     * 半寬在那一帶是 0.8 上下，0.35/a ≈ 0.44，修正量約 +3%。不修的話尾錐的
     * 背線會整段低 0.05。
     */
    const top = topFront.map((v, k) => {
      if (!rear(k)) return v
      const y = robustOf(rearT, k, 90)
      const a = halfW[k]!
      const nn = Math.min(3.4, Math.max(1.4, expo[k]!))
      const f = (1 - Math.min(0.98, (REAR_U / a) ** nn)) ** (1 / nn)
      return REAR_V + y / f
    })


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
    smoothZ(halfW, 0.15)
    smoothZ(belly, 0.15)
    smoothZ(top, 0.15)
    // 指數本來就該是平滑變化的；門檻開大讓它整條被抹平
    smoothZ(expo, 9, 6)

    // 【診斷】三條錨點曲線與指數，每 6 站一列。看得出哪一段是內插來的
    if (process.argv.includes('--peek')) {
      console.log('   量測Z   機體Z    半寬    背線    腹線     n')
      for (let k = 0; k < rs.planes.length; k += 6) {
        console.log(`  ${n(rs.planes[k]!, 6, 2)}  ${n(rs.planes[k]! - QUARTER_CHORD, 6, 2)}`
          + `  ${n(halfW[k]!)}  ${n(top[k]!)}  ${n(belly[k]!)}  ${n(expo[k]!, 6, 2)}`)
      }
      return
    }
    console.log('// ── 貼進 src/render/geometry/b17g.hull.ts 的 B17G_HULL ──')
    console.log(`// QUARTER_CHORD ${QUARTER_CHORD}  站距 ${STEP}  ${rs.planes.length} 站`)
    for (let k = 0; k < rs.planes.length; k++) {
      const a = halfW[k]!
      const bUp = top[k]! - AXIS_V
      const bDn = AXIS_V - belly[k]!
      const nn = Math.min(6, Math.max(1.4, expo[k]!))
      const pts = OUT_DEG.map((deg) => {
        const u = deg * Math.PI / 180
        const b = deg >= 0 ? bUp : bDn
        const x = a * Math.abs(Math.cos(u)) ** (2 / nn)
        const y = AXIS_V + Math.sign(Math.sin(u)) * b * Math.abs(Math.sin(u)) ** (2 / nn)
        return `[${x.toFixed(4)}, ${y.toFixed(4)}]`
      })
      console.log(`  { z: ${(rs.planes[k]! - QUARTER_CHORD).toFixed(4)}, `
        + `half: [${pts.join(', ')}] },`)
    }

    /** 最寬線的曲率變號次數——平順度的唯一有效指標（坑 19），門檻 8/34 */
    let flips = 0
    for (let k = 2; k < halfW.length - 1; k++) {
      const a = halfW[k - 1]! - 2 * halfW[k]! + halfW[k + 1]!
      const b = halfW[k - 2]! - 2 * halfW[k - 1]! + halfW[k]!
      if (a * b < 0) flips++
    }
    console.log(`\n// 最寬線曲率變號 ${flips}/${halfW.length} 站（門檻 8/34）`)
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
