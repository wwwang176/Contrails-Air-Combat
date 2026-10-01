import { Vector3 } from 'three'
import { B17G } from '../../specs/b17g'
import { P51D } from '../../specs/p51d'
import { BF109K4 } from '../../specs/bf109k4'
import {
  BOMB_RELEASE_Y, barrage, body, bodyUp, bombAt, edit, rampedOffset, timeline, velocityAt, wingman, wreckAt,
  type Cut, type Path, type ReelDecor, type ReelPlane, type ReelProp, type Shot,
} from './kit'

// ── 轟炸機流 ───────────────────────────────────────────────
//
// 正午、內陸農地上空 400 m。主軸：109 攔截 → B-17 頂著攻擊不散隊、照樣飛向油廠 →
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
//   4.6–7.6   一刀到底，右僚機翼根上方：長焦看 109 迎面撲來開火、曳光打進機身，逼近時拉寬，
//             它從頭上 25 m 掠過時鏡頭甩頭追到身後（震一下），看它拉起
//   7.6–9.0   右僚機右後上方跟拍（手持）：冒煙的發動機竄出火，它仍守在隊形裡
//   9.0–10.6  平行跟拍第二架 109（手持）：它在前景俯衝開火，長機與編隊在前方放大，曳光交錯
//   10.6–11.9 低空組長機的上方砲塔往前上方看：第二架 109 撲向長機、火花打在長機身上，
//             最後一刻從長機頭上拉起掠過
//   11.9–13.4 長機右腰窗（手持）：拖著火的右僚機 12.6 秒被高砲直接命中炸開，編隊不散
//   13.4–15.6 伴飛機往右後下方看：右僚機的殘骸冒火翻滾往下掉，編隊從它上方飛過、越離越遠
//   15.6–18.4 長機機腹下：油廠在前下方，彈艙打開，十枚炸彈一枚枚落下
//   18.4–22.3 編隊後上方往下俯看：每一架機腹下拖出一串炸彈，往下方的油廠落下去
//   22.3–25.7 跟著長機的最後一枚炸彈往下掉：完好的油廠在下方越來越大，第一顆在畫面下方炸開
//   25.7–28.2 貼地在動力區北邊往南看、鏡頭一路後退：炸彈串一顆接一顆朝鏡頭走過來，
//             鍋爐房與兩座氣櫃殉爆，最後一顆落在 70 m 外、鏡頭被震開
//   28.2–30.2 繞著一排煙囪低角度側移、從底部往上搖：煙囪一根接一根被炸黑、底下竄出火
//   30.2–31.8 高潮：快速推近西北槽區，油槽一座接一座殉爆，最後整片炸成最大的一團火球，
//             鏡頭被推開、震得最兇
//   31.8–34.0 長機球形砲塔往後下方看：低空組在前景，底下整片油廠在燒、槽區還在炸

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

/** `t0` 起 `d` 秒內從 0 平順走到 1（smoothstep），之前是 0、之後是 1。鏡頭運動的起停用它 */
function ease(t: number, t0: number, d: number): number {
  const u = Math.min(1, Math.max(0, (t - t0) / d))
  return u * u * (3 - 2 * u)
}

const STREAM_SPEED = 75
/**
 * 編隊的高度。【它決定炸彈在空中掉多久】400 m 投下要 9.6 秒落地；投彈到落地之間的每一刀
 * 都得塞在這段時間裡，再高的話炸彈刀之前就多出好幾秒沒事可拍
 */
const STREAM_ALT = 400
/**
 * 長機第 0 秒在哪。投彈時刻與油廠的位置都綁著它：從 400 m 投下的炸彈往前拋 603 m，
 * 長機 16.0 秒投下的第一枚落在 (450, −1112)，一串掃到 z −1287 —— 廠區的正中間
 */
const STREAM_X0 = 450
const STREAM_Z0 = 690
const streamLead: Path = (t, out) => out.set(STREAM_X0, STREAM_ALT, STREAM_Z0 - STREAM_SPEED * t)

/** 長機組：長機、左僚機、右僚機（中彈的那一架） */
const leftWing = wingman(streamLead, -38, -7, 26, 0.9)
const STREAM_HIT = 2
/**
 * 中彈的右僚機拖著火守在隊形裡，進入投彈航線時被高砲直接命中炸開 —— 它那一串炸彈
 * 沒投出去。編隊不散，照樣飛向目標
 */
const KILL_AT = 12.6
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
/** 改平的加速度：兩段錯開 1.5 秒的 `rampedOffset` 相減，速度改變量就是它 × 1.5 —— 正好抵掉下沉 */
const LEVEL_GAIN = (FIGHTER_SPEED * Math.sin(DIVE_ANGLE)) / 1.5

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
    // 衝過去之後改平：收掉俯衝的下沉 —— 不收的話 20 秒後掉到離地十幾公尺
    out.y += LEVEL_GAIN * (rampedOffset(t, pass + 0.5, 1.5, 1) - rampedOffset(t, pass + 2, 1.5, 1))
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
const BOMBS_AWAY = 16.0
const BOMB_GAP = 0.26
/** 長機最後一枚炸彈：投下那一刻的機腹點與速度，第 22.3～25.7 秒鏡頭跟著它往下掉 */
const LAST_DROP = BOMBS_AWAY + 9 * BOMB_GAP
const LAST_P = body(streamLead, LAST_DROP, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const LAST_V = velocityAt(streamLead, LAST_DROP, new Vector3())
const LAST_BOMB = new Vector3()

/** 油廠的中心：鏡頭的注視點 */
const PLANT = new Vector3(450, 0, -1200)

/** 右僚機被高砲直接命中的那一朵：炸開那一刻在它的左前上方 */
const DIRECT_HIT = crippled(KILL_AT - 0.05, new Vector3()).add(new Vector3(-5, 4, -7))
/** 右僚機交給殘骸池那一刻的位置與速度；殘骸翻滾墜落那一刀用 `wreckAt` 從它算出殘骸在哪 */
const WRECK_P = crippled(KILL_AT, new Vector3())
const WRECK_V = velocityAt(crippled, KILL_AT, new Vector3())
const WRECK = new Vector3()

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
      // 一刀到底：右僚機右翼根上方，鏡頭一路盯著 109。先是長焦（28°）看它從 470 m 外迎面
      // 撲來、槍口焰閃著、曳光打進機身；逼近時鏡頭拉寬到 62°，6.69 秒它從頭上 25 m 掠過，
      // 鏡頭跟著抬頭、繞過頭頂甩向後方（尖峰約每秒 500°），震一下，接著看它在身後拉起、
      // 轉開，自己的垂尾與平尾在畫面裡。注視點取 109 0.03 秒前的位置，甩頭時跟不上一點。
      // 【鏡頭偏離機身中線 4 m】109 沿中線掠過，鏡頭架在中線上的話視線會正好穿過頭頂、
      // 畫面翻成上下顛倒；偏開之後甩頭是繞著鉛直方向轉過去，地平線始終在下
      body(crippled, t, 4, 3.4, 7.5, false, out.position)
      bandit(t - 0.03, S1).sub(out.position).normalize()
      out.target.copy(out.position).addScaledVector(S1, 30)
      jolt(t, PASS_1, 1.2, out.target)
      bodyUp(crippled, t, out.up)
      out.fov = 28 + 34 * ease(t, 5.8, 0.7)
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
      // 12.6 秒被高砲直接命中炸開（震一下）；長機照樣往前飛。
      // 【鏡頭位置不晃】平尾離鏡頭 3 m，位置晃 0.3 m 它就在畫面上跳 5°；只轉方向
      body(streamLead, t, 2.1, 0.5, 9.2, false, out.position)
      crippled(Math.min(t, KILL_AT) - 0.2, out.target)
      shake(t, 0.4, 6, out.target)
      jolt(t, KILL_AT, 1.4, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 52
    },
  },
  {
    from: 13.4, subject: null,
    camera(t, out) {
      // 編隊右後上方 70 m 的伴飛機往右後下方看（手持 0.25°）：右僚機的殘骸冒著火、拖著
      // 黑煙翻滾往下掉，長機組與低空組照樣從它上方飛過去，它在畫面裡越掉越遠
      // （13.4 → 15.6 秒，離鏡頭 60 → 220 m）。不跟到落地
      streamLead(t, out.position).add(S1.set(75, 70, 40))
      shake(t, 0.3, 24, out.position)
      wreckAt(WRECK_P, WRECK_V, t - 0.25 - KILL_AT, WRECK)
      streamLead(t, S2).add(S3.set(20, -20, 60))
      aimBetween(out.position, WRECK, S2, 0.35, out.target)
      shake(t, 0.4, 25, out.target)
      out.fov = 50
    },
  },
  {
    from: 15.6, subject: null, mount: 0,
    camera(t, out) {
      // 機腹下、彈艙後方往前下方看：前下方的田裡是油廠，16.0 秒起十枚炸彈一枚枚從機腹
      // 落下、往後飄過鏡頭下方，最後一枚 18.34 秒
      body(streamLead, t, 1.6, -3.4, 7.0, false, out.position)
      body(streamLead, t, 0, -6, -3, false, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 62
    },
  },
  {
    from: 18.4, subject: 0,
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
    from: 22.3, subject: null,
    camera(t, out) {
      // 跟著長機的最後一枚炸彈往下掉：鏡頭在它後上方幾公尺，炸彈在畫面下半，前面幾枚
      // 在更下方；完好的油廠在正下方越來越大，冷卻塔冒著白汽。25.50 秒第一顆在畫面下方
      // 炸開，這一刀在第二、三顆之間切到地面 —— 那時這一枚還在百來公尺高。
      // 【這一刀之前廠區不能有火】觀眾第一次看到廠區爆炸，要在跟著炸彈掉下去之後
      bombAt(LAST_P, LAST_V, t - LAST_DROP, LAST_BOMB)
      out.position.copy(LAST_BOMB).add(S1.set(1.6, 2.2, 3.4))
      shake(t, 0.05, 19, out.position)
      aimBetween(out.position, LAST_BOMB, PLANT, 0.4, out.target)
      out.fov = 54
    },
  },
  {
    from: 25.7, subject: null,
    camera(t, out) {
      // 貼地在動力區北邊、氣櫃與鍋爐房之間的空隙口，離地 20 m 往南看：左僚機那一串沿著
      // 空隙、長機那一串貼著鍋爐房，一顆接一顆朝鏡頭「走」過來（每 0.26 秒一顆、每顆近
      // 19 m），鏡頭一路往後退（每秒 14 m，退得比炸彈走得慢，一顆比一顆近）。鍋爐房
      // 26.34、27.64 秒炸開，遠處的氣櫃 26.83 秒殉爆；最後一顆 27.90 秒落在 70 m 外，
      // 左前方 80 m 的氣櫃 27.92 秒跟著殉爆成一團大火球，鏡頭被衝擊往後彈開 6 m、
      // 一震最兇。不晃 —— 只有爆炸那幾下震。
      // 【鏡頭要在空隙口】架在鍋爐房正後方的話，整面牆擋住畫面
      // 【不再靠近】炸彈的火球半徑幾十公尺，最後一顆再近鏡頭就鑽進火裡、整片紅
      const back = 14 * (t - 25.7) + 6 * ease(t, 27.9, 0.25)
      out.position.set(415, 20 + 2 * ease(t, 27.9, 0.25), -1330 - back)
      out.target.set(425, 12, -1180 - back)
      jolt(t, 26.34, 0.5, out.target)
      jolt(t, 26.83, 0.9, out.target)
      jolt(t, 27.38, 0.8, out.target)
      jolt(t, 27.64, 1.2, out.target)
      jolt(t, 27.9, 1.8, out.target)
      jolt(t, 27.92, 1.5, out.target)
      out.fov = 56
    },
  },
  {
    from: 28.2, subject: null,
    camera(t, out) {
      // 仰拍一排四根煙囪（百公尺高）：鏡頭在它們北端外、離地 12 m，繞著煙囪排由西往東
      // 緩緩側移（弧長約 50 m，每秒 25 m），同時從煙囪底部往上搖到頂（仰角 4° → 29°）。
      // 右上僚機的一串沿著煙囪排落下來，28.63、28.94、29.57、30.19 秒一根接一根被炸黑、
      // 底下竄出火，29.0 秒煙囪根部的管線再炸一團。最後一根就在鏡頭前（每根震一下，
      // 越近越兇）。炸毀的物件只換焦黑材質、不會倒
      const u = ease(t, 28.2, 2.0)
      const arc = -0.3 + 0.4 * u
      out.position.set(520 + 125 * Math.sin(arc), 12, -1240 - 125 * Math.cos(arc))
      out.target.set(522, 20 + 60 * u, -1240)
      jolt(t, 28.63, 0.5, out.target)
      jolt(t, 28.94, 0.7, out.target)
      jolt(t, 29.0, 0.9, out.target)
      jolt(t, 29.57, 1.0, out.target)
      jolt(t, 30.19, 1.6, out.target)
      out.fov = 58
    },
  },
  {
    from: 30.2, subject: null,
    camera(t, out) {
      // 高潮：西北槽區的殉爆。鏡頭從槽區東南 280 m、離地 40 m 快速推近 60 m，油槽一座接
      // 一座被引爆成大火球（30.35、30.65、31.1 秒，中間 30.9 秒油桶堆），31.3 秒整個槽區
      // 炸成一團 4.5 倍的火球 —— 最大的一團，鏡頭被衝擊往後推開 15 m、往上抬，震得最兇。
      // 【不再推近】那一團的火球半徑上百公尺；推到 150 m 內鏡頭就鑽進火裡、整片紅
      const push = 60 * ease(t, 30.2, 1.1) - 15 * ease(t, 31.3, 0.3)
      out.position.set(330 - 0.758 * push, 40 - 10 * ease(t, 30.2, 1.1) + 6 * ease(t, 31.3, 0.3),
        -1270 - 0.65 * push)
      out.target.set(115, 15 + 35 * ease(t, 31.3, 0.5), -1445)
      jolt(t, 30.35, 0.6, out.target)
      jolt(t, 30.65, 0.8, out.target)
      jolt(t, 30.9, 0.9, out.target)
      jolt(t, 31.1, 1.2, out.target)
      jolt(t, 31.3, 3.0, out.target)
      out.fov = 54
    },
  },
  {
    from: 31.8, subject: LOW_LEAD, mount: 0,
    camera(t, out) {
      // 球形砲塔：機腹下往左後下方看，低空組在前景，底下整片油廠在燒，槽區還一座接一座
      // 在炸（32.3、32.8、33.3 秒）。掛在機上，不晃
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
  duration: 34,
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
    ...barrage(101, 0, 33.5, 2.0, (t, out) => streamLead(t, out).add(S3.set(-20, -20, 70)),
      { x: 190, yLo: -80, yHi: 100, z: 240 }, edit(CUTS), 70),
    // 投彈航線上：長機組前方的一片彈幕，編隊直直飛進去
    ...barrage(202, 13.3, 18.8, 3.0, (t, out) => streamLead(t, out).add(S3.set(10, 10, -260)),
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
    // 投彈：長機組、低空組、右上那一架照順序
    { at: BOMBS_AWAY, kind: 'bomb', actor: 0, count: 10, interval: BOMB_GAP },
    { at: BOMBS_AWAY + 0.1, kind: 'bomb', actor: 1, count: 10, interval: BOMB_GAP },
    { at: 17.5, kind: 'bomb', actor: 3, count: 8, interval: 0.3 },
    { at: 17.8, kind: 'bomb', actor: 4, count: 8, interval: 0.3 },
    { at: 17.8, kind: 'bomb', actor: 5, count: 8, interval: 0.3 },
    { at: 18.0, kind: 'bomb', actor: 6, count: 8, interval: 0.3 },
    // 進入投彈航線，右僚機被高砲直接命中
    { at: KILL_AT - 0.05, kind: 'flak', x: DIRECT_HIT.x, y: DIRECT_HIT.y, z: DIRECT_HIT.z },
    { at: KILL_AT, kind: 'kill', actor: STREAM_HIT, blast: true },
    // 層層升級：炸彈串（25.5 秒起）→ 鍋爐房、氣櫃殉爆 → 煙囪排 → 西北槽區一座接一座
    // 被引爆（油槽、油桶堆炸毀時自己會殉爆一團 2.5 倍的火球）→ 31.3 秒整個槽區一團
    // 4.5 倍的大火球 → 收尾那一刀槽區還在一座座炸
    { at: 29.0, kind: 'blast', x: 535, y: 6, z: -1250, size: 2 },
    { at: 30.35, kind: 'destroy', prop: 7 },
    { at: 30.65, kind: 'destroy', prop: 5 },
    { at: 30.9, kind: 'destroy', prop: 9 },
    { at: 31.1, kind: 'destroy', prop: 3 },
    { at: 31.3, kind: 'blast', x: 120, y: 20, z: -1450, size: 4.5 },
    { at: 32.3, kind: 'destroy', prop: 1 },
    { at: 32.8, kind: 'destroy', prop: 6 },
    { at: 33.3, kind: 'blast', x: 100, y: 12, z: -1470, size: 3 },
  ]),
}
