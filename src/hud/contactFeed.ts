import { Vector3, type PerspectiveCamera } from 'three'
import type { Combatant } from '../world/combatant'
import { solveLead, NO_INTERCEPT } from '../world/lead'
import { PROJECTILE_LIFETIME } from '../world/Projectiles'
import { flightOfCombatant, isFlightLeader, type FlightIndex } from '../battle/flights'
import { DEG } from '../core/math'
import { HUD_MAX_CONTACTS, type HudFrame } from './types'

interface ContactFeedDependencies {
  hudFrame: Pick<HudFrame, 'contacts' | 'contactCount'>
  camera: PerspectiveCamera
  visuals: { get(combatant: Combatant): { readonly position: Vector3 } | undefined }
  projectDistance: number
}

/** 只更新接觸點池；暫存與投影依賴在建構時綁定，每幀不配置。 */
export function createContactFeed({
  hudFrame, camera, visuals, projectDistance: HUD_PROJECT_DISTANCE,
}: ContactFeedDependencies) {
  const probe = new Vector3()
  const relPos = new Vector3()
  const relVel = new Vector3()
  const leadDir = new Vector3()
  const leadProbe = new Vector3()

  return function fillContacts(
    combatants: readonly Combatant[],
    player: Combatant,
    flights: Pick<FlightIndex, 'flights' | 'flightOf' | 'positionOf'>,
    renderPos: Vector3,
    godView: boolean,
    godPosition: Vector3,
  ): Vector3 {
    const aircraft = player.aircraft
    /**
     * 【轟炸機沒有瞄準具】它們的槍全部是砲塔、由 AI 操作 —— 玩家沒有任何
     * 可扣扳機的武器，畫一個預瞄環會讓人以為按了會發射。
     *
     * 【判準用 mounts 而不是 role】要問的是「玩家扣得到扳機嗎」，而那正是
     * `battery.mounts` 的定義。用 `role === 'bomber'` 的話，日後若有哪一台
     * 轟炸機真的裝了固定前射武器，這裡會靜靜地漏掉它的預瞄環。
     */
    const hasFixedGuns = aircraft.spec.battery.mounts.length > 0

    // 【接觸點】畫全部，沒有距離門檻；預瞄環的條件是「真的打得到」。
    const sight = aircraft.spec.battery.sight
    // 【每幀取一次】玩家的分隊序號。編制每個物理步重新壓縮，所以陣亡、
    // 遞補、重生都不需要額外同步 —— flightOf 直接就是最新的
    const playerFlightIndex = flights.flightOf[player.index]!
    // 【上帝視角下的基準點是鏡頭，不是自機】兩個地方吃它：
    //
    //   `refY`   小地圖的高度符號。平面已經以鏡頭重新置中（`worldX`/`worldZ`），
    //            高度基準卻還留在自機的話，三角形的上下與畫面上的位置對應不
    //            起來 —— 一架就在鏡頭正下方的飛機會被畫成「在你上方」。
    //   `refPos` `contact.range`，而 `radius` 由它推出來。
    //
    // 【`range` 也要跟著 `refPos`】拿 `renderPos`（玩家飛機）算的話，鏡頭
    // 飛到戰場另一頭時，框卻會因為**玩家飛機**靠近某架敵機而變大 ——
    // 分隊標示（`godMarkers`）的「框依距離縮放」吃的就是它。
    const refPos = godView ? godPosition : renderPos
    const refY = refPos.y
    let n = 0
    for (const c of combatants) {
      // 【上帝視角下自機也要進接觸點】座艙裡排除自己是對的（你就坐在裡面），
      // 但上帝視角下中心是**鏡頭**不是自機 —— 不放進來的話，玩家自己那一架
      // （正被 AI 代飛，也就是這個模式最想看的東西）在小地圖上一個像素都沒有。
      // 池子夠：`HUD_MAX_CONTACTS` 48，20v20 最多 39 個他機。
      //
      // 【自機那一格的 `range` 是 0】上帝視角下鏡頭與自機是兩個東西，所以
      // `range` 不再恆為 0 —— 那是 `refPos` 改成鏡頭之後的直接後果（見上面）。
      // 恆為 0 的只剩「鏡頭正好貼在某架身上」那個退化情形，而 `radius` 的
      // `Math.max(range, 1)` 已經擋住除以零。
      if ((c === player && !godView) || !c.alive || n >= HUD_MAX_CONTACTS) continue
      const contact = hudFrame.contacts[n]!
      const v = visuals.get(c)!

      probe.copy(v.position).project(camera)
      contact.behind = probe.z >= 1
      contact.x = probe.x * camera.aspect
      contact.y = probe.y
      contact.range = v.position.distanceTo(refPos)
      // 【單位是螢幕半高】透視投影的 NDC y = tan(θ) / tan(fov/2)，而
      // tan(atan(halfSpan / range)) 就是 halfSpan / range——所以直接寫比值，
      // 不要繞一圈 atan（那會算成 θ / tan(fov/2)，近距離時低估框的大小）。
      contact.radius = ((c.aircraft.spec.wing.span / 2) / Math.max(contact.range, 1))
        / Math.tan((camera.fov * DEG) / 2)
      contact.hostile = c.team !== player.team
      // 【`playerFlightIndex >= 0` 這道守衛不能省】玩家退場時它是 −1，而場上
      // 每一架已退場者的 `flightOf` 也是 −1 —— 少了守衛就會 `-1 === -1`，
      // 一整批飛機被畫成隊友色。
      contact.flightMate = playerFlightIndex >= 0
        && flights.flightOf[c.index] === playerFlightIndex
      // 【分隊標示只認長機】`compactFlights` 每個物理步重壓，所以長機陣亡時
      // 標示自動跳到繼任者，這裡不需要任何同步。玩家那一架恆為 true ——
      // 他釘死在 `members[0]`（`FlightIndex.pinned`）。
      const flight = flightOfCombatant(flights, c.index)
      contact.flightLeader = isFlightLeader(flights, c.index)
      contact.flightAlive = flight?.count ?? 0
      contact.flightSize = flight?.roster.length ?? 0
      contact.deltaY = v.position.y - refY
      contact.worldX = v.position.x
      contact.worldZ = v.position.z

      // 【預瞄環只給敵機】M5 起彈丸直接穿過友機（spec §2），所以友機的預瞄環
      // 指的是一個打不到的點——畫出來只會是「往這裡開槍」的錯誤暗示。19 架
      // 友機同時畫更是滿畫面的雜訊。順帶省掉每架一次的預瞄解。
      contact.leadValid = false
      if (contact.hostile && hasFixedGuns) {
        relPos.copy(c.aircraft.state.position).sub(aircraft.state.position)
        relVel.copy(c.aircraft.state.velocity).sub(aircraft.state.velocity)
        const t = solveLead(relPos, relVel, sight.muzzleVelocity, leadDir)
        contact.leadValid = t !== NO_INTERCEPT && t <= PROJECTILE_LIFETIME
        if (contact.leadValid) {
          leadProbe.copy(renderPos).addScaledVector(leadDir, HUD_PROJECT_DISTANCE).project(camera)
          contact.leadX = leadProbe.x * camera.aspect
          contact.leadY = leadProbe.y
          contact.leadBehind = leadProbe.z >= 1
        }
      }

      contact.active = true
      n++
    }
    hudFrame.contactCount = n
    return refPos
  }
}
