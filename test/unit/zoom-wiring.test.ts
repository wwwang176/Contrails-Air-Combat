import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { zh as ZH } from '../../src/i18n/zh'
import { en as EN } from '../../src/i18n/en'

const read = (p: string): string => readFileSync(p, 'utf8').replace(/\r\n/g, '\n')

/**
 * 【按住 V 望遠的接線】望遠時飛機換低模的距離跟著倍率調，不然遠方的飛機放大了卻還是低模。
 * 觸控瞄準的位移不乘倍率：它照鏡頭 FOV 換算成角度，FOV 收窄就已經慢下來了
 */
describe('望遠的接線', () => {
  it('觸控瞄準的位移不另外乘倍率', () => {
    const t = read('src/input/touch.ts')
    expect(t).toContain('state.aimDeltaX += dx * TOUCH_AIM_SENSITIVITY\n')
    expect(t).toContain('state.aimDeltaY -= dy * TOUCH_AIM_SENSITIVITY\n')
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
