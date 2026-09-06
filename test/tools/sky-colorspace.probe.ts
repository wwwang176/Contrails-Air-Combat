/**
 * 天空球缺少輸出色彩空間轉換，畫面上到底差多少。**不是測試**（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/sky-colorspace.probe.ts`
 *
 * 【要回答什麼】`sky.ts` 是自寫的 `ShaderMaterial`，直接寫 `gl_FragColor`，
 * 而 three **不會**替自寫的片段著色器呼叫 `linearToOutputTexel` —— 要著色器
 * 自己 `#include <colorspace_fragment>`。於是天空把線性值原樣寫進 sRGB 緩衝
 * 區，螢幕上比常數所表達的暗一大截。
 *
 * 海面走 `MeshStandardMaterial`，本來就有轉換，所以 `SEA_COLOR` 沒有這個問題
 * —— 這支順帶把那件事也算出來當對照。
 *
 * 處置是**補上轉換、常數不動**。理由與數字見
 * `docs/superpowers/plans/2026-08-10-ocean-glint.md`。
 */
import { Color, SRGBColorSpace } from 'three'

const L = (c: Color) => c.getHSL({ h: 0, s: 0, l: 0 }).l
const ZEN_OLD = 0x4d84b8
const HZ_OLD = 0xd6e9f4
const POW = 0.8

function sky(hzHex: number, zenHex: number, power: number, dirY: number): Color {
  const t = Math.pow(Math.min(Math.max(dirY * 0.5 + 0.5, 0), 1), power)
  return new Color().lerpColors(new Color(hzHex), new Color(zenHex), t)
}

/** three 的 Color(hex) 已經是線性工作空間；取回它在「未轉換輸出」下螢幕上的 sRGB code */
function screenCodeNow(hex: number): [number, number, number] {
  const c = new Color(hex) // 線性
  // 現況：著色器把線性值原樣寫進 sRGB 緩衝 → 螢幕 code 就是那個線性值
  return [c.r, c.g, c.b]
}

/**
 * 要在「有轉換」之下重現同一個螢幕外觀，新的線性值 = sRGBToLinear(舊的線性值)。
 *
 * 【它只保住端點，保不住整條漸層】decode 是非線性的、
 * 內插是線性的，兩者不可交換。所以換算過去之後 `t = 0` 與 `t = 1` 兩處的
 * 外觀確實不變，中間整段仍會偏移。「保持現在的畫面」這個說法過度承諾了。
 *
 * 也因為這樣，下面那張表的地平線 `0.314` 是**甲-1 之下 `fog.test.ts` 會看到
 * 的值**（`mix(decode(H), decode(Z), t)`），不是現在螢幕上的 `0.241`
 * （`decode(mix(H, Z, t))`）。兩條算式問的是不同的事，別把它當成殘留的錯誤。
 */
function preserveAppearance(hex: number): number {
  const c = new Color(hex)
  const out = new Color()
  // 把「現在的螢幕 code」當成 sRGB 再轉回線性
  out.setRGB(c.r, c.g, c.b, SRGBColorSpace)
  return out.getHex(SRGBColorSpace)
}

console.log('=== 現況（未轉換輸出）===')
for (const [name, hex] of [['SKY_HORIZON', HZ_OLD], ['SKY_ZENITH', ZEN_OLD]] as const) {
  const [r, g, b] = screenCodeNow(hex)
  console.log(`${name} 0x${hex.toString(16)}  線性值=(${r.toFixed(3)},${g.toFixed(3)},${b.toFixed(3)})`
    + `  → 螢幕上看起來像 sRGB #${[r, g, b].map(v => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`)
}

/**
 * 【內插與非線性轉換不可交換】
 *
 * 初版先對兩個端點各自 decode 再內插：mix(decode(H), decode(Z), t)。
 * 但著色器實際做的是**先在線性空間內插**，再把結果誤當成 sRGB code 輸出：
 * decode(mix(H, Z, t))。兩者不相等。
 *
 * 地平線因此不是 0.315 而是 **0.241**；天頂 t = 1 沒有內插，0.101 是對的。
 */
function screenLightnessNow(dirY: number): number {
  const mixed = sky(HZ_OLD, ZEN_OLD, POW, dirY) // 線性空間的內插結果
  const decoded = new Color()
  decoded.setRGB(mixed.r, mixed.g, mixed.b, SRGBColorSpace) // 當成 sRGB code 解回線性
  return L(decoded)
}

console.log('\n=== 螢幕上「實際」的明度（先內插、再誤當 sRGB 輸出）===')
console.log(`地平線 L = ${screenLightnessNow(0).toFixed(3)}`
  + `   天頂 L = ${screenLightnessNow(1).toFixed(3)}`)
console.log('對照：常數所表達的（fog.test.ts 斷言的）'
  + ` 地平線 ${L(sky(HZ_OLD, ZEN_OLD, POW, 0)).toFixed(3)}`
  + ` 天頂 ${L(sky(HZ_OLD, ZEN_OLD, POW, 1)).toFixed(3)}`)
console.log(`海色 L = 0.041（走 MeshStandardMaterial，本來就有轉換）`)
console.log(`→ 現況螢幕上的海天階差 = ${(screenLightnessNow(0) - 0.041).toFixed(3)}`
  + `，補 include 之後 = ${(L(sky(HZ_OLD, ZEN_OLD, POW, 0)) - 0.041).toFixed(3)}`)

console.log('\n=== 甲-1：修好管線並把兩個端點換算回現在的外觀（中間漸層仍會偏移）===')
const HZ_KEEP = preserveAppearance(HZ_OLD)
const ZEN_KEEP = preserveAppearance(ZEN_OLD)
console.log(`SKY_HORIZON 0x${HZ_OLD.toString(16)} → 0x${HZ_KEEP.toString(16).padStart(6, '0')}`)
console.log(`SKY_ZENITH  0x${ZEN_OLD.toString(16)} → 0x${ZEN_KEEP.toString(16).padStart(6, '0')}`)
console.log('fog.test.ts 的四條門檻（線性明度）：')
const rows: [string, number, number][] = [
  ['甲-1', HZ_KEEP, ZEN_KEEP],
  ['甲-2（常數不動，畫面變亮）', HZ_OLD, ZEN_OLD],
]
console.log('設定                        地平線L  天頂L  落差(>0.10)  地平線(>0.35)  天頂(>0.20)  常數餘裕(>0)')
for (const [name, hz, zen] of rows) {
  const l0 = L(sky(hz, zen, POW, 0))
  const l1 = L(sky(hz, zen, POW, 1))
  const margin = L(new Color(hz)) - 0.2 - l0
  console.log(`${name.padEnd(26)} ${l0.toFixed(3)}  ${l1.toFixed(3)}  ${(l0 - l1).toFixed(3).padStart(10)}`
    + `  ${(l0 > 0.35 ? '✓' : '✗').padStart(12)}  ${(l1 > 0.20 ? '✓' : '✗').padStart(10)}`
    + `  ${margin.toFixed(3).padStart(11)}`)
}

console.log('\n=== 海色 ===')
console.log(`SEA_COLOR 0x18344c → 保持外觀 0x${preserveAppearance(0x18344c).toString(16).padStart(6, '0')}`)
console.log('（海走 MeshStandardMaterial，本來就有轉換 —— 所以海色一個字都不用動）')
