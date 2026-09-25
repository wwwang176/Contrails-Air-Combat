import { Vector3, type Camera } from 'three'
import type { Terrain } from '../render/terrain'

/**
 * # 測距（F4）：畫面中央瞄到的那一點有多遠、落在哪一圈
 *
 * 開發工具。畫面中央畫一個小十字，底下列出那一點的斜距、水平距離、高度差，
 * 以及樹、灌木、房子在那裡是哪一級、地面由哪一層畫（`Terrain.describeAt`）。
 * 用來對「模型換級、地面換層」的交界到底在畫面上哪裡。
 *
 * 【視線打地面用步進加二分】地形高度場沒有射線查詢；每 0.1 s 算一次，步長隨距離
 * 放大，最遠 `MAX_RANGE`。打不到地（看天）就只顯示方向
 */

/** 最遠量到多遠，m */
const MAX_RANGE = 80_000
/** 多久量一次，s */
const PERIOD = 0.1

export interface RangeProbe {
  /** 每幀叫；關著的時候什麼都不做 */
  update(camera: Camera, terrain: Terrain, time: number): void
}

export function createRangeProbe(): RangeProbe {
  const root = document.createElement('div')
  root.style.cssText = [
    'position:fixed', 'left:50%', 'top:50%', 'z-index:100', 'pointer-events:none', 'display:none',
  ].join(';')
  const cross = document.createElement('div')
  cross.style.cssText = [
    'position:absolute', 'left:-9px', 'top:-9px', 'width:18px', 'height:18px',
    'background:linear-gradient(#ffeb3b,#ffeb3b) center/2px 100% no-repeat,'
    + 'linear-gradient(#ffeb3b,#ffeb3b) center/100% 2px no-repeat',
  ].join(';')
  const text = document.createElement('div')
  text.style.cssText = [
    'position:absolute', 'left:14px', 'top:14px',
    'font:12px/1.5 ui-monospace,Consolas,monospace', 'color:#ffeb3b',
    'background:rgba(0,0,0,.6)', 'padding:6px 9px', 'border-radius:4px', 'white-space:pre',
  ].join(';')
  root.appendChild(cross)
  root.appendChild(text)
  document.body.appendChild(root)

  let visible = false
  let nextAt = 0
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'F4') return
    e.preventDefault()
    visible = !visible
    root.style.display = visible ? 'block' : 'none'
    nextAt = 0
  })

  const origin = new Vector3()
  const dir = new Vector3()
  /** 視線在 t 公尺處是不是已經在地面下 */
  const below = (terrain: Terrain, t: number, time: number): boolean =>
    origin.y + dir.y * t <= terrain.heightAt(origin.x + dir.x * t, origin.z + dir.z * t, time)

  return {
    update(camera, terrain, time) {
      if (!visible || time < nextAt) return
      nextAt = time + PERIOD
      camera.getWorldPosition(origin)
      camera.getWorldDirection(dir)
      let lo = 0
      let hi = -1
      let t = 1
      while (t < MAX_RANGE) {
        if (below(terrain, t, time)) { hi = t; break }
        lo = t
        t += Math.max(2, t * 0.01)
      }
      if (hi < 0) {
        text.textContent = `沒有打到地面（${MAX_RANGE / 1000} km 內）`
        return
      }
      for (let i = 0; i < 30; i++) {
        const mid = (lo + hi) / 2
        if (below(terrain, mid, time)) hi = mid
        else lo = mid
      }
      const x = origin.x + dir.x * hi
      const z = origin.z + dir.z * hi
      const y = origin.y + dir.y * hi
      const flat = Math.hypot(x - origin.x, z - origin.z)
      const m = (v: number): string => `${Math.round(v).toLocaleString()} m`
      text.textContent = [
        `斜距 ${m(hi)}   水平 ${m(flat)}   高度差 ${m(origin.y - y)}`,
        ...(terrain.describeAt?.(x, z) ?? ['這張地形沒有分圈資訊']),
      ].join('\n')
    },
  }
}
