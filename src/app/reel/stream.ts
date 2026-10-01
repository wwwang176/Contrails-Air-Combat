import { Vector3 } from 'three'
import { B17G } from '../../specs/b17g'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import {
  barrage, body, bodyUp, edit, rampedOffset, timeline, wingman,
  type Cut, type Path, type ReelPlane, type ReelProp, type Shot,
} from './kit'

// ── 轟炸機流 ───────────────────────────────────────────────
//
// 正午、內陸農地上空 1,000 m。B-17 分前導組、長機組、低空組，野馬在上方護航。
// 高砲一路炸；各組投彈，炸彈串掃過村子南邊的一座油廠與調車場。兩架 109 從正前方
// 對衝，右僚機的右內側發動機中彈起火，脫隊之後被高砲直接命中炸開；第二波一架 109
// 從低空組旁邊穿過，被咬在它後面的野馬打爆。
//
// 地形（局部座標）：整個 `clear` 圓是平地（離地 0 m）。村子的中心在 (−40, −1760)；
// 油廠在它南邊 x −95…60、z −1480…−1640，正好在長機組與低空組的炸彈串底下。
//
// 刀表：
//   0.0–2.6   長機右翼外側：兩具螺旋槳在前景，機首在右，後面高砲炸開
//   2.6–5.2   右後上方的伴飛機（手持）：整個編隊壓在德國的田、樹林與村子上
//   5.2–7.6   左僚機的右腰窗外：自己的右翼在前景，長機與右僚機在黑雲裡
//   7.6–10.0  長機機腹下往前看：炸彈一枚枚從彈艙掉出去，底下是一公里外的田
//   10.0–11.0 109 機尾左後上方：編隊迎面變大，109 對著右僚機開火
//   11.0–13.6 反打，右僚機後上方的伴飛機（手持）：曳光打進右僚機右翼噴出火花，右內側
//             發動機 11.6 秒冒煙；109 從右僚機頭上拉起、從鏡頭左邊擦過
//   13.6–15.6 右僚機右後上方 27 m 跟拍（手持）：冒煙的發動機 13.8 秒竄出火
//   15.6–18.8 低空組前方（手持）：第二架 109 從低空組長機正下方鑽過去，追在同一條航線
//             上的野馬開火，18.45 秒把它打爆
//   18.8–21.8 長機右腰窗（手持）：右僚機拖著火往右下脫隊，21.2 秒被高砲直接命中炸開
//   21.8–24.2 地面，油廠東南邊的田上（手持）：炸彈落成一片雨，在油廠裡一串串炸開
//   24.2–27.6 長機球形砲塔往左後下方看：低空組在前景，底下的油廠一串一串炸開
//   27.6–32.0 低空組長機的上方砲塔往前上方看：長機組迎著黑雲飛下去

const S1 = new Vector3()
const S2 = new Vector3()
const S3 = new Vector3()

const AIM_A = new Vector3()
const AIM_B = new Vector3()
/**
 * 從 `from` 看出去、介於 `a` 與 `b` 兩個方向之間的注視點（`w` = 偏向 `b` 的比例）。
 * 混的是方向不是位置 —— 一個在 20 m、一個在 600 m 的話，位置的內插幾乎就是遠的那一點
 */
function aimBetween(from: Vector3, a: Vector3, b: Vector3, w: number, out: Vector3): Vector3 {
  AIM_A.subVectors(a, from).normalize().multiplyScalar(100 * (1 - w))
  AIM_B.subVectors(b, from).normalize().multiplyScalar(100 * w)
  return out.copy(from).add(AIM_A).add(AIM_B)
}

/**
 * 手持的晃動：每一軸三條頻率互質的正弦（0.7～2.9 Hz），疊進 `out`。`amp` 是最大位移，m。
 * 鏡頭位置與注視點各疊一份、`seed` 不同 —— 用同一份的話整台鏡頭平移，看不出晃
 */
function shake(t: number, amp: number, seed: number, out: Vector3): Vector3 {
  const w = 2 * Math.PI
  out.x += amp * (0.5 * Math.sin(w * 0.71 * t + seed) + 0.3 * Math.sin(w * 1.63 * t + 2.1 * seed)
    + 0.2 * Math.sin(w * 2.87 * t + 0.7 * seed))
  out.y += amp * (0.5 * Math.sin(w * 0.93 * t + 1.3 * seed) + 0.3 * Math.sin(w * 2.11 * t + 0.4 * seed)
    + 0.2 * Math.sin(w * 2.53 * t + 3.1 * seed))
  out.z += amp * (0.6 * Math.sin(w * 0.79 * t + 2.7 * seed) + 0.4 * Math.sin(w * 1.91 * t + 1.9 * seed))
  return out
}

/**
 * 衝擊的一震：`t0` 起 4～5 Hz、0.18 秒衰減一半多的快抖，0.6 秒後歸零，疊進 `out`。
 * 只給爆炸與擦身而過的那一下 —— 一直抖的話觀眾看的是鏡頭不是飛機
 */
function jolt(t: number, t0: number, amp: number, out: Vector3): Vector3 {
  const u = t - t0
  if (u < 0 || u > 0.6) return out
  const k = amp * Math.exp(-u / 0.18)
  out.x += k * Math.sin(2 * Math.PI * 5.3 * u)
  out.y += k * Math.sin(2 * Math.PI * 4.1 * u + 1)
  return out
}

const STREAM_SPEED = 75
const STREAM_ALT = 1000
const streamLead: Path = (t, out) => out.set(0, STREAM_ALT, -STREAM_SPEED * t)

/** 長機組：長機、左僚機、右僚機（中彈的那一架） */
const leftWing = wingman(streamLead, -38, -7, 26, 0.9)
const STREAM_HIT = 2
const DROP_AT = 16.6
const KILL_AT = 21.2
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
const lowLeft = wingman(streamLead, -110, -55, 138, 3.4)
const lowRight = wingman(streamLead, -34, -41, 138, 2.2)
const LOW_LEAD = 3

const FIGHTER_SPEED = 140
/** 閃避的加速度花多久加滿、多久收掉，秒 */
const SWERVE_D = 0.4

/**
 * 109 對衝：一條水平直線正對著長機座標裡的 (`ax`, `ay`, `az`)，第 `tc` 秒與那一點擦身。
 * 擦身前 `swerveT` 秒才閃開，到 `tc` 時偏開 (`offX`, `offY`)，之後以那時的速度繼續
 * 偏出去；`turnAt` 起往 `side` 那一側壓坡度俯衝轉開。
 *
 * 【開火只能在閃避之前】曳光沿機首直直打出去，機首就是航線。直線段正對著目標的
 * 機身，一開始閃避機首就偏離。連射最晚停在 `tc − swerveT`
 *
 * 【偏開的距離要大於兩架的半翼展和】B-17 加 109 是 20.8 m，僚機還有 ±2 m 的起伏。
 * `swerveT` 越短閃得越猛，擦身之後偏出去的速度也越快（約 2 × 偏開距離 / `swerveT`）
 */
const attack = (
  tc: number, ax: number, ay: number, az: number, offX: number, offY: number,
  swerveT: number, side: number, turnAt: number,
): Path => {
  const gain = 1 / (SWERVE_D * 0.5 * (swerveT - SWERVE_D) + 0.5 * (swerveT - SWERVE_D) ** 2)
  return (t, out) => {
    const s = gain * (rampedOffset(t, tc - swerveT, SWERVE_D, 1) - rampedOffset(t, tc - SWERVE_D, SWERVE_D, 1))
    out.set(ax, STREAM_ALT + ay, -STREAM_SPEED * tc + az + FIGHTER_SPEED * (t - tc))
    out.x += offX * s + side * rampedOffset(t, turnAt, 1.5, 7)
    out.y += offY * s - rampedOffset(t, turnAt - 0.2, 1.5, 5) + rampedOffset(t, turnAt + 3, 1.5, 5)
    out.z -= rampedOffset(t, turnAt, 1.5, 6)
    return out
  }
}
/** 主攻的 109：正對著右僚機打，13.1 秒從它左上方 23 m 擦過 */
const PASS_AT = 13.1
const BANDIT_SWERVE = 1.8
const bandit = attack(PASS_AT, 38, 7, 26, -16, 17, BANDIT_SWERVE, -1, PASS_AT + 1)
const BANDIT = 9
/**
 * 左邊的僚機，正對著長機打，從長機左上方 28 m 擦過。
 * 【不擊落】它在編隊前方 300 m 炸開的話，殘骸帶著 140 m/s 正好穿過反打那一刀的畫面
 */
const BANDIT_WING = 10
/**
 * 第二波：單獨一架正對著低空組長機打，17.2 秒從它正下方 34 m 鑽過去。
 * 【下方要留得比 109 自己需要的多】跟在後面的野馬走同一條航線，但它通過低空組長機時
 * 109 的閃避才做了七成 —— 留 34 m，野馬那一刻還有 24 m
 */
const SECOND_PASS = 17.2
/** 閃得慢一點：擦身之後往下的速度小，被野馬打爆時還在低空組後方不遠 */
const SECOND_SWERVE = 2.8
const second = attack(SECOND_PASS, -72, -48, 112, -6, -34, SECOND_SWERVE, -1, SECOND_PASS + 2.5)
const SECOND = 11
/**
 * 咬住第二架 109 的野馬：走同一條航線、落後 0.75 秒。
 * 【開火要等 109 閃避完】閃避的那幾秒航線是彎的，野馬的機首（0.75 秒前 109 的方向）
 * 對不到它；閃避收掉之後兩架在同一條直線上
 */
const CHASE_LAG = 0.75
const chaser: Path = (t, out) => second(t - CHASE_LAG, out)
const CHASER = 12
const SECOND_DOWN = SECOND_PASS + CHASE_LAG + 0.5

const escort = (dx: number, dy: number, dz: number, phase: number): Path => (t, out) => {
  streamLead(t, out)
  out.x += dx + 110 * Math.sin(0.33 * t + phase)
  out.y += dy + 14 * Math.sin(0.47 * t + phase)
  out.z += dz
  return out
}

/** 前導組：長機組右前上方，先投彈 —— 它的炸彈比長機組的早一秒半落地 */
const forwardA = wingman(streamLead, 130, 70, -460, 0.5)
const forwardB = wingman(streamLead, 175, 62, -500, 2.9)

/** 長機組投彈的時刻；炸彈從 1,000 m 落地要 15.7 秒、往前拋 890 m */
const BOMBS_AWAY = 7.8

/** 右僚機被高砲直接命中的那一朵：炸開那一刻在它的左前上方 */
const DIRECT_HIT = crippled(KILL_AT - 0.05, new Vector3()).add(new Vector3(-5, 4, -7))

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
    from: 2.6, subject: 0,
    camera(t, out) {
      // 伴飛機：右後上方，往前下方看 —— 地面的田與村子鋪滿畫面的下半。
      // 平靜的大遠景，晃動壓在 0.1° 上下。前景 50 m 那一架對鏡頭位置的晃動最敏感：
      // 位置晃 1 m 它就跳 1°
      streamLead(t, out.position).add(S1.set(95, 72, 185))
      shake(t, 0.15, 1, out.position)
      streamLead(t, out.target).add(S1.set(-20, -60, -80))
      shake(t, 1.0, 4, out.target)
      out.fov = 50
    },
  },
  {
    from: 5.2, subject: 0, mount: 1,
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
    from: 7.6, subject: null, mount: 0,
    camera(t, out) {
      // 機腹下、彈艙後方往前下方看：炸彈從機腹落下、往後飄過鏡頭下方
      body(streamLead, t, 1.6, -3.4, 7.0, false, out.position)
      body(streamLead, t, 0, -6, -3, false, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 62
    },
  },
  {
    from: 10.0, subject: STREAM_HIT, mount: BANDIT,
    camera(t, out) {
      // 機尾左後上方：整架 109 在右下前景，編隊在它前方，曳光沿機首打向右僚機。
      // 貼著座艙的話畫面只剩一塊機背和半透明的槳盤，看不出是 109
      body(bandit, t, -1.8, 2.4, 9.0, false, out.position)
      crippled(t, S1)
      body(bandit, t, 0, 0, -300, false, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      bodyUp(bandit, t, out.up)
      out.fov = 34
    },
  },
  {
    from: 11.0, subject: STREAM_HIT,
    camera(t, out) {
      // 反打：右僚機後上方 110 m 的伴飛機（手持 0.25°）。109 的曳光迎面打進右僚機的
      // 右翼、噴出火花，右內側發動機冒起一縷煙；
      // 109 從右僚機頭上拉起，13.5 秒從鏡頭左邊 50 m 擦過（震一下）。
      // 右僚機與 109 的來向差不到 15°，在同一個畫面裡。注視點偏向 109 一點，
      // 109 開始閃避（12.6 秒）之後收回右僚機 —— 不收的話它擦過鏡頭時把右僚機甩出畫面
      streamLead(t, out.position).add(S1.set(62, 30, 130))
      shake(t, 0.2, 11, out.position)
      crippled(t, S1)
      bandit(t, S2)
      const lean = Math.min(1, Math.max(0, (PASS_AT - 0.3 - t) / 0.5))
      aimBetween(out.position, S1, S2, 0.25 * lean, out.target)
      shake(t, 0.3, 12, out.target)
      jolt(t, PASS_AT + 0.45, 1.0, out.target)
      out.fov = 30
    },
  },
  {
    from: 13.6, subject: STREAM_HIT,
    camera(t, out) {
      // 右僚機右後上方 35 m 跟拍（手持 0.2°）：冒煙的右內側發動機（`enginePoints[0]`，
      // 機體 x +3.05）13.8 秒竄出火，火與煙順著機翼往後拉。再貼近的話煙尾從鏡頭旁
      // 流過，整架隔著一層煙
      body(crippled, t, 25, 11, 22, true, out.position)
      shake(t, 0.08, 13, out.position)
      body(crippled, t, 1.5, 0, -1, true, out.target)
      shake(t, 0.15, 14, out.target)
      out.fov = 40
    },
  },
  {
    from: 15.6, subject: LOW_LEAD,
    camera(t, out) {
      // 低空組長機的右前下方、背對來襲方向：109 從鏡頭左邊 25 m 擦過、從低空組長機
      // 正下方鑽過去，野馬追在後面。緊張的追逐：晃 0.3° 上下，兩架擦過鏡頭各震一下
      streamLead(t, out.position).add(S1.set(-50, -72, 40))
      shake(t, 0.4, 2, out.position)
      lowLead(t - 0.25, S1)
      lowRight(t - 0.25, S2)
      out.target.copy(S1).lerp(S2, 0.5)
      out.target.y -= 14
      shake(t, 0.9, 5, out.target)
      jolt(t, SECOND_PASS - 0.33, 1.4, out.target)
      jolt(t, SECOND_PASS + CHASE_LAG - 0.33, 1.0, out.target)
      out.fov = 52
    },
  },
  {
    from: 18.8, subject: STREAM_HIT, mount: 0,
    camera(t, out) {
      // 右腰窗：機槍手的視角，自己的平尾壓在畫面上緣，注視點跟不上脫隊的右僚機。
      // 【鏡頭位置不晃】平尾離鏡頭 3 m，位置晃 0.3 m 它就在畫面上跳 5°；只轉方向，
      // 0.3° 上下，炸開那一下震到 1°
      body(streamLead, t, 2.1, 0.5, 9.2, false, out.position)
      crippled(t - 0.3, out.target)
      shake(t, 0.5, 6, out.target)
      jolt(t, KILL_AT, 1.4, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 52
    },
  },
  {
    from: 21.8, subject: null,
    camera(t, out) {
      // 地面，油廠東南邊的田上 70 m（再低油廠就躲在林緣後面）：炸彈串落成一片雨、
      // 在油廠裡炸開。往上抬到編隊的話，右僚機的殘骸與煙落在畫面正中
      // 手持 0.25° 上下，第一串落進油廠時震一下
      out.position.set(420, 70, -1150)
      shake(t, 0.6, 7, out.position)
      streamLead(t, S1)
      S2.set(100, 0, -1600)
      aimBetween(out.position, S2, S1, 0.14, out.target)
      shake(t, 0.7, 8, out.target)
      jolt(t, 23.5, 0.9, out.target)
      out.fov = 50
    },
  },
  {
    from: 24.2, subject: LOW_LEAD, mount: 0,
    camera(t, out) {
      // 球形砲塔：機腹下往左後下方看，低空組在前景，底下的田與村子一串串炸開。
      // 右僚機的殘骸在右後下方往下掉 —— 注視點往左偏，它才在畫面外
      body(streamLead, t, 0, -2.6, 2.0, false, out.position)
      body(streamLead, t, -105, -200, 170, false, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 64
    },
  },
  {
    from: 27.6, subject: 0, mount: LOW_LEAD,
    camera(t, out) {
      // 低空組長機的上方砲塔往右前上方看：長機組在前上方、迎著黑雲飛下去。
      // 右僚機的殘骸在編隊後下方 —— 往前上方看它才不在畫面裡
      // 掛在機上，只留 0.15° 上下的慢晃
      body(lowLead, t, 1.0, 3.1, -0.5, false, out.position)
      streamLead(t, S1)
      body(lowLead, t, 0, 30, -400, false, S2)
      aimBetween(out.position, S1, S2, 0.45, out.target)
      shake(t, 0.3, 10, out.target)
      bodyUp(lowLead, t, out.up)
      out.fov = 50
    },
  },
]

const PLANES: readonly ReelPlane[] = [
  { spec: B17G, path: streamLead },
  { spec: B17G, path: leftWing },
  { spec: B17G, path: crippled },
  { spec: B17G, path: lowLead },
  { spec: B17G, path: lowLeft, extra: true },
  { spec: B17G, path: lowRight },
  { spec: B17G, path: wingman(streamLead, 78, 42, 150, 4.1), extra: true },
  { spec: P51D, path: escort(60, 115, -30, 0) },
  { spec: P51D, path: escort(-80, 135, -80, Math.PI), extra: true },
  { spec: BF109K4, path: bandit },
  { spec: BF109K4, path: attack(PASS_AT + 0.2, 0, 0, 0, -20, 20, BANDIT_SWERVE, -1, PASS_AT + 1.2) },
  { spec: BF109K4, path: second },
  { spec: P51D, path: chaser },
  { spec: B17G, path: forwardA, extra: true },
  { spec: B17G, path: forwardB, extra: true },
]

/**
 * 油廠與調車場：排在長機組與低空組的炸彈串底下（落點 x −110…80、z −1430…−1650），
 * 落在命中盒外擴 15 m 內就炸毀起火。煙囪高 100 m —— 地面鏡頭要離它 200 m 以上
 */
const PROPS: readonly ReelProp[] = [
  { id: 'oilTank', x: -30, z: -1500, heading: 0 },
  { id: 'oilTank', x: 0, z: -1490, heading: 0 },
  { id: 'oilTank', x: 30, z: -1510, heading: 0 },
  { id: 'gasHolder', x: -75, z: -1560, heading: 0 },
  { id: 'coolingTower', x: -30, z: -1550, heading: 0 },
  { id: 'boilerHouse', x: 15, z: -1600, heading: 0 },
  { id: 'chimney', x: 55, z: -1612, heading: 0 },
  { id: 'locomotive', x: 80, z: -1460, heading: 0 },
  { id: 'tender', x: 80, z: -1471, heading: 0 },
  { id: 'boxcar', x: 80, z: -1481, heading: 0 },
  { id: 'boxcar', x: 80, z: -1491, heading: 0 },
  { id: 'boxcar', x: 80, z: -1501, heading: 0 },
  { id: 'boxcar', x: 80, z: -1511, heading: 0 },
]

export const STREAM: Shot = {
  id: 'stream',
  duration: 32,
  timeOfDay: 'noon',
  faceSun: false,
  terrain: 'farmland',
  // 半徑決定執行時落在農地的哪裡（`openSeaOrigin` 躲山丘）：3,750～4,500 m 落在
  // (12990, 7500)，村子就在圓心的 (−145, +581)。改了半徑，村子就不在油廠北邊
  clear: { x: 105, z: -2341, radius: 4400 },
  planes: PLANES,
  props: PROPS,
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    ...barrage(101, 0, 31, 2.0, (t, out) => streamLead(t, out).add(S3.set(-20, -20, 70)),
      { x: 190, yLo: -80, yHi: 100, z: 240 }, edit(CUTS), 70),
    // 最後一刀：長機組前方的一片彈幕，編隊直直飛進去
    ...barrage(202, 27.7, 31.6, 3.5, (t, out) => streamLead(t, out).add(S3.set(20, 15, -260)),
      { x: 160, yLo: -50, yHi: 90, z: 160 }, edit(CUTS), 70),
    // 投彈：前導組先投，長機組、低空組、右上那一架照順序
    { at: 6.4, kind: 'bomb', actor: 13, count: 8, interval: 0.3 },
    { at: 6.5, kind: 'bomb', actor: 14, count: 8, interval: 0.3 },
    { at: BOMBS_AWAY, kind: 'bomb', actor: 0, count: 10, interval: 0.26 },
    { at: BOMBS_AWAY + 0.1, kind: 'bomb', actor: 1, count: 10, interval: 0.26 },
    { at: BOMBS_AWAY + 0.15, kind: 'bomb', actor: STREAM_HIT, count: 10, interval: 0.26 },
    { at: 9.3, kind: 'bomb', actor: 3, count: 8, interval: 0.3 },
    { at: 9.4, kind: 'bomb', actor: 4, count: 8, interval: 0.3 },
    { at: 9.45, kind: 'bomb', actor: 5, count: 8, interval: 0.3 },
    { at: 9.6, kind: 'bomb', actor: 6, count: 8, interval: 0.3 },
    // 第一波：遠距離就開始打，到 109 穿過去為止
    { at: 9.6, kind: 'gunner', actor: 1, target: BANDIT_WING, seconds: 2.3, miss: 18 },
    { at: 10.0, kind: 'gunner', actor: 3, target: BANDIT, seconds: 2.6, miss: 14 },
    { at: 10.2, kind: 'gunner', actor: STREAM_HIT, target: BANDIT, seconds: 2.4, miss: 14 },
    { at: 10.4, kind: 'gunner', actor: 5, target: BANDIT, seconds: 2.6, miss: 16 },
    { at: 10.0, kind: 'burst', actor: BANDIT, seconds: PASS_AT - BANDIT_SWERVE - 10.0, target: STREAM_HIT },
    { at: 10.8, kind: 'gunner', actor: 0, target: BANDIT_WING, seconds: 1.1, miss: 8 },
    { at: 11.0, kind: 'burst', actor: BANDIT_WING, seconds: 0.5, target: 0 },
    { at: 11.2, kind: 'gunner', actor: 6, target: BANDIT, seconds: 1.6, miss: 20 },
    { at: 12.0, kind: 'gunner', actor: 0, target: BANDIT, seconds: 1.0, miss: 10 },
    // 右內側發動機：先冒煙，兩秒後竄出火 —— 火一下子整團冒出來的話看不出是被打的
    { at: 11.6, kind: 'smoke', actor: STREAM_HIT, engine: 0 },
    { at: 13.8, kind: 'smoke', actor: STREAM_HIT, engine: 0, fire: true },
    // 穿過去之後低空組追著它的背打
    { at: 13.4, kind: 'gunner', actor: 3, target: BANDIT, seconds: 1.8, miss: 14 },
    { at: 13.5, kind: 'gunner', actor: 6, target: BANDIT, seconds: 1.6, miss: 18 },
    // 第二波
    { at: 15.0, kind: 'gunner', actor: 3, target: SECOND, seconds: 2.4, miss: 14 },
    { at: 15.2, kind: 'gunner', actor: 4, target: SECOND, seconds: 2.2, miss: 18 },
    { at: 15.4, kind: 'gunner', actor: 5, target: SECOND, seconds: 2.4, miss: 12 },
    { at: 13.6, kind: 'burst', actor: SECOND, seconds: SECOND_PASS - SECOND_SWERVE - 13.6, target: LOW_LEAD },
    { at: SECOND_PASS + CHASE_LAG, kind: 'burst', actor: CHASER, seconds: 0.5, target: SECOND },
    { at: SECOND_DOWN, kind: 'kill', actor: SECOND, blast: true },
    // 右僚機脫隊，高砲直接命中
    { at: KILL_AT - 0.05, kind: 'flak', x: DIRECT_HIT.x, y: DIRECT_HIT.y, z: DIRECT_HIT.z },
    { at: KILL_AT, kind: 'kill', actor: STREAM_HIT, blast: true },
  ]),
}
