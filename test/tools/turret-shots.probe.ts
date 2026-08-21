/**
 * 砲塔槍管的截圖 —— **機庫是這個專案唯一截得到 3D 的地方。**
 *
 *   npx tsx test/tools/turret-shots.probe.ts     # 需要 npm run dev 開在 5178
 *
 * 【為什麼不在遊戲裡截】遊戲的 WebGL 畫布沒開 `preserveDrawingBuffer`，
 * `page.screenshot()` 只拍得到 HUD 那張 2D canvas，3D 是全黑的（實測）。
 * 機庫的 renderer 有開（`tools/hangar.ts` 建立時就註明「外部工具要把畫面
 * 複製到 2D canvas 抽輪廓」）。
 *
 * 【看得到什麼、看不到什麼】機庫畫的是**靜止指向**的槍管（`turret.axis`），
 * 幾何與側偏都與 `render/turretBarrels.ts` 共用同一份推導。所以這一支驗得
 * 到的是「位置對不對、朝向對不對、有沒有埋進機身或飄在機外」——
 * 也就是「量到的機身剖面 + 史實站位」那六座最需要驗的那一項。
 *
 * **驗不到**槍焰的時機、彈流的出處、以及曳光彈會不會穿出自己的機身 ——
 * 那三件要在真的瀏覽器裡看一場戰鬥。
 *
 * 【全景不夠用，要近照】1280×720 的全景下 B-17 是 20.8 px/m，一根 0.9 m
 * 的管子只有 19 px、直徑 0.09 m 只有 2 px —— 分不出「管子在那裡」與
 * 「模型本來就有的天線」。所以每一座砲塔各拍一張把鏡頭推到它旁邊的近照。
 */
import { chromium, type Page } from 'playwright'

const URL = 'http://localhost:5178/hangar.html'
const SHOTS = '.shots/'

/** 一張近照：相機位置與看向的機體座標點。 */
interface Shot {
  name: string
  /** 看向哪裡（機體座標） */
  at: [number, number, number]
  /** 相機相對 `at` 的偏移 */
  from: [number, number, number]
}

const B17: readonly Shot[] = [
  { name: 'tail', at: [0, 1.0, 15.5], from: [4, 1.5, 7] },
  { name: 'top', at: [0, 2.0, -1.1], from: [5, 2.5, 4] },
  { name: 'ball', at: [0, -1.1, 5.1], from: [5, -3.0, 4] },
  { name: 'waist', at: [0, 0.6, 6.5], from: [7, 1.5, 0] },
  { name: 'chin-cheek', at: [0, -0.2, -5.0], from: [5, 0.5, -5] },
]

const HE111: readonly Shot[] = [
  { name: 'dorsal', at: [0, 1.7, 2.4], from: [4, 1.8, 4] },
  { name: 'ventral', at: [0, -0.9, 5.3], from: [4, -2.0, 3] },
  { name: 'beam', at: [0, 0.2, 2.8], from: [5, 1.0, 0] },
  { name: 'nose', at: [0.25, 0.35, -2.9], from: [4, 1.0, -3] },
]

async function shoot(page: Page, id: string, shots: readonly Shot[]): Promise<void> {
  await page.evaluate((x) => (window as unknown as {
    __hangarSpec: (s: string) => boolean }).__hangarSpec(x), id)
  await page.waitForTimeout(1200)
  for (const s of shots) {
    const [tx, ty, tz] = s.at
    const [dx, dy, dz] = s.from
    await page.evaluate(([a, b, c, d, e, f]) => (window as unknown as {
      __hangarCam: (px: number, py: number, pz: number,
        qx: number, qy: number, qz: number) => void
    }).__hangarCam(a!, b!, c!, d!, e!, f!),
    [tx + dx, ty + dy, tz + dz, tx, ty, tz] as const)
    await page.waitForTimeout(350)
    await page.screenshot({ path: `${SHOTS}barrel-${id}-${s.name}.png` })
  }
  console.log(`  ${id}：${shots.length} 張已寫入 ${SHOTS}barrel-${id}-*.png`)
}

void (async (): Promise<void> => {
  const browser = await chromium.launch()
  // 【視窗開大】近照要看得出 0.09 m 的管徑
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', (e) => console.log('  [pageerror] ' + String(e)))
  await page.goto(URL)
  await shoot(page, 'b17g', B17)
  await shoot(page, 'he111', HE111)
  await browser.close()
})()
