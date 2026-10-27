import { describe, expect, it } from 'vitest'
import { Quaternion, Vector3 } from 'three'
import { STUKA } from '../../src/app/reel/stuka'
import { BOMB_RELEASE_Y, body, bombAt, propAt, velocityAt } from '../../src/app/reel/kit'
import { createGroundTarget, groundUnitOf } from '../../src/world/groundTargets'
import { Projectiles } from '../../src/world/Projectiles'
import { createReelGunnery } from '../../src/app/reel/reelGunnery'

describe('斯圖卡連續轟炸', () => {
  it('05 切入前已連射且整段不中斷，07 切入時已有曳光抵達長機附近', () => {
    const projectiles = new Projectiles(1024)
    const guns = createReelGunnery(projectiles, { light: false, fx: { hits() {} } })
    const actors = STUKA.planes.map(p => ({
      spec: p.spec, model: {}, position: new Vector3(), velocity: new Vector3(), quaternion: new Quaternion(),
      burstLeft: 0, cooldowns: new Float32Array(), muzzleFlash: new Float32Array(),
    }))
    const props = STUKA.props!.map((p, i) => createGroundTarget(i, p.id, 'red', p.x, p.z, p.heading))
    const events = STUKA.events.filter(e => e.kind === 'groundFire').filter(e => e.at >= 12.2 && e.at <= 15.35)
    for (const t of [13.6, 14.4, 15.29]) {
      expect(events.filter(e => e.tracerLife === 2 && e.at < 13.6 && e.at + e.seconds > t)).toHaveLength(3)
    }
    let next = 0
    const dt = 1 / 240
    let nearest = Infinity
    for (let t = 12.2; t <= 15.35; t += dt) {
      actors.forEach((a, i) => {
        STUKA.planes[i]!.path(t, a.position)
        velocityAt(STUKA.planes[i]!.path, t, a.velocity)
      })
      props.forEach((p, i) => propAt(STUKA.props![i]!, t, p.position))
      while (next < events.length && events[next]!.at <= t) guns.startStream(events[next++]!)
      guns.stepStreams(actors, [], props, t, dt)
      projectiles.step(dt)
      if (t < 15.3) continue
      for (let i = 0; i < projectiles.capacity; i++) {
        if (projectiles.owner[i] === -1) continue
        nearest = Math.min(nearest, Math.hypot(
          projectiles.x[i]! - actors[0]!.position.x,
          projectiles.y[i]! - actors[0]!.position.y,
          projectiles.z[i]! - actors[0]!.position.z,
        ))
      }
    }
    expect(nearest).toBeLessThan(25)
  })

  it('車隊中軸後拍在第一段轟炸期間不穿入任何車身', () => {
    const camera = { position: new Vector3(), target: new Vector3(), up: new Vector3(0, 1, 0), fov: 60 }
    const position = new Vector3()
    const firstRelease = STUKA.events.find(e => e.kind === 'bomb')!.at
    const from = STUKA.jumps!.find(j => j.from > firstRelease)!.to
    const end = STUKA.cuts.find(c => c.from > from)!.from
    for (let t = from; t < end; t += 1 / 60) {
      STUKA.camera(t, camera)
      for (const prop of STUKA.props!) {
        propAt(prop, t, position)
        const dx = camera.position.x - position.x
        const dz = camera.position.z - position.z
        const c = Math.cos(prop.heading), s = Math.sin(prop.heading)
        const x = dx * c - dz * s, z = dx * s + dz * c
        const inside = groundUnitOf(prop.id).hull.some(b =>
          Math.abs(x - b.center.x) < b.half.x + 0.3
          && Math.abs(z - b.center.z) < b.half.z + 0.3
          && Math.abs(camera.position.y - b.center.y) < b.half.y + 0.3)
        expect(inside, `t=${t.toFixed(3)} ${prop.id}`).toBe(false)
      }
    }
  })

  it('六枚炸彈約每半秒命中車隊，落地不被時間跳切略過', () => {
    const arrivals: number[] = []
    const point = new Vector3()
    const vehicle = new Vector3()
    for (const event of STUKA.events) {
      if (event.kind !== 'bomb') continue
      const path = STUKA.planes[event.actor]!.path
      const start = body(path, event.at, 0, BOMB_RELEASE_Y, 0, false, new Vector3())
      const velocity = velocityAt(path, event.at, new Vector3())
      let lo = 0
      let hi = 20
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2
        if (bombAt(start, velocity, mid, point).y > 0) lo = mid
        else hi = mid
      }
      const at = event.at + hi
      bombAt(start, velocity, hi, point)
      arrivals.push(at)
      expect(STUKA.jumps?.some(j => at >= j.from && at < j.to)).toBe(false)
      const nearest = Math.min(...STUKA.props!.map(p => propAt(p, at, vehicle).distanceTo(point)))
      expect(nearest).toBeLessThan(1)
    }
    expect(arrivals).toHaveLength(6)
    for (let i = 1; i < arrivals.length; i++) {
      expect(arrivals[i]! - arrivals[i - 1]!).toBeGreaterThan(0.48)
      expect(arrivals[i]! - arrivals[i - 1]!).toBeLessThan(0.52)
    }
  })
})
