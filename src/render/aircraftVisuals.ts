import { Quaternion, Vector3, type Object3D } from 'three'
import type { Combatant } from '../world/combatant'
import {
  buildAircraft, buildAircraftLod, useAircraftLod, type AircraftModel,
} from './geometry/buildAircraft'
import type { Vortex } from './vortex'
import type { Wrecks } from './wrecks'

/** 一席的模型與內插暫存；模型交給殘骸池後，暫存仍供相機與特效讀取。 */
export interface AircraftVisual {
  /**
   * 這一席目前的模型。**只在整隊重生時換**：舊模型已經交給殘骸池，復活的
   * 席位拿一具新的。`renderPositions` 參考的是 `position`，不受影響。
   */
  model: AircraftModel
  /**
   * 遠處用的低模。**沒有低模的機種是 `null`**，那一席一路走 `model`。
   *
   * 【兩具都掛在場景上，靠 `visible` 切】換的是哪一個 group 在畫，不是重建
   * 幾何 —— 每幀重建一架 B-17 是不可能的成本。
   */
  lod: AircraftModel | null
  /** 這一幀顯示的是低模嗎。`useAircraftLod` 的遲滯要讀上一幀的答案。 */
  far: boolean
  readonly position: Vector3
  readonly quaternion: Quaternion
  /**
   * 模型已經交給殘骸池了嗎。
   *
   * 【為什麼需要這個旗標】殘骸池從此擁有那個 `group` 的位置與旋轉；每幀的
   * 內插迴圈若繼續寫它，殘骸會被釘在飛機死掉的地方一動也不動。
   */
  wrecked: boolean
}

export interface AircraftVisualBuilders {
  buildAircraft: typeof buildAircraft
  buildAircraftLod: typeof buildAircraftLod
}

type Liveries = Readonly<Record<string, string>> | undefined

export interface AircraftVisuals {
  readonly visuals: ReadonlyMap<Combatant, Readonly<AircraftVisual>>
  /** 依 combatant.index 索引，直接持有各席的內插暫存，增援與復活不更換它。 */
  readonly positions: readonly Vector3[]
  readonly quaternions: readonly Quaternion[]
  sync(combatants: readonly Combatant[], liveries: Liveries): void
  clear(wrecks: Pick<Wrecks, 'reset'>): void
  update(
    combatants: readonly Combatant[], alpha: number, cameraPosition: Vector3,
    propRotation: number, liveries: Liveries,
    wrecks: Pick<Wrecks, 'adopt'>, vortex: Pick<Vortex, 'emit'>,
    magnification?: number,
  ): void
}

const DEFAULT_BUILDERS: AircraftVisualBuilders = { buildAircraft, buildAircraftLod }

/** 管理飛機顯示資源的所有權；每幀共用兩個翼尖暫存，不建立姿態物件。 */
export function createAircraftVisuals(
  scene: Pick<Object3D, 'add' | 'remove'>,
  builders: AircraftVisualBuilders = DEFAULT_BUILDERS,
): AircraftVisuals {
  const visuals = new Map<Combatant, AircraftVisual>()
  const positions: Vector3[] = []
  const quaternions: Quaternion[] = []
  const TIP_L = new Vector3()
  const TIP_R = new Vector3()

  function attachLod(v: AircraftVisual, id: string): void {
    v.lod = builders.buildAircraftLod(id)
    if (v.lod !== null) {
      v.lod.group.visible = false
      scene.add(v.lod.group)
    }
    v.far = false
  }

  function attachVisual(c: Combatant, liveries: Liveries): AircraftVisual {
    const v: AircraftVisual = {
      model: builders.buildAircraft(c.aircraft.spec, liveries?.[c.aircraft.spec.id]),
      lod: null,
      far: false,
      position: new Vector3(),
      quaternion: new Quaternion(),
      wrecked: false,
    }
    scene.add(v.model.group)
    attachLod(v, c.aircraft.spec.id)
    visuals.set(c, v)
    return v
  }

  // 增援只從尾端加座位；既有模型、殘骸與內插暫存都維持原物件。
  function sync(combatants: readonly Combatant[], liveries: Liveries): void {
    for (let i = positions.length; i < combatants.length; i++) {
      const v = attachVisual(combatants[i]!, liveries)
      positions.push(v.position)
      quaternions.push(v.quaternion)
    }
  }

  function clear(wrecks: Pick<Wrecks, 'reset'>): void {
    wrecks.reset()
    for (const v of visuals.values()) {
      // 殘骸已移交所有權，可能剛被 reset 釋放，也可能早已落地或被池子覆蓋。
      // 復活的席位則持有新模型，舊模型仍由殘骸池釋放。
      if (!v.wrecked) {
        scene.remove(v.model.group)
        v.model.dispose()
      }
      if (v.lod !== null) {
        scene.remove(v.lod.group)
        v.lod.dispose()
        v.lod = null
      }
    }
    visuals.clear()
    positions.length = 0
    quaternions.length = 0
  }

  function update(
    combatants: readonly Combatant[], alpha: number, cameraPosition: Vector3,
    propRotation: number, liveries: Liveries,
    wrecks: Pick<Wrecks, 'adopt'>, vortex: Pick<Vortex, 'emit'>,
    magnification = 1,
  ): void {
    for (const c of combatants) {
      const v = visuals.get(c)!
      if (v.wrecked) {
        // 模型已經交給殘骸池，位置與旋轉從此由它寫
        if (!c.alive) continue
        // 【整隊重生的席位拿一具新模型】舊的那具由殘骸池在落海或被覆蓋時
        // 釋放。配置只發生在復活那一刻
        v.model = builders.buildAircraft(c.aircraft.spec, liveries?.[c.aircraft.spec.id])
        scene.add(v.model.group)
        attachLod(v, c.aircraft.spec.id)
        v.wrecked = false
      }

      v.position.lerpVectors(c.aircraft.prevPosition, c.aircraft.state.position, alpha)
      v.quaternion.slerpQuaternions(c.aircraft.prevOrientation, c.aircraft.state.orientation, alpha)
      // 【距離 LOD】兩具的姿態都要寫 —— 只寫顯示中的那一具，換過去的那一幀
      // 會看到它還停在上一次顯示時的位置。
      // 【望遠】畫面放大 `magnification` 倍，同一架在畫面上的大小等於近了那麼多倍，
      // 距離照放大後的算，不然拉近看到的還是低模
      if (v.lod !== null) {
        v.far = useAircraftLod(v.position.distanceToSquared(cameraPosition) / (magnification * magnification), v.far)
        v.lod.group.position.copy(v.position)
        v.lod.group.quaternion.copy(v.quaternion)
      }
      v.model.group.position.copy(v.position)
      v.model.group.quaternion.copy(v.quaternion)

      // 【整場不進場的席位不畫、不留殘骸】它從來沒有飛過
      if (c.retired) {
        v.model.group.visible = false
        if (v.lod !== null) v.lod.group.visible = false
        continue
      }
      if (!c.alive) {
        // 【殘骸的判準是「還有沒有人要用這個模型」，不是「這是不是玩家」】
        // M9 起玩家陣亡改為接手僚機，他的 alive 維持 false —— 這一段一個字
        // 都不用改就自動替玩家的舊機體留下殘骸（M8 spec §10 預告的那件事）。
        //
        // 【為什麼先內插再接管】殘骸的起始姿態必須接在畫面上最後看到的位置。
        // 用擊墜事件裡的子步位置會跳最多 0.83 m（M8 spec §3.1）。
        v.wrecked = true
        // 【殘骸接手高模，低模在這裡放掉】殘骸池只收一個 group，
        // 而墜落的殘骸會一路掉到眼前 —— 交低模過去的話近看是多邊形的機身。
        if (v.lod !== null) {
          scene.remove(v.lod.group)
          v.lod.dispose()
          v.lod = null
          v.far = false
        }
        const vel = c.aircraft.state.velocity
        wrecks.adopt(v.model, c.aircraft.spec, vel.x, vel.y, vel.z, c.index)
        continue
      }

      const shown = v.far && v.lod !== null ? v.lod : v.model
      if (v.lod !== null) {
        v.model.group.visible = !v.far
        v.lod.group.visible = v.far
      } else {
        v.model.group.visible = true
      }
      shown.setPropSpin(propRotation, c.command.throttle > 0.15, c.command.throttle)

      // 【翼尖凝結尾】接線點在 `v.wrecked` 與 `!c.alive` 的 continue 之後 ——
      // 翻滾的殘骸沒有升力，本來就不該冒尾跡，那是免費得到的。
      //
      // 【用 v.position / v.quaternion 而不是 c.aircraft.state.*】尾跡要接在
      // **畫面上看到的**翼尖，不是物理子步的位置。與殘骸接管用 `v` 的理由
      // 完全相同（見上方那段註解）。
      //
      // 【翼尖寫在機種的模型定義上】每一台的機翼位置都不一樣，見 `GlbAircraft.wingTip`。
      const tip = v.model.wingTip
      TIP_L.set(-tip.x, tip.y, tip.z).applyQuaternion(v.quaternion).add(v.position)
      TIP_R.set(tip.x, tip.y, tip.z).applyQuaternion(v.quaternion).add(v.position)
      vortex.emit(
        c.index, c.aircraft.diag.loadFactor,
        TIP_L.x, TIP_L.y, TIP_L.z,
        TIP_R.x, TIP_R.y, TIP_R.z,
      )
    }
  }

  return { visuals, positions, quaternions, sync, clear, update }
}
