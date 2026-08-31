/**
 * 部位倍率的**可達性**量測。不是測試，不斷言任何事。
 *
 * 跑法：`npx vite-node test/tools/damage-parts.probe.ts`
 *
 * ── 為什麼要量這個 ──────────────────────────────────────────
 *
 * `PART_MULTIPLIER` 寫了五個值（座艙 2.5 一路到機翼 0.7），但那是**設計
 * 意圖**不是行為。真正決定一發子彈扣多少血的，是 `hitAircraft` 的規則：
 *
 *   一個物理步的線段，凡是**碰到**的盒都算，倍率取其中**最高**的那一個。
 *
 * 不是「最先進入的那個盒」。所以「座艙 2.5 拿不拿得到」跟座艙盒的正投影
 * 面積無關，跟「一條 3.7 m 的線段有多容易掃過座艙盒」有關 —— 迎頭打機首
 * 的那一發，線段從 z −2.94 走到 +0.76，正好切進座艙盒，於是整發算 2.5。
 *
 * 這一支就是把那條規則照著跑一遍：每個進場角度打一片平行彈幕，記錄每一
 * 發最後**實際**拿到哪一個倍率，換算成面積佔比與等效血量。
 *
 * 【步長為什麼是 887/240】`Projectiles` 一步走 muzzleVelocity × dt，
 * 而 dt 是模擬的固定步長 1/240 s。步的相位（切分平面落在機身哪裡）會影響
 * 結果，所以每條彈道掃 8 個相位再平均。
 */
import { Vector3 } from 'three'
import { PART_MULTIPLIER, segmentBox, type HitBox, type HitPart } from '../../src/world/hit'
import { P51D } from '../../src/specs/p51d'
import { BF109K4 } from '../../src/specs/bf109k4'
import { F6F5 } from '../../src/specs/f6f5'
import { HE111 } from '../../src/specs/he111'
import { B17G } from '../../src/specs/b17g'
import type { AircraftSpec } from '../../src/specs/types'

const DT = 1 / 240
const PHASES = 8
/** 彈幕的取樣間距，m。0.05 對機翼厚度（約 0.3 m）還有六格 */
const CELL = 0.05

/** 一發打在 (u, v) 的彈道，回傳實際拿到的部位；沒打中回 null。 */
function fire(
  boxes: readonly HitBox[], origin: Vector3, dir: Vector3, step: number, phase: number,
): HitPart | null {
  const a = new Vector3(), b = new Vector3()
  // 從包圍球外面起跑，往前走到穿出去為止
  for (let s = -30 + phase * step / PHASES; s < 30; s += step) {
    a.copy(origin).addScaledVector(dir, s)
    b.copy(origin).addScaledVector(dir, s + step)
    let best: HitPart | null = null
    let bestMul = -1
    for (const box of boxes) {
      if (segmentBox(a.x, a.y, a.z, b.x, b.y, b.z, box) < 0) continue
      const m = PART_MULTIPLIER[box.part]
      if (m > bestMul) { bestMul = m; best = box.part }
    }
    if (best !== null) return best
  }
  return null
}

interface Aspect { name: string; s: Vector3 }
const D = Math.PI / 180
const from = (azDeg: number, elDeg: number): Vector3 => {
  const az = azDeg * D, el = elDeg * D
  // az 0 = 正後方（機體 +Z）、90 = 右側、180 = 迎頭；el 正 = 高位
  return new Vector3(
    Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el),
  ).normalize()
}
const ASPECTS: readonly Aspect[] = [
  { name: '正後方', s: from(0, 0) },
  { name: '後上方 30°', s: from(0, 30) },
  { name: '後下方 30°', s: from(0, -30) },
  { name: '後方偏 30°', s: from(30, 0) },
  { name: '側方 90°', s: from(90, 0) },
  { name: '前方偏 30°', s: from(150, 0) },
  { name: '迎頭', s: from(180, 0) },
  { name: '正上方', s: from(0, 90) },
]

const PARTS: readonly HitPart[] = ['cockpit', 'engine', 'tail', 'fuselage', 'wingLeft', 'wingRight']
const f = (v: number, d = 1): string => v.toFixed(d)

function report(spec: AircraftSpec): void {
  const step = spec.battery.sight.muzzleVelocity * DT
  // 彈幕鋪在垂直於彈道的平面上，範圍取整機包圍球
  let r = 0
  for (const b of spec.hitBoxes) {
    r = Math.max(r, b.center.length() + b.half.length())
  }
  console.log(`\n══ ${spec.name}  hp ${spec.hp}  步長 ${f(step, 2)} m ═══════════════`)
  console.log('進場        ' + PARTS.map((p) => p.slice(0, 7).padStart(8)).join('')
    + '     面積   平均倍率  等效血量')
  for (const asp of ASPECTS) {
    const dir = asp.s.clone().multiplyScalar(-1)
    // 彈幕平面的兩軸
    const up = Math.abs(dir.y) > 0.9 ? new Vector3(0, 0, 1) : new Vector3(0, 1, 0)
    const ex = new Vector3().crossVectors(dir, up).normalize()
    const ey = new Vector3().crossVectors(ex, dir).normalize()
    const count = new Map<HitPart, number>()
    let shots = 0
    const o = new Vector3()
    for (let u = -r; u <= r; u += CELL) {
      for (let v = -r; v <= r; v += CELL) {
        o.copy(asp.s).multiplyScalar(0).addScaledVector(ex, u).addScaledVector(ey, v)
        for (let ph = 0; ph < PHASES; ph++) {
          const part = fire(spec.hitBoxes, o, dir, step, ph)
          if (part === null) continue
          count.set(part, (count.get(part) ?? 0) + 1)
          shots++
        }
      }
    }
    if (shots === 0) { console.log(`${asp.name.padEnd(12)} —— 打不到`); continue }
    const area = (shots / PHASES) * CELL * CELL
    let mul = 0
    for (const [p, n] of count) mul += PART_MULTIPLIER[p] * n / shots
    const cols = PARTS.map((p) => `${f(100 * (count.get(p) ?? 0) / shots, 0)}%`.padStart(8)).join('')
    console.log(`${asp.name.padEnd(12)}${cols}  ${f(area, 2).padStart(7)} m²`
      + `  ${f(mul, 3).padStart(7)}  ${f(spec.hp / mul, 0).padStart(7)}`)
  }
}

for (const s of [P51D, F6F5, BF109K4, HE111, B17G]) report(s)
