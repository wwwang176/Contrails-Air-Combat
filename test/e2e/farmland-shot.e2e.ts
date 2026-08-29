/**
 * **內陸農地的試飛截圖**。凍結姿態，所以改動前後的像素可比。
 *
 * ```
 * node node_modules/vite/bin/vite.js --port 5190                              # 終端機一
 * node node_modules/vite-node/vite-node.mjs test/e2e/farmland-shot.e2e.ts     # 終端機二
 * ```
 *
 * 【與 island-shot 同一套理由】`__still` 把鏡頭姿態與世界時間釘死；一定要
 * 有頭（無頭 chromium 走 SwiftShader 軟體算圖，不是玩家機器上的編譯器）；
 * 飛機與粒子關掉。
 *
 * 【這一支比 island-shot 多吃 x / z】細節區的邊在 15 km 外，而
 * `__still` 原本把相機釘在原點。植被也一樣：LOD 的邊界要飛到那個距離才
 * 拍得到。
 *
 * 【`__still` 會自己 `terrain.settle()`】植被引擎每幀只生四格，光靠一次
 * `update` 會拍到還沒補完的地，而且每次的進度都不一樣。
 */
import { chromium, type Page } from 'playwright'
import { villageSite } from '../../src/render/flora'

/** 離原點最近的那個村。取景不用手挑座標 */
function nearestVillage(): { x: number; z: number } {
  const p = { x: 0, z: 0 }
  let best = { x: 0, z: 0 }
  let bd = Infinity
  for (let j = -2; j <= 2; j++) {
    for (let i = -2; i <= 2; i++) {
      if (!villageSite(i, j, p)) continue
      const d = Math.hypot(p.x, p.z)
      if (d < bd) { bd = d; best = { x: p.x, z: p.z } }
    }
  }
  console.log(`  最近的村在 (${best.x.toFixed(0)}, ${best.z.toFixed(0)})，`
    + `離原點 ${(bd / 1000).toFixed(2)} km`)
  return best
}

const VILLAGE = nearestVillage()

/** 【要與上面那一行的 --port 對上】vite 在指定埠被佔時會自己往上找 */
const URL = 'http://localhost:5190/'
const ROOT = 'C:/Users/weiwe/AppData/Local/Temp/claude/C--projects-grok-aircraft2/'
  + 'a396768a-75a8-4daf-b583-9ba32d4ff88e/scratchpad'

interface View {
  readonly name: string
  readonly yaw: number
  readonly pitch: number
  readonly alt: number
  readonly x: number
  readonly z: number
  readonly desc: string
}

const VIEWS: readonly View[] = [
  {
    name: 'overview', yaw: 0, pitch: -35, alt: 3000, x: 0, z: 0,
    desc: '3 km 俯瞰 —— 田的尺度、樹籬的網、樹林的深綠塊',
  },
  {
    name: 'cruise', yaw: 25, pitch: -12, alt: 600, x: 0, z: 0,
    desc: '600 m 巡航 —— 最常看到的高度',
  },
  {
    name: 'deck', yaw: 25, pitch: -3, alt: 150, x: 0, z: 0,
    desc: '150 m 貼地 —— 樹的量體與灌木叢',
  },
  {
    name: 'lod-edge', yaw: 0, pitch: -8, alt: 900, x: 0, z: 0,
    desc: '900 m 高、平視 —— 樹幹的門檻就在畫面中段',
  },
  {
    // 【看鋸齒要看遠】一個像素蓋到的地越寬，帶邊的抗鋸齒越吃重
    name: 'horizon', yaw: 40, pitch: -2, alt: 120, x: 0, z: 0,
    desc: '120 m 貼地、幾乎平視 —— 遠方的樹籬線與凹路，看爬行鋸齒',
  },
  {
    name: 'horizon-high', yaw: 40, pitch: -6, alt: 1500, x: 0, z: 0,
    desc: '1,500 m 平視地平線 —— 田的網一路接到遠景環',
  },
  {
    // 【看公告板接不接得上】3 km 的門檻在畫面中段
    name: 'card-edge', yaw: 40, pitch: -4, alt: 400, x: 0, z: 0,
    desc: '400 m 平視 —— 3 km 的樹冠／公告板門檻就在畫面中段',
  },
  {
    // 【看公告板有沒有躺平】俯角 60°
    name: 'dive', yaw: 40, pitch: -60, alt: 2500, x: 0, z: 0,
    desc: '俯角 60° —— 公告板必須仍然站著，不能變成一地色塊',
  },
  {
    name: 'bush-edge', yaw: 40, pitch: -10, alt: 250, x: 0, z: 0,
    desc: '250 m 低空 —— 1.2 km 的灌木門檻',
  },
  {
    // 站到村的南邊 600 m、往北看
    name: 'village', yaw: 0, pitch: -22, alt: 350,
    x: VILLAGE.x, z: VILLAGE.z + 600,
    desc: '村落 —— 房子沿凹路排，教堂的尖塔',
  },
  {
    name: 'edge-out', yaw: 0, pitch: -6, alt: 900, x: 0, z: -14200,
    desc: '細節區邊緣往外看 —— 丘陵會斷，田不會',
  },
  {
    name: 'edge-in', yaw: 180, pitch: -10, alt: 900, x: 0, z: -14200,
    desc: '同一點往內看',
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
    await page.click('[data-act="skirmish"]')
    // 【用 nth 不用文字】標籤裡是全形空格，字面比對很容易差一個碼位
    await page.click('#terrain-pick button >> nth=1')
    await page.click('#altitude-pick button:text-is("中空")')
    await page.click('#skirmish [data-act="fight"]')
    await page.waitForTimeout(9000)

    await page.evaluate(() =>
      (window as unknown as Record<string, (p: Record<string, boolean>) => unknown>)['__gfx']!(
        { aircraft: false, particles: false, tracers: false, propDisc: false, vortex: false }))

    for (const v of VIEWS) {
      await page.evaluate((q: readonly number[]) =>
        (window as unknown as Record<string, (...r: number[]) => unknown>)['__still']!(...q),
      [v.yaw, v.pitch, v.alt, 12, v.x, v.z])
      await page.waitForTimeout(1200)
      await page.screenshot({ path: `${ROOT}/farm-${v.name}.png` })
      console.log(`  ${v.name.padEnd(10)} ${v.desc}`)
    }

    console.log(`\n  console 錯誤 ${errors.length} 則`)
    for (const e of errors) console.log('    ' + e)
  } finally {
    await browser.close()
  }
}

main().catch((e: unknown) => { console.error(e); throw e })
