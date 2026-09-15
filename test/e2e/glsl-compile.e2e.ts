/**
 * **把產生的 GLSL 丟進真的 WebGL2 context 編譯。**
 *
 * ```
 * node node_modules/vite-node/vite-node.mjs test/e2e/glsl-compile.e2e.ts
 * ```
 *
 * 【為什麼一定要有這一條】headless 的單元測試碰不到 GPU，所以
 * `fields.test.ts` 的兩條 GLSL 測試只證明「常數沒有漂」與「演算法那幾行
 * 兩邊一致」—— **語法錯了兩條都是綠的**。
 *
 * 實際踩到的：`half` 是 GLSL 的保留字。CPU 那一份用它完全合法，金本位測試
 * 逐行對得上，全套件 3,152 條全綠 —— 而遊戲一開就是黑畫面加
 * `VALIDATE_STATUS false`。
 *
 * 【為什麼不用 headless】無頭 chromium 走 SwiftShader 的軟體實作，那不是
 * 玩家機器上的編譯器。與 `island-shot.e2e.ts` 同一個理由。
 */
import { chromium } from 'playwright'
import { fieldGlsl, fieldGlslWithSite } from '../../src/render/fields'
import { SEASONS } from '../../src/render/season'
import { LEUNA_SITE } from '../../src/render/terrain'

async function main(): Promise<void> {
  const browser = await chromium.launch({ headless: false })
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')
    // 【每一個季節各編一次】色值烘進字串，一個季節一份著色器；只編夏季的話
    // 晚秋那一份壞掉要到瀏覽器裡才看得到
    for (const season of SEASONS) {
      const log = await compile(page, fieldGlsl(season))
      if (log.trim() === '') {
        console.log(`  fieldGlsl('${season}') 編譯通過`)
        continue
      }
      console.error(`  fieldGlsl('${season}') 編譯失敗：`)
      console.error(log)
      throw new Error('GLSL 編譯失敗')
    }
    // 【廠區那一份要單獨編】墊面、鋪面矩形與道路是接在 fieldColorAt 尾巴的
    // 另一段字串，沒有 site 的那四份編得過不代表它編得過
    const siteLog = await compile(page, fieldGlslWithSite('lateAutumn', LEUNA_SITE))
    if (siteLog.trim() !== '') {
      console.error('  洛伊納的 fieldGlslWithSite 編譯失敗：')
      console.error(siteLog)
      throw new Error('GLSL 編譯失敗')
    }
    console.log('  洛伊納的 fieldGlslWithSite 編譯通過')
    // 【查候選表的那一份】多了 usampler2D 與整數位元運算，細節地形用的是它
    const candLog = await compile(page, fieldGlslWithSite('lateAutumn', LEUNA_SITE, true))
    if (candLog.trim() !== '') {
      console.error('  查候選表的 fieldGlslWithSite 編譯失敗：')
      console.error(candLog)
      throw new Error('GLSL 編譯失敗')
    }
    console.log('  查候選表的 fieldGlslWithSite 編譯通過')
  } finally {
    await browser.close()
  }
}

async function compile(page: import('playwright').Page, glsl: string): Promise<string> {
  return page.evaluate((src: string) => {
      const gl = document.createElement('canvas').getContext('webgl2')
      if (gl === null) return 'WebGL2 拿不到 context'
      const sh = gl.createShader(gl.FRAGMENT_SHADER)
      if (sh === null) return 'createShader 回 null'
      // 【前綴要像 three 產生的那一份】版本、精度、以及一個輸出
      gl.shaderSource(sh, '#version 300 es\nprecision highp float;\n'
        + 'precision highp int;\n' + src
        + '\nout vec4 o;\nvoid main(){ o = vec4(fieldColorAt(gl_FragCoord.xy), 1.0); }')
      gl.compileShader(sh)
      if (gl.getShaderParameter(sh, gl.COMPILE_STATUS) === true) return ''
      return gl.getShaderInfoLog(sh) ?? '（編譯失敗但沒有訊息）'
    }, glsl)
}

main().catch((e: unknown) => { console.error(e); throw e })
