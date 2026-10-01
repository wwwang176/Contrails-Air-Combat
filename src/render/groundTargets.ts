import { BufferGeometry, Group, Mesh, MeshStandardMaterial, Quaternion, Vector3 } from 'three'
import type { GroundTarget } from '../world/groundTargets'
import { GEAR_CLEARANCE } from '../control/takeoffRoll'
import { groundGeometry, groundLodGeometry } from './geometry/ground'
import {
  PARKED_OFFSET_KEY, PARKED_PROP_KEY, PARKED_TAIL_DOWN, type ParkedProp,
} from './geometry/ground/parked'
import { useAircraftLod } from './geometry/buildAircraft'

/** 停放模型烘進去的機尾下沉，與它的反向 */
const TILT = /* @__PURE__ */ new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), PARKED_TAIL_DOWN)
const UNTILT = /* @__PURE__ */ TILT.clone().invert()
const OFF = /* @__PURE__ */ new Vector3()
const Z_AXIS = /* @__PURE__ */ new Vector3(0, 0, 1)
const SPIN = /* @__PURE__ */ new Quaternion()

/**
 * 地上的槳轉速，rad/s（約每秒 1.3 圈）。與飛行中油門收到底時同一個數
 * （`main.ts` 的 `propRotation`）。四葉槳每幀轉超過 45° 看起來就會倒轉 ——
 * 60 fps 的上限約 47 rad/s。
 */
export const PARKED_PROP_SPIN = 8

/**
 * 地面目標的模型。**一台一顆 Mesh**，幾何來自 `geometry/ground`。
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
  /**
   * `cam` 是鏡頭的世界座標，距離 LOD 用。`seconds` 是這一幀的物理時間（暫停為 0），
   * 地上的槳照它轉。
   */
  update(targets: readonly GroundTarget[], cam: Vector3, seconds?: number): void
  /**
   * 距離 LOD 現在切到哪裡，給 `main.ts` 的 `__lod` 出口。
   *
   * 【為什麼需要它】切換沒生效時畫面上看不出來 —— 兩份幾何長得幾乎一樣，
   * 症狀只有「省下來的幀時間是零」，而幀時間本來就會漂。
   */
  lodState(): { withLod: number; far: number }
  dispose(): void
}

interface Pair {
  readonly hi: BufferGeometry
  readonly lo: BufferGeometry | null
}

export function createGroundModels(targets: readonly GroundTarget[]): GroundModels {
  const live = new MeshStandardMaterial({
    vertexColors: true, flatShading: true, roughness: 0.85, metalness: 0.06,
  })
  const wreck = new MeshStandardMaterial({
    color: 0x2a2421, flatShading: true, roughness: 1.0,
  })
  const object = new Group()
  const meshes: Mesh[] = []
  const pairs: Pair[] = []
  /** 這一幀顯示的是低模嗎。逐台一格，`useAircraftLod` 的遲滯要讀上一幀。 */
  const far: boolean[] = []
  /** 程序化那幾種的幾何是這裡建的，這裡放；GLB 的是快取共用的，不碰。 */
  const owned: BufferGeometry[] = []
  const byId = new Map<string, Pair>()
  /** 逐台一格：拆開的槳葉（停放的 P-51），沒有就是 null */
  const props: (Mesh | null)[] = []

  for (const t of targets) {
    let pair = byId.get(t.unit.id)
    if (pair === undefined) {
      const hi = groundGeometry(t.unit)
      if ('build' in t.unit.model) owned.push(hi)
      const lo = groundLodGeometry(t.unit)
      if (lo !== null && t.unit.lodModel !== undefined && 'build' in t.unit.lodModel) owned.push(lo)
      pair = { hi, lo }
      byId.set(t.unit.id, pair)
    }
    const m = new Mesh(pair.hi, live)
    object.add(m)
    meshes.push(m)
    pairs.push(pair)
    far.push(false)
    // 拆開的槳葉掛成子網格，跟著機身的變換走（滾行改平也一起）
    const pp = pair.hi.userData[PARKED_PROP_KEY] as ParkedProp | undefined
    let prop: Mesh | null = null
    if (pp !== undefined) {
      prop = new Mesh(pp.geometry, live)
      prop.position.set(pp.hub.x, pp.hub.y, pp.hub.z)
      prop.quaternion.copy(TILT)
      m.add(prop)
    }
    props.push(prop)
  }
  /** 地上的槳一律同一個角度 —— 一台一個相位看不出差別 */
  let spin = 0

  return {
    object,
    update(list, cam, seconds = 0) {
      spin = (spin + seconds * PARKED_PROP_SPIN) % (Math.PI * 2)
      SPIN.setFromAxisAngle(Z_AXIS, spin)
      for (let k = 0; k < list.length && k < meshes.length; k++) {
        const t = list[k]!
        const m = meshes[k]!
        const prop = props[k]!
        if (prop !== null) {
          // 被打掉的停轉
          if (t.alive) prop.quaternion.multiplyQuaternions(TILT, SPIN)
          if (prop.material !== (t.alive ? live : wreck)) prop.material = t.alive ? live : wreck
        }
        m.position.copy(t.position)
        m.quaternion.copy(t.orientation)
        const lo = pairs[k]!.lo
        // 【滾行時機身改平】停放模型烘進了機尾下沉與貼地的平移，滾行的姿態是
        // 機身水平、原點在地面上 `GEAR_CLEARANCE` —— 與離地後接手的那一架相同，
        // 不扣回來的話交接那一幀機頭會跳 10°
        const off = m.geometry.userData[PARKED_OFFSET_KEY] as { x: number; y: number; z: number } | undefined
        if (t.rolling && off !== undefined) {
          m.quaternion.multiply(UNTILT)
          OFF.set(off.x, off.y, off.z).applyQuaternion(m.quaternion)
          m.position.y += GEAR_CLEARANCE
          m.position.sub(OFF)
        }
        if (lo !== null) {
          const want = useAircraftLod(t.position.distanceToSquared(cam), far[k]!)
          far[k] = want
          const geo = want ? lo : pairs[k]!.hi
          if (m.geometry !== geo) m.geometry = geo
        }
        // 【只換材質，形狀不動，而且雙向】重開一場實體會復活，只換過去不換
        // 回來的話畫面留著焦黑。參考比較，每幀跑也不配置
        const want = t.alive ? live : wreck
        if (m.material !== want) m.material = want
        // 【起飛離場的不畫】它已經是空中那一架了，留著會是一具不存在的殘骸。
        // 開到前線退場的車也不畫 —— 它是開走了，不是燒在路上。藏著還沒出發的
        // 縱隊也不畫：它還不在場上。死掉的人也不畫：不留焦黑的人形
        m.visible = !t.departed && !t.arrived && !t.dormant && (t.alive || t.unit.personnel !== true)      }
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
      for (const g of owned) g.dispose()
      live.dispose()
      wreck.dispose()
    },
  }
}
