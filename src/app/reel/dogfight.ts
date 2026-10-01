import { Vector3 } from 'three'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import {
  body, bodyUp, edit, rampedOffset, timeline, velocityAt, wreckAt, type Cut, type Path, type Shot,
} from './kit'

// ── 纏鬥 ───────────────────────────────────────────────────
//
// 正午、北海上空 430 m。野馬（#0）左右急轉想甩掉咬在後面的 109 長機（#1），
// 109 僚機（#2）在長機左上方。另一架野馬（#3）從 650 m 高空俯衝下來，
// 太晚了 —— 野馬中彈爆炸，它打下 109 僚機報仇。四周還有三組在互咬、兩架冒煙往下掉。
//   0–2.8    109 長機右後上方：三架排在同一條視線上，遠處別組在打
//   2.8–5.3  掛在野馬座艙右後方回看：機身與垂尾在前景，後面 109 長機與僚機咬著
//   5.3–7.8  109 長機的肩後：地平線跟著機身歪，第一段連射打空
//   7.8–10.2 野馬正前方迎著拍：它壓坡度急轉，曳光從鏡頭旁掠過
//   10.2–12.6 高空的野馬（#3）垂尾後上方：它壓坡度往下衝，底下遠處是纏鬥
//   12.6–15  109 長機機腹下往前看：螺旋槳壓在上緣，曳光打進野馬，它開始冒煙
//   15–17.3  野馬右前側方 15 m：拖著黑煙急轉，後方 109 的曳光掃過
//   17.3–19.8 野馬左前方回看：17.6 秒空中爆開，109 穿過火團拉起
//   19.8–22.3 俯衝的野馬（#3）左後上方跟拍：它咬住 109 僚機，21.4 秒開火
//   22.3–24.6 109 僚機右前方回看：中彈冒煙，24 秒爆開
//   24.6–28  殘骸旁跟著一起往下掉，海面越來越近
//   28–32    海面上 8 m：殘骸落海、水柱

const S1 = new Vector3()
const S2 = new Vector3()

const ALT = 430
const SPEED = 135
const WEAVE = 0.5
/** 109 長機落後野馬幾秒（約 60 m） */
const LAG = 0.45
const KILL_AT = 17.6
const WING_KILL = 24
/** 野馬（#3）俯衝的起點與長度，秒 */
const DIVE_FROM = 6
const DIVE_LEN = 16

/** 戰場中心：主線那一組的平均位置。背景的幾組圍著它打，鏡頭轉到哪都看得到 */
const centre: Path = (t, out) => out.set(0, ALT, -SPEED * t)

/** 0→1 的 smootherstep：一階、二階導數兩端都是 0 —— 俯衝的推桿與改平才不會一幀翻轉 */
function smoother(u: number): number {
  const v = u < 0 ? 0 : u > 1 ? 1 : u
  return v * v * v * (v * (6 * v - 15) + 10)
}

/**
 * 從 `t0` 起偏開一段再穩住：先 `a` 再 −`a` 各 `span` 秒，之後速度回到原來，
 * 總共偏開約 `a·span²` m。
 *
 * 【加減各一次不夠】`rampedOffset(t0) − rampedOffset(t1)` 停的是加速度，不是速度 ——
 * 之後會一直以 `a·span` 的速度往同一邊飄，拉起就變成一路爬到一千多公尺
 */
function pullOut(t: number, t0: number, span: number, a: number): number {
  return rampedOffset(t, t0, 1.2, a) - 2 * rampedOffset(t, t0 + span, 1.2, a) + rampedOffset(t, t0 + 2 * span, 1.2, a)
}

const mustang: Path = (t, out) => out.set(
  130 * Math.sin(WEAVE * t),
  ALT + 30 * Math.sin(0.3 * t + 1),
  -SPEED * t,
)
const messerschmitt: Path = (t, out) => {
  mustang(t - LAG, out)
  // 【不能壓在野馬的航跡上】野馬中彈後拖的煙就鋪在那條線上，109 跟著鑽的話
  // 從後面看過去是一整串貼臉的黑煙。擊墜之後往右上拉，避開爆炸的火團
  out.x += 8 + pullOut(t, KILL_AT + 1.3, 3.2, 7)
  out.y += 12 + pullOut(t, KILL_AT + 1.3, 3.2, 8)
  return out
}
/** 109 僚機：長機左上方，晚 0.45 秒走同一條航跡 */
const wing109: Path = (t, out) => {
  messerschmitt(t - 0.45, out)
  out.x -= 38
  out.y += 22
  return out
}
/**
 * 野馬（#3）：從僚機後上方 200 m、後方 440 m 俯衝下來，22 秒咬在它後方 80 m。
 *
 * 【俯衝的垂直加速度要小於 1 g】推桿的向下加速度超過重力時升力方向翻到機腹，
 * `flightPose` 會讓它在一幀裡翻成倒飛。200 m 分 16 秒，最大約 0.46 g
 */
const rescuer: Path = (t, out) => {
  wing109(t - 0.6, out)
  const k = 1 - smoother((t - DIVE_FROM) / DIVE_LEN)
  // 打下僚機之後往右上拉，不鑽進爆炸的火團
  out.x += 6 + 70 * k + pullOut(t, WING_KILL - 0.3, 2.5, 4)
  out.y += 8 + 200 * k + pullOut(t, WING_KILL - 0.3, 2.5, 10)
  out.z += 360 * k
  return out
}

// ── 背景 ──

/**
 * 圍著戰場中心兜圈的一架：相對中心走一個橢圓，加上前進就是一條左右擺的航跡。
 * `rz·w` 要小於 SPEED，不然會在某一段往後飛
 */
const circler = (
  cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, w: number, phase: number,
): Path => (t, out) => {
  centre(t, out)
  out.x += cx + rx * Math.sin(w * t + phase)
  out.y += cy + ry * Math.sin(0.6 * w * t + phase)
  out.z += cz + rz * Math.cos(w * t + phase)
  return out
}
/** 咬在 `target` 後面 `lag` 秒、偏開一點的追擊者 */
const chaser = (target: Path, lag: number, dx: number, dy: number): Path => (t, out) => {
  target(t - lag, out)
  out.x += dx
  out.y += dy
  return out
}

// A 組：右前下方，野馬（#4）追 109（#5）。109 後段中彈冒煙
const bgA109 = circler(260, -110, -420, 200, 40, 180, 0.45, 0)
// B 組：後上方，109（#6）追野馬（#7）。野馬 12.6 秒中彈、拖著煙往下掉
const bgBBase = circler(-120, 90, 380, 220, 50, 200, 0.4, 2)
const B_HIT = 12.6
const B_DOWN = 20.5
const bgBMustang: Path = (t, out) => {
  bgBBase(t, out)
  out.y -= rampedOffset(t, B_HIT + 0.4, 2, 6)
  return out
}
// C 組：前上方由右往左斜穿過去，野馬（#9）追 109（#10）
const bgC109: Path = (t, out) => out.set(
  650 - 70 * t,
  ALT + 120 + 15 * Math.sin(0.5 * t),
  -SPEED * t - 600 + 120 * Math.sin(0.3 * t),
)
/** 開場就拖著煙往下掉的 109（#8），右前方遠處 */
const FALL_DOWN = 7.5
const faller: Path = (t, out) => out.set(
  420 + 10 * t,
  ALT + 140 - 10 * t - 2.5 * t * t,
  -SPEED * t - 700 + 30 * t,
)

const KILL_POS = mustang(KILL_AT, new Vector3())
const KILL_VEL = velocityAt(mustang, KILL_AT, new Vector3())
const WING_POS = wing109(WING_KILL, new Vector3())
const WING_VEL = velocityAt(wing109, WING_KILL, new Vector3())

/** 野馬殘骸落海那一刻，擊墜後幾秒 */
const SPLASH_TAU = (() => {
  const p = new Vector3()
  let lo = 0
  let hi = 30
  for (let k = 0; k < 40; k++) {
    const mid = (lo + hi) / 2
    if (wreckAt(KILL_POS, KILL_VEL, mid, p).y > 0) lo = mid
    else hi = mid
  }
  return hi
})()
const SPLASH_POS = wreckAt(KILL_POS, KILL_VEL, SPLASH_TAU, new Vector3())

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      // 從 109 長機右後上方：109 在近處、野馬在它前方，兩架排在同一條視線上。
      // 架在側面的話兩架橫著攤開，主角讓到右邊之後後面那一架會落到選單後面
      body(messerschmitt, t, 22, 10, 36 - 2 * t, true, out.position)
      mustang(t, S1)
      messerschmitt(t, S2)
      out.target.copy(S1).lerp(S2, 0.3)
      out.fov = 46
    },
  },
  {
    from: 2.8, subject: 1, mount: 0,
    camera(t, out) {
      // 野馬座艙右後方，回頭看：機身與垂尾在右邊前景，後面是咬著的 109
      body(mustang, t, 1.5, 1.5, -1.4, false, out.position)
      body(mustang, t, 0, 0.9, 1.3, false, S1)
      messerschmitt(t, out.target)
      out.target.lerp(S1, 0.12)
      bodyUp(mustang, t, out.up)
      out.fov = 55
    },
  },
  {
    from: 5.3, subject: 0, mount: 1,
    camera(t, out) {
      body(messerschmitt, t, 1.0, 1.75, 3.6, false, out.position)
      mustang(t, out.target)
      bodyUp(messerschmitt, t, out.up)
      out.fov = 42
    },
  },
  {
    from: 7.8, subject: 0,
    camera(t, out) {
      // 鏡頭沿著野馬自己的航跡飛在它前方，距離從約 60 m 收到 25 m：
      // 它朝鏡頭急轉，後面 109 的曳光順著同一條線掠過鏡頭
      mustang(t + 0.45 - 0.11 * (t - 7.8), out.position)
      out.position.x -= 10
      out.position.y += 3
      mustang(t, out.target)
      out.fov = 44
    },
  },
  {
    from: 10.2, subject: 3, mount: 3,
    camera(t, out) {
      // 高空野馬的垂尾後上方：座艙與機鼻在前景，越過機鼻往下看得到纏鬥
      body(rescuer, t, 1.2, 3.0, 11, false, out.position)
      wing109(t, out.target)
      bodyUp(rescuer, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 12.6, subject: 0, mount: 1,
    camera(t, out) {
      // 機腹下、翼根之間往前看：機鼻與螺旋槳盤壓在畫面上緣，野馬在前下方。
      // 視線沿機身軸往上抬約 5°，機鼻才進得了畫面
      body(messerschmitt, t, 0, -1.3, 0.5, false, out.position)
      body(messerschmitt, t, 0, 4, -60, false, out.target)
      bodyUp(messerschmitt, t, out.up)
      out.fov = 52
    },
  },
  {
    from: 15, subject: 0,
    camera(t, out) {
      // 右前側方 15 m：機首朝畫面右，黑煙往左後方拖出去，後方 109 的曳光從它身邊掃過。
      // 架在後方的話煙一出來就流到鏡頭後面，畫面上看不到它在冒煙
      body(mustang, t, 12.5, 3, -8, true, out.position)
      body(mustang, t, 0, 0, 1, true, out.target)
      out.fov = 46
    },
  },
  {
    from: 17.3, subject: 0,
    camera(t, out) {
      // 擊墜之後鏡頭照原速再往前飛 —— 殘骸帶著 135 m/s 往鏡頭衝，鏡頭一停就穿過去
      body(mustang, Math.min(t, KILL_AT), -12, 3, -36 - SPEED * Math.max(0, t - KILL_AT), true, out.position)
      mustang(Math.min(t, KILL_AT), out.target)
      if (t > KILL_AT) wreckAt(KILL_POS, KILL_VEL, t - KILL_AT, out.target)
      out.fov = 46
    },
  },
  {
    from: 19.8, subject: 3,
    camera(t, out) {
      // 俯衝野馬的左後上方 15 m 跟拍：它與前方的 109 僚機排在同一條視線上。
      // 架在右後方的話僚機在它左前方，兩架橫著攤開，野馬落到選單後面
      body(rescuer, t, -7, 4, 13, true, out.position)
      rescuer(t, S1)
      wing109(t, S2)
      out.target.copy(S1).lerp(S2, 0.25)
      out.fov = 46
    },
  },
  {
    from: 22.3, subject: 2,
    camera(t, out) {
      // 與第 8 刀同一個做法：擊墜之後鏡頭照原速往前飛，殘骸慢下來、往後掉
      body(wing109, Math.min(t, WING_KILL), 11, 2, -18 - SPEED * Math.max(0, t - WING_KILL), true, out.position)
      wing109(Math.min(t, WING_KILL), out.target)
      if (t > WING_KILL) wreckAt(WING_POS, WING_VEL, t - WING_KILL, out.target)
      out.fov = 46
    },
  },
  {
    from: 24.6, subject: null,
    camera(t, out) {
      // 殘骸左後方約 35 m、略低，跟著一起往下掉：背景一半是天空、一半是越來越近的海
      wreckAt(KILL_POS, KILL_VEL, t - KILL_AT, out.target)
      out.position.set(out.target.x - 28, out.target.y - 3, out.target.z + 22)
      out.fov = 48
    },
  },
  {
    from: 28, subject: null,
    camera(t, out) {
      // 海面上 8 m、落海點側面 75 m：殘骸從畫面上方掉進水柱
      out.position.set(SPLASH_POS.x - 60, 8, SPLASH_POS.z + 45)
      wreckAt(KILL_POS, KILL_VEL, Math.min(t - KILL_AT, SPLASH_TAU), out.target)
      out.target.y += 12
      out.fov = 40
    },
  },
]

export const DOGFIGHT: Shot = {
  id: 'dogfight',
  duration: 32,
  timeOfDay: 'noon',
  captionKey: 'reel.dogfight',
  faceSun: false,
  // 比動作範圍（約 3,300 m）大一截：低空鏡頭的地平線上才不會有島擠在殘骸後面
  clear: { x: 0, z: -2300, radius: 5000 },
  planes: [
    { spec: P51D, path: mustang },
    { spec: BF109K4, path: messerschmitt },
    { spec: BF109K4, path: wing109 },
    { spec: P51D, path: rescuer },
    { spec: P51D, path: chaser(bgA109, 0.7, 4, 6), extra: true },
    { spec: BF109K4, path: bgA109, extra: true },
    { spec: BF109K4, path: chaser(bgBBase, 0.8, -4, 7), extra: true },
    { spec: P51D, path: bgBMustang, extra: true },
    { spec: BF109K4, path: faller, extra: true },
    { spec: P51D, path: chaser(bgC109, 0.7, 3, 5), extra: true },
    { spec: BF109K4, path: bgC109, extra: true },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    // 主線
    { at: 5.7, kind: 'burst', actor: 1, seconds: 0.9 },
    { at: 8.4, kind: 'burst', actor: 1, seconds: 0.7 },
    { at: 12.8, kind: 'burst', actor: 1, seconds: 1.5 },
    { at: 12.9, kind: 'gunner', actor: 1, target: 0, seconds: 1.3, miss: 3 },
    { at: 13.5, kind: 'smoke', actor: 0 },
    { at: 15.5, kind: 'burst', actor: 1, seconds: 1.7 },
    { at: 15.5, kind: 'gunner', actor: 1, target: 0, seconds: 1.9, miss: 1.5 },
    { at: KILL_AT, kind: 'kill', actor: 0, blast: true },
    { at: 21.4, kind: 'burst', actor: 3, seconds: 2.2 },
    { at: 21.6, kind: 'gunner', actor: 3, target: 2, seconds: 2.0, miss: 2 },
    { at: 22.5, kind: 'smoke', actor: 2 },
    { at: WING_KILL, kind: 'kill', actor: 2, blast: true },
    // 背景
    { at: 0, kind: 'smoke', actor: 8 },
    { at: FALL_DOWN, kind: 'kill', actor: 8, blast: false },
    ...[1.0, 4.2, 7.5, 11.0, 14.5, 18.0, 21.0, 25.5].map((at) => ({ at, kind: 'burst' as const, actor: 4, seconds: 0.7 })),
    ...[2.2, 5.5, 9.0, 11.8].map((at) => ({ at, kind: 'burst' as const, actor: 6, seconds: 0.8 })),
    ...[3.5, 6.8, 10.5, 16.5, 22.0, 26.5, 29.5].map((at) => ({ at, kind: 'burst' as const, actor: 9, seconds: 0.7 })),
    { at: B_HIT, kind: 'smoke', actor: 7 },
    { at: B_DOWN, kind: 'kill', actor: 7, blast: false },
    { at: 19.0, kind: 'smoke', actor: 5 },
  ]),
}
