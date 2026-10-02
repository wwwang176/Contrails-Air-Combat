import { Vector3 } from 'three'
import { B17G } from '../../specs/b17g'
import { BF109K4 } from '../../specs/bf109k4'
import {
  BOMB_RELEASE_Y, barrage, body, bodyUp, bombAt, edit, rampedOffset, timeline, velocityAt, wingman, wreckAt,
  type Cut, type Path, type ReelCamera, type ReelDecor, type ReelPlane, type ReelProp, type Shot,
} from './kit'

// ── 轟炸機流 ───────────────────────────────────────────────
//
// 十一月的灰色正午、晚秋農地上空 400 m。主軸：109 攔截 → B-17 頂著攻擊不散隊、照樣飛向油廠 →
// 開彈艙投彈 → 炸彈落進油廠。被打的一方沒有退：中彈冒火的右僚機守在編隊裡，進入投彈
// 航線時被高砲炸開，其餘的照樣飛過去把炸彈投完。
//
// 地形（局部座標）：整個 `clear` 圓是平地（離地 0 m）。村子的中心在 (−40, −1760)；
// 油廠在它東南邊，x 30…930、z −1500…−870：西北是槽區、正中間是動力區（鍋爐房、
// 氣櫃、一排煙囪）、南邊兩排廠房、東邊是冷卻塔、倉庫與調車場，外圍一圈高砲。炸彈串落在正中間。
//
// 刀表（每一刀在主軸上的作用；〔〕裡是用到的運鏡手法）：
//   0.0–2.4   〔長焦壓縮〕編隊左後下方 950 m、視角 11°：好幾層 B-17 前後疊成一片，
//             高砲黑雲擠在它們之間、兩朵在前景炸開：編隊在投彈航線上
//   攻擊段只有一刀看得到 109 開火（4.5–7.6），其餘都從挨打的一方拍：
//   2.4–3.5   長機座艙後上方往左後看：高砲在左僚機旁炸開、左僚機右外側發動機冒煙，
//             第二朵在鏡頭左後方炸開、震一下
//   3.5–4.5   〔獵人視角，長焦、微荷蘭角〕第一架 109 俯衝線的後上方往前下方盯著右僚機：
//             獵物鎖在畫面正中越來越大，109 從畫面右下緣切進來朝它衝，曳光迎著打過來
//   4.5–7.6   一刀到底，右僚機翼根上方：長焦看 109 迎面撲來開火、曳光打進機身，逼近時拉寬，
//             它從頭上 25 m 掠過時鏡頭甩頭追到身後（震一下），看它拉起
//   7.6–8.7   右僚機正後上方的跟拍：被打中的右內側發動機冒著煙、竄出火，煙從鏡頭旁往後流
//   8.7–9.6   〔細節特寫〕長機下巴砲塔的側影，機槍手從它旁邊往前打，曳光往外噴、收向
//             遠處撲來的第二架 109（一個小點）
//   9.6–10.7  長機左翼根上方往前看：火花從右內側發動機一路掃過機首、打到鏡頭旁的左內側
//             發動機，它冒出煙；機槍手從身邊往前還擊
//   10.7–11.9 右僚機左後方的伴飛機（手持）：拖著火的右僚機掉在隊形下方、一點一點拉回長機
//             旁邊；近處一朵高砲震一下
//   11.9–13.4 長機右腰窗（手持）：拖著火的右僚機 12.6 秒被高砲直接命中炸開，編隊不散
//   13.4–14.7 伴飛機往右後下方看：右僚機的殘骸冒火翻滾往下掉，編隊從它上方飛過、越離越遠
//   14.7–15.9 〔垂直俯視〕編隊正上方 260 m 往正下方看：編隊往畫面右邊飛、底下是田，
//             從一層高砲黑雲之間穿過去
//   15.9–18.4 長機機腹下：油廠在前下方，彈艙打開，十枚炸彈一枚枚落下
//   18.4–22.3 編隊後上方往下俯看：每一架機腹下拖出一串炸彈，往下方的油廠落下去
//   22.3–25.7 跟著長機的最後一枚炸彈往下掉：完好的油廠在下方越來越大，第一顆在畫面下方炸開
//   25.7–27.3 〔垂直俯視〕整片廠區正上方 1300 m：炸彈串從南往北一顆接一顆炸過動力區，
//             編隊在下方飛過廠區上空
//   27.3–28.6 廠區東緣地上往西仰看：天上的編隊與落下的炸彈同框，地上一串串從左往右
//             走過動力區，左前景是廠房
//   28.6–30.6 廠區東北角外的田上仰看：編隊從左上方飛過，右下的中東槽組連環殉爆成一大團
//   30.6–33.0 長機左翼根上方往後下方看：整片廠區在燒、西北槽區連環殉爆；低空組右僚機的
//             發動機燒起來，32.3 秒掉出編隊，鏡頭往下搖跟它，它剛開始往下掉時切
//   33.0–35.6 〔著火的 B-17 往下墜〕它前上方 55 m 的近距離追拍往後下方看：它拖著火與
//             黑煙往下掉、越來越小，後下方燃燒的廠區從畫面下緣升進來。不跟到落地

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

const DUTCH_F = new Vector3()
const DUTCH_R = new Vector3()
/**
 * 荷蘭角：把鏡頭的上方繞著視線轉 `deg` 度（正值 = 上方倒向畫面右邊，地平線左低右高）。
 * 固定的傾斜，不是晃。在 `position`、`target`、`up` 都設好之後呼叫
 */
function dutch(out: ReelCamera, deg: number): void {
  DUTCH_F.subVectors(out.target, out.position).normalize()
  DUTCH_R.crossVectors(DUTCH_F, out.up).normalize()
  out.up.copy(DUTCH_R).cross(DUTCH_F)
  const a = (deg * Math.PI) / 180
  out.up.multiplyScalar(Math.cos(a)).addScaledVector(DUTCH_R, Math.sin(a))
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

/**
 * 右僚機發動機起火之後掉出隊形：往下沉 6 m，再拉回原位（8.2 → 12.3 秒）。
 * 加速度 +1、−1、+1 三段（各 `SAG_T`、中間那段兩倍長），速度與位移都回到零。
 * 【`SAG_A` 不能超過 g】往下的加速度大過重力就得負 G 才飛得出來，姿態會翻過去。
 * 【只能往下沉，不能橫飄】往下沉的那幾秒只剩 0.3 G，姿態由航線推出來，同樣的橫向
 * 加速度壓出的坡度是平飛時的三倍：橫飄 1 m 就歪到 22°，看起來像要翻過去
 * 【12.6 秒之前要回到原位】直接命中那一朵與殘骸的起點都照它當時的位置算
 */
const SAG_AT = 8.2
const SAG_T = 0.95
const SAG_A = 6.6
function sagDepth(t: number): number {
  return SAG_A * (rampedOffset(t, SAG_AT, 0.3, 1) - 2 * rampedOffset(t, SAG_AT + SAG_T, 0.3, 1)
    + 2 * rampedOffset(t, SAG_AT + 3 * SAG_T, 0.3, 1) - rampedOffset(t, SAG_AT + 4 * SAG_T, 0.3, 1))
}
const crippled: Path = (t, out) => {
  crippledBase(t, out)
  out.y -= sagDepth(t)
  return out
}

/** 低空組：在長機組左後下方 */
const lowLead = wingman(streamLead, -72, -48, 112, 0.3)
const lowLeft = wingman(streamLead, -110, -55, 138, 3.4)
const lowRight = wingman(streamLead, -34, -41, 138, 2.2)
const LOW_LEAD = 3
/** 低空組右僚機掉出編隊的時刻：收尾那一刀裡看它脫隊、往下掉 */
const LAST_FALL_AT = 32.3
/** 它交給殘骸池那一刻的位置與速度；收尾那一刀用 `wreckAt` 從它算出它掉到哪 */
const FALL_P = lowRight(LAST_FALL_AT, new Vector3())
const FALL_V = velocityAt(lowRight, LAST_FALL_AT, new Vector3())
/** 收尾兩刀廠區那一側的注視點：西北槽區與動力區之間，殉爆的槽區在畫面裡 */
const FALL_PLANT = new Vector3(300, 0, -1330)

/** 109 對頭攻擊：速度、射擊窗正中那一刻離目標多遠 */
const FIGHTER_SPEED = 150
const FIRE_RANGE = 380
/**
 * 射擊窗的半長，s。機首那條線第 `fireAt` 秒正好穿過目標的機身中心，射擊窗以這一刻為中心。
 * 目標水平往前飛、109 斜著衝過來，目標每秒偏離那條線 75 × tan(俯角) m（上下）與
 * 75 × tan(偏航) m（左右）；機身容許 5.3 m（僚機另有 0.5 m 的起伏），前後各 0.55 秒、
 * 距離從 500 m 打到 260 m。俯角 6° 不偏航時上下偏 4.3 m；兩向都要偏的話俯角得放淺
 */
const FIRE_HALF = 0.55
/** 停火之後最後一刻拉起：擦身那一刻多抬高幾公尺 */
const PULL_UP = 12
const PULL_D = 0.3

/** 從射擊窗正中到飛過目標那一個橫切面要幾秒 */
function passAfter(dive: number, yaw: number): number {
  const c = Math.cos(dive) * Math.cos(yaw)
  return (c * FIRE_RANGE) / (FIGHTER_SPEED * c + STREAM_SPEED)
}

/**
 * 109 從前方對頭撲向 `target`：一條往下 `dive`、往右偏 `yaw` 的直線，第 `fireAt` 秒穿過
 * 目標的機身中心、那時離它 380 m。停火的那一刻（`fireAt + FIRE_HALF`）猛然拉起，
 * 從目標頭上掠過（約 4 G，翼尖拉出凝結尾），之後往 `side` 那一側壓坡度轉開。
 *
 * 【拉起只能在停火之後】曳光沿機首直直打出去；一拉起機首就離開目標
 * 【擦身的間距】B-17 加 109 的半翼展和是 20.8 m，僚機另有 ±2 m 的起伏。直線本身在擦身
 * 那一刻已經高出目標（俯角 6° 是 13 m、3° 是 6.6 m），偏航另外橫向錯開
 */
function diveOn(target: Path, fireAt: number, side: number, dive: number, yaw: number): Path {
  const aim = target(fireAt, new Vector3())
  const dx = Math.cos(dive) * Math.sin(yaw)
  const dy = -Math.sin(dive)
  const dz = Math.cos(dive) * Math.cos(yaw)
  const x0 = aim.x - dx * FIRE_RANGE
  const y0 = aim.y - dy * FIRE_RANGE
  const z0 = aim.z - dz * FIRE_RANGE
  const pullFrom = fireAt + FIRE_HALF
  const pass = fireAt + passAfter(dive, yaw)
  const pullT = pass - pullFrom
  const pullGain = PULL_UP / (0.5 * PULL_D * (pullT - PULL_D) + 0.5 * (pullT - PULL_D) ** 2)
  // 改平的加速度：兩段錯開 1.5 秒的 `rampedOffset` 相減，速度改變量就是它 × 1.5 —— 正好抵掉下沉
  const levelGain = (FIGHTER_SPEED * Math.sin(dive)) / 1.5
  return (t, out) => {
    const s = FIGHTER_SPEED * (t - fireAt)
    out.set(x0 + dx * s, y0 + dy * s, z0 + dz * s)
    out.y += pullGain * (rampedOffset(t, pullFrom, PULL_D, 1) - rampedOffset(t, pass - PULL_D, PULL_D, 1))
    // 衝過去之後改平：收掉俯衝的下沉 —— 不收的話 20 秒後掉到離地十幾公尺
    out.y += levelGain * (rampedOffset(t, pass + 0.5, 1.5, 1) - rampedOffset(t, pass + 2, 1.5, 1))
    out.x += side * rampedOffset(t, pass + 0.3, 1.5, 9)
    out.z -= rampedOffset(t, pass + 0.3, 1.5, 10)
    return out
  }
}
/** 第一架：俯角 6° 正對著撲向右僚機 */
const DIVE_1 = (6 * Math.PI) / 180
const FIRE_1 = 5.0
const PASS_1 = FIRE_1 + passAfter(DIVE_1, 0)
const bandit = diveOn(crippledBase, FIRE_1, -1, DIVE_1, 0)
const BANDIT = 9
/**
 * 第二架：撲向長機。俯角 3°、往右偏 6°，機首那條線每秒在長機身上往左掃 7.9 m：火花從
 * 右內側發動機掃過機首、打到左內側發動機（`enginePoints[2]`），它冒煙。擦身時在長機
 * 左上方
 */
const FIRE_2 = 9.55
const bandit2 = diveOn(streamLead, FIRE_2, -1, (3 * Math.PI) / 180, (6 * Math.PI) / 180)
const BANDIT_2 = 10

/** 穿梭的 109：俯角、U 形迴轉的每一半要幾秒 */
const RAID_DIVE = (6 * Math.PI) / 180
const RAID_TURN = 5

/**
 * 攔截中隊裡穿梭的 109（不瞄準、不帶護欄的目標）：第 `tp` 秒穿過編隊裡相對長機
 * (`gx`, `gy`, `gz`) 那一點 —— 一個量過、離每一架 B-17 都超過 23 m 的空隙。航向 `yaw`
 * （0 = 往南迎頭、π = 往北從後方追上、π/2 = 往東橫切），往下 6°。
 * 穿過之後 `breakAfter` 秒翻身脫離：往 `side` 那一側做一個 U 形迴轉（前 5 秒轉到側向、
 * 後 5 秒轉到反向，同時改平），迴轉完在 750 m 外往回飛，像在外圍盤旋準備下一輪。
 *
 * 【迴轉用兩段定向加速度拼】速度從「前」轉到「側」再轉到「後」，中段速度降到 106 m/s，
 * 約 4.3 G。每一段用 `rampedOffset` 平順加上去，三次跳變加起來是零，迴轉完不再加速
 * 【一定要改平】往下 6° 一路衝的話 20 秒後掉到離地兩百公尺以下、30 秒撞地
 */
function raider(tp: number, gx: number, gy: number, gz: number, yaw: number, side: number, breakAfter: number): Path {
  const a = streamLead(tp, new Vector3()).add(new Vector3(gx, gy, gz))
  const h = Math.cos(RAID_DIVE) * FIGHTER_SPEED
  const vx = Math.sin(yaw) * h
  const vy = -Math.sin(RAID_DIVE) * FIGHTER_SPEED
  const vz = Math.cos(yaw) * h
  // 側向：航向往 `side` 那一側轉 90°
  const px = side * Math.cos(yaw) * h
  const pz = -side * Math.sin(yaw) * h
  const t1 = tp + breakAfter
  const t2 = t1 + RAID_TURN
  const t3 = t2 + RAID_TURN
  const T = RAID_TURN
  return (t, out) => {
    const s = t - tp
    out.set(a.x + vx * s, a.y + vy * s, a.z + vz * s)
    // 第一段加速度 (p − h)/T，第二段 (−h − p)/T，之後 0
    out.x += rampedOffset(t, t1, 0.5, (px - vx) / T) + rampedOffset(t, t2, 0.5, -2 * px / T)
      + rampedOffset(t, t3, 0.5, (vx + px) / T)
    out.z += rampedOffset(t, t1, 0.5, (pz - vz) / T) + rampedOffset(t, t2, 0.5, -2 * pz / T)
      + rampedOffset(t, t3, 0.5, (vz + pz) / T)
    // 第一段同時把下沉收掉
    out.y += rampedOffset(t, t1, 0.5, -vy / T) - rampedOffset(t, t2, 0.5, -vy / T)
    return out
  }
}
/**
 * 五架穿梭的 109，各在不同的刀裡穿過背景：
 * - 從編隊右後方追上來、斜斜往前下方超過右上那一架（開場長焦的背景、砲塔特寫的前方）
 * - 一對長僚機跟第一架 109 一起迎頭撲下來，從長機與右僚機之間的上方穿過（獵人視角裡
 *   是同一群往下撲的其他幾架，迎面＋甩頭那刀從右僚機頭上穿過）
 * - 一架迎頭從左僚機與低空組之間鑽過去（砲塔特寫、掉高度那兩刀）
 * - 一架往東橫切、從長機組後面穿過去（垂直俯視那刀從編隊底下橫過）
 * 【開場那架在編隊東側】長焦那刀從左後方拍、選單在左邊：西側的全躲在選單後面
 */
/**
 * 【追上來的那架要晚點才迴轉、往東轉】它往北飛，迴轉完往南：早轉的話段尾往南飛出
 * 開闊圓；往西轉的話橫切過前導組的前方。超過編隊 600 m 才翻身，迴轉完只剩 15 秒往南
 */
const raidAstern = raider(1.5, 110, -25, 20, Math.PI, -1, 8.5)
const raidLead = raider(5.6, 18, 30, 0, 0, 1, 1.0)
const raidWing = raider(5.9, 40, 45, 0, 0, 1, 1.0)
const raidLow = raider(10.3, -56, -21, 0, 0, -1, 1.0)
const raidCross = raider(14.9, 0, -20, 70, Math.PI / 2, 1, 1.5)
const RAID_LEAD = 8
const RAID_WING = 13
const RAID_LOW = 14

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

/**
 * 高砲的閃光是一團低面數的火球：離鏡頭 70 m 以內在畫面上看得出稜角，像一顆紅色的石頭
 * （`barrage` 也是 70 m 起跳）。下面幾朵都離拍到它的鏡頭 70 m 以上
 */
/**
 * 開場長焦那兩朵：在鏡頭與編隊之間、炸開時離鏡頭 300 m 上下（長焦把它們拉近，讀起來
 * 像前景）。世界座標固定、鏡頭跟著編隊往前飛，它們迎面飄近、從畫面邊上滑出去
 */
const FLAK_OPEN_1 = streamLead(0.4, new Vector3()).add(new Vector3(-185, -95, 560))
const FLAK_OPEN_2 = streamLead(1.3, new Vector3()).add(new Vector3(-150, -85, 520))
/** 咬上左僚機的那一朵：在它外側後方，從長機看過去在它背後炸開 */
const FLAK_WING_AT = 2.7
const FLAK_WING = leftWing(FLAK_WING_AT, new Vector3()).add(new Vector3(-30, 10, 10))
/** 長機左後上方 75 m 的那一朵（相對長機的位置）：2.4–3.6 那一刀的鏡頭震一下 */
const FLAK_NEAR_AT = 3.15
const FLAK_NEAR = new Vector3(-55, 20, 45)
const FLAK_NEAR_P = streamLead(FLAK_NEAR_AT, new Vector3()).add(FLAK_NEAR)
/** 右僚機拉回隊形時在它右前方炸開的那一朵 */
const FLAK_SAG_AT = 11.45
const FLAK_SAG = crippledBase(FLAK_SAG_AT, new Vector3()).add(new Vector3(14, 6, -40))

/** 右僚機被高砲直接命中的那一朵：炸開那一刻在它的左前上方 */
const DIRECT_HIT = crippled(KILL_AT - 0.05, new Vector3()).add(new Vector3(-5, 4, -7))
/** 右僚機交給殘骸池那一刻的位置與速度；殘骸翻滾墜落那一刀用 `wreckAt` 從它算出殘骸在哪 */
const WRECK_P = crippled(KILL_AT, new Vector3())
const WRECK_V = velocityAt(crippled, KILL_AT, new Vector3())
const WRECK = new Vector3()

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: LOW_LEAD,
    camera(t, out) {
      // 長焦壓縮編隊：編隊左後下方 950 m 的伴飛機往前上方看，視角只有 11°。低空組、
      // 長機組、右上那一架與遠處的前導組沿著視線前後疊成好幾層，往畫面深處飛；周圍的
      // 高砲黑雲跟它們擠在一起，兩朵在鏡頭與編隊之間炸開、迎面飄過前景。慢慢推近一點。
      // 晃 1 m 在 950 m 外是 0.06°，長焦放大三倍多讀起來約 0.2°（緊張的跟拍）。
      // 【鏡頭在左後方、注視點偏左】編隊往畫面右邊排開、選單在左邊；正後方拍的話
      // 低空組落在選單後面
      streamLead(t, out.position).add(S1.set(-300, -150, 900 - 20 * t))
      shake(t, 0.5, 31, out.position)
      streamLead(t, out.target).add(S1.set(-25, -10, 40))
      shake(t, 1.0, 32, out.target)
      out.fov = 11
    },
  },
  {
    from: 2.4, subject: 1, mount: 0,
    camera(t, out) {
      // 長機座艙後上方往左後看：自己的左翼與兩具發動機在下緣，左僚機在 45 m 外。
      // 2.7 秒一朵高砲在它前上方炸開、它的右外側發動機冒出煙；3.15 秒第二朵在鏡頭左後方
      // 二十來公尺炸開，鏡頭震一下。掛在機上，只留 0.1° 的慢晃
      body(streamLead, t, -1.6, 3.3, -1.0, false, out.position)
      leftWing(t, S1)
      streamLead(t, S2).add(FLAK_NEAR)
      aimBetween(out.position, S1, S2, 0.25, out.target)
      shake(t, 0.15, 26, out.target)
      jolt(t, FLAK_NEAR_AT, 1.4, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 3.5, subject: STREAM_HIT,
    camera(t, out) {
      // 獵人的視角：鏡頭在第一架 109 的俯衝線上方 8 m、偏東 5 m，往前下方盯著右僚機。
      // 右僚機鎖在畫面正中、從 720 m 逼近到 545 m，越來越大，編隊在它周圍毫不知情、
      // 底下是田。109 比鏡頭快一半，3.8 秒從畫面右下緣切進來（離鏡頭 30 m），一路往下
      // 朝畫面中央的獵物衝，4.5 秒退到 65 m 外、貼在獵物右下方。視角 18°（長焦：獵物在
      // 600 m 外，廣一點就只是一個小點，看不出變大），往右倒 12°，跟拍機的手持 0.2°
      // （600 m 外晃 2 m）。還沒開火 —— 開火那一刀從右僚機上拍（4.5 秒起）。
      // 【鏡頭沿著俯衝線走、速度是 109 的三分之二】取 109 在較早時刻的位置當鏡頭，鏡頭與
      // 109 同一條線往下衝；跟它一樣快的話 109 釘在畫面同一處，看不出它在撲；只有一半
      // 快的話 109 一下子就縮成獵物旁邊的一個小點
      // 【鏡頭偏東】往南看時東邊是畫面左邊：109 落在畫面右半，不會躲進選單後面
      // 【沒辦法背著太陽】109 從編隊正前方（北）撲下來，太陽在南邊，獵物是逆光的
      bandit(3.5 + (2 / 3) * (t - 3.5) - 15 / 150, out.position).add(S1.set(5, 8, 0))
      shake(t, 0.1, 33, out.position)
      crippledBase(t, out.target)
      shake(t, 2.0, 34, out.target)
      dutch(out, 12)
      out.fov = 18
    },
  },
  {
    from: 4.5, subject: BANDIT, mount: STREAM_HIT,
    camera(t, out) {
      // 一刀到底：右僚機右翼根上方，鏡頭一路盯著 109。先是長焦（28°）看它從 490 m 外迎面
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
      // 右僚機正後上方 35 m 的跟拍（伴飛機，手持 0.2°）：兩邊翼面被斜陽照亮，被打中的
      // 右內側發動機（`enginePoints[0]`，機體 x +3.05）在畫面右半冒著煙，7.8 秒竄出火，
      // 黑煙沿著翼面往後流、從鏡頭右下擦過。8.2 秒起它開始往下沉，鏡頭跟著它。
      // 【鏡頭在垂尾之後】往後 14 m 只到垂尾的位置，尾翼橫在畫面下緣、整架讀不出來
      // 【不掛在機上】架在翼上，外側發動機艙擋住起火的那一具；架在翼下，畫面是一整片
      // 背光的機翼底面
      // 【從正後上方拍】太陽在它左後方：從右邊拍是背陰面，整架隔著黑煙糊成一團暗灰；
      // 從左邊拍，起火的那一具被機身擋住
      body(crippled, t, 1, 14, 32, true, out.position)
      shake(t, 0.08, 13, out.position)
      body(crippled, t, 2, 0, -2, true, out.target)
      shake(t, 0.2, 14, out.target)
      out.fov = 40
    },
  },
  {
    from: 8.7, subject: BANDIT_2, mount: 0,
    camera(t, out) {
      // 細節特寫：長機機背、上方砲塔右後方 3 m 往前看。曬著太陽的砲塔在畫面左下，
      // 長機的機槍手就從它旁邊往前打，曳光一條條往外噴、收向前方 600 m 外迎面撲來的
      // 第二架 109（畫面中間的一個小點，9.0 秒起它的槍口也在閃）。掛在機上，只留 0.1° 的
      // 慢晃。
      // 【拍上方砲塔、不拍下巴砲塔】正午的太陽在頭頂，機腹下的砲塔從哪個角度看都是
      // 一團背光的黑球
      body(streamLead, t, 1.0, 3.3, 1.5, false, out.position)
      bandit2(t, S1)
      body(streamLead, t, 0, 2.6, -1.0, false, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      shake(t, 0.15, 35, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 50
    },
  },
  {
    from: 9.6, subject: 0, mount: 0,
    camera(t, out) {
      // 長機左翼根上方往右前方看：機首與右內側發動機在畫面裡，第二架 109 只是上緣一個
      // 越來越大的小點。火花從右內側發動機掃過機首、一路打到鏡頭旁的左內側發動機
      // （彈著 9.4～10.5 秒），10.15 秒它冒出煙、從鏡頭右下往後流；長機的機槍手從身邊
      // 往前還擊。掛在機上，挨打時晃 0.3°
      body(streamLead, t, -4.9, 2.8, 4.0, false, out.position)
      body(streamLead, t, 1.5, 1.2, -8, false, out.target)
      shake(t, 0.3, 21, out.target)
      jolt(t, FIRE_2 + FIRE_HALF, 0.5, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 54
    },
  },
  {
    from: 10.7, subject: STREAM_HIT,
    camera(t, out) {
      // 右僚機左後方 46 m、與它的原位同高的伴飛機（手持 0.25°）：拖著火的右僚機
      // 掉在原位下方 5 m，一點一點拉回來，長機在它左前方當基準。11.45 秒一朵高砲
      // 在它右前方炸開、鏡頭震一下。
      // 【鏡頭與注視點都綁在隊形的原位上、不跟它】跟著它的話畫面裡它不動，看不出掉下去
      // 【從左後方拍】太陽在編隊左後方，從右邊拍是整片背陰的機身
      crippledBase(t, out.position).add(S1.set(-12, 2, 44))
      shake(t, 0.25, 22, out.position)
      crippledBase(t, out.target).add(S1.set(-6, -3, -10))
      shake(t, 0.35, 23, out.target)
      jolt(t, FLAK_SAG_AT, 0.9, out.target)
      out.fov = 44
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
      // （13.4 → 14.7 秒，離鏡頭 60 → 160 m）。不跟到落地
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
    from: 14.7, subject: 0,
    camera(t, out) {
      // 正上方垂直俯視：編隊正上方 260 m 往正下方看，編隊往畫面右邊飛、底下是田；
      // 長機組與低空組從一片高砲黑雲之間穿過去，黑雲夾在鏡頭與飛機之間。
      // 伴飛機，手持 0.1°。
      // 【畫面的上方取西邊】機首方向（北）朝右、編隊才不會飛進左邊的選單；注視點在長機
      // 後方 90 m，低空組（長機後方 110～140 m）才落在選單右邊
      streamLead(t, out.position).add(S1.set(-30, 260, 90))
      shake(t, 0.3, 36, out.position)
      streamLead(t, out.target).add(S1.set(-30, 0, 90))
      shake(t, 0.3, 37, out.target)
      out.up.set(-1, 0, 0)
      out.fov = 50
    },
  },
  {
    from: 15.9, subject: null, mount: 0,
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
      // 正上方垂直俯視整片廠區：離地 1300 m 往正下方看，畫面右邊是北、上方是西，整片
      // 廠區的東西向剛好塞滿畫面高度。長機組那幾串炸彈從南（左）往北（右）一顆接一顆
      // 炸過動力區，編隊在 900 m 下方從左往右飛過廠區上空；27.0 秒起低空組的幾串接著
      // 落下。廠區南緣那排廠房在選單後面，炸彈串從選單右緣開始走。
      // 伴飛機，手持 0.05°（1300 m 外晃 1 m）
      out.position.set(480, 1300, -1240)
      shake(t, 1.0, 38, out.position)
      out.target.set(480, 0, -1240)
      out.up.set(-1, 0, 0)
      out.fov = 40
    },
  },
  {
    from: 27.3, subject: null,
    camera(t, out) {
      // 廠區東緣、冷卻塔外 60 m 的地上（離地 20 m）往西仰看：編隊在 400 m 高空、炸彈還一串串
      // 掛在天上往下落，地面那幾串從畫面左邊（南）一顆接一顆往右（北）走過動力區，
      // 鍋爐房、氣櫃、煙囪在爆炸裡清楚可辨；左前景是南排的廠房。
      // 因果同框：觀眾先看到炸彈在天上、再看到它落地。380 m 外，鏡頭穩，只在幾下大的
      // 殉爆時輕震（0.4～0.6°）
      out.position.set(800, 20, -1150)
      shake(t, 0.3, 7, out.position)
      out.target.set(430, 140, -1185)
      shake(t, 0.5, 8, out.target)
      jolt(t, 27.64, 0.5, out.target)
      jolt(t, 27.92, 0.6, out.target)
      out.fov = 60
    },
  },
  {
    from: 28.6, subject: null,
    camera(t, out) {
      // 廠區東北角外的田上 60 m（高過樹梢與廠房）仰看：編隊從左上方飛過去，右下 320 m 外的
      // 廠區連環殉爆 —— 中東那組油槽一座接一座炸成火球（28.9、29.25、29.6、29.95 秒），
      // 30.25 秒整組炸成一大團。注視點跟不上長機 0.25 秒、偏向背後挨炸的槽組（手持 0.25°）
      out.position.set(760, 60, -1640)
      shake(t, 0.4, 9, out.position)
      streamLead(t - 0.25, S1)
      S2.set(620, 25, -1360)
      aimBetween(out.position, S1, S2, 0.6, out.target)
      shake(t, 0.5, 10, out.target)
      out.fov = 64
    },
  },
  {
    from: 30.6, subject: 5, mount: 0,
    camera(t, out) {
      // 收尾第一刀：長機左翼根上方、兩具發動機之間往後下方看。後下方整片廠區在燒，西北
      // 槽區一座接一座殉爆（30.8～31.7 秒）、32.0 秒炸成一大團；左後下方是低空組。
      // 低空組右僚機冒了半天煙的那一具 31.0 秒燒起來，32.3 秒撐不住、拖著火與黑煙掉出
      // 編隊；注視點跟著它（晚 0.2 秒，跟不上一點）往下搖。它剛開始往下掉、在畫面裡往下
      // 走的時候切到下一刀。自己的垂尾在畫面右緣一角。掛在機上，只留 0.15° 的慢晃。
      // 【不架在機背中線】從中線往後看，垂尾從上緣直插到下緣、把廠區擠到角落
      body(streamLead, t, -5, 2.6, 6, false, out.position)
      const tf = t - 0.2
      if (tf < LAST_FALL_AT) lowRight(tf, S1)
      else wreckAt(FALL_P, FALL_V, tf - LAST_FALL_AT, S1)
      aimBetween(out.position, S1, FALL_PLANT, 0.25, out.target)
      shake(t, 0.25, 12, out.target)
      bodyUp(streamLead, t, out.up)
      out.fov = 48
    },
  },
  {
    from: 33.0, subject: null,
    camera(t, out) {
      // 收尾第二刀：近距離追拍。鏡頭在那架 B-17 前上方 55 m（偏西 20 m），跟著它往北的
      // 水平速度走、高度不跟，往後下方看：它拖著火與黑煙往下掉、翻著，離鏡頭從 55 m
      // 拉到 100 m 外、越來越小；它後下方是整片燃燒的廠區，隨著它往下掉、廠區從畫面
      // 下緣升進來（33.5 秒槽區最後一團殉爆、震一下）。它還在 300 m 高時結束，不跟到
      // 落地。跟拍機的手持 0.25°。
      // 【接上一刀的動作】上一刀從長機往後（南）看，它在畫面裡往下、往遠處退；這一刀
      // 同樣往南看，它也是往下、往遠處退，左右方向不翻
      // 【在它前上方，不在它後上方】它掉出去時已經飛過廠區北緣、還在往北滑：從它後上方
      // 往前看，廠區在鏡頭背後
      wreckAt(FALL_P, FALL_V, t - LAST_FALL_AT, S1)
      out.position.set(S1.x - 20, FALL_P.y + 22, S1.z - 50)
      shake(t, 0.15, 41, out.position)
      wreckAt(FALL_P, FALL_V, t - 0.12 - LAST_FALL_AT, S2)
      aimBetween(out.position, S2, FALL_PLANT, 0.2, out.target)
      shake(t, 0.3, 42, out.target)
      jolt(t, 33.5, 0.4, out.target)
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
  // 7、8：穿梭的 109（換掉兩架野馬護航 —— 攔截的是一整個中隊，護航在畫面上沒有戲）
  { spec: BF109K4, path: raidAstern },
  { spec: BF109K4, path: raidLead },
  { spec: BF109K4, path: bandit },
  { spec: BF109K4, path: bandit2 },
  { spec: B17G, path: forwardA, extra: true },
  { spec: B17G, path: forwardB, extra: true },
  // 13～15：其餘穿梭的 109
  { spec: BF109K4, path: raidWing },
  { spec: BF109K4, path: raidLow },
  { spec: BF109K4, path: raidCross },
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
  duration: 35.6,
  // 十一月的正午：太陽在西南偏南、仰角 25°，天色灰白。編隊往北飛，太陽在它左後方 ——
  // 往北看的鏡頭順光，往南看的逆光（機身背光變暗）
  timeOfDay: 'novemberNoon',
  faceSun: false,
  terrain: 'autumnFarmland',
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
    ...barrage(101, 0, 35.5, 2.0, (t, out) => streamLead(t, out).add(S3.set(-20, -20, 70)),
      { x: 190, yLo: -80, yHi: 100, z: 240 }, edit(CUTS), 70),
    // 投彈航線上：長機組前方的一片彈幕，編隊直直飛進去
    ...barrage(202, 13.3, 18.8, 3.0, (t, out) => streamLead(t, out).add(S3.set(10, 10, -260)),
      { x: 160, yLo: -50, yHi: 90, z: 160 }, edit(CUTS), 70),
    // 垂直俯視那一刀：編隊上方一層黑雲，夾在鏡頭與飛機之間
    ...barrage(303, 14.0, 15.9, 7.0, (t, out) => streamLead(t, out).add(S3.set(-30, 90, 60)),
      { x: 140, yLo: -40, yHi: 60, z: 200 }, edit(CUTS), 70),
    // 開場長焦：鏡頭與編隊之間的兩朵，從右往左飄過前景
    { at: 0.4, kind: 'flak', x: FLAK_OPEN_1.x, y: FLAK_OPEN_1.y, z: FLAK_OPEN_1.z },
    { at: 1.3, kind: 'flak', x: FLAK_OPEN_2.x, y: FLAK_OPEN_2.y, z: FLAK_OPEN_2.z },
    // 高砲先咬上左僚機（右外側發動機冒煙），第二朵貼著長機炸開；低空組右僚機也挨了一朵
    { at: FLAK_WING_AT, kind: 'flak', x: FLAK_WING.x, y: FLAK_WING.y, z: FLAK_WING.z },
    { at: 2.8, kind: 'smoke', actor: 1, engine: 1 },
    { at: FLAK_NEAR_AT, kind: 'flak', x: FLAK_NEAR_P.x, y: FLAK_NEAR_P.y, z: FLAK_NEAR_P.z },
    { at: 3.3, kind: 'smoke', actor: 5, engine: 2 },
    // 第一架 109 撲向右僚機：編隊的機槍手迎著它打，它從 500 m 打到 260 m
    { at: 2.6, kind: 'gunner', actor: STREAM_HIT, target: BANDIT, seconds: 4.0, miss: 14 },
    { at: 3.0, kind: 'gunner', actor: 0, target: BANDIT, seconds: 3.4, miss: 12 },
    { at: 3.4, kind: 'gunner', actor: 6, target: BANDIT, seconds: 3.0, miss: 18 },
    { at: 3.5, kind: 'gunner', actor: 5, target: BANDIT, seconds: 2.2, miss: 20 },
    { at: 3.65, kind: 'gunner', actor: 3, target: BANDIT, seconds: 2.8, miss: 16 },
    { at: FIRE_1 - FIRE_HALF, kind: 'burst', actor: BANDIT, seconds: 2 * FIRE_HALF, target: STREAM_HIT },
    // 右內側發動機：先冒煙，兩秒後竄出火 —— 火一下子整團冒出來的話看不出是被打的
    { at: 5.6, kind: 'smoke', actor: STREAM_HIT, engine: 0 },
    { at: 7.8, kind: 'smoke', actor: STREAM_HIT, engine: 0, fire: true },
    // 衝過去之後低空組追著它的背打
    { at: 6.8, kind: 'gunner', actor: 5, target: BANDIT, seconds: 1.8, miss: 14 },
    { at: 7.0, kind: 'gunner', actor: 3, target: BANDIT, seconds: 1.6, miss: 18 },
    // 第二架 109 撲向長機；掉出隊形的右僚機照樣還擊
    { at: 8.2, kind: 'gunner', actor: 0, target: BANDIT_2, seconds: 3.0, miss: 10 },
    { at: 8.5, kind: 'gunner', actor: 1, target: BANDIT_2, seconds: 2.6, miss: 14 },
    { at: 8.7, kind: 'gunner', actor: STREAM_HIT, target: BANDIT_2, seconds: 2.4, miss: 16 },
    { at: FIRE_2 - FIRE_HALF, kind: 'burst', actor: BANDIT_2, seconds: 2 * FIRE_HALF, target: 0 },
    // 穿梭的 109：迎頭穿過空隙之前打一短串（不帶目標 —— 曳光順著空隙穿過編隊），
    // 編隊的機槍手轉過去追著它們打
    { at: 4.7, kind: 'burst', actor: RAID_LEAD, seconds: 0.5 },
    { at: 5.0, kind: 'burst', actor: RAID_WING, seconds: 0.5 },
    { at: 5.2, kind: 'gunner', actor: 1, target: RAID_LEAD, seconds: 1.4, miss: 16 },
    { at: 5.4, kind: 'gunner', actor: 6, target: RAID_WING, seconds: 1.4, miss: 18 },
    { at: 9.4, kind: 'burst', actor: RAID_LOW, seconds: 0.5 },
    { at: 9.5, kind: 'gunner', actor: 1, target: RAID_LOW, seconds: 1.4, miss: 14 },
    { at: 9.7, kind: 'gunner', actor: 3, target: RAID_LOW, seconds: 1.4, miss: 16 },
    { at: FIRE_2 + FIRE_HALF + 0.05, kind: 'smoke', actor: 0, engine: 2 },
    { at: FLAK_SAG_AT, kind: 'flak', x: FLAK_SAG.x, y: FLAK_SAG.y, z: FLAK_SAG.z },
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
    // 炸彈串之後的連環殉爆（油槽、油桶堆炸毀時自己會殉爆一團 2.5 倍的火球）：中東槽組
    // 一座接一座、30.25 秒一大團 → 西北槽區一座接一座、32.0 秒一大團 → 收尾還在炸
    { at: 28.9, kind: 'destroy', prop: 10 },
    { at: 29.25, kind: 'destroy', prop: 12 },
    { at: 29.6, kind: 'destroy', prop: 11 },
    { at: 29.95, kind: 'destroy', prop: 13 },
    { at: 30.25, kind: 'blast', x: 620, y: 15, z: -1360, size: 4 },
    { at: 30.8, kind: 'destroy', prop: 7 },
    { at: 31.1, kind: 'destroy', prop: 5 },
    { at: 31.4, kind: 'destroy', prop: 9 },
    { at: 31.7, kind: 'destroy', prop: 3 },
    { at: 32.0, kind: 'blast', x: 130, y: 15, z: -1450, size: 4.5 },
    { at: 32.8, kind: 'destroy', prop: 1 },
    { at: 33.2, kind: 'destroy', prop: 6 },
    { at: 33.5, kind: 'blast', x: 100, y: 12, z: -1470, size: 3 },
    // 收尾：低空組右僚機那具冒了半天煙的發動機燒起來，撐到 32.3 秒掉出編隊
    { at: 31.0, kind: 'smoke', actor: 5, engine: 2, fire: true },
    { at: LAST_FALL_AT, kind: 'kill', actor: 5, blast: false },
  ]),
}
