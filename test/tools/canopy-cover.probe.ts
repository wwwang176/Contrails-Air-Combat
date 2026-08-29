/**
 * 島上的樹冠覆蓋率。不是測試。
 *
 * 【它回答什麼】遠處把植被關掉之後，地應該是什麼顏色。答案是「地色與樹色
 * 按覆蓋率的面積平均」—— 不是隨手調的濃淡。
 */
import { createArchipelago, type IslandDesc } from '../../src/world/archipelago'
import { createFloraBuffer, createIslandFlora, FloraKind, FLORA_STRIDE } from '../../src/render/flora'
import { isGrass } from '../../src/render/island'

const CONE_R = 7      // 針葉的樹冠半徑，m —— floraShapes 的 CONE_CROWN_R
const BUSH_R = 6      // 灌木的半徑，m
const arch = createArchipelago()
const source = createIslandFlora(arch.field, arch.islands)
const height = (x: number, z: number): number => arch.field.sample(x, z)
const buf = createFloraBuffer(65536)
const big: IslandDesc = [...arch.islands].sort((a, b) => b.radius - a.radius)[0]!

/** 高度帶：0 = 山腳（t < 0.25）、1 = 中段、2 = 山頂（t ≥ 0.6） */
function band(h: number): number {
  const t = h / big.peak
  return t >= 0.6 ? 2 : t < 0.25 ? 0 : 1
}

const crown = [0, 0, 0]
const area = [0, 0, 0]
const r = big.outerRadius
const STEP = 20
for (let z = big.cz - r; z < big.cz + r; z += STEP) {
  for (let x = big.cx - r; x < big.cx + r; x += STEP) {
    const h = height(x, z)
    if (!isGrass(h)) continue
    area[band(h)]! += STEP * STEP
  }
}
buf.count = 0
buf.dropped = 0
source(big.cx - r, big.cz - r, big.cx + r, big.cz + r, height, buf)
for (let i = 0; i < buf.count; i++) {
  const o = i * FLORA_STRIDE
  const h = height(buf.data[o]!, buf.data[o + 2]!)
  const s = buf.data[o + 4]!
  const rad = (buf.kind[i] === FloraKind.Bush ? BUSH_R : CONE_R) * s
  crown[band(h)]! += Math.PI * rad * rad
}

console.log('  高度帶      可用面積      樹冠面積     覆蓋率')
const label = ['山腳', '中段', '山頂']
let ta = 0
let tc = 0
for (let b = 0; b < 3; b++) {
  ta += area[b]!
  tc += crown[b]!
  console.log(
    `  ${label[b]}    ${(area[b]! / 1e6).toFixed(2).padStart(8)} km²`
    + `  ${(crown[b]! / 1e6).toFixed(2).padStart(8)} km²`
    + `  ${((crown[b]! / area[b]!) * 100).toFixed(1).padStart(7)}%`,
  )
}
console.log(`  全島    ${(ta / 1e6).toFixed(2).padStart(8)} km²  ${(tc / 1e6).toFixed(2).padStart(8)} km²`
  + `  ${((tc / ta) * 100).toFixed(1).padStart(7)}%`)
