import { RAD, clamp } from '../../core/math'
import { HUD_COLORS, hudFont, type HudFrame, type HudLayout } from '../types'

/**
 * 低於此效力轉為危險色。`(1 / 1.2)² = 0.694` —— 速度剛好掉到 1 G 失速
 * 速度的那一點。不是配出來的數字。
 */
const LOW_SPEED_DANGER = 1 / 1.44

/**
 * 能量戰教學元件：G、迎角、Ps、Es。
 *
 * Ps 正值代表能量累積、負值代表流失。大 G 轉彎時會跳到 −40 m/s 這種數字——
 * 這一個讀數就把能量戰講完了。玩家看得到，才學得會。
 */
export function drawEnergy(ctx: CanvasRenderingContext2D, L: HudLayout, f: HudFrame): void {
  const x = 30 * L.scale
  const y = L.height * 0.32
  const lh = 18 * L.scale
  ctx.font = hudFont(13 * L.scale)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'

  const rows: [string, string, string][] = [
    ['G', f.loadFactor.toFixed(2), Math.abs(f.loadFactor) > 6 ? HUD_COLORS.warn : HUD_COLORS.primary],
    ['AoA', `${(f.alpha * RAD).toFixed(1)}°`, HUD_COLORS.primary],
    ['Ps', `${f.ps >= 0 ? '+' : ''}${f.ps.toFixed(1)} m/s`, f.ps >= 0 ? HUD_COLORS.primary : HUD_COLORS.warn],
    ['Es', `${(f.es / 1000).toFixed(2)} km`, HUD_COLORS.primary],
  ]
  rows.forEach((r, i) => {
    ctx.fillStyle = HUD_COLORS.dim
    ctx.fillText(r[0], x, y + i * lh)
    ctx.fillStyle = r[2]
    ctx.fillText(r[1], x + 40 * L.scale, y + i * lh)
  })

  // 迎角條：接近臨界時進入紅區
  const barX = x
  const barY = y + rows.length * lh + 8 * L.scale
  const barW = 90 * L.scale
  const barH = 8 * L.scale
  const ratio = clamp(Math.abs(f.alpha) / f.alphaCrit, 0, 1.3)
  ctx.fillStyle = 'rgba(255,255,255,0.12)'
  ctx.fillRect(barX, barY, barW, barH)
  ctx.fillStyle = ratio > 0.95 ? HUD_COLORS.danger : ratio > 0.85 ? HUD_COLORS.warn : HUD_COLORS.primary
  ctx.fillRect(barX, barY, barW * Math.min(ratio, 1), barH)
  ctx.strokeStyle = HUD_COLORS.danger
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(barX + barW * 0.95, barY - 2 * L.scale)
  ctx.lineTo(barX + barW * 0.95, barY + barH + 2 * L.scale)
  ctx.stroke()

  // 油門與引擎輸出
  ctx.fillStyle = HUD_COLORS.dim
  ctx.textAlign = 'center'
  ctx.fillText(
    `THR ${(f.throttle * 100).toFixed(0)}%${f.throttle > 1 ? ' WEP' : ''}   ` +
    `${(f.powerW / 1000).toFixed(0)} kW   ${f.aircraftName}`,
    L.cx, L.height - 26 * L.scale,
  )

  // 失速警告
  if (ratio > 1) {
    ctx.fillStyle = HUD_COLORS.danger
    ctx.font = hudFont(22 * L.scale, true)
    ctx.fillText('STALL', L.cx, L.height * 0.24)
  }

  // 低速警告。
  // 【為什麼不沿用 STALL】STALL 以 |α|/α_crit 觸發，而垂直爬升時攻角接近
  // 0——它一次都不會亮，即使飛機正在變得不可控。語意也不同：你離失速很遠，
  // 你只是快沒速度了。把兩者混在同一個字樣下會讓玩家學到錯的因果。
  //
  // 位置 0.29 是刻意的：STALL 在 0.24、字級 22，本字級 18，兩者不重疊。
  // 兩個警告可以同時亮——它們是兩件不同的事。
  if (f.controlAuthority < 1) {
    ctx.fillStyle = f.controlAuthority < LOW_SPEED_DANGER
      ? HUD_COLORS.danger
      : HUD_COLORS.warn
    ctx.font = hudFont(18 * L.scale, true)
    ctx.textAlign = 'center'
    ctx.fillText('LOW SPEED', L.cx, L.height * 0.29)
  }
}
