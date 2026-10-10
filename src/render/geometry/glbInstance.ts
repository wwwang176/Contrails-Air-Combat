import type { Group, Mesh, Object3D, Vector3 } from 'three'
import type { AircraftModel, HullMetrics } from './assembly'
import { PROP_BLUR_SPIN, propBlurRate } from '../propBlur'


/** 載好、貼好材質、併好的一份樣板。每個機種一份，全場共用。 */
export interface GlbTemplate {
  group: Group
  metrics: HullMetrics
  eyePoint: Vector3
  wingTip: Vector3
  /** 見 `GlbAircraft.bombPoint`。`null` = 這一台掛不了彈 */
  bombPoint: Vector3 | null
  /** 每一具槳轂的位置，機體座標。見 `AircraftModel.enginePoints` */
  enginePoints: Vector3[]
  /** 樣板自己持有的 GPU 資源。整局結束才需要放。 */
  dispose(): void
}


/**
 * 由樣板複製一架。
 *
 * 【幾何與材質是共用的，不是複製的】`Object3D.clone()` 預設就共用
 * `BufferGeometry` 與 `Material`。20v20 是 40 架共用同一份頂點緩衝 ——
 * 這正是這條分支在買的東西（每幀上傳與 draw call）。代價是 `dispose()`
 * 不能放共用資源，所以它是空的；樣板的資源由 `GlbTemplate.dispose` 放。
 */
export function buildFromTemplate(t: GlbTemplate): AircraftModel {
  const group = t.group.clone(true)
  // 每一具螺旋槳一組（多發機有好幾組）
  const props: { hub: Object3D; disc: Mesh; blades: Mesh[] }[] = []
  group.traverse((o) => {
    if (!o.userData['propHub']) return
    let disc: Mesh | null = null
    const blades: Mesh[] = []
    for (const c of o.children) {
      const mesh = c as Mesh
      if (!mesh.userData['spinning']) continue
      if ((mesh.geometry as { type?: string } | undefined)?.type === 'CircleGeometry') disc = mesh
      else blades.push(mesh)
    }
    if (disc === null) throw new Error('樣板的螺旋槳轉軸底下沒有槳盤')
    props.push({ hub: o, disc, blades })
  })
  if (props.length === 0) throw new Error('樣板缺少螺旋槳節點')
  /** 這一架的殘影角度，rad。起始值隨機：編隊裡的槳盤才不會轉得一模一樣 */
  let blurAngle = Math.random() * Math.PI * 2
  /** 上一次 `setPropSpin` 時的殘影時鐘 */
  let clockAt = PROP_BLUR_SPIN.clock
  return {
    group,
    metrics: t.metrics,
    eyePoint: t.eyePoint.clone(),
    wingTip: t.wingTip.clone(),
    bombPoint: t.bombPoint === null ? null : t.bombPoint.clone(),
    // 【複製而不是共用】殘骸那一層只讀不寫，但共用一份可變向量是等著出事
    enginePoints: t.enginePoints.map((p) => p.clone()),
    setPropSpin(r, b, throttle = 1) {
      // 【殘影不跟著槳轂轉】照全場的殘影時鐘走了多少、乘上這一架的轉速累積（`render/propBlur.ts`）；
      // 時鐘倒退（換場重設）就不轉
      const step = PROP_BLUR_SPIN.clock - clockAt
      clockAt = PROP_BLUR_SPIN.clock
      if (step > 0) blurAngle = (blurAngle + step * propBlurRate(throttle)) % (Math.PI * 2)
      for (const p of props) {
        p.hub.rotation.z = r
        p.disc.visible = b
        // 扣掉槳轂已經轉的，圓盤實際的角度才只看殘影角度
        p.disc.rotation.z = blurAngle - r
        for (const blade of p.blades) blade.visible = !b
      }
    },
    dispose() { /* 幾何與材質由樣板持有，見上方說明 */ },
  }
}
