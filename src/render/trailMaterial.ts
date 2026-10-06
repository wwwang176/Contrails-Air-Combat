/** 凝結尾的顏色。近白、略帶天空的藍。 */
export const TRAIL_COLOR = 0xeef4f8

/**
 * 把 three 的 `MeshBasicMaterial` 著色器改造成**逐頂點 alpha**。
 *
 * 【為什麼非得動著色器】`BufferGeometry` 的頂點色只有 RGB 沒有 alpha，而
 * 這條管子的淡出必須逐節點（尾端淡、頭端濃）。
 *
 * 【為什麼抽成獨立的具名函式】`String.replace` 找不到目標時**不報錯**。
 * 抽出來之後可以拿 three 真正的 `ShaderLib.basic` 去斷言注入確實發生了 ——
 * 否則 three 改版重新命名 chunk，逐頂點 alpha 會靜靜地失效，管子變成一片
 * 不透明的白。與 `particles.ts` 的 `injectBillboard` 同一個理由。
 *
 * 【與 `injectBillboard` 不共用】那邊還要把四邊形在視圖空間攤平成廣告板，
 * 這邊不用 —— 管子是真的幾何。共用會是硬湊。
 */
export function injectVertexAlpha(
  shader: { vertexShader: string; fragmentShader: string },
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       varying float vAlpha;`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       #include <project_vertex>`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;`,
    )
    .replace(
      // 【接在 dithering 之後】霧在更前面（`fog_fragment`），所以霧先套 RGB、
      // 這裡再乘 alpha —— 順序正確。與 `injectBillboard` 挑同一個錨點。
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       gl_FragColor.a *= vAlpha;`,
    )
}
