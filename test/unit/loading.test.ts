import { describe, it, expect } from 'vitest'
import { LOADING_HOLD_SECONDS, fileFraction, loadingPercent } from '../../src/ui/loading'

/** 【用 import.meta.glob 而不是 fs】與 `camera-shake.test.ts` 讀接線同一個做法 */
const SOURCES = import.meta.glob(['../../index.html', '../../src/main.ts'], {
  query: '?raw', import: 'default', eager: true,
}) as Record<string, string>
// 【換行統一成 LF】工作區在 Windows 上是 CRLF，照 `\n` 切段會找不到結尾而切到檔尾
const srcOf = (name: string): string =>
  Object.entries(SOURCES).find(([k]) => k.endsWith(name))![1].replace(/\r\n/g, '\n')

describe('fileFraction：已載完的檔數換成進度', () => {
  it('照檔數比例，夾在 0–1', () => {
    expect(fileFraction(0, 18)).toBe(0)
    expect(fileFraction(9, 18)).toBe(0.5)
    expect(fileFraction(18, 18)).toBe(1)
    expect(fileFraction(20, 18)).toBe(1)
  })

  it('沒東西要載就是載完了，不是 NaN', () => {
    expect(fileFraction(0, 0)).toBe(1)
  })
})

describe('loadingPercent：進度換成百分比字樣', () => {
  it('四捨五入到整數，夾在 0–100%', () => {
    expect(loadingPercent(0)).toBe('0%')
    expect(loadingPercent(0.456)).toBe('46%')
    expect(loadingPercent(1)).toBe('100%')
    expect(loadingPercent(-0.2)).toBe('0%')
    expect(loadingPercent(1.7)).toBe('100%')
  })

  it('壞掉的輸入回 0%，不印 NaN%', () => {
    expect(loadingPercent(Number.NaN)).toBe('0%')
  })
})

/**
 * 載入畫面的接線。
 *
 * 【它在防什麼】一、模型還在預載時選單就點得到，那時按出擊會在找不到模型樣板
 * 的地方丟例外 —— 所以載入畫面在 HTML 裡一開始就蓋著。二、建一場戰鬥是同步
 * 的一大段，不先讓出一幀畫面就停在選單上不動、進度條一格都畫不出來。
 */
describe('載入畫面的接線', () => {
  it('index.html 一開場就蓋著載入畫面', () => {
    const html = srcOf('index.html')
    const tag = html.match(/<div id="loading"[^>]*>/)
    expect(tag).not.toBeNull()
    expect(tag![0]).not.toContain('hidden')
    for (const id of ['loading-step', 'loading-fill', 'loading-pct']) {
      expect(html, id).toContain(`id="${id}"`)
    }
  })

  it('出擊先鎖指標、再非同步載入，不直接同步建場', () => {
    const main = srcOf('main.ts')
    const from = main.indexOf("if (event === 'fight' && screen === 'battle')")
    const branch = main.slice(from, main.indexOf('\n    }\n', from))
    expect(branch).toContain('grabPointer()')
    expect(branch).toContain('loadBattle(')
    expect(branch).not.toContain('enterBattle()')
    expect(branch.indexOf('grabPointer()')).toBeLessThan(branch.indexOf('loadBattle('))
  })

  /**
   * 【非同步的入口也要清粒子池】玩家的出擊與「再打一場」現在走 `loadBattle`，
   * 與 `enterBattle` 是同一件事的兩個版本 —— 規則照 `pool-reset-entrypoints`：
   * 呼叫 `resetPools()`，不直接呼叫任何 `xxx.reset()`。
   */
  it('loadBattle 呼叫 resetPools()，不直接清單一的池', () => {
    const main = srcOf('main.ts')
    const head = 'async function loadBattle(): Promise<void> {'
    const from = main.indexOf(head)
    expect(from).toBeGreaterThanOrEqual(0)
    const body = main.slice(from + head.length, main.indexOf('\n}', from))
    expect(body).toContain('resetPools()')
    expect(body.match(/\b[a-z]\w*\.reset\(\)/g) ?? []).toEqual([])
  })

  it('載入中主迴圈不推進戰鬥', () => {
    const main = srcOf('main.ts')
    const frame = main.slice(main.indexOf('function frame(now: number)'))
    expect(frame.slice(0, frame.indexOf('stepAndDrawBattle('))).toContain('loadingBattle')
  })

  /**
   * 【載入中動滑鼠不算數】指標在出擊時就鎖了，位移照樣累加；不清掉的話
   * 第一幀一次套上去，一進場就轉一個大彎。
   */
  it('載入中每一幀都丟掉滑鼠的準星位移', () => {
    const main = srcOf('main.ts')
    const frame = main.slice(main.indexOf('function frame(now: number)'))
    const at = frame.indexOf('if (loadingBattle) {')
    const branch = frame.slice(at, frame.indexOf('} else if (screen === \'battle\')', at))
    expect(branch).toContain('input.aimDeltaX = 0')
    expect(branch).toContain('input.aimDeltaY = 0')
  })

  /** 【頭尾各停一下】太快的載入一閃而過，看不出是載入 */
  it('開場預載先停在 0%、逐項回報、載完停在 100% 才收', () => {
    const main = srcOf('main.ts')
    const start = main.slice(main.indexOf('const initialRecoveryFailure'))
    for (const fn of ['preloadAircraftModels', 'preloadShipModels', 'preloadGroundModels']) {
      expect(start, fn).toContain(fn)
    }
    expect(start).toContain('loading.step(')
    expect(start.indexOf('loading.hold()')).toBeLessThan(start.indexOf('preloadAircraftModels'))
    expect(start.indexOf('loading.finish(')).toBeGreaterThan(start.indexOf('preloadGroundModels()'))
  })

  /**
   * 【進度跟著檔數走】三類預載都要把逐檔回報接上，總數也要把三類都算進去 ——
   * 漏接一類的話那一段進度條不動，漏算一類的話會衝過 100%（被夾住，停在滿格
   * 等剩下的檔）。
   */
  it('開場三類預載都接上逐檔回報，總數三類都算', () => {
    const main = srcOf('main.ts')
    const start = main.slice(main.indexOf('const initialRecoveryFailure'))
    expect(start).toContain('preloadAircraftModels(fileLoaded)')
    expect(start).toContain('preloadShipModels(shipIds, fileLoaded)')
    expect(start).toContain('preloadGroundModels(undefined, fileLoaded)')
    const total = start.slice(start.indexOf('const fileTotal'), start.indexOf('\n', start.indexOf('const fileTotal')))
    for (const part of ['AIRCRAFT_MODEL_COUNT', 'shipIds.length', 'groundModelUrls().length']) {
      expect(total, part).toContain(part)
    }
  })

  /**
   * 【佈景 GLB 進場才載】廠區 1.5 MB 只有洛伊納用得到，開場不能等它；而進場
   * 時少了這一步，那一關的地形組裝當場丟「還沒載入」。
   */
  it('開場不載佈景；進關卡在鋪地形之前先載', () => {
    const main = srcOf('main.ts')
    const start = main.slice(main.indexOf('const initialRecoveryFailure'))
    const startCode = start.slice(0, start.indexOf('requestAnimationFrame(frame)'))
    for (const fn of ['preloadPlantScenery(', 'preloadAirfieldScenery(', 'preloadTerrainScenery(']) {
      expect(startCode, fn).not.toContain(fn)
    }
    const head = 'async function loadBattle(): Promise<void> {'
    const from = main.indexOf(head)
    const body = main.slice(from + head.length, main.indexOf('\n}', from))
    expect(body).toContain('await preloadTerrainScenery(battleTerrainKind())')
    expect(body.indexOf('preloadTerrainScenery(')).toBeLessThan(body.indexOf('buildBattleTerrain()'))
  })

  it('進關卡同樣頭尾各停一下', () => {
    const main = srcOf('main.ts')
    const head = 'async function loadBattle(): Promise<void> {'
    const from = main.indexOf(head)
    const body = main.slice(from + head.length, main.indexOf('\n}', from))
    expect(body.indexOf('loading.hold()')).toBeGreaterThan(body.indexOf('loading.show('))
    expect(body.indexOf('loading.hold()')).toBeLessThan(body.indexOf('resetPools()'))
    expect(body).toContain('loading.finish(')
  })

  it('停留時間是 0.1 秒', () => {
    expect(LOADING_HOLD_SECONDS).toBeCloseTo(0.1, 9)
  })
})
