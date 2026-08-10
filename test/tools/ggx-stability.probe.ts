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
function textbook(nh: number, rough: number, f: (x: number) => number): number {
  const a = f(rough * rough), a2 = f(a * a)
  const d = f(f(nh * nh) * f(a2 - 1) + 1)
  return f(f(a2 * a2) / f(d * d))
}
function stable(nh: number, rough: number, f: (x: number) => number): number {
  const a = f(rough * rough), a2 = f(a * a)
  const nh2 = f(nh * nh)
  const d = f(f(a2 * nh2) + f(1 - nh2))
  return f(f(a2 * a2) / f(d * d))
}
const id = (x: number) => x
console.log('nh=1（峰值）：教科書形式 vs 穩定形式')
console.log('rough    double教科書      f32教科書       double穩定    f32穩定')
for (const r of [0.3, 0.1, 0.04, 0.02, 0.005, 1e-6]) {
  console.log(`${r.toString().padEnd(8)} ${textbook(1, r, id).toExponential(4).padStart(14)}`
    + ` ${textbook(1, r, f32).toExponential(4).padStart(14)}`
    + ` ${stable(1, r, id).toFixed(9).padStart(13)} ${stable(1, r, f32).toFixed(9).padStart(11)}`)
}
