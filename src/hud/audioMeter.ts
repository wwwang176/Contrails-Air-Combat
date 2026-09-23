import {
  METER_FLOOR_DB, METER_SLOTS, METER_STEP, MeterHistory, meterFraction, type MeterSample,
} from '../audio/meter'
import { LIMITER_CEILING_DB } from '../audio/limiter'
import { HDR_KNEE_DB, HDR_MAX_DUCK_DB } from '../audio/dynamics'

/**
 * # 音訊錶
 *
 * 畫面左上角的疊圖：輸出峰值、限幅器壓了幾 dB、HDR 的窗口、同時發聲數，
 * 再加一條六秒的歷史曲線。**除錯用，預設關著**（`__audioMeter(true)`）。
 *
 * 【為什麼要它】限幅與 HDR 都是聽感的東西，而「聽起來怪」指不出是哪一層。
 * 看得到壓了幾 dB、頂到天花板沒有，才分得出「音量太熱」與「某一層壞了」。
 */

const WIDTH = 260
const HEIGHT = 164
/** 音訊時鐘落後超過這個毫秒數轉紅 —— 一塊緩衝以內的跳動是正常的 */
const LAG_WARN_MS = 30
/** 「近 1 秒」要回看幾格 */
const CUT_RING = Math.round(1 / METER_STEP)
const PAD = 8
/** 條的高度 */
const BAR = 12
/** 歷史曲線那一塊的高度 */
const GRAPH = 56

export interface AudioMeter {
  readonly canvas: HTMLCanvasElement
  /** 每幀一次。`dt` 是畫面時間，用來決定要不要推一格歷史 */
  draw(sample: MeterSample, dt: number): void
  reset(): void
}

/** dB → 顯示字串，正負號對齊 */
function db(v: number): string {
  return `${v >= 0 ? '+' : ''}${v.toFixed(1)}`
}

export function createAudioMeter(): AudioMeter {
  const canvas = document.createElement('canvas')
  canvas.id = 'audio-meter'
  canvas.width = WIDTH
  canvas.height = HEIGHT
  canvas.style.cssText = [
    // 【讓開左上角】那裡是 FPS 面板（`core/perf.ts`）
    'position:fixed', 'left:8px', 'top:72px', `width:${WIDTH}px`, `height:${HEIGHT}px`,
    'pointer-events:none', 'z-index:40', 'image-rendering:pixelated',
  ].join(';')
  const ctx = canvas.getContext('2d')!
  const history = new MeterHistory()
  let carry = 0
  /** 最近一秒每格的累計切斷數，`cutAt` 那一格是一秒前的 */
  const cutRing = new Float64Array(CUT_RING).fill(NaN)
  let cutAt = 0

  /** 一條左右滿版的水平條：`frac` 0…1，`warn` 為真時轉紅 */
  function bar(y: number, frac: number, warn: boolean, label: string, value: string): void {
    const w = WIDTH - PAD * 2
    ctx.fillStyle = '#1b1b1b'
    ctx.fillRect(PAD, y, w, BAR)
    ctx.fillStyle = warn ? '#e05545' : '#68c06a'
    ctx.fillRect(PAD, y, w * frac, BAR)
    ctx.fillStyle = '#d8d8d8'
    ctx.font = '10px monospace'
    ctx.textBaseline = 'middle'
    ctx.fillText(label, PAD + 3, y + BAR / 2)
    ctx.textAlign = 'right'
    ctx.fillText(value, WIDTH - PAD - 3, y + BAR / 2)
    ctx.textAlign = 'left'
  }

  /** 天花板那一條刻度線 */
  function tick(y: number, frac: number, color: string): void {
    const w = WIDTH - PAD * 2
    ctx.fillStyle = color
    ctx.fillRect(PAD + w * frac - 1, y - 2, 2, BAR + 4)
  }

  function draw(s: MeterSample, dt: number): void {
    carry += dt
    while (carry >= METER_STEP) {
      carry -= METER_STEP
      history.push(s.peakDb, s.reductionDb)
      cutRing[cutAt] = s.cuts
      cutAt = (cutAt + 1) % CUT_RING
    }

    ctx.clearRect(0, 0, WIDTH, HEIGHT)
    ctx.fillStyle = 'rgba(0,0,0,0.55)'
    ctx.fillRect(0, 0, WIDTH, HEIGHT)

    let y = PAD
    // 【輸出峰值】頂到天花板就轉紅 —— 那時限幅器已經在救
    bar(y, meterFraction(s.peakDb), s.peakDb > LIMITER_CEILING_DB + 0.5, '輸出', `${db(s.peakDb)} dB`)
    tick(y, meterFraction(LIMITER_CEILING_DB), '#e8c14a')
    y += BAR + 6

    // 【限幅器壓了幾 dB】0 = 沒在作用。壓超過 6 dB 就是音量太熱
    const red = -s.reductionDb
    bar(y, Math.min(1, red / 24), red > 6, '限幅', `−${red.toFixed(1)} dB`)
    y += BAR + 6

    // 【HDR 的窗口】最響值與不衰減區的下緣
    bar(y, meterFraction(s.loudestDb), false, 'HDR 最響', `${db(s.loudestDb)} dB`)
    tick(y, meterFraction(s.loudestDb - HDR_KNEE_DB), '#5aa9e6')
    y += BAR + 6

    ctx.fillStyle = '#d8d8d8'
    ctx.font = '10px monospace'
    ctx.fillText(`發聲 ${s.voices}　窗口下緣 ${db(s.loudestDb - HDR_KNEE_DB)}　最深 ${HDR_MAX_DUCK_DB} dB`, PAD, y + 5)
    y += 14
    // 【切斷與卡頓】兩者都是「啪」一聲而峰值不變，上面那三條看不到
    const ago = cutRing[cutAt]!
    const recentCuts = Number.isNaN(ago) ? 0 : s.cuts - ago
    ctx.fillStyle = recentCuts > 0 ? '#e05545' : '#d8d8d8'
    ctx.fillText(`切斷 ${s.cuts}（近 1 秒 ${recentCuts}）`, PAD, y + 5)
    ctx.fillStyle = s.lagMs > LAG_WARN_MS ? '#e05545' : '#d8d8d8'
    ctx.fillText(`落後 ${s.lagMs.toFixed(0)} ms`, PAD + 150, y + 5)
    y += 14

    // 歷史曲線：綠 = 輸出峰值、紅 = 限幅壓縮量
    const gx = PAD
    const gw = WIDTH - PAD * 2
    ctx.fillStyle = '#141414'
    ctx.fillRect(gx, y, gw, GRAPH)
    ctx.strokeStyle = '#e8c14a'
    ctx.globalAlpha = 0.5
    ctx.beginPath()
    const ceilY = y + GRAPH - GRAPH * meterFraction(LIMITER_CEILING_DB)
    ctx.moveTo(gx, ceilY)
    ctx.lineTo(gx + gw, ceilY)
    ctx.stroke()
    ctx.globalAlpha = 1
    for (const [color, arr, scale] of [
      ['#68c06a', history.peak, (v: number) => meterFraction(v)],
      ['#e05545', history.reduction, (v: number) => Math.min(1, -v / 24)],
    ] as const) {
      ctx.strokeStyle = color
      ctx.beginPath()
      for (let i = 0; i < history.count; i++) {
        const at = history.indexOf(i)
        if (at < 0) continue
        const px = gx + (gw * i) / (METER_SLOTS - 1)
        const py = y + GRAPH - GRAPH * scale(arr[at] ?? METER_FLOOR_DB)
        if (i === 0) ctx.moveTo(px, py)
        else ctx.lineTo(px, py)
      }
      ctx.stroke()
    }
  }

  return { canvas, draw, reset: () => { history.clear(); cutRing.fill(NaN); carry = 0 } }
}
