import { Vector3 } from 'three'
import { JU87 } from '../../specs/ju87'
import { hash01 } from '../../core/hash'
import { scatterClouds, type CloudSpec } from '../../render/clouds'
import {
  BOMB_RELEASE_Y, barrage, bombAt, body, bodyUp, edit, propAt, propTravel, timeline, velocityAt,
  type Cut, type ReelCamera, type ReelEvent, type ReelPlane, type ReelProp, type Shot,
} from './kit'
import { aimBetween, dutch, jolt } from './reelCameraMath'
import { easeInOut, ramp } from './reelTiming'
import { COUNT, PATHS, LEAD, WING, PULL_IN_AT, peelAt, releaseAt, cruise } from './stukaFlight'

// ── 斯圖卡俯衝轟炸 ─────────────────────────────────────────
//
// 夏日正午、農地上空。六架 Ju 87 成右梯隊往北飛，一架接一架拉起、翻成腹部朝上、
// 機首往下拉進俯衝，炸路上的蘇軍縱隊（T-34 與卡車），投完彈拉起、往南爬升離開。

/**
 * 每一架那一枚炸彈的落點（局部座標，y = 0）與落地時刻。載入時照放映機同一套彈道
 * （`body` 的機腹點、`velocityAt` 的中央差分、`bombAt`）算一次
 */
const IMPACTS: Vector3[] = []
const IMPACT_AT: number[] = []
for (let i = 0; i < COUNT; i++) {
  const at = releaseAt(i)
  const p0 = body(PATHS[i]!, at, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
  const v0 = velocityAt(PATHS[i]!, at, new Vector3())
  const out = new Vector3()
  let lo = 0
  let hi = 20
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2
    if (bombAt(p0, v0, mid, out).y > 0) lo = mid
    else hi = mid
  }
  bombAt(p0, v0, hi, out)
  out.y = 0
  IMPACTS.push(out)
  IMPACT_AT.push(at + hi)
}

/** 投彈那一刀拍的那一枚：長機的炸彈（第一顆落地的）投下那一刻的機腹點與速度 */
const DROP_AT = releaseAt(0)
const DROP_P = body(LEAD, DROP_AT, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
const DROP_V = velocityAt(LEAD, DROP_AT, new Vector3())
/**
 * 投彈那一刀：鏡頭在長機左翼尖外、往機腹那一側 `-DROP_LOW` m、略後（機身座標），上方跟著
 * 機背 —— 從斜下方看機腹，機身橫在畫面裡、機頭朝左，炸彈在兩支起落架之間的機腹下。
 * 【要低過翼面】跟機腹差不多高的話，左翼與起落架整片擋在機腹前面
 * 投彈那一刻脫鉤：之後順著投彈那一刻的速度
 * 直線往下、上方停在那一刻的機背。飛機拉起往畫面上方離開；炸彈留在鏡頭前，被重力往前
 * （畫面左）、往機腹那一側（畫面下）帶開 —— 看得到它離開機腹往下掉
 * 【左側】機頭朝左，炸彈往前帶開時往畫面中間走；在右側的話它往右緣跑，一下就出畫
 */
const DROP_SIDE = 7
const DROP_LOW = -8
const DROP_BACK = 3
const DROP_FOV = 40
const DROP_CAM = body(LEAD, DROP_AT, -DROP_SIDE, DROP_LOW, DROP_BACK, false, new Vector3())
const DROP_UP = bodyUp(LEAD, DROP_AT, new Vector3())
/** 注視點從「投彈點順著速度走到哪」轉到炸彈本身：投彈後這一段時間裡從一半轉到全跟 */
const DROP_FOLLOW_AT = 0.5
const DROP_FOLLOW = 0.6

// ── 路與縱隊 ───────────────────────────────────────────────
//
// 路沿著六個落點那條線，往兩頭各拉 7.5 km。縱隊沿著路往北開（`COLUMN_SPEED`）：每兩個
// 落點之間三輛，前後各多兩輛。每一顆炸彈都落在一輛車上 —— 那一輛的出發點往回推，炸彈
// 落地那一刻（`IMPACT_AT`）正好開到落點。挨炸的幾輛走路中間，其餘的走左右兩側：炸毀
// 的停在原地，後面的從旁邊開過去，不會穿過殘骸

/** 路的走向（單位向量，往北那一頭）與每兩個落點的間距 */
const ROAD_DIR = IMPACTS[COUNT - 1]!.clone().sub(IMPACTS[0]!).normalize()
const ROAD_GAP = IMPACTS[1]!.distanceTo(IMPACTS[0]!)
/** 路的右手邊（往北看的右邊，東） */
const ROAD_RIGHT = new Vector3(-ROAD_DIR.z, 0, ROAD_DIR.x)
/** 車頭的方向，`ReelProp.heading` 的約定：前進方向 (−sin h, 0, −cos h) */
const COLUMN_HEADING = Math.atan2(-ROAD_DIR.x, -ROAD_DIR.z)
const PER_GAP = 3
const LEAD_IN = 2
/** 縱隊的行軍速度，m/s（約 29 km/h）；第一顆命中後依 `COLUMN_BRAKE` 煞停。 */
const COLUMN_SPEED = 8
/** 沒挨炸的車偏離路中線多少，m。車寬 3 m：偏 3.6 m 與中線上的殘骸留 0.6 m */
const COLUMN_SIDE = 3.6

/** 路上第 `s` 公尺那一點（從第一個落點量起，往北為正），寫進 `out` */
function onRoad(s: number, side: number, out: Vector3): Vector3 {
  return out.copy(IMPACTS[0]!).addScaledVector(ROAD_DIR, s).addScaledVector(ROAD_RIGHT, side)
}

/**
 * 第一顆炸開那一刻全隊踩煞車，`COLUMN_BRAKE.seconds` 秒內停住、之後原地不動（`propTravel`）
 */
const COLUMN_BRAKE = { at: IMPACT_AT[0]!, seconds: 1.5 }
const COLUMN_MOTION: ReelProp = { id: 'tank', x: 0, z: 0, heading: 0, speed: COLUMN_SPEED, brake: COLUMN_BRAKE }
/**
 * 第 `i` 個落點那一輛第 0 秒在路上第幾公尺：炸彈落地那一刻開到落點（含煞車，所以第三顆
 * 以後的目標是剛好停在落點上）
 * 【出發點要照煞車算】照等速算的話，煞停之後還沒挨炸的目標停在落點前面，後面幾顆炸空
 */
const spawnOnRoad = (i: number): number => i * ROAD_GAP - propTravel(COLUMN_MOTION, IMPACT_AT[i]!)

const PROPS: readonly ReelProp[] = (() => {
  const out: ReelProp[] = []
  const n = (COUNT - 1) * PER_GAP + 1 + 2 * LEAD_IN
  const step = (spawnOnRoad(COUNT - 1) - spawnOnRoad(0)) / ((COUNT - 1) * PER_GAP)
  const p = new Vector3()
  for (let k = 0; k < n; k++) {
    const slot = k - LEAD_IN
    // 落在落點上的那一輛走中線、不偏；其餘沿路前後錯一點、輪流走左右兩側
    const onImpact = slot >= 0 && slot % PER_GAP === 0 && slot / PER_GAP < COUNT
    const jitter = onImpact ? 0 : (((k * 37) % 11) / 10 - 0.5) * 6
    const side = onImpact ? 0 : (k % 2 === 0 ? COLUMN_SIDE : -COLUMN_SIDE)
    // 兩個落點之間照出發點內插；前後多出來的照平均車距外推
    const g = Math.floor(slot / PER_GAP)
    const s = onImpact
      ? spawnOnRoad(slot / PER_GAP)
      : g >= 0 && g < COUNT - 1
        ? spawnOnRoad(g) + (spawnOnRoad(g + 1) - spawnOnRoad(g)) * ((slot - g * PER_GAP) / PER_GAP)
        : spawnOnRoad(0) + slot * step
    onRoad(s + jitter, side, p)
    // 每三輛一輛戰車，其餘卡車；落點上一律放戰車
    const id = onImpact || k % 3 === 1 ? 'tank' : 'truck'
    out.push({ id, x: p.x, z: p.z, heading: COLUMN_HEADING, speed: COLUMN_SPEED, brake: COLUMN_BRAKE })
  }
  return out
})()

/**
 * 交叉剪接（見刀表）各刀的起點：飛行員視角 1.7、長機側拍 2.15、卡車 1.0、
 * 駕駛室 1.75 秒，接投彈那一刀。最後兩刀都在地上、一刀比一刀近，收在長機迎面衝下來
 */
const X_PILOT = 13.6
// 刪除砲塔仰拍後，空出的 1.3 秒平均分給側面俯衝與迎面俯衝。
const X_SIDE = 15.3
const X_TRUCK = 17.45
const X_CAB = 18.45
const X_DROP = 20.2
/**
 * 交叉剪接裡架在車上的兩刀各架在哪一台：卡車旁、卡車駕駛室旁。都不是
 * 挨炸的車，也不在 `GROUND_FIRE` 輪流開火的那十台裡 —— 各自另外排一段機槍（`MOUNT_FIRE`），
 * 鏡頭架在上面的那一刀它一定在打
 * 【鏡頭離地下限 1 m】再扣掉車身顛簸（`jostle` 最多 0.08 m）
 */
const TRUCK_PROP = 0
const CAB_PROP = 6
/**
 * 卡車那一刀（車身座標：x 右、y 離地、z 車尾，m）：蹲在車尾右後方（命中盒車尾 3.36，外擴
 * 0.3）、比車身頂（2.70）低，往前上方看。注視點從長機偏向車尾頂邊右角（`TRUCK_W`）：篷布
 * 的角在畫面下段，長機在它上方 —— 同一個方位，都落在選單右邊那半
 * 【要貼近、要低】車尾頂邊離鏡頭水平不到 1 m、高 1.6 m，仰角 60° 上下，才跟仰角約 77° 的
 * 長機塞得進同一個長焦畫面；再退後，車身就掉出畫面下緣
 */
const TRUCK_X = 1.1
const TRUCK_Y = 1.1
const TRUCK_Z = 4.1
const TRUCK_EDGE_X = 0.9
const TRUCK_EDGE_Y = 2.7
const TRUCK_EDGE_Z = 3.3
const TRUCK_W = 0.33
const TRUCK_FOV = 26
/** 駕駛室那一刀：貼著駕駛室右側車門（命中盒半寬 1.21，外擴 0.3）、比車頂低 */
const CAB_X = 1.6
const CAB_Y = 1.7
const CAB_Z = -2.2
const ON_VEHICLE = new Vector3()

/**
 * 投彈那一刀拍到炸彈脫離、飛機拉起，就跳接（`TimeJump`）到縱隊北頭沿路看那一刀：片內
 * `JUMP_FROM` 直接跳到 `JUMP_TO`，炸彈往下掉的那幾秒剪掉，切過去 0.1 秒後第一顆炸開
 * 【跳到落地前】跳過落地那一刻的話，炸彈在地底下才被看到，炸點偏掉
 */
const JUMP_FROM = 21.6
const JUMP_TO = 24.4

/**
 * 路邊看見編隊那一刀：起訖秒數；機位在第 `SPOT_PASS_PROP` 台戰車 `SPOT_PASS_AT` 秒開到的
 * 地方的路東邊 `SPOT_SIDE` m（那台戰車那時從鏡頭旁邊開過去）—— 車開到鏡頭前 `SPOT_LOOK` m
 * 時，鏡頭到車的連線與車頭方向夾 15°，從車的斜前方拍；接著直接切到天空，
 * 從較近的視角緩慢變焦至原本的編隊大小（視角單位為度）
 */
const SPOT_FROM = 3.2
const SPOT_TO = 6.8
const SPOT_PASS_PROP = 13
const SPOT_PASS_AT = 5.6
const SPOT_LOOK = 30
const SPOT_SIDE = SPOT_LOOK * Math.tan(15 * Math.PI / 180)
/** 車隊近景直接切到較近的天空構圖，不再從地面大幅甩上去。 */
const SPOT_SKY_AT = 4.1
const SPOT_FOV_ROAD = 40
const SPOT_FOV_SKY = 8
const SPOT_FOV_ZOOM = 4.5
const SPOT_PASS = propAt(PROPS[SPOT_PASS_PROP]!, SPOT_PASS_AT, new Vector3())
const SPOT_CAM = SPOT_PASS.clone().addScaledVector(ROAD_RIGHT, SPOT_SIDE).setY(6)
const SPOT_SKY_START = cruise(2.5, SPOT_SKY_AT, new Vector3())
/**
 * 拍路時的注視點：沿著路往南 120 m、再往路那一側偏 10° —— 路的消失點落在注視點左邊一點，
 * 開過來的那台車在它右邊十來度，兩者都在主角讓到的畫面右半。注視點擺在路上的話，往遠處
 * 收的那一串車全擠到畫面左半、躲進選單後面；視線與路平行的話，開過來的車一開始就貼在
 * 畫面右緣
 */
const SPOT_ROAD = SPOT_CAM.clone().addScaledVector(ROAD_DIR, -120)
  .addScaledVector(ROAD_RIGHT, -120 * Math.tan(10 * Math.PI / 180)).setY(2)

/**
 * 第 `k` 台車第 `t` 秒車身座標 (x 右、y 上、z 車尾) 那一點的局部座標，寫進 `out`。
 * 車的位置是 `propAt`，車頭朝 (−sin h, 0, −cos h)
 */
function onVehicle(k: number, t: number, x: number, y: number, z: number, out: Vector3): Vector3 {
  const p = PROPS[k]!
  propAt(p, t, ON_VEHICLE)
  const c = Math.cos(p.heading)
  const s = Math.sin(p.heading)
  return out.set(ON_VEHICLE.x + x * c + z * s, y, ON_VEHICLE.z - x * s + z * c)
}

const ROAD_FAR = 7500
const ROAD_S = onRoad(-ROAD_FAR, 0, new Vector3())
const ROAD_N = onRoad((COUNT - 1) * ROAD_GAP + ROAD_FAR, 0, new Vector3())
/** 墊面放在路的北段、縱隊外 7 km（見 `STUKA.ground`） */
const PAD_AT = onRoad((COUNT - 1) * ROAD_GAP + 7000, 260, new Vector3())

// ── 鏡頭工具 ───────────────────────────────────────────────

const S1 = new Vector3()
const S2 = new Vector3()

/**
 * 手持／機上的慢晃（與 raid 同一支）：注視點繞著鏡頭偏一個小角度，頻率 0.3～1.1 Hz 互質
 * 的正弦疊起來。指向的晃動 RMS 約 0.7 × `deg` 度。偏的是角度不是公尺 —— 注視點在 5 m 與
 * 300 m 的刀，同一個 `deg` 晃得一樣多。在注視點設好之後呼叫。
 * 【要慢】快過 1.5 Hz 的話讀起來是抖，不是手持
 */
function shake(t: number, deg: number, seed: number, out: ReelCamera): void {
  const d = out.target.distanceTo(out.position) * deg * (Math.PI / 180)
  out.target.x += d * (0.6 * Math.sin(2.1 * t + seed) + 0.4 * Math.sin(4.9 * t + 2.1 * seed))
  out.target.y += d * (0.6 * Math.sin(2.9 * t + 1.3 * seed) + 0.4 * Math.sin(6.7 * t + seed))
  out.target.z += d * (0.5 * Math.sin(2.5 * t + 0.7 * seed) + 0.5 * Math.sin(4.3 * t + 1.9 * seed))
}

/** 車隊中段：空中的防空彈幕以這裡為中心。 */
const BURNING = onRoad(ROAD_GAP, 0, new Vector3())
/** 左前方迎拍第二架；以航跡前方取景，鏡頭不跟著機身向左滾。 */
const ROLL_SECOND = PATHS[1]!
/** 原版僚機座艙罩後上方機位：機背留在前景，向左前方看長機。 */
const HERO_CAM_X = 0.4
const HERO_CAM_Y = 1.8
const HERO_CAM_Z = 3.3
const HERO_W = 0.2
const HERO_FOV = 64
/** 僚機頭頂看完整翻轉後，直接跳接迎面俯衝近景。 */
const ROLL_CUT_AT = 10.2
const ROLL_CLOSE_AT = 12.2

/** 第 `i` 架那一枚炸彈落在哪一台車上（落點上那一台，見 `PROPS`） */
const targetProp = (i: number): number => LEAD_IN + i * PER_GAP

/**
 * 飛行員視角：鏡頭在長機座艙罩後上方（機身座標 y `PILOT_UP`、往後 `PILOT_BACK` m），長焦
 * 對準縱隊，整刀從 `fov0` 收到 `fov1`（對著目標衝過去）。上方跟著機背，路在畫面裡上下走
 * 向；長焦下看不到自己的機身
 * 【長焦】縱隊在一公里外，從上往下看一台車只有 3 × 6.7 m：視角 15° 時是十來個像素的
 * 小點，畫面上讀起來只有田與路
 * 【要高過槳盤】槳盤半徑約 1.7 m；視線穿過槳盤的話，整個長焦畫面蒙上一層半透明的灰
 * 【垂尾】命中盒從往後 3.87 m 起（外擴 0.5），鏡頭在它前面
 */
const PILOT_UP = 2.8
const PILOT_BACK = 3.2
const PILOT_FOV0 = 7
const PILOT_FOV1 = 5
/** `w` = 注視點從縱隊中段（前兩個落點的中間）偏向長機那一枚目標的比例 */
function pilotView(t: number, from: number, to: number, fov0: number, fov1: number, w: number, out: ReelCamera): void {
  body(LEAD, t, 0, PILOT_UP, PILOT_BACK, false, out.position)
  propAt(PROPS[targetProp(0)]!, t, S1)
  propAt(PROPS[targetProp(1)]!, t, S2)
  out.target.copy(S2).lerp(S1, 0.5 + 0.5 * w)
  bodyUp(LEAD, t, out.up)
  out.fov = fov0 + (fov1 - fov0) * Math.min(1, Math.max(0, (t - from) / (to - from)))
  shake(t, 0.15 * out.fov / 16, 27, out)
}

/** 車在開：鏡頭跟著車身慢晃加一點顛，疊進 `p` */
function jostle(t: number, p: Vector3): void {
  p.y += 0.05 * Math.sin(2 * Math.PI * 2.3 * t) + 0.03 * Math.sin(2 * Math.PI * 3.7 * t + 1)
}

/**
 * 車上往上看長機：注視點介於長機與車頭前方 200 m 的路面之間（`w` = 偏向路面的比例），
 * 加手持晃動（長焦下照視角收小）
 */
function lookUpAtLead(t: number, k: number, w: number, seed: number, out: ReelCamera): void {
  LEAD(t, S1)
  onVehicle(k, t, 0, 0, -200, S2)
  aimBetween(out.position, S1, S2, w, out.target)
  shake(t, 0.35 * Math.pow(out.fov / 40, 0.6), seed, out)
}
/** 駕駛室那一刀：注視點偏向路面的比例與視角（度） */
const CAB_W = 0
const CAB_FOV = 6

/** 第三顆命中前換到側拍；最後一顆火光膨脹時切到拉起。 */
const IMPACT_TRACK_AT = IMPACT_AT[2]! - 0.12
const IMPACT_END = IMPACT_AT[COUNT - 1]! + 0.16
/** 第四架在前景，最後兩架與尚未散去的轟炸煙塵在後景。 */
const DEPARTURE_ACTOR = 3
/** 離場只保留一段近拍，包含最後 0.6 秒暗場。 */
const END_AT = 31.2
const DEPARTURE_START = PATHS[DEPARTURE_ACTOR]!(IMPACT_END, new Vector3())
/** 六處燃燒區維持前後景擺位；起火時間錯開，兩處相鄰火點匯成較寬的煙，避免排成等粗煙柱。 */
const DEPARTURE_SMOKE: readonly ReelEvent[] = [{
  at: IMPACT_TRACK_AT + 0.1,
  kind: 'fireColumns',
  points: [
    { x: 10, z: -30, age: 12.8 },
    { x: 18, z: -25, age: 7.3 },
    { x: 80, z: -30, age: 5.2 },
    { x: 150, z: 10, age: 15.5 },
    { x: 55, z: 80, age: 8.1 },
    { x: 80, z: 145, age: 13.6 },
    { x: 74, z: 151, age: 4.7 },
    { x: 100, z: 215, age: 4.3 },
  ].map(({ x, z, age }) => ({ x: DEPARTURE_START.x + x, z: DEPARTURE_START.z + z, age })),
}]

/**
 * 路側低空平移，沿路速度配合落彈間隔，從側面看連續命中。
 * 機位高度、炸點距離與仰角保持固定，讓火球自然膨脹入鏡，收尾不推近或抬頭。
 */
function impactView(t: number, out: ReelCamera): void {
  const along = ROAD_GAP * (t - IMPACT_AT[0]!) / (IMPACT_AT[1]! - IMPACT_AT[0]!)
  onRoad(along + 18, 38, out.position).setY(1.4)
  onRoad(along, 0, out.target).setY(4)
  out.fov = 58
  shake(t, 0.18, 16, out)
  for (const at of IMPACT_AT) jolt(t, at, 0.5, out.target)
}

/**
 * 側拍長機那一刀裡曳光瞄長機時偏開多少，m。偏移是每一軸各自 ±這麼多，最遠約 1.7 倍
 * （12 m），在長機四周散開往上竄
 * 【不能再大】鏡頭在長機西側 13 → 11.5 m；往西偏 7 m 的那一發離鏡頭還有 4 m，再大就有
 * 曳光從鏡頭上穿過去，整個畫面一道白
 */
const CROSSFIRE_MISS = 7

/**
 * 地面機槍的節奏：每台每 `FIRE_PERIOD` 秒打一段 `FIRE_BURST`～`FIRE_BURST + FIRE_BURST_SPREAD`
 * 秒的短點放。十台錯開，同一時間約三道
 * 【點放不連發】一道曳光每秒十幾發（放映機的射速），連打兩三秒、五道一起，讀起來是一片
 * 掃不完的光網，像射速過高
 */
const FIRE_PERIOD = 4.5
const FIRE_BURST = 0.9
const FIRE_BURST_SPREAD = 0.6

/**
 * 縱隊朝俯衝的斯圖卡打的機槍：每隔一台（十台）輪流點放（`FIRE_*`），各車的起點錯開。
 * 從 10.5 秒（長機拉進俯衝）打到 31.5 秒（最後一架
 * 拉出），每一段挑那時正在俯衝或拉出的一架打，瞄點偏開 25～45 m，曳光從飛機旁邊擦過去。
 * 跨到側拍長機那一刀的段改瞄長機、偏開 `CROSSFIRE_MISS`。炸毀的車自己停火
 * 【曳光只飛 1.2 秒】850 m/s 打不到一公里外：俯衝的前半段，曳光是往上竄、在半空熄掉
 */
const GROUND_FIRE: ReelEvent[] = (() => {
  const out: ReelEvent[] = []
  const from = 10.5
  const to = 31.5
  const push = (k: number, j: number, at: number, seconds: number): void => {
    if (seconds < 0.3) return
    const mid = at + seconds / 2
    // 那一刻在俯衝線上的：拉進俯衝之後、拉出到一半之前
    const live: number[] = []
    for (let i = 0; i < COUNT; i++) if (mid > peelAt(i) + PULL_IN_AT && mid < releaseAt(i) + 4.5) live.push(i)
    const cross = at < X_TRUCK && at + seconds > X_SIDE
    if (!cross && live.length === 0) return
    out.push({
      at, kind: 'groundFire', prop: k, actor: cross ? 0 : live[(k + j) % live.length]!, seconds,
      miss: cross ? CROSSFIRE_MISS : 25 + hash01(k * 29 + j + 11) * 20,
    })
  }
  for (let k = 1; k < PROPS.length; k += 2) {
    // 十台的起點均勻錯開在一個週期裡，同一時間的道數才穩定
    let at = from + ((k - 1) / 2) * (FIRE_PERIOD / 10)
    for (let j = 0; at < to; j++) {
      push(k, j, at, Math.min(FIRE_BURST + hash01(k * 17 + j + 5) * FIRE_BURST_SPREAD, to - at))
      at += FIRE_PERIOD
    }
  }
  return out
})()

/**
 * 交叉剪接裡鏡頭架著的兩台車各點放一段，瞄長機、偏開 20 m：從切進來前 `MOUNT_LEAD` 秒
 * 打到那一刀結束，那一刀裡曳光從鏡頭旁邊往上竄向畫面裡的長機。都在寧靜那一刀之前打完
 */
const MOUNT_LEAD = 1.4
/**
 * 05 切入前 1.2 秒就讓三台開始連射，整段 05 到 07 結束都不中斷。
 * 起射錯開少許，讓曳光形成持續的三路火網；07 切入時已有子彈飛到高空。
 * 這幾段專用曳光延長到 2 秒，避免在抵達一公里以上的飛機前消失；一般射擊維持原壽命。
 */
const CROSS_FIRE: ReelEvent[] = [8, 10, 12].map((prop, i) => {
  const at = X_PILOT - 1.2 + i * 0.1
  return { at, kind: 'groundFire', prop, actor: 0, seconds: X_TRUCK - at, miss: CROSSFIRE_MISS, tracerLife: 2 }
})
const MOUNT_FIRE: ReelEvent[] = [
  { at: X_TRUCK - MOUNT_LEAD, kind: 'groundFire', prop: TRUCK_PROP, actor: 0, seconds: X_CAB - X_TRUCK + MOUNT_LEAD, miss: 20, tracerLife: 2 },
  { at: X_CAB - MOUNT_LEAD, kind: 'groundFire', prop: CAB_PROP, actor: 0, seconds: X_DROP - X_CAB + MOUNT_LEAD, miss: 20, tracerLife: 2 },
]

// ── 刀表 ───────────────────────────────────────────────────
//
//   0.0–3.2   編隊裡：鏡頭在長機正後方、比隊形快一點往前滑，從第二架左邊 14 m 掠過，鏡頭
//             跟著它轉、慢慢滾轉；長機在左前方，後面一整排梯隊往右後方排開，底下是田
//   3.2–4.1   路邊固定機位看車隊迎面開來
//   4.1–6.8   直接切到天空編隊，從較近的構圖緩慢 zoom in
//   6.8–9.25  斜側拍長機翻離，小幅向機隊緩進，第二架側翻時貼近前景
//   9.25→12.2 跳接到原本的迎面俯衝鏡位，拍至 13.6 秒
//   ── 交叉剪接：空中、地面輪流；飛行員往下看與車上往上看互為對照，最後兩刀在地上 ──
//   13.6–15.3 飛行員視角：長機上長焦對準路上的縱隊，一台台車讀得出來，一邊收窄
//   15.3–17.45 長機西側 13 → 11.5 m 機身特寫：機頭朝右下往下衝，後上方是僚機，刀尾曳光
//             一陣一陣竄到它身邊
//   17.45–18.45 卡車車尾右後方往上看：篷布的角在下段，曳光從它後面竄出，上方一串斯圖卡
//   18.45–20.2 卡車駕駛室旁往正上方看（超長焦）：長機與僚機迎面衝下來，倒鷗翼與起落架
//             佔滿畫面
//   ──
//   20.2–21.6 長機左下方看機腹：炸彈掛在兩支起落架之間，20.5 秒脫離機腹，飛機拉起往上
//             離開、炸彈往下掉開
//   21.6–25.4 跳接到 24.4，貼著車隊低空前移，前兩顆爆炸在車輛後方由遠逼近
//   25.4–27.2 路側固定低角度平移，最後一次火光膨脹時直接切鏡
//   27.2–31.2 第四架從側前方近景超越鏡頭，後兩架接續掠過，燃燒車隊留在後景

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 1,
    camera(t, out) {
      // 鏡頭當成編隊裡的一架，在長機正後方、第二架左邊 14 m，每秒比隊形快 9 m 往前滑，
      // 2.9 秒從第二架身旁掠過，長機在左前方。注視點一路釘在它後方一點，鏡頭跟著往右轉，
      // 它背後整排梯隊往右後方排開。上方從左倒 10° 慢慢滾到右倒 8°
      // 【注視點在它後方】主角讓到畫面右邊；注視點在它前方的話，往右前看時它落在注視點
      // 右邊，被推出畫面
      cruise(0, t, out.position).add(S1.set(4, -1.5 + 0.4 * t, 40 - 9 * t))
      PATHS[1]!(t, out.target).add(S1.set(-2, 0, 8))
      out.fov = 55
      dutch(out, -10 + 5.6 * t)
      shake(t, 0.12, 1, out)
    },
  },
  {
    from: SPOT_FROM, subject: null,
    camera(t, out) {
      // 路邊固定機位只看車隊迎面開來，天空另切一刀，免去大幅抬鏡。
      out.position.copy(SPOT_CAM)
      out.target.copy(SPOT_ROAD)
      out.fov = SPOT_FOV_ROAD
      shake(t, 0.06, 3, out)
    },
  },
  {
    from: SPOT_SKY_AT, subject: null,
    camera(t, out) {
      // 機位平移抵銷八成的編隊位移，追蹤轉向只留兩成；構圖仍由 8° 緩收至 4.5°。
      cruise(2.5, t, out.target)
      out.position.copy(out.target).sub(SPOT_SKY_START).multiplyScalar(0.8).add(SPOT_CAM)
      // 線性收窄視角，切鏡前仍持續變焦，不在尾段減速至停住。
      const zoom = Math.min(1, Math.max(0, (t - SPOT_SKY_AT) / (SPOT_TO - SPOT_SKY_AT)))
      out.fov = SPOT_FOV_SKY + (SPOT_FOV_ZOOM - SPOT_FOV_SKY) * zoom
      shake(t, 0.16 * Math.pow(out.fov / SPOT_FOV_ROAD, 0.6), 3, out)
    },
  },
  {
    from: 6.8, subject: 0, mount: 1,
    camera(t, out) {
      // 恢復原版第二架座艙罩後上方的構圖，先看長機翻轉，再隨僚機一起滾轉。
      body(ROLL_SECOND, t, HERO_CAM_X, HERO_CAM_Y, HERO_CAM_Z, false, out.position)
      LEAD(t, S1)
      body(ROLL_SECOND, t, 0, 0, -300, false, S2)
      aimBetween(out.position, S1, S2, HERO_W, out.target)
      bodyUp(ROLL_SECOND, t, out.up)
      shake(t, 0.12, 5, out)
      out.fov = HERO_FOV
    },
  },
  {
    from: ROLL_CUT_AT, subject: null,
    camera(t, out) {
      // 跳接回原本的俯衝近景：沿第二架前方的航跡退行，保留已確認的角度與變焦曲線。
      const close = easeInOut(t, 6.8, X_PILOT - 6.8)
      ROLL_SECOND(t + 0.65 - 0.55 * close, out.position)
      out.position.add(S1.set(-30 + 28 * close, 0, 0))
      LEAD(t, S1)
      ROLL_SECOND(t, S2)
      out.target.copy(S1).lerp(S2, easeInOut(t, 8.5, 2.5))
      // 先留住長機的左右位置，讓它掉出畫面下緣後，才把水平構圖交給第二架。
      out.target.x = S1.x + (S2.x - S1.x) * easeInOut(t, 10.2, 1.4)
      shake(t, 0.16, 5, out)
      out.fov = 64 - 10 * close
    },
  },
  {
    from: X_PILOT, subject: null, mount: 0,
    camera(t, out) {
      // 飛行員視角：長機座艙罩後上方，長焦對準路上的縱隊，一邊往前衝一邊收窄。地面的機槍
      // 曳光從下面往上竄
      pilotView(t, X_PILOT, X_SIDE, PILOT_FOV0, PILOT_FOV1, 0, out)
    },
  },
  {
    from: X_SIDE, subject: 0,
    camera(t, out) {
      // 長機西側 13 m 跟拍、往東看，幾乎是機身特寫，鏡頭正立不歪（上方是世界的上方），
      // 手持晃得很兇：前景的長機機首朝下往畫面下方衝，後景是它的右僚機，在它上方約 25 m
      // （畫面上方）一起衝下來。縱隊從南邊（畫面右下）打上來的曳光貼著長機往上竄。鏡頭跟著
      // 長機往下掉、慢慢推近到 11.5 m
      // 【鏡頭在西側】往南俯衝約 77°，從西側看南邊在畫面右邊，機頭朝右下偏離垂直約 13°，
      // 座艙罩朝畫面右上，看得出是正著衝
      // 【彈道碰不到鏡頭】曳光從南邊下方打上來、瞄點往鏡頭這側最多偏 7 m（`CROSSFIRE_MISS`），
      // 鏡頭在 11.5 m 外的側面
      // 【交叉剪接的後段才放它】離縱隊一公里以內曳光才打得到長機身邊（見 `CROSS_FIRE`）
      const u = (t - X_SIDE) / (X_TRUCK - X_SIDE)
      LEAD(t, out.position).add(S1.set(-(13 - 1.5 * u), -2, 2))
      LEAD(t, S1)
      WING(t, S2)
      aimBetween(out.position, S1, S2, 0.4, out.target)
      shake(t, 0.6, 22, out)
      out.fov = 70
    },
  },
  {
    from: X_TRUCK, subject: 0, groundMount: TRUCK_PROP,
    camera(t, out) {
      // 卡車車尾右後方、比車身低，往前上方看：車尾篷布的角在畫面下段，自己這台的機槍曳光
      // 從它後面往上竄，長機與後面幾架排成一串衝下來。車在開：慢晃加一點顛
      onVehicle(TRUCK_PROP, t, TRUCK_X, TRUCK_Y, TRUCK_Z, out.position)
      jostle(t, out.position)
      LEAD(t, S1)
      onVehicle(TRUCK_PROP, t, TRUCK_EDGE_X, TRUCK_EDGE_Y, TRUCK_EDGE_Z, S2)
      aimBetween(out.position, S1, S2, TRUCK_W, out.target)
      out.fov = TRUCK_FOV
      shake(t, 0.25 * Math.pow(out.fov / 40, 0.6), 1, out)
    },
  },
  {
    from: X_CAB, subject: 0, groundMount: CAB_PROP,
    camera(t, out) {
      // 卡車駕駛室右側車門旁往正上方看（超長焦）：自己這台的機槍曳光往上竄，長機與僚機
      // 迎面衝下來，倒鷗翼與起落架佔滿畫面
      onVehicle(CAB_PROP, t, CAB_X, CAB_Y, CAB_Z, out.position)
      jostle(t, out.position)
      out.fov = CAB_FOV
      lookUpAtLead(t, CAB_PROP, CAB_W, 3, out)
    },
  },
  {
    from: X_DROP, subject: null,
    camera(t, out) {
      // 長機左下方看機腹：機身橫在畫面裡、機頭朝左。20.5 秒炸彈脫離機腹，
      // 長機 4.5 G 拉起、翼尖拖著白線往畫面上方離開；鏡頭脫鉤（`DROP_CAM`），炸彈往左下
      // 掉開、注視點轉去跟它；1.1 秒後剪到爆炸那一刀（炸彈往下掉的幾秒剪掉，見 `JUMP_*`）。
      // 拉起那一下氣流掃過，震一下
      if (t < DROP_AT) {
        body(LEAD, t, -DROP_SIDE, DROP_LOW, DROP_BACK, false, out.position)
        body(LEAD, t, 0, BOMB_RELEASE_Y, 0, false, out.target)
        bodyUp(LEAD, t, out.up)
      } else {
        const u = t - DROP_AT
        out.position.copy(DROP_CAM).addScaledVector(DROP_V, u)
        S1.copy(DROP_P).addScaledVector(DROP_V, u)
        bombAt(DROP_P, DROP_V, u, S2)
        out.target.copy(S1).lerp(S2, 0.5 + 0.5 * ramp(t, DROP_AT + DROP_FOLLOW_AT, DROP_FOLLOW))
        out.up.copy(DROP_UP)
      }
      shake(t, 0.1, 23, out)
      jolt(t, DROP_AT + 0.4, 1.0, out.target)
      out.fov = DROP_FOV
    },
  },
  {
    from: JUMP_FROM, subject: null,
    camera(t, out) {
      // 中軸往車隊後方看，左右錯列的車輛框住遠方炸點；與車隊一起煞停，保持車身間隙。
      const along = 93 + propTravel(COLUMN_MOTION, t) - propTravel(COLUMN_MOTION, JUMP_TO)
      onRoad(along, 0, out.position).setY(1.6)
      onRoad(along - 85, 0, out.target).setY(3)
      out.fov = 68
      shake(t, 0.2, 17, out)
      for (const at of IMPACT_AT) jolt(t, at, 0.65, out.target)
    },
  },
  {
    from: IMPACT_TRACK_AT, subject: null,
    camera: impactView,
  },
  {
    from: IMPACT_END, subject: null,
    camera(t, out) {
      // 前進速度降到主角的一半，三架約每 1.5 秒依序超越鏡頭。
      // 橫移跟上右梯隊，但留在機腹下方、每秒只升高 2 m，讓飛機拉起的高度差讀得出來。
      // 固定以約 25° 仰看後上方，飛機逐架往畫面上方掠過，不跟著抬升抵消爬升感。
      const u = t - IMPACT_END
      PATHS[DEPARTURE_ACTOR]!(t, S1)
      out.position.set(
        DEPARTURE_START.x - 15 + 18 * u,
        DEPARTURE_START.y - 24 + 2 * u,
        DEPARTURE_START.z + 34 + 0.5 * (S1.z - DEPARTURE_START.z),
      )
      out.target.copy(out.position).add(S1.set(18, 14, -24))
      shake(t, 0.65, 18, out)
      out.fov = 48
    },
  },
]

/**
 * 靜止的雲（局部座標的雲底中心與水平半徑）：給飛機一個參照物，讀得出速度與往下衝。
 * 巡航那一層的雲底比隊形（1720 m）低二、三十公尺，雲頂與飛機同高
 * 【不擋主角】每一朵都放在鏡頭路徑旁邊、主角後面；鏡頭也不鑽進雲裡（測試會查）
 */
const CLOUDS: readonly CloudSpec[] = [
  // 編隊右前方：第一刀隊形從它旁邊飛過
  { x: 170, y: 1690, z: 250, radius: 70 },
  // 長機翻身處的西邊：第二架座艙罩後面看長機翻身時在左前方
  { x: -170, y: 1690, z: -170, radius: 75 },
  // 隊形前方（北）：第二架與第六架看前面幾架翻下去時的後景
  { x: -60, y: 1695, z: -520, radius: 90 },
  // 俯衝線東邊 160 m、1000 m 高：側拍長機時在後景往上掠過；地面仰看時在飛機旁邊
  { x: 150, y: 1000, z: -230, radius: 60 },
  // 俯衝線西邊、760 m 高：地面仰看的廣角裡多一朵
  { x: -160, y: 760, z: -150, radius: 70 },
  // 縱隊東邊上空、1300 m 高：地面仰看與路邊拍車時天上的雲
  { x: 220, y: 1300, z: -60, radius: 110 },
  // 編隊右邊遠處：第一刀地平線上、隊形後面
  { x: 280, y: 1690, z: 470, radius: 90 },
  // 遠景：鏡頭離圓心最遠約 0.75 km，圓環從 1.5 km 起
  ...scatterClouds({ x: 50, z: -200, inner: 1500, outer: 6500, yMin: 1100, yMax: 2100, rMin: 70, rMax: 150, count: 50, seed: 1 }),
]

const PLANES: readonly ReelPlane[] = [
  ...PATHS.map((path) => ({ spec: JU87, path })),
  { spec: JU87, path: WING, extra: true },
]

export const STUKA: Shot = {
  id: 'stuka',
  duration: END_AT,
  bombSparkBursts: 3,
  jumps: [
    { from: ROLL_CUT_AT, to: ROLL_CLOSE_AT },
    { from: JUMP_FROM, to: JUMP_TO },
  ],
  clouds: CLOUDS,
  // 夏日正午：太陽在西南、仰角約 60°。編隊往北飛，太陽在它左後方
  timeOfDay: 'noon',
  faceSun: false,
  terrain: 'farmland',
  // 只要那一條路。`ground` 一定要有墊面，而墊面的不規則邊往矩形外鋪 180 m、上面是
  // 一格格的鋪面髒污 —— 放在縱隊那裡是田中間一大塊方格斑。所以墊面丟到北邊 7 km 外的
  // 路旁（鏡頭拍不到的地平線下），鋪成犁過的田色，遠遠看到也只是一塊田
  ground: {
    pad: { x0: PAD_AT.x - 20, z0: PAD_AT.z - 20, x1: PAD_AT.x + 20, z1: PAD_AT.z + 20 },
    patches: [{ x0: PAD_AT.x - 220, z0: PAD_AT.z - 220, x1: PAD_AT.x + 220, z1: PAD_AT.z + 220, hex: 0x615242 }],
    roads: [[{ x: ROAD_S.x, z: ROAD_S.z }, { x: ROAD_N.x, z: ROAD_N.z }]],
  },
  // 半徑決定執行時落在農地的哪裡（`openSeaOrigin` 躲山丘）：3,500 m 落在 (12124, 7000)。
  // 圓心決定縱隊落在哪一塊田上：這裡縱隊每一輛車 40 m 內沒有樹籬與樹林，東邊 1 km 是
  // 一個村子。改了半徑或圓心，車就可能長在樹林裡、低空的鏡頭被樹擋住
  // 【跟著炸點走】炸點（也就是縱隊）在局部座標裡移了多少，圓心就移多少，縱隊才落在同一塊田上
  clear: { x: 331.5, z: -860.4, radius: 3500 },
  planes: PLANES,
  props: PROPS,
  ships: [],
  cuts: CUTS,
  camera: edit(CUTS),
  events: timeline([
    ...DEPARTURE_SMOKE,
    // 俯衝線上零星幾朵高砲黑雲（縱隊上空 400～1300 m）；主角是地面的機槍曳光
    ...barrage(601, 13.0, 24.0, 0.7, (_t, out) => out.copy(BURNING).setY(850),
      { x: 260, yLo: -400, yHi: 450, z: 300 }, edit(CUTS), 70),
    // 一架一枚（500 kg）。投彈那一刀從機腹下近看，兩枚前後只差幾公尺會疊成一團讀不清
    ...PATHS.map((_, i) => ({ at: releaseAt(i), kind: 'bomb' as const, actor: i, count: 1, interval: 0 })),
    ...GROUND_FIRE,
    ...MOUNT_FIRE,
    ...CROSS_FIRE,
  ]),
}
