import { Vector3 } from 'three'
import { F6F5 } from '../../specs/f6f5'
import { body, edit, rampedOffset, shipAt, wingman, type Cut, type Path, type ReelShip, type Shot } from './kit'

// ── 艦隊 ───────────────────────────────────────────────────
//
// 拂曉，艦隊往太陽開。
//   0–9   航艦艦艏劈浪，鏡頭在右舷前方貼著海面
//   9–17  驅逐艦的側舷，航艦在它後面
//   17–25 航艦舷側的海面上仰拍：四架地獄貓從艦尾方向低空飛越
//   25–34 跟在長機後面左轉，艦隊在下方

const S1 = new Vector3()

const FLEET_SPEED = 9
const ESSEX: ReelShip = { cls: 'essex', x: 0, z: 0, heading: 0, speed: FLEET_SPEED }
const FLEET_DD: ReelShip = { cls: 'fletcher', x: -420, z: -380, heading: 0, speed: FLEET_SPEED }
const hellcatLead: Path = (t, out) => {
  // 第 20 秒飛越航艦（x −30、70 m），23 秒起左轉、22 秒起爬升
  out.set(-30, 70, 2820 - 150 * t)
  out.y += rampedOffset(t, 22, 2, 4) - rampedOffset(t, 27, 2, 4)
  out.x -= rampedOffset(t, 23, 2, 18) - rampedOffset(t, 29, 2, 18)
  return out
}

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: null,
    camera(t, out) {
      shipAt(ESSEX, t, S1)
      out.position.set(S1.x + 120, 13, S1.z - 330 + 3 * t)
      out.target.set(S1.x, 16, S1.z - 105)
      out.fov = 38
    },
  },
  {
    from: 9, subject: null,
    camera(t, out) {
      shipAt(FLEET_DD, t, S1)
      out.position.set(S1.x - 110, 9, S1.z + 45 - 2 * (t - 9))
      out.target.set(S1.x, 10, S1.z - 10)
      out.fov = 42
    },
  },
  {
    from: 17, subject: 0,
    camera(t, out) {
      shipAt(ESSEX, t, S1)
      out.position.set(S1.x - 75, 12, S1.z + 40)
      hellcatLead(t, out.target)
      out.fov = 45
    },
  },
  {
    from: 25, subject: 0,
    camera(t, out) {
      // 架在四機隊形的正後上方 —— 偏一邊的話會貼到那一側的僚機
      body(hellcatLead, t - 0.15, 4, 9, 40, true, out.position)
      body(hellcatLead, t, 0, -8, -150, true, out.target)
      out.fov = 48
    },
  },
]

export const FLEET: Shot = {
  id: 'fleet',
  duration: 34,
  timeOfDay: 'dawn',
  captionKey: 'reel.fleet',
  faceSun: true,
  clear: { x: 0, z: 200, radius: 3000 },
  planes: [
    { spec: F6F5, path: hellcatLead },
    { spec: F6F5, path: wingman(hellcatLead, -18, -2, 14, 0.4) },
    { spec: F6F5, path: wingman(hellcatLead, 30, 1, 20, 1.3), extra: true },
    { spec: F6F5, path: wingman(hellcatLead, 48, -1, 34, 2.1), extra: true },
  ],
  ships: [
    ESSEX,
    FLEET_DD,
    { cls: 'wichita', x: -380, z: 420, heading: 0, speed: FLEET_SPEED },
    { cls: 'fletcher', x: 300, z: -760, heading: 0, speed: FLEET_SPEED },
  ],
  cuts: CUTS,
  camera: edit(CUTS),
  events: [],
}
