/**
 * 砲塔視覺的人工驗收 —— 槍管、槍焰、彈流的出處。
 * **不由 vitest 執行**（副檔名 `.e2e.ts`，`vite.config.ts` 只收 `*.test.ts`）。
 *
 * ```
 * npm run dev                                        # 終端機一
 * npx vite-node test/e2e/turret-visuals.e2e.ts       # 終端機二
 * ```
 *
 * ── 【為什麼是目視而不是斷言】────────────────────────────
 *
 * WebGL 畫布沒開 `preserveDrawingBuffer`，畫面讀不回來，所以這一支只能
 * **產生截圖**並確認執行路徑沒有丟出錯誤。要看的四件事全部是人眼判斷：
 *
 *   1. 尾砲塔有兩根黑色管子，而且**指著攻擊者**（不是永遠指正後方）
 *   2. 開火時管口有槍焰
 *   3. 彈流從**管口**出來 —— 不是機身中間、不是管子後端，也**不是兩根管子
 *      中間**（雙聯輪替就是為了這一條）
 *   4. **沒有曳光彈從 B-17 自己的機身或機翼穿出來**
 *
 * 第 4 條是實作計畫 Task 4 那條被拿掉的「射界錐不撞自己」的替代驗收
 * （專案負責人 2026-08-20 裁定：同隊已被 `World.ts` 的判定跳過、不造成
 * 傷害，所以不值得用測試綁住一個接近史實的半角）。**看到穿模才回頭調
 * 半角**，看不到就維持現值。
 *
 * ── 【場景怎麼擺】──────────────────────────────────────
 *
 * 選同盟 + B-17G：`battleConfigFrom` 的 `redSpec` 取的是**敵方陣營的第一
 * 台**，所以這是「我方 B-17G vs 德軍 Bf 109」—— 玩家自己就坐在一台有八座
 * 砲塔的飛機上，第三人稱鏡頭正好從後方看自己的尾砲塔。
 *
 * 按 `I` 把自己交給 AI，飛機才會真的進戰鬥；不然它只會直線平飛。
 *
 * 【刻意不點畫面鎖指標】無頭 chromium 下那一下會把瞄準方向甩到天上
 * （既有缺陷，見 `god-view.e2e.ts` 的檔頭）。全程走鍵盤。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright
 * 自己寫檔，判斷全部走 `page.evaluate`。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5178/'
const SHOTS = '.shots/'

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    const warnings: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
      else if (m.type() === 'warning') warnings.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')

    // 【機型按鈕沒有 data-act】它是 renderSetup 動態長出來的一排 button，
    // 只認得出文字。B-17G 的 `name` 見 `src/specs/b17g.ts`。
    const specs = page.locator('#skirmish-specs button')
    const names = await specs.allTextContents()
    const idx = names.findIndex((t) => t.includes('B-17'))
    if (idx < 0) throw new Error(`機型清單裡沒有 B-17：${names.join(' / ')}`)
    await specs.nth(idx).click()
    console.log(`  機型選了「${names[idx]}」（清單：${names.join(' / ')}）`)

    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(2000)

    // 交給 AI 飛，否則玩家那台只會直線平飛、永遠不進戰鬥
    await page.keyboard.press('KeyI')

    /**
     * 開場兩隊相距 10 km，接敵要一段時間。逐段截圖而不是等一個固定時刻 ——
     * 「什麼時候正好在開火」不是可以預測的事。
     */
    for (let k = 1; k <= 12; k++) {
      await page.waitForTimeout(5000)
      await page.screenshot({ path: `${SHOTS}turret-3rd-${String(k).padStart(2, '0')}.png` })
    }

    // 上帝視角：鏡頭離開機身，看得到整台的槍管。方向由滑鼠控制而無頭下
    // 不可靠，所以只用鍵盤平移，取幾個不同的位置各一張。
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(500)
    const moves: [string, number][] = [
      ['KeyE', 1200], ['KeyS', 1500], ['KeyQ', 2000], ['KeyA', 1500], ['KeyW', 2500],
    ]
    for (let k = 0; k < moves.length; k++) {
      const [key, hold] = moves[k]!
      await page.keyboard.down(key)
      await page.waitForTimeout(hold)
      await page.keyboard.up(key)
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${SHOTS}turret-god-${String(k + 1)}.png` })
    }

    console.log(`\n  console error ${errors.length} 條、warning ${warnings.length} 條`)
    for (const e of errors.slice(0, 10)) console.log('    [error] ' + e)
    for (const w of warnings.slice(0, 10)) console.log('    [warn ] ' + w)
    console.log(`\n  截圖在 ${SHOTS}turret-*.png —— 四件事全部人眼判斷，見檔頭。`)
    if (errors.length > 0) throw new Error('有 console error，先修那個再看截圖')
  } finally {
    await browser.close()
  }
}
void main()
