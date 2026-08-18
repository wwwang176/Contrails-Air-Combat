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
        + `  殘差RMS ${n(Math.sqrt(rss / N))}`)
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
