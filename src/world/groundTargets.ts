import { Quaternion, Vector3 } from 'three'
import { boundingRadius, type Box } from './hit'
import type { StrikeTarget } from './strikeTarget'
import type { Team } from './World'

/**
 * # 場上的地面目標
 *
 * **不是 `Combatant`，也不是 `Ship`。** 沒有飛行模型、不進記分板、不上 HUD
 * 的接觸列表（理由同 `ships.ts` 檔頭）；船有沉沒動畫與「`position.y` 恆為
 * 水線」的假設，硬套會把工廠沉進地裡。
 *
 * **只有炸彈認得它。** 子彈與飛機都穿過去 —— 彈丸命中與撞建築都沒做，
 * 因為沒有任何一關的路徑會用到：轟炸機沒有前射武器，攔截機不對工廠開火。
 * 哪一天要做，是 `World.resolveHits` 與 `hitsShip` 各加一個對應版。
 *
 * ## 座標系
 *
 * 自身座標：X 橫、Y 上、−Z 前，原點在**地面 × 腳印中心**。`position.y`
 * 恆為 0 —— 墊面在結構上保證是 0（`leuna.ts`），這是定義不是查詢。
 */
export type GroundKind =
  | 'hydroTower' | 'chimney' | 'boilerHouse' | 'oilTank' | 'gasHolder' | 'coolingTower'

/** 一種構件的靜態資料。同種構件共用 */
export interface GroundClass {
  readonly id: GroundKind
  readonly name: string
  /** 腳印 × 高，m。幾何與命中盒都對著它做 */
  readonly size: { readonly x: number; readonly y: number; readonly z: number }
  /**
   * 命中盒，自身座標，底貼 0。圓柱與截錐用**外接方盒**：保守近似，盒角
   * 比圓面多出一圈，炸彈落在那一圈會提前在盒頂引爆。煙囪的角差不到 2 m、
   * 氣櫃約 8 m，對 30 m 的爆炸半徑都不構成差別。
   */
  readonly hull: readonly Box[]
  /** 包圍球半徑，m。**必須是上界**（`hit.ts` 的 `boundingRadius`） */
  readonly radius: number
  /** 血量。用「幾枚炸彈」訂：一枚 9,000、30 m 線性衰減，直擊算滿 */
  readonly hp: number
}

export interface GroundTarget extends StrikeTarget {
  readonly kind: 'ground'
  readonly cls: GroundClass
  hp: number
  alive: boolean
}

const UP = /* @__PURE__ */ new Vector3(0, 1, 0)

/** 一個由腳印與高度撐起來的盒，底貼 0 */
function block(x: number, y: number, z: number): Box {
  return { center: new Vector3(0, y / 2, 0), half: new Vector3(x / 2, y / 2, z / 2) }
}

function define(id: GroundKind, name: string, x: number, y: number, z: number, hp: number): GroundClass {
  const hull = [block(x, y, z)]
  // 【多留 5%】上界是規則，餘裕是保險
  return { id, name, size: { x, y, z }, hull, radius: boundingRadius(hull) * 1.05, hp }
}

/** 六種構件。尺寸與血量都是**起始值，由試飛裁定** */
export const GROUND_CLASSES: Readonly<Record<GroundKind, GroundClass>> = {
  hydroTower: define('hydroTower', '氫化塔', 8, 40, 8, 8_000),
  chimney: define('chimney', '煙囪', 8, 100, 8, 8_000),
  boilerHouse: define('boilerHouse', '鍋爐房', 60, 18, 30, 16_000),
  oilTank: define('oilTank', '儲油槽', 25, 12, 25, 6_000),
  gasHolder: define('gasHolder', '氣櫃', 40, 35, 40, 14_000),
  coolingTower: define('coolingTower', '冷卻塔', 30, 40, 30, 14_000),
}

/** 命中盒的頂，自身座標。HUD 標記與落點求解的平面都用它 */
export function groundTopOf(cls: GroundClass): number {
  let top = 0
  for (const b of cls.hull) {
    const t = b.center.y + b.half.y
    if (t > top) top = t
  }
  return top
}

export function createGroundTarget(
  index: number, cls: GroundClass, team: Team, x: number, z: number, heading: number,
): GroundTarget {
  return {
    kind: 'ground',
    index,
    team,
    cls,
    position: new Vector3(x, 0, z),
    orientation: new Quaternion().setFromAxisAngle(UP, heading),
    speed: 0,
    hull: cls.hull,
    impactY: groundTopOf(cls),
    value: cls.hp,
    hp: cls.hp,
    alive: true,
  }
}

/** 換一場時回滿血。位置與朝向不變 —— 建築不會動 */
export function resetGroundTarget(t: GroundTarget): void {
  t.hp = t.cls.hp
  t.alive = true
}
