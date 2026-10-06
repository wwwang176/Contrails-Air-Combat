/**
 * 把 three 的 `MeshBasicMaterial` 著色器改造成**廣告板 + 逐實例 alpha +
 * 軟邊圓形或貼圖**。
 *
 * 【為什麼非得動著色器】`InstancedMesh` 的逐實例顏色只有 RGB 沒有 alpha。
 * M7 兩次繞開這條限制（槍焰靠加法混合淡到黑、水柱靠幾何曲線），黑煙繞不
 * 開：加法混合對黑色無效（`dst + 0` 等於隱形），往黑淡在亮天空上方向是反
 * 的，而一團 9 m 的深色物體直接消失非常明顯（M8 spec §4.3）。
 *
 * 【軟邊圓形是預設，不是唯一】沒有貼圖時片段端一行 `smoothstep` 就得到一個
 * 軟邊圓 —— 曳光、水花、火花都夠用。給了 `alphaMap` 就換成貼圖的形狀，那時
 * `soft` 要關掉（見下）。
 *
 * 【為什麼抽成獨立的具名函式】`String.replace` 找不到目標時**不報錯**。
 * 抽出來之後可以拿 three 真正的 `ShaderLib.basic` 去斷言注入確實發生了 ——
 * 否則 three 改版重新命名 chunk，廣告板會靜靜地退化而沒有任何東西失敗。
 *
 * @param soft 片段端要不要自己裁成軟邊圓形。**用 `alphaMap` 時要關掉** ——
 *             貼圖本身已經有邊緣，兩層淡出疊起來會把煙縮成一個小核
 */
export function injectBillboard(
  shader: { vertexShader: string; fragmentShader: string },
  soft = true,
): void {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      `#include <common>
       attribute float aAlpha;
       attribute float aSpin;
       varying float vAlpha;
       varying vec2 vOffset;
       varying vec2 vSpunUv;`,
    )
    .replace(
      '#include <project_vertex>',
      `vAlpha = aAlpha;
       vOffset = position.xy;
       // 【逐顆轉貼圖】同一張圖、又都正對相機，不轉的話十幾顆疊起來看得出
       // 是同一個形狀重複。轉的是 UV 不是四邊形 —— 轉四邊形會連帶轉掉
       // 廣告板的軸，而那正是它「永遠正對相機」的來源。
       float sc = cos(aSpin);
       float ss = sin(aSpin);
       vec2 duv = uv - 0.5;
       vSpunUv = vec2(sc * duv.x - ss * duv.y, ss * duv.x + sc * duv.y) + 0.5;
       // 【廣告板】只取實例矩陣的平移與縮放，在視圖空間把四邊形攤平 ——
       // 於是它永遠正對相機，不論從哪個角度看都是一團。
       vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
       float instScale = length(instanceMatrix[0].xyz);
       mvPosition.xy += position.xy * instScale;
       gl_Position = projectionMatrix * mvPosition;`,
    )

  shader.fragmentShader = shader.fragmentShader
    .replace(
      '#include <common>',
      `#include <common>
       varying float vAlpha;
       varying vec2 vOffset;
       varying vec2 vSpunUv;`,
    )
    .replace(
      '#include <dithering_fragment>',
      soft
        ? `#include <dithering_fragment>
       // 軟邊圓形：四邊形的頂點在 [-0.5, 0.5]，所以半徑 0.5 是內接圓
       float rEdge = smoothstep(0.5, 0.25, length(vOffset));
       gl_FragColor.a *= vAlpha * rEdge;`
        : `#include <dithering_fragment>
       gl_FragColor.a *= vAlpha;`,
    )

  if (soft) return
  // 【three 自己的 alphaMap 取樣讀 `vAlphaMapUv`】那一份沒有轉過。同一件
  // 事改用 `vSpunUv`。
  //
  // 【轉出去的角落】貼圖的包裹模式是 ClampToEdge，而煙的貼圖四邊是黑的
  // （alpha 0），所以轉 45° 時角落取到的仍然是透明。
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <alphamap_fragment>',
    `#ifdef USE_ALPHAMAP
       diffuseColor.a *= texture2D( alphaMap, vSpunUv ).g;
     #endif`,
  )
}
