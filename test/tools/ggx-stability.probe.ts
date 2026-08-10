/**
 * GGX 的 `d` 兩種寫法在 float32 下的差異。**不是測試**（`.probe.ts`）。
 *
 * 跑法：`npx vite-node test/tools/ggx-stability.probe.ts`
 *
 * 【要回答什麼】Codex 2026-08-10 第二輪審查指出：歸一化的
 * `glintIntensity` 用教科書形式的
 *
 *     d = (n·h)²·(a² − 1) + 1
 *
 * 時，`a²` 遠小於 1 會發生災難性抵銷 —— float32 把 `a² − 1` 捨成 −1，於是
 * 峰值處 `d = 0`、回傳 `Infinity`。改成代數上等價、但沒有減法抵銷的
 *
 *     d = a²·(n·h)² + (1 − (n·h)²)
 *
 * 之後，峰值恆為 1。這支把兩者並排算出來 —— GLSL 那一份就是 float32。
 *
 * 【結論】教科書式在 roughness 0.02 已經差 20%、0.005 直接 Infinity；穩定式
 * 在**所有正常路徑會用到的粗糙度**上都剛好 1.000000000。
 *
 * 【但穩定式不是無條件的 —— Codex 第四輪審查】它有兩個仍然會壞的邊界，兩個
 * 都由 `glintFromNDotH` 的夾擋住，而下面的表把它們都印出來：
 *
 *   1. **下溢**：峰值處分子分母都是 `roughness⁸`，兩邊一起塌成 0 → `0/0 = NaN`。
 *      表格最後一列 `roughness = 1e-6` 印出的就是 `NaN` —— 這才是
 *      `GLINT_ROUGHNESS_FLOOR` 真正擋的東西（不是 1.0 附近的抵銷）。
 *
 *      【界線有兩條，別混為一談 —— Codex 第五輪審查】float32 的最小正規數
 *      1.18e-38 的八次方根是 **1.8146e-5**；最小次正規數 1.40e-45 的八次方根
 *      是 **2.4735e-6**。次正規數仍可表示，所以實測 `roughness = 2.5e-6` 峰值
 *      還是 1，`2e-6` 才真的 NaN。文件用 1.8146e-5 當界線是因為 **GPU 可以
 *      合法地 flush 次正規數**，不是因為低於它就一定歸零。
 *   2. **`n·h` 略大於 1**：兩個 float32 正規化向量的內積可以是 `1 + 2⁻²³`，
 *      此時回傳值會**超過 1**（roughness 0.04 → 1.10、0.02 → 15.39）。
 */
const f32 = (x: number) => Math.fround(x)
/** α = roughness²（GGX / three 的慣例）。教科書形式的分母，會抵銷 */
function textbook(nh: number, rough: number, f: (x: number) => number): number {
  const a2 = f(f(rough * rough) * f(rough * rough))
  const d = f(f(nh * nh) * f(a2 - 1) + 1)
  return f(f(a2 * a2) / f(d * d))
}
/** 同一條公式的穩定寫法：d = α²·(n·h)² + (1 − (n·h)²) */
function stable(nh: number, rough: number, f: (x: number) => number): number {
  const a2 = f(f(rough * rough) * f(rough * rough))
  const nh2 = f(nh * nh)
  const d = f(f(a2 * nh2) + f(1 - nh2))
  return f(f(a2 * a2) / f(d * d))
}
/** 【曾經寫錯的那一版】把 α 當成 roughness 本身 —— 峰值一樣是 1，寬度差很多 */
function wrongAlpha(nh: number, rough: number, f: (x: number) => number): number {
  const a2 = f(rough * rough)
  const nh2 = f(nh * nh)
  const d = f(f(a2 * nh2) + f(1 - nh2))
  return f(f(a2 * a2) / f(d * d))
}
const id = (x: number) => x
console.log('=== nh=1（峰值）：教科書形式 vs 穩定形式，α = roughness² ===')
console.log('rough    double教科書      f32教科書       double穩定    f32穩定')
for (const r of [0.3, 0.1, 0.04, 0.02, 0.005, 1e-5, 2.5e-6, 2e-6, 1e-6]) {
  console.log(`${r.toString().padEnd(8)} ${textbook(1, r, id).toExponential(4).padStart(14)}`
    + ` ${textbook(1, r, f32).toExponential(4).padStart(14)}`
    + ` ${stable(1, r, id).toFixed(9).padStart(13)} ${stable(1, r, f32).toFixed(9).padStart(11)}`)
}

/**
 * 【α 的慣例弄錯會怎樣】兩者峰值都是 1，所以「峰值恆為 1」那條測試分不出來
 * —— 這正是 Codex 第三輪指出的假綠。差別全在**離峰的寬度**。
 */
console.log('\n=== 離峰寬度：α = roughness²（對） vs α = roughness（錯） ===')
console.log('偏離峰值的 n·h    rough=0.04            rough=0.20')
console.log('                對         錯        對         錯')
for (const nh of [1, 0.9999, 0.999, 0.99, 0.95]) {
  console.log(`${nh.toFixed(4).padStart(10)}  ${stable(nh, 0.04, id).toExponential(2).padStart(9)}`
    + ` ${wrongAlpha(nh, 0.04, id).toExponential(2).padStart(9)}`
    + ` ${stable(nh, 0.20, id).toExponential(2).padStart(9)}`
    + ` ${wrongAlpha(nh, 0.20, id).toExponential(2).padStart(9)}`)
}
/** 離峰 25° 的錨點 —— `ocean-shading.test.ts` 用來把 α 慣例釘死的那兩個數 */
const NH_25 = Math.cos((12.5 * Math.PI) / 180) // 視線偏 25° → 半向量偏 12.5°
console.log('\n偏離峰值 25°（n·h = cos 12.5°）—— 測試的錨點值：')
for (const r of [0.2, 0.04]) {
  console.log(`  rough=${r.toString().padEnd(5)} 對 ${stable(NH_25, r, id).toExponential(11)}`
    + `   錯 ${wrongAlpha(NH_25, r, id).toExponential(11)}`
    + `   倍率 ${(wrongAlpha(NH_25, r, id) / stable(NH_25, r, id)).toExponential(2)}`)
}

/**
 * 【`n·h` 超過 1 —— Codex 第四輪審查的 Important】上面全部假設 `n·h ≤ 1`。
 * 但 GLSL 的 `dot` 吃的是兩個 float32 正規化向量，結果可以是 `1 + 2⁻²³`。
 * 穩定式在那裡不會 Infinity，卻會**悄悄超過 1**，違反「歸一化、峰值恆為 1」
 * 這個宣告 —— `GLINT_STRENGTH` 也就不再是亮度上限。
 *
 * three 自己的 `BRDF_GGX` 是先 `saturate(dot(normal, halfDir))` 才平方；
 * `glintFromNDotH` 與 `glintGLSL` 現在跟它一致。
 */
console.log('\n=== n·h 略大於 1 時（float32 的 dot 真的會這樣）===')
const OVER = Math.sqrt(1 + Math.pow(2, -23)) // 讓 nh² 恰好是 1 + 2⁻²³
console.log('rough      不夾（壞）        夾成 [0,1]（現在的寫法）')
for (const r of [0.2, 0.04, 0.02]) {
  const clamped = Math.min(Math.max(OVER, 0), 1)
  console.log(`${r.toString().padEnd(10)} ${stable(OVER, r, id).toFixed(5).padStart(10)}`
    + ` ${stable(clamped, r, id).toFixed(9).padStart(22)}`)
}
