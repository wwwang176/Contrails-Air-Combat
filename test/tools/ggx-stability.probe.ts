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
 * 【結論】教科書式在 roughness 0.02 已經差 20%、0.005 直接 Infinity；
 * 穩定式全部剛好 1.000000000。這是 `GLINT_ROUGHNESS_FLOOR = 0.02` 與
 * 穩定寫法兩層保險的依據。
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
for (const r of [0.3, 0.1, 0.04, 0.02, 0.005, 1e-6]) {
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
