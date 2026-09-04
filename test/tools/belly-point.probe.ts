/**
 * 量三台轟炸機的**機腹中央**：機體座標 x≈0、z≈0 那一帶的機身最低點。
 *
 * `bombPoint` 就放在那裡 —— 投彈瞄具的眼點與炸彈的產生位置都用它。
 *
 * 用法（`.probe.ts` 不在 `vite.config.ts` 的 include 裡）：
 *   `npx vitest run --config <一支 include 改成 test/tools/*.probe.ts 的設定>`
 */
import { beforeAll, it } from 'vitest'
import { Box3, Mesh, Vector3 } from 'three'
import { buildAircraft } from '../../src/render/geometry/buildAircraft'
import { specOf } from '../../src/battle/skirmish'
import { loadGlbTemplatesForNode } from '../fixtures/glb'

/** 取樣半徑，m。z=0 前後這一段的機身底面 */
const HALF_Z = 1.2
/** 中線的取樣半寬，m */
const HALF_X = 0.35

beforeAll(async () => { await loadGlbTemplatesForNode() })

it('量機腹中央', () => {
  const lines: string[] = []
  lines.push('機種      全長     z=0 附近的機腹底 y     整機包圍盒 y')
  for (const id of ['b17g', 'he111', 'g4m']) {
    const model = buildAircraft(specOf(id))
    model.group.updateMatrixWorld(true)

    let belly = Infinity
    const v = new Vector3()
    model.group.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const pos = m.geometry.getAttribute('position')
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld)
        if (Math.abs(v.x) > HALF_X || Math.abs(v.z) > HALF_Z) continue
        if (v.y < belly) belly = v.y
      }
    })

    const box = new Box3().setFromObject(model.group)
    lines.push(
      `${id.padEnd(8)} ${model.metrics.realLength.toFixed(2).padStart(6)}`
      + ` ${belly.toFixed(3).padStart(20)}`
      + ` ${box.min.y.toFixed(3).padStart(16)}`,
    )
    model.dispose()
  }
  // eslint-disable-next-line no-console
  console.log(lines.join('\n'))
})
