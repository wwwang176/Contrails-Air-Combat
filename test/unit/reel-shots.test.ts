import { describe, expect, it } from 'vitest'
import { PerspectiveCamera, Quaternion, Vector3 } from 'three'
import {
  BOMB_RELEASE_Y, createReelCamera, pickIsland, rampedOffset, reelShots, TORPEDO_SPEED, torpedoAt, torpedoEntry,
  type Shot,
} from '../../src/app/reelShots'
import { createArchipelago } from '../../src/world/archipelago'
import { createFlight, flightPose } from '../../src/app/reelFlight'
import { REEL_MAX_PLANES } from '../../src/app/menuReel'
import { SHIP_CLASSES } from '../../src/world/ships'

const STEP = 0.1
const shots = reelShots()

/** 這一架在 `t` 已經交給殘骸池了嗎 */
function killedBy(shot: Shot, actor: number, t: number): boolean {
  return shot.events.some((e) => e.kind === 'kill' && e.actor === actor && e.at <= t)
}

/**
 * 這一點是不是在第 k 艘船的正上方：船體每一個碰撞盒的俯視投影外擴 8 m。
 * 船的桅杆與煙囪在盒外，所以在這個範圍裡的東西要高過 55 m
 */
function overShip(shot: Shot, k: number, t: number, p: Vector3): boolean {
  return overShipBy(shot, k, t, p, 8)
}

/** 同上，外擴 `margin` 公尺 */
function overShipBy(shot: Shot, k: number, t: number, p: Vector3, margin: number): boolean {
  const s = shot.ships[k]!
  shipAt(shot, k, t, ship0)
  // 世界 → 艦體：繞 Y 轉 −heading
  const dx = p.x - ship0.x
  const dz = p.z - ship0.z
  const c = Math.cos(s.heading)
  const n = Math.sin(s.heading)
  const lx = dx * c - dz * n
  const lz = dx * n + dz * c
  return SHIP_CLASSES[s.cls].hull.some((b) =>
    Math.abs(lx - b.center.x) < b.half.x + margin && Math.abs(lz - b.center.z) < b.half.z + margin)
}

/** `'island'` 的段取景的那座島：執行時用同一支 `pickIsland` 挑 */
const archipelago = createArchipelago()
const island = pickIsland(archipelago.islands)!
const ship0 = new Vector3()

function shipAt(shot: Shot, k: number, t: number, out: Vector3): Vector3 {
  const s = shot.ships[k]!
  return out.set(s.x - Math.sin(s.heading) * s.speed * t, 0, s.z - Math.cos(s.heading) * s.speed * t)
}

describe('rampedOffset：平順加上去的加速度', () => {
  it('二階差分就是加速度：起點 0、`d` 之後等於 a', () => {
    const h = 1e-3
    const acc = (t: number) =>
      (rampedOffset(t + h, 5, 2, 8) - 2 * rampedOffset(t, 5, 2, 8) + rampedOffset(t - h, 5, 2, 8)) / (h * h)
    expect(acc(4.9)).toBeCloseTo(0, 3)
    expect(acc(6)).toBeCloseTo(4, 1)
    expect(acc(8)).toBeCloseTo(8, 2)
  })
})

describe.each(shots.map((s) => [s.id, s] as const))(
  '分鏡 %s',
  (_name, shot) => {
    const cam = createReelCamera()
    const a = new Vector3()
    const b = new Vector3()
    const ship = new Vector3()
    const times: number[] = []
    for (let t = 0; t <= shot.duration + 1e-9; t += STEP) times.push(t)

    it('事件照時間排、都在片長之內', () => {
      for (let k = 1; k < shot.events.length; k++) {
        expect(shot.events[k]!.at).toBeGreaterThanOrEqual(shot.events[k - 1]!.at)
      }
      for (const e of shot.events) expect(e.at).toBeLessThan(shot.duration)
    })

    it('島上取景：鏡頭離地至少 5 m、飛機至少 30 m、船停在水深 2 m 以上的海面', () => {
      if (shot.site !== 'island') return
      // 局部座標相對島心，執行時不轉 —— 轉了的話這裡的地形對不上
      expect(shot.faceSun).toBe(false)
      const ground = (x: number, z: number): number => archipelago.field.sample(island.cx + x, island.cz + z)
      for (const t of times) {
        shot.camera(t, cam)
        expect(cam.position.y - ground(cam.position.x, cam.position.z), `鏡頭 t=${t.toFixed(1)}`)
          .toBeGreaterThanOrEqual(5)
        shot.planes.forEach((p, i) => {
          if (killedBy(shot, i, t)) return
          p.path(t, a)
          expect(a.y - ground(a.x, a.z), `#${i} t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(30)
        })
        for (let k = 0; k < shot.ships.length; k++) {
          shipAt(shot, k, t, ship)
          expect(ground(ship.x, ship.z), `船 ${k} t=${t.toFixed(1)}`).toBeLessThan(-2)
        }
      }
      // 地面物件在陸地上（離海面至少 0.5 m）
      ;(shot.props ?? []).forEach((p, k) => {
        expect(ground(p.x, p.z), `地面物件 ${k}（${p.id}）`).toBeGreaterThan(0.5)
      })
    })

    it('地面物件只放在島上或內陸的段', () => {
      if ((shot.props ?? []).length === 0) return
      expect(shot.site === 'island' || shot.terrain === 'farmland' || shot.terrain === 'autumnFarmland').toBe(true)
    })

    it('標了目標的連射，開火的每一刻機首正前方那條線都穿過目標的機身', () => {
      const shooter = createFlight()
      const nose = new Vector3()
      const toTarget = new Vector3()
      for (const e of shot.events) {
        if (e.kind !== 'burst' || e.target === undefined) continue
        // 【半翼展的三分之一】機身與內側發動機的範圍 —— 用整個半翼展的話擦到翼尖也算打中，
        // 畫面上就是曳光從目標旁邊飛過去
        const halfSpan = shot.planes[e.target]!.spec.wing.span / 6
        for (let t = e.at; t <= e.at + e.seconds + 1e-9; t += 0.05) {
          if (killedBy(shot, e.target, t) || killedBy(shot, e.actor, t)) continue
          flightPose(shot.planes[e.actor]!.path, t, shooter)
          nose.set(0, 0, -1).applyQuaternion(shooter.quaternion)
          shot.planes[e.target]!.path(t, a)
          toTarget.subVectors(a, shooter.position)
          const ahead = toTarget.dot(nose)
          // 目標中心到機首那條線的垂直距離
          const miss = toTarget.addScaledVector(nose, -ahead).length()
          const where = `#${e.actor} 打 #${e.target}，t=${t.toFixed(2)}`
          expect(ahead, `${where}：目標不在前方`).toBeGreaterThan(0)
          expect(miss, `${where}：機首那條線離目標中心 ${miss.toFixed(1)} m（上限 ${halfSpan.toFixed(1)} m）`)
            .toBeLessThanOrEqual(halfSpan)
        }
      }
    })

    it('打中的魚雷跑到瞄點時撞在船身上，而且在片長之內', () => {
      const pose = createFlight()
      const p0 = new Vector3()
      const v0 = new Vector3()
      const at = new Vector3()
      for (const e of shot.events) {
        if (e.kind !== 'torpedo' || !e.hit) continue
        flightPose(shot.planes[e.actor]!.path, e.at, pose)
        p0.set(0, BOMB_RELEASE_Y, 0).applyQuaternion(pose.quaternion).add(pose.position)
        v0.copy(pose.velocity)
        const entry = torpedoEntry(p0, v0)
        torpedoAt(p0, v0, entry, e.aim, entry, at)
        const arrive = e.at + entry + Math.hypot(e.aim.x - at.x, e.aim.z - at.z) / TORPEDO_SPEED
        expect(arrive, `#${e.actor} 在 ${e.at} 秒投的魚雷`).toBeLessThan(shot.duration)
        const struck = shot.ships.some((_, k) =>
          overShipBy(shot, k, arrive, at.set(e.aim.x, 0, e.aim.z), 4))
        expect(struck, `#${e.actor} 在 ${e.at} 秒投的魚雷到瞄點時沒有船`).toBe(true)
      }
    })

    it('飛機、船與鏡頭整段都在宣告的開闊海面圓內', () => {
      const inside = (p: Vector3, what: string, t: number): void => {
        expect(Math.hypot(p.x - shot.clear.x, p.z - shot.clear.z), `${what} t=${t.toFixed(1)}`)
          .toBeLessThan(shot.clear.radius)
      }
      for (const t of times) {
        shot.camera(t, cam)
        inside(cam.position, '鏡頭', t)
        shot.planes.forEach((p, i) => {
          if (!killedBy(shot, i, t)) inside(p.path(t, a), `#${i}`, t)
        })
        for (let k = 0; k < shot.ships.length; k++) inside(shipAt(shot, k, t, ship), `船 ${k}`, t)
      }
    })

    it('鏡頭在海面上至少 6 m，經過船的上空時高過桅杆', () => {
      for (const t of times) {
        shot.camera(t, cam)
        expect(cam.position.y, `t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(6)
        for (let k = 0; k < shot.ships.length; k++) {
          if (overShip(shot, k, t, cam.position)) {
            expect(cam.position.y, `經過船 ${k}，t=${t.toFixed(1)}`).toBeGreaterThan(55)
          }
        }
      }
    })

    it('還沒被擊落的飛機離海面至少 15 m，飛過船時高過桅杆', () => {
      for (const t of times) {
        shot.planes.forEach((p, i) => {
          if (killedBy(shot, i, t)) return
          p.path(t, a)
          expect(a.y, `#${i} t=${t.toFixed(1)}`).toBeGreaterThanOrEqual(15)
          for (let k = 0; k < shot.ships.length; k++) {
            if (overShip(shot, k, t, a)) {
              expect(a.y, `#${i} 飛過船 ${k}，t=${t.toFixed(1)}`).toBeGreaterThan(55)
            }
          }
        })
      }
    })

    it('任兩架都不相撞（距離大於兩者半翼展之和）', () => {
      for (const t of times) {
        for (let i = 0; i < shot.planes.length; i++) {
          if (killedBy(shot, i, t)) continue
          shot.planes[i]!.path(t, a)
          for (let j = i + 1; j < shot.planes.length; j++) {
            if (killedBy(shot, j, t)) continue
            shot.planes[j]!.path(t, b)
            const minimum = (shot.planes[i]!.spec.wing.span + shot.planes[j]!.spec.wing.span) / 2
            expect(a.distanceTo(b), `#${i}–#${j} t=${t.toFixed(1)}`).toBeGreaterThan(minimum)
          }
        }
      }
    })

    it('剪接表照時間排、第一刀從 0 開始', () => {
      expect(shot.cuts[0]!.from).toBe(0)
      for (let k = 1; k < shot.cuts.length; k++) {
        expect(shot.cuts[k]!.from).toBeGreaterThan(shot.cuts[k - 1]!.from)
      }
    })

    it('每一刀拍的那一架都在畫面內（16:9 與 4:3）', () => {
      for (const aspect of [16 / 9, 4 / 3]) {
        const c = new PerspectiveCamera(50, aspect, 1, 100000)
        shot.cuts.forEach((cut, k) => {
          if (cut.subject === null) return
          const end = shot.cuts[k + 1]?.from ?? shot.duration
          for (const t of times) {
            if (t < cut.from || t >= end || killedBy(shot, cut.subject, t)) continue
            shot.camera(t, cam)
            c.fov = cam.fov
            c.updateProjectionMatrix()
            c.position.copy(cam.position)
            c.up.copy(cam.up)
            c.lookAt(cam.target)
            c.updateMatrixWorld()
            shot.planes[cut.subject]!.path(t, a)
            a.project(c)
            const where = `第 ${k + 1} 刀 aspect ${aspect.toFixed(2)} t=${t.toFixed(1)}`
            expect(Math.abs(a.x), where).toBeLessThan(0.95)
            expect(Math.abs(a.y), where).toBeLessThan(0.95)
            expect(a.z, `在鏡頭後面 ${where}`).toBeLessThan(1)
          }
        })
      }
    })

    it('鏡頭不鑽進任何一架飛機：掛在它身上的不進命中盒與螺旋槳，其餘離機身中心至少 6 m', () => {
      const pose = createFlight()
      const local = new Vector3()
      const inv = new Quaternion()
      shot.cuts.forEach((cut, k) => {
        const end = shot.cuts[k + 1]?.from ?? shot.duration
        for (const t of times) {
          if (t < cut.from || t >= end) continue
          shot.camera(t, cam)
          shot.planes.forEach((p, i) => {
            if (killedBy(shot, i, t)) return
            const where = `第 ${k + 1} 刀 #${i} t=${t.toFixed(1)}`
            if (cut.mount !== i) {
              expect(p.path(t, a).distanceTo(cam.position), where).toBeGreaterThan(6)
              return
            }
            // 鏡頭轉到這一架的機體座標
            flightPose(p.path, t, pose)
            inv.copy(pose.quaternion).invert()
            local.copy(cam.position).sub(pose.position).applyQuaternion(inv)
            for (const box of p.spec.hitBoxes) {
              const inside = Math.abs(local.x - box.center.x) < box.half.x + 0.5
                && Math.abs(local.y - box.center.y) < box.half.y + 0.5
                && Math.abs(local.z - box.center.z) < box.half.z + 0.5
              expect(inside, `在命中盒（${box.part}）裡 ${where}`).toBe(false)
            }
            // 機首前方的螺旋槳盤：命中盒最前緣再往前 1.5 m、半徑 2.2 m 的圓柱
            const nose = Math.min(...p.spec.hitBoxes.map((b) => b.center.z - b.half.z))
            const inProp = local.z < nose + 0.5 && local.z > nose - 1.5 && Math.hypot(local.x, local.y) < 2.2
            expect(inProp, `在螺旋槳盤裡 ${where}`).toBe(false)
          })
        }
      })
    })

    it('飛機不超過放映機的上限；事件指到的演員都存在，同一架只擊落一次', () => {
      expect(shot.planes.length).toBeLessThanOrEqual(REEL_MAX_PLANES)
      const n = shot.planes.length
      const killed = new Set<number>()
      for (const e of shot.events) {
        if (e.kind === 'flak') continue
        if (e.kind === 'blast') {
          expect(e.size).toBeGreaterThan(0)
          continue
        }
        if (e.kind === 'destroy') {
          expect(e.prop).toBeLessThan(shot.props?.length ?? 0)
          continue
        }
        expect(e.actor).toBeGreaterThanOrEqual(0)
        expect(e.actor).toBeLessThan(n)
        if (e.kind === 'gunner') {
          expect(e.target).toBeLessThan(n)
          expect(e.target).not.toBe(e.actor)
        }
        if (e.kind === 'aa') expect(e.ship).toBeLessThan(shot.ships.length)
        if (e.kind === 'kill') {
          expect(killed.has(e.actor), `#${e.actor} 被擊落兩次`).toBe(false)
          killed.add(e.actor)
        }
      }
      for (const c of shot.cuts) {
        if (c.subject !== null) expect(c.subject).toBeLessThan(n)
        if (c.mount !== undefined) expect(c.mount).toBeLessThan(n)
      }
    })
  },
)
