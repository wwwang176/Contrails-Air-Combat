import { Vector3 } from 'three'
import { B17G } from '../../specs/b17g'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import {
  BOMB_RELEASE_Y, barrage, body, bodyUp, bombAt, edit, rampedOffset, timeline, velocityAt, wingman,
  type Cut, type Path, type ReelPlane, type ReelProp, type Shot,
} from './kit'

// ── 轟炸機流 ───────────────────────────────────────────────
//
// 正午、內陸農地上空 600 m。主軸：109 攔截 → B-17 頂著攻擊不散隊、照樣飛向油廠 →
// 開彈艙投彈 → 炸彈落進油廠。被打的一方沒有退：中彈冒火的右僚機守在編隊裡把炸彈投完，
// 任務完成之後才脫隊、被高砲炸開。
//
// 地形（局部座標）：整個 `clear` 圓是平地（離地 0 m）。村子的中心在 (−40, −1760)；
// 油廠在它南邊，x −250…250、z −1270…−1540：西北是槽區、中間是動力區（鍋爐房、
// 氣櫃、一排煙囪）、東邊是冷卻塔與調車場，外圍一圈高砲。炸彈串落在廠區中間。
//
// 刀表（每一刀在主軸上的作用）：
//   0.0–2.4   長機右翼外側的發動機特寫，四周高砲炸開：編隊在投彈航線上
//   2.4–4.6   109 肩後：機背、座艙罩與兩翼在下緣，右僚機在機首前從 1 km 放大到半公里，開火
//   4.6–6.5   右僚機機鼻前、長焦：109 迎面衝來、槍口焰閃著、曳光擦過鏡頭，最後一刻
//             猛然拉起（翼尖拉出凝結尾），塞滿畫面
//   6.5–7.6   右僚機機背上往前看：109 從頭上 25 m 呼嘯而過（震一下），發動機冒煙
//   7.6–9.0   右僚機右後上方跟拍（手持）：冒煙的發動機竄出火，它仍守在隊形裡
//   9.0–10.6  長機上方砲塔、長焦：第二架 109 迎面撲來開火，機槍手迎著它打
//   10.6–11.5 第二架 109 肩後：長機在機首前放大、火花打在它身上，猛然拉起
//   11.5–14.0 長機機鼻往前下方看：油廠進到瞄準線上，黑雲四起
//   14.0–16.4 長機機腹下：彈艙打開，炸彈一枚枚落下
//   16.4–18.8 編隊後上方往下俯看：每一架機腹下拖出一串炸彈，往下方的油廠落下去
//   18.8–21.6 長機右腰窗（手持）：投完彈的右僚機脫隊，20.9 秒被高砲直接命中炸開
//   21.6–25.9 跟著長機的最後一枚炸彈往下掉：油廠在下方越來越大，前導組炸的煙已經冒起
//   25.9–29.6 地面，油廠東南邊（手持）：炸彈串落進廠區，一座座炸開起火
//   29.6–33.0 長機球形砲塔往後下方看：低空組在前景，底下整片油廠在燒

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
const STREAM_ALT = 600
/**
 * 長機第 0 秒在哪。投彈時刻與油廠的位置都綁著它：從 600 m 投下的炸彈落地要 11.9 秒、
 * 往前拋 720 m，長機 14.2 秒投下的第一枚落在 z −1350（動力區的北緣）
 */
const STREAM_Z0 = 434
const streamLead: Path = (t, out) => out.set(0, STREAM_ALT, STREAM_Z0 - STREAM_SPEED * t)

/** 長機組：長機、左僚機、右僚機（中彈的那一架） */
const leftWing = wingman(streamLead, -38, -7, 26, 0.9)
const STREAM_HIT = 2
/** 投完彈之後才脫隊 */
const DROP_AT = 18.6
const KILL_AT = 20.9
const crippledBase = wingman(streamLead, 38, 7, 26, 1.7)
/**
 * 中彈的右僚機：投完彈往右下脫隊、速度掉下來。
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

/** 109 對頭攻擊：俯角、速度、射擊窗正中那一刻離目標多遠 */
const DIVE_ANGLE = (6 * Math.PI) / 180
const FIGHTER_SPEED = 150
const FIRE_RANGE = 380
/**
 * 往下 6° 的直線第 `fireAt` 秒正好穿過目標的機身中心 —— 射擊窗以這一刻為中心。
 * 目標水平往前飛、109 微微往下衝，目標每秒偏離機首那條線 75 × sin 6° = 7.8 m；
 * 機身容許 5.3 m（僚機另有 0.5 m 的起伏），前後各 0.55 秒，距離從 500 m 打到 260 m
 */
const FIRE_HALF = 0.55
/** 從射擊窗正中到飛過目標那一個橫切面要幾秒 */
const PASS_AFTER = (Math.cos(DIVE_ANGLE) * FIRE_RANGE) / (FIGHTER_SPEED * Math.cos(DIVE_ANGLE) + STREAM_SPEED)
/** 停火之後最後一刻拉起：擦身那一刻多抬高幾公尺（直線本身已經高出 13 m） */
const PULL_UP = 12
const PULL_D = 0.3
const PULL_T = PASS_AFTER - FIRE_HALF
const PULL_GAIN = 1 / (0.5 * PULL_D * (PULL_T - PULL_D) + 0.5 * (PULL_T - PULL_D) ** 2)

/**
 * 109 從正前方對頭撲向 `target`：一條往下 6° 的直線，第 `fireAt` 秒穿過目標的機身中心、
 * 那時離它 380 m。停火的那一刻（`fireAt + FIRE_HALF`）猛然拉起，從目標頭上 25 m
 * 掠過（約 4 G，翼尖拉出凝結尾），之後往 `side` 那一側壓坡度轉開。
 *
 * 【拉起只能在停火之後】曳光沿機首直直打出去；一拉起機首就離開目標
 * 【擦身的間距】B-17 加 109 的半翼展和是 20.8 m，僚機另有 ±2 m 的起伏
 */
function diveOn(target: Path, fireAt: number, side: number): Path {
  const aim = target(fireAt, new Vector3())
  const sy = Math.sin(DIVE_ANGLE)
  const cz = Math.cos(DIVE_ANGLE)
  const x0 = aim.x
  const y0 = aim.y + sy * FIRE_RANGE
  const z0 = aim.z - cz * FIRE_RANGE
  const pullFrom = fireAt + FIRE_HALF
  const pass = fireAt + PASS_AFTER
  return (t, out) => {
    const s = FIGHTER_SPEED * (t - fireAt)
    out.set(x0, y0 - sy * s, z0 + cz * s)
    out.y += PULL_UP * PULL_GAIN * (rampedOffset(t, pullFrom, PULL_D, 1) - rampedOffset(t, pass - PULL_D, PULL_D, 1))
    out.x += side * rampedOffset(t, pass + 0.3, 1.5, 9)
    out.z -= rampedOffset(t, pass + 0.3, 1.5, 10)
    return out
  }
}
/** 第一架：撲向右僚機 */
const FIRE_1 = 5.0
const PASS_1 = FIRE_1 + PASS_AFTER
const bandit = diveOn(crippledBase, FIRE_1, 1)
const BANDIT = 9
/** 第二架：撲向長機，打中左外側發動機 */
const FIRE_2 = 10.0
const bandit2 = diveOn(streamLead, FIRE_2, -1)
const BANDIT_2 = 10

const escort = (dx: number, dy: number, dz: number, phase: number): Path => (t, out) => {
  streamLead(t, out)
  out.x += dx + 110 * Math.sin(0.33 * t + phase)
  out.y += dy + 14 * Math.sin(0.47 * t + phase)
  out.z += dz
  return out
}

/** 前導組：長機組右前上方，先投彈 —— 它的炸彈 21.6 秒起落在廠區東半，煙先冒起來 */
const forwardA = wingman(streamLead, 130, 70, -460, 0.5)
const forwardB = wingman(streamLead, 175, 62, -500, 2.9)
const FORWARD_A = 11
const FORWARD_B = 12

/** 長機組開始投彈的時刻；一串十枚、每 0.26 秒一枚 */
const BOMBS_AWAY = 14.2
const BOMB_GAP = 0.26
/** 長機最後一枚炸彈：投下那一刻的機腹點與速度，第 21.6～25.9 秒鏡頭跟著它往下掉 */
const LAST_DROP = BOMBS_AWAY + 9 * BOMB_GAP
const LAST_P = body(streamLead, LAST_DROP, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const LAST_V = velocityAt(streamLead, LAST_DROP, new Vector3())
const LAST_BOMB = new Vector3()

/** 油廠的中心：鏡頭的注視點 */
const PLANT = new Vector3(-10, 0, -1400)

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
    from: 2.4, subject: STREAM_HIT, mount: BANDIT,
    camera(t, out) {
      // 109 的肩後：座艙後上方 7 m、高 2.2 m，畫面下三分之一是自己的機背、座艙罩與兩側
      // 機翼；順著機首那條線看出去，右僚機在畫面中央從 1 km 放大到半公里，4.45 秒開火、
      // 曳光從機翼往前收向它。掛在機上、跟著機身滾轉，不晃
      body(bandit, t, 0.5, 2.2, 7.0, false, out.position)
      body(bandit, t, 0, 0.6, -300, false, out.target)
      bodyUp(bandit, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 4.6, subject: BANDIT, mount: STREAM_HIT,
    camera(t, out) {
      // 右僚機機鼻正前方往前看、長焦：109 迎面從 470 m 衝到頭頂，槍口焰閃著、曳光擦著
      // 鏡頭打進機身，火花就噴在鏡頭旁。最後一刻它猛然拉起，注視點跟著它往上甩。
      // 鏡頭離機鼻再近就進了測試的螺旋槳盤範圍
      body(crippled, t, 0, -1.0, -8.2, false, out.position)
      body(crippled, t, 0, 0, -400, false, S1)
      bandit(t, S2)
      aimBetween(out.position, S1, S2, 0.92, out.target)
      shake(t, 0.12, 21, out.target)
      bodyUp(crippled, t, out.up)
      out.fov = 30
    },
  },
  {
    from: 6.5, subject: STREAM_HIT, mount: STREAM_HIT,
    camera(t, out) {
      // 右僚機機背上、上方砲塔後面往前看：機身與冒煙的右內側發動機在前下方，109 從
      // 頭上 25 m 呼嘯而過（6.69 秒，鏡頭震一下）
      body(crippled, t, 0, 3.4, 7.5, false, out.position)
      body(crippled, t, 2, -2, -60, false, S1)
      out.target.copy(S1)
      jolt(t, PASS_1, 1.2, out.target)
      bodyUp(crippled, t, out.up)
      out.fov = 60
    },
  },
  {
    from: 7.6, subject: STREAM_HIT,
    camera(t, out) {
      // 右僚機右後上方 35 m 跟拍（手持 0.2°）：冒煙的右內側發動機（`enginePoints[0]`，
      // 機體 x +3.05）7.8 秒竄出火，它仍守在隊形裡、長機在它左前方。再貼近的話煙尾從
      // 鏡頭旁流過，整架隔著一層煙
      body(crippled, t, 25, 11, 22, true, out.position)
      shake(t, 0.08, 13, out.position)
      body(crippled, t, -4, 0, -4, true, out.target)
      shake(t, 0.15, 14, out.target)
      out.fov = 44
    },
  },
  {
    from: 9.0, subject: BANDIT_2, mount: 0,
    camera(t, out) {
      // 長機上方砲塔往前上方看、長焦：第二架 109 從 600 m 外迎面撲來、開火，砲塔的
      // 曳光迎著它打。掛在機上，只留 0.1° 的慢晃
      body(streamLead, t, 0.6, 3.0, -0.5, false, out.position)
      body(streamLead, t, 0, -20, -400, false, S1)
      bandit2(t, S2)
      aimBetween(out.position, S1, S2, 0.9, out.target)
      shake(t, 0.15, 15, out.target)
      out.fov = 26
    },
  },
  {
    from: 10.6, subject: 0, mount: BANDIT_2,
    camera(t, out) {
      // 第二架 109 的肩後（同第一架的機位）：長機在機首前從 300 m 放大到整個機翼橫跨畫面，
      // 火花打在它身上；10.55 秒停火猛然拉起，長機往畫面下緣滑。
      // 【注視點往長機偏一點】拉起之後機首離開長機，只看機首線的話長機掉出下緣。
      // 掛在機上、跟著機身滾轉，不晃
      body(bandit2, t, 0.5, 2.2, 7.0, false, out.position)
      streamLead(t, S1)
      body(bandit2, t, 0, 0.6, -300, false, S2)
      aimBetween(out.position, S1, S2, 0.7, out.target)
      bodyUp(bandit2, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 11.5, subject: null, mount: 0,
    camera(t, out) {
      // 長機機鼻正前方 1.8 m（投彈手的位置）往前下方看：油廠在前下方的田裡，越來越近，
      // 黑雲在前方炸開。鏡頭離機鼻再近就進了測試的螺旋槳盤範圍
      body(streamLead, t, 0, -1.0, -8.2, false, out.position)
      out.target.copy(PLANT)
      shake(t, 0.4, 16, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 14.0, subject: null, mount: 0,
    camera(t, out) {
      // 機腹下、彈艙後方往前下方看：炸彈一枚枚從機腹落下、往後飄過鏡頭下方
      body(streamLead, t, 1.6, -3.4, 7.0, false, out.position)
      body(streamLead, t, 0, -6, -3, false, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 62
    },
  },
  {
    from: 16.4, subject: 0,
    camera(t, out) {
      // 編隊後上方 120 m 往下俯看（伴飛機，手持 0.15°）：整個編隊在畫面裡，
      // 每一架機腹下拖出一串炸彈，一串串往下方的油廠落下去 —— 地毯式轟炸。
      // 【鏡頭的上方取機首方向】幾乎正朝下看，世界的上方退化，畫面會亂轉
      streamLead(t, out.position).add(S1.set(-30, 120, 150))
      shake(t, 0.2, 17, out.position)
      streamLead(t, out.target).add(S1.set(-35, -70, 30))
      shake(t, 0.3, 18, out.target)
      out.up.set(0, 0, -1)
      out.fov = 62
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
    from: 21.6, subject: null,
    camera(t, out) {
      // 跟著長機的最後一枚炸彈往下掉：鏡頭在它後上方幾公尺，炸彈在畫面下半，前面幾枚
      // 在更下方；油廠在正下方越來越大，前導組炸的火與煙已經冒起來。這一刀結束時
      // 炸彈還在 215 m 高
      bombAt(LAST_P, LAST_V, t - LAST_DROP, LAST_BOMB)
      out.position.copy(LAST_BOMB).add(S1.set(1.6, 2.2, 3.4))
      shake(t, 0.05, 19, out.position)
      aimBetween(out.position, LAST_BOMB, PLANT, 0.4, out.target)
      out.fov = 54
    },
  },
  {
    from: 25.9, subject: null,
    camera(t, out) {
      // 地面，油廠東南邊的田上 80 m（再低廠區就躲在林緣後面）：炸彈串一串串落進廠區、
      // 一座座炸開起火。手持 0.25° 上下，第一串落地時震一下
      out.position.set(430, 80, -1050)
      shake(t, 0.6, 7, out.position)
      streamLead(t, S1)
      aimBetween(out.position, PLANT, S1, 0.12, out.target)
      shake(t, 0.7, 8, out.target)
      jolt(t, 26.1, 0.9, out.target)
      out.fov = 50
    },
  },
  {
    from: 29.6, subject: LOW_LEAD, mount: 0,
    camera(t, out) {
      // 球形砲塔：機腹下往左後下方看，低空組在前景，底下整片油廠在燒。掛在機上，不晃
      body(streamLead, t, 0, -2.6, 2.0, false, out.position)
      body(streamLead, t, -90, -200, 190, false, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 64
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
  { spec: BF109K4, path: bandit2 },
  { spec: B17G, path: forwardA, extra: true },
  { spec: B17G, path: forwardB, extra: true },
]

/**
 * 油廠：西北槽區、西南堆場、中間動力區、東邊冷卻塔與調車場，外圍一圈重高砲，
 * 佔地約 600 × 360 m、60 件（每件一個繪製呼叫）。
 * 長機組與低空組的炸彈串落在 x −115…80、z −1315…−1525，炸掉動力區全部與槽區東排；
 * 前導組炸掉南邊那座冷卻塔與水塔。槽區西半、堆場、北邊兩座冷卻塔與東邊兩根煙囪、
 * 調車場與高砲陣地留著 —— 炸中了，也看得出廠很大。炸彈落在命中盒外擴 15 m 內就炸毀起火
 */
const PROPS: readonly ReelProp[] = [
  // 槽區（西北，裸土的防溢堤裡）：四排三列的油槽（直徑 25 m）、南邊兩座油桶堆
  ...[-230, -190, -150, -110].flatMap((x) => [-1290, -1330, -1370].map((z) => ({ id: 'oilTank' as const, x, z, heading: 0 }))),
  { id: 'fuelDump', x: -200, z: -1395, heading: 0 },
  { id: 'fuelDump', x: -150, z: -1395, heading: 0 },
  // 西南的堆場（裸土）：油桶堆與彈藥堆
  { id: 'fuelDump', x: -230, z: -1490, heading: 0 },
  { id: 'fuelDump', x: -190, z: -1490, heading: 0 },
  { id: 'bombDump', x: -230, z: -1520, heading: 0 },
  { id: 'bombDump', x: -160, z: -1515, heading: 0 },
  // 動力區（中間）：兩座氣櫃、兩棟鍋爐房、一排四根煙囪（中間留廠內大路）
  { id: 'gasHolder', x: -55, z: -1385, heading: 0 },
  { id: 'gasHolder', x: -55, z: -1470, heading: 0 },
  { id: 'boilerHouse', x: 5, z: -1395, heading: 0 },
  { id: 'boilerHouse', x: 5, z: -1465, heading: 0 },
  ...[-1375, -1395, -1455, -1475].map((z) => ({ id: 'chimney' as const, x: 55, z, heading: 0 })),
  // 東邊：三座冷卻塔、兩根煙囪、兩座水塔。炸彈串碰不到冷卻塔北邊兩座與這兩根煙囪 ——
  // 炸後畫面裡還有白色蒸汽，與燒著的槽區、氣櫃冒的黑煙並存
  { id: 'coolingTower', x: 115, z: -1310, heading: 0 },
  { id: 'coolingTower', x: 115, z: -1360, heading: 0 },
  { id: 'coolingTower', x: 115, z: -1455, heading: 0 },
  { id: 'chimney', x: 160, z: -1340, heading: 0 },
  { id: 'chimney', x: 160, z: -1365, heading: 0 },
  { id: 'hydroTower', x: 165, z: -1295, heading: 0 },
  { id: 'hydroTower', x: 165, z: -1515, heading: 0 },
  // 調車場（東，碴石）：兩條線上停三列車
  { id: 'locomotive', x: 210, z: -1290, heading: 0 },
  { id: 'tender', x: 210, z: -1302, heading: 0 },
  ...[-1312, -1322, -1332, -1342, -1352, -1362].map((z) => ({ id: 'boxcar' as const, x: 210, z, heading: 0 })),
  ...[-1430, -1440, -1450, -1460].map((z) => ({ id: 'boxcar' as const, x: 210, z, heading: 0 })),
  { id: 'locomotive', x: 226, z: -1400, heading: 0 },
  { id: 'tender', x: 226, z: -1412, heading: 0 },
  ...[-1423, -1434, -1445, -1456].map((z) => ({ id: 'flatcar' as const, x: 226, z, heading: 0 })),
  // 外圍一圈重高砲陣地與調車場邊的一門輕高砲
  { id: 'flakHeavy', x: -300, z: -1310, heading: 0.8 },
  { id: 'flakHeavy', x: -300, z: -1500, heading: 2.3 },
  { id: 'flakHeavy', x: -130, z: -1585, heading: 2.8 },
  { id: 'flakHeavy', x: 90, z: -1585, heading: 3.4 },
  { id: 'flakHeavy', x: 300, z: -1500, heading: 4.0 },
  { id: 'flakHeavy', x: 300, z: -1300, heading: 5.2 },
  { id: 'flakHeavy', x: 110, z: -1225, heading: 5.8 },
  { id: 'flakHeavy', x: -160, z: -1225, heading: 0.3 },
  { id: 'flakLight', x: 260, z: -1400, heading: 4.5 },
]

export const STREAM: Shot = {
  id: 'stream',
  duration: 33,
  timeOfDay: 'noon',
  faceSun: false,
  terrain: 'farmland',
  // 水泥墊面貼著物件；槽區與西南堆場是裸土、調車場是碴石。廠內一條東西大路串起
  // 槽區、動力區、冷卻塔與調車場，一條南北路從北門接到村子（中心 (−40, −1760)）、
  // 從南門往南拉出去；西門接上廠區西北角外那條斜穿田野的凹路。鐵路南北貫穿調車場
  ground: {
    // 【矩形比物件的範圍內縮約 80 m】墊面的不規則邊往矩形外鋪出去好幾十公尺；照物件的
    // 範圍給的話，四周多出一大圈空灰
    pad: { x0: -165, z0: -1460, x1: 165, z1: -1350 },
    patches: [
      { x0: -250, z0: -1412, x1: -94, z1: -1276, hex: 0x6b5f4e },
      { x0: -250, z0: -1536, x1: -140, z1: -1478, hex: 0x6b5f4e },
      { x0: 197, z0: -1536, x1: 246, z1: -1276, hex: 0x5f5a52 },
    ],
    treeClear: 60,
    roads: [
      [{ x: -272, z: -1436 }, { x: -255, z: -1428 }, { x: 197, z: -1428 }],
      [{ x: -200, z: -500 }, { x: -120, z: -1000 }, { x: -88, z: -1272 }, { x: -88, z: -1540 },
        { x: -70, z: -1630 }, { x: -45, z: -1705 }],
    ],
    rails: [[{ x: 218, z: -4500 }, { x: 218, z: 1500 }]],
  },
  // 半徑決定執行時落在農地的哪裡（`openSeaOrigin` 躲山丘）：3,750～4,500 m 落在
  // (12990, 7500)，村子就在圓心的 (−145, +581)。改了半徑，村子就不在油廠北邊
  clear: { x: 105, z: -2341, radius: 4400 },
  planes: PLANES,
  props: PROPS,
  decor: [
    { kind: 'hall', x: -170, z: -1640, heading: 0 },
    { kind: 'warehouse', x: -100, z: -1640, heading: 0 },
    { kind: 'office', x: -40, z: -1640, heading: 0 },
    { kind: 'pipeRack', x: 30, z: -1640, heading: 0 },
    { kind: 'tanks', x: 100, z: -1640, heading: 0 },
  ],
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    ...barrage(101, 0, 32, 2.0, (t, out) => streamLead(t, out).add(S3.set(-20, -20, 70)),
      { x: 190, yLo: -80, yHi: 100, z: 240 }, edit(CUTS), 70),
    // 投彈航線上：長機組前方的一片彈幕，編隊直直飛進去
    ...barrage(202, 11.5, 17, 3.0, (t, out) => streamLead(t, out).add(S3.set(10, 10, -260)),
      { x: 160, yLo: -50, yHi: 90, z: 160 }, edit(CUTS), 70),
    // 第一架 109 撲向右僚機：編隊的機槍手迎著它打，它從 500 m 打到 260 m
    { at: 2.6, kind: 'gunner', actor: STREAM_HIT, target: BANDIT, seconds: 4.0, miss: 14 },
    { at: 3.0, kind: 'gunner', actor: 0, target: BANDIT, seconds: 3.4, miss: 12 },
    { at: 3.4, kind: 'gunner', actor: 6, target: BANDIT, seconds: 3.0, miss: 18 },
    { at: 3.8, kind: 'gunner', actor: 3, target: BANDIT, seconds: 2.8, miss: 16 },
    { at: FIRE_1 - FIRE_HALF, kind: 'burst', actor: BANDIT, seconds: 2 * FIRE_HALF, target: STREAM_HIT },
    // 右內側發動機：先冒煙，兩秒後竄出火 —— 火一下子整團冒出來的話看不出是被打的
    { at: 5.6, kind: 'smoke', actor: STREAM_HIT, engine: 0 },
    { at: 7.8, kind: 'smoke', actor: STREAM_HIT, engine: 0, fire: true },
    // 衝過去之後低空組追著它的背打
    { at: 6.8, kind: 'gunner', actor: 5, target: BANDIT, seconds: 1.8, miss: 14 },
    { at: 7.0, kind: 'gunner', actor: 3, target: BANDIT, seconds: 1.6, miss: 18 },
    // 第二架 109 撲向長機
    { at: 8.4, kind: 'gunner', actor: 0, target: BANDIT_2, seconds: 3.2, miss: 10 },
    { at: 8.8, kind: 'gunner', actor: 1, target: BANDIT_2, seconds: 2.8, miss: 14 },
    { at: 9.0, kind: 'gunner', actor: STREAM_HIT, target: BANDIT_2, seconds: 2.4, miss: 16 },
    { at: FIRE_2 - FIRE_HALF, kind: 'burst', actor: BANDIT_2, seconds: 2 * FIRE_HALF, target: 0 },
    { at: 10.6, kind: 'smoke', actor: 0, engine: 3 },
    // 投彈：前導組先投，長機組、低空組、右上那一架照順序
    { at: 8.6, kind: 'bomb', actor: FORWARD_B, count: 8, interval: 0.3 },
    { at: 9.1, kind: 'bomb', actor: FORWARD_A, count: 8, interval: 0.3 },
    { at: BOMBS_AWAY, kind: 'bomb', actor: 0, count: 10, interval: BOMB_GAP },
    { at: BOMBS_AWAY + 0.1, kind: 'bomb', actor: 1, count: 10, interval: BOMB_GAP },
    { at: BOMBS_AWAY + 0.15, kind: 'bomb', actor: STREAM_HIT, count: 10, interval: BOMB_GAP },
    { at: 15.7, kind: 'bomb', actor: 3, count: 8, interval: 0.3 },
    { at: 16.0, kind: 'bomb', actor: 4, count: 8, interval: 0.3 },
    { at: 16.0, kind: 'bomb', actor: 5, count: 8, interval: 0.3 },
    { at: 16.2, kind: 'bomb', actor: 6, count: 8, interval: 0.3 },
    // 右僚機投完彈脫隊，高砲直接命中
    { at: KILL_AT - 0.05, kind: 'flak', x: DIRECT_HIT.x, y: DIRECT_HIT.y, z: DIRECT_HIT.z },
    { at: KILL_AT, kind: 'kill', actor: STREAM_HIT, blast: true },
  ]),
}
