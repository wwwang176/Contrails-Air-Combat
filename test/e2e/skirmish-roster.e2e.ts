/**
 * 遭遇戰的自訂編組（2026-08-21）。**這一支問的是「點得動嗎」。**
 *
 * 專案負責人的需求：「要可以設定我方機種、敵方機種，等於是左右兩排，
 * 點一台 P51 就增加一台 P51 到出戰卡牌中，點幾台出幾台（不是用數量增減），
 * 然後要可以讓我選我是當哪一台；陣營可以混搭，也就是 P51 可以跟 BF109
 * 同一隊。」
 *
 * ── 這一支與 `test/unit/skirmish.test.ts` 的分工 ──────────
 *
 * 名單的加、減、玩家座位怎麼跟著動、混編會編出什麼樣的編組表 —— 全部是
 * 純函數，已經由那一支逐條釘住。**這裡只驗那些純函數真的接到按鈕上**：
 * 點了會不會加、✕ 會不會刪、選中的那一台會不會高亮、按下開始戰鬥之後
 * 場上真的是那一組編制。
 *
 * 【為什麼那樣分】DOM 測起來慢又脆，而「玩家的座位有沒有跟著動」那種
 * 邏輯錯誤在這一層只會表現成一張卡片的樣子不對 —— 分不出是接線錯了
 * 還是算錯了。
 *
 * 【不得使用 process / fs】專案沒有 `@types/node`。
 *
 * 跑法：`npx tsx test/e2e/skirmish-roster.e2e.ts`（dev server 要在 5178）
 */
import { chromium } from 'playwright'

const URL = 'http://localhost:5178/'

function ok(pass: boolean, label: string, detail = ''): void {
  console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? `　${detail}` : ''}`)
  if (!pass) throw new Error(label)
}

async function main(): Promise<void> {
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors: string[] = []
    const logs: string[] = []
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text())
      else logs.push(m.text())
    })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="skirmish"]')

    const blueAdd = page.locator('#blue-add button:not(.ghost)')
    const redAdd = page.locator('#red-add button:not(.ghost)')
    const blueChips = page.locator('#blue-roster .chip')
    const redChips = page.locator('#red-roster .chip')

    const names = await blueAdd.allTextContents()
    ok(names.length === 4, '兩排各有四台可以編', names.join(' / '))
    ok(await redAdd.count() === 4, '敵方那一排也是四台')

    ok(await blueChips.count() === 20, '預設是 20 對 20', `我方 ${await blueChips.count()}`)

    // ── 清空 → 逐架編 ───────────────────────────────────
    await page.click('#blue-add button.ghost')
    ok(await blueChips.count() === 0, '清空之後我方名單是空的')
    const fight = page.locator('#skirmish [data-act="fight"]')
    ok(await fight.isDisabled(), '空名單時「開始戰鬥」是禁用的')

    const idx = (t: string) => names.findIndex((n) => n.includes(t))
    // P-51 ×2、Bf109 ×1、B-17 ×1 —— 混搭
    await blueAdd.nth(idx('P-51')).click()
    await blueAdd.nth(idx('P-51')).click()
    await blueAdd.nth(idx('Bf')).click()
    await blueAdd.nth(idx('B-17')).click()
    ok(await blueChips.count() === 4, '點幾台出幾台')
    const labels = await blueChips.locator('button:not(.del)').allTextContents()
    ok(labels[2]!.includes('Bf'), '同一隊裡混得進 Bf109', labels.join(' | '))
    ok(!(await fight.isDisabled()), '兩邊都有人時「開始戰鬥」可以按')

    // ── 選我開哪一台 ────────────────────────────────────
    ok(await blueChips.nth(0).locator('button.me').count() === 1, '預設是第一架')
    await blueChips.nth(2).locator('button:not(.del)').click()
    ok(await blueChips.nth(2).locator('button.me').count() === 1, '點第三架就換成第三架')

    // ── ✕ 刪掉他前面那一架，玩家要跟著往前一格 ─────────
    await blueChips.nth(0).locator('button.del').click()
    ok(await blueChips.count() === 3, '✕ 刪掉一架')
    const after = await blueChips.locator('button:not(.del)').allTextContents()
    ok(await blueChips.nth(1).locator('button.me').count() === 1,
      '玩家跟著往前一格 —— 還是同一台 Bf109', after.join(' | '))

    // ── 敵方也編一組混搭 ────────────────────────────────
    await page.click('#red-add button.ghost')
    const redNames = await redAdd.allTextContents()
    await redAdd.nth(redNames.findIndex((n) => n.includes('He'))).click()
    await redAdd.nth(redNames.findIndex((n) => n.includes('P-51'))).click()
    ok(await redChips.count() === 2, '敵方編了兩架')

    // ── 打起來 ──────────────────────────────────────────
    await fight.click()
    await page.waitForTimeout(2500)

    const line = logs.find((t) => t.includes('×'))
    ok(line !== undefined, '主迴圈印出了這一場的編制', line ?? '(沒有)')
    ok(line!.includes('bf109g6') && line!.includes('p51d') && line!.includes('b17g'),
      '我方真的是混編的那三架')
    ok(line!.includes('he111'), '敵方真的有 He 111')

    const spawned = await page.evaluate(() => document.querySelectorAll('canvas').length)
    ok(spawned > 0, '畫面還在')
    ok(errors.length === 0, '沒有 console error', errors.slice(0, 3).join(' / '))

    console.log('\n遭遇戰自訂編組：全部通過')
  } finally {
    await browser.close()
  }
}

await main()
