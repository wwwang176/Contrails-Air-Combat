import { Vector3 } from 'three'
import { B17G } from '../../specs/b17g'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import {
  barrage, body, bodyUp, edit, rampedOffset, timeline, wingman, type Cut, type Path, type Shot,
} from './kit'

// ── 轟炸機流 ───────────────────────────────────────────────
//
// 正午、1,500 m。七架 B-17 分長機組、低空組與右上方一架，野馬在上方護航；
// 三架 109 從正前方略俯衝對衝穿過編隊。
//   0.0–2.8   長機右翼兩具發動機與螺旋槳的特寫，機首在右，後面高砲炸開
//   2.8–5.6   左僚機的右腰窗外：自己的右翼在前景，長機與右僚機在黑雲裡
//   5.6–8.2   109 機尾左後上方：前景是它的左翼與座艙罩，編隊在正前方迎面變大
//   8.2–9.8   長機上方砲塔往前看：自己的機鼻在下緣，兩架 109 衝過來、各機的曳光交叉；
//             9.4 秒左邊那架炸開
//   9.8–10.9  右僚機右翼上方：前景兩具發動機，109 迎面開火
//   10.9–12.4 緊跟在 109 機尾後：從長機與右僚機之間穿過去；右僚機 11.1 秒中彈冒煙
//   12.4–15.4 右僚機右翼前上方往後看：右內側發動機拖著黑煙
//   15.4–18.2 低空組正前方：第三架 109 從鏡頭右後方擦過、開火鑽到低空組下面
//   18.2–21.0 長機右腰窗下：自己的平尾在上緣，右僚機 18.6 秒起拖著煙往右下脫隊
//   21.0–24.4 貼著右僚機的右前下方：它壓坡度機頭朝下滑出去，編隊留在上方
//   24.4–28.2 編隊左前下方仰拍的大全景：黑雲、護航的野馬，右僚機拖煙往下掉
//   28.2–32.0 右後下方的遠鏡頭：編隊飛進黑雲，右僚機 28.6 秒交給殘骸池往下掉

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()

const STREAM_SPEED = 75
const STREAM_ALT = 1500
const streamLead: Path = (t, out) => out.set(0, STREAM_ALT, -STREAM_SPEED * t)

/** 長機組：長機、左僚機、右僚機（中彈的那一架） */
const leftWing = wingman(streamLead, -38, -7, 26, 0.9)
const STREAM_HIT = 2
const DROP_AT = 18.6
const KILL_AT = 28.6
const crippledBase = wingman(streamLead, 38, 7, 26, 1.7)
/**
 * 中彈的右僚機：往右下脫隊、速度掉下來。
 * 【下沉的加速度不能接近 g】升力方向是「加速度 + 重力」，往下 5 m/s² 時只剩 4.8，
 * 再大就翻成機腹朝天
 */
const crippled: Path = (t, out) => {
  crippledBase(t, out)
  out.x += rampedOffset(t, DROP_AT, 3, 2.5)
  out.y -= rampedOffset(t, DROP_AT, 3, 5)
  out.z += rampedOffset(t, DROP_AT, 3, 2)
  return out
}

/** 低空組：在長機組左後下方 */
const lowLead = wingman(streamLead, -72, -48, 112, 0.3)
const lowRight = wingman(streamLead, -34, -41, 138, 2.2)

/**
 * 109 對衝：第 `tp` 秒穿過長機所在的那一個橫切面，那一刻在長機的 (`rx`, `ry`)。
 * 之前是一條直線（水平 140 m/s、每秒沉 14 m，對編隊的接近率 215 m/s），
 * 穿過去之後往 `side` 那一側壓坡度俯衝轉開。
 *
 * 【穿過去之後一定要轉開】直飛的話 30 秒後飛到四公里外，出了開闊海面圓
 */
const FIGHTER_SPEED = 140
const FIGHTER_SINK = 14
const headOn = (tp: number, rx: number, ry: number, side: number): Path => (t, out) => {
  const tau = t - tp
  out.set(rx, STREAM_ALT + ry - FIGHTER_SINK * tau, -STREAM_SPEED * tp + FIGHTER_SPEED * tau)
  out.x += side * rampedOffset(t, tp + 1, 1.5, 7)
  out.y -= rampedOffset(t, tp + 0.8, 1.5, 5) - rampedOffset(t, tp + 4, 1.5, 5)
  out.z -= rampedOffset(t, tp + 1, 1.5, 6)
  return out
}
/** 主攻的 109：從長機右上方 18 m、長機與右僚機之間穿過 */
const PASS_AT = 11.5
const bandit = headOn(PASS_AT, 15, 18, 1)
const BANDIT = 9
/** 左邊的僚機，還沒到編隊就被機槍手打爆 */
const BANDIT_WING = 10
const BLAST_AT = 9.4
/** 第二波：單獨一架從低空組下方鑽過去 */
const SECOND_PASS = 16.6
const second = headOn(SECOND_PASS, -60, -62, -1)
const SECOND = 11

const escort = (dx: number, dy: number, dz: number, phase: number): Path => (t, out) => {
  streamLead(t, out)
  out.x += dx + 110 * Math.sin(0.33 * t + phase)
  out.y += dy + 14 * Math.sin(0.47 * t + phase)
  out.z += dz
  return out
}

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0, mount: 0,
    camera(t, out) {
      // 右翼外側、發動機前下方往內看：兩具螺旋槳在前景，機首在右邊。
      // 架在左翼的話機首落在左邊的選單後面
      body(streamLead, t, 12, -1.5, -13 + 0.3 * t, false, out.position)
      body(streamLead, t, 4.0, 0.3, -2.5, false, out.target)
      out.fov = 42
    },
  },
  {
    from: 2.8, subject: 0, mount: 1,
    camera(t, out) {
      body(leftWing, t, 2.4, 2.3, 6.8, false, out.position)
      streamLead(t, S1)
      crippled(t, S2)
      out.target.copy(S1).lerp(S2, 0.35)
      bodyUp(leftWing, t, out.up)
      out.fov = 46
    },
  },
  {
    from: 5.6, subject: 0, mount: BANDIT,
    camera(t, out) {
      // 機尾左後上方：整架 109 在右下前景，編隊在它前方。
      // 貼著座艙的話畫面只剩一塊機背和半透明的槳盤，看不出是 109
      body(bandit, t, -1.8, 2.4, 9.0, false, out.position)
      streamLead(t, out.target).add(S1.set(-10, -45, 60))
      bodyUp(bandit, t, out.up)
      out.fov = 34
    },
  },
  {
    from: 8.2, subject: BANDIT, mount: 0,
    camera(t, out) {
      // 上方砲塔：自己的座艙頂在下緣，109 從正前方偏上衝過來
      body(streamLead, t, 0.6, 3.0, -0.5, false, out.position)
      body(streamLead, t, 0, -60, -400, false, S1)
      bandit(t, S2)
      out.target.copy(S1).lerp(S2, 0.5)
      out.fov = 54
    },
  },
  {
    from: 9.8, subject: BANDIT, mount: STREAM_HIT,
    camera(t, out) {
      // 右翼上方、兩具發動機之間的後面：兩副螺旋槳在右下，109 在正前方開火。
      // 架在左翼的話發動機落在左邊的選單後面
      body(crippled, t, 4.6, 1.75, 3.0, false, out.position)
      body(crippled, t, 4.6, 0, -300, false, S1)
      bandit(t, S2)
      out.target.copy(S1).lerp(S2, 0.8)
      bodyUp(crippled, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 10.9, subject: BANDIT, mount: BANDIT,
    camera(t, out) {
      body(bandit, t, 0, 1.9, 11, false, out.position)
      body(bandit, t, 0, 0.4, -60, false, out.target)
      bodyUp(bandit, t, out.up)
      out.fov = 55
    },
  },
  {
    from: 12.4, subject: STREAM_HIT, mount: STREAM_HIT,
    camera(t, out) {
      // 拖煙的是右內側那一具（`enginePoints[0]`，機體 x +3.05）：從它的右前上方
      // 往後看，煙順著機翼往機尾拉
      body(crippled, t, 8.0, 3.0, -9.5 + 0.4 * (t - 12.4), false, out.position)
      body(crippled, t, 3.05, 0.2, 1.0, false, out.target)
      bodyUp(crippled, t, out.up)
      out.fov = 44
    },
  },
  {
    from: 15.4, subject: 3,
    camera(t, out) {
      // 低空組正前方、背對來襲方向：109 從鏡頭右後方擦過，往前鑽到低空組下面
      streamLead(t, out.position).add(S1.set(-52, -58, 40))
      lowLead(t, S1)
      lowRight(t, S2)
      out.target.copy(S1).lerp(S2, 0.3)
      out.target.y -= 6
      out.fov = 50
    },
  },
  {
    from: 18.2, subject: STREAM_HIT, mount: 0,
    camera(t, out) {
      // 右腰窗下緣、平尾前下方：自己的平尾壓在畫面上緣
      body(streamLead, t, 2.1, 0.5, 9.2, false, out.position)
      crippled(t, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 21.0, subject: STREAM_HIT,
    camera(t, out) {
      body(crippled, t, 22, -6, -30, true, out.position)
      body(crippled, t, -6, 8, 6, true, out.target)
      out.fov = 50
    },
  },
  {
    from: 24.4, subject: 0,
    camera(t, out) {
      streamLead(24.4, S1)
      out.position.set(S1.x - 120, S1.y - 210, S1.z - 330)
      streamLead(t, S2)
      out.target.set(S2.x - 10, S2.y - 25, S2.z + 50)
      out.fov = 46
    },
  },
  {
    from: 28.2, subject: 0,
    camera(t, out) {
      streamLead(28.2, S1)
      out.position.set(S1.x + 110, S1.y - 170, S1.z + 330)
      streamLead(t, S2)
      out.target.set(S2.x + 10, S2.y - 40, S2.z + 60)
      out.fov = 40
    },
  },
]

export const STREAM: Shot = {
  id: 'stream',
  duration: 32,
  timeOfDay: 'noon',
  captionKey: 'reel.stream',
  faceSun: false,
  clear: { x: 0, z: -1300, radius: 3000 },
  planes: [
    { spec: B17G, path: streamLead },
    { spec: B17G, path: leftWing },
    { spec: B17G, path: crippled },
    { spec: B17G, path: lowLead },
    { spec: B17G, path: wingman(streamLead, -110, -55, 138, 3.4), extra: true },
    { spec: B17G, path: lowRight },
    { spec: B17G, path: wingman(streamLead, 78, 42, 150, 4.1), extra: true },
    { spec: P51D, path: escort(60, 115, -30, 0) },
    { spec: P51D, path: escort(-80, 135, -80, Math.PI), extra: true },
    { spec: BF109K4, path: bandit },
    { spec: BF109K4, path: headOn(PASS_AT + 0.2, -62, 14, -1) },
    { spec: BF109K4, path: second },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    ...barrage(101, 0, 31, 1.8, (t, out) => streamLead(t, out).add(S3.set(-20, -20, 70)),
      { x: 190, yLo: -80, yHi: 100, z: 240 }, edit(CUTS), 70),
    // 第一波：遠距離就開始打，到 109 穿過去為止
    { at: 7.0, kind: 'gunner', actor: 1, target: BANDIT_WING, seconds: 2.4, miss: 18 },
    { at: 7.4, kind: 'gunner', actor: 3, target: BANDIT_WING, seconds: 2.0, miss: 14 },
    { at: 7.8, kind: 'gunner', actor: STREAM_HIT, target: BANDIT, seconds: 1.9, miss: 14 },
    { at: 8.2, kind: 'gunner', actor: 5, target: BANDIT, seconds: 3.4, miss: 16 },
    { at: 8.6, kind: 'gunner', actor: 6, target: BANDIT, seconds: 2.6, miss: 20 },
    { at: 9.0, kind: 'burst', actor: BANDIT_WING, seconds: 0.4 },
    { at: BLAST_AT, kind: 'kill', actor: BANDIT_WING, blast: true },
    { at: 9.8, kind: 'gunner', actor: 0, target: BANDIT, seconds: 1.6, miss: 10 },
    { at: 9.9, kind: 'gunner', actor: 1, target: BANDIT, seconds: 1.5, miss: 12 },
    { at: 9.9, kind: 'burst', actor: BANDIT, seconds: 1.1 },
    { at: 11.1, kind: 'smoke', actor: STREAM_HIT },
    // 穿過去之後低空組與右上那一架追著它的背打
    { at: 11.6, kind: 'gunner', actor: 3, target: BANDIT, seconds: 1.8, miss: 14 },
    { at: 11.7, kind: 'gunner', actor: 6, target: BANDIT, seconds: 1.6, miss: 18 },
    // 第二波
    { at: 15.4, kind: 'gunner', actor: 3, target: SECOND, seconds: 3.0, miss: 14 },
    { at: 15.6, kind: 'gunner', actor: 4, target: SECOND, seconds: 2.8, miss: 18 },
    { at: 15.8, kind: 'gunner', actor: 5, target: SECOND, seconds: 3.2, miss: 12 },
    { at: 16.6, kind: 'burst', actor: SECOND, seconds: 1.0 },
    { at: 17.4, kind: 'gunner', actor: 1, target: SECOND, seconds: 2.0, miss: 16 },
    { at: KILL_AT, kind: 'kill', actor: STREAM_HIT, blast: false },
  ]),
}
