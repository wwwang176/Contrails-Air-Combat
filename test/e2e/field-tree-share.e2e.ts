/**
 * **田色算式記的樹冠份量（`fieldTree`），在真的 GPU 上跑。**
 *
 * ```
 * node node_modules/vite-node/vite-node.mjs test/e2e/field-tree-share.e2e.ts
 * ```
 *
 * 地面拿 `fieldTree / lum(顏色)` 當樹冠的佔比，把那一份乘上視角係數（`viewShade.ts`）。
 * 份量漏記，遠處的林子就不隨視角變；多記（路、田還留著樹冠份量），作物田與凹路會
 * 跟著林子迎光變暗 —— 兩種都編得過、單元測試也碰不到 GPU。
 *
 * 由 CPU 那一份（`fieldAt`、`onTrack`）挑出樹林田、作物田、穿過樹林田的凹路各若干點，
 * 在 GPU 上算 `fieldColorAt`，讀回份量與亮度：
 *
 * - 遠處的樣子（`fieldFar = 1`）：樹林田的份量就是整格的亮度；作物田與凹路是 0
 * - 近處（`fieldFar = 0`）：樹林田也是 0 —— 那是真的樹底下的地
 *
 * 【變異驗證】拿掉 `fieldColorAt` 裡樹林田那一行的份量，或凹路那一行的衰減，必紅。
 */
import { chromium } from 'playwright'
import { fieldGlsl } from '../../src/render/fieldShaders'
import {
  fieldAt, HEDGE_WIDTH, isWoodField, onTrack, regionAt, trackGap, trackWidthAt,
  type FieldSample, type RegionSample,
} from '../../src/render/fields'

type Kind = 'wood' | 'crop' | 'trackInWood'

/** 每一種取幾點 */
const PER_KIND = 12
/** 每一點畫成幾個像素見方：要有導數，帶的抗鋸齒（`bandCoverage`）才不會除以 0 */
const BLOCK = 4

function pickPoints(): { x: number; z: number; kind: Kind }[] {
  const reg = { r1: 0, r2: 0, ax: 0, az: 0, bx: 0, bz: 0, id: 0, angle: 0, cellW: 0, cellH: 0, tone: 0 } as RegionSample
  const fld = { id: 0, edge: 0, hedged: false, cx: 0, cz: 0 } as FieldSample
  const out: { x: number; z: number; kind: Kind }[] = []
  const count = { wood: 0, crop: 0, trackInWood: 0 }
  for (let i = 0; i < 400000 && (count.wood < PER_KIND || count.crop < PER_KIND || count.trackInWood < PER_KIND); i++) {
    // 二維的低差異序列（R2）：不重複、均勻鋪開
    const x = ((0.5 + i * 0.7548776662) % 1) * 20000 - 10000
    const z = ((0.5 + i * 0.5698402910) % 1) * 20000 - 10000
    regionAt(x, z, reg)
    fieldAt(x, z, reg, fld)
    const wood = isWoodField(fld.id)
    const track = onTrack(x, z, reg)
    let kind: Kind | null = null
    // 離田界夠遠：樹籬（遠處放寬 2.5 倍）與抗鋸齒帶都碰不到
    if (!track && fld.edge > HEDGE_WIDTH * 2) kind = wood ? 'wood' : 'crop'
    // 凹路正中央（離中線不到兩成半寬）、四周是樹林田
    else if (track && wood && fld.edge > HEDGE_WIDTH * 2 && trackGap(x, z, reg) < 0.2 * trackWidthAt(x, z)) {
      kind = 'trackInWood'
    }
    if (kind === null || count[kind] >= PER_KIND) continue
    count[kind]++
    out.push({ x, z, kind })
  }
  return out
}

async function main(): Promise<void> {
  const pts = pickPoints()
  console.log(`  取了 ${pts.length} 點`)
  const browser = await chromium.launch({ headless: false })
  let allPass = true
  const ok = (name: string, pass: boolean, detail: string): void => {
    console.log(`  ${pass ? '通過' : '失敗'}  ${name.padEnd(28)} ${detail}`)
    if (!pass) allPass = false
  }
  try {
    const page = await browser.newPage()
    await page.goto('about:blank')
    for (const far of [1, 0]) {
      const res = await page.evaluate(({ src, pts, far, block }) => {
        const n = pts.length
        const canvas = document.createElement('canvas')
        canvas.width = n * block
        canvas.height = block
        const gl = canvas.getContext('webgl2')!
        const vs = gl.createShader(gl.VERTEX_SHADER)!
        gl.shaderSource(vs, '#version 300 es\nvoid main(){ vec2 p = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(p, 0.0, 1.0); }')
        gl.compileShader(vs)
        const fs = gl.createShader(gl.FRAGMENT_SHADER)!
        // 每一點一塊 BLOCK × BLOCK，塊裡一像素 1 m：導數是 1 m
        gl.shaderSource(fs, '#version 300 es\nprecision highp float;\nprecision highp int;\n' + src
          + `\nuniform vec2 uPts[${n}];\nuniform float uFar;\nout vec4 o;
void main(){
  int i = int(gl_FragCoord.x) / ${block};
  vec2 w = uPts[i] + gl_FragCoord.xy - vec2(float(i * ${block}) + ${block / 2}.0, ${block / 2}.0);
  fieldFar = uFar;
  vec3 c = fieldColorAt(w);
  o = vec4(fieldTree * 2.0, dot(c, FIELD_LUM) * 2.0, 0.0, 1.0);
}`)
        gl.compileShader(fs)
        if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) return { error: gl.getShaderInfoLog(fs) ?? '' }
        const prog = gl.createProgram()!
        gl.attachShader(prog, vs)
        gl.attachShader(prog, fs)
        gl.linkProgram(prog)
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return { error: gl.getProgramInfoLog(prog) ?? '' }
        gl.useProgram(prog)
        gl.uniform2fv(gl.getUniformLocation(prog, 'uPts'), new Float32Array(pts.flatMap((p) => [p.x, p.z])))
        gl.uniform1f(gl.getUniformLocation(prog, 'uFar'), far)
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.drawArrays(gl.TRIANGLES, 0, 3)
        const buf = new Uint8Array(canvas.width * canvas.height * 4)
        gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, buf)
        const row = block / 2
        return {
          error: '',
          vals: pts.map((_, i) => {
            const o = (row * canvas.width + i * block + block / 2) * 4
            return [buf[o]! / 255 / 2, buf[o + 1]! / 255 / 2]
          }),
        }
      }, { src: fieldGlsl('summer'), pts, far, block: BLOCK })
      if (res.error !== '') throw new Error(res.error)
      const vals = res.vals!
      const of = (k: Kind): number[][] => vals.filter((_, i) => pts[i]!.kind === k)
      // 8 位元、乘 2 再存：一階約 0.002
      const eps = 0.003
      if (far === 1) {
        const wood = of('wood')
        ok('遠處：樹林田的份量是整格的亮度', wood.every(([t, l]) => l! > 0.005 && Math.abs(t! - l!) < eps),
          wood.map(([t, l]) => `${t!.toFixed(3)}/${l!.toFixed(3)}`).slice(0, 4).join(' '))
        const crop = of('crop')
        ok('遠處：作物田沒有份量', crop.every(([t]) => t! < eps), crop.map(([t]) => t!.toFixed(3)).slice(0, 6).join(' '))
        // 【比平均不比逐點】凹路的寬度沿路起伏，CPU 挑的正中央在 GPU 上偶爾只蓋到九成；
        // 沒有衰減的話整組是樹林田的份量
        const track = of('trackInWood')
        const mean = (v: number[][]): number => v.reduce((s, [t]) => s + t!, 0) / Math.max(1, v.length)
        ok('遠處：樹林裡的凹路蓋掉份量', track.length > 0 && mean(track) < mean(wood) * 0.25,
          `凹路平均 ${mean(track).toFixed(4)}，樹林田平均 ${mean(wood).toFixed(4)}`)
      } else {
        const wood = of('wood')
        ok('近處：樹林田沒有份量（真的樹底下的地）', wood.every(([t]) => t! < eps),
          wood.map(([t]) => t!.toFixed(3)).slice(0, 6).join(' '))
      }
    }
  } finally {
    await browser.close()
  }
  console.log(allPass ? '\n  全部通過' : '\n  有項目失敗')
  if (!allPass) process.exitCode = 1
}

main().catch((e: unknown) => { console.error(e); process.exitCode = 1 })
