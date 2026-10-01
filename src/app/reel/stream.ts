import { Vector3 } from 'three'
import { B17G } from '../../specs/b17g'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import {
  BOMB_RELEASE_Y, barrage, body, bodyUp, bombAt, edit, rampedOffset, timeline, velocityAt, wingman,
  type Cut, type Path, type ReelDecor, type ReelPlane, type ReelProp, type Shot,
} from './kit'

// ── 轟炸機流 ───────────────────────────────────────────────
//
// 正午、內陸農地上空 600 m。主軸：109 攔截 → B-17 頂著攻擊不散隊、照樣飛向油廠 →
// 開彈艙投彈 → 炸彈落進油廠。被打的一方沒有退：中彈冒火的右僚機守在編隊裡，進入投彈
// 航線時被高砲炸開，其餘的照樣飛過去把炸彈投完。
//
// 地形（局部座標）：整個 `clear` 圓是平地（離地 0 m）。村子的中心在 (−40, −1760)；
// 油廠在它東南邊，x 30…930、z −1500…−870：西北是槽區、正中間是動力區（鍋爐房、
// 氣櫃、一排煙囪）、南邊兩排廠房、東邊是冷卻塔、倉庫與調車場，外圍一圈高砲。炸彈串落在正中間。
//
// 刀表（每一刀在主軸上的作用）：
//   0.0–2.4   長機右翼外側的發動機特寫，四周高砲炸開：編隊在投彈航線上
//   2.4–4.6   109 肩後：機背、座艙罩與兩翼在下緣，右僚機在機首前從 1 km 放大到半公里，開火
//   4.6–6.5   右僚機機鼻前、長焦：109 迎面衝來、槍口焰閃著、曳光擦過鏡頭，最後一刻
//             猛然拉起（翼尖拉出凝結尾），塞滿畫面
//   6.5–7.6   右僚機機背上往前看：109 從頭上 25 m 呼嘯而過（震一下），發動機冒煙
//   7.6–9.0   右僚機右後上方跟拍（手持）：冒煙的發動機竄出火，它仍守在隊形裡
//   9.0–10.6  平行跟拍第二架 109（手持）：它在前景俯衝開火，長機與編隊在前方放大，曳光交錯
//   10.6–11.9 低空組長機的上方砲塔往前上方看：第二架 109 撲向長機、火花打在長機身上，
//             最後一刻從長機頭上拉起掠過
//   11.9–13.6 長機右腰窗（手持）：拖著火的右僚機進入投彈航線時被高砲直接命中炸開，編隊不散
//   13.6–16.4 長機機腹下：油廠在前下方，彈艙打開，炸彈一枚枚落下
//   16.4–20.4 編隊後上方往下俯看：每一架機腹下拖出一串炸彈，往下方的油廠落下去
//   20.4–25.9 跟著長機的最後一枚炸彈往下掉：完好的油廠在下方越來越大，下一刀從第一聲爆炸開始
//   25.9–28.6 貼地在動力區北邊往南看（手持）：長機那一串一顆接一顆朝鏡頭走過來，
//             鍋爐房炸開，最後一顆落在 70 m 外
//   28.6–30.8 低角度仰拍一排煙囪：一串炸彈沿著煙囪排落下，煙囪一根接一根被炸黑、底下竄出火
//   30.8–33.0 長機球形砲塔往後下方看：低空組在前景，底下整片油廠在燒

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
 * 往前拋 720 m，長機 14.2 秒投下的第一枚落在 (450, −1112)，一串掃到 z −1287 ——
 * 廠區的正中間
 */
const STREAM_X0 = 450
const STREAM_Z0 = 671
const streamLead: Path = (t, out) => out.set(STREAM_X0, STREAM_ALT, STREAM_Z0 - STREAM_SPEED * t)

/** 長機組：長機、左僚機、右僚機（中彈的那一架） */
const leftWing = wingman(streamLead, -38, -7, 26, 0.9)
const STREAM_HIT = 2
/**
 * 中彈的右僚機拖著火守在隊形裡，進入投彈航線時被高砲直接命中炸開 —— 它那一串炸彈
 * 沒投出去。編隊不散，照樣飛向目標
 */
const KILL_AT = 12.9
const crippledBase = wingman(streamLead, 38, 7, 26, 1.7)
const crippled = crippledBase

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
const bandit = diveOn(crippledBase, FIRE_1, -1)
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

/**
 * 前導組：長機組右前上方，只當背景不投彈。
 * 【不能先炸】它在長機組前方 500 m，炸同一個目標的話炸彈早 6 秒落地 —— 廠區會在
 * 「跟著炸彈掉下去」那一刀之前就著火，故事倒過來
 */
const forwardA = wingman(streamLead, 130, 70, -460, 0.5)
const forwardB = wingman(streamLead, 175, 62, -500, 2.9)

/** 長機組開始投彈的時刻；一串十枚、每 0.26 秒一枚 */
const BOMBS_AWAY = 14.2
const BOMB_GAP = 0.26
/** 長機最後一枚炸彈：投下那一刻的機腹點與速度，第 20.4～25.9 秒鏡頭跟著它往下掉 */
const LAST_DROP = BOMBS_AWAY + 9 * BOMB_GAP
const LAST_P = body(streamLead, LAST_DROP, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const LAST_V = velocityAt(streamLead, LAST_DROP, new Vector3())
const LAST_BOMB = new Vector3()

/** 油廠的中心：鏡頭的注視點 */
const PLANT = new Vector3(450, 0, -1200)

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
    from: 9.0, subject: BANDIT_2,
    camera(t, out) {
      // 平行跟拍第二架 109：鏡頭在它右後上方 19 m 跟著它一起俯衝（伴飛機，手持 0.25°），
      // 109 在前景偏左、機翼的曳光往前收向長機，長機與編隊在右前方越來越大，編隊的
      // 機槍手曳光反打回來 —— 兩邊的曳光交錯。
      // 【鏡頭不能太偏側面】109 與長機在畫面上拉得太開的話，左邊的 109 躲進選單後面
      body(bandit2, t, 8, 3.5, 17, true, out.position)
      shake(t, 0.25, 22, out.position)
      bandit2(t, S1)
      streamLead(t, S2)
      aimBetween(out.position, S1, S2, 0.6, out.target)
      shake(t, 0.35, 23, out.target)
      out.fov = 50
    },
  },
  {
    from: 10.6, subject: 0, mount: LOW_LEAD,
    camera(t, out) {
      // 低空組長機的上方砲塔往右前上方看：長機在前上方 140 m，第二架 109 從它正前方
      // 衝來、火花打在長機身上，11.69 秒猛然拉起從長機頭上掠過、翼尖拖著凝結尾。
      // 攻擊者與被攻擊者同框，從後方第三者的位置看。掛在機上，只留 0.1° 的慢晃
      body(lowLead, t, 1.0, 3.1, -0.5, false, out.position)
      streamLead(t, S1)
      bandit2(t, S2)
      aimBetween(out.position, S1, S2, 0.3, out.target)
      shake(t, 0.15, 20, out.target)
      bodyUp(lowLead, t, out.up)
      out.fov = 36
    },
  },
  {
    from: 11.9, subject: STREAM_HIT, mount: 0,
    camera(t, out) {
      // 長機右腰窗：機槍手的視角，自己的平尾壓在畫面上緣。拖著火守在隊形裡的右僚機
      // 12.9 秒被高砲直接命中炸開（震一下）；長機照樣往前飛。
      // 【鏡頭位置不晃】平尾離鏡頭 3 m，位置晃 0.3 m 它就在畫面上跳 5°；只轉方向
      body(streamLead, t, 2.1, 0.5, 9.2, false, out.position)
      crippled(t - 0.2, out.target)
      shake(t, 0.4, 6, out.target)
      jolt(t, KILL_AT, 1.4, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 52
    },
  },
  {
    from: 13.6, subject: null, mount: 0,
    camera(t, out) {
      // 機腹下、彈艙後方往前下方看：前下方的田裡是油廠，14.2 秒炸彈一枚枚從機腹落下、
      // 往後飄過鏡頭下方
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
    from: 20.4, subject: null,
    camera(t, out) {
      // 跟著長機的最後一枚炸彈往下掉：鏡頭在它後上方幾公尺，炸彈在畫面下半，前面幾枚
      // 在更下方；完好的油廠在正下方越來越大，冷卻塔冒著白汽。這一刀結束時炸彈還在
      // 215 m 高，0.13 秒後第一顆落地 —— 下一刀就從那一聲開始。
      // 【這一刀之前廠區不能有火】觀眾第一次看到廠區爆炸，要在跟著炸彈掉下去之後
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
      // 貼地架在動力區北邊、氣櫃與鍋爐房之間的空隙口，離地 20 m 往南看（手持 0.25°）：
      // 左僚機那一串沿著空隙、長機那一串貼著鍋爐房，從 250 m 外一顆接一顆朝鏡頭「走」
      // 過來 —— 每 0.26 秒一顆、每顆近 19 m，鍋爐房 28.1 秒炸開，最後一顆 28.41 秒落在
      // 70 m 外，一顆比一顆震得兇。
      // 【鏡頭要在空隙口】架在鍋爐房正後方的話，整面牆擋住畫面
      // 【不再靠近】炸彈的火球半徑幾十公尺，最後一顆再近鏡頭就鑽進火裡、整片紅
      out.position.set(415, 20, -1355)
      shake(t, 0.3, 7, out.position)
      out.target.set(425, 12, -1180)
      shake(t, 0.5, 8, out.target)
      jolt(t, 27.63, 0.5, out.target)
      jolt(t, 27.89, 0.7, out.target)
      jolt(t, 28.1, 1.2, out.target)
      jolt(t, 28.41, 1.8, out.target)
      out.fov = 56
    },
  },
  {
    from: 28.6, subject: null,
    camera(t, out) {
      // 低角度仰拍一排四根煙囪（百公尺高），鏡頭在它們北端外 60 m、離地 12 m：右上僚機的
      // 一串沿著煙囪排落下來，29.0、29.6、30.2、30.56 秒一根接一根被炸黑、底下竄出火，
      // 最後一根就在鏡頭前（每根震一下，越近越兇）。炸毀的物件只換焦黑材質、不會倒
      out.position.set(505, 12, -1360)
      shake(t, 0.2, 9, out.position)
      out.target.set(522, 55, -1230)
      shake(t, 0.4, 10, out.target)
      jolt(t, 29.0, 0.5, out.target)
      jolt(t, 29.64, 0.8, out.target)
      jolt(t, 30.25, 1.2, out.target)
      jolt(t, 30.56, 1.8, out.target)
      out.fov = 58
    },
  },
  {
    from: 30.8, subject: LOW_LEAD, mount: 0,
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
 * 油廠：佔地約 950 × 630 m（x 30…930、z −1500…−870），村子在它西北角外。
 * 可炸的物件 60 件（每件一個繪製呼叫）撐住會冒火冒煙的部分，廠房、倉庫、辦公樓、
 * 管架與小槽組用佈景建築（`DECOR`，整批一個繪製呼叫）鋪出規模。
 *
 * 炸彈串落在 x 340…625、z −1085…−1385（廠區正中間）：炸掉動力區、中東的槽組、
 * 幾棟北排廠房與管架；西北槽區、南排廠房、東邊的冷卻塔、倉庫、調車場與高砲陣地
 * 留著 —— 從投彈視角看得出炸中了一大片、但廠還很大。冷卻塔與煙囪活著時冒白汽，
 * 燒著的氣櫃與油槽冒黑煙，兩種並存。炸彈落在命中盒外擴 15 m 內就炸毀起火
 */
const PROPS: readonly ReelProp[] = [
  // 西北槽區（裸土的防溢堤裡）：油槽兩排四座、旁邊兩座油桶堆
  ...[60, 100, 140, 180].flatMap((x) => [-1470, -1430].map((z) => ({ id: 'oilTank' as const, x, z, heading: 0 }))),
  { id: 'fuelDump', x: 60, z: -1385, heading: 0 },
  { id: 'fuelDump', x: 110, z: -1385, heading: 0 },
  // 中東的槽組（裸土）：前導組的炸彈落在這裡，冒黑煙
  ...[600, 640].flatMap((x) => [-1340, -1380].map((z) => ({ id: 'oilTank' as const, x, z, heading: 0 }))),
  // 南邊的堆場（裸土）：油桶堆與彈藥堆
  { id: 'fuelDump', x: 60, z: -940, heading: 0 },
  { id: 'fuelDump', x: 110, z: -940, heading: 0 },
  { id: 'bombDump', x: 165, z: -940, heading: 0 },
  { id: 'bombDump', x: 215, z: -940, heading: 0 },
  // 動力區（正中間）：兩座氣櫃、兩棟鍋爐房、一排四根煙囪
  { id: 'gasHolder', x: 380, z: -1290, heading: 0 },
  { id: 'gasHolder', x: 380, z: -1200, heading: 0 },
  { id: 'boilerHouse', x: 460, z: -1285, heading: 0 },
  { id: 'boilerHouse', x: 460, z: -1195, heading: 0 },
  ...[-1300, -1265, -1220, -1185].map((z) => ({ id: 'chimney' as const, x: 520, z, heading: 0 })),
  // 東邊：三座冷卻塔、兩根煙囪、兩座水塔，炸彈串碰不到
  { id: 'coolingTower', x: 740, z: -1330, heading: 0 },
  { id: 'coolingTower', x: 740, z: -1270, heading: 0 },
  { id: 'coolingTower', x: 740, z: -1210, heading: 0 },
  { id: 'chimney', x: 790, z: -1300, heading: 0 },
  { id: 'chimney', x: 790, z: -1240, heading: 0 },
  { id: 'hydroTower', x: 865, z: -1470, heading: 0 },
  { id: 'hydroTower', x: 865, z: -1050, heading: 0 },
  // 調車場（最東，碴石）：兩條線上停三列車
  { id: 'locomotive', x: 897, z: -1450, heading: 0 },
  { id: 'tender', x: 897, z: -1438, heading: 0 },
  ...[-1428, -1418, -1408, -1398, -1388, -1378].map((z) => ({ id: 'boxcar' as const, x: 897, z, heading: 0 })),
  { id: 'locomotive', x: 913, z: -1250, heading: 0 },
  { id: 'tender', x: 913, z: -1238, heading: 0 },
  ...[-1227, -1216, -1205, -1194].map((z) => ({ id: 'flatcar' as const, x: 913, z, heading: 0 })),
  ...[-1100, -1090, -1080, -1070].map((z) => ({ id: 'boxcar' as const, x: 897, z, heading: 0 })),
  // 外圍一圈重高砲陣地與調車場邊的一門輕高砲
  { id: 'flakHeavy', x: -40, z: -1450, heading: 0.8 },
  { id: 'flakHeavy', x: -50, z: -1150, heading: 1.6 },
  { id: 'flakHeavy', x: -30, z: -860, heading: 2.3 },
  { id: 'flakHeavy', x: 360, z: -820, heading: 3.0 },
  { id: 'flakHeavy', x: 640, z: -820, heading: 3.5 },
  { id: 'flakHeavy', x: 985, z: -900, heading: 4.0 },
  { id: 'flakHeavy', x: 990, z: -1320, heading: 4.8 },
  { id: 'flakHeavy', x: 560, z: -1580, heading: 5.8 },
  { id: 'flakLight', x: 850, z: -1010, heading: 4.5 },
]

/** 東西向擺的管架：長邊沿 X */
const EW = Math.PI / 2

/**
 * 佈景建築：南邊兩排廠房（中間是廠內大路）、東邊一排倉庫、西邊辦公區、北緣一排倉庫，
 * 管架把槽區、動力區與冷卻塔串起來。長邊沿 Z，`EW` 的那幾件轉成東西向
 */
const DECOR: readonly ReelDecor[] = [
  // 南邊兩排廠房（30 × 60 m，南北向），南北大路（x 300）兩側
  ...[40, 120, 200, 380, 460, 540, 620, 700, 780].flatMap((x) => [-1060, -900].map((z) => ({ kind: 'hall' as const, x, z, heading: 0 }))),
  // 東邊一排倉庫，靠著調車場
  ...[-1390, -1320, -1250, -1180, -1110].map((z) => ({ kind: 'warehouse' as const, x: 830, z, heading: 0 })),
  // 北緣一排倉庫（東西向）
  ...[400, 480, 560, 640, 720, 800].map((x) => ({ kind: 'warehouse' as const, x, z: -1535, heading: EW })),
  // 東西大路北側一排辦公樓（東西向）
  ...[40, 120, 200, 380, 460, 540, 620, 700, 780].map((x) => ({ kind: 'office' as const, x, z: -1008, heading: EW })),
  // 西邊辦公區、兩棟廠房與兩棟倉庫
  ...[40, 100].flatMap((x) => [-1300, -1240].map((z) => ({ kind: 'office' as const, x, z, heading: 0 }))),
  { kind: 'hall', x: 180, z: -1290, heading: 0 },
  { kind: 'hall', x: 260, z: -1290, heading: 0 },
  { kind: 'warehouse', x: 120, z: -1160, heading: EW },
  { kind: 'warehouse', x: 220, z: -1160, heading: EW },
  // 西北角：槽區北邊三棟倉庫（東西向）
  ...[60, 140, 220].map((x) => ({ kind: 'warehouse' as const, x, z: -1535, heading: EW })),
  // 小槽組：槽區東邊與北緣
  ...[240, 330, 560, 640, 720].map((x) => ({ kind: 'tanks' as const, x, z: -1475, heading: 0 })),
  // 管架：北邊一條東西向的主管線，兩條南北向的支線接動力區與冷卻塔
  ...[290, 410, 530, 650, 770].map((x) => ({ kind: 'pipeRack' as const, x, z: -1420, heading: EW })),
  { kind: 'pipeRack', x: 560, z: -1230, heading: 0 },
  { kind: 'pipeRack', x: 690, z: -1300, heading: 0 },
]

export const STREAM: Shot = {
  id: 'stream',
  duration: 33,
  timeOfDay: 'noon',
  faceSun: false,
  terrain: 'farmland',
  // 水泥墊面貼著物件；槽區、中東槽組與南邊堆場是裸土、調車場是碴石。廠內一條東西大路
  // （z −980，兩排廠房之間）、一條南北大路（x 300），南北路往北接村子（中心 (−40, −1760)）、
  // 往南拉出去；東西路往西接上廠區西邊那條斜穿田野的凹路。鐵路南北貫穿調車場
  ground: {
    // 【矩形比物件的範圍內縮約 80 m】墊面的不規則邊往矩形外鋪出去好幾十公尺；照物件的
    // 範圍給的話，四周多出一大圈空灰
    pad: { x0: 110, z0: -1420, x1: 850, z1: -950 },
    patches: [
      { x0: 35, z0: -1495, x1: 205, z1: -1405, hex: 0x6b5f4e },
      { x0: 580, z0: -1400, x1: 660, z1: -1320, hex: 0x6b5f4e },
      { x0: 35, z0: -965, x1: 240, z1: -915, hex: 0x6b5f4e },
      { x0: 880, z0: -1485, x1: 935, z1: -1040, hex: 0x5f5a52 },
    ],
    treeClear: 60,
    roads: [
      [{ x: -385, z: -1300 }, { x: -200, z: -1150 }, { x: -20, z: -980 }, { x: 880, z: -980 }],
      [{ x: 260, z: -500 }, { x: 300, z: -860 }, { x: 300, z: -1530 }, { x: 150, z: -1580 },
        { x: 20, z: -1630 }, { x: -30, z: -1665 }],
    ],
    rails: [[{ x: 905, z: -4500 }, { x: 905, z: 1500 }]],
  },
  // 半徑決定執行時落在農地的哪裡（`openSeaOrigin` 躲山丘）：3,750～4,500 m 落在
  // (12990, 7500)，村子就在圓心的 (−145, +581)。改了半徑，村子就不在油廠北邊
  clear: { x: 105, z: -2341, radius: 4400 },
  planes: PLANES,
  props: PROPS,
  decor: DECOR,
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
    { at: BOMBS_AWAY, kind: 'bomb', actor: 0, count: 10, interval: BOMB_GAP },
    { at: BOMBS_AWAY + 0.1, kind: 'bomb', actor: 1, count: 10, interval: BOMB_GAP },
    { at: 15.7, kind: 'bomb', actor: 3, count: 8, interval: 0.3 },
    { at: 16.0, kind: 'bomb', actor: 4, count: 8, interval: 0.3 },
    { at: 16.0, kind: 'bomb', actor: 5, count: 8, interval: 0.3 },
    { at: 16.2, kind: 'bomb', actor: 6, count: 8, interval: 0.3 },
    // 進入投彈航線，右僚機被高砲直接命中
    { at: KILL_AT - 0.05, kind: 'flak', x: DIRECT_HIT.x, y: DIRECT_HIT.y, z: DIRECT_HIT.z },
    { at: KILL_AT, kind: 'kill', actor: STREAM_HIT, blast: true },
  ]),
}
