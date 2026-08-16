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

/**
 * 【為什麼要自己宣告 `process`】專案的 `tsconfig` 沒有把 `node` 放進 `types`，
 * 所以 `process` 沒有型別 —— 而 `tsc --noEmit` 會掃到 `test/` 底下。
 *
 * 為了一支開發腳本的一個欄位把 `@types/node` 拉進整個專案，代價是全專案的
 * 型別環境多一整組 node 的全域名稱（`Buffer`、`__dirname`、`require`…），
 * 而那些在瀏覽器端的程式裡出現時**應該要紅**。宣告用到的那一個欄位就好。
 */
declare const process: { argv: readonly string[] }

const URL = 'http://localhost:5177/hangar.html'
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
const ALIGN = { yaw: -90, pitch: 2.4, scale: 6.003285 }

interface Probe {
  tris: number
  meshes: number
  min: number[]
  max: number[]
  size: number[]
  parts: { name: string; tris: number; min: number[]; max: number[]; size: number[] }[]
}
interface Extent {
  planes: number[]
  uMin: number[]; uMax: number[]; vMin: number[]; vMax: number[]
  count: number[]
}

declare global {
  interface Window {
    __hangarProbe: (u: string, a?: typeof ALIGN) => Promise<Probe>
    __hangarSlice: (
      k: string, a: string, o: Record<string, unknown>, t?: 'mine',
    ) => Promise<unknown>
    __hangarSpec: (id: string) => boolean
    __hangarRef: (on: boolean, solid?: boolean) => Promise<boolean>
    __hangarInfo: () => { metrics: { noseZ: number; noseY: number } } | null
    __hangarShow: (mine: boolean, ref: boolean) => void
    __hangarCam: (x: number, y: number, z: number) => void
    __hangarOrtho: (v: string | null) => void
  }
}

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
    if (stage === 'verify') {
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
      target?: 'mine',
    ) =>
      page.evaluate(
        ([k, a, opt, t]) => window.__hangarSlice(
          k as string, a as string, opt as never, t as 'mine' | undefined,
        ),
        [kind, axis, o, target] as const,
      )

    // 【不認識的名字退回 align】它最便宜，也是後面每一格的前提
    await (stages[stage] ?? stages['align']!)(page, probe, slice)
  } finally {
    await browser.close()
  }
}

type Slicer = (
  k: 'radial' | 'extent', a: string, o: Record<string, unknown>, t?: 'mine',
) => Promise<unknown>
type Stage = (page: Page, probe: Probe, slice: Slicer) => Promise<void>

const stages: Record<string, Stage> = {
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
    // 【窗口要蓋滿】第一版只開到 Z=9，而機身到 16.8 —— 後半段整個沒量到，
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

    // ── 二、機身剖面逐站 ────────────────────────────
    const opt = {
      from: -3.0, to: 9.5, count: 26, angles: 72, axisV: 0.25, maxRadius: 1.45,
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
     * 因此會塌回機背。第一版用中位數量垂尾，兩邊都被低估，而且**低估的幅度
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
    const diffs: number[] = []
    for (let k = 0; k < rm.planes.length; k++) {
      const w = pick(rm.r[k]!, rm.theta, 0) - pick(rr.r[k]!, rr.theta, 0)
      const t = pick(rm.r[k]!, rm.theta, 90) - pick(rr.r[k]!, rr.theta, 90)
      const b = pick(rm.r[k]!, rm.theta, -90) - pick(rr.r[k]!, rr.theta, -90)
      for (const d of [w, t, b]) if (Number.isFinite(d)) diffs.push(Math.abs(d))
      console.log(`  ${n(rm.planes[k]!, 6, 2)}  ${n(w)}  ${n(t)}  ${n(b)}`)
    }
    diffs.sort((a, b) => a - b)
    const rms = Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / Math.max(diffs.length, 1))
    console.log(`\n  ${diffs.length} 筆：中位數 ${n(diffs[diffs.length >> 1] ?? NaN)}`
      + `  RMS ${n(rms)}  最大 ${n(diffs[diffs.length - 1] ?? NaN)}`)

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
    console.log('\n── 三、主翼逐站（uWindow Z ∈ [−1.8, 6.8]）──────')
    const wOpt = { from: 3.4, to: 11.2, count: 27, uWindow: [-1.8, 6.8] }
    const wm = await slice('extent', 'x', wOpt, 'mine') as Extent
    const wr = await slice('extent', 'x', wOpt) as Extent
    console.log('      X   ── 前緣 ──  ── 後緣 ──  ── 弦長 ──  ── 厚度 ──')
    console.log('          自家   參考  自家   參考  自家   參考  自家   參考')
    for (let i = 0; i < wm.planes.length; i++) {
      if (wm.count[i]! === 0 || wr.count[i]! === 0) continue
      const c = (m: Extent) => m.uMax[i]! - m.uMin[i]!
      const t = (m: Extent) => m.vMax[i]! - m.vMin[i]!
      console.log(
        `  ${n(wm.planes[i]!, 6, 2)}${n(wm.uMin[i]!, 7, 2)}${n(wr.uMin[i]!, 7, 2)}`
        + `${n(wm.uMax[i]!, 7, 2)}${n(wr.uMax[i]!, 7, 2)}`
        + `${n(c(wm), 7, 2)}${n(c(wr), 7, 2)}${n(t(wm), 7, 2)}${n(t(wr), 7, 2)}`,
      )
    }

    // ── 三之二、水平尾翼：與主翼同一個手法，uWindow 限住 Z 才不會混到主翼
    console.log('\n── 三之二、水平尾翼（uWindow Z ∈ [9.5, 13.6]）──')
    const tOpt = { from: 0.6, to: 3.9, count: 12, uWindow: [9.5, 13.6] }
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
    const fOpt = { from: 8.0, to: 13.4, count: 28, angles: 72, axisV: 0.0, maxRadius: 4.0 }
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
   * 【每站取 8 個角度，與 P-51D／Bf 109 一致】第一點在正上方（背線）、
   * 最後一點在正下方（腹線），中間六點等角分佈。
   *
   * 【每個角度取鄰近射線的中位數，不是單一射線】72 條射線每 5° 一條，取
   * ±12° 內的中位數。**這是為了擋單點漏失** —— 實測 Z=5.27 的正上方那一條
   * 射線回 0（機身在那裡有個縫），若直接採用，背線會從 1.65 掉到 0.86 再
   * 跳回 1.46，烘出來是一個凹坑。中位數對這種孤立漏失免疫，而剖面本身是
   * 平滑的，鄰近角度的半徑本來就接近。
   *
   * 【背線與腹線同樣走中位數】坑 20 說的是「不要用**擬合的** bUp/bDn，要用
   * 正上方那一條射線」—— 理由是單一指數的超橢圓配不上「上圓下平」的剖面。
   * 這裡沒有擬合，量到的就是射線本身，所以那條坑不適用；中位數只是把
   * 「那一條」換成「那一小撮的中位數」，仍然是直接量測。
   *
   * ── 平移 ────────────────────────────────────────────────────
   *
   * 機體座標 = 量測 Z − 2.7465。那個數字是**主翼四分之一弦線**：外段前後緣
   * 各配一條直線外推到 X=0，得前緣 1.2581、弦長 5.9535，四分之一弦
   * 1.2581 + 5.9535/4 = 2.7465。原點是重心，四分之一弦線壓在原點才是正常
   * 的飛機配置（`HullSpec.offsetZ` 的推導）。
   */
  bake: async (_page, _probe, slice) => {
    const AXIS_V = 0.25
    const MAXR = 1.45
    /** 主翼四分之一弦線在量測系的 Z。機體座標 = 量測 Z − 這個數 */
    const QUARTER_CHORD = 2.7465
    /** 每站的輸出角度：正上方 → 右側 → 正下方，八點 */
    const OUT_DEG = [90, 64.286, 38.571, 12.857, -12.857, -38.571, -64.286, -90]

    /**
     * 【量測段的兩端都是量出來的，不是挑的】
     *
     * 起點 −0.5：`align` 那一趟量到幾何的 Z 下界是 −0.5（X 幅度 0.039，
     *            一個點）。從 0.0 開始會把機首尖端整段切掉。
     *
     * 終點 12.3：尾翼從這之後開始污染。實測 —— 水平尾翼從量測 Z ≈ 12.4 起
     *            被「略低於水平」那條射線打到（半寬由 0.35 跳到 0.68、
     *            1.10），垂尾從 Z ≈ 13.2 起被正上方那條打到（背線由 0.48
     *            跳到 0.74、1.07）。**兩者都不是機身。**
     *            12.3 之後的尾錐手工收，錨在最後一個乾淨站位（坑 15）。
     */
    const rs = await slice('radial', 'z', {
      from: -0.5, to: 12.3, count: 33, angles: 72, axisV: AXIS_V, maxRadius: MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }

    /** ±12° 內、非零的半徑中位數；全空回 NaN */
    const robust = (row: readonly number[], theta: readonly number[], deg: number): number => {
      const want = deg * Math.PI / 180
      const near: number[] = []
      for (let j = 0; j < theta.length; j++) {
        let d = theta[j]! - want
        while (d > Math.PI) d -= 2 * Math.PI
        while (d < -Math.PI) d += 2 * Math.PI
        if (Math.abs(d) <= 12 * Math.PI / 180 && row[j]! > 0) near.push(row[j]!)
      }
      if (near.length === 0) return NaN
      near.sort((a, b) => a - b)
      return near[near.length >> 1]!
    }

    // ── 站位 × 8 點，量測座標 ──────────────────────────────
    type Ring = { z: number; pts: [number, number][] }
    const rings: Ring[] = []
    for (let k = 0; k < rs.planes.length; k++) {
      const row = rs.r[k]!
      const pts = OUT_DEG.map((deg) => {
        const r = robust(row, rs.theta, deg)
        const th = deg * Math.PI / 180
        return [Math.abs(r * Math.cos(th)), AXIS_V + r * Math.sin(th)] as [number, number]
      })
      rings.push({ z: rs.planes[k]! - QUARTER_CHORD, pts })
    }

    // ── 補洞：任何 NaN 由前後最近的有效站位沿 z 線性內插 ────
    let holes = 0
    for (let p = 0; p < OUT_DEG.length; p++) {
      for (let k = 0; k < rings.length; k++) {
        if (Number.isFinite(rings[k]!.pts[p]![1])) continue
        holes++
        let a = k - 1
        while (a >= 0 && !Number.isFinite(rings[a]!.pts[p]![1])) a--
        let b = k + 1
        while (b < rings.length && !Number.isFinite(rings[b]!.pts[p]![1])) b++
        const A = a >= 0 ? rings[a]! : null
        const B = b < rings.length ? rings[b]! : null
        if (A && B) {
          const t = (rings[k]!.z - A.z) / (B.z - A.z)
          rings[k]!.pts[p] = [
            A.pts[p]![0] + (B.pts[p]![0] - A.pts[p]![0]) * t,
            A.pts[p]![1] + (B.pts[p]![1] - A.pts[p]![1]) * t,
          ]
        } else if (A) rings[k]!.pts[p] = [...A.pts[p]!] as [number, number]
        else if (B) rings[k]!.pts[p] = [...B.pts[p]!] as [number, number]
        else rings[k]!.pts[p] = [0, 0]
      }
    }

    /**
     * z 不等距的拉普拉斯平滑，兩輪（坑 19）。
     *
     * 【為什麼不是等權的 [.25,.5,.25]】站距不等距時等權濾波會把密集區壓扁。
     * 這裡把每一站往「前後兩站在該 z 的連線」拉 λ = 0.5。
     */
    const smooth = (): void => {
      for (let pass = 0; pass < 2; pass++) {
        const src = rings.map((r) => r.pts.map((p) => [...p] as [number, number]))
        for (let k = 1; k < rings.length - 1; k++) {
          const z0 = rings[k - 1]!.z, z1 = rings[k]!.z, z2 = rings[k + 1]!.z
          const t = (z1 - z0) / (z2 - z0)
          for (let p = 0; p < OUT_DEG.length; p++) {
            for (let c = 0; c < 2; c++) {
              const line = src[k - 1]![p]![c]! + (src[k + 1]![p]![c]! - src[k - 1]![p]![c]!) * t
              rings[k]!.pts[p]![c] = src[k]![p]![c]! + (line - src[k]![p]![c]!) * 0.5
            }
          }
        }
      }
    }
    smooth()

    // 【只有機首那一端收成一點】尾端停在最後一個乾淨站位，尾錐手工接
    {
      const mid = (rings[0]!.pts[0]![1] + rings[0]!.pts[7]![1]) / 2
      for (const p of rings[0]!.pts) { p[0] = 0; p[1] = mid }
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
      from: 12.3, to: 15.9, count: 10, angles: 72, axisV: AXIS_V, maxRadius: MAXR,
    }) as { planes: number[]; theta: number[]; r: number[][] }

    const last = rings[rings.length - 1]!
    const lastW = Math.max(...last.pts.map((p) => p[0]))
    const lastTop = last.pts[0]![1]
    const lastBot = last.pts[7]![1]
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
        pts: e.pts.map(() => [0, (e.pts[0]![1] + e.pts[7]![1]) / 2] as [number, number]),
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
    const MAXR = 1.0
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
