import { makeScratch } from '../core/pool'
import { FLASH_SECONDS } from '../weapons/muzzleFlash'
import { mountDirection } from '../weapons/types'
import { stepCadence } from '../weapons/cadence'
import { PROJECTILE_LIFETIME, type Projectiles } from './Projectiles'
import type { Combatant } from './combatant'

/** 固定槍只讀射手姿態與扳機，並更新射速時鐘及槍焰。 */
export type FixedGunCombatant = Pick<Combatant,
  'hp' | 'aircraft' | 'command' | 'cooldowns' | 'muzzleFlash' | 'index' | 'team'>

/** 所有射手循序共用；不在每次發射時建立向量。 */
const S = makeScratch(3)

/** 依扳機與射速時鐘發射。熱路徑，不配置。 */
export function stepFixedGuns(c: FixedGunCombatant, projectiles: Pick<Projectiles, 'spawn'>, dt: number): void {
  // 打爆的飛機不會繼續射擊。step 已經擋過退場的，這一條擋的是「血歸零
  // 但因為 respawnOnDestroy 而仍然活著」那一格的殘餘狀態。
  if (c.hp <= 0) return

  const battery = c.aircraft.spec.battery
  const trigger = c.command.firing
  const pos = c.aircraft.state.position
  const vel = c.aircraft.state.velocity
  const q = c.aircraft.state.orientation

  for (let i = 0; i < battery.mounts.length; i++) {
    const mount = battery.mounts[i]!
    const shots = stepCadence(c.cooldowns, i, mount.weapon.roundsPerMinute, trigger, dt)
    if (shots === 0) continue
    c.muzzleFlash[i] = FLASH_SECONDS

    // 槍口的世界位置與世界射向
    const muzzle = S.v[0]!.copy(mount.position).applyQuaternion(q).add(pos)
    const dir = mountDirection(battery, i, S.v[1]!).applyQuaternion(q)
    // V_bullet = 槍口方向 × 初速 + 射手速度（spec §5.1）
    const v = S.v[2]!.copy(dir).multiplyScalar(mount.weapon.muzzleVelocity).add(vel)

    for (let n = 0; n < shots; n++) {
      projectiles.spawn(
        muzzle.x, muzzle.y, muzzle.z, v.x, v.y, v.z, mount.weapon.damage, c.index,
        c.team === 'blue' ? 0 : 1, PROJECTILE_LIFETIME, mount.weapon.caliber,
      )
    }
  }
}
