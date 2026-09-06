/**
 * 戰場視覺三則（海到地平線、翼尖凝結尾、螺旋槳圓盤）的人工驗收。
 * **不由 vitest 執行** —— 副檔名是 `.e2e.ts`，而 `vite.config.ts` 的
 * `test.include` 只收 `test/**\/*.test.ts`。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                            # 終端機一，開在 5173
 * npx vite-node test/e2e/battlefield-visuals.e2e.ts      # 終端機二
 * ```
 *
 * ── 【這支腳本能斷言的很有限，而那是儀器的限制不是取巧】──
 *
 * WebGL 畫布沒開 `preserveDrawingBuffer`，畫面讀不回來。所以它做的是
 * **執行路徑的驗收**：
 *
 *   相機遠平面 5,000 km、遠海那片 6,000 km 的四邊形、`FogExp2` 的 uniform、
 *   雙面的圓盤材質、凝結尾那個改造過著色器的 `InstancedMesh` ——
 *   全部會在「進場 → 上帝視角 → 爬高 → 回座艙」這條路徑上被 three 實際
 *   編譯與繪製。shader 或幾何出問題會以 WebGL warning / console error 的
 *   形式現形，而那正是這一份最可能壞掉的方式（新的 fog uniform、新的巨大
 *   幾何、新的粒子著色器注入）。
 *
 * 「高 G 真的會冒尾跡」由 `test/unit/vortex.test.ts` 斷言，不在這裡重複 ——
 * e2e 讀不到粒子數。「海到不到地平線」「凝結尾好不好看」由手動試飛判定。
 *
 * 【刻意不點畫面鎖指標】無頭 chromium 下那一下會把瞄準方向甩到天上（既有
 * 缺陷，詳見 `god-view.e2e.ts` 的檔頭）。這支全程走鍵盤，不需要指標鎖定。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。截圖交給 playwright
 * 自己寫檔，判斷全部走 `page.evaluate`。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/'
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
    // 三次點擊：首頁 → 模式選單 → 遭遇戰設定 → 戰鬥。第三次要限定在
    // `#skirmish` 之內（結算板上有同 `data-act` 的雙胞胎）
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(3000)
    await page.screenshot({ path: SHOTS + 'vis-1-cockpit.png' })

    // 22. 座艙裡先確認場景真的在跑（HUD 有東西 = 主迴圈沒有卡死）
    const ink = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#hud')
      const ctx = c?.getContext('2d') ?? null
      if (c === null || ctx === null) return -1
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      let n = 0
      for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++
      return n
    })
    console.log(`[22] 座艙 HUD 不透明像素 ${ink}（必須 > 0）`)
    if (ink <= 0) throw new Error('座艙 HUD 是空的 —— 主迴圈沒跑起來，這支驗收本身壞了')
    console.log(`[人工看] ${SHOTS}vis-1-cockpit.png —— **地平線的證據就是這一張**。`
      + '要是一條乾淨的硬線（海 L 0.060 對天空 L 0.431），海面近到遠不得有'
      + '明顯的顏色變化，天空頂部要比靠近地平線的地方深')

    // 22a. 深度緩衝的實際位元數。**只記錄不斷言** —— `scene.ts` 的精度計算
    // 假設 24 bit，而 WebGL 規格只保證 16 bit。這不是遠海放大時引入的（遠
    // 平面拉到 800 km 時就存在），但沒有人量過。
    const depthBits = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('canvas:not(#hud)')
      const gl = c?.getContext('webgl2') ?? c?.getContext('webgl') ?? null
      return gl === null ? -1 : (gl.getParameter(gl.DEPTH_BITS) as number)
    })
    console.log(`[22a] DEPTH_BITS = ${depthBits}（scene.ts 的精度計算假設 24）`)

    // 23. 進上帝視角並爬到高空。遠海、霧、5,000 km 遠平面全部在這條路徑上
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: SHOTS + 'vis-2-god.png' })

    await page.keyboard.down('ShiftLeft')
    await page.keyboard.down('KeyE')          // 升高
    await page.waitForTimeout(6000)
    await page.keyboard.up('KeyE')
    await page.keyboard.up('ShiftLeft')
    await page.waitForTimeout(1500)
    await page.screenshot({ path: SHOTS + 'vis-3-high.png' })
    console.log(`[人工看] ${SHOTS}vis-3-high.png —— 俯視。畫面下半不得出現`
      + '方形的邊或天空色的破洞；遠處的飛機／煙霧在深海背景上不得亮得突兀'
      + '（海面不吃霧，而物件仍吃 —— 見 fog.ts 的已知代價）')

    // 24. 把鏡頭抬起來看海天交界（海色與天空色的那一階）
    //
    // 【用漸進的 mouse.move 而不是一次跳過去】`movementX/Y` 在沒有指標鎖定
    // 時照樣會報，所以轉得動鏡頭。但一次移動一大段等於餵給 `stepGodCamera`
    // 一個巨大的 `lookY`，鏡頭會直接翻過頭 —— 那正是 `god-view.e2e.ts` 檔頭
    // 記錄的那個「點一下就把視線甩到天上」的同一類現象。分成小步就沒事。
    // 【這一段只拍照，抓不抓得到地平線不保證 —— 而且原因值得寫下來】
    //
    // 第一次 `mouse.move` 是一次巨大的位移：瀏覽器從它自己的原點跳到
    // (640, 360)，`movementY` 因此是幾百 px —— 換算 360/360 × 1.6 ≈ 1.6 rad
    // ≈ 92°，一次就超過 `pitchLimit` 85°，鏡頭直接撞上限。這與
    // `god-view.e2e.ts` 檔頭記錄的「點一下就把視線甩到天上」是同一個既有
    // 現象。而**撞到哪一邊不確定**：實測同一段程式跑兩次，一次四張全是
    // 天空、一次四張全是海。
    //
    // 所以這裡不宣稱它會拍到地平線。它的價值是**讓鏡頭的 look 路徑真的被
    // 執行**（`stepGodCamera` 的俯仰夾制、`godCameraTarget`），而那條路徑
    // 出問題會以 console 錯誤或 NaN 現形 —— 那才是第 26 條在守的。
    //
    // 「地平線看不看得出來、海有沒有比天暗」的權威判準有兩個，都不在這裡：
    //   一、`test/unit/fog.test.ts` 把顏色關係釘死（**海色**必須比
    //       `skyColorAt(0)` 暗，而且差距 > 0.25。不可以比
    //       霧色，那時海面還吃霧）。
    //   二、手動試飛 —— 有些錯只有人眼看得出來。
    //
    // 【地平線的證據是 `vis-1-cockpit.png`，不是 `vis-3-high.png`】曾經寫成
    // 後者，那是錯的：進上帝視角時相機是 −45° 俯角，65° 的垂直 FOV **整個
    // 落在幾何地平線以下** —— 那張圖裡不會有地平線。`vis-3-high.png` 證明的
    // 是另一件事：俯視時畫面下半不得出現方形的邊或天空色的破洞。
    await page.mouse.move(640, 360)
    await page.waitForTimeout(600)
    let y = 360
    for (const shot of ['a', 'b', 'c', 'd']) {
      for (let i = 0; i < 5; i++) {
        y += 20
        await page.mouse.move(640, y)
        await page.waitForTimeout(60)
      }
      await page.waitForTimeout(800)
      await page.screenshot({ path: `${SHOTS}vis-4-horizon-${shot}.png` })
    }
    console.log(`[人工看] ${SHOTS}vis-4-horizon-{a,b,c,d}.png —— 掃過一段俯角。`
      + '無頭下的滑鼠位移不穩定，這四張不保證拍到地平線（見上方註解）；'
      + '海天的明暗關係由 fog.test.ts 與手動試飛判定')

    // 25. 回座艙，確認整條路徑走得回來
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(2000)
    await page.screenshot({ path: SHOTS + 'vis-5-back.png' })
    console.log(`[人工看] ${SHOTS}vis-5-back.png —— 機首前方要看得到螺旋槳的模糊圓盤`)

    // 26. 全程沒有 console 錯誤。**這才是這支腳本真正的斷言。**
    console.log(`[26] console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('  ' + e)
    if (errors.length > 0) throw new Error('有 console 錯誤')

    // 26a. 圖形相關的 warning 也算失敗。
    //
    // 【原本這支只收 error，檔頭卻聲稱會抓 WebGL warning】那句話是假的 ——
    // 巨大幾何（遠海半邊 3,000 km）與 5,000 km 遠平面
    // **不一定會噴 error，但幾乎一定會先噴 warning**，而那正是這一類改動
    // 最可能壞掉的方式。非圖形的 warning 只記錄不失敗。
    //
    // 【驅動的 Performance 類訊息不算】實測這支會穩定噴四則
    // `GL Driver Message (OpenGL, Performance, ...): GPU stall due to ReadPixels`
    // —— 那是 `page.screenshot()` 自己讀回 framebuffer 造成的，是**儀器的**
    // 副作用不是場景的問題。把舊版的 `src/render/*` checkout
    // 回來跑同一支，四則一字不差地出現，證實與任何場景改動無關。
    // 只濾掉 `Performance` 這一類；`Error` / `Deprecated` / `Portability`
    // 與 three 自己的 `THREE.xxx:` 警告一律照樣失敗。
    const driverPerf = /GL Driver Message \(OpenGL, Performance/i
    const gfx = warnings.filter((w) => /THREE|WebGL|GL_/i.test(w) && !driverPerf.test(w))
    console.log(`[26a] 圖形相關 warning ${gfx.length} 則`
      + `（總 warning ${warnings.length} 則，其中驅動效能提示 `
      + `${warnings.filter((w) => driverPerf.test(w)).length} 則不計）`)
    for (const w of gfx) console.log('  ' + w)
    if (gfx.length > 0) throw new Error('有圖形相關的 warning')
    console.log('全部通過')
  } finally {
    // 【一定要 finally】上面每一個 throw 都排在 close 之前，直接寫的話
    // 失敗時會留下孤兒 chromium
    await browser.close()
  }
}

main().catch((e: unknown) => {
  console.error(e)
  throw e
})
