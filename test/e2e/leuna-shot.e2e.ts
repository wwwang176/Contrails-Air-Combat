/**
 * **洛伊納廠區的試飛截圖**。凍結姿態，所以改動前後的像素可比。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                           # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/leuna-shot.e2e.ts     # 終端機二
 * ```
 *
 * 【一定要走任務流程】遭遇戰的地形是群島，**根本不會建廠區那顆網格** ——
 * 拿它拍出來的圖裡沒有佈景。陣營 → 航線 → 簡報三層，每一層的按鈕都是進了
 * 上一層才生出來的，而且切換有過場，元素出現的那一刻點下去會落空。
 *
 * 【與 farmland-shot 同一套理由】一定要有頭（無頭 chromium 走 SwiftShader
 * 軟體算圖，不是玩家機器上的編譯器）；飛機與粒子關掉。
 */
import { chromium, type Page } from 'playwright'
import { PLANT_CENTER } from '../../src/world/leuna'

/** 【要與上面那一行的 --port 對上】vite 在指定埠被佔時會自己往上找 */
const URL = 'http://localhost:5190/'
const ROOT = 'C:/Users/weiwe/AppData/Local/Temp/claude/'
  + 'C--Users-weiwe-orca-workspaces-grok-aircraft2-lenua-build/'
  + '151d84f5-5f66-4442-a023-415b01783c86/scratchpad'

interface View {
  readonly name: string
  readonly yaw: number
  readonly pitch: number
  readonly alt: number
  /** 相對廠區中心的偏移，m */
  readonly dx: number
  readonly dz: number
  readonly desc: string
}

const VIEWS: readonly View[] = [
  {
    name: 'top4k', yaw: 0, pitch: -88, alt: 4000, dx: 0, dz: 0,
    desc: '4 km 正俯視 —— 整片廠區的疏密',
  },
  {
    name: 'bomb2k', yaw: 0, pitch: -55, alt: 2500, dx: 0, dz: 1600,
    desc: '2.5 km 投彈高度、俯角 55° —— 這一關的視距重心',
  },
  {
    name: 'ingress1k', yaw: 0, pitch: -18, alt: 1200, dx: 0, dz: 2600,
    desc: '1.2 km 進場 —— 管廊分層的側影與煙囪',
  },
  {
    name: 'run600', yaw: 0, pitch: -8, alt: 600, dx: 0, dz: 1400,
    desc: '600 m 投彈航線 —— 管廊在頭上交錯',
  },
  {
    name: 'deck200', yaw: 20, pitch: -4, alt: 200, dx: -400, dz: 300,
    desc: '200 m 貼地 —— 地面雜物與管線網撐不撐得住',
  },
  {
    // 【機位要在目標南邊】yaw 0 是往 −Z 看，相機得站在目標的 +Z 那一側
    name: 'tanks', yaw: 0, pitch: -40, alt: 700, dx: 1150, dz: 900,
    desc: '儲槽區 700 m —— 六邊筒在這個距離看不看得出邊',
  },
  {
    name: 'railyard', yaw: 0, pitch: -45, alt: 800, dx: 750, dz: 1350,
    desc: '調車場 800 m —— 股道、龍門吊、堆料',
  },
]

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page: Page = await browser.newPage({
      viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1,
    })
    const errors: string[] = []
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
    page.on('pageerror', (e) => errors.push(String(e)))

    await page.goto(URL)
    await page.click('[data-act="start"]')
    await page.click('[data-act="mission"]')
    const step = async (sel: string): Promise<void> => {
      await page.waitForSelector(sel, { state: 'visible' })
      await page.waitForTimeout(400)
      await page.click(sel)
    }
    await step('#campaign-cards button[data-campaign="allies"]')
    await step('#route .stop[data-mission="allies-m2"]')
    await step('#brief-go')
    await page.waitForTimeout(9000)

    await page.evaluate(() =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!(
        { aircraft: false, particles: false, tracers: false, propDisc: false, vortex: false }))

    for (const v of VIEWS) {
      await page.evaluate((q: readonly number[]) =>
        (window as unknown as Record<string, (...r: number[]) => unknown>)['__still']!(...q),
      [v.yaw, v.pitch, v.alt, 12, PLANT_CENTER.x + v.dx, PLANT_CENTER.z + v.dz])
      await page.waitForTimeout(1500)
      await page.screenshot({ path: `${ROOT}/leuna-${v.name}.png` })
      console.log(`  ${v.name.padEnd(10)} ${v.desc}`)
    }

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
