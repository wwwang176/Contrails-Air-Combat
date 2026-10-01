import { Vector3 } from 'three'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import { body, bodyUp, edit, rampedOffset, velocityAt, wreckAt, type Cut, type Path, type Shot } from './kit'

// ── 纏鬥 ───────────────────────────────────────────────────
//
// 正午、450 m。野馬左右急轉想甩掉咬在後面 0.75 秒的 109。三段連射都排在野馬
// 轉向換邊那一刻（航跡最直、瞄得最準）。
//   0–6    兩架的右後上方，109 咬在野馬後面
//   6–12   109 飛行員的肩後：地平線跟著機身歪，第一段連射打空
//   12–20  野馬正前方迎著拍：曳光從它身邊掠過、中彈冒煙、19 秒在鏡頭前爆開
//   20–32  鏡頭跟著殘骸一起往下掉，看它拖著火落海

const S1 = new Vector3()
const S2 = new Vector3()

const DOGFIGHT_ALT = 450
const DOGFIGHT_SPEED = 135
const WEAVE = 0.5
const LAG = 0.75
const KILL_AT = 19
const mustang: Path = (t, out) => out.set(
  130 * Math.sin(WEAVE * t),
  DOGFIGHT_ALT + 30 * Math.sin(0.3 * t + 1),
  -DOGFIGHT_SPEED * t,
)
const messerschmitt: Path = (t, out) => {
  mustang(t - LAG, out)
  // 【不能壓在野馬的航跡上】野馬中彈後拖的煙就鋪在那條線上，109 跟著鑽的話
  // 鏡頭從後面看過去是一整串貼臉的黑煙
  out.x += 8
  out.y += 12
  out.x += rampedOffset(t, KILL_AT + 1.3, 1.5, 14) - rampedOffset(t, KILL_AT + 4.5, 1.5, 14)
  out.y += rampedOffset(t, KILL_AT + 1.3, 1.5, 16) - rampedOffset(t, KILL_AT + 4.5, 1.5, 16)
  return out
}
const KILL_POS = mustang(KILL_AT, new Vector3())
const KILL_VEL = velocityAt(mustang, KILL_AT, new Vector3())

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 從兩架的右後上方：109 在近處、野馬在它前方，兩架排在同一條視線上。
      // 架在側面的話兩架橫著攤開，主角讓到右邊之後後面那一架會落到選單後面
      body(messerschmitt, t, 26, 13, 42, true, out.position)
      mustang(t, S1)
      messerschmitt(t, S2)
      out.target.copy(S1).lerp(S2, 0.3)
      out.fov = 46
    },
  },
  {
    from: 6, subject: 0, mount: 1,
    camera(t, out) {
      body(messerschmitt, t, 1.1, 2.0, 7, false, out.position)
      mustang(t, out.target)
      bodyUp(messerschmitt, t, out.up)
      out.fov = 40
    },
  },
  {
    from: 12, subject: 0,
    camera(t, out) {
      // 擊墜之後鏡頭照原速再飛 1 秒才切 —— 殘骸帶著 135 m/s 往鏡頭衝，鏡頭一停就穿過去
      body(mustang, Math.min(t, KILL_AT), -16, 5, -55 - DOGFIGHT_SPEED * Math.max(0, t - KILL_AT), true, out.position)
      mustang(Math.min(t, KILL_AT), out.target)
      if (t > KILL_AT) wreckAt(KILL_POS, KILL_VEL, t - KILL_AT, out.target)
      out.fov = 46
    },
  },
  {
    from: 20.2, subject: null,
    camera(t, out) {
      // 跟著殘骸一起往下掉，一直在它左後上方約 130 m；最後停在海面上看它落海。
      // 架在海面上仰拍的話，前幾秒殘骸還在 400 m 高，畫面只剩天空
      wreckAt(KILL_POS, KILL_VEL, t - KILL_AT, out.target)
      out.position.set(out.target.x - 110, Math.max(15, out.target.y + 35), out.target.z + 60)
      out.fov = 42
    },
  },
]

export const DOGFIGHT: Shot = {
  id: 'dogfight',
  duration: 32,
  timeOfDay: 'noon',
  captionKey: 'reel.dogfight',
  faceSun: false,
  clear: { x: 0, z: -2200, radius: 3000 },
  planes: [
    { spec: P51D, path: mustang },
    { spec: BF109K4, path: messerschmitt },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: [
    { at: 6.2, kind: 'burst', actor: 1, seconds: 0.8 },
    { at: 12.2, kind: 'burst', actor: 1, seconds: 0.8 },
    { at: 12.8, kind: 'smoke', actor: 0 },
    { at: 18.4, kind: 'burst', actor: 1, seconds: 0.7 },
    { at: KILL_AT, kind: 'kill', actor: 0, blast: true },
  ],
}
