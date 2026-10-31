import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3, type Texture } from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { GEAR_CLEARANCE, takeoffOriginBlend } from '../control/takeoffRoll'
import { GROUND_MODELS, groundGeometry, groundLodGeometry, groundVariants } from './geometry/ground'
import { PARKED_TAIL_DOWN, type GroundLivery } from '../specs/ground'
import {
  PARKED_OFFSET_KEY, PARKED_PROP_KEY, PARKED_LIVERY_KEY, type ParkedProp,
} from './geometry/ground/parked'
import { useAircraftLod } from './geometry/buildAircraft'
import { GUN_TURRET_KEY, type GunTurretParts } from './geometry/ground/turret'
import { disposeLivery, liveryGeometry } from './geometry/ground/livery'
import { createGroundGunShots, groundGunMuzzleOf, readGroundGunMuzzle, type GroundGunSource } from './groundGunShots'
import { createGroundMuzzles } from './groundMuzzles'
import { createGroundVehicleBatch, type GroundModelPart } from './groundVehicleBatch'
import { GROUND_GUN_MOUNTS } from '../specs/groundGunMounts'
import { createRoofGunParts, SHERMAN_ROOF_GUN } from './geometry/ground/roofGun'
import { applyGroundDust, groundGrimeTexture } from './groundGrime'
import {
  GUN_PITCH_MAX, GUN_PITCH_MIN, TANK_PITCH_MAX, TANK_PITCH_MIN, TANK_TRAVERSE_RATE, aimAngles, slewYaw,
} from './gunAim'

/** 停放模型烘進去的機尾下沉 */
const TILT = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), PARKED_TAIL_DOWN)
const OFF = /* @__PURE__ */ new Vector3()
const Z_AXIS = /* @__PURE__ */ new Vector3(0, 0, 1)
const FORWARD = /* @__PURE__ */ new Vector3(0, 0, -1)
const SPIN = /* @__PURE__ */ new Quaternion()
/** 砲塔角度的暫存。熱路徑：不配置 */
const ANGLES = { yaw: 0, pitch: 0 }
const TO = /* @__PURE__ */ new Vector3()
const INV = /* @__PURE__ */ new Quaternion()

/** 耳軸到目標的水平距離下限，m。目標貼著車身時仰角不會翻到背後 */
const TRUNNION_MIN_REACH = 0.5

/** 砲塔（水平轉那一顆，上下抬那一顆是它的孩子）的物件名 */
export const GROUND_TURRET_NAME = 'groundModels.turret'

/**
 * 砲塔的瞄準目標從哪來：地面戰的戲（`render/groundBattle.ts`）。序號是 `update` 收到的那一份
 * 清單的序號，回 −1 = 沒有
 */
export interface GroundAimSource {
  aimTarget(s: number): number
}

/**
 * 地上的槳轉速，rad/s（約每秒 1.3 圈）。與飛行中油門收到底時同一個數
 * （`main.ts` 的 `propRotation`）。四葉槳每幀轉超過 45° 看起來就會倒轉 ——
 * 60 fps 的上限約 47 rad/s。
 */
export const PARKED_PROP_SPIN = 8

/**
 * 地面目標的模型。每台保留一個根節點，幾何來自 `geometry/ground`；車輛可合批繪製。
 *
 * 【同一種只建一份幾何，全部共用】Mesh 各自帶變換，共用幾何完全安全。停放的
 * B-17 有 24 台，逐台一份的話光是那一種就是 24 份頂點緩衝區。
 *
 * 【死了換材質，不換模型】燒掉的戰車還是那台戰車的形狀，只是黑的。關掉
 * 頂點色、整台塗成焦黑，一行就做完；殘骸模型與傾倒動畫不做。
 *
 * 【廠房也不換】把炸毀的廠房換成矮一截的殘骸，在投彈高度只讀成「那裡的
 * 東西不見了」—— 一根 100 m 的煙囪塌成 25 m 的板子看不出是被炸的。代價是
 * 命中盒隨著實體死掉，後續的炸彈會穿過還站著的煙囪在地上爆。
 *
 * 【距離 LOD】有 `lodModel` 的那幾種遠了換低模。門檻與飛行中那批共用
 * （`geometry/buildAircraft.ts` 的 `useAircraftLod`）—— 上帝視角飛得到停機坪
 * 旁邊，兩邊用同一個距離才不會出現「地上那架先變、天上那架還沒變」。
 *
 * 【與船同一個更新節奏】位置與旗標都是狀態不是事件，在渲染幀讀就好。
 */
export interface GroundModels {
  readonly object: Group
  /** 寫出目前模型砲口的位置與方向；無砲管或模型隱藏時回傳 false。 */
  muzzle(index: number, position: Vector3, direction: Vector3): boolean
  /**
   * `cam` 是鏡頭的世界座標，距離 LOD 用。`seconds` 是這一幀的物理時間（暫停為 0），
   * 地上的槳與 T-34 的砲塔照它轉。`aim` 是沒有模擬砲位的單位（T-34、反坦克砲）的瞄準目標；
   * 省略 = 它們的砲塔轉回正前方。
   */
  update(targets: readonly GroundTarget[], cam: Vector3, seconds?: number, aim?: GroundAimSource | null): void
  /**
   * 距離 LOD 現在切到哪裡，給 `main.ts` 的 `__lod` 出口。
   *
   * 【為什麼需要它】切換沒生效時畫面上看不出來 —— 兩份幾何長得幾乎一樣，
   * 症狀只有「省下來的幀時間是零」，而幀時間本來就會漂。
   */
  lodState(): { withLod: number; far: number }
  /**
   * 砲塔角度歸零（朝正前方、砲管放平）。**重開一場時呼叫**：沒有波次的一場重開不重建地面模型
   * （`main.ts`），不歸零的話上一場最後的角度會帶進來
   */
  resetTurrets(): void
  dispose(): void
}

interface Pair {
  readonly hi: BufferGeometry
  readonly lo: BufferGeometry | null
}

/**
 * @param livery 這一場地面單位的塗裝（任務卡的 `groundLivery`）。省略 = 預設配色、直接用共用的幾何
 * @param onGunShot 防空砲新開火時通報模型管口、方向與效果尺度，爆炸效果由呼叫端持有。
 */
export function createGroundModels(
  targets: readonly GroundTarget[], livery?: GroundLivery,
  onGunShot?: (x: number, y: number, z: number, dx: number, dy: number, dz: number, scale: number) => void,
): GroundModels {
  const live = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.06,
  })
  const wreck = new MeshStandardMaterial({
    color: 0x2a2421, flatShading: true, roughness: 1.0,
  })
  // 【車輛與地面砲（GLB 那幾台）蓋髒污】白底圖集乘上頂點色，冬季塗裝照樣換（`groundGrime.ts`）。
  // 合批的只有它們，所以這一份只給合批用；程序化的步兵、火車、廠房、停放的飛機維持 `live`
  const grime = groundGrimeTexture()
  const vehicle = grime === null ? live : live.clone()
  if (grime !== null) {
    vehicle.map = grime
    applyGroundDust(vehicle)
  }
  const object = new Group()
  // 車輛一律合批；沒有 multi-draw 擴充時，由 Three 自動逐筆提交。
  const vehicleBatch = createGroundVehicleBatch(object)
  const meshes: GroundModelPart[] = []
  const pairs: Pair[] = []
  /** 這一幀顯示的是低模嗎。逐台一格，`useAircraftLod` 的遲滯要讀上一幀。 */
  const far: boolean[] = []
  /** 程序化那幾種的幾何是這裡建的，這裡放；GLB 的是快取共用的，不碰。 */
  const owned: BufferGeometry[] = []
  /** 換過塗裝的那一份，依共用的原物一份（共用同一支 GLB 的單位共用它）；這裡建的、這裡放 */
  const liveried = new Map<BufferGeometry, BufferGeometry>()
  /** 依「單位 id + 擺法」一份；只有一種擺法的就是一種單位一份 */
  const byId = new Map<string, Pair>()
  /** 每種單位已經擺了幾台：有多種擺法的照這個輪流挑，同一關的相鄰幾堆因此不會長一樣 */
  const placedCount = new Map<string, number>()
  /** 幾何對應的存活材質；同貼圖只建立一份，更新幀僅查表。 */
  const liveMaterials = new Map<BufferGeometry, MeshStandardMaterial | MeshStandardMaterial[]>()
  const paintedMaterials = new Map<Texture, MeshStandardMaterial[]>()

  /**
   * @param plain 沒有停放塗裝時存活的那一份。合批的（GLB）給 `vehicle`：每一幀照存活換回它，
   *   換成別的那一池就對不上材質、整批藏起來
   */
  function prepareMaterial(geometry: BufferGeometry, plain: MeshStandardMaterial = live): void {
    if (liveMaterials.has(geometry)) return
    const texture = geometry.userData[PARKED_LIVERY_KEY] as Texture | undefined
    if (texture === undefined) {
      liveMaterials.set(geometry, plain)
      return
    }
    let materials = paintedMaterials.get(texture)
    if (materials === undefined) {
      const painted = live.clone()
      painted.map = texture
      materials = [live, painted]
      paintedMaterials.set(texture, materials)
    }
    liveMaterials.set(geometry, materials)
  }
  /** 逐台一格：拆開的槳葉（停放的 P-51），沒有就是 null */
  const props: (Mesh | null)[] = []
  /** 逐台一格：會轉的砲塔（水平轉那一顆，上下抬那一顆是它的孩子），沒有就是 null */
  const turrets: (GroundModelPart | null)[] = []
  const muzzlePoints: (Vector3 | null)[] = []
  /** 逐台一格：拆開的兩塊與轉軸，坦克算方位與仰角用 */
  const turretParts: (GunTurretParts | null)[] = []
  /** 逐台一格：左右射界的半角，rad；轉得了一整圈是 Infinity */
  const yawLimits: number[] = []
  /** 逐台的砲塔角度，rad。死了停在最後那一幀 */
  const yaws = new Float64Array(targets.length)
  const pitches = new Float64Array(targets.length)
  const gunSources: GroundGunSource[] = []
  const muzzleSources: GroundGunSource[] = []
  const roofGuns: (GroundModelPart | null)[] = []
  let roofParts: ReturnType<typeof createRoofGunParts> | null = null

  for (const t of targets) {
    const batch = 'glb' in GROUND_MODELS[t.unit.id].model ? vehicleBatch : null
    const part = (geometry: BufferGeometry, material: MeshStandardMaterial): GroundModelPart =>
      batch === null ? new Mesh(geometry, material) : batch.part(geometry, material, wreck)
    const nth = placedCount.get(t.unit.id) ?? 0
    placedCount.set(t.unit.id, nth + 1)
    const variant = nth % groundVariants(t.unit)
    const key = `${t.unit.id}#${variant}`
    let pair = byId.get(key)
    if (pair === undefined) {
      const { model, lodModel } = GROUND_MODELS[t.unit.id]
      let hi = groundGeometry(t.unit, variant)
      if ('build' in model) owned.push(hi)
      else if (livery !== undefined) {
        // 【只換 GLB 那幾台】程序化的沒有冬季資料，`liveryGeometry` 會回原物
        let painted = liveried.get(hi)
        if (painted === undefined) {
          painted = liveryGeometry(hi, livery)
          liveried.set(hi, painted)
        }
        hi = painted
      }
      const lo = groundLodGeometry(t.unit)
      if (lo !== null && lodModel !== undefined && 'build' in lodModel) owned.push(lo)
      pair = { hi, lo }
      byId.set(key, pair)
      prepareMaterial(hi, batch === null ? live : vehicle)
      if (lo !== null) prepareMaterial(lo)
    }
    // 車輛皆為單一頂點色材質；停放飛機可能有多材質貼圖，保留原 Mesh。
    const m = batch === null ? new Mesh(pair.hi, liveMaterials.get(pair.hi)!) : part(pair.hi, vehicle)
    object.add(m)
    meshes.push(m)
    pairs.push(pair)
    far.push(false)
    // 拆開的槳葉掛成子網格，跟著機身的變換走。
    const pp = pair.hi.userData[PARKED_PROP_KEY] as ParkedProp | undefined
    let prop: Mesh | null = null
    if (pp !== undefined) {
      prepareMaterial(pp.geometry)
      prop = new Mesh(pp.geometry, liveMaterials.get(pp.geometry)!)
      prop.position.set(pp.hub.x, pp.hub.y, pp.hub.z)
      prop.quaternion.copy(TILT)
      m.add(prop)
    }
    props.push(prop)
    // 拆開的砲塔：水平轉那一顆掛在車身、上下抬那一顆掛在它底下，位置都是轉軸
    const gt = pair.hi.userData[GUN_TURRET_KEY] as GunTurretParts | undefined
    let trav: GroundModelPart | null = null
    let roofGun: GroundModelPart | null = null
    if (gt !== undefined) {
      trav = part(gt.traverse, vehicle)
      // 【命名】量測出口（`__gfx` 的 `groundTurrets`）靠名字找出這些子網格
      trav.name = GROUND_TURRET_NAME
      trav.position.copy(gt.traversePivot)
      const elev = part(gt.elevate, vehicle)
      elev.position.copy(gt.elevatePivot)
      trav.add(elev)
      m.add(trav)
      if (t.unit.id === 'usFlakHeavy' || t.unit.id === 'flakHeavy') {
        gunSources.push({ index: meshes.length - 1, barrel: elev })
      } else if (t.unit.id === 'flakLight' || t.unit.id === 'usFlakTrack') {
        muzzleSources.push({ index: meshes.length - 1, barrel: elev, muzzles: GROUND_GUN_MOUNTS[t.unit.id]!.muzzles })
      } else if (t.unit.id === 'usTank' && t.guns[0]?.zone.tier === 'mg') {
        roofParts ??= createRoofGunParts()
        const mount = new Group()
        mount.position.set(SHERMAN_ROOF_GUN.x - gt.traversePivot.x,
          SHERMAN_ROOF_GUN.y - gt.traversePivot.y, SHERMAN_ROOF_GUN.z - gt.traversePivot.z)
        // 車頂機槍使用獨立材質，保留 Mesh，不另外建立合批池。
        mount.add(new Mesh(roofParts.post, roofParts.material))
        roofGun = new Mesh(roofParts.gun, roofParts.material)
        roofGun.name = 'groundModels.roofGun'
        mount.add(roofGun)
        trav.add(mount)
        muzzleSources.push({ index: meshes.length - 1, barrel: roofGun, muzzles: GROUND_GUN_MOUNTS.usTank!.muzzles })
      }
    }
    roofGuns.push(roofGun)
    turrets.push(trav)
    muzzlePoints.push(trav === null ? null : groundGunMuzzleOf(trav.children[0] as GroundModelPart))
    turretParts.push(gt ?? null)
    const reg = GROUND_MODELS[t.unit.id].model
    yawLimits.push('glb' in reg ? reg.turret?.yawLimit ?? Infinity : Infinity)
  }

  const gunShots = gunSources.length > 0 && onGunShot !== undefined
    ? createGroundGunShots(gunSources, targets, onGunShot) : null
  const muzzles = muzzleSources.length > 0 ? createGroundMuzzles(muzzleSources, targets) : null
  if (muzzles !== null) object.add(muzzles.object)
  vehicleBatch.build()
  vehicleBatch.update()

  /** 第 k 台砲塔這一幀的角度寫進 `yaws`／`pitches`。死了的不動 */
  function aimTurret(list: readonly GroundTarget[], k: number, seconds: number, aim: GroundAimSource | null): void {
    const t = list[k]!
    if (!t.alive) return
    const gun = t.guns[0]
    // 【有模擬砲位的照它的瞄準方向】已經是單位本身的座標，而且已照轉速慢慢轉，畫面不再平滑
    if (gun !== undefined && roofGuns[k] === null) {
      const a = gun.aim
      const mount = t.projectileMount
      const yaw = mount?.elevationPivot && mount.tier === gun.zone.tier ? gun.muzzleYaw ?? yaws[k]! : yaws[k]!
      aimAngles(a.x, a.y, a.z, yaw, pitches[k]!, GUN_PITCH_MIN, GUN_PITCH_MAX, ANGLES)
      yaws[k] = ANGLES.yaw
      pitches[k] = ANGLES.pitch
      return
    }
    // 【其餘的問地面戰】指向目標的中心；沒有就轉回正前方
    const j = aim === null ? -1 : aim.aimTarget(k)
    const them = j >= 0 ? list[j] : undefined
    let wantYaw = 0
    let wantPitch = 0
    if (them !== undefined) {
      // 目標中心換成車身座標。【方位從水平旋轉軸量、仰角從耳軸量】耳軸在旋轉軸前方
      // （`elevatePivot.z` 為負）：方位從耳軸量的話近處的目標會偏；仰角的水平距離從旋轉軸量的話
      // 會多算那一段，近處指低（正前方 10 m 差將近 1°）
      const g = turretParts[k]!
      TO.set(them.position.x, them.position.y + them.unit.realHeight * 0.5, them.position.z)
        .sub(t.position).applyQuaternion(INV.copy(t.orientation).invert())
      const tp = g.traversePivot
      const ep = g.elevatePivot
      const dx = TO.x - tp.x
      const dz = TO.z - tp.z
      // 耳軸跟著砲塔轉到目標方向上，所以它到目標的水平距離是「旋轉軸到目標」減掉它往前伸的那一段。
      // 目標在耳軸裡面（距離 ≤ 0）時夾一個下限，免得仰角翻到背後
      const flat = Math.max(TRUNNION_MIN_REACH, Math.hypot(dx, dz) + ep.z)
      aimAngles(dx, 0, dz, yaws[k]!, pitches[k]!, 0, 0, ANGLES)
      // 【射界】開腳式砲架只能在架腳之間轉；射界外的目標停在邊上
      const lim = yawLimits[k]!
      wantYaw = Math.min(lim, Math.max(-lim, ANGLES.yaw))
      wantPitch = Math.min(TANK_PITCH_MAX, Math.max(TANK_PITCH_MIN, Math.atan2(TO.y - tp.y - ep.y, flat)))
    }
    yaws[k] = slewYaw(yaws[k]!, wantYaw, TANK_TRAVERSE_RATE, seconds)
    pitches[k] = slewYaw(pitches[k]!, wantPitch, TANK_TRAVERSE_RATE, seconds)
  }
  /** 地上的槳一律同一個角度 —— 一台一個相位看不出差別 */
  let spin = 0

  return {
    object,
    muzzle(index, position, direction) {
      const trav = turrets[index]
      const local = muzzlePoints[index]
      if (trav == null || local == null || !meshes[index]!.visible) return false
      readGroundGunMuzzle(trav.children[0] as GroundModelPart, local, position, direction)
      return true
    },
    update(list, cam, seconds = 0, aim = null) {
      spin = (spin + seconds * PARKED_PROP_SPIN) % (Math.PI * 2)
      SPIN.setFromAxisAngle(Z_AXIS, spin)
      for (let k = 0; k < list.length && k < meshes.length; k++) {
        const t = list[k]!
        const m = meshes[k]!
        const prop = props[k]!
        if (prop !== null) {
          // 被打掉的停轉
          if (t.alive) prop.quaternion.multiplyQuaternions(TILT, SPIN)
          const propMaterial = t.alive ? liveMaterials.get(prop.geometry)! : wreck
          if (prop.material !== propMaterial) prop.material = propMaterial
        }
        const trav = turrets[k]!
        if (trav !== null) {
          aimTurret(list, k, seconds, aim)
          const elev = trav.children[0] as GroundModelPart
          trav.rotation.y = yaws[k]!
          elev.rotation.x = pitches[k]!
          const mat = t.alive ? vehicle : wreck
          if (trav.material !== mat) trav.material = mat
          if (elev.material !== mat) elev.material = mat
          const roof = roofGuns[k]!
          if (roof !== null) {
            const gun = t.guns[0]
            if (t.alive && gun?.alive) {
              // 射向屬於車身座標；扣掉主砲塔方位，車頂機槍獨立瞄準。
              TO.copy(gun.aim).applyQuaternion(INV.copy(trav.quaternion).invert())
              roof.quaternion.setFromUnitVectors(FORWARD, TO)
            }
            const roofMaterial = t.alive ? roofParts!.material : wreck
            roof.material = roofMaterial
            const post = roof.parent!.children[0] as GroundModelPart
            post.material = roofMaterial
          }
        }
        m.position.copy(t.position)
        m.quaternion.copy(t.orientation)
        const lo = pairs[k]!.lo
        // 滾行維持烘好的 10° 抬頭；只將貼地原點漸變到飛行原點，避免起步與離地跳位。
        const off = m.geometry.userData[PARKED_OFFSET_KEY] as { x: number; y: number; z: number } | undefined
        if (t.rolling && off !== undefined) {
          OFF.set(off.x, off.y, off.z).applyQuaternion(m.quaternion)
          const k = takeoffOriginBlend(t.taxi)
          m.position.y += GEAR_CLEARANCE * k
          m.position.addScaledVector(OFF, -k)
        }
        if (lo !== null) {
          const want = useAircraftLod(t.position.distanceToSquared(cam), far[k]!)
          far[k] = want
          const geo = want ? lo : pairs[k]!.hi
          if (m.geometry !== geo) m.geometry = geo
        }
        // 【只換材質，形狀不動，而且雙向】重開一場實體會復活，只換過去不換
        // 回來的話畫面留著焦黑。參考比較，每幀跑也不配置
        const want = t.alive ? liveMaterials.get(m.geometry)! : wreck
        if (m.material !== want) m.material = want
        // 【起飛離場的不畫】它已經是空中那一架了，留著會是一具不存在的殘骸。
        // 開到前線退場的車也不畫 —— 它是開走了，不是燒在路上。藏著還沒出發的
        // 縱隊也不畫：它還不在場上。死掉的人也不畫：不留焦黑的人形
        m.visible = !t.departed && !t.arrived && !t.dormant && (t.alive || t.unit.personnel !== true)
      }
      gunShots?.update(list, seconds)
      muzzles?.update(list, seconds)
      vehicleBatch.update()
    },
    resetTurrets() {
      gunShots?.reset()
      muzzles?.reset()
      yaws.fill(0)
      pitches.fill(0)
      for (const roof of roofGuns) roof?.quaternion.identity()
      for (const trav of turrets) {
        if (trav === null) continue
        trav.rotation.y = 0
        trav.children[0]!.rotation.x = 0
      }
      vehicleBatch.update()
    },
    lodState() {
      let withLod = 0
      let n = 0
      for (let k = 0; k < pairs.length; k++) {
        if (pairs[k]!.lo === null) continue
        withLod++
        if (far[k]!) n++
      }
      return { withLod, far: n }
    },
    dispose() {
      vehicleBatch.dispose()
      muzzles?.dispose()
      roofParts?.dispose()
      for (const g of owned) g.dispose()
      for (const [base, g] of liveried) if (g !== base) disposeLivery(g)
      // 貼圖由飛行模型快取持有；只釋放這裡建立的材質。
      for (const materials of paintedMaterials.values()) materials[1]!.dispose()
      live.dispose()
      // 髒污圖集是共用的（`groundGrimeTexture`），只釋放材質
      if (vehicle !== live) vehicle.dispose()
      wreck.dispose()
    },
  }
}
