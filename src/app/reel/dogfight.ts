import { Vector3 } from 'three'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import { scatterClouds, type CloudSpec } from '../../render/clouds'
import {
  body, bodyUp, edit, timeline, type Cut, type ReelCamera, type ReelEvent, type Shot,
} from './kit'
import { aimBetween } from './reelCameraMath'
import { phases, pursue, script, simulate, track, type Pilot, type Start } from './dogfightSimulation'

// ── 纏鬥 ───────────────────────────────────────────────────
//
// 正午、北海上空 650 m。野馬雙機（主角 #0、僚機 #3）與 109 雙機（長機 #1、僚機 #2）對頭，
// 主角打爆 109 僚機。109 長機翻筋斗繞回來從上方壓下，與急轉的主角打剪刀，咬上之後擊落主角；
// 野馬僚機從高空翻滾切入、一路追到低空打下它，再拉起做勝利滾轉。四周還有三組在互咬、
// 一架冒煙的 109 在遠處盤旋下降。
//   0–2       釘在野馬雙機航線前下方：兩架迎面壓過來
//   2–3.75    主角座艙後上方往前看：對頭，曳光收進 109 僚機，它起火
//   3.75–5.4  交會點旁的半空：109 長機與起火的僚機掠過，長機在眼前拉起；4.5 秒僚機爆開
//   5.4–7.6   主角右翼尖：8 g 左轉，地平線豎起來
//   7.6–9.6   筋斗頂點上方俯拍：109 長機垂直爬上來、倒飛翻過頂
//   9.6–11.7  109 長機後上方跟著俯衝：壓向底下急轉的主角，11 秒那串打在前面
//   11.7–13.5 主角座艙回頭看：109 衝過頭，12.4 秒主角反向急滾
//   13.5–15.6 主角前方 30 m 回看：剪刀機動，左右急滾反向，109 切過它的航跡
//   15.6–17.6 109 長機左肩後：主角拉成直線爬升，109 滑進它正後方
//   17.6–18.8 主角右前側 14 m：17.85 秒後方的 109 開火，18 秒起火，18.4 秒爆開，鏡頭不追殘骸
//   18.8–20.7 野馬僚機座艙後上方：翻滾切入、往下衝
//   20.7–22.6 109 俯衝線側下方仰拍：109 斜衝下去，野馬咬在後面
//   22.6–24.2 野馬僚機右肩後：23.3 秒開火，23.7 秒 109 起火
//   24.2–25.4 109 左前方回看：25 秒爆開
//   25.4–28   爆炸點下方仰拍：野馬從頭頂掠過、拉起
//   28–31     野馬右後側跟拍：爬升中的勝利滾轉

// ── 主線 ──
//
// #0 野馬（主角）、#1 109 長機、#2 109 僚機、#3 野馬僚機。

const M1 = 0
const G1 = 1
const G2 = 2
const M2 = 3

const PASS_ALT = 650
const V = 120
const G2_KILL = 4.5
const M1_KILL = 18.4
const G1_KILL = 25
const STARTS: readonly Start[] = [
  { x: 0, y: PASS_ALT, z: 0, heading: 0, v: V },
  { x: -15, y: PASS_ALT + 7, z: -960, heading: Math.PI, v: V },
  { x: 12, y: PASS_ALT - 9, z: -940, heading: Math.PI, v: V },
  { x: -32, y: PASS_ALT + 12, z: 30, heading: 0, v: V },
  // 背景：A 組左下方左轉兜圈、B 組右上方右轉兜圈、C 組低空由右往左橫過、
  // 一架冒煙的 109 從高空盤旋下降。追的那一架起點在被追的那一架後方 130 m
  { x: -370, y: 520, z: -1100, heading: 0, v: 110 },
  { x: -370, y: 528, z: -970, heading: 0, v: 110 },
  { x: -30, y: 1250, z: -600, heading: 0, v: 110 },
  { x: -30, y: 1258, z: -470, heading: 0, v: 110 },
  { x: 1200, y: 380, z: -500, heading: Math.PI / 2, v: 115 },
  { x: 1330, y: 388, z: -500, heading: Math.PI / 2, v: 115 },
  { x: -1400, y: 1350, z: -2600, heading: -Math.PI / 2, v: 100 },
]

/**
 * 主角的劇本：對頭後 8 g 左轉、剪刀兩次反向，最後被咬上時拉成直線爬升 ——
 * 被咬住的那一段要飛直線，曲線上咬在同一條航跡後面的人機首永遠指著弦外側，對不準
 */
const HERO = script([
  [-1, 0, null, 1, V, 0],
  // 對頭開完火拉起，從起火的 109 僚機上方錯過去
  [2.9, 0, null, 3.5, V],
  [3.7, 0, null, 1, V, 6],
  [4.2, -90, null, 8, V, 8],
  [12.4, 90, null, 7, 105, -5],
  [14.0, -90, null, 7, 105, -5],
  [14.8, 0, null, 4, 110, 20],
])

const BG_A = 4
const BG_B = 6
const BG_C = 8
const BG_FALL = 10

const PILOTS: readonly Pilot[] = [
  // 野馬（主角）
  phases([
    [-1, HERO],
    // 對頭時機首壓到 109 僚機上開火，2.9 秒放開、拉起從它上方錯過去
    [0.3, pursue(G2, { range: 0, nMax: 3, vLo: V, vHi: V, gain: 4 })],
    [2.9, HERO],
  ]),
  // 109 長機
  phases([
    [-1, script([[-1, 0, null, 1, V, 0], [4.3, 0, null, 7.5, V, 85]])],
    [7.0, pursue(M1, { range: 120, nMax: 7.5, vLo: 100, vHi: 150 })],
    [12.5, pursue(M1, { range: 120, nMax: 8, vLo: 95, vHi: 125, gain: 5 })],
    [14.0, pursue(M1, { range: 95, nMax: 7, vLo: 90, vHi: 135, gain: 3 })],
    [M1_KILL, script([
      [M1_KILL, 0, null, 2, 110, 0],
      [18.8, 180, null, 1.5, 120],
      [20.0, null, null, 5, 140],
      [20.7, 0, null, 6, 150, -35],
      [21.9, 70, null, 5, 150, -12],
      [22.7, 0, null, 2, 150, -8],
    ])],
  ]),
  // 109 僚機
  script([[-1, 0, null, 1, V, 0]]),
  // 野馬僚機
  phases([
    [-1, script([[-1, 0, null, 1, V, 0], [4.4, -20, null, 4, V, 30]])],
    [8.5, pursue(G1, { range: 320, nMax: 5, vLo: 100, vHi: 140, above: 300 })],
    [18.6, pursue(G1, { range: 90, nMax: 8, vLo: 100, vHi: 180, gain: 5 })],
    [G1_KILL, script([[G1_KILL, 0, null, 7, 130, 70], [27.8, null, 220, 2, 110], [29.6, 0, null, 3, 110, 40]])],
  ]),
  // 背景
  script([[-1, -75, null, 3.9, 110, 0]]),
  pursue(BG_A, { range: 130, nMax: 6, vLo: 95, vHi: 140, gain: 7 }),
  script([[-1, 75, null, 3.9, 110, 0]]),
  pursue(BG_B, { range: 130, nMax: 6, vLo: 95, vHi: 140, gain: 7 }),
  script([[-1, 30, null, 1.6, 115, 0], [4, -30, null, 1.6, 115, 0], [9, 35, null, 1.8, 115, 0], [14, -30, null, 1.6, 115, 0],
    [19, 30, null, 1.6, 115, 0], [24, -35, null, 1.8, 115, 0], [29, 30, null, 1.6, 115, 0]]),
  pursue(BG_C, { range: 130, nMax: 6, vLo: 100, vHi: 145, gain: 7 }),
  script([[-1, -30, null, 1.3, 100, -9]]),
]

const TABLES = simulate(STARTS, PILOTS)
const mustang = track(TABLES[M1]!)
const messerschmitt = track(TABLES[G1]!)
const wing109 = track(TABLES[G2]!)
const rescuer = track(TABLES[M2]!)

// ── 鏡頭工具 ──

const S1 = new Vector3()
const S2 = new Vector3()

const SH_F = new Vector3()
const SH_R = new Vector3()
const SH_U = new Vector3()
/** 三條正弦（權重 0.6／0.3／0.1）兩軸合起來的 RMS 是 0.68，除掉它 `deg` 就是 RMS 角度 */
const SHAKE_NORM = 1 / 0.68
const DEG = Math.PI / 180

/**
 * 手持搖晃：把注視點沿畫面的左右、上下推開，晃的是**角度**（RMS 約 `deg` 度），不是公尺 ——
 * 同樣 1 m 的位移，貼著機身 8 m 的鏡頭是 7°、500 m 外的遠景看不出來，照公尺定的話
 * 近景會抖到看不清飛機。頻率 0.3～1.4 Hz，讀起來是手持或機上的慢晃。
 *
 * `kickAt` 給了的話，那一刻（爆炸、擦身而過）再疊一下約 1° 的快抖，0.4 秒內衰減掉。
 * 要在 position 與 target 都算好之後呼叫
 */
function shake(t: number, deg: number, seed: number, out: ReelCamera, kickAt = -1): void {
  SH_F.subVectors(out.target, out.position)
  const dist = SH_F.length()
  SH_F.multiplyScalar(1 / dist)
  SH_R.crossVectors(SH_F, out.up)
  if (SH_R.lengthSq() < 1e-6) SH_R.set(1, 0, 0)
  SH_R.normalize()
  SH_U.crossVectors(SH_R, SH_F)
  const s = dist * deg * DEG * SHAKE_NORM
  let a = s * (0.6 * Math.sin(2.3 * t + seed) + 0.3 * Math.sin(5.3 * t + 2.1 * seed) + 0.1 * Math.sin(8.9 * t + seed))
  let b = s * (0.6 * Math.sin(1.9 * t + 1.3 * seed) + 0.3 * Math.sin(4.7 * t + seed) + 0.1 * Math.sin(7.7 * t + 0.4 * seed))
  if (kickAt >= 0 && t >= kickAt) {
    const k = dist * DEG * 1.4 * Math.exp(-(t - kickAt) / 0.15)
    a += k * Math.sin(29 * (t - kickAt) + seed)
    b += k * Math.sin(23 * (t - kickAt) + 2 * seed)
  }
  out.target.addScaledVector(SH_R, a).addScaledVector(SH_U, b)
}

/**
 * 從 `from` 看出去、介於 `a` 與 `b` 兩個方向之間的注視點（`w` = 偏向 `b` 的比例）。
 * 混的是方向不是位置 —— 一個在 20 m、一個在 300 m 的話，位置的內插幾乎就是遠的那一點
 */

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: M1,
    camera(t, out) {
      // 釘在半空、野馬雙機的航線前下方：兩架迎面壓過來，2 秒時長機只剩 30 m
      // 緊張的迎面，手持 0.3°；注視點晚 0.12 秒，長機壓近時在畫面裡往上漂
      out.position.set(16, PASS_ALT - 18, -262)
      mustang(t - 0.12, out.target)
      shake(t, 0.3, 1, out)
      out.fov = 42
    },
  },
  {
    from: 2.0, subject: G2, mount: M1,
    camera(t, out) {
      // 主角座艙後上方，越過機鼻往前看：曳光從兩翼收向迎面的 109 僚機，它起火
      // 掛在機上：機身不會抖，只留 0.1° 讓畫面活著
      body(mustang, t, 0.9, 1.9, 3.2, false, out.position)
      wing109(t, S1)
      body(mustang, t, 0, 0.6, -60, false, S2)
      aimBetween(out.position, S2, S1, 0.75, out.target)
      bodyUp(mustang, t, out.up)
      shake(t, 0.1, 2, out)
      out.fov = 40
    },
  },
  {
    from: 3.75, subject: G1,
    camera(t, out) {
      // 釘在交會點旁的半空：109 長機與起火的僚機迎面掠過，長機就在眼前拉起；鏡頭轉身追它
      // 0.3° 手持，4.5 秒僚機在旁邊爆開時震一下
      out.position.set(-46, PASS_ALT + 2, -415)
      messerschmitt(t - 0.1, out.target)
      shake(t, 0.3, 3, out, G2_KILL)
      out.fov = 52
    },
  },
  {
    from: 5.4, subject: M1, mount: M1,
    camera(t, out) {
      // 主角右翼尖外、往左下看過座艙：8 g 左轉，右翼朝天，背景是一整片傾斜的海
      // 掛在翼尖：地平線自己在轉，鏡頭幾乎不晃（0.08°）
      body(mustang, t, 6.6, 1.1, 3.2, false, out.position)
      body(mustang, t, -3, -0.8, -10, false, out.target)
      bodyUp(mustang, t, out.up)
      shake(t, 0.08, 4, out)
      out.fov = 62
    },
  },
  {
    from: 7.6, subject: G1,
    camera(t, out) {
      // 釘在 109 長機翻筋斗的頂點上方往下俯拍：它垂直爬上來、在鏡頭底下倒飛翻過頂，
      // 背景是海與底下急轉的野馬
      // 長鏡頭俯拍，0.15°：畫角窄，晃多了 109 會在畫面裡亂跳
      out.position.set(-95, PASS_ALT + 360, -235)
      messerschmitt(t - 0.06, out.target)
      shake(t, 0.15, 5, out)
      out.fov = 40
    },
  },
  {
    from: 9.6, subject: G1,
    camera(t, out) {
      // 109 長機後上方跟著往下衝：越過它看得到底下急轉的野馬與海面，11 秒那串曳光打在前面
      // 跟拍機的俯衝追逐，0.35°
      messerschmitt(t - 0.3, out.position)
      out.position.y += 7
      messerschmitt(t, S1)
      mustang(t, S2)
      aimBetween(out.position, S1, S2, 0.3, out.target)
      shake(t, 0.35, 6, out)
      out.fov = 50
    },
  },
  {
    from: 11.7, subject: G1, mount: M1,
    camera(t, out) {
      // 主角座艙右後方回頭看：109 從後上方壓下來又衝過頭，12.4 秒主角反向急滾
      // 掛在機上，0.1°；急滾反向本身就是畫面的動作
      body(mustang, t, 1.5, 1.5, -1.4, false, out.position)
      messerschmitt(t - 0.1, S1)
      body(mustang, t, 0, 0.9, 1.3, false, S2)
      aimBetween(out.position, S2, S1, 0.72, out.target)
      bodyUp(mustang, t, out.up)
      shake(t, 0.1, 7, out)
      out.fov = 56
    },
  },
  {
    from: 13.5, subject: M1,
    camera(t, out) {
      // 主角前方 30 m 回看：它左右急滾反向，後下方的 109 跟著切過它的航跡
      // 跟拍機在它前面倒著飛，剪刀最緊張的一段，0.4°；注視點晚半拍，跟不太上急滾
      body(mustang, t, 9, 3, -30, true, out.position)
      mustang(t - 0.08, S1)
      messerschmitt(t - 0.2, S2)
      aimBetween(out.position, S1, S2, 0.45, out.target)
      shake(t, 0.4, 8, out)
      out.fov = 60
    },
  },
  {
    from: 15.6, subject: M1, mount: G1,
    camera(t, out) {
      // 109 長機左肩後：它滾轉、滑進直線爬升的主角正後方 80 m。掛在機上，0.1°
      body(messerschmitt, t, -1.0, 1.75, 3.6, false, out.position)
      mustang(t, out.target)
      bodyUp(messerschmitt, t, out.up)
      shake(t, 0.1, 10, out)
      out.fov = 42
    },
  },
  {
    from: 17.6, subject: M1,
    camera(t, out) {
      // 主角右前側 14 m：後方的 109 打來一串，主角起火，18.4 秒爆開。鏡頭照它原本的航線
      // 繼續往前，不追殘骸
      // 0.25° 跟拍，爆開那一下震
      body(mustang, t, 12, 2.5, -7, true, out.position)
      body(mustang, t, 0, 0, 2, true, out.target)
      shake(t, 0.25, 11, out, M1_KILL)
      out.fov = 50
    },
  },
  {
    from: 18.8, subject: G1, mount: M2,
    camera(t, out) {
      // 野馬僚機的座艙後上方：翻滾切入、幾乎垂直往下衝，109 在底下 400 m
      // 掛在機上，0.1°
      body(rescuer, t, 0.5, 1.6, 3.6, false, out.position)
      messerschmitt(t, S1)
      body(rescuer, t, 0, 0.9, -80, false, S2)
      aimBetween(out.position, S2, S1, 0.4, out.target)
      bodyUp(rescuer, t, out.up)
      shake(t, 0.1, 12, out)
      out.fov = 56
    },
  },
  {
    from: 20.7, subject: G1,
    camera(t, out) {
      // 釘在 109 俯衝線側下方的半空，往上仰拍：109 從鏡頭前斜衝下去，野馬咬在後面。
      // 架在俯衝線的正前方的話，背景正好是主角殘骸拖著煙往下掉的那一條
      messerschmitt(22.3, out.position)
      out.position.x += 48
      out.position.y -= 25
      out.position.z += 50
      // 手持仰拍 0.3°，注視點晚 0.15 秒：109 衝過去時跟不太上
      messerschmitt(t - 0.15, S1)
      rescuer(t, S2)
      aimBetween(out.position, S1, S2, 0.2, out.target)
      shake(t, 0.3, 13, out)
      out.fov = 46
    },
  },
  {
    from: 22.6, subject: G1, mount: M2,
    camera(t, out) {
      // 野馬僚機右肩後：曳光收進 109，23.7 秒起火。掛在機上，0.1°
      body(rescuer, t, 1.0, 1.75, 3.6, false, out.position)
      messerschmitt(t, out.target)
      bodyUp(rescuer, t, out.up)
      shake(t, 0.1, 14, out)
      out.fov = 40
    },
  },
  {
    from: 24.2, subject: G1,
    camera(t, out) {
      // 109 左前方 16 m 回看：起火冒煙，後方野馬再一串，25 秒爆開。鏡頭照它原本的航線往前
      // 0.25° 跟拍，爆開那一下震
      body(messerschmitt, t, -13, 2, -9, true, out.position)
      body(messerschmitt, t, 0, 0, 3, true, out.target)
      shake(t, 0.25, 15, out, G1_KILL)
      out.fov = 50
    },
  },
  {
    from: 25.4, subject: M2,
    camera(t, out) {
      // 釘在爆炸點下方往上仰拍：野馬穿過煙拉起、直直爬上天
      // 手持仰拍 0.3°，野馬從頭頂掠過的那一刻震一下。注視點只晚 0.05 秒 —— 它離鏡頭最近
      // 只有 50 m，晚多了會直接甩出畫面
      rescuer(26.6, out.position)
      out.position.x -= 30
      out.position.y -= 55
      rescuer(t - 0.05, out.target)
      shake(t, 0.3, 16, out, 26.3)
      out.fov = 56
    },
  },
  {
    from: 28, subject: M2,
    camera(t, out) {
      // 野馬右後側 40 m 跟拍：爬升中的勝利滾轉
      // 片尾收在平穩的跟拍，0.15°
      body(rescuer, t, 30, -6, 30, true, out.position)
      rescuer(t - 0.1, out.target)
      shake(t, 0.15, 17, out)
      out.fov = 44
    },
  },
]

const EVENTS: ReelEvent[] = [
  // 對頭：主角打僚機，長機那一串從主角身邊擦過去
  { at: 1.7, kind: 'burst', actor: M1, seconds: 1.15, target: G2 },
  { at: 2.3, kind: 'burst', actor: G1, seconds: 1.0 },
  { at: 2.7, kind: 'smoke', actor: G2, fire: true },
  { at: G2_KILL, kind: 'kill', actor: G2, blast: true },
  // 長機從上方壓下來，第一串打在主角前面
  { at: 11.0, kind: 'burst', actor: G1, seconds: 0.6 },
  // 剪刀之後咬上：主角拉成直線爬升，導引在 17.8 秒之後收斂到機首壓在它機身上，只在這一段開火
  { at: 17.85, kind: 'burst', actor: G1, seconds: 0.5, target: M1 },
  { at: 18.0, kind: 'smoke', actor: M1, fire: true },
  { at: M1_KILL, kind: 'kill', actor: M1, blast: true },
  // 僚機報仇
  { at: 23.3, kind: 'burst', actor: M2, seconds: 0.9, target: G1 },
  { at: 23.7, kind: 'smoke', actor: G1, fire: true },
  { at: 24.4, kind: 'burst', actor: M2, seconds: 0.55, target: G1 },
  { at: G1_KILL, kind: 'kill', actor: G1, blast: true },
  // 背景：各組追的那一架一串一串打，曳光在遠處交叉；冒煙的那一架整段都在往下掉
  { at: 0, kind: 'smoke', actor: BG_FALL },
  ...[1.5, 6.0, 10.5, 15.0, 20.0, 26.0].map((at) => ({ at, kind: 'burst' as const, actor: BG_A + 1, seconds: 0.6, target: BG_A })),
  ...[3.0, 8.0, 13.0, 18.5, 23.0, 28.0].map((at) => ({ at, kind: 'burst' as const, actor: BG_B + 1, seconds: 0.6, target: BG_B })),
  ...[4.5, 9.0, 16.0, 22.0, 29.0].map((at) => ({ at, kind: 'burst' as const, actor: BG_C + 1, seconds: 0.6, target: BG_C })),
]

/**
 * 纏鬥在 650～1000 m。雲擺在各刀的後景、離鏡頭幾百公尺以外，多半在畫面右半（左半被
 * 選單蓋住）
 */
const CLOUDS: readonly CloudSpec[] = [
  // 開場往南看：右上方
  { x: -250, y: 780, z: 580, radius: 40 },
  // 往北對頭：右上方
  { x: 290, y: 660, z: -1300, radius: 45 },
  // 往東看主角打 109 僚機
  { x: 830, y: 830, z: -420, radius: 40 },
  // 低處一朵：往下看的幾刀襯在海面上
  { x: -310, y: 410, z: -730, radius: 45 },
  // 剪刀那幾刀往東北看
  { x: 1060, y: 870, z: -1190, radius: 45 },
  // 仰看野馬僚機切入：高處
  { x: -230, y: 1340, z: -1100, radius: 50 },
  { x: 500, y: 640, z: -470, radius: 40 },
  // 勝利滾轉往北看：遠處
  { x: 1710, y: 960, z: -2480, radius: 45 },
  // 遠景：鏡頭離圓心最遠 1.1 km，圓環從 1.8 km 起
  ...scatterClouds({ x: 400, z: -900, inner: 1800, outer: 6500, yMin: 500, yMax: 1300, rMin: 70, rMax: 150, count: 50, seed: 3 }),
]

export const DOGFIGHT: Shot = {
  id: 'dogfight',
  duration: 31,
  clouds: CLOUDS,
  timeOfDay: 'noon',
  faceSun: false,
  // 動作範圍約 2.5 km 見方。圓要大上好幾倍：掛機與仰拍的鏡頭看得到地平線，
  // 小了島就擠在畫面邊上
  clear: { x: 0, z: -1000, radius: 12000 },
  planes: [
    { spec: P51D, path: mustang },
    { spec: BF109K4, path: messerschmitt },
    { spec: BF109K4, path: wing109 },
    { spec: P51D, path: rescuer },
    { spec: BF109K4, path: track(TABLES[BG_A]!), extra: true },
    { spec: P51D, path: track(TABLES[BG_A + 1]!), extra: true },
    { spec: P51D, path: track(TABLES[BG_B]!), extra: true },
    { spec: BF109K4, path: track(TABLES[BG_B + 1]!), extra: true },
    { spec: BF109K4, path: track(TABLES[BG_C]!), extra: true },
    { spec: P51D, path: track(TABLES[BG_C + 1]!), extra: true },
    { spec: BF109K4, path: track(TABLES[BG_FALL]!), extra: true },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline(EVENTS),
}