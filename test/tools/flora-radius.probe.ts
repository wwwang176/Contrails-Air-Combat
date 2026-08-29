/**
 * 把植被的維持半徑放大要付多少。不是測試。
 *
 * 生成只做一次（用最大的那個半徑，逐格快取），統計是純算術 —— 所以各半徑
 * 之間比得準。門檻按半徑等比縮放，不然放大半徑等於只是把最遠那一級拉長。
 *
 * 跑法：`node node_modules/vite-node/vite-node.mjs test/tools/flora-radius.probe.ts`
 */
import { createFarmland, outsideZero } from '../../src/world/farmland'
import {
  createFloraBuffer, farmHedgeFlora, farmVillageFlora, farmWoodFlora, FloraKind,
} from '../../src/render/flora'
import { lodFor, TILE_SIZE } from '../../src/render/vegetation'

const BUSH_RANGE = 900
const MAX_PER_TILE = 4096

const farm = createFarmland()
const solid = outsideZero(farm.field)
const heightAt = (x: number, z: number): number => solid.sample(x, z)
const sources = [farmHedgeFlora, farmWoodFlora, farmVillageFlora]

interface TileSum {
  broad: number
  cone: number
  bush: number
  build: number
}

const cache = new Map<number, TileSum>()
const buf = createFloraBuffer(MAX_PER_TILE)

function tileSum(i: number, j: number): TileSum {
  const key = i * 65536 + j
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  buf.count = 0
  buf.dropped = 0
  const x0 = i * TILE_SIZE
  const z0 = j * TILE_SIZE
  for (const s of sources) s(x0, z0, x0 + TILE_SIZE, z0 + TILE_SIZE, heightAt, buf)
  const t: TileSum = { broad: 0, cone: 0, bush: 0, build: 0 }
  for (let k = 0; k < buf.count; k++) {
    if (buf.kind[k] === FloraKind.BroadTree) t.broad++
    else if (buf.kind[k] === FloraKind.ConeTree) t.cone++
    else if (buf.kind[k] === FloraKind.Bush) t.bush++
    else t.build++
  }
  if (buf.dropped > 0) console.warn(`格 ${i},${j} 溢位 ${buf.dropped}`)
  cache.set(key, t)
  return t
}

/** 一條穿過全圖的航線 */
const POSITIONS: [number, number][] = []
for (let n = 0; n < 24; n++) {
  const t = n / 23
  POSITIONS.push([-11000 + t * 22000, -8000 + t * 16000])
}

interface Acc {
  broadL0: number
  coneL0: number
  broadMid: number
  coneMid: number
  broadFar: number
  coneFar: number
  bush: number
  build: number
  tiles: number
}

function zero(): Acc {
  return {
    broadL0: 0, coneL0: 0, broadMid: 0, coneMid: 0, broadFar: 0, coneFar: 0,
    bush: 0, build: 0, tiles: 0,
  }
}

/** 一株喬木的三角形數，分樹種分級 */
const TRI = {
  broadL0: 20, coneL0: 19, broadMid: 8, coneMid: 9, broadFar: 8, coneFar: 5,
  bush: 8, build: 18,
}

function scan(radius: number, bushRange: number): Acc {
  const max = zero()
  for (const [cx, cz] of POSITIONS) {
    const a = zero()
    const i0 = Math.floor((cx - radius) / TILE_SIZE)
    const i1 = Math.floor((cx + radius) / TILE_SIZE)
    const j0 = Math.floor((cz - radius) / TILE_SIZE)
    const j1 = Math.floor((cz + radius) / TILE_SIZE)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const tx = i * TILE_SIZE + TILE_SIZE / 2
        const tz = j * TILE_SIZE + TILE_SIZE / 2
        const d = Math.hypot(tx - cx, tz - cz)
        if (d > radius) continue
        a.tiles++
        const t = tileSum(i, j)
        const lod = lodFor((d * 2000) / radius, -1)
        if (lod === 0) { a.broadL0 += t.broad; a.coneL0 += t.cone }
        else if (lod === 1) { a.broadMid += t.broad; a.coneMid += t.cone }
        else { a.broadFar += t.broad; a.coneFar += t.cone }
        if (d <= bushRange) a.bush += t.bush
        a.build += t.build
      }
    }
    for (const k of Object.keys(max) as (keyof Acc)[]) if (a[k] > max[k]) max[k] = a[k]
  }
  return max
}

function tris(a: Acc): number {
  let n = 0
  for (const k of Object.keys(TRI) as (keyof typeof TRI)[]) n += a[k] * TRI[k]
  return n
}

console.log('\n  農地・24 個位置各取最大同時實例數・LOD 門檻隨半徑等比縮放')
console.log('  （灌木維持在 900 m）\n')
console.log('     R    格數   broadL0  coneL0  broadMid  coneMid  broadFar  coneFar    bush   建築   三角形')
for (const R of [2000, 2500, 3000, 3500, 4000]) {
  const a = scan(R, BUSH_RANGE)
  console.log(
    `  ${String(R).padStart(4)}   ${String(a.tiles).padStart(5)}`
    + `   ${String(a.broadL0).padStart(7)} ${String(a.coneL0).padStart(7)}`
    + `  ${String(a.broadMid).padStart(8)} ${String(a.coneMid).padStart(8)}`
    + `  ${String(a.broadFar).padStart(8)} ${String(a.coneFar).padStart(8)}`
    + `  ${String(a.bush).padStart(6)} ${String(a.build).padStart(6)}`
    + `   ${(tris(a) / 1000).toFixed(0).padStart(5)}k`)
}

console.log('\n  灌木視距（半徑固定 3,000）\n')
console.log('   灌木 R    bush 實例    三角形')
for (const B of [900, 1200, 1500, 2000]) {
  const a = scan(3000, B)
  console.log(`   ${String(B).padStart(6)}   ${String(a.bush).padStart(8)}   ${(tris(a) / 1000).toFixed(0).padStart(5)}k`)
}

// ── 兩級／分樹種 ────────────────────────────────────────────
// 近 450 m 帶樹幹，之外只有樹冠，而樹冠的形狀與顏色跟著樹種走。
// 門檻**不隨半徑縮放** —— 450 m 是「樹幹掉到 1 px 以下」的像素門檻，
// 與畫多遠無關。
const TWO = { broadNear: 20, coneNear: 19, broadFar: 8, coneFar: 6, bush: 8, build: 18 }

interface Acc2 {
  broadNear: number
  coneNear: number
  broadFar: number
  coneFar: number
  bush: number
  build: number
  tiles: number
  tris: number
}

function zero2(): Acc2 {
  return {
    broadNear: 0, coneNear: 0, broadFar: 0, coneFar: 0, bush: 0, build: 0, tiles: 0, tris: 0,
  }
}

function scan2(radius: number, bushRange: number, nearAt: number): Acc2 {
  const max = zero2()
  for (const [cx, cz] of POSITIONS) {
    const a = zero2()
    const i0 = Math.floor((cx - radius) / TILE_SIZE)
    const i1 = Math.floor((cx + radius) / TILE_SIZE)
    const j0 = Math.floor((cz - radius) / TILE_SIZE)
    const j1 = Math.floor((cz + radius) / TILE_SIZE)
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const tx = i * TILE_SIZE + TILE_SIZE / 2
        const tz = j * TILE_SIZE + TILE_SIZE / 2
        const d = Math.hypot(tx - cx, tz - cz)
        if (d > radius) continue
        a.tiles++
        const t = tileSum(i, j)
        if (d <= nearAt) { a.broadNear += t.broad; a.coneNear += t.cone }
        else { a.broadFar += t.broad; a.coneFar += t.cone }
        if (d <= bushRange) a.bush += t.bush
        a.build += t.build
      }
    }
    a.tris = 0
    for (const k of Object.keys(TWO) as (keyof typeof TWO)[]) a.tris += a[k] * TWO[k]
    for (const k of Object.keys(max) as (keyof typeof max)[]) if (a[k] > max[k]) max[k] = a[k]
  }
  return max
}

console.log('\n  兩級／分樹種（樹幹門檻固定 450 m，不隨半徑縮放）\n')
console.log('     R   灌木R    格數   broadNear coneNear   broadFar  coneFar     bush   三角形')
for (const [R, B] of [[2000, 900], [2500, 1100], [3000, 1200], [3000, 1500], [3500, 1200], [4000, 1200]] as const) {
  const a = scan2(R, B, 450)
  console.log(
    `  ${String(R).padStart(4)}   ${String(B).padStart(5)}   ${String(a.tiles).padStart(5)}`
    + `   ${String(a.broadNear).padStart(9)} ${String(a.coneNear).padStart(8)}`
    + `   ${String(a.broadFar).padStart(8)} ${String(a.coneFar).padStart(8)}`
    + `   ${String(a.bush).padStart(6)}   ${(a.tris / 1000).toFixed(0).padStart(5)}k`)
}
console.log('')

// ── 樹幹門檻掃描 ────────────────────────────────────────────
// 樹幹直徑 1 m。960 px／60° 下一公尺在 d 公尺外約占 917 / d 個像素 ——
// 900 m 正好是 1 px。150 m/s 的甲板速度下，門檻除以 150 就是「看得到樹幹
// 的秒數」。
console.log('\n  樹幹門檻掃描（R = 3,000、灌木 1,200）\n')
console.log('   門檻   樹幹 px   飛過秒數   broadNear coneNear   broadFar coneFar   三角形')
for (const N of [450, 700, 900, 1200]) {
  const a = scan2(3000, 1200, N)
  console.log(
    `  ${String(N).padStart(5)}   ${(917 / N).toFixed(2).padStart(6)}   ${(N / 150).toFixed(1).padStart(7)}`
    + `   ${String(a.broadNear).padStart(9)} ${String(a.coneNear).padStart(8)}`
    + `   ${String(a.broadFar).padStart(8)} ${String(a.coneFar).padStart(7)}`
    + `   ${(a.tris / 1000).toFixed(0).padStart(5)}k`)
}
console.log('')
