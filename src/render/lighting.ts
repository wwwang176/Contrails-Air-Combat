import { AmbientLight, DirectionalLight, HemisphereLight, type Object3D } from 'three'

/**
 * 場上的三盞燈。**`render/scene.ts` 與量測用的 e2e fixture 共用同一份。**
 *
 * 【為什麼要獨立成一個模組】遠處的植被走 `gl.POINTS`，而點吃不到光照 ——
 * 亮度是烘進頂點色的。那個係數只有在「與真正的光照下的樹冠比對」時才校得準；
 * fixture 若自己另外配一組燈，校出來的係數在遊戲裡就是錯的。
 *
 * 【開局後光照固定】沒有日夜循環，所以「烘一次」是成立的。
 */
export function createLights(): Object3D[] {
  const sun = new DirectionalLight(0xfff2e0, 2.2)
  sun.position.set(-0.4, 0.8, 0.45).normalize()
  return [
    sun,
    new HemisphereLight(0xbfd8ee, 0x2a3a48, 0.9),
    new AmbientLight(0xffffff, 0.15),
  ]
}
