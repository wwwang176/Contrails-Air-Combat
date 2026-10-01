import { Vector3 } from 'three'
import type { AircraftSpec } from '../../specs/types'
import { KI84 } from '../../specs/ki84'
import { body, bodyUp, edit, wingman, type Cut, type Path, type Shot } from './kit'

// ── 歸航 ───────────────────────────────────────────────────
//
// 黃昏，三架貼著海面 40 m 往夕陽飛。
//   0–7    長機右側的貼身跟拍，夕陽在機首前方
//   7–14   僚機飛行員的肩後看長機，地平線跟著機身歪
//   14–22  海面上的固定機位：三架從頭頂掠過，鏡頭轉身目送
//   22–30  長機後方，三架飛進夕陽

const S1 = new Vector3()

const HOME_SPEED = 110
const homeLead: Path = (t, out) => out.set(0, 40 + 1.5 * Math.sin(0.6 * t), 1870 - HOME_SPEED * t)
const homeWing = wingman(homeLead, -32, 3, 26, 0.5)

const CUTS: readonly Cut[] = [
  {
    from: 0, subject: 0,
    camera(t, out) {
      body(homeLead, t, 13, 2, 5, true, out.position)
      body(homeLead, t, 0, 0.5, -3, true, out.target)
      out.fov = 44
    },
  },
  {
    from: 7, subject: 0, mount: 1,
    camera(t, out) {
      body(homeWing, t, 0.9, 1.9, 6.5, false, out.position)
      homeLead(t, out.target)
      bodyUp(homeWing, t, out.up)
      out.fov = 42
    },
  },
  {
    from: 14, subject: 0,
    camera(t, out) {
      out.position.set(70, 18, -40)
      homeLead(t, S1)
      out.target.set(S1.x, S1.y - 4, S1.z)
      out.fov = 45
    },
  },
  {
    from: 22, subject: 0,
    camera(t, out) {
      body(homeLead, t - 0.2, 10, 6, 60, true, out.position)
      body(homeLead, t, 0, -2, -200, true, out.target)
      out.fov = 42
    },
  },
]

/** 歸航那一段飛疾風或零戰，每次進主選單抽一次 */
export function homeShot(spec: AircraftSpec): Shot {
  return {
    id: 'home',
    duration: 30,
    timeOfDay: 'dusk',
    captionKey: spec === KI84 ? 'reel.homeKi84' : 'reel.homeA6m5',
    faceSun: true,
    clear: { x: 0, z: 220, radius: 2600 },
    planes: [
      { spec, path: homeLead },
      { spec, path: homeWing },
      { spec, path: wingman(homeLead, 34, -2, 30, 1.9), extra: true },
    ],
    ships: [],
    cuts: CUTS,
    camera: edit(CUTS),
    events: [],
  }
}
