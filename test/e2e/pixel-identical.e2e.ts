/**
 * **逐像素回歸**：證明一次改動在畫面上**一個像素都沒動**。
 * **不由 vitest 執行**（副檔名 `.e2e.ts`）。
 *
 * ```
 * npm run dev                                              # 終端機一
 * npx vite-node test/e2e/pixel-identical.e2e.ts            # 改動前，存基準
 * # …套用改動…
 * npx vite-node test/e2e/pixel-identical.e2e.ts            # 改動後，存對照
 * # 比對兩批檔案（見檔尾的說明）
 * ```
 *
 * ── 【怎麼做到兩次執行像素相同】──
 *
 * 實際戰鬥每一次都不一樣。這支靠 `main.ts` 的兩個量測出口把變因全部拿掉：
 *
 * ```
 *   __still(yaw, pitch, alt, t)   鏡頭姿態、高度、世界時間全部釘死
 *   __gfx({ ... : false })        飛機、參照物、粒子、曳光彈全部關掉
 * ```
 *
 * 剩下的就只有**天空、海與陸地** —— 都是姿態與時間的純函數。
 *
 * 【`battleProps` 非關不可】砲塔管、編隊標記、碎片、目標環的位置取決於這一場
 * 打成什麼樣。量到：不關它們的話，同一份程式跑兩次仍有 0.2～0.9%
 * 的像素在跳，最大差 171/255 —— 任何改動的差都埋在那個底噪裡。關掉之後同一份
 * 程式跑兩次是**逐 byte 相同**。
 *
 * 【姿態的取法要涵蓋會出事的地方】天空／海的改動最可能在三個地方壞掉：
 * 地平線那一條（海天交界）、天頂（漸層的端點）、正下方（只有海）。所以
 * 俯仰角取的是跨過地平線的一串，不是隨便幾個角度。
 *
 * 【HUD 與效能疊層要藏掉】它們是 DOM，內容取決於暫停前那一刻的戰況，
 * 兩次執行不會一樣。HUD 用 CSS 蓋掉（`hidden` 屬性每幀被主迴圈重寫，
 * 改屬性沒有用），效能疊層按 F3。
 *
 * 【不得使用 process / fs】檔名前綴寫死在下面的 `PREFIX`，改動前後各跑一次
 * 時手動改它。截圖由 playwright 自己寫檔。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/'
const SHOTS = '.shots/pixel/'

/**
 * 這一批截圖的前綴。**改動前跑一次存 `before`，改動後改成 `after` 再跑一次。**
 *
 * 【一輪不同不算證據 —— 一定要有同版的對照組】量到這支偶爾整輪
 * 偏移一個色階：0.5% 的像素差 1/255（天空與海的漸層），高反差處差到 174/255。
 * 那不是程式的差 —— 同一份程式的六輪裡，四輪彼此逐 byte 相同、兩輪一起偏
 * 一階；而兩個**不同**的程式版本只要落在同一輪次群裡就逐 byte 相同。
 *
 * 所以流程是三輪：改動前一輪、改動後兩輪。改動後的兩輪要先彼此相同，
 * 那一輪才有資格拿去跟改動前比。
 */
const PREFIX = 'after'

/**
 * 連天空也一起關掉。
 *
 * 【它在回答什麼】天空的改動理論上碰不到海 —— 海是不透明的、先畫的、
 * 著色器沒動。但「理論上」不是證據。把天空整個移出畫面之後兩版若位元相同，
 * 就證明差異全部出在天空自己的像素上；若還是不同，那差異的成因就不在天空，
 * 得回頭找。
 */
const HIDE_SKY = false

/** 俯仰角，度。負值 = 俯視。跨過地平線的一串，見檔頭 */
const PITCHES = [-90, -60, -30, -10, -3, 0, 3, 10, 30, 60, 89]
/** 偏航角，度。太陽在 `scene.ts` 是固定方向，所以方位角要取得到不同的高光 */
const YAWS = [0, 90, 180]

/**
 * 高空的地平線姿態。**與 3,000 m 那一組是不同的問題。**
 *
 * 【它在守什麼】遠海半邊 3,000 km，而深度緩衝是 24 bit、近平面 1 m ——
 * 3,000 km 外的深度只離「最遠」四到六個最低位。任何「把某一層的深度推到
 * 最遠」的手法（天空就是）在那裡都可能反過來把遠海蓋掉，而 3,000 m 的
 * 姿態看不到那麼遠的海：爬到 20 km 才看得到接近遠海邊緣的那一圈。
 */
const HIGH_ALT = 20000
const HIGH_PITCHES = [-6, -2, 0, 2, 6]

async function main(): Promise<void> {
  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-background-timer-throttling', '--disable-renderer-backgrounding'],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
    })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(3000)

    // HUD 是 DOM 疊層，內容隨戰況。`hidden` 屬性每幀被主迴圈重寫，只有 CSS
    // 蓋得住
    await page.addStyleTag({ content: '#hud { display: none !important }' })
    await page.keyboard.press('F3')            // 收掉效能疊層

    // 只留天空、海與島。飛機的出生位置、粒子的亂數不可重現，所以關掉。
    //
    // 【島留著，而且是刻意的】它是固定種子的解析生成 —— 沒有 Math.random、
    // 沒有時間相依，所以逐像素可重現。
    //
    // 【植被關掉，而且不可能留】它的 tile 快取與 LOD **設計上就吃歷史**：
    // `lodFor(dist, prev)` 有遲滯、快取的淘汰次序取決於鏡頭飛過哪裡。定格
    // 之前那三秒的戰鬥每次都不同，所以同一份程式跑兩次會有 0.3% 的像素在跳
    // （實測，最大差 174/255，散成滿地的點 —— 那是遠處的植被點）。
    // 留著就等於把任何改動的差都埋進那個底噪裡。
    await page.evaluate((hideSky: boolean) =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!({
        aircraft: false, particles: false, tracers: false,
        vortex: false, propDisc: false, battleProps: false, flora: false,
        ...(hideSky ? { sky: false } : {}),
      }), HIDE_SKY)

    let n = 0
    const shoot = async (yaw: number, pitch: number, alt: number): Promise<void> => {
      await page.evaluate(([y, p, a]) =>
        (window as unknown as Record<string, (b: number, c: number, d: number, e: number) => unknown>)
          ['__still']!(y!, p!, a!, 12.5),
        [yaw, pitch, alt])
      // 兩幀：一幀讓 `__still` 寫下的姿態進到畫面，一幀確定畫面已經穩定
      await page.waitForTimeout(120)
      const tag = alt === 3000 ? '' : `-a${alt}`
      await page.screenshot({ path: `${SHOTS}${PREFIX}-y${yaw}-p${pitch}${tag}.png` })
      n++
    }
    for (const yaw of YAWS) {
      for (const pitch of PITCHES) await shoot(yaw, pitch, 3000)
      for (const pitch of HIGH_PITCHES) await shoot(yaw, pitch, HIGH_ALT)
    }
    console.log(`${n} 張截圖寫到 ${SHOTS}${PREFIX}-*.png`)
    console.log(`console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('  ' + e)
    console.log('\n比對（PowerShell）：')
    console.log('  node -e "const fs=require(\'fs\');const d=\'.shots/pixel/\';'
      + 'let bad=0,ok=0;for(const f of fs.readdirSync(d).filter(f=>f.startsWith(\'before-\'))){'
      + 'const a=fs.readFileSync(d+f),b=fs.readFileSync(d+f.replace(\'before-\',\'after-\'));'
      + 'if(a.equals(b))ok++;else{bad++;console.log(\'差異 \'+f)}}'
      + 'console.log(ok+\' 張相同、\'+bad+\' 張不同\')"')
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  throw e
})
