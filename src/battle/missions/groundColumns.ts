import { Quaternion, Vector3 } from 'three'
import { createGroundMotion, motionPose } from '../../world/groundMotion'
import type { GroundEntry, MissionGroundColumn, MissionVehicleConvoy } from './types'


/**
 * 卡片上的車隊 → 地面目標的條目。
 *
 * 【開場位置】各批沿路線排開，全部在第 0 秒就開始走：最後一批的車尾在起點
 * （沿路線距離 0）。一輛的沿路線距離 = 同一批裡排在它後面的輛數 × `gap`
 * ＋ 排在它後面的批數 × (`batchGap` + 一批的長度)。
 *
 * 【開場的 x、z、航向就是 motion 在第 0 秒的姿態】`World.step` 第一步才會改寫
 * 它；擺成別的值的話開場那一幀車會閃一下，重開時也會回到錯的朝向。
 *
 * 載入期跑一次，不在熱路徑上。
 */
export function convoyGround(c: MissionVehicleConvoy): GroundEntry[] {
  const motion = { speed: c.speed, turnRadius: c.turnRadius, turnRate: c.speed / c.turnRadius }
  const pose = {
    position: new Vector3(), velocity: new Vector3(),
    orientation: new Quaternion(), angularVelocity: new Vector3(),
  }
  const fwd = new Vector3()
  const out: GroundEntry[] = []
  // 【由最後一批往前推】最後一批的車尾在 0，每往前一批加上那一批的長度與批次間距
  const starts: number[] = []
  let s = 0
  for (let b = c.batches.length - 1; b >= 0; b--) {
    starts[b] = s
    s += (c.batches[b]!.units.length - 1) * c.gap + c.batchGap
  }
  c.batches.forEach((batch, b) => {
    const n = batch.units.length
    batch.units.forEach((unit, i) => {
      const m = createGroundMotion(c.route, motion, starts[b]! + (n - 1 - i) * c.gap, 0)
      motionPose(m, m.departAt, 0, pose)
      fwd.set(0, 0, -1).applyQuaternion(pose.orientation)
      out.push({
        unit, team: 'red', x: pose.position.x, z: pose.position.z,
        heading: Math.atan2(-fwd.x, -fwd.z), motion: m,
        ...(c.armed?.includes(unit) === true ? { guns: 'mg' as const } : {}),
      })
    })
  })
  return out
}

type Pt = { readonly x: number; readonly z: number }

/**
 * 折線往行進方向的右手邊平移 `ell` m（負的往左）。轉角用角平分線斜接，內縮外擴的比例夾在 2 倍以內。
 * `ell` 為 0 回傳原本那一份。世界座標：行進方向 d 的右手邊法向是 (−d.z, d.x)（朝北時右 = +X）。
 */
function offsetPath(route: readonly Pt[], ell: number): readonly Pt[] {
  if (ell === 0) return route
  const dir = (a: Pt, b: Pt): Pt => {
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1
    return { x: (b.x - a.x) / len, z: (b.z - a.z) / len }
  }
  const last = route.length - 1
  return route.map((p, k) => {
    const a = k > 0 ? dir(route[k - 1]!, p) : dir(p, route[1]!)
    const b = k < last ? dir(p, route[k + 1]!) : a
    const sx = -(a.z + b.z)
    const sz = a.x + b.x
    const len = Math.hypot(sx, sz) || 1
    const nx = sx / len
    const nz = sz / len
    const scale = ell / Math.max(nx * -a.z + nz * a.x, 0.5)
    return { x: p.x + nx * scale, z: p.z + nz * scale }
  })
}

/**
 * 第 `i` 輛展開時的楔位序號：0、+1、−1、+2、−2……（正的在右）。
 */
function wedgeIndex(i: number): number {
  return i % 2 === 1 ? (i + 1) / 2 : -i / 2
}

/**
 * 展開成楔形的路徑：共用路線的前 `keep` 個點（再依 `ell` 左右平移），接著開向自己楔位後方 `lead` m，
 * 最後朝前開上楔位。路線的最後一點是楔尖。
 */
function deployPath(c: MissionGroundColumn, i: number, ell: number): readonly Pt[] {
  const d = c.deploy!
  const tip = c.route[c.route.length - 1]!
  const fx = -Math.sin(d.facing)
  const fz = -Math.cos(d.facing)
  const m = wedgeIndex(i)
  const lateral = m * d.spacing
  const back = Math.abs(m) * d.spacing * d.wingBack
  const sx = tip.x - fz * lateral - fx * back
  const sz = tip.z + fx * lateral - fz * back
  return [...offsetPath(c.route.slice(0, d.keep), ell), { x: sx - fx * d.lead, z: sz - fz * d.lead }, { x: sx, z: sz }]
}

/**
 * 卡片上的一支縱隊 → 地面目標的條目。出發時刻是 `Infinity`（等 `depart` 節拍），
 * 走到終點停住：第 i 輛停在終點前 `i × gap`，停下來仍然是一列；有 `deploy` 的改為各自開向楔位、
 * 停成寬楔形。有 `stagger` 的前後車左右交錯，各走自己那條平行線。
 *
 * 【開場的 x、z、航向就是 motion 還沒出發的姿態】理由同 `convoyGround`。
 *
 * 載入期跑一次，不在熱路徑上。
 */
export function columnGround(c: MissionGroundColumn): GroundEntry[] {
  const motion = { speed: c.speed, turnRadius: c.turnRadius, turnRate: c.speed / c.turnRadius }
  const pose = {
    position: new Vector3(), velocity: new Vector3(),
    orientation: new Quaternion(), angularVelocity: new Vector3(),
  }
  const fwd = new Vector3()
  const n = c.units.length
  const stagger = c.stagger ?? 0
  return c.units.map((unit, i) => {
    const ell = (i % 2 === 0 ? -1 : 1) * stagger
    const path = c.deploy === undefined ? offsetPath(c.route, ell) : deployPath(c, i, ell)
    const m = createGroundMotion(path, motion, (n - 1 - i) * c.gap, Infinity, c.deploy === undefined ? i * c.gap : 0)
    motionPose(m, Infinity, 0, pose)
    fwd.set(0, 0, -1).applyQuaternion(pose.orientation)
    return {
      unit, team: c.team, x: pose.position.x, z: pose.position.z,
      heading: Math.atan2(-fwd.x, -fwd.z), motion: m,
      ...(c.hidden === true ? { hidden: true as const } : {}),
    }
  })
}
