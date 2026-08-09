/**
 * 上帝視角的人工驗收。**不由 vitest 執行** —— 副檔名是 `.e2e.ts`，而
 * `vite.config.ts:19-24` 的 `test.include` 只收 `test/**\/*.test.ts`。
 *
 * 跑法（兩個終端機）：
 *
 * ```
 * npm run dev                                   # 終端機一，開在 5173
 * npx vite-node test/e2e/god-view.e2e.ts        # 終端機二
 * ```
 *
 * 【為什麼要有它】`main.ts` 沒有單元測試，而這一份改動有一半在那裡：
 * 鏡頭分派、地形的跟隨點、HUD 的欄位。整合測試的護欄守得到「鏡頭不改
 * 戰局」，守不到「鏡頭飛遠之後海面還在不在」。
 *
 * 【為什麼不用 process / fs】專案沒有 `@types/node`。截圖交給 playwright
 * 自己寫檔，判斷全部走 `page.evaluate`。這個目錄若讓 `tsc --noEmit` 收，
 * playwright 的 `.d.ts` 會把 node 的型別拉進來。實測沒有發生（`skipLibCheck`
 * 吞掉了），所以 `tsconfig.json` 沒有加 `exclude`；哪天 `tsc --noEmit` 因為
 * 這個檔案紅了，加 `"exclude": ["test/e2e"]` 就是。
 *
 * ── 這個腳本裡哪些是斷言、哪些是給人看的 ──
 *
 * **是斷言**（會 throw）：準星像素、儀表區像素、console 錯誤。
 *
 * **給人看的**（只印數字與截圖）：三個「畫面差異百分比」。原本的設計把
 * 它們當斷言，但那是**恆真**的 —— 比的是 PNG 位元組，改一個像素整條
 * deflate 流就變了，而海浪與 40 架飛機一直在動，任何兩張截圖的差異都
 * 會是 ≈100%。恆真的斷言比沒有斷言更糟：它看起來像在守什麼。
 *
 * ── 【無頭下量不到的那一條】離開後準星是否回來 ──
 *
 * 這一條**只印不斷言**，理由是儀器本身量不到：無頭 chromium 跑這個場景
 * 只有 ~7.5 fps（實測 `frameSeconds` 0.13 ~ 0.25 s），而 `CameraRig` 的
 * 彈簧 k=120、辛歐拉積分，穩定條件約 `dt < 2/√k ≈ 0.18 s`，實測 0.13 s
 * 已經在發散區。任何擾動之後相機位置會逐幀 ×1.1 ~ ×1.4 地飛走（實測從
 * 1e4 一路到 1e38），於是接觸點與準星全部落到相機背後，`aimVisible` 恆
 * 為 false。
 *
 * **這與上帝視角無關**：只按既有的 `I`（自機交給 AI，同樣把瞄準點鎖在
 * 機首）就重現得一模一樣，而且把 `src/` 整個切回這一份動工之前的
 * `f83c5c2` 也重現。真人以 60 fps 玩的時候 `dt` = 0.017 s，遠在穩定區內。
 *
 * **那個低幀率的不穩定本身是一個真的缺陷**（掉幀掉到 11 fps 以下就會發生），
 * 但它是既有的、範圍在 `CameraRig`，要獨立處理，不該在這一份裡被順手改掉
 * 或用一個放寬的斷言蓋過去。
 *
 * 換上來的是**不經過 3D 相機**的判準：右下角儀表區的像素。上帝視角下
 * `hudWidgets` 不排儀表、血條、能量，那一區必須是空的；回到座艙
 * 必須再度有東西。它驗的正是「上帝視角只畫這幾個 widget，離開後全部回來」，
 * 而且完全不吃相機的狀態。
 *
 * ── 【2026-08-09：中央的判準由「沒有墨水」換成「沒有綠色」】──
 *
 * 上帝視角長出了分隊標示（`godMarkers`），中央因此**不再必須是空的** ——
 * 任何一架長機投影到畫面中央附近，方框的邊就落在離中心 9~46 CSS px
 * （dpr 2 下 18~92 裝置像素）處，直接進到那個 ±40 的框裡。戰鬥中誰會飛到
 * 畫面中央不可控，所以舊判準會**間歇性地紅**，而那是最壞的一種紅。
 *
 * 這一條真正要守的一直是「準星不得出現」，因為準星是**誤導**不是雜訊。
 * 而準星的三個部件（滑鼠圈、機首十字、兩者間的虛線）全部是綠的
 * （`HUD_COLORS.primary` #7dfba8 與 `dim`），分隊標示則是紅（#ff5a4d）
 * 或藍（#5aa9ff）。只數綠色因此正好切開兩者，**而且比原本更強** ——
 * 原本只要中央有任何墨水就算違規，包含與準星無關的東西；現在它真正只盯準星。
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5173/'
const SHOTS = '.shots/'

/** 兩張截圖的位元組差異比例。**不是斷言** —— 見檔頭 */
function diff(a: Uint8Array, b: Uint8Array): number {
  if (a.length !== b.length) return 1
  let n = 0
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) n++
  return n / a.length
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    /**
     * HUD 畫布中央 ±`half` 裝置像素內有多少個不透明像素。
     *
     * 【為什麼驗得到】HUD 是一張獨立的 **2D** canvas（`index.html` 的
     * `#hud`），2D context 的 `getImageData` 讀得回來 —— 而 WebGL 的那一張
     * 讀不到（未設 `preserveDrawingBuffer`）。準星畫在正中央（圓圈恆在畫面
     * 中心，因為相機跟著瞄準點走），上帝視角下 `hudWidgets` 根本不排它，
     * 而那個模式留下的三個 widget（小地圖、名冊、提示）沒有一個畫在中央。
     */
    const hudInk = (half: number): Promise<{ centre: number, dials: number }> =>
      page.evaluate((h: number) => {
        const c = document.querySelector<HTMLCanvasElement>('#hud')
        if (c === null) return { centre: -1, dials: -1 }
        const ctx = c.getContext('2d')
        if (ctx === null) return { centre: -1, dials: -1 }
        // 【兩塊一起在同一次 evaluate 裡讀完】分兩次呼叫會落在不同幀，
        // 於是「中央有、整塊沒有」這種自相矛盾的讀數就出現了（實測踩過）
        const count = (x: number, y: number, w: number, hh: number): number => {
          const d = ctx.getImageData(x, y, w, hh).data
          let n = 0
          for (let i = 3; i < d.length; i += 4) if (d[i]! > 0) n++
          return n
        }
        // 【中央只數綠色】理由見檔頭。`g > r && g > b` 切開準星（綠）與
        // 分隊標示（紅、藍）。
        //
        // 【`a >= 128` 這道下限是必要的，不是保守】`getImageData` 回傳的是
        // **未預乘**的 RGB，而瀏覽器內部存的是預乘值。除回來時在極低 alpha
        // 下捨入誤差會大到把色相整個換掉：α = 1/255 的紅色 (255,90,77) 預乘
        // 後是 (1.0, 0.35, 0.30)，取整之後再除以 α 還原，出來的色相已經不是
        // 紅的了 —— 一個紅框的抗鋸齒邊緣像素就可能被算成準星。準星的筆畫在
        // dpr 2 下有大量 α = 255 的像素（第 16 條會驗證這件事），所以這道
        // 下限不會削弱偵測。
        const greenCount = (x: number, y: number, w: number, hh: number): number => {
          const d = ctx.getImageData(x, y, w, hh).data
          let n = 0
          for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3]! >= 128 && d[i + 1]! > d[i]! && d[i + 1]! > d[i + 2]!) n++
          }
          return n
        }
        const cx = Math.round(c.width / 2)
        const cy = Math.round(c.height / 2)
        return {
          centre: greenCount(cx - h, cy - h, h * 2, h * 2),
          // 右下角的儀表／血條／能量區。不經過 3D 相機。
          // 【名冊不在這一區】它畫在畫面**上方**置中（`roster.ts` 的
          // `y = L.height * 0.04`），而且上帝視角下照畫 —— 它是留下的三個
          // widget 之一
          dials: count(
            Math.round(c.width * 0.66), Math.round(c.height * 0.72),
            Math.round(c.width * 0.34), Math.round(c.height * 0.28),
          ),
        }
      }, half)

    await page.goto(URL)
    // 【三次點擊】首頁 → 模式選單 → 遭遇戰設定 → 戰鬥。按鈕在 `index.html`
    // （不在 `screens.ts`，那裡只有切換邏輯）。用 `data-act` 而不是文字：
    // 「開　始」中間是全形空格 U+3000，而「開始戰鬥」在結算板上還有一顆
    // 同 `data-act` 的雙胞胎，所以第三次要限定在 `#skirmish` 之內
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(3000)

    const before = await page.screenshot({ path: SHOTS + 'god-1-cockpit.png' })

    // 【刻意不點畫面鎖指標】原本這裡有一次 `page.mouse.click(640, 360)`
    // 用來取得指標鎖定。**在無頭 chromium 下那一下會把瞄準方向甩到天上**：
    // 點擊之後接觸點與準星全部落到相機背後（實測 HUD 中央的不透明像素從
    // 每幀穩定的 ~510 變成永遠 0，而畫面上只剩天空、沒有海也沒有飛機）。
    //
    // 這**不是上帝視角造成的**：把 `src/` 整個切回這一份動工之前的
    // `f83c5c2` 再跑同一支腳本，數字逐條相同（點擊前 b20≈500、點擊後 0）。
    // 推測是鎖定生效那一刻瀏覽器補送的一個巨大 `movementX/movementY` 被
    // `slewAimWorld` 吃了 —— 640 px / 半高 360 px × 1.6 ≈ 2.8 rad，正好把
    // 視線甩到近乎正上方。真人玩的時候看不到這個現象（滑鼠是連續移動的）。
    //
    // 這一份的驗收全部走鍵盤，不需要指標鎖定，所以直接不點。**那個現象
    // 本身值得獨立追**，但不該在這裡被一次點擊順手蓋掉。
    //
    // 16. 座艙裡畫面中央有準星、右下角有儀表
    //
    // 【這一條同時是新判準的反面驗證】`centre` 自 2026-08-09 起只數綠色。
    // 若這裡讀到 0，表示 `g > r && g > b` 加上 `a >= 128` 這把尺**根本抓不到
    // 準星** —— 那時第 17 條就是永遠綠的假護欄，不是上帝視角有問題。
    const cockpit = await hudInk(40)
    console.log(`[16] 座艙：中央的綠色 ${cockpit.centre}、儀表區 ${cockpit.dials}`)
    if (cockpit.centre <= 0) {
      throw new Error('座艙裡畫面中央沒有綠色 —— 這一條驗收本身壞了，不是上帝視角的問題')
    }
    if (cockpit.dials <= 0) throw new Error('座艙裡右下角沒有儀表 —— 同上，驗收本身壞了')

    await page.keyboard.press('KeyG')
    await page.waitForTimeout(1500)
    const god = await page.screenshot({ path: SHOTS + 'god-2-entered.png' })

    // 17. 上帝視角下中央不得有**綠色**（＝準星），右下角儀表區必須全空。
    // 中央的紅／藍是分隊標示，那是應該在的 —— 見檔頭。
    const inGod = await hudInk(40)
    console.log(`[17] 上帝視角：中央的綠色 ${inGod.centre}、儀表區 ${inGod.dials}（都必須是 0）`)
    if (inGod.centre !== 0) throw new Error('上帝視角下畫面中央還有綠色 —— 準星沒有被關掉？')
    if (inGod.dials !== 0) throw new Error('上帝視角下右下角還有儀表 —— hudWidgets 沒有生效？')

    console.log(`[給人看] 進上帝視角後的畫面差異 ${(diff(before, god) * 100).toFixed(1)}%`)

    // 17a. 分隊標示的驗收照。
    //
    // 【為什麼要先把鏡頭搬過去】**進上帝視角的當下，整場戰鬥不在畫面裡。**
    // 2026-08-09 實測（相機 (−750, 4802, 4868)、俯角 −45°、yaw 0；最近的
    // 一架在 (−2350, 3705, 4715)）：換算到相機座標是「前 857 m、左 1600 m、
    // 下 697 m」，偏離視軸 39° 與 62°，而半視角只有 32.5° 與 48.6° ——
    // 四十架**全部**在畫面左下角外面，`god-2-entered.png` 裡那些橄欖色的
    // 板子是參照物不是飛機。所以那一張**不能**當分隊標示的證據。
    //
    // 這一段把鏡頭往左 1,600 m、往後 940 m，讓戰鬥落到 −45° 的視軸上。
    // 加速時的平移速度實測約 1,240 m/s，所以是 1.30 s 與 0.76 s。
    //
    // 【為什麼只記錄不斷言】框畫不畫得出來由 `test/unit/hud.test.ts` 的
    // 假 `CanvasRenderingContext2D` 守著（畫幾個、畫在哪、字是什麼）。
    // 這裡量的是**取景**，而取景吃 waitForTimeout 與當下的幀率 ——
    // 把它變成斷言就是造一個間歇性會紅的護欄。與 `vis-4-horizon-*`
    // 那四張同一個處置。
    await page.keyboard.down('ShiftLeft')
    await page.keyboard.down('KeyA')
    await page.waitForTimeout(1300)
    await page.keyboard.up('KeyA')
    await page.keyboard.down('KeyS')
    await page.waitForTimeout(760)
    await page.keyboard.up('KeyS')
    // 【再爬高一段】對準之後畫面裡只有藍方 —— 紅方在更北邊。俯角固定 −45°，
    // 所以拉高就等於把視錐涵蓋的那塊地面按比例放大，兩隊才會同時進來。
    await page.keyboard.down('KeyE')
    await page.waitForTimeout(1400)
    await page.keyboard.up('KeyE')
    await page.keyboard.up('ShiftLeft')
    await page.waitForTimeout(800)
    await page.screenshot({ path: SHOTS + 'god-2b-markers.png' })

    // HUD 上屬於分隊標示的顏色（敵 #ff5a4d、我 #5aa9ff），扣掉左下角的
    // 小地圖與上方的名冊 —— 那兩個 widget 也用同樣的顏色。
    const markerInk = await page.evaluate(() => {
      const c = document.querySelector<HTMLCanvasElement>('#hud')
      const ctx = c?.getContext('2d') ?? null
      if (c === null || ctx === null) return -1
      const d = ctx.getImageData(0, 0, c.width, c.height).data
      const near = (v: number, t: number): boolean => Math.abs(v - t) <= 24
      let n = 0
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3]! < 128) continue
        const p = i / 4
        const x = p % c.width
        const y = Math.floor(p / c.width)
        // 小地圖在左下、名冊在正上方
        if (x < c.width * 0.15 && y > c.height * 0.72) continue
        if (y < c.height * 0.08) continue
        const r = d[i]!
        const g = d[i + 1]!
        const b = d[i + 2]!
        if ((near(r, 255) && near(g, 90) && near(b, 77))
          || (near(r, 90) && near(g, 169) && near(b, 255))) n++
      }
      return n
    })
    console.log(`[17a] 分隊標示的像素 ${markerInk}（只記錄不斷言 —— 取景不保證）`)
    if (markerInk === 0) {
      console.log('      **這一次沒取到景**，god-2b-markers.png 上不會有框。'
        + '重跑一次；框本身由 hud.test.ts 的假 ctx 測試守著')
    }
    console.log(`[人工看] ${SHOTS}god-2b-markers.png —— **分隊標示的證據就是這一張**。`
      + '要看三件事：敵我雙方都有框、框套的是長機（僚機身上沒有）、框下面是 (n/4)')

    // 18. WASD 之後畫面再次改變（給人看：god-3-moved.png）
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(1500)
    await page.keyboard.up('KeyW')
    const moved = await page.screenshot({ path: SHOTS + 'god-3-moved.png' })
    console.log(`[給人看] W 之後的畫面差異 ${(diff(god, moved) * 100).toFixed(1)}%`)

    // 19. 飛遠之後海面仍然鋪滿畫面（terrain.update 的中心點沒接錯）
    await page.keyboard.down('ShiftLeft')
    await page.keyboard.down('KeyW')
    await page.waitForTimeout(6000)
    await page.keyboard.up('KeyW')
    await page.keyboard.up('ShiftLeft')
    await page.waitForTimeout(500)
    await page.screenshot({ path: SHOTS + 'god-4-far.png' })
    // 【怎麼判斷「海還在」】把鏡頭壓到低空俯視，畫面下半應該幾乎全是海色。
    // 網格的邊跑掉的話下半會出現大片天空色。**這一條沒有自動判準** ——
    // WebGL 那張畫布讀不回像素，只能人工看
    await page.keyboard.down('KeyQ')
    await page.waitForTimeout(2000)
    await page.keyboard.up('KeyQ')
    const far = await page.screenshot({ path: SHOTS + 'god-5-far-low.png' })
    console.log(`[人工看] ${SHOTS}god-5-far-low.png —— 畫面下半應為海，不是天空或黑色`)

    // 20. 再按 G 回到座艙，整套座艙 HUD 要回來
    await page.keyboard.press('KeyG')
    await page.waitForTimeout(1500)
    const back = await page.screenshot({ path: SHOTS + 'god-6-back.png' })
    const inkBack = await hudInk(40)
    console.log(`[20] 回到座艙：儀表區 ${inkBack.dials}（必須 > 0）`)
    if (inkBack.dials <= 0) throw new Error('回到座艙之後儀表沒有回來')
    // 【中央只印不斷言】無頭 ~7.5 fps 下 CameraRig 的彈簧在發散區，任何
    // 擾動之後相機會飛走，接觸點與準星全部落到相機背後。詳見檔頭
    console.log(`[給人看] 回到座艙：中央 ${inkBack.centre}`
      + '（無頭下恆為 0，是 CameraRig 在低幀率下的既有不穩定，見檔頭）')
    console.log(`[給人看] 回到跟拍後的畫面差異 ${(diff(far, back) * 100).toFixed(1)}%`)

    // 21. 全程沒有 console 錯誤
    console.log(`[21] console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('  ' + e)
    if (errors.length > 0) throw new Error('有 console 錯誤')
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
