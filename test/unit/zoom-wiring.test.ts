import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { zh as ZH } from '../../src/i18n/zh'
import { en as EN } from '../../src/i18n/en'

const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/**
 * 【按住 V 望遠的接線】鏡頭吃按住的狀態；望遠時瞄準靈敏度與飛機換低模的距離跟著倍率調 ——
 * 不調的話畫面放大了、準星卻照原本的速度飄，遠方的飛機放大了卻還是低模
 */
describe('望遠的接線', () => {
  it('滑鼠與觸控的瞄準乘上 aimScale', () => {
    const b = read('src/input/bindings.ts')
    expect(b).toContain('state.aimDeltaX += (e.movementX / half) * MOUSE_SENSITIVITY * state.aimScale')
    expect(b).toContain('state.aimDeltaY -= (e.movementY / half) * MOUSE_SENSITIVITY * state.aimScale')
    const t = read('src/input/touch.ts')
    expect(t).toContain('state.aimDeltaX += dx * TOUCH_AIM_SENSITIVITY * state.aimScale')
    expect(t).toContain('state.aimDeltaY -= dy * TOUCH_AIM_SENSITIVITY * state.aimScale')
  })

  it('飛機換低模的距離跟著倍率拉遠', () => {
    const v = read('src/render/aircraftVisuals.ts')
    expect(v).toContain('v.far = useAircraftLod(v.position.distanceToSquared(cameraPosition) / (magnification * magnification), v.far)')
    expect(read('src/main.ts')).toContain('battle.cfg.liveries, wrecks, vortex, rig.magnification,')
  })

  it('機首視角拿掉了', () => {
    for (const p of ['src/camera/CameraRig.ts', 'src/main.ts', 'src/input/InputState.ts', 'src/input/actions.ts']) {
      expect(read(p), p).not.toContain('firstPersonOffset')
      expect(read(p), p).not.toContain("'first'")
    }
  })

  it('按鍵提示與觸控按鈕的字', () => {
    expect(ZH['hud.keys']).toContain('V 望遠')
    expect(ZH['touch.view']).toBe('望遠')
    expect(EN['hud.keys']).toContain('V Zoom')
    expect(EN['touch.view']).toBe('Zoom')
  })
})
