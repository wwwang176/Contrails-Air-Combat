import type { Vector3 } from 'three'
import type { GroundModels } from '../render/groundTargets'
import type { GroundBattle } from '../render/groundBattle'
import type { GroundTarget } from '../world/groundTargets'
import { GFX_HIDDEN_LAYER } from './graphicsDiagnostics'

type InspectionGround = Pick<GroundTarget, 'team' | 'hp' | 'alive'> & {
  readonly unit: Pick<GroundTarget['unit'], 'id'>
}

interface SceneryInspectionDependencies {
  groundTargets(): readonly InspectionGround[]
  readonly battleScenery: {
    readonly groundModels: Pick<GroundModels, 'object' | 'lodState'> | null
    readonly groundBattle: Pick<GroundBattle, 'objects' | 'shots' | 'arcShots' | 'arcLanded' | 'arcLastLanding'> | null
    readonly battleFogOn: boolean
  }
  readonly visuals: {
    readonly size: number
    values(): Iterable<{ readonly lod: object | null; readonly far: boolean; readonly position: Vector3 }>
  }
  readonly cameraPosition: Vector3
  readonly fog: { readonly a: { w: number } }
}

/** External scene probes read live scenery only when invoked, including after a battle switch. */
export function createSceneryInspection({
  groundTargets, battleScenery, visuals, cameraPosition, fog,
}: SceneryInspectionDependencies) {
  /**
   * 依單位種類隱藏地面目標，用來把幀時間歸因到某一種實體。給 `id` 就只藏那
   * 一種，省略則全部顯示。
   *
   * 【為什麼不放進 `__gfx`】那一份的目標是**繪製層**（海、天、粒子、曳光彈），
   * 而這裡要的是「同一層裡的某一批物件」—— 波爾塔瓦機場上停放的 24 架 B-17
   * 與 22 個砲位走的是同一顆材質、同一個 Group。
   *
   * 【`groundModels` 的孩子與 `groundTargets()` 同序】`createGroundModels`
   * 是照那個陣列一路 `add` 的，兩邊靠索引對齊。
   */
  const __hideGround = (id?: string) => {
    const g = battleScenery.groundModels?.object
    if (g === undefined) return { hidden: 0, kinds: [] as string[] }
    const list = groundTargets()
    const kinds = new Set<string>()
    let hidden = 0
    for (let k = 0; k < list.length && k < g.children.length; k++) {
      const t = list[k]!
      kinds.add(t.unit.id)
      const on = id === undefined || t.unit.id !== id
      g.children[k]!.traverse((o) => { o.layers.set(on ? 0 : GFX_HIDDEN_LAYER) })
      if (!on) hidden++
    }
    return { hidden, kinds: [...kinds] }
  }

  /**
   * **量測出口**：距離 LOD 現在切到哪裡。
   *
   * 【為什麼需要它】切換沒有生效時畫面上**看不出來** —— 兩具模型長得幾乎一樣，
   * 症狀只有「省下來的幀時間是零」，而幀時間本來就會漂。
   */
  const __lod = () => {
    let withLod = 0
    let far = 0
    let nearest = Infinity
    for (const v of visuals.values()) {
      if (v.lod === null) continue
      withLod++
      if (v.far) far++
      nearest = Math.min(nearest, v.position.distanceTo(cameraPosition))
    }
    return {
      seats: visuals.size, withLod, far, nearest: Math.round(nearest),
      ground: battleScenery.groundModels?.lodState() ?? null,
    }
  }

  /** **量測出口**：地面戰的戲開場到現在打了幾發。`null` = 這一場沒有戲 */
  const __theater = () => battleScenery.groundBattle?.shots ?? null

  /**
   * **量測出口**：戰場高度霧開關（省略參數 = 查現在的狀態）。同一頁交錯開關量它的成本、拍有霧與沒霧的
   * 同一幀。`null` = 這一場沒有霧
   */
  const __haze = (on?: boolean) => {
    if (!battleScenery.battleFogOn) return null
    if (on !== undefined) fog.a.w = on ? 1 : 0
    return fog.a.w > 0
  }

  /** **量測出口**：塵團開關（省略參數 = 查現在的狀態）。`null` = 這一場沒有塵團 */
  const __dustClouds = (on?: boolean) => {
    const o = battleScenery.groundBattle?.objects.find((x) => x.name === 'groundBattle.dustClouds')
    if (o === undefined) return null
    if (on !== undefined) o.visible = on
    return o.visible
  }

  /** **量測出口**：迫擊砲彈開場到現在發了幾發、落地幾發、最近一發落在哪裡。`null` = 這一場沒有戲 */
  const __mortars = () => battleScenery.groundBattle === null ? null : {
    shots: battleScenery.groundBattle.arcShots,
    landed: battleScenery.groundBattle.arcLanded,
    last: { ...battleScenery.groundBattle.arcLastLanding },
  }

  /**
   * **量測出口**：把紅方 `unit` 的前 `n` 台（省略 = 全部）直接打掉。
   *
   * 【為什麼需要它】德 M4 的兩段要驗「反坦克砲炸完 → 縱隊出發、目標換段」。靠 AI 去
   * 炸要好幾分鐘而且每次不同；這一支讓驗收直接跳到換段那一刻。走的是與炸彈同一條
   * 摧毀判定（`alive = false`），算進摧毀數。玩家沒有任何路徑碰得到。
   */
  const __wreckGround = (unit: string, n = Infinity) => {
    let k = 0
    for (const t of groundTargets()) {
      if (k >= n) break
      if (t.team !== 'red' || t.unit.id !== unit || !t.alive) continue
      t.hp = 0
      t.alive = false
      k++
    }
    return k
  }


  return { __hideGround, __lod, __theater, __haze, __dustClouds, __mortars, __wreckGround }
}
