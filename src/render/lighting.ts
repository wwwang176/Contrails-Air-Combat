import { AmbientLight, DirectionalLight, HemisphereLight } from 'three'
import { DAY_PALETTES, type DayPalette } from './timeOfDay'

/**
 * 場上的三盞燈。**`render/scene.ts` 與量測用的 e2e fixture 共用同一份。**
 *
 * 【為什麼要獨立成一個模組】遠處的植被走 `gl.POINTS`，而點吃不到光照 ——
 * 亮度是烘進頂點色的。那個係數只有在「與真正的光照下的樹冠比對」時才校得準；
 * fixture 若自己另外配一組燈，校出來的係數在遊戲裡就是錯的。
 *
 * 【開局後光照固定】沒有日夜循環，所以「烘一次」是成立的。時段是**開局前**
 * 選的設定值，見 `timeOfDay.ts`。
 */
export interface Lights {
  readonly sun: DirectionalLight
  readonly hemi: HemisphereLight
  readonly ambient: AmbientLight
  /** 三盞燈，給 `scene.add` 用。 */
  readonly all: readonly [DirectionalLight, HemisphereLight, AmbientLight]
}

/** 預設是正午 —— 植被亮度的校正係數就是在那組燈下量的。 */
export function createLights(p: DayPalette = DAY_PALETTES.noon): Lights {
  const sun = new DirectionalLight()
  const hemi = new HemisphereLight()
  const ambient = new AmbientLight()
  const lights: Lights = { sun, hemi, ambient, all: [sun, hemi, ambient] }
  applyLightPalette(lights, p)
  return lights
}

/** 換時段。三盞燈一起換 —— 漏一盞就是「白天的環境光配黃昏的太陽」。 */
export function applyLightPalette(l: Lights, p: DayPalette): void {
  l.sun.color.setHex(p.sunColor)
  l.sun.intensity = p.sunIntensity
  // 【方向性光看的是 position 的方向，不是位置】正規化之後就是「指向光源」
  l.sun.position.set(p.sunDir[0], p.sunDir[1], p.sunDir[2]).normalize()
  l.hemi.color.setHex(p.hemiSky)
  l.hemi.groundColor.setHex(p.hemiGround)
  l.hemi.intensity = p.hemiIntensity
  l.ambient.color.setHex(p.ambientColor)
  l.ambient.intensity = p.ambientIntensity
}
