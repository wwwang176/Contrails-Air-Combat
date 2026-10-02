import { Color, ShaderChunk, ShaderLib, UniformsLib } from 'three'

/**
 * # 戰場的高度霧
 *
 * 霧的密度隨高度指數下降（越低越濃），再乘上一個以戰場為中心的水平淡出與緩緩飄動的團塊。每個像素把
 * 「相機到這個像素」那一段視線上的密度**用公式一次積分**（不步進），所以只有一次指數運算的成本。
 *
 * 【為什麼放在材質的霧計算裡，不走後製】後製要深度貼圖，而主渲染平常是直接畫到畫面上、沒有深度貼圖；
 * 要做就得每幀走 `lowResTransparency` 那條離屏多重取樣、解析、複製的路。改 three 的霧 chunk，每個像素
 * 自己知道自己的世界位置，不需要深度貼圖，物體、地面、煙都吃同一套。
 *
 * 【怎麼讓所有材質看得到每幀會變的參數】兩份 uniform（`uBFA`、`uBFB`）是**純物件**，登記進
 * `ShaderLib` 每一個有霧的項目與 `UniformsLib.fog`。three 建 program 時 `UniformsUtils.clone`／`merge`
 * 只複製 Vector、Color、Matrix、Texture 這些有旗標的物件，純物件是同一個參考；上傳時 `{x,y,z,w}` 也認得。
 * 所以每幀改這兩個物件，全場材質同時看到。**一定要在第一次編譯任何著色器之前安裝**（`main.ts` 的
 * 第一個 import），之前編好的 program 與之前建好的自訂材質字典不會有它，而且不報錯，只是沒有霧。
 *
 * 【強度為 0 就整段略過】沒有這個 uniform 的材質（自訂字典沒帶它）讀到 0，也是略過。
 *
 * 【用 `fireFog` 換掉 `fog_fragment` 的著色器（火）不吃高度霧】火是自己發光的，合理。
 *
 * 純畫面。**全部數值是起始值，由試飛裁定。**
 */

/** 霧濃度為基準的高度（世界 y），m。庫斯克的草原在 0 附近，丘陵凸出霧之上 */
export const HEIGHT_FOG_BASE = 0

/** 密度每降到 1/e 的高度，m */
export const HEIGHT_FOG_SCALE_HEIGHT = 110

/** 基準高度的密度，1/m。從高處垂直往下看，穿過整層霧的光學厚度約是它乘尺度高度 */
export const HEIGHT_FOG_DENSITY = 0.0022

/** 水平淡出從半徑的幾成開始：內圈整片濃，往外到半徑為零 */
export const HEIGHT_FOG_EDGE_START = 0.3

/**
 * 水平遮罩取在視線上離像素多遠的地方，單位是尺度高度：視線大部分的光學厚度集中在像素那一端
 * （最低、密度最高），大約在像素往上一兩個尺度高度的那一點
 */
export const HEIGHT_FOG_SAMPLE = 1.5

/** 團塊的最淡倍率：濃度在這個值與 1 之間依團塊起伏 */
export const HEIGHT_FOG_BREAKUP = 0.2

/** 霧的顏色（灰黃的塵煙）。呼叫端混一點天色後給 `setBattleFog` */
export const HEIGHT_FOG_DUST = 0xbfae94

/** 團塊的飄動：風向（單位向量，世界 xz）與倍率（時間 × 倍率 = 相位）。風速另外由團塊的空間頻率決定 */
const CLOUD_SCALE = 1

/**
 * 兩份共用的 uniform，純物件。
 *   a = (圓心 x, 圓心 z, 半徑, 強度)，強度 0 = 關
 *   b = (霧色 r, g, b, 時間)
 */
export const BATTLE_FOG = {
  a: { x: 0, y: 0, z: 1, w: 0 },
  b: { x: 0, y: 0, z: 0, w: 0 },
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)))
  return t * t * (3 - 2 * t)
}

/** 離圓心 `d` 公尺的濃度倍率：內圈 1，到半徑為 0。著色器是同一個公式 */
export function battleFogEdge(d: number, radius: number): number {
  return 1 - smoothstep(radius * HEIGHT_FOG_EDGE_START, radius, d)
}

/**
 * 從相機（高度 `camY`）到像素（高度 `pY`）、視線長 `d` 的那一段，高度霧的光學厚度。
 *
 * 密度 ρ(y) = ρ0·exp(−(y − 基準)/H)，沿視線線性內插高度，所以
 * `τ = ρ0·d·exp(−(camY − 基準)/H)·(1 − exp(−k))/k`，`k = (pY − camY)/H`。
 * `k` 趨近 0（視線水平）時 `(1 − e^−k)/k → 1`，要取極限；指數夾在 ±30，極端高度不溢位。
 * 著色器是同一個公式。
 */
export function heightFogColumn(camY: number, pY: number, d: number): number {
  const H = HEIGHT_FOG_SCALE_HEIGHT
  const k = Math.min(30, Math.max(-30, (pY - camY) / H))
  const f = Math.abs(k) < 1.0e-3 ? 1.0 : (1.0 - Math.exp(-k)) / k
  const start = Math.min(30, Math.max(-30, (camY - HEIGHT_FOG_BASE) / H))
  return HEIGHT_FOG_DENSITY * d * Math.exp(-start) * f
}

/**
 * 水平遮罩與團塊取樣的位置：從像素往相機走視線的幾分之幾（0 = 像素、0.5 = 中點）。
 *
 * 從高處斜看遠處的地面，取樣點要在像素端附近 —— 取中點的話，圈外很遠的像素只因為視線飛越過戰場上方
 * 就被蓋上一層霧，整張畫面像蒙了灰。視線接近水平（相機也在霧裡）時整段都在霧裡，才取到中點。
 * 著色器是同一個公式。
 */
export function battleFogSampleT(camY: number, pY: number): number {
  return Math.min(0.5, (HEIGHT_FOG_SAMPLE * HEIGHT_FOG_SCALE_HEIGHT) / Math.max(Math.abs(pY - camY), 1))
}

export interface BattleFogSpec {
  /** 圓心（世界座標）與半徑，m */
  readonly x: number
  readonly z: number
  readonly radius: number
  /** 霧的顏色。呼叫端依天色與時段給 */
  readonly tint: Color
  /** 強度，預設 1。0 = 關（量測用的開關） */
  readonly strength?: number
}

/** 開一場的霧：寫進共用的 uniform，團塊的時間歸零 */
export function setBattleFog(spec: BattleFogSpec): void {
  BATTLE_FOG.a.x = spec.x
  BATTLE_FOG.a.y = spec.z
  BATTLE_FOG.a.z = spec.radius
  BATTLE_FOG.a.w = spec.strength ?? 1
  BATTLE_FOG.b.x = spec.tint.r
  BATTLE_FOG.b.y = spec.tint.g
  BATTLE_FOG.b.z = spec.tint.b
  BATTLE_FOG.b.w = 0
}

/** 關掉：強度歸零，著色器整段略過 */
export function clearBattleFog(): void {
  BATTLE_FOG.a.w = 0
}

/** 團塊順風飄 `dt` 秒。**世界秒數**，暫停時為 0 */
export function stepBattleFog(dt: number): void {
  BATTLE_FOG.b.w += dt * CLOUD_SCALE
}

/** 霧色：灰黃的塵煙混一點天空的霧色。純塵煙在清晨的藍天下髒得突兀，純天色又看不出是煙 */
export function battleFogTint(sky: Color): Color {
  return new Color(HEIGHT_FOG_DUST).lerp(sky, 0.4)
}

const f4 = (v: number): string => v.toFixed(4)

/** 片段端的宣告與函數：放進 `fog_pars_fragment` */
function fragmentPars(): string {
  return /* glsl */ `
	uniform vec4 uBFA;
	uniform vec4 uBFB;
	varying vec3 vFogRay;

	// 團塊：幾個不同方向與頻率的正弦相乘，緩緩飄動。0～1
	float battleFogCloud( vec2 p ) {
		float t = uBFB.w;
		float v = sin( p.x * 0.0021 + t * 0.07 ) * sin( p.y * 0.0017 - t * 0.05 )
			+ 0.6 * sin( ( p.x + p.y ) * 0.0043 + t * 0.11 ) * sin( ( p.x - p.y ) * 0.0037 - t * 0.09 );
		return smoothstep( -0.9, 0.9, v );
	}

	// 相機到這個像素的視線上，高度霧的光學厚度（公式見 heightFog.ts 的 heightFogColumn）
	float battleFogTau( vec3 cam, vec3 ray ) {
		float d = length( ray );
		vec3 p = cam + ray;
		float r = uBFA.z;
		// 遮罩與團塊取在視線上靠近像素的那一點（公式見 heightFog.ts 的 battleFogSampleT）
		float t = min( 0.5, ${f4(HEIGHT_FOG_SAMPLE * HEIGHT_FOG_SCALE_HEIGHT)} / max( abs( ray.y ), 1.0 ) );
		vec2 q = p.xz - ray.xz * t;
		float mask = 1.0 - smoothstep( r * ${f4(HEIGHT_FOG_EDGE_START)}, r, distance( q, uBFA.xy ) );
		float breakup = mix( ${f4(HEIGHT_FOG_BREAKUP)}, 1.0, battleFogCloud( q ) );
		float k = clamp( ( p.y - cam.y ) / ${f4(HEIGHT_FOG_SCALE_HEIGHT)}, -30.0, 30.0 );
		float f = abs(k) < 1.0e-3 ? 1.0 : (1.0 - exp(-k)) / k;
		float start = clamp( ( cam.y - ${f4(HEIGHT_FOG_BASE)} ) / ${f4(HEIGHT_FOG_SCALE_HEIGHT)}, -30.0, 30.0 );
		float tau = ${HEIGHT_FOG_DENSITY.toFixed(6)} * uBFA.w * d * exp( -start ) * f;
		return tau * mask * breakup;
	}
`
}

function patch(name: string, anchor: string, add: (original: string) => string): void {
  const chunks = ShaderChunk as unknown as Record<string, string>
  const original = chunks[name]
  // 找不到錨點就丟：那是 three 改了這個 chunk，不丟的話霧會靜靜地少一層
  if (original === undefined || !original.includes(anchor)) {
    throw new Error(`heightFog：three 的 ${name} 與預期不同，找不到「${anchor}」`)
  }
  chunks[name] = add(original)
}

/**
 * 把高度霧接進 three 的霧 chunk 與 uniform 表。**重複呼叫無效。**
 * 一定要在第一次編譯任何著色器之前呼叫。
 */
export function installHeightFog(): void {
  const chunks = ShaderChunk as unknown as Record<string, string>
  if (chunks['fog_pars_fragment']!.includes('uBFA')) return

  patch('fog_pars_vertex', 'varying float vFogDepth;', (s) =>
    s.replace('varying float vFogDepth;', 'varying float vFogDepth;\n\tvarying vec3 vFogRay;'))
  // `vFogRay` 是相機到這個頂點的向量，換成世界軸：視圖矩陣的旋轉部分是正交的，轉置就是反矩陣
  patch('fog_vertex', 'vFogDepth = - mvPosition.z;', (s) =>
    s.replace(
      'vFogDepth = - mvPosition.z;',
      'vFogDepth = - mvPosition.z;\n\tvFogRay = transpose(mat3(viewMatrix)) * mvPosition.xyz;',
    ))
  patch('fog_pars_fragment', 'varying float vFogDepth;', (s) =>
    s.replace('varying float vFogDepth;', `varying float vFogDepth;${fragmentPars()}`))
  patch('fog_fragment', 'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );', (s) =>
    s.replace(
      'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );',
      'gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );\n'
      + '\tif ( uBFA.w > 0.0 ) {\n'
      + '\t\tgl_FragColor.rgb = mix( gl_FragColor.rgb, uBFB.rgb, 1.0 - exp( - battleFogTau( cameraPosition, vFogRay ) ) );\n'
      + '\t}',
    ))

  // 純物件：clone／merge 不會複製它，所有材質共用同一個參考
  const entry = (value: object): { value: object } => ({ value })
  const libs = ShaderLib as unknown as Record<string, { uniforms: Record<string, unknown> }>
  for (const lib of Object.values(libs)) {
    if (lib.uniforms['fogColor'] === undefined) continue
    lib.uniforms['uBFA'] = entry(BATTLE_FOG.a)
    lib.uniforms['uBFB'] = entry(BATTLE_FOG.b)
  }
  const fog = (UniformsLib as unknown as Record<string, Record<string, unknown>>)['fog']!
  fog['uBFA'] = entry(BATTLE_FOG.a)
  fog['uBFB'] = entry(BATTLE_FOG.b)
}
