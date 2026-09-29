import { ShaderChunk } from 'three'

/**
 * # 沒亮的點光源不算
 *
 * 爆炸的閃光（`blastLights.ts`）是開場就掛著的固定幾盞點光源，沒在用時強度 0 ——
 * 燈數一變，每一個受光材質都要重編著色器。而 three 的 `lights_fragment_begin` 對每一
 * 盞點光源都完整跑一次 `RE_Direct`，所以海、陸地、樹、飛機、船的每一個像素都在算
 * 幾盞熄著的燈。
 *
 * 【跳過的條件是 `directLight.visible`】`getPointLightInfo` 把「強度乘上距離衰減」
 * 寫進 `color`，並把 `visible` 設成 `color != 0`。燈熄著時整個畫面都跳過；亮著時也只有
 * 照射半徑（`PointLight.distance`）以內的像素付錢。
 *
 * 【畫面逐位元相同】跳過的那一項是 0 乘上一個有限的 BRDF（粗糙度有下限，分母有
 * `EPSILON`），加上去本來就不變。
 *
 * 【一定要在第一次編譯前裝】three 的程式快取不看 chunk 的內容，裝之前編好的程式
 * 不會重編。`createScene` 一開頭就裝。
 */

const CALL = 'RE_Direct( directLight, geometryPosition, geometryNormal, geometryViewDir, '
  + 'geometryClearcoatNormal, material, reflectedLight );'
const GUARDED = `if ( directLight.visible ) ${CALL}`

/**
 * 在點光源那一圈（`getPointLightInfo` 之後的第一個 `RE_Direct`）加上 visible 守衛。
 * 找不到就丟 —— three 升版改了 chunk 時，靜默失效的症狀只是「變慢」，沒有東西會紅
 */
export function skipDarkPointLights(chunk: string): string {
  const info = chunk.indexOf('getPointLightInfo(')
  if (info < 0) throw new Error('lightSkip：找不到 getPointLightInfo')
  const call = chunk.indexOf(CALL, info)
  const loopEnd = chunk.indexOf('#pragma unroll_loop_end', info)
  if (call < 0 || loopEnd < 0 || call > loopEnd) {
    throw new Error('lightSkip：點光源那一圈裡找不到 RE_Direct')
  }
  return chunk.slice(0, call) + GUARDED + chunk.slice(call + CALL.length)
}

/** 改寫 three 的 chunk。可以重複呼叫 */
export function installLightSkip(): void {
  if (ShaderChunk.lights_fragment_begin.includes(GUARDED)) return
  ShaderChunk.lights_fragment_begin = skipDarkPointLights(ShaderChunk.lights_fragment_begin)
}
