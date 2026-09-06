/**
 * 遭遇戰的編組頁（選單重做）。**這一支問的是「點得動嗎」。**
 *
 * 這一頁要有：單位是分隊、我帶哪一隊 5 選 1、機種卡片、兵力對比、
 * 四個想定；戰場與高度有示意圖。」
 *
 * ── 這一支與 `test/unit/skirmish.test.ts` 的分工 ──────────
 *
 * 分隊的加、減、架數、我帶哪一隊、四個想定的編成、與模擬編組表的等價 ——
 * 全部是純函數，已經由那一支逐條釘住。**這裡只驗那些純函數真的接到按鈕上**：
 * 想定一鍵成局、加分隊會展開機種卡、− ＋ ✕ 動得了、帶隊圓點換得了、
 * 對戰條的數字跟著變、按下戰鬥之後場上真的是那一組編制。
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
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
    await page.waitForTimeout(200)

    const mine = page.locator('#sk-mine .flight')
    const foe = page.locator('#sk-foe .flight')
    const odds = page.locator('#sk-versus .odds')
    const fight = page.locator('#skirmish [data-act="fight"]')
    const countOf = (side: 'mine' | 'foe') => page.locator(`#sk-${side} .count b`).textContent()
    const leadIndex = () => page.evaluate(() =>
      Array.from(document.querySelectorAll('#sk-mine .flight')).findIndex((f) => f.classList.contains('lead')))

    // ── 預設 20v20：五隊各四架，我帶第 3 隊（索引 2）───────
    ok(await mine.count() === 5 && await foe.count() === 5, '預設兩邊各五隊')
    ok(await countOf('mine') === '20' && await countOf('foe') === '20', '各 20 架')
    ok(await leadIndex() === 2, '預設我帶第 3 隊 —— 就是舊路徑的 playerAt = 8')
    ok(await page.locator('#sk-presets button').count() === 4, '四個想定')

    // ── 想定一鍵成局 ────────────────────────────────────
    await page.click('#sk-presets button:nth-child(2)')   // 護航突破
    await page.waitForTimeout(100)
    ok(await mine.count() === 2 && await foe.count() === 3, '護航突破：我方兩隊、敵方三隊')
    ok((await odds.textContent())!.includes('8') && (await odds.textContent())!.includes('10'),
      '對戰條 8 : 10', (await odds.textContent())!.replace(/\s+/g, ' '))
    ok(await leadIndex() === 0, '套想定後我帶第 1 隊')

    // ── 加一個分隊：展開機種卡 → 點 Ki-84 ────────────────
    await page.click('#sk-mine .add')
    await page.waitForTimeout(100)
    const planes = page.locator('#sk-mine .plane')
    ok(await planes.count() === 8, '機種卡八張')
    const names = await planes.locator('.nm').allTextContents()
    await planes.nth(names.findIndex((n) => n.includes('Ki-84'))).click()
    await page.waitForTimeout(100)
    ok(await mine.count() === 3, '加了第三隊')
    ok(await page.locator('#sk-mine .palette:not([hidden])').count() === 0, '選完機種卡收起來')
    ok((await mine.nth(2).locator('.nm').textContent())!.includes('Ki-84'), '第三隊是 Ki-84')
    ok(await countOf('mine') === '12', '我方 12 架')

    // ── − ＋ ✕ ─────────────────────────────────────────
    await mine.nth(2).locator('.minus').click()
    await page.waitForTimeout(80)
    ok((await mine.nth(2).locator('.qty .n').textContent()) === '3', '− 一次變 3 架')
    ok(await mine.nth(2).locator('.dots i.on').count() === 3, '三個三角形亮著')
    await foe.nth(2).locator('.rm').click()
    await page.waitForTimeout(80)
    ok(await foe.count() === 2, '✕ 拿掉敵方第三隊')
    ok(await countOf('foe') === '8', '敵方 8 架')

    // ── 我帶哪一隊 ──────────────────────────────────────
    await mine.nth(1).locator('.pick').click()
    await page.waitForTimeout(80)
    ok(await leadIndex() === 1, '點第二隊的圓點就換成第二隊')
    ok((await mine.nth(1).locator('.nm').textContent())!.includes('B-17G'), '那一隊是 B-17G')

    // ── 對戰條跟著變 ────────────────────────────────────
    const text = (await odds.textContent())!.replace(/\s+/g, ' ')
    ok(text.includes('11') && text.includes('8'), '對戰條 11 : 8', text)
    ok(text.includes('轟炸機 4 : 0'), '轟炸機 4 : 0', text)

    // ── 戰場與開場高度 ──────────────────────────────────
    const terrain = page.locator('#sk-terrain button')
    const alt = page.locator('#sk-alt button')
    ok(await terrain.count() === 3 && await alt.count() === 3, '戰場與高度各三個選項')
    ok((await terrain.nth(0).getAttribute('class')) === 'on', '戰場預設是群島')
    ok((await alt.nth(2).getAttribute('class')) === 'on', '高度預設是中空')
    await alt.nth(0).click()
    await page.waitForTimeout(80)
    ok((await alt.nth(0).getAttribute('class')) === 'on', '點甲板之後換它高亮')

    // ── 空名單擋住起飛 ──────────────────────────────────
    await foe.nth(1).locator('.rm').click()
    await foe.nth(0).locator('.rm').click()
    await page.waitForTimeout(80)
    ok(await foe.count() === 0, '敵方清空')
    // 【只驗按鈕，沒有警告文字】一邊空著
    // 的時候那一欄本來就是空的，再寫一行「兩邊都要有人」是多的
    ok(await fight.isDisabled(), '敵方空著時「戰鬥」是禁用的')
    await page.click('#sk-foe .add')
    await page.waitForTimeout(80)
    const foeNames = await page.locator('#sk-foe .plane .nm').allTextContents()
    await page.locator('#sk-foe .plane').nth(foeNames.findIndex((n) => n.includes('G4M'))).click()
    await page.waitForTimeout(80)
    ok(await foe.count() === 1 && !(await fight.isDisabled()), '敵方加回一隊 G4M，戰鬥可以按')

    // ── 打起來：場上真的是這一組編制 ─────────────────────
    await fight.click()
    await page.waitForTimeout(2500)
    const line = logs.find((t) => t.includes('×'))
    ok(line !== undefined, '主迴圈印出了這一場的編制', line ?? '(沒有)')
    ok(line!.includes('4 × p51d') && line!.includes('4 × b17g') && line!.includes('3 × ki84'),
      '我方真的是 P-51D 4、B-17G 4、Ki-84 3')
    ok(line!.includes('4 × g4m'), '敵方真的是 G4M 4')
    // 【我帶第二隊 → 玩家座位是那一隊的長機 = 第 4 格】flightLine 把 player 掛在
    // lead 隊，長機就是 members[0]；前一隊四架，所以是 #4
    ok(line!.includes('玩家座位 #4'), '玩家座位在第二隊的長機', line)
    ok(line!.includes('開場 600 m'), '甲板那一格真的接到了開場高度')
    ok(line!.includes('archipelago'), '場地也接上了')
    ok(await page.evaluate(() => document.querySelector<HTMLElement>('#ui .screen:not([hidden])') === null),
      '進入戰鬥後選單全部藏起來')
    ok(errors.length === 0, '沒有 console error', errors.join(' / '))

    console.log('\n遭遇戰編組：全部通過')
  } finally {
    await browser.close()
  }
}

void main()
